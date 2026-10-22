import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M G5 生产 Schema fixture：术语领域 termSubjectField（M-9.2.9-01）与 termEntry 独立 id（M-9.2.1-05）。
 * 仿 wp6.ts 的 pm()/txt() 写法；不修改 wp6.ts（它被多个既有测试共用）。
 */

const pm = (
  type: string,
  attrs?: Record<string, unknown>,
  content?: PMJsonNode[],
  text?: string,
  marks?: NonNullable<PMJsonNode['marks']>,
): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
  ...(text !== undefined ? { text } : {}),
  ...(marks ? { marks } : {}),
})

const txt = (text: string, marks?: NonNullable<PMJsonNode['marks']>) => pm('text', undefined, undefined, text, marks)
const para = (nodeId: string, ...content: PMJsonNode[]) => pm('stdParagraph', { nodeId }, content)
const definition = (nodeId: string, text: string) => pm('termDefinition', { nodeId }, [txt(text)])

/** GB/T 46687.2—2026 9.2.9 示例：3.1 协会 association，领域“顾客满意”。 */
export const G5_SUBJECT_CUSTOMER = '顾客满意'

/**
 * 全文术语布局（编号由 Resolver 派生）：
 * 3.1 协会（领域+英文名）、3.2 无领域旧式条目、3.3 条 > 3.3.1 技术规范（领域+来源+注）、3.3.2 仅领域（无英文名、领域含粗体）、
 * 3.4 含嵌套（嵌套 3.4.1 带领域）；附录 A 内 A.1（领域）。
 */
export function createWp8mG5Fixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('chapter', { nodeId: 'g5-scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('g5-scope-p',
        txt('本文件规定术语领域；见'),
        txt('协会', [{ type: 'crossRef', attrs: { targetId: 'g5-t1', refType: 'term' } }]),
        txt('与'),
        txt('协会', [{ type: 'termRef', attrs: { targetId: 'g5-t1' } }]),
        txt('。'),
      ),
    ]),
    pm('chapter', { nodeId: 'g5-norm' }, [
      pm('chapterTitle', undefined, [txt('规范性引用文件')]),
      para('g5-norm-p', txt('本文件没有规范性引用文件。')),
    ]),
    pm('chapter', { nodeId: 'g5-terms' }, [
      pm('chapterTitle', undefined, [txt('术语和定义')]),
      para('g5-terms-intro', txt('下列术语和定义适用于本文件。')),
      pm('termDef', { nodeId: 'g5-t1', level: 1 }, [
        pm('termName', undefined, [txt('协会')]),
        pm('termNameEn', undefined, [txt('association')]),
        pm('termSubjectField', undefined, [txt(G5_SUBJECT_CUSTOMER)]),
        definition('g5-t1-def', '由成员组织或个人组成的组织。'),
      ]),
      pm('termDef', { nodeId: 'g5-t2', level: 1 }, [
        pm('termName', undefined, [txt('无领域术语')]),
        definition('g5-t2-def', '没有领域字段的旧式术语条目。'),
      ]),
      pm('clause', { nodeId: 'g5-c3', level: 1 }, [
        pm('clauseTitle', undefined, [txt('分类术语')]),
        pm('termDef', { nodeId: 'g5-t331', level: 1 }, [
          pm('termName', undefined, [txt('技术规范')]),
          pm('termNameEn', undefined, [txt('technical specification')]),
          pm('termSubjectField', undefined, [txt('ISO 和/或 IEC 发布的')]),
          definition('g5-t331-def', '现阶段处在发展阶段的标准化文件。'),
          pm('termSource', undefined, [txt('GB/T 20000.1—2014，5.3')]),
          pm('note', { nodeId: 'g5-t331-note' }, [txt('领域不影响注的编号。')]),
        ]),
        pm('termDef', { nodeId: 'g5-t332', level: 1 }, [
          pm('termName', undefined, [txt('仅领域术语')]),
          pm('termSubjectField', undefined, [txt('化学', [{ type: 'bold' }])]),
          definition('g5-t332-def', '没有英文名、领域含粗体的术语条目。'),
        ]),
      ]),
      pm('termDef', { nodeId: 'g5-t4', level: 1 }, [
        pm('termName', undefined, [txt('含嵌套术语')]),
        definition('g5-t4-def', '含有嵌套术语条目的条目。'),
        pm('termDef', { nodeId: 'g5-t41', level: 2 }, [
          pm('termName', undefined, [txt('嵌套术语')]),
          pm('termSubjectField', undefined, [txt('嵌套领域')]),
          definition('g5-t41-def', '嵌套在 3.4 内的术语。'),
        ]),
      ]),
    ]),
    pm('appendix', { nodeId: 'g5-app-a', normative: true }, [
      pm('appendixLabel', undefined, [txt('（规范性）')]),
      pm('appendixTitle', undefined, [txt('附录术语')]),
      pm('termDef', { nodeId: 'g5-t-app', level: 1 }, [
        pm('termName', undefined, [txt('附录术语')]),
        pm('termSubjectField', undefined, [txt('附录领域')]),
        definition('g5-t-app-def', '附录中的术语。'),
      ]),
    ]),
  ])
}

/** 与 fixture 对应的期望：术语条目 id → [label, term_ 独立 id]。 */
export const G5_EXPECTED_TERM_IDS: Record<string, [string, string]> = {
  'g5-t1': ['3.1', 'term_3.1'],
  'g5-t2': ['3.2', 'term_3.2'],
  'g5-t331': ['3.3.1', 'term_3.3.1'],
  'g5-t332': ['3.3.2', 'term_3.3.2'],
  'g5-t4': ['3.4', 'term_3.4'],
  'g5-t41': ['3.4.1', 'term_3.4.1'],
  'g5-t-app': ['A.1', 'term_A.1'],
}

/** 带领域的术语条目 id 与其领域纯文本。 */
export const G5_SUBJECT_FIELDS: Record<string, string> = {
  'g5-t1': G5_SUBJECT_CUSTOMER,
  'g5-t331': 'ISO 和/或 IEC 发布的',
  'g5-t332': '化学',
  'g5-t41': '嵌套领域',
  'g5-t-app': '附录领域',
}
