import type { IRDocMeta } from '../../ir/types'
import { xmlTextContent } from '../tree'
import type { XmlElement } from '../tree'
import type { ImportContext } from './context'
import { readInlineChildren } from './inline'

const XML = 'http://www.w3.org/XML/1998/namespace'
const isKnownOrgChild = (el: XmlElement) => el.name.ns === null && ['std-org-name', 'std-org-abbrev'].includes(el.name.local)
const elements = (el: XmlElement) => el.children.filter((x): x is XmlElement => x.type === 'element')
function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
}

export function mapMetadata(element: XmlElement, ctx: ImportContext): IRDocMeta | undefined {
  if (element.name.ns !== null || element.name.local !== 'std-meta') return undefined
  const meta: IRDocMeta = { standardType: 'gb' }
  const warn = (el: XmlElement, message: string, severity: 'warning' | 'error' = 'warning') => ctx.report({ code: severity === 'error' ? 'xml-content-model' : 'xml-normalized', severity, message, xml: ctx.location(el) })
  const id = (el: XmlElement) => ctx.elementId(el) ?? ''
  const text = (el: XmlElement) => xmlTextContent(el).trim()
  const child = (el: XmlElement, name: string) => ctx.child(el, null, name)
  const inline = (el?: XmlElement) => el ? readInlineChildren(el, ctx) : []
  let standardTypeText: string | undefined
  const mapOrg = (org: XmlElement) => {
    const names = ctx.children(org, null, 'std-org-name')
    const abbreviation = child(org, 'std-org-abbrev')
    const identifier = abbreviation && text(abbreviation)
    const role = ctx.attr(org, null, 'std-org-role')
    if (names.length === 0 && abbreviation) {
      ;(meta.publishers ??= []).push({ id: id(org), name: inline(abbreviation), role, identifier })
      warn(org, '机构仅有缩写，以缩写作为名称')
    }
    names.forEach((name, index) => {
      ;(meta.publishers ??= []).push({ id: index === 0 ? id(org) : id(name), name: inline(name), role, identifier: index === 0 ? identifier : undefined })
      if (meta.issuer === undefined) meta.issuer = xmlTextContent(name)
    })
    if (ctx.attr(org, null, 'std-org-level') || ctx.attr(org, null, 'std-org-type')) warn(org, '机构级别或类型无法表达')
    for (const item of elements(org)) if (!isKnownOrgChild(item)) warn(item, '未知机构元素', 'error')
  }
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
          if (org.name.local !== 'std-org' || org.name.ns !== null) warn(org, '未知机构元素', 'error')
          else mapOrg(org)
        }
        break
      case 'std-org': mapOrg(el); break
      case 'content-language': (meta.languages ??= []).push({ id: id(el), tag: text(el) }); break
      case 'release-date':
      case 'implementation-date': {
        if (!validDate(text(el))) ctx.report({ code: 'xml-date-invalid', severity: 'error', message: '日期必须是真实的 YYYY-MM-DD 日历日期', xml: ctx.location(el) })
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
      case 'std-type': standardTypeText = text(el); warn(el, `标准类型原文「${standardTypeText}」没有完整语义映射`); break
      case 'equivalence': warn(el, `采用关系无已确认内容模型：${text(el)}`); break
      case 'proj-id': case 'release-version': case 'doc-ref': case 'secretariat': case 'page-count':
        warn(el, `${el.name.local} 无对应字段，已忽略`); break
      default: warn(el, '未知元数据元素', 'error')
    }
  }
  for (const [lang, field] of [['zh', 'title'], ['en', 'titleEn']] as const) {
    if (meta[field] !== undefined) continue
    const parts = (meta.titleParts ?? []).filter(p => p.lang?.toLowerCase().split('-')[0] === lang)
    if (parts.length) {
      meta[field] = parts.map(p => p.content.map(run => run.text).join('')).filter(Boolean).join(' ')
      warn(element, `完整${lang}题名缺失，以分段生成封面题名`)
    }
  }
  const code = meta.stdCode ?? ''
  const descriptor = standardTypeText ?? ''
  if (/^GB\/Z(?:\s|$)/i.test(code) || descriptor.includes('指导性技术文件')) meta.standardType = 'guide'
  else if (/^GB(?:\/T)?(?:\s|$)/i.test(code) || descriptor.includes('国家标准')) meta.standardType = 'gb'
  else if (/^DB\d+(?:\/T)?(?:\s|$)/i.test(code) || descriptor.includes('地方标准')) meta.standardType = 'local'
  else if (/^T\//i.test(code) || descriptor.includes('团体标准')) meta.standardType = 'group'
  else if (/^Q\//i.test(code) || descriptor.includes('企业标准')) meta.standardType = 'enterprise'
  else if (descriptor.includes('行业标准')) meta.standardType = 'industry'
  else warn(element, '标准类型缺少可确定的依据，暂用 gb')
  return meta
}
