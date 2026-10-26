import { describe, expect, it } from 'vitest'
import { analyzeDocument } from './analyze'
import type { IRAppendix, IRBlock, IRChapter, IRClause, IRDoc, IRInline, IRParagraph, IRTermEntry } from '../ir/types'
import { createParagraphDocument } from './__fixtures__/documents'

const inline = (text: string, marks?: IRInline['marks']): IRInline => marks ? { text, marks } : { text }
const para = (id: string, text: string | IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content: typeof text === 'string' ? [inline(text)] : text })
const clause = (id: string, children: (IRClause | IRBlock | IRTermEntry)[], opts: { level?: number; titled?: boolean; title?: string } = {}): IRClause => ({
  kind: 'clause', id, level: (opts.level ?? 1) as 1 | 2 | 3 | 4 | 5, titled: opts.titled ?? true,
  title: opts.titled === false ? [] : [inline(opts.title ?? '要求')], children,
})
const chapter = (id: string, title: string, children: (IRClause | IRBlock | IRTermEntry)[], secType: IRChapter['secType'] = 'general'): IRChapter => ({ kind: 'chapter', id, secType, title: [inline(title)], children })
const term = (id: string, name: string, definition = '定义内容。'): IRTermEntry => ({ kind: 'termEntry', id, term: [inline(name)], definition: [para(`${id}-definition`, definition)], notes: [], examples: [] })
const appendix = (id: string, children: (IRClause | IRBlock | IRTermEntry)[], title = '附录内容'): IRAppendix => ({ kind: 'appendix', id, normative: false, title: [inline(title)], children })
const doc = (body: IRChapter[], appendices: IRAppendix[] = []): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] }, body, appendices, bibliography: [],
})
const figure = (id: string, caption = '示意图'): IRBlock => ({ kind: 'figure', id, caption: [inline(caption)], orientation: 'portrait', src: 'resource', notes: [] })
const table = (id: string, caption = '数据'): IRBlock => ({ kind: 'table', id, caption: [inline(caption)], orientation: 'portrait', headerRowCount: 0, rows: [], notes: [] })
const list = (id: string, content = '项目'): IRBlock => ({ kind: 'list', id, listType: 'dash', items: [{ id: `${id}-item`, content: [para(`${id}-item-p`, content)] }] })

const issuesFor = (ir: IRDoc, ruleId: string) => analyzeDocument(ir).validation.issues.filter(issue => issue.ruleId === ruleId)

describe('analyzeDocument', () => {
  it('returns deterministic resolution and a report without mutating a frozen IR document', () => {
    const ir = doc([chapter('c1', '范围', [para('p1', '本文件规定了要求。')], 'scope')])
    Object.freeze(ir.body[0].children[0])
    Object.freeze(ir.body[0].children)
    Object.freeze(ir.body[0])
    Object.freeze(ir.body)
    Object.freeze(ir)

    const first = analyzeDocument(ir)
    const second = analyzeDocument(ir)

    expect(first).toEqual(second)
    expect(first.resolution.doc).toBe(ir)
    expect(first.validation.profile).toBe('ses-phase6-manual-v2')
    expect(first.validation.summary.total).toBe(first.validation.issues.length)
  })

  it('provides a deterministic size-controlled IR fixture for repeatable performance checks', () => {
    const fixture = createParagraphDocument(500)
    expect(fixture.body[0]?.children).toHaveLength(500)
    expect(analyzeDocument(fixture).validation.profile).toBe('ses-phase6-manual-v2')
  })

  it('checks project hanging paragraphs, exempts the whole terms chapter, and ignores direct figures', () => {
    const ir = doc([
      chapter('terms', '术语和定义', [para('terms-lead', '引导语。'), term('t1', '术语')], 'terms'),
      chapter('symbols', '符号和缩略语', [para('symbols-lead', '重要提示：'), clause('s1', [para('s1-p', '内容。')])]),
      chapter('ordinary', '术语补充', [para('ordinary-lead', '说明。'), clause('o1', [para('o1-p', '内容。')])]),
      chapter('object-only', '对象', [figure('f1'), clause('ob1', [para('ob1-p', '内容。')])]),
    ], [appendix('app-a', [para('app-lead', '附录说明。'), clause('app-c1', [para('app-p', '附录内容。')])])])

    const hanging = issuesFor(ir, 'structure.hanging-paragraph')
    expect(hanging.map(issue => issue.nodeId)).toEqual(['symbols-lead', 'ordinary-lead', 'app-lead'])
    expect(analyzeDocument(ir).resolution.problems.filter(problem => problem.code === 'hanging-paragraph')).toHaveLength(4)
    expect(hanging.every(issue => issue.severity === 'warning' && issue.basis.kind === 'project-convention')).toBe(true)
  })

  it('requires an introduction before each list but accepts a colon or a complete introductory sentence', () => {
    const ir = doc([chapter('c1', '要求', [
      para('lead-colon', '应满足下列条件：'), list('list-ok-1'),
      para('lead-sentence', '设备应具备以下性能。'), list('list-ok-2'),
      list('list-bad-1'), list('list-bad-2'),
    ])])

    const issues = issuesFor(ir, 'list.introduction')
    expect(issues.map(issue => issue.nodeId)).toEqual(['list-bad-1', 'list-bad-2'])
    expect(issues[0]?.evidence?.[0]?.text).toBe('')
    expect(issues[0]?.suggestion).toContain('引出语')
  })

  it('checks figure and table introductions separately from body mentions in one combined issue', () => {
    const ir = doc([chapter('c1', '要求', [
      figure('f1'), para('after-fig', '结果参见图1。'),
      table('t1'),
      para('table-intro', '检验指标见表1。'), table('t2'),
    ])])

    const issues = issuesFor(ir, 'object.introduction-and-mention')
    expect(issues).toHaveLength(3)
    expect(issues.map(issue => issue.nodeId)).toEqual(['f1', 't1', 't2'])
    expect(issues[0]?.message).toContain('缺少图前引出语')
    expect(issues[0]?.message).not.toContain('正文未提及')
    expect(issues[1]?.message).toContain('缺少表前引出语')
    expect(issues[1]?.message).not.toContain('正文未提及')
    expect(issues[2]?.message).toContain('缺少表前引出语')
    expect(issues[2]?.message).toContain('正文未提及')
  })

  it('uses the nearest paragraph and requires it to point to every shared figure target', () => {
    const ir = doc([chapter('c1', '要求', [
      para('shared', '结构见图1。'), figure('f1'), figure('f2'),
    ])])
    const issues = issuesFor(ir, 'object.introduction-and-mention')
    expect(issues.map(issue => issue.nodeId)).toEqual(['f2'])
    expect(issues[0]?.message).toContain('缺少图前引出语')
    expect(issues[0]?.message).toContain('正文未提及')
  })

  it('requires each appendix to be mentioned from body content, not from front matter or another appendix', () => {
    const ir = doc([
      chapter('scope', '范围', [para('body-mention', '见附录A。')], 'scope'),
    ], [
      appendix('app-a', [para('app-a-text', '本附录提及附录B。')]),
      appendix('app-b', [para('app-b-text', '自身附录B内容。')]),
    ])
    ir.front.introduction.push(para('front-mention', '参见附录B。'))

    const issues = issuesFor(ir, 'appendix.body-mention')
    expect(issues.map(issue => issue.nodeId)).toEqual(['app-b'])
    expect(issues[0]?.message).toContain('附录B未在正文中提及')
  })

  it('counts terms in body text only, joins styled runs, and does not double count termRef display text', () => {
    const ir = doc([
      chapter('terms', '术语和定义', [term('term-api', '应用程序接口')], 'terms'),
      chapter('body', '要求', [
        para('use-one', [inline('应用程序'), inline('接口', [{ type: 'bold' }])]),
        para('use-two', [inline('应用程序接口', [{ type: 'termRef', targetId: 'term-api' }])]),
      ]),
    ])
    const issues = issuesFor(ir, 'term.minimum-usage')
    expect(issues).toHaveLength(0)
    expect(analyzeDocument(ir).validation.coverage.termUsage.status).toBe('partial')
  })

  it('reports zero and one literal term use with evidence and a threshold of two', () => {
    const ir = doc([
      chapter('terms', '术语和定义', [term('term-a', '阀门'), term('term-en', '标准 API')], 'terms'),
      chapter('body', '要求', [para('use-a', '应检查阀门。标准化工作应按规定运行。')]),
    ])
    const issues = issuesFor(ir, 'term.minimum-usage')
    expect(issues.map(issue => [issue.nodeId, issue.count, issue.threshold])).toEqual([['term-a', 1, 2], ['term-en', 0, 2]])
    expect(issues[0]?.evidence?.[0]).toMatchObject({ nodeId: 'use-a', text: '阀门' })
    expect(issues[1]?.nodeId).toBe('term-en')
  })

  it('preserves English word boundaries across spaces and treats adjacent termRef fragments as one use', () => {
    const ir = doc([
      chapter('terms', '术语和定义', [term('term-api', 'API'), term('term-system', '系统'), term('term-interface', '接口')], 'terms'),
      chapter('body', '要求', [
        para('english-uses', 'API API XAPI APIx'),
        para('fragmented-refs', [
          inline('系', [{ type: 'termRef', targetId: 'term-system' }]),
          inline('统', [{ type: 'bold' }, { type: 'termRef', targetId: 'term-system' }]),
          inline('', [{ type: 'termRef', targetId: 'term-interface' }]),
        ]),
      ]),
    ])
    const issues = issuesFor(ir, 'term.minimum-usage')
    expect(issues.map(issue => [issue.nodeId, issue.count])).toEqual([['term-system', 1], ['term-interface', 1]])
  })

  it('counts table-cell term uses but never lets a table cite itself from its own cells', () => {
    const ir = doc([
      chapter('terms', '术语和定义', [term('term-valve', '阀门'), term('term-pump', '泵')], 'terms'),
      chapter('body', '要求', [
        {
          kind: 'table', id: 'table-self', caption: [inline('表格')], orientation: 'portrait', headerRowCount: 0, rows: [
            { id: 'row-1', cells: [{ id: 'cell-1', colspan: 1, rowspan: 1, header: false, content: [para('cell-use-1', '阀门')] }] },
            { id: 'row-2', cells: [{ id: 'cell-2', colspan: 1, rowspan: 1, header: false, content: [para('cell-use-2', '阀门见表1。')] }] },
          ], notes: [],
        },
      ]),
    ])
    const analysis = analyzeDocument(ir)
    expect(analysis.validation.issues.some(issue => issue.ruleId === 'term.minimum-usage' && issue.nodeId === 'term-valve')).toBe(false)
    const tableIssue = analysis.validation.issues.find(issue => issue.ruleId === 'object.introduction-and-mention' && issue.nodeId === 'table-self')
    expect(tableIssue?.message).toContain('缺少表前引出语')
    expect(tableIssue?.message).toContain('正文未提及')
  })

  it('uses longest term matches, excludes notes/examples/code and appendices from term counts', () => {
    const ir = doc([
      chapter('terms', '术语和定义', [term('short', '控制'), term('long', '控制系统')], 'terms'),
      chapter('body', '要求', [
        para('p1', '控制系统。'),
        { kind: 'note', id: 'n1', content: [para('note-p', '控制系统控制系统')] },
        { kind: 'example', id: 'e1', content: [para('example-p', '控制系统控制系统')] },
        { kind: 'code', id: 'code1', language: 'text', text: '控制系统控制系统' },
      ]),
    ], [appendix('app-a', [para('app-use', '控制系统控制系统')])])

    const issues = issuesFor(ir, 'term.minimum-usage')
    expect(issues.map(issue => [issue.nodeId, issue.count])).toEqual([['short', 0], ['long', 1]])
  })

  it('keeps the limited normative-reference format rules and leaves bibliography reminders excluded', () => {
    const ir = doc([
      chapter('scope', '范围', [para('scope-p', '范围。')], 'scope'),
      chapter('norms', '规范性引用文件', [
        para('norm-lead', '下列文件适用。'),
        para('norm-valid', 'GB/T 1.1—2020 标准化工作导则 第1部分：总则。'),
        para('norm-missing-name', 'GB/T 9999—2020。'),
      ], 'norm-refs'),
      chapter('body', '要求', [para('p1', '要求。')]),
    ])

    expect(issuesFor(ir, 'normative-reference.format').map(issue => issue.nodeId)).toEqual(['norm-missing-name'])
    expect(analyzeDocument(ir).validation.coverage.bibliographyReminder.status).toBe('excluded')
    expect(analyzeDocument(ir).validation.coverage.standardDatabase.status).toBe('deferred')
  })

  it('retains structural and internal-reference diagnostics but filters footnote-only quality issues', () => {
    const ir = doc([
      chapter('c1', '要求', [
        clause('parent', [clause('child', [para('child-p', '正文。')], { level: 3 })], { titled: false }),
        clause('lonely-parent', [clause('only-child', [para('only-p', '正文。')])]),
        para('bad-ref', [inline('缺失目标', [{ type: 'crossRef', targetId: 'missing', targetKind: 'figure' }])]),
        para('footnote-ref', [{ text: '注释', footnote: { id: 'fn1', content: [inline('内部引用', [{ type: 'crossRef', targetId: 'missing-footnote' }])] } }]),
      ]),
    ])
    ir.body.push(chapter('empty', '', []))

    const analysis = analyzeDocument(ir)
    expect(analysis.validation.issues.some(issue => issue.ruleId === 'structure.heading-skip')).toBe(true)
    expect(analysis.validation.issues.some(issue => issue.ruleId === 'structure.untitled-parent')).toBe(true)
    expect(analysis.validation.issues.some(issue => issue.ruleId === 'structure.isolated-subclause')).toBe(true)
    expect(analysis.validation.issues.some(issue => issue.ruleId === 'structure.empty-title')).toBe(true)
    expect(analysis.validation.issues.some(issue => issue.ruleId === 'reference.dangling' && issue.nodeId === 'bad-ref')).toBe(true)
    expect(analysis.validation.issues.some(issue => issue.nodeId === 'fn1')).toBe(false)
    expect(analysis.validation.issues.filter(issue => issue.nodeId === 'footnote-ref').map(issue => issue.ruleId)).toEqual(['structure.hanging-paragraph'])
    expect(analysis.validation.coverage.footnotes.status).toBe('excluded')
    expect(analysis.validation.coverage.internalReferences.status).toBe('checked')
  })
})
