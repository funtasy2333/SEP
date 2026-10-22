import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M G7「罗马列项与注/示例的块内容」的生产 PM 夹具（矩阵 M-5.7-04、M-5.6-05）。不改 wp6.ts。
 *
 * 所有节点都带稳定 nodeId，使 PM→IR→PM 往返与保存重开可以逐节点比较。
 *
 *   chapter g7-ch1 "技术要求"（章 1）
 *     clause g7-c11 "罗马列项"（1.1）
 *       stdParagraph g7-intro        ── 引用 g7-r3（第一个罗马列项的第 3 项）与 g7-s2（第二个罗马列项的第 2 项）
 *       stdList g7-l-roman (roman)   ── g7-r1…g7-r4（i) ii) iii) iv)）
 *       stdList g7-l-roman2 (roman)  ── g7-s1、g7-s2（编号从 i) 重新起）
 *       stdList g7-l-alpha (alpha)   ── 与罗马列项相邻的字母列项，用来核对类型互不串扰
 *
 * Resolver 只给被引用的有序列项赋标签（G4）：g7-r3 = { label:'iii)', xmlId:'li_1', refText:'1.1 iii)' }、
 * g7-s2 = { label:'ii)', xmlId:'li_2', refText:'1.1 ii)' }。
 */

type Marks = NonNullable<PMJsonNode['marks']>

const pm = (type: string, attrs?: Record<string, unknown>, content?: PMJsonNode[], text?: string, marks?: Marks): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
  ...(text !== undefined ? { text } : {}),
  ...(marks ? { marks } : {}),
})

const txt = (value: string, marks?: Marks) => pm('text', undefined, undefined, value, marks)
const para = (nodeId: string, ...content: PMJsonNode[]) => pm('stdParagraph', { nodeId }, content)
const item = (nodeId: string, value: string) => pm('stdListItem', { nodeId }, [txt(value)])
const stdList = (nodeId: string, listType: string, level: 1 | 2, ...items: PMJsonNode[]) => pm('stdList', { nodeId, listType, level }, items)
const xref = (value: string, targetId: string, refType: string) => txt(value, [{ type: 'crossRef', attrs: { targetId, refType } }])

export function createG7RomanFixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('chapter', { nodeId: 'g7-ch1', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('技术要求')]),
      pm('clause', { nodeId: 'g7-c11', level: 1 }, [
        pm('clauseTitle', { level: 1 }, [txt('罗马列项')]),
        para('g7-intro', txt('分下列步骤，见'), xref('占位甲', 'g7-r3', 'listItem'), txt('与'), xref('占位乙', 'g7-s2', 'listItem'), txt('。')),
        stdList('g7-l-roman', 'roman', 1, item('g7-r1', '准备'), item('g7-r2', '实施'), item('g7-r3', '检查'), item('g7-r4', '处置')),
        stdList('g7-l-roman2', 'roman', 1, item('g7-s1', '收集'), item('g7-s2', '归档')),
        stdList('g7-l-alpha', 'alpha', 1, item('g7-a1', '甲'), item('g7-a2', '乙')),
      ]),
    ]),
  ])
}

/** 期望的 Resolver 标签（只有被引用的有序列项有标签） */
export const WP8M_G7_ROMAN_LABELS = {
  'g7-r3': { label: 'iii)', xmlId: 'li_1', refText: '1.1 iii)' },
  'g7-s2': { label: 'ii)', xmlId: 'li_2', refText: '1.1 ii)' },
} as const
