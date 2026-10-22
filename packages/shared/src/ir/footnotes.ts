import type { IRBlock, IRClauseChild, IRDoc, IRFootnote, IRInline } from './types'

/** 原位条文脚注按前言→引言→正文→附录→文献顺序收集，不混入表脚注。 */
export function collectFootnotes(doc: IRDoc, bibliographyOrder?: string[]): IRFootnote[] {
  const out: IRFootnote[] = []
  const represented = new WeakSet<IRInline>()
  const inlines = (runs: IRInline[]) => {
    for (const run of runs) { represented.add(run); if (run.footnote) out.push(run.footnote) }
  }
  const block = (node: IRBlock): void => {
    switch (node.kind) {
      case 'paragraph': inlines(node.content); break
      case 'list': for (const item of node.items) item.content.forEach(block); break
      case 'note': case 'example': case 'warning': case 'quote': node.content.forEach(block); break
      case 'code': break
      case 'table':
        inlines(node.caption); inlines(node.captionEn ?? [])
        for (const row of node.rows) for (const cell of row.cells) cell.content.forEach(block)
        node.notes.forEach(block)
        break
      case 'figure': node.notes.forEach(block); inlines(node.caption); inlines(node.captionEn ?? []); break
      case 'formula': inlines(node.sourceInlines ?? []); for (const item of node.whereList) { inlines(item.term); inlines(item.definition) }; break
      case 'defList': for (const item of node.items) { inlines(item.term); inlines(item.definition) }; break
    }
  }
  const child = (node: IRClauseChild): void => {
    if (node.kind === 'clause') { inlines(node.title); node.children.forEach(child) }
    else if (node.kind === 'termEntry') {
      inlines(node.term); inlines(node.termEn ?? []); inlines(node.subjectField ?? [])
      node.definition.forEach(block); node.examples.forEach(block); node.notes.forEach(block)
      inlines(node.source ?? [])
    } else block(node)
  }
  for (const source of doc.unmappedFootnotes ?? []) inlines(source.content)
  doc.front.foreword.forEach(block); doc.front.introduction.forEach(block); (doc.front.introductionClauses ?? []).forEach(child)
  for (const chapter of doc.body) { inlines(chapter.title); chapter.children.forEach(child) }
  for (const appendix of doc.appendices) { inlines(appendix.title); appendix.children.forEach(child) }
  const extras = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(extras); return }
    const row = value as Record<string, unknown>
    if (typeof row.text === 'string' && !row.kind && !represented.has(row as unknown as IRInline)) inlines([row as unknown as IRInline])
    for (const [key, child] of Object.entries(row)) {
      if (key !== 'footnote' && key !== 'unmappedFootnotes' && key !== 'unsupportedContent' && !(row.kind === 'bibEntry' && key === 'content')) extras(child)
    }
  }
  extras(doc)
  for (const entry of bibliographyOrder ? bibliographyOrder.map(id => doc.bibliography.find(entry => entry.id === id)!).filter(Boolean) : doc.bibliography) inlines(entry.content)
  return out
}
