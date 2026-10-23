// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { analyzeDocument, pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorSchema, normalizeNodeIds } from '../extensions/editorSchema'
import { chapter, clause, paragraph, phase6Fixture, text } from './__fixtures__/phase6'

function inspect(pm: PMJsonNode) {
  const schema = createEditorSchema()
  const node = normalizeNodeIds(schema.nodeFromJSON(pm))
  node.check()
  return analyzeDocument(pmToIr(node.toJSON() as PMJsonNode).doc).validation
}
function requirement(pm: PMJsonNode): PMJsonNode {
  return pm.content!.find(n => n.attrs?.nodeId === 'requirements')!
}
function issuesFor(pm: PMJsonNode, ruleId: string) {
  return inspect(pm).issues.filter(issue => issue.ruleId === ruleId)
}

describe('Phase 6: production PM → IR → manual quality acceptance', () => {
  it('recognizes real editable elements and their hand-written introductions/mentions without changing source JSON', () => {
    const pm = phase6Fixture()
    const before = JSON.stringify(pm)
    const report = inspect(pm)
    expect(JSON.stringify(pm)).toBe(before)
    expect(report.issues.filter(issue => ['introductions', 'mentions', 'terms'].includes(issue.category))).toEqual([])
    expect(report.coverage.footnotes.status).toBe('excluded')
    expect(report.coverage.tableFootnotes.status).toBe('excluded')
    expect(report.coverage.bibliographyReminder.status).toBe('excluded')
    expect(report.coverage.standardDatabase.status).toBe('deferred')
  })

  it('reports absent introductions and appendix mention against the actual PM owner IDs', () => {
    const pm = phase6Fixture()
    requirement(pm).content = requirement(pm).content!.filter(n => !['objects-lead', 'list-lead'].includes(String(n.attrs?.nodeId)))
    const issues = inspect(pm).issues
    expect(issues.filter(i => i.ruleId === 'object.introduction-and-mention').map(i => i.nodeId)).toEqual(['figure-one', 'table-one'])
    expect(issues.find(i => i.ruleId === 'list.introduction')?.nodeId).toBe('list-one')
    expect(issues.find(i => i.ruleId === 'appendix.body-mention')?.nodeId).toBe('appendix-a')
  })

  it('does not count a term definition or caption, but counts two real occurrences across styled inline runs', () => {
    const pm = phase6Fixture()
    const req = requirement(pm)
    req.content = [req.content![0]!, paragraph('uses', text('阀'), text('门', [{ type: 'bold' }]), text('应检查。阀门应记录。'))]
    expect(issuesFor(pm, 'term.minimum-usage')).toEqual([])
    req.content[1] = paragraph('uses', text('阀门应检查。'))
    expect(issuesFor(pm, 'term.minimum-usage')).toEqual([expect.objectContaining({ nodeId: 'term-valve', count: 1, threshold: 2 })])
  })

  it('exempts the whole terms chapter but reports non-term and appendix hanging paragraphs', () => {
    const pm = phase6Fixture()
    const terms = pm.content!.find(n => n.attrs?.nodeId === 'terms')!
    terms.content!.push(clause('term-sub-a', paragraph('ts-a', text('说明。'))), clause('term-sub-b', paragraph('ts-b', text('说明。'))))
    requirement(pm).content = [requirement(pm).content![0]!, paragraph('hanging-main', text('普通悬置段。')), clause('sub-a', paragraph('s-a', text('内容。'))), clause('sub-b', paragraph('s-b', text('内容。')))]
    pm.content!.push(chapter('symbols', '符号和缩略语', 'general', paragraph('hanging-symbols', text('下列符号适用于本文件。')), clause('sym-a', paragraph('sym-p', text('说明。')))))
    const app = pm.content!.find(n => n.attrs?.nodeId === 'appendix-a')!
    app.content!.push(clause('app-sub-a', paragraph('app-p-a', text('内容。'))), clause('app-sub-b', paragraph('app-p-b', text('内容。'))))
    const issues = issuesFor(pm, 'structure.hanging-paragraph')
    expect(issues.map(i => i.nodeId)).toContain('hanging-main')
    expect(issues.map(i => i.nodeId)).toContain('hanging-symbols')
    expect(issues.map(i => i.nodeId)).toContain('appendix-text')
    expect(issues.some(i => i.nodeId === 'terms-lead')).toBe(false)
    expect(issues.every(i => i.basis.kind === 'project-convention')).toBe(true)
  })

  it('does not let a later hand-written mention stand in for a figure introduction', () => {
    const pm = phase6Fixture()
    const req = requirement(pm)
    req.content = [req.content![0]!, req.content![2]!, paragraph('later', text('结构见图1。'))]
    const figure = issuesFor(pm, 'object.introduction-and-mention').find(i => i.nodeId === 'figure-one')
    expect(figure?.message).toContain('引出语')
    expect(figure?.message).not.toContain('正文未提及')
  })
})
