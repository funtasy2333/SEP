/**
 * DOCX 出件（平台无关）：ProseMirror JSON → IR → Resolver → shared DOCX renderer → JSZip 字节。
 * 图片由宿主解析为字节，公式由 KaTeX/MathML 转为 OMML 后交给 shared 渲染器；
 * 本模块不依赖 Tiptap、Blob 或 Node 专有 API，client 与服务端共用。
 */

import JSZip from 'jszip'
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
import { collectImageResources, type ImageResourceOptions } from './imageResources'
import { convertFormulasToOmml } from './formulaOmml'

export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ZIP_DATE = new Date(Date.UTC(1980, 0, 1))

/** 带 `toJSON()` 的文档对象（如 ProseMirror Node）；io 不依赖 Tiptap 类型，按鸭子类型接受。 */
export interface PMJsonSource {
  toJSON(): unknown
}

export interface PreparedDocxInput {
  doc: IRDoc
  labels: ReturnType<typeof resolve>['labels']
  warnings: string[]
}

export interface BuildDocxOptions {
  pmDoc: PMJsonNode | PMJsonSource
  documentMeta?: DocumentMeta
  stage?: string
  createdAt?: string
  imageResources?: ImageResourceOptions
}

/** 文档库元数据中所有非 undefined 字段都覆盖 pmToIr 结果，空字符串也保留。 */
export function prepareDocxInput(
  pmDoc: PMJsonNode | PMJsonSource,
  documentMeta?: DocumentMeta,
): PreparedDocxInput {
  const node = pmDoc as PMJsonSource
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

/** 将 shared 返回的 XML 部件与 base64 二进制部件完整写入 DOCX 字节。 */
export async function packageDocxBytes(docxPackage: DocxPackage): Promise<Uint8Array> {
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
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

/** 生成 DOCX 字节；createdAt 默认取调用时刻，便于与 shared 输出保持一致。 */
export async function buildDocx(options: BuildDocxOptions): Promise<{
  bytes: Uint8Array
  warnings: DocxPackage['warnings']
}> {
  const { doc, labels } = prepareDocxInput(options.pmDoc, options.documentMeta)
  const [imageResult, formulaResult] = await Promise.all([
    collectImageResources(doc, options.imageResources),
    convertFormulasToOmml(doc),
  ])
  const docxPackage = renderDocx(doc, labels, {
    images: imageResult.images,
    formulaOmml: formulaResult.formulaOmml,
    stage: resolveDocumentStage(options.stage),
    createdAt: options.createdAt ?? new Date().toISOString(),
  })
  return {
    bytes: await packageDocxBytes(docxPackage),
    warnings: [
      ...formulaResult.warnings,
      ...imageResult.diagnostics.map(({ nodeId, message }) => ({ code: 'image-resource-failed', nodeId, message })),
      ...docxPackage.warnings,
    ],
  }
}
