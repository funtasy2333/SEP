/**
 * DOCX 大纲快照（docs/wp7-docx-delivery.md §10.2 helpers/outline.ts）。
 *
 * `docxOutline(pkg)` 按 `word/document.xml` 顺序把每个段落写成一行：`样式ID │ 编号 │ 文本`。
 * - 样式ID：段落 `pPr/pStyle` 的 `w:val`；没有 `pStyle` 写 "—"。
 * - 编号：WP7.1 写 `numId:ilvl`（取自段落级 `pPr/numPr`）；没有 `numPr` 写 "—"。
 *   WP7.2 起编号栏改用 §4.7 模拟器算出的标识（不在本文件改动范围）。
 * - 文本：`w:t` 原文；`w:br` 记为 "⏎"；`w:tab` 记为 "⇥"；公式（`m:oMath`/`m:oMathPara`）
 *   记为 "〔公式〕"；图片（`w:r` 内的 `w:drawing`）记为 "〔图〕"。
 * - 表格内的段落（`w:tbl` > `w:tr` > `w:tc` > `w:p`）整行前面加 "┆"。
 * - 每个 `w:sectPr` 单独一行，紧跟在它所结束那一节的末段之后（含 body 末尾、不属于任何
 *   段落的最后一节 sectPr）：`§ type=… pgNumType=… orient=…`；属性缺失同样写 "—"。
 *
 * 这是测试代码（属于 shared 测试基建），配合 `toMatchSnapshot()` 固化，不从任何 index.ts
 * 导出，同样不得使用 Node 或浏览器专有 API。
 */

import type { DocxPackage } from '../../types'
import { parseXml, type XmlElement, type XmlNode } from './xmlTree'

/** 导出供 numberingSim.ts 复用（§4.7 模拟器的 text 提取规则与大纲相同，见该文件顶部注释） */
export function findChild(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === 'element' && c.name === name)
}

function textOf(el: XmlElement): string {
  let out = ''
  for (const c of el.children) if (c.kind === 'text') out += c.text
  return out
}

function formatSectPr(sect: XmlElement): string {
  const type = findChild(sect, 'w:type')?.attrs['w:val'] ?? '—'
  const pgNumType = findChild(sect, 'w:pgNumType')?.attrs['w:fmt'] ?? '—'
  const orient = findChild(sect, 'w:pgSz')?.attrs['w:orient'] ?? '—'
  return `§ type=${type} pgNumType=${pgNumType} orient=${orient}`
}

function extractRunText(r: XmlElement): string {
  let out = ''
  for (const child of r.children) {
    if (child.kind === 'text') {
      out += child.text
      continue
    }
    if (child.name === 'w:t') out += textOf(child)
    else if (child.name === 'w:br') out += '⏎'
    else if (child.name === 'w:tab') out += '⇥'
    else if (child.name === 'w:drawing') out += '〔图〕'
    // 其余（rPr、fldChar、instrText…）不影响大纲文本，忽略
  }
  return out
}

/** 导出供 numberingSim.ts 复用：§4.7 模拟器的 text 列提取规则与大纲相同 */
export function extractParagraphText(p: XmlElement): string {
  let out = ''
  for (const child of p.children) {
    if (child.kind !== 'element') continue
    if (child.name === 'w:pPr') continue
    if (child.name === 'w:r') out += extractRunText(child)
    else if (child.name === 'm:oMath' || child.name === 'm:oMathPara') out += '〔公式〕'
  }
  return out
}

function formatParagraphLine(p: XmlElement, inTable: boolean): string {
  const pPr = findChild(p, 'w:pPr')
  const style = (pPr && findChild(pPr, 'w:pStyle')?.attrs['w:val']) ?? '—'
  const numPr = pPr && findChild(pPr, 'w:numPr')
  const numbering = numPr
    ? `${findChild(numPr, 'w:numId')?.attrs['w:val'] ?? '?'}:${findChild(numPr, 'w:ilvl')?.attrs['w:val'] ?? '0'}`
    : '—'
  const text = extractParagraphText(p)
  return `${inTable ? '┆' : ''}${style} │ ${numbering} │ ${text}`
}

function walkBody(nodes: readonly XmlNode[], inTable: boolean, lines: string[]): void {
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    if (node.name === 'w:p') {
      lines.push(formatParagraphLine(node, inTable))
      const pPr = findChild(node, 'w:pPr')
      const sectPrInP = pPr && findChild(pPr, 'w:sectPr')
      if (sectPrInP) lines.push(formatSectPr(sectPrInP))
    } else if (node.name === 'w:tbl') {
      walkTable(node, lines)
    } else if (node.name === 'w:sectPr') {
      // body 直接子元素的 sectPr：最后一节，写在 body 末尾（见 §2.2）
      lines.push(formatSectPr(node))
    }
  }
}

function walkTable(tbl: XmlElement, lines: string[]): void {
  for (const row of tbl.children) {
    if (row.kind !== 'element' || row.name !== 'w:tr') continue
    for (const cell of row.children) {
      if (cell.kind !== 'element' || cell.name !== 'w:tc') continue
      walkBody(cell.children, true, lines)
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
  const lines: string[] = []
  walkBody(body.children, false, lines)
  return lines.join('\n')
}
