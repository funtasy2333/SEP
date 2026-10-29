import { getXmlAttr, isXmlElement, MATHML_NS } from '../tree'
import type { XmlDocument, XmlElement } from '../tree'
import { buildImportIndex, location } from './context'
import type { ImportProblem, ValidationResult } from './contracts'

const TBX = 'urn:iso:std:iso:30042:ed-1'
const orderA = 'std-type title-wrap proj-id release-version std-ident std-org|std-org-group content-language std-ref doc-ref release-date implementation-date equivalence comm-ref secretariat ics ccs page-count std-supersedes std-xref permissions custom-meta-group'.split(' ')
const orderB = 'std-type ics ccs title-wrap proj-id release-version std-ident std-org|std-org-group content-language std-ref doc-ref release-date implementation-date equivalence comm-ref secretariat page-count std-supersedes std-xref permissions custom-meta-group'.split(' ')
const kids = (el: XmlElement) => el.children.filter(isXmlElement)
const child = (el: XmlElement, name: string) => kids(el).find(c => c.name.ns === null && c.name.local === name)
const attr = (el: XmlElement, name: string) => getXmlAttr(el, null, name)
function value(el: XmlElement): string {
  return el.children.map(c => c.type === 'text' ? c.value : c.type === 'element' ? value(c) : '').join('')
}
function ordered(el: XmlElement, order: string[]): boolean {
  let previous = -1
  for (const c of kids(el)) {
    if (c.name.ns !== null) continue
    const rank = order.findIndex(group => group.split('|').includes(c.name.local))
    if (rank < 0) continue
    if (rank < previous) return false
    previous = rank
  }
  return true
}
export function validateXml46687(tree: XmlDocument): ValidationResult {
  const problems: ImportProblem[] = []
  const ids = new Map<string, string>()
  const issue = (el: XmlElement, code: ImportProblem['code'], rule: string, message: string, severity: ImportProblem['severity'] = 'error') => problems.push({ code, severity, message, xml: location(el), detail: { rule } })
  const visit = (el: XmlElement, parent: XmlElement | undefined, ancestors: XmlElement[]) => {
    if (el.position?.path) ids.set(el.position.path, `node-${ids.size}`)
    const plain = el.name.ns === null
    const name = el.name.local
    if (plain && name === 'app') {
      if (!child(el, 'annex-type')) issue(el, 'xml-annex-type-required', 'R1', '附录缺少 annex-type')
      if (!attr(el, 'id')?.trim()) issue(el, 'xml-app-id-required', 'R6', '附录缺少 ID')
    }
    if (plain && name === 'xref' && attr(el, 'ref-type') === 'custom' && !attr(el, 'custom-type')?.trim()) issue(el, 'xml-xref-custom-type-required', 'R2', '自定义引用缺少类型')
    if (plain && name === 'ext-link' && attr(el, 'ext-link-type') !== 'uri') issue(el, 'xml-ext-link-type-invalid', 'R3', '外链类型必须为 uri')
    if (el.name.ns === MATHML_NS && name === 'math' && parent?.name.ns === null && ['disp-formula', 'inline-formula'].includes(parent.name.local)) {
      const display = attr(el, 'display')
      if ((parent.name.local === 'disp-formula' && display !== undefined && display !== 'block') || (parent.name.local === 'inline-formula' && display !== undefined)) issue(el, 'xml-math-display-invalid', 'R4', '公式的 MathML display 与上下文不符')
      if (!attr(el, 'id')?.trim()) issue(el, 'xml-math-id-required', 'R5', '公式的 MathML 缺少 ID')
    }
    if (plain && name === 'ref' && parent?.name.ns === null && parent.name.local === 'ref-list' && ['bibl', 'bibr'].includes(attr(parent, 'content-type') ?? '') && !attr(el, 'id')?.trim()) issue(el, 'xml-bibl-ref-id-required', 'R7', '参考文献条目缺少 ID')
    if (el.name.ns === TBX && name === 'termEntry') {
      if (!attr(el, 'id')?.trim()) issue(el, 'xml-term-id-required', 'R8', '术语条目缺少 ID')
      const definitions = kids(el).filter(c => c.name.ns === TBX && c.name.local === 'langSet').flatMap(kids).filter(c => c.name.ns === TBX && c.name.local === 'definition')
      if (definitions.length !== 1) issue(el, 'xml-term-definition-count', 'R13', '术语条目必须恰有一个定义')
    }
    if (plain && name === 'p' && attr(el, 'id') !== undefined) issue(el, 'xml-paragraph-id-forbidden', 'R9', '段落不得带 ID')
    if (plain && name === 'sec' && ancestors.some(a => a.name.ns === null && ['body', 'app'].includes(a.name.local)) && !value(child(el, 'label') ?? { ...el, children: [] }).trim()) issue(el, 'xml-section-label-required', 'R10', '章条缺少非空 label')
    if (plain && name === 'std-meta') {
      const a = ordered(el, orderA), b = ordered(el, orderB)
      if (!a && !b) issue(el, 'xml-meta-order-invalid', 'R11', '标准元数据次序无效')
      else if (!a && b) issue(el, 'xml-normalized', 'R11', '标准元数据采用可规范化的异写顺序', 'warning')
    }
    if (plain && name === 'table-wrap' && !value(child(el, 'label') ?? { ...el, children: [] }).trim()) issue(el, 'xml-table-label-required', 'R12', '表缺少非空 label')
    for (const c of kids(el)) visit(c, el, [...ancestors, el])
  }
  visit(tree.root, undefined, [])
  problems.push(...buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() }).problems)
  return { problems }
}
