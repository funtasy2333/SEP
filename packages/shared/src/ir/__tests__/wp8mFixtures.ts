/**
 * WP8.M M-Z 全要素 fixture 的 IR 原生版本（docs/wp8.m/design.md §3.6、§4.9 第 1 项）。
 *
 * 与 client 侧 `extensions/__fixtures__/wp8m.ts`（生产 PM JSON）逐节点对应：client 的 wp8mIntegration.test.ts 断言
 * `pmToIr(生产 PM fixture).doc` 与本文件的 {@link createWp8mIrDoc} 深度相等，所以两份文档的 nodeId、内容与顺序必须同步修改。
 * 不修改字节锁定的 fixtures.ts；G1、G3、G8 的构造器直接复用各组 fixture，其余按 IR 原生写法构造。
 *
 * 文档结构：
 *   foreword        多块注 g7-fw-note（G7）
 *   introduction    条 0.1（0.1.1、0.1.2）、0.2、无题条 0.3（G6）
 *   第 1 章 范围          引用缩略语 / 行内图 + 图 / 术语 / 引言条的段落
 *   第 2 章 规范性引用文件  引导语 + 清单（G1）
 *   第 3 章 术语和定义      带领域的术语 3.1…3.3.2（G5）
 *   第 4 章 符号和缩略语    缩略语表（G2）
 *   第 5 章 总体要求        正文 stdRef / mixedCitation（G1）
 *   第 6 章 图的说明        图例、图注、图中示例、行内图（G3）
 *   第 7 章 技术要求        列项引用（G4）
 *   第 8 章 技术要求        罗马列项、多块注 / 示例（G7）
 *   第 9 章 表的版式        名义列宽、分边边框样式（G8）
 *   附录 A（缩略语）、附录 B（图）、附录 C（术语）；参考文献（自定义标题）；图资源
 */

import type {
  IRAppendix, IRBlock, IRChapter, IRClause, IRDefItem, IRDoc, IRInline, IRList, IRMark, IRParagraph, IRTable, NodeId,
} from '../types'
import { g1NormRefList } from './wp8mG1Fixtures'
import { G3_INLINE_PNG, g3Appendix, g3Figure1, g3Figure2, g3Note, inlineImage } from './wp8mG3Fixtures'
import { g8MergedTable, g8TwoColumnTable } from './wp8mG8Fixtures'

const t = (text: string, ...marks: IRMark[]): IRInline => ({ text, ...(marks.length ? { marks } : {}) })
const para = (id: NodeId, ...content: IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content })
const xref = (text: string, targetId: NodeId, targetKind: Extract<IRMark, { type: 'crossRef' }>['targetKind']): IRInline =>
  t(text, { type: 'crossRef', targetId, ...(targetKind ? { targetKind } : {}) })
/** 单段注 / 示例：content 恰为一个 id 为 `${id}.p0` 的段落（生产单段 note / example 的派生规则）。 */
const note = (id: NodeId, ...content: IRInline[]): IRBlock => ({ kind: 'note', id, content: [para(`${id}.p0`, ...content)] })
const item = (id: NodeId, text: string): IRList['items'][number] => ({ id, content: [para(`${id}.p0`, t(text))] })
const list = (id: NodeId, listType: IRList['listType'], items: IRList['items'], level?: 1 | 2): IRList =>
  ({ kind: 'list', id, listType, ...(level ? { level } : {}), items })
const defItem = (id: NodeId, term: IRInline[], definition: IRInline[]): IRDefItem => ({ id, term, definition })

function scopeChapter(): IRChapter {
  return {
    kind: 'chapter', id: 'g1-ch1', secType: 'scope', title: [t('范围')], children: [
      para('g1-ch1-p', t('本文件规定了引用的写法。')),
      para('g2-scope-p', t('本文件使用缩略语'), xref('模数转换器', 'abb-adc', 'abbreviation'), t('与'), xref('计算机断层扫描', 'abb-ct', 'abbreviation'), t('。')),
      para('g3-scope-p', t('本文件的符号'), inlineImage({ size: 'M', alt: '箭头' }), t('见'), xref('图', 'g3-fig-1', 'figure'), t('。')),
      para('wp8m-term-ref', t('术语见'), xref('协会', 'g5-t1', 'term'), t('，领域术语见'), xref('技术规范', 'g5-t331', 'term'), t('。')),
      para('g6-ch1-c1-p', t('见引言'), xref('0.1', 'g6-c1', 'clause'), t('与'), xref('0.1.1', 'g6-c1-1', 'clause'), t('。')),
    ],
  }
}

function normRefsChapter(): IRChapter {
  return {
    kind: 'chapter', id: 'g1-ch2', secType: 'norm-refs', title: [t('规范性引用文件')], children: [
      para('g1-ch2-lead', t('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。')),
      g1NormRefList(),
    ],
  }
}

function termsChapter(): IRChapter {
  return {
    kind: 'chapter', id: 'g5-terms', secType: 'terms', title: [t('术语和定义')], children: [
      para('g5-terms-intro', t('下列术语和定义适用于本文件。')),
      {
        kind: 'termEntry', id: 'g5-t1', level: 1, term: [t('协会')], termEn: [t('association')], subjectField: [t('顾客满意')],
        definition: [para('g5-t1-def', t('由成员组织或个人组成的组织。'))], notes: [], examples: [],
      },
      {
        kind: 'termEntry', id: 'g5-t2', level: 1, term: [t('无领域术语')],
        definition: [para('g5-t2-def', t('没有领域字段的旧式术语条目。'))], notes: [], examples: [],
      },
      {
        kind: 'clause', id: 'g5-c3', level: 1, titled: true, title: [t('分类术语')], children: [
          {
            kind: 'termEntry', id: 'g5-t331', level: 1, term: [t('技术规范')], termEn: [t('technical specification')], subjectField: [t('ISO 和/或 IEC 发布的')],
            definition: [para('g5-t331-def', t('现阶段处在发展阶段的标准化文件。'))],
            source: [t('GB/T 20000.1—2014，5.3')],
            notes: [{ kind: 'note', id: 'g5-t331-note', content: [para('g5-t331-note.p0', t('领域不影响注的编号。'))] }],
            examples: [],
          },
          {
            kind: 'termEntry', id: 'g5-t332', level: 1, term: [t('仅领域术语')], subjectField: [t('化学', { type: 'bold' })],
            definition: [para('g5-t332-def', t('没有英文名、领域含粗体的术语条目。'))], notes: [], examples: [],
          },
        ],
      },
    ],
  }
}

function abbreviationsChapter(): IRChapter {
  return {
    kind: 'chapter', id: 'g2-abbr-ch', secType: 'general', title: [t('符号和缩略语')], children: [
      para('g2-abbr-intro', t('下列缩略语适用于本文件。')),
      {
        kind: 'defList', id: 'g2-list', items: [
          defItem('abb-adc', [t('ADC')], [t('模数转换器（Analog-to-Digital Converter）')]),
          defItem('abb-agc', [t('AGC')], [t('自动增益控制（Automatic Gain Control）')]),
          defItem('abb-ct', [t('CT')], [t('计算机断层扫描，参见'), xref('ADC', 'abb-adc', 'abbreviation'), t('与', { type: 'bold' }), t('电流互感器')]),
        ],
      },
      {
        kind: 'clause', id: 'g2-c41', level: 1, titled: true, title: [t('化学符号')], children: [
          { kind: 'defList', id: 'g2-list-clause', items: [defItem('abb-clause', [t('CO'), t('2', { type: 'sub' })], [t('二氧化碳')])] },
          para('g2-c41-p', t('见'), xref('CO', 'abb-clause', 'abbreviation'), t('。')),
        ],
      },
    ],
  }
}

function requirementsChapter(): IRChapter {
  return {
    kind: 'chapter', id: 'g1-ch3', secType: 'general', title: [t('总体要求')], children: [
      para('g1-ch3-p1', t('量的名称与符号应符合'), t('GB/T 3102.1', { type: 'stdRef' }), t('的规定，并遵守'), t('《中华人民共和国计量法》', { type: 'mixedCitation' }), t('。')),
      para('g1-ch3-p2', t('加粗的标准引用：'), t('GB/T 321', { type: 'bold' }, { type: 'stdRef' }), t('；见'),
        t('2', { type: 'crossRef', targetId: 'g1-ch2', targetKind: 'chapter' }, { type: 'stdRef' })),
      list('g1-list', 'dash', [{ id: 'g1-list-i1', content: [para('g1-list-i1.p0', t('符合'), t('GB/T 321', { type: 'stdRef' }))] }]),
      note('g1-note', t('注中引用'), t('GB/T 3102', { type: 'stdRef' })),
    ],
  }
}

function figuresChapter(): IRChapter {
  return {
    kind: 'chapter', id: 'g3-fig-ch', secType: 'general', title: [t('图的说明')], children: [
      para('g3-ch-p', t('资源图：'), inlineImage({ resourceId: 'g3-res-1', alt: '图标', size: 'S' }), t('，无尺寸图：'), inlineImage()),
      g3Figure1(),
      g3Figure2(),
      list('g3-list', 'dash', [{ id: 'g3-list-i1', content: [para('g3-list-i1.p0', t('列项中的图：'), inlineImage({ size: 'L' }))] }]),
      g3Note('g3-note', t('注中的图：'), inlineImage()),
      {
        kind: 'table', id: 'g3-tab', caption: [t('含行内图的表')], orientation: 'portrait', headerRowCount: 0, notes: [],
        rows: [{ id: 'g3-tab-r1', cells: [
          { id: 'g3-tab-r1c1', colspan: 1, rowspan: 1, header: false, content: [para('g3-tab-r1c1.p0', t('单元格：'), inlineImage({ size: 'S' }))] },
        ] }],
      },
    ],
  }
}

function listRefsChapter(): IRChapter {
  return {
    kind: 'chapter', id: 'g4-ch1', secType: 'general', title: [t('技术要求')], children: [{
      kind: 'clause', id: 'g4-c11', level: 1, titled: true, title: [t('列项')], children: [
        para('g4-ref', t('见'), xref('占位甲', 'g4-a3', 'listItem'), t('与'), xref('占位乙', 'g4-n2', 'listItem')),
        list('g4-l-alpha', 'alpha', [item('g4-a1', '甲'), item('g4-a2', '乙'), item('g4-a3', '丙')]),
        list('g4-l-number', 'number', [item('g4-n1', '壹'), item('g4-n2', '贰')], 2),
        list('g4-l-dash', 'dash', [item('g4-d1', '一'), item('g4-d2', '二')]),
      ],
    }],
  }
}

function notesChapter(): IRChapter {
  const cell = (id: NodeId, header: boolean, content: IRBlock[]) => ({ id, colspan: 1, rowspan: 1, header, content })
  const table: IRTable = {
    kind: 'table', id: 'g7-t1', caption: [t('块注示例表')], orientation: 'portrait', headerRowCount: 1, notes: [],
    rows: [
      { id: 'g7-t1-r1', cells: [cell('g7-t1-h1', true, [para('g7-t1-h1-p', t('项目'))]), cell('g7-t1-h2', true, [para('g7-t1-h2-p', t('说明'))])] },
      { id: 'g7-t1-r2', cells: [
        cell('g7-t1-c1', false, [para('g7-t1-c1-p', t('取值'))]),
        cell('g7-t1-c2', false, [{
          kind: 'note', id: 'g7-t1-note', content: [para('g7-t1-note-p1', t('单元格内注的第一段。')), para('g7-t1-note-p2', t('单元格内注的第二段。'))],
        }]),
      ] },
    ],
  }
  return {
    kind: 'chapter', id: 'g7-ch1', secType: 'general', title: [t('技术要求')], children: [
      {
        kind: 'clause', id: 'g7-c11', level: 1, titled: true, title: [t('列项与注')], children: [
          para('g7-intro', t('分下列步骤，见'), xref('占位甲', 'g7-r3', 'listItem'), t('，并见'), xref('占位乙', 'g7-n3', 'note'), t('。')),
          list('g7-l-roman', 'roman', [item('g7-r1', '准备'), item('g7-r2', '实施'), item('g7-r3', '检查'), item('g7-r4', '处置')]),
          note('g7-n1', t('旧式单段注。')),
          {
            kind: 'note', id: 'g7-n2', content: [
              para('g7-n2-p1', t('多块注的第一段。')),
              para('g7-n2-p2', t('第二段带脚注'), { text: '', footnote: { id: 'g7-fn1', content: [t('注内段落的脚注。')] } }, t('。')),
              list('g7-n2-l', 'dash', [item('g7-n2-i1', '注内列项一'), item('g7-n2-i2', '注内列项二')]),
            ],
          },
          { kind: 'note', id: 'g7-n3', content: [para('g7-n3-p', t('单段但段落 id 非派生的注。'))] },
          { kind: 'example', id: 'g7-e1', content: [para('g7-e1.p0', t('旧式单段示例。'))] },
          {
            kind: 'example', id: 'g7-e2', content: [
              para('g7-e2-p1', t('多块示例的引语：')),
              list('g7-e2-l', 'roman', [item('g7-e2-a', '示例项甲'), item('g7-e2-b', '示例项乙')]),
            ],
          },
        ],
      },
      { kind: 'clause', id: 'g7-c12', level: 1, titled: true, title: [t('表中的块注')], children: [table] },
    ],
  }
}

function tablesChapter(): IRChapter {
  const legacy = (): IRTable => ({
    kind: 'table', id: 'g8-tbl-legacy', caption: [t('旧式表')], orientation: 'portrait', headerRowCount: 1, notes: [],
    rows: [
      { id: 'g8-tbl-legacy.r0', cells: [
        { id: 'g8-tbl-legacy.r0c0', colspan: 1, rowspan: 1, header: true, content: [para('g8-tbl-legacy.r0c0.p0', t('项'))] },
        { id: 'g8-tbl-legacy.r0c1', colspan: 1, rowspan: 1, header: true, content: [para('g8-tbl-legacy.r0c1.p0', t('值'))] },
      ] },
      { id: 'g8-tbl-legacy.r1', cells: [
        { id: 'g8-tbl-legacy.r1c0', colspan: 1, rowspan: 1, header: false, content: [para('g8-tbl-legacy.r1c0.p0', t('x'))] },
        { id: 'g8-tbl-legacy.r1c1', colspan: 1, rowspan: 1, header: false, content: [para('g8-tbl-legacy.r1c1.p0', t('y'))] },
      ] },
    ],
  })
  return {
    kind: 'chapter', id: 'g8-body', secType: 'general', title: [t('表的版式')], children: [
      para('g8-intro', t('见'), xref('表1', 'g8-tbl-2col', 'table'), t('。')),
      g8TwoColumnTable(),
      g8MergedTable(),
      legacy(),
    ],
  }
}

function introductionClauses(): IRClause[] {
  return [
    {
      kind: 'clause', id: 'g6-c1', level: 1, titled: true, title: [t('背景')], children: [
        {
          kind: 'clause', id: 'g6-c1-1', level: 2, titled: true, title: [t('起因')], children: [
            para('g6-c1-1-p', t('编制起因。')),
            note('g6-c1-1-note', t('引言条内的注。')),
          ],
        },
        {
          kind: 'clause', id: 'g6-c1-2', level: 2, titled: true, title: [t('说明')], children: [
            para('g6-c1-2-p', t('本文件的编制背景。'), { text: '', footnote: { id: 'g6-fn1', content: [t('引言条中的脚注。')] } }),
          ],
        },
      ],
    },
    { kind: 'clause', id: 'g6-c2', level: 1, titled: true, title: [t('目的')], children: [para('g6-c2-p', t('编制目的，见'), xref('0.1', 'g6-c1', 'clause'), t('。'))] },
    { kind: 'clause', id: 'g6-c3', level: 1, titled: false, title: [], children: [para('g6-c3-p', t('无标题条的条文。'))] },
  ]
}

function appendices(): IRAppendix[] {
  return [
    {
      kind: 'appendix', id: 'g2-app-a', normative: false, title: [t('补充缩略语')], children: [
        para('g2-app-p', t('下列缩略语适用于本附录。')),
        { kind: 'defList', id: 'g2-list-app', items: [defItem('abb-app', [t('UTF-8')], [t('8位统一码转换格式（8-bit Unicode Transformation Format）')])] },
      ],
    },
    g3Appendix(),
    {
      kind: 'appendix', id: 'g5-app-a', normative: true, title: [t('附录术语')], children: [{
        kind: 'termEntry', id: 'g5-t-app', level: 1, term: [t('附录术语')], subjectField: [t('附录领域')],
        definition: [para('g5-t-app-def', t('附录中的术语。'))], notes: [], examples: [],
      }],
    },
  ]
}

/** 全要素 IR 文档（G1～G8 的全部新结构，见文件头结构表）。 */
export function createWp8mIrDoc(): IRDoc {
  return {
    schemaVersion: 1,
    extensionVersion: 1,
    meta: { standardType: 'gb' },
    front: {
      foreword: [{ kind: 'note', id: 'g7-fw-note', content: [para('g7-fw-note-p1', t('前言注的第一段。')), para('g7-fw-note-p2', t('前言注的第二段。'))] }],
      introduction: [],
      introductionClauses: introductionClauses(),
    },
    body: [scopeChapter(), normRefsChapter(), termsChapter(), abbreviationsChapter(), requirementsChapter(), figuresChapter(), listRefsChapter(), notesChapter(), tablesChapter()],
    appendices: appendices(),
    bibliography: [{ kind: 'bibEntry', id: 'g1-bib-1', content: [t('张三.计量学基础[M].北京:出版社,2020.')] }],
    bibliographyTitle: [t('参考书目')],
    resources: [{ id: 'g3-res-1', mediaType: 'image/png', name: 'inline.png', encoding: 'dataUrl', data: G3_INLINE_PNG }],
  }
}

/** 全要素文档里每个章 / 附录的 id，按文档顺序（供测试按序取用）。 */
export const WP8M_CHAPTER_IDS = ['g1-ch1', 'g1-ch2', 'g5-terms', 'g2-abbr-ch', 'g1-ch3', 'g3-fig-ch', 'g4-ch1', 'g7-ch1', 'g8-body'] as const
export const WP8M_APPENDIX_IDS = ['g2-app-a', 'g3-app-a', 'g5-app-a'] as const
