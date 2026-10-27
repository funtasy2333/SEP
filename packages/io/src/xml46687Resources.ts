/**
 * 为 GB/T 46687.2 XML 导出准备图片资源（WP8.2 设计 §4.3、§5.2 (b)）。
 *
 * 条目清单来自 shared 的 `collectXml46687ImageRefs`——与渲染器是同一个函数，故 `xlink:href` 天然一致；
 * 取字节复用 `imageResources.ts`（data URL / fetch / resource key 解析）。与 DOCX 的差别：DOCX 只收
 * PNG/JPEG/GIF 并读像素尺寸；XML 只要求 `image/*`，接受 SVG 与 WebP，不读尺寸（`graphic` 无尺寸属性）。
 *
 * 宿主（client 或服务端）是资源边界：此模块不访问网络或浏览器 API，除非宿主给了 fetcher / resolver（或环境自带 fetch）。
 */

import {
  collectXml46687ImageRefs,
  type IRDoc,
  type IRResource,
  type NodeId,
  type ResolvedLabel,
  type ResourceManifest,
  type ResourceManifestEntry,
  type ResourceManifestSource,
  type Xml46687Problem,
} from '@ses/shared'
import {
  bytesFromValue,
  decodeBase64,
  fetchBytes,
  isFetchableUrl,
  type ImageBytes,
  type ImageResourceOptions,
} from './imageResources'

export interface Xml46687ResourcesResult {
  /** 成功读取的图片的清单，按 IR 文档序；失败项不进清单。 */
  manifest: ResourceManifest
  /** 资源包内的文件：键为 `ResourceManifestEntry.fileName`（无目录），值为字节。同一字节被多处引用时各写各的文件，不去重。 */
  files: Record<string, Uint8Array>
  problems: Xml46687Problem[]
}

interface LoadedImage {
  bytes: Uint8Array
  mediaType: string
  source: ResourceManifestSource
}

type LoadResult =
  | { ok: true; image: LoadedImage }
  | { ok: false; code: 'resource-load-failed' | 'resource-media-type'; reason: string }

/** 媒体类型无法落实为 `image/*` 时抛出，用来与读取失败区分。 */
class MediaTypeError extends Error {}

const textEncoder = new TextEncoder()

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value)
}

/** 二进制签名：PNG、JPEG、GIF、WebP。 */
function sniffBinaryImageType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return undefined
}

/** SVG 是文本：BOM / XML 声明 / 注释 / DOCTYPE 之后的根元素是 `svg`。 */
const SVG_HEAD = /^﻿?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i

function sniffSvg(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096))
  return SVG_HEAD.test(head) ? 'image/svg+xml' : undefined
}

function normalizeMediaType(value: string | undefined): string | undefined {
  const type = value?.split(';', 1)[0]?.trim().toLowerCase()
  if (!type) return undefined
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg'
  if (type === 'image/x-png') return 'image/png'
  return type
}

/**
 * 字节签名优先（PNG/JPEG/GIF/WebP，再看 SVG 根元素）；签名无法判定者取声明的媒体类型，且必须是 `image/*`。
 * 声明与字节不符时以字节为准。
 */
function resolveMediaType(bytes: Uint8Array, declared: string | undefined): string {
  const sniffed = sniffBinaryImageType(bytes) ?? sniffSvg(bytes)
  if (sniffed) return sniffed
  const type = normalizeMediaType(declared)
  if (type && /^image\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type)) return type
  throw new MediaTypeError(
    type
      ? `媒体类型「${type}」不是图片类型，字节内容也不是已知的图片格式`
      : '没有给出图片的媒体类型，字节内容也不是已知的图片格式',
  )
}

const KNOWN_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}

/** 文件扩展名由媒体类型决定：png/jpg/gif/svg/webp；其他 `image/*` 取子类型的最后一段（如 `image/bmp` → `bmp`）。 */
function extensionOf(mediaType: string): string {
  const known = KNOWN_EXTENSIONS[mediaType]
  if (known) return known
  const subtype = mediaType.slice('image/'.length).replace(/^x-/, '').split('+', 1)[0]!
  const last = subtype.split('.').pop() ?? ''
  return last.replace(/[^a-z0-9]/g, '') || 'bin'
}

/** 与 `imageResources.ts` 的 `parseDataUrl` 不同：接受任何 `data:` 载荷（SVG、WebP……），媒体类型之后由 `resolveMediaType` 判定。 */
function parseImageDataUrl(value: string): ImageBytes {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(value)
  if (!match) throw new Error('data URL 格式无效')
  const [mime = '', ...parameters] = match[1]!.split(';').map(part => part.trim())
  const contentType = mime.toLowerCase() || undefined
  if (parameters.some(parameter => parameter.toLowerCase() === 'base64')) {
    return { bytes: decodeBase64(match[2]!), contentType }
  }
  try {
    return { bytes: textEncoder.encode(decodeURIComponent(match[2]!)), contentType }
  } catch {
    throw new Error('data URL 的数据无法解码')
  }
}

function bytesOfResource(resource: IRResource): ImageBytes {
  const declared = normalizeMediaType(resource.mediaType)
  switch (resource.encoding) {
    case 'dataUrl': {
      const parsed = parseImageDataUrl(resource.data.trim())
      const candidates = [declared, normalizeMediaType(parsed.contentType)]
      return { bytes: parsed.bytes, contentType: candidates.find(type => type?.startsWith('image/')) ?? declared ?? parsed.contentType }
    }
    case 'base64':
      return { bytes: decodeBase64(resource.data), contentType: declared }
    case 'text':
      return { bytes: textEncoder.encode(resource.data), contentType: declared }
    default:
      throw new Error(`不支持的资源编码「${String(resource.encoding)}」`)
  }
}

/** 同 `imageResources.ts` 的 `resolveSource`，但 data URL（直接给出的，或由 resolver 返回的）不限于 PNG/JPEG/GIF。 */
async function resolveImageSource(
  src: string,
  options: ImageResourceOptions,
  fetcher: typeof fetch,
): Promise<ImageBytes> {
  const normalized = src.trim()
  if (!normalized) throw new Error('图片资源地址为空')
  if (/^data:/i.test(normalized)) return parseImageDataUrl(normalized)
  if (isFetchableUrl(normalized)) return fetchBytes(normalized, fetcher)
  if (!options.resolveResourceKey) throw new Error('没有配置 resource key 解析器')
  const resolved = await options.resolveResourceKey(normalized)
  if (typeof resolved === 'string' && /^data:/i.test(resolved.trim())) return parseImageDataUrl(resolved.trim())
  return bytesFromValue(resolved, fetcher)
}

/**
 * 收集 IR 中全部图片（块图与行内图）并整理成资源清单与文件。
 *
 * - 键 = `resourceId`（在 `doc.resources` 中查找，`encoding` 为 `dataUrl`/`base64`/`text`，媒体类型用资源自带值）；
 *   不在 `doc.resources` 中、或没有 `resourceId` 时取 `src`（data URL / 可 fetch 的 URL / 经 `resolveResourceKey` 解析的资源键）。
 * - 媒体类型：字节签名优先（PNG/JPEG/GIF/WebP/SVG），签名无法判定者取声明值；不是 `image/*` → error `resource-media-type`。
 * - 文件名 `<href>.<扩展名>`；`href` 或文件名在忽略大小写后重复 → error `resource-name-conflict`（先到者保留）。
 * - 读取失败 → error `resource-load-failed`（带 nodeId、IR 路径、原因）。失败项**不进清单**，渲染器随后会再报 `resource-missing`，
 *   两处各自成立（UI 按 nodeId 合并显示）。
 * - 同一资源被多处引用：各得各的 `href` 与文件，不去重；同一键的字节只读取一次。
 * - `problems`、清单条目都按 IR 文档序（资源请求并发完成，不影响顺序）。
 */
export async function collectXml46687Resources(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  options: ImageResourceOptions = {},
): Promise<Xml46687ResourcesResult> {
  const refs = collectXml46687ImageRefs(doc, labels)
  const resourceById = new Map<string, IRResource>((doc.resources ?? []).map(resource => [resource.id, resource]))
  const fetcher = options.fetcher ?? globalThis.fetch
  const cache = new Map<string, Promise<LoadResult>>()

  const load = (key: string): Promise<LoadResult> => {
    let pending = cache.get(key)
    if (!pending) {
      pending = (async (): Promise<LoadResult> => {
        try {
          const resource = resourceById.get(key)
          const raw = resource ? bytesOfResource(resource) : await resolveImageSource(key, options, fetcher)
          if (raw.bytes.length === 0) throw new Error('图片数据为空')
          const source: ResourceManifestSource = resource ? 'resource' : /^data:/i.test(key.trim()) ? 'dataUrl' : 'src'
          return { ok: true, image: { bytes: raw.bytes, mediaType: resolveMediaType(raw.bytes, raw.contentType), source } }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return { ok: false, code: error instanceof MediaTypeError ? 'resource-media-type' : 'resource-load-failed', reason }
        }
      })()
      cache.set(key, pending)
    }
    return pending
  }

  const results = await Promise.all(refs.map(ref => load(ref.key)))

  const entries: ResourceManifestEntry[] = []
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  const problems: Xml46687Problem[] = []
  const hrefsByLowerCase = new Map<string, string>()
  const fileNamesByLowerCase = new Map<string, string>()

  refs.forEach((ref, index) => {
    const result = results[index]!
    const where = ref.ownerId === '' ? {} : { nodeId: ref.ownerId }
    const subject = ref.kind === 'figure' ? '图' : '行内图'
    const at = `${subject}（${ref.ownerId === '' ? ref.path : `节点 ${ref.ownerId}`}）`
    if (!result.ok) {
      problems.push({
        code: result.code,
        severity: 'error',
        ...where,
        path: ref.path,
        message: result.code === 'resource-media-type'
          ? `${at}的资源不是图片：${result.reason}。`
          : `${at}的图片资源读取失败：${result.reason}。`,
      })
      return
    }

    const { bytes, mediaType, source } = result.image
    const fileName = `${ref.href}.${extensionOf(mediaType)}`
    const sameHref = hrefsByLowerCase.get(ref.href.toLowerCase())
    const sameFile = fileNamesByLowerCase.get(fileName.toLowerCase())
    if (sameHref !== undefined || sameFile !== undefined) {
      const other = sameHref !== undefined ? `引用名「${sameHref}」` : `文件名「${sameFile}」`
      problems.push({
        code: 'resource-name-conflict',
        severity: 'error',
        ...where,
        path: ref.path,
        message: `${at}的资源「${fileName}」与已有的${other}在忽略大小写后重名，无法写入资源包。`,
      })
      return
    }
    hrefsByLowerCase.set(ref.href.toLowerCase(), ref.href)
    fileNamesByLowerCase.set(fileName.toLowerCase(), fileName)
    entries.push({ href: ref.href, key: ref.key, fileName, mediaType, source })
    files[fileName] = bytes
  })

  return { manifest: { version: 1, entries }, files, problems }
}
