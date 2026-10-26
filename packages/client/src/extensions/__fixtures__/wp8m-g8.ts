import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M G8 生产 Schema fixture：表的名义列宽 `stdTable.columns`（M-6.1-03）与单元格分边边框样式（M-6.3.3.1-01）。
 * 仿 wp6.ts 的 pm()/txt() 写法；不修改 wp6.ts（它被多个既有测试共用）。
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
const cell = (type: 'tableCell' | 'tableHeader', nodeId: string, text: string, attrs: Record<string, unknown> = {}) =>
  pm(type, { nodeId, colspan: 1, rowspan: 1, ...attrs }, [pm('paragraph', undefined, [txt(text)])])
const row = (nodeId: string, ...cells: PMJsonNode[]) => pm('tableRow', { nodeId }, cells)
const table = (nodeId: string, caption: string, rows: PMJsonNode[], attrs: Record<string, unknown> = {}) =>
  pm('stdTable', { nodeId, ...attrs }, [pm('tableCaption', undefined, [txt(caption)]), pm('table', undefined, rows)])

/** 6.1 p22 示例 `<col align="center" valign="middle" width="50%"/>` 的 40% / 60% 变体（生产 PM 形态，四键齐全）。 */
export const G8_COLUMNS_2 = [
  { width: 40, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
  { width: 60, widthUnit: '%', textAlign: null, verticalAlign: null },
]

/** 三列网格：第 2 列没有名义宽度（四键皆 null），第 3 列 50% 右对齐、下对齐。 */
export const G8_COLUMNS_3 = [
  { width: 20, widthUnit: '%', textAlign: null, verticalAlign: null },
  { width: null, widthUnit: null, textAlign: null, verticalAlign: null },
  { width: 50, widthUnit: '%', textAlign: 'right', verticalAlign: 'bottom' },
]

/** 6.3.3.1 p24 示例的四边（左 solid 1px、上 solid 5px、右 none、下 dashed 3px）。 */
export const G8_P24_ATTRS = {
  borderLeft: 1, borderLeftUnit: 'px', borderLeftStyle: 'solid',
  borderTop: 5, borderTopUnit: 'px', borderTopStyle: 'solid',
  borderRightStyle: 'none',
  borderBottom: 3, borderBottomUnit: 'px', borderBottomStyle: 'dashed',
}

export const G8_DOTTED_ATTRS = {
  borderTop: 2, borderTopUnit: 'px', borderTopStyle: 'dotted',
  borderRight: 2, borderRightUnit: 'px', borderRightStyle: 'dotted',
  borderBottom: 2, borderBottomUnit: 'px', borderBottomStyle: 'dotted',
  borderLeft: 2, borderLeftUnit: 'px', borderLeftStyle: 'dotted',
}

/**
 * 全文布局：
 * - g8-tbl-2col：两列，columns 40%/60%，数据行两格带分边边框样式；
 * - g8-tbl-merged：三列网格（colspan=2 的表头、rowspan=2 的单元格），columns 20% / 空 / 50%；
 * - g8-tbl-px：两列，columns 50%/50% 的同时每格带编辑器拖拽得到的 colwidth（px）——两条列宽通路并存；
 * - g8-tbl-legacy：不带 columns 与边框样式的旧式表。
 */
export function createWp8mG8Fixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('chapter', { nodeId: 'g8-scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('g8-scope-p', txt('本文件规定表的列宽与边框样式。')),
    ]),
    pm('chapter', { nodeId: 'g8-body' }, [
      pm('chapterTitle', undefined, [txt('表的版式')]),
      para('g8-intro', txt('见'), txt('表1', [{ type: 'crossRef', attrs: { targetId: 'g8-tbl-2col', refType: 'table' } }]), txt('。')),
      table('g8-tbl-2col', '两列表', [
        row('g8-tbl-2col.r0',
          cell('tableHeader', 'g8-tbl-2col.r0c0', '项目'),
          cell('tableHeader', 'g8-tbl-2col.r0c1', '要求')),
        row('g8-tbl-2col.r1',
          cell('tableCell', 'g8-tbl-2col.r1c0', '甲', G8_P24_ATTRS),
          cell('tableCell', 'g8-tbl-2col.r1c1', '乙', G8_DOTTED_ATTRS)),
      ], { columns: G8_COLUMNS_2 }),
      table('g8-tbl-merged', '合并单元格表', [
        row('g8-tbl-merged.r0',
          cell('tableHeader', 'g8-tbl-merged.r0c0', '合并表头', { colspan: 2 }),
          cell('tableHeader', 'g8-tbl-merged.r0c1', '单列表头')),
        row('g8-tbl-merged.r1',
          cell('tableCell', 'g8-tbl-merged.r1c0', '跨行', { rowspan: 2 }),
          cell('tableCell', 'g8-tbl-merged.r1c1', 'b1'),
          cell('tableCell', 'g8-tbl-merged.r1c2', 'c1')),
        row('g8-tbl-merged.r2',
          cell('tableCell', 'g8-tbl-merged.r2c0', 'b2'),
          cell('tableCell', 'g8-tbl-merged.r2c1', 'c2')),
      ], { columns: G8_COLUMNS_3 }),
      table('g8-tbl-px', '两条通路并存', [
        row('g8-tbl-px.r0',
          cell('tableHeader', 'g8-tbl-px.r0c0', '甲', { colwidth: [200] }),
          cell('tableHeader', 'g8-tbl-px.r0c1', '乙', { colwidth: [320] })),
        row('g8-tbl-px.r1',
          cell('tableCell', 'g8-tbl-px.r1c0', '1', { colwidth: [200] }),
          cell('tableCell', 'g8-tbl-px.r1c1', '2', { colwidth: [320] })),
      ], {
        columns: [
          { width: 50, widthUnit: '%', textAlign: null, verticalAlign: null },
          { width: 50, widthUnit: '%', textAlign: null, verticalAlign: null },
        ],
      }),
      table('g8-tbl-legacy', '旧式表', [
        row('g8-tbl-legacy.r0',
          cell('tableHeader', 'g8-tbl-legacy.r0c0', '项'),
          cell('tableHeader', 'g8-tbl-legacy.r0c1', '值')),
        row('g8-tbl-legacy.r1',
          cell('tableCell', 'g8-tbl-legacy.r1c0', 'x'),
          cell('tableCell', 'g8-tbl-legacy.r1c1', 'y')),
      ]),
    ]),
  ])
}
