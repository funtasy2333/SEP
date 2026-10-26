// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ValidationIssue } from '@ses/shared'
import { createEditorSchema } from '../extensions/editorSchema'
import { processAnalysisRequest } from './analysis.worker'
import { clause, phase6Fixture, paragraph, text } from './__fixtures__/phase6'
import { resolveValidationIssueAnchors } from './anchors'

function reportFor(doc: ReturnType<ReturnType<typeof createEditorSchema>['nodeFromJSON']>) {
  const response = processAnalysisRequest({
    type: 'analyze', runId: 1, documentId: 1, generation: 1,
    pmJson: doc.toJSON(),
    documentMeta: { titleCn: '测试标准', standardType: 'national' },
  })
  if (response.type !== 'result') throw new Error(response.message)
  return response.report
}

function issue(docReport: ReturnType<typeof reportFor>, ruleId: string, nodeId: string | null) {
  return docReport.issues.find(item => item.ruleId === ruleId && item.nodeId === nodeId)!
}

describe('ProseMirror validation anchors', () => {
  it('maps object, appendix, and term-hit evidence to actual live PM node spans', () => {
    const fixture = phase6Fixture()
    const requirements = fixture.content!.find(node => node.attrs?.nodeId === 'requirements')!
    const chapterTitle = requirements.content![0]!
    const figure = requirements.content!.find(node => node.type === 'figure')!
    const table = requirements.content!.find(node => node.type === 'stdTable')!
    requirements.content = [chapterTitle, paragraph('single-usage', text('阀门应按检验流程操作。')), figure, table]
    const editorDoc = createEditorSchema().nodeFromJSON(fixture)
    editorDoc.check()
    const report = reportFor(editorDoc)

    const anchors = resolveValidationIssueAnchors(editorDoc, [
      issue(report, 'object.introduction-and-mention', 'figure-one'),
      issue(report, 'object.introduction-and-mention', 'table-one'),
      issue(report, 'appendix.body-mention', 'appendix-a'),
      issue(report, 'term.minimum-usage', 'term-valve'),
    ])

    expect(anchors.map(anchor => [anchor.nodeId, anchor.status])).toEqual([
      ['figure-one', 'located'], ['table-one', 'located'], ['appendix-a', 'located'], ['single-usage', 'located'],
    ])
    for (const anchor of anchors) {
      if (anchor.status !== 'located' || anchor.from === undefined || anchor.to === undefined) {
        throw new Error('Expected a located PM anchor')
      }
      const node = editorDoc.nodeAt(anchor.from)
      expect(node?.attrs.nodeId).toBe(anchor.nodeId)
      expect(anchor.to - anchor.from).toBe(node?.nodeSize)
    }
  })

  it('anchors a missing list introduction to the list instead of its preceding evidence paragraph', () => {
    const fixture = phase6Fixture()
    const requirements = fixture.content!.find(node => node.attrs?.nodeId === 'requirements')!
    const lead = requirements.content!.find(node => node.attrs?.nodeId === 'list-lead')!
    lead.content = [text('检验项目')]
    const editorDoc = createEditorSchema().nodeFromJSON(fixture)
    editorDoc.check()
    const report = reportFor(editorDoc)
    const listIssue = issue(report, 'list.introduction', 'list-one')!
    const anchor = resolveValidationIssueAnchors(editorDoc, [listIssue])[0]!

    expect(listIssue.evidence?.[0]?.nodeId).toBe('list-lead')
    expect(anchor).toMatchObject({ status: 'located', nodeId: 'list-one', source: 'issue' })
    expect(editorDoc.nodeAt(anchor.from!)?.attrs.nodeId).toBe('list-one')
  })

  it('refuses duplicate node IDs and never interprets an IR path as a PM position', () => {
    const fixture = phase6Fixture()
    const appendix = fixture.content!.find(node => node.type === 'appendix')!
    appendix.content!.push(clause('appendix-subclause', paragraph('appendix-subcontent', text('附录条文。'))))
    const requirements = fixture.content!.find(node => node.attrs?.nodeId === 'requirements')!
    requirements.content!.push(paragraph('appendix-text', text('重复的节点标识。')))
    const editorDoc = createEditorSchema().nodeFromJSON(fixture)
    editorDoc.check()
    const report = reportFor(editorDoc)

    const duplicate = resolveValidationIssueAnchors(editorDoc, [issue(report, 'structure.hanging-paragraph', 'appendix-text')])[0]!
    const synthetic: ValidationIssue = {
      id: 'synthetic-front-issue', ruleId: 'structure.hanging-paragraph', severity: 'warning', category: 'structure',
      nodeId: null, path: 'front.foreword[0]', message: '前言问题', suggestion: '核对前言。',
      basis: { kind: 'project-convention', text: '项目约定。' },
      evidence: [{ nodeId: null, path: 'front.foreword[0]', text: '前言内容' }],
    }
    const unknown = resolveValidationIssueAnchors(editorDoc, [synthetic])[0]!

    expect(duplicate).toMatchObject({ status: 'ambiguous', nodeId: 'appendix-text' })
    expect(duplicate.reason).toContain('相同节点 ID')
    expect(unknown).toMatchObject({ status: 'unavailable', nodeId: null })
    expect(unknown.reason).toContain('前言')
    expect(unknown).not.toHaveProperty('from')
  })
})
