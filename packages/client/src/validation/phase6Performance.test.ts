// @vitest-environment node
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { EditorState } from '@tiptap/pm/state'
import { createDocumentValidationPlugin, documentValidationPluginKey } from '../extensions/plugins/documentValidation'
import { resolveValidationIssueAnchors } from './anchors'
import { analyzeDocument, pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorSchema, normalizeNodeIds } from '../extensions/editorSchema'
import { paragraph, phase6Fixture, text } from './__fixtures__/phase6'

/** Representative actual PM documents; record timings separately from deterministic correctness assertions. */
function largeDocument(blocks: number): PMJsonNode {
  const pm = phase6Fixture()
  const req = pm.content!.find(node => node.attrs?.nodeId === 'requirements')!
  const figure = req.content!.find(node => node.type === 'figure')!
  const table = req.content!.find(node => node.type === 'stdTable')!
  for (let i = 0; i < blocks; i++) {
    if (i % 50 === 0) {
      const object = JSON.parse(JSON.stringify(i % 100 === 0 ? figure : table)) as PMJsonNode
      const id = `large-object-${i}`
      object.attrs = { ...object.attrs, nodeId: id }
      req.content!.push(paragraph(`large-lead-${i}`, text('检验结构应符合'), text('对应图表', [{ type: 'crossRef', attrs: { targetId: id, refType: object.type === 'figure' ? 'figure' : 'table' } }]), text('的规定。')), object)
    } else {
      req.content!.push(paragraph(`large-p-${i}`, text(`第${i}项检验应记录结果。阀门应正常工作。`)))
    }
  }
  return pm
}

describe('Phase 6 representative document measurements', () => {
  it.each([500, 2000, 10000])('checks %i content blocks without mutation or unresolved object mentions', blocks => {
    const schema = createEditorSchema()
    const pm = normalizeNodeIds(schema.nodeFromJSON(largeDocument(blocks)))
    pm.check()
    const before = JSON.stringify(pm.toJSON())
    const samples: { conversionMs: number; analysisMs: number; totalMs: number }[] = []
    for (let repeat = 0; repeat < 5; repeat++) {
      const started = performance.now()
      const ir = pmToIr(pm.toJSON() as PMJsonNode).doc
      const converted = performance.now()
      const report = analyzeDocument(ir).validation
      const completed = performance.now()
      samples.push({ conversionMs: converted - started, analysisMs: completed - converted, totalMs: completed - started })
      expect(report.issues.filter(issue => issue.ruleId === 'object.introduction-and-mention')).toEqual([])
      expect(report.coverage.footnotes.status).toBe('excluded')
    }
    expect(JSON.stringify(pm.toJSON())).toBe(before)

    // Exercise a substantial nonempty report through real PM anchors and decoration state.
    const unintroduced = pm.toJSON() as PMJsonNode
    const requirements = unintroduced.content!.find(node => node.attrs?.nodeId === 'requirements')!
    requirements.content = requirements.content!.filter(node => !String(node.attrs?.nodeId ?? '').startsWith('large-lead-'))
    const problemDoc = schema.nodeFromJSON(unintroduced)
    const report = analyzeDocument(pmToIr(unintroduced).doc).validation
    const anchorStart = performance.now()
    const anchors = resolveValidationIssueAnchors(problemDoc, report.issues)
    const anchorEnd = performance.now()
    const state = EditorState.create({ doc: problemDoc, plugins: [createDocumentValidationPlugin()] })
    const decorated = state.apply(state.tr.setMeta(documentValidationPluginKey, anchors).setMeta('addToHistory', false))
    const decorationEnd = performance.now()
    expect(anchors.filter(anchor => anchor.status === 'located').length).toBeGreaterThanOrEqual(blocks / 50)
    expect(documentValidationPluginKey.getState(decorated)!.find().length).toBeGreaterThanOrEqual(blocks / 50)
    expect(decorated.doc.eq(problemDoc)).toBe(true)
    console.info('PHASE6_PRESENTATION_MEASUREMENT', JSON.stringify({ blocks, issues: report.issues.length, anchorMs: anchorEnd - anchorStart, decorationMs: decorationEnd - anchorEnd }))
    console.info('PHASE6_MEASUREMENT', JSON.stringify({ blocks, samples }))
  }, 30000)
})
