<template>
  <aside class="validation-panel" aria-label="文档质量检查">
    <header class="panel-head">
      <div>
        <p class="eyebrow">文档质量</p>
        <h2>检查结果</h2>
      </div>
      <button class="icon-button" type="button" aria-label="关闭质量检查" @click="emit('close')">×</button>
    </header>

    <section class="run-card" aria-live="polite">
      <div class="state-line" :class="`state-${state}`">
        <span class="state-symbol" aria-hidden="true">{{ stateSymbol }}</span>
        <strong>{{ stateTitle }}</strong>
      </div>
      <p v-if="state === 'not-run'" class="state-copy">尚未检查。点击下方按钮后，才会读取当前正文和已生效设置。</p>
      <p v-else-if="state === 'running'" class="state-copy">正在检查当前文档。请稍候。</p>
      <p v-else-if="state === 'stale'" class="state-copy">正文或已生效设置已修改，结果已过期，请重新检查。</p>
      <p v-else-if="state === 'failed'" class="state-copy">{{ error || '检查未能完成。' }}</p>
      <template v-else-if="report">
        <p v-if="report.summary.total === 0" class="state-copy">本期启用规则未发现问题。</p>
        <p v-else class="state-copy">发现 {{ report.summary.total }} 个问题：{{ report.summary.error }} 项错误、{{ report.summary.warning }} 项提醒、{{ report.summary.suggestion }} 项建议。</p>
      </template>
      <button
        class="run-button"
        type="button"
        :disabled="!canRun || state === 'running'"
        :aria-label="runLabel"
        @click="emit('run')"
      >
        <span v-if="state === 'running'" class="spinner" aria-hidden="true" />
        {{ runLabel }}
      </button>
    </section>

    <p v-if="report && state === 'running'" class="stale-notice" role="status">正在生成新报告；下方保留的是上一次结果，定位已暂停。</p>
    <p v-if="report && state === 'stale'" class="stale-notice" role="status">历史问题仍可查看，但不能跳转，也不代表当前正文的检查结果。</p>
    <p v-if="report && state === 'failed'" class="stale-notice" role="status">本次检查失败；下方保留的是上一次报告，失败不代表检查通过。</p>

    <section v-if="report" class="issues-section" aria-label="检查问题">
      <div class="section-heading">
        <h3>问题列表</h3>
        <label class="filter-control">
          <span class="visually-hidden">问题类别筛选</span>
          <select v-model="selectedCategory" aria-label="问题类别筛选">
            <option value="all">全部类别</option>
            <option v-for="category in categories" :key="category" :value="category">{{ categoryLabel(category) }}</option>
          </select>
        </label>
      </div>

      <p v-if="visibleIssues.length === 0" class="empty-filter">此类别没有问题。</p>
      <ol v-else class="issue-list">
        <li v-for="issue in visibleIssues" :key="issue.id" class="issue-card" :class="`severity-${issue.severity}`">
          <div class="issue-topline">
            <span class="severity-label"><span aria-hidden="true">{{ severitySymbol(issue.severity) }}</span>{{ severityLabel(issue.severity) }}</span>
            <span class="category-label">{{ categoryLabel(issue.category) }}</span>
          </div>
          <p class="issue-message">{{ issue.message }}</p>
          <p v-if="issue.path" class="issue-path">文档路径：{{ issue.path }}</p>

          <div v-if="issue.ruleId === 'term.minimum-usage' || issue.ruleId === 'coverage.term-name-ambiguous'" class="evidence-block term-count">
            {{ termCountText(issue) }}
          </div>

          <div v-if="isObjectCheck(issue)" class="subchecks" aria-label="图表检查项">
            <div class="subcheck" :class="{ 'is-missing': missesIntroduction(issue) }">
              <span aria-hidden="true">{{ missesIntroduction(issue) ? '!' : '✓' }}</span>
              <span>图表引出语</span>
              <small>{{ missesIntroduction(issue) ? '未识别到' : '已检查' }}</small>
            </div>
            <div class="subcheck" :class="{ 'is-missing': missesMention(issue) }">
              <span aria-hidden="true">{{ missesMention(issue) ? '!' : '✓' }}</span>
              <span>正文提及</span>
              <small>{{ missesMention(issue) ? '未识别到' : '已检查' }}</small>
            </div>
          </div>

          <details v-if="issue.basis || issue.evidence?.length" class="issue-details">
            <summary>查看依据与证据</summary>
            <p v-if="issue.basis" class="basis-text">
              <span>{{ basisLabel(issue.basis.kind) }}<template v-if="issue.basis.reference"> · {{ issue.basis.reference }}</template></span>
              {{ issue.basis.text }}
            </p>
            <ul v-if="issue.evidence?.length" class="evidence-list">
              <li v-for="(item, index) in issue.evidence" :key="`${item.nodeId ?? 'none'}:${item.from ?? 'x'}:${index}`">
                <q v-if="item.text">{{ item.text }}</q>
                <span v-else>未提供文本片段</span>
                <small v-if="item.role"> · {{ evidenceRoleLabel(item.role) }}</small>
              </li>
            </ul>
          </details>

          <p v-if="issue.suggestion" class="suggestion"><strong>建议</strong>{{ issue.suggestion }}</p>
          <div class="issue-actions">
            <span v-if="anchorReason(issue.id)" class="anchor-reason">{{ anchorReason(issue.id) }}</span>
            <button
              type="button"
              class="locate-button"
              aria-label="定位到问题位置"
              :disabled="state !== 'current' || anchorFor(issue.id)?.status !== 'located'"
              @click="emit('locate', issue.id)"
            >定位</button>
          </div>
        </li>
      </ol>
    </section>

    <section v-if="conversion.warnings.length || conversion.unsupported.length" class="conversion-notice" aria-label="转换提示">
      <h3>转换提示</h3>
      <p>部分编辑器内容无法完整转换为本期检查模型，结果可能不完整。</p>
      <ul>
        <li v-for="(warning, index) in conversion.warnings" :key="`warning-${index}`">{{ warning }}</li>
        <li v-for="(item, index) in conversion.unsupported" :key="`unsupported-${index}`">
          未支持的内容：{{ item.nodeType }}<template v-if="item.reason">（{{ item.reason }}）</template>
        </li>
      </ul>
    </section>

    <details v-if="report" class="coverage-section">
      <summary>本期检查范围与限制</summary>
      <ul class="coverage-list">
        <li v-for="(item, key) in report.coverage" :key="key" :class="`coverage-${item.status}`">
          <span>{{ coverageLabel(key) }}</span>
          <small>{{ coverageStatusLabel(item.status) }}：{{ item.reason }}</small>
        </li>
      </ul>
    </details>
    <footer class="panel-footnote">术语权威性、引用文件有效性和准确性未检查；脚注、表脚注、参考文献提醒不在本期范围。</footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ValidationCoverageGroup, ValidationIssue, ValidationReport } from '@ses/shared'
import type { DocumentValidationState } from '@/composables/useDocumentValidation'
import type { ValidationIssueAnchor } from '@/validation/anchors'
import type { ValidationWorkerSuccess } from '@/validation/analysis.worker'

const props = defineProps<{
  state: DocumentValidationState
  report: ValidationReport | null
  conversion: ValidationWorkerSuccess['conversion']
  anchors: ValidationIssueAnchor[]
  error: string
  canRun: boolean
}>()
const emit = defineEmits<{
  run: []
  locate: [issueId: string]
  close: []
}>()

const selectedCategory = ref('all')
watch(() => props.report, () => { selectedCategory.value = 'all' })

const categories = computed(() => [...new Set(props.report?.issues.map(issue => issue.category) ?? [])])
const visibleIssues = computed(() => (props.report?.issues ?? []).filter(issue =>
  selectedCategory.value === 'all' || issue.category === selectedCategory.value,
))
const runLabel = computed(() => props.state === 'running' ? '检查中…'
  : props.state === 'not-run' ? '检查文档'
    : props.state === 'failed' ? '重试检查'
      : '重新检查')
const stateTitle = computed(() => ({
  'not-run': '未检查', running: '检查中', current: '检查完成', stale: '结果已过期', failed: '检查失败',
}[props.state]))
const stateSymbol = computed(() => ({ 'not-run': '○', running: '…', current: '✓', stale: '!', failed: '×' }[props.state]))

function categoryLabel(category: string): string {
  return ({ structure: '结构', introductions: '引出语', mentions: '引用提及', terms: '术语', references: '规范性引用', coverage: '覆盖提示' } as Record<string, string>)[category] ?? category
}
function severityLabel(severity: ValidationIssue['severity']): string {
  return ({ error: '错误', warning: '提醒', suggestion: '建议' })[severity]
}
function severitySymbol(severity: ValidationIssue['severity']): string {
  return ({ error: '×', warning: '!', suggestion: 'i' })[severity]
}
function basisLabel(kind: ValidationIssue['basis']['kind']): string {
  return ({ standard: '标准依据', 'project-convention': '项目约定', system: '系统说明' })[kind]
}
function evidenceRoleLabel(role: string): string {
  return ({ paragraph: '正文段落', listItem: '列项', tableCell: '表格单元格', termRef: '结构化术语引用', 'term-name': '术语名称' } as Record<string, string>)[role] ?? role
}
function termCountText(issue: ValidationIssue): string {
  const count = issue.count ?? 0
  const threshold = issue.threshold ?? 2
  return `正文识别到 ${count} 次；要求至少 ${threshold} 次${issue.ruleId === 'coverage.term-name-ambiguous' ? '（只计入可确认的结构化引用）' : ''}`
}
function isObjectCheck(issue: ValidationIssue): boolean {
  return issue.ruleId === 'object.introduction-and-mention'
}
function missesIntroduction(issue: ValidationIssue): boolean {
  return /缺少(?:图|表)前引出语/.test(issue.message)
}
function missesMention(issue: ValidationIssue): boolean {
  return /(?:正文未提及|未在正文中提及)/.test(issue.message)
}
function anchorFor(issueId: string): ValidationIssueAnchor | undefined {
  return props.anchors.find(anchor => anchor.issueId === issueId)
}
function anchorReason(issueId: string): string {
  const anchor = anchorFor(issueId)
  if (!anchor || anchor.status === 'located') return ''
  return anchor.reason ?? (anchor.status === 'ambiguous' ? '位置不唯一，无法安全定位。' : '无法安全定位。')
}
function coverageLabel(key: string): string {
  const labels: Record<ValidationCoverageGroup, string> = {
    structure: '结构', hangingParagraphs: '悬置段', listIntroductions: '列项引出语',
    objectIntroductions: '图表引出语', objectMentions: '正文图表提及', appendixMentions: '附录正文提及',
    termUsage: '术语使用次数', normativeReferences: '规范性引用文件格式', internalReferences: '内部交叉引用',
    standardDatabase: '引用文件有效性与准确性', termAuthority: '术语权威性', bibliographyReminder: '参考文献提醒',
    footnotes: '脚注', tableFootnotes: '表脚注', listStyleConsistency: '列项样式一致性', objectFormatting: '图表格式',
  }
  return labels[key as ValidationCoverageGroup] ?? key
}
function coverageStatusLabel(status: string): string {
  return ({ checked: '已检查', partial: '有限覆盖', deferred: '暂缓', excluded: '本期排除', 'not-applicable': '不适用' } as Record<string, string>)[status] ?? status
}
</script>

<style scoped>
.validation-panel {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: auto;
  background: var(--ses-surface, #fff);
  color: var(--ses-ink, #20222a);
  border-left: 1px solid var(--ses-line, #e4e6ed);
  font: 13px/1.55 var(--ses-font-zh, inherit);
}
.panel-head, .section-heading, .issue-topline, .issue-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.panel-head { padding: 18px 18px 12px; }
.eyebrow { margin: 0; color: var(--ses-ink-3, #747987); font-size: 10px; letter-spacing: .08em; }
h2, h3, p { margin-top: 0; }
h2 { margin-bottom: 0; font-size: 17px; }
h3 { margin-bottom: 0; font-size: 13px; }
.icon-button { border: 0; background: transparent; color: inherit; font-size: 23px; cursor: pointer; line-height: 1; }
.run-card { margin: 0 14px 14px; padding: 14px; border: 1px solid var(--ses-line, #e4e6ed); border-radius: 10px; background: var(--ses-bg, #f8f8fb); }
.state-line { display: flex; align-items: center; gap: 8px; }
.state-symbol { width: 22px; height: 22px; display: inline-grid; place-items: center; border-radius: 50%; font-weight: 800; background: #eceef3; }
.state-current .state-symbol { color: #087b51; background: #e4f5ed; }
.state-stale .state-symbol, .state-failed .state-symbol { color: #a53b19; background: #fff0e8; }
.state-copy { margin: 8px 0 12px; color: var(--ses-ink-2, #555a68); }
.run-button { width: 100%; min-height: 36px; border: 0; border-radius: 6px; background: var(--ses-accent, #5543c2); color: white; font: inherit; font-weight: 650; cursor: pointer; }
.run-button:disabled { opacity: .52; cursor: not-allowed; }
.spinner { display: inline-block; width: 11px; height: 11px; margin-right: 7px; border: 2px solid #ffffff70; border-top-color: white; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.stale-notice, .conversion-notice { margin: 0 14px 14px; padding: 10px 12px; border-radius: 7px; color: #713917; background: #fff6e8; }
.issues-section { padding: 0 14px 14px; }
.section-heading { margin-bottom: 9px; }
.filter-control select { max-width: 150px; padding: 5px 7px; border: 1px solid var(--ses-line, #d9dce5); border-radius: 5px; background: white; color: inherit; font: inherit; }
.empty-filter { color: var(--ses-ink-3, #747987); }
.issue-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
.issue-card { padding: 11px; border: 1px solid var(--ses-line, #e4e6ed); border-left: 3px solid #797f90; border-radius: 7px; background: white; }
.severity-error { border-left-color: #c73535; }
.severity-warning { border-left-color: #c77912; }
.severity-suggestion { border-left-color: #376bb4; }
.issue-topline { justify-content: flex-start; font-size: 11px; }
.severity-label { display: inline-flex; gap: 5px; align-items: center; font-weight: 700; }
.severity-error .severity-label { color: #a92727; }
.severity-warning .severity-label { color: #8d5600; }
.severity-suggestion .severity-label { color: #275a9c; }
.category-label { color: var(--ses-ink-3, #747987); }
.issue-message { margin: 8px 0; font-weight: 600; overflow-wrap: anywhere; }
.issue-path { color: var(--ses-ink-3, #747987); font-size: 11px; overflow-wrap: anywhere; }
.evidence-block { margin: 8px 0; padding: 7px 8px; border-radius: 5px; background: #f1efff; color: #423294; }
.subchecks { display: grid; gap: 4px; margin: 9px 0; }
.subcheck { display: grid; grid-template-columns: 16px 1fr auto; align-items: center; gap: 5px; color: #176549; }
.subcheck.is-missing { color: #9a3e25; }
.subcheck > span:first-child { font-weight: 800; text-align: center; }
.subcheck small { color: var(--ses-ink-3, #747987); }
.issue-details { margin: 8px 0; color: var(--ses-ink-2, #555a68); }
.issue-details summary, .coverage-section summary { cursor: pointer; font-weight: 600; }
.basis-text { margin: 7px 0; font-size: 12px; }
.basis-text span { display: block; color: var(--ses-ink-3, #747987); }
.evidence-list { margin: 6px 0; padding-left: 18px; }
.evidence-list li { margin: 4px 0; overflow-wrap: anywhere; }
.evidence-list q { color: var(--ses-ink, #20222a); }
.evidence-list small { color: var(--ses-ink-3, #747987); }
.suggestion { margin: 8px 0; color: var(--ses-ink-2, #555a68); font-size: 12px; }
.suggestion strong { margin-right: 6px; color: var(--ses-ink, #20222a); }
.issue-actions { align-items: flex-start; }
.anchor-reason { color: #8e4e26; font-size: 11px; }
.locate-button { flex: none; padding: 4px 10px; border: 1px solid var(--ses-line, #d9dce5); border-radius: 5px; background: white; color: var(--ses-ink, #20222a); font: inherit; cursor: pointer; }
.locate-button:disabled { color: #9297a3; cursor: not-allowed; }
.conversion-notice { color: #5b4a17; background: #fff9dc; }
.conversion-notice h3 { margin-bottom: 5px; }
.conversion-notice p { margin-bottom: 6px; }
.conversion-notice ul { padding-left: 18px; margin: 0; overflow-wrap: anywhere; }
.coverage-section { margin: 0 14px 12px; padding: 10px 12px; border-top: 1px solid var(--ses-line, #e4e6ed); }
.coverage-list { padding-left: 18px; margin-bottom: 0; }
.coverage-list li { margin: 6px 0; }
.coverage-list small { display: block; color: var(--ses-ink-3, #747987); }
.coverage-excluded > span { text-decoration: line-through; }
.panel-footnote { padding: 12px 16px 16px; margin-top: auto; color: var(--ses-ink-3, #747987); border-top: 1px solid var(--ses-line, #e4e6ed); font-size: 11px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@media (max-width: 700px) {
  .validation-panel { width: 100%; min-width: 0; }
}
</style>
