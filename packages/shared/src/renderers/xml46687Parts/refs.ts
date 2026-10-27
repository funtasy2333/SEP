/**
 * 规范性引用文件、参考文献与索引（WP8.2 设计 §2.10、§2.11 索引）。
 *
 * - 规范性引用（`renderNormRefList`）：`ref-list[@content-type="norm-refs"]`（只能在 `secType === 'norm-refs'` 的章内，否则
 *   `xml-normref-outside`；`ref-list` 不写 id）＞ `ref[@id=ref_<n>]`（恒输出，D-X-11）＞ `std>std-ref+title`（两者之间不写逗号文本，C-T-54）
 *   或 `mixed-citation`；`std` 条目的编号或名称为空 → error `xml-normref-incomplete`；
 * - 参考文献（`renderBibliography`）：`back/ref-list[@content-type="bibl"][@id="sec_bibl"]` ＞ `title`（`bibliographyTitle`，缺省“参考文献”）
 *   ＞ `ref[@id=biblref_<n>]`（按 xmlId 尾号升序，不信任数组序）＞ `label`（“[n]”）+ `std` 或 `mixed-citation[@xlink:type="simple"]`
 *   （+ `uri`）。`entryType==='standard'` 且 `fields` 有非空 `std-ref` 与 `title` 才写 `std`，否则 warning `bib-std-incomplete` 并按
 *   `mixed-citation` 输出；其余字段与标识符无 XML 表达 → warning `bib-field-not-expressed`（聚合）；
 * - 索引（`renderIndex`）：`index[@id="sec_index"]` ＞ `index-title-group` ＞ `index-div` ＞ `index-entry[@id=df_<k>]` ＞ `term` + `see-entry`
 *   （纯文本编号，无 `rid`）；`seeAlso` 无 XML 表达 → warning `index-seealso-not-expressed`。
 *
 * `bibRef` 的 `xref` 内容取 run 自己的文本（D-X-10），由 inline.ts 写出；本文件只写目标 `ref`。
 */

import type { IRBibEntry, IRIndexEntry, IRInline, IRNormRef, IRNormRefList } from '../../ir/types'
import type { XmlElement, XmlNode } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { el, site, sub, type RenderContext, type Site } from './context'
import { urlProblem } from './inline'

export const XML46687_REFS_BOUNDARY: Xml46687BoundaryContribution = {
  fields: {
    doc: ['bibliographyTitle', 'index'],
    // BASE_FIELDS 里没有 normRefList / normRef：视为整个 kind 放行
    normRefList: ['kind', 'id', 'entries'],
    normRef: ['kind', 'id', 'entryType', 'ref', 'title', 'content'],
    bibEntry: ['entryType', 'fields', 'identifiers', 'externalLink'],
    bibField: ['id', 'name', 'value'],
    bibIdentifier: ['id', 'scheme', 'value'],
    bibExternalLink: ['href', 'title', 'target', 'rel', 'displayText'],
    index: ['id', 'title', 'groups'],
    indexGroup: ['id', 'label', 'entries'],
    indexEntry: ['id', 'term', 'targets', 'seeAlso'],
  },
  shapes: [
    { parent: 'bibEntry', key: 'fields', shape: 'bibField' },
    { parent: 'bibEntry', key: 'identifiers', shape: 'bibIdentifier' },
    { parent: 'bibEntry', key: 'externalLink', shape: 'bibExternalLink' },
    { parent: 'doc', key: 'index', shape: 'index' },
    { parent: 'index', key: 'groups', shape: 'indexGroup' },
    { parent: 'indexGroup', key: 'entries', shape: 'indexEntry' },
  ],
  declared: [
    { pathSuffix: 'doc.bibliographyTitle', kind: 'field', name: 'bibliographyTitle', matrixIds: ['M-4.5.3-02'], task: 'T2.4c', reason: '自定义参考文献标题写成 ref-list/title（4.5.3）' },
    { pathSuffix: '.kind', kind: 'kind', name: 'normRefList', matrixIds: ['M-4.4.2.3-02', 'M-4.4.2.3-03', 'M-4.4.2.3-04'], task: 'T2.4c', reason: '规范性引用文件清单写成 ref-list[@content-type="norm-refs"]（4.4.2.3）' },
    { pathSuffix: 'doc.index', kind: 'field', name: 'index', matrixIds: ['M-4.5.4-01', 'M-4.5.4-02', 'M-4.5.4-03', 'M-4.5.4-04', 'M-4.5.4-05', 'M-4.5.4-06'], task: 'T2.4c', reason: '索引写成 index/index-div/index-entry（4.5.4）' },
    { pathSuffix: 'bibliography.entryType', kind: 'field', name: 'entryType', matrixIds: ['M-4.5.3-05', 'M-4.5.3.1-03'], task: 'T2.4c', reason: '文献类型 standard 决定写 std 还是 mixed-citation（4.5.3.1）' },
    { pathSuffix: 'bibliography.fields', kind: 'field', name: 'fields', matrixIds: ['M-4.5.3.1-04', 'M-4.5.3.1-05'], task: 'T2.4c', reason: '文献字段 std-ref/title 写成 std/std-ref、std/title；其余字段报 bib-field-not-expressed（4.5.3.1）' },
    { pathSuffix: 'bibliography.identifiers', kind: 'field', name: 'identifiers', matrixIds: ['M-4.5.3-05'], task: 'T2.4c', reason: '文献标识符无 XML 表达：放行并报 bib-field-not-expressed（D-X-04）' },
    { pathSuffix: 'bibliography.externalLink', kind: 'field', name: 'externalLink', matrixIds: ['M-4.5.3-08', 'M-4.5.3.3-02'], task: 'T2.4c', reason: '文献外链写成 mixed-citation/uri（4.5.3.3）' },
  ],
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 有实际可输出内容（文本去空白后非空，或公式、脚注、行内图）。 */
function hasContent(runs: readonly IRInline[] | undefined): boolean {
  return runs !== undefined && runs.some((run) => run.text.trim() !== '' || run.formula !== undefined || run.footnote !== undefined || run.image !== undefined)
}

// ---------------------------------------------------------------------------
// 规范性引用文件（§2.10）
// ---------------------------------------------------------------------------

function renderNormRef(entry: IRNormRef, at: Site, ctx: RenderContext): XmlElement | undefined {
  const id = ctx.xmlIdOf(entry.id, at, '规范性引用文件条目')
  if (entry.entryType === 'std') {
    const complete = hasContent(entry.ref) && hasContent(entry.title)
    if (!complete) {
      ctx.report('xml-normref-incomplete', 'error',
        `规范性引用文件条目的${!hasContent(entry.ref) ? '文件编号' : '文件名称'}为空：std 必须同时有 std-ref 与 title（4.4.2.3.2）。`, at)
      return undefined
    }
    return el('ref', { id }, [
      el('std', undefined, [
        el('std-ref', undefined, ctx.renderInlines(entry.ref, sub(at, '.ref'), 'text')),
        el('title', undefined, ctx.renderInlines(entry.title, sub(at, '.title'), 'inline')),
      ]),
    ])
  }
  if (entry.entryType === 'mixed') {
    if (!hasContent(entry.content)) {
      ctx.report('xml-normref-incomplete', 'error', '非标准化文件的规范性引用条目没有内容（mixed-citation 需要保持原有格式的引用文字，4.4.2.3.3）。', at)
      return undefined
    }
    return el('ref', { id }, [el('mixed-citation', undefined, ctx.renderInlines(entry.content, sub(at, '.content'), 'citation'))])
  }
  const unknown: never = entry
  throw new Error(`xml46687: 未知的规范性引用条目类型 ${String((unknown as { entryType?: unknown }).entryType)}（${at.path}）`)
}

export function renderNormRefList(block: IRNormRefList, at: Site, ctx: RenderContext): XmlElement[] {
  if (ctx.scope.chapter?.secType !== 'norm-refs') {
    ctx.report('xml-normref-outside', 'error', '规范性引用文件清单只能放在「规范性引用文件」章（secType 为 norm-refs）内，此处不能导出。', at)
    return []
  }
  if (block.entries.length === 0) {
    ctx.report('empty-content', 'warning', '规范性引用文件清单没有任何条目，已省略该清单。', at)
    return []
  }
  const refs = block.entries
    .map((entry, index) => renderNormRef(entry, sub(at, `.entries[${index}]`, entry.id), ctx))
    .filter((ref): ref is XmlElement => ref !== undefined)
  return [el('ref-list', { 'content-type': 'norm-refs' }, refs)]
}

// ---------------------------------------------------------------------------
// 参考文献（§2.10）
// ---------------------------------------------------------------------------

const BIBLREF_ID = /^biblref_(\d+)$/
const BIB_TITLE_DEFAULT = '参考文献'

/** 文献条目里没有 XML 表达的部分（聚合的 warning `bib-field-not-expressed`）。 */
function describeUnexpressed(entry: IRBibEntry, usedFields: ReadonlySet<number>, linkUnexpressed: boolean): string | undefined {
  const names = (entry.fields ?? []).filter((_field, index) => !usedFields.has(index)).map((field) => field.name || '（无名字段）')
  const parts: string[] = []
  if (names.length > 0) parts.push(`字段 ${names.join('、')}`)
  const identifiers = entry.identifiers ?? []
  if (identifiers.length > 0) parts.push(`标识符 ${identifiers.map((identifier) => identifier.scheme || '（无方案）').join('、')}`)
  if (linkUnexpressed && entry.externalLink) parts.push('外部链接')
  return parts.length > 0 ? parts.join('；') : undefined
}

/** `mixed-citation/uri`：文字取 `externalLink.href`（`uri` 没有 `xlink:href`），协议白名单同 V-11；其余属性无表达。 */
function renderBibUri(entry: IRBibEntry, at: Site, ctx: RenderContext): XmlElement | undefined {
  const link = entry.externalLink
  if (!link) return undefined
  const linkSite = sub(at, '.externalLink')
  const href = typeof link.href === 'string' ? link.href.trim() : ''
  const problem = href === '' ? '地址为空' : urlProblem(link.href)
  if (problem) {
    ctx.report('xml-link-protocol', 'error', `文献外部链接「${link.href ?? ''}」不能导出：${problem}。`, linkSite)
    return undefined
  }
  if (typeof link.displayText === 'string' && link.displayText !== '' && link.displayText !== href) {
    ctx.report('link-attr-not-expressed', 'warning', `文献外部链接的显示文字「${link.displayText}」与地址不同；uri 只能写地址，显示文字未导出。`, linkSite)
  }
  for (const attribute of ['title', 'target', 'rel'] as const) {
    const value = link[attribute]
    if (typeof value === 'string' && value !== '') {
      ctx.report('link-attr-not-expressed', 'warning', `文献外部链接的 ${attribute}「${value}」在 GB/T 46687.2 中没有对应属性，未导出。`, linkSite)
    }
  }
  return el('uri', undefined, [href])
}

function renderBibEntry(entry: IRBibEntry, at: Site, ctx: RenderContext, xmlId: string, label: string): XmlElement {
  const fields = entry.fields ?? []
  const stdRefIndex = fields.findIndex((field) => field.name === 'std-ref' && hasContent(field.value))
  const titleIndex = fields.findIndex((field) => field.name === 'title' && hasContent(field.value))
  let body: XmlElement
  let unexpressed: string | undefined
  if (entry.entryType === 'standard' && stdRefIndex >= 0 && titleIndex >= 0) {
    body = el('std', undefined, [
      el('std-ref', undefined, ctx.renderInlines(fields[stdRefIndex]!.value, sub(at, `.fields[${stdRefIndex}].value`, fields[stdRefIndex]!.id), 'text')),
      el('title', undefined, ctx.renderInlines(fields[titleIndex]!.value, sub(at, `.fields[${titleIndex}].value`, fields[titleIndex]!.id), 'inline')),
    ])
    unexpressed = describeUnexpressed(entry, new Set([stdRefIndex, titleIndex]), true)
  } else {
    if (entry.entryType === 'standard') {
      const missing = [stdRefIndex < 0 ? 'std-ref' : undefined, titleIndex < 0 ? 'title' : undefined].filter((name) => name !== undefined).join('、')
      ctx.report('bib-std-incomplete', 'warning', `文献 ${label} 的类型是标准，但缺少非空的 ${missing} 字段，无法写成 std，已按 mixed-citation 输出其文字。`, at)
    }
    const uri = renderBibUri(entry, at, ctx)
    const content = ctx.renderInlines(entry.content, sub(at, '.content'), 'citation')
    if (!hasContent(entry.content) && uri === undefined) {
      ctx.report('empty-content', 'warning', `文献 ${label} 没有任何文字内容，已写出空的 mixed-citation。`, sub(at, '.content'))
    }
    body = el('mixed-citation', { 'xlink:type': 'simple' }, [...content, uri])
    unexpressed = describeUnexpressed(entry, new Set(), false)
  }
  if (unexpressed !== undefined) {
    ctx.reportMerged('bib-field-not-expressed', 'warning', '参考文献条目里有信息在 GB/T 46687.2 中没有表达，未导出', `文献 ${label}：${unexpressed}`, at)
  }
  return el('ref', { id: xmlId }, [el('label', undefined, [label]), body])
}

export function renderBibliography(ctx: RenderContext): XmlElement | null {
  const entries = ctx.doc.bibliography
  if (entries.length === 0) return null
  const prepared = entries.map((entry, index) => {
    const at = site(`doc.bibliography[${index}]`, entry.id)
    const label = ctx.labelOf(entry.id)
    const sequence = label ? BIBLREF_ID.exec(label.xmlId)?.[1] : undefined
    if (!label || sequence === undefined || label.label === '') {
      ctx.report('xml-label-missing', 'error',
        `参考文献条目在 Resolver 的 labels 中缺少 biblref_<n> 形式的 xmlId 或编号（节点 ${entry.id}；现为「${label?.xmlId ?? '无'}」）。`, at)
      return undefined
    }
    return { entry, at, xmlId: label.xmlId, label: label.label, sequence: Number(sequence), index }
  }).filter((item): item is NonNullable<typeof item> => item !== undefined)
  prepared.sort((a, b) => a.sequence - b.sequence || a.index - b.index)

  const title = ctx.doc.bibliographyTitle !== undefined && hasContent(ctx.doc.bibliographyTitle)
    ? el('title', undefined, ctx.renderInlines(ctx.doc.bibliographyTitle, site('doc.bibliographyTitle'), 'inline'))
    : el('title', undefined, [BIB_TITLE_DEFAULT])
  return el('ref-list', { id: 'sec_bibl', 'content-type': 'bibl' }, [
    title,
    ...prepared.map((item) => renderBibEntry(item.entry, item.at, ctx, item.xmlId, item.label)),
  ])
}

// ---------------------------------------------------------------------------
// 索引（§2.11）
// ---------------------------------------------------------------------------

function renderIndexEntry(entry: IRIndexEntry, at: Site, ctx: RenderContext): XmlElement {
  const id = `df_${ctx.nextCount('df')}`
  const seeEntries: XmlElement[] = []
  entry.targets.forEach((targetId, index) => {
    const targetSite = sub(at, `.targets[${index}]`)
    const label = ctx.labelOf(targetId)
    if (!label) {
      ctx.report('xml-xref-target-missing', 'error', `索引条目的目标「${targetId}」在 labels 中不存在，无法写出 see-entry。`, targetSite)
    } else if (label.label === '' || label.refText === '') {
      ctx.report('xml-xref-target-unsupported', 'error', `索引条目的目标「${targetId}」没有真实编号（如段落、规范性引用条目），see-entry 里写不出编号。`, targetSite)
    } else {
      seeEntries.push(el('see-entry', undefined, [label.refText]))
    }
  })
  if (entry.seeAlso.length > 0) {
    ctx.report('index-seealso-not-expressed', 'warning', `索引条目的“参见”（${entry.seeAlso.length} 项）在 GB/T 46687.2 中没有写法，未导出。`, sub(at, '.seeAlso'))
  }
  return el('index-entry', { id }, [el('term', undefined, ctx.renderInlines(entry.term, sub(at, '.term'), 'term')), ...seeEntries])
}

export function renderIndex(ctx: RenderContext): XmlElement | null {
  const index = ctx.doc.index
  if (index === undefined) return null
  const at = site('doc.index', index.id)
  const divs: XmlElement[] = []
  index.groups.forEach((group, groupIndex) => {
    const groupSite = sub(at, `.groups[${groupIndex}]`, group.id)
    if (group.entries.length === 0) {
      ctx.report('empty-content', 'warning', '索引分组里没有任何条目，已省略该分组。', groupSite)
      return
    }
    const children: Array<XmlNode | null> = [
      hasContent(group.label)
        ? el('index-title-group', undefined, [el('title', undefined, ctx.renderInlines(group.label!, sub(groupSite, '.label'), 'inline'))])
        : null,
      ...group.entries.map((entry, entryIndex) => renderIndexEntry(entry, sub(groupSite, `.entries[${entryIndex}]`, entry.id), ctx)),
    ]
    divs.push(el('index-div', undefined, children))
  })
  if (divs.length === 0) {
    ctx.report('empty-content', 'warning', '索引没有任何条目，已省略整个索引（index 至少需要一个 index-div 或 index-entry）。', at)
    return null
  }
  return el('index', { id: 'sec_index' }, [
    hasContent(index.title) ? el('index-title-group', undefined, [el('title', undefined, ctx.renderInlines(index.title!, sub(at, '.title'), 'inline'))]) : null,
    ...divs,
  ])
}
