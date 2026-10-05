/**
 * Authoring IR → ProseMirror JSON adapter.
 *
 * This is a semantic projection, not a snapshot copier: each IR field is written
 * to its typed production node/attribute. Data which cannot be represented by
 * the production schema is rejected with a path-bearing diagnostic.
 */
import type {
  IRAppendix, IRBibEntry, IRBlock, IRChapter, IRClause, IRClauseChild, IRDoc,
  IRDocMeta, IRInline, IRList, IRMeasure, IRTable, IRTermEntry,
} from './types'
import type { PMJsonNode } from './pmToIr'
import { hasSemanticExtensions } from './extensions'

export interface IRToPmDiagnostic {
  path: string
  reason: string
  nodeId?: string
}

export class IRToPmError extends Error {
  readonly diagnostics: IRToPmDiagnostic[]

  constructor(diagnostics: IRToPmDiagnostic[]) {
    super(`IR contains ${diagnostics.length} item(s) that cannot be represented in ProseMirror JSON`)
    this.name = 'IRToPmError'
    this.diagnostics = diagnostics
  }
}

export interface IRToPmOptions {
  /** StandardDoc is useful to XML integrations; production editor defaults to StarterKit doc. */
  rootType?: 'doc' | 'standardDoc'
}

type PmAttrs = Record<string, unknown>
const node = (type: string, attrs?: PmAttrs, content?: PMJsonNode[]): PMJsonNode => ({
  type,
  ...(attrs && Object.keys(attrs).length ? { attrs } : {}),
  ...(content ? { content } : {}),
})
const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const withId = (id: string, attrs: PmAttrs = {}): PmAttrs => ({ ...attrs, nodeId: id })
const nonEmpty = <T>(value: T[] | undefined): T[] => value ?? []

const targetKinds: Record<string, string> = {
  chapter: 'chapter', clause: 'clause', appendix: 'appendix', figure: 'figure',
  table: 'table', formula: 'formula', note: 'note', example: 'example',
  bibliography: 'bibEntry', term: 'term', index: 'index', paragraph: 'paragraph',
}

function markToPm(mark: NonNullable<IRInline['marks']>[number]): { type: string; attrs?: PmAttrs } {
  switch (mark.type) {
    case 'bold': return { type: 'bold' }
    case 'italic': return { type: 'italic' }
    case 'underline': return { type: 'underline' }
    case 'sub': return { type: 'subscript' }
    case 'sup': return { type: 'superscript' }
    case 'strike': return { type: 'strike' }
    case 'code': return { type: 'code' }
    case 'variable': return { type: 'variable', attrs: { kind: mark.kind ?? null, name: mark.name ?? null } }
    case 'externalLink': return { type: 'externalLink', attrs: { href: mark.href, title: mark.title ?? null, target: mark.target ?? null, rel: mark.rel ?? null } }
    case 'crossRef': return {
      type: 'crossRef',
      attrs: { targetId: mark.targetId, ...(mark.targetKind ? { refType: targetKinds[mark.targetKind] ?? mark.targetKind } : {}) },
    }
    case 'bibRef': return { type: 'bibRef', attrs: { targetId: mark.targetId } }
    case 'termRef': return { type: 'termRef', attrs: { targetId: mark.targetId } }
    case 'tableFootnoteRef': return { type: 'tableFootnoteRef', attrs: { targetId: mark.targetId } }
  }
}

function inlineToPm(run: IRInline): PMJsonNode[] {
  const marks = [...(run.marks ?? []).map(markToPm)]
  if (run.style && Object.keys(run.style).length) marks.push({ type: 'textStyle', attrs: { ...run.style } })
  const result: PMJsonNode[] = []
  if (run.text) {
    // ProseMirror text nodes cannot contain hard breaks semantically.
    const parts = run.text.split('\n')
    parts.forEach((part, i) => {
      if (part) result.push({ ...text(part), ...(marks.length ? { marks: [...marks] } : {}) })
      if (i < parts.length - 1) result.push({ type: 'hardBreak', ...(marks.length ? { marks: [...marks] } : {}) })
    })
  }
  if (run.formula) {
    result.push({ ...node('formulaInline', withId(run.formula.id, {
      mathml: run.formula.mathml ?? null,
      latex: run.formula.latex ?? null,
      source: run.formula.source ?? null,
    })), ...(marks.length ? { marks: [...marks] } : {}) })
  }
  if (run.footnote) {
    result.push(node('footnoteRef', withId(run.footnote.id, {
      content: inlinesToPm(run.footnote.content),
    })))
  }
  if (run.marks?.some(mark => mark.type === 'tableFootnoteRef')) {
    for (const mark of run.marks) {
      if (mark.type === 'tableFootnoteRef') result.push(node('tableFootnoteRef', withId(mark.id ?? '', { targetId: mark.targetId })))
    }
  }
  return result
}

function inlinesToPm(inlines: IRInline[]): PMJsonNode[] {
  return inlines.flatMap(inlineToPm)
}

function measureAttrs(attrs: PmAttrs, key: string, value?: IRMeasure): void {
  if (!value) return
  attrs[key] = value.value
  attrs[`${key}Unit`] = value.unit
}

function cellStyleAttrs(style: NonNullable<IRTable['rows'][number]['cells'][number]['style']>): PmAttrs {
  const attrs: PmAttrs = { ...style }
  for (const key of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
    delete attrs[key]
    measureAttrs(attrs, key, style[key])
  }
  return attrs
}

function rowStyleAttrs(style: NonNullable<IRTable['rows'][number]['style']>): PmAttrs {
  const attrs: PmAttrs = { ...style }
  for (const key of ['borderWidth', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'height'] as const) {
    delete attrs[key]
    measureAttrs(attrs, key, style[key])
  }
  return attrs
}

function tableStyleAttrs(style: NonNullable<IRTable['style']>): PmAttrs {
  const attrs: PmAttrs = { ...style }
  delete attrs.borderWidth
  delete attrs.cellPadding
  measureAttrs(attrs, 'borderWidth', style.borderWidth)
  measureAttrs(attrs, 'cellPadding', style.cellPadding)
  return attrs
}

function paragraph(id: string, content: IRInline[], type = 'stdParagraph'): PMJsonNode {
  return node(type, withId(id), inlinesToPm(content))
}

function blocksToPm(blocks: IRBlock[], path: string, errors: IRToPmDiagnostic[]): PMJsonNode[] {
  return blocks.map((block, index) => blockToPm(block, `${path}[${index}]`, errors)).filter((item): item is PMJsonNode => !!item)
}

function noteContent(content: IRBlock[], path: string, errors: IRToPmDiagnostic[]): PMJsonNode[] {
  if (content.length === 1 && content[0].kind === 'paragraph') return inlinesToPm(content[0].content)
  errors.push({ path, nodeId: content[0]?.id, reason: '生产 note/example 只接受一段行内内容，IR 中存在多块或非段落内容' })
  return []
}

function termToPm(entry: IRTermEntry, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  const content: PMJsonNode[] = [
    node('termName', undefined, inlinesToPm(entry.term)),
    ...(entry.termEn ? [node('termNameEn', undefined, inlinesToPm(entry.termEn))] : []),
  ]
  const [mainDefinition, ...continuedDefinitions] = entry.definition
  if (!mainDefinition) {
    errors.push({ path: `${path}.definition`, nodeId: entry.id, reason: 'termDef schema 要求至少一个主定义段落' })
    content.push(node('termDefinition', withId(`${entry.id}.def0`), []))
  } else if (mainDefinition.kind !== 'paragraph') {
    errors.push({ path: `${path}.definition[0]`, nodeId: mainDefinition.id, reason: 'termDef 主定义必须为段落' })
    content.push(node('termDefinition', withId(mainDefinition.id), []))
  } else {
    content.push(node('termDefinition', withId(mainDefinition.id), inlinesToPm(mainDefinition.content)))
  }
  for (const [index, block] of continuedDefinitions.entries()) {
    if (block.kind === 'paragraph') {
      content.push(paragraph(block.id, block.content))
    } else {
      errors.push({ path: `${path}.definition[${index + 1}]`, nodeId: block.id, reason: 'termDef 后续定义只允许段落' })
    }
  }
  if (entry.source !== undefined) content.push(node('termSource', undefined, inlinesToPm(entry.source)))
  for (const note of entry.notes) {
    const inlineContent = noteContent(note.content, `${path}.notes.${note.id}`, errors)
    content.push(node('note', withId(note.id), inlineContent))
  }
  for (const example of entry.examples) {
    const inlineContent = noteContent(example.content, `${path}.examples.${example.id}`, errors)
    content.push(node('example', withId(example.id), inlineContent))
  }
  for (const child of entry.nestedEntries ?? []) content.push(termToPm(child, `${path}.nestedEntries.${child.id}`, errors))
  for (const set of entry.languageSets ?? []) {
    const tigs = set.groups.map(group => node('tbxTig', withId(group.id), group.terms.map(variant => node('tbxTermVariant', withId(variant.id), [
      node('tbxTerm', undefined, inlinesToPm(variant.content)),
      ...variant.descriptors.map(descriptor => node('tbxTermDescriptor', withId(descriptor.id, { type: descriptor.kind }), inlinesToPm(descriptor.value))),
    ]))))
    content.push(node('tbxLangSet', withId(set.id, { lang: set.language }), tigs))
  }
  return node('termDef', withId(entry.id, { level: entry.level ?? 1 }), content)
}

function listToPm(list: IRList, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  const simple = list.items.every(item => item.content.length === 1 && item.content[0]?.kind === 'paragraph')
  if (simple) {
    const typeByList = { dash: 'dash', number: 'numeric', alpha: 'alpha', roman: 'numeric', romanUpper: 'numeric', boxed: 'boxedNumeric', dot: 'dot' } as const
    const rawType = typeByList[list.listType]
    const level = list.level ?? (rawType === 'numeric' || rawType === 'dot' ? 2 : 1)
    return node('stdList', withId(list.id, { listType: rawType, level }), list.items.map(item => {
      const content = item.content[0]
      return node('stdListItem', withId(item.id), content?.kind === 'paragraph' ? inlinesToPm(content.content) : [])
    }))
  }
  if (list.listType === 'dash' || list.listType === 'number') {
    const type = list.listType === 'number' ? 'orderedList' : 'bulletList'
    return node(type, withId(list.id), list.items.map(item => node('listItem', withId(item.id), [
      ...item.content.flatMap((block, index) => block.kind === 'paragraph'
        ? [paragraph(block.id, block.content, 'paragraph')]
        : [listToPm(block, `${path}.${item.id}[${index}]`, errors)]),
    ])))
  }
  errors.push({ path, nodeId: list.id, reason: '生产stdList不支持嵌套列表；当前IR列项结构不能无损映射' })
  return node('stdList', withId(list.id, { listType: 'dash', level: list.level ?? 1 }), [])
}

function tableToPm(table: IRTable, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  const attrs: PmAttrs = withId(table.id, { orientation: table.orientation, unit: table.unit ?? null })
  measureAttrs(attrs, 'width', table.width)
  if (table.style) Object.assign(attrs, tableStyleAttrs(table.style))
  const rows = table.rows.map((row, ri) => node('tableRow', withId(row.id, row.style ? rowStyleAttrs(row.style) : {}), row.cells.map((cell, ci) => {
    const cellAttrs: PmAttrs = withId(cell.id, {
      colspan: cell.colspan,
      rowspan: cell.rowspan,
      colwidth: cell.columnWidths ? [...cell.columnWidths] : null,
      cellType: cell.cellType ?? null,
      unit: cell.unit ?? null,
    })
    measureAttrs(cellAttrs, 'width', cell.width)
    if (cell.style) Object.assign(cellAttrs, cellStyleAttrs(cell.style))
    return node(cell.header ? 'tableHeader' : 'tableCell', cellAttrs, blocksToPm(cell.content, `${path}.rows[${ri}].cells[${ci}].content`, errors))
  })))
  const content: PMJsonNode[] = [
    node('tableCaption', undefined, inlinesToPm(table.caption)),
    ...(table.captionEn ? [node('tableCaptionEn', undefined, inlinesToPm(table.captionEn))] : []),
    node('table', undefined, rows),
  ]
  if (table.notes.length) content.push(node('tableNoteRow', undefined, table.notes.map(note => {
    const inlineContent = noteContent(note.content, `${path}.notes.${note.id}`, errors)
    return node('note', withId(note.id), inlineContent)
  })))
  if (table.footnotes?.length) content.push(node('tableFootnoteRow', undefined, table.footnotes.map(footnote => node('tableFootnoteEntry', withId(footnote.id), inlinesToPm(footnote.content)))))
  return node('stdTable', attrs, content)
}

function figureToPm(figure: Extract<IRBlock, { kind: 'figure' }>, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (figure.notes.length) errors.push({ path: `${path}.notes`, nodeId: figure.id, reason: '生产Figure节点没有可保存图中注的子节点' })
  const width = figure.imageWidth
  const height = figure.imageHeight
  const content: PMJsonNode[] = [
    node('figureImage', {
      src: figure.src, resourceId: figure.resourceId ?? null, alt: figure.alt ?? '', title: figure.title ?? null,
      width: width?.value ?? null, height: height?.value ?? null,
      widthUnit: width?.unit ?? null, heightUnit: height?.unit ?? null,
    }),
    node('figureCaption', undefined, inlinesToPm(figure.caption)),
    ...(figure.captionEn ? [node('figureCaptionEn', undefined, inlinesToPm(figure.captionEn))] : []),
    ...(figure.descriptions ?? []).map(description => node('figureDescription', withId(description.id), inlinesToPm(description.content))),
    ...(figure.groups ?? []).map(group => node('figureGroup', withId(group.id), [
      ...group.descriptions.map(description => node('figureDescription', withId(description.id), inlinesToPm(description.content))),
      ...group.resourceRefs.map(targetId => node('figureResourceRef', { targetId })),
    ])),
  ]
  return node('figure', withId(figure.id, { orientation: figure.orientation, unit: figure.unit ?? null }), content)
}

function formulaToPm(formula: Extract<IRBlock, { kind: 'formula' }>): PMJsonNode {
  const source = formula.sourceInlines ?? [{ text: formula.latex }]
  const content: PMJsonNode[] = [node('formulaContent', undefined, inlinesToPm(source))]
  if (formula.notes?.length) content.push(...formula.notes.map(note => node('formulaNote', withId(note.id), inlinesToPm(note.content))))
  if (formula.whereList.length) {
    content.push(node('whereList', undefined, formula.whereList.map(item => node('whereItem', withId(item.id), [
      node('whereTerm', undefined, inlinesToPm(item.term)),
      node('whereDefinition', undefined, inlinesToPm(item.definition)),
    ]))))
  }
  return node('formula', withId(formula.id, { latex: formula.latex, mathml: formula.mathml ?? null, numbered: formula.numbered }), content)
}

function blockToPm(block: IRBlock, path: string, errors: IRToPmDiagnostic[]): PMJsonNode | null {
  switch (block.kind) {
    case 'paragraph': return paragraph(block.id, block.content)
    case 'list': return listToPm(block, path, errors)
    case 'table': return tableToPm(block, path, errors)
    case 'figure': return figureToPm(block, path, errors)
    case 'formula': return formulaToPm(block)
    case 'note': case 'example': {
      const content = noteContent(block.content, path, errors)
      return node(block.kind, withId(block.id), content)
    }
    case 'warning': return node('warning', withId(block.id), blocksToPm(block.content, path, errors))
    case 'quote': return node('quoteBlock', withId(block.id), blocksToPm(block.content, path, errors))
    case 'code': return node('codeBlock', withId(block.id, { language: block.language ?? null }), block.text ? [text(block.text)] : [])
  }
}

function childrenToPm(children: IRClauseChild[], path: string, errors: IRToPmDiagnostic[]): PMJsonNode[] {
  return children.map((child, index) => {
    const at = `${path}[${index}]`
    if (child.kind === 'clause') return clauseToPm(child, at, errors)
    if (child.kind === 'termEntry') return termToPm(child, at, errors)
    return blockToPm(child, at, errors)
  }).filter((item): item is PMJsonNode => !!item)
}

function clauseToPm(clause: IRClause, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  return node('clause', withId(clause.id, { level: clause.level, hasTitle: clause.titled }), [
    node('clauseTitle', undefined, inlinesToPm(clause.title)),
    ...childrenToPm(clause.children, path, errors),
  ])
}

function chapterToPm(chapter: IRChapter, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  return node('chapter', withId(chapter.id), [
    node('chapterTitle', undefined, inlinesToPm(chapter.title)),
    ...childrenToPm(chapter.children, path, errors),
  ])
}

function appendixToPm(appendix: IRAppendix, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  return node('appendix', withId(appendix.id, { normative: appendix.normative }), [
    node('appendixLabel', undefined, [text(appendix.normative ? '（规范性）' : '（资料性）')]),
    node('appendixTitle', undefined, inlinesToPm(appendix.title)),
    ...childrenToPm(appendix.children, path, errors),
  ])
}

function bibEntryToPm(entry: IRBibEntry): PMJsonNode {
  const content = inlinesToPm(entry.content)
  const fields = nonEmpty(entry.fields).map(field => node('bibField', withId(field.id, { name: field.name }), inlinesToPm(field.value)))
  const identifiers = nonEmpty(entry.identifiers).map(identifier => node('bibIdentifier', withId(identifier.id, { scheme: identifier.scheme, value: identifier.value })))
  const externalLink = entry.externalLink ? [node('bibExternalLink', {
    href: entry.externalLink.href,
    title: entry.externalLink.title ?? null,
    target: entry.externalLink.target ?? null,
    rel: entry.externalLink.rel ?? null,
    displayText: entry.externalLink.displayText ?? entry.externalLink.title ?? entry.externalLink.href,
  })] : []
  if (fields.length || identifiers.length || externalLink.length) {
    content.push(node('bibStructured', undefined, [...fields, ...identifiers, ...externalLink]))
  }
  return node('bibEntry', withId(entry.id, { entryType: entry.entryType ?? null }), content)
}

function textOnlyField(inlines: IRInline[], path: string, id: string, errors: IRToPmDiagnostic[]): string {
  if (inlines.some(run => (run.marks?.length ?? 0) > 0 || !!run.style || !!run.formula || !!run.footnote)) {
    errors.push({ path, nodeId: id, reason: '生产schema将该字段存入纯字符串属性，无法保留IR中的行内格式或公式' })
  }
  return inlinePlainText(inlines)
}

function metadataToPm(meta: IRDocMeta, errors: IRToPmDiagnostic[]): PMJsonNode | undefined {
  const content: PMJsonNode[] = []
  for (const value of meta.titleParts ?? []) content.push(node('titlePart', withId(value.id, { lang: value.lang ?? null, role: value.role ?? null }), inlinesToPm(value.content)))
  for (const value of meta.identifiers ?? []) content.push(node('standardIdentifier', withId(value.id, { scheme: value.scheme ?? null, value: value.value ?? null }), value.parts.map(part => node('identifierPart', withId(part.id, { kind: part.kind, position: part.position ?? null }), inlinesToPm(part.content)))))
  for (const value of meta.languages ?? []) content.push(node('language', withId(value.id, { tag: value.tag, usage: value.usage ?? null })))
  for (const value of meta.publishers ?? []) content.push(node('publisher', withId(value.id, { role: value.role ?? null, identifier: value.identifier ?? null }), inlinesToPm(value.name)))
  for (const value of meta.adoptions ?? []) content.push(node('adoption', withId(value.id, { reference: value.reference, degree: value.degree ?? null, language: value.language ?? null })))
  for (const value of meta.replacedStandards ?? []) content.push(node('replacedStandard', withId(value.id, { reference: value.reference, relation: value.relation ?? null })))
  for (const value of meta.copyrights ?? []) content.push(node('copyright', withId(value.id, { holder: value.holder ? textOnlyField(value.holder, `meta.copyrights.${value.id}.holder`, value.id, errors) : null, year: value.year ?? null, language: value.language ?? null }), inlinesToPm(value.statement)))
  return content.length ? node('metadataBlock', undefined, content) : undefined
}

function inlinePlainText(inlines: IRInline[]): string { return inlines.map(item => item.text).join('') }

function metaToCover(meta: IRDocMeta): PmAttrs {
  const types: Record<IRDocMeta['standardType'], string> = {
    gb: 'national', industry: 'industry', local: 'local', group: 'group', enterprise: 'enterprise', guide: 'guidance',
  }
  return {
    standardNo: meta.stdCode ?? '', standardType: types[meta.standardType],
    titleCn: meta.title ?? '', titleEn: meta.titleEn ?? '',
    publishDate: meta.publishDate ?? '', implementDate: meta.implementDate ?? '',
    issuer: meta.issuer ?? '', icsCode: meta.icsCode ?? '', ccsCode: meta.ccsCode ?? '',
    replaces: meta.replaces ?? '', consistency: meta.consistency ?? '', filingNo: meta.filingNo ?? '',
    industryName: meta.industryName ?? '', regionName: meta.regionName ?? '', coverDesignation: meta.coverDesignation ?? '',
    applicant: meta.applicant ?? null, proposer: meta.proposer ?? null, technicalCommittee: meta.technicalCommittee ?? null,
  }
}

function indexToPm(index: NonNullable<IRDoc['index']>, errors: IRToPmDiagnostic[]): PMJsonNode {
  const groups = index.groups.map(group => node('indexGroup', withId(group.id, { label: group.label ? textOnlyField(group.label, `index.groups.${group.id}.label`, group.id, errors) : null }), group.entries.map(entry => node('indexEntry', withId(entry.id), [
    node('indexTerm', undefined, inlinesToPm(entry.term)),
    ...entry.targets.map(targetId => node('indexTarget', { targetId })),
    ...entry.seeAlso.map(targetId => node('indexSeeAlso', { targetId })),
  ]))))
  return node('indexBlock', withId(index.id, { title: index.title ? textOnlyField(index.title, 'index.title', index.id, errors) : null }), groups)
}

/** Convert a newly constructed or imported IR document into production PM JSON. */
export function irToPm(doc: IRDoc, options: IRToPmOptions = {}): PMJsonNode {
  const rootType = options.rootType ?? 'doc'
  const errors: IRToPmDiagnostic[] = []
  if (doc.unsupportedContent?.length) {
    errors.push(...doc.unsupportedContent.map(item => ({ path: item.path, nodeId: item.nodeId ?? undefined, reason: `${item.nodeType}: ${item.reason}` })))
  }
  if (doc.unmappedFootnotes?.length) {
    errors.push(...doc.unmappedFootnotes.map(item => ({ path: `unmappedFootnotes.${item.container}`, nodeId: item.nodeId, reason: item.reason ?? '脚注位置不能无损写回生产文档' })))
  }

  const content: PMJsonNode[] = []
  const hasScalarMeta = doc.meta.standardType !== 'gb' || Object.entries(metaToCover(doc.meta)).some(([key, value]) => key !== 'standardType' && value !== '' && value !== null && value !== undefined)
  const metadata = metadataToPm(doc.meta, errors)
  if (hasScalarMeta || rootType === 'standardDoc') content.push(node('coverPage', metaToCover(doc.meta), [node('paragraph')]))
  if (metadata) content.push(metadata)
  if (doc.front.foreword.length) content.push(node('foreword', undefined, blocksToPm(doc.front.foreword, 'front.foreword', errors)))
  if (doc.front.introduction.length) content.push(node('introduction', undefined, blocksToPm(doc.front.introduction, 'front.introduction', errors)))
  doc.body.forEach((chapter, index) => content.push(chapterToPm(chapter, `body[${index}]`, errors)))
  doc.appendices.forEach((appendix, index) => content.push(appendixToPm(appendix, `appendices[${index}]`, errors)))
  if (doc.bibliography.length) content.push(node('bibliography', undefined, [
    node('bibliographyTitle', undefined, [text('参考文献')]),
    ...doc.bibliography.map(bibEntryToPm),
  ]))
  if (doc.index) content.push(indexToPm(doc.index, errors))
  for (const resource of doc.resources ?? []) {
    content.push(node('figureResource', withId(resource.id, {
      mediaType: resource.mediaType ?? null, name: resource.name ?? null,
      encoding: resource.encoding, data: resource.data,
    })))
  }

  // Older IR snapshots did not carry a stable identity for table-footnote reference atoms.
  // Give those atoms deterministic document-local IDs without changing existing IDs.
  const usedIds = new Set<string>()
  const collectIds = (items: PMJsonNode[]): void => {
    for (const item of items) {
      const id = item.attrs?.nodeId
      if (typeof id === 'string' && id) usedIds.add(id)
      collectIds(item.content ?? [])
    }
  }
  collectIds(content)
  let generatedRefSeq = 0
  const completeReferenceIds = (items: PMJsonNode[]): void => {
    for (const item of items) {
      if (item.type === 'tableFootnoteRef' && !(typeof item.attrs?.nodeId === 'string' && item.attrs.nodeId)) {
        let id = ''
        do { generatedRefSeq += 1; id = `irTableFootnoteRef${generatedRefSeq}` } while (usedIds.has(id))
        usedIds.add(id)
        item.attrs = { ...item.attrs, nodeId: id }
      }
      completeReferenceIds(item.content ?? [])
    }
  }
  completeReferenceIds(content)

  if (errors.length) throw new IRToPmError(errors)
  const attrs = hasSemanticExtensions(doc) ? { extensionVersion: 1 } : undefined
  if (rootType === 'standardDoc') {
    return node('standardDoc', attrs, content)
  }
  return node('doc', attrs, content)
}
