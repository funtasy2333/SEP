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
  irMetaFromDocumentMeta,
  type DocumentMeta,
  type PMJsonNode,
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
   * 按文档 id 取出库中内容并做编辑器导出前的同样处理（DOCX / PDF / HTML / JSON 共用）：
   * 内容为空 → 422；同步封面元数据；按生产 schema 校验并取 ProseMirror 文档的 toJSON()，不符合 → 422；
   * 除 json 外做导出前检查（脚注、输出边界）→ 未通过 422。json 与编辑器一致不做导出前检查，但同样校验结构。
   *
   * 文档库里保存的 content 就是编辑器 getJSON() 的结果（保存前同样经过封面同步）；
   * 但库里的内容不一定出自编辑器（API 直接写入、AI 写入），所以这里额外校验：
   * 不符合 schema 的内容返回 422，而不是导出一份缺失或错乱的文件。
   *
   * 结构无法解析同样 422。日志只记录文档 id、问题类别与 JSON Pointer（下标与固定字段名），
   * 不记录节点类型、消息或正文（错误消息可能带正文片段）。
   */
  private async prepareForExport(
    id: number,
    format: Extract<ExportGuardFormat, 'docx' | 'pdf' | 'html' | 'json'>,
  ): Promise<PreparedExport> {
    const label = format.toUpperCase();
    const doc = await this.documentService.findOne(id);
    if (isEmptyContent(doc.content)) {
      throw unprocessable(`文档内容为空，无法导出 ${label}`);
    }
    // 实体上的 meta 类型是 shared DocumentMeta 的子集（standardType 为 string），数据形状一致。
    const meta = (doc.meta ?? {}) as unknown as DocumentMeta;

    let pmDoc: PMJsonNode;
    let failure: ExportGuardFailure | null;
    try {
      const synchronized = synchronizeCoverMetadata(doc.content, meta);
      pmDoc = validateContent(synchronized).toJSON() as PMJsonNode;
      failure = checkExportGuard(pmDoc, format);
    } catch (error) {
      if (error instanceof EditorContentError) {
        this.logger.warn(
          `文档 #${id} 内容不符合编辑器文档结构，${label} 导出中止（${error.problem.code}，${error.problem.path || '根节点'}）`,
        );
        throw unprocessable(
          `文档内容不符合编辑器文档结构，无法导出 ${label}：${error.message}`,
          schemaProblemDetails(error),
        );
      }
      // 库里的 content 无法解析；错误消息可能带正文片段，不写日志。
      this.logger.warn(
        `文档 #${id} 内容无法解析，${label} 导出中止（${(error as Error).name}）`,
      );
      throw unprocessable(`文档内容结构无法解析，无法导出 ${label}`);
    }
    if (failure) {
      throw unprocessable(failure.message, {
        source: failure.source,
        detail: failure.detail,
        problems: failure.problems,
      });
    }
    return {
      meta,
      stage: doc.stage,
      pmDoc,
      filenameBase: meta.titleCn?.trim() || DEFAULT_FILE_TITLE,
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
