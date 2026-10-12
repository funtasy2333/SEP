import { collectFootnotes } from '../ir/footnotes'
import { resolve } from '../ir/resolve'
import type { IRBlock, IRClauseChild, IRDoc, IRFootnote, IRInline, IRTable, NodeId, ResolvedLabel } from '../ir/types'

type Labels = Record<NodeId, ResolvedLabel>

/**
 * Sort table-footnote definitions by the labels already assigned by resolve().
 * This deliberately consumes resolver labels instead of assigning footnote numbers here.
 */
export function orderTableFootnotes(footnotes: IRFootnote[], labels: Labels): IRFootnote[] {
  return footnotes
    .map((footnote) => {
      const resolved = labels[footnote.id]
      if (!resolved) throw new Error(`render: 表脚注 "${footnote.id}" 在 labels 中没有编号`)
      const marker = resolved.refText
      if (!/^[a-z]+$/.test(marker) || resolved.label !== marker || !resolved.xmlId.endsWith(`_${marker}`)) {
        throw new Error(`render: 表脚注 "${footnote.id}" 的 resolver 标签无效: "${marker}"`)
      }
      return { footnote, markerOrder: alphaMarkerOrder(marker) }
    })
    .sort((a, b) => a.markerOrder - b.markerOrder || (a.footnote.id < b.footnote.id ? -1 : a.footnote.id > b.footnote.id ? 1 : 0))
    .map(({ footnote }) => footnote)
}

/** Sort body-note definitions by the resolver's continuous fn_N identifiers. */
export function orderBodyFootnotes(footnotes: IRFootnote[], labels: Labels): IRFootnote[] {
  return footnotes
    .map((footnote) => {
      const resolved = labels[footnote.id]
      const match = resolved ? /^fn_(\d+)$/.exec(resolved.xmlId) : null
      if (!resolved || !match || Number(match[1]) < 1 || !Number.isSafeInteger(Number(match[1]))) {
        throw new Error(`render: 条文脚注 "${footnote.id}" 缺少有效的 resolver 编号`)
      }
      return { footnote, id: Number(match[1]) }
    })
    .sort((a, b) => a.id - b.id)
    .map(({ footnote }) => footnote)
}

/** Convert a resolver-provided alphabetic marker to an ordering key (a=1, z=26, aa=27). */
function alphaMarkerOrder(marker: string): number {
  let order = 0
  for (const char of marker) order = order * 26 + char.charCodeAt(0) - 96
  return order
}

function blockHasTableFootnotes(block: IRBlock): boolean {
  switch (block.kind) {
    case 'table':
      return (block.footnotes?.length ?? 0) > 0 ||
        block.rows.some((row) => row.cells.some((cell) => cell.content.some(blockHasTableFootnotes))) ||
        block.notes.some((note) => note.content.some(blockHasTableFootnotes))
    case 'list':
      return block.items.some((item) => item.content.some(blockHasTableFootnotes))
    case 'warning':
    case 'quote':
    case 'note':
    case 'example':
      return block.content.some(blockHasTableFootnotes)
    case 'figure':
      return block.notes.some((note) => note.content.some(blockHasTableFootnotes))
    case 'paragraph':
    case 'formula':
    case 'code':
      return false
  }
}

function inlineHasFootnote(inlines: IRInline[]): boolean {
  return inlines.some((run) => run.footnote !== undefined || run.marks?.some((mark) => mark.type === 'tableFootnoteRef'))
}

function blockHasFootnoteSyntax(block: IRBlock): boolean {
  switch (block.kind) {
    case 'paragraph': return inlineHasFootnote(block.content)
    case 'list': return block.items.some((item) => item.content.some(blockHasFootnoteSyntax))
    case 'warning':
    case 'quote':
    case 'note':
    case 'example': return block.content.some(blockHasFootnoteSyntax)
    case 'table': return (block.footnotes?.length ?? 0) > 0 || inlineHasFootnote(block.caption) ||
      inlineHasFootnote(block.captionEn ?? []) || block.rows.some((row) => row.cells.some((cell) => cell.content.some(blockHasFootnoteSyntax))) ||
      block.notes.some((note) => note.content.some(blockHasFootnoteSyntax))
    case 'figure': return inlineHasFootnote(block.caption) || inlineHasFootnote(block.captionEn ?? []) ||
      block.notes.some((note) => note.content.some(blockHasFootnoteSyntax))
    case 'formula': return inlineHasFootnote(block.sourceInlines ?? []) || block.whereList.some((item) => inlineHasFootnote(item.term) || inlineHasFootnote(item.definition))
    case 'code': return false
  }
}

function childHasTableFootnotes(child: IRClauseChild): boolean {
  if (child.kind === 'clause') return child.children.some(childHasTableFootnotes)
  if (child.kind === 'termEntry') {
    return child.definition.some(blockHasTableFootnotes) || child.notes.some((note) => note.content.some(blockHasTableFootnotes)) ||
      child.examples.some((example) => example.content.some(blockHasTableFootnotes))
  }
  return blockHasTableFootnotes(child)
}

function childHasFootnoteSyntax(child: IRClauseChild): boolean {
  if (child.kind === 'clause') return inlineHasFootnote(child.title) || child.children.some(childHasFootnoteSyntax)
  if (child.kind === 'termEntry') return inlineHasFootnote(child.term) || inlineHasFootnote(child.termEn ?? []) ||
    child.definition.some(blockHasFootnoteSyntax) || child.notes.some((note) => note.content.some(blockHasFootnoteSyntax)) ||
    child.examples.some((example) => example.content.some(blockHasFootnoteSyntax)) || inlineHasFootnote(child.source ?? [])
  return blockHasFootnoteSyntax(child)
}

function documentHasFootnoteSyntax(doc: IRDoc): boolean {
  return (doc.unmappedFootnotes?.length ?? 0) > 0 || doc.front.foreword.some(blockHasFootnoteSyntax) || doc.front.introduction.some(blockHasFootnoteSyntax) ||
    doc.body.some((chapter) => inlineHasFootnote(chapter.title) || chapter.children.some(childHasFootnoteSyntax)) ||
    doc.appendices.some((appendix) => inlineHasFootnote(appendix.title) || appendix.children.some(childHasFootnoteSyntax)) ||
    doc.bibliography.some((entry) => inlineHasFootnote(entry.content))
}

function collectTables(block: IRBlock, out: IRTable[]): void {
  switch (block.kind) {
    case 'table':
      out.push(block)
      block.rows.forEach((row) => row.cells.forEach((cell) => cell.content.forEach((child) => collectTables(child, out))))
      block.notes.forEach((note) => note.content.forEach((child) => collectTables(child, out)))
      break
    case 'list': block.items.forEach((item) => item.content.forEach((child) => collectTables(child, out))); break
    case 'warning': case 'quote': case 'note': case 'example': block.content.forEach((child) => collectTables(child, out)); break
    case 'figure': block.notes.forEach((note) => note.content.forEach((child) => collectTables(child, out))); break
    case 'paragraph': case 'formula': case 'code': break
  }
}

function collectDocumentTables(doc: IRDoc): IRTable[] {
  const tables: IRTable[] = []
  const collectChild = (child: IRClauseChild): void => {
    if (child.kind === 'clause') child.children.forEach(collectChild)
    else if (child.kind === 'termEntry') {
      child.definition.forEach((block) => collectTables(block, tables))
      child.notes.forEach((note) => note.content.forEach((block) => collectTables(block, tables)))
      child.examples.forEach((example) => example.content.forEach((block) => collectTables(block, tables)))
    } else collectTables(child, tables)
  }
  doc.front.foreword.forEach((block) => collectTables(block, tables))
  doc.front.introduction.forEach((block) => collectTables(block, tables))
  doc.body.forEach((chapter) => chapter.children.forEach(collectChild))
  doc.appendices.forEach((appendix) => appendix.children.forEach(collectChild))
  return tables
}

/** Reject broken footnote links at renderer entry, even when the client export guard is bypassed. */
export function assertFootnoteReferences(doc: IRDoc, labels: Labels): IRFootnote[] {
  const bodyFootnotes = collectFootnotes(doc)
  if (!documentHasFootnoteSyntax(doc) && bodyFootnotes.length === 0) return []

  const resolved = resolve(doc)
  const footnoteProblems = resolved.problems.filter((problem) =>
    problem.code === 'dangling-footnote' || problem.code === 'unreferenced-footnote' || problem.code === 'invalid-footnote')
  if (footnoteProblems.length > 0) {
    throw new Error(`render: 脚注关联无效：${footnoteProblems.map((problem) => problem.message).join('；')}`)
  }

  const assertLabelMatch = (id: NodeId, kind: '条文脚注' | '表脚注') => {
    const actual = labels[id]
    const expected = resolved.labels[id]
    if (!actual || !expected || actual.xmlId !== expected.xmlId || actual.label !== expected.label || actual.refText !== expected.refText) {
      throw new Error(`render: ${kind} "${id}" 的传入 labels 与 Resolver 不一致`)
    }
  }
  for (const footnote of bodyFootnotes) assertLabelMatch(footnote.id, '条文脚注')
  for (const table of collectDocumentTables(doc)) {
    for (const footnote of table.footnotes ?? []) {
      assertLabelMatch(footnote.id, '表脚注')
      // Validate the resolver's marker format before either renderer consumes it.
      orderTableFootnotes([footnote], labels)
    }
  }
  return orderBodyFootnotes(bodyFootnotes, labels)
}

export function documentHasFootnotes(doc: IRDoc, bodyFootnotes: IRFootnote[]): boolean {
  return bodyFootnotes.length > 0 || documentHasFootnoteSyntax(doc) ||
    doc.front.foreword.some(blockHasTableFootnotes) || doc.front.introduction.some(blockHasTableFootnotes) ||
    doc.body.some((chapter) => chapter.children.some(childHasTableFootnotes)) ||
    doc.appendices.some((appendix) => appendix.children.some(childHasTableFootnotes))
}

/** Compute the table's rendered grid width for its merged footnote cell. */
export function tableColumnCount(table: IRTable): number {
  return Math.max(1, ...table.rows.map((row) => row.cells.reduce((sum, cell) => sum + Math.max(1, cell.colspan), 0)))
}
