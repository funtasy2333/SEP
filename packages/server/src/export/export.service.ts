import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  buildDocx,
  checkExportGuard,
  synchronizeCoverMetadata,
  type ExportGuardFailure,
} from '@ses/io';
import type { DocumentMeta, PMJsonNode } from '@ses/shared';
import { DocumentService } from '../document/document.service';
import type { ExportWarning } from './export-http';

export interface DocxExportResult {
  bytes: Uint8Array;
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

  constructor(private readonly documentService: DocumentService) {}

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
}
