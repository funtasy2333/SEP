/**
 * WP8.M G5 测试 fixture：术语领域 `subjectField`（M-9.2.9-01）与术语条目独立 id `term_<编号>`（M-9.2.1-05）。
 *
 * - IR 原生构造器（`g5IrDoc` / `g5PrintDoc`）：Resolver、PM 投影、输出边界与渲染器测试共用。
 * - PM JSON 构造器（`g5PmDoc`）：shared 层 pmToIr/irToPm 测试用的纯对象文档（不依赖 Tiptap）。
 *
 * 不修改字节锁定的 fixtures.ts；这里只复用它的 PM 构造器。
 */

import type { PMJsonNode } from '../pmToIr'
import type {
  IRAppendix, IRChapter, IRClause, IRDoc, IRInline, IRTermEntry,
} from '../types'
import { chapter as pmChapter, para as pmPara, text as pmText } from './fixtures'

/** GB/T 46687.2—2026 9.2.9 的示例：3.1 协会 association，领域“顾客满意”。 */
export const SUBJECT_CUSTOMER = '顾客满意'
/** 同标准 9.3 示例 3.1.1 技术规范 的领域。 */
export const SUBJECT_ISO_IEC = 'ISO 和/或 IEC 发布的'

const plain = (value: string): IRInline[] => [{ text: value }]

interface G5TermOptions {
  termEn?: string
  subjectField?: IRInline[]
  nested?: IRTermEntry[]
}

/** IR 术语条目：定义段 id 取 `<id>.def0`，与 pmToIr 对缺 nodeId 的术语定义的约定一致。 */
export function g5Term(id: string, term: string, definition: string, options: G5TermOptions = {}): IRTermEntry {
  return {
    kind: 'termEntry',
    id,
    level: 1,
    term: plain(term),
    ...(options.termEn === undefined ? {} : { termEn: plain(options.termEn) }),
    ...(options.subjectField === undefined ? {} : { subjectField: options.subjectField }),
    definition: [{ kind: 'paragraph', id: `${id}.def0`, content: plain(definition) }],
    notes: [],
    examples: [],
    ...(options.nested ? { nestedEntries: options.nested } : {}),
  }
}

function baseDoc(body: IRChapter[], appendices: IRAppendix[]): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: 'G5 术语领域测试', stdCode: 'GB/T 99999—2026' },
    front: { foreword: [], introduction: [] },
    body,
    appendices,
    bibliography: [],
  }
}

/** `withTermRef` 为真时正文另含 termRef mark（Resolver 测试用；HTML/DOCX 输出边界不放行该 mark，故打印文档不含）。 */
function scopeChapters(termRefTarget?: string, withTermRef = false): IRChapter[] {
  return [
    {
      kind: 'chapter', id: 'g5-scope', secType: 'scope', title: plain('范围'),
      children: [{ kind: 'paragraph', id: 'g5-scope-p', content: plain('本文件规定了术语领域的表示。') }],
    },
    {
      kind: 'chapter', id: 'g5-norm', secType: 'norm-refs', title: plain('规范性引用文件'),
      children: [{
        kind: 'paragraph', id: 'g5-norm-p',
        content: termRefTarget
          ? [
              { text: '术语' },
              { text: '协会', marks: [{ type: 'crossRef', targetId: termRefTarget, targetKind: 'term' }] },
              ...(withTermRef ? [{ text: '与' }, { text: '协会', marks: [{ type: 'termRef' as const, targetId: termRefTarget }] }] : []),
              { text: '。' },
            ]
          : plain('本文件没有规范性引用文件。'),
      }],
    },
  ]
}

/** 可被 HTML/DOCX 渲染的术语章：不含嵌套术语（nestedEntries 会被输出边界拦下）。 */
export function g5PrintTerms(): IRChapter {
  const grouped: IRClause = {
    kind: 'clause', id: 'g5-clause', level: 1, titled: true, title: plain('分类术语'),
    children: [
      g5Term('g5-t-iso', '技术规范', '现阶段由于标准化对象涉及的技术内容仍处在发展阶段的标准化文件。', {
        termEn: 'technical specification',
        subjectField: plain(SUBJECT_ISO_IEC),
      }),
      g5Term('g5-t-marked', '带格式领域', '领域含粗体与上标的术语。', {
        subjectField: [{ text: '化学', marks: [{ type: 'bold' }] }, { text: '2', marks: [{ type: 'sup' }] }],
      }),
    ],
  }
  return {
    kind: 'chapter', id: 'g5-terms', secType: 'terms', title: plain('术语和定义'),
    children: [
      g5Term('g5-t1', '协会', '由成员组织或个人组成的组织。', {
        termEn: 'association',
        subjectField: plain(SUBJECT_CUSTOMER),
      }),
      g5Term('g5-t2', '无领域术语', '没有领域字段的旧式术语条目。'),
      grouped,
    ],
  }
}

/** 附录 A 内的术语条目：编号 A.1，独立 id 应为 term_A.1。 */
export function g5Appendix(): IRAppendix {
  return {
    kind: 'appendix', id: 'g5-app-a', normative: true, title: plain('附录术语'),
    children: [g5Term('g5-t-app', '附录术语', '附录中的术语。', { subjectField: plain('附录领域') })],
  }
}

/** HTML/DOCX 渲染与边界测试用：term 3.1（有领域）、3.2（无领域）、3.3.1、3.3.2，附录 A.1。 */
export function g5PrintDoc(): IRDoc {
  return baseDoc([...scopeChapters('g5-t1'), g5PrintTerms()], [g5Appendix()])
}

/** Resolver / PM 往返测试用：在 g5PrintDoc 之外再加嵌套术语 3.4（含 3.4.1），覆盖 `term_3.4.1`。 */
export function g5IrDoc(): IRDoc {
  const terms = g5PrintTerms()
  terms.children.push(g5Term('g5-t4', '含嵌套术语', '含有嵌套术语条目的条目。', {
    nested: [g5Term('g5-t41', '嵌套术语', '嵌套在 3.4 内的术语。', { subjectField: plain('嵌套领域') })],
  }))
  return baseDoc([...scopeChapters('g5-t1', true), terms], [g5Appendix()])
}

// ---------- PM JSON（shared 层纯对象） ----------

interface PmTermOptions {
  termEn?: string
  subject?: string | PMJsonNode[] | null
  definition?: string
  extra?: PMJsonNode[]
}

/** 生产 PM 术语节点；`subject` 为 null 表示放一个空的 termSubjectField 节点。 */
export function pmTerm(nodeId: string, termCn: string, options: PmTermOptions = {}): PMJsonNode {
  const content: PMJsonNode[] = [{ type: 'termName', content: [pmText(termCn)] }]
  if (options.termEn !== undefined) content.push({ type: 'termNameEn', content: [pmText(options.termEn)] })
  if (options.subject !== undefined) {
    content.push({
      type: 'termSubjectField',
      content: options.subject === null ? [] : typeof options.subject === 'string' ? [pmText(options.subject)] : options.subject,
    })
  }
  content.push({
    type: 'termDefinition',
    attrs: { nodeId: `${nodeId}.def0` },
    content: [pmText(options.definition ?? `${termCn}的定义。`)],
  })
  if (options.extra) content.push(...options.extra)
  return { type: 'termDef', attrs: { nodeId, level: 1 }, content }
}

/** 与 g5PrintDoc 同构的 PM 文档：范围、规范性引用文件、术语和定义（含领域）。 */
export function g5PmDoc(): PMJsonNode {
  return {
    type: 'doc',
    content: [
      pmChapter('g5-scope', '范围', pmPara('g5-scope-p', pmText('本文件规定了术语领域的表示。'))),
      pmChapter('g5-norm', '规范性引用文件', pmPara('g5-norm-p', pmText('本文件没有规范性引用文件。'))),
      pmChapter(
        'g5-terms', '术语和定义',
        pmTerm('g5-t1', '协会', { termEn: 'association', subject: SUBJECT_CUSTOMER, definition: '由成员组织或个人组成的组织。' }),
        pmTerm('g5-t2', '无领域术语', { definition: '没有领域字段的旧式术语条目。' }),
      ),
    ],
  }
}
