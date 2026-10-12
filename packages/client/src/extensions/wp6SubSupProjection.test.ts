// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { irToPm, pmToIr, type IRDoc, type PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'
import { exportSemanticJson } from '../serializer/jsonExporter'

const schema = getSchema(createEditorExtensions())

function authoredDocument(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter-sub-sup', secType: 'general', title: [], children: [{
        kind: 'paragraph', id: 'paragraph-sub-sup', content: [
          { text: '下标文本', marks: [{ type: 'sub' }] },
          { text: '上标文本', marks: [{ type: 'sup' }] },
          { text: '', formula: { id: 'formula-sub', latex: 'x_1' }, marks: [{ type: 'sub' }] },
          { text: '', formula: { id: 'formula-sup', latex: 'x^1' }, marks: [{ type: 'sup' }] },
        ],
      }],
    }],
    appendices: [],
    bibliography: [],
  }
}

function marksForNode(doc: PMNode, type: 'text' | 'formulaInline', selector: (node: PMNode) => boolean) {
  const found: string[][] = []
  doc.descendants(node => {
    if (node.type.name === type && selector(node)) found.push(node.marks.map(mark => mark.type.name))
  })
  return found
}

describe('IR subscript and superscript in the production editor schema', () => {
  it('preserves sub/sup on text and formula through semantic/raw JSON and two HTML reopen cycles', () => {
    const source = authoredDocument()
    const original = structuredClone(source)
    const projected = schema.nodeFromJSON(irToPm(source))
    projected.check()

    const rawJson = JSON.parse(JSON.stringify(projected.toJSON())) as PMJsonNode
    const rawReopened = schema.nodeFromJSON(rawJson)
    rawReopened.check()

    const semanticSaved = JSON.parse(JSON.stringify(exportSemanticJson(rawReopened as PMNode))) as PMJsonNode
    const semanticPmReopened = schema.nodeFromJSON(semanticSaved)
    semanticPmReopened.check()
    const semanticReopened = pmToIr(semanticPmReopened.toJSON() as PMJsonNode).doc
    expect(semanticReopened.body[0]!.children[0]).toMatchObject({
      kind: 'paragraph',
      content: [
        { text: '下标文本', marks: [{ type: 'sub' }] },
        { text: '上标文本', marks: [{ type: 'sup' }] },
        { text: '', formula: { id: 'formula-sub', latex: 'x_1' }, marks: [{ type: 'sub' }] },
        { text: '', formula: { id: 'formula-sup', latex: 'x^1' }, marks: [{ type: 'sup' }] },
      ],
    })
    let htmlReopened = semanticPmReopened
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const container = document.createElement('div')
      container.append(DOMSerializer.fromSchema(schema).serializeFragment(htmlReopened.content))
      expect(container.querySelector('sub')?.textContent).toContain('下标文本')
      expect(container.querySelector('sup')?.textContent).toContain('上标文本')
      htmlReopened = DOMParser.fromSchema(schema).parse(container)
      htmlReopened.check()
    }

    expect(marksForNode(htmlReopened, 'text', node => node.text === '下标文本')).toEqual([['subscript']])
    expect(marksForNode(htmlReopened, 'text', node => node.text === '上标文本')).toEqual([['superscript']])
    expect(marksForNode(htmlReopened, 'formulaInline', node => node.attrs.nodeId === 'formula-sub')).toEqual([['subscript']])
    expect(marksForNode(htmlReopened, 'formulaInline', node => node.attrs.nodeId === 'formula-sup')).toEqual([['superscript']])

    const htmlSemanticReopened = pmToIr(htmlReopened.toJSON() as PMJsonNode).doc
    expect(htmlSemanticReopened.body[0]!.children[0]).toMatchObject({
      kind: 'paragraph',
      content: [
        { text: '下标文本', marks: [{ type: 'sub' }] },
        { text: '上标文本', marks: [{ type: 'sup' }] },
        { text: '', formula: { id: 'formula-sub', latex: 'x_1' }, marks: [{ type: 'sub' }] },
        { text: '', formula: { id: 'formula-sup', latex: 'x^1' }, marks: [{ type: 'sup' }] },
      ],
    })
    expect(source).toEqual(original)
  })
})
