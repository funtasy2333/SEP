/**
 * 为 shared DOCX 渲染器准备 IR 图片资源。
 *
 * client 是资源边界：此模块可解析 data URL、fetch URL/blob URL，以及由宿主资源仓库解析的
 * resource key；shared 只接收 base64、MIME 与像素尺寸，不访问网络或浏览器 API。
 */

import type { IRBlock, IRChapterChild, IRDoc, IRFigure, IRTermEntry, NodeId, DocxRenderOptions } from '@ses/shared'

export type DocxImageResource = DocxRenderOptions['images'][NodeId]

/** resource key resolver 返回的图片数据。string 可为 data URL、可 fetch URL 或裸 base64。 */
export type ImageResourceValue = Blob | ArrayBuffer | Uint8Array | Response | string

export interface ImageResourceOptions {
  /** 可用 fetch 默认值；提供此项便于应用资源代理与自动化测试。 */
  fetcher?: typeof fetch
  /** 对 asset: 等应用内部 key 返回字节或 URL；直接 data URL 和 fetchable URL 不经过该回调。 */
  resolveResourceKey?: (key: string) => ImageResourceValue | Promise<ImageResourceValue>
}

export interface ImageResourceDiagnostic {
  nodeId: NodeId
  message: string
}

export interface ImageResourcesResult {
  /** 仅包含成功读取的图片；缺失项由 shared 渲染器输出 image-missing warning。 */
  images: Record<NodeId, DocxImageResource>
  /** 供 client 日志或诊断面板使用，不替代 shared 的逐图 warning。 */
  diagnostics: ImageResourceDiagnostic[]
}

interface ImageBytes {
  bytes: Uint8Array
  contentType?: string
}

interface ImageInfo {
  contentType: DocxImageResource['contentType']
  widthPx: number
  heightPx: number
}

function visitBlocks(blocks: IRBlock[], visitFigure: (figure: IRFigure) => void): void {
  for (const block of blocks) visitBlock(block, visitFigure)
}

function visitBlock(block: IRBlock, visitFigure: (figure: IRFigure) => void): void {
  switch (block.kind) {
    case 'figure':
      visitFigure(block)
      for (const note of block.notes) visitBlocks(note.content, visitFigure)
      break
    case 'table':
      for (const row of block.rows) for (const cell of row.cells) visitBlocks(cell.content, visitFigure)
      for (const note of block.notes) visitBlocks(note.content, visitFigure)
      break
    case 'list':
      for (const item of block.items) {
        for (const child of item.content) if (child.kind === 'list') visitBlock(child, visitFigure)
      }
      break
    case 'note':
    case 'example':
      visitBlocks(block.content, visitFigure)
      break
    case 'paragraph':
    case 'formula':
      break
  }
}

function visitTermEntry(entry: IRTermEntry, visitFigure: (figure: IRFigure) => void): void {
  visitBlocks(entry.definition, visitFigure)
  for (const note of entry.notes) visitBlocks(note.content, visitFigure)
  for (const example of entry.examples) visitBlocks(example.content, visitFigure)
}

function visitStructuredChild(child: IRChapterChild, visitFigure: (figure: IRFigure) => void): void {
  if (child.kind === 'clause') {
    for (const nested of child.children) visitStructuredChild(nested, visitFigure)
  } else if (child.kind === 'termEntry') {
    visitTermEntry(child, visitFigure)
  } else {
    visitBlock(child, visitFigure)
  }
}

function collectFigures(doc: IRDoc): IRFigure[] {
  const figures: IRFigure[] = []
  const visitFigure = (figure: IRFigure) => figures.push(figure)
  visitBlocks(doc.front.foreword, visitFigure)
  visitBlocks(doc.front.introduction, visitFigure)
  for (const chapter of doc.body) for (const child of chapter.children) visitStructuredChild(child, visitFigure)
  for (const appendix of doc.appendices) for (const child of appendix.children) visitStructuredChild(child, visitFigure)
  return figures
}

function isFetchableUrl(value: string): boolean {
  if (/^(?:https?:|blob:|\/\/|\/|\.\.?\/)/i.test(value)) return true
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return false // custom schemes are resource keys, not fetch URLs.
  return value.includes('/') || /\.(?:png|jpe?g|gif)(?:[?#]|$)/i.test(value)
}

function decodeBase64(value: string): Uint8Array {
  const compact = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw new Error('base64 数据格式无效')
  }
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=')
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new Error('base64 数据无法解码')
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function parseDataUrl(value: string): ImageBytes {
  const match = /^data:(image\/(?:png|jpeg|jpg|gif));base64,([\s\S]*)$/i.exec(value)
  if (!match) throw new Error('仅支持 PNG、JPEG、GIF 的 base64 图片 data URL')
  const subtype = match[1]!.toLowerCase()
  return {
    contentType: subtype === 'image/jpg' ? 'image/jpeg' : subtype,
    bytes: decodeBase64(match[2]!),
  }
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 256 + bytes[offset + 1]!
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 256
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1000000 + bytes[offset + 1]! * 0x10000 + bytes[offset + 2]! * 0x100 + bytes[offset + 3]!
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
}

function jpegSize(bytes: Uint8Array): { widthPx: number; heightPx: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset++]!
    if (marker === 0xd9 || marker === 0xda) break // EOI or SOS, dimensions must precede scan data.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue // standalone marker
    if (offset + 1 >= bytes.length) break
    const segmentLength = readUint16BE(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break
    if (startOfFrame.has(marker)) {
      if (segmentLength < 7) break
      const heightPx = readUint16BE(bytes, offset + 3)
      const widthPx = readUint16BE(bytes, offset + 5)
      if (widthPx > 0 && heightPx > 0) return { widthPx, heightPx }
      break
    }
    offset += segmentLength
  }
  return undefined
}

function inspectImage(bytes: Uint8Array): ImageInfo {
  if (isPng(bytes)) {
    const widthPx = readUint32BE(bytes, 16)
    const heightPx = readUint32BE(bytes, 20)
    if (widthPx > 0 && heightPx > 0) return { contentType: 'image/png', widthPx, heightPx }
  }

  const jpeg = jpegSize(bytes)
  if (jpeg) return { contentType: 'image/jpeg', ...jpeg }

  if (bytes.length >= 10 &&
      bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
      bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    const widthPx = readUint16LE(bytes, 6)
    const heightPx = readUint16LE(bytes, 8)
    if (widthPx > 0 && heightPx > 0) return { contentType: 'image/gif', widthPx, heightPx }
  }

  throw new Error('无法识别图片格式或读取像素尺寸（仅支持 PNG、JPEG、GIF）')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

function contentTypeOf(value: string | null | undefined): string | undefined {
  const contentType = value?.split(';', 1)[0]?.trim().toLowerCase()
  return contentType || undefined
}

async function bytesFromResponse(response: Response): Promise<ImageBytes> {
  if (!response.ok) throw new Error(`读取图片失败，HTTP ${response.status}`)
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: contentTypeOf(response.headers.get('content-type')),
  }
}

async function bytesFromValue(value: ImageResourceValue, fetcher: typeof fetch): Promise<ImageBytes> {
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (/^data:/i.test(normalized)) return parseDataUrl(normalized)
    // A resolver may return raw base64 whose alphabet contains '/'. Validate its image signature
    // before treating an otherwise ambiguous string as a relative URL.
    try {
      const bytes = decodeBase64(normalized)
      inspectImage(bytes)
      return { bytes }
    } catch {
      // Explicit URL syntax and relative paths are handled by the fetch branch below.
    }
    if (isFetchableUrl(normalized)) return fetchBytes(normalized, fetcher)
    return { bytes: decodeBase64(normalized) }
  }
  if (typeof Response !== 'undefined' && value instanceof Response) return bytesFromResponse(value)
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { bytes: new Uint8Array(await value.arrayBuffer()), contentType: contentTypeOf(value.type) }
  }
  if (value instanceof Uint8Array) return { bytes: value }
  if (value instanceof ArrayBuffer) return { bytes: new Uint8Array(value) }
  throw new Error('资源解析器返回了不支持的数据类型')
}

async function fetchBytes(src: string, fetcher: typeof fetch): Promise<ImageBytes> {
  if (typeof fetcher !== 'function') throw new Error('当前环境没有可用的 fetch')
  return bytesFromResponse(await fetcher(src))
}

async function resolveSource(
  src: string,
  options: ImageResourceOptions,
  fetcher: typeof fetch,
): Promise<ImageBytes> {
  const normalized = src.trim()
  if (!normalized) throw new Error('图片资源地址为空')
  if (/^data:/i.test(normalized)) return parseDataUrl(normalized)
  if (isFetchableUrl(normalized)) return fetchBytes(normalized, fetcher)
  if (!options.resolveResourceKey) throw new Error('没有配置 resource key 解析器')
  return bytesFromValue(await options.resolveResourceKey(normalized), fetcher)
}

/**
 * 按文档顺序收集 IR 中所有图（包括表格单元格、图/表/注/示例及术语内容中的嵌套图），
 * 将成功读取的图片整理成 shared `DocxRenderOptions.images` 所需 map。
 */
export async function collectImageResources(doc: IRDoc, options: ImageResourceOptions = {}): Promise<ImageResourcesResult> {
  const figures = collectFigures(doc)
  const images: Record<NodeId, DocxImageResource> = Object.create(null) as Record<NodeId, DocxImageResource>
  const diagnostics: ImageResourceDiagnostic[] = []
  const sourceCache = new Map<string, Promise<DocxImageResource>>()
  const fetcher = options.fetcher ?? globalThis.fetch

  const resolved = await Promise.all(figures.map(async (figure) => {
    try {
      let pending = sourceCache.get(figure.src)
      if (!pending) {
        pending = (async () => {
          const bytes = await resolveSource(figure.src, options, fetcher)
          const info = inspectImage(bytes.bytes)
          return {
            base64: bytesToBase64(bytes.bytes),
            contentType: info.contentType,
            widthPx: info.widthPx,
            heightPx: info.heightPx,
          }
        })()
        sourceCache.set(figure.src, pending)
      }
      return { ok: true as const, nodeId: figure.id, image: await pending }
    } catch (error) {
      return { ok: false as const, diagnostic: {
        nodeId: figure.id,
        message: error instanceof Error ? error.message : String(error),
      } }
    }
  }))

  // 资源请求并发完成，但资源表和告警始终按 IR 文档顺序输出。
  for (const result of resolved) {
    if (result.ok) images[result.nodeId] = result.image
    else diagnostics.push(result.diagnostic)
  }

  return { images, diagnostics }
}
