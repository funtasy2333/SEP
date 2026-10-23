import type { IRAppendix, IRChapter, IRClause, IRClauseChild, IRDoc } from '../../ir/types'
import { textForInlines } from '../contentIndex'
import { makeIssue } from '../issues'
import type { ValidationIssue } from '../types'

const structureBasis = { kind: 'standard' as const, reference: 'GB/T 1.1—2020 7.3', text: '章、条应按层级组织，标题和层级应清楚一致。' }
const hangingBasis = { kind: 'project-convention' as const, reference: '项目约定（2026-10-22）', text: '除术语章及其内部容器外，章节、条和附录中有直接普通段落且有直接子条时，报告悬置段。' }

function plain(inlines: IRChapter['title']): string {
  return textForInlines(inlines).normalize('NFKC').replace(/[\s\u3000]/g, '').trim()
}

function isTermsChapter(chapter: IRChapter): boolean {
  const secType = (chapter as IRChapter & { secType?: string }).secType
  return secType === 'terms' || (secType == null && plain(chapter.title) === '术语和定义')
}

function reportHanging(
  issues: ValidationIssue[],
  children: IRClauseChild[],
  path: string,
  inTerms: boolean,
): void {
  if (inTerms) return
  const hasSubclause = children.some(child => child.kind === 'clause')
  if (!hasSubclause) return
  children.forEach((child, index) => {
    if (child.kind !== 'paragraph') return
    const childPath = `${path}[${index}]`
    issues.push(makeIssue({
      ruleId: 'structure.hanging-paragraph', severity: 'warning', category: 'structure', nodeId: child.id, path: childPath,
      message: '此处存在悬置段，请移入相应子条或调整结构。',
      suggestion: '将该段移入适用的子条，或调整章条结构。', basis: hangingBasis,
      evidence: [{ nodeId: child.id, path: childPath, role: 'paragraph', text: textForInlines(child.content) }],
    }))
  })
}

function clauseRules(issues: ValidationIssue[], children: IRClauseChild[], path: string, inTerms: boolean): void {
  const clauses = children.filter((child): child is IRClause => child.kind === 'clause')
  if (clauses.length === 1) {
    const only = clauses[0]!
    issues.push(makeIssue({
      ruleId: 'structure.isolated-subclause', severity: 'suggestion', category: 'structure', nodeId: only.id, path: `${path}[${children.indexOf(only)}]`,
      message: '此处只有一个直接子条，请核对是否确有分条必要。',
      suggestion: '如无并列内容需要区分，可将内容并入上级条。', basis: structureBasis,
      evidence: [{ nodeId: only.id, path: `${path}[${children.indexOf(only)}]`, role: 'clause-title', text: textForInlines(only.title) }],
    }))
  }
  const byLevel = new Map<number, IRClause[]>()
  for (const child of clauses) {
    const siblings = byLevel.get(child.level) ?? []
    siblings.push(child)
    byLevel.set(child.level, siblings)
  }
  for (const siblings of byLevel.values()) {
    if (siblings.length < 2) continue
    const hasTitle = siblings.some(clause => clause.titled && plain(clause.title) !== '')
    const hasNoTitle = siblings.some(clause => !clause.titled || plain(clause.title) === '')
    if (!hasTitle || !hasNoTitle) continue
    for (const sibling of siblings) {
      const siblingPath = `${path}[${children.indexOf(sibling)}]`
      issues.push(makeIssue({
        ruleId: 'structure.title-consistency', severity: 'warning', category: 'structure', nodeId: sibling.id, path: siblingPath,
        message: '同级条有题与无题形式不一致。',
        suggestion: '核对同级条的标题形式，并按同一结构口径调整。', basis: structureBasis,
        evidence: [{ nodeId: sibling.id, path: siblingPath, role: 'clause-title', text: textForInlines(sibling.title) }],
      }))
    }
  }
  children.forEach((child, index) => {
    if (child.kind !== 'clause') return
    const childPath = `${path}[${index}]`
    if (child.titled && plain(child.title) === '') {
      issues.push(makeIssue({
        ruleId: 'structure.empty-title', severity: 'warning', category: 'structure', nodeId: child.id, path: `${childPath}.title`,
        message: '有题条的标题为空。', suggestion: '补充条标题，或将条改为无题条。', basis: structureBasis,
        evidence: [{ nodeId: child.id, path: `${childPath}.title`, role: 'title', text: textForInlines(child.title) }],
      }))
    }
    if (!child.titled && child.children.some(grandchild => grandchild.kind === 'clause')) {
      issues.push(makeIssue({
        ruleId: 'structure.untitled-parent', severity: 'warning', category: 'structure', nodeId: child.id, path: childPath,
        message: '无题条又分出子条，请核对是否需要为上级条补充标题。',
        suggestion: '为上级条补充能概括下级内容的标题，或调整分条层级。', basis: structureBasis,
        evidence: [{ nodeId: child.id, path: `${childPath}.title`, role: 'title', text: '' }],
      }))
    }
    reportHanging(issues, child.children, `${childPath}.children`, inTerms)
    clauseRules(issues, child.children, `${childPath}.children`, inTerms)
  })
}

function chapterRules(issues: ValidationIssue[], chapter: IRChapter, path: string, inTerms: boolean): void {
  if (!plain(chapter.title)) {
    issues.push(makeIssue({
      ruleId: 'structure.empty-title', severity: 'warning', category: 'structure', nodeId: chapter.id, path: `${path}.title`,
      message: '章标题为空。', suggestion: '补充章标题。', basis: structureBasis,
      evidence: [{ nodeId: chapter.id, path: `${path}.title`, role: 'title', text: textForInlines(chapter.title) }],
    }))
  }
  reportHanging(issues, chapter.children, `${path}.children`, inTerms)
  clauseRules(issues, chapter.children, `${path}.children`, inTerms)
}

function appendixRules(issues: ValidationIssue[], appendix: IRAppendix, path: string): void {
  if (!plain(appendix.title)) {
    issues.push(makeIssue({
      ruleId: 'structure.empty-title', severity: 'warning', category: 'structure', nodeId: appendix.id, path: `${path}.title`,
      message: '附录标题为空。', suggestion: '补充附录标题。', basis: structureBasis,
      evidence: [{ nodeId: appendix.id, path: `${path}.title`, role: 'title', text: textForInlines(appendix.title) }],
    }))
  }
  reportHanging(issues, appendix.children, `${path}.children`, false)
  clauseRules(issues, appendix.children, `${path}.children`, false)
}

export function validateStructure(doc: IRDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  doc.body.forEach((chapter, index) => chapterRules(issues, chapter, `body[${index}]`, isTermsChapter(chapter)))
  doc.appendices.forEach((appendix, index) => appendixRules(issues, appendix, `appendices[${index}]`))
  return issues
}
