import {
  canonicalTermTailOrder, sameTermTailOrder, generateNodeId, hasSemanticExtensions, importParserProblem, irToPm, IRToPmError, mapXml46687,
  parseXml46687, pmToIr, validateXml46687, detectLegacyXml46687, getXmlAttr, XLINK_NS,
} from '@ses/shared'
import type { ImportProblem, IRResource, IRTermEntry, PMJsonNode, PreparedResources, ResolvedResource, XmlElement, XmlLocation } from '@ses/shared'
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

/** 相邻且样式相同的非引用文本仅在比较时合并，原子和引用的边界保留。 */
function mergeTextRuns(value: unknown): unknown {
  if (Array.isArray(value)) {
    const result: unknown[] = []
    for (const entry of value.map(mergeTextRuns)) {
      const run = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : undefined
      const previousValue = result[result.length - 1]
      const previous = previousValue && typeof previousValue === 'object' && !Array.isArray(previousValue) ? previousValue as Record<string, unknown> : undefined
      const eligible = (v: Record<string, unknown> | undefined): boolean => !!v && typeof v.text === 'string' && v.text !== '' && Object.keys(v).every(k => ['text', 'marks', 'style'].includes(k)) && (!Array.isArray(v.marks) || v.marks.every(mark => mark && typeof mark === 'object' && ['bold', 'italic', 'underline', 'sub', 'sup', 'strike', 'code'].includes((mark as { type?: string }).type ?? '')))
      if (eligible(run) && eligible(previous) && JSON.stringify(canonical({ marks: run!.marks, style: run!.style })) === JSON.stringify(canonical({ marks: previous!.marks, style: previous!.style }))) {
        result[result.length - 1] = { ...previous, text: String(previous!.text) + String(run!.text) }
      } else result.push(entry)
    }
    return result
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mergeTextRuns(child)]))
  return value
}

/** IR 行内 marks 是集合；仅排序完整 mark 对象，保留重复和所有属性。 */
function sortInlineMarks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortInlineMarks)
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sortInlineMarks(child)]))
  if (typeof result.text === 'string' && Array.isArray(result.marks)) {
    result.marks = [...result.marks].sort((a, b) => {
      const left = JSON.stringify(canonical(a)), right = JSON.stringify(canonical(b))
      return left < right ? -1 : left > right ? 1 : 0
    })
  }
  return result
}

/** 返回首个不一致字段的路径，不回显文档内容。 */
function firstDifference(a: unknown, b: unknown, path = 'doc'): string | undefined {
  if (Object.is(a, b)) return undefined
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length`
    for (let index = 0; index < a.length; index++) {
      const mismatch = firstDifference(a[index], b[index], `${path}[${index}]`)
      if (mismatch) return mismatch
    }
    return undefined
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const key of keys) {
      const mismatch = firstDifference(left[key], right[key], `${path}.${key}`)
      if (mismatch) return mismatch
    }
    return undefined
  }
  return path
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
  const elementsByNodeId = new Map<string, XmlElement>()
  const graphics: XmlElement[] = []
  const idProblems: ImportProblem[] = []
  const generate = options.generateId ?? generateNodeId
  const visit = (element: XmlElement) => {
    const path = element.position?.path
    const id = generate()
    if (!path || typeof id !== 'string' || !id.trim()) idProblems.push({ code: 'xml-node-id-missing', severity: 'error', message: '节点 ID 分配失败', xml: { line: element.position?.line ?? 1, column: element.position?.column ?? 1, path: path ?? '/' } })
    else if (seen.has(id)) idProblems.push({ code: 'xml-node-id-duplicate', severity: 'error', message: '节点 ID 生成器产生重复值', xml: { line: element.position?.line ?? 1, column: element.position?.column ?? 1, path } })
    else { seen.add(id); ids.set(path, id); elementsByNodeId.set(id, element) }
    if (element.name.ns === null && ['graphic', 'inline-graphic'].includes(element.name.local)) graphics.push(element)
    for (const child of element.children) if (child.type === 'element') visit(child)
  }
  visit(parsed.tree.root)
  for (const id of seen) {
    if (!seen.has(`${id}.p0`)) continue
    const source = elementsByNodeId.get(id)!
    idProblems.push({ code: 'xml-node-id-duplicate', severity: 'error', message: '节点 ID 与派生段落 ID 冲突', xml: { line: source.position?.line ?? 1, column: source.position?.column ?? 1, path: source.position?.path ?? '/' } })
  }
  if (idProblems.length) return { pmDoc: null, problems: [...validation, ...idProblems] }
  const prepared = new Map<string, Readonly<ResolvedResource>>()
  const irResources: IRResource[] = []
  const resourceIds = new Map<string, IRResource>()
  const reservedParagraphIds = new Set([...seen].map(id => `${id}.p0`))
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
    const existing = resourceIds.get(resourceId)
    if (typeof resourceId !== 'string' || !resourceId.trim() || seen.has(resourceId) || reservedParagraphIds.has(resourceId) || (existing && (existing.data !== supplied.src || existing.mediaType !== supplied.mediaType))) {
      idProblems.push({ code: 'xml-node-id-duplicate', severity: 'error', message: '图片资源 ID 无效或重复', xml: location })
      continue
    }
    if (!existing) {
      const resource: IRResource = { id: resourceId, mediaType: supplied.mediaType, encoding: 'dataUrl', data: supplied.src }
      resourceIds.set(resourceId, resource)
      irResources.push(resource)
    }
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
      const source = nodeId ? elementsByNodeId.get(nodeId) : undefined
      mapped.problems.push({ code: 'xml-normalized', severity: 'warning', message: '图片未指定替代文字，生产文档保存为空替代文字', ...(nodeId ? { nodeId } : {}), ...(source?.position ? { xml: { line: source.position.line ?? 1, column: source.position.column ?? 1, path: source.position.path } } : {}) })
    }
    if (record.kind === 'termEntry' && Array.isArray(record.tailOrder)) {
      const entry = record as unknown as IRTermEntry
      if (sameTermTailOrder(entry.tailOrder!, canonicalTermTailOrder(entry, 'pm')) && sameTermTailOrder(entry.tailOrder!, canonicalTermTailOrder(entry, 'resolver'))) {
        delete record.tailOrder
        const nodeId = typeof record.id === 'string' ? record.id : undefined
        const source = nodeId ? elementsByNodeId.get(nodeId) : undefined
        mapped.problems.push({ code: 'xml-normalized', severity: 'warning', message: '术语尾项顺序与生产默认顺序一致，按缺省保存', ...(nodeId ? { nodeId } : {}), ...(source?.position ? { xml: { line: source.position.line ?? 1, column: source.position.column ?? 1, path: source.position.path } } : {}) })
      }
    }
    if (record.kind === 'termEntry' && record.level === undefined) {
      record.level = 1
      const nodeId = typeof record.id === 'string' ? record.id : undefined
      const source = nodeId ? elementsByNodeId.get(nodeId) : undefined
      mapped.problems.push({ code: 'xml-normalized', severity: 'warning', message: '缺省术语层级按生产 Schema 保存为一级', ...(nodeId ? { nodeId } : {}), ...(source?.position ? { xml: { line: source.position.line ?? 1, column: source.position.column ?? 1, path: source.position.path } } : {}) })
    }
    if (record.formula && typeof record.formula === 'object') {
      const formula = record.formula as Record<string, unknown>
      if (formula.latex === '' && typeof formula.mathml === 'string' && formula.mathml !== '') {
        delete formula.latex
        const nodeId = typeof formula.id === 'string' ? formula.id : undefined
        const source = nodeId ? elementsByNodeId.get(nodeId) : undefined
        mapped.problems.push({ code: 'xml-normalized', severity: 'warning', message: '原生 MathML 的空 LaTeX 备用文本按缺省保存', ...(nodeId ? { nodeId } : {}), ...(source?.position ? { xml: { line: source.position.line ?? 1, column: source.position.column ?? 1, path: source.position.path } } : {}) })
      }
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
  const originalDifference = firstDifference(canonical(mapped.ir), canonical(roundtrip.doc))
  const textDifference = firstDifference(canonical(mergeTextRuns(mapped.ir)), canonical(mergeTextRuns(roundtrip.doc)))
  const difference = firstDifference(canonical(mergeTextRuns(sortInlineMarks(mapped.ir))), canonical(mergeTextRuns(sortInlineMarks(roundtrip.doc))))
  if (originalDifference && originalDifference !== textDifference) mapped.problems.push({ code: 'xml-normalized', severity: 'warning', message: '相邻同样式文本片段在生产 Schema 中重新分段', path: originalDifference })
  if (textDifference && !difference) mapped.problems.push({ code: 'xml-normalized', severity: 'warning', message: '生产 Schema 调整了行内标记顺序', path: textDifference })
  if (roundtrip.warnings.length || difference) return { pmDoc: null, problems: [...mapped.problems, { code: 'xml-roundtrip-loss', severity: 'error', message: '生产 Schema 往返未能保留全部语义', ...(difference ? { path: difference } : {}) }] }
  return { pmDoc, problems: mapped.problems }
}
