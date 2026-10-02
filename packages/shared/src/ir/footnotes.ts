import type { IRBlock, IRClauseChild, IRDoc, IRFootnote, IRInline } from './types'

/** 原位条文脚注按前言→引言→正文→附录→文献顺序收集，不混入表脚注。 */
export function collectFootnotes(doc: IRDoc, bibliographyOrder?: string[]): IRFootnote[] {
  const out: IRFootnote[] = []
  const inlines = (runs: IRInline[]) => {
    for (const run of runs) if (run.footnote) out.push(run.footnote)
  }
  const block = (node: IRBlock): void => {
    switch (node.kind) {
      case 'paragraph': inlines(node.content); break
      case 'list': for (const item of node.items) item.content.forEach(block); break
      case 'note': case 'example': node.content.forEach(block); break
      case 'table':
        inlines(node.caption); inlines(node.captionEn ?? [])
        for (const row of node.rows) for (const cell of row.cells) cell.content.forEach(block)
        node.notes.forEach(block)
        break
      case 'figure': node.notes.forEach(block); inlines(node.caption); inlines(node.captionEn ?? []); break
      case 'formula': inlines(node.sourceInlines ?? []); for (const item of node.whereList) { inlines(item.term); inlines(item.definition) }; break
    }
  }
  const child = (node: IRClauseChild): void => {
    if (node.kind === 'clause') { inlines(node.title); node.children.forEach(child) }
    else if (node.kind === 'termEntry') {
      inlines(node.term); inlines(node.termEn ?? [])
      node.definition.forEach(block); node.examples.forEach(block); node.notes.forEach(block)
      inlines(node.source ?? [])
    } else block(node)
  }
  doc.front.foreword.forEach(block); doc.front.introduction.forEach(block)
  for (const chapter of doc.body) { inlines(chapter.title); chapter.children.forEach(child) }
  for (const appendix of doc.appendices) { inlines(appendix.title); appendix.children.forEach(child) }
  for (const entry of bibliographyOrder ? bibliographyOrder.map(id => doc.bibliography.find(entry => entry.id === id)!).filter(Boolean) : doc.bibliography) inlines(entry.content)
  return out
}
