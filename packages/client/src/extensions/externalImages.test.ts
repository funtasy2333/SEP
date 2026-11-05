// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'
import {
  EXTERNAL_IMAGE_PLACEHOLDER_SRC,
  isExternalImageApproved,
  resetApprovedExternalImages,
} from '../utils/imageSource'

const FIGURE_URL = 'https://evil.example/figure.png'
const INLINE_URL = 'http://192.168.1.5:8080/inline.png'
const GRAPHIC_URL = 'https://cdn.evil.example/extra.png'
const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const text = (value: string) => ({ type: 'text', text: value })

function figure(nodeId: string, src: string, extra: Record<string, unknown> = {}, imageAttrs: Record<string, unknown> = {}) {
  return {
    type: 'figure',
    attrs: { nodeId, ...extra },
    content: [
      { type: 'figureImage', attrs: { src, alt: '示意图', ...imageAttrs } },
      { type: 'figureCaption', content: [text('图题')] },
    ],
  }
}

function content(...children: unknown[]) {
  return {
    type: 'doc',
    content: [{
      type: 'chapter',
      attrs: { nodeId: 'chapter-1' },
      content: [{ type: 'chapterTitle', content: [text('范围')] }, ...children],
    }],
  }
}

const editors: Editor[] = []
function createEditor(doc: unknown) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: createEditorExtensions(),
    editorProps: { handleScrollToSelection: () => true },
    content: doc as any,
  })
  editors.push(editor)
  return editor
}

beforeEach(() => resetApprovedExternalImages())
afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element
    editor.destroy()
    if (element instanceof HTMLElement) element.remove()
  }
})

/** 章节点的 JSON：setContent 会在末尾补一个空段落（文档默认填充），与本测试无关，比较时去掉。 */
const chapterJson = (editor: Editor) => JSON.stringify(editor.getJSON().content![0])

const images = (editor: Editor) => Array.from(editor.view.dom.querySelectorAll('img'))

function externalDoc() {
  return content(
    figure('fig-1', FIGURE_URL, { additionalGraphics: [{ nodeId: 'g-1', src: GRAPHIC_URL }] }),
    {
      type: 'stdParagraph',
      attrs: { nodeId: 'p-1' },
      content: [text('行内'), { type: 'inlineImage', attrs: { src: INLINE_URL, alt: '行内图' } }, text('结束')],
    },
  )
}

function expectNoExternalAddressLoaded(editor: Editor) {
  for (const image of images(editor)) {
    for (const name of ['src', 'srcset']) {
      expect(image.getAttribute(name) ?? '', `${name} of ${image.className}`).not.toMatch(/https?:|\/\/|evil|192\.168/)
    }
  }
}

describe('编辑器里的外部图片：点击才加载', () => {
  it('figureImage / inlineImage / additionalGraphics 的外部图片只显示占位图，DOM 的 src / srcset 不含外部地址', () => {
    const editor = createEditor(externalDoc())
    const all = images(editor)
    expect(all).toHaveLength(3)
    expectNoExternalAddressLoaded(editor)
    for (const image of all) {
      expect(image.getAttribute('src')).toBe(EXTERNAL_IMAGE_PLACEHOLDER_SRC)
      expect(image.hasAttribute('srcset')).toBe(false)
      expect(image.classList.contains('is-external-image')).toBe(true)
      expect(image.title).toMatch(/^外部图片未加载，点击加载：/)
    }
    const byType = (selector: string) => editor.view.dom.querySelector(selector)!
    expect(byType('img[data-type="figure-image"]').getAttribute('data-external-src')).toBe(FIGURE_URL)
    expect(byType('img[data-type="figure-image"]').getAttribute('title')).toContain('evil.example')
    expect(byType('img[data-type="inline-image"]').getAttribute('data-external-src')).toBe(INLINE_URL)
    expect(byType('img[data-type="inline-image"]').getAttribute('title')).toContain('192.168.1.5')
    expect(byType('img.std-graphic-preview').getAttribute('data-external-src')).toBe(GRAPHIC_URL)
    // 占位只存在于 DOM，文档里是真实地址
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain(FIGURE_URL)
    expect(json).not.toContain('data:image/svg')
  })

  it('点击占位图：该图片 src 变为真实地址并记住；文档 JSON 不变，不产生事务', () => {
    const editor = createEditor(externalDoc())
    const before = JSON.stringify(editor.getJSON())
    const stateBefore = editor.state
    let transactions = 0
    editor.on('transaction', () => { transactions += 1 })

    const figureImage = editor.view.dom.querySelector<HTMLImageElement>('img[data-type="figure-image"]')!
    figureImage.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(figureImage.getAttribute('src')).toBe(FIGURE_URL)
    expect(figureImage.classList.contains('is-external-image')).toBe(false)
    expect(figureImage.hasAttribute('data-external-src')).toBe(false)
    expect(isExternalImageApproved(FIGURE_URL)).toBe(true)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    expect(editor.state).toBe(stateBefore)
    expect(transactions).toBe(0)

    // 其他地址的图片仍是占位图
    const inline = editor.view.dom.querySelector('img[data-type="inline-image"]')!
    expect(inline.getAttribute('src')).toBe(EXTERNAL_IMAGE_PLACEHOLDER_SRC)
    expect(isExternalImageApproved(INLINE_URL)).toBe(false)
  })

  it('点击附加图形的预览图同样有效，并同步显示同地址的其他图片', () => {
    const editor = createEditor(content(
      figure('fig-1', GRAPHIC_URL, { additionalGraphics: [{ nodeId: 'g-1', src: GRAPHIC_URL }] }),
    ))
    const [main, preview] = images(editor)
    expect(main!.getAttribute('data-external-src')).toBe(GRAPHIC_URL)
    expect(preview!.classList.contains('std-graphic-preview')).toBe(true)
    preview!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(preview!.getAttribute('src')).toBe(GRAPHIC_URL)
    expect(main!.getAttribute('src')).toBe(GRAPHIC_URL)
  })

  it('允许之后重新渲染的同地址图片直接显示真实地址', () => {
    const editor = createEditor(externalDoc())
    editor.view.dom.querySelector('img[data-type="inline-image"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const other = createEditor(content(
      { type: 'stdParagraph', attrs: { nodeId: 'p-2' }, content: [{ type: 'inlineImage', attrs: { src: INLINE_URL } }] },
    ))
    const image = images(other)[0]!
    expect(image.getAttribute('src')).toBe(INLINE_URL)
    expect(image.hasAttribute('data-external-src')).toBe(false)
  })

  it('data URL 图片照常显示，不加占位', () => {
    const editor = createEditor(content(
      figure('fig-d', DATA_URL),
      { type: 'stdParagraph', attrs: { nodeId: 'p-d' }, content: [{ type: 'inlineImage', attrs: { src: DATA_URL } }] },
    ))
    const all = images(editor)
    expect(all).toHaveLength(2)
    for (const image of all) {
      expect(image.getAttribute('src')).toBe(DATA_URL)
      expect(image.hasAttribute('data-external-src')).toBe(false)
      expect(image.classList.contains('is-external-image')).toBe(false)
    }
  })

  it('空 src 的图片不加占位', () => {
    const editor = createEditor(content(figure('fig-e', '')))
    const image = images(editor)[0]!
    expect(image.getAttribute('src')).toBe('')
    expect(image.classList.contains('is-external-image')).toBe(false)
  })

  it('通用 image 节点：序列化为占位图，解析时还原真实地址', () => {
    const editor = createEditor(externalDoc())
    const { schema } = editor
    const node = schema.nodes.image!.create({ src: FIGURE_URL, alt: 'a', title: '原标题' })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLImageElement
    expect(dom.getAttribute('src')).toBe(EXTERNAL_IMAGE_PLACEHOLDER_SRC)
    expect(dom.hasAttribute('srcset')).toBe(false)
    expect(dom.getAttribute('data-external-src')).toBe(FIGURE_URL)
    expect(dom.classList.contains('is-external-image')).toBe(true)

    const holder = document.createElement('div')
    holder.append(dom)
    const parsed = PMDOMParser.fromSchema(schema).parse(holder)
    const image = parsed.firstChild!
    expect(image.type.name).toBe('image')
    expect(image.attrs.src).toBe(FIGURE_URL)
    expect(image.attrs.title).toBe('原标题')

    const embedded = schema.nodes.image!.create({ src: DATA_URL })
    const embeddedDom = DOMSerializer.fromSchema(schema).serializeNode(embedded) as HTMLImageElement
    expect(embeddedDom.getAttribute('src')).toBe(DATA_URL)
    expect(embeddedDom.hasAttribute('data-external-src')).toBe(false)
  })

  describe('复制粘贴与重新解析不丢真实地址', () => {
    it('getHTML 再 setContent：外部图片的 src 仍是原地址，不会变成占位图', () => {
      const editor = createEditor(externalDoc())
      const original = chapterJson(editor)
      const html = editor.getHTML()
      expect(html).toContain('data-external-src')
      editor.commands.setContent(html)
      expect(chapterJson(editor)).toBe(original)
      const serialized = chapterJson(editor)
      expect(serialized).toContain(FIGURE_URL)
      expect(serialized).toContain(INLINE_URL)
      expect(serialized).not.toContain('data:image/svg')
    })

    it('figureImage 的 title 属性往返不被提示文字覆盖', () => {
      const editor = createEditor(content(figure('fig-t', FIGURE_URL, {}, { title: '资源标题' })))
      const html = editor.getHTML()
      editor.commands.setContent(html)
      const figureImage = editor.state.doc.firstChild!.child(1).firstChild!
      expect(figureImage.attrs.src).toBe(FIGURE_URL)
      expect(figureImage.attrs.title).toBe('资源标题')

      const noTitle = createEditor(content(figure('fig-n', FIGURE_URL)))
      noTitle.commands.setContent(noTitle.getHTML())
      expect(noTitle.state.doc.firstChild!.child(1).firstChild!.attrs.title).toBeNull()
    })

    it('SES 内部剪贴板同款序列化（DOMSerializer 切片）再解析：外部图片地址保持', () => {
      const editor = createEditor(externalDoc())
      const { schema, state } = editor
      const slice = state.doc.slice(0, state.doc.content.size)
      const fragment = DOMSerializer.fromSchema(schema).serializeFragment(slice.content, { document })
      const holder = document.createElement('div')
      holder.append(fragment)
      expect(holder.innerHTML).not.toMatch(/\ssrc="(?:https?:|\/\/)/)
      const parsed = PMDOMParser.fromSchema(schema).parseSlice(holder)
      const srcs: string[] = []
      parsed.content.descendants((node) => {
        if (['figureImage', 'inlineImage', 'image'].includes(node.type.name)) srcs.push(node.attrs.src)
      })
      expect(srcs).toEqual([FIGURE_URL, INLINE_URL])
    })

    it('已允许加载的图片 getHTML 输出真实地址，也能解析回来', () => {
      const editor = createEditor(externalDoc())
      editor.view.dom.querySelector('img[data-type="figure-image"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const original = chapterJson(editor)
      editor.commands.setContent(editor.getHTML())
      expect(chapterJson(editor)).toBe(original)
    })
  })
})
