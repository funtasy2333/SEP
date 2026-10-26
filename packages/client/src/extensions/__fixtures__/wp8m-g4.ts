import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M / G4（列项引用与列项 id）的生产 PM 夹具（不改 wp6.ts）。
 * PM Schema 零变化：引用是既有 crossRef mark，refType 取新值 `listItem`，目标是 stdListItem 的 nodeId。
 *
 *   chapter g4-ch1 "技术要求"（章 1）
 *     clause g4-c11 "列项"（1.1）
 *       stdParagraph g4-ref   ── 引用 g4-a3（字母列项 c））与 g4-n2（数字列项 2））
 *       stdList g4-l-alpha    ── g4-a1 g4-a2 g4-a3
 *       stdList g4-l-number   ── g4-n1 g4-n2（level 2）
 *       stdList g4-l-dash     ── g4-d1 g4-d2（无序，不可被引用）
 *
 * 期望标签：g4-a3 = { label:'c）', xmlId:'li_1', refText:'1.1 c）' }、g4-n2 = { label:'2）', xmlId:'li_2', refText:'1.1 2）' }。
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
const item = (nodeId: string, value: string) => pm('stdListItem', { nodeId }, [txt(value)])
const stdList = (nodeId: string, listType: string, level: 1 | 2, ...items: PMJsonNode[]) => pm('stdList', { nodeId, listType, level }, items)

/** 指向列项的 crossRef mark：refType 取 PM 侧的 `listItem`（对应 IR targetKind） */
export const listItemRef = (targetId: string, refType = 'listItem'): Marks => [{ type: 'crossRef', attrs: { targetId, refType } }]

export interface Wp8mG4Options {
  /** 引用段的内容；缺省引用 g4-a3 与 g4-n2 */
  refContent?: PMJsonNode[]
}

export function createWp8mG4Fixture(options: Wp8mG4Options = {}): PMJsonNode {
  const refContent = options.refContent ?? [
    txt('见'), txt('占位甲', listItemRef('g4-a3')), txt('与'), txt('占位乙', listItemRef('g4-n2')),
  ]
  return pm('doc', undefined, [
    pm('chapter', { nodeId: 'g4-ch1' }, [
      pm('chapterTitle', undefined, [txt('技术要求')]),
      pm('clause', { nodeId: 'g4-c11', level: 1 }, [
        pm('clauseTitle', { level: 1 }, [txt('列项')]),
        pm('stdParagraph', { nodeId: 'g4-ref' }, refContent),
        stdList('g4-l-alpha', 'alpha', 1, item('g4-a1', '甲'), item('g4-a2', '乙'), item('g4-a3', '丙')),
        stdList('g4-l-number', 'numeric', 2, item('g4-n1', '壹'), item('g4-n2', '贰')),
        stdList('g4-l-dash', 'dash', 1, item('g4-d1', '一'), item('g4-d2', '二')),
      ]),
    ]),
  ])
}

/** 期望的 Resolver 标签（Fixture 默认引用） */
export const WP8M_G4_EXPECTED_LABELS = {
  'g4-a3': { label: 'c）', xmlId: 'li_1', refText: '1.1 c）' },
  'g4-n2': { label: '2）', xmlId: 'li_2', refText: '1.1 2）' },
} as const

/**
 * 删除空条守卫用：标题为空、仅含一个被引用的空列项的条；引用写在另一个条里。
 * clause.ts 的 deleteEmptyClause 要求 textContent 为空，列项也是空的，因此只有 hasReferenceWithin 能拦住删除。
 */
export function createWp8mG4EmptyClauseFixture(): PMJsonNode {
  return pm('doc', undefined, [
    pm('chapter', { nodeId: 'e-ch' }, [
      pm('chapterTitle', undefined, [txt('技术要求')]),
      pm('clause', { nodeId: 'e-host', level: 1 }, [
        pm('clauseTitle', { level: 1 }, [txt('引用所在条')]),
        pm('stdParagraph', { nodeId: 'e-ref' }, [txt('见'), txt('占位', listItemRef('e-item'))]),
      ]),
      pm('clause', { nodeId: 'e-empty', level: 1 }, [
        pm('clauseTitle', { level: 1 }),
        stdList('e-list', 'alpha', 1, pm('stdListItem', { nodeId: 'e-item' })),
      ]),
    ]),
  ])
}
