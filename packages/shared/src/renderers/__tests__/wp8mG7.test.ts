/**
 * WP8.M G7：罗马列项与注/示例块内容的输出边界与本阶段排版（docs/wp8.m/design.md §4.7、§7.1；矩阵 M-5.7-04、M-5.6-05）。
 *
 * D-M-06（A，真排）：HTML 罗马列项用 `lower-roman` 计数器，DOCX 的 A14 抽象编号用 `lowerRoman`；标记与同一输出里的字母/数字列项
 * 一致用全角右括号（i）ii）iii）），与 Resolver 的 `gbT11Strategy.listItem`（半角 `i)`，用于引用文本 refText）的罗马数字序列一致。
 * 多块注/示例（§4.7.2）：HTML 逐块输出（单段输出保持字节不变），DOCX 早已逐块输出（SesNote/SesNoteCont、SesExLabel/SesExText）。
 * 版式依据 GB/T 1.1—2020 10.2.2 列项（第一层字母/破折号编号空两字起排、文字在第五字位）与 10.4.4.1 注、10.4.5 示例。
 */

import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import { gbT11Strategy } from '../../ir/strategies'
import type { IRDoc, IRList } from '../../ir/types'
import { G7_LIST_ITEM_EXPECTED, createG7NoteIrDoc, createG7RomanIrDoc, docWithBlocks, para, simpleList, t } from '../../ir/__tests__/wp8mG7Fixtures'
import { renderDocx } from '../docx'
import { renderDocxTraced } from '../docx/render'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from '../docx/__tests__/helpers/checks'
import { assertCoverage, assertNumberingConsistency, collectNumberedNodeIds } from '../docx/__tests__/helpers/consistency'
import { docxOutline } from '../docx/__tests__/helpers/outline'
import { simulateNumbering } from '../docx/__tests__/helpers/numberingSim'
import { renderHtml } from '../html'
import { getOutputSupportProblems, type OutputBoundaryFormat } from '../outputBoundary'
import { printCss } from '../printCss'

const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']
const docxOptions = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-22T08:00:00.000Z' }

function render(doc: IRDoc, variant: 'screen' | 'print') {
  return renderHtml(doc, resolve(doc).labels, { variant })
}

function docx(doc: IRDoc) {
  const { labels, problems } = resolve(doc)
  expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
  const { pkg, numbered } = renderDocxTraced(doc, labels, docxOptions)
  return { pkg, numbered, labels }
}

/** numbering.xml 里某个 abstractNum 的 XML 片段 */
function abstractNumXml(numberingXml: string, id: number): string {
  const start = numberingXml.indexOf(`<w:abstractNum w:abstractNumId="${id}"`)
  expect(start, `abstractNum ${id}`).toBeGreaterThan(-1)
  return numberingXml.slice(start, numberingXml.indexOf('</w:abstractNum>', start))
}

/** 全角右括号换成半角，用来与 Resolver 的半角标记比较序列（括号宽度是显示约定，罗马数字序列必须一致）。 */
const halfWidth = (marker: string) => marker.replace('）', ')')

// ---------------------------------------------------------------------------------------------------------------------
// M-5.7-04 罗马列项
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-5.7-04] 输出边界：罗马列项对 HTML、DOCX 放行（真排）；XML 系列字段表放行', () => {
  const doc = createG7RomanIrDoc()

  it.each(FORMATS)('%s：没有 unsupported-output（listType 是既有字段，值 roman 不被阻断）', format => {
    expect(getOutputSupportProblems(doc, format)).toEqual([])
  })

  it('romanUpper 同样不被边界阻断（既有行为）：它没有原文取值，两种格式都按数字列项输出，PM 不再产生它', () => {
    const upper = docWithBlocks([simpleList('up', 'romanUpper', ['u1', '项'])])
    for (const format of FORMATS) expect(getOutputSupportProblems(upper, format), format).toEqual([])
  })
})

describe('[M-5.7-04] HTML（screen / print）：罗马列项用 lower-roman 计数器', () => {
  const doc = createG7RomanIrDoc()
  const screen = render(doc, 'screen')
  const print = render(doc, 'print')

  it.each([['screen', screen], ['print', print]] as const)('%s：列表 class 为 ses-list-roman、一级（无 data-level），列项顺序与 id 保留；被引用项带 li_ 锚点', (_name, rawHtml) => {
    const html = rawHtml.replace(/>\n</g, '><') // 渲染器按块换行，比较时只看标签结构
    expect(html).toContain('<div class="ses-list ses-list-roman" data-type="list" data-list-type="roman" data-node-id="g7-l-roman">')
    expect(html).toContain('<div class="ses-list ses-list-roman" data-type="list" data-list-type="roman" data-node-id="g7-l-roman2">')
    expect(html).not.toMatch(/ses-list-roman"[^>]*data-level/)
    expect(html).toContain('<div class="ses-list-item" data-node-id="g7-r3" id="li_1"><span class="ses-list-item-text">检查</span></div>')
    // 引用文本是 Resolver 的 refText（半角 iii)，容器编号 + 标记）；screen 为链接，print 为纯文本
    expect(html).toMatch(/<(?:a|span) class="ses-xref"[^>]*data-ref-target="g7-r3">1\.1 iii\)<\/(?:a|span)>/)
  })

  it('样式：screen 与 print 都用 counter(ses-li, lower-roman) 加全角右括号；大写罗马仍按数字，CSS 里没有 upper-roman', () => {
    const roman = '.ses-list-roman > .ses-list-item::before { content: counter(ses-li, lower-roman) "） "; }'
    const upperAsNumber = '.ses-list-romanUpper > .ses-list-item::before { content: counter(ses-li) "） "; }'
    for (const html of [screen, printCss()]) {
      expect(html).toContain(roman)
      expect(html).toContain(upperAsNumber)
      expect(html).not.toMatch(/counter\(ses-li, upper-roman\)/)
      // 罗马标记宽度不定（viii）、xiii）超过 2 字）：左浮动 + 最小宽 2 字 + 左外边距 -2 字，超宽时文字后移而不重叠；
      // 其他类型仍是绝对定位的 2 字标记框
      expect(html).toContain('.ses-list-roman > .ses-list-item::before { position: static; float: left; min-width: 2em; margin-left: -2em; }')
      expect(html).toContain('.ses-list-item::before {')
    }
    // 与字母/数字列项同一套规则：一级列项 margin-left 2em（空两字起排）、文字在第五字位（padding-left 2em）
    expect(printCss()).toMatch(/\.ses-list \{ margin: 4pt 0 4pt 2em; counter-reset: ses-li; \}/)
    expect(printCss()).toMatch(/\.ses-list-item \{ position: relative; padding-left: 2em; \}/)
  })

  it('每个列表重新起编（counter-reset 在 .ses-list 上），罗马列项与字母列项互不串扰', () => {
    expect(printCss()).toMatch(/\.ses-list \{[^}]*counter-reset: ses-li;/)
    const mixed = docWithBlocks([simpleList('l1', 'roman', ['a', 'x']), simpleList('l2', 'alpha', ['b', 'y'])])
    const html = render(mixed, 'print')
    expect(html).toContain('ses-list-roman')
    expect(html).toContain('ses-list-alpha')
  })

  it('纯函数：同样输入两次输出字节级相同', () => {
    expect(render(doc, 'screen')).toBe(screen)
    expect(render(doc, 'print')).toBe(print)
  })
})

describe('[M-5.7-04] DOCX：A14 抽象编号为 lowerRoman，罗马列项一级、全角右括号', () => {
  const doc = createG7RomanIrDoc()
  const { pkg, numbered, labels } = docx(doc)
  const numberingXml = pkg.parts['word/numbering.xml']!
  const documentXml = pkg.parts['word/document.xml']!

  it('包结构合法：well-formed、子元素顺序、编号完整性', () => {
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
  })

  it('numbering.xml：A14 的 L0 是 lowerRoman `%1）`（缩进、字体同 A12），L1 为间隔号；A12 仍是 lowerLetter、A13 仍是 decimal、A15 仍是 decimal 占位', () => {
    const a14 = abstractNumXml(numberingXml, 14)
    expect(a14).toContain('<w:multiLevelType w:val="multilevel"/>')
    expect(a14).toMatch(/<w:lvl w:ilvl="0">.*<w:numFmt w:val="lowerRoman"\/>.*<w:lvlText w:val="%1）"\/>/)
    expect(a14).toContain('<w:ind w:left="840" w:hanging="420"/>')
    expect(a14).toContain('<w:numFmt w:val="bullet"/>')
    expect(a14).toContain('<w:lvlText w:val="·"/>')
    // 与 A12（字母列项）的区别只有 L0 的 numFmt 与标识 ASCII 字体：Times New Roman（宋体的 ASCII 字母半角等宽，
    // `iii）` 就超出 2 字悬挂量，Word 会把文字推到下一个制表位；Times 的 i 窄，i）～vi） 都落在 2 字内）
    const songLabel = '<w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hAnsi="宋体" w:cs="宋体"/>'
    const romanLabel = '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
    const a12 = abstractNumXml(numberingXml, 12)
    expect(a12.split(songLabel)).toHaveLength(3) // L0、L1 各一次
    expect(a14.replace('lowerRoman', 'lowerLetter').replace(romanLabel, songLabel)).toBe(a12.replace('w:abstractNumId="12"', 'w:abstractNumId="14"'))
    expect(a14.match(/<w:rFonts [^>]*Times New Roman[^>]*\/>/g)).toHaveLength(1)
    expect(abstractNumXml(numberingXml, 13)).toContain('<w:numFmt w:val="decimal"/>')
    expect(abstractNumXml(numberingXml, 15)).toContain('<w:numFmt w:val="decimal"/>')
    expect(numberingXml.match(/w:val="lowerRoman"/g)).toHaveLength(1)
    expect(numberingXml).not.toMatch(/w:val="upperRoman"/)
    expect(numberingXml.match(/<w:abstractNum /g)).toHaveLength(16)
  })

  it('每个罗马列表一个 A14 按需实例（ilvl 0、1 都写 startOverride=1），段落用 SesListItem + 段落级 numPr', () => {
    const instances = [...numberingXml.matchAll(/<w:num w:numId="(\d+)"><w:abstractNumId w:val="14"\/>(.*?)<\/w:num>/g)]
    expect(instances).toHaveLength(2)
    for (const [, , body] of instances) {
      for (const ilvl of [0, 1]) expect(body).toContain(`<w:lvlOverride w:ilvl="${ilvl}"><w:startOverride w:val="1"/></w:lvlOverride>`)
    }
    const numIds = instances.map(match => match[1])
    for (const id of numIds) expect(documentXml).toContain(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`)
    expect(documentXml.match(/<w:pStyle w:val="SesListItem"\/>/g)).toHaveLength(6)
  })

  it('Word 编号模拟器：i） ii） iii） iv），第二个列表重新从 i） 起；与同一文档里字母列项互不串扰', () => {
    const outline = docxOutline(pkg).split('\n')
    const items = outline.filter(line => line.startsWith('SesListItem'))
    expect(items).toEqual([
      'SesListItem │ i） │ 准备', 'SesListItem │ ii） │ 实施', 'SesListItem │ iii） │ 检查', 'SesListItem │ iv） │ 处置',
      'SesListItem │ i） │ 收集', 'SesListItem │ ii） │ 归档',
    ])
    const mixed = docx(docWithBlocks([simpleList('r', 'roman', ['r1', '甲'], ['r2', '乙']), simpleList('a', 'alpha', ['a1', '丙'], ['a2', '丁'])]))
    expect(docxOutline(mixed.pkg).split('\n').filter(line => line.startsWith('SesListItem')))
      .toEqual(['SesListItem │ i） │ 甲', 'SesListItem │ ii） │ 乙', 'SesListItem │ a） │ 丙', 'SesListItem │ b） │ 丁'])
  })

  it('§4.7 一致性：模拟器标识与手写期望逐段一致，且罗马数字序列与 Resolver 的 gbT11Strategy.listItem 一致（括号宽度除外）', () => {
    expect(() => assertNumberingConsistency(pkg, numbered, labels, G7_LIST_ITEM_EXPECTED)).not.toThrow()
    expect(() => assertCoverage(numbered, collectNumberedNodeIds(doc))).not.toThrow()
    const simulated = simulateNumbering(pkg).filter(paragraph => paragraph.label !== undefined && paragraph.styleId === 'SesListItem')
    expect(simulated.map(paragraph => halfWidth(paragraph.label!.replace(/　$/, '')))).toEqual([1, 2, 3, 4, 1, 2].map(n => gbT11Strategy.listItem!('roman', n)))
    // 被引用项的 Resolver 标签就是同一个标记
    expect(labels['g7-r3']!.label).toBe(halfWidth('iii）'))
  })

  it('大写罗马 romanUpper（无原文取值）仍降级为数字列项 1） 2），不产生 upperRoman；roman 作为嵌套列表的父级时子级照常', () => {
    const upper = docx(docWithBlocks([simpleList('up', 'romanUpper', ['u1', '甲'], ['u2', '乙'])]))
    expect(docxOutline(upper.pkg).split('\n').filter(line => line.startsWith('SesListItem'))).toEqual(['SesListItem │ 1） │ 甲', 'SesListItem │ 2） │ 乙'])
    expect(upper.pkg.parts['word/numbering.xml']).not.toMatch(/w:val="upperRoman"/)
    const nested: IRList = {
      kind: 'list', id: 'p', listType: 'roman',
      items: [{ id: 'p1', content: [para('p1.p0', t('外一')), simpleList('p1-sub', 'dot', ['p1-s1', '内一'])] }],
    }
    const result = docx(docWithBlocks([nested]))
    const lines = docxOutline(result.pkg).split('\n').filter(line => /^SesList/.test(line))
    expect(lines).toEqual(['SesListItem │ i） │ 外一', 'SesListDot │ · │ 内一'])
  })

  it('纯函数：同一输入两次输出深度相等', () => {
    expect(renderDocx(doc, resolve(doc).labels, docxOptions)).toEqual(pkg)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// M-5.6-05 注/示例的块内容
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-5.6-05] 输出边界：多块/含列项的注与示例对 HTML、DOCX 放行；内容里的其他块仍按各格式字段表检查', () => {
  const doc = createG7NoteIrDoc()

  it.each(FORMATS)('%s：没有 unsupported-output（note/example 的 content 是既有字段）', format => {
    expect(getOutputSupportProblems(doc, format)).toEqual([])
  })

  it('注里放字段表不允许的块（警告）：HTML、DOCX 仍报问题，路径指向该块', () => {
    const bad = createG7NoteIrDoc()
    const clause = bad.body[0]!.children[0]!
    if (clause.kind !== 'clause') throw new Error('期望条')
    const note = clause.children.find(child => child.id === 'g7-n2')
    if (!note || note.kind !== 'note') throw new Error('期望注')
    note.content.push({ kind: 'warning', id: 'g7-warning', content: [] })
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(bad, format).map(problem => problem.path), format).toEqual([expect.stringContaining('content[3].kind')])
    }
  })
})

describe('[M-5.6-05] HTML（screen / print）：多块注/示例逐块输出，单段输出不变', () => {
  const doc = createG7NoteIrDoc()
  const screen = render(doc, 'screen')
  const print = render(doc, 'print')

  it.each([['screen', screen], ['print', print]] as const)('%s：单段注/示例（含段落 id 非派生的单段）输出与此前逐字节相同——标记 span + 行内内容，无 multi 类', (_name, html) => {
    expect(html).toContain('<div class="ses-note" data-type="note" data-node-id="g7-n1" id="note_1"><span class="ses-note-marker">注1：</span>旧式单段注。</div>')
    expect(html).toContain('<div class="ses-note" data-type="note" data-node-id="g7-n3" id="note_3"><span class="ses-note-marker">注3：</span>段落 id 非派生的单段注。</div>')
    expect(html).toContain('<div class="ses-example" data-type="example" data-node-id="g7-e1" id="example_1"><span class="ses-example-marker">示例1：</span>旧式单段示例。</div>')
  })

  it.each([['screen', screen], ['print', print]] as const)('%s：多块注——标记 span 之后是 .ses-note-body，段落、列项各自成块', (_name, html) => {
    const start = html.indexOf('data-node-id="g7-n2"')
    const note = html.slice(html.lastIndexOf('<div', start), html.indexOf('<div class="ses-note" data-type="note" data-node-id="g7-n3"'))
    expect(note).toContain('<div class="ses-note ses-note-multi" data-type="note" data-node-id="g7-n2" id="note_2"><span class="ses-note-marker">注2：</span><div class="ses-note-body">')
    expect(note).toContain('<p class="ses-paragraph" data-type="paragraph" data-node-id="g7-n2-p1">多块注的第一段。</p><p class="ses-paragraph" data-type="paragraph" data-node-id="g7-n2-p2">多块注的第二段。</p>')
    expect(note).toContain('<div class="ses-list ses-list-dash" data-type="list" data-list-type="dash" data-node-id="g7-n2-l">')
    expect(note.indexOf('多块注的第二段。')).toBeLessThan(note.indexOf('ses-list-dash'))
    // 内容没有被拼成一行：段落之间是块元素边界
    expect(note).not.toContain('多块注的第一段。多块注的第二段。')
  })

  it.each([['screen', screen], ['print', print]] as const)('%s：只含列项的注——标记之后直接是列表块（仍走多块形态）；多块示例——标签单独一行，其下逐块', (_name, html) => {
    expect(html).toContain('<div class="ses-note ses-note-multi" data-type="note" data-node-id="g7-n4" id="note_4"><span class="ses-note-marker">注4：</span><div class="ses-note-body"><div class="ses-list ses-list-alpha"')
    expect(html).toContain('<div class="ses-example ses-example-multi" data-type="example" data-node-id="g7-e2" id="example_2"><div class="ses-example-marker">示例2：</div><p class="ses-paragraph" data-type="paragraph" data-node-id="g7-e2-p1">多块示例的引语：</p><div class="ses-list ses-list-roman"')
  })

  it('编号由 Resolver 给出：同一条内注1：～注4：、示例1：、示例2：连续；渲染器只消费标签', () => {
    const { labels } = resolve(doc)
    expect(['g7-n1', 'g7-n2', 'g7-n3', 'g7-n4'].map(id => labels[id]!.label)).toEqual(['注1：', '注2：', '注3：', '注4：'])
    expect(['g7-e1', 'g7-e2'].map(id => labels[id]!.label)).toEqual(['示例1：', '示例2：'])
    expect(screen.indexOf('注1：')).toBeLessThan(screen.indexOf('注2：'))
    expect(screen.indexOf('注4：')).toBeLessThan(screen.indexOf('示例1：'))
  })

  it('样式：注为 grid 两列（标记在左、内容块在右，续段与列项回行对齐注的文字位置），示例标签块级；screen 与 print 都有', () => {
    for (const css of [screen, printCss()]) {
      expect(css).toContain('.ses-note-multi { display: grid; grid-template-columns: max-content 1fr; }')
      expect(css).toContain('.ses-note-body > .ses-paragraph { text-indent: 0; margin: 0; }')
      expect(css).toContain('.ses-example-multi > .ses-example-marker { display: block; }')
    }
    // 打印沿用小五号、左缩进两字起排（10.4.4.1）
    expect(printCss()).toContain('.ses-note, .ses-example { font-size: var(--ses-fs-xiaowu); margin: 4pt 0 4pt 2em; }')
  })

  it('图注与表注沿用同一渲染（figure.notes 已放行）：多块内容也逐块输出', () => {
    const withFigure: IRDoc = docWithBlocks([{
      kind: 'figure', id: 'fig', caption: [t('示意图')], orientation: 'portrait', alt: '', src: 'data:image/png;base64,QUJD',
      notes: [{ kind: 'note', id: 'fig-note', content: [para('fig-note-p1', t('图注第一段。')), para('fig-note-p2', t('图注第二段。'))] }],
    }])
    const html = render(withFigure, 'print')
    expect(html).toContain('<div class="ses-note ses-note-multi" data-type="note" data-node-id="fig-note" id="note_1"><span class="ses-note-marker">注：</span><div class="ses-note-body"><p class="ses-paragraph"')
    expect(getOutputSupportProblems(withFigure, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(withFigure, 'DOCX')).toEqual([])
  })

  it('纯函数：同样输入两次输出字节级相同', () => {
    expect(render(doc, 'screen')).toBe(screen)
    expect(render(doc, 'print')).toBe(print)
  })
})

describe('[M-5.6-05] DOCX：多块注/示例逐块输出（SesNote/SesNoteCont、SesExLabel/SesExText），编号与 Resolver 一致', () => {
  const doc = createG7NoteIrDoc()
  const { pkg, numbered, labels } = docx(doc)

  it('包结构合法：well-formed、子元素顺序、编号完整性', () => {
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
  })

  it('大纲（Word 编号模拟器）：注2：首段与标识同段，续段用 SesNoteNCont，注内列项照常；示例标识单独一段，其后逐块', () => {
    const lines = docxOutline(pkg).split('\n')
    const body = lines.slice(lines.indexOf('SesPara │ — │ 下列注与示例。'), lines.indexOf('SesEndMark │ — │'))
    expect(body).toEqual([
      'SesPara │ — │ 下列注与示例。',
      'SesNoteN │ 注1： │ 旧式单段注。',
      'SesNoteN │ 注2： │ 多块注的第一段。',
      'SesNoteNCont │ — │ 多块注的第二段。',
      'SesListDash │ —— │ 注内列项一',
      'SesListDash │ —— │ 注内列项二',
      'SesNoteN │ 注3： │ 段落 id 非派生的单段注。',
      'SesNoteN │ 注4： │',
      'SesListItem │ a） │ 仅列项的注一',
      'SesListItem │ b） │ 仅列项的注二',
      'SesExLabelN │ 示例1： │',
      'SesExText │ — │ 旧式单段示例。',
      'SesExLabelN │ 示例2： │',
      'SesExText │ — │ 多块示例的引语：',
      'SesListItem │ i） │ 示例项甲',
      'SesListItem │ ii） │ 示例项乙',
      'SesListItem │ iii） │ 示例项丙',
    ])
  })

  it('§4.7 一致性：模拟器标识与 Resolver 标签/手写列项期望逐段一致；注、示例、列项在 numbered 中恰好出现一次', () => {
    expect(() => assertNumberingConsistency(pkg, numbered, labels, G7_LIST_ITEM_EXPECTED)).not.toThrow()
    expect(() => assertCoverage(numbered, collectNumberedNodeIds(doc))).not.toThrow()
    expect(numbered.filter(trace => trace.kind === 'note').map(trace => trace.nodeId)).toEqual(['g7-n1', 'g7-n2', 'g7-n3', 'g7-n4'])
    expect(numbered.filter(trace => trace.kind === 'example').map(trace => trace.nodeId)).toEqual(['g7-e1', 'g7-e2'])
  })

  it('单条注（作用域内只有一个）：多块内容用 SesNote + SesNoteCont（标识「注：」）；多块示例用 SesExLabel + SesExText', () => {
    const single = docWithBlocks([
      { kind: 'note', id: 's-note', content: [para('s-note-p1', t('唯一注首段。')), para('s-note-p2', t('唯一注续段。'))] },
      { kind: 'example', id: 's-ex', content: [para('s-ex-p1', t('唯一示例引语：')), simpleList('s-ex-l', 'dash', ['s-ex-i1', '项'])] },
    ])
    const { pkg: singlePkg, numbered: singleTrace, labels: singleLabels } = docx(single)
    const lines = docxOutline(singlePkg).split('\n')
    expect(lines).toEqual(expect.arrayContaining([
      'SesNote │ 注： │ 唯一注首段。', 'SesNoteCont │ — │ 唯一注续段。',
      'SesExLabel │ 示例： │', 'SesExText │ — │ 唯一示例引语：', 'SesListDash │ —— │ 项',
    ]))
    expect(() => assertNumberingConsistency(singlePkg, singleTrace, singleLabels, new Map([['s-ex-i1', '——']]))).not.toThrow()
  })

  it('纯函数：同一输入两次输出深度相等', () => {
    expect(renderDocx(doc, resolve(doc).labels, docxOptions)).toEqual(pkg)
  })
})
