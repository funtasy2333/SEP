/**
 * `processing-meta` 与 `front/std-meta`（WP8.2 设计 §2.1）。
 *
 * `std-meta` 的子元素次序由本文件固定写死（`validate.py` V-12 的导出次序），不依赖输入顺序：
 * std-type（不输出）、title-wrap、std-ident、std-org-group、content-language、std-ref、release-date、implementation-date、
 * equivalence（不输出）、comm-ref、ics、ccs、std-supersedes、std-xref、permissions、custom-meta-group。
 * SES 必填元数据（发布机构、语言、发布日期、实施日期）缺失时按 D-X-02 决定 B 报 warning `meta-required-missing`
 * 并省略对应元素；题名缺失仍为 error。IR 里有数据而 XML 无表达的（采用关系、一致性程度、多份版权……）报 `meta-not-expressed`，
 * 同一文档内合并为一条（`standardType` 为 info，每次导出一条）。
 */

import type { IRInline, IRTitlePart } from '../../ir/types'
import type { XmlElement, XmlNode } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { el, site, type RenderContext, type Site } from './context'

export const XML46687_META_BOUNDARY: Xml46687BoundaryContribution = {
  fields: {
    meta: ['titleParts', 'identifiers', 'languages', 'publishers', 'adoptions', 'replacedStandards', 'copyrights', 'proposer', 'technicalCommittee'],
    titlePart: ['id', 'lang', 'role', 'content'],
    identifier: ['id', 'scheme', 'value', 'parts'],
    identifierPart: ['id', 'kind', 'position', 'content'],
    language: ['id', 'tag', 'usage'],
    publisher: ['id', 'name', 'role', 'identifier'],
    adoption: ['id', 'reference', 'degree', 'language'],
    replacedStandard: ['id', 'reference', 'relation'],
    copyright: ['id', 'holder', 'year', 'language', 'statement'],
  },
  shapes: [
    { parent: 'meta', key: 'titleParts', shape: 'titlePart' },
    { parent: 'meta', key: 'identifiers', shape: 'identifier' },
    { parent: 'identifier', key: 'parts', shape: 'identifierPart' },
    { parent: 'meta', key: 'languages', shape: 'language' },
    { parent: 'meta', key: 'publishers', shape: 'publisher' },
    { parent: 'meta', key: 'adoptions', shape: 'adoption' },
    { parent: 'meta', key: 'replacedStandards', shape: 'replacedStandard' },
    { parent: 'meta', key: 'copyrights', shape: 'copyright' },
  ],
  // IRIdentifierPart.kind 是元素名（originator/doc-type……），不是节点 kind
  plainKindShapes: ['identifierPart'],
  declared: [
    { pathSuffix: 'meta.titleParts', kind: 'field', name: 'titleParts', matrixIds: ['M-4.3.2-04', 'M-4.3.2-19', 'M-4.3.2-20', 'M-4.3.2-21', 'M-4.3.2-22'], task: 'T2.4a', reason: '分段/多语种题名写成 title-wrap（C-S-13）' },
    { pathSuffix: 'meta.identifiers', kind: 'field', name: 'identifiers', matrixIds: ['M-4.3.2-05', 'M-4.3.2-23', 'M-4.3.2-24'], task: 'T2.4a', reason: '标准编号写成 std-ident 与 std-ref（C-S-14）' },
    { pathSuffix: 'meta.languages', kind: 'field', name: 'languages', matrixIds: ['M-4.3.2-07'], task: 'T2.4a', reason: '语言写成 content-language（C-S-16）' },
    { pathSuffix: 'meta.publishers', kind: 'field', name: 'publishers', matrixIds: ['M-4.3.2-06', 'M-4.3.2-29'], task: 'T2.4a', reason: '发布机构写成 std-org-group（C-S-15）' },
    { pathSuffix: 'meta.copyrights', kind: 'field', name: 'copyrights', matrixIds: ['M-4.3.2-15', 'M-4.3.2-16', 'M-4.3.2-17', 'M-4.3.2-18'], task: 'T2.4a', reason: '版权写成 permissions（C-S-19）' },
    { pathSuffix: 'meta.replacedStandards', kind: 'field', name: 'replacedStandards', matrixIds: ['M-4.3.2-13'], task: 'T2.4a', reason: '被代替标准写成 std-supersedes/std-xref（C-S-18）' },
    { pathSuffix: 'meta.adoptions', kind: 'field', name: 'adoptions', matrixIds: ['M-4.3.2-08'], task: 'T2.4a', reason: '采用关系放行并报 meta-not-expressed（equivalence 无内容模型，D-S-05、D-X-04）' },
    { pathSuffix: 'meta.proposer', kind: 'field', name: 'proposer', matrixIds: ['M-4.3.2-14'], task: 'T2.4a', reason: '提出单位写成 custom-meta proposer（C-S-21）' },
    { pathSuffix: 'meta.technicalCommittee', kind: 'field', name: 'technicalCommittee', matrixIds: ['M-F-27', 'M-G-03'], task: 'T2.4a', reason: '归口单位写成 comm-ref（C-S-20）' },
  ],
}

/** processing-meta 的六个固定属性（M-4.3.2-30，C-S-04）。 */
const PROCESSING_META_ATTRS = {
  'base-tagset': 'interchange',
  'mathml-version': '3.0',
  'table-model': 'xhtml',
  'terminology-model': 'tbx',
  'math-representation': 'mathml',
  'tagset-family': 'sts',
}

/** `processing-meta`（第一个子元素）：六个固定属性 + 版本说明（M-4.3.2-30/-31，D-S-02）。 */
export function renderProcessingMeta(): XmlElement {
  return el('processing-meta', PROCESSING_META_ATTRS, [
    el('custom-meta-group', undefined, [
      el('custom-meta', undefined, [
        el('meta-name', undefined, ['基于XML的标准文档内容标记指南']),
        el('meta-value', undefined, ['2026']),
      ]),
    ]),
  ])
}

const NOT_EXPRESSED_TITLE = '元数据中有信息在 GB/T 46687.2 中没有表达，未导出'

function isRealDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
  return day <= days
}

const TITLE_ROLES = ['intro', 'main', 'compl', 'full'] as const
type TitleRole = typeof TITLE_ROLES[number]

interface TitleGroup {
  lang: string
  roles: Partial<Record<TitleRole, { content: IRInline[]; at: Site } | { text: string }>>
}

function langPriority(lang: string): number {
  const primary = lang.toLowerCase().split(/[-_]/)[0]
  return primary === 'zh' ? 0 : primary === 'en' ? 1 : 2
}

/** `title-wrap`（每种语言一个，zh、en、其余按首次出现）。 */
function renderTitleWraps(ctx: RenderContext): XmlElement[] {
  const meta = ctx.doc.meta
  const groups = new Map<string, TitleGroup>()
  ;(meta.titleParts ?? []).forEach((part: IRTitlePart, index) => {
    const at = site(`doc.meta.titleParts[${index}]`, part.id)
    const lang = (part.lang ?? '').trim()
    if (lang === '') {
      ctx.report('meta-required-missing', 'error', '题名分段缺少语言（lang），title-wrap 的 xml:lang 是必备属性，无法导出。', at)
      return
    }
    const role = part.role === undefined || part.role === '' ? 'full' : part.role
    if (!(TITLE_ROLES as readonly string[]).includes(role)) {
      ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `题名分段的 role「${role}」不在 intro/main/compl/full 内，已跳过`, at)
      return
    }
    let group = groups.get(lang)
    if (!group) { group = { lang, roles: {} }; groups.set(lang, group) }
    if (group.roles[role as TitleRole]) {
      ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `同一语言的题名分段 ${role} 重复，只导出第一个`, at)
      return
    }
    group.roles[role as TitleRole] = { content: part.content, at: site(`${at.path}.content`, part.id) }
  })
  const legacy: Array<[string, string | undefined]> = [['zh', meta.title], ['en', meta.titleEn]]
  for (const [lang, text] of legacy) {
    if (text === undefined || text.trim() === '') continue
    let group = [...groups.values()].find((entry) => entry.lang.toLowerCase().split(/[-_]/)[0] === lang)
    if (!group) { group = { lang, roles: {} }; groups.set(lang, group) }
    // 旧字段只在该语言没有全称（full）时补上（C-S-13：不合成、不改写）
    if (!group.roles.full) group.roles.full = { text }
  }
  if (groups.size === 0) {
    ctx.report('meta-required-missing', 'error', '文档没有任何题名（meta.titleParts、meta.title 均为空），std-meta 至少需要一个 title-wrap。', site('doc.meta'))
    return []
  }
  const ordered = [...groups.values()].map((group, index) => ({ group, index }))
    .sort((a, b) => langPriority(a.group.lang) - langPriority(b.group.lang) || a.index - b.index)
  return ordered.map(({ group }) => el('title-wrap', { 'xml:lang': group.lang },
    TITLE_ROLES.map((role): XmlElement | null => {
      const entry = group.roles[role]
      if (!entry) return null
      const children: XmlNode[] = 'text' in entry ? [{ type: 'text', value: entry.text }] : ctx.renderInlines(entry.content, entry.at, 'inline')
      return el(role, undefined, children)
    })))
}

/** `std-ident`：第一个有 `parts` 的标识符；只写 IR 里有的组成部分（C-S-14）。 */
function renderStdIdent(ctx: RenderContext): XmlElement | null {
  const identifiers = ctx.doc.meta.identifiers ?? []
  const index = identifiers.findIndex((identifier) => identifier.parts.length > 0)
  identifiers.forEach((identifier, other) => {
    if (identifier.parts.length > 0 && other !== index) {
      ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, '只导出第一个有组成部分的标准编号（std-ident 至多一个），其余编号的组成部分未导出', site(`doc.meta.identifiers[${other}]`, identifier.id))
    }
  })
  if (index < 0) return null
  const identifier = identifiers[index]!
  const at = site(`doc.meta.identifiers[${index}]`, identifier.id)
  const order = ['originator', 'doc-type', 'doc-number', 'part-number', 'edition', 'version']
  const children: XmlElement[] = []
  const parts = identifier.parts.map((part, position) => ({ part, position }))
  for (const name of order) {
    const same = parts.filter(({ part }) => part.kind === name)
      .sort((a, b) => (a.part.position ?? Number.MAX_SAFE_INTEGER) - (b.part.position ?? Number.MAX_SAFE_INTEGER) || a.position - b.position)
    for (const { part, position } of same) {
      const nodes = ctx.renderInlines(part.content, site(`${at.path}.parts[${position}].content`, part.id), name === 'edition' || name === 'version' ? 'subsup' : 'text')
      if (nodes.length > 0) children.push(el(name, undefined, nodes))
    }
  }
  identifier.parts.forEach((part, position) => {
    if (!order.includes(part.kind)) {
      ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `标准编号的组成部分「${part.kind}」不是 std-ident 的子元素，未导出`, site(`${at.path}.parts[${position}]`, part.id))
    }
  })
  return children.length > 0 ? el('std-ident', undefined, children) : null
}

/** `std-org-group`：每个发布机构一个 `std-org`；缺 `publishers` 时用旧字段 `issuer`。 */
function renderOrganizations(ctx: RenderContext): XmlElement | null {
  const meta = ctx.doc.meta
  const orgs: XmlElement[] = []
  ;(meta.publishers ?? []).forEach((publisher, index) => {
    const at = site(`doc.meta.publishers[${index}]`, publisher.id)
    const names = ctx.renderInlines(publisher.name, site(`${at.path}.name`, publisher.id), 'subsup')
    const abbreviation = (publisher.identifier ?? '').trim()
    const children: XmlElement[] = []
    if (names.length > 0) children.push(el('std-org-name', undefined, names))
    if (abbreviation !== '') children.push(el('std-org-abbrev', undefined, [abbreviation]))
    if (children.length > 0) orgs.push(el('std-org', { 'std-org-role': publisher.role?.trim() }, children))
  })
  if (orgs.length === 0 && (meta.issuer ?? '').trim() !== '') {
    orgs.push(el('std-org', undefined, [el('std-org-name', undefined, [meta.issuer!.trim()])]))
  }
  if (orgs.length === 0) {
    ctx.report('meta-required-missing', 'warning', '缺少发布机构（meta.publishers 与 meta.issuer 均为空）：SES 要求填写，已省略 std-org-group。', site('doc.meta.publishers'))
    return null
  }
  return el('std-org-group', undefined, orgs)
}

function renderLanguages(ctx: RenderContext): XmlElement[] {
  const out: XmlElement[] = []
  ;(ctx.doc.meta.languages ?? []).forEach((language, index) => {
    const tag = language.tag.trim()
    const at = site(`doc.meta.languages[${index}]`, language.id)
    if (tag === '') return
    out.push(el('content-language', undefined, [tag]))
    if ((language.usage ?? '') !== '') {
      ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `语言「${tag}」的 usage「${language.usage}」没有对应元素`, at)
    }
  })
  if (out.length === 0) {
    ctx.report('meta-required-missing', 'warning', '缺少内容语言（meta.languages 为空）：SES 要求填写，已省略 content-language。', site('doc.meta.languages'))
  }
  return out
}

/** `std-ref type="dated|undated"`：来自标识符的 `value`（`scheme`）；缺 dated 值时用旧字段 `stdCode`。 */
function renderStdRefs(ctx: RenderContext): XmlElement[] {
  const meta = ctx.doc.meta
  const out: XmlElement[] = []
  let dated: string | undefined
  ;(meta.identifiers ?? []).forEach((identifier, index) => {
    const value = (identifier.value ?? '').trim()
    if (value === '') return
    const scheme = identifier.scheme
    if (scheme === 'dated' || scheme === 'undated') {
      out.push(el('std-ref', { type: scheme }, [value]))
      if (scheme === 'dated' && dated === undefined) dated = value
    } else {
      ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `标准编号「${value}」的 scheme「${scheme ?? ''}」不是 dated/undated，未导出为 std-ref`, site(`doc.meta.identifiers[${index}]`, identifier.id))
    }
  })
  const stdCode = (meta.stdCode ?? '').trim()
  if (stdCode !== '') {
    if (dated === undefined) out.unshift(el('std-ref', { type: 'dated' }, [stdCode]))
    else if (dated !== stdCode) {
      ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `meta.stdCode「${stdCode}」与标识符给出的完整编号「${dated}」不一致，以标识符为准，stdCode 未导出`, site('doc.meta.stdCode'))
    }
  }
  return out
}

function renderDate(ctx: RenderContext, name: 'release-date' | 'implementation-date', value: string | undefined, field: string, label: string): { element: XmlElement | null; date?: string } {
  const text = (value ?? '').trim()
  const at = site(`doc.meta.${field}`)
  if (text === '') {
    ctx.report('meta-required-missing', 'warning', `缺少${label}（meta.${field} 为空）：SES 要求填写，已省略 ${name}。`, at)
    return { element: null }
  }
  if (!isRealDate(text)) {
    ctx.report('xml-date-invalid', 'error', `${label}「${text}」不是真实的日历日期（需要 YYYY-MM-DD），不输出猜测值。`, at)
    return { element: null }
  }
  return { element: el(name, undefined, [text]), date: text }
}

/** `std-supersedes`（代替关系）与 `std-xref type="revises"`（修订关系）。 */
function renderReplacements(ctx: RenderContext): { supersedes: XmlElement[]; xrefs: XmlElement[] } {
  const meta = ctx.doc.meta
  const supersedes: XmlElement[] = []
  const xrefs: XmlElement[] = []
  const replaced = meta.replacedStandards ?? []
  replaced.forEach((entry, index) => {
    const reference = entry.reference.trim()
    if (reference === '') return
    const relation = entry.relation ?? ''
    if (relation === '' || relation === 'replaces') supersedes.push(el('std-supersedes', undefined, [reference]))
    else if (relation === 'revises') xrefs.push(el('std-xref', { type: 'revises' }, [el('std-ref', undefined, [reference])]))
    else ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `被代替标准「${reference}」的关系「${relation}」没有已确认的表达`, site(`doc.meta.replacedStandards[${index}]`, entry.id))
  })
  if (replaced.length === 0 && (meta.replaces ?? '').trim() !== '') supersedes.push(el('std-supersedes', undefined, [meta.replaces!.trim()]))
  return { supersedes, xrefs }
}

/** `permissions`：`copyrights` 恰有一项时输出（C-S-19）。 */
function renderPermissions(ctx: RenderContext): XmlElement | null {
  const copyrights = ctx.doc.meta.copyrights ?? []
  if (copyrights.length === 0) return null
  if (copyrights.length > 1) {
    ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `有 ${copyrights.length} 份版权声明，原文没有多份 permissions 的写法，全部未导出`, site('doc.meta.copyrights'))
    return null
  }
  const copyright = copyrights[0]!
  const at = site('doc.meta.copyrights[0]', copyright.id)
  if ((copyright.language ?? '') !== '') {
    ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `版权声明的 language「${copyright.language}」没有对应属性`, at)
  }
  const statement = ctx.renderInlines(copyright.statement, site(`${at.path}.statement`, copyright.id), 'phrase')
  const holder = copyright.holder ? ctx.renderInlines(copyright.holder, site(`${at.path}.holder`, copyright.id), 'subsup') : []
  const year = (copyright.year ?? '').trim()
  const children: XmlElement[] = []
  if (statement.length > 0) children.push(el('copyright-statement', undefined, statement))
  if (year !== '') children.push(el('copyright-year', undefined, [year]))
  if (holder.length > 0) children.push(el('copyright-holder', undefined, holder))
  return children.length > 0 ? el('permissions', undefined, children) : null
}

/** SES 专有字段：`custom-meta`（固定顺序，非空才写，C-S-21）。 */
function renderCustomMeta(ctx: RenderContext): XmlElement | null {
  const meta = ctx.doc.meta
  const fields: Array<[string, string | undefined]> = [
    ['filing-no', meta.filingNo], ['industry-name', meta.industryName], ['region-name', meta.regionName],
    ['cover-designation', meta.coverDesignation], ['applicant', meta.applicant], ['proposer', meta.proposer],
  ]
  const items = fields.filter(([, value]) => (value ?? '').trim() !== '')
    .map(([name, value]) => el('custom-meta', undefined, [el('meta-name', undefined, [name]), el('meta-value', undefined, [value!.trim()])]))
  return items.length > 0 ? el('custom-meta-group', undefined, items) : null
}

/** `front/std-meta`（设计 §2.1）。 */
export function renderStdMeta(ctx: RenderContext): XmlElement {
  const meta = ctx.doc.meta
  ctx.report('meta-not-expressed', 'info', `标准类型（standardType: ${meta.standardType}）在 GB/T 46687.2 中没有内容模型，std-type 未导出。`, site('doc.meta.standardType'))

  const titles = renderTitleWraps(ctx)
  const ident = renderStdIdent(ctx)
  const organizations = renderOrganizations(ctx)
  const languages = renderLanguages(ctx)
  const stdRefs = renderStdRefs(ctx)
  const release = renderDate(ctx, 'release-date', meta.publishDate, 'publishDate', '发布日期')
  const implementation = renderDate(ctx, 'implementation-date', meta.implementDate, 'implementDate', '实施日期')
  if (release.date !== undefined && implementation.date !== undefined && release.date > implementation.date) {
    ctx.report('meta-date-order', 'warning', `发布日期 ${release.date} 晚于实施日期 ${implementation.date}（疑似把实施日期写进了发布日期）。`, site('doc.meta.publishDate'))
  }
  if ((meta.adoptions ?? []).length > 0) {
    ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `有 ${(meta.adoptions ?? []).length} 条采用关系（adoptions）：equivalence 没有内容模型，未导出`, site('doc.meta.adoptions'))
  }
  if ((meta.consistency ?? '').trim() !== '') {
    ctx.reportMerged('meta-not-expressed', 'warning', NOT_EXPRESSED_TITLE, `一致性程度标识「${meta.consistency}」：equivalence 没有内容模型，未导出`, site('doc.meta.consistency'))
  }
  const committee = (meta.technicalCommittee ?? '').trim()
  const replacements = renderReplacements(ctx)

  return el('std-meta', undefined, [
    ...titles,
    ident,
    organizations,
    ...languages,
    ...stdRefs,
    release.element,
    implementation.element,
    committee !== '' ? el('comm-ref', undefined, [committee]) : null,
    (meta.icsCode ?? '').trim() !== '' ? el('ics', undefined, [meta.icsCode!.trim()]) : null,
    (meta.ccsCode ?? '').trim() !== '' ? el('ccs', undefined, [meta.ccsCode!.trim()]) : null,
    ...replacements.supersedes,
    ...replacements.xrefs,
    renderPermissions(ctx),
    renderCustomMeta(ctx),
  ])
}
