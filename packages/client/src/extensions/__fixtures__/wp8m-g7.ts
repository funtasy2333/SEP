import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M G7「罗马列项与注/示例的块内容」的生产 PM 夹具（矩阵 M-5.7-04、M-5.6-05）。不改 wp6.ts。
 *
 * 所有节点都带稳定 nodeId，使 PM→IR→PM 往返与保存重开可以逐节点比较。
 *
 *   chapter g7-ch1 "技术要求"（章 1）
 *     clause g7-c11 "罗马列项"（1.1）
 *       stdParagraph g7-intro        ── 引用 g7-r3（第一个罗马列项的第 3 项）与 g7-s2（第二个罗马列项的第 2 项）
 *       stdList g7-l-roman (roman)   ── g7-r1…g7-r4（i） ii） iii） iv））
 *       stdList g7-l-roman2 (roman)  ── g7-s1、g7-s2（编号从 i） 重新起）
 *       stdList g7-l-alpha (alpha)   ── 与罗马列项相邻的字母列项，用来核对类型互不串扰
 *
 * Resolver 只给被引用的有序列项赋标签（G4）：g7-r3 = { label:'iii）', xmlId:'li_1', refText:'1.1 iii）' }、
 * g7-s2 = { label:'ii）', xmlId:'li_2', refText:'1.1 ii）' }。
 *
 * 注/示例的块内容见 createG7NoteFixture（M-5.6-05）：
 *
 *   foreword
 *     noteBlock g7-fw-note        ── 前言里的多段注（两个段落）
 *   chapter g7-ch1 "技术要求"（章 1）
 *     clause g7-c11 "列项与注"（1.1）
 *       stdParagraph g7-intro     ── 引用 g7-r3（罗马列项 iii））与 g7-n3（注）
 *       stdList g7-l-roman        ── g7-r1…g7-r4
 *       note g7-n1                ── 旧的单段注（canonical：派生段落 id）
 *       noteBlock g7-n2           ── 多块注：段落 + 带脚注的段落 + dash 列项
 *       noteBlock g7-n3           ── 单段但段落 id 非派生（g7-n3-p）：必须仍是 noteBlock
 *       example g7-e1             ── 旧的单段示例
 *       exampleBlock g7-e2        ── 多块示例：段落 + 罗马列项
 *     clause g7-c12 "表中的块注"（1.2）
 *       stdTable g7-t1            ── 单元格内的 noteBlock g7-t1-note
 *
 * 期望标签（同一作用域的注/示例连续编号）：g7-n1 注1：、g7-n2 注2：、g7-n3 注3：；g7-e1 示例1：、g7-e2 示例2：。
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
  'g7-r3': { label: 'iii）', xmlId: 'li_1', refText: '1.1 iii）' },
  'g7-s2': { label: 'ii）', xmlId: 'li_2', refText: '1.1 ii）' },
} as const

export function createG7NoteFixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('foreword', undefined, [
      pm('noteBlock', { nodeId: 'g7-fw-note' }, [
        para('g7-fw-note-p1', txt('前言注的第一段。')),
        para('g7-fw-note-p2', txt('前言注的第二段。')),
      ]),
    ]),
    pm('chapter', { nodeId: 'g7-ch1', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('技术要求')]),
      pm('clause', { nodeId: 'g7-c11', level: 1 }, [
        pm('clauseTitle', { level: 1 }, [txt('列项与注')]),
        para('g7-intro', txt('分下列步骤，见'), xref('占位甲', 'g7-r3', 'listItem'), txt('，并见'), xref('占位乙', 'g7-n3', 'note'), txt('。')),
        stdList('g7-l-roman', 'roman', 1, item('g7-r1', '准备'), item('g7-r2', '实施'), item('g7-r3', '检查'), item('g7-r4', '处置')),
        pm('note', { nodeId: 'g7-n1' }, [txt('旧式单段注。')]),
        pm('noteBlock', { nodeId: 'g7-n2' }, [
          para('g7-n2-p1', txt('多块注的第一段。')),
          para('g7-n2-p2', txt('第二段带脚注'), pm('footnoteRef', { nodeId: 'g7-fn1', content: [txt('注内段落的脚注。')] }), txt('。')),
          stdList('g7-n2-l', 'dash', 1, item('g7-n2-i1', '注内列项一'), item('g7-n2-i2', '注内列项二')),
        ]),
        pm('noteBlock', { nodeId: 'g7-n3' }, [para('g7-n3-p', txt('单段但段落 id 非派生的注。'))]),
        pm('example', { nodeId: 'g7-e1' }, [txt('旧式单段示例。')]),
        pm('exampleBlock', { nodeId: 'g7-e2' }, [
          para('g7-e2-p1', txt('多块示例的引语：')),
          stdList('g7-e2-l', 'roman', 1, item('g7-e2-a', '示例项甲'), item('g7-e2-b', '示例项乙')),
        ]),
      ]),
      pm('clause', { nodeId: 'g7-c12', level: 1 }, [
        pm('clauseTitle', { level: 1 }, [txt('表中的块注')]),
        pm('stdTable', { nodeId: 'g7-t1', headerRowCount: 1 }, [
          pm('tableCaption', undefined, [txt('块注示例表')]),
          pm('table', undefined, [
            pm('tableRow', { nodeId: 'g7-t1-r1' }, [
              pm('tableHeader', { nodeId: 'g7-t1-h1', colspan: 1, rowspan: 1 }, [para('g7-t1-h1-p', txt('项目'))]),
              pm('tableHeader', { nodeId: 'g7-t1-h2', colspan: 1, rowspan: 1 }, [para('g7-t1-h2-p', txt('说明'))]),
            ]),
            pm('tableRow', { nodeId: 'g7-t1-r2' }, [
              pm('tableCell', { nodeId: 'g7-t1-c1', colspan: 1, rowspan: 1 }, [para('g7-t1-c1-p', txt('取值'))]),
              pm('tableCell', { nodeId: 'g7-t1-c2', colspan: 1, rowspan: 1 }, [
                pm('noteBlock', { nodeId: 'g7-t1-note' }, [
                  para('g7-t1-note-p1', txt('单元格内注的第一段。')),
                  para('g7-t1-note-p2', txt('单元格内注的第二段。')),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ])
}

/** 期望的 Resolver 标签（块内容的注/示例，同一作用域连续编号） */
export const WP8M_G7_NOTE_LABELS = {
  notes: { 'g7-n1': '注1：', 'g7-n2': '注2：', 'g7-n3': '注3：' },
  examples: { 'g7-e1': '示例1：', 'g7-e2': '示例2：' },
} as const
