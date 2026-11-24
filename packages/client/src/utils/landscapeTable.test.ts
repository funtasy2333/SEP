// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions, createLandscapeTableModalExtensions } from '../extensions/editorExtensions'
import {
  LANDSCAPE_TARGET_WIDTH_PX,
  PORTRAIT_TARGET_WIDTH_PX,
  buildActiveTableAutoWidthTransaction,
  buildActiveTableEvenWidthTransaction,
  buildColwidthTransaction,
  buildMergedStdTableNode,
  computeTableWidthMetrics,
  distributeColumnWidthsByWeights,
  extractStdTableForModal,
  findActiveTableGrid,
  findStdTableByTarget,
  getStdTableGridColwidths,
  isEffectiveLandscapeStdTable,
  mergeModalStdTable,
} from './landscapeTable'

const mainSchema = getSchema(createEditorExtensions())

function sampleStdTableJson(overrides: Partial<PMJsonNode> = {}): PMJsonNode {
  return {
    type: 'stdTable',
    attrs: {
      nodeId: 'tbl-1',
      orientation: 'landscape',
      columns: [
        { width: 30, widthUnit: '%' },
        { width: 70, widthUnit: '%' },
      ],
      ...(overrides.attrs ?? {}),
    },
    content: overrides.content ?? [
      { type: 'tableCaption', content: [{ type: 'text', text: '主要技术指标' }] },
      { type: 'tableCaptionEn', content: [{ type: 'text', text: 'Main technical indicators' }] },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            attrs: { nodeId: 'r0' },
            content: [
              { type: 'tableHeader', attrs: { nodeId: 'c00', colwidth: [200] }, content: [{ type: 'paragraph', attrs: { nodeId: 'p00' }, content: [{ type: 'text', text: '项目' }] }] },
              { type: 'tableHeader', attrs: { nodeId: 'c01', colwidth: [400] }, content: [{ type: 'paragraph', attrs: { nodeId: 'p01' }, content: [{ type: 'text', text: '指标要求' }] }] },
            ],
          },
          {
            type: 'tableRow',
            attrs: { nodeId: 'r1' },
            content: [
              { type: 'tableCell', attrs: { nodeId: 'c10', colwidth: [200] }, content: [{ type: 'paragraph', attrs: { nodeId: 'p10' }, content: [{ type: 'text', text: '含水率' }] }] },
              { type: 'tableCell', attrs: { nodeId: 'c11', colwidth: [400] }, content: [{ type: 'paragraph', attrs: { nodeId: 'p11' }, content: [{ type: 'text', text: '≤ 0.5%' }] }] },
            ],
          },
        ],
      },
      {
        type: 'tableNoteRow',
        content: [{ type: 'note', attrs: { nodeId: 'note-1' }, content: [{ type: 'text', text: '原表注' }] }],
      },
      {
        type: 'tableFootnoteRow',
        content: [{ type: 'tableFootnoteEntry', attrs: { nodeId: 'fn-1' }, content: [{ type: 'text', text: '原表脚注' }] }],
      },
    ],
  }
}

describe('landscapeTable 工具函数', () => {
  it('extractStdTableForModal 移除 tableCaption/tableCaptionEn 并保留表题只读信息，且符合弹窗子编辑器 schema', () => {
    const source = sampleStdTableJson()
    const extracted = extractStdTableForModal(source)

    expect(extracted.captionText).toBe('主要技术指标')
    expect(extracted.captionNodes.map(n => n.type)).toEqual(['tableCaption', 'tableCaptionEn'])

    const modalStdTable = extracted.modalDoc.content![0]!
    expect(modalStdTable.type).toBe('stdTable')
    expect(modalStdTable.content!.map(n => n.type)).toEqual(['table', 'tableNoteRow', 'tableFootnoteRow'])

    const modalSchema = getSchema(createLandscapeTableModalExtensions())
    const parsedModalDoc = modalSchema.nodeFromJSON(extracted.modalDoc)
    expect(() => parsedModalDoc.check()).not.toThrow()
    expect(modalSchema.nodes.stdTable!.spec.content).toBe('table tableFootnote? tableNoteRow? tableFootnoteRow?')
  })

  it('mergeModalStdTable 与 buildMergedStdTableNode 保留主文档原始中英文表题并应用弹窗修改', () => {
    const originalPm = mainSchema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'chapter',
          attrs: { nodeId: 'ch-1' },
          content: [
            { type: 'chapterTitle', content: [{ type: 'text', text: '要求' }] },
            sampleStdTableJson(),
          ],
        },
      ],
    })
    const originalTableNode = originalPm.firstChild!.lastChild!
    const { modalDoc } = extractStdTableForModal(originalTableNode.toJSON() as PMJsonNode)

    // 修改弹窗内表单元格文字并增补表注，同时验证即使传入伪造的表题也不影响主文档原始表题
    const modalTable = modalDoc.content![0]!
    modalTable.content![0]!.content![1]!.content![1]!.content![0]!.content = [{ type: 'text', text: '≤ 0.2%' }]
    modalTable.content!.unshift({ type: 'tableCaption', content: [{ type: 'text', text: '不应生效的篡改表题' }] })

    const mergedJson = mergeModalStdTable(originalTableNode.toJSON() as PMJsonNode, modalDoc)
    expect(mergedJson.content![0]!.content![0]!.text).toBe('主要技术指标')
    expect(mergedJson.content![1]!.type).toBe('tableCaptionEn')
    expect(mergedJson.content![1]!.content![0]!.text).toBe('Main technical indicators')

    const mergedNode = buildMergedStdTableNode(originalTableNode, modalDoc)
    expect(() => mergedNode.check()).not.toThrow()
    expect(mergedNode.child(0).textContent).toBe('主要技术指标')
    expect(mergedNode.child(1).textContent).toBe('Main technical indicators')
    expect(mergedNode.textContent).toContain('≤ 0.2%')
    expect(mergedNode.textContent).not.toContain('不应生效的篡改表题')
  })

  it('isEffectiveLandscapeStdTable 能识别独立横表及横向附录内的子表', () => {
    const doc = mainSchema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'chapter',
          attrs: { nodeId: 'ch1' },
          content: [
            { type: 'chapterTitle', content: [{ type: 'text', text: '正文' }] },
            sampleStdTableJson({ attrs: { nodeId: 't-portrait', orientation: 'portrait' } }),
            sampleStdTableJson({ attrs: { nodeId: 't-landscape', orientation: 'landscape' } }),
          ],
        },
        {
          type: 'appendix',
          attrs: { nodeId: 'app-landscape', orientation: 'landscape', normative: false },
          content: [
            { type: 'appendixLabel', content: [{ type: 'text', text: '（资料性）' }] },
            { type: 'appendixTitle', content: [{ type: 'text', text: '附表' }] },
            sampleStdTableJson({ attrs: { nodeId: 't-in-app', orientation: 'portrait' } }),
          ],
        },
      ],
    })

    const portrait = findStdTableByTarget(doc, { nodeId: 't-portrait' })!
    const landscape = findStdTableByTarget(doc, { nodeId: 't-landscape' })!
    const inLandscapeApp = findStdTableByTarget(doc, { nodeId: 't-in-app' })!

    expect(isEffectiveLandscapeStdTable(doc, portrait.pos)).toBe(false)
    expect(isEffectiveLandscapeStdTable(doc, landscape.pos)).toBe(true)
    expect(isEffectiveLandscapeStdTable(doc, inLandscapeApp.pos)).toBe(true)
  })

  it('distributeColumnWidthsByWeights 精确分配 952px 且满足最小列宽约束', () => {
    expect(distributeColumnWidthsByWeights([1, 2, 1], LANDSCAPE_TARGET_WIDTH_PX)).toEqual([238, 476, 238])
    const odd = distributeColumnWidthsByWeights([1, 1, 1], LANDSCAPE_TARGET_WIDTH_PX)
    expect(odd.reduce((a, b) => a + b, 0)).toBe(LANDSCAPE_TARGET_WIDTH_PX)
    expect(odd).toEqual([318, 317, 317])

    const tiny = distributeColumnWidthsByWeights([1, 1000, 1], LANDSCAPE_TARGET_WIDTH_PX, 25)
    expect(tiny[0]).toBeGreaterThanOrEqual(25)
    expect(tiny[2]).toBeGreaterThanOrEqual(25)
    expect(tiny.reduce((a, b) => a + b, 0)).toBe(LANDSCAPE_TARGET_WIDTH_PX)
  })

  it('buildColwidthTransaction 支持按列宽数组写入和清空 colwidth，正确处理 colspan', () => {
    const { modalDoc } = extractStdTableForModal(sampleStdTableJson({
      content: [
        { type: 'tableCaption', content: [{ type: 'text', text: '合并表' }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', attrs: { colspan: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '跨两列' }] }] },
                { type: 'tableHeader', attrs: { colspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第三列' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C' }] }] },
              ],
            },
          ],
        },
      ],
    }))

    const editor = new Editor({
      extensions: createLandscapeTableModalExtensions(),
      content: modalDoc as never,
    })

    try {
      const tr = buildColwidthTransaction(editor.state, [300, 352, 300])!
      expect(tr).not.toBeNull()
      editor.view.dispatch(tr)

      const stdTable = editor.state.doc.firstChild!
      const info = getStdTableGridColwidths(stdTable)!
      expect(info.colCount).toBe(3)
      expect(info.widths).toEqual([300, 352, 300])

      // 合并表头应写入 [300, 352]
      const firstRowFirstCell = stdTable.child(0).child(0).child(0)
      expect(firstRowFirstCell.attrs.colwidth).toEqual([300, 352])

      const metrics = computeTableWidthMetrics(stdTable)
      expect(metrics.totalPx).toBe(952)
      expect(metrics.exceedsPage).toBe(false)

      // 清空 colwidth
      const resetTr = buildColwidthTransaction(editor.state, null)!
      expect(resetTr).not.toBeNull()
      editor.view.dispatch(resetTr)
      expect(getStdTableGridColwidths(editor.state.doc.firstChild!)!.widths).toEqual([null, null, null])
      // 未传 clearNominalColumns 时保持向后兼容，不改动 stdTable.attrs.columns
      expect(editor.state.doc.firstChild!.attrs.columns).toEqual([
        { width: 30, widthUnit: '%' },
        { width: 70, widthUnit: '%' },
      ])
    } finally {
      editor.destroy()
    }
  })

  it('多表格文档下按激活表独立均分列宽（纵向 662px / 横向 952px），自动列宽同事务清空 colwidth 与 columns 且可单步撤销', () => {
    const threeColTable = (nodeId: string, orientation: 'portrait' | 'landscape', label: string, withColumns = false): PMJsonNode => ({
      type: 'stdTable',
      attrs: {
        nodeId,
        orientation,
        ...(withColumns ? { columns: [{ width: 20, widthUnit: '%' }, { width: 30, widthUnit: '%' }, { width: 50, widthUnit: '%' }] } : {}),
      },
      content: [
        { type: 'tableCaption', content: [{ type: 'text', text: `${label}-表题` }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', attrs: { colspan: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${label}-合并头` }] }] },
                { type: 'tableHeader', attrs: { colspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${label}-第三列` }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${label}-A` }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${label}-B` }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${label}-C` }] }] },
              ],
            },
          ],
        },
        {
          type: 'tableNoteRow',
          content: [{ type: 'note', content: [{ type: 'text', text: `${label}-注` }] }],
        },
      ],
    })

    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: {
        type: 'doc',
        content: [
          {
            type: 'chapter',
            attrs: { nodeId: 'ch-multi' },
            content: [
              { type: 'chapterTitle', content: [{ type: 'text', text: '多表测试' }] },
              threeColTable('tbl-p1', 'portrait', '纵表1', true),
              threeColTable('tbl-p2', 'portrait', '纵表2', false),
            ],
          },
          {
            type: 'appendix',
            attrs: { nodeId: 'app-l', orientation: 'landscape', normative: false },
            content: [
              { type: 'appendixLabel', content: [{ type: 'text', text: '（资料性）' }] },
              { type: 'appendixTitle', content: [{ type: 'text', text: '横附录' }] },
              threeColTable('tbl-a1', 'portrait', '附录表', true),
            ],
          },
        ],
      },
    })

    const textPos = (needle: string): number => {
      let found = -1
      editor.state.doc.descendants((node, pos) => {
        if (found < 0 && node.isText && node.text?.includes(needle)) found = pos + 1
      })
      return found
    }

    try {
      // 光标在章标题（非表格）时返回 null
      editor.commands.setTextSelection(textPos('多表测试'))
      expect(findActiveTableGrid(editor.state)).toBeNull()
      expect(buildActiveTableEvenWidthTransaction(editor.state)).toBeNull()

      // 光标在纵表1的表注行时也能定位到纵表1，并按 662px 均分 3 列 -> [221, 221, 220]
      editor.commands.setTextSelection(textPos('纵表1-注'))
      const activeP1 = findActiveTableGrid(editor.state)!
      expect(activeP1.stdTableNode?.attrs.nodeId).toBe('tbl-p1')
      expect(activeP1.isLandscape).toBe(false)

      const evenP1Tr = buildActiveTableEvenWidthTransaction(editor.state)!
      expect(evenP1Tr).not.toBeNull()
      editor.view.dispatch(evenP1Tr)

      const tblP1AfterEven = findStdTableByTarget(editor.state.doc, { nodeId: 'tbl-p1' })!.node
      const tblP2Untouched = findStdTableByTarget(editor.state.doc, { nodeId: 'tbl-p2' })!.node
      expect(getStdTableGridColwidths(tblP1AfterEven)!.widths).toEqual([220, 221, 221])
      expect(tblP1AfterEven.child(1).child(0).child(0).attrs.colwidth).toEqual([220, 221])
      expect(getStdTableGridColwidths(tblP1AfterEven)!.widths.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(PORTRAIT_TARGET_WIDTH_PX)
      // 第二个表格完全不受影响
      expect(getStdTableGridColwidths(tblP2Untouched)!.widths).toEqual([null, null, null])

      // 纵表1执行自动列宽：同事务清空 colwidth 与 stdTable.attrs.columns，且支持单步撤销
      const autoP1Tr = buildActiveTableAutoWidthTransaction(editor.state)!
      expect(autoP1Tr).not.toBeNull()
      editor.view.dispatch(autoP1Tr)

      const tblP1AfterAuto = findStdTableByTarget(editor.state.doc, { nodeId: 'tbl-p1' })!.node
      expect(getStdTableGridColwidths(tblP1AfterAuto)!.widths).toEqual([null, null, null])
      expect(tblP1AfterAuto.attrs.columns).toBeNull()

      expect(editor.commands.undo()).toBe(true)
      const tblP1AfterUndo = findStdTableByTarget(editor.state.doc, { nodeId: 'tbl-p1' })!.node
      expect(getStdTableGridColwidths(tblP1AfterUndo)!.widths).toEqual([220, 221, 221])
      expect(tblP1AfterUndo.attrs.columns).toEqual([
        { width: 20, widthUnit: '%' },
        { width: 30, widthUnit: '%' },
        { width: 50, widthUnit: '%' },
      ])

      // 横向附录内的表按 952px 均分 3 列 -> [318, 317, 317]
      editor.commands.setTextSelection(textPos('附录表-表题'))
      const activeA1 = findActiveTableGrid(editor.state)!
      expect(activeA1.stdTableNode?.attrs.nodeId).toBe('tbl-a1')
      expect(activeA1.isLandscape).toBe(true)

      const evenA1Tr = buildActiveTableEvenWidthTransaction(editor.state)!
      editor.view.dispatch(evenA1Tr)
      const tblA1AfterEven = findStdTableByTarget(editor.state.doc, { nodeId: 'tbl-a1' })!.node
      expect(getStdTableGridColwidths(tblA1AfterEven)!.widths).toEqual([318, 317, 317])
      expect(getStdTableGridColwidths(tblA1AfterEven)!.widths.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(LANDSCAPE_TARGET_WIDTH_PX)
    } finally {
      editor.destroy()
    }
  })

  it('自动列宽仅清除 columns 中的 width/widthUnit，完整保留 textAlign 与 verticalAlign 且可无损转 IR', () => {
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: {
        type: 'doc',
        content: [
          {
            type: 'chapter',
            attrs: { nodeId: 'ch-align' },
            content: [
              { type: 'chapterTitle', content: [{ type: 'text', text: '列对齐保留' }] },
              {
                type: 'stdTable',
                attrs: {
                  nodeId: 'tbl-align',
                  orientation: 'portrait',
                  columns: [
                    { width: 30, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
                    { width: 70, widthUnit: '%' },
                  ],
                },
                content: [
                  { type: 'tableCaption', content: [{ type: 'text', text: '带列对齐的表' }] },
                  {
                    type: 'table',
                    content: [
                      {
                        type: 'tableRow',
                        content: [
                          { type: 'tableHeader', attrs: { colwidth: [200] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '列1' }] }] },
                          { type: 'tableHeader', attrs: { colwidth: [462] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '列2' }] }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    try {
      let cellPos = -1
      editor.state.doc.descendants((node, pos) => {
        if (cellPos < 0 && node.isText && node.text === '列1') cellPos = pos + 1
      })
      editor.commands.setTextSelection(cellPos)

      const autoTr = buildActiveTableAutoWidthTransaction(editor.state)!
      expect(autoTr).not.toBeNull()
      editor.view.dispatch(autoTr)

      const updated = findStdTableByTarget(editor.state.doc, { nodeId: 'tbl-align' })!.node
      expect(getStdTableGridColwidths(updated)!.widths).toEqual([null, null])
      expect(updated.attrs.columns).toEqual([
        { textAlign: 'center', verticalAlign: 'middle' },
        {},
      ])

      // 再次点击自动列宽应为无操作（不产生冗余事务）
      expect(buildActiveTableAutoWidthTransaction(editor.state)).toBeNull()

      // 转换 IR 无 unsupportedContent，且对齐信息完整保留
      const irResult = pmToIr(editor.getJSON() as PMJsonNode)
      expect(irResult.doc.unsupportedContent ?? []).toEqual([])
      const irTable = irResult.doc.body[0]!.children[0]!
      expect(irTable.kind).toBe('table')
      if (irTable.kind === 'table') {
        expect(irTable.columns).toEqual([
          { textAlign: 'center', verticalAlign: 'middle' },
          {},
        ])
      }

      // 单步撤销同时恢复 colwidth 与名义列宽
      expect(editor.commands.undo()).toBe(true)
      const undone = findStdTableByTarget(editor.state.doc, { nodeId: 'tbl-align' })!.node
      expect(getStdTableGridColwidths(undone)!.widths).toEqual([200, 462])
      expect(undone.attrs.columns).toEqual([
        { width: 30, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
        { width: 70, widthUnit: '%' },
      ])
    } finally {
      editor.destroy()
    }
  })
})
