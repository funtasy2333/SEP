// @vitest-environment happy-dom
import { Editor } from '@tiptap/vue-3'
import { createApp, h, nextTick } from 'vue'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import type { PMJsonNode } from '@ses/shared'
import DocumentOutline from './DocumentOutline.vue'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { replaceEditorDocument } from '@/utils/editorDocument'

// 两章内容等长：互换位置后，旧位置上的节点大小不变
const chapter = (id: string, title: string): PMJsonNode => ({
  type: 'chapter', attrs: { nodeId: id }, content: [
    { type: 'chapterTitle', content: [{ type: 'text', text: title }] },
    { type: 'stdParagraph', attrs: { nodeId: `${id}-p` }, content: [{ type: 'text', text: `${title}正文` }] },
  ],
})
const doc = (...chapters: PMJsonNode[]): PMJsonNode & Record<string, unknown> => ({ type: 'doc', content: chapters })

function mountOutline(content: PMJsonNode) {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  editor.mount(document.createElement('div'))
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(DocumentOutline, { editor }) })
  app.use(ElementPlus).mount(root)
  return {
    editor,
    root,
    chapterIds: () => (editor.getJSON().content ?? []).filter(node => node.type === 'chapter').map(node => node.attrs?.nodeId),
    clickDelete(title: string) {
      const item = [...root.querySelectorAll<HTMLElement>('.outline-item')].find(element => element.textContent?.includes(title))!
      item.querySelector<HTMLElement>('.outline-item-delete')!.click()
    },
    destroy() { app.unmount(); root.remove(); editor.destroy() },
  }
}

function deferredConfirm() {
  let settle!: (confirmed: boolean) => void
  vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise((resolve, reject) => {
    settle = confirmed => confirmed ? resolve('confirm' as never) : reject('cancel')
  }))
  return (confirmed: boolean) => settle(confirmed)
}

afterEach(() => vi.restoreAllMocks())

it('确认删除后删掉对话框里点名的那一章', async () => {
  const view = mountOutline(doc(chapter('a', '甲'), chapter('b', '乙')))
  const settle = deferredConfirm()
  await nextTick()
  view.clickDelete('甲')
  settle(true)
  await vi.waitFor(() => expect(view.chapterIds()).toEqual(['b']))
  view.destroy()
})

it('取消确认不改动文档', async () => {
  const view = mountOutline(doc(chapter('a', '甲'), chapter('b', '乙')))
  const settle = deferredConfirm()
  await nextTick()
  view.clickDelete('甲')
  settle(false)
  await new Promise(resolve => setTimeout(resolve))
  expect(view.chapterIds()).toEqual(['a', 'b'])
  view.destroy()
})

it('确认期间外部修订把等长的两章互换位置，仍删除原先点名的那一章', async () => {
  const view = mountOutline(doc(chapter('a', '甲'), chapter('b', '乙')))
  const settle = deferredConfirm()
  await nextTick()
  view.clickDelete('甲')
  replaceEditorDocument(view.editor, doc(chapter('b', '乙'), chapter('a', '甲')))
  settle(true)
  await vi.waitFor(() => expect(view.chapterIds()).toEqual(['b']))
  view.destroy()
})

it('确认期间原章已被外部删除时不删任何内容并提示', async () => {
  const view = mountOutline(doc(chapter('a', '甲'), chapter('b', '乙')))
  const settle = deferredConfirm()
  const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close() {} }) as never)
  await nextTick()
  view.clickDelete('甲')
  replaceEditorDocument(view.editor, doc(chapter('b', '乙'), chapter('c', '丙')))
  settle(true)
  await vi.waitFor(() => expect(warning).toHaveBeenCalled())
  expect(view.chapterIds()).toEqual(['b', 'c'])
  view.destroy()
})
