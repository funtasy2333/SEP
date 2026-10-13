import { expect } from 'vitest'
import type { AuthoringContext } from '../fragmentContext'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import type { IRDoc } from '../types'
import type { AuthoringNodeKind } from '../authoring'

/** 1x1 PNG，仅用于格式校验。 */
export const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** 确定性 id 序列：g1、g2 …（测试里显式 id 避免使用 g 开头）。 */
export function seqIds(prefix = 'g'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

export const ALL_CONTEXTS: { name: string; context: AuthoringContext }[] = [
  { name: 'foreword', context: { parent: 'foreword' } },
  { name: 'introduction', context: { parent: 'introduction' } },
  { name: 'body', context: { parent: 'body' } },
  { name: 'chapter', context: { parent: 'chapter' } },
  { name: 'clause:1', context: { parent: 'clause', level: 1 } },
  { name: 'clause:2', context: { parent: 'clause', level: 2 } },
  { name: 'clause:3', context: { parent: 'clause', level: 3 } },
  { name: 'clause:4', context: { parent: 'clause', level: 4 } },
  { name: 'clause:5', context: { parent: 'clause', level: 5 } },
  { name: 'appendices', context: { parent: 'appendices' } },
  { name: 'appendix', context: { parent: 'appendix' } },
  { name: 'bibliography', context: { parent: 'bibliography' } },
]

const BLOCKS: AuthoringNodeKind[] = ['paragraph', 'list', 'table', 'figure', 'formula', 'note', 'example']

/**
 * 每个上下文允许的 kind——独立于实现手写一份，用来核对实现（authoring.test.ts）与
 * 说明文档里的上下文表（authoringReference.test.ts）。依据见 fragmentContext.ts 头注释。
 */
export const EXPECTED_ALLOWED: Record<string, AuthoringNodeKind[]> = {
  foreword: BLOCKS,
  introduction: BLOCKS,
  body: ['chapter'],
  chapter: [...BLOCKS, 'clause', 'termEntry'],
  'clause:1': [...BLOCKS, 'clause', 'termEntry'],
  'clause:2': [...BLOCKS, 'clause', 'termEntry'],
  'clause:3': [...BLOCKS, 'clause', 'termEntry'],
  'clause:4': [...BLOCKS, 'clause', 'termEntry'],
  'clause:5': BLOCKS,
  appendices: ['appendix'],
  appendix: [...BLOCKS, 'clause', 'termEntry'],
  bibliography: ['bibEntry'],
}

/** 每种 kind 的最小合法输入（在其允许的上下文中都能通过）。 */
export const MINIMAL: Record<AuthoringNodeKind, unknown> = {
  paragraph: { kind: 'paragraph', content: '段落' },
  list: { kind: 'list', items: ['项'] },
  table: { kind: 'table', caption: '表题', rows: [['格']] },
  figure: { kind: 'figure', caption: '图题', src: PNG_DATA_URL },
  formula: { kind: 'formula', latex: 'x' },
  note: { kind: 'note', content: '注' },
  example: { kind: 'example', content: '例' },
  clause: { kind: 'clause', title: '条' },
  termEntry: { kind: 'termEntry', term: '术语', definition: '定义' },
  chapter: { kind: 'chapter', title: '章' },
  appendix: { kind: 'appendix', title: '附录' },
  bibEntry: { kind: 'bibEntry', content: '文献' },
}

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const el = (type: string, attrs: Record<string, unknown> | undefined, content: PMJsonNode[]): PMJsonNode =>
  ({ type, ...(attrs ? { attrs } : {}), content })

/** 把片段投影出的 PM 节点放进一篇最小的生产形态文档，使其落在 `context` 指定的父节点下。 */
export function wrapInPmDoc(nodes: PMJsonNode[], context: AuthoringContext): PMJsonNode {
  switch (context.parent) {
    case 'foreword':
      return el('doc', undefined, [el('foreword', undefined, nodes)])
    case 'introduction':
      return el('doc', undefined, [el('introduction', undefined, nodes)])
    case 'body':
    case 'appendices':
      return el('doc', undefined, nodes)
    case 'chapter':
      return el('doc', undefined, [
        el('chapter', { nodeId: 'ctx-chapter', secType: 'general' }, [el('chapterTitle', undefined, [text('容器')]), ...nodes]),
      ])
    case 'clause': {
      let inner = nodes
      for (let level = context.level; level >= 1; level -= 1) {
        inner = [el('clause', { nodeId: `ctx-clause-${level}`, level, hasTitle: true }, [el('clauseTitle', undefined, [text('容器条')]), ...inner])]
      }
      return el('doc', undefined, [
        el('chapter', { nodeId: 'ctx-chapter', secType: 'general' }, [el('chapterTitle', undefined, [text('容器')]), ...inner]),
      ])
    }
    case 'appendix':
      return el('doc', undefined, [
        el('appendix', { nodeId: 'ctx-appendix', normative: true }, [
          el('appendixLabel', undefined, [text('（规范性）')]),
          el('appendixTitle', undefined, [text('容器')]),
          ...nodes,
        ]),
      ])
    case 'bibliography':
      return el('doc', undefined, [el('bibliography', undefined, [el('bibliographyTitle', undefined, [text('参考文献')]), ...nodes])])
  }
}

/** 从 pmToIr 的结果中取回 `context` 父节点下的子节点。 */
export function extractFromIr(doc: IRDoc, context: AuthoringContext): unknown[] {
  switch (context.parent) {
    case 'foreword': return doc.front.foreword
    case 'introduction': return doc.front.introduction
    case 'body': return doc.body
    case 'appendices': return doc.appendices
    case 'bibliography': return doc.bibliography
    case 'chapter': return doc.body[0]!.children
    case 'appendix': return doc.appendices[0]!.children
    case 'clause': {
      let children: unknown[] = doc.body[0]!.children
      for (let level = 1; level <= context.level; level += 1) {
        const clause = children[0] as { kind: string; level: number; children: unknown[] }
        expect(clause.kind).toBe('clause')
        expect(clause.level).toBe(level)
        children = clause.children
      }
      return children
    }
  }
}

/** 投影 → 放入父节点 → pmToIr 读回，返回读回的片段（并断言无警告、无不可表示内容）。 */
export function pmRoundTrip(pmNodes: PMJsonNode[], context: AuthoringContext): unknown[] {
  const { doc, warnings } = pmToIr(wrapInPmDoc(pmNodes, context))
  expect(warnings).toEqual([])
  expect(doc.unsupportedContent).toBeUndefined()
  return extractFromIr(doc, context)
}
