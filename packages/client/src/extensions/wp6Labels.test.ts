// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { expect, it, vi } from 'vitest'
import { buildXml46687Package, importXml46687 } from '@ses/io'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'
import { resolveEditorLabels, semanticLabels } from '../utils/semanticLabels'
import { docToText } from '../utils/docDiff'
import { replaceEditorDocument } from '../utils/editorDocument'
import { collectInternalReferences } from '../utils/internalReference'

it('光标移动和查看交叉引用目标复用当前文档的编号', () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: createWp6Fixture() })
  editor.mount(document.createElement('div'))
  // Let the initial editor transaction normalize legacy IDs before measuring selection updates.
  editor.view.dispatch(editor.state.tr)
  const doc = editor.state.doc
  const serialize = vi.spyOn(doc, 'toJSON')
  try {
    const { from, to } = editor.state.selection
    editor.commands.setTextSelection({ from, to: to + 1 })
    expect(editor.state.doc).toBe(doc)
    expect(collectInternalReferences(editor)).toContainEqual(expect.objectContaining({
      type: 'term', text: '1.1.1',
    }))
    expect(serialize).not.toHaveBeenCalled()
  } finally {
    serialize.mockRestore()
    editor.destroy()
  }
})

it('普通条文中修改文字时复用编号，被引用的段落仍更新引用文字', () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: {
    type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'ch' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '要求' }] },
      { type: 'stdParagraph', attrs: { nodeId: 'plain' }, content: [{ type: 'text', text: '普通正文' }] },
      { type: 'stdParagraph', attrs: { nodeId: 'target' }, content: [{ type: 'text', text: '目标正文' }] },
      { type: 'stdParagraph', attrs: { nodeId: 'ref' }, content: [{ type: 'text', text: '目标正文', marks: [
        { type: 'crossRef', attrs: { targetId: 'target', refType: 'paragraph', refText: '目标正文' } },
      ] }] },
    ] }],
  } })
  try {
    editor.view.dispatch(editor.state.tr)
    const initialLabels = resolveEditorLabels(editor.state.doc)
    const posFor = (id: string) => {
      let position = -1
      editor.state.doc.descendants((node, pos) => { if (node.attrs.nodeId === id) position = pos + 1 })
      return position
    }
    const edit = editor.state.tr.insertText('更新', posFor('plain'))
    const serialize = vi.spyOn(edit.doc, 'toJSON')
    editor.view.dispatch(edit)
    expect(resolveEditorLabels(editor.state.doc)).toBe(initialLabels)
    expect(serialize).not.toHaveBeenCalled()
    serialize.mockRestore()

    editor.view.dispatch(editor.state.tr.insertText('更新', posFor('target')))
    expect(resolveEditorLabels(editor.state.doc).target?.refText).toBe('更新目标正文')
    expect(editor.view.dom.querySelector('[data-node-id="ref"]')?.textContent).toBe('更新目标正文')
  } finally {
    editor.destroy()
  }
})

it('编辑器DOM、版本差异与JSON共用Resolver，嵌套术语编号不受旧level计数器影响', () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: createWp6Fixture() })
  editor.mount(document.createElement('div'))
  const before = editor.getJSON() as PMJsonNode
  const labels = resolve(pmToIr(before).doc).labels
  const term = editor.view.dom.querySelector<HTMLElement>('[data-type="term-def"]')!
  expect(term.querySelector<HTMLElement>('.std-term-name')?.dataset.resolvedLabel).toBe('1.1.1')
  for (const element of editor.view.dom.querySelectorAll<HTMLElement>('[data-resolved-label]')) {
    const owner = element.closest<HTMLElement>('[data-node-id]')!
    expect(element.dataset.resolvedLabel).toBe(labels[owner.dataset.nodeId!]!.label)
  }
  expect(docToText(before as unknown as Record<string, unknown>)).toContain('1.1.1 ')
  expect(editor.getJSON()).toEqual(before)
  // A view update must retain derived labels without inserting cached numbers in PM JSON.
  editor.commands.setTextSelection(1)
  editor.view.dispatch(editor.state.tr)
  const updated = editor.getJSON() as PMJsonNode
  const derived = resolve(pmToIr(updated).doc).labels
  expect(term.querySelector<HTMLElement>('.std-term-name')?.dataset.resolvedLabel).toBe(derived[term.dataset.nodeId!]!.label)
  expect(JSON.stringify(updated)).not.toContain('resolvedLabel')
  editor.destroy()
})

it('缺少历史nodeId的编号投影不修改输入且使用Resolver的层级规则', () => {
  const source = createWp6Fixture()
  const removeIds = (node: PMJsonNode) => {
    if (node.attrs) delete node.attrs.nodeId
    node.content?.forEach(removeIds)
  }
  removeIds(source)
  const before = structuredClone(source)
  const projected = semanticLabels(source)
  const terms: PMJsonNode[] = []
  const visit = (node: PMJsonNode) => {
    if (node.type === 'termDef') terms.push(node)
    node.content?.forEach(visit)
  }
  visit(source)
  expect(projected.labelFor(terms[0]!)).toBe('1.1.1')
  expect(source).toEqual(before)
})

it('只含新术语来源carrier时XML46687保留来源标识，不把来源变成定义', async () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: {
    type: 'doc', content: [{ type: 'chapter', attrs: {nodeId: 'c', secType: 'terms'}, content: [
      {type: 'chapterTitle', content: [{type: 'text', text: '术语和定义'}]},
      {type: 'termDef', attrs: {nodeId: 't'}, content: [
        {type: 'termName', content: [{type: 'text', text: '文档'}]},
        {type: 'termDefinition', attrs: {nodeId: 'd'}, content: [{type: 'text', text: '定义'}]},
        {type: 'termSource', content: [{type: 'text', text: 'ISO vocabulary'}]},
      ]},
    ]}],
  }})
  const before = editor.getJSON()
  const { xml, problems } = await buildXml46687Package({ pmDoc: before as PMJsonNode, documentMeta: { standardType: 'national', titleCn: '术语测试' } })
  expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(xml).toContain('ISO vocabulary')
  const imported = await importXml46687(xml!, {
    validateContent: (candidate) => {
      try {
        const node = editor.schema.nodeFromJSON(candidate)
        node.check()
        return { ok: true, content: node.toJSON() as PMJsonNode }
      } catch (error) {
        return { ok: false, code: 'xml-schema-invalid', message: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  expect(imported.problems.filter(problem => problem.severity === 'error')).toEqual([])
  const reopened = pmToIr(imported.pmDoc!).doc
  expect(reopened.body[0]?.children[0]).toMatchObject({
    kind: 'termEntry', source: [{ text: 'ISO vocabulary' }],
    definition: [{ kind: 'paragraph', content: [{ text: '定义' }] }],
  })
  expect(editor.getJSON()).toEqual(before)
  editor.destroy()
})

it('实际加载和回滚入口保留根级元数据/扩展版本；旧文档重载会清除前一文档回退数据', () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: '<p></p>' })
  const source = createWp6Fixture()
  const before = structuredClone(source)
  expect(replaceEditorDocument(editor, source as unknown as Record<string, unknown>)).toBe(true)
  expect(editor.getJSON().attrs).toEqual(source.attrs)
  const loaded = pmToIr(editor.getJSON() as PMJsonNode).doc
  expect(loaded.extensionVersion).toBe(1)
  expect(loaded.meta.titleParts?.[0]?.id).toBe('meta-title-zh')
  const fallbackOnly = structuredClone(source)
  fallbackOnly.content = fallbackOnly.content?.filter(node => node.type !== 'metadataBlock')
  replaceEditorDocument(editor, fallbackOnly as unknown as Record<string, unknown>, false)
  expect(pmToIr(editor.getJSON() as PMJsonNode).doc.meta.titleParts?.[0]?.id).toBe('fallback-title')
  const oldDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
  replaceEditorDocument(editor, oldDoc)
  expect(editor.getJSON().attrs?.extensionVersion).toBeNull()
  expect(editor.getJSON().attrs?.titleParts).toBeNull()
  expect(source).toEqual(before)
  editor.destroy()
})
