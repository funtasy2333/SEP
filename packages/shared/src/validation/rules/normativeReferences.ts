import type { IRBlock, IRDoc } from '../../ir/types'
import { textForInlines } from '../contentIndex'
import { makeIssue } from '../issues'
import { parseStandardIdentifier } from '../standardIdentifier'
import type { ValidationCoverage, ValidationIssue } from '../types'

export interface NormativeReferenceAnalysis {
  issues: ValidationIssue[]
  coverage: ValidationCoverage
}

const basis = { kind: 'standard' as const, reference: 'GB/T 1.1—2020 8.6', text: '规范性引用文件按规定的位置列出，并包括文件标识和名称。' }

function chapterIsNormativeReferences(chapter: IRDoc['body'][number]): boolean {
  const role = (chapter as IRDoc['body'][number] & { secType?: string }).secType
  return role === 'norm-refs' || (role == null && textForInlines(chapter.title).normalize('NFKC').replace(/[\s\u3000]/g, '') === '规范性引用文件')
}

function listEntries(block: IRBlock, path: string): { nodeId: string | null; path: string; text: string }[] {
  if (block.kind === 'paragraph') return [{ nodeId: block.id, path, text: textForInlines(block.content) }]
  if (block.kind === 'list') {
    return block.items.flatMap((item, itemIndex) => item.content.flatMap((child, childIndex) => child.kind === 'paragraph'
      ? [{ nodeId: child.id, path: `${path}.items[${itemIndex}].content[${childIndex}]`, text: textForInlines(child.content) }]
      : [],
    ))
  }
  return []
}

function hasListPrefix(text: string): boolean {
  return /^\s*(?:\d+\s*[.、)]|[（(]\s*\d+\s*[）)]|[一二三四五六七八九十]+\s*[、.])/u.test(text.normalize('NFKC'))
}

export function validateNormativeReferences(doc: IRDoc): NormativeReferenceAnalysis {
  const issues: ValidationIssue[] = []
  const sections = doc.body.flatMap((chapter, index) => chapterIsNormativeReferences(chapter) ? [{ chapter, index }] : [])
  if (sections.length === 0) return { issues, coverage: { status: 'not-applicable', reason: '文档未包含规范性引用文件章。' } }
  let encounteredUnknown = false
  for (const { chapter, index } of sections) {
    if (index !== 1) {
      issues.push(makeIssue({
        ruleId: 'normative-reference.chapter-position', severity: 'warning', category: 'references', nodeId: chapter.id, path: `body[${index}]`,
        message: '规范性引用文件章的位置不符合本地结构检查口径。',
        suggestion: '核对该章是否位于范围章之后。', basis,
        evidence: [{ nodeId: chapter.id, path: `body[${index}].title`, role: 'chapter-title', text: textForInlines(chapter.title) }],
      }))
    }
    chapter.children.forEach((child, childIndex) => {
      const childPath = `body[${index}].children[${childIndex}]`
      if (child.kind !== 'paragraph' && child.kind !== 'list') return
      for (const entry of listEntries(child, childPath)) {
        const text = entry.text.trim()
        if (!text) continue
        if (hasListPrefix(text)) {
          issues.push(makeIssue({
            ruleId: 'normative-reference.list-prefix', severity: 'warning', category: 'references', nodeId: entry.nodeId, path: entry.path,
            message: '规范性引用文件条目前存在手工序号。',
            suggestion: '移除手工序号，保留文件标识和名称。', basis,
            evidence: [{ nodeId: entry.nodeId, path: entry.path, role: 'normative-reference', text }],
          }))
        }
        const parsed = parseStandardIdentifier(text)
        if (!parsed.recognized) {
          encounteredUnknown = true
          continue
        }
        if (!parsed.valid) {
          issues.push(makeIssue({
            ruleId: 'normative-reference.format', severity: 'warning', category: 'references', nodeId: entry.nodeId, path: entry.path,
            message: '未识别到受支持格式的规范性引用文件标识。',
            suggestion: '核对文件标识语法；本规则不查验编号是否真实存在。', basis,
            evidence: [{ nodeId: entry.nodeId, path: entry.path, role: 'normative-reference', text }],
          }))
        } else if (!parsed.title) {
          issues.push(makeIssue({
            ruleId: 'normative-reference.format', severity: 'warning', category: 'references', nodeId: entry.nodeId, path: entry.path,
            message: `规范性引用文件「${parsed.identifier}」缺少名称。`,
            suggestion: '补充文件名称；不注日期引用不因缺少年份而报错。', basis,
            evidence: [{ nodeId: entry.nodeId, path: entry.path, role: 'normative-reference', text }],
          }))
        }
      }
    })
  }
  const reason = encounteredUnknown
    ? '仅覆盖有限的常见标识语法；无法识别的出版物保留为待核对，本报告不判断其编号、名称、有效性或准确性。'
    : '仅检查有限的章位置、清单前序号、标识语法和名称格式；不查询出版物数据库、时效性或内容准确性。'
  return { issues, coverage: { status: 'partial', reason } }
}
