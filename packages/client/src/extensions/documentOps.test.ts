// @vitest-environment happy-dom
/**
 * WP9.2c1：文档操作引擎（@ses/io）与编辑器生产 schema 的一致性。
 *
 * `@ses/io` 是同构包，不能依赖编辑器 schema，因此引擎通过注入的 `validateContent` 做 schema 校验与 nodeId 规范化。
 * 这里把宿主校验实现为 `getSchema(createEditorExtensions())` 的 `nodeFromJSON().check()` + client 的 `normalizeNodeIds`
 * （服务端 `normalizeContent` 的同一组合），证明引擎产生的各种文档（容器创建与清空、深层条、移动改层级、替换……）
 * 都是编辑器能加载、检查通过的合法文档，并且「readNode → 原样 replace」在编辑器 schema 的规范形态下文档不变。
 */
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import {
  applyDocumentOperations, buildOutline, readNode,
  type ApplyDocumentOperationsSuccess, type ContentValidator, type DocumentOperation,
} from '@ses/io'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import fixtureSource from '../../../server/src/export/__fixtures__/standard-document.json?raw'
import { createEditorExtensions } from './editorExtensions'
import { normalizeNodeIds } from './plugins/ensureNodeId'

const schema = getSchema(createEditorExtensions())

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** 宿主注入的校验：生产 schema 的 nodeFromJSON + check，通过后按编辑器同一策略规范化 nodeId，返回编辑器 getJSON() 形态。 */
const validateContent: ContentValidator = content => {
  try {
    const node = schema.nodeFromJSON(content)
    node.check()
    return { ok: true, content: normalizeNodeIds(node).toJSON() as PMJsonNode }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** 每次调用用不同的前缀：同一份文档上的多次 apply 不能产生重复 id。 */
let applyCount = 0
function sequentialIds(): () => string {
  const prefix = `e${++applyCount}_`
  let n = 0
  return () => `${prefix}${++n}`
}

const canonical = (json: unknown): PMJsonNode => schema.nodeFromJSON(json).toJSON() as PMJsonNode
const fixture = (): PMJsonNode => JSON.parse(fixtureSource) as PMJsonNode

function apply(source: PMJsonNode, operations: DocumentOperation[]): ApplyDocumentOperationsSuccess {
  const result = applyDocumentOperations(source, operations, { validateContent, generateId: sequentialIds() })
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2))
  return result
}

/** schema 合法；`ids` 为 true 时还要求每个带 nodeId 属性的节点都有唯一的 nodeId（经 normalizeNodeIds 之后）。 */
function expectValid(doc: PMJsonNode, ids = true): PMNode {
  const node = schema.nodeFromJSON(doc)
  node.check()
  if (!ids) return node
  const seen = new Set<string>()
  node.descendants(child => {
    if (!('nodeId' in child.attrs)) return
    const id = child.attrs.nodeId as unknown
    expect(typeof id === 'string' && id.length > 0, `${child.type.name} 缺少 nodeId`).toBe(true)
    expect(seen.has(id as string), `nodeId 重复：${String(id)}`).toBe(false)
    seen.add(id as string)
  })
  return node
}

/** 条标题节点的 level 与条自身一致（编辑器里两者始终相等）。 */
function expectClauseTitleLevels(doc: PMJsonNode): void {
  const visit = (node: PMJsonNode): void => {
    if (node.type === 'clause') {
      const title = (node.content ?? []).find(child => child.type === 'clauseTitle')
      expect(title?.attrs?.level, `条 ${String(node.attrs?.nodeId)} 的标题层级`).toBe(node.attrs?.level)
    }
    ;(node.content ?? []).forEach(visit)
  }
  visit(doc)
}

const mark = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra })

function richBlocks(sfx: string): unknown[] {
  return [
    '普通段落',
    {
      kind: 'paragraph',
      content: [
        '前', { text: '粗斜', marks: [mark('bold'), mark('italic')] }, { text: '下标', marks: [mark('sub')] },
        { text: '代码', marks: [mark('code')] }, { text: '变量', marks: [mark('variable', { name: 'm' })] },
        { text: '引用', marks: [mark('crossRef', { targetId: `tbl${sfx}`, targetKind: 'table' })] },
        { text: '链接', marks: [mark('externalLink', { href: 'https://example.com', title: '标题' })] },
        '换行\n第二行',
      ],
    },
    ...(['dash', 'alpha', 'boxed', 'number', 'dot'] as const).map(listType => ({ kind: 'list', listType, items: ['甲', { content: [{ text: '乙', marks: [mark('bold')] }] }] })),
    {
      kind: 'table', id: `tbl${sfx}`, caption: '表题', captionEn: 'Table', headerRowCount: 2,
      rows: [
        [{ content: '项目', rowspan: 2 }, { content: '指标', colspan: 2 }],
        ['下限', '上限'],
        ['长度', { content: ['1', '2'] }, { content: [{ kind: 'list', items: ['x', 'y'] }] }],
      ],
      notes: ['表注一', '表注二'],
    },
    { kind: 'figure', caption: '图题', captionEn: 'Figure', src: PNG, alt: '替代文字' },
    { kind: 'formula', latex: 'E = mc^2', whereList: [{ term: 'E', definition: '能量' }, { term: 'm', definition: '质量' }] },
    { kind: 'formula', latex: 'a+b', numbered: false },
    { kind: 'note', content: [{ text: '带标记的注', marks: [mark('italic')] }] },
    { kind: 'example', content: '示例' },
  ]
}

const terms = (): unknown[] => [
  { kind: 'termEntry', term: '术语一', termEn: 'term one', definition: ['定义第一段', '定义第二段'], source: 'GB/T 1.1—2020，3.1', notes: ['术语注'], examples: ['术语例'] },
  { kind: 'termEntry', term: '术语二', definition: '定义' },
]

const clauseChain = (depth: number): unknown =>
  ({ kind: 'clause', title: `条${depth}`, children: ['正文', ...(depth > 1 ? [clauseChain(depth - 1)] : [])] })

/** 在编辑器 fixture 上一次写入全部可写节点种类，并创建引言、附录、参考文献等不存在的部分。 */
function buildRichDocument(): ApplyDocumentOperationsSuccess {
  return apply(fixture(), [
    { op: 'insert', parent: 'foreword', position: 'end', content: richBlocks('-fw') },
    { op: 'insert', parent: 'introduction', position: 'start', content: richBlocks('-intro') },
    { op: 'insert', parent: 'cl-formula', position: 'end', content: [clauseChain(4)] },
    { op: 'insert', parent: 'body', position: { after: 'ch-scope' }, content: [
      { kind: 'chapter', id: 'ch-terms', title: '术语和定义', children: ['引导语', ...terms()] },
    ] },
    { op: 'insert', parent: 'body', position: 'end', content: [
      { kind: 'chapter', id: 'ch-more', title: '补充要求', children: [clauseChain(5), { kind: 'clause', children: ['无题条'] }] },
    ] },
    { op: 'insert', parent: 'appendices', position: 'end', content: [
      { kind: 'appendix', id: 'app-n', title: '规范性附录', normative: true, children: [clauseChain(2)] },
      { kind: 'appendix', id: 'app-i', title: '资料性附录', children: richBlocks('-app') },
    ] },
    { op: 'insert', parent: 'bibliography', position: 'end', content: [
      'GB/T 1.1—2020 标准化工作导则', { kind: 'bibEntry', id: 'bib-b', content: [{ text: '书名', marks: [mark('italic')] }] },
    ] },
  ])
}

describe('引擎产生的文档通过编辑器生产 schema', () => {
  it('基线：服务端导出用的 fixture 本身通过 schema（其中容器与封面的 nodeId 为 null，由校验时的规范化补齐）', () => {
    expectValid(fixture(), false)
  })

  it('一次写入全部可写节点种类，创建引言/附录/参考文献：nodeFromJSON().check() 通过，nodeId 唯一，条标题层级同步', () => {
    const result = buildRichDocument()
    expectValid(result.doc)
    expectClauseTitleLevels(result.doc)
    const types = (result.doc.content ?? []).map(child => child.type)
    expect(types).toEqual([
      'coverPage', 'foreword', 'introduction', 'chapter', 'chapter', 'chapter', 'chapter', 'appendix', 'appendix', 'bibliography',
    ])
    expect(result.operations.map(effect => effect.createdContainer)).toEqual([undefined, 'introduction', undefined, undefined, undefined, undefined, 'bibliography'])
    // 引擎之外：IR 能读回，没有 IR 表达不了的内容，Resolver 对新增内容没有错误级新问题
    const { doc: ir } = pmToIr(result.doc)
    expect(ir.unsupportedContent).toBeUndefined()
    expect(resolve(ir).problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(ir.extensionVersion).toBe(1)
    expect(result.doc.attrs?.extensionVersion).toBe(1)
  })

  it('宿主校验的 nodeId 规范化生效：fixture 里没有 nodeId 的容器节点被补齐', () => {
    const result = apply(fixture(), [{ op: 'insert', parent: 'ch-scope', position: 'end', content: ['新段落'] }])
    const foreword = result.doc.content!.find(child => child.type === 'foreword')!
    expect(typeof foreword.attrs?.nodeId).toBe('string')
    expect((foreword.attrs?.nodeId as string).length).toBeGreaterThan(0)
    expectValid(result.doc)
  })

  it('结构树与编号', () => {
    const outline = buildOutline(buildRichDocument().doc)
    expect(outline.body.map(item => [item.number, item.title])).toEqual([
      ['1', '范围'], ['2', '术语和定义'], ['3', '技术要求'], ['4', '补充要求'],
    ])
    expect(outline.appendices.map(item => item.number)).toEqual(['附录A', '附录B'])
    expect(outline.bibliography).toEqual({ present: true, entryCount: 2 })
    expect(outline.introduction.present).toBe(true)
  })
})

describe('后续操作产生的文档同样通过 schema', () => {
  const base = buildRichDocument().doc

  it('删除使前言、引言、参考文献变空：容器被移除，文档仍然合法', () => {
    const forewordIds = readIds(base, 'foreword')
    const introIds = readIds(base, 'introduction')
    const bibIds = readIds(base, 'bibliography')
    const result = apply(base, [
      ...forewordIds.map(nodeId => ({ op: 'delete', nodeId }) as const),
      ...introIds.map(nodeId => ({ op: 'delete', nodeId }) as const),
      ...bibIds.map(nodeId => ({ op: 'delete', nodeId }) as const),
    ])
    expectValid(result.doc)
    const types = (result.doc.content ?? []).map(child => child.type)
    expect(types).not.toContain('foreword')
    expect(types).not.toContain('introduction')
    expect(types).not.toContain('bibliography')
    expect(result.operations.flatMap(effect => effect.removedContainer ?? [])).toEqual(['foreword', 'introduction', 'bibliography'])
    // 再次创建，位置正确
    const again = apply(result.doc, [
      { op: 'insert', parent: 'bibliography', position: 'end', content: ['新文献'] },
      { op: 'insert', parent: 'foreword', position: 'end', content: ['新前言'] },
    ])
    expectValid(again.doc)
    expect((again.doc.content ?? []).map(child => child.type)).toEqual([
      'coverPage', 'foreword', 'chapter', 'chapter', 'chapter', 'chapter', 'appendix', 'appendix', 'bibliography',
    ])
  })

  it('移动条改变层级：自身与子条的条属性、条标题层级一起变化，文档合法；超过 5 级的移动被拒绝', () => {
    // 写入 cl-formula 下的 4 层条链：2、3、4、5 级
    const chainTop = findPm(base, 'cl-formula')!.content!.filter(child => child.type === 'clause').at(-1)!
    const chainId = chainTop.attrs!.nodeId as string
    expect(chainTop.attrs?.level).toBe(2)
    const up = apply(base, [{ op: 'move', nodeId: chainId, parent: 'ch-more', position: 'start' }])
    expectValid(up.doc)
    expectClauseTitleLevels(up.doc)
    expect(findPm(up.doc, chainId)!.attrs?.level).toBe(1)
    expect(up.operations[0]!.levelChanged).toHaveLength(4)
    // 再移回 cl-formula 下：回到 2 级，子条回到 3~5 级
    const down = apply(up.doc, [{ op: 'move', nodeId: chainId, parent: 'cl-formula', position: 'end' }])
    expectValid(down.doc)
    expectClauseTitleLevels(down.doc)
    expect(findPm(down.doc, chainId)!.attrs?.level).toBe(2)
    // 5 层的条链放到 2 级条下会超过 5 级
    const deep = findPm(base, 'ch-more')!.content!.find(child => child.type === 'clause')!.attrs!.nodeId as string
    const rejected = applyDocumentOperations(base, [{ op: 'move', nodeId: deep, parent: 'cl-formula', position: 'start' }], { validateContent })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.issues[0]).toMatchObject({ code: 'level-overflow' })
  })

  it('跨容器移动块、移动章与附录、替换、删除组合，文档合法', () => {
    const forewordFirst = readIds(base, 'foreword')[0]!
    const result = apply(base, [
      { op: 'move', nodeId: forewordFirst, parent: 'introduction', position: 'end' },
      { op: 'move', nodeId: 'ch-more', parent: 'body', position: 'start' },
      { op: 'move', nodeId: 'app-i', parent: 'appendices', position: 'start' },
      { op: 'replace', nodeId: 'cl-table', content: [{ kind: 'clause', title: '重写的表条', children: ['说明'] }] },
      { op: 'delete', nodeId: 'ch-terms' },
    ])
    expectValid(result.doc)
    expectClauseTitleLevels(result.doc)
    expect((result.doc.content ?? []).map(child => child.attrs?.nodeId).filter(Boolean).slice(0, 4)).toContain('ch-more')
  })

  it('宿主校验拒绝不合法的文档：问题带 schema 的原因', () => {
    const broken: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c', secType: 'general' }, content: [{ type: 'stdParagraph', attrs: { nodeId: 'p' } }] }] }
    const result = applyDocumentOperations(broken, [{ op: 'insert', parent: 'c', position: 'end', content: ['x'] }], { validateContent })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]).toMatchObject({ code: 'schema-invalid', path: 'document' })
  })

  it('未注入校验时，引擎写入的片段本身也通过 schema（对照：同一批操作注入校验后同样成功）', () => {
    const operations: DocumentOperation[] = [{ op: 'insert', parent: 'ch-scope', position: 'end', content: richBlocks('-x') }]
    const without = applyDocumentOperations(fixture(), operations, { generateId: sequentialIds() })
    const withValidator = applyDocumentOperations(fixture(), operations, { generateId: sequentialIds(), validateContent })
    expect(without.ok && withValidator.ok).toBe(true)
    // 未注入校验时，写入的片段本身也是 schema 合法的（只是 fixture 里原本为 null 的 nodeId 没有被补齐）
    if (without.ok) expectValid(without.doc, false)
  })
})

describe('读回原样替换：编辑器 schema 规范形态下文档不变', () => {
  /** 与 irToPm 一致的术语条目尾项顺序（来源、注、示例），见 io 的 roundTrip.test.ts 对登记差异的说明。 */
  function normalizeTerms(node: PMJsonNode): PMJsonNode {
    const rank = (child: PMJsonNode): number =>
      ({ termName: 0, termNameEn: 1, termDefinition: 2, stdParagraph: 3, termSource: 4, note: 5, example: 6 } as Record<string, number>)[child.type] ?? 9
    const children = (node.content ?? []).map(normalizeTerms)
    if (node.type !== 'termDef') return node.content ? { ...node, content: children } : node
    return {
      ...node,
      content: [...children].sort((a, b) => rank(a) - rank(b)).map(child =>
        child.type === 'termDefinition' && !child.attrs?.nodeId
          ? { ...child, attrs: { ...child.attrs, nodeId: `${String(node.attrs?.nodeId)}.def0` } } : child),
    }
  }

  const cases: { name: string; document: () => PMJsonNode }[] = [
    { name: '服务端导出用的编辑器 fixture', document: () => canonical(fixture()) },
    { name: '引擎写入全部节点种类后的文档', document: () => buildRichDocument().doc },
  ]

  for (const { name, document } of cases) {
    it(`${name}：每个可替换节点 readNode → replace 后，节点在 schema 规范形态下逐字段相同`, () => {
      const source = document()
      const originalIr = pmToIr(source).doc
      const addressable: string[] = []
      const collect = (node: PMJsonNode, inside: boolean): void => {
        const id = node.attrs?.nodeId
        const kinds = ['chapter', 'appendix', 'clause', 'termDef', 'bibEntry', 'stdParagraph', 'stdList', 'stdTable', 'figure', 'formula', 'note', 'example']
        if (typeof id === 'string' && kinds.includes(node.type) && !inside) addressable.push(id)
        const nextInside = inside || ['stdTable', 'stdList', 'termDef', 'figure', 'formula', 'note', 'example', 'stdParagraph', 'bibEntry'].includes(node.type)
        for (const child of node.content ?? []) collect(child, nextInside)
      }
      collect(source, false)
      expect(addressable.length).toBeGreaterThan(10)

      let replaced = 0
      for (const id of addressable) {
        const read = readNode(source, id)
        if (!read.ok) throw new Error(read.reason)
        if (!read.node.replaceable) continue
        const result = apply(source, [{ op: 'replace', nodeId: id, content: [read.node.ir] }])
        expect(pmToIr(result.doc).doc, id).toEqual(originalIr)
        expect(result.warnings, id).toEqual([])
        expect(findPm(result.doc, id), id).toEqual(normalizeTerms(findPm(canonical(source), id)!))
        replaced += 1
      }
      expect(replaced).toBeGreaterThan(addressable.length / 2)
    })
  }

  it('fixture 里含脚注的段落与章被标为不可替换', () => {
    const source = canonical(fixture())
    for (const id of ['scope-p', 'ch-scope']) {
      const read = readNode(source, id)
      expect(read.ok && read.node.replaceable, id).toBe(false)
    }
    expect(readNode(source, 'f-frac')).toMatchObject({ ok: true, node: { replaceable: true, number: '(1)' } })
  })
})

function findPm(pm: PMJsonNode, id: string): PMJsonNode | undefined {
  if (pm.attrs?.nodeId === id) return pm
  for (const child of pm.content ?? []) {
    const found = findPm(child, id)
    if (found) return found
  }
  return undefined
}

/** 容器（前言/引言/参考文献）里各节点的 id。 */
function readIds(pm: PMJsonNode, container: 'foreword' | 'introduction' | 'bibliography'): string[] {
  const node = pm.content!.find(child => child.type === container)!
  return (node.content ?? []).map(child => child.attrs?.nodeId).filter((id): id is string => typeof id === 'string')
}
