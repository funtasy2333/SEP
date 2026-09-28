/**
 * sections.ts 单元测试（docs/wp7-docx-delivery.md §9 WP7.2「测试」sections 一项）。
 *
 * 有无前言、引言、附录、参考文献的各种组合下的节序、type、pgNumType、页眉页脚引用个数
 * （用大纲的 § 行断言）；页眉页脚部件的内容。
 */

import { describe, expect, it } from 'vitest'
import { buildHeaderFooterParts, createSectionManager, sectionPropsFor, type HeaderFooterRelIds, type SectionKind } from './sections'
import type { DocxPackage } from './types'
import { docxOutline } from './__tests__/helpers/outline'
import { findChild, parseXml } from './__tests__/helpers/xmlTree'

const REL_IDS: HeaderFooterRelIds = { header1: 'rId1', header2: 'rId2', footer1: 'rId3', footer2: 'rId4' }

function plainParagraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

function pkgFromBody(bodyXml: string): DocxPackage {
  // 分节的 sectPr 里写了 headerReference/footerReference 的 r:id，document.xml 根元素必须声明 xmlns:r
  const documentXml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${bodyXml}</w:body></w:document>`
  return { parts: { 'word/document.xml': documentXml }, binaries: {}, warnings: [] }
}

/** 依次经历 kinds 指定的节，每节放一段内容，模拟 render.ts 的用法 */
function buildDocument(kinds: SectionKind[]): DocxPackage {
  const mgr = createSectionManager(REL_IDS)
  let body = ''
  for (const kind of kinds) {
    body += mgr.startSection(kind)
    body += plainParagraph(`content of ${kind}`)
  }
  body += mgr.finalSectPr()
  return pkgFromBody(body)
}

function sectionLines(pkg: DocxPackage): string[] {
  return docxOutline(pkg)
    .split('\n')
    .filter((l) => l.startsWith('§'))
}

/** 用 sectionPropsFor（sections.ts 本身导出的表）推导期望的 § 行，用于覆盖多种组合而不必每种都手写全部字段 */
function expectedLine(kind: SectionKind): string {
  const props = sectionPropsFor(kind)
  const pgNumType = props.pgNumType?.fmt ?? '—'
  const start = props.pgNumType?.start ? '1' : '—'
  const refs = props.withHeaderFooter ? 4 : 0
  return `§ type=${props.type} pgNumType=${pgNumType} start=${start} orient=— refs=${refs}`
}

describe('sections.ts：createSectionManager 节序（§2.2）', () => {
  it('全要素：封面/目次/前言/引言/正文/附录×2/参考文献——每节一条 § 行，顺序与内容一一对应', () => {
    const kinds: SectionKind[] = ['cover', 'toc', 'foreword', 'introduction', 'body', 'appendix', 'appendix', 'bibliography']
    const pkg = buildDocument(kinds)
    expect(sectionLines(pkg)).toEqual(kinds.map(expectedLine))
  })

  it('全要素的 § 行逐字面值核对（不经 expectedLine 推导，避免自证）', () => {
    const kinds: SectionKind[] = ['cover', 'toc', 'foreword', 'introduction', 'body', 'appendix', 'bibliography']
    const pkg = buildDocument(kinds)
    expect(sectionLines(pkg)).toEqual([
      '§ type=nextPage pgNumType=— start=— orient=— refs=0', // 封面：不写 pgNumType，无页眉页脚引用
      '§ type=oddPage pgNumType=upperRoman start=1 orient=— refs=4', // 目次：罗马页码重起
      '§ type=nextPage pgNumType=upperRoman start=— orient=— refs=4', // 前言：续编，不重起
      '§ type=nextPage pgNumType=upperRoman start=— orient=— refs=4', // 引言：续编
      '§ type=oddPage pgNumType=decimal start=1 orient=— refs=4', // 正文：阿拉伯页码重起
      '§ type=nextPage pgNumType=decimal start=— orient=— refs=4', // 附录：续编
      '§ type=nextPage pgNumType=decimal start=— orient=— refs=4', // 参考文献：续编
    ])
  })

  it('无前言、无引言：目次直接接正文', () => {
    const kinds: SectionKind[] = ['cover', 'toc', 'body', 'appendix', 'bibliography']
    expect(sectionLines(buildDocument(kinds))).toEqual(kinds.map(expectedLine))
  })

  it('无附录、无参考文献：正文是最后一节', () => {
    const kinds: SectionKind[] = ['cover', 'toc', 'foreword', 'body']
    expect(sectionLines(buildDocument(kinds))).toEqual(kinds.map(expectedLine))
  })

  it('只有引言没有前言：目次 → 引言 → 正文', () => {
    const kinds: SectionKind[] = ['cover', 'toc', 'introduction', 'body']
    expect(sectionLines(buildDocument(kinds))).toEqual(kinds.map(expectedLine))
  })

  it('最简：封面 + 目次 + 正文（无前言引言附录参考文献）', () => {
    const kinds: SectionKind[] = ['cover', 'toc', 'body']
    expect(sectionLines(buildDocument(kinds))).toEqual(kinds.map(expectedLine))
  })

  it('三个附录：每个都是独立的 nextPage/decimal 续编节', () => {
    const kinds: SectionKind[] = ['cover', 'toc', 'body', 'appendix', 'appendix', 'appendix']
    const lines = sectionLines(buildDocument(kinds))
    expect(lines).toEqual(kinds.map(expectedLine))
    expect(lines.filter((l) => l.includes('type=nextPage pgNumType=decimal'))).toHaveLength(3)
  })

  it('非末节的 sectPr 写在单独的分节空段里（无 pStyle、无文字），最后一节的 sectPr 直接是 body 的子元素', () => {
    const kinds: SectionKind[] = ['cover', 'toc', 'body']
    const pkg = buildDocument(kinds)
    const doc = parseXml(pkg.parts['word/document.xml'])
    const body = findChild(doc, 'w:body')!
    // 直接子元素里最后一个应为裸 w:sectPr（不是 w:p）
    const last = body.children[body.children.length - 1]
    expect(last.kind === 'element' && last.name === 'w:sectPr').toBe(true)
    // 分节空段：word/document.xml 里应能找到「无 pStyle」的 w:p，其 pPr 只有 sectPr
    const outline = docxOutline(pkg)
    expect(outline).toContain('— │ — │\n§ type=nextPage') // 封面节结束：空段 + 紧跟的 § 行
  })

  it('finalSectPr() 在 startSection() 之前调用抛错', () => {
    const mgr = createSectionManager(REL_IDS)
    expect(() => mgr.finalSectPr()).toThrow()
  })
})

describe('sections.ts：buildHeaderFooterParts（§2.3 页眉页脚部件内容）', () => {
  const parts = buildHeaderFooterParts('GB/T 12345—2026')

  it('header1（单数页/default）：SesHeader 样式，右对齐，STYLEREF 域缓存 stdCode', () => {
    const hdr = parseXml(parts.header1)
    expect(hdr.name).toBe('w:hdr')
    const p = findChild(hdr, 'w:p')!
    const pPr = findChild(p, 'w:pPr')!
    expect(findChild(pPr, 'w:pStyle')?.attrs['w:val']).toBe('SesHeader')
    expect(findChild(pPr, 'w:jc')?.attrs['w:val']).toBe('right')
    // w:instrText 在 w:r 内、不是 w:p 的直接子元素，直接用文本检索核对域代码（元素文本内容里的
    // 双引号不需要转义，只有属性值才转义为 &quot;）：
    expect(parts.header1).toContain('STYLEREF "SES_封面文件编号" \\* MERGEFORMAT')
    expect(parts.header1).toContain('<w:t xml:space="preserve">GB/T 12345—2026</w:t>')
  })

  it('header2（双数页/even）：左对齐，域与 header1 相同', () => {
    const hdr = parseXml(parts.header2)
    const p = findChild(hdr, 'w:p')!
    const pPr = findChild(p, 'w:pPr')!
    expect(findChild(pPr, 'w:jc')?.attrs['w:val']).toBe('left')
    expect(parts.header2).toContain('STYLEREF "SES_封面文件编号" \\* MERGEFORMAT')
  })

  it('footer1（单数页）：SesFooter 样式，右对齐，ind right=227，PAGE 域缓存「1」', () => {
    const ftr = parseXml(parts.footer1)
    expect(ftr.name).toBe('w:ftr')
    const p = findChild(ftr, 'w:p')!
    const pPr = findChild(p, 'w:pPr')!
    expect(findChild(pPr, 'w:pStyle')?.attrs['w:val']).toBe('SesFooter')
    expect(findChild(pPr, 'w:ind')?.attrs['w:right']).toBe('227')
    expect(findChild(pPr, 'w:jc')?.attrs['w:val']).toBe('right')
    expect(parts.footer1).toContain('<w:instrText xml:space="preserve"> PAGE </w:instrText>')
    expect(parts.footer1).toContain('<w:t xml:space="preserve">1</w:t>')
  })

  it('footer2（双数页）：左对齐，ind left=227', () => {
    const ftr = parseXml(parts.footer2)
    const p = findChild(ftr, 'w:p')!
    const pPr = findChild(p, 'w:pPr')!
    expect(findChild(pPr, 'w:ind')?.attrs['w:left']).toBe('227')
    expect(findChild(pPr, 'w:jc')?.attrs['w:val']).toBe('left')
  })

  it('stdCode 缺失（空串）时 STYLEREF 缓存为空文本，不影响域结构', () => {
    const empty = buildHeaderFooterParts('')
    expect(empty.header1).toContain('<w:t xml:space="preserve"></w:t>')
  })

  it('根元素声明 w、r 两个前缀', () => {
    for (const xml of [parts.header1, parts.header2, parts.footer1, parts.footer2]) {
      expect(xml).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"')
      expect(xml).toContain('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
    }
  })
})
