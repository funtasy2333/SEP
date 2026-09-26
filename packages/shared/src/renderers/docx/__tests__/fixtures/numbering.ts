/**
 * `numbering` 一致性 fixture（docs/wp7-docx-delivery.md §9 WP7.2「numbering」）。
 *
 * 手写 IRDoc（不经 pmToIr，以便覆盖 pmToIr 产生不了的结构）。覆盖 §9 列出的全部项：
 * 前言两条注一个示例；引言一图一注（图号从引言起算）；两层以上有标题条；无标题条（首块段落 /
 * 首块列表）；新章首条从 N.1 起；深度 5 条链；level 与深度不一致的条；章直属两条术语（一条带
 * termEn/定义/两示例/两注/来源）、条内术语、附录直属术语；注的交错（§4.3）、两段单条注、多条注
 * 中一条两段、首块非段落的注；同作用域两示例；alpha/number/roman/romanUpper/boxed 列项、
 * dash 嵌 number（新实例）、三层嵌套（含嵌在字母列表里的 dash 与非 dash）、一项两段、首块是
 * 嵌套列表的项；正文两图两表跨章，附录 A/B 各有图表（A 至少两图）；公式编号/不编号各一；参考
 * 文献三条（跨 run 前缀剥离一条）；条/图/表/公式/参考文献交叉引用各一处。
 *
 * 每个带编号段落都嵌入期望标记（〔期望X〕/〔前段期望X〕/〔附录期望X〕），供 §10.3 expect.py
 * 在 Word 实际排出的 PDF 上核对，也供本文件同目录的一致性测试核对模拟器输出。
 */

import type {
  IRAppendix,
  IRBlock,
  IRChapter,
  IRClause,
  IRClauseChild,
  IRDoc,
  IRExample,
  IRFigure,
  IRInline,
  IRList,
  IRNote,
  IRParagraph,
  IRTable,
  IRTermEntry,
  NodeId,
  ResolvedLabel,
} from '../../../../ir/types'

function t(text: string): IRInline {
  return { text }
}
function boldText(text: string): IRInline {
  return { text, marks: [{ type: 'bold' }] }
}
function xref(text: string, targetId: NodeId): IRInline {
  return { text, marks: [{ type: 'crossRef', targetId }] }
}
function para(id: NodeId, ...runs: IRInline[]): IRParagraph {
  return { kind: 'paragraph', id, content: runs }
}

interface MarkerTarget {
  nodeId: NodeId
  content: IRInline[]
}

export interface NumberingFixture {
  doc: IRDoc
  /** 列项（Resolver 不给 label）的手写期望：nodeId -> 标识文本（如 "a)"） */
  listItemExpected: Map<NodeId, string>
  /** resolve(doc) 之后调用：把 labels 里的标识写成期望标记，注入到对应段落的行内内容里 */
  applyExpectMarkers: (labels: Record<NodeId, ResolvedLabel>) => void
}

export function buildNumberingFixture(): NumberingFixture {
  const selfTargets: MarkerTarget[] = []
  const prevTargets: MarkerTarget[] = []
  const appendixTargets: MarkerTarget[] = []
  const listItemExpected = new Map<NodeId, string>()

  function markSelf(nodeId: NodeId, content: IRInline[]): IRInline[] {
    selfTargets.push({ nodeId, content })
    return content
  }
  function markPrev(nodeId: NodeId, content: IRInline[]): IRInline[] {
    prevTargets.push({ nodeId, content })
    return content
  }
  function markAppendix(nodeId: NodeId, content: IRInline[]): IRInline[] {
    appendixTargets.push({ nodeId, content })
    return content
  }
  /** 列项自身编号：期望文本立即可知（不依赖 Resolver），直接写死标记并记入 listItemExpected */
  function markListItemSelf(itemId: NodeId, expected: string, content: IRInline[]): void {
    listItemExpected.set(itemId, expected)
    content.push(t(`〔期望${expected}〕`))
  }
  function markListItemPrevText(expected: string, content: IRInline[]): void {
    content.push(t(`〔前段期望${expected}〕`))
  }

  // ==================== 前言、引言 ====================

  const fwNote1P = para('fw-note1-p', t('前言首条注释'))
  const fwNote1: IRNote = { kind: 'note', id: 'fw-note1', content: [fwNote1P] }
  markSelf('fw-note1', fwNote1P.content)

  const fwNote2P = para('fw-note2-p', t('前言次条注释'))
  const fwNote2: IRNote = { kind: 'note', id: 'fw-note2', content: [fwNote2P] }
  markSelf('fw-note2', fwNote2P.content)

  const fwEx1P = para('fw-ex1-p', t('前言示例内容'))
  const fwEx1: IRExample = { kind: 'example', id: 'fw-ex1', content: [fwEx1P] }
  markPrev('fw-ex1', fwEx1P.content)

  const foreword: IRBlock[] = [para('fw-intro', t('本文件前言说明文字。')), fwNote1, fwNote2, fwEx1]

  const introFigCaption: IRInline[] = [t('引言图')]
  const introFig: IRFigure = { kind: 'figure', id: 'intro-fig', caption: introFigCaption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [] }
  markSelf('intro-fig', introFigCaption)

  const introNoteP = para('intro-note-p', t('引言注释内容'))
  const introNote: IRNote = { kind: 'note', id: 'intro-note', content: [introNoteP] }
  markSelf('intro-note', introNoteP.content)

  const introduction: IRBlock[] = [para('intro-p', t('引言说明文字。')), introFig, introNote]

  // ==================== 章 1：范围 ====================

  const ch1cl1Title: IRInline[] = [t('内容概述')]
  const ch1cl1: IRClause = { kind: 'clause', id: 'ch1-cl1', level: 1, titled: true, title: ch1cl1Title, children: [para('ch1-cl1-p', t('范围章的内容说明。'))] }
  markSelf('ch1-cl1', ch1cl1Title)

  const ch1Title: IRInline[] = [t('范围')]
  const chapter1: IRChapter = { kind: 'chapter', id: 'ch1', secType: 'scope', title: ch1Title, children: [ch1cl1] }
  markSelf('ch1', ch1Title)

  // ==================== 章 2：规范性引用文件 ====================

  const ch2Title: IRInline[] = [t('规范性引用文件')]
  const chapter2: IRChapter = { kind: 'chapter', id: 'ch2', secType: 'norm-refs', title: ch2Title, children: [para('ch2-p', t('本文件没有规范性引用文件。'))] }
  markSelf('ch2', ch2Title)

  // ==================== 章 3：术语和定义 ====================

  const tRichTerm: IRInline[] = [t('标准')]
  const tRichTermEn: IRInline[] = [t('standard')]
  markPrev('t-rich', tRichTerm)
  const tRichEx1P = para('t-rich-ex1-p', t('术语示例一'))
  const tRichEx1: IRExample = { kind: 'example', id: 't-rich-ex1', content: [tRichEx1P] }
  markPrev('t-rich-ex1', tRichEx1P.content)
  const tRichEx2P = para('t-rich-ex2-p', t('术语示例二'))
  const tRichEx2: IRExample = { kind: 'example', id: 't-rich-ex2', content: [tRichEx2P] }
  markPrev('t-rich-ex2', tRichEx2P.content)
  const tRichNote1P = para('t-rich-note1-p', t('术语注释一'))
  const tRichNote1: IRNote = { kind: 'note', id: 't-rich-note1', content: [tRichNote1P] }
  markSelf('t-rich-note1', tRichNote1P.content)
  const tRichNote2P = para('t-rich-note2-p', t('术语注释二'))
  const tRichNote2: IRNote = { kind: 'note', id: 't-rich-note2', content: [tRichNote2P] }
  markSelf('t-rich-note2', tRichNote2P.content)
  const tRich: IRTermEntry = {
    kind: 'termEntry',
    id: 't-rich',
    term: tRichTerm,
    termEn: tRichTermEn,
    definition: [para('t-rich-def', t('通过标准化活动制定的文件。'))],
    source: [t('[来源：GB/T 20000.1—2014，5.3]')],
    examples: [tRichEx1, tRichEx2],
    notes: [tRichNote1, tRichNote2],
  }

  const tSimpleTerm: IRInline[] = [t('术语')]
  markPrev('t-simple', tSimpleTerm)
  const tSimple: IRTermEntry = {
    kind: 'termEntry',
    id: 't-simple',
    term: tSimpleTerm,
    definition: [para('t-simple-def', t('本文件使用的一般性术语。'))],
    notes: [],
    examples: [],
  }

  const tNestedTerm: IRInline[] = [t('嵌套术语')]
  markPrev('t-nested', tNestedTerm)
  const tNested: IRTermEntry = {
    kind: 'termEntry',
    id: 't-nested',
    term: tNestedTerm,
    definition: [para('t-nested-def', t('条内出现的术语条目。'))],
    notes: [],
    examples: [],
  }

  const figCh3Caption: IRInline[] = [t('术语章示例图')]
  const figCh3: IRFigure = { kind: 'figure', id: 'fig-ch3', caption: figCh3Caption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [] }
  markSelf('fig-ch3', figCh3Caption)

  const tblCh3Caption: IRInline[] = [t('术语章示例表')]
  const tblCh3: IRTable = {
    kind: 'table', id: 'tbl-ch3', caption: tblCh3Caption, orientation: 'portrait', headerRowCount: 1,
    rows: [{ id: 'tbl-ch3-r1', cells: [{ id: 'tbl-ch3-c1', colspan: 1, rowspan: 1, header: true, content: [] }] }],
    notes: [],
  }
  markSelf('tbl-ch3', tblCh3Caption)

  const ch3ClExtraTitle: IRInline[] = [t('补充说明')]
  markSelf('ch3-cl-extra', ch3ClExtraTitle)
  const ch3ClExtra: IRClause = {
    kind: 'clause', id: 'ch3-cl-extra', level: 1, titled: true, title: ch3ClExtraTitle,
    children: [tNested, figCh3, tblCh3],
  }

  const ch3Title: IRInline[] = [t('术语和定义')]
  const chapter3: IRChapter = {
    kind: 'chapter', id: 'ch3', secType: 'terms', title: ch3Title,
    children: [para('ch3-intro', t('下列术语和定义适用于本文件。')), tRich, tSimple, ch3ClExtra],
  }
  markSelf('ch3', ch3Title)

  // ==================== 章 4：技术要求 ====================

  // ---- 4.1 总体要求：交叉引用 + 注交错 + 公式 ----

  const xrefPara = para(
    'ch4-cl1-xref-p',
    t('详见'), xref('内容概述', 'ch1-cl1'), t('、'), xref('图', 'fig-ch3'), t('、'),
    xref('表', 'tbl-ch3'), t('、'), xref('公式', 'formula-numbered'), t('与'), xref('文献', 'bib-2'), t('。'),
  )

  const cl41NoteAP = para('cl41-noteA-p', t('条内首条注释'))
  const cl41NoteA: IRNote = { kind: 'note', id: 'cl41-noteA', content: [cl41NoteAP] }
  markSelf('cl41-noteA', cl41NoteAP.content)

  const figInterleaveCaption: IRInline[] = [t('交错示例图')]
  const figIntlN1P = para('fig-intl-n1-p', t('交错图注一'))
  const figIntlN1: IRNote = { kind: 'note', id: 'fig-intl-n1', content: [figIntlN1P] }
  markSelf('fig-intl-n1', figIntlN1P.content)
  const figIntlN2P = para('fig-intl-n2-p', t('交错图注二'))
  const figIntlN2: IRNote = { kind: 'note', id: 'fig-intl-n2', content: [figIntlN2P] }
  markSelf('fig-intl-n2', figIntlN2P.content)
  const figInterleave: IRFigure = {
    kind: 'figure', id: 'fig-interleave', caption: figInterleaveCaption, orientation: 'portrait',
    src: 'data:image/png;base64,x', notes: [figIntlN1, figIntlN2],
  }
  markSelf('fig-interleave', figInterleaveCaption)

  const cl41NoteBP = para('cl41-noteB-p', t('条内次条注释'))
  const cl41NoteB: IRNote = { kind: 'note', id: 'cl41-noteB', content: [cl41NoteBP] }
  markSelf('cl41-noteB', cl41NoteBP.content)

  const tbl41Caption: IRInline[] = [t('总体要求示例表')]
  const tbl41: IRTable = {
    kind: 'table', id: 'tbl-41', caption: tbl41Caption, orientation: 'portrait', headerRowCount: 1,
    rows: [{ id: 'tbl-41-r1', cells: [{ id: 'tbl-41-c1', colspan: 1, rowspan: 1, header: true, content: [] }] }],
    notes: [],
  }
  markSelf('tbl-41', tbl41Caption)

  const formulaNumbered: IRBlock = { kind: 'formula', id: 'formula-numbered', latex: 'E=mc^2', numbered: true, whereList: [] }
  const formulaUnnumbered: IRBlock = { kind: 'formula', id: 'formula-unnumbered', latex: 'x=y', numbered: false, whereList: [] }

  // level 与深度不一致的条（level 写 5，实际嵌套深度为 2）：按深度编号，渲染忽略 level
  const clMismatchTitle: IRInline[] = [t('深度不符样例')]
  markSelf('cl-mismatch', clMismatchTitle)
  const clMismatch: IRClause = { kind: 'clause', id: 'cl-mismatch', level: 5, titled: true, title: clMismatchTitle, children: [para('cl-mismatch-p', t('本条 level 字段故意写错。'))] }

  // ---- 遍历顺序（§4.7）：图的注里再嵌一张图，注里的图应先编号 ----
  // 放在既有三张图（引言图、术语章示例图、交错示例图）之后，避免打乱它们已核对过的编号。
  const figOrderNestedCaption: IRInline[] = [t('图序内嵌图')]
  const figOrderNested: IRFigure = {
    kind: 'figure', id: 'fig-order-nested', caption: figOrderNestedCaption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [],
  }
  markSelf('fig-order-nested', figOrderNestedCaption)
  const figOrderNoteP = para('fig-order-note-p', t('图序注释文字'))
  markSelf('fig-order-note', figOrderNoteP.content)
  const figOrderNote: IRNote = { kind: 'note', id: 'fig-order-note', content: [figOrderNoteP, figOrderNested] }
  const figOrderOuterCaption: IRInline[] = [t('图序外层图')]
  const figOrderOuter: IRFigure = {
    kind: 'figure', id: 'fig-order-outer', caption: figOrderOuterCaption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [figOrderNote],
  }
  markSelf('fig-order-outer', figOrderOuterCaption)

  // ---- 遍历顺序（§4.7）：术语条目的示例与注里各嵌一张图，示例里的图应先编号 ----
  const termFigOrderTerm: IRInline[] = [t('图序术语')]
  markPrev('term-fig-order', termFigOrderTerm)
  const termFigExLeadP = para('term-fig-ex-lead-p', t('术语示例文字'))
  markPrev('term-fig-ex', termFigExLeadP.content) // 示例标识恒为空段（§5.7），marker 放在示例内容第一段
  const termFigExFigCaption: IRInline[] = [t('术语示例图')]
  const termFigExFig: IRFigure = {
    kind: 'figure', id: 'term-fig-ex-fig', caption: termFigExFigCaption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [],
  }
  markSelf('term-fig-ex-fig', termFigExFigCaption)
  const termFigEx: IRExample = { kind: 'example', id: 'term-fig-ex', content: [termFigExLeadP, termFigExFig] }
  const termFigNoteLeadP = para('term-fig-note-lead-p', t('术语注释文字'))
  markSelf('term-fig-note', termFigNoteLeadP.content) // 注的首块是段落：与单条注标识同段
  const termFigNoteFigCaption: IRInline[] = [t('术语注图')]
  const termFigNoteFig: IRFigure = {
    kind: 'figure', id: 'term-fig-note-fig', caption: termFigNoteFigCaption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [],
  }
  markSelf('term-fig-note-fig', termFigNoteFigCaption)
  const termFigNote: IRNote = { kind: 'note', id: 'term-fig-note', content: [termFigNoteLeadP, termFigNoteFig] }
  const termFigOrder: IRTermEntry = {
    kind: 'termEntry', id: 'term-fig-order', term: termFigOrderTerm,
    definition: [para('term-fig-order-def', t('用于验证遍历顺序的术语。'))],
    examples: [termFigEx], notes: [termFigNote],
  }

  const cl41Title: IRInline[] = [t('总体要求')]
  markSelf('cl41', cl41Title)
  const cl41: IRClause = {
    kind: 'clause', id: 'cl41', level: 1, titled: true, title: cl41Title,
    children: [
      xrefPara, cl41NoteA, figInterleave, cl41NoteB, tbl41, formulaNumbered, formulaUnnumbered, clMismatch,
      figOrderOuter, termFigOrder,
    ],
  }

  // ---- 4.2 列项样例 ----

  function listItem(id: NodeId, content: (IRParagraph | IRList)[]): IRList['items'][number] {
    return { id, content }
  }

  // alpha 顶层：item1 带 number 子列表（其中一项两段续段 + 三层嵌套 dash）；item2 带 dash 子列表（一项三层嵌套 number，文字标识）
  const numSub1Item1P = para('alpha-i1-num-i1-p1', t('数字子项一'))
  const numSub1Item1P2 = para('alpha-i1-num-i1-p2', t('数字子项一续段'))
  const dashL3Item1P = para('alpha-i1-num-i1-dash-i1-p', t('破折三层一'))
  const dashL3Item2P = para('alpha-i1-num-i1-dash-i2-p', t('破折三层二'))
  const dashL3: IRList = {
    kind: 'list', id: 'alpha-i1-num-i1-dash', listType: 'dash',
    items: [listItem('alpha-i1-num-i1-dash-i1', [dashL3Item1P]), listItem('alpha-i1-num-i1-dash-i2', [dashL3Item2P])],
  }
  // 第三层及更深的 dash 列项复用 A11 L1（SesListDot，"·"），不是顶层 A11 L0 的「——」
  markListItemSelf('alpha-i1-num-i1-dash-i1', '·', dashL3Item1P.content)
  markListItemSelf('alpha-i1-num-i1-dash-i2', '·', dashL3Item2P.content)

  const numSub1Item2P = para('alpha-i1-num-i2-p', t('数字子项二'))
  const numSub1: IRList = {
    kind: 'list', id: 'alpha-i1-num', listType: 'number',
    items: [
      listItem('alpha-i1-num-i1', [numSub1Item1P, numSub1Item1P2, dashL3]),
      listItem('alpha-i1-num-i2', [numSub1Item2P]),
    ],
  }
  markListItemSelf('alpha-i1-num-i1', '1)', numSub1Item1P.content)
  markListItemSelf('alpha-i1-num-i2', '2)', numSub1Item2P.content)

  const alphaItem1P = para('alpha-i1-p', t('字母项一'))
  markListItemSelf('alpha-i1', 'a)', alphaItem1P.content)

  const dashSub1Item1P = para('alpha-i2-dash-i1-p', t('破折子项一'))
  // 第二层 dash 也复用 A11 L1（"·"），不论上层是什么类型（§4.4）
  markListItemSelf('alpha-i2-dash-i1', '·', dashSub1Item1P.content)
  const numL3Item1P = para('alpha-i2-dash-i2-num-i1-p', t('数字三层一'))
  const numL3Item2P = para('alpha-i2-dash-i2-num-i2-p', t('数字三层二'))
  const numL3: IRList = {
    kind: 'list', id: 'alpha-i2-dash-i2-num', listType: 'number',
    items: [listItem('alpha-i2-dash-i2-num-i1', [numL3Item1P]), listItem('alpha-i2-dash-i2-num-i2', [numL3Item2P])],
  }
  // 第三层及更深的非 dash 列项：文字标识「n)」，不是编号段落，不写期望标记（§9 WP7.2）
  const dashSub1Item2P = para('alpha-i2-dash-i2-p', t('破折子项二'))
  markListItemSelf('alpha-i2-dash-i2', '·', dashSub1Item2P.content)
  const dashSub1: IRList = {
    kind: 'list', id: 'alpha-i2-dash', listType: 'dash',
    items: [listItem('alpha-i2-dash-i1', [dashSub1Item1P]), listItem('alpha-i2-dash-i2', [dashSub1Item2P, numL3])],
  }
  const alphaItem2P = para('alpha-i2-p', t('字母项二'))
  markListItemSelf('alpha-i2', 'b)', alphaItem2P.content)

  const alphaList: IRList = {
    kind: 'list', id: 'list-alpha', listType: 'alpha',
    items: [listItem('alpha-i1', [alphaItem1P, numSub1]), listItem('alpha-i2', [alphaItem2P, dashSub1])],
  }

  // number 顶层：item1 首块是嵌套列表（不是段落）
  const numTopSubItem1P = para('num-top-i1-sub-i1-p', t('数字项一之破折一'))
  markListItemSelf('num-top-i1-sub-i1', '·', numTopSubItem1P.content)
  markListItemPrevText('1)', numTopSubItem1P.content) // 兼作 number 顶层第一项（只有编号）的「前段期望」
  const numTopSubItem2P = para('num-top-i1-sub-i2-p', t('数字项一之破折二'))
  markListItemSelf('num-top-i1-sub-i2', '·', numTopSubItem2P.content)
  const numTopSub: IRList = {
    kind: 'list', id: 'num-top-i1-sub', listType: 'dash',
    items: [listItem('num-top-i1-sub-i1', [numTopSubItem1P]), listItem('num-top-i1-sub-i2', [numTopSubItem2P])],
  }
  markListItemSelf('num-top-i1', '1)', [])
  const numTopItem2P = para('num-top-i2-p', t('数字项二'))
  markListItemSelf('num-top-i2', '2)', numTopItem2P.content)
  const numberList: IRList = {
    kind: 'list', id: 'list-number', listType: 'number',
    items: [listItem('num-top-i1', [numTopSub]), listItem('num-top-i2', [numTopItem2P])],
  }

  const romanItem1P = para('roman-i1-p', t('罗马项一'))
  markListItemSelf('roman-i1', 'i)', romanItem1P.content)
  const romanItem2P = para('roman-i2-p', t('罗马项二'))
  markListItemSelf('roman-i2', 'ii)', romanItem2P.content)
  const romanList: IRList = { kind: 'list', id: 'list-roman', listType: 'roman', items: [listItem('roman-i1', [romanItem1P]), listItem('roman-i2', [romanItem2P])] }

  const romanUpperItem1P = para('romanU-i1-p', t('大写罗马项一'))
  markListItemSelf('romanU-i1', 'I)', romanUpperItem1P.content)
  const romanUpperItem2P = para('romanU-i2-p', t('大写罗马项二'))
  markListItemSelf('romanU-i2', 'II)', romanUpperItem2P.content)
  const romanUpperList: IRList = {
    kind: 'list', id: 'list-romanUpper', listType: 'romanUpper',
    items: [listItem('romanU-i1', [romanUpperItem1P]), listItem('romanU-i2', [romanUpperItem2P])],
  }

  const boxedItem1P = para('boxed-i1-p', t('方框项一'))
  markListItemSelf('boxed-i1', '1)', boxedItem1P.content) // boxed 退化为 number（A13）
  const boxedItem2P = para('boxed-i2-p', t('方框项二'))
  markListItemSelf('boxed-i2', '2)', boxedItem2P.content)
  const boxedList: IRList = { kind: 'list', id: 'list-boxed', listType: 'boxed', items: [listItem('boxed-i1', [boxedItem1P]), listItem('boxed-i2', [boxedItem2P])] }

  // dash 顶层下嵌 number 子列表（新建 A12 实例，用 ilvl1，"1)"）
  const dashNumSubItem1P = para('dash-i1-num-i1-p', t('破折下数字一'))
  markListItemSelf('dash-i1-num-i1', '1)', dashNumSubItem1P.content)
  const dashNumSubItem2P = para('dash-i1-num-i2-p', t('破折下数字二'))
  markListItemSelf('dash-i1-num-i2', '2)', dashNumSubItem2P.content)
  const dashNumSub: IRList = {
    kind: 'list', id: 'dash-i1-num', listType: 'number',
    items: [listItem('dash-i1-num-i1', [dashNumSubItem1P]), listItem('dash-i1-num-i2', [dashNumSubItem2P])],
  }
  const dashTopItem1P = para('dash-i1-p', t('破折顶层项一'))
  markListItemSelf('dash-i1', '——', dashTopItem1P.content)
  const dashTopItem2P = para('dash-i2-p', t('破折顶层项二'))
  markListItemSelf('dash-i2', '——', dashTopItem2P.content)
  const dashWithNumberList: IRList = {
    kind: 'list', id: 'list-dash-with-number', listType: 'dash',
    items: [listItem('dash-i1', [dashTopItem1P, dashNumSub]), listItem('dash-i2', [dashTopItem2P])],
  }

  const cl42Title: IRInline[] = [t('列项样例')]
  markSelf('cl42', cl42Title)
  const cl42: IRClause = {
    kind: 'clause', id: 'cl42', level: 1, titled: true, title: cl42Title,
    children: [alphaList, numberList, romanList, romanUpperList, boxedList, dashWithNumberList],
  }

  // ---- 4.3 单注两段样例 ----

  const note2paraP1 = para('note2para-p1', t('单注首段内容'))
  const note2paraP2 = para('note2para-p2', t('单注续段内容'))
  markSelf('note-2para', note2paraP1.content)
  const note2para: IRNote = { kind: 'note', id: 'note-2para', content: [note2paraP1, note2paraP2] }
  const cl43Title: IRInline[] = [t('单注两段样例')]
  markSelf('cl43', cl43Title)
  const cl43: IRClause = { kind: 'clause', id: 'cl43', level: 1, titled: true, title: cl43Title, children: [note2para] }

  // ---- 4.4 多注两段样例（其中一条两段） ----

  const noteMultiAP = para('note-multiA-p', t('多注甲内容'))
  markSelf('note-multiA', noteMultiAP.content)
  const noteMultiA: IRNote = { kind: 'note', id: 'note-multiA', content: [noteMultiAP] }
  const noteMultiBP1 = para('note-multiB-p1', t('多注乙首段'))
  const noteMultiBP2 = para('note-multiB-p2', t('多注乙续段'))
  markSelf('note-multiB', noteMultiBP1.content)
  const noteMultiB: IRNote = { kind: 'note', id: 'note-multiB', content: [noteMultiBP1, noteMultiBP2] }
  const cl44Title: IRInline[] = [t('多注两段样例')]
  markSelf('cl44', cl44Title)
  const cl44: IRClause = { kind: 'clause', id: 'cl44', level: 1, titled: true, title: cl44Title, children: [noteMultiA, noteMultiB] }

  // ---- 4.5 注首块非段落样例（首块是列表） ----

  const nonParaListItemP = para('note-nonpara-list-i1-p', t('注内列表项'))
  markListItemSelf('note-nonpara-list-i1', 'a)', nonParaListItemP.content)
  markPrev('note-nonpara', nonParaListItemP.content) // 兼作该注（首块非段落）的「前段期望」
  const nonParaList: IRList = { kind: 'list', id: 'note-nonpara-list', listType: 'alpha', items: [listItem('note-nonpara-list-i1', [nonParaListItemP])] }
  const noteNonParaTrailP = para('note-nonpara-trail-p', t('注内后续段落'))
  const noteNonPara: IRNote = { kind: 'note', id: 'note-nonpara', content: [nonParaList, noteNonParaTrailP] }
  const cl45Title: IRInline[] = [t('注首块非段落样例')]
  markSelf('cl45', cl45Title)
  const cl45: IRClause = { kind: 'clause', id: 'cl45', level: 1, titled: true, title: cl45Title, children: [noteNonPara] }

  // ---- 4.6 双示例样例 ----

  const exAP = para('ex-a-p', t('示例甲内容'))
  markPrev('ex-a', exAP.content)
  const exA: IRExample = { kind: 'example', id: 'ex-a', content: [exAP] }
  const exBP = para('ex-b-p', t('示例乙内容'))
  markPrev('ex-b', exBP.content)
  const exB: IRExample = { kind: 'example', id: 'ex-b', content: [exBP] }
  const cl46Title: IRInline[] = [t('双示例样例')]
  markSelf('cl46', cl46Title)
  const cl46: IRClause = { kind: 'clause', id: 'cl46', level: 1, titled: true, title: cl46Title, children: [exA, exB] }

  // ---- 4.7 无标题条：首块为段落 ----

  const noTitleParaFirstP = para('cl47-first-p', t('无标题条首段内容'))
  markSelf('cl47', noTitleParaFirstP.content)
  const cl47: IRClause = {
    kind: 'clause', id: 'cl47', level: 1, titled: false, title: [],
    children: [noTitleParaFirstP, para('cl47-second-p', t('无标题条续段内容'))],
  }

  // ---- 4.8 无标题条：首块为列表 ----

  const noTitleListItemP = para('cl48-list-i1-p', t('无标题条列表项'))
  markListItemSelf('cl48-list-i1', 'a)', noTitleListItemP.content)
  markPrev('cl48', noTitleListItemP.content) // 兼作该无标题条（首块非段落）的「前段期望」
  const cl48List: IRList = { kind: 'list', id: 'cl48-list', listType: 'alpha', items: [listItem('cl48-list-i1', [noTitleListItemP])] }
  const cl48: IRClause = { kind: 'clause', id: 'cl48', level: 1, titled: false, title: [], children: [cl48List] }

  const ch4Title: IRInline[] = [t('技术要求')]
  const chapter4: IRChapter = { kind: 'chapter', id: 'ch4', secType: 'general', title: ch4Title, children: [cl41, cl42, cl43, cl44, cl45, cl46, cl47, cl48] }
  markSelf('ch4', ch4Title)

  // ==================== 章 5：深度链（5 级条） ====================

  const l5Title: IRInline[] = [t('链五')]
  markSelf('cl-l5', l5Title)
  const clL5: IRClause = { kind: 'clause', id: 'cl-l5', level: 5, titled: true, title: l5Title, children: [para('cl-l5-p', t('第五层条文。'))] }
  const l4Title: IRInline[] = [t('链四')]
  markSelf('cl-l4', l4Title)
  const clL4: IRClause = { kind: 'clause', id: 'cl-l4', level: 4, titled: true, title: l4Title, children: [clL5] }
  const l3Title: IRInline[] = [t('链三')]
  markSelf('cl-l3', l3Title)
  const clL3: IRClause = { kind: 'clause', id: 'cl-l3', level: 3, titled: true, title: l3Title, children: [clL4] }
  const l2Title: IRInline[] = [t('链二')]
  markSelf('cl-l2', l2Title)
  const clL2: IRClause = { kind: 'clause', id: 'cl-l2', level: 2, titled: true, title: l2Title, children: [clL3] }
  const l1Title: IRInline[] = [t('链一')]
  markSelf('cl-l1', l1Title)
  const clL1: IRClause = { kind: 'clause', id: 'cl-l1', level: 1, titled: true, title: l1Title, children: [clL2] }

  const ch5Title: IRInline[] = [t('深度链')]
  const chapter5: IRChapter = { kind: 'chapter', id: 'ch5', secType: 'general', title: ch5Title, children: [clL1] }
  markSelf('ch5', ch5Title)

  // ==================== 附录 A（规范性） ====================

  const appATitle: IRInline[] = [t('附录内容一')]
  markAppendix('app-a', appATitle)

  const appATermTerm: IRInline[] = [t('附录术语')]
  markPrev('app-a-term', appATermTerm)
  const appATerm: IRTermEntry = {
    kind: 'termEntry', id: 'app-a-term', term: appATermTerm,
    definition: [para('app-a-term-def', t('附录直属术语的定义。'))], notes: [], examples: [],
  }

  const appAFig1Caption: IRInline[] = [t('附录图一')]
  const appAFig1: IRFigure = { kind: 'figure', id: 'app-a-fig1', caption: appAFig1Caption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [] }
  markSelf('app-a-fig1', appAFig1Caption)
  const appAFig2Caption: IRInline[] = [t('附录图二')]
  const appAFig2: IRFigure = { kind: 'figure', id: 'app-a-fig2', caption: appAFig2Caption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [] }
  markSelf('app-a-fig2', appAFig2Caption)
  const appATblCaption: IRInline[] = [t('附录表一')]
  const appATbl: IRTable = {
    kind: 'table', id: 'app-a-tbl1', caption: appATblCaption, orientation: 'portrait', headerRowCount: 1,
    rows: [{ id: 'app-a-tbl1-r1', cells: [{ id: 'app-a-tbl1-c1', colspan: 1, rowspan: 1, header: true, content: [] }] }], notes: [],
  }
  markSelf('app-a-tbl1', appATblCaption)

  const appAClTitle: IRInline[] = [t('附录条一')]
  markSelf('app-a-cl1', appAClTitle)
  const appACl1: IRClause = {
    kind: 'clause', id: 'app-a-cl1', level: 1, titled: true, title: appAClTitle,
    children: [appAFig1, appAFig2, appATbl],
  }

  const appendixA: IRAppendix = { kind: 'appendix', id: 'app-a', normative: true, title: appATitle, children: [appATerm, appACl1] }

  // ==================== 附录 B（资料性） ====================

  const appBTitle: IRInline[] = [t('附录内容二')]
  markAppendix('app-b', appBTitle)

  const appBFigCaption: IRInline[] = [t('附录B图一')]
  const appBFig: IRFigure = { kind: 'figure', id: 'app-b-fig1', caption: appBFigCaption, orientation: 'portrait', src: 'data:image/png;base64,x', notes: [] }
  markSelf('app-b-fig1', appBFigCaption)
  const appBTblCaption: IRInline[] = [t('附录B表一')]
  const appBTbl: IRTable = {
    kind: 'table', id: 'app-b-tbl1', caption: appBTblCaption, orientation: 'portrait', headerRowCount: 1,
    rows: [{ id: 'app-b-tbl1-r1', cells: [{ id: 'app-b-tbl1-c1', colspan: 1, rowspan: 1, header: true, content: [] }] }], notes: [],
  }
  markSelf('app-b-tbl1', appBTblCaption)
  const appBClTitle: IRInline[] = [t('附录条二')]
  markSelf('app-b-cl1', appBClTitle)
  const appBCl1: IRClause = { kind: 'clause', id: 'app-b-cl1', level: 1, titled: true, title: appBClTitle, children: [appBFig, appBTbl] }

  const appendixB: IRAppendix = { kind: 'appendix', id: 'app-b', normative: false, title: appBTitle, children: [appBCl1] }

  // ==================== 参考文献 ====================

  const bib1Content: IRInline[] = [t('标准一 内容说明')]
  markSelf('bib-1', bib1Content)
  const bib2Content: IRInline[] = [t('标准二 内容说明')]
  markSelf('bib-2', bib2Content)
  // 拆在三个 run 里的「[9] 」前缀：「[」、加粗的「9」、「] 」接正文（§5.12 跨 run 剥离）
  const bib3Content: IRInline[] = [t('['), boldText('9'), t('] 标准三 内容说明')]
  markSelf('bib-3', bib3Content)

  const doc: IRDoc = {
    schemaVersion: 1,
    meta: {
      title: '编号一致性测试文档',
      stdCode: 'GB/T 99999—2026',
      standardType: 'gb',
    },
    front: { foreword, introduction },
    body: [chapter1, chapter2, chapter3, chapter4, chapter5],
    appendices: [appendixA, appendixB],
    bibliography: [
      { kind: 'bibEntry', id: 'bib-1', content: bib1Content },
      { kind: 'bibEntry', id: 'bib-2', content: bib2Content },
      { kind: 'bibEntry', id: 'bib-3', content: bib3Content },
    ],
  }

  return {
    doc,
    listItemExpected,
    applyExpectMarkers(labels: Record<NodeId, ResolvedLabel>) {
      for (const { nodeId, content } of selfTargets) {
        content.push(t(`〔期望${labels[nodeId]?.label ?? ''}〕`))
      }
      for (const { nodeId, content } of prevTargets) {
        content.push(t(`〔前段期望${labels[nodeId]?.label ?? ''}〕`))
      }
      for (const { nodeId, content } of appendixTargets) {
        content.push(t(`〔附录期望${labels[nodeId]?.label ?? ''}〕`))
      }
    },
  }
}
