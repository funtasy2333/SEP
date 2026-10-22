/**
 * WP8.M G7「罗马列项与注/示例的块内容」的 IR 原生 fixture（矩阵 M-5.7-04、M-5.6-05）。
 *
 * 不修改字节锁定的 fixtures.ts；这里只构造 G7 需要的最小文档：
 *   chapter g7-ch1 "技术要求"（章 1）
 *     clause g7-c11 "罗马列项"（1.1）
 *       paragraph g7-intro        ── 引用 g7-r3 与 g7-s2（列项引用，G4）
 *       list g7-l-roman (roman)   ── g7-r1…g7-r4
 *       list g7-l-roman2 (roman)  ── g7-s1、g7-s2
 */

import type { IRBlock, IRClause, IRDoc, IRExample, IRInline, IRList, IRNote, IRParagraph, NodeId } from '../types'

export const t = (text: string): IRInline => ({ text })
export const para = (id: NodeId, ...content: IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content })
export const listRef = (text: string, targetId: NodeId): IRInline => ({ text, marks: [{ type: 'crossRef', targetId, targetKind: 'listItem' }] })

/** 简单列表：每项一个派生 id（`<项 id>.p0`）的段落，pmToIr/irToPm 的规范形态 */
export function simpleList(id: NodeId, listType: IRList['listType'], ...items: [NodeId, string][]): IRList {
  return {
    kind: 'list', id, listType,
    ...(listType === 'number' || listType === 'dot' ? { level: 2 as const } : {}),
    items: items.map(([itemId, text]) => ({ id: itemId, content: [para(`${itemId}.p0`, t(text))] })),
  }
}

export function docWithBlocks(blocks: Array<IRBlock | IRClause>): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'g7-ch1', secType: 'general', title: [t('技术要求')],
      children: [{
        kind: 'clause', id: 'g7-c11', level: 1, titled: true, title: [t('罗马列项')],
        children: blocks as IRClause['children'],
      }],
    }],
    appendices: [],
    bibliography: [],
  }
}

export function createG7RomanIrDoc(): IRDoc {
  return docWithBlocks([
    para('g7-intro', t('分下列步骤，见'), listRef('占位甲', 'g7-r3'), t('与'), listRef('占位乙', 'g7-s2'), t('。')),
    simpleList('g7-l-roman', 'roman', ['g7-r1', '准备'], ['g7-r2', '实施'], ['g7-r3', '检查'], ['g7-r4', '处置']),
    simpleList('g7-l-roman2', 'roman', ['g7-s1', '收集'], ['g7-s2', '归档']),
  ])
}

// ---------------------------------------------------------------------------------------------------------------------
// M-5.6-05 注/示例的块内容
// ---------------------------------------------------------------------------------------------------------------------

/**
 * 同一条（1.1）里的注与示例，覆盖 HTML/DOCX 的各种内容形态：
 *   n1 旧式单段注（canonical，派生段落 id）        ── 注1：
 *   n2 多块注：段落 + 段落 + dash 列项             ── 注2：
 *   n3 单段但段落 id 非派生                        ── 注3：（HTML 仍按单段输出）
 *   n4 只含一个 alpha 列项的注                     ── 注4：
 *   e1 旧式单段示例                                ── 示例1：
 *   e2 多块示例：段落 + 罗马列项                    ── 示例2：
 */
export function createG7NoteIrDoc(): IRDoc {
  const n1: IRNote = { kind: 'note', id: 'g7-n1', content: [para('g7-n1.p0', t('旧式单段注。'))] }
  const n2: IRNote = {
    kind: 'note', id: 'g7-n2', content: [
      para('g7-n2-p1', t('多块注的第一段。')),
      para('g7-n2-p2', t('多块注的第二段。')),
      simpleList('g7-n2-l', 'dash', ['g7-n2-i1', '注内列项一'], ['g7-n2-i2', '注内列项二']),
    ],
  }
  const n3: IRNote = { kind: 'note', id: 'g7-n3', content: [para('g7-n3-p', t('段落 id 非派生的单段注。'))] }
  const n4: IRNote = { kind: 'note', id: 'g7-n4', content: [simpleList('g7-n4-l', 'alpha', ['g7-n4-a', '仅列项的注一'], ['g7-n4-b', '仅列项的注二'])] }
  const e1: IRExample = { kind: 'example', id: 'g7-e1', content: [para('g7-e1.p0', t('旧式单段示例。'))] }
  const e2: IRExample = {
    kind: 'example', id: 'g7-e2', content: [
      para('g7-e2-p1', t('多块示例的引语：')),
      simpleList('g7-e2-l', 'roman', ['g7-e2-a', '示例项甲'], ['g7-e2-b', '示例项乙'], ['g7-e2-c', '示例项丙']),
    ],
  }
  return docWithBlocks([para('g7-note-intro', t('下列注与示例。')), n1, n2, n3, n4, e1, e2])
}

/** DOCX 一致性比对用：列项（Resolver 不给 label）的手写期望。 */
export const G7_LIST_ITEM_EXPECTED: ReadonlyMap<NodeId, string> = new Map<NodeId, string>([
  ['g7-r1', 'i）'], ['g7-r2', 'ii）'], ['g7-r3', 'iii）'], ['g7-r4', 'iv）'],
  ['g7-s1', 'i）'], ['g7-s2', 'ii）'],
  ['g7-n2-i1', '——'], ['g7-n2-i2', '——'],
  ['g7-n4-a', 'a）'], ['g7-n4-b', 'b）'],
  ['g7-e2-a', 'i）'], ['g7-e2-b', 'ii）'], ['g7-e2-c', 'iii）'],
])
