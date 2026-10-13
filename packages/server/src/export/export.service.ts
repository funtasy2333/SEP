import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
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
import { ConvertService } from '../convert/convert.service';
import { DocumentService } from '../document/document.service';
import type { ExportWarning } from './export-http';
import { blockExternalImages } from './external-images';

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
  Promise.reject(
    new Error('服务端导出不访问网络资源，请使用内嵌（data URL）图片'),
  );

/** null、非对象，或没有任何顶层节点：视为空内容。 */
function isEmptyContent(content: unknown): boolean {
  if (typeof content !== 'object' || content === null) return true;
  const nodes = (content as { content?: unknown }).content;
  return !Array.isArray(nodes) || nodes.length === 0;
}

function unprocessable(
  message: string,
  extra: Record<string, unknown> = {},
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message,
    ...extra,
  });
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
   * 同步封面元数据 → 导出前检查（脚注、输出边界）→ buildDocx。
   * 文档库里保存的 content 就是编辑器 getJSON() 的结果（保存前同样经过封面同步）。
   *
   * 日志只记录文档 id、字节数与告警条数，不记录文档内容或告警消息（可能含正文片段）。
   *
   * @param createdAt 写入 docProps/core.xml 的时间；缺省为当前时间。固定它可得到可复现的字节。
   */
  async exportDocx(id: number, createdAt?: string): Promise<DocxExportResult> {
    const doc = await this.documentService.findOne(id);
    if (isEmptyContent(doc.content)) {
      throw unprocessable('文档内容为空，无法导出 DOCX');
    }
    // 实体上的 meta 类型是 shared DocumentMeta 的子集（standardType 为 string），数据形状一致。
    const meta = (doc.meta ?? {}) as unknown as DocumentMeta;

    let pmDoc: PMJsonNode;
    let failure: ExportGuardFailure | null;
    try {
      pmDoc = synchronizeCoverMetadata(
        doc.content,
        meta,
      ) as unknown as PMJsonNode;
      failure = checkExportGuard(pmDoc, 'docx');
    } catch (error) {
      // 库里的 content 不是合法的编辑器文档结构；错误消息可能带正文片段，不写日志。
      this.logger.warn(
        `文档 #${id} 内容无法解析，DOCX 导出中止（${(error as Error).name}）`,
      );
      throw unprocessable('文档内容结构无法解析，无法导出 DOCX');
    }
    if (failure) {
      throw unprocessable(failure.message, {
        source: failure.source,
        detail: failure.detail,
        problems: failure.problems,
      });
    }

    try {
      const { bytes, warnings } = await buildDocx({
        pmDoc,
        documentMeta: meta,
        stage: doc.stage,
        createdAt,
        imageResources: { fetcher: rejectAllFetcher },
      });
      this.logger.log(
        `文档 #${id} DOCX 导出成功：${bytes.length} 字节，${warnings.length} 条告警`,
      );
      return {
        bytes,
        warnings,
        filename: `${meta.titleCn?.trim() || DEFAULT_FILE_TITLE}.docx`,
      };
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
   * 按文档 id 取出库中内容并做编辑器导出前的同样处理（PDF / HTML / JSON 共用）：
   * 内容为空 → 422；同步封面元数据；除 json 外做导出前检查（脚注、输出边界）→ 未通过 422。
   * 结构无法解析同样 422（错误消息可能带正文片段，不写日志）。
   */
  private async prepareForExport(
    id: number,
    format: Extract<ExportGuardFormat, 'pdf' | 'html' | 'json'>,
  ): Promise<{ meta: DocumentMeta; pmDoc: PMJsonNode; filenameBase: string }> {
    const label = format.toUpperCase();
    const doc = await this.documentService.findOne(id);
    if (isEmptyContent(doc.content)) {
      throw unprocessable(`文档内容为空，无法导出 ${label}`);
    }
    const meta = (doc.meta ?? {}) as unknown as DocumentMeta;

    let pmDoc: PMJsonNode;
    let failure: ExportGuardFailure | null;
    try {
      pmDoc = synchronizeCoverMetadata(
        doc.content,
        meta,
      ) as unknown as PMJsonNode;
      failure = checkExportGuard(pmDoc, format);
    } catch (error) {
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
      pmDoc,
      filenameBase: meta.titleCn?.trim() || DEFAULT_FILE_TITLE,
    };
  }

  /**
   * 按文档 id 导出语义 HTML（screen 变体），与编辑器 handleExportFormat('html') 等价：
   * 同步封面元数据 → 导出前检查 → exportSemanticHtml。
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
   * 同步封面元数据 → exportSemanticJson → `JSON.stringify(…, null, 2)`。
   * json 不做导出前检查（与编辑器一致），因此导出阶段的任何失败都来自文档内容本身，一律 422。
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
   * 同步封面元数据 → 导出前检查 → buildPdfExportRequest（print HTML + 目次目标，meta 取
   * irMetaFromDocumentMeta(文档库 meta)）→ 现有 IR→HTML→PDF 两遍构建管线。
   *
   * 校验顺序：404 → 422（内容为空、导出前检查）→ 503（管线缺依赖，响应体列出缺少的依赖）→ 生成（失败 500）。
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
