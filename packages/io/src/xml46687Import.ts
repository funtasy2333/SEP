import {
  generateNodeId, importParserProblem, irToPm, IRToPmError, mapXml46687,
  parseXml46687, pmToIr, validateXml46687, detectLegacyXml46687,
} from '@ses/shared'
import type { ImportProblem, PMJsonNode, PreparedResources, XmlElement } from '@ses/shared'
import type { ContentValidator } from './documentOps/types'

export interface Xml46687ImportOptions {
  validateContent: ContentValidator
  generateId?: () => string
  resources?: PreparedResources
}
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
  const idProblems: ImportProblem[] = []
  const generate = options.generateId ?? generateNodeId
  const visit = (element: XmlElement) => {
    const path = element.position?.path
    const id = generate()
    if (!path || typeof id !== 'string' || !id.trim()) idProblems.push({ code: 'xml-node-id-missing', severity: 'error', message: '节点 ID 分配失败', xml: { line: element.position?.line ?? 1, column: element.position?.column ?? 1, path: path ?? '/' } })
    else if (seen.has(id)) idProblems.push({ code: 'xml-node-id-duplicate', severity: 'error', message: '节点 ID 生成器产生重复值', xml: { line: element.position?.line ?? 1, column: element.position?.column ?? 1, path } })
    else { seen.add(id); ids.set(path, id) }
    for (const child of element.children) if (child.type === 'element') visit(child)
  }
  visit(parsed.tree.root)
  if (idProblems.length) return { pmDoc: null, problems: [...validation, ...idProblems] }
  const mapped = mapXml46687(parsed.tree, { nodeIdsByPath: ids, resources: options.resources ?? new Map() })
  if (!mapped.ir) return { pmDoc: null, problems: mapped.problems }
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
