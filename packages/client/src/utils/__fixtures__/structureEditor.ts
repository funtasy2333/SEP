import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../../extensions/editorExtensions'

/** 结构编辑测试的共用夹具：均基于生产 Tiptap schema（createEditorExtensions）。 */
const editors: Editor[] = []

export const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
export const p = (id: string, value = ''): JSONContent => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: value ? [text(value)] : [] })
export const clause = (id: string, title: string, body: JSONContent[] = [], level = 1): JSONContent => ({ type: 'clause', attrs: { nodeId: id, level }, content: [
  { type: 'clauseTitle', attrs: { level }, content: title ? [text(title)] : [] }, ...body,
] })
/** 无题条（IR 模型）：clauseTitle 为空，条文在首个 stdParagraph。 */
export const untitled = (id: string, paragraphId: string, value: string, body: JSONContent[] = [], level = 1): JSONContent => ({
  type: 'clause', attrs: { nodeId: id, level, hasTitle: false }, content: [
    { type: 'clauseTitle', attrs: { level }, content: [] }, p(paragraphId, value), ...body,
  ],
})
export const item = (id: string, value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'stdListItem', attrs: { nodeId: id }, content: value ? [text(value, marks)] : [] })
export const list = (id: string, listType: string, items: JSONContent[]): JSONContent => ({
  type: 'stdList', attrs: { nodeId: id, listType, level: listType === 'numeric' || listType === 'dot' ? 2 : 1 }, content: items,
})
export const note = (id: string, value: string): JSONContent => ({ type: 'note', attrs: { nodeId: id }, content: [text(value)] })
export const term = (id: string, level: number, name: string, nested: JSONContent[] = []): JSONContent => ({
  type: 'termDef', attrs: { nodeId: id, level }, content: [
    { type: 'termName', content: [text(name)] },
    { type: 'termDefinition', attrs: { nodeId: `${id}-def` }, content: [text(`${name}的定义`)] },
    ...nested,
  ],
})
export const chapterDoc = (body: JSONContent[]): JSONContent => ({
  type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [{ type: 'chapterTitle', content: [text('总体原则')] }, ...body] }],
})
export const appendixDoc = (body: JSONContent[]): JSONContent => ({
  type: 'doc', content: [{ type: 'appendix', attrs: { nodeId: 'appendix' }, content: [
    { type: 'appendixLabel', content: [text('（规范性）')] },
    { type: 'appendixTitle', content: [text('附录标题')] }, ...body,
  ] }],
})

export function makeEditor(content: JSONContent): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  const e = new Editor({ element, extensions: createEditorExtensions(), editorProps: { handleScrollToSelection: () => true }, content })
  editors.push(e)
  return e
}
export const editor = (body: JSONContent[]): Editor => makeEditor(chapterDoc(body))
export function destroyEditors(): void {
  for (const e of editors.splice(0)) {
    const el = e.options.element
    e.destroy()
    if (el instanceof HTMLElement) el.remove()
  }
}

/**
 * 向视图派发真实的 keydown（走 ProseMirror 的 handleKeyDown / keymap 链）。
 * 不用 editor.commands.keyboardShortcut：它会捕获快捷键事务并只重放步骤，选区等信息会丢失。
 */
export function pressKey(e: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  return e.view.someProp('handleKeyDown', handler => handler(e.view, event)) ?? false
}

/** 文档 JSON；去掉 Tiptap 在末尾自动补的空 paragraph（任何事务之后才会出现），便于与初始稿深比较。 */
export function snapshot(e: Editor): JSONContent {
  const json = e.getJSON()
  const content = json.content ?? []
  const last = content[content.length - 1]
  const trailing = content.length > 1 && last?.type === 'paragraph' && !(last.content && last.content.length)
  return trailing ? { ...json, content: content.slice(0, -1) } : json
}

/** 选中第一个文本节点恰为 value 的位置（offset/length 为文本内偏移）。 */
export function select(e: Editor, value: string, offset = 0, length = 0): void {
  let pos = -1
  e.state.doc.descendants((n, at) => { if (pos < 0 && n.isText && n.text === value) pos = at })
  if (pos < 0) throw new Error(`找不到文本「${value}」`)
  e.commands.setTextSelection({ from: pos + offset, to: pos + offset + length })
}
/** 把光标放进 nodeId 对应文本块的 offset 处。 */
export function caretIn(e: Editor, nodeId: string, offset = 0): void {
  let pos = -1
  e.state.doc.descendants((n, at) => { if (pos < 0 && n.attrs.nodeId === nodeId) pos = at })
  if (pos < 0) throw new Error(`找不到节点 ${nodeId}`)
  e.commands.setTextSelection(pos + 1 + offset)
}
export function nodeById(e: Editor, nodeId: string) {
  let found: { node: Editor['state']['doc']; pos: number; parent: Editor['state']['doc'] | null } | null = null
  e.state.doc.descendants((n, pos, parent) => { if (!found && n.attrs.nodeId === nodeId) found = { node: n, pos, parent } })
  if (!found) throw new Error(`找不到节点 ${nodeId}`)
  return found as { node: Editor['state']['doc']; pos: number; parent: Editor['state']['doc'] | null }
}
export function clauseByTitle(e: Editor, title: string) {
  const nodes = [] as Array<{ node: Editor['state']['doc']; parent: Editor['state']['doc'] | null }>
  e.state.doc.descendants((n, _pos, parent) => { if (n.type.name === 'clause' && n.firstChild?.textContent === title) nodes.push({ node: n, parent }) })
  if (nodes.length !== 1) throw new Error(`标题「${title}」的条数为 ${nodes.length}`)
  return nodes[0]!
}
/** 编辑器当前内容转 IR 后的问题与编号。 */
export function irOf(e: Editor) {
  const converted = pmToIr(e.getJSON() as PMJsonNode)
  const resolved = resolve(converted.doc)
  return { ...converted, problems: resolved.problems, labels: resolved.labels }
}
export function structureProblems(e: Editor, codes = ['heading-skip', 'hanging-paragraph']) {
  return irOf(e).problems.filter(item => codes.includes(item.code))
}
