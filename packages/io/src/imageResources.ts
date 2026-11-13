/**
 * 为 shared DOCX 渲染器准备 IR 图片资源。
 *
 * 宿主（client 或服务端）是资源边界：此模块可解析 data URL、fetch URL/blob URL，以及由宿主资源仓库解析的
 * resource key；shared 只接收 base64、MIME 与像素尺寸，不访问网络或浏览器 API。
 */

import { inlineImageResourceKey, type IRBlock, type IRChapterChild, type IRDoc, type IRTermEntry, type NodeId, type DocxRenderOptions } from '@ses/shared'

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

export interface ImageBytes {
  bytes: Uint8Array
  contentType?: string
}

interface ImageInfo {
  contentType: DocxImageResource['contentType']
  widthPx: number
  heightPx: number
}

interface ImageTarget {
  /** Key in `DocxRenderOptions.images` (`figure.id` or `inlineImageResourceKey(paragraph.id, imageIndex)`). */
  key: string
  /** Diagnostic node ID (`figure.id` or `paragraph.id`). */
  nodeId: NodeId
  src: string
  resourceId?: string
}

function visitBlocks(blocks: IRBlock[], visitTarget: (target: ImageTarget) => void): void {
  for (const block of blocks) visitBlock(block, visitTarget)
}

function visitBlock(block: IRBlock, visitTarget: (target: ImageTarget) => void): void {
  switch (block.kind) {
    case 'figure':
      visitTarget({ key: block.id, nodeId: block.id, src: block.src, resourceId: block.resourceId })
      for (const note of block.notes) visitBlocks(note.content, visitTarget)
      break
    case 'table':
      for (const row of block.rows) for (const cell of row.cells) visitBlocks(cell.content, visitTarget)
      for (const note of block.notes) visitBlocks(note.content, visitTarget)
      break
    case 'list':
      for (const item of block.items) {
        visitBlocks(item.content, visitTarget)
      }
      break
    case 'note':
    case 'example':
      visitBlocks(block.content, visitTarget)
      break
    case 'paragraph': {
      let imageIndex = 0
      for (const run of block.content) {
        if (!run.image) continue
        const idx = imageIndex++
        visitTarget({
          key: inlineImageResourceKey(block.id, idx),
          nodeId: block.id,
          src: run.image.src,
          resourceId: run.image.resourceId,
        })
      }
      break
    }
    case 'defList':
      for (const item of block.items) {
        let imageIndex = 0
        for (const run of [...item.term, ...item.definition]) {
          if (!run.image) continue
          const idx = imageIndex++
          visitTarget({
            key: inlineImageResourceKey(item.id, idx),
            nodeId: item.id,
            src: run.image.src,
            resourceId: run.image.resourceId,
          })
        }
      }
      break
    case 'formula':
      break
  }
}

function visitTermEntry(entry: IRTermEntry, visitTarget: (target: ImageTarget) => void): void {
  visitBlocks(entry.definition, visitTarget)
  for (const note of entry.notes) visitBlocks(note.content, visitTarget)
  for (const example of entry.examples) visitBlocks(example.content, visitTarget)
}

function visitStructuredChild(child: IRChapterChild, visitTarget: (target: ImageTarget) => void): void {
  if (child.kind === 'clause') {
    for (const nested of child.children) visitStructuredChild(nested, visitTarget)
  } else if (child.kind === 'termEntry') {
    visitTermEntry(child, visitTarget)
  } else {
    visitBlock(child, visitTarget)
  }
}

function collectImageTargets(doc: IRDoc): ImageTarget[] {
  const targets: ImageTarget[] = []
  const visitTarget = (target: ImageTarget) => targets.push(target)
  visitBlocks(doc.front.foreword, visitTarget)
  visitBlocks(doc.front.introduction, visitTarget)
  for (const clause of doc.front.introductionClauses ?? []) visitStructuredChild(clause, visitTarget)
  for (const chapter of doc.body) for (const child of chapter.children) visitStructuredChild(child, visitTarget)
  for (const appendix of doc.appendices) for (const child of appendix.children) visitStructuredChild(child, visitTarget)
  return targets
}

export function isFetchableUrl(value: string): boolean {
  if (/^(?:https?:|blob:|\/\/|\/|\.\.?\/)/i.test(value)) return true
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return false // custom schemes are resource keys, not fetch URLs.
  return value.includes('/') || /\.(?:png|jpe?g|gif)(?:[?#]|$)/i.test(value)
}

export function decodeBase64(value: string): Uint8Array {
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

export async function bytesFromValue(value: ImageResourceValue, fetcher: typeof fetch): Promise<ImageBytes> {
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

export async function fetchBytes(src: string, fetcher: typeof fetch): Promise<ImageBytes> {
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
 * 按文档顺序收集 IR 中所有图与段落行内图片（包括表格单元格、列表项、图/表/注/示例及术语内容中的图片），
 * 将成功读取的图片整理成 shared `DocxRenderOptions.images` 所需 map。
 */
export async function collectImageResources(doc: IRDoc, options: ImageResourceOptions = {}): Promise<ImageResourcesResult> {
  const targets = collectImageTargets(doc)
  const images: Record<NodeId, DocxImageResource> = Object.create(null) as Record<NodeId, DocxImageResource>
  const diagnostics: ImageResourceDiagnostic[] = []
  const sourceCache = new Map<string, Promise<DocxImageResource>>()
  const fetcher = options.fetcher ?? globalThis.fetch

  const resolved = await Promise.all(targets.map(async (target) => {
    try {
      const trimmedSrc = target.src.trim()
      const embeddedResource = !trimmedSrc && target.resourceId
        ? doc.resources?.find((r) => r.id === target.resourceId && (r.encoding === 'dataUrl' || r.encoding === 'base64'))
        : undefined
      const effectiveSource = trimmedSrc || (embeddedResource ? embeddedResource.data : (target.resourceId ?? ''))
      const cacheKey = `${trimmedSrc ? 'src' : 'res'}:${effectiveSource}`
      let pending = sourceCache.get(cacheKey)
      if (!pending) {
        pending = (async () => {
          const bytes = embeddedResource && embeddedResource.encoding === 'base64'
            ? { bytes: decodeBase64(embeddedResource.data), contentType: embeddedResource.mediaType }
            : await resolveSource(effectiveSource, options, fetcher)
          const info = inspectImage(bytes.bytes)
          return {
            base64: bytesToBase64(bytes.bytes),
            contentType: info.contentType,
            widthPx: info.widthPx,
            heightPx: info.heightPx,
          }
        })()
        sourceCache.set(cacheKey, pending)
      }
      return { ok: true as const, key: target.key, image: await pending }
    } catch (error) {
      return { ok: false as const, diagnostic: {
        nodeId: target.nodeId,
        message: error instanceof Error ? error.message : String(error),
      } }
    }
  }))

  // 资源请求并发完成，但资源表和告警始终按 IR 文档顺序输出。
  for (const result of resolved) {
    if (result.ok) images[result.key] = result.image
    else diagnostics.push(result.diagnostic)
  }

  return { images, diagnostics }
}
