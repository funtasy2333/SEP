// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValidationReport } from '@ses/shared'
import ValidationPanel from './ValidationPanel.vue'
import type { DocumentValidationState } from '@/composables/useDocumentValidation'
import type { ValidationIssueAnchor } from '@/validation/anchors'

const coverage = {
  structure: { status: 'checked', reason: '已检查结构。' },
  hangingParagraphs: { status: 'checked', reason: '已检查悬置段。' },
  listIntroductions: { status: 'partial', reason: '仅识别常见列项引出语。' },
  objectIntroductions: { status: 'partial', reason: '仅识别明确的图表引出语。' },
  objectMentions: { status: 'partial', reason: '仅识别本地覆盖的图表提及。' },
  appendixMentions: { status: 'partial', reason: '检查附录正文提及。' },
  termUsage: { status: 'partial', reason: '按术语名称作字面计数。' },
  normativeReferences: { status: 'partial', reason: '本地有限覆盖。' },
  internalReferences: { status: 'checked', reason: '检查结构化引用目标。' },
  standardDatabase: { status: 'deferred', reason: '等待标准数据库。' },
  termAuthority: { status: 'deferred', reason: '等待术语权威来源。' },
  bibliographyReminder: { status: 'excluded', reason: '本期取消未引用文献提醒。' },
  footnotes: { status: 'excluded', reason: '本期不检查脚注。' },
  tableFootnotes: { status: 'excluded', reason: '本期不检查表脚注。' },
  listStyleConsistency: { status: 'excluded', reason: '本期不检查列项样式一致性。' },
  objectFormatting: { status: 'excluded', reason: '本期不检查图表格式。' },
} satisfies ValidationReport['coverage']

function report(issues: ValidationReport['issues'] = []): ValidationReport {
  return {
    profile: 'ses-phase6-manual-v2', rulesVersion: '2026-10-22', issues,
    summary: {
      total: issues.length,
      error: issues.filter(issue => issue.severity === 'error').length,
      warning: issues.filter(issue => issue.severity === 'warning').length,
      suggestion: issues.filter(issue => issue.severity === 'suggestion').length,
    },
    coverage,
  }
}

const emptyConversion = { warnings: [], unsupported: [] }
const apps: Array<ReturnType<typeof createApp>> = []
const roots: HTMLElement[] = []

function mount(state: DocumentValidationState, currentReport: ValidationReport | null, anchors: ValidationIssueAnchor[] = [], extra: Record<string, unknown> = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  roots.push(root)
  const run = vi.fn()
  const locate = vi.fn()
  const close = vi.fn()
  const stateRef = ref(state)
  const reportRef = shallowRef(currentReport)
  const wrapper = defineComponent(() => () => h(ValidationPanel, {
    state: stateRef.value,
    report: reportRef.value,
    conversion: emptyConversion,
    anchors,
    error: '',
    canRun: true,
    ...extra,
    onRun: run,
    onLocate: locate,
    onClose: close,
  }))
  const app = createApp(wrapper)
  apps.push(app)
  app.mount(root)
  return { app, root, run, locate, close, stateRef, reportRef }
}

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  for (const root of roots.splice(0)) root.remove()
})

describe('ValidationPanel', () => {
  it('shows an honest not-checked state and emits one explicit manual run', async () => {
    const view = mount('not-run', null)
    await nextTick()
    expect(view.root.textContent).toContain('未检查')
    expect(view.root.textContent).not.toContain('0 个问题')
    view.root.querySelector<HTMLButtonElement>('[aria-label="检查文档"]')!.click()
    expect(view.run).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['running', '检查中'],
    ['failed', '检查失败'],
  ] as const)('renders the %s state', async (state, text) => {
    const view = mount(state as DocumentValidationState, null, [], state === 'failed' ? { error: 'Worker 已退出' } : {})
    await nextTick()
    expect(view.root.textContent).toContain(text)
  })

  it('shows stale reports for reading but disables their location actions and states excluded coverage', async () => {
    const staleReport = report([{
      id: 'stale-issue', ruleId: 'structure.empty-title', severity: 'warning', category: 'structure',
      nodeId: 'chapter-x', path: 'body[0]', message: '标题为空。', suggestion: '補充標題。',
      basis: { kind: 'standard', text: '标题应清楚。' },
    }])
    const view = mount('stale', staleReport, [{
      issueId: 'stale-issue', nodeId: 'chapter-x', severity: 'warning', status: 'located', from: 1, to: 4,
    }])
    await nextTick()
    expect(view.root.textContent).toContain('结果已过期')
    expect(view.root.textContent).toContain('脚注、表脚注、参考文献提醒不在本期范围')
    const locate = view.root.querySelector<HTMLButtonElement>('[aria-label="定位到问题位置"]')!
    expect(locate.disabled).toBe(true)
    locate.click()
    expect(view.locate).not.toHaveBeenCalled()
  })

  it('filters report issues and presents term counts, object check evidence, and conversion gaps', async () => {
    const objectIssue = {
      id: 'object-issue', ruleId: 'object.introduction-and-mention', severity: 'warning' as const, category: 'mentions' as const,
      nodeId: 'figure-x', path: 'body[0].children[1]', message: '图1缺少图前引出语；正文未提及图1。',
      suggestion: '补充引出语并在正文提及。', basis: { kind: 'standard' as const, text: '图应引出并在正文提及。' },
      evidence: [{ nodeId: 'figure-x', text: '图1', role: 'figure' }],
    }
    const termIssue = {
      id: 'term-issue', ruleId: 'term.minimum-usage', severity: 'warning' as const, category: 'terms' as const,
      nodeId: 'term-x', path: 'body.terms[0]', message: '术语「阀门」：正文识别到 1 次，要求至少 2 次。',
      suggestion: '核对该术语是否确需保留。', basis: { kind: 'project-convention' as const, text: '正文至少使用两次。' },
      count: 1, threshold: 2, evidence: [{ nodeId: 'uses-x', text: '阀门', from: 0, to: 2, role: 'paragraph' }],
    }
    const view = mount('current', report([objectIssue, termIssue]), [
      { issueId: 'object-issue', nodeId: 'figure-x', severity: 'warning', status: 'located', from: 1, to: 2 },
      { issueId: 'term-issue', nodeId: 'uses-x', severity: 'warning', status: 'located', from: 2, to: 5 },
    ], { conversion: { warnings: ['前言容器无法合并'], unsupported: [] } })
    await nextTick()

    expect(view.root.textContent).toContain('正文识别到 1 次；要求至少 2 次')
    expect(view.root.textContent).toContain('图表引出语')
    expect(view.root.textContent).toContain('正文提及')
    expect(view.root.textContent).toContain('阀门')
    expect(view.root.textContent).toContain('转换提示')

    const category = view.root.querySelector<HTMLSelectElement>('[aria-label="问题类别筛选"]')!
    category.value = 'terms'
    category.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(view.root.textContent).toContain('阀门')
    expect(view.root.textContent).not.toContain('图1缺少图前引出语')
    view.root.querySelector<HTMLButtonElement>('[aria-label="定位到问题位置"]')!.click()
    expect(view.locate).toHaveBeenCalledWith('term-issue')
  })
})
