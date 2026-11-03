import type { IRDoc } from '../../ir/types'
import type { Xml46687ParseProblem } from '../parse'
import type { XmlDocument } from '../tree'

/** 稳定的公共错误码；具体规则使用 matrixId 或 detail.rule。 */
export type ImportProblemCode = Xml46687ParseProblem['code']
  | 'xml-annex-type-required' | 'xml-xref-custom-type-required' | 'xml-ext-link-type-invalid'
  | 'xml-math-display-invalid' | 'xml-math-id-required' | 'xml-app-id-required'
  | 'xml-bibl-ref-id-required' | 'xml-term-id-required' | 'xml-paragraph-id-forbidden'
  | 'xml-section-label-required' | 'xml-meta-order-invalid' | 'xml-table-label-required'
  | 'xml-term-definition-count'
  | 'legacy-format' | 'xml-content-model' | 'xml-unsupported' | 'xml-date-invalid'
  | 'xml-id-invalid' | 'xml-id-duplicate' | 'xml-id-missing'
  | 'xml-node-id-missing' | 'xml-node-id-duplicate'
  | 'xml-reference-dangling' | 'xml-reference-kind' | 'xml-resource-missing'
  | 'xml-schema-invalid' | 'xml-roundtrip-loss' | 'xml-normalized'

/** 稳定目录；领域诊断通过 rule 和 matrixId 细化，不扩充任意字符串码。 */
export const IMPORT_PROBLEM_CODES = [
  'xml-syntax', 'xml-namespace', 'xml-forbidden-doctype', 'xml-forbidden-entity',
  'xml-forbidden-pi', 'xml-encoding', 'xml-limit',
  'xml-annex-type-required', 'xml-xref-custom-type-required', 'xml-ext-link-type-invalid',
  'xml-math-display-invalid', 'xml-math-id-required', 'xml-app-id-required',
  'xml-bibl-ref-id-required', 'xml-term-id-required', 'xml-paragraph-id-forbidden',
  'xml-section-label-required', 'xml-meta-order-invalid', 'xml-table-label-required',
  'xml-term-definition-count', 'legacy-format', 'xml-content-model', 'xml-unsupported',
  'xml-date-invalid', 'xml-id-invalid', 'xml-id-duplicate', 'xml-id-missing',
  'xml-node-id-missing', 'xml-node-id-duplicate', 'xml-reference-dangling',
  'xml-reference-kind', 'xml-resource-missing', 'xml-schema-invalid',
  'xml-roundtrip-loss', 'xml-normalized',
] as const satisfies readonly ImportProblemCode[]

export interface XmlLocation { line: number; column: number; path: string }
export interface ImportProblem {
  code: ImportProblemCode
  severity: 'error' | 'warning' | 'info'
  message: string
  xml?: XmlLocation
  nodeId?: string
  path?: string
  matrixId?: string
  detail?: { hostCode?: string; rule?: string; [key: string]: unknown }
}
export interface ResolvedResource { src: string; resourceId?: string; mediaType: string }
export type PreparedResources = ReadonlyMap<string, Readonly<ResolvedResource>>
/** IO 必须为每个元素的唯一 position.path 预分配非空、全局唯一 NodeId。
 * 为旧式单段容器保留 `${containerId}.p0`：调用方分配的其他 ID 不得与其冲突。 */
export interface MappingOptions { nodeIdsByPath: ReadonlyMap<string, string>; resources: PreparedResources }
export interface ValidationResult { problems: ImportProblem[] }
export interface MappingResult { ir: IRDoc | null; problems: ImportProblem[] }
/** 仅声明未来 facade 的签名；不提供未经领域实现的成功桩。 */
export type ValidateXml46687 = (tree: XmlDocument) => ValidationResult
export type MapXml46687 = (tree: XmlDocument, options: MappingOptions) => MappingResult
export function importParserProblem(problem: Xml46687ParseProblem): ImportProblem {
  return { ...problem, xml: { ...problem.xml } }
}
