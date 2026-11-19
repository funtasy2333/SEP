// @vitest-environment happy-dom
import JSZip from 'jszip'
import { Editor, getSchema } from '@tiptap/core'
import { expect, it } from 'vitest'
import { irToPm, pmToIr, renderHtml, resolve, type IRDoc, type IRFormula, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { replaceEditorDocument } from '../utils/editorDocument'
import { buildDocxBlob } from '../serializer/docxExporter'

const sourceLatex = '\\mathrm{STALEONLY}+1'
const schema = getSchema(createEditorExtensions())
const authored = (): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'ch', secType: 'general', title: [{ text: '正文' }], children: [
    { kind: 'formula', id: 'formula', latex: sourceLatex, numbered: true, whereList: [] },
  ] }], appendices: [], bibliography: [],
})

it.each(['\\mathrm{LATESTONLY}+2', ''])('exports the actually edited formula content %j without restoring stale latex', async latex => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: irToPm(authored()) })
  try {
    let start = -1
    let end = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'formulaContent') { start = pos + 1; end = pos + node.nodeSize - 1 }
    })
    expect(start).toBeGreaterThan(0)
    const tr = latex ? editor.state.tr.replaceWith(start, end, editor.schema.text(latex)) : editor.state.tr.delete(start, end)
    editor.view.dispatch(tr)
    const edited = editor.getJSON() as PMJsonNode
    editor.state.doc.check()
    // Exercise the real editor's existing behavior: it does not synchronize this snapshot attribute.
    expect(edited.content!.find(node => node.type === 'chapter')!.content!.find(node => node.type === 'formula')!.attrs!.latex).toBe(sourceLatex)
    const inputSnapshot = JSON.stringify(edited)
    const first = pmToIr(edited).doc
    expect((first.body[0].children[0] as IRFormula).latex).toBe(latex)
    expect(first.unsupportedContent).toBeUndefined()
    const resolved = resolve(first)
    expect(resolved.problems.filter(problem => problem.severity === 'error')).toEqual([])
    const html = new DOMParser().parseFromString(renderHtml(first, resolved.labels), 'text/html')
    expect(html.querySelector('.ses-formula')?.getAttribute('data-latex')).toBe(latex)
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(edited)))
    expect((pmToIr(reopened.toJSON() as PMJsonNode).doc.body[0].children[0] as IRFormula).latex).toBe(latex)
    const projected = schema.nodeFromJSON(irToPm(first))
    projected.check()
    expect((pmToIr(projected.toJSON() as PMJsonNode).doc.body[0].children[0] as IRFormula).latex).toBe(latex)
    const { blob } = await buildDocxBlob({ pmDoc: edited, documentMeta: { titleCn: '正文', standardType: 'national' } })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const text = new DOMParser().parseFromString(xml, 'text/xml').documentElement.textContent ?? ''
    expect(text).not.toContain('STALEONLY')
    if (latex) expect(text).toContain('LATESTONLY')
    expect(JSON.stringify(edited)).toBe(inputSnapshot)
  } finally {
    editor.destroy()
  }
})

it('renders imported MathML in a read-only editor without mutating the stored source', () => {
  const input = authored()
  const formula = input.body[0].children[0] as IRFormula
  formula.latex = ''
  formula.mathml = '<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML"><mml:mfrac><mml:mi>x</mml:mi><mml:mi>y</mml:mi></mml:mfrac></mml:math>'
  const editor = new Editor({ editable: false, extensions: createEditorExtensions(), content: irToPm(input) })
  try {
    const preview = editor.view.dom.querySelector<HTMLButtonElement>('.std-formula-preview')!
    expect(preview.querySelector('mfrac')?.textContent).toBe('xy')
    let opened = false
    editor.view.dom.addEventListener('ses:block-formula', () => { opened = true })
    preview.click()
    expect(opened).toBe(false)
    expect((pmToIr(editor.getJSON() as PMJsonNode).doc.body[0].children[0] as IRFormula).mathml).toBe(formula.mathml)
  } finally {
    editor.destroy()
  }
})

it('refreshes a MathML-only preview when a remote reload changes only the parent attribute', () => {
  const doc = authored()
  const formula = doc.body[0].children[0] as IRFormula
  formula.latex = ''
  formula.mathml = '<math><mi>x</mi></math>'
  const editor = new Editor({ extensions: createEditorExtensions(), content: irToPm(doc) })
  const preview = () => editor.view.dom.querySelector('.std-formula-preview')?.textContent
  try {
    expect(preview()).toBe('x')
    const remote = structuredClone(editor.getJSON())
    const attrs = (remote as PMJsonNode).content!.find(n => n.type === 'chapter')!.content!.find(n => n.type === 'formula')!.attrs!
    attrs.mathml = '<math><mi>y</mi></math>'
    expect(replaceEditorDocument(editor, remote, false, false)).toBe(true)
    expect(preview()).toBe('y')
    attrs.mathml = null
    expect(replaceEditorDocument(editor, remote, false, false)).toBe(true)
    expect(preview()).toBe('空公式')
  } finally {
    editor.destroy()
  }
})

it.each(['wrong-first', 'correct-first'] as const)('validates wrong kinds on paragraph targets through production schema with %s references', order => {
  const input = authored()
  const wrong = { kind: 'paragraph' as const, id: 'wrong', content: [{ text: '图引用', marks: [{ type: 'crossRef' as const, targetId: 'target', targetKind: 'figure' as const }] }] }
  const correct = { kind: 'paragraph' as const, id: 'correct', content: [{ text: '段落引用', marks: [{ type: 'crossRef' as const, targetId: 'target', targetKind: 'paragraph' as const }] }] }
  input.body[0].children = [{ kind: 'paragraph', id: 'target', content: [{ text: '目标' }] }, ...(order === 'wrong-first' ? [wrong, correct] : [correct, wrong])]
  const loaded = schema.nodeFromJSON(irToPm(input))
  loaded.check()
  const reopened = pmToIr(loaded.toJSON() as PMJsonNode).doc
  expect(resolve(reopened).problems.filter(problem => problem.severity === 'error')).toEqual([
    expect.objectContaining({ code: 'dangling-typed-ref', nodeId: 'wrong' }),
  ])
})
