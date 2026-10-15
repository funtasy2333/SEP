/**
 * DOCX client 薄壳：出件逻辑位于 `@ses/io`（ProseMirror → IR → Resolver → shared DOCX renderer → JSZip），
 * 此处只把字节结果包装为浏览器下载用的 Blob，并保留原有导出名。
 */

import {
  DOCX_MIME_TYPE,
  buildDocx,
  packageDocxBytes,
  prepareDocxInput,
  resolveDocumentStage,
  type BuildDocxOptions,
  type PreparedDocxInput,
} from '@ses/io'
import type { DocxPackage } from '@ses/shared'

export { DOCX_MIME_TYPE, prepareDocxInput, resolveDocumentStage }
export type { BuildDocxOptions, PreparedDocxInput }

/** JSZip 的 uint8array 输出由普通 ArrayBuffer 支撑；类型上默认是 ArrayBufferLike，需收窄后才能作为 BlobPart。 */
function toDocxBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: DOCX_MIME_TYPE })
}

/** 将 shared 返回的 XML 部件与 base64 二进制部件完整写入 DOCX Blob。 */
export async function packageDocx(docxPackage: DocxPackage): Promise<Blob> {
  return toDocxBlob(await packageDocxBytes(docxPackage))
}

/** 生成 DOCX Blob；createdAt 默认取调用时刻，便于与 shared 输出保持一致。 */
export async function buildDocxBlob(options: BuildDocxOptions): Promise<{
  blob: Blob
  warnings: DocxPackage['warnings']
}> {
  const { bytes, warnings } = await buildDocx(options)
  return { blob: toDocxBlob(bytes), warnings }
}
