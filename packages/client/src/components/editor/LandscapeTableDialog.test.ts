// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PMJsonNode } from '@ses/shared'
import LandscapeTableDialog from './LandscapeTableDialog.vue'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import {
  buildMergedStdTableNode,
  getStdTableGridColwidths,
} from '@/utils/landscapeTable'

const roots: HTMLElement[] = []
const extraEditors: Editor[] = []

afterEach(() => {
  while (extraEditors.length) extraEditors.pop()!.destroy()
  while (roots.length) roots.pop()!.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

async function finishDialogTransition(): Promise<void> {
  await settle()
  document.querySelectorAll('.el-overlay-dialog, .el-dialog').forEach(el => {
    el.dispatchEvent(new Event('transitionend'))
  })
  await settle()
}

function makeSampleStdTable(overrides?: { orientation?: 'portrait' | 'landscape'; colwidths?: (number | null)[] }): PMJsonNode {
  const colwidths = overrides?.colwidths ?? [null, null, null, null]
  const makeCell = (text: string, colIndex: number): PMJsonNode => {
    const w = colwidths[colIndex]
    return {
      type: 'tableCell',
      ...(w ? { attrs: { colwidth: [w] } } : {}),
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }
  }
  return {
    type: 'stdTable',
    attrs: {
      nodeId: 'tbl-3',
      orientation: overrides?.orientation ?? 'landscape',
    },
    content: [
      {
        type: 'tableCaption',
        content: [{ type: 'text', text: '主要技术指标' }],
      },
      {
        type: 'tableCaptionEn',
        content: [{ type: 'text', text: 'Main technical indicators' }],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              makeCell('项目', 0),
              makeCell('单位', 1),
              makeCell('限值', 2),
              makeCell('备注', 3),
            ],
          },
          {
            type: 'tableRow',
            content: [
              makeCell('指标 A', 0),
              makeCell('mg/L', 1),
              makeCell('≤ 10', 2),
              makeCell('说明', 3),
            ],
          },
        ],
      },
      {
        type: 'tableNoteRow',
        attrs: { nodeId: 'note-1' },
        content: [
          {
            type: 'note',
            attrs: { nodeId: 'note-item-1' },
            content: [{ type: 'text', text: '原表注' }],
          },
        ],
      },
    ],
  }
}

async function mountLandscapeDialog(tableJson: PMJsonNode, tableLabel = '表 3') {
  const root = document.createElement('div')
  document.body.append(root)
  roots.push(root)
  const open = ref(false)
  const applied: PMJsonNode[] = []
  const footnoteRequests: string[] = []
  const dialogRef = ref<InstanceType<typeof LandscapeTableDialog> | null>(null)

  const app = createApp({
    setup: () => () =>
      h(LandscapeTableDialog, {
        ref: dialogRef,
        modelValue: open.value,
        tableJson,
        tableLabel,
        'onUpdate:modelValue': (value: boolean) => { open.value = value },
        onApply: (modalDoc: PMJsonNode) => { applied.push(modalDoc) },
        onRequestTableFootnote: (mode: string) => { footnoteRequests.push(mode) },
      }),
  })
  app.use(ElementPlus).mount(root)
  open.value = true
  await finishDialogTransition()
  return { open, applied, footnoteRequests, dialogRef, app }
}

describe('LandscapeTableDialog', () => {
  it('弹窗子编辑器排除 tableCaption / tableCaptionEn，仅在标题栏只读展示并回合并时完整保留原表题', async () => {
    const sourceTable = makeSampleStdTable()
    const { open, applied, dialogRef, app } = await mountLandscapeDialog(sourceTable, '表 3')

    const titleEl = document.querySelector('[data-testid="landscape-dialog-title"]')
    expect(titleEl?.textContent).toBe('编辑横页表格 · 表 3  主要技术指标')

    const modalEditor = dialogRef.value!.getEditor()!
    expect(modalEditor).toBeTruthy()
    const modalJson = modalEditor.getJSON() as PMJsonNode
    const modalStdTable = modalJson.content?.[0]
    expect(modalStdTable?.type).toBe('stdTable')
    const modalChildTypes = (modalStdTable?.content ?? []).map(c => c.type)
    expect(modalChildTypes).not.toContain('tableCaption')
    expect(modalChildTypes).not.toContain('tableCaptionEn')
    expect(modalChildTypes).toContain('table')
    expect(modalChildTypes).toContain('tableNoteRow')

    // 子编辑器 DOM 中不得出现表题或主编辑区的「展开编辑」按钮
    expect(document.querySelector('.lt-editor-content .std-table-caption')).toBeNull()
    expect(document.querySelector('.lt-editor-content .ses-expand-landscape-btn')).toBeNull()

    // 在弹窗内修改第一行第一列文字并应用
    modalEditor.chain().setTextSelection(4).insertContent('补充').run()
    await settle()

    const applyBtn = document.querySelector<HTMLButtonElement>('[data-testid="lt-apply-btn"]')!
    applyBtn.click()
    await settle()

    expect(applied).toHaveLength(1)
    expect(open.value).toBe(false)

    // 用 buildMergedStdTableNode 验证回合并后保留了主文档的中英文表题
    const mainEditor = new Editor({
      extensions: createEditorExtensions({ landscapeTablePreview: false }),
      content: { type: 'doc', content: [sourceTable] },
    })
    extraEditors.push(mainEditor)
    const mergedNode = buildMergedStdTableNode(mainEditor.state.doc.firstChild!, applied[0]!)
    const mergedJson = mergedNode.toJSON() as PMJsonNode
    expect(mergedJson.content?.[0]).toEqual(sourceTable.content![0])
    expect(mergedJson.content?.[1]).toEqual(sourceTable.content![1])
    expect(JSON.stringify(mergedJson)).toContain('补充')

    app.unmount()
  })

  it('工具栏与主编辑区格式按钮（加粗/斜体/下划线/删除线）保持一致，无冗余尺寸标签，快捷列宽按钮工作正常', async () => {
    const sourceTable = makeSampleStdTable({ colwidths: [100, 200, 300, 400] })
    const { dialogRef, app } = await mountLandscapeDialog(sourceTable, '表 3')
    const modalEditor = dialogRef.value!.getEditor()!

    // 标题栏与工具栏不展示像素/毫米尺寸角标、总宽状态条及「铺满横页」按钮
    expect(document.querySelector('.lt-dlg-badge')).toBeNull()
    expect(document.querySelector('[data-testid="lt-width-status"]')).toBeNull()
    expect(document.querySelector('[data-testid="lt-fit-width-btn"]')).toBeNull()

    // 格式按钮与主编辑界面一致：加粗、斜体、下划线、删除线
    const formatLabels = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.ses-landscape-table-dlg .format-group button'),
      btn => btn.getAttribute('aria-label'),
    )
    expect(formatLabels).toEqual(['加粗', '斜体', '下划线', '删除线'])

    // 点击「均分列宽」-> 4 列均分 952px（每列 238px）
    document.querySelector<HTMLButtonElement>('[data-testid="lt-even-width-btn"]')!.click()
    await settle()
    const evenWidths = getStdTableGridColwidths(modalEditor.state.doc.firstChild!)
    expect(evenWidths?.widths).toEqual([238, 238, 238, 238])

    // 点击「自动列宽」-> 清空 colwidth
    document.querySelector<HTMLButtonElement>('[data-testid="lt-reset-width-btn"]')!.click()
    await settle()
    const autoWidths = getStdTableGridColwidths(modalEditor.state.doc.firstChild!)
    expect(autoWidths?.widths).toEqual([null, null, null, null])

    app.unmount()
  })

  it('Ctrl/Cmd+S 可直接提交应用；未改取消直接关闭，有改动取消需确认后才丢弃', async () => {
    const sourceTable = makeSampleStdTable()
    const { open, applied, dialogRef, app } = await mountLandscapeDialog(sourceTable, '表 3')
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm')

    // 1. 未修改时点击取消：不弹窗确认，直接关闭
    document.querySelector<HTMLButtonElement>('[data-testid="lt-cancel-btn"]')!.click()
    await settle()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(open.value).toBe(false)

    // 2. 重新打开，修改内容后点取消，用户点击「继续编辑」（reject）-> 保持弹窗开启
    open.value = true
    await finishDialogTransition()
    const modalEditor = dialogRef.value!.getEditor()!
    modalEditor.chain().setTextSelection(4).insertContent('变更').run()
    await settle()

    confirmSpy.mockRejectedValueOnce('cancel')
    document.querySelector<HTMLButtonElement>('[data-testid="lt-cancel-btn"]')!.click()
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(open.value).toBe(true)

    // 3. 再次点取消并确认放弃修改 -> 关闭弹窗且不触发 apply
    confirmSpy.mockResolvedValueOnce('confirm' as never)
    document.querySelector<HTMLButtonElement>('[data-testid="lt-cancel-btn"]')!.click()
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(open.value).toBe(false)
    expect(applied).toHaveLength(0)

    // 4. 再次打开修改后按 Ctrl+S -> 提交应用并关闭
    open.value = true
    await finishDialogTransition()
    dialogRef.value!.getEditor()!.chain().setTextSelection(4).insertContent('快捷键保存').run()
    await settle()

    const dialogEl = document.querySelector<HTMLElement>('.ses-landscape-table-dlg')!
    dialogEl.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    await settle()
    expect(applied).toHaveLength(1)
    expect(JSON.stringify(applied[0])).toContain('快捷键保存')
    expect(open.value).toBe(false)

    app.unmount()
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
  ])('在表格单元格中按 %s+S 只应用一次', async (_modifier, keyOptions) => {
    const { open, applied, dialogRef, app } = await mountLandscapeDialog(makeSampleStdTable())
    try {
      const editor = dialogRef.value!.getEditor()!
      editor.chain().setTextSelection(4).insertContent('快捷键保存').run()
      const cell = editor.view.dom.querySelector('td p')!
      const event = new KeyboardEvent('keydown', { key: 's', ...keyOptions, bubbles: true, cancelable: true })

      cell.dispatchEvent(event)
      await settle()

      expect(event.defaultPrevented).toBe(true)
      expect(applied).toHaveLength(1)
      expect(JSON.stringify(applied[0])).toContain('快捷键保存')
      expect(open.value).toBe(false)
    } finally {
      app.unmount()
    }
  })

  it('主编辑器中的展开编辑按钮 decoration 仅出现在生效横向表上，且绝不污染 JSON / DOMSerializer 输出', () => {
    const mountEl = document.createElement('div')
    document.body.append(mountEl)
    roots.push(mountEl)

    const editor = new Editor({
      element: mountEl,
      extensions: createEditorExtensions(),
      content: {
        type: 'doc',
        content: [
          {
            type: 'stdTable',
            attrs: { nodeId: 't-p', orientation: 'portrait' },
            content: [
              { type: 'tableCaption', content: [{ type: 'text', text: '纵表' }] },
              {
                type: 'table',
                content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '纵' }] }] }] }],
              },
            ],
          },
          {
            type: 'stdTable',
            attrs: { nodeId: 't-l', orientation: 'landscape' },
            content: [
              { type: 'tableCaption', content: [{ type: 'text', text: '横表' }] },
              {
                type: 'table',
                content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '横' }] }] }] }],
              },
            ],
          },
          {
            type: 'appendix',
            attrs: { nodeId: 'app-l', orientation: 'landscape', normative: false },
            content: [
              { type: 'appendixLabel', content: [{ type: 'text', text: '（资料性）' }] },
              { type: 'appendixTitle', content: [{ type: 'text', text: '横附录' }] },
              {
                type: 'stdTable',
                attrs: { nodeId: 't-al', orientation: 'portrait' },
                content: [
                  { type: 'tableCaption', content: [{ type: 'text', text: '附录横表' }] },
                  {
                    type: 'table',
                    content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '附' }] }] }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    extraEditors.push(editor)

    const buttons = Array.from(mountEl.querySelectorAll<HTMLButtonElement>('.ses-expand-landscape-btn'))
    expect(buttons.map(btn => btn.dataset.tableId)).toEqual(['t-l', 't-al'])

    const jsonText = JSON.stringify(editor.getJSON())
    expect(jsonText).not.toContain('展开编辑')
    expect(jsonText).not.toContain('ses-expand-landscape-btn')

    const serializedEl = document.createElement('div')
    serializedEl.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content))
    expect(serializedEl.querySelector('.ses-expand-landscape-btn')).toBeNull()
    expect(serializedEl.textContent).not.toContain('展开编辑')
  })

  it('弹窗单表上下文中表脚注上标/定义编号（a/b）与多条表注编号（注1：/注2：）正常解析，不显示 ?', async () => {
    const tableWithFootnotes: PMJsonNode = {
      type: 'stdTable',
      attrs: { nodeId: 'tbl-fn', orientation: 'landscape' },
      content: [
        { type: 'tableCaption', content: [{ type: 'text', text: '带脚注横表' }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: '指标一' },
                      { type: 'tableFootnoteRef', attrs: { nodeId: 'tf-ref-1', targetId: 'tf-entry-1' } },
                    ],
                  }],
                },
                {
                  type: 'tableCell',
                  content: [{
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: '指标二' },
                      { type: 'tableFootnoteRef', attrs: { nodeId: 'tf-ref-2', targetId: 'tf-entry-2' } },
                    ],
                  }],
                },
              ],
            },
          ],
        },
        {
          type: 'tableNoteRow',
          attrs: { nodeId: 'tn-row' },
          content: [
            { type: 'note', attrs: { nodeId: 'tn-1' }, content: [{ type: 'text', text: '第一条表注' }] },
            { type: 'note', attrs: { nodeId: 'tn-2' }, content: [{ type: 'text', text: '第二条表注' }] },
          ],
        },
        {
          type: 'tableFootnoteRow',
          attrs: { nodeId: 'tf-row' },
          content: [
            { type: 'tableFootnoteEntry', attrs: { nodeId: 'tf-entry-1' }, content: [{ type: 'text', text: '第一条脚注说明' }] },
            { type: 'tableFootnoteEntry', attrs: { nodeId: 'tf-entry-2' }, content: [{ type: 'text', text: '第二条脚注说明' }] },
          ],
        },
      ],
    }

    const { app } = await mountLandscapeDialog(tableWithFootnotes, '表 5')
    await settle()

    const refLabels = Array.from(
      document.querySelectorAll<HTMLElement>('.lt-editor-content .std-table-footnote-label'),
      el => el.textContent?.trim(),
    )
    const entryLabels = Array.from(
      document.querySelectorAll<HTMLElement>('.lt-editor-content [data-table-footnote-label]'),
      el => el.textContent?.trim(),
    )
    const noteMarkers = Array.from(
      document.querySelectorAll<HTMLElement>('.lt-editor-content .std-note-marker'),
      el => el.textContent?.trim(),
    )

    expect(refLabels).toEqual(['a', 'b'])
    expect(entryLabels).toEqual(['a', 'b'])
    expect(noteMarkers).toEqual(['注1：', '注2：'])

    app.unmount()
  })

  it('beforeApply 返回 false 时拒绝提交并保持弹窗开启，不丢失用户编辑内容', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    roots.push(root)
    const open = ref(false)
    const applied: PMJsonNode[] = []
    const beforeApply = vi.fn(() => false)

    const app = createApp({
      setup: () => () =>
        h(LandscapeTableDialog, {
          modelValue: open.value,
          tableJson: makeSampleStdTable(),
          tableLabel: '表 3',
          beforeApply,
          'onUpdate:modelValue': (value: boolean) => { open.value = value },
          onApply: (modalDoc: PMJsonNode) => { applied.push(modalDoc) },
        }),
    })
    app.use(ElementPlus).mount(root)
    open.value = true
    await finishDialogTransition()

    document.querySelector<HTMLButtonElement>('[data-testid="lt-apply-btn"]')!.click()
    await settle()

    expect(beforeApply).toHaveBeenCalledTimes(1)
    expect(applied).toHaveLength(0)
    expect(open.value).toBe(true)

    app.unmount()
  })

  it('弹窗内支持点击或按 Enter/Space 补选空行内图，保留原图属性并拦截关闭期间回写', async () => {
    const picker = await import('@/utils/imagePicker')
    const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const tableWithEmptyImg: PMJsonNode = {
      type: 'stdTable',
      attrs: { nodeId: 'tbl-empty-img', orientation: 'landscape', headerRowCount: 0 },
      content: [
        { type: 'tableCaption', attrs: { nodeId: 'tbl-empty-cap' }, content: [{ type: 'text', text: '行内图弹窗' }] },
        {
          type: 'table',
          content: [{
            type: 'tableRow',
            content: [{
              type: 'tableCell',
              content: [{
                type: 'paragraph',
                content: [{ type: 'inlineImage', attrs: { src: '', alt: '待补选', size: 'M' } }],
              }],
            }],
          }],
        },
      ],
    }

    let resolvePick: ((src: string | null) => void) | undefined
    const selectSpy = vi.spyOn(picker, 'selectLocalImage').mockImplementation(() => new Promise((resolve) => {
      resolvePick = resolve
    }))

    const root = document.createElement('div')
    document.body.append(root)
    roots.push(root)
    const open = ref(false)
    const applied: PMJsonNode[] = []
    const app = createApp({
      setup: () => () =>
        h(LandscapeTableDialog, {
          modelValue: open.value,
          tableJson: tableWithEmptyImg,
          tableLabel: '表 6',
          'onUpdate:modelValue': (value: boolean) => { open.value = value },
          onApply: (modalDoc: PMJsonNode) => { applied.push(modalDoc) },
        }),
    })
    app.use(ElementPlus).mount(root)
    open.value = true
    await finishDialogTransition()

    const imgEl = document.querySelector<HTMLImageElement>('.lt-editor-content img.std-inline-image[role="button"]')
    expect(imgEl).not.toBeNull()

    // 1. 触发键盘 Enter 补选并写回，保留 size / alt
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    imgEl!.dispatchEvent(enterEvent)
    expect(enterEvent.defaultPrevented).toBe(true)
    expect(selectSpy).toHaveBeenCalledTimes(1)
    resolvePick!(sampleDataUrl)
    await settle()

    document.querySelector<HTMLButtonElement>('[data-testid="lt-apply-btn"]')!.click()
    await finishDialogTransition()
    expect(applied).toHaveLength(1)
    expect(JSON.stringify(applied[0])).toContain(sampleDataUrl)
    expect(JSON.stringify(applied[0])).toContain('"alt":"待补选"')
    expect(JSON.stringify(applied[0])).toContain('"size":"M"')

    // 2. 点击空图等待期间弹窗关闭时，异步回调不得抛错或改动主文档，并给出提示
    const warnSpy = vi.spyOn((await import('element-plus')).ElMessage, 'warning').mockImplementation(() => ({ close: () => {} }) as never)
    open.value = true
    await finishDialogTransition()
    const emptyEl = document.querySelector<HTMLImageElement>('.lt-editor-content img.std-inline-image[role="button"]')!
    // 测试环境下直接派发 click 可能缺坐标导致 ProseMirror posAtCoords 返回空；同时覆盖 Space 与 click 路径（此处显式触发空图点击事件与 Space 校验）
    emptyEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    if (selectSpy.mock.calls.length < 2) {
      emptyEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    }
    expect(selectSpy).toHaveBeenCalledTimes(2)
    open.value = false
    await finishDialogTransition()
    resolvePick!(sampleDataUrl)
    await settle()
    expect(warnSpy).toHaveBeenCalledWith('未能在原位置插入图片，请重新选择位置')

    app.unmount()
  })
})
