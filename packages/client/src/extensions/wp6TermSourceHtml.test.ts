// @vitest-environment happy-dom
import { pmToIr, type IRDoc, type PMJsonNode } from '@ses/shared'
import { getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())
const richSource = [
  { type: 'text', text: 'ISO ', marks: [{ type: 'bold' }] },
  { type: 'text', text: 'Vocabulary', marks: [{ type: 'italic' }, { type: 'textStyle', attrs: { color: '#123456' } }] },
]

function termDocument(sourceContent: PMJsonNode[]): PMJsonNode {
  return {
    type: 'doc',
    content: [{
      type: 'chapter',
      attrs: { nodeId: 'chapter-source' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '术语和定义' }] },
        {
          type: 'termDef',
          attrs: { nodeId: 'term-source-owner', level: 1 },
          content: [
            { type: 'termName', content: [{ type: 'text', text: '术语' }] },
            { type: 'termDefinition', content: [{ type: 'text', text: '定义内容' }] },
            { type: 'termSource', content: sourceContent },
          ],
        },
      ],
    }],
  }
}

function roundtrip(json: PMJsonNode) {
  const source = schema.nodeFromJSON(json)
  source.check()
  const container = document.createElement('div')
  container.append(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
  const html = container.innerHTML
  const input = document.createElement('div')
  input.innerHTML = html
  const reopened = DOMParser.fromSchema(schema).parse(input)
  reopened.check()
  return { container, html, reopened }
}

function termSourceNode(doc: ReturnType<typeof schema.nodeFromJSON>) {
  return doc.firstChild!.child(1).child(2)
}

function sourceFromIr(doc: IRDoc) {
  return (doc.body[0]!.children[0] as Extract<IRDoc['body'][number]['children'][number], { kind: 'termEntry' }>).source
}

describe('TermSource production HTML roundtrip', () => {
  it('preserves rich source content without parsing its label into the source', () => {
    const original = termDocument(richSource as PMJsonNode[])
    const originalBytes = JSON.stringify(original)
    let current = original

    for (let pass = 0; pass < 3; pass++) {
      const { container, reopened } = roundtrip(current)
      expect(container.querySelector('.std-term-source-label')?.textContent).toBe('来源：')
      expect(container.querySelector('.std-term-source-content')?.textContent).toBe('ISO Vocabulary')
      const pmSource = termSourceNode(reopened).toJSON() as PMJsonNode
      expect(pmSource.type).toBe('termSource')
      expect(pmSource.content).toHaveLength(richSource.length)
      expect(pmSource.content?.[0]).toMatchObject(richSource[0])
      expect(pmSource.content?.[1]).toMatchObject(richSource[1])
      expect(sourceFromIr(pmToIr(reopened.toJSON() as PMJsonNode).doc)).toEqual([
        { text: 'ISO ', marks: [{ type: 'bold' }] },
        { text: 'Vocabulary', marks: [{ type: 'italic' }], style: { color: '#123456' } },
      ])
      current = reopened.toJSON() as PMJsonNode
    }

    expect(JSON.stringify(original)).toBe(originalBytes)
  })

  it('keeps an empty source empty through repeated HTML roundtrips', () => {
    const original = termDocument([])
    const originalBytes = JSON.stringify(original)
    let current = original

    for (let pass = 0; pass < 3; pass++) {
      const { container, reopened } = roundtrip(current)
      expect(container.querySelector('.std-term-source-label')?.textContent).toBe('来源：')
      expect(container.querySelector('.std-term-source-content')?.childNodes.length).toBe(0)
      expect(termSourceNode(reopened).childCount).toBe(0)
      expect(sourceFromIr(pmToIr(reopened.toJSON() as PMJsonNode).doc)).toEqual([])
      current = reopened.toJSON() as PMJsonNode
    }

    expect(JSON.stringify(original)).toBe(originalBytes)
  })

  it.each(['p', 'div'])('reads rich text from an external tagged <%s> without an editor content slot', (tag) => {
    const source = schema.nodeFromJSON(termDocument([]))
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
    const renderedSource = container.querySelector('[data-type="term-source"]')
    expect(renderedSource).not.toBeNull()

    const externalSource = document.createElement(tag)
    externalSource.setAttribute('data-type', 'term-source')
    externalSource.innerHTML = '<strong>外部</strong> 来源'
    renderedSource!.replaceWith(externalSource)

    const parsed = DOMParser.fromSchema(schema).parse(container)
    parsed.check()
    const pmSource = termSourceNode(parsed).toJSON() as PMJsonNode
    expect(pmSource.type).toBe('termSource')
    expect(pmSource.content).toMatchObject([
      { type: 'text', text: '外部', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' 来源' },
    ])
  })

  it('leaves an external plain paragraph to the ordinary paragraph parser', () => {
    const input = document.createElement('div')
    input.innerHTML = '<p>外部来源文本</p>'
    const parsed = DOMParser.fromSchema(schema).parse(input)
    parsed.check()

    expect(parsed.firstChild?.type.name).not.toBe('termSource')
    expect(parsed.firstChild?.textContent).toBe('外部来源文本')
    expect(parsed.firstChild?.textContent).not.toContain('来源：')
  })
})
