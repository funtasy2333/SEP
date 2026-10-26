import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  buildDocx,
  buildPdfExportRequest,
  checkExportGuard,
  exportSemanticHtml,
  exportSemanticJson,
  synchronizeCoverMetadata,
  type ExportGuardFailure,
  type ExportGuardFormat,
} from '@ses/io';
import {
  analyzeDocument,
  irMetaFromDocumentMeta,
  pmToIr,
  type DocumentMeta,
  type IRProblem,
  type PMJsonNode,
  type ValidationReport,
} from '@ses/shared';
import { schemaProblemDetails, unprocessable } from '../common/http-errors';
import { ConvertService } from '../convert/convert.service';
import { isEmptyContent } from '../document/document-content';
import { DocumentService } from '../document/document.service';
import { EditorContentError } from '../editor-schema/editor-content-error';
import { validateContent } from '../editor-schema/editor-schema';
import type { ExportWarning } from './export-http';
import {
  EXTERNAL_IMAGE_REJECTED_MESSAGE,
  blockExternalImages,
} from './external-images';

export interface DocxExportResult {
  bytes: Uint8Array;
  warnings: ExportWarning[];
  /** 下载文件名（含扩展名）：meta.titleCn，为空时「标准文件」。 */
  filename: string;
}

export interface TextExportResult {
  /** HTML 或语义 JSON 文本（UTF-8）。 */
  content: string;
  /** 下载文件名（含扩展名）：meta.titleCn，为空时「标准文件」。 */
  filename: string;
}

export interface PdfExportResult {
  bytes: Buffer;
  /** 被拒绝抓取的外部图片等，由接口放进 X-SES-Export-Warning* 响应头。 */
  warnings: ExportWarning[];
  /** 下载文件名（含扩展名）：meta.titleCn，为空时「标准文件」。 */
  filename: string;
}

const DEFAULT_FILE_TITLE = '标准文件';

/**
 * 服务端不发起任何网络请求去抓图片：文档内容可能来自 AI 或他人，允许服务端按文档里的 URL
 * 取资源即 SSRF（可探测内网、云元数据地址）。data URL 在本地解码，不经过 fetcher；
 * 其余 http(s)/blob/相对路径都会走到这里被拒绝，由 @ses/io 记为 image-resource-failed 告警，
 * 导出继续（该图在 DOCX 中以缺图占位）。
 */
const rejectAllFetcher: typeof fetch = () =>
  Promise.reject(new Error(EXTERNAL_IMAGE_REJECTED_MESSAGE));

/** prepareForExport 的结果：封面已同步、已按生产 schema 校验的文档，以及导出所需的元数据。 */
interface PreparedExport {
  meta: DocumentMeta;
  stage: string;
  pmDoc: PMJsonNode;
  filenameBase: string;
}

/** 参与导出前检查的格式（json 与编辑器一致不检查）。 */
type GuardedFormat = Extract<ExportGuardFormat, 'docx' | 'pdf' | 'html'>;
/** 带 json：json 不做导出前检查，但同样要先校验结构。 */
type ExportFormat = GuardedFormat | Extract<ExportGuardFormat, 'json'>;

/** {@link ExportService.validateForExport} 逐一检查的格式。 */
export const VALIDATED_EXPORT_FORMATS: readonly GuardedFormat[] = [
  'docx',
  'pdf',
  'html',
];

/**
 * 检查的用途，决定 422 与日志里的措辞：`action` 接在「无法」之后（导出 DOCX / 校验），
 * `aborted` 接在「中止」之前（DOCX 导出 / 校验）。导出沿用原有措辞，不因共用检查而改变。
 */
interface CheckPurpose {
  action: string;
  aborted: string;
}

/** {@link ExportService.inspect} 的结果：{@link PreparedExport}、读到的 revision 与各格式的导出前检查结论。 */
interface InspectedDocument extends PreparedExport {
  revision: number;
  /** 每个被检查的格式 → 未通过时的失败信息，通过为 null。 */
  failures: ReadonlyMap<ExportFormat, ExportGuardFailure | null>;
}

/** {@link ExportService.validateForExport} 的结果。 */
export interface ExportValidation {
  /** 本次检查所基于的文档 revision。 */
  revision: number;
  /**
   * 文档的 Resolver 问题，与 apply_operations 返回的 problems 同一来源（`resolve(pmToIr(文档).doc).problems`），
   * 只是没有 `introduced`（没有「本批操作」可供对比）。
   */
  problems: IRProblem[];
  /** Phase 6 手动质量报告；与旧 problems / 导出检查分开，不改变导出阻断规则。 */
  quality: ValidationReport;
  /** 各格式的导出前检查结论：null 表示通过；否则与对应导出接口 422 响应体里的 source、message、problems 相同。 */
  checks: Record<GuardedFormat, ExportGuardFailure | null>;
  /** PDF 管线是否可用（与 GET /api/convert/capabilities 的 htmlToPdf 一致）。 */
  pdfAvailable: boolean;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly convertService: ConvertService,
  ) {}

  /**
   * 按文档 id 导出 DOCX，路径与编辑器 EditorView.handleExportFormat('docx') 等价：
   * 同步封面元数据 → 按生产 schema 解析为 ProseMirror 文档（getSynchronizedEditorDoc 的 nodeFromJSON）
   * → 导出前检查（脚注、输出边界）→ buildDocx。前三步见 {@link prepareForExport}。
   *
   * 后续步骤使用 ProseMirror 文档的 toJSON()，与编辑器把 PMNode 交给 checkExportGuard / buildDocx
   *（二者内部同样先调 toJSON()）等价：缺省属性已按 schema 补齐，字节与编辑器一致。
   *
   * 日志只记录文档 id、字节数与告警条数，不记录文档内容或告警消息（可能含正文片段）。
   *
   * @param createdAt 写入 docProps/core.xml 的时间；缺省为当前时间。固定它可得到可复现的字节。
   */
  async exportDocx(id: number, createdAt?: string): Promise<DocxExportResult> {
    const { meta, stage, pmDoc, filenameBase } = await this.prepareForExport(
      id,
      'docx',
    );

    try {
      const { bytes, warnings } = await buildDocx({
        pmDoc,
        documentMeta: meta,
        stage,
        createdAt,
        imageResources: { fetcher: rejectAllFetcher },
      });
      this.logger.log(
        `文档 #${id} DOCX 导出成功：${bytes.length} 字节，${warnings.length} 条告警`,
      );
      return { bytes, warnings, filename: `${filenameBase}.docx` };
    } catch (error) {
      this.logger.error(
        `文档 #${id} DOCX 导出失败（${(error as Error).name}）`,
      );
      throw new InternalServerErrorException(
        `DOCX 导出失败：${(error as Error).message || error}`,
      );
    }
  }

  /**
   * 按文档 id 取出库中内容并做编辑器导出前的同样处理（DOCX / PDF / HTML / JSON 导出共用）：
   * 内容为空 → 422；同步封面元数据；按生产 schema 校验并取 ProseMirror 文档的 toJSON()，不符合 → 422；
   * 除 json 外做导出前检查（脚注、输出边界）→ 未通过 422。json 与编辑器一致不做导出前检查，但同样校验结构。
   * 前几步与检查本身见 {@link inspect}，校验接口 {@link validateForExport} 走同一个方法。
   */
  private async prepareForExport(
    id: number,
    format: ExportFormat,
  ): Promise<PreparedExport> {
    const label = format.toUpperCase();
    const { failures, ...prepared } = await this.inspect(id, [format], {
      action: `导出 ${label}`,
      aborted: `${label} 导出`,
    });
    const failure = failures.get(format);
    if (failure) {
      throw unprocessable(failure.message, {
        source: failure.source,
        detail: failure.detail,
        problems: failure.problems,
      });
    }
    return prepared;
  }

  /**
   * 导出与校验共用的「读取 + 检查」：读取文档（不存在 404），内容为空 → 422，同步封面元数据，
   * 按生产 schema 校验并取 toJSON()，再对 `formats` 里的每个格式做导出前检查（`checkExportGuard`：脚注，输出边界）。
   * 检查结论放在返回值里（未通过不抛），由调用方决定是转成 422（导出）还是原样汇报（校验）；
   * 内容为空、不符合 schema、结构无法解析则在这里直接抛 422。
   *
   * 文档库里保存的 content 就是编辑器 getJSON() 的结果（保存前同样经过封面同步）；
   * 但库里的内容不一定出自编辑器（API 直接写入、AI 写入），所以这里额外校验：
   * 不符合 schema 的内容返回 422，而不是导出一份缺失或错乱的文件。
   *
   * 只读：不写库、不补 nodeId。日志只记录文档 id、问题类别与 JSON Pointer（下标与固定字段名），
   * 不记录节点类型、消息或正文（错误消息可能带正文片段）。
   *
   * `documentService.findOne` 经过写锁：operations 事务进行期间，这里等它结束，读到的一定是已提交的内容与 revision。
   * 锁只覆盖这次读取；校验、检查以及之后的导出构建（含耗时的 PDF 管线）都在锁外，不会阻塞写入。
   */
  private async inspect(
    id: number,
    formats: readonly ExportFormat[],
    purpose: CheckPurpose,
  ): Promise<InspectedDocument> {
    const doc = await this.documentService.findOne(id);
    if (isEmptyContent(doc.content)) {
      throw unprocessable(`文档内容为空，无法${purpose.action}`);
    }
    // 实体上的 meta 类型是 shared DocumentMeta 的子集（standardType 为 string），数据形状一致。
    const meta = (doc.meta ?? {}) as unknown as DocumentMeta;

    let pmDoc: PMJsonNode;
    const failures = new Map<ExportFormat, ExportGuardFailure | null>();
    try {
      const synchronized = synchronizeCoverMetadata(doc.content, meta);
      pmDoc = validateContent(synchronized).toJSON() as PMJsonNode;
      for (const format of formats) {
        failures.set(format, checkExportGuard(pmDoc, format));
      }
    } catch (error) {
      if (error instanceof EditorContentError) {
        this.logger.warn(
          `文档 #${id} 内容不符合编辑器文档结构，${purpose.aborted}中止（${error.problem.code}，${error.problem.path || '根节点'}）`,
        );
        throw unprocessable(
          `文档内容不符合编辑器文档结构，无法${purpose.action}：${error.message}`,
          schemaProblemDetails(error),
        );
      }
      // 库里的 content 无法解析；错误消息可能带正文片段，不写日志。
      this.logger.warn(
        `文档 #${id} 内容无法解析，${purpose.aborted}中止（${(error as Error).name}）`,
      );
      throw unprocessable(`文档内容结构无法解析，无法${purpose.action}`);
    }
    return {
      revision: doc.revision,
      meta,
      stage: doc.stage,
      pmDoc,
      filenameBase: meta.titleCn?.trim() || DEFAULT_FILE_TITLE,
      failures,
    };
  }

  /**
   * 校验文档（MCP 的 validate_document 使用）：只读，不写库，不生成文件。
   *
   * - `checks`：docx / pdf / html 的导出前检查，与对应导出接口是同一套判断（同一个 {@link inspect}：
   *   同步封面元数据 → 生产 schema 校验 → `checkExportGuard`），所以这里通过的格式，导出接口在检查这一步也一定通过；
   * - `problems`：文档的 Resolver 问题。基于同一份已校验的文档，与 apply_operations 返回的 problems 同一来源；
   * - `pdfAvailable`：PDF 管线是否可用。检查通过而管线不可用时，导出 PDF 仍会 503（顺序与导出接口一致：先 422 后 503）。
   *
   * 文档不存在 404；内容为空、不符合生产 schema、结构无法解析 → 422，与导出接口一致。json 不做导出前检查，不在其中。
   */
  async validateForExport(id: number): Promise<ExportValidation> {
    const { revision, meta, pmDoc, failures } = await this.inspect(
      id,
      VALIDATED_EXPORT_FORMATS,
      { action: '校验', aborted: '校验' },
    );
    const checks = Object.fromEntries(
      VALIDATED_EXPORT_FORMATS.map((format) => [
        format,
        failures.get(format) ?? null,
      ]),
    ) as ExportValidation['checks'];
    const irDoc = pmToIr(pmDoc).doc;
    // 与客户端 validation worker 一致：文档设置中的元数据覆盖 PM 根节点推导值。
    irDoc.meta = { ...irDoc.meta, ...irMetaFromDocumentMeta(meta) };
    const analysis = analyzeDocument(irDoc);
    // irMetaFromDocumentMeta 只覆盖 IRDocMeta 的标量字段；Resolver 的结构化元数据内联内容不变。
    // 因而本次分析的 resolution 与旧 resolve(pmToIr(pmDoc).doc) 问题集合一致。
    const problems = analysis.resolution.problems;
    this.logger.log(
      `文档 #${id} 校验完成：${problems.length} 个文档问题，` +
        VALIDATED_EXPORT_FORMATS.map(
          (format) => `${format} ${checks[format] ? '未通过' : '通过'}`,
        ).join('、'),
    );
    return {
      revision,
      problems,
      quality: analysis.validation,
      checks,
      pdfAvailable: this.convertService.getCapabilities().htmlToPdf,
    };
  }

  /**
   * 按文档 id 导出语义 HTML（screen 变体），与编辑器 handleExportFormat('html') 等价：
   * 同步封面元数据 → 校验生产 schema → 导出前检查 → exportSemanticHtml。
   */
  async exportHtml(id: number): Promise<TextExportResult> {
    const { pmDoc, filenameBase } = await this.prepareForExport(id, 'html');
    try {
      const content = exportSemanticHtml(pmDoc);
      this.logger.log(`文档 #${id} HTML 导出成功：${content.length} 字符`);
      return { content, filename: `${filenameBase}.html` };
    } catch (error) {
      this.logger.error(
        `文档 #${id} HTML 导出失败（${(error as Error).name}）`,
      );
      throw new InternalServerErrorException(
        `HTML 导出失败：${(error as Error).message || error}`,
      );
    }
  }

  /**
   * 按文档 id 导出语义 JSON，与编辑器 handleExportFormat('json') 等价：
   * 同步封面元数据 → 校验生产 schema → exportSemanticJson → `JSON.stringify(…, null, 2)`。
   * json 不做导出前检查（与编辑器一致），但同样校验结构；通过校验之后导出阶段的失败仍一律 422。
   */
  async exportJson(id: number): Promise<TextExportResult> {
    const { pmDoc, filenameBase } = await this.prepareForExport(id, 'json');
    try {
      const content = JSON.stringify(exportSemanticJson(pmDoc), null, 2);
      this.logger.log(`文档 #${id} JSON 导出成功：${content.length} 字符`);
      return { content, filename: `${filenameBase}.json` };
    } catch (error) {
      this.logger.warn(
        `文档 #${id} 内容无法导出为语义 JSON（${(error as Error).name}）`,
      );
      throw unprocessable('文档内容结构无法解析，无法导出 JSON');
    }
  }

  /**
   * 按文档 id 导出 PDF，与编辑器 handleExportFormat('pdf') 等价：
   * 同步封面元数据 → 校验生产 schema → 导出前检查 → buildPdfExportRequest（print HTML + 目次目标，meta 取
   * irMetaFromDocumentMeta(文档库 meta)）→ 现有 IR→HTML→PDF 两遍构建管线。
   *
   * 校验顺序：404 → 422（内容为空、不符合生产 schema、导出前检查）→ 503（管线缺依赖，响应体列出缺少的依赖）→ 生成（失败 500）。
   * 管线本身与 POST /api/convert/html-to-pdf 相同，不另设并发限制。
   * 与 DOCX 一致，服务端不抓取外部图片（见 external-images.ts）：这是与编辑器路径唯一的有意差异，
   * 只在文档含非 data URL 图片时出现；其余文档交给管线的 html、toc、docTitle 与编辑器路径逐字相同。
   */
  async exportPdf(id: number): Promise<PdfExportResult> {
    const { meta, pmDoc, filenameBase } = await this.prepareForExport(
      id,
      'pdf',
    );
    if (!this.convertService.getCapabilities().htmlToPdf) {
      const missing = this.convertService.getHtmlPdfMissingDependencies();
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message:
          'PDF 导出不可用：服务端 IR→HTML→PDF 管线缺少依赖' +
          (missing.length
            ? `：${missing.join('、')}`
            : '（@vivliostyle/cli 或 poppler）'),
        missingDependencies: missing,
      });
    }

    try {
      // 不让渲染端按文档里的 URL 抓取图片（SSRF）；与 DOCX 一致，只留告警。
      const warnings = blockExternalImages(pmDoc);
      const request = buildPdfExportRequest(
        pmDoc,
        irMetaFromDocumentMeta(meta),
      );
      const bytes = await this.convertService.convertHtmlToPdf({
        html: request.html,
        toc: request.toc,
        docTitle: request.docTitle,
      });
      this.logger.log(
        `文档 #${id} PDF 导出成功：${bytes.length} 字节，${warnings.length} 条告警`,
      );
      return { bytes, warnings, filename: `${filenameBase}.pdf` };
    } catch (error) {
      this.logger.error(`文档 #${id} PDF 导出失败（${(error as Error).name}）`);
      throw new InternalServerErrorException(
        `PDF 导出失败：${(error as Error).message || error}`,
      );
    }
  }
}
