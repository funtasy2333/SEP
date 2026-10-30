// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { expect, it } from 'vitest'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'
import { semanticLabels } from '../utils/semanticLabels'
import { docToText } from '../utils/docDiff'
import { replaceEditorDocument } from '../utils/editorDocument'
import { serializeToXml } from '../serializer/xmlSerializer'
import { parseXmlToEditorJson } from '../serializer/xmlParser'

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

it('只含新术语来源carrier时旧XML保留来源标识，不把来源变成定义', () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: {
    type: 'doc', content: [{ type: 'chapter', attrs: {nodeId: 'c'}, content: [
      {type: 'chapterTitle', content: [{type: 'text', text: '术语'}]},
      {type: 'termDef', attrs: {nodeId: 't'}, content: [
        {type: 'termName', content: [{type: 'text', text: '文档'}]},
        {type: 'termDefinition', attrs: {nodeId: 'd'}, content: [{type: 'text', text: '定义'}]},
        {type: 'termSource', content: [{type: 'text', text: 'ISO vocabulary'}]},
      ]},
    ]}],
  }})
  const before = editor.getJSON()
  const xml = serializeToXml(editor.state.doc)
  expect(xml).toContain('[来源：ISO vocabulary]')
  const reopened = pmToIr(parseXmlToEditorJson(xml, editor.schema.topNodeType.name)).doc
  expect(reopened.body[0]?.children[0]).toMatchObject({
    kind: 'termEntry', source: [{ text: '[来源：ISO vocabulary]' }],
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
