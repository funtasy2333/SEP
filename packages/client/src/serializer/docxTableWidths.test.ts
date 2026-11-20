// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import JSZip from 'jszip'
import type { PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { snapshotDocxTableWidths } from './docxTableWidths'
import { buildDocxBlob } from './docxExporter'
import { LANDSCAPE_PAGE_PX } from '@/utils/landscapeTable'

const activeEditors: Editor[] = []

function makeParagraph(text: string, nodeId?: string): PMJsonNode {
  return {
    type: 'paragraph',
    ...(nodeId ? { attrs: { nodeId } } : {}),
    content: [{ type: 'text', text }],
  }
}

function makeCell(text: string, attrs?: Record<string, unknown>): PMJsonNode {
  return {
    type: 'tableCell',
    ...(attrs ? { attrs } : {}),
    content: [makeParagraph(text)],
  }
}

function createDocxTestEditor(doc: PMJsonNode): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createEditorExtensions({ landscapeTablePreview: false }),
    content: doc,
  })
  activeEditors.push(editor)
  return editor
}

function getStdTableCellsColwidths(stdTableJson: PMJsonNode): (number[] | null | undefined)[] {
  const table = stdTableJson.content?.find(child => child.type === 'table')
  const row = table?.content?.[0]
  return (row?.content ?? []).map(cell => cell.attrs?.colwidth as number[] | null | undefined)
}

function mockTableCols(
  editor: Editor,
  nodeId: string,
  colWidths: number[],
  landscapeScale?: string,
): void {
  const wrapper = editor.view.dom.querySelector<HTMLElement>(`.std-table-wrapper[data-node-id="${nodeId}"]`)
  if (!wrapper) throw new Error(`Missing .std-table-wrapper for ${nodeId}`)
  const tableWrapper = wrapper.querySelector<HTMLElement>('.tableWrapper')
  const table = wrapper.querySelector<HTMLTableElement>('table')
  if (!tableWrapper || !table) throw new Error(`Missing table DOM for ${nodeId}`)

  if (landscapeScale) {
    tableWrapper.setAttribute('data-landscape-scale', landscapeScale)
  } else {
    tableWrapper.removeAttribute('data-landscape-scale')
  }

  let colgroup = table.querySelector<HTMLTableColElement>(':scope > colgroup')
  if (!colgroup) {
    colgroup = document.createElement('colgroup')
    table.prepend(colgroup)
  }
  colgroup.innerHTML = ''
  for (const width of colWidths) {
    const col = document.createElement('col')
    col.getBoundingClientRect = () => ({ width } as DOMRect)
    colgroup.appendChild(col)
  }
}

async function readDocxTblGridWidths(blob: Blob): Promise<number[][]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const xml = await zip.file('word/document.xml')!.async('string')
  return Array.from(xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g), match =>
    Array.from(match[1]!.matchAll(/w:w="(\d+)"/g), colMatch => Number(colMatch[1])),
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  while (activeEditors.length > 0) {
    activeEditors.pop()?.destroy()
  }
  document.body.innerHTML = ''
})

describe('snapshotDocxTableWidths', () => {
  it('保留横向表已显式设置的完整 952px colwidth，不被主编辑区缩放 DOM（~666px）覆盖', async () => {
    const editor = createDocxTestEditor({
      type: 'doc',
      content: [
        {
          type: 'chapter',
          content: [
            { type: 'chapterTitle', content: [{ type: 'text', text: '横表章节' }] },
            {
              type: 'stdTable',
              attrs: { nodeId: 't-explicit', orientation: 'landscape' },
              content: [
                { type: 'tableCaption', content: [{ type: 'text', text: '显式宽横表' }] },
                {
                  type: 'table',
                  content: [
                    {
                      type: 'tableRow',
                      content: [
                        makeCell('A', { colwidth: [300] }),
                        makeCell('B', { colwidth: [652] }),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    // 模拟主编辑区被缩放后的 DOM（总宽仅 ~666px）
    mockTableCols(editor, 't-explicit', [210, 456], '0.70')

    const snapshot = snapshotDocxTableWidths(editor.getJSON() as PMJsonNode, editor.view)
    const tableNode = snapshot.content?.[0]?.content?.find(child => child.type === 'stdTable')
    expect(tableNode).toBeTruthy()
    expect(getStdTableCellsColwidths(tableNode!)).toEqual([[300], [652]])

    const { blob } = await buildDocxBlob({
      pmDoc: editor.getJSON() as PMJsonNode,
      editorView: editor.view,
    })
    const grids = await readDocxTblGridWidths(blob)
    expect(grids).toHaveLength(1)
    const [col1, col2] = grids[0]!
    expect(col1! + col2!).toBe(14280) // (300 + 652) * 15 twips = 14280 twips (~252mm)，而非 666 * 15 ≈ 9990
    expect(col1).toBe(4500)
    expect(col2).toBe(9780)
  })

  it('当横向表未设置显式 colwidth 且 DOM 带 data-landscape-scale 时，按缩放比例还原真实宽度', () => {
    const editor = createDocxTestEditor({
      type: 'doc',
      content: [
        {
          type: 'stdTable',
          attrs: { nodeId: 't-scaled-dom', orientation: 'landscape' },
          content: [
            { type: 'tableCaption', content: [{ type: 'text', text: '缩放还原横表' }] },
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [makeCell('C1'), makeCell('C2'), makeCell('C3')],
                },
              ],
            },
          ],
        },
      ],
    })

    // 原始宽度 [200, 300, 500] (总 1000px > 952px)，在 scale=0.666 下 DOM 测量值为 [133.2, 199.8, 333]
    mockTableCols(editor, 't-scaled-dom', [133.2, 199.8, 333], '0.666')

    const snapshot = snapshotDocxTableWidths(editor.getJSON() as PMJsonNode, editor.view)
    const widths = getStdTableCellsColwidths(snapshot.content![0]!)
    expect(widths).toHaveLength(3)
    expect(widths![0]![0]!).toBeCloseTo(200, 1)
    expect(widths![1]![0]!).toBeCloseTo(300, 1)
    expect(widths![2]![0]!).toBeCloseTo(500, 1)
  })

  it('对横向表格与横向附录内的自动列宽表格，若还原后总宽不足 252mm（~952.44px）则按比例放大至版心宽', () => {
    const editor = createDocxTestEditor({
      type: 'doc',
      content: [
        {
          type: 'stdTable',
          attrs: { nodeId: 't-landscape-auto', orientation: 'landscape' },
          content: [
            { type: 'tableCaption', content: [{ type: 'text', text: '自动宽横表' }] },
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [makeCell('L1'), makeCell('L2')],
                },
              ],
            },
          ],
        },
        {
          type: 'appendix',
          attrs: { nodeId: 'app-land', orientation: 'landscape', normative: true },
          content: [
            { type: 'appendixLabel', content: [{ type: 'text', text: '（规范性）' }] },
            { type: 'appendixTitle', content: [{ type: 'text', text: '横页附录' }] },
            {
              type: 'stdTable',
              attrs: { nodeId: 't-app-auto', orientation: 'portrait' },
              content: [
                { type: 'tableCaption', content: [{ type: 'text', text: '随附录横向的表' }] },
                {
                  type: 'table',
                  content: [
                    {
                      type: 'tableRow',
                      content: [makeCell('A1'), makeCell('A2')],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    // 未带 data-landscape-scale 且测得仅 600px（如降级 DOM 环境），应比例放大至 LANDSCAPE_PAGE_PX
    mockTableCols(editor, 't-landscape-auto', [200, 400])
    // 带 data-landscape-scale 但仅部分显式 colwidth（第一列 null），还原总宽 666px -> 归一化到 LANDSCAPE_PAGE_PX
    mockTableCols(editor, 't-app-auto', [140, 326.2], '0.70')

    const snapshot = snapshotDocxTableWidths(editor.getJSON() as PMJsonNode, editor.view)
    const landscapeWidths = getStdTableCellsColwidths(snapshot.content![0]!)
    expect(landscapeWidths![0]![0]! + landscapeWidths![1]![0]!).toBeCloseTo(LANDSCAPE_PAGE_PX, 2)
    expect(landscapeWidths![1]![0]! / landscapeWidths![0]![0]!).toBeCloseTo(2, 4)

    const appendixTable = snapshot.content![1]!.content!.find(c => c.type === 'stdTable')!
    const appendixWidths = getStdTableCellsColwidths(appendixTable)
    expect(appendixWidths![0]![0]! + appendixWidths![1]![0]!).toBeCloseTo(LANDSCAPE_PAGE_PX, 2)
    expect(appendixWidths![1]![0]! / appendixWidths![0]![0]!).toBeCloseTo(326.2 / 140, 3)
  })

  it('纵向表格保持原有 DOM 列宽快照行为，不按横向放大或改写', () => {
    const editor = createDocxTestEditor({
      type: 'doc',
      content: [
        {
          type: 'stdTable',
          attrs: { nodeId: 't-portrait', orientation: 'portrait' },
          content: [
            { type: 'tableCaption', content: [{ type: 'text', text: '纵向表' }] },
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [makeCell('P1'), makeCell('P2')],
                },
              ],
            },
          ],
        },
      ],
    })

    mockTableCols(editor, 't-portrait', [180, 420])

    const snapshot = snapshotDocxTableWidths(editor.getJSON() as PMJsonNode, editor.view)
    expect(getStdTableCellsColwidths(snapshot.content![0]!)).toEqual([[180], [420]])
  })
})
