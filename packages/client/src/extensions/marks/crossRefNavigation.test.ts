// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { afterEach, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../editorExtensions'

let editor: Editor
afterEach(() => { editor?.destroy(); vi.restoreAllMocks() })

function setup(attrs: Record<string, unknown>, markType = 'crossRef') {
  editor = new Editor({ extensions: createEditorExtensions(), content: {
    type: 'doc', content: [
      { type: 'chapter', attrs: { nodeId: 'target' }, content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '目标章' }] },
        { type: 'stdParagraph', content: [{ type: 'text', text: '原文' }] },
      ] },
      { type: 'chapter', attrs: { nodeId: 'host' }, content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '引用章' }] },
        { type: 'stdParagraph', content: [{ type: 'text', text: '见第1章', marks: [{ type: markType, attrs }] }] },
      ] },
    ],
  } })
  document.body.append(editor.view.dom)
  editor.commands.setTextSelection(editor.state.doc.content.size - 3)
  return editor.view.dom.querySelector<HTMLAnchorElement>('a')!
}

function click(anchor: HTMLAnchorElement) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  Object.defineProperty(event, 'target', { value: anchor })
  editor.view.someProp('handleClick', handler => handler(editor.view, editor.state.selection.from, event))
  return event
}

it.each([{ targetId: 'target', refType: 'chapter' }, { refId: 'target', refType: 'chapter' }])(
  'clicking a canonical or legacy internal reference locates the target without opening a page: %j', attrs => {
    const anchor = setup(attrs)
    const before = editor.getJSON()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const event = click(anchor)
    expect(open).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    expect(editor.state.selection.$from.parent.type.name).toBe('chapterTitle')
    expect(editor.state.selection.$from.parent.textContent).toBe('目标章')
    expect(editor.getJSON()).toEqual(before)
  },
)

it('consumes missing internal targets and reports the failure instead of opening a page', () => {
  const anchor = setup({ targetId: 'missing', refType: 'chapter' })
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const missing = vi.fn()
  editor.view.dom.addEventListener('ses:reference-missing', missing)
  const selection = editor.state.selection.from
  expect(click(anchor).defaultPrevented).toBe(true)
  expect(open).not.toHaveBeenCalled()
  expect(editor.state.selection.from).toBe(selection)
  expect(missing).toHaveBeenCalledOnce()
})

it.each(['termRef', 'bibRef'])('locates imported %s internal references in the editor', type => {
  const anchor = setup({ targetId: 'target' }, type)
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  expect(click(anchor).defaultPrevented).toBe(true)
  expect(open).not.toHaveBeenCalled()
  expect(editor.state.selection.$from.parent.textContent).toBe('目标章')
})

it('preserves opening normal external links', () => {
  const anchor = setup({ href: 'https://example.org/spec', target: '_blank' }, 'externalLink')
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  click(anchor)
  expect(open).toHaveBeenCalledWith('https://example.org/spec', '_blank')
})
