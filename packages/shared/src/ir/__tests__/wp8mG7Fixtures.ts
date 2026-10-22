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

import type { IRBlock, IRClause, IRDoc, IRInline, IRList, IRParagraph, NodeId } from '../types'

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
