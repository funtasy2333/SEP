import type { IRDocMeta } from '../../ir/types'
import { xmlTextContent } from '../tree'
import type { XmlElement } from '../tree'
import type { ImportContext } from './context'
import { readInlineChildren } from './inline'

const XML = 'http://www.w3.org/XML/1998/namespace'
const elements = (el: XmlElement) => el.children.filter((x): x is XmlElement => x.type === 'element')

export function mapMetadata(element: XmlElement, ctx: ImportContext): IRDocMeta | undefined {
  if (element.name.ns !== null || element.name.local !== 'std-meta') return undefined
  const meta: IRDocMeta = { standardType: 'gb' }
  const warn = (el: XmlElement, message: string, severity: 'warning' | 'error' = 'warning') => ctx.report({ code: severity === 'error' ? 'xml-content-model' : 'xml-normalized', severity, message, xml: ctx.location(el) })
  const id = (el: XmlElement) => ctx.elementId(el) ?? ''
  const text = (el: XmlElement) => xmlTextContent(el).trim()
  const child = (el: XmlElement, name: string) => ctx.child(el, null, name)
  const inline = (el?: XmlElement) => el ? readInlineChildren(el, ctx) : []
  for (const el of elements(element)) {
    if (el.name.ns !== null) { warn(el, '未知元数据元素', 'error'); continue }
    switch (el.name.local) {
      case 'title-wrap': {
        const lang = ctx.attr(el, XML, 'lang')
        for (const part of elements(el)) {
          if (!['intro', 'main', 'compl', 'full'].includes(part.name.local) || part.name.ns !== null) { warn(part, '未知题名分段', 'error'); continue }
          ;(meta.titleParts ??= []).push({ id: id(part), lang, role: part.name.local, content: inline(part) })
          if (part.name.local === 'full') {
            const primary = lang?.toLowerCase().split('-')[0]
            if (primary === 'zh' && meta.title === undefined) meta.title = xmlTextContent(part)
            if (primary === 'en' && meta.titleEn === undefined) meta.titleEn = xmlTextContent(part)
          }
        }
        break
      }
      case 'std-ident':
        ;(meta.identifiers ??= []).push({ id: id(el), parts: elements(el).map((part, position) => ({ id: id(part), kind: part.name.local, position, content: inline(part) })) })
        break
      case 'std-ref': {
        const scheme = ctx.attr(el, null, 'type')
        const value = text(el)
        ;(meta.identifiers ??= []).push({ id: id(el), scheme, value, parts: [] })
        if ((scheme === 'dated' || !scheme) && meta.stdCode === undefined) meta.stdCode = value
        break
      }
      case 'std-org-group':
        for (const org of elements(el)) {
          if (org.name.local !== 'std-org' || org.name.ns !== null) { warn(org, '未知机构元素', 'error'); continue }
          const name = child(org, 'std-org-name')
          const abbreviation = child(org, 'std-org-abbrev')
          ;(meta.publishers ??= []).push({ id: id(org), name: inline(name), role: ctx.attr(org, null, 'std-org-role'), identifier: abbreviation && text(abbreviation) })
          if (meta.issuer === undefined && name) meta.issuer = xmlTextContent(name)
          if (ctx.attr(org, null, 'std-org-level') || ctx.attr(org, null, 'std-org-type')) warn(org, '机构级别或类型无法表达')
        }
        break
      case 'content-language': (meta.languages ??= []).push({ id: id(el), tag: text(el) }); break
      case 'release-date':
      case 'implementation-date': {
        const field = el.name.local === 'implementation-date' || ctx.attr(el, null, 'date-type') === 'implemented' ? 'implementDate' : 'publishDate'
        if (meta[field] !== undefined) warn(el, '日期语义重复', 'error')
        else meta[field] = text(el)
        break
      }
      case 'ics': if (meta.icsCode !== undefined) warn(el, '多个 ICS 无法保真', 'error'); else meta.icsCode = text(el); break
      case 'ccs': if (meta.ccsCode !== undefined) warn(el, '多个 CCS 无法保真', 'error'); else meta.ccsCode = text(el); break
      case 'comm-ref': meta.technicalCommittee = text(el); break
      case 'std-supersedes':
      case 'std-xref': {
        const reference = el.name.local === 'std-xref' ? (child(el, 'std-ref') ? text(child(el, 'std-ref')!) : text(el)) : text(el)
        const relation = el.name.local === 'std-xref' ? ctx.attr(el, null, 'type') : 'replaces'
        ;(meta.replacedStandards ??= []).push({ id: id(el), reference, relation })
        if (relation === 'replaces' && meta.replaces === undefined) meta.replaces = reference
        break
      }
      case 'permissions': {
        const statement = child(el, 'copyright-statement'), holder = child(el, 'copyright-holder'), year = child(el, 'copyright-year')
        ;(meta.copyrights ??= []).push({ id: id(el), statement: inline(statement), holder: holder && inline(holder), year: year && text(year), language: ctx.attr(el, XML, 'lang') })
        break
      }
      case 'custom-meta-group': {
        const fields: Record<string, 'filingNo' | 'industryName' | 'regionName' | 'coverDesignation' | 'applicant' | 'proposer'> = { 'filing-no': 'filingNo', 'industry-name': 'industryName', 'region-name': 'regionName', 'cover-designation': 'coverDesignation', applicant: 'applicant', proposer: 'proposer' }
        for (const item of elements(el)) {
          const name = child(item, 'meta-name'), value = child(item, 'meta-value')
          const key = name && fields[text(name)]
          if (key && value) meta[key] = text(value)
          else warn(item, '未知自定义元数据未表达')
        }
        break
      }
      case 'equivalence': case 'std-type': warn(el, '元数据没有已确认的语义映射'); break
      default: warn(el, '未知元数据元素', 'error')
    }
  }
  const code = meta.stdCode ?? ''
  if (/^GB(?:\/T|\/Z)?\s/i.test(code)) meta.standardType = 'gb'
  else warn(element, '标准类型缺少可确定的依据，暂用 gb')
  return meta
}
