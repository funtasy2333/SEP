/**
 * DOCX client 薄壳：ProseMirror → IR → Resolver → shared DOCX renderer → JSZip。
 * 图片与公式资源仍按 WP7.4 之前的约定留空。
 */

import JSZip from 'jszip'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  DocumentStage,
  irMetaFromDocumentMeta,
  pmToIr,
  renderDocx,
  resolve,
  type DocxPackage,
  type DocumentMeta,
  type DocumentStage as DocumentStageType,
  type IRDoc,
  type PMJsonNode,
} from '@ses/shared'

export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ZIP_DATE = new Date(1980, 0, 1)

export interface PreparedDocxInput {
  doc: IRDoc
  labels: ReturnType<typeof resolve>['labels']
  warnings: string[]
}

export interface BuildDocxOptions {
  pmDoc: PMNode | PMJsonNode
  documentMeta?: DocumentMeta
  stage?: string
  createdAt?: string
}

/** 文档库元数据中所有非 undefined 字段都覆盖 pmToIr 结果，空字符串也保留。 */
export function prepareDocxInput(
  pmDoc: PMNode | PMJsonNode,
  documentMeta?: DocumentMeta,
): PreparedDocxInput {
  const node = pmDoc as PMNode
  const pmJson = typeof node.toJSON === 'function' ? node.toJSON() as PMJsonNode : pmDoc as PMJsonNode
  const { doc, warnings } = pmToIr(pmJson)
  Object.assign(doc.meta, irMetaFromDocumentMeta(documentMeta))
  const { labels } = resolve(doc)
  return { doc, labels, warnings }
}

/** 无有效阶段值时按新建文档的工作草案阶段处理。 */
export function resolveDocumentStage(stage: string | undefined): DocumentStageType {
  const stages = Object.values(DocumentStage) as DocumentStageType[]
  return stage && stages.includes(stage as DocumentStageType)
    ? stage as DocumentStageType
    : DocumentStage.WORKING_DRAFT
}

/** 将 shared 返回的 XML 部件与 base64 二进制部件完整写入 DOCX Blob。 */
export async function packageDocx(docxPackage: DocxPackage): Promise<Blob> {
  const zip = new JSZip()
  // JSZip 默认把当前时间写入每个条目，还可能生成隐式目录；固定这两项，令同一
  // DocxPackage 的字节结果可复现。Content Types 放首项，与 pack.py 一致。
  const partPaths = Object.keys(docxPackage.parts).sort((a, b) =>
    a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : a < b ? -1 : a > b ? 1 : 0,
  )
  for (const path of partPaths) {
    zip.file(path, docxPackage.parts[path]!, { date: ZIP_DATE, createFolders: false })
  }
  for (const path of Object.keys(docxPackage.binaries).sort()) {
    zip.file(path, docxPackage.binaries[path]!, { base64: true, date: ZIP_DATE, createFolders: false })
  }
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME_TYPE, compression: 'DEFLATE' })
}

/** 生成 DOCX Blob；createdAt 默认取调用时刻，便于与 shared 输出保持一致。 */
export async function buildDocxBlob(options: BuildDocxOptions): Promise<{
  blob: Blob
  warnings: DocxPackage['warnings']
}> {
  const { doc, labels } = prepareDocxInput(options.pmDoc, options.documentMeta)
  const docxPackage = renderDocx(doc, labels, {
    images: {},
    formulaOmml: {},
    stage: resolveDocumentStage(options.stage),
    createdAt: options.createdAt ?? new Date().toISOString(),
  })
  return {
    blob: await packageDocx(docxPackage),
    warnings: docxPackage.warnings,
  }
}

/** 将同一 DOCX Blob 作为 multipart 文件提交给服务端 LibreOffice 转换接口。 */
export async function convertDocxToPdf(
  docxBlob: Blob,
  filename: string,
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  const baseName = filename.replace(/\.docx$/i, '') || '标准文件'
  const form = new FormData()
  form.append('file', docxBlob, `${baseName}.docx`)

  const response = await fetcher('/api/convert/docx-to-pdf', {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const message = detail.trim() || response.statusText
    throw new Error(`服务器转换失败 (${response.status})${message ? `: ${message}` : ''}`)
  }
  return response.blob()
}
