/**
 * WP8.M G3 测试 fixture：图例、行内图、图注、图中示例。
 * 矩阵行：M-8.5-01～06（图例）、M-8.3-02（行内图）、M-8.2-11（图注）、M-8.4-03（图中示例）。
 * 约定：C-T-27、C-T-29、C-T-31、C-T-32、X-14/15，D-M-08、D-M-09。
 *
 * - IR 原生构造器（`g3IrDoc`）：Resolver、PM 投影、输出边界与渲染器测试共用。
 * - PM JSON 构造器（`g3PmDoc`）：shared 层 pmToIr/irToPm 测试用的纯对象文档（不依赖 Tiptap）。
 *
 * 不修改字节锁定的 fixtures.ts；与 client 侧 `wp8m-g3.ts`（生产 PM JSON）配套。
 *
 * 文档结构（id 即语义）：
 *   g3-scope 范围          ── 引用段：行内图（size=M）+ 引用图1
 *   g3-fig-ch 图的说明      ── 行内图段、图 g3-fig-1（图例 3 项 + 注 ×2 + 示例 ×1）、图 g3-fig-2（注 ×1 + 示例 ×1，无图例）、
 *                            含行内图的列项 / 注 / 表格单元格
 *   附录 A                 ── 图 g3-fig-a1（图例 + 注）
 *
 * 期望标签（Resolver）：图1、图2、图A.1；图1 内 注1：/注2：、示例：；图2 内 注：、示例：（作用域 = 各自的图）；
 * 章内（g3-fig-ch 直属）注 g3-note 为 注：（与图内的注互不影响）。
 */

import type { PMJsonNode } from '../pmToIr'
import type {
  IRAppendix, IRChapter, IRDefItem, IRDoc, IRExample, IRFigure, IRInline, IRLegend, IRNote, IRParagraph, NodeId,
} from '../types'
import { appendix as pmAppendix, chapter as pmChapter, para as pmPara, text as pmText } from './fixtures'

/** 1×1 的最小有效 PNG（行内图 src）。 */
export const G3_INLINE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** 图的主图（与 fixtures.ts 的 FIG_PNG_BLUE 同形，避免依赖其导出常量）。 */
export const G3_FIG_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAa0lEQVR42u3QQQ0AAAgEoOsfzwRmMIEtnA82EpDq4UAUiBaNaNGiLYgWjWjRoi2IFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLRrRokUjWjSiRYtGtGhEixaNaNGiES0a0b8s0ipI1zvfEP8AAAAASUVORK5CYII='

const t = (text: string): IRInline => ({ text })
const plain = (value: string): IRInline[] => [t(value)]

/** 行内图 run：text 恒为空，不带 marks/style（M-8.3-02）。 */
export function inlineImage(image: Partial<NonNullable<IRInline['image']>> = {}): IRInline {
  return { text: '', image: { src: G3_INLINE_PNG, ...image } }
}

export function para(id: NodeId, ...content: IRInline[]): IRParagraph {
  return { kind: 'paragraph', id, content }
}

/** 注 / 示例：content 恰为一个 id 为 `${id}.p0` 的段落（生产单段 note / example 的派生规则）。 */
export function g3Note(id: NodeId, ...content: IRInline[]): IRNote {
  return { kind: 'note', id, content: [para(`${id}.p0`, ...content)] }
}
export function g3Example(id: NodeId, ...content: IRInline[]): IRExample {
  return { kind: 'example', id, content: [para(`${id}.p0`, ...content)] }
}

export function legendItem(id: NodeId, term: string | IRInline[], definition: string | IRInline[]): IRDefItem {
  return { id, term: typeof term === 'string' ? plain(term) : term, definition: typeof definition === 'string' ? plain(definition) : definition }
}

export function g3Legend(id: NodeId, title: string | null, ...items: IRDefItem[]): IRLegend {
  return { id, ...(title !== null ? { title: plain(title) } : {}), items }
}

export function g3Figure(id: NodeId, caption: string, extra: Partial<IRFigure> = {}): IRFigure {
  return { kind: 'figure', id, caption: plain(caption), orientation: 'portrait', src: G3_FIG_PNG, alt: '', notes: [], ...extra }
}

/** 图 1：图例 3 项（一项含加粗与引用）+ 两条注 + 一条示例。 */
export function g3Figure1(): IRFigure {
  return g3Figure('g3-fig-1', '测试图', {
    legend: g3Legend('g3-legend-1', '图例',
      legendItem('g3-lg-1', '1', '主电路'),
      legendItem('g3-lg-2', '2', [t('控制器，见'), { text: '图A.1', marks: [{ type: 'crossRef', targetId: 'g3-fig-a1', targetKind: 'figure' }] }]),
      legendItem('g3-lg-3', [t('V'), { text: 'o', marks: [{ type: 'sub' }] }], [{ text: '输出电压', marks: [{ type: 'bold' }] }]),
    ),
    notes: [g3Note('g3-fig1-n1', t('图注一。')), g3Note('g3-fig1-n2', t('图注二。'))],
    examples: [g3Example('g3-fig1-e1', t('图中示例。'))],
  })
}

/** 图 2：单条注 + 单条示例，无图例；注 / 示例标签不带序号。 */
export function g3Figure2(): IRFigure {
  return g3Figure('g3-fig-2', '第二幅图', {
    notes: [g3Note('g3-fig2-n1', t('唯一图注。'))],
    examples: [g3Example('g3-fig2-e1', t('唯一图示例。'))],
  })
}

/** 附录图：图例（无标题）+ 一条注，用于验证附录内图的编号与图例不赋标签。 */
export function g3AppendixFigure(): IRFigure {
  return g3Figure('g3-fig-a1', '附录图', {
    legend: g3Legend('g3-legend-a1', null, legendItem('g3-lg-a1', 'A', '甲')),
    notes: [g3Note('g3-figa1-n1', t('附录图注。'))],
  })
}

export function g3Appendix(): IRAppendix {
  return {
    kind: 'appendix', id: 'g3-app-a', normative: false, title: plain('补充图'),
    children: [para('g3-app-p', t('下图为补充说明。')), g3AppendixFigure()],
  }
}

/** 含行内图的单元格表格。 */
export function g3Table(): IRChapter['children'][number] {
  return {
    kind: 'table', id: 'g3-tab', caption: plain('含行内图的表'), orientation: 'portrait', headerRowCount: 0, notes: [],
    rows: [{ id: 'g3-tab-r1', cells: [
      { id: 'g3-tab-r1c1', colspan: 1, rowspan: 1, header: false, content: [para('g3-tab-r1c1-p', t('单元格：'), inlineImage({ size: 'S' }))] },
    ] }],
  }
}

/**
 * HTML/DOCX 渲染与边界测试、Resolver 测试共用的 IR 文档。
 * 含全部 G3 结构：图例、行内图（段落 / 列项 / 注 / 单元格）、图注、图中示例。
 */
export function g3IrDoc(): IRDoc {
  const body: IRChapter[] = [
    {
      kind: 'chapter', id: 'g3-scope', secType: 'scope', title: plain('范围'),
      children: [para('g3-scope-p',
        t('本文件的符号'), inlineImage({ size: 'M', alt: '箭头' }), t('见'),
        { text: '图', marks: [{ type: 'crossRef', targetId: 'g3-fig-1', targetKind: 'figure' }] }, t('。'))],
    },
    {
      kind: 'chapter', id: 'g3-fig-ch', secType: 'general', title: plain('图的说明'),
      children: [
        para('g3-ch-p', t('资源图：'), inlineImage({ resourceId: 'g3-res-1', alt: '图标', size: 'S' }), t('，无尺寸图：'), inlineImage()),
        g3Figure1(),
        g3Figure2(),
        { kind: 'list', id: 'g3-list', listType: 'dash', items: [{ id: 'g3-list-i1', content: [para('g3-list-i1.p0', t('列项中的图：'), inlineImage({ size: 'L' }))] }] },
        g3Note('g3-note', t('注中的图：'), inlineImage()),
        g3Table(),
      ],
    },
  ]
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: 'G3 图测试', stdCode: 'GB/T 99999—2026' },
    front: { foreword: [], introduction: [] },
    body,
    appendices: [g3Appendix()],
    bibliography: [],
    resources: [{ id: 'g3-res-1', mediaType: 'image/png', name: 'inline.png', encoding: 'dataUrl', data: G3_INLINE_PNG }],
  }
}

// ---------- PM JSON（shared 层纯对象） ----------

export function pmInlineImage(attrs: Record<string, unknown> = {}): PMJsonNode {
  return { type: 'inlineImage', attrs: { src: G3_INLINE_PNG, resourceId: null, alt: '', size: null, ...attrs } }
}

export function pmLegendItem(nodeId: string, term: string | PMJsonNode[], definition: string | PMJsonNode[]): PMJsonNode {
  const inline = (value: string | PMJsonNode[]): PMJsonNode[] => typeof value === 'string' ? (value ? [pmText(value)] : []) : value
  return {
    type: 'whereItem', attrs: { nodeId },
    content: [{ type: 'whereTerm', content: inline(term) }, { type: 'whereDefinition', content: inline(definition) }],
  }
}

export function pmLegend(nodeId: string, title: string | null, ...items: PMJsonNode[]): PMJsonNode {
  return {
    type: 'figureLegend', attrs: { nodeId },
    content: [...(title !== null ? [{ type: 'figureLegendTitle', content: title ? [pmText(title)] : [] }] : []), ...items],
  }
}

export function pmFigure(nodeId: string, caption: string, ...extra: PMJsonNode[]): PMJsonNode {
  return {
    type: 'figure', attrs: { nodeId, orientation: 'portrait' },
    content: [
      { type: 'figureImage', attrs: { src: G3_FIG_PNG, alt: '' } },
      { type: 'figureCaption', content: [pmText(caption)] },
      ...extra,
    ],
  }
}

export const pmFigureNote = (nodeId: string, ...content: PMJsonNode[]): PMJsonNode => ({ type: 'note', attrs: { nodeId }, content })
export const pmFigureExample = (nodeId: string, ...content: PMJsonNode[]): PMJsonNode => ({ type: 'example', attrs: { nodeId }, content })

/** 含行内图的单元格表格（与 g3Table 同 id：行 / 单元格 / 段落 nodeId 显式给出，pmToIr 不再派生）。 */
export function pmTable(): PMJsonNode {
  return {
    type: 'stdTable', attrs: { nodeId: 'g3-tab' },
    content: [
      { type: 'tableCaption', content: [pmText('含行内图的表')] },
      { type: 'table', content: [{
        type: 'tableRow', attrs: { nodeId: 'g3-tab-r1' },
        content: [{
          type: 'tableCell', attrs: { nodeId: 'g3-tab-r1c1', colspan: 1, rowspan: 1 },
          content: [{ type: 'stdParagraph', attrs: { nodeId: 'g3-tab-r1c1-p' }, content: [pmText('单元格：'), pmInlineImage({ size: 'S' })] }],
        }],
      }] },
    ],
  }
}

/** 与 g3IrDoc 同构的 PM 文档（章：范围、图的说明；附录 A）。 */
export function g3PmDoc(): PMJsonNode {
  const figRef = (targetId: string): PMJsonNode['marks'] => [{ type: 'crossRef', attrs: { targetId, refType: 'figure' } }]
  return {
    type: 'doc',
    attrs: { extensionVersion: 1 },
    content: [
      pmChapter('g3-scope', '范围', pmPara('g3-scope-p',
        pmText('本文件的符号'), pmInlineImage({ size: 'M', alt: '箭头' }), pmText('见'), pmText('图', figRef('g3-fig-1')), pmText('。'))),
      pmChapter('g3-fig-ch', '图的说明',
        pmPara('g3-ch-p', pmText('资源图：'), pmInlineImage({ resourceId: 'g3-res-1', alt: '图标', size: 'S' }), pmText('，无尺寸图：'), pmInlineImage()),
        pmFigure('g3-fig-1', '测试图',
          pmLegend('g3-legend-1', '图例',
            pmLegendItem('g3-lg-1', '1', '主电路'),
            pmLegendItem('g3-lg-2', '2', [pmText('控制器，见'), pmText('图A.1', figRef('g3-fig-a1'))]),
            pmLegendItem('g3-lg-3', [pmText('V'), pmText('o', [{ type: 'subscript' }])], [pmText('输出电压', [{ type: 'bold' }])]),
          ),
          pmFigureNote('g3-fig1-n1', pmText('图注一。')),
          pmFigureNote('g3-fig1-n2', pmText('图注二。')),
          pmFigureExample('g3-fig1-e1', pmText('图中示例。')),
        ),
        pmFigure('g3-fig-2', '第二幅图', pmFigureNote('g3-fig2-n1', pmText('唯一图注。')), pmFigureExample('g3-fig2-e1', pmText('唯一图示例。'))),
        {
          type: 'stdList', attrs: { nodeId: 'g3-list', listType: 'dash', level: 1 },
          content: [{ type: 'stdListItem', attrs: { nodeId: 'g3-list-i1' }, content: [pmText('列项中的图：'), pmInlineImage({ size: 'L' })] }],
        },
        { type: 'note', attrs: { nodeId: 'g3-note' }, content: [pmText('注中的图：'), pmInlineImage()] },
        pmTable(),
      ),
      pmAppendix('g3-app-a', false, '补充图',
        pmPara('g3-app-p', pmText('下图为补充说明。')),
        pmFigure('g3-fig-a1', '附录图',
          pmLegend('g3-legend-a1', null, pmLegendItem('g3-lg-a1', 'A', '甲')),
          pmFigureNote('g3-figa1-n1', pmText('附录图注。')),
        ),
      ),
      // 行内图的 resourceId 指向文档级资源（figureResource 在文档顶层）
      { type: 'figureResource', attrs: { nodeId: 'g3-res-1', mediaType: 'image/png', name: 'inline.png', encoding: 'dataUrl', data: G3_INLINE_PNG } },
    ],
  }
}
