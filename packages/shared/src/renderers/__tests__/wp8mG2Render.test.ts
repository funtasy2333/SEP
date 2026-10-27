/**
 * WP8.M G2 排版：缩略语表 defList（M-10.1.4-01/-03/-04/-05）与 abbreviation 引用（M-10.1.1-04），
 * HTML（screen/print）与 DOCX（设计 §7.1 本阶段排版）。
 *
 * 版式依据（已按原 PDF 图像核对）：
 * - GB/T 1.1-2020 8.8.3（印刷页 17，PDF 第 24 页）：清单中的符号和缩略语之前不给序号；本条没有给出缩略语行的版式示例，
 *   因此沿用 10.2 的条文段落式排版（段首空两个汉字起排，回行顶格）。
 * - GB/T 46687.2—2026 3.2 缩略语（印刷页 2，PDF 第 6 页）的实际排版：每条一行，缩略语在前、释义在后，起排位置与引导语
 *   “下列缩略语适用于本文件。”同为段首缩进，无序号、无破折号。
 * - 设计 §7.1 原定“释义前空一个汉字”，主导人审查后改按 46687.2 印刷页 2 的实排：缩略语与释义同行，中间是全角冒号“：”（U+FF1A），
 *   不加空格；冒号只在渲染时添加，IR 与 PM 中不存。
 */

import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import type { IRDefList, IRDoc } from '../../ir/types'
import { abbrRef, defItem, g2IrDoc, g2PmDoc } from '../../ir/__tests__/wp8mG2Fixtures'
import { renderDocx } from '../docx'
import { docxOutline } from '../docx/__tests__/helpers/outline'
import { assertChildOrder, assertWellFormed } from '../docx/__tests__/helpers/checks'
import { renderHtml } from '../html'

const DOCX_OPTIONS = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-22T00:00:00.000Z' }

function html(doc: IRDoc, variant: 'screen' | 'print'): string {
  return renderHtml(doc, resolve(doc).labels, { variant })
}

function docx(doc: IRDoc) {
  return renderDocx(doc, resolve(doc).labels, DOCX_OPTIONS)
}

/** 取出某个 defList 的 HTML 片段（容器 div 起，到与之配对的 </div>）。 */
function defListHtml(output: string, id: string): string {
  const start = output.indexOf(`<div class="ses-def-list" data-type="def-list" data-node-id="${id}">`)
  expect(start, id).toBeGreaterThanOrEqual(0)
  return output.slice(start, output.indexOf('</div>', start) + '</div>'.length)
}

const SEP = '：' // U+FF1A 全角冒号，只在渲染时添加

describe('[M-10.1.4-01] HTML：缩略语表的排法', () => {
  for (const variant of ['screen', 'print'] as const) {
    it(`${variant}：每项一段，缩略语在前、释义在后，中间是全角冒号（无空格）；锚点 id 取 abb_<k>`, () => {
      const fragment = defListHtml(html(g2IrDoc(), variant), 'g2-list')
      const xref = variant === 'screen'
        ? '<a class="ses-xref" href="#abb_1" data-ref-target="abb-adc">ADC</a>'
        : '<span class="ses-xref" data-ref-target="abb-adc">ADC</span>'
      expect(fragment).toBe([
        '<div class="ses-def-list" data-type="def-list" data-node-id="g2-list">',
        `<p class="ses-paragraph ses-def-item" data-type="def-item" data-node-id="abb-adc" id="abb_1"><span class="ses-def-term">ADC</span><span class="ses-def-sep">${SEP}</span><span class="ses-def-definition">模数转换器（Analog-to-Digital Converter）</span></p>`,
        `<p class="ses-paragraph ses-def-item" data-type="def-item" data-node-id="abb-agc" id="abb_2"><span class="ses-def-term">AGC</span><span class="ses-def-sep">${SEP}</span><span class="ses-def-definition">自动增益控制（Automatic Gain Control）</span></p>`,
        `<p class="ses-paragraph ses-def-item" data-type="def-item" data-node-id="abb-ct" id="abb_3"><span class="ses-def-term">CT</span><span class="ses-def-sep">${SEP}</span><span class="ses-def-definition">计算机断层扫描，参见${xref}<strong>与</strong>电流互感器</span></p>`,
        '</div>',
      ].join('\n'))
    })
  }

  it('排版沿用条文段落类 ses-paragraph（首行空两个汉字、回行顶格），不新增 CSS 规则', () => {
    for (const variant of ['screen', 'print'] as const) {
      const output = html(g2IrDoc(), variant)
      expect(output).toMatch(/\.ses-paragraph \{[^}]*text-indent: 2em/)
      expect(output).not.toMatch(/\.ses-def-(list|item|term|definition|gap)\s*[{,]/)
    }
  })

  it('不输出“式中：”引导、破折号或列表序号，不使用 dl/dt/dd（那是公式 whereList 的版式）', () => {
    const fragment = defListHtml(html(g2IrDoc(), 'print'), 'g2-list')
    expect(fragment).not.toMatch(/式中|——|<dl|<dt|<dd|<ol|<ul|<li/)
  })

  it('冒号是写成文字的全角“：”（复制与 PDF 取文可得），每项恰一个，缩略语与释义之间不再有空格', () => {
    const fragment = defListHtml(html(g2IrDoc(), 'print'), 'g2-list')
    expect(fragment.match(/<span class="ses-def-sep">：<\/span>/g)).toHaveLength(3)
    const text = fragment.replace(/<[^>]+>/g, '')
    expect(text.split('\n').filter(Boolean)).toEqual([
      `ADC${SEP}模数转换器（Analog-to-Digital Converter）`,
      `AGC${SEP}自动增益控制（Automatic Gain Control）`,
      `CT${SEP}计算机断层扫描，参见ADC与电流互感器`,
    ])
  })

  it('表前的引导语与表同属正文：引导语段落在前，缩略语表紧随其后；附录内同样输出', () => {
    const output = html(g2IrDoc(), 'print')
    expect(output.indexOf('下列缩略语适用于本文件。')).toBeLessThan(output.indexOf('data-node-id="g2-list"'))
    expect(defListHtml(output, 'g2-list-app')).toContain('<span class="ses-def-term">UTF-8</span>')
  })

  it('术语与释义的特殊字符被转义；术语内的行内格式保留', () => {
    const doc = g2IrDoc()
    ;(doc.body[2]!.children[1] as IRDefList).items[0] = defItem('abb-adc', [{ text: 'a<b' }, { text: '2', marks: [{ type: 'sup' }] }], 'x & "y"')
    const fragment = defListHtml(html(doc, 'print'), 'g2-list')
    expect(fragment).toContain('<span class="ses-def-term">a&lt;b<sup>2</sup></span>')
    expect(fragment).toContain('<span class="ses-def-definition">x &amp; "y"</span>')
  })

  it('渲染为纯函数；PM 往返后的 IR 输出与手写 IR 一致', () => {
    for (const variant of ['screen', 'print'] as const) {
      expect(html(g2IrDoc(), variant)).toBe(html(g2IrDoc(), variant))
      const fromPm = defListHtml(html(pmToIr(g2PmDoc()).doc, variant), 'g2-list')
      expect(fromPm).toBe(defListHtml(html(g2IrDoc(), variant), 'g2-list'))
    }
  })
})

describe('[M-10.1.1-04] HTML：abbreviation 引用输出 refText 并链接到项', () => {
  it('screen：内部链接指向 abb_<k>，文字为缩略语（作者原文被 refText 替换）', () => {
    const output = html(g2IrDoc(), 'screen')
    expect(output).toContain('本文件使用缩略语<a class="ses-xref" href="#abb_1" data-ref-target="abb-adc">ADC</a>与<a class="ses-xref" href="#abb_3" data-ref-target="abb-ct">CT</a>。')
    expect(output).not.toContain('模数转换器</a>')
    expect(output.match(/ id="abb_\d+"/g)).toHaveLength(4)
    for (const k of [1, 2, 3, 4]) expect(output.match(new RegExp(` id="abb_${k}"`, 'g'))).toHaveLength(1)
  })

  it('print：只输出文本 span，不输出内部链接；项仍带 id', () => {
    const output = html(g2IrDoc(), 'print')
    expect(output).toContain('本文件使用缩略语<span class="ses-xref" data-ref-target="abb-adc">ADC</span>与<span class="ses-xref" data-ref-target="abb-ct">CT</span>。')
    expect(output).not.toMatch(/<a[\s>]/)
    expect(output.match(/ id="abb_\d+"/g)).toHaveLength(4)
  })

  it('缩略语项的 xmlId 在附录内继续按文档序编号（abb_4），引用附录项得到其术语', () => {
    const doc = g2IrDoc([abbrRef('abb-app', '统一码')])
    const output = html(doc, 'screen')
    expect(output).toContain('<a class="ses-xref" href="#abb_4" data-ref-target="abb-app">UTF-8</a>')
  })
})

describe('[M-10.1.4-03][M-10.1.4-04][M-10.1.4-05] DOCX：缩略语表', () => {
  it('大纲：每项一个 SesPara 段，缩略语、全角冒号、释义；引导语在前，无编号栏', () => {
    const outline = docxOutline(docx(g2IrDoc()))
    expect(outline).toContain([
      'SesChapter │ 3 │ 符号和缩略语',
      'SesPara │ — │ 下列缩略语适用于本文件。',
      `SesPara │ — │ ADC${SEP}模数转换器（Analog-to-Digital Converter）`,
      `SesPara │ — │ AGC${SEP}自动增益控制（Automatic Gain Control）`,
      `SesPara │ — │ CT${SEP}计算机断层扫描，参见ADC与电流互感器`,
    ].join('\n'))
    expect(outline).toContain(`SesPara │ — │ UTF-8${SEP}8位统一码转换格式（8-bit Unicode Transformation Format）`)
  })

  it('XML 片段：同一 w:p 内依次是缩略语 run、全角冒号 run、释义 run；行内格式保留；沿用 SesPara、无 numPr', () => {
    const xml = docx(g2IrDoc()).parts['word/document.xml']!
    expect(xml).toContain([
      '<w:p><w:pPr><w:pStyle w:val="SesPara"/></w:pPr>',
      '<w:r><w:t xml:space="preserve">ADC</w:t></w:r>',
      `<w:r><w:t xml:space="preserve">${SEP}</w:t></w:r>`,
      '<w:r><w:t xml:space="preserve">模数转换器（Analog-to-Digital Converter）</w:t></w:r></w:p>',
    ].join(''))
    expect(xml).toContain([
      '<w:p><w:pPr><w:pStyle w:val="SesPara"/></w:pPr>',
      '<w:r><w:t xml:space="preserve">CT</w:t></w:r>',
      `<w:r><w:t xml:space="preserve">${SEP}</w:t></w:r>`,
      '<w:r><w:t xml:space="preserve">计算机断层扫描，参见</w:t></w:r>',
      '<w:r><w:t xml:space="preserve">ADC</w:t></w:r>',
      '<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">与</w:t></w:r>',
      '<w:r><w:t xml:space="preserve">电流互感器</w:t></w:r></w:p>',
    ].join(''))
  })

  it('不新增样式与编号：styles.xml、numbering.xml 与无缩略语表的同一文档逐字节一致', () => {
    const withLists = docx(g2IrDoc())
    const plain = g2IrDoc()
    plain.body[0]!.children = [{ kind: 'paragraph', id: 'g2-scope-p', content: [{ text: '无引用。' }] }]
    plain.body[2]!.children = plain.body[2]!.children.filter(child => child.kind !== 'defList')
    plain.appendices[0]!.children = plain.appendices[0]!.children.filter(child => child.kind !== 'defList')
    const without = docx(plain)
    for (const part of ['word/styles.xml', 'word/numbering.xml']) expect(withLists.parts[part], part).toBe(without.parts[part])
  })

  it('每项恰好一个段落：全文 SesPara 数量 = 无缩略语版本 + 缩略语项数（4）', () => {
    const count = (xml: string) => (xml.match(/<w:pStyle w:val="SesPara"\/>/g) ?? []).length
    const plain = g2IrDoc()
    plain.body[2]!.children = plain.body[2]!.children.filter(child => child.kind !== 'defList')
    plain.appendices[0]!.children = plain.appendices[0]!.children.filter(child => child.kind !== 'defList')
    expect(count(docx(g2IrDoc()).parts['word/document.xml']!) - count(docx(plain).parts['word/document.xml']!)).toBe(4)
  })

  it('包结构合法、输出确定且可 JSON 往返；缩略语表不产生降级告警', () => {
    const pkg = docx(g2IrDoc())
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(docx(g2IrDoc())).toEqual(pkg)
    expect(JSON.parse(JSON.stringify(pkg))).toEqual(pkg)
    expect(pkg.warnings.filter(warning => warning.nodeId?.startsWith('abb-') || warning.nodeId?.startsWith('g2-'))).toEqual([])
  })

  it('项内的行内公式缺 OMML 时回退 LaTeX 并记 formula-missing-omml 告警（沿用公式降级规则）', () => {
    const doc = g2IrDoc()
    ;(doc.body[2]!.children[1] as IRDefList).items.push(defItem('abb-f', [{ text: '', formula: { id: 'g2-f1', latex: 'x^2' } }], '平方'))
    const pkg = docx(doc)
    expect(pkg.warnings.map(warning => warning.code)).toContain('formula-missing-omml')
    expect(pkg.parts['word/document.xml']).toContain('x^2')
  })
})

describe('[M-10.1.1-04] DOCX：abbreviation 引用输出 refText', () => {
  it('引用处文字为缩略语（作者原文被替换）；缩略语项不新增书签', () => {
    const xml = docx(g2IrDoc()).parts['word/document.xml']!
    const plain = g2IrDoc()
    plain.body[0]!.children = [{ kind: 'paragraph', id: 'g2-scope-p', content: [{ text: '无引用。' }] }]
    const baseline = docx(plain).parts['word/document.xml']!
    expect(xml).toContain('<w:t xml:space="preserve">本文件使用缩略语</w:t></w:r><w:r><w:t xml:space="preserve">ADC</w:t></w:r><w:r><w:t xml:space="preserve">与</w:t></w:r><w:r><w:t xml:space="preserve">CT</w:t></w:r>')
    expect(xml).not.toContain('模数转换器</w:t></w:r><w:r><w:t xml:space="preserve">与')
    expect(xml).not.toContain('abb_')
    expect(xml.match(/<w:bookmarkStart /g)?.length ?? 0).toBe(baseline.match(/<w:bookmarkStart /g)?.length ?? 0)
  })
})

describe('缩略语表在表格单元格内（DOCX 表格行高估算分支）', () => {
  it('单元格内的缩略语表可渲染且不抛错（tablePagination 的行数估算覆盖 defList）', () => {
    const doc = g2IrDoc()
    doc.body[2]!.children.push({
      kind: 'table', id: 'g2-t', caption: [{ text: '含缩略语表的表' }], orientation: 'portrait', headerRowCount: 0, notes: [],
      rows: [{ id: 'g2-t-r', cells: [{
        id: 'g2-t-c', colspan: 1, rowspan: 1, header: false,
        content: [{ kind: 'defList', id: 'g2-t-list', items: [defItem('abb-t', 'TBX', '术语数据库交换')] }],
      }] }],
    })
    const pkg = docx(doc)
    expect(docxOutline(pkg)).toContain(`SesPara │ — │ TBX${SEP}术语数据库交换`)
    expect(() => assertWellFormed(pkg)).not.toThrow()
  })
})
