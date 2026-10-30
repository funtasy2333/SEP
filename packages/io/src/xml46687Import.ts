import {
  generateNodeId, hasSemanticExtensions, importParserProblem, irToPm, IRToPmError, mapXml46687,
  parseXml46687, pmToIr, validateXml46687, detectLegacyXml46687, getXmlAttr, XLINK_NS,
} from '@ses/shared'
import type { ImportProblem, IRResource, PMJsonNode, PreparedResources, ResolvedResource, XmlElement, XmlLocation } from '@ses/shared'
import type { ContentValidator } from './documentOps/types'

export interface Xml46687ImportOptions {
  validateContent: ContentValidator
  generateId?: () => string
  resources?: PreparedResources
  resolveResource?: (request: Readonly<Xml46687ResourceRequest>) => Promise<ResolvedResource | null>
}
export interface Xml46687ResourceRequest { href: string; basename: string; kind: 'graphic' | 'inline-graphic'; location: XmlLocation; bytes?: Uint8Array; mediaType?: string }
export interface Xml46687ImportResult { pmDoc: PMJsonNode | null; problems: ImportProblem[] }

/** 比较完整 JSON 值，忽略对象键序与 JSON 中不存在的 undefined。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => [key, canonical(record[key])]))
  }
  return value
}

/** 解析、校验、映射及生产 Schema 往返。输入与提供的资源表保持不变。 */
export async function importXml46687(xml: string, options: Xml46687ImportOptions): Promise<Xml46687ImportResult> {
  if (typeof options.validateContent !== 'function') return { pmDoc: null, problems: [{ code: 'xml-schema-invalid', severity: 'error', message: '必须提供生产 Schema 校验器' }] }
  const parsed = parseXml46687(xml)
  if (!parsed.tree) return { pmDoc: null, problems: parsed.problems.map(importParserProblem) }
  const legacy = detectLegacyXml46687(parsed.tree)
  if (legacy.some(p => p.severity === 'error')) return { pmDoc: null, problems: legacy }
  const validation = validateXml46687(parsed.tree).problems
  if (validation.some(p => p.severity === 'error')) return { pmDoc: null, problems: validation }
  const ids = new Map<string, string>()
  const seen = new Set<string>()
  const graphics: XmlElement[] = []
  const idProblems: ImportProblem[] = []
  const generate = options.generateId ?? generateNodeId
  const visit = (element: XmlElement) => {
    const path = element.position?.path
    const id = generate()
    if (!path || typeof id !== 'string' || !id.trim()) idProblems.push({ code: 'xml-node-id-missing', severity: 'error', message: '节点 ID 分配失败', xml: { line: element.position?.line ?? 1, column: element.position?.column ?? 1, path: path ?? '/' } })
    else if (seen.has(id)) idProblems.push({ code: 'xml-node-id-duplicate', severity: 'error', message: '节点 ID 生成器产生重复值', xml: { line: element.position?.line ?? 1, column: element.position?.column ?? 1, path } })
    else { seen.add(id); ids.set(path, id) }
    if (element.name.ns === null && ['graphic', 'inline-graphic'].includes(element.name.local)) graphics.push(element)
    for (const child of element.children) if (child.type === 'element') visit(child)
  }
  visit(parsed.tree.root)
  if (idProblems.length) return { pmDoc: null, problems: [...validation, ...idProblems] }
  const prepared = new Map<string, Readonly<ResolvedResource>>()
  const irResources: IRResource[] = []
  const resourceIds = new Set<string>()
  for (const graphic of graphics) {
    const href = getXmlAttr(graphic, XLINK_NS, 'href')
    if (!href || prepared.has(href)) continue
    const location = { line: graphic.position?.line ?? 1, column: graphic.position?.column ?? 1, path: graphic.position?.path ?? '/' }
    const supplied = options.resources?.get(href) ?? await options.resolveResource?.({ href, basename: href.split('/').pop() ?? href, kind: graphic.name.local as 'graphic' | 'inline-graphic', location })
    if (!supplied || !supplied.src || !supplied.mediaType) continue
    const data = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(supplied.src)
    if (supplied.src.startsWith('data:') && (!data || data[1]?.toLowerCase() !== supplied.mediaType.toLowerCase() || data[2]!.length % 4 !== 0)) {
      idProblems.push({ code: 'xml-resource-missing', severity: 'error', message: '图片数据或媒体类型无效', xml: location })
      continue
    }
    if (!data && !/^https?:\/\//i.test(supplied.src)) {
      idProblems.push({ code: 'xml-resource-missing', severity: 'error', message: '图片地址不是可持久的 HTTP 或 HTTPS 地址', xml: location })
      continue
    }
    if (!data && supplied.resourceId) {
      idProblems.push({ code: 'xml-resource-missing', severity: 'error', message: '外部地址没有可保存的资源字节', xml: location })
      continue
    }
    if (!data) { prepared.set(href, { src: supplied.src, mediaType: supplied.mediaType }); continue }
    const resourceId = supplied.resourceId ?? generate()
    if (typeof resourceId !== 'string' || !resourceId.trim() || seen.has(resourceId) || resourceIds.has(resourceId) || [...seen].some(id => `${id}.p0` === resourceId)) {
      idProblems.push({ code: 'xml-node-id-duplicate', severity: 'error', message: '图片资源 ID 无效或重复', xml: location })
      continue
    }
    resourceIds.add(resourceId)
    irResources.push({ id: resourceId, mediaType: supplied.mediaType, encoding: 'dataUrl', data: supplied.src })
    prepared.set(href, { src: supplied.src, mediaType: supplied.mediaType, resourceId })
  }
  if (idProblems.length) return { pmDoc: null, problems: [...validation, ...idProblems] }
  const mapped = mapXml46687(parsed.tree, { nodeIdsByPath: ids, resources: prepared })
  if (!mapped.ir) return { pmDoc: null, problems: mapped.problems }
  if (irResources.length) mapped.ir.resources = irResources
  // 生产 figure 节点将未指定的 alt 持久化为空串。只对缺省值做此规范化。
  const normalizeFigureAlt = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(normalizeFigureAlt); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.kind === 'figure' && record.alt === undefined) {
      record.alt = ''
      const nodeId = typeof record.id === 'string' ? record.id : undefined
      mapped.problems.push({ code: 'xml-normalized', severity: 'warning', message: '图片未指定替代文字，生产文档保存为空替代文字', ...(nodeId ? { nodeId } : {}) })
    }
    for (const child of Object.values(record)) normalizeFigureAlt(child)
  }
  normalizeFigureAlt(mapped.ir)
  if (hasSemanticExtensions(mapped.ir)) mapped.ir.extensionVersion = 1
  let candidate: PMJsonNode
  try { candidate = irToPm(mapped.ir) }
  catch (error) {
    if (!(error instanceof IRToPmError)) throw error
    return { pmDoc: null, problems: [...mapped.problems, ...error.diagnostics.map(d => ({ code: 'xml-schema-invalid' as const, severity: 'error' as const, message: d.reason, path: d.path, nodeId: d.nodeId }))] }
  }
  const validated = options.validateContent(candidate)
  if (!validated.ok) return { pmDoc: null, problems: [...mapped.problems, { code: 'xml-schema-invalid', severity: 'error', message: validated.message, path: validated.path, nodeId: validated.nodeId, detail: { hostCode: validated.code } }] }
  const pmDoc = validated.content ?? candidate
  const roundtrip = pmToIr(pmDoc)
  if (roundtrip.warnings.length || JSON.stringify(canonical(mapped.ir)) !== JSON.stringify(canonical(roundtrip.doc))) return { pmDoc: null, problems: [...mapped.problems, { code: 'xml-roundtrip-loss', severity: 'error', message: '生产 Schema 往返未能保留全部语义' }] }
  return { pmDoc, problems: mapped.problems }
}
