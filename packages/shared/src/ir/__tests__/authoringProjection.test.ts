import { describe, expect, it } from 'vitest'
import { normalizeAuthoringFragment, AUTHORING_NODE_KINDS } from '../authoring'
import type { AuthoringContext, IRFragmentNode } from '../fragmentContext'
import { IRToPmError, irFragmentToPm, irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import type { IRBlock, IRDoc } from '../types'
import {
  ALL_CONTEXTS, EXPECTED_ALLOWED, MINIMAL, PNG_DATA_URL, pmRoundTrip, seqIds,
} from './authoringHelpers'

function normalize(
  input: unknown, context: AuthoringContext, existingIds?: Set<string>, generateId: () => string = seqIds('n'),
): IRFragmentNode[] {
  const result = normalizeAuthoringFragment(input, context, { generateId, ...(existingIds ? { existingIds } : {}) })
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2))
  return result.nodes
}

function captureError(run: () => unknown): IRToPmError {
  let caught: unknown
  try { run() } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(IRToPmError)
  return caught as IRToPmError
}

const mark = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra })

/** 覆盖每种可写块及其主要变体的片段（块位置通用）。 */
function richBlocks(sfx = ''): unknown[] {
  return [
    '普通段落',
    {
      kind: 'paragraph', id: `para-marks${sfx}`,
      content: [
        '前', { text: '粗', marks: [mark('bold')] }, { text: '斜下', marks: [mark('italic'), mark('sub')] },
        { text: '删', marks: [mark('strike'), mark('underline')] }, { text: '代码', marks: [mark('code')] },
        { text: '变量', marks: [mark('variable', { kind: 'quantity', name: 'm' })] },
        { text: '表', marks: [mark('crossRef', { targetId: 'tbl-rich', targetKind: 'table' })] },
        { text: '文献', marks: [mark('bibRef', { targetId: 'bib-1' })] },
        { text: '术语', marks: [mark('termRef', { targetId: 'term-1' })] },
        { text: '链接', marks: [mark('externalLink', { href: 'https://example.com/a', title: '标题', target: '_blank', rel: 'noopener' })] },
        '换行\n第二行', { text: '粗\n体', marks: [mark('bold')] },
      ],
    },
    { kind: 'list', listType: 'dash', items: ['甲', { id: `dash-2${sfx}`, content: [{ text: '乙', marks: [mark('bold')] }] }] },
    { kind: 'list', listType: 'alpha', items: ['a'] },
    { kind: 'list', listType: 'boxed', items: ['b'] },
    { kind: 'list', listType: 'number', items: ['n1', 'n2'] },
    { kind: 'list', listType: 'dot', items: ['d'] },
    {
      kind: 'table', id: `tbl-rich${sfx}`, caption: [{ text: '复杂表', marks: [mark('bold')] }], captionEn: 'Complex table',
      orientation: 'landscape', headerRowCount: 2,
      rows: [
        [{ content: '项目', rowspan: 2 }, { content: '指标', colspan: 2 }],
        ['下限', '上限'],
        ['长度', { content: ['1', '2'] }, { content: [{ kind: 'list', items: ['x', 'y'] }] }],
        { id: `row-last${sfx}`, cells: [{ id: `cell-last${sfx}`, content: [{ text: '末', marks: [mark('sup')] }], header: true }, '', ''] },
      ],
      notes: ['表注一', { id: `tbl-note-2${sfx}`, content: '表注二' }],
    },
    { kind: 'table', caption: '', headerRowCount: 0, rows: [['单格']] },
    { kind: 'figure', caption: '图题', captionEn: 'Figure', orientation: 'landscape', src: PNG_DATA_URL, alt: '替代文字' },
    { kind: 'figure', caption: '', src: PNG_DATA_URL },
    {
      kind: 'formula', latex: 'E = mc^2', numbered: false,
      whereList: [{ term: [{ text: 'E', marks: [mark('variable')] }], definition: '能量' }, { id: `where-2${sfx}`, term: 'm', definition: '质量' }],
    },
    { kind: 'formula', latex: '\\frac{a}{b}' },
    { kind: 'note', content: '注内容' },
    { kind: 'note', id: `note-2${sfx}`, content: [{ kind: 'paragraph', id: `note-2${sfx}.p0`, content: [{ text: '带标记', marks: [mark('italic')] }] }] },
    { kind: 'example', content: [{ text: '示例', marks: [mark('bold')] }, '内容'] },
  ]
}

function termEntries(): unknown[] {
  return [
    { kind: 'termEntry', id: 'term-1', term: '术语一', termEn: 'term one', definition: ['定义第一段', '定义第二段'], source: 'GB/T 1.1—2020，3.1', notes: ['术语注'], examples: ['术语例'] },
    { kind: 'termEntry', term: [{ text: '术语二', marks: [mark('bold')] }], definition: '定义', level: 3 },
  ]
}

function clauseChain(depth: number): unknown {
  return {
    kind: 'clause', title: `条${depth}`,
    children: ['正文', ...(depth > 1 ? [clauseChain(depth - 1)] : [])],
  }
}

function richFragment(name: string): unknown[] {
  switch (name) {
    case 'foreword': return richBlocks()
    case 'introduction': return richBlocks('-intro')
    case 'body': return [
      { kind: 'chapter', title: '范围', children: ['本文件规定了……'] },
      { kind: 'chapter', title: '规范性引用文件', children: ['下列文件……'] },
      { kind: 'chapter', id: 'chapter-terms', title: '术语和定义', children: ['引导语', ...termEntries()] },
      { kind: 'chapter', title: '技术要求', secType: 'general', children: [clauseChain(3), { kind: 'clause', children: ['无题条'] }] },
    ]
    case 'appendices': return [
      { kind: 'appendix', title: '规范性附录', normative: true, children: [{ kind: 'clause', title: '条', children: ['正文'] }] },
      { kind: 'appendix', title: '资料性附录', children: richBlocks('-app').slice(0, 3) },
    ]
    case 'bibliography': return ['GB/T 1.1—2020 标准化工作导则', { kind: 'bibEntry', id: 'bib-1', content: [{ text: '书名', marks: [mark('italic')] }] }]
    case 'clause:5': return richBlocks()
    default: {
      const level = name.startsWith('clause:') ? Number(name.slice(7)) : 0
      return [...richBlocks(), clauseChain(Math.max(1, 5 - level)), ...termEntries(), { kind: 'clause' }]
    }
  }
}

describe('irFragmentToPm / 往返：片段 → 生产 PM → pmToIr 与归一化 IR 一致', () => {
  for (const { name, context } of ALL_CONTEXTS) {
    it(`${name}：覆盖全部可写节点与变体`, () => {
      const nodes = normalize(richFragment(name), context)
      const pm = irFragmentToPm(nodes, context)
      expect(pm).toHaveLength(nodes.length)
      expect(pmRoundTrip(pm, context)).toEqual(nodes)
    })
  }

  it('所有 kind 都在往返覆盖里出现（不漏测）', () => {
    const seen = new Set<string>()
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === 'object') {
        const kind = (value as { kind?: unknown }).kind
        if (typeof kind === 'string') seen.add(kind)
        Object.values(value).forEach(collect)
      }
    }
    for (const { name, context } of ALL_CONTEXTS) collect(normalize(richFragment(name), context))
    for (const kind of AUTHORING_NODE_KINDS) expect(seen.has(kind), kind).toBe(true)
  })

  it('投影结果是纯 JSON（可往返）且不含编号', () => {
    for (const { name, context } of ALL_CONTEXTS) {
      const pm = irFragmentToPm(normalize(richFragment(name), context), context)
      expect(JSON.parse(JSON.stringify(pm))).toEqual(pm)
      expect(JSON.stringify(pm)).not.toMatch(/"number"|"label"|"refText"/)
    }
  })

  it('图的 alt 缺省为空串时往返不变；\\n 拆成的换行片段往返不变', () => {
    const context: AuthoringContext = { parent: 'chapter' }
    const nodes = normalize([{ kind: 'figure', caption: '', src: PNG_DATA_URL }, '甲\n乙'], context)
    expect(pmRoundTrip(irFragmentToPm(nodes, context), context)).toEqual(nodes)
    const paragraph = nodes[1] as { content: { text: string }[] }
    expect(paragraph.content.map(run => run.text)).toEqual(['甲', '\n', '乙'])
  })
})

describe('归一化与投影的一致性（确定性随机变异）', () => {
  // 线性同余伪随机数：固定种子，结果可复现
  function rng(seed: number): () => number {
    let state = seed
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296
      return state / 4294967296
    }
  }

  type Slot = { parent: unknown; key: string | number }

  function slots(value: unknown, out: Slot[] = []): Slot[] {
    if (Array.isArray(value)) {
      value.forEach((child, index) => { out.push({ parent: value, key: index }); slots(child, out) })
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) { out.push({ parent: value, key }); slots(child, out) }
    }
    return out
  }

  const REPLACEMENTS: unknown[] = [
    null, 0, 1, -1, 2.5, true, false, '', ' ', 'x', '[来源：x', 'data:image/png;base64,QUJD', 'https://x.com', 'javascript:1',
    [], {}, [[]], ['a', { text: 'b' }], { kind: 'paragraph', content: 'z' }, { kind: 'list', items: ['i'] },
    { kind: 'note', content: 'n' }, { kind: 'clause', title: 'c' }, { kind: 'quote' }, { text: 'a\nb' },
    { type: 'bold' }, { type: 'crossRef', targetId: 't' }, 'dash', 'roman', 'landscape', 'terms',
  ]

  for (const { name, context } of ALL_CONTEXTS) {
    it(`${name}：随机变异 400 次——归一化从不抛错；一旦通过，投影必然成功且往返一致`, () => {
      const random = rng(name.length * 7919 + 17)
      const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]!
      let passed = 0
      for (let round = 0; round < 400; round += 1) {
        const input = JSON.parse(JSON.stringify(richFragment(name))) as unknown[]
        for (let step = 0, steps = 1 + Math.floor(random() * 3); step < steps; step += 1) {
          const all = slots(input)
          if (all.length === 0) break
          const slot = pick(all)
          const container = slot.parent as Record<string | number, unknown> & unknown[]
          switch (Math.floor(random() * 5)) {
            case 0: if (Array.isArray(container)) container.splice(slot.key as number, 1); else delete container[slot.key]; break
            case 1: container[slot.key] = JSON.parse(JSON.stringify(pick(REPLACEMENTS))); break
            case 2: if (Array.isArray(container)) container.splice(slot.key as number, 0, JSON.parse(JSON.stringify(container[slot.key as number]))); else container[`extra${step}`] = 1; break
            case 3: if (container && typeof container === 'object' && !Array.isArray(container) && 'id' in container) container.id = 'dup'; else container[slot.key] = pick(['paragraph', 'table', 'chapter', 'termEntry'])
              break
            default: if (!Array.isArray(container)) container[slot.key] = JSON.parse(JSON.stringify(container[slot.key])); break
          }
        }
        const result = normalizeAuthoringFragment(input, context, { generateId: seqIds('z') })
        if (!result.ok) {
          expect(result.issues.length).toBeGreaterThan(0)
          for (const issue of result.issues) {
            expect(issue.path.startsWith('fragment') || issue.path === 'context').toBe(true)
            expect(issue.reason).not.toBe('')
          }
          continue
        }
        passed += 1
        const pm = irFragmentToPm(result.nodes, context)
        expect(pmRoundTrip(pm, context)).toEqual(result.nodes)
        // 归一化结果是不动点
        const again = normalizeAuthoringFragment(result.nodes, context, { generateId: () => { throw new Error('不应再生成 id') } })
        expect(again).toEqual({ ok: true, nodes: result.nodes })
      }
      // 两个分支都要被走到：变异既不应全部被拒（否则没有检验“通过之后”的性质），也不应全部通过
      expect(passed).toBeGreaterThan(40)
      expect(passed).toBeLessThan(360)
    })
  }
})

describe('irFragmentToPm / 与整篇 irToPm 一致', () => {
  it('片段投影出的节点与整篇文档投影中对应位置的节点完全相同', () => {
    const existing = new Set<string>()
    const generateId = seqIds('n')
    const take = (name: string, context: AuthoringContext): IRFragmentNode[] => {
      const nodes = normalize(richFragment(name), context, existing, generateId)
      JSON.stringify(nodes, (key, value) => { if (key === 'id') existing.add(value as string); return value })
      return nodes
    }
    const foreword = take('foreword', { parent: 'foreword' }) as IRBlock[]
    const introduction = take('introduction', { parent: 'introduction' }) as IRBlock[]
    const chapters = take('body', { parent: 'body' }) as IRDoc['body']
    const appendices = take('appendices', { parent: 'appendices' }) as IRDoc['appendices']
    const bibliography = take('bibliography', { parent: 'bibliography' }) as IRDoc['bibliography']
    const doc: IRDoc = {
      schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword, introduction },
      body: chapters, appendices, bibliography,
    }
    const whole = irToPm(doc)
    const topLevel = whole.content!
    expect(topLevel[0]).toEqual({ type: 'foreword', content: irFragmentToPm(foreword, { parent: 'foreword' }) })
    expect(topLevel[1]).toEqual({ type: 'introduction', content: irFragmentToPm(introduction, { parent: 'introduction' }) })
    const chapterNodes = topLevel.filter(node => node.type === 'chapter')
    expect(chapterNodes).toEqual(irFragmentToPm(chapters, { parent: 'body' }))
    chapters.forEach((chapter, index) => {
      expect(chapterNodes[index]!.content!.slice(1)).toEqual(irFragmentToPm(chapter.children, { parent: 'chapter' }))
    })
    expect(topLevel.filter(node => node.type === 'appendix')).toEqual(irFragmentToPm(appendices, { parent: 'appendices' }))
    expect(topLevel.find(node => node.type === 'bibliography')!.content!.slice(1)).toEqual(irFragmentToPm(bibliography, { parent: 'bibliography' }))

    // 分片归一化时用已有 id 集合互相避让：整篇文档 id 唯一，Resolver 不报 id 问题和悬空引用
    const problems = resolve(doc).problems.filter(problem => ['duplicate-id', 'missing-id', 'dangling-xref', 'dangling-typed-ref'].includes(problem.code))
    expect(problems).toEqual([])
    // 整篇投影再读回，仍是同一份 IR
    expect(pmToIr(whole).doc.body).toEqual(doc.body)
  })
})

describe('irFragmentToPm / 上下文校验', () => {
  const MINIMAL_IR = new Map<string, IRFragmentNode>()
  for (const kind of AUTHORING_NODE_KINDS) {
    const home = ALL_CONTEXTS.find(({ name }) => EXPECTED_ALLOWED[name]!.includes(kind))!
    MINIMAL_IR.set(kind, normalize([MINIMAL[kind]], home.context)[0]!)
  }

  for (const { name, context } of ALL_CONTEXTS) {
    it(`${name}：只接受允许的 kind，其余抛 IRToPmError（路径 fragment[0]）`, () => {
      for (const kind of AUTHORING_NODE_KINDS) {
        const node = MINIMAL_IR.get(kind)!
        if (EXPECTED_ALLOWED[name]!.includes(kind)) {
          expect(irFragmentToPm([node], context)).toHaveLength(1)
        } else {
          const error = captureError(() => irFragmentToPm([node], context))
          expect(error.diagnostics).toHaveLength(1)
          expect(error.diagnostics[0]).toMatchObject({ path: 'fragment[0]', nodeId: node.id })
          expect(error.diagnostics[0]!.reason).toContain(kind)
        }
      }
    })
  }

  it('IR 层的块（warning / quote / code）在块位置可以投影，在章序列中不可以', () => {
    const para = { kind: 'paragraph' as const, id: 'p', content: [{ text: '内' }] }
    const blocks: IRBlock[] = [
      { kind: 'warning', id: 'w', content: [para] },
      { kind: 'quote', id: 'q', content: [{ ...para, id: 'p2' }] },
      { kind: 'code', id: 'c', language: 'ts', text: 'x' },
    ]
    expect(irFragmentToPm(blocks, { parent: 'chapter' }).map(node => node.type)).toEqual(['warning', 'quoteBlock', 'codeBlock'])
    for (const parent of ['body', 'appendices', 'bibliography'] as const) {
      expect(captureError(() => irFragmentToPm(blocks, { parent })).diagnostics).toHaveLength(3)
    }
  })

  it('无效上下文、非数组片段、缺 kind 的节点', () => {
    expect(captureError(() => irFragmentToPm([], { parent: 'clause' } as never)).diagnostics[0]).toMatchObject({ path: 'context' })
    expect(captureError(() => irFragmentToPm({} as never, { parent: 'chapter' })).diagnostics[0]).toMatchObject({ path: 'fragment' })
    expect(captureError(() => irFragmentToPm([{ id: 'x' } as never], { parent: 'chapter' })).diagnostics[0]).toMatchObject({ path: 'fragment[0]', reason: '片段节点缺少 kind' })
    expect(irFragmentToPm([], { parent: 'chapter' })).toEqual([])
  })
})

describe('irFragmentToPm / 诊断沿用 IRToPmError', () => {
  const ctx: AuthoringContext = { parent: 'chapter' }
  const para = (content: IRBlock extends infer B ? B extends { kind: 'paragraph' } ? B['content'] : never : never): IRBlock => ({ kind: 'paragraph', id: 'p', content })

  it('行内问题带片段路径：crossRef 含换行、重复标记、code 与其他标记、空文本带标记', () => {
    const error = captureError(() => irFragmentToPm([
      para([{ text: 'a\nb', marks: [{ type: 'crossRef', targetId: 't' }] }]),
      para([{ text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }]),
      para([{ text: 'x', marks: [{ type: 'code' }, { type: 'italic' }] }]),
      para([{ text: '', marks: [{ type: 'sup' }] }]),
      para([{ text: '', marks: [{ type: 'crossRef', targetId: 't' }] }]),
    ], ctx))
    const paths = error.diagnostics.map(diagnostic => diagnostic.path)
    expect(paths).toEqual(expect.arrayContaining([
      'fragment[0].content[0].text', 'fragment[1].content[0].marks[1]', 'fragment[2].content[0].marks[0]',
      'fragment[3].content[0].marks[0]', 'fragment[4].content[0].marks[0]',
    ]))
  })

  // WP8.M G7-a：原用例用小写罗马 roman 断言「罗马数字列项经 irFragmentToPm 被拒」；roman 现可表示，改用无原文取值的 romanUpper。
  // WP8.M G3（M-8.2-11）：图中注现可表示（figure 内的单段 note），原用例的空内容图中注改为仍不可表示的多块图中注，
  // 诊断路径由 `fragment[1].notes` 变为 `fragment[1].notes.fn`（与术语条目、表注行内的注同一规则），其余断言（空列表/空表）不变。
  it('不可表示的 IR：大写罗马数字列项、多块图中注、空列表/空表、嵌套列项', () => {
    const item = (id: string) => ({ id, content: [{ kind: 'paragraph' as const, id: `${id}.p0`, content: [{ text: 'x' }] }] })
    const error = captureError(() => irFragmentToPm([
      { kind: 'list', id: 'l1', listType: 'romanUpper', items: [item('i1')] },
      {
        kind: 'figure', id: 'f1', caption: [], orientation: 'portrait', src: PNG_DATA_URL,
        notes: [{ kind: 'note', id: 'fn', content: [
          { kind: 'paragraph', id: 'fn.p0', content: [{ text: '一' }] }, { kind: 'paragraph', id: 'fn.p1', content: [{ text: '二' }] },
        ] }],
      },
      { kind: 'list', id: 'l2', listType: 'dash', items: [] },
      { kind: 'table', id: 't1', caption: [], orientation: 'portrait', headerRowCount: 0, rows: [], notes: [] },
    ], ctx))
    const byPath = new Map(error.diagnostics.map(diagnostic => [diagnostic.path, diagnostic.nodeId]))
    expect(byPath.get('fragment[0].listType')).toBe('l1')
    expect(byPath.get('fragment[1].notes.fn')).toBe('fn.p0')
    expect(byPath.get('fragment[2].items')).toBe('l2')
    expect(byPath.get('fragment[3].rows')).toBe('t1')
  })

  // WP8.M G7-b：原用例的第一个片段是块位置的注，断言其非派生段落 id 在 `fragment[0].content[0]` 被拒绝。块位置的注现投影为
  // noteBlock 并保留该 id（下一用例），所以改用仍压平为单段 note 的术语条目注作为拒绝对象；术语条目缺主定义的断言不变。
  it('术语条目的注/示例内段落 id 与派生值不符、术语条目缺主定义：投影层拒绝，不静默改写 id', () => {
    const error = captureError(() => irFragmentToPm([
      {
        kind: 'termEntry', id: 't0', term: [{ text: 't' }], definition: [{ kind: 'paragraph', id: 't0.def0', content: [{ text: 'd' }] }],
        notes: [{ kind: 'note', id: 'n1', content: [{ kind: 'paragraph', id: 'wrong', content: [{ text: 'x' }] }] }], examples: [],
      },
      { kind: 'termEntry', id: 't1', term: [{ text: 't' }], definition: [], notes: [], examples: [] },
    ], ctx))
    const paths = error.diagnostics.map(diagnostic => diagnostic.path)
    expect(paths).toContain('fragment[0].notes.n1.content[0]')
    expect(paths).toContain('fragment[1].definition')
  })

  it('[M-5.6-05] 块位置的注内段落 id 与派生值不符：投影为 noteBlock，保留段落 id（不静默改写）', () => {
    const nodes = irFragmentToPm([
      { kind: 'note', id: 'n1', content: [{ kind: 'paragraph', id: 'wrong', content: [{ text: 'x' }] }] },
    ], ctx)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ type: 'noteBlock', attrs: { nodeId: 'n1' } })
    expect(nodes[0]!.content![0]).toMatchObject({ type: 'stdParagraph', attrs: { nodeId: 'wrong' } })
  })

  it('脚注内容无法保存、表脚注引用缺 id：路径以片段根开头', () => {
    const error = captureError(() => irFragmentToPm([
      para([{ text: '', footnote: { id: 'fn1', content: [{ text: 'x', marks: [{ type: 'code' }] }] } }]),
      para([{ text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'entry' }] }]),
    ], ctx))
    const paths = error.diagnostics.map(diagnostic => diagnostic.path)
    expect(paths.some(path => path.startsWith('fragment[0].content[0].footnote.content'))).toBe(true)
    expect(paths).toContain('fragment[1].content[0].marks[0]')
    // 带 id 的表脚注引用可以投影
    const pm = irFragmentToPm([para([{ text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'entry', id: 'ref-1' }] }])], ctx)
    expect(pm[0]!.content![0]).toMatchObject({ type: 'tableFootnoteRef', attrs: { nodeId: 'ref-1', targetId: 'entry' } })
  })

  it('rootPath 改变诊断路径的根；同一次调用收集全部诊断', () => {
    const error = captureError(() => irFragmentToPm([
      { kind: 'chapter', id: 'c', secType: 'general', title: [], children: [] },
      para([{ text: 'a\nb', marks: [{ type: 'crossRef', targetId: 't' }] }]),
    ], ctx, { rootPath: 'ops[0].content' }))
    expect(error.diagnostics.map(diagnostic => diagnostic.path)).toEqual(['ops[0].content[1].content[0].text', 'ops[0].content[0]'])
    expect(error.message).toContain('2')
  })
})

describe('irFragmentToPm / 不影响整篇 irToPm', () => {
  it('整篇投影的诊断路径仍以 doc 为根（脚注负载检查的根路径参数默认值未变）', () => {
    const doc: IRDoc = {
      schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{
        kind: 'chapter', id: 'c', secType: 'general', title: [{ text: '章' }],
        children: [{ kind: 'paragraph', id: 'p', content: [{ text: '', footnote: { id: 'fn', content: [{ text: 'x', marks: [{ type: 'code' }] }] } }] }],
      }],
      appendices: [], bibliography: [],
    }
    const error = captureError(() => irToPm(doc))
    expect(error.diagnostics.some(diagnostic => diagnostic.path.startsWith('doc.body[0].children[0].content[0].footnote.content'))).toBe(true)
  })

  it('片段投影不改变传入的 IR 节点', () => {
    const nodes = normalize(richFragment('chapter'), { parent: 'chapter' })
    const snapshot = JSON.stringify(nodes)
    irFragmentToPm(nodes, { parent: 'chapter' })
    expect(JSON.stringify(nodes)).toBe(snapshot)
  })
})

describe('irFragmentToPm / 节点形态（抽查生产属性）', () => {
  it('章下的条、列项、注、术语条目投影为对应的生产节点与属性', () => {
    const nodes = normalize([
      { kind: 'clause', id: 'cl', title: '条', children: [{ kind: 'termEntry', id: 'te', term: '术语', definition: '定义' }] },
      { kind: 'list', id: 'ls', listType: 'number', items: [{ id: 'li', content: '项' }] },
      { kind: 'note', id: 'nt', content: '注' },
    ], { parent: 'chapter' })
    const [clause, list, note] = irFragmentToPm(nodes, { parent: 'chapter' }) as [PMJsonNode, PMJsonNode, PMJsonNode]
    expect(clause).toMatchObject({ type: 'clause', attrs: { nodeId: 'cl', level: 1, hasTitle: true } })
    expect(clause.content![0]).toEqual({ type: 'clauseTitle', content: [{ type: 'text', text: '条' }] })
    expect(clause.content![1]).toMatchObject({ type: 'termDef', attrs: { nodeId: 'te', level: 2 } })
    expect(list).toMatchObject({ type: 'stdList', attrs: { nodeId: 'ls', listType: 'numeric', level: 2 } })
    expect(list.content![0]).toMatchObject({ type: 'stdListItem', attrs: { nodeId: 'li' }, content: [{ type: 'text', text: '项' }] })
    expect(note).toEqual({ type: 'note', attrs: { nodeId: 'nt' }, content: [{ type: 'text', text: '注' }] })
  })
})
