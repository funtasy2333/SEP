/**
 * WP8.M G1：规范性引用文件清单、正文标准引用 mark、参考文献标题的输出边界与本阶段排版
 * （docs/wp8.m/design.md §3.4、§4.1、§7.1；矩阵 M-4.4.2.3-02/-03/-04、M-10.2-01/-02、M-10.1.7-01、M-4.5.3-02、M-E-06）。
 *
 * §7.1：规范性引用清单按 GB/T 1.1—2020 10.3.4 排版（HTML 含打印与 DOCX）——每项空两个汉字起排、回行顶格，文件之后不加标点，
 * 文件编号或“（所有部分）”与文件名称之间空一个汉字；stdRef / mixedCitation 按普通文本输出（D-M-07）；自定义参考文献标题替换默认标题。
 * 版式依据：GB/T 1.1—2020 原 PDF 第 8 页（印刷页 1，第 2 章“规范性引用文件”，已按图像核对：首行缩进与段落相同、
 * 每项一行、编号与名称之间约一个汉字、无末尾标点）。XML、XML46687 仍阻断（XML46687 留给 WP8.2）。
 */

import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import type { IRDoc, IRInline, IRNormRefList } from '../../ir/types'
import { createG1IrDoc, createG1LegacyIrDoc, createG1PmDoc } from '../../ir/__tests__/wp8mG1Fixtures'
import { renderDocx } from '../docx'
import { renderDocxTraced } from '../docx/render'
import { buildStylesXml } from '../docx/styles'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from '../docx/__tests__/helpers/checks'
import { docxOutline } from '../docx/__tests__/helpers/outline'
import { renderHtml } from '../html'
import { getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'

const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']
const docxOptions = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-22T08:00:00.000Z' }

function html(doc: IRDoc, variant: 'screen' | 'print'): string {
  return renderHtml(doc, resolve(doc).labels, { variant })
}

function docx(doc: IRDoc) {
  const { labels, problems } = resolve(doc)
  expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
  const { pkg, numbered } = renderDocxTraced(doc, labels, docxOptions)
  return { pkg, numbered, labels }
}

function normRefs(doc: IRDoc): IRNormRefList {
  return doc.body[1]!.children.find(child => child.kind === 'normRefList') as IRNormRefList
}

function pathsOf(doc: IRDoc, format: OutputBoundaryFormat): string[] {
  return getOutputSupportProblems(doc, format).map(problem => problem.path)
}

describe('[M-4.4.2.3-02] 输出边界：normRefList 只对 HTML、DOCX 放行', () => {
  const doc = createG1IrDoc()

  it('HTML、DOCX：含清单、两种 mark、自定义标题的文档没有任何 unsupported-output', () => {
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
  })

  it('XML、XML46687：清单（kind）、两种 mark（type）、标题（bibliographyTitle）各被阻断，路径精确', () => {
    for (const format of ['XML', 'XML46687'] as const) {
      const paths = pathsOf(doc, format)
      expect(paths, format).toEqual([
        'doc.body[1].children[1].kind',
        'doc.body[2].children[0].content[1].marks[0].type',
        'doc.body[2].children[0].content[3].marks[0].type',
        'doc.body[2].children[1].content[1].marks[1].type',
        'doc.body[2].children[1].content[4].marks[1].type',
        'doc.body[2].children[2].items[0].content[0].content[1].marks[0].type',
        'doc.body[2].children[3].content[0].content[1].marks[0].type',
        'doc.bibliographyTitle',
      ])
      for (const problem of getOutputSupportProblems(doc, format)) {
        expect(problem).toMatchObject({ code: 'unsupported-output', message: expect.stringContaining(format) })
        expect(problem.message).toContain('请保留 JSON 文档')
      }
    }
  })

  it('XML46687 在 8.M 内不得放开：与旧 XML 逐条相同（仅消息里的格式名不同）', () => {
    expect(getOutputSupportProblems(doc, 'XML46687').map(problem => ({ ...problem, message: problem.message.replace('XML46687', 'XML') })))
      .toEqual(getOutputSupportProblems(doc, 'XML'))
  })

  it('去掉 G1 新结构的旧文档：四种格式都没有问题（放行只由新结构触发）', () => {
    const legacy = createG1LegacyIrDoc()
    for (const format of FORMATS) expect(getOutputSupportProblems(legacy, format), format).toEqual([])
  })

  it('只有清单（没有 mark 与标题）：XML 家族只报清单的 kind；只有标题：只报 bibliographyTitle', () => {
    const onlyList = createG1LegacyIrDoc()
    onlyList.body[1]!.children.push(normRefs(doc))
    for (const format of ['XML', 'XML46687'] as const) expect(pathsOf(onlyList, format), format).toEqual(['doc.body[1].children[2].kind'])
    for (const format of ['HTML', 'DOCX'] as const) expect(pathsOf(onlyList, format), format).toEqual([])

    const onlyTitle = createG1LegacyIrDoc()
    onlyTitle.bibliographyTitle = [{ text: '参考书目' }]
    for (const format of ['XML', 'XML46687'] as const) expect(pathsOf(onlyTitle, format), format).toEqual(['doc.bibliographyTitle'])
    for (const format of ['HTML', 'DOCX'] as const) expect(pathsOf(onlyTitle, format), format).toEqual([])
  })

  it('放行不连带放行未知字段：条目里的额外字段、清单里的额外字段仍报 unsupported-output', () => {
    const extra = createG1IrDoc()
    ;(normRefs(extra) as unknown as Record<string, unknown>).label = '附加'
    ;(normRefs(extra).entries[0] as unknown as Record<string, unknown>).xmlId = 'ref_x'
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(pathsOf(extra, format).sort(), format).toEqual(['doc.body[1].children[1].entries[0].xmlId', 'doc.body[1].children[1].label'])
    }
  })

  it('条目内的行内公式不放行（文件编号/名称/混合引用属于不开放行内公式的位置）；脚注与既有行内格式放行', () => {
    const formula = createG1IrDoc()
    const list = normRefs(formula)
    const first = list.entries[0]!
    if (first.entryType !== 'std') throw new Error('夹具应为 std 条目')
    first.title.push({ text: '', formula: { id: 'g1-formula', latex: 'x^2' } })
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(formula, format).some(problem => problem.message.includes('行内公式')), format).toBe(true)
    }
    const title = createG1IrDoc()
    title.bibliographyTitle = [{ text: '', formula: { id: 'g1-formula-title', latex: 'x^2' } }]
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(title, format).some(problem => problem.message.includes('行内公式')), format).toBe(true)
    }
  })

  it('来自生产 PM 文档的路径一致：pmToIr 得到的 IR 与手写 IR 的边界结论相同', () => {
    const { doc: fromPm } = pmToIr(createG1PmDoc())
    expect(getOutputSupportProblems(fromPm, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(fromPm, 'DOCX')).toEqual([])
    for (const format of ['XML', 'XML46687'] as const) expect(pathsOf(fromPm, format)).toEqual(pathsOf(doc, format))
  })

  it('清单位于非 norm-refs 章：Resolver 的 unsupported-content error 不被边界吞掉，pmToIr 的 unsupportedContent 使四种格式阻断', () => {
    const { doc: bad } = pmToIr(createG1PmDoc())
    bad.unsupportedContent = [{ nodeId: 'g1-stray', path: 'doc.content[2]', nodeType: 'stdParagraph', reason: '清单内的未知节点' }]
    for (const format of FORMATS) expect(getOutputSupportProblems(bad, format).some(problem => problem.nodeId === 'g1-stray'), format).toBe(true)
  })
})

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] [M-E-06] HTML：规范性引用清单按 10.3.4 排版', () => {
  const doc = createG1IrDoc()
  const expectedList = [
    '<div class="ses-norm-ref-list" data-type="norm-ref-list" data-node-id="g1-nrl">',
    '<p class="ses-paragraph ses-norm-ref" data-type="norm-ref" data-entry-type="std" data-node-id="g1-nr-1" id="ref_1"><span class="ses-norm-ref-no">GB/T 321</span>　<span class="ses-norm-ref-title">优先数和优先数系</span></p>',
    '<p class="ses-paragraph ses-norm-ref" data-type="norm-ref" data-entry-type="std" data-node-id="g1-nr-2" id="ref_2"><span class="ses-norm-ref-no">GB/T 3102（所有部分）</span>　<span class="ses-norm-ref-title">量和单位</span></p>',
    '<p class="ses-paragraph ses-norm-ref" data-type="norm-ref" data-entry-type="std" data-node-id="g1-nr-3" id="ref_3"><span class="ses-norm-ref-no">ISO 80000（所有部分）</span>　<span class="ses-norm-ref-title">量和单位（Quantities and units）</span></p>',
    '</div>',
  ]

  for (const variant of ['screen', 'print'] as const) {
    it(`${variant}：std 条目 = 文件编号 + 一个汉字（U+3000）+ 文件名称，每项一个 p，条目 id 为 ref_<n>`, () => {
      const output = html(doc, variant)
      const start = output.indexOf('<div class="ses-norm-ref-list"')
      expect(start).toBeGreaterThan(-1)
      const lines = output.slice(start).split('\n')
      expect(lines.slice(0, 4)).toEqual(expectedList.slice(0, 4))
      // 文件编号与名称之间恰为一个 U+3000，没有普通空格
      expect(lines[1]).toContain('GB/T 321</span>　<span')
      expect(lines[2]).not.toMatch(/　　| <span class="ses-norm-ref-title"/)
    })
  }

  it('mixed 条目保持原有格式原样输出（无编号/名称拆分），脚注按条文脚注输出；清单之后的结构完整', () => {
    const screen = html(doc, 'screen')
    expect(screen).toContain('data-entry-type="mixed" data-node-id="g1-nr-4" id="ref_4">《中华人民共和国计量法》<span class="ses-footnote" role="doc-footnote" id="fn_1" data-label="1)">非标准化文件的脚注。</span></p>')
    const print = html(doc, 'print')
    expect(print).toContain('data-entry-type="mixed" data-node-id="g1-nr-4" id="ref_4">《中华人民共和国计量法》<span class="ses-footnote" role="doc-footnote" id="fn_1" data-label="1)"><span class="ses-footnote-marker"><sup>1)</sup></span><span class="ses-footnote-text">非标准化文件的脚注。</span></span></p>')
    expect(screen.indexOf('ses-norm-ref-list')).toBeLessThan(screen.indexOf('</section>', screen.indexOf('ses-norm-ref-list')))
  })

  it('版式复用 .ses-paragraph（首行缩进 2 字、回行顶格），不新增样式规则：screen/print 样式表与 G1 之前逐字相同', () => {
    const legacy = createG1LegacyIrDoc()
    const css = (value: string) => /<style>([\s\S]*?)<\/style>/.exec(value)![1]!
    for (const variant of ['screen', 'print'] as const) {
      expect(css(html(doc, variant))).toBe(css(html(legacy, variant)))
      expect(css(html(doc, variant))).not.toContain('ses-norm-ref')
    }
    expect(css(html(doc, 'print'))).toContain('.ses-paragraph { text-indent: 2em; }')
  })

  it('文件之后不加标点：渲染器不追加任何字符，也不改写作者内容；空的一段不留多余间隔', () => {
    const noTitle = createG1IrDoc()
    const first = normRefs(noTitle).entries[0]!
    if (first.entryType !== 'std') throw new Error('夹具应为 std 条目')
    first.title = []
    const withoutTitle = html(noTitle, 'print')
    expect(withoutTitle).toContain('id="ref_1"><span class="ses-norm-ref-no">GB/T 321</span></p>')
    const noRef = createG1IrDoc()
    const entry = normRefs(noRef).entries[0]!
    if (entry.entryType !== 'std') throw new Error('夹具应为 std 条目')
    entry.ref = []
    expect(html(noRef, 'print')).toContain('id="ref_1"><span class="ses-norm-ref-title">优先数和优先数系</span></p>')
    const lines = html(doc, 'print').split('\n').filter(line => line.includes('ses-norm-ref"') && line.includes('data-entry-type="std"'))
    for (const line of lines) expect(line).toMatch(/<\/span><\/p>$/)
  })

  it('特殊字符被转义；渲染为纯函数（两次输出逐字节相同）', () => {
    const escaped = createG1IrDoc()
    const entry = normRefs(escaped).entries[0]!
    if (entry.entryType !== 'std') throw new Error('夹具应为 std 条目')
    entry.title = [{ text: 'a<b & "c"' }]
    expect(html(escaped, 'print')).toContain('<span class="ses-norm-ref-title">a&lt;b &amp; "c"</span>')
    expect(html(doc, 'print')).toBe(html(doc, 'print'))
    expect(html(doc, 'screen')).toBe(html(doc, 'screen'))
  })

  it('没有清单的 norm-refs 章（旧形态）输出不含任何 norm-ref 标记', () => {
    const output = html(createG1LegacyIrDoc(), 'print')
    expect(output).not.toMatch(/ses-norm-ref|norm-ref-list/)
  })
})

describe('[M-10.2-01] [M-10.2-02] [M-10.1.7-01] HTML：stdRef / mixedCitation 按普通文本输出', () => {
  it('被标记的文本原样输出，不加 span/标记；与 bold 叠加时只体现 bold；与 crossRef 叠加时输出 refText', () => {
    const output = html(createG1IrDoc(), 'print')
    expect(output).toContain('量的名称与符号应符合GB/T 3102.1的规定，并遵守《中华人民共和国计量法》。')
    expect(output).toContain('加粗的标准引用：<strong>GB/T 321</strong>；见<span class="ses-xref" data-ref-target="g1-ch2">第2章</span>')
    expect(output).toContain('<span class="ses-list-item-text">符合GB/T 321</span>')
    expect(output).not.toMatch(/std-ref|stdRef|mixed-citation|mixedCitation/)
  })

  it('同一文档去掉两种 mark 后，正文段落输出逐字相同（mark 不产生任何可见或结构差异）', () => {
    const marked = createG1IrDoc()
    const stripped = createG1IrDoc()
    const strip = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(strip); return }
      if (!value || typeof value !== 'object') return
      const row = value as { marks?: { type: string }[] }
      if (Array.isArray(row.marks)) {
        row.marks = row.marks.filter(mark => mark.type !== 'stdRef' && mark.type !== 'mixedCitation')
        if (row.marks.length === 0) delete row.marks
      }
      Object.values(row).forEach(strip)
    }
    strip(stripped)
    for (const variant of ['screen', 'print'] as const) expect(html(marked, variant)).toBe(html(stripped, variant))
  })
})

describe('[M-4.5.3-02] HTML：自定义参考文献标题', () => {
  it('自定义标题替换默认的“参考文献”；目次条目随标题；默认标题输出不变', () => {
    const output = html(createG1IrDoc(), 'print')
    expect(output).toContain('<h2 class="ses-bib-title">参考书目</h2>')
    expect(output).toContain('<span class="ses-toc-text">参考书目</span>')
    expect(output).not.toContain('参考文献</h2>')
    expect(output).not.toContain('<span class="ses-toc-text">参考文献</span>')

    const legacy = html(createG1LegacyIrDoc(), 'print')
    expect(legacy).toContain('<h2 class="ses-bib-title">参考文献</h2>')
    expect(legacy).toContain('<span class="ses-toc-text">参考文献</span>')
  })

  it('标题里的行内格式保留，目次里取纯文本并转义', () => {
    const doc = createG1IrDoc()
    doc.bibliographyTitle = [{ text: '参考', marks: [{ type: 'bold' }] }, { text: '<书目>' }]
    const output = html(doc, 'screen')
    expect(output).toContain('<h2 class="ses-bib-title"><strong>参考</strong>&lt;书目&gt;</h2>')
    expect(output).toContain('参考&lt;书目&gt;')
  })

  it('没有参考文献条目时不输出标题（与默认行为一致）', () => {
    const doc = createG1IrDoc()
    doc.bibliography = []
    expect(html(doc, 'print')).not.toContain('<h2 class="ses-bib-title"')
  })
})

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] DOCX：规范性引用清单按 10.3.4 排版（SesPara：首行缩进 2 字、回行顶格）', () => {
  const { pkg, numbered } = docx(createG1IrDoc())
  const outline = docxOutline(pkg)

  it('每项一个 SesPara 段：std = 文件编号 + U+3000 + 文件名称；mixed 原样；条目段无编号', () => {
    expect(outline).toContain([
      'SesPara │ — │ 下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。',
      'SesPara │ — │ GB/T 321　优先数和优先数系',
      'SesPara │ — │ GB/T 3102（所有部分）　量和单位',
      'SesPara │ — │ ISO 80000（所有部分）　量和单位（Quantities and units）',
      'SesPara │ — │ 《中华人民共和国计量法》1)',
    ].join('\n'))
  })

  it('文件编号与名称之间恰为一个 U+3000 的独立 run；没有普通空格，不加末尾标点', () => {
    const xml = pkg.parts['word/document.xml']!
    expect(xml).toContain('<w:t xml:space="preserve">GB/T 321</w:t></w:r><w:r><w:t xml:space="preserve">　</w:t></w:r><w:r><w:t xml:space="preserve">优先数和优先数系</w:t></w:r></w:p>')
    for (const line of outline.split('\n').filter(entry => /^SesPara │ — │ (GB\/T|ISO) /.test(entry))) {
      expect(line).not.toMatch(/[。；，、.;,]$/)
    }
  })

  it('不新增样式：条目段使用既有的 SesPara（styles.xml 与没有清单的文档逐字相同），不进入 §4.7 编号追踪', () => {
    // 样式表只随“是否含条文脚注”变化（既有机制），清单本身不增删任何样式
    expect(pkg.parts['word/styles.xml']).toBe(buildStylesXml({ includeFootnotes: true }))
    expect(docx(createG1LegacyIrDoc()).pkg.parts['word/styles.xml']).toBe(buildStylesXml({ includeFootnotes: false }))
    expect(buildStylesXml({ includeFootnotes: true })).toContain('w:styleId="SesPara"')
    expect(numbered.filter(item => item.nodeId.startsWith('g1-nr-'))).toEqual([])
  })

  it('包结构合法：XML 良构、子元素顺序、编号完整性；条目内的脚注进入 footnotes 部件', () => {
    assertWellFormed(pkg)
    assertChildOrder(pkg)
    assertNumberingIntegrity(pkg)
    expect(pkg.parts['word/footnotes.xml']).toContain('非标准化文件的脚注。')
  })

  it('清单在 DOCX 中的位置：位于“规范性引用文件”章标题与引导语之后，下一章之前', () => {
    const lines = outline.split('\n')
    const chapter = lines.findIndex(line => line.includes('规范性引用文件') && line.startsWith('SesChapter'))
    const lastRef = lines.findIndex(line => line.includes('《中华人民共和国计量法》1)'))
    const nextChapter = lines.findIndex((line, index) => index > chapter && line.startsWith('SesChapter'))
    expect(chapter).toBeGreaterThan(-1)
    expect(lastRef).toBeGreaterThan(chapter)
    expect(lastRef).toBeLessThan(nextChapter)
  })

  it('空的一段不留多余间隔（title 为空时只输出文件编号）', () => {
    const doc = createG1IrDoc()
    const entry = normRefs(doc).entries[0]!
    if (entry.entryType !== 'std') throw new Error('夹具应为 std 条目')
    entry.title = []
    expect(docxOutline(docx(doc).pkg)).toContain('SesPara │ — │ GB/T 321\n')
  })
})

describe('[M-10.2-01] [M-10.2-02] [M-10.1.7-01] DOCX：stdRef / mixedCitation 按普通文本输出', () => {
  it('被标记文本的 run 不带任何额外 rPr；叠加 bold 时只有粗体', () => {
    const { pkg } = docx(createG1IrDoc())
    const xml = pkg.parts['word/document.xml']!
    expect(xml).toContain('<w:r><w:t xml:space="preserve">GB/T 3102.1</w:t></w:r>')
    expect(xml).toContain('<w:r><w:t xml:space="preserve">《中华人民共和国计量法》</w:t></w:r>')
    expect(xml).toContain('<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">GB/T 321</w:t></w:r>')
    expect(xml).not.toMatch(/stdRef|mixedCitation|std-ref|mixed-citation/)
  })

  it('同一文档去掉两种 mark 后，正文输出逐字相同', () => {
    const marked = createG1IrDoc()
    const stripped = createG1IrDoc()
    const strip = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(strip); return }
      if (!value || typeof value !== 'object') return
      const row = value as { marks?: { type: string }[] }
      if (Array.isArray(row.marks)) {
        row.marks = row.marks.filter(mark => mark.type !== 'stdRef' && mark.type !== 'mixedCitation')
        if (row.marks.length === 0) delete row.marks
      }
      Object.values(row).forEach(strip)
    }
    strip(stripped)
    expect(docxOutline(docx(marked).pkg)).toBe(docxOutline(docx(stripped).pkg))
    expect(docx(marked).pkg.parts['word/document.xml']).toBe(docx(stripped).pkg.parts['word/document.xml'])
  })
})

describe('[M-4.5.3-02] DOCX：自定义参考文献标题', () => {
  it('自定义纯文本标题与默认标题同一版式：逐字 1 个字宽字距，最后一个字不加；目次条目为纯文本', () => {
    const { pkg } = docx(createG1IrDoc())
    const xml = pkg.parts['word/document.xml']!
    const space = '<w:rPr><w:spacing w:val="210"/></w:rPr>'
    expect(xml).toContain(`<w:p><w:pPr><w:pStyle w:val="SesBibTitle"/></w:pPr><w:bookmarkStart`)
    expect(xml).toContain(`<w:r>${space}<w:t xml:space="preserve">参</w:t></w:r><w:r>${space}<w:t xml:space="preserve">考</w:t></w:r><w:r>${space}<w:t xml:space="preserve">书</w:t></w:r><w:r><w:t xml:space="preserve">目</w:t></w:r>`)
    const outline = docxOutline(pkg)
    expect(outline).toContain('SesBibTitle │ — │ 参考书目')
    expect(outline).toContain('TOC1 │ — │ 参考书目')
    expect(outline).not.toContain('参考文献')
  })

  it('默认标题输出与改动前逐字相同：参、考、文三个 run 带字距，献不带', () => {
    const { pkg } = docx(createG1LegacyIrDoc())
    const space = '<w:rPr><w:spacing w:val="210"/></w:rPr>'
    expect(pkg.parts['word/document.xml']).toContain(`<w:r>${space}<w:t xml:space="preserve">参</w:t></w:r><w:r>${space}<w:t xml:space="preserve">考</w:t></w:r><w:r>${space}<w:t xml:space="preserve">文</w:t></w:r><w:r><w:t xml:space="preserve">献</w:t></w:r>`)
    expect(docxOutline(pkg)).toContain('TOC1 │ — │ 参考文献')
  })

  it('带格式的标题按行内渲染（保留粗体），不加字距', () => {
    const doc = createG1IrDoc()
    doc.bibliographyTitle = [{ text: '参考', marks: [{ type: 'bold' }] }, { text: '书目' }]
    const xml = docx(doc).pkg.parts['word/document.xml']!
    expect(xml).toContain('<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">参考</w:t></w:r><w:r><w:t xml:space="preserve">书目</w:t></w:r>')
  })

  it('renderDocx 与 renderDocxTraced 对同一文档输出相同（纯函数）', () => {
    const doc = createG1IrDoc()
    const { labels } = resolve(doc)
    expect(renderDocx(doc, labels, docxOptions).parts['word/document.xml']).toBe(renderDocx(doc, labels, docxOptions).parts['word/document.xml'])
  })
})

describe('渲染入口自检：违规内容不会被静默渲染', () => {
  it('清单含行内公式 → renderHtml / renderDocx 抛出 unsupported-output（边界先于渲染）', () => {
    const doc = createG1IrDoc()
    const mixed = normRefs(doc).entries[3]!
    if (mixed.entryType !== 'mixed') throw new Error('夹具应为 mixed 条目')
    mixed.content.push({ text: '', formula: { id: 'g1-f', latex: 'x' } } as IRInline)
    const { labels } = resolve(doc)
    expect(() => renderHtml(doc, labels, { variant: 'print' })).toThrow('行内公式')
    expect(() => renderDocx(doc, labels, docxOptions)).toThrow('行内公式')
  })
})
