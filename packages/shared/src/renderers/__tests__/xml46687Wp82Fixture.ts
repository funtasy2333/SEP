/**
 * WP8.2 全要素夹具（设计 §7.2，T2.6）：直接手写 `IRDoc`，不经 ProseMirror。
 *
 * 目标：命中每个 `obligation ∈ {shall, should}` 且 `export ≠ not-applicable` 的矩阵行至少一次，且 SES 必填元数据（发布机构、
 * 内容语言、发布日期、实施日期）齐全，导出不产生任何 error。内容覆盖：
 *
 * - 元数据：分段题名（中英）、std-ident 全部组成、两个发布机构、版权、被代替/修订的标准、ICS/CCS、归口、custom-meta 六项；
 * - 前言（含多块注）、引言正文 + 引言条（含嵌套条、无标题条）；
 * - 范围章：全部 xref 目标种类（章、条、引言条、附录、表、图、公式、注、示例、术语注、列项、缩略语、文献、术语、索引）、
 *   全部行内标记与其嵌套/合并、变量及其上下标、`stdRef`/`mixedCitation`/外链、条文脚注、换行、行内公式、行内图（S/M/L/无尺寸；资源与 data URL 两种来源）；
 * - 规范性引用文件（`std` 与 `mixed` 条目，`mixed` 内带条文脚注）、术语（`languageSets`、四类描述符、G5 的三种非错误情形、
 *   被引用/未被引用的术语注、术语示例、`tbx:entailedTerm`）、缩略语（被引用/未被引用）；
 * - 列项（五种类型、嵌套、被引用/未被引用的有序项）、注/示例（被引用/未被引用，多块）、警告、摘录、代码；
 * - 表（`col`、`thead`、rowspan/colspan、单元格 style、行 style、表注、表脚注、单位、多块单元格、附录表）、
 *   图（图例、说明段、图注、图中示例、单位、横向、附录图）、公式（有/无编号、公式注、“式中”、附录公式）；
 * - 附录（资料性/规范性）、参考文献（`std` 完整/`mixed`/外链/脚注）、索引（标题、分组、多个条目）。
 *
 * 公式只提供 `latex`（真实 LaTeX，供 io 端到端用 KaTeX 转换）；shared 测试用确定性 MathML 桩（`wp82Options`）。
 * 两处公式（一个行间、一个行内）同时带 IR 自己的 `mathml`，验证“IR 优先”。
 * 图片是真实的 PNG/SVG data URL：块图、行内图各有“资源键”（`IRDoc.resources`）与“内联 data URL”两种来源。
 *
 * 夹具只含手写数据；各节点 id 以 `w82-` 起头，语义即 id。
 */

import type {
  IRAppendix, IRBibEntry, IRBlock, IRChapter, IRClause, IRDefItem, IRDoc, IRExample, IRFigure, IRFormula, IRIndex, IRInline,
  IRList, IRMark, IRNormRefList, IRNote, IRTable, IRTableRow, IRTermEntry, IRTermLanguageSet, NodeId,
} from '../../ir/types'
import type { RenderXml46687Options } from '../xml46687'
import { appendix, chapter, clause, makeDoc, para, run } from './xml46687Kit'
import { stubManifest, stubMathMl } from './xml46687StubKit'

/** 1×1 的最小有效 PNG。 */
export const W82_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** 120×60 的真实 PNG（蓝色）。 */
export const W82_PNG_BLUE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAa0lEQVR42u3QQQ0AAAgEoOsfzwRmMIEtnA82EpDq4UAUiBaNaNGiLYgWjWjRoi2IFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLRrRokUjWjSiRYtGtGhEixaNaNGiES0a0b8s0ipI1zvfEP8AAAAASUVORK5CYII='
/** 极小的有效 SVG（utf8 形式的 data URL）。 */
export const W82_SVG = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')}`

const stdRef: IRMark = { type: 'stdRef' }
const x = (text: string, targetId: NodeId, targetKind: Extract<IRMark, { type: 'crossRef' }>['targetKind']): IRInline =>
  run(text, { type: 'crossRef', targetId, ...(targetKind ? { targetKind } : {}) })
const text = (value: string): IRInline => ({ text: value })
const noteOf = (id: NodeId, ...content: Array<string | IRInline>): IRNote => ({ kind: 'note', id, content: [para(`${id}.p0`, ...content)] })
const exampleOf = (id: NodeId, ...content: Array<string | IRInline>): IRExample => ({ kind: 'example', id, content: [para(`${id}.p0`, ...content)] })
const item = (id: NodeId, ...content: Array<string | IRInline>): IRList['items'][number] => ({ id, content: [para(`${id}.p0`, ...content)] })
const list = (id: NodeId, listType: IRList['listType'], items: IRList['items'], level?: 1 | 2): IRList =>
  ({ kind: 'list', id, listType, ...(level ? { level } : {}), items })
const defItem = (id: NodeId, term: IRInline[], definition: IRInline[]): IRDefItem => ({ id, term, definition })
const inlineImage = (image: Partial<NonNullable<IRInline['image']>> = {}): IRInline => ({ text: '', image: { src: W82_PNG, ...image } })

/** 行内公式：`mathml` 缺省时由 `options.mathml`（shared 的桩、io 的 KaTeX）补。 */
const inlineFormula = (id: NodeId, latex: string, mathml?: string): IRInline =>
  ({ text: '', formula: { id, latex, ...(mathml ? { mathml } : {}) } })

/** 带 IR 自己的 MathML 的公式用的原生 MathML（含命名空间声明，验证 mathml.ts 的规范化）。 */
const NATIVE_MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>c</mi><mo>=</mo><mi>a</mi><mo>+</mo><mi>b</mi></mrow></math>'
const NATIVE_INLINE_MATHML = '<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>'

// ---------- 元数据 ----------
function wp82Meta(): IRDoc['meta'] {
  return {
    standardType: 'gb',
    titleParts: [
      { id: 'w82-tp-zh-intro', lang: 'zh', role: 'intro', content: [text('信息技术')] },
      { id: 'w82-tp-zh-main', lang: 'zh', role: 'main', content: [text('网络设备安全要求')] },
      { id: 'w82-tp-zh-compl', lang: 'zh', role: 'compl', content: [text('第1部分：总则')] },
      { id: 'w82-tp-zh-full', lang: 'zh', role: 'full', content: [text('信息技术 网络设备安全要求 第1部分：总则')] },
      { id: 'w82-tp-en-main', lang: 'en', role: 'main', content: [text('Security requirements for network devices')] },
      { id: 'w82-tp-en-full', lang: 'en', role: 'full', content: [text('Information technology Security requirements for network devices Part 1: General')] },
    ],
    identifiers: [
      {
        id: 'w82-ident-dated', scheme: 'dated', value: 'GB/T 99999.1—2026',
        parts: [
          { id: 'w82-ident-p1', kind: 'originator', content: [text('SAC')] },
          { id: 'w82-ident-p2', kind: 'doc-type', content: [text('GB/T')] },
          { id: 'w82-ident-p3', kind: 'doc-number', content: [text('99999')] },
          { id: 'w82-ident-p4', kind: 'part-number', content: [text('1')] },
          { id: 'w82-ident-p5', kind: 'edition', content: [text('2')] },
          { id: 'w82-ident-p6', kind: 'version', content: [text('1'), run('a', { type: 'sup' })] },
        ],
      },
      { id: 'w82-ident-undated', scheme: 'undated', value: 'GB/T 99999.1', parts: [] },
    ],
    languages: [{ id: 'w82-lang-zh', tag: 'zh' }, { id: 'w82-lang-en', tag: 'en' }],
    publishers: [
      { id: 'w82-pub-1', name: [text('国家市场监督管理总局')], role: 'lead', identifier: 'SAMR' },
      { id: 'w82-pub-2', name: [text('国家标准化管理委员会')], role: 'lead', identifier: 'SAC' },
    ],
    copyrights: [{ id: 'w82-cp-1', statement: [text('版权专有 侵权必究')], year: '2026', holder: [text('国家标准化管理委员会')] }],
    replacedStandards: [
      { id: 'w82-rs-1', reference: 'GB/T 99999.1—2020', relation: 'replaces' },
      { id: 'w82-rs-2', reference: 'GB/T 88888', relation: 'revises' },
    ],
    publishDate: '2026-04-30',
    implementDate: '2026-11-01',
    icsCode: '35.240.30',
    ccsCode: 'L 72',
    technicalCommittee: 'SAC/TC 28',
    filingNo: '2026-0001',
    industryName: '信息技术',
    regionName: '全国',
    coverDesignation: '中华人民共和国国家标准',
    applicant: '起草单位',
    proposer: '提出单位',
  }
}

// ---------- 前言与引言 ----------
function front(): IRDoc['front'] {
  return {
    foreword: [
      para('w82-fw-p1', '本文件按照', run('GB/T 1.1—2020', stdRef), '的规定起草。'),
      {
        kind: 'note', id: 'w82-fw-note', content: [
          para('w82-fw-note-p1', '前言注的第一段。'),
          list('w82-fw-note-l', 'dash', [item('w82-fw-note-i1', '前言注内的列项。')]),
        ],
      },
    ],
    // 引言只有条，没有悬置的正文段（Resolver 的 hanging-paragraph）
    introduction: [],
    introductionClauses: [
      clause('w82-ic1', 1, '背景', [
        clause('w82-ic1-1', 2, '起因', [para('w82-ic1-1-p', '编制起因。'), noteOf('w82-ic1-1-note', '引言条内的注。')]),
        clause('w82-ic1-2', 2, '说明', [para('w82-ic1-2-p', '编制背景。')]),
      ]),
      clause('w82-ic2', 1, '目的', [para('w82-ic2-p', '编制目的，见', x('0.1', 'w82-ic1', 'clause'), '。')]),
      clause('w82-ic3', 1, null, [para('w82-ic3-p', '引言中的无标题条。')]),
    ],
  }
}

// ---------- 范围 ----------
function scopeChapter(): IRChapter {
  return chapter('w82-ch-scope', '范围', [
    // 全部 xref 目标种类。内容取 Resolver 的 refText（作者文本不是内容），文献/术语/索引取 run 自己的文本。
    para('w82-scope-p1',
      '本文件的结构见', x('x', 'w82-ch-norm', 'chapter'), '、', x('x', 'w82-cl-lists', 'clause'), '、', x('x', 'w82-ic1', 'clause'),
      '，附录', x('x', 'w82-app-a', 'appendix'), '，', x('x', 'w82-tab-perf', 'table'), '，', x('x', 'w82-fig-arch', 'figure'),
      '，', x('x', 'w82-f-energy', 'formula'), '；见', x('x', 'w82-note-ref', 'note'), '与', x('x', 'w82-ex-ref', 'example'),
      '，术语注', x('x', 'w82-term-1-note-b', 'note'), '，列项', x('x', 'w82-li-b', 'listItem'),
      '，缩略语', x('x', 'w82-abb-adc', 'abbreviation'), '，图中注', x('x', 'w82-fig-note-b', 'note'),
      '，图中示例', x('x', 'w82-fig-ex', 'example'), '，公式注', x('x', 'w82-f-note-b', 'note'),
      '，文献', run('GB/T 7714', { type: 'bibRef', targetId: 'w82-bib-std' }),
      '与', run('[2]', { type: 'bibRef', targetId: 'w82-bib-book' }),
      '，术语', run('防火墙', { type: 'termRef', targetId: 'w82-term-1' }), '与', run('入侵检测', { type: 'crossRef', targetId: 'w82-term-2', targetKind: 'term' }),
      '，索引', run('索引', { type: 'crossRef', targetId: 'w82-index', targetKind: 'index' }), '。'),
    // 行内标记：单个与嵌套、变量及其上下标、代码、外链、标准引用、非标准化文件引用、条文脚注、换行
    para('w82-scope-p2',
      '格式有', run('粗体', { type: 'bold' }), '、', run('斜体', { type: 'italic' }), '、', run('下划线', { type: 'underline' }),
      '、', run('删除线', { type: 'strike' }), '、上标', run('2', { type: 'sup' }), '、下标', run('i', { type: 'sub' }),
      '，嵌套', run('粗斜下划线', { type: 'bold' }, { type: 'italic' }, { type: 'underline' }),
      '，变量', run('x', { type: 'variable' }), run('2', { type: 'variable' }, { type: 'sup' }), run('i', { type: 'variable' }, { type: 'sub' }),
      '，调用', run('init(&ctx)', { type: 'code' }), '，加粗代码', run('ls', { type: 'bold' }, { type: 'code' }),
      '。参照', run('GB/T 1.1—2020', stdRef), '、加粗的', run('GB/T 20000.1', { type: 'bold' }, stdRef),
      '，另见', run('Example Corp. Interface specification', { type: 'mixedCitation' }), '、', run('《计量法》', { type: 'italic' }, { type: 'mixedCitation' }),
      '，访问', run('示例网站', { type: 'externalLink', href: 'https://example.org/' }), '与', run('邮件', { type: 'bold' }, { type: 'externalLink', href: 'mailto:sac@example.org' }),
      '。脚注', { text: '内容', footnote: { id: 'w82-fn-1', content: [text('正文脚注的内容。')] } },
      '；强制换行：第一行\n第二行，加粗换行', run('甲\n乙', { type: 'bold' }), '。'),
    // 行内公式与行内图
    para('w82-scope-p3',
      '行内公式', inlineFormula('w82-if-1', 'a_i + b^2'), '与', inlineFormula('w82-if-2', 'x^2', NATIVE_INLINE_MATHML),
      '；行内图', inlineImage({ size: 'S' }), inlineImage({ size: 'M', resourceId: 'w82-res-inline' }), inlineImage({ size: 'L', src: W82_SVG }), inlineImage(), '。'),
  ], 'scope')
}

// ---------- 规范性引用文件 ----------
function normRefChapter(): IRChapter {
  const entries: IRNormRefList['entries'] = [
    { kind: 'normRef', id: 'w82-nr-1', entryType: 'std', ref: [text('GB/T 1.1—2020')], title: [text('标准化工作导则 第1部分：标准化文件的结构和起草规则')] },
    { kind: 'normRef', id: 'w82-nr-2', entryType: 'std', ref: [text('GB/T 3102（所有部分）')], title: [text('量和单位')] },
    { kind: 'normRef', id: 'w82-nr-3', entryType: 'mixed', content: [run('《中华人民共和国计量法》', { type: 'italic' })] },
    { kind: 'normRef', id: 'w82-nr-4', entryType: 'mixed', content: [text('Example Corp. Interface specification'), { text: '', footnote: { id: 'w82-fn-nr', content: [text('规范性引用文件条目的脚注。')] } }] },
  ]
  return chapter('w82-ch-norm', '规范性引用文件', [
    para('w82-norm-lead', '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。'),
    { kind: 'normRefList', id: 'w82-nrl', entries },
  ], 'norm-refs')
}

// ---------- 术语和定义 ----------
function languageSet(id: NodeId, language: string, variants: Array<[string, Array<[string, string]>?]>): IRTermLanguageSet {
  return {
    id, language,
    groups: [{
      id: `${id}.g`,
      terms: variants.map(([name, descriptors], index) => ({
        id: `${id}.v${index}`, content: [text(name)],
        descriptors: (descriptors ?? []).map(([kind, value], descriptorIndex) => ({ id: `${id}.v${index}.d${descriptorIndex}`, kind, value: [text(value)] })),
      })),
    }],
  }
}

function termsChapter(): IRChapter {
  const term1: IRTermEntry = {
    kind: 'termEntry', id: 'w82-term-1', term: [text('防火墙')], termEn: [text('firewall')],
    // 条目级领域（规范形式）；术语名在 languageSets 里带四类描述符、两个变体
    subjectField: [text('网络安全')],
    definition: [
      para('w82-term-1-def', '在网络之间执行访问控制策略的系统，见', run('入侵检测', { type: 'termRef', targetId: 'w82-term-2' }), '。'),
      para('w82-term-1-def2', '定义的续段。'),
    ],
    source: [text('GB/T 1.1—2020，3.1')],
    notes: [
      noteOf('w82-term-1-note-a', '没有被引用的术语注，不带 id。'),
      noteOf('w82-term-1-note-b', '被引用的术语注，带 nte_ id。'),
    ],
    examples: [exampleOf('w82-term-1-ex', '术语示例，不写 id。')],
    languageSets: [languageSet('w82-ls-1', 'zh', [
      ['网络防火墙', [['partOfSpeech', 'noun'], ['grammaticalNumber', 'singular'], ['normativeAuthorization', 'preferredTerm'], ['termType', 'fullForm']]],
      ['防护墙', [['normativeAuthorization', 'deprecatedTerm'], ['partOfSpeech', 'noun']]],
    ])],
  }
  const term2: IRTermEntry = {
    kind: 'termEntry', id: 'w82-term-2', term: [text('入侵检测')],
    // 条目级缺失，术语级描述符取值一致 → 提升（warning term-subjectfield-promoted）
    definition: [para('w82-term-2-def', '对网络活动进行监视并识别攻击的过程。')], notes: [], examples: [],
    languageSets: [languageSet('w82-ls-2', 'zh', [
      ['入侵侦测', [['subjectField', '网络安全'], ['partOfSpeech', 'noun'], ['normativeAuthorization', 'admittedTerm']]],
      ['入侵监测', [['subjectField', '网络安全'], ['partOfSpeech', 'noun'], ['normativeAuthorization', 'admittedTerm']]],
    ])],
  }
  const term3: IRTermEntry = {
    kind: 'termEntry', id: 'w82-term-3', term: [text('访问控制')], termEn: [text('access control')],
    // 条目级与术语级并存 → 术语级被忽略（warning term-subjectfield-duplicate）；其余语言集合并到 zh（info term-language-merged）
    subjectField: [text('信息安全')],
    definition: [para('w82-term-3-def', '限制主体对客体访问的措施。')], notes: [], examples: [],
    languageSets: [
      languageSet('w82-ls-3a', 'zh-Hans', [['访问管制', [['subjectField', '信息安全'], ['partOfSpeech', 'noun'], ['normativeAuthorization', 'admittedTerm']]]]),
      languageSet('w82-ls-3b', 'fr', [['contrôle d\'accès', [['partOfSpeech', 'noun'], ['normativeAuthorization', 'preferredTerm']]]]),
    ],
  }
  const term4: IRTermEntry = {
    kind: 'termEntry', id: 'w82-term-4', term: [text('加密')],
    // 领域取值含 marks → 取纯文本（warning mark-dropped-in-text-only）
    subjectField: [run('密码学', { type: 'bold' })],
    definition: [para('w82-term-4-def', '用密码算法变换数据的过程。')], notes: [], examples: [],
  }
  return chapter('w82-ch-terms', '术语和定义', [
    term1,
    term2,
    clause('w82-cl-termgrp', 1, '分类术语', [term3, term4]),
  ], 'terms')
}

// ---------- 缩略语 ----------
function abbreviationChapter(): IRChapter {
  return chapter('w82-ch-abbr', '符号和缩略语', [
    para('w82-abbr-lead', '下列缩略语适用于本文件。'),
    {
      kind: 'defList', id: 'w82-abbr-list', items: [
        defItem('w82-abb-adc', [text('ADC')], [text('模数转换器（Analog-to-Digital Converter）')]),
        defItem('w82-abb-agc', [text('AGC')], [text('自动增益控制')]),
        defItem('w82-abb-co2', [text('CO'), run('2', { type: 'sub' })], [run('二氧化碳', { type: 'bold' })]),
      ],
    },
  ])
}

// ---------- 技术要求 ----------
function listsClause(): IRClause {
  return clause('w82-cl-lists', 1, '列项、注与示例', [
    para('w82-lists-p1',
      '各项要求应符合', x('x', 'w82-cl-tables', 'clause'), '的规定；见', x('x', 'w82-li-n2', 'listItem'), '与', x('x', 'w82-li-r2', 'listItem'), '。'),
    list('w82-list-alpha', 'alpha', [item('w82-li-a', '第一项；'), item('w82-li-b', '第二项（被引用）；'), item('w82-li-c', '第三项。')]),
    list('w82-list-number', 'number', [item('w82-li-n1', '壹；'), item('w82-li-n2', '贰（被引用）。')]),
    list('w82-list-roman', 'roman', [item('w82-li-r1', '准备；'), item('w82-li-r2', '实施（被引用）。')]),
    list('w82-list-dash', 'dash', [item('w82-li-d1', '无序项一；'), item('w82-li-d2', '无序项二。')]),
    list('w82-list-dot', 'dot', [item('w82-li-o1', '圆点项。')]),
    // 嵌套：一级 alpha 内的二级 number 项含嵌套列表（嵌套有序列项按显示形态导出）
    {
      kind: 'list', id: 'w82-list-outer', listType: 'alpha', items: [{
        id: 'w82-li-outer', content: [
          para('w82-li-outer.p0', '外层项，含嵌套列项：'),
          list('w82-list-inner', 'dash', [item('w82-li-inner1', '嵌套项一；'), item('w82-li-inner2', '嵌套项二。')]),
          // 二层 alpha 列项在 HTML/DOCX 显示为间隔号（D-M-17），没有标记：按显示形态导出为 bullet，并给 list-type-normalized
          list('w82-list-inner-alpha', 'alpha', [item('w82-li-inner-a', '二层字母项甲；'), item('w82-li-inner-b', '二层字母项乙。')], 2),
        ],
      }],
    },
    noteOf('w82-note-unref', '没有被引用的注，不带 id。'),
    noteOf('w82-note-ref', '被引用的注，带 note_ id。'),
    { kind: 'note', id: 'w82-note-multi', content: [para('w82-note-multi-p1', '多块注的第一段。'), list('w82-note-multi-l', 'dash', [item('w82-note-multi-i1', '注内列项。')])] },
    exampleOf('w82-ex-ref', '被引用的示例，带 example_ id。'),
    exampleOf('w82-ex-unref', '没有被引用的示例，不带 id。'),
    { kind: 'warning', id: 'w82-warning', content: [para('w82-warning.p0', '警告是带有警告标签的注，不写 id。')] },
    { kind: 'quote', id: 'w82-quote', content: [para('w82-quote.p0', '被缩进的单段引文。')] },
    { kind: 'code', id: 'w82-code', text: 'for (i = 0; i < n; i++) {\n    total += a[i];\n}' },
  ])
}

/** 子条、无标题条与子条之后的尾部注（条内不能同时有悬置的正文段和子条，所以单独成条）。 */
function subClausesClause(): IRClause {
  return clause('w82-cl-subs', 1, '子条与无标题条', [
    clause('w82-cl-sub', 2, '子条', [para('w82-sub-p', '子条正文。')]),
    clause('w82-cl-numbered', 2, null, [para('w82-numbered-p', '无标题条，输出为 numbered-paragraph，没有 title。')]),
    noteOf('w82-note-tail', '子条之后的尾部注：写在子条之后。'),
  ])
}

function cell(
  id: NodeId, content: Array<string | IRInline> | IRBlock[], extra: Partial<IRTableRow['cells'][number]> = {},
): IRTableRow['cells'][number] {
  const blocks: IRBlock[] = content.length > 0 && typeof content[0] === 'object' && 'kind' in (content[0] as object)
    ? content as IRBlock[]
    : [para(`${id}.p0`, ...(content as Array<string | IRInline>))]
  return { id, colspan: 1, rowspan: 1, header: false, content: blocks, ...extra }
}

function tablesClause(): IRClause {
  const perf: IRTable = {
    kind: 'table', id: 'w82-tab-perf', caption: [text('性能'), run('指标', { type: 'bold' })], orientation: 'portrait', headerRowCount: 2,
    width: { value: 66, unit: '%' },
    unit: '单位为毫米',
    columns: [
      { width: { value: 20, unit: '%' }, textAlign: 'left' },
      { width: { value: 50, unit: '%' } },
      { width: { value: 30, unit: '%' }, textAlign: 'center', verticalAlign: 'middle' },
    ],
    rows: [
      { id: 'w82-tab-perf.r0', cells: [
        cell('w82-tab-perf.r0c0', ['项目'], { header: true, rowspan: 2 }),
        cell('w82-tab-perf.r0c1', ['指标'], { header: true, colspan: 2, style: { textAlign: 'center' } }),
      ] },
      { id: 'w82-tab-perf.r1', cells: [
        cell('w82-tab-perf.r1c0', ['下限'], { header: true }),
        cell('w82-tab-perf.r1c1', ['上限'], { header: true, unit: '单位为V' }),
      ] },
      { id: 'w82-tab-perf.r2', style: { textAlign: 'center', verticalAlign: 'middle' }, cells: [
        cell('w82-tab-perf.r2c0', [run('电压', { type: 'italic' }), 'U', run('o', { type: 'sub' })]),
        cell('w82-tab-perf.r2c1', ['3.3'], {
          style: {
            textAlign: 'right', verticalAlign: 'top', backgroundColor: '#eeeeee',
            borderLeft: { value: 2, unit: 'px' }, borderLeftStyle: 'dashed', borderTop: { value: 3, unit: 'px' }, borderBottomStyle: 'none',
          },
        }),
        cell('w82-tab-perf.r2c2', ['5.0', { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'w82-tabfn-a' }] }, { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'w82-tabfn-b' }] }]),
      ] },
      { id: 'w82-tab-perf.r3', cells: [
        cell('w82-tab-perf.r3c0', ['说明']),
        cell('w82-tab-perf.r3c1', [
          para('w82-tab-perf.r3c1.p0', '第一段\n换行后继续'),
          list('w82-tab-perf.r3c1.l', 'dash', [item('w82-tab-perf.r3c1.i1', '单元格内列项。')]),
        ], { colspan: 2 }),
      ] },
    ],
    notes: [noteOf('w82-tab-note-a', '表注（没有被引用）。'), noteOf('w82-tab-note-b', '表注（被引用）。')],
    footnotes: [
      { id: 'w82-tabfn-b', content: [text('第二个表脚注。')] },
      { id: 'w82-tabfn-a', content: [text('第一个表脚注。')] },
    ],
  }
  const wide: IRTable = {
    kind: 'table', id: 'w82-tab-wide', caption: [text('横向表')], orientation: 'landscape', headerRowCount: 0,
    rows: [{ id: 'w82-tab-wide.r0', cells: [cell('w82-tab-wide.r0c0', ['甲']), cell('w82-tab-wide.r0c1', ['乙'])] }],
    notes: [],
  }
  return clause('w82-cl-tables', 1, '表', [
    para('w82-tables-p', '见', x('x', 'w82-tab-wide', 'table'), '，其注见', x('x', 'w82-tab-note-b', 'note'), '。'),
    perf,
    wide,
  ])
}

function figuresClause(): IRClause {
  const arch: IRFigure = {
    kind: 'figure', id: 'w82-fig-arch', caption: [text('系统结构示意')], orientation: 'portrait', src: W82_PNG_BLUE, unit: '单位为毫米',
    descriptions: [{ id: 'w82-fig-desc-1', content: [text('图的说明段一。')] }, { id: 'w82-fig-desc-2', content: [text('图的说明段二，含'), run('粗体', { type: 'bold' })] }],
    legend: {
      id: 'w82-legend', title: [text('图例')],
      items: [
        defItem('w82-lg-1', [text('1')], [text('主电路')]),
        defItem('w82-lg-2', [text('V'), run('o', { type: 'sub' })], [run('输出电压', { type: 'bold' }), text('，见'), x('x', 'w82-tab-perf', 'table')]),
      ],
    },
    notes: [noteOf('w82-fig-note-a', '图注一（没有被引用）。'), noteOf('w82-fig-note-b', '图注二（被引用）。')],
    examples: [exampleOf('w82-fig-ex', '图中示例（被引用）。')],
  }
  const sideways: IRFigure = {
    kind: 'figure', id: 'w82-fig-wide', caption: [text('资源图（横向）')], orientation: 'landscape', src: '', resourceId: 'w82-res-fig', notes: [],
  }
  const svg: IRFigure = { kind: 'figure', id: 'w82-fig-svg', caption: [text('SVG 图')], orientation: 'portrait', src: W82_SVG, notes: [] }
  return clause('w82-cl-figures', 1, '图', [para('w82-figures-p', '见', x('x', 'w82-fig-wide', 'figure'), '。'), arch, sideways, svg])
}

function formulasClause(): IRClause {
  const energy: IRFormula = {
    kind: 'formula', id: 'w82-f-energy', latex: 'E = mc^2', numbered: true,
    whereList: [
      defItem('w82-fw-1', [text('E')], [text('能量')]),
      defItem('w82-fw-2', [text('m')], [text('质量，单位为 kg')]),
      defItem('w82-fw-3', [text('c')], [text('光速，约 3×10'), run('8', { type: 'sup' }), text(' m/s')]),
    ],
    notes: [
      { id: 'w82-f-note-a', content: [text('公式注（没有被引用）。')] },
      { id: 'w82-f-note-b', content: [text('公式注（被引用）。')] },
    ],
  }
  const native: IRFormula = { kind: 'formula', id: 'w82-f-native', latex: 'c = a + b', mathml: NATIVE_MATHML, numbered: false, whereList: [] }
  const frac: IRFormula = { kind: 'formula', id: 'w82-f-frac', latex: '\\frac{a}{b} = \\sqrt{x}', numbered: true, whereList: [] }
  return clause('w82-cl-formulas', 1, '公式', [para('w82-formulas-p', '见', x('x', 'w82-f-frac', 'formula'), '。'), energy, native, frac])
}

function requirementsChapter(): IRChapter {
  return chapter('w82-ch-req', '技术要求', [listsClause(), subClausesClause(), tablesClause(), figuresClause(), formulasClause()])
}

// ---------- 附录 ----------
function appendices(): IRAppendix[] {
  const appTable: IRTable = {
    kind: 'table', id: 'w82-tab-app', caption: [text('附录表')], orientation: 'portrait', headerRowCount: 1, notes: [],
    rows: [
      { id: 'w82-tab-app.r0', cells: [cell('w82-tab-app.r0c0', ['项'], { header: true }), cell('w82-tab-app.r0c1', ['值'], { header: true })] },
      { id: 'w82-tab-app.r1', cells: [cell('w82-tab-app.r1c0', ['x']), cell('w82-tab-app.r1c1', ['y'])] },
    ],
  }
  return [
    appendix('w82-app-a', false, '资料性附录示例', [
      clause('w82-app-a1', 1, '附录中的条', [
        para('w82-app-a1-p', '附录中的条沿用附录字母作编号前缀。'),
        appTable,
        { kind: 'figure', id: 'w82-fig-app', caption: [text('附录图')], orientation: 'portrait', src: W82_PNG, notes: [] },
        { kind: 'formula', id: 'w82-f-app', latex: 'y = kx + b', numbered: true, whereList: [] },
      ]),
    ]),
    appendix('w82-app-b', true, '规范性附录示例', [
      para('w82-app-b-p', '规范性附录的正文。'),
      { kind: 'defList', id: 'w82-abbr-app', items: [defItem('w82-abb-app', [text('UTF-8')], [text('8位统一码转换格式')])] },
    ]),
  ]
}

// ---------- 参考文献与索引 ----------
function bibliography(): IRBibEntry[] {
  return [
    {
      kind: 'bibEntry', id: 'w82-bib-std', content: [text('GB/T 7714 信息与文献 参考文献著录规则')], entryType: 'standard',
      fields: [
        { id: 'w82-bib-std-f1', name: 'std-ref', value: [text('GB/T 7714')] },
        { id: 'w82-bib-std-f2', name: 'title', value: [text('信息与文献 参考文献著录规则')] },
      ],
    },
    { kind: 'bibEntry', id: 'w82-bib-book', content: [text('张伯奥.中医内科学[M].北京:人民卫生出版社,2020.')], externalLink: { href: 'https://example.org/book' } },
    {
      kind: 'bibEntry', id: 'w82-bib-fn',
      content: [text('Example Corp. Interface specification[EB/OL]. '), { text: '', footnote: { id: 'w82-fn-bib', content: [text('参考文献条目的脚注。')] } }],
    },
  ]
}

function indexOf(): IRIndex {
  return {
    id: 'w82-index', title: [text('索引')],
    groups: [
      { id: 'w82-ig-1', label: [text('A')], entries: [
        { id: 'w82-ie-1', term: [text('访问控制')], targets: ['w82-cl-lists', 'w82-tab-perf'], seeAlso: [] },
        { id: 'w82-ie-2', term: [text('ADC')], targets: ['w82-fig-arch'], seeAlso: [] },
      ] },
      { id: 'w82-ig-2', entries: [{ id: 'w82-ie-3', term: [text('防火墙'), run('2', { type: 'sup' })], targets: ['w82-ch-terms'], seeAlso: [] }] },
    ],
  }
}

/** WP8.2 全要素 IR 文档（元数据齐全，导出不产生 error）。 */
export function createWp82Doc(): IRDoc {
  return makeDoc(
    [scopeChapter(), normRefChapter(), termsChapter(), abbreviationChapter(), requirementsChapter()],
    {
      extensionVersion: 1,
      meta: wp82Meta(),
      front: front(),
      appendices: appendices(),
      bibliography: bibliography(),
      index: indexOf(),
      resources: [
        { id: 'w82-res-fig', mediaType: 'image/png', name: 'fig-wide.png', encoding: 'dataUrl', data: W82_PNG_BLUE },
        { id: 'w82-res-inline', mediaType: 'image/png', name: 'inline.png', encoding: 'dataUrl', data: W82_PNG },
      ],
    },
  )
}

/**
 * 生产 ProseMirror 能表示的变体（io 端到端经 `irToPm` → `buildXml46687Package` 用）。`irToPm` 对 IR 里下面两处报
 * `IRToPmError`（生产 Schema 的限制，不是渲染器的限制），所以变体去掉它们，其余内容原样保留：
 *
 * 1. `w82-scope-p2` 里 `bold + code` 的 run：生产 `code` 标记排斥其他行内标记 → 改为只带 `code`；
 * 2. `w82-list-outer`（列项内嵌套列表）：生产 `stdList` 不支持嵌套列表 → 整个块去掉（连同其中二层字母项的 `list-type-normalized` 告警）。
 */
export function createWp82PmRepresentableDoc(): IRDoc {
  const doc = createWp82Doc()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    if (record.id === 'w82-scope-p2' && Array.isArray(record.content)) {
      for (const run of record.content as IRInline[]) {
        if (run.marks?.some(mark => mark.type === 'code') && run.marks.length > 1) run.marks = run.marks.filter(mark => mark.type === 'code')
      }
    }
    if (Array.isArray(record.children)) record.children = (record.children as Array<{ id?: string }>).filter(child => child.id !== 'w82-list-outer')
    for (const child of Object.values(record)) visit(child)
  }
  visit(doc.body)
  return doc
}

/** 公式 NodeId（深度遍历，块公式与行内公式），按文档序，用于生成确定性 MathML 桩。 */
export function formulaIdsOf(doc: IRDoc): NodeId[] {
  const ids: NodeId[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) visit(entry); return }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    if (record.kind === 'formula' && typeof record.id === 'string') ids.push(record.id)
    if (typeof record.text === 'string' && typeof record.formula === 'object' && record.formula !== null) {
      const formula = record.formula as { id?: unknown }
      if (typeof formula.id === 'string') ids.push(formula.id)
    }
    for (const child of Object.values(record)) visit(child)
  }
  visit(doc.front)
  visit(doc.body)
  visit(doc.appendices)
  return ids
}

/** 确定性 MathML 桩：每个公式一个，符号按序号区分（`f1`、`f2`……的第一个字母外加序号），键序即文档序。 */
export function stubMathMlFor(doc: IRDoc): Record<NodeId, string> {
  const map: Record<NodeId, string> = {}
  formulaIdsOf(doc).forEach((id, index) => { map[id] = stubMathMl(`m${index + 1}`) })
  return map
}

/** 渲染选项：确定性 MathML 桩 + 由 `collectXml46687ImageRefs` 生成的假资源清单。 */
export function wp82Options(doc: IRDoc): RenderXml46687Options {
  return { mathml: stubMathMlFor(doc), resources: stubManifest(doc) }
}

export type { IRBlock }
