import type { IRBibEntry, IRBlock, IRInline, IRTermEntry, NodeId } from '../../ir/types'
import { findXmlChild, findXmlChildren, getXmlAttr, XLINK_NS } from '../tree'
import type { XmlDocument, XmlElement } from '../tree'
import type { ImportProblem, MappingOptions, ResolvedResource, XmlLocation } from './contracts'

const TBX = 'urn:iso:std:iso:30042:ed-1'
const XML = 'http://www.w3.org/XML/1998/namespace'
const start = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const ncName = new RegExp(`^[${start}][${start}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, 'u')

export type ImportTargetKind = 'chapter' | 'clause' | 'appendix' | 'figure' | 'table' | 'formula' | 'note' | 'example' | 'bibliography' | 'term' | 'index' | 'listItem' | 'abbreviation' | 'footnote' | 'tableFootnote'
export interface ImportTarget { element: XmlElement; nodeId: NodeId; kind: ImportTargetKind }
export interface ImportIndex {
  byXmlId: ReadonlyMap<string, ImportTarget>
  elementsByXmlId: ReadonlyMap<string, XmlElement>
  parent: ReadonlyMap<XmlElement, XmlElement | undefined>
  nodeIds: ReadonlyMap<XmlElement, NodeId>
  footnoteDefinitions: ReadonlyMap<string, XmlElement>
  footnoteReferenceCounts: ReadonlyMap<string, number>
  resourceHrefs: ReadonlySet<string>
}
export interface ImportIndexResult { index: ImportIndex; problems: ImportProblem[] }

export function location(element: XmlElement): XmlLocation {
  return { line: element.position?.line ?? 1, column: element.position?.column ?? 1, path: element.position?.path ?? '/' }
}
function is(el: XmlElement, local: string, ns: string | null = null): boolean {
  return el.name.ns === ns && el.name.local === local
}
function xmlId(el: XmlElement): string | undefined {
  return getXmlAttr(el, null, 'id') ?? getXmlAttr(el, XML, 'id')
}
function nearest(el: XmlElement, parent: ReadonlyMap<XmlElement, XmlElement | undefined>, name: string): XmlElement | undefined {
  let current = parent.get(el)
  while (current) {
    if (is(current, name)) return current
    current = parent.get(current)
  }
  return undefined
}
function kindOf(el: XmlElement, parents: ReadonlyMap<XmlElement, XmlElement | undefined>): ImportTargetKind | undefined {
  const n = el.name.local
  if (el.name.ns === TBX) return n === 'termEntry' ? 'term' : n === 'note' ? 'note' : n === 'example' ? 'example' : undefined
  if (el.name.ns !== null) return undefined
  if (n === 'sec') {
    if (nearest(el, parents, 'front') && !nearest(el, parents, 'intro')) return undefined
    return nearest(el, parents, 'sec') || nearest(el, parents, 'app') || nearest(el, parents, 'front') ? 'clause' : 'chapter'
  }
  if (n === 'term-sec') return 'term'
  if (n === 'app') return 'appendix'
  if (n === 'fig' || n === 'fig-group') return 'figure'
  if (n === 'table-wrap') return 'table'
  if (n === 'disp-formula' || n === 'disp-formula-group') return 'formula'
  if (n === 'non-normative-note') return 'note'
  if (n === 'non-normative-example') return 'example'
  if (n === 'ref' || n === 'ref-list') return 'bibliography'
  if (n === 'index') return 'index'
  if (n === 'list-item' || n === 'list') return 'listItem'
  if (n === 'def-item' && getXmlAttr(parents.get(el)!, null, 'list-content') === 'abbreviation') return 'abbreviation'
  if (n === 'fn') return nearest(el, parents, 'table-wrap-foot') ? 'tableFootnote' : 'footnote'
  return undefined
}
function accepted(ref: XmlElement, target: ImportTarget, parents: ReadonlyMap<XmlElement, XmlElement | undefined>): boolean {
  const type = getXmlAttr(ref, null, 'ref-type')
  const custom = getXmlAttr(ref, null, 'custom-type')
  if (type === 'other' || type === 'chem') return true
  if (type === 'custom') return (custom === 'term-entry' && target.kind === 'term') || custom === target.kind
  if (type === 'sec') return ['chapter', 'clause', 'term', 'bibliography', 'index'].includes(target.kind)
  const expected: Record<string, ImportTargetKind[]> = { app: ['appendix'], fig: ['figure'], table: ['table'], 'disp-formula': ['formula'], bibr: ['bibliography'], fn: ['footnote'], 'table-fn': ['tableFootnote'], list: ['listItem'], abbreviation: ['abbreviation'] }
  if (!type || !expected[type]?.includes(target.kind)) return false
  return type !== 'table-fn' || nearest(ref, parents, 'table-wrap') === nearest(target.element, parents, 'table-wrap')
}

/** 两遍扫描，不依赖 id 字面意义，不修改 tree 或预分配表。 */
export function buildImportIndex(tree: XmlDocument, options: MappingOptions): ImportIndexResult {
  const problems: ImportProblem[] = []
  const byXmlId = new Map<string, ImportTarget>()
  const elementsByXmlId = new Map<string, XmlElement>()
  const parent = new Map<XmlElement, XmlElement | undefined>()
  const nodeIds = new Map<XmlElement, NodeId>()
  const footnoteDefinitions = new Map<string, XmlElement>()
  const footnoteReferenceCounts = new Map<string, number>()
  const resourceHrefs = new Set<string>()
  const ids = new Set<string>()
  const elements: XmlElement[] = []
  const issue = (el: XmlElement, code: ImportProblem['code'], message: string) => problems.push({ code, severity: 'error', message, xml: location(el) })
  const visit = (el: XmlElement, p: XmlElement | undefined) => {
    parent.set(el, p)
    elements.push(el)
    const path = el.position?.path
    const id = path ? options.nodeIdsByPath.get(path) : undefined
    if (!id) issue(el, 'xml-node-id-missing', '元素缺少预分配节点 ID 或路径')
    else if (ids.has(id)) issue(el, 'xml-node-id-duplicate', '预分配节点 ID 重复')
    else { ids.add(id); nodeIds.set(el, id) }
    for (const child of el.children) if (child.type === 'element') visit(child, el)
  }
  visit(tree.root, undefined)
  for (const el of elements) {
    const id = xmlId(el)
    if (id !== undefined) {
      if (!ncName.test(id)) { issue(el, 'xml-id-invalid', 'XML ID 不符合 NCName'); continue }
      if (elementsByXmlId.has(id)) { issue(el, 'xml-id-duplicate', 'XML ID 重复'); continue }
      elementsByXmlId.set(id, el)
      let kind = kindOf(el, parent)
      let owner = el
      if (is(el, 'termEntry', TBX)) {
        const container = nearest(el, parent, 'term-sec')
        if (container) owner = container
      }
      const nodeId = nodeIds.get(owner)
      if (kind && nodeId) byXmlId.set(id, { element: el, nodeId, kind })
      if (is(el, 'fn')) footnoteDefinitions.set(id, el)
    }
    if (is(el, 'graphic') || is(el, 'inline-graphic')) {
      const href = getXmlAttr(el, XLINK_NS, 'href')
      if (href) resourceHrefs.add(href)
    }
  }
  for (const el of elements) {
    if (!is(el, 'xref')) continue
    const rid = getXmlAttr(el, null, 'rid')?.trim()
    if (!rid || /\s/.test(rid)) { issue(el, 'xml-reference-dangling', '引用必须指定一个目标 ID'); continue }
    if (getXmlAttr(el, null, 'ref-type') === 'fn' || getXmlAttr(el, null, 'ref-type') === 'table-fn') footnoteReferenceCounts.set(rid, (footnoteReferenceCounts.get(rid) ?? 0) + 1)
    const target = byXmlId.get(rid)
    if (!elementsByXmlId.has(rid)) issue(el, 'xml-reference-dangling', '引用目标不存在')
    else if (!target || !accepted(el, target, parent)) issue(el, 'xml-reference-kind', '引用目标类型不匹配或无可引用实体')
  }
  return { index: { byXmlId, elementsByXmlId, parent, nodeIds, footnoteDefinitions, footnoteReferenceCounts, resourceHrefs }, problems }
}

export interface ImportHandlers {
  inline?: (element: XmlElement, context: ImportContext) => IRInline[] | undefined
  block?: (element: XmlElement, context: ImportContext) => IRBlock[] | undefined
  term?: (element: XmlElement, context: ImportContext) => IRTermEntry | undefined
  references?: (element: XmlElement, context: ImportContext) => IRBibEntry[] | undefined
}
export interface ImportContext {
  index: ImportIndex
  problems: ImportProblem[]
  elementId(element: XmlElement): NodeId | undefined
  xmlTargetID(id: string): NodeId | undefined
  targetKind(id: string): ImportTargetKind | undefined
  requiredResource(element: XmlElement): Readonly<ResolvedResource> | undefined
  report(problem: ImportProblem): void
  location: typeof location
  child: typeof findXmlChild
  children: typeof findXmlChildren
  attr: typeof getXmlAttr
  dispatchInline(element: XmlElement): IRInline[] | undefined
  dispatchBlock(element: XmlElement): IRBlock[] | undefined
  dispatchTerm(element: XmlElement): IRTermEntry | undefined
  dispatchReferences(element: XmlElement): IRBibEntry[] | undefined
}
export function createImportContext(tree: XmlDocument, options: MappingOptions, handlers: ImportHandlers): ImportContext {
  const result = buildImportIndex(tree, options)
  const problems = [...result.problems]
  const missing = (element: XmlElement) => problems.push({ code: 'xml-unsupported', severity: 'error', message: '未注册此内容的映射处理器', xml: location(element) })
  const ctx: ImportContext = {
    index: result.index, problems,
    elementId: element => result.index.nodeIds.get(element),
    xmlTargetID: id => result.index.byXmlId.get(id)?.nodeId,
    targetKind: id => result.index.byXmlId.get(id)?.kind,
    requiredResource: element => {
      const href = getXmlAttr(element, XLINK_NS, 'href')
      const resource = href ? options.resources.get(href) : undefined
      if (!resource || !resource.src || !resource.mediaType) {
        problems.push({ code: 'xml-resource-missing', severity: 'error', message: '图片缺少已准备的资源', xml: location(element) })
        return undefined
      }
      return { ...resource }
    },
    report: problem => { problems.push(problem) },
    location, child: findXmlChild, children: findXmlChildren, attr: getXmlAttr,
    dispatchInline: element => { if (!handlers.inline) { missing(element); return undefined } return handlers.inline(element, ctx) },
    dispatchBlock: element => { if (!handlers.block) { missing(element); return undefined } return handlers.block(element, ctx) },
    dispatchTerm: element => { if (!handlers.term) { missing(element); return undefined } return handlers.term(element, ctx) },
    dispatchReferences: element => { if (!handlers.references) { missing(element); return undefined } return handlers.references(element, ctx) },
  }
  return ctx
}
