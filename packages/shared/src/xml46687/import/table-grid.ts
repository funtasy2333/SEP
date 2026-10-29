import { getXmlAttr, isXmlElement } from '../tree'
import type { XmlDocument, XmlElement } from '../tree'
import { location } from './context'
import type { ImportProblem } from './contracts'

const children = (el: XmlElement, name: string) => el.children.filter(isXmlElement).filter(c => c.name.ns === null && c.name.local === name)
interface Span { start: number; end: number; until: number }
export function validateTableGrids(tree: XmlDocument, maxWork = 4_000_000): ImportProblem[] {
  const problems: ImportProblem[] = []
  let remaining = maxWork, exhausted = false
  const spend = (amount: number, el: XmlElement): boolean => {
    remaining -= amount
    if (remaining >= 0) return true
    if (!exhausted) problems.push({code:'xml-limit', severity:'error', message:'表格网格校验超过计算限额', xml:location(el), detail:{rule:'TABLE-GRID-LIMIT', maxWork}})
    exhausted = true
    return false
  }
  const issue = (el: XmlElement, message: string) => problems.push({ code: 'xml-content-model', severity: 'error', message, xml: location(el), detail: {rule: 'TABLE-GRID'} })
  const table = (el: XmlElement) => {
    if (!spend(el.children.length + 1, el)) return
    const directCols = children(el, 'col').length
    const groups = children(el, 'colgroup')
    const columns = directCols + groups.reduce((n, g) => n + Math.max(1, children(g, 'col').length), 0)
    let width: number | undefined = columns || undefined
    for (const group of el.children.filter(isXmlElement).filter(e => e.name.ns === null && ['thead', 'tbody'].includes(e.name.local))) {
      const rows = children(group, 'tr')
      let spans: Span[] = []
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        if (!spend(spans.length + rows[rowIndex].children.length + 1, rows[rowIndex])) return
        spans = spans.filter(s => s.until > rowIndex)
        let column = 0, rowWidth = spans.reduce((max, s) => Math.max(max, s.end), 0)
        const coverage = spans.map(s => ({ start: s.start, end: s.end }))
        for (const cell of rows[rowIndex].children.filter(isXmlElement).filter(c => c.name.ns === null && ['td', 'th'].includes(c.name.local))) {
          const number = (name: string) => {
            const value = getXmlAttr(cell, null, name)
            if (value === undefined) return 1
            if (!/^\d+$/.test(value)) return 0
            const result = Number(value)
            return Number.isSafeInteger(result) && result > 0 ? result : 0
          }
          const colspan = number('colspan'), rowspan = number('rowspan')
          if (!colspan || !rowspan || rowIndex + rowspan > rows.length) { issue(cell, '单元格跨度无效或超出所在行组'); continue }
          if (!spend(spans.length + 1, cell)) return
          let occupying = spans.find(s => s.start <= column && column < s.end)
          while (occupying) {
            if (!spend(spans.length + 1, cell)) return
            column = occupying.end; occupying = spans.find(s => s.start <= column && column < s.end)
          }
          const end = column + colspan
          if (!spend(spans.length + 1, cell)) return
          if (!Number.isSafeInteger(end) || spans.some(s => s.start < end && s.end > column)) issue(cell, '单元格跨度与其他单元格重叠')
          coverage.push({start: column, end})
          if (rowspan > 1) spans.push({start: column, end, until: rowIndex + rowspan})
          column = end; rowWidth = Math.max(rowWidth, end)
        }
        if (!spend(coverage.length * Math.max(1, Math.ceil(Math.log2(coverage.length + 1))), rows[rowIndex])) return
        let covered = 0
        for (const part of coverage.sort((a, b) => a.start - b.start)) {
          if (part.start > covered) issue(rows[rowIndex], '表格网格存在空洞')
          covered = Math.max(covered, part.end)
        }
        if (width === undefined) width = rowWidth
        else if (rowWidth !== width) issue(rows[rowIndex], '表格行宽与列声明或其他行不一致')
      }
    }
  }
  const visit = (el: XmlElement) => {
    if (exhausted || !spend(1, el)) return
    if (el.name.ns === null && el.name.local === 'table') table(el)
    for (const c of el.children) if (isXmlElement(c)) visit(c)
  }
  visit(tree.root)
  return problems
}
