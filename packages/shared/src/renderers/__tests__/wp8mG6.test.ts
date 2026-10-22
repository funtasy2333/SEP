/**
 * WP8.M G6：引言中的条的输出边界与本阶段排版（docs/wp8.m/design.md §4.6、§7.1；矩阵 M-4.3.4-02、M-4.3.4-03）。
 *
 * §7.1：引言中的条在 HTML（含打印）与 DOCX 按条标题排版，编号 0.1，字体字号与正文条一致（GB/T 1.1—2020 表 F.1 #33
 * 章、条编号及其标题五号黑体；8.4 引言仅对条编号，编为 0.1、0.2 等）；XML、XML46687 仍阻断（XML46687 留给 WP8.2）。
 * 目次只列「引言」，不列引言条（8.2 d 条目次“需要时列出”，目次页码的前置/正文分区见 io/pdfExport.ts）。
 */

import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import { pmToIr, type PMJsonNode } from '../../ir/pmToIr'
import type { IRDoc } from '../../ir/types'
import { createG6IrDoc, createG6IrDocWithoutClauses } from '../../ir/__tests__/wp8mG6Fixtures'
import { renderDocx } from '../docx'
import { renderDocxTraced } from '../docx/render'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from '../docx/__tests__/helpers/checks'
import { assertCoverage, assertNumberingConsistency, collectNumberedNodeIds } from '../docx/__tests__/helpers/consistency'
import { docxOutline } from '../docx/__tests__/helpers/outline'
import { renderHtml } from '../html'
import { getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'
import { printCss } from '../printCss'

const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']
const docxOptions = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-22T08:00:00.000Z' }

function render(doc: IRDoc, variant: 'screen' | 'print') {
  const { labels } = resolve(doc)
  return renderHtml(doc, labels, { variant })
}

function docx(doc: IRDoc) {
  const { labels, problems } = resolve(doc)
  expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
  const { pkg, numbered } = renderDocxTraced(doc, labels, docxOptions)
  return { pkg, numbered, labels }
}

const listItemExpected = new Map([['intro-c2-list-i1', 'a）'], ['intro-c2-list-i2', 'b）']])

describe('[M-4.3.4-02] 输出边界：front.introductionClauses 只对 HTML、DOCX 放行', () => {
  const withClauses = createG6IrDoc()
  const legacy = createG6IrDocWithoutClauses()

  it('HTML、DOCX：没有 unsupported-output', () => {
    expect(getOutputSupportProblems(withClauses, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(withClauses, 'DOCX')).toEqual([])
  })

  it('XML、XML46687：阻断，路径指向 front.introductionClauses（WP8.2 再放开 XML46687）', () => {
    for (const format of ['XML', 'XML46687'] as const) {
      const problems = getOutputSupportProblems(withClauses, format)
      expect(problems.map(problem => problem.path), format).toEqual(['doc.front.introductionClauses'])
      expect(problems[0]).toMatchObject({ code: 'unsupported-output', message: expect.stringContaining('introductionClauses') })
    }
  })

  it('无条的引言：四种格式都与改动前一致，没有问题', () => {
    for (const format of FORMATS) expect(getOutputSupportProblems(legacy, format), format).toEqual([])
    const empty = { ...legacy, front: { ...legacy.front, introductionClauses: [] } }
    for (const format of FORMATS) expect(getOutputSupportProblems(empty, format), format).toEqual([])
  })

  it('引言条内的内容仍受各格式既有字段表约束（条本身放行不等于内容放行）', () => {
    const styled = createG6IrDoc()
    const clause = styled.front.introductionClauses![0]!
    ;(clause.children[0] as { children: unknown[] }).children.push({ kind: 'warning', id: 'intro-warning', content: [] })
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(styled, format).map(problem => problem.path), format)
        .toEqual(['doc.front.introductionClauses[0].children[0].children[2].kind'])
    }
  })

  it('条之后的悬置段：pmToIr 的 unsupportedContent 使 HTML、DOCX 同样阻断', () => {
    const paragraph = (id: string): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [{ type: 'text', text: '正文' }] })
    const pm: PMJsonNode = { type: 'doc', content: [
      { type: 'introduction', attrs: { nodeId: 'intro' }, content: [
        { type: 'clause', attrs: { nodeId: 'c1', level: 1, hasTitle: true }, content: [{ type: 'clauseTitle', content: [{ type: 'text', text: '条' }] }, paragraph('c1-p')] },
        paragraph('hanging'),
      ] },
      { type: 'chapter', attrs: { nodeId: 'ch1' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] }, paragraph('ch1-p')] },
    ] }
    const { doc } = pmToIr(pm)
    for (const format of FORMATS) {
      const problems = getOutputSupportProblems(doc, format).filter(problem => problem.message.includes('悬置段'))
      expect(problems, format).toHaveLength(1)
      expect(problems[0]).toMatchObject({ code: 'unsupported-output', nodeId: 'hanging' })
    }
  })
})

describe('[M-4.3.4-02][M-4.3.4-03] HTML（screen / print）：引言条按条标题排版', () => {
  const doc = createG6IrDoc()
  const screen = render(doc, 'screen')
  const print = render(doc, 'print')

  function introduction(html: string): string {
    const start = html.indexOf('<section class="ses-introduction"')
    expect(start).toBeGreaterThan(-1)
    // 引言 section 内嵌套 section.ses-clause，按嵌套深度找到与之配对的 </section>
    let depth = 0
    const tag = /<section\b|<\/section>/g
    tag.lastIndex = start
    for (let match = tag.exec(html); match; match = tag.exec(html)) {
      depth += match[0] === '</section>' ? -1 : 1
      if (depth === 0) return html.slice(start, match.index + '</section>'.length)
    }
    throw new Error('引言 section 没有闭合')
  }

  it.each([['screen', screen], ['print', print]] as const)('%s：引言内是条 section，标题为 h3/h4 + 编号 span（0.1、0.1.1），锚点 sec_0.n', (_name, html) => {
    const intro = introduction(html)
    expect(intro).toContain('<h1 class="ses-front-heading">引　言</h1>')
    expect(intro).toContain('<section class="ses-clause ses-clause-l1" data-type="clause" data-level="1" data-titled="true" data-node-id="intro-c1" id="sec_0.1">')
    expect(intro).toContain('<h3 class="ses-clause-title"><span class="ses-num">0.1</span>背景</h3>')
    expect(intro).toContain('<section class="ses-clause ses-clause-l2" data-type="clause" data-level="2" data-titled="true" data-node-id="intro-c1-1" id="sec_0.1.1">')
    expect(intro).toContain('<h4 class="ses-clause-title"><span class="ses-num">0.1.1</span>起因</h4>')
    expect(intro).toContain('<span class="ses-num">0.1.2</span>说明')
    expect(intro).toContain('<span class="ses-num">0.2</span>目的')
    // 无题条（0.3）：只有编号，与首段同排
    expect(intro).toContain('<p class="ses-clause-numbered-para" data-type="paragraph" data-node-id="intro-c3-p1"><span class="ses-clause-num-only">0.3</span>无标题条的条文。</p>')
    // 引言不给章编号：引言里没有 ses-chapter，也没有以“章”编号的标题
    expect(intro).not.toContain('ses-chapter')
    // 条在引言标题之后、正文章之前
    expect(html.indexOf('引　言')).toBeLessThan(html.indexOf('id="sec_0.1"'))
    expect(html.indexOf('id="sec_0.3"')).toBeLessThan(html.indexOf('<section class="ses-chapter"'))
  })

  it('引言条内的图表编号从引言起算并接续正文；注标记按条作用域', () => {
    const intro = introduction(screen)
    expect(intro).toContain('表1')
    expect(intro).toContain('图1')
    expect(intro).toContain('<span class="ses-note-marker">注：</span>')
    expect(screen).toContain('表2')
    expect(screen).toContain('图2')
  })

  it('正文章条编号不受引言条影响：第 1 章、1.1', () => {
    expect(screen).toContain('<h2 class="ses-chapter-title"><span class="ses-num">1</span>范围</h2>')
    expect(screen).toContain('<h3 class="ses-clause-title"><span class="ses-num">1.1</span>一般要求</h3>')
    expect(screen).toContain('id="sec_1.1"')
  })

  it('交叉引用：screen 为指向 #sec_0.1 的链接、文本为 0.1；print 为纯文本 span，无内部链接', () => {
    expect(screen).toContain('<a class="ses-xref" href="#sec_0.1" data-ref-target="intro-c1">0.1</a>')
    expect(screen).toContain('<a class="ses-xref" href="#sec_0.1.1" data-ref-target="intro-c1-1">0.1.1</a>')
    expect(print).toContain('<span class="ses-xref" data-ref-target="intro-c1">0.1</span>')
    expect(print).not.toContain('<a ')
  })

  it('目次：只有「引言」一项，引言条不进目次（screen 与 print 一致）', () => {
    for (const html of [screen, print]) {
      const toc = html.slice(html.indexOf('<nav class="ses-toc"'), html.indexOf('</nav>'))
      expect(toc).toContain('引言')
      expect(toc).toContain('1　范围')
      expect(toc).not.toContain('0.1')
      expect(toc).not.toContain('背景')
    }
    // 引言只有条也会出现在目次中，并带 front_intro 锚点（PDF 目次页码按此锚点划分前置分区）
    expect(print).toContain('data-target="front_intro"')
    expect(screen).toContain('<section class="ses-introduction" data-type="introduction" id="front_intro"')
  })

  it('字体字号与正文条一致：引言条与正文条用同一套 .ses-clause-title 规则（五号黑体），引言容器不覆盖字体', () => {
    const css = printCss()
    expect(css).toMatch(/\.ses-clause-title\s*\{[^}]*font-family: var\(--ses-hei\);[^}]*font-size: var\(--ses-fs-wu\);[^}]*font-weight: bold;/)
    // 引言容器只负责另起一页，没有任何限定在引言内的条标题/正文字体规则
    expect(css).not.toMatch(/\.ses-introduction[^{,]*\.ses-clause/)
    expect(css).toMatch(/\.ses-foreword, \.ses-introduction \{ break-before: page; \}/)
    // 条标题样式在引言与正文里是同一个选择器：两处输出的 h3 都是 class="ses-clause-title"
    expect(introduction(print).match(/<h3 class="ses-clause-title">/g)).toHaveLength(2) // 0.1、0.2（0.3 是无题条）
    expect(introduction(print).match(/<h4 class="ses-clause-title">/g)).toHaveLength(2) // 0.1.1、0.1.2
    expect(print).toContain('<h3 class="ses-clause-title"><span class="ses-num">1.1</span>一般要求</h3>')
  })

  it('纯函数：同样输入两次输出字节级相同', () => {
    expect(render(doc, 'screen')).toBe(screen)
    expect(render(doc, 'print')).toBe(print)
  })

  it('无条引言：输出与带空 introductionClauses 的相同，且不出现 sec_0.n', () => {
    const legacy = createG6IrDocWithoutClauses()
    const empty = { ...legacy, front: { ...legacy.front, introductionClauses: [] } }
    for (const variant of ['screen', 'print'] as const) {
      expect(render(empty, variant)).toBe(render(legacy, variant))
      expect(render(legacy, variant)).not.toContain('sec_0')
    }
  })

  it('XML 边界不影响 HTML：引言只有条、没有正文块时 HTML 仍渲染引言标题', () => {
    const onlyClauses = createG6IrDoc()
    expect(onlyClauses.front.introduction).toEqual([])
    expect(render(onlyClauses, 'screen')).toContain('<h1 class="ses-front-heading">引　言</h1>')
  })
})

describe('[M-4.3.4-02][M-4.3.4-03] DOCX：引言条用 A17 原生编号（0.1…），样式与正文条相同', () => {
  const doc = createG6IrDoc()
  const { pkg, numbered, labels } = docx(doc)
  const documentXml = pkg.parts['word/document.xml']!
  const numberingXml = pkg.parts['word/numbering.xml']!

  it('包结构合法：well-formed、子元素顺序、编号完整性', () => {
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
  })

  it('numbering.xml：按需输出 A17（abstractNum 17），L1 `0.%2　`、L2 `0.%2.%3　`，实例 101 对 ilvl 1..5 写 startOverride', () => {
    expect(numberingXml.match(/<w:abstractNum /g)).toHaveLength(17)
    const a17 = numberingXml.slice(numberingXml.indexOf('<w:abstractNum w:abstractNumId="17"'), numberingXml.indexOf('</w:abstractNum>', numberingXml.indexOf('<w:abstractNum w:abstractNumId="17"')))
    expect(a17).toContain('<w:lvl w:ilvl="1"')
    expect(a17).toContain('<w:lvlText w:val="0.%2　"/>')
    expect(a17).toContain('<w:lvlText w:val="0.%2.%3　"/>')
    expect(a17).toContain('<w:lvlText w:val="0.%2.%3.%4.%5.%6　"/>')
    // 缩进与字体同 A1 的条级别：L1..L5 缩进 0、标识黑体
    expect(a17.match(/<w:ind w:left="0" w:firstLine="0"\/>/g)).toHaveLength(6)
    expect(a17.match(/w:ascii="黑体"/g)).toHaveLength(6)
    const instance = numberingXml.slice(numberingXml.indexOf('<w:num w:numId="101"'), numberingXml.indexOf('</w:num>', numberingXml.indexOf('<w:num w:numId="101"')))
    expect(instance).toContain('<w:abstractNumId w:val="17"/>')
    for (const ilvl of [1, 2, 3, 4, 5]) expect(instance).toContain(`<w:lvlOverride w:ilvl="${ilvl}"><w:startOverride w:val="1"/></w:lvlOverride>`)
    // 章条 A1 的定义不变：L1 仍是 `%1.%2　`
    expect(numberingXml).toContain('<w:lvlText w:val="%1.%2　"/>')
  })

  it('大纲（Word 编号模拟器）：引言条 0.1、0.1.1、0.1.2、0.2、0.3；正文章条 1、1.1 不受影响', () => {
    const outline = docxOutline(pkg).split('\n')
    expect(outline).toEqual(expect.arrayContaining([
      'SesFrontTitle │ — │ 引言',
      'SesClause1 │ 0.1 │ 背景',
      'SesClause2 │ 0.1.1 │ 起因',
      'SesClause2 │ 0.1.2 │ 说明',
      'SesClause1 │ 0.2 │ 目的',
      'SesNoTitle1 │ 0.3 │ 无标题条的条文。',
      'SesChapter │ 1 │ 范围',
      'SesClause1 │ 1.1 │ 一般要求',
    ]))
    const positions = ['SesFrontTitle │ — │ 引言', 'SesClause1 │ 0.1 │ 背景', 'SesClause1 │ 0.2 │ 目的', 'SesNoTitle1 │ 0.3 │ 无标题条的条文。', 'SesChapter │ 1 │ 范围']
      .map(line => outline.indexOf(line))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(positions.every(position => position >= 0)).toBe(true)
  })

  it('段落：引言条用 SesClause{L}/SesNoTitle{L} 样式（同正文条，字体字号一致）+ 段落级 numPr 指向实例 101；正文条没有段落级 numPr', () => {
    const paragraphOf = (text: string) => {
      // 取最后一处：目次里也有同名条目（TOC2）
      const index = documentXml.lastIndexOf(`>${text}<`)
      expect(index, text).toBeGreaterThan(-1)
      const start = documentXml.lastIndexOf('<w:p>', index)
      return documentXml.slice(start, documentXml.indexOf('</w:p>', index))
    }
    const numPr = (ilvl: number) => `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="101"/></w:numPr>`
    expect(paragraphOf('背景')).toContain(`<w:pStyle w:val="SesClause1"/>${numPr(1)}`)
    expect(paragraphOf('起因')).toContain(`<w:pStyle w:val="SesClause2"/>${numPr(2)}`)
    expect(paragraphOf('目的')).toContain(`<w:pStyle w:val="SesClause1"/>${numPr(1)}`)
    expect(paragraphOf('无标题条的条文。')).toContain(`<w:pStyle w:val="SesNoTitle1"/>${numPr(1)}`)
    expect(paragraphOf('一般要求')).toContain('<w:pStyle w:val="SesClause1"/>')
    expect(paragraphOf('一般要求')).not.toContain('<w:numPr>')
    // 引言条与正文条共用同一个条标题样式（五号黑体，styles.xml 只定义一次）
    const styles = pkg.parts['word/styles.xml']!
    const clause1 = styles.slice(styles.indexOf('w:styleId="SesClause1"'), styles.indexOf('</w:style>', styles.indexOf('w:styleId="SesClause1"')))
    expect(clause1).toContain('w:ascii="黑体"')
    expect(styles.match(/w:styleId="SesClause1"/g)).toHaveLength(1)
  })

  it('§4.7 一致性：模拟器编号与 Resolver 标签逐段一致；引言条在 numbered 中恰好出现一次', () => {
    expect(() => assertNumberingConsistency(pkg, numbered, labels, listItemExpected)).not.toThrow()
    expect(() => assertCoverage(numbered, collectNumberedNodeIds(doc))).not.toThrow()
    expect(numbered.filter(trace => trace.kind === 'clause' && trace.nodeId.startsWith('intro-')).map(trace => trace.nodeId))
      .toEqual(['intro-c1', 'intro-c1-1', 'intro-c1-2', 'intro-c2', 'intro-c3'])
    expect(collectNumberedNodeIds(doc)).toEqual(expect.arrayContaining(['intro-c1', 'intro-c1-1', 'intro-c1-2', 'intro-c2', 'intro-c3']))
  })

  it('引言条内的图表编号从引言起算并接续正文，注/脚注与正文一致', () => {
    const outline = docxOutline(pkg)
    expect(outline).toMatch(/SesTblCap │ 表1 │ 引言表/)
    expect(outline).toMatch(/SesFigCap │ 图1 │ 引言图/)
    expect(outline).toMatch(/SesTblCap │ 表2 │ 正文表/)
    expect(outline).toMatch(/SesFigCap │ 图2 │ 正文图/)
    expect(outline).toMatch(/SesNote\w* │ 注[：]? │ 引言条内的注。/)
    expect(pkg.parts['word/footnotes.xml']).toContain('引言条中的脚注。')
    expect(pkg.parts['word/footnotes.xml']!.indexOf('引言条中的脚注。')).toBeLessThan(pkg.parts['word/footnotes.xml']!.indexOf('正文脚注。'))
  })

  it('目次只列「引言」，不列引言条（TOC2 里没有 0.x 条目）', () => {
    const outline = docxOutline(pkg).split('\n')
    expect(outline.some(line => line.startsWith('TOC1') && line.includes('引言'))).toBe(true)
    expect(outline.some(line => line.startsWith('TOC2') && /背景|目的|0\.\d/.test(line))).toBe(false)
    expect(outline.some(line => line.startsWith('TOC2') && line.includes('一般要求'))).toBe(true)
  })

  it('纯函数：同一输入两次输出深度相等', () => {
    expect(renderDocx(doc, resolve(doc).labels, docxOptions)).toEqual(pkg)
  })

  it('无条引言：不输出 A17，numbering.xml 仍是 16 个 abstractNum；引言块照旧渲染', () => {
    const legacy = createG6IrDocWithoutClauses()
    const { pkg: legacyPkg } = docx(legacy)
    const legacyNumbering = legacyPkg.parts['word/numbering.xml']!
    expect(legacyNumbering.match(/<w:abstractNum /g)).toHaveLength(16)
    expect(legacyNumbering).not.toContain('w:abstractNumId="17"')
    expect(legacyNumbering).not.toContain('0.%2')
    expect(docxOutline(legacyPkg)).toContain('SesPara │ — │ 引言的正文。')
    const empty = { ...legacy, front: { ...legacy.front, introductionClauses: [] } }
    expect(docx(empty).pkg).toEqual(legacyPkg)
  })

  it('引言只有条也输出引言节与「引言」标题', () => {
    expect(documentXml).toContain('<w:pStyle w:val="SesFrontTitle"/>')
    expect(docxOutline(pkg)).toContain('SesFrontTitle │ — │ 引言')
  })
})
