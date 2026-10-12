// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { expect, it } from 'vitest'
import { irToPm, pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'

const schema = getSchema(createEditorExtensions())
function records(root: PMJsonNode): Map<string, PMJsonNode> {
  const result = new Map<string, PMJsonNode>()
  const visit = (node: PMJsonNode): void => {
    const id = node.attrs?.nodeId
    if (typeof id === 'string') result.set(id, node)
    // Image/link carriers deliberately have no semantic entity ID.
    if (node.type === 'figureImage') result.set(`image:${node.attrs?.resourceId}`, node)
    if (node.type === 'bibExternalLink') result.set(`bib-link:${node.attrs?.href}`, node)
    node.content?.forEach(visit)
  }
  visit(root)
  return result
}

it('每个生产语义记录的属性与代码文本都经过IR保留，而不是仅比较已丢字段的IR', () => {
  const fixture = createWp6Fixture()
  const addAtomMarks = (node: PMJsonNode): void => {
    if (node.type === 'formulaInline') node.marks = [
      { type: 'variable', attrs: { kind: 'expression', name: 'inline-math' } },
      { type: 'textStyle', attrs: { color: '#abcdef' } },
    ]
    node.content?.forEach(addAtomMarks)
  }
  addAtomMarks(fixture)
  const original = schema.nodeFromJSON(fixture)
  original.check()
  const projected = schema.nodeFromJSON(irToPm(pmToIr(original.toJSON() as PMJsonNode).doc))
  projected.check()
  const before = records(original.toJSON() as PMJsonNode)
  const after = records(projected.toJSON() as PMJsonNode)
  // Cover/front/bibliography wrappers retain their legacy IR contract (metadata/derived labels).
  const legacyContainers = new Set(['coverPage', 'foreword', 'introduction', 'bibliography', 'paragraph'])
  for (const [id, record] of before) {
    if (legacyContainers.has(record.type)) continue
    const reopened = after.get(id)
    expect(reopened, `${record.type} ${id}`).toBeDefined()
    for (const [key, value] of Object.entries(record.attrs ?? {})) {
      if (value !== null && value !== undefined) expect(reopened?.attrs?.[key], `${id}.${key}`).toEqual(value)
    }
    if (record.marks) expect(reopened?.marks, `${id}.marks`).toEqual(record.marks)
    if (record.type === 'codeBlock' || record.type === 'stdParagraph') expect(reopened?.content, `${id}.content`).toEqual(record.content)
  }
  expect(JSON.stringify(projected.toJSON())).toContain('在线来源')
  expect(JSON.stringify(projected.toJSON())).toContain('key = value')
})
