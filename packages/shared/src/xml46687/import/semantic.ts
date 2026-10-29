import { getXmlAttr, isXmlElement, MATHML_NS } from '../tree'
import type { XmlDocument, XmlElement } from '../tree'
import { location } from './context'
import type { ImportProblem } from './contracts'
const TBX = 'urn:iso:std:iso:30042:ed-1'
const XML = 'http://www.w3.org/XML/1998/namespace'
const kids = (el: XmlElement) => el.children.filter(isXmlElement)
const attr = (el: XmlElement, n: string) => getXmlAttr(el, null, n)
const plain = (el: XmlElement | undefined, n: string) => el?.name.ns === null && el.name.local === n
const rawText = (el: XmlElement): string => el.children.map(c => c.type === 'text' ? c.value : c.type === 'element' ? rawText(c) : '').join('')
const text = (el: XmlElement): string => rawText(el).trim()
const processing: Record<string, string> = { 'base-tagset': 'interchange', 'mathml-version': '3.0', 'table-model': 'xhtml', 'terminology-model': 'tbx', 'math-representation': 'mathml', 'tagset-family': 'sts' }
function unsafeUrl(value: string): boolean {
  if (/[\x00-\x1f\x7f]/.test(value)) return true
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value.trim())
  return !!scheme && !['http', 'https', 'mailto', 'ftp'].includes(scheme[1].toLowerCase())
}
function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const y = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  return y > 0 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}
export function validateSemantics(tree: XmlDocument): ImportProblem[] {
  const problems: ImportProblem[] = [], dates = new Map<string, XmlElement[]>()
  const report = (el: XmlElement, code: ImportProblem['code'], rule: string, message: string, severity: ImportProblem['severity'] = 'error') => problems.push({ code, severity, message, xml: location(el), detail: { rule } })
  const visit = (el: XmlElement, parent: XmlElement | undefined, ancestors: XmlElement[]) => {
    const n = el.name.local, isPlain = el.name.ns === null
    const has = (name: string) => kids(el).some(c => plain(c, name))
    const within = (name: string) => ancestors.some(a => plain(a, name))
    if (plain(el, 'sec')) {
      const type = attr(el, 'sec-type')
      const reserved = ['foreword', 'intro', 'scope', 'norm-refs', 'norm_refs', 'terms']
      if ((plain(parent, 'front') && !['foreword', 'intro'].includes(type ?? '')) || (plain(parent, 'body') && ['foreword', 'intro', 'numbered-paragraph'].includes(type ?? '')) || (!plain(parent, 'front') && !plain(parent, 'body') && reserved.includes(type ?? '')) || (type === 'numbered-paragraph' && has('title')) || (plain(parent, 'body') && !has('title'))) report(el, 'xml-content-model', 'V-2', '章条类型或标题不符合所在上下文')
    }
    if (plain(el, 'term-sec') && !ancestors.some((a, i) => plain(a, 'sec') && attr(a, 'sec-type') === 'terms' && plain(ancestors[i - 1], 'body'))) report(el, 'xml-content-model', 'V-2', '术语条必须在术语和定义章内')
    if (plain(el, 'app')) {
      const type = attr(el, 'content-type') ?? ''
      if (!['informative', 'normative', 'inform-annex', 'inform_annex'].includes(type)) report(el, 'xml-content-model', 'V-3', '附录性质无效')
      if (['inform-annex', 'inform_annex'].includes(type)) report(el, 'xml-normalized', 'V-3', '附录性质异写将规范化', 'warning')
      const annex = kids(el).find(c => plain(c, 'annex-type'))
      if (annex && ((type === 'informative' && text(annex).includes('规范性') && !text(annex).includes('资料性')) || (type === 'normative' && text(annex).includes('资料性')))) report(annex, 'xml-normalized', 'V-3', '附录性质文字与属性矛盾，以属性为准', 'warning')
    }
    if (plain(el, 'ref-list')) {
      const type = attr(el, 'content-type') ?? ''
      if (!['norm-refs', 'norm_refs', 'bibl', 'bibr'].includes(type) || (['bibl', 'bibr'].includes(type) && !plain(parent, 'back')) || (['norm-refs', 'norm_refs'].includes(type) && (!plain(parent, 'sec') || !['norm-refs', 'norm_refs'].includes(attr(parent!, 'sec-type') ?? '')))) report(el, 'xml-content-model', 'V-3', '参考文献表类型或位置无效')
    }
    if (plain(el, 'release-date') || plain(el, 'implementation-date')) {
      const type = plain(el, 'implementation-date') ? 'implemented' : attr(el, 'date-type') ?? 'published'
      if (!['published', 'implemented'].includes(type) || !validDate(text(el))) report(el, 'xml-date-invalid', 'V-4', '日期格式、日历日期或日期类型无效')
      const list = dates.get(type) ?? []; list.push(el); dates.set(type, list)
    }
    if (plain(el, 'list')) {
      const type = attr(el, 'list-type') ?? ''
      if (!['alpha-lower', 'arabic', 'roman-lower', 'dash', 'bullet'].includes(type)) report(el, 'xml-content-model', 'V-5', '列项类型无效')
      if (['dash', 'bullet'].includes(type)) for (const item of kids(el).filter(c => plain(c, 'list-item'))) if (kids(item).some(c => plain(c, 'label'))) report(item, 'xml-content-model', 'V-5', '无序列项不得带编号')
    }
    if (plain(el, 'processing-meta')) for (const [key, expected] of Object.entries(processing)) if (attr(el, key) !== expected) report(el, 'xml-content-model', 'V-6', '处理元数据属性无效')
    if (plain(el, 'title-wrap') && !getXmlAttr(el, XML, 'lang')) report(el, 'xml-content-model', 'V-6', '标题缺少语言')
    for (const a of el.attrs) {
      const key = a.name.local.toLowerCase()
      if (el.name.ns === MATHML_NS && key.startsWith('on')) report(el, 'xml-unsupported', 'V-10', 'MathML 不允许事件属性')
      if (['href', 'src', 'altimg'].includes(key) && unsafeUrl(a.value)) report(el, 'xml-unsupported', el.name.ns === MATHML_NS ? 'V-10' : 'V-11', '链接包含控制字符或不允许的协议')
    }
    if (plain(el, 'uri') && unsafeUrl(rawText(el))) report(el, 'xml-unsupported', 'V-11', '链接包含控制字符或不允许的协议')
    if (isPlain && ['table', 'table-wrap'].includes(n) && (within('td') || within('th'))) report(el, 'xml-unsupported', 'M-6.1-06', '不支持嵌套表格')
    if (plain(el, 'std') && ancestors.some(a => a.name.ns === TBX && a.name.local === 'source')) report(el, 'xml-unsupported', 'M-9.2.8-02', '术语来源不能包含 std')
    if (plain(el, 'fn') && (within('fig') || within('fig-group'))) report(el, 'xml-unsupported', 'M-8.6-02', '不支持图脚注')
    if (plain(el, 'fn') && (plain(parent, 'sec') || plain(parent, 'app'))) report(el, 'xml-unsupported', 'M-10.1.8-01', '脚注不得直接置于章条')
    if (el.name.ns === TBX && n === 'termEntry' && ancestors.some(a => a.name.ns === TBX && a.name.local === 'termEntry')) report(el, 'xml-unsupported', 'M-9.1-03', '术语条目不得嵌套')
    if (el.name.ns === TBX && n === 'definition' && attr(el, 'target') !== undefined) report(el, 'xml-unsupported', 'M-C.1-08', '定义不得带 target')
    if (plain(el, 'caption') && kids(el).filter(c => plain(c, 'title')).length > 1) report(el, 'xml-content-model', 'M-6.2.1-06', '图表题不能含多个标题')
    for (const c of kids(el)) visit(c, el, [...ancestors, el])
  }
  visit(tree.root, undefined, [])
  for (const entries of dates.values()) if (entries.length > 1) report(entries[1], 'xml-date-invalid', 'V-4', '同一日期重复表达')
  const pub = dates.get('published')?.[0], impl = dates.get('implemented')?.[0]
  if (pub && impl && validDate(text(pub)) && validDate(text(impl)) && text(pub) > text(impl)) report(pub, 'xml-normalized', 'V-4', '发布日期晚于实施日期', 'warning')
  return problems
}
