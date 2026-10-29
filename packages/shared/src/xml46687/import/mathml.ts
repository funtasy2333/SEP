import { MATHML_NS, XLINK_NS, type XmlElement } from '../tree'
import { writeXml } from '../writer'
import type { ImportContext } from './context'

const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const texEncodings = new Set(['application/x-tex', 'tex', 'latex', 'application/x-latex', 'text/x-tex'])
const urlAttrs = new Set(['href', 'src', 'altimg'])

/** 保留 URI 树与文本，明确拒绝输出阶段会改变的结构。 */
export function readMathMl(element: XmlElement, ctx: ImportContext): string | undefined {
  let invalid = false
  const error = (el: XmlElement, message: string) => { invalid = true; ctx.report({ code: 'xml-unsupported', severity: 'error', message, xml: ctx.location(el) }) }
  if (element.name.ns !== MATHML_NS || element.name.local !== 'math') { error(element, '公式缺少 MathML math 根'); return undefined }
  let inheritedPreserve = false
  let ancestor = ctx.index.parent.get(element)
  while (ancestor) {
    const space = ctx.attr(ancestor, XML_NS, 'space')
    if (space === 'preserve' || space === 'default') { inheritedPreserve = space === 'preserve'; break }
    ancestor = ctx.index.parent.get(ancestor)
  }
  let warnedWhitespace = false
  const visit = (el: XmlElement, inherited: boolean): void => {
    const space = ctx.attr(el, XML_NS, 'space')
    const preserve = space === 'preserve' ? true : space === 'default' ? false : inherited
    const tokens = ['mi','mn','mo','mtext','ms','annotation']
    const losesWhitespace = !tokens.includes(el.name.local) && el.children.some(c => c.type === 'element') && el.children.some(c => c.type === 'text' && /^[ \t\r\n]+$/.test(c.value))
    if (losesWhitespace && preserve) error(el, '输出器会删除显式保留的 MathML 空白')
    else if (losesWhitespace && !warnedWhitespace) { warnedWhitespace = true; ctx.report({code:'xml-normalized', severity:'warning', message:'输出时 MathML 格式空白将规范化', xml:ctx.location(el)}) }
    if (el.name.ns !== MATHML_NS || el.name.local.toLowerCase() === 'script') error(el, 'MathML 含未知命名空间或危险元素')
    for (const attr of el.attrs) {
      const name = attr.name.local.toLowerCase()
      if (attr.name.ns !== null && attr.name.ns !== XML_NS && attr.name.ns !== XLINK_NS) error(el, 'MathML 属性使用未知命名空间')
      if (name.startsWith('on')) error(el, 'MathML 不允许事件属性')
      if (urlAttrs.has(name)) {
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(attr.value.trim())
        if (/[\u0000-\u001f\u007f]/.test(attr.value) || (scheme && !['http', 'https', 'mailto', 'ftp'].includes(scheme[1]!.toLowerCase()))) error(el, 'MathML 含不安全 URI')
      }
    }
    if (['annotation', 'annotation-xml'].includes(el.name.local) && texEncodings.has((ctx.attr(el, null, 'encoding') ?? '').trim().toLowerCase())) error(el, '输出器会删除 TeX 注释，无法保真')
    if (el.name.local === 'semantics' && el.children.filter(c => c.type === 'element').length === 1 && !el.children.some(c => c.type === 'text' && c.value.trim())) error(el, '输出器会展开 semantics，无法保真')
    for (const child of el.children) if (child.type === 'element') visit(child, preserve)
  }
  visit(element, inheritedPreserve)
  if (invalid) return undefined
  const root: XmlElement = { ...element, attrs: element.attrs.filter(a => !(a.name.ns === null && ['id', 'display'].includes(a.name.local))) }
  try { return writeXml({ root }, { namespaces: { mml: MATHML_NS, xlink: XLINK_NS }, indent: null }).replace(/^<\?xml[^\n]*\n/, '').trimEnd() }
  catch { error(element, 'MathML 无法写出'); return undefined }
}
