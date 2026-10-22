// @vitest-environment happy-dom
import { Editor, getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer, Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { irToPm, pmToIr, resolve, type IRClause, type IRList, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { NODE_ID_TYPES, remapPastedSliceIds } from './plugins/ensureNodeId'
import { createWp8mG4Fixture, WP8M_G4_EXPECTED_LABELS } from './__fixtures__/wp8m-g4'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { replaceEditorDocument } from '../utils/editorDocument'

const schema = getSchema(createEditorExtensions())

function visit(node: PMJsonNode, fn: (node: PMJsonNode) => void): void {
  fn(node)
  node.content?.forEach(child => visit(child, fn))
}

/** 文档里全部 crossRef mark 的 attrs（按出现顺序） */
function crossRefs(root: PMJsonNode): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  visit(root, node => { for (const mark of node.marks ?? []) if (mark.type === 'crossRef') found.push({ ...mark.attrs }) })
  return found
}

function nodesOfType(root: PMJsonNode, type: string): PMJsonNode[] {
  const found: PMJsonNode[] = []
  visit(root, node => { if (node.type === type) found.push(node) })
  return found
}

function roundtripHtml(json: object, passes = 2) {
  let current: object = json
  let html = ''
  let reopened = schema.nodeFromJSON(current)
  for (let pass = 0; pass < passes; pass += 1) {
    const source = schema.nodeFromJSON(current)
    source.check()
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
    html = container.innerHTML
    const input = document.createElement('div')
    input.innerHTML = html
    reopened = DOMParser.fromSchema(schema).parse(input)
    reopened.check()
    current = reopened.toJSON()
  }
  return { html, reopened }
}

const errorsOf = (doc: ReturnType<typeof pmToIr>['doc']) => resolve(doc).problems.filter(problem => problem.severity === 'error')

afterEach(() => { document.body.replaceChildren() })

describe('[M-10.1.5-01] [M-10.1.5-02] G4 Schema：零变化，refType=listItem 与 stdListItem 目标可存', () => {
  it('夹具通过 Schema 校验；crossRef 的 refType=listItem、targetId 指向 stdListItem 的 nodeId 原样保存', () => {
    const fixture = createWp8mG4Fixture()
    const root = schema.nodeFromJSON(fixture)
    root.check()
    const json = root.toJSON() as PMJsonNode
    expect(crossRefs(json)).toEqual([
      expect.objectContaining({ targetId: 'g4-a3', refType: 'listItem' }),
      expect.objectContaining({ targetId: 'g4-n2', refType: 'listItem' }),
    ])
    const itemIds = new Set(nodesOfType(json, 'stdListItem').map(node => node.attrs?.nodeId))
    expect(itemIds.has('g4-a3') && itemIds.has('g4-n2')).toBe(true)
  })

  it('stdListItem 已在 NODE_ID_TYPES 内（列项是稳定锚点），本组不新增任何 PM 节点或 mark', () => {
    expect(NODE_ID_TYPES).toContain('stdListItem')
    expect(Object.keys(schema.nodes)).not.toContain('listItemRef')
    expect(schema.marks.crossRef).toBeDefined()
    expect(schema.marks.crossRef!.spec.attrs).toHaveProperty('refType')
  })

  it('非法组合仍被拒：stdListItem 不能脱离 stdList 直接放进章里', () => {
    const fixture = createWp8mG4Fixture()
    const chapter = fixture.content![0]!
    chapter.content!.push({ type: 'stdListItem', attrs: { nodeId: 'orphan' }, content: [] })
    expect(() => schema.nodeFromJSON(fixture).check()).toThrow()
  })
})

describe('[M-10.1.5-01] [M-10.1.5-02] G4 往返：PM → IR → PM', () => {
  it('pmToIr 无告警；crossRef 映射为 targetKind=listItem；Resolver 无错误且标签符合设计', () => {
    const { doc, warnings } = pmToIr(createWp8mG4Fixture())
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    const clause = doc.body[0]!.children[0] as IRClause
    const reference = clause.children[0]
    expect(reference?.kind === 'paragraph' && reference.content.flatMap(run => run.marks ?? [])).toEqual([
      { type: 'crossRef', targetId: 'g4-a3', targetKind: 'listItem' },
      { type: 'crossRef', targetId: 'g4-n2', targetKind: 'listItem' },
    ])
    const lists = clause.children.filter((child): child is IRList => child.kind === 'list')
    expect(lists.map(list => [list.id, list.listType])).toEqual([['g4-l-alpha', 'alpha'], ['g4-l-number', 'number'], ['g4-l-dash', 'dash']])
    const resolved = resolve(doc)
    expect(errorsOf(doc)).toEqual([])
    expect(resolved.labels['g4-a3']).toEqual(WP8M_G4_EXPECTED_LABELS['g4-a3'])
    expect(resolved.labels['g4-n2']).toEqual(WP8M_G4_EXPECTED_LABELS['g4-n2'])
    // 未被引用者无标签
    for (const id of ['g4-a1', 'g4-a2', 'g4-n1', 'g4-d1', 'g4-d2', 'g4-l-alpha']) expect(resolved.labels[id], id).toBeUndefined()
  })

  it('PM → IR → PM 逐属性相等，再经 JSON 冷重开后 IR 深度相等', () => {
    const original = schema.nodeFromJSON(createWp8mG4Fixture())
    original.check()
    const first = pmToIr(original.toJSON() as PMJsonNode)
    const emitted = irToPm(first.doc)
    const projected = schema.nodeFromJSON(emitted)
    projected.check()
    const before = original.toJSON() as PMJsonNode
    const after = projected.toJSON() as PMJsonNode
    expect(crossRefs(after)).toEqual(crossRefs(before))
    for (const type of ['stdList', 'stdListItem']) {
      expect(nodesOfType(after, type).map(node => node.attrs), type).toEqual(nodesOfType(before, type).map(node => node.attrs))
    }
    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(after)) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(first.doc)
  })

  it('旧稿形态：无类型引用（refType 空串）仍映射为无类型，同样触发列项标签', () => {
    const fixture = createWp8mG4Fixture({ refContent: [{ type: 'text', text: '见丙', marks: [{ type: 'crossRef', attrs: { targetId: 'g4-a3', refType: '' } }] }] })
    const { doc, warnings } = pmToIr(fixture)
    expect(warnings).toEqual([])
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['g4-a3']).toEqual(WP8M_G4_EXPECTED_LABELS['g4-a3'])
  })

  it('引用无序列项（g4-d2）：Resolver 报 dangling-xref，且没有 ext_ 占位标签', () => {
    const fixture = createWp8mG4Fixture({ refContent: [{ type: 'text', text: '见二', marks: [{ type: 'crossRef', attrs: { targetId: 'g4-d2', refType: 'listItem' } }] }] })
    const { labels, problems } = resolve(pmToIr(fixture).doc)
    expect(problems.filter(problem => problem.code === 'dangling-xref')).toHaveLength(1)
    expect(labels['g4-d2']).toBeUndefined()
  })
})

describe('[M-10.1.5-01] [M-10.1.5-02] G4 HTML 往返（DOMSerializer / DOMParser 两轮）', () => {
  it('节点类型、nodeId、列表属性与 crossRef 属性不变', () => {
    const fixture = createWp8mG4Fixture()
    const { html, reopened } = roundtripHtml(fixture)
    expect(html).toContain('data-type="cross-ref"')
    const json = reopened.toJSON() as PMJsonNode
    const expected = schema.nodeFromJSON(fixture).toJSON() as PMJsonNode
    expect(crossRefs(json)).toEqual(crossRefs(expected))
    expect(nodesOfType(json, 'stdListItem').map(node => node.attrs?.nodeId)).toEqual(['g4-a1', 'g4-a2', 'g4-a3', 'g4-n1', 'g4-n2', 'g4-d1', 'g4-d2'])
    expect(nodesOfType(json, 'stdList').map(node => [node.attrs?.nodeId, node.attrs?.listType, node.attrs?.level])).toEqual([
      ['g4-l-alpha', 'alpha', 1], ['g4-l-number', 'numeric', 2], ['g4-l-dash', 'dash', 1],
    ])
    expect(pmToIr(json).doc).toEqual(pmToIr(expected).doc)
  })
})

describe('[M-10.1.5-01] [M-10.1.5-02] G4 保存重开（Editor + replaceEditorDocument + exportSemanticJson）', () => {
  function open(content: PMJsonNode): Editor {
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({ element, extensions: createEditorExtensions(), content: '<p></p>' })
    expect(replaceEditorDocument(editor, content as unknown as Record<string, unknown>)).toBe(true)
    return editor
  }

  it('加载后导出，再把编辑器 JSON 冷重开并导出，两次语义 JSON 相等；IR 与标签不变', () => {
    const first = open(createWp8mG4Fixture())
    try {
      const exported = exportSemanticJson(first.state.doc)
      const saved = JSON.parse(JSON.stringify(first.getJSON())) as PMJsonNode
      const second = open(saved)
      try {
        expect(exportSemanticJson(second.state.doc)).toEqual(exported)
        expect(pmToIr(second.getJSON() as PMJsonNode).doc).toEqual(pmToIr(first.getJSON() as PMJsonNode).doc)
        expect(crossRefs(second.getJSON() as PMJsonNode)).toEqual([
          expect.objectContaining({ targetId: 'g4-a3', refType: 'listItem' }),
          expect.objectContaining({ targetId: 'g4-n2', refType: 'listItem' }),
        ])
        const labels = resolve(pmToIr(second.getJSON() as PMJsonNode).doc).labels
        expect(labels['g4-a3']).toEqual(WP8M_G4_EXPECTED_LABELS['g4-a3'])
      } finally {
        second.destroy()
      }
    } finally {
      first.destroy()
    }
  })

  it('语义 JSON 不为列项增加编号字段：被引用与未被引用的列项节点形状一致，引用 mark 带 refType', () => {
    const editor = open(createWp8mG4Fixture())
    try {
      const exported = JSON.parse(JSON.stringify(exportSemanticJson(editor.state.doc))) as PMJsonNode
      const items = nodesOfType(exported, 'stdListItem')
      expect(items.map(node => Object.keys(node).sort())).toEqual(items.map(() => ['attrs', 'content', 'type']))
      expect(crossRefs(exported).map(attrs => attrs.refType)).toEqual(['listItem', 'listItem'])
    } finally {
      editor.destroy()
    }
  })

  it('编辑器挂载的 DOM：引用渲染为指向列项 nodeId 的交叉引用链接', () => {
    const editor = open(createWp8mG4Fixture())
    try {
      const links = [...editor.view.dom.querySelectorAll('a[data-type="cross-ref"]')]
      expect(links.map(link => link.getAttribute('href'))).toEqual(['#g4-a3', '#g4-n2'])
      expect(links.every(link => link.classList.contains('std-cross-ref'))).toBe(true)
    } finally {
      editor.destroy()
    }
  })
})

describe('[M-10.1.5-02] G4 粘贴重映射：对 stdListItem 目标同样生效', () => {
  const brokenCodes = ['duplicate-id', 'dangling-xref', 'dangling-typed-ref']

  it('remapPastedSliceIds：整章复制到同一文档时，副本里的列项换新 id，副本内的引用跟随副本，refType 保持 listItem', () => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: createWp8mG4Fixture() })
    try {
      const source = editor.state.doc.child(0)
      const slice = remapPastedSliceIds(new Slice(Fragment.from(source), 0, 0), editor.state.doc)
      const copied = slice.content.child(0).toJSON() as PMJsonNode
      const copiedItems = nodesOfType(copied, 'stdListItem').map(node => String(node.attrs?.nodeId))
      expect(copiedItems).toHaveLength(7)
      expect(copiedItems.some(id => id.startsWith('g4-'))).toBe(false)
      const refs = crossRefs(copied)
      expect(refs.map(attrs => attrs.refType)).toEqual(['listItem', 'listItem'])
      // 副本引用指向副本中对应位置（第 3 个字母项、第 2 个数字项）的新 id
      expect(refs.map(attrs => attrs.targetId)).toEqual([copiedItems[2], copiedItems[4]])
      // 原文档不被改动
      expect(crossRefs(editor.getJSON() as PMJsonNode).map(attrs => attrs.targetId)).toEqual(['g4-a3', 'g4-n2'])
    } finally {
      editor.destroy()
    }
  })

  it('production view.pasteHTML：副本与原件各自带标签，li_ 编号按文档序，无重复 id、无悬空引用', () => {
    const base = createWp8mG4Fixture()
    base.content!.push({
      type: 'chapter', attrs: { nodeId: 'g4-slot' }, content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '插入槽' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'g4-slot-p' }, content: [{ type: 'text', text: '替换' }] },
      ],
    })
    const editor = new Editor({ extensions: createEditorExtensions(), content: base })
    try {
      const wrapper = document.createElement('div')
      wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.from(editor.state.doc.child(0))))
      let slot = -1
      editor.state.doc.descendants((node, pos) => { if (node.attrs.nodeId === 'g4-slot') slot = pos })
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, slot)))
      editor.view.pasteHTML(wrapper.innerHTML)

      const json = editor.getJSON() as PMJsonNode
      const ids = nodesOfType(json, 'stdListItem').map(node => String(node.attrs?.nodeId))
      expect(ids).toHaveLength(14)
      expect(new Set(ids).size).toBe(14)
      expect(ids.slice(0, 7)).toEqual(['g4-a1', 'g4-a2', 'g4-a3', 'g4-n1', 'g4-n2', 'g4-d1', 'g4-d2'])
      const refs = crossRefs(json)
      expect(refs.map(attrs => attrs.targetId)).toEqual(['g4-a3', 'g4-n2', ids[9], ids[11]])
      const { doc, unsupportedContent } = { doc: pmToIr(json).doc, unsupportedContent: pmToIr(json).doc.unsupportedContent ?? [] }
      expect(unsupportedContent).toEqual([])
      const { labels, problems } = resolve(doc)
      expect(problems.filter(problem => brokenCodes.includes(problem.code))).toEqual([])
      expect(['g4-a3', 'g4-n2', ids[9], ids[11]].map(id => labels[id]?.xmlId)).toEqual(['li_1', 'li_2', 'li_3', 'li_4'])
      expect(labels[ids[9]!]?.refText).toBe('2.1 c)')
    } finally {
      editor.destroy()
    }
  })
})
