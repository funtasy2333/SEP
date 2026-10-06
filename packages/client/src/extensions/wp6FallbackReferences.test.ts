// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { expect, it } from 'vitest'
import { IRToPmError, irToPm, pmToIr, resolve, type IRInline, type IRReferenceTargetKind, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())
function legacyFallback(storage: 'root' | 'cover', targetKind: IRReferenceTargetKind): PMJsonNode {
  const content: IRInline[] = [{ text: '见图', marks: [{ type: 'crossRef', targetId: 'figure-target', targetKind }] }]
  const fallback = {
    titleParts: [{ id: 'title', role: 'main', content }],
    identifiers: [{ id: 'identifier', parts: [{ id: 'identifier-part', kind: 'number', content }] }],
    publishers: [{ id: 'publisher', name: content }],
    copyrights: [{ id: 'copyright', holder: [{ text: '版权人' }], statement: content }],
  }
  return {
    type: 'doc', ...(storage === 'root' ? { attrs: fallback } : {}),
    content: [
      ...(storage === 'cover' ? [{ type: 'coverPage', attrs: fallback, content: [{ type: 'paragraph' }] }] : []),
      { type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '正文' }] },
        { type: 'figure', attrs: { nodeId: 'figure-target' }, content: [
          { type: 'figureImage', attrs: { src: 'https://example.org/figure.png' } },
          { type: 'figureCaption', content: [{ type: 'text', text: '目标图' }] },
        ] },
      ] },
    ],
  }
}

it.each(['root', 'cover'] as const)('preserves typed figure references from %s metadata through production projection and JSON reopen', storage => {
  const source = legacyFallback(storage, 'figure')
  const snapshot = JSON.stringify(source)
  const loaded = schema.nodeFromJSON(source)
  loaded.check()
  const first = pmToIr(loaded.toJSON() as PMJsonNode).doc
  expect(first.unsupportedContent).toBeUndefined()
  const expected = [{ text: '见图', marks: [{ type: 'crossRef', targetId: 'figure-target', targetKind: 'figure' }] }]
  expect(first.meta.titleParts![0].content).toEqual(expected)
  expect(first.meta.identifiers![0].parts[0].content).toEqual(expected)
  expect(first.meta.publishers![0].name).toEqual(expected)
  expect(first.meta.copyrights![0].holder).toEqual([{ text: '版权人' }])
  expect(first.meta.copyrights![0].statement).toEqual(expected)
  expect(resolve(first).problems.filter(problem => problem.severity === 'error')).toEqual([])
  const projected = schema.nodeFromJSON(irToPm(first))
  projected.check()
  const marks: Record<string, unknown>[] = []
  projected.descendants(node => {
    for (const mark of node.marks) if (mark.type.name === 'crossRef') marks.push(mark.attrs)
  })
  expect(marks).toHaveLength(4)
  expect(marks.every(mark => mark.refType === 'figure' && mark.targetId === 'figure-target')).toBe(true)
  const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(projected.toJSON())))
  reopened.check()
  const second = pmToIr(reopened.toJSON() as PMJsonNode).doc
  expect(second.meta).toEqual(first.meta)
  expect(resolve(second).problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(JSON.stringify(source)).toBe(snapshot)
})

it.each(['root', 'cover'] as const)('retains mismatched reference kinds from %s metadata for Resolver diagnostics', storage => {
  const loaded = schema.nodeFromJSON(legacyFallback(storage, 'table'))
  loaded.check()
  const first = pmToIr(loaded.toJSON() as PMJsonNode).doc
  const errors = resolve(first).problems.filter(problem => problem.code === 'dangling-typed-ref')
  expect(errors).toHaveLength(4)
  expect(errors.every(problem => problem.message.includes('table') && problem.message.includes('figure'))).toBe(true)
  const projected = schema.nodeFromJSON(irToPm(first))
  projected.check()
  const second = pmToIr(projected.toJSON() as PMJsonNode).doc
  expect(resolve(second).problems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual(errors)
})


it.each(['root', 'cover'] as const)('preserves references in %s string-only carriers and explicitly rejects lossy projection', storage => {
  const source = legacyFallback(storage, 'figure')
  const carrier = storage === 'root' ? source : source.content![0]
  const copyrights = carrier.attrs!.copyrights as { holder: IRInline[] }[]
  copyrights[0].holder = [{ text: '见图', marks: [{ type: 'crossRef', targetId: 'figure-target', targetKind: 'figure' }] }]
  const loaded = schema.nodeFromJSON(source)
  loaded.check()
  const first = pmToIr(loaded.toJSON() as PMJsonNode).doc
  expect(first.meta.copyrights![0].holder).toEqual(copyrights[0].holder)
  expect(resolve(first).problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(() => irToPm(first)).toThrow(IRToPmError)
  try {
    irToPm(first)
  } catch (error) {
    expect((error as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({ path: 'meta.copyrights.copyright.holder', nodeId: 'copyright' }))
  }
})

it.each(['root', 'cover'] as const)('preserves %s metadata footnote payload and its typed nested reference through projection', storage => {
  const source = legacyFallback(storage, 'figure')
  const carrier = storage === 'root' ? source : source.content![0]
  const publishers = carrier.attrs!.publishers as { name: IRInline[] }[]
  publishers[0].name = [{ text: '', footnote: { id: 'metadata-footnote', content: [
    { text: '见目标图', marks: [{ type: 'bold' }, { type: 'crossRef', targetId: 'figure-target', targetKind: 'figure' }] },
  ] } }]
  const snapshot = JSON.stringify(source)
  const loaded = schema.nodeFromJSON(source)
  loaded.check()
  const first = pmToIr(loaded.toJSON() as PMJsonNode).doc
  expect(first.meta.publishers![0].name).toEqual(publishers[0].name)
  expect(resolve(first).problems.filter(problem => problem.severity === 'error')).toEqual([])
  const projected = schema.nodeFromJSON(irToPm(first))
  projected.check()
  const second = pmToIr(projected.toJSON() as PMJsonNode).doc
  expect(second.meta.publishers![0].name).toEqual(publishers[0].name)
  expect(resolve(second).problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(JSON.stringify(source)).toBe(snapshot)
})

it.each(['root', 'cover'] as const)('reports malformed %s fallback references and footnotes instead of permitting lossy projection', storage => {
  const source = legacyFallback(storage, 'figure')
  const carrier = storage === 'root' ? source : source.content![0]
  carrier.attrs!.titleParts = [{ id: 'bad-title', content: [
    { text: '类型', marks: [{ type: 'crossRef', targetId: 'figure-target', targetKind: 'bibEntry' }] },
    { text: '表脚注', marks: [{ type: 'tableFootnoteRef', targetId: 'table-note', id: 42 }] },
    { text: '脚注', footnote: { id: 'bad-footnote', content: 'invalid' } },
  ] }]
  const snapshot = JSON.stringify(source)
  const loaded = schema.nodeFromJSON(source)
  loaded.check()
  const first = pmToIr(loaded.toJSON() as PMJsonNode).doc
  expect(first.unsupportedContent).toHaveLength(3)
  expect(first.unsupportedContent!.map(problem => problem.path)).toEqual([
    'meta.titleParts[0].content[0]', 'meta.titleParts[0].content[1]', 'meta.titleParts[0].content[2].footnote',
  ])
  expect(resolve(first).problems.filter(problem => problem.code === 'unsupported-content')).toHaveLength(3)
  expect(() => irToPm(first)).toThrow(IRToPmError)
  expect(JSON.stringify(source)).toBe(snapshot)
})
