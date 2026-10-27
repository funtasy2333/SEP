/**
 * WP8.M M-Z-d B（D-M-17）：Resolver 的列项标记与 HTML / DOCX 实际渲染的标识一致；无标识的列项不可被引用。
 *
 * 渲染事实（本文件逐条断言，作为 Resolver 规则的依据）：
 * - HTML screen / print：嵌套（第二层）的 alpha / roman 由 `.ses-list .ses-list:not(.ses-list-number) > .ses-list-item::before`
 *   显示为间隔号“·”；嵌套 number 仍是计数器 `1） 2）`（每个 `.ses-list` 各自 `counter-reset`）。
 * - DOCX：嵌套 number → 另起 A13 实例，ilvl 0（decimal `%1）`）；嵌套 alpha / roman → 父列表实例的 ilvl 1（A12 / A13 / A14 的
 *   ilvl 1 都是 bullet“·”）；dash 父列表下 → 新建 A12 实例、ilvl 1（bullet“·”）；第三层及以下只有 SesListDot，没有编号。
 * 引用无标识列项时：Resolver 报 dangling-xref（error，“没有编号”），两种渲染器回退作者原文，不输出任何新增标识；
 * 该问题不属于输出边界（与无序列项一致，M-Z-a 的口径：只有 unsupported-content 与 dangling-typed-ref 等阻断非 JSON 出口）。
 */

import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import type { IRDoc } from '../../ir/types'
import { nestedListDoc, xref } from '../../ir/__tests__/wp8mZdBFixtures'
import { renderDocxTraced } from '../docx/render'
import { renderHtml } from '../html'
import { getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'
import { printCss } from '../printCss'

const DOCX_OPTIONS = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-26T00:00:00.000Z' }
const FORMATS: readonly OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']

function html(doc: IRDoc, variant: 'screen' | 'print'): string {
  return renderHtml(doc, resolve(doc).labels, { variant })
}

function docxParts(doc: IRDoc): Record<string, string> {
  return renderDocxTraced(doc, resolve(doc).labels, DOCX_OPTIONS).pkg.parts
}

interface ListParagraph { style: string; numId?: string; ilvl?: string; text: string }

/** 列项段落（样式以 SesList 开头）：样式、numId、ilvl 与文字。 */
function listParagraphs(documentXml: string): ListParagraph[] {
  const out: ListParagraph[] = []
  for (const paragraph of documentXml.match(/<w:p>.*?<\/w:p>|<w:p [^>]*>.*?<\/w:p>/gs) ?? []) {
    const style = /w:pStyle w:val="([^"]+)"/.exec(paragraph)?.[1]
    if (!style?.startsWith('SesList') || style.startsWith('SesListCont')) continue
    out.push({
      style,
      numId: /w:numId w:val="(\d+)"/.exec(paragraph)?.[1],
      ilvl: /w:ilvl w:val="(\d+)"/.exec(paragraph)?.[1],
      text: [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(match => match[1]).join(''),
    })
  }
  return out
}

/** numbering.xml 中某个 abstractNum 的某一级：numFmt 与 lvlText。 */
function abstractLevel(numberingXml: string, abstractNumId: number, ilvl: number): { numFmt?: string; lvlText?: string } {
  const start = numberingXml.indexOf(`<w:abstractNum w:abstractNumId="${abstractNumId}"`)
  const block = numberingXml.slice(start, numberingXml.indexOf('</w:abstractNum>', start))
  const level = new RegExp(`<w:lvl w:ilvl="${ilvl}">(.*?)</w:lvl>`, 's').exec(block)?.[1] ?? ''
  return { numFmt: /w:numFmt w:val="([^"]+)"/.exec(level)?.[1], lvlText: /w:lvlText w:val="([^"]+)"/.exec(level)?.[1] }
}

/** numId → abstractNumId。 */
function abstractOf(numberingXml: string, numId: string): number {
  return Number(new RegExp(`<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"/>`).exec(numberingXml)![1])
}

describe('[M-Z-d B] HTML：嵌套列表的实际标识与 Resolver 一致', () => {
  const doc = nestedListDoc()

  it('screen 与 print 的样式：嵌套的非 number 列项显示间隔号，嵌套 number 保留计数器', () => {
    const rule = '.ses-list .ses-list:not(.ses-list-number) > .ses-list-item::before { content: "·"; counter-increment: none; }'
    expect(html(doc, 'screen')).toContain(rule)
    expect(printCss()).toContain(rule)
    for (const css of [html(doc, 'screen'), printCss()]) {
      expect(css).toContain('.ses-list-number > .ses-list-item::before { content: counter(ses-li) "） "; }')
      expect(css).toMatch(/\.ses-list \{[^}]*counter-reset: ses-li;/)
    }
  })

  it('结构：嵌套列表是 .ses-list-item 内的 .ses-list（样式规则的“后代”前提成立）', () => {
    const out = html(doc, 'screen')
    expect(out).toMatch(/<div class="ses-list-item" data-node-id="n1">\s*<span class="ses-list-item-text">壹<\/span>\s*<div class="ses-list ses-list-roman"/)
    expect(out).toMatch(/<div class="ses-list-item" data-node-id="n3">\s*<span class="ses-list-item-text">叁<\/span>\s*<div class="ses-list ses-list-number"/)
  })

  it.each(['screen', 'print'] as const)('%s：引用嵌套 roman / dash 内 alpha 回退作者原文，不生成链接与 id；引用嵌套 number 输出 refText', variant => {
    const withRefs = nestedListDoc([xref('nr2', 'listItem', '见罗马项'), xref('da2', 'listItem', '见破折下字母项'), xref('nn2', 'listItem', '见数字项')])
    const out = html(withRefs, variant)
    expect(out).toContain('<span class="ses-xref" data-ref-target="nr2">见罗马项</span>')
    expect(out).toContain('<span class="ses-xref" data-ref-target="da2">见破折下字母项</span>')
    expect(out).toContain('<div class="ses-list-item" data-node-id="nr2">')
    expect(out).toContain('<div class="ses-list-item" data-node-id="da2">')
    expect(out).not.toMatch(/data-node-id="(nr2|da2)" id=/)
    // 样式表里的注释可能含“i）”，只检查正文
    const body = out.slice(out.indexOf('<body'))
    expect(body).not.toMatch(/\b(i|ii|iii|b)）/)
    expect(out).toContain(variant === 'screen'
      ? '<a class="ses-xref" href="#li_1" data-ref-target="nn2">1.1 3） 2）</a>'
      : '<span class="ses-xref" data-ref-target="nn2">1.1 3） 2）</span>')
    expect(out).toContain('<div class="ses-list-item" data-node-id="nn2" id="li_1">')
    expect(out.match(/ id="li_\d+"/g)).toHaveLength(1)
  })

  it('没有任何引用时输出与是否含嵌套列表无关：不含 li_', () => {
    for (const variant of ['screen', 'print'] as const) expect(html(nestedListDoc(), variant)).not.toContain('li_')
  })
})

describe('[M-Z-d B] DOCX：嵌套列表的实际标识与 Resolver 一致', () => {
  const parts = docxParts(nestedListDoc())
  const paragraphs = listParagraphs(parts['word/document.xml']!)
  const numbering = parts['word/numbering.xml']!
  const byText = (text: string): ListParagraph => {
    const found = paragraphs.filter(paragraph => paragraph.text === text)
    expect(found, text).toHaveLength(1)
    return found[0]!
  }
  /** 嵌套项的文字是“id + 文”，按 id 取其列项段落。 */
  const at = (id: string): ListParagraph => byText(`${id}文`)

  it('number 内嵌 number：另起 A13 实例（abstractNum 13）的 ilvl 0，decimal `%1）`——与 Resolver 的 1） 2） 一致', () => {
    const nested = [at('nn1'), at('nn2')]
    const parent = byText('叁')
    expect(nested.map(paragraph => paragraph.ilvl)).toEqual(['0', '0'])
    expect(nested[0]!.numId).toBe(nested[1]!.numId)
    expect(nested[0]!.numId).not.toBe(parent.numId)
    const level = abstractLevel(numbering, abstractOf(numbering, nested[0]!.numId!), 0)
    expect(level).toEqual({ numFmt: 'decimal', lvlText: '%1）' })
  })

  it('number 内嵌 roman / alpha：沿用父列表实例的 ilvl 1，该级是 bullet“·”，不是 i） / a）', () => {
    for (const id of ['nr1', 'nr2', 'nr3', 'na1', 'na2']) {
      const paragraph = at(id)
      expect(paragraph.ilvl, id).toBe('1')
      expect(paragraph.numId, id).toBe(byText('壹').numId)
    }
    expect(abstractLevel(numbering, abstractOf(numbering, byText('壹').numId!), 1)).toEqual({ numFmt: 'bullet', lvlText: '·' })
  })

  it('dash 内嵌 alpha / roman：新建 A12 实例、ilvl 1（bullet“·”）；dash 内嵌 number：A13 的 ilvl 0（1） 2））', () => {
    for (const id of ['da1', 'da2', 'dr1', 'dr2']) {
      const paragraph = at(id)
      expect(paragraph.ilvl, id).toBe('1')
      expect(abstractOf(numbering, paragraph.numId!), id).toBe(12)
      expect(abstractLevel(numbering, 12, 1), id).toEqual({ numFmt: 'bullet', lvlText: '·' })
    }
    // 三个 dash 子列表各自一个新实例
    expect(new Set(['da1', 'dr1', 'dn1'].map(id => at(id).numId)).size).toBe(3)
    for (const id of ['dn1', 'dn2']) {
      const paragraph = at(id)
      expect(paragraph.ilvl, id).toBe('0')
      expect(abstractLevel(numbering, abstractOf(numbering, paragraph.numId!), 0), id).toEqual({ numFmt: 'decimal', lvlText: '%1）' })
    }
  })

  it('alpha 内嵌 number / alpha、roman 内嵌 roman：number 另起 A13 实例的 ilvl 0；alpha / roman 沿用父实例 ilvl 1（bullet）', () => {
    expect(at('an1')).toMatchObject({ ilvl: '0' })
    expect(abstractOf(numbering, at('an1').numId!)).toBe(13)
    expect(at('an1').numId).not.toBe(byText('甲').numId)
    for (const id of ['aa1', 'aa2']) expect(at(id), id).toMatchObject({ ilvl: '1', numId: byText('乙').numId })
    for (const id of ['rr1', 'rr2']) expect(at(id), id).toMatchObject({ ilvl: '1', numId: byText('Ⅰ').numId })
    expect(abstractLevel(numbering, abstractOf(numbering, byText('Ⅰ').numId!), 1)).toEqual({ numFmt: 'bullet', lvlText: '·' })
  })

  it('第三层 number：只有 SesListDot，没有 numPr（所以 Resolver 不给第三层赋标记）', () => {
    for (const id of ['dp1', 'dp2']) expect(at(id), id).toMatchObject({ style: 'SesListDot', numId: undefined, ilvl: undefined })
  })

  it('第一层 alpha / number / roman 仍是各自实例的 ilvl 0（A12 lowerLetter、A13 decimal、A14 lowerRoman）', () => {
    for (const [text, abstractId, numFmt] of [['甲', 12, 'lowerLetter'], ['壹', 13, 'decimal'], ['Ⅰ', 14, 'lowerRoman']] as const) {
      const paragraph = byText(text)
      expect(paragraph.ilvl, text).toBe('0')
      expect(abstractOf(numbering, paragraph.numId!), text).toBe(abstractId)
      expect(abstractLevel(numbering, abstractId, 0), text).toEqual({ numFmt, lvlText: '%1）' })
    }
  })

  it('引用嵌套 roman / dash 内 alpha：回退作者原文；引用嵌套 number 输出 refText；不新增书签', () => {
    const baseline = docxParts(nestedListDoc())['word/document.xml']!
    const withRefs = nestedListDoc([xref('nr2', 'listItem', '见罗马项'), xref('da2', 'listItem', '见破折下字母项'), xref('nn2', 'listItem', '见数字项')])
    const xml = docxParts(withRefs)['word/document.xml']!
    expect(xml).toContain('见罗马项')
    expect(xml).toContain('见破折下字母项')
    expect(xml).not.toContain('见数字项')
    expect(xml).toContain('<w:t xml:space="preserve">1.1 3） 2）</w:t>')
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*\bi{1,3}）/)
    expect(xml).not.toContain('li_')
    expect(xml.match(/<w:bookmarkStart /g)?.length ?? 0).toBe(baseline.match(/<w:bookmarkStart /g)?.length ?? 0)
  })
})

describe('[M-Z-d B] 报告与导出：引用无标识列项的最终问题码与是否阻断', () => {
  const refs = [xref('nr2', 'listItem'), xref('na1', 'listItem'), xref('da2', 'listItem'), xref('dr1', 'listItem'), xref('dp2', 'listItem')]

  it('Resolver 对每一处报 dangling-xref（error，“没有编号，无法生成引用文本”），与引用无序列项相同', () => {
    const problems = resolve(nestedListDoc(refs)).problems
    expect(problems.map(problem => [problem.code, problem.severity])).toEqual(Array(5).fill(['dangling-xref', 'error']))
    expect(problems.map(problem => problem.message)).toEqual(
      ['nr2', 'na1', 'da2', 'dr1', 'dp2'].map(id => `交叉引用的目标「${id}」没有编号，无法生成引用文本`))
    // 引用无序列项（G4 既有行为）：同码同级
    const unordered = resolve(nestedListDoc([xref('d1', 'listItem')])).problems
    expect(unordered.map(problem => [problem.code, problem.severity])).toEqual([['dangling-xref', 'error']])
  })

  it.each(FORMATS)('%s：输出边界不因此阻断（与无序列项同口径，不新增 unsupported-output），渲染回退作者原文', format => {
    const withRefs = getOutputSupportProblems(nestedListDoc(refs), format)
    const without = getOutputSupportProblems(nestedListDoc(), format)
    expect(withRefs).toEqual(without)
  })

  it('HTML / DOCX 渲染不抛错，且输出里没有任何不存在的嵌套标识（嵌套的 i） / b） 等只来自作者原文时才会出现）', () => {
    const doc = nestedListDoc(refs.map((ref, index) => ({ ...ref, text: `原文${index}` })))
    for (const variant of ['screen', 'print'] as const) {
      const out = html(doc, variant)
      for (let index = 0; index < refs.length; index += 1) expect(out).toContain(`原文${index}`)
    }
    const xml = docxParts(doc)['word/document.xml']!
    for (let index = 0; index < refs.length; index += 1) expect(xml).toContain(`原文${index}`)
  })
})
