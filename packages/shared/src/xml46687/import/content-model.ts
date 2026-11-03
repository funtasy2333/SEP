import { getXmlAttr, isXmlElement } from '../tree'
import type { XmlDocument, XmlElement } from '../tree'
import { location } from './context'
import type { ImportProblem } from './contracts'

/** 骨架规则；完整元素和属性模型由 RNG 匹配器校验。 */
export function validateSkeleton(tree: XmlDocument): ImportProblem[] {
  const problems: ImportProblem[] = []
  const issue = (el: XmlElement, rule: string) => problems.push({code: 'xml-content-model', severity: 'error', message: '文档结构、次序或属性不符合内容模型', xml: location(el), detail: {rule} } as ImportProblem)
  const root = tree.root
  if (root.name.ns !== null || root.name.local !== 'standard' || root.attrs.length) issue(root, 'ROOT')
  const elements = root.children.filter(isXmlElement)
  const names = elements.map(e => e.name.ns === null ? e.name.local : '')
  if (!/^(processing-meta,)?front,body(,back)?$/.test(names.join(','))) issue(root, 'ROOT')
  for (const el of elements) {
    if (el.name.ns !== null) continue
    const children = el.children.filter(isXmlElement)
    const values = children.map(c => c.name.ns === null ? c.name.local : '')
    if (['front', 'body', 'back'].includes(el.name.local) && (el.attrs.length || el.children.some(c => c.type === 'text' && c.value.trim()))) issue(el, el.name.local.toUpperCase())
    if (el.name.local === 'front') {
      const types = children.slice(1).map(c => c.name.local === 'sec' && c.name.ns === null ? getXmlAttr(c, null, 'sec-type') : '')
      if (values[0] !== 'std-meta' || types.length > 2 || types.some((type, i) => !['foreword', 'intro'].includes(type ?? '') || (i > 0 && types[i - 1] !== 'foreword'))) issue(el, 'FRONT')
    }
    if (el.name.local === 'body' && (!values.length || values.some(n => n !== 'sec'))) issue(el, 'BODY')
    if (el.name.local === 'back' && !/^(app-group,)?(ref-list,)?index$|^(app-group,)?ref-list$|^app-group$|^$/.test(values.join(','))) issue(el, 'BACK')
  }
  return problems
}
