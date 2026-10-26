// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createEditorSchema } from '../extensions/editorSchema'
import { phase6Fixture } from './__fixtures__/phase6'
import { processAnalysisRequest } from './analysis.worker'

describe('validation worker protocol', () => {
  it('analyzes the current ProseMirror snapshot with effective document metadata', () => {
    const pm = createEditorSchema().nodeFromJSON({
      ...phase6Fixture(),
      attrs: { titleCn: '旧正文标题', standardType: 'national' },
    })
    pm.check()

    const response = processAnalysisRequest({
      type: 'analyze',
      runId: 17,
      documentId: 5,
      generation: 9,
      pmJson: pm.toJSON(),
      documentMeta: {
        titleCn: '当前文件设置标题',
        standardNo: 'GB/T 1.1—2020',
        standardType: 'national',
      },
    })

    expect(response).toMatchObject({
      type: 'result',
      runId: 17,
      documentId: 5,
      generation: 9,
      effectiveMeta: {
        title: '当前文件设置标题',
        stdCode: 'GB/T 1.1—2020',
        standardType: 'gb',
      },
      report: { profile: 'ses-phase6-manual-v2' },
    })
  })

  it('returns PM-to-IR loss diagnostics alongside the quality report', () => {
    const fixture = phase6Fixture()
    fixture.content!.push(
      { type: 'foreword', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前言一。' }] }] },
      { type: 'foreword', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前言二。' }] }] },
    )
    const pm = createEditorSchema().nodeFromJSON(fixture)
    pm.check()

    const response = processAnalysisRequest({
      type: 'analyze',
      runId: 18,
      documentId: 5,
      generation: 9,
      pmJson: pm.toJSON(),
      documentMeta: { titleCn: '范围', standardType: 'national' },
    })

    expect(response.type).toBe('result')
    if (response.type !== 'result') throw new Error('Expected analysis result')
    expect(response.conversion.unsupported.some(item => item.nodeType === 'foreword')).toBe(true)
    expect(response.conversion.warnings.length).toBeGreaterThan(0)
    expect(response.report.coverage.structure.status).toBe('checked')
  })
})
