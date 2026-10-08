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
type IRInlineMark = NonNullable<IRInline['marks']>[number]
type IRTextMark = Exclude<IRInlineMark, { type: 'tableFootnoteRef' }>
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

function markToPm(mark: IRTextMark): { type: string; attrs?: PmAttrs } {
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
      // Preserve an untyped IR reference explicitly: the production PM mark defaults
      // missing refType to `chapter` for legacy PM documents.
      attrs: { targetId: mark.targetId, refType: mark.targetKind ? targetKinds[mark.targetKind] ?? mark.targetKind : '' },
    }
    case 'bibRef': return { type: 'bibRef', attrs: { targetId: mark.targetId } }
    case 'termRef': return { type: 'termRef', attrs: { targetId: mark.targetId } }
  }
}

function inlineToPm(run: IRInline): PMJsonNode[] {
  // tableFootnoteRef is an inline atom, not a ProseMirror mark. Keep it out of
  // text/formula mark sets and emit its node after the inline payload instead.
  const tableFootnoteRefs = (run.marks ?? []).filter((mark): mark is Extract<IRInlineMark, { type: 'tableFootnoteRef' }> => mark.type === 'tableFootnoteRef')
  const textMarks = (run.marks ?? []).filter((mark): mark is IRTextMark => mark.type !== 'tableFootnoteRef')
  const marks = [...textMarks.map(markToPm)]
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
  for (const mark of tableFootnoteRefs) result.push(node('tableFootnoteRef', withId(mark.id ?? '', { targetId: mark.targetId })))
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

function noteContent(ownerId: string, content: IRBlock[], path: string, errors: IRToPmDiagnostic[]): PMJsonNode[] {
  if (content.length === 1 && content[0].kind === 'paragraph') {
    const paragraph = content[0]
    const expectedId = `${ownerId}.p0`
    if (paragraph.id !== expectedId) {
      errors.push({
        path: `${path}.content[0]`,
        nodeId: paragraph.id,
        reason: `生产 note/example 行内内容会将段落 ID 派生为「${expectedId}」，无法保留「${paragraph.id}」`,
      })
    }
    return inlinesToPm(paragraph.content)
  }
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
    const inlineContent = noteContent(note.id, note.content, `${path}.notes.${note.id}`, errors)
    content.push(node('note', withId(note.id), inlineContent))
  }
  for (const example of entry.examples) {
    const inlineContent = noteContent(example.id, example.content, `${path}.examples.${example.id}`, errors)
    content.push(node('example', withId(example.id), inlineContent))
  }
  for (const child of entry.nestedEntries ?? []) content.push(termToPm(child, `${path}.nestedEntries.${child.id}`, errors))
  for (const [setIndex, set] of (entry.languageSets ?? []).entries()) {
    if (set.groups.length === 0) {
      errors.push({ path: `${path}.languageSets[${setIndex}].groups`, nodeId: set.id, reason: '生产tbxLangSet节点至少需要一个术语组' })
    }
    const tigs = set.groups.map((group, groupIndex) => {
      if (group.terms.length === 0) {
        errors.push({ path: `${path}.languageSets[${setIndex}].groups[${groupIndex}].terms`, nodeId: group.id, reason: '生产tbxTig节点至少需要一个术语变体' })
      }
      return node('tbxTig', withId(group.id), group.terms.map(variant => node('tbxTermVariant', withId(variant.id), [
        node('tbxTerm', undefined, inlinesToPm(variant.content)),
        ...variant.descriptors.map(descriptor => node('tbxTermDescriptor', withId(descriptor.id, { type: descriptor.kind }), inlinesToPm(descriptor.value))),
      ])))
    })
    content.push(node('tbxLangSet', withId(set.id, { lang: set.language }), tigs))
  }
  return node('termDef', withId(entry.id, { level: entry.level ?? 1 }), content)
}

function listToPm(list: IRList, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (list.items.length === 0) {
    errors.push({ path: `${path}.items`, nodeId: list.id, reason: '生产列表至少需要一个列项' })
  }
  if (list.listType === 'roman' || list.listType === 'romanUpper') {
    errors.push({
      path: `${path}.listType`,
      nodeId: list.id,
      reason: `生产列表schema不支持「${list.listType}」编号，不能无损转换`,
    })
    return node('stdList', withId(list.id, { listType: 'dash', level: 1 }), [])
  }

  const fixedLevel = list.listType === 'number' || list.listType === 'dot' ? 2 : 1
  if (list.level !== undefined && list.level !== fixedLevel) {
    errors.push({
      path: `${path}.level`,
      nodeId: list.id,
      reason: `生产列表「${list.listType}」固定为 ${fixedLevel} 级，IR 显式给出 ${list.level} 级`,
    })
  }

  const simple = list.items.every(item => item.content.length === 1 && item.content[0]?.kind === 'paragraph')
  if (simple) {
    const typeByList = { dash: 'dash', number: 'numeric', alpha: 'alpha', boxed: 'boxedNumeric', dot: 'dot' } as const
    const rawType = typeByList[list.listType]
    return node('stdList', withId(list.id, { listType: rawType, level: fixedLevel }), list.items.map((item, index) => {
      const content = item.content[0]
      if (content?.kind === 'paragraph' && content.id !== `${item.id}.p0`) {
        errors.push({
          path: `${path}.items[${index}].content[0]`,
          nodeId: content.id,
          reason: `生产标准列表会将列项段落 ID 派生为「${item.id}.p0」，无法保留「${content.id}」`,
        })
      }
      return node('stdListItem', withId(item.id), content?.kind === 'paragraph' ? inlinesToPm(content.content) : [])
    }))
  }
  if (list.listType === 'dash' || list.listType === 'number') {
    for (const [index, item] of list.items.entries()) {
      const first = item.content[0]
      if (first?.kind !== 'paragraph') {
        errors.push({
          path: `${path}.items[${index}].content[0]`,
          nodeId: first?.id ?? item.id,
          reason: 'StarterKit列项必须以段落开头',
        })
      }
    }
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
  if (table.rows.length === 0) {
    errors.push({ path: `${path}.rows`, nodeId: table.id, reason: '生产表格至少需要一个表格行' })
  }
  const attrs: PmAttrs = withId(table.id, { orientation: table.orientation, unit: table.unit ?? null, headerRowCount: table.headerRowCount })
  measureAttrs(attrs, 'width', table.width)
  if (table.style) Object.assign(attrs, tableStyleAttrs(table.style))
  const rows = table.rows.map((row, ri) => {
    if (row.cells.length === 0) {
      errors.push({ path: `${path}.rows[${ri}].cells`, nodeId: row.id, reason: '生产表格行至少需要一个单元格' })
    }
    const cells = row.cells.map((cell, ci) => {
      if (cell.content.length === 0) {
        errors.push({ path: `${path}.rows[${ri}].cells[${ci}].content`, nodeId: cell.id, reason: '生产表格单元格至少需要一个块级内容' })
      }
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
    })
    return node('tableRow', withId(row.id, row.style ? rowStyleAttrs(row.style) : {}), cells)
  })
  const content: PMJsonNode[] = [
    node('tableCaption', undefined, inlinesToPm(table.caption)),
    ...(table.captionEn ? [node('tableCaptionEn', undefined, inlinesToPm(table.captionEn))] : []),
    node('table', undefined, rows),
  ]
  if (table.notes.length) content.push(node('tableNoteRow', undefined, table.notes.map(note => {
    const inlineContent = noteContent(note.id, note.content, `${path}.notes.${note.id}`, errors)
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

function formulaToPm(formula: Extract<IRBlock, { kind: 'formula' }>, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  if (formula.sourceInlines && inlinePlainText(formula.sourceInlines).trim() !== formula.latex.trim()) {
    errors.push({ path: `${path}.sourceInlines`, nodeId: formula.id, reason: 'IR公式latex与sourceInlines文本不一致，不能无损投影为单一编辑源' })
  }
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
    case 'formula': return formulaToPm(block, path, errors)
    case 'note': case 'example': {
      const content = noteContent(block.id, block.content, path, errors)
      return node(block.kind, withId(block.id), content)
    }
    case 'warning': {
      if (block.content.length === 0) errors.push({ path, nodeId: block.id, reason: '生产 warning 节点要求至少一个块级子节点' })
      return node('warning', withId(block.id), blocksToPm(block.content, path, errors))
    }
    case 'quote': {
      if (block.content.length === 0) errors.push({ path, nodeId: block.id, reason: '生产 quoteBlock 节点要求至少一个块级子节点' })
      return node('quoteBlock', withId(block.id), blocksToPm(block.content, path, errors))
    }
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
  if (!clause.titled && clause.title.length > 0) {
    errors.push({ path: `${path}.title`, nodeId: clause.id, reason: '无题条不能携带非空title；生产schema无法区分隐藏标题与有效标题' })
  }
  return node('clause', withId(clause.id, { level: clause.level, hasTitle: clause.titled }), [
    node('clauseTitle', undefined, inlinesToPm(clause.title)),
    ...childrenToPm(clause.children, path, errors),
  ])
}

function chapterToPm(chapter: IRChapter, path: string, errors: IRToPmDiagnostic[]): PMJsonNode {
  return node('chapter', withId(chapter.id, { secType: chapter.secType }), [
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

const REFERENCE_MARK_TYPES = new Set(['crossRef', 'bibRef', 'termRef'])

/** A semantic reference mark needs actual text or a formula atom to attach to in ProseMirror. */
function diagnoseReferenceRunsWithoutCarrier(value: unknown, path: string, ownerId: string | undefined, errors: IRToPmDiagnostic[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => diagnoseReferenceRunsWithoutCarrier(child, `${path}[${index}]`, ownerId, errors))
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const currentOwnerId = typeof record.id === 'string' ? record.id : ownerId
  if (typeof record.text === 'string' && record.text.length === 0 && !record.formula && Array.isArray(record.marks)) {
    record.marks.forEach((mark, index) => {
      if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return
      const type = (mark as { type?: unknown }).type
      if (typeof type !== 'string' || !REFERENCE_MARK_TYPES.has(type)) return
      errors.push({
        path: `${path}.marks[${index}]`,
        nodeId: currentOwnerId,
        reason: `空文本上的${type}没有生产ProseMirror节点载体，投影会丢失目标引用`,
      })
    })
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'id') continue
    diagnoseReferenceRunsWithoutCarrier(child, `${path}.${key}`, currentOwnerId, errors)
  }
}

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
  const groups = index.groups.map((group, groupIndex) => {
    if (group.entries.length === 0) {
      errors.push({ path: `index.groups[${groupIndex}].entries`, nodeId: group.id, reason: '生产indexGroup节点至少需要一个索引词条' })
    }
    return node('indexGroup', withId(group.id, { label: group.label ? textOnlyField(group.label, `index.groups.${group.id}.label`, group.id, errors) : null }), group.entries.map(entry => node('indexEntry', withId(entry.id), [
      node('indexTerm', undefined, inlinesToPm(entry.term)),
      ...entry.targets.map(targetId => node('indexTarget', { targetId })),
      ...entry.seeAlso.map(targetId => node('indexSeeAlso', { targetId })),
    ])))
  })
  return node('indexBlock', withId(index.id, { title: index.title ? textOnlyField(index.title, 'index.title', index.id, errors) : null }), groups)
}

/** Convert a newly constructed or imported IR document into production PM JSON. */
export function irToPm(doc: IRDoc, options: IRToPmOptions = {}): PMJsonNode {
  const rootType = options.rootType ?? 'doc'
  const errors: IRToPmDiagnostic[] = []
  diagnoseReferenceRunsWithoutCarrier(doc, 'doc', undefined, errors)
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

  if (rootType === 'standardDoc' && doc.body.length === 0) {
    errors.push({ path: 'body', reason: '生产standardDoc根至少需要一个chapter' })
  }
  if (rootType === 'doc' && content.length === 0) {
    errors.push({ path: 'doc.content', reason: '生产doc根至少需要一个内容节点' })
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
