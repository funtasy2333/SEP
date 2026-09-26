/**
 * DOCX 大纲快照（docs/wp7-docx-delivery.md §10.2 helpers/outline.ts）。
 *
 * `docxOutline(pkg)` 按 `word/document.xml` 顺序把每个段落写成一行：`样式ID │ 编号 │ 文本`。
 * - 样式ID：段落 `pPr/pStyle` 的 `w:val`；没有 `pStyle` 写 "—"。
 * - 编号：WP7.2 起改用 §4.7 模拟器（numberingSim.ts）算出的 label，去掉末尾一个 U+3000；
 *   无编号写 "—"。
 * - 文本：规则见 paragraphText.ts（`w:t` 原文；`w:br`⏎；`w:tab`⇥；公式〔公式〕；图片〔图〕）。
 * - 表格内的段落（`w:tbl` > `w:tr` > `w:tc` > `w:p`）整行前面加 "┆"。
 * - 每个 `w:sectPr` 单独一行，紧跟在它所结束那一节的末段之后：WP7.2 起格式为
 *   `§ type=… pgNumType=… start=… orient=… refs=…`：`start` 为 `pgNumType` 的 `w:start`，
 *   `refs` 为 headerReference 与 footerReference 的个数（含 0），缺失的属性写 "—"。
 *
 * 这是测试代码（属于 shared 测试基建），配合 `toMatchSnapshot()` 固化，不从任何 index.ts
 * 导出，同样不得使用 Node 或浏览器专有 API。
 */

import type { DocxPackage } from '../../types'
import { simulateNumbering, type SimParagraph } from './numberingSim'
import { extractParagraphText } from './paragraphText'
import { findChild, parseXml, type XmlElement, type XmlNode } from './xmlTree'

function formatSectPr(sect: XmlElement): string {
  const type = findChild(sect, 'w:type')?.attrs['w:val'] ?? '—'
  const pgNumTypeEl = findChild(sect, 'w:pgNumType')
  const pgNumType = pgNumTypeEl?.attrs['w:fmt'] ?? '—'
  const start = pgNumTypeEl?.attrs['w:start'] ?? '—'
  const orient = findChild(sect, 'w:pgSz')?.attrs['w:orient'] ?? '—'
  const refs = sect.children.filter(
    (c): c is XmlElement => c.kind === 'element' && (c.name === 'w:headerReference' || c.name === 'w:footerReference'),
  ).length
  return `§ type=${type} pgNumType=${pgNumType} start=${start} orient=${orient} refs=${refs}`
}

/** 模拟器 label 去掉末尾一个 U+3000（§10.2）；无编号（undefined）写 "—" */
function numberingColumn(sim: SimParagraph): string {
  return sim.label !== undefined ? sim.label.replace(/　$/, '') : '—'
}

function formatParagraphLine(p: XmlElement, inTable: boolean, sim: SimParagraph): string {
  const pPr = findChild(p, 'w:pPr')
  const style = (pPr && findChild(pPr, 'w:pStyle')?.attrs['w:val']) ?? '—'
  const text = extractParagraphText(p)
  return `${inTable ? '┆' : ''}${style} │ ${numberingColumn(sim)} │ ${text}`
}

/** 按与 numberingSim.ts 完全相同的顺序消费 simulated 数组：文档顺序深度优先，含表格单元格 */
function walkBody(nodes: readonly XmlNode[], inTable: boolean, lines: string[], simulated: readonly SimParagraph[], nextIndex: () => number): void {
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    if (node.name === 'w:p') {
      const sim = simulated[nextIndex()]
      lines.push(formatParagraphLine(node, inTable, sim))
      const pPr = findChild(node, 'w:pPr')
      const sectPrInP = pPr && findChild(pPr, 'w:sectPr')
      if (sectPrInP) lines.push(formatSectPr(sectPrInP))
    } else if (node.name === 'w:tbl') {
      walkTable(node, lines, simulated, nextIndex)
    } else if (node.name === 'w:sectPr') {
      // body 直接子元素的 sectPr：最后一节，写在 body 末尾（见 §2.2）
      lines.push(formatSectPr(node))
    }
  }
}

function walkTable(tbl: XmlElement, lines: string[], simulated: readonly SimParagraph[], nextIndex: () => number): void {
  for (const row of tbl.children) {
    if (row.kind !== 'element' || row.name !== 'w:tr') continue
    for (const cell of row.children) {
      if (cell.kind !== 'element' || cell.name !== 'w:tc') continue
      walkBody(cell.children, true, lines, simulated, nextIndex)
    }
  }
}

/** 按 word/document.xml 顺序生成大纲文本，每段一行，配合 toMatchSnapshot() 使用 */
export function docxOutline(pkg: DocxPackage): string {
  const documentXml = pkg.parts['word/document.xml']
  if (documentXml === undefined) throw new Error('docxOutline: 包内没有 word/document.xml')
  const doc = parseXml(documentXml)
  const body = findChild(doc, 'w:body')
  if (!body) throw new Error('docxOutline: word/document.xml 缺少 w:body')

  // simulateNumbering 按同样的「文档顺序深度优先、含表格单元格」规则遍历，因此可以用一个
  // 递增下标把两次独立的遍历结果一一对应起来。
  const simulated = simulateNumbering(pkg)
  let i = 0
  const lines: string[] = []
  walkBody(body.children, false, lines, simulated, () => i++)
  return lines.join('\n')
}
