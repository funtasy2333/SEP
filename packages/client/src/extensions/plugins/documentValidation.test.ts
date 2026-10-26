// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { EditorState } from '@tiptap/pm/state'
import { createEditorSchema } from '../editorSchema'
import { phase6Fixture } from '../../validation/__fixtures__/phase6'
import { createDocumentValidationPlugin, documentValidationPluginKey } from './documentValidation'

function nodeSpan(doc: ReturnType<ReturnType<typeof createEditorSchema>['nodeFromJSON']>, nodeId: string) {
  let span: { from: number; to: number } | undefined
  doc.descendants((node, from) => {
    if (node.attrs.nodeId === nodeId) span = { from, to: from + node.nodeSize }
  })
  if (!span) throw new Error(`Missing node ${nodeId}`)
  return span
}

describe('document validation decorations', () => {
  it('marks actual PM node spans without changing the document and clears them after a body edit', () => {
    const doc = createEditorSchema().nodeFromJSON(phase6Fixture())
    doc.check()
    const target = nodeSpan(doc, 'figure-one')
    const plugin = createDocumentValidationPlugin()
    const initial = EditorState.create({ doc, plugins: [plugin] })
    const marked = initial.apply(initial.tr
      .setMeta(documentValidationPluginKey, [{
        issueId: 'figure-intro', nodeId: 'figure-one', severity: 'warning',
        status: 'located', ...target,
      }])
      .setMeta('addToHistory', false))

    expect(marked.doc).toBe(initial.doc)
    expect(documentValidationPluginKey.getState(marked)?.find()).toMatchObject([
      { from: target.from, to: target.to, type: { attrs: { 'data-validation-issue-ids': 'figure-intro' } } },
    ])

    const paragraph = nodeSpan(doc, 'scope-p')
    const changed = marked.apply(marked.tr.insertText('已修改', paragraph.from + 1))
    expect(documentValidationPluginKey.getState(changed)?.find()).toEqual([])
  })
})
