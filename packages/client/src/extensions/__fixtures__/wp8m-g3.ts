import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M G3 生产 Schema fixture：图例（M-8.5-01～06）、行内图（M-8.3-02）、图注（M-8.2-11）、图中示例（M-8.4-03）。
 * 仿 wp6.ts 的 pm()/txt() 写法；不修改 wp6.ts（它被多个既有测试共用）。
 *
 * 文档结构（id 即语义）：
 *   g3-scope 范围        ── 引用段：行内图（size=M）+ 引用 图1
 *   g3-fig-ch 图的说明    ── 行内图段、图 g3-fig-1（图例：标题 + 3 项；注 ×2；示例 ×1）、图 g3-fig-2（注 ×1 + 示例 ×1，无图例）、
 *                          含行内图的列项 / 注 / 表格单元格
 *   附录 A               ── 图 g3-fig-a1（无标题图例 + 注）
 *   figureResource g3-res-1 ── 行内图 resourceId 指向的文档级资源
 *
 * 期望标签（Resolver）：图1、图2、图A.1；图1 内 注1：/注2：、示例：；图2 内 注：、示例：（作用域 = 各自的图）；章内 g3-note 为 注：。
 */

const pm = (
  type: string,
  attrs?: Record<string, unknown>,
  content?: PMJsonNode[],
  text?: string,
  marks?: NonNullable<PMJsonNode['marks']>,
): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
  ...(text !== undefined ? { text } : {}),
  ...(marks ? { marks } : {}),
})

const txt = (text: string, marks?: NonNullable<PMJsonNode['marks']>) => pm('text', undefined, undefined, text, marks)
const para = (nodeId: string, ...content: PMJsonNode[]) => pm('stdParagraph', { nodeId }, content)

/** 1×1 的最小有效 PNG。 */
export const G3_INLINE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const FIG_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAa0lEQVR42u3QQQ0AAAgEoOsfzwRmMIEtnA82EpDq4UAUiBaNaNGiLYgWjWjRoi2IFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLRrRokUjWjSiRYtGtGhEixaNaNGiES0a0b8s0ipI1zvfEP8AAAAASUVORK5CYII='

/** 行内图原子：size 缺省为 null（按行高自适应）。 */
export const inlineImage = (attrs: { resourceId?: string | null; alt?: string; size?: string | null } = {}): PMJsonNode =>
  pm('inlineImage', { src: G3_INLINE_PNG, resourceId: attrs.resourceId ?? null, alt: attrs.alt ?? '', size: attrs.size ?? null })

export const legendItem = (nodeId: string, term: PMJsonNode[] | string, definition: PMJsonNode[] | string): PMJsonNode =>
  pm('whereItem', { nodeId }, [
    pm('whereTerm', undefined, typeof term === 'string' ? (term ? [txt(term)] : []) : term),
    pm('whereDefinition', undefined, typeof definition === 'string' ? (definition ? [txt(definition)] : []) : definition),
  ])

export const figureLegend = (nodeId: string, title: string | null, ...items: PMJsonNode[]): PMJsonNode =>
  pm('figureLegend', { nodeId }, [...(title !== null ? [pm('figureLegendTitle', undefined, title ? [txt(title)] : [])] : []), ...items])

export const figureNote = (nodeId: string, text: string): PMJsonNode => pm('note', { nodeId }, [txt(text)])
export const figureExample = (nodeId: string, text: string): PMJsonNode => pm('example', { nodeId }, [txt(text)])

export const figure = (nodeId: string, caption: string, ...extra: PMJsonNode[]): PMJsonNode =>
  pm('figure', { nodeId, orientation: 'portrait' }, [
    pm('figureImage', { src: FIG_PNG, alt: '' }),
    pm('figureCaption', undefined, [txt(caption)]),
    ...extra,
  ])

const figRef = (targetId: string): NonNullable<PMJsonNode['marks']> => [{ type: 'crossRef', attrs: { targetId, refType: 'figure' } }]

/** 全文图注 / 示例的期望标签（Resolver）。 */
export const G3_EXPECTED_NOTE_LABELS: Record<string, { label: string; xmlId: string }> = {
  'g3-fig1-n1': { label: '注1：', xmlId: 'note_1' },
  'g3-fig1-n2': { label: '注2：', xmlId: 'note_2' },
  'g3-fig2-n1': { label: '注：', xmlId: 'note_3' },
  'g3-note': { label: '注：', xmlId: 'note_4' },
  'g3-figa1-n1': { label: '注：', xmlId: 'note_5' },
  'g3-fig1-e1': { label: '示例：', xmlId: 'example_1' },
  'g3-fig2-e1': { label: '示例：', xmlId: 'example_2' },
}

export function createWp8mG3Fixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('chapter', { nodeId: 'g3-scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('g3-scope-p', txt('本文件的符号'), inlineImage({ size: 'M', alt: '箭头' }), txt('见'), txt('图', figRef('g3-fig-1')), txt('。')),
    ]),
    pm('chapter', { nodeId: 'g3-fig-ch' }, [
      pm('chapterTitle', undefined, [txt('图的说明')]),
      para('g3-ch-p', txt('资源图：'), inlineImage({ resourceId: 'g3-res-1', alt: '图标', size: 'S' }), txt('，无尺寸图：'), inlineImage()),
      figure('g3-fig-1', '测试图',
        figureLegend('g3-legend-1', '图例',
          legendItem('g3-lg-1', '1', '主电路'),
          legendItem('g3-lg-2', '2', [txt('控制器，见'), txt('图A.1', figRef('g3-fig-a1'))]),
          legendItem('g3-lg-3', [txt('V'), txt('o', [{ type: 'subscript' }])], [txt('输出电压', [{ type: 'bold' }])]),
        ),
        figureNote('g3-fig1-n1', '图注一。'),
        figureNote('g3-fig1-n2', '图注二。'),
        figureExample('g3-fig1-e1', '图中示例。'),
      ),
      figure('g3-fig-2', '第二幅图', figureNote('g3-fig2-n1', '唯一图注。'), figureExample('g3-fig2-e1', '唯一图示例。')),
      pm('stdList', { nodeId: 'g3-list', listType: 'dash', level: 1 }, [
        pm('stdListItem', { nodeId: 'g3-list-i1' }, [txt('列项中的图：'), inlineImage({ size: 'L' })]),
      ]),
      pm('note', { nodeId: 'g3-note' }, [txt('注中的图：'), inlineImage()]),
      pm('stdTable', { nodeId: 'g3-tab' }, [
        pm('tableCaption', undefined, [txt('含行内图的表')]),
        pm('table', undefined, [
          pm('tableRow', { nodeId: 'g3-tab-r1' }, [
            pm('tableCell', { nodeId: 'g3-tab-r1c1', colspan: 1, rowspan: 1 }, [pm('paragraph', undefined, [txt('单元格：'), inlineImage({ size: 'S' })])]),
          ]),
        ]),
      ]),
    ]),
    pm('appendix', { nodeId: 'g3-app-a', normative: false }, [
      pm('appendixLabel', undefined, [txt('（资料性）')]),
      pm('appendixTitle', undefined, [txt('补充图')]),
      para('g3-app-p', txt('下图为补充说明。')),
      figure('g3-fig-a1', '附录图', figureLegend('g3-legend-a1', null, legendItem('g3-lg-a1', 'A', '甲')), figureNote('g3-figa1-n1', '附录图注。')),
    ]),
    pm('figureResource', { nodeId: 'g3-res-1', mediaType: 'image/png', name: 'inline.png', encoding: 'dataUrl', data: G3_INLINE_PNG }),
  ])
}
