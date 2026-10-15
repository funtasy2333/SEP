// @vitest-environment happy-dom
/**
 * WP9.2b：写作片段 → 生产 PM JSON 的投影必须能通过编辑器的生产 schema。
 *
 * shared 不能依赖 client 的 Tiptap 扩展，因此“shared 的投影与编辑器没有漂移”由这里把关：
 * 覆盖全部可写节点种类的片段与 docs/wp9-authoring-reference.md 里的全部示例，
 * 投影后放入合法父节点，用 getSchema(createEditorExtensions()) 的 nodeFromJSON(...).check() 校验，
 * 再经 schema 序列化读回（pmToIr），应与归一化结果一致。
 */
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import {
  AUTHORING_NODE_KINDS, irFragmentToPm, normalizeAuthoringFragment, pmToIr,
  type AuthoringContext, type IRDoc, type IRFragmentNode, type PMJsonNode,
} from '@ses/shared'
import reference from '../../../../docs/wp9-authoring-reference.md?raw'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const CONTEXTS: { name: string; context: AuthoringContext }[] = [
  { name: 'foreword', context: { parent: 'foreword' } },
  { name: 'introduction', context: { parent: 'introduction' } },
  { name: 'body', context: { parent: 'body' } },
  { name: 'chapter', context: { parent: 'chapter' } },
  ...([1, 2, 3, 4, 5] as const).map(level => ({ name: `clause:${level}`, context: { parent: 'clause', level } as AuthoringContext })),
  { name: 'appendices', context: { parent: 'appendices' } },
  { name: 'appendix', context: { parent: 'appendix' } },
  { name: 'bibliography', context: { parent: 'bibliography' } },
]

function parseContext(name: string): AuthoringContext {
  return name.startsWith('clause:')
    ? { parent: 'clause', level: Number(name.slice(7)) as 1 | 2 | 3 | 4 | 5 }
    : { parent: name } as AuthoringContext
}

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const el = (type: string, attrs: Record<string, unknown> | undefined, content: PMJsonNode[]): PMJsonNode =>
  ({ type, ...(attrs ? { attrs } : {}), content })

/** 把投影结果放入合法父节点：生产编辑器 `doc` 根下，容器按各自的内容表达式配齐必需的标题子节点。 */
function wrap(nodes: PMJsonNode[], context: AuthoringContext): PMJsonNode {
  switch (context.parent) {
    case 'foreword': return el('doc', undefined, [el('foreword', { nodeId: 'ctx-foreword' }, nodes)])
    case 'introduction': return el('doc', undefined, [el('introduction', { nodeId: 'ctx-introduction' }, nodes)])
    case 'body':
    case 'appendices': return el('doc', undefined, nodes)
    case 'chapter':
      return el('doc', undefined, [el('chapter', { nodeId: 'ctx-chapter', secType: 'general' }, [el('chapterTitle', undefined, [text('容器')]), ...nodes])])
    case 'clause': {
      let inner = nodes
      for (let level = context.level; level >= 1; level -= 1) {
        inner = [el('clause', { nodeId: `ctx-clause-${level}`, level, hasTitle: true }, [el('clauseTitle', undefined, [text('容器条')]), ...inner])]
      }
      return el('doc', undefined, [el('chapter', { nodeId: 'ctx-chapter', secType: 'general' }, [el('chapterTitle', undefined, [text('容器')]), ...inner])])
    }
    case 'appendix':
      return el('doc', undefined, [el('appendix', { nodeId: 'ctx-appendix', normative: true }, [
        el('appendixLabel', undefined, [text('（规范性）')]), el('appendixTitle', undefined, [text('容器')]), ...nodes,
      ])])
    case 'bibliography':
      return el('doc', undefined, [el('bibliography', { nodeId: 'ctx-bibliography' }, [el('bibliographyTitle', undefined, [text('参考文献')]), ...nodes])])
  }
}

function extract(doc: IRDoc, context: AuthoringContext): unknown[] {
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
      for (let level = 1; level <= context.level; level += 1) children = (children[0] as { children: unknown[] }).children
      return children
    }
  }
}

function sequentialIds(): () => string {
  let n = 0
  return () => `frag${++n}`
}

function normalizeOk(input: unknown, context: AuthoringContext): IRFragmentNode[] {
  const result = normalizeAuthoringFragment(input, context, { generateId: sequentialIds() })
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2))
  return result.nodes
}

/** pmToIr 保留 PM 的标记顺序（按 schema 排序）；比较时与标记顺序无关。 */
function sortMarks<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, child: unknown) =>
    key === 'marks' && Array.isArray(child)
      ? [...child].sort((a, b) => String((a as { type: string }).type).localeCompare(String((b as { type: string }).type)))
      : child)) as T
}

/** 投影 → 放入父节点 → 生产 schema check() → schema 序列化 → pmToIr 读回，返回读回的片段。 */
function projectAndCheck(nodes: IRFragmentNode[], context: AuthoringContext): unknown[] {
  const pm = irFragmentToPm(nodes, context)
  const doc = schema.nodeFromJSON(wrap(pm, context))
  doc.check()
  expectNodeIdsUnique(doc)
  const { doc: ir, warnings } = pmToIr(doc.toJSON() as PMJsonNode)
  expect(warnings).toEqual([])
  expect(ir.unsupportedContent).toBeUndefined()
  return extract(ir, context)
}

function expectNodeIdsUnique(doc: PMNode): void {
  const seen = new Set<string>()
  doc.descendants(node => {
    if (!('nodeId' in node.attrs)) return
    const id = node.attrs.nodeId as unknown
    expect(typeof id === 'string' && id.length > 0, `${node.type.name} 缺少 nodeId`).toBe(true)
    expect(seen.has(id as string), `nodeId 重复：${String(id)}`).toBe(false)
    seen.add(id as string)
  })
}

const mark = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra })

function richBlocks(sfx: string): unknown[] {
  return [
    '普通段落',
    {
      kind: 'paragraph',
      content: [
        '前', { text: '粗斜', marks: [mark('bold'), mark('italic')] }, { text: '下标', marks: [mark('sub')] },
        { text: '上标', marks: [mark('sup')] }, { text: '删线', marks: [mark('strike'), mark('underline')] },
        { text: '代码', marks: [mark('code')] }, { text: '变量', marks: [mark('variable', { kind: 'quantity', name: 'm' })] },
        { text: '表', marks: [mark('crossRef', { targetId: `tbl${sfx}`, targetKind: 'table' })] },
        { text: '文献', marks: [mark('bibRef', { targetId: 'bib-1' })] },
        { text: '术语', marks: [mark('termRef', { targetId: 'term-1' })] },
        { text: '链接', marks: [mark('externalLink', { href: 'https://example.com', title: '标题' })] },
        '换行\n第二行',
      ],
    },
    ...(['dash', 'alpha', 'boxed', 'number', 'dot'] as const).map(listType => ({ kind: 'list', listType, items: ['甲', { content: [{ text: '乙', marks: [mark('bold')] }] }] })),
    {
      kind: 'table', id: `tbl${sfx}`, caption: '表题', captionEn: 'Table', orientation: 'landscape', headerRowCount: 2,
      rows: [
        [{ content: '项目', rowspan: 2 }, { content: '指标', colspan: 2 }],
        ['下限', '上限'],
        ['长度', { content: ['1', '2'] }, { content: [{ kind: 'list', items: ['x', 'y'] }] }],
        ['', '', ''],
      ],
      notes: ['表注一', '表注二'],
    },
    { kind: 'table', caption: '', headerRowCount: 0, rows: [['单格']] },
    { kind: 'figure', caption: '图题', captionEn: 'Figure', orientation: 'landscape', src: PNG, alt: '替代文字' },
    { kind: 'formula', latex: 'E = mc^2', numbered: false, whereList: [{ term: 'E', definition: '能量' }, { term: 'm', definition: '质量' }] },
    { kind: 'formula', latex: 'a+b' },
    { kind: 'note', content: [{ text: '带标记的注', marks: [mark('italic')] }] },
    { kind: 'example', content: '示例' },
  ]
}

function richTerms(): unknown[] {
  return [
    { kind: 'termEntry', term: '术语一', termEn: 'term one', definition: ['定义第一段', '定义第二段'], source: 'GB/T 1.1—2020，3.1', notes: ['术语注'], examples: ['术语例'] },
    { kind: 'termEntry', term: '术语二', definition: '定义' },
  ]
}

function clauseChain(depth: number): unknown {
  return { kind: 'clause', title: `条${depth}`, children: ['正文', ...(depth > 1 ? [clauseChain(depth - 1)] : [])] }
}

function richFragment(name: string): unknown[] {
  switch (name) {
    case 'body': return [
      { kind: 'chapter', title: '范围', children: ['本文件规定了……'] },
      { kind: 'chapter', title: '术语和定义', children: ['引导语', ...richTerms()] },
      { kind: 'chapter', title: '技术要求', children: [clauseChain(5), { kind: 'clause', children: ['无题条'] }] },
    ]
    case 'appendices': return [
      { kind: 'appendix', title: '规范性附录', normative: true, children: [clauseChain(2)] },
      { kind: 'appendix', title: '资料性附录', children: richBlocks('-app') },
    ]
    case 'bibliography': return ['GB/T 1.1—2020 标准化工作导则', { kind: 'bibEntry', content: [{ text: '书名', marks: [mark('italic')] }] }]
    case 'clause:5': case 'foreword': case 'introduction': return richBlocks(`-${name}`)
    default: {
      const level = name.startsWith('clause:') ? Number(name.slice(7)) : 0
      return [...richBlocks(`-${name}`), clauseChain(Math.max(1, 5 - level)), ...richTerms(), { kind: 'clause' }]
    }
  }
}

describe('写作片段 → 生产 schema', () => {
  for (const { name, context } of CONTEXTS) {
    it(`${name}：覆盖全部可写节点的片段投影后通过 check()，经 schema 读回与归一化结果一致`, () => {
      const nodes = normalizeOk(richFragment(name), context)
      expect(sortMarks(projectAndCheck(nodes, context))).toEqual(sortMarks(nodes))
    })
  }

  it('上述片段覆盖了全部可写节点种类', () => {
    const seen = new Set<string>()
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') {
        const kind = (value as { kind?: unknown }).kind
        if (typeof kind === 'string') seen.add(kind)
        Object.values(value).forEach(walk)
      }
    }
    for (const { name, context } of CONTEXTS) walk(normalizeOk(richFragment(name), context))
    for (const kind of AUTHORING_NODE_KINDS) expect(seen.has(kind), kind).toBe(true)
  })

  it('校验是有效的：放错位置或缺少必需子节点的 PM 会被 check() 拒绝', () => {
    const entries = irFragmentToPm(normalizeOk(['文献'], { parent: 'bibliography' }), { parent: 'bibliography' })
    // 参考文献条目不能直接放在章里
    expect(() => schema.nodeFromJSON(wrap(entries, { parent: 'chapter' })).check()).toThrow()
    // 章缺少标题子节点
    const chapters = irFragmentToPm(normalizeOk([{ kind: 'chapter', title: '章' }], { parent: 'body' }), { parent: 'body' })
    chapters[0]!.content!.shift()
    expect(() => schema.nodeFromJSON(wrap(chapters, { parent: 'body' })).check()).toThrow()
    // 列项项不能脱离列表
    const list = irFragmentToPm(normalizeOk([{ kind: 'list', items: ['x'] }], { parent: 'chapter' }), { parent: 'chapter' })
    expect(() => schema.nodeFromJSON(wrap(list[0]!.content!, { parent: 'chapter' })).check()).toThrow()
  })
})

describe('说明文档里的示例 → 生产 schema', () => {
  const pattern = /^```json ses-example([^\n]*)\n([\s\S]*?)\n```$/gm
  const examples = [...(reference as string).matchAll(pattern)].map(match => {
    const attrs = Object.fromEntries(match[1]!.trim().split(/\s+/).filter(Boolean).map(token => {
      const at = token.indexOf('=')
      return [token.slice(0, at), token.slice(at + 1)]
    })) as Record<string, string>
    return { line: (reference as string).slice(0, match.index).split('\n').length, attrs, json: JSON.parse(match[2]!) as unknown }
  }).filter(example => example.attrs.expect !== 'error')

  it('文档中有示例', () => {
    expect(examples.length).toBeGreaterThanOrEqual(15)
  })

  for (const example of examples) {
    it(`第 ${example.line} 行（${example.attrs.context}）通过 check() 且读回一致`, () => {
      const context = parseContext(example.attrs.context!)
      const nodes = normalizeOk(example.json, context)
      expect(sortMarks(projectAndCheck(nodes, context))).toEqual(sortMarks(nodes))
    })
  }
})
