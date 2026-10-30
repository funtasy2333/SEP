import { getXmlAttr, parseXml46687, XLINK_NS } from '@ses/shared'
import type { ResolvedResource, XmlElement } from '@ses/shared'
import { importXml46687 } from './xml46687Import'
import type { Xml46687ImportOptions, Xml46687ImportResult, Xml46687ResourceRequest } from './xml46687Import'
import { openBoundedZip, ZipImportError } from './xml46687ZipImport'

type ManifestEntry = { href: string; key: string; fileName: string; mediaType: string; source: 'resource' | 'dataUrl' | 'src' }
type Resource = { request: Xml46687ResourceRequest; bytes: Uint8Array; mediaType: string }
const fail = (message: string, path = '/'): never => { throw new ZipImportError('xml-unsupported', message, path) }
const missing = (message: string, path = '/'): never => { throw new ZipImportError('xml-unsupported', message, path) }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const safeName = (s: string) => !!s && s !== '.' && s !== '..' && !/[/\\\u0000]/.test(s)
const base = (s: string) => s.slice(s.lastIndexOf('/') + 1)
const utf8 = (data: Uint8Array, name: string): string => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data) }
  catch { throw new ZipImportError('xml-encoding', '资源包文本不是有效 UTF-8', name) }
}
const dataUrl = (data: Uint8Array, mediaType: string): string => {
  const chunks: string[] = []
  // 每段长度为 3 的倍数，独立编码后可以直接拼接。
  for (let i = 0; i < data.length; i += 24576) {
    const piece = data.subarray(i, i + 24576)
    let binary = ''
    for (const byte of piece) binary += String.fromCharCode(byte)
    chunks.push(btoa(binary))
  }
  return `data:${mediaType};base64,${chunks.join('')}`
}

function parseManifest(raw: string): ManifestEntry[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return fail('资源清单不是有效 JSON', 'manifest.json') }
  if (!record(parsed) || parsed.format !== 'GB/T 46687.2—2026 XML' || parsed.version !== 1 || parsed.xml !== 'standard.xml' || !Array.isArray(parsed.entries)) fail('资源清单格式无效', 'manifest.json')
  const entries: ManifestEntry[] = []
  const hrefs = new Set<string>(), names = new Set<string>()
  for (const value of (parsed as { entries: unknown[] }).entries) {
    if (!record(value) || typeof value.href !== 'string' || !value.href || typeof value.key !== 'string' || !value.key || typeof value.fileName !== 'string' || !safeName(value.fileName) || typeof value.mediaType !== 'string' || !/^image\/[a-z0-9][a-z0-9.+-]*$/i.test(value.mediaType) || !['resource', 'dataUrl', 'src'].includes(value.source as string)) fail('资源清单条目无效', 'manifest.json')
    const entry = value as ManifestEntry
    const href = entry.href.toLowerCase(), name = entry.fileName.toLowerCase()
    if (hrefs.has(href) || names.has(name)) fail('资源清单存在重复名称', 'manifest.json')
    // A key may identify one image referenced by more than one href; keep those associations.
    hrefs.add(href); names.add(name)
    entries.push(entry)
  }
  return entries
}

async function prepare(bytes: Uint8Array): Promise<{ xml: string; resources: Resource[] }> {
  const files = await openBoundedZip(bytes)
  const manifest = files.get('manifest.json'), xmlFile = files.get('standard.xml')
  if (!manifest || !xmlFile) missing('资源包缺少 manifest.json 或 standard.xml')
  const entries = parseManifest(utf8(manifest!, 'manifest.json'))
  const xml = utf8(xmlFile!, 'standard.xml')
  const allowed = new Set(['manifest.json', 'standard.xml', ...entries.map(e => `resources/${e.fileName}`)])
  for (const name of files.keys()) if (!allowed.has(name)) fail('资源包包含清单之外的文件', name)
  for (const entry of entries) if (!files.has(`resources/${entry.fileName}`)) throw new ZipImportError('xml-resource-missing', '资源清单对应文件缺失', `resources/${entry.fileName}`)
  const parsed = parseXml46687(xml)
  if (!parsed.tree) return { xml, resources: [] } // 纯 XML 入口负责报告精确解析问题。
  const resources: Resource[] = [], seen = new Set<string>()
  const stack: XmlElement[] = [parsed.tree.root]
  while (stack.length) {
    const element = stack.pop()!
    for (let i = element.children.length - 1; i >= 0; i--) if (element.children[i]!.type === 'element') stack.push(element.children[i] as XmlElement)
    if (element.name.ns !== null || (element.name.local !== 'graphic' && element.name.local !== 'inline-graphic')) continue
    const href = getXmlAttr(element, XLINK_NS, 'href')
    if (!href || seen.has(href)) continue
    seen.add(href)
    const exact = entries.filter(e => e.href === href)
    const matches = exact.length ? exact : entries.filter(e => base(e.href) === base(href) || e.fileName === base(href))
    if (matches.length > 1) fail('图片资源名称存在歧义', element.position?.path)
    if (!matches.length) continue // 交给纯 XML 入口报告有位置的缺资源问题。
    const entry = matches[0]!, data = files.get(`resources/${entry.fileName}`)!
    const location = { line: element.position?.line ?? 1, column: element.position?.column ?? 1, path: element.position?.path ?? '/' }
    resources.push({ request: { href, basename: base(href), kind: element.name.local as 'graphic' | 'inline-graphic', location }, bytes: data, mediaType: entry.mediaType })
  }
  return { xml, resources }
}

/** 包内资源优先；resolver 接收独立字节副本，返回 null 时回退到包内 data URL，异常直接传播。 */
export async function importXml46687Package(bytes: Uint8Array, options: Xml46687ImportOptions): Promise<Xml46687ImportResult> {
  let prepared: Awaited<ReturnType<typeof prepare>>
  try { prepared = await prepare(bytes) }
  catch (error) {
    if (!(error instanceof ZipImportError)) throw error
    return { pmDoc: null, problems: [{ code: error.code, severity: 'error', message: error.message, path: error.path }] }
  }
  const resources = new Map<string, Readonly<ResolvedResource>>()
  for (const resource of prepared.resources) {
    const fallback = { src: dataUrl(resource.bytes, resource.mediaType), mediaType: resource.mediaType }
    const resolved = await options.resolveResource?.({ ...resource.request, bytes: resource.bytes.slice(), mediaType: resource.mediaType })
    resources.set(resource.request.href, resolved ?? fallback)
  }
  return importXml46687(prepared.xml, { ...options, resources, resolveResource: undefined })
}
