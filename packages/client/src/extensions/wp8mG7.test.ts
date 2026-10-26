// @vitest-environment happy-dom
/**
 * WP8.M G7：罗马列项（M-5.7-04）与注/示例的块内容（M-5.6-05）
 * （docs/wp8.m/design.md §3.6、§4.7；约定 C-S-31、C-S-32；§7.1 D-M-05、D-M-06）。
 *
 * 每个小节的四类用例：Schema、往返（PM→IR→PM）、HTML 往返、保存重开（Editor + replaceEditorDocument +
 * exportSemanticJson）；外加输出边界（HTML/DOCX/XML/XML46687）与显示（编辑器 DOM、CSS、守卫）。
 */

import { getSchema } from '@tiptap/core'
import { Editor } from '@tiptap/vue-3'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Fragment, Slice } from '@tiptap/pm/model'
import {
  IRToPmError, UnsupportedOutputError, getOutputSupportProblems, irToPm, pmToIr, resolve,
  type IRBlock, type IRList, type IRNote, type PMJsonNode,
} from '@ses/shared'
import { docToText } from '../utils/docDiff'
import { replaceEditorDocument } from '../utils/editorDocument'
import { setClauseFormat, setListFormat, setParagraphFormat } from '../utils/structureEditing'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { serializeToXml } from '../serializer/xmlSerializer'
import { createEditorExtensions } from './editorExtensions'
import { canInsertBodyFootnote } from './nodes/footnotes'
import { normalizeStdListType } from './nodes/std-list'
import { NODE_ID_TYPES, remapPastedSliceIds } from './plugins/ensureNodeId'
import { createG7NoteFixture, createG7RomanFixture, WP8M_G7_NOTE_LABELS, WP8M_G7_ROMAN_LABELS } from './__fixtures__/wp8m-g7'

const extensions = createEditorExtensions()
const schema = getSchema(extensions)

function visit(node: PMJsonNode, fn: (node: PMJsonNode) => void): void {
  fn(node)
  node.content?.forEach(child => visit(child, fn))
}

function byId(root: PMJsonNode): Map<string, PMJsonNode> {
  const result = new Map<string, PMJsonNode>()
  visit(root, node => { if (typeof node.attrs?.nodeId === 'string') result.set(node.attrs.nodeId, node) })
  return result
}

function nodesOfType(root: PMJsonNode, type: string): PMJsonNode[] {
  const found: PMJsonNode[] = []
  visit(root, node => { if (node.type === type) found.push(node) })
  return found
}

function roundtripHtml(json: PMJsonNode, passes = 2) {
  let current: PMJsonNode = json
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
    current = reopened.toJSON() as PMJsonNode
  }
  return { html, reopened, current }
}

function mountedEditor(content?: PMJsonNode): Editor {
  const editor = new Editor({ extensions, content: content ?? '<p></p>' })
  editor.mount(document.createElement('div'))
  return editor
}

/** 把选区放进指定 nodeId 的文本块里（空文本块也可以）。 */
function selectInside(editor: Editor, nodeId: string): void {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.attrs.nodeId === nodeId) found = pos
  })
  if (found < 0) throw new Error(`找不到节点 ${nodeId}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found + 1)))
}

const errorsOf = (doc: ReturnType<typeof pmToIr>['doc']) => resolve(doc).problems.filter(problem => problem.severity === 'error')

// ---------------------------------------------------------------------------------------------------------------------
// M-5.7-04 罗马列项
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-5.7-04] 生产 Schema：stdList 支持 listType=roman', () => {
  it('夹具通过 Schema 校验；roman 列表保留类型与一级 level，不再被归一化为 numeric', () => {
    const root = schema.nodeFromJSON(createG7RomanFixture())
    expect(() => root.check()).not.toThrow()
    const lists = nodesOfType(root.toJSON() as PMJsonNode, 'stdList')
    expect(lists.map(list => [list.attrs?.listType, list.attrs?.level])).toEqual([['roman', 1], ['roman', 1], ['alpha', 1]])
  })

  it('normalizeStdListType：roman 保留；romanUpper（46687.2 没有取值）降级为 numeric；未知值回退 dash', () => {
    expect(normalizeStdListType('roman')).toBe('roman')
    expect(normalizeStdListType('romanUpper')).toBe('numeric')
    expect(normalizeStdListType('fancy')).toBe('dash')
  })

  it('stdList 仍要求至少一个列项，且只接受 stdListItem', () => {
    const bad = createG7RomanFixture()
    const list = nodesOfType(bad, 'stdList')[0]!
    list.content = []
    expect(() => schema.nodeFromJSON(bad).check()).toThrow()
    list.content = [{ type: 'stdParagraph', attrs: { nodeId: 'x' }, content: [{ type: 'text', text: 'x' }] }]
    expect(() => schema.nodeFromJSON(bad).check()).toThrow()
  })
})

describe('[M-5.7-04] 往返：生产 PM → pmToIr → Resolver → irToPm → 生产 PM', () => {
  const original = schema.nodeFromJSON(createG7RomanFixture())
  original.check()
  const originalJson = original.toJSON() as PMJsonNode

  it('pmToIr：无 warning、无 unsupportedContent；列表类型为 roman，extensionVersion 为 1；Resolver 无 error', () => {
    const { doc, warnings } = pmToIr(originalJson)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.extensionVersion).toBe(1)
    const clause = doc.body[0]!.children[0]!
    expect(clause.kind).toBe('clause')
    const lists = (clause.kind === 'clause' ? clause.children : []).filter((child): child is IRList => child.kind === 'list')
    expect(lists.map(list => list.listType)).toEqual(['roman', 'roman', 'alpha'])
    expect(lists[0]!.level).toBeUndefined() // 罗马列项是一级（与字母列项相同），不写 level
    expect(errorsOf(doc)).toEqual([])
  })

  it('Resolver：被引用的罗马列项得到 i）…形式的标签（G4 的 gbT11Strategy.listItem），每个列表重新起编；未被引用的没有标签', () => {
    const { labels } = resolve(pmToIr(originalJson).doc)
    for (const [id, expected] of Object.entries(WP8M_G7_ROMAN_LABELS)) expect(labels[id], id).toMatchObject(expected)
    for (const id of ['g7-r1', 'g7-r2', 'g7-r4', 'g7-s1']) expect(labels[id], id).toBeUndefined()
  })

  it('irToPm 后 Schema 校验通过，与原文档逐节点相同；经 JSON 冷重开、再次 pmToIr 后 IR 深度相等', () => {
    const first = pmToIr(originalJson).doc
    const roundtrip = schema.nodeFromJSON(irToPm(first))
    roundtrip.check()
    const before = byId(originalJson)
    const after = byId(roundtrip.toJSON() as PMJsonNode)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [id, record] of before) {
      for (const [key, value] of Object.entries(record.attrs ?? {})) {
        if (value !== null && value !== undefined) expect(after.get(id)?.attrs?.[key], `${id}.${key}`).toEqual(value)
      }
    }
    expect(roundtrip.toJSON()).toEqual(originalJson)
    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(roundtrip.toJSON())) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(first)
  })

  it('不含罗马列项的文档往返后不出现 extensionVersion（旧文档不被误标）', () => {
    const legacy: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'ch', secType: 'general' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
      { type: 'stdList', attrs: { nodeId: 'l', listType: 'alpha', level: 1 }, content: [{ type: 'stdListItem', attrs: { nodeId: 'i' }, content: [{ type: 'text', text: '项' }] }] },
    ] }] }
    const ir = pmToIr(legacy).doc
    expect(ir.extensionVersion).toBeUndefined()
    expect(irToPm(ir).attrs).toBeUndefined()
  })

  it('旧文档里残留的 romanUpper：pmToIr 降级为数字列项并保留 1 条警告（行为不变）；irToPm 拒绝大写罗马', () => {
    const legacy = createG7RomanFixture()
    nodesOfType(legacy, 'stdList')[2]!.attrs!.listType = 'romanUpper'
    const { doc, warnings } = pmToIr(legacy)
    expect(warnings.filter(warning => warning.includes('旧罗马列项类型'))).toHaveLength(1)
    const clause = doc.body[0]!.children[0]!
    const lists = (clause.kind === 'clause' ? clause.children : []).filter((child): child is IRList => child.kind === 'list')
    expect(lists.map(list => list.listType)).toEqual(['roman', 'roman', 'number'])
    const native: IRBlock = { kind: 'list', id: 'up', listType: 'romanUpper', items: [{ id: 'up-i', content: [{ kind: 'paragraph', id: 'up-i.p0', content: [{ text: 'x' }] }] }] }
    let caught: unknown
    try { irToPm({ ...doc, body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [native] }] }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    expect((caught as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][0].listType', nodeId: 'up', reason: expect.stringContaining('不支持'),
    }))
  })
})

describe('[M-5.7-04] HTML 往返：DOMSerializer / DOMParser 两轮后类型与 nodeId 不变', () => {
  it('roman 列表序列化为 div[data-type=std-list][data-list-type=roman].std-list-roman，重新解析仍是 roman（不降级为 numeric）', () => {
    const fixture = schema.nodeFromJSON(createG7RomanFixture()).toJSON() as PMJsonNode
    const { html, current } = roundtripHtml(fixture)
    const rendered = document.createElement('div')
    rendered.innerHTML = html
    const romanLists = rendered.querySelectorAll('div[data-type="std-list"][data-list-type="roman"]')
    expect(romanLists).toHaveLength(2)
    for (const element of romanLists) {
      expect(element.classList.contains('std-list-roman')).toBe(true)
      expect(element.getAttribute('data-level')).toBe('1')
    }
    const after = byId(current)
    expect(after.get('g7-l-roman')?.attrs).toMatchObject({ listType: 'roman', level: 1 })
    expect(after.get('g7-l-roman2')?.attrs).toMatchObject({ listType: 'roman', level: 1 })
    expect(after.get('g7-l-alpha')?.attrs).toMatchObject({ listType: 'alpha', level: 1 })
    for (const id of ['g7-r1', 'g7-r2', 'g7-r3', 'g7-r4', 'g7-s1', 'g7-s2']) expect(after.get(id)?.attrs?.nodeId, id).toBe(id)
    // 根节点属性（extensionVersion）不随 HTML 片段走，由加载入口按内容重新判定；比较文档内容
    expect(current.content).toEqual(fixture.content)
  })
})

describe('[M-5.7-04] 保存重开：Editor + replaceEditorDocument + exportSemanticJson', () => {
  it('加载 → 导出语义 JSON → 再加载 → 再导出：JSON 相等；罗马列表类型保存为 roman', () => {
    const editor = mountedEditor()
    expect(replaceEditorDocument(editor, createG7RomanFixture() as unknown as Record<string, unknown>)).toBe(true)
    expect(editor.getJSON().attrs).toMatchObject({ extensionVersion: 1 })
    const firstSave = editor.getJSON() as PMJsonNode
    expect(nodesOfType(firstSave, 'stdList').map(list => list.attrs?.listType)).toEqual(['roman', 'roman', 'alpha'])
    const firstExport = exportSemanticJson(editor.state.doc)

    const reopened = mountedEditor()
    replaceEditorDocument(reopened, JSON.parse(JSON.stringify(firstSave)) as Record<string, unknown>)
    expect(reopened.getJSON()).toEqual(firstSave)
    expect(exportSemanticJson(reopened.state.doc)).toEqual(firstExport)
    for (const target of [editor, reopened]) target.destroy()
  })

  it('旧版保存的 roman 列表（此前被当作数字列项）重新加载后按罗马列项显示：加载入口不再把它改写为 numeric', () => {
    const legacySaved = createG7RomanFixture()
    const editor = mountedEditor()
    replaceEditorDocument(editor, JSON.parse(JSON.stringify(legacySaved)) as Record<string, unknown>)
    const html = editor.getHTML()
    expect(html).toContain('data-list-type="roman"')
    expect(html).not.toContain('std-list-numeric')
    editor.destroy()
  })
})

describe('[M-5.7-04] 输出边界：HTML、DOCX、XML46687 放行罗马列项；旧 XML 阻断（旧序列化器会把 i) 降为 1)）', () => {
  const { doc } = pmToIr(schema.nodeFromJSON(createG7RomanFixture()).toJSON() as PMJsonNode)

  it.each(['HTML', 'DOCX', 'XML46687'] as const)('%s：没有 unsupported-output', format => {
    expect(getOutputSupportProblems(doc, format)).toEqual([])
  })

  it('XML：两个罗马列表各一条 unsupported-output（路径指向 listType），字母列表不受影响', () => {
    const problems = getOutputSupportProblems(doc, 'XML')
    expect(problems.map(problem => [problem.nodeId, problem.path.endsWith('.listType')])).toEqual([['g7-l-roman', true], ['g7-l-roman2', true]])
    expect(problems[0]!.message).toContain('阿拉伯数字')
  })

  it('旧 XML 序列化器（serializeToXml）对含罗马列项的文档报 UnsupportedOutputError，不再静默导出为数字列项', () => {
    let caught: unknown
    try { serializeToXml(schema.nodeFromJSON(createG7RomanFixture())) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(UnsupportedOutputError)
    expect((caught as UnsupportedOutputError).problems.map(problem => problem.nodeId)).toEqual(['g7-l-roman', 'g7-l-roman2'])
  })
})

describe('[M-5.7-04] 显示：编辑器 DOM 与样式', () => {
  // happy-dom 环境下 import.meta.url 不是 file: URL，按 vitest 的工作目录（packages/client）读取样式表
  const css = readFileSync(resolvePath(process.cwd(), 'src/styles/standard-nodes.css'), 'utf8')

  it('编辑器 DOM：罗马列表带 std-list-roman，列项数量与顺序正确', () => {
    const editor = mountedEditor(createG7RomanFixture())
    const lists = [...editor.view.dom.querySelectorAll<HTMLElement>('.std-list-roman')]
    expect(lists.map(list => list.dataset.nodeId)).toEqual(['g7-l-roman', 'g7-l-roman2'])
    expect(lists.map(list => list.querySelectorAll('.std-list-item').length)).toEqual([4, 2])
    expect(editor.view.dom.querySelectorAll('.std-list-numeric')).toHaveLength(0)
    editor.destroy()
  })

  it('样式：.std-list-roman 用自己的计数器与 lower-roman，每个列表重新起编；roman 不再共用数字计数器', () => {
    expect(css).toMatch(/\.std-list-roman \{\s*counter-reset: roman-counter;\s*\}/)
    expect(css).toMatch(/\.std-list-roman \.std-list-item \{\s*counter-increment: roman-counter;\s*\}/)
    expect(css).toMatch(/\.std-list-roman \.std-list-item::before \{\s*content: counter\(roman-counter, lower-roman\) '） ';\s*\}/)
  })
})

describe('[M-5.7-04][M-10.1.5-01] 与 G4 列项守卫衔接：罗马列项的被引用项不得因格式命令失去编号', () => {
  it('把含被引用项的罗马列项改成无序类型：拒绝（referenced-block），文档不变；改成字母/数字等有序类型：成功', () => {
    const editor = mountedEditor(createG7RomanFixture())
    // 编辑器会在文档末尾补一个空 paragraph（trailing node），只比较章的子树
    const chapterJson = () => JSON.stringify(byId(editor.getJSON() as PMJsonNode).get('g7-ch1'))
    const before = chapterJson()
    selectInside(editor, 'g7-r3')
    expect(setListFormat(editor, 'dash')).toEqual({ ok: false, reason: 'referenced-block' })
    expect(chapterJson()).toBe(before)

    // 选区在第 3 项：只有该项变成字母列表，前后部分保持罗马列表；被引用项 g7-r3 的 nodeId 不变，仍有编号
    expect(setListFormat(editor, 'alpha')).toEqual({ ok: true })
    const json = editor.getJSON() as PMJsonNode
    const lists = nodesOfType(json, 'stdList').map(list => [list.attrs?.listType, (list.content ?? []).map(item => item.attrs?.nodeId)])
    expect(lists).toEqual([
      ['roman', ['g7-r1', 'g7-r2']],
      ['alpha', ['g7-r3']],
      ['roman', ['g7-r4']],
      ['roman', ['g7-s1', 'g7-s2']],
      ['alpha', ['g7-a1', 'g7-a2']],
    ])
    const ir = pmToIr(json).doc
    expect(errorsOf(ir)).toEqual([])
    expect(resolve(ir).labels['g7-r3']).toMatchObject({ label: 'a）', refText: '1.1 a）' })
    editor.destroy()
  })

  it('未被引用的罗马列项改成无序类型：允许（没有目标会悬空）', () => {
    const editor = mountedEditor(createG7RomanFixture())
    selectInside(editor, 'g7-r1')
    // g7-l-roman 里的 g7-r3 被引用，整表转换会拒绝；选中单项（不含被引用项）时只拆出该项
    expect(setListFormat(editor, 'dash')).toEqual({ ok: true })
    const json = editor.getJSON() as PMJsonNode
    const lists = nodesOfType(json, 'stdList').map(list => [list.attrs?.listType, (list.content ?? []).map(item => item.attrs?.nodeId)])
    expect(lists).toEqual([
      ['dash', ['g7-r1']],
      ['roman', ['g7-r2', 'g7-r3', 'g7-r4']],
      ['roman', ['g7-s1', 'g7-s2']],
      ['alpha', ['g7-a1', 'g7-a2']],
    ])
    expect(errorsOf(pmToIr(json).doc)).toEqual([])
    editor.destroy()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// M-5.6-05 注/示例的块内容
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-5.6-05] 生产 Schema：noteBlock / exampleBlock（内容 (stdParagraph | stdList)+）', () => {
  it('夹具通过 Schema 校验；两个新节点是块组、带 nodeId，且已登记到 NODE_ID_TYPES', () => {
    const root = schema.nodeFromJSON(createG7NoteFixture())
    expect(() => root.check()).not.toThrow()
    for (const name of ['noteBlock', 'exampleBlock']) {
      const type = schema.nodes[name]!
      expect(type.spec.group).toBe('block')
      expect(type.spec.content).toBe('(stdParagraph | stdList)+')
      expect(type.spec.attrs).toHaveProperty('nodeId')
      expect(NODE_ID_TYPES).toContain(name)
    }
  })

  it('旧的 note / example 保持不动：内容仍是 inline*', () => {
    expect(schema.nodes.note!.spec.content).toBe('inline*')
    expect(schema.nodes.example!.spec.content).toBe('inline*')
  })

  it('非法内容被拒绝：空节点、嵌套的 note/noteBlock、直接放文字', () => {
    const wrap = (children: PMJsonNode[]): PMJsonNode => ({ type: 'doc', content: [{ type: 'foreword', content: [{ type: 'noteBlock', attrs: { nodeId: 'x' }, content: children }] }] })
    const p = (id: string): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [{ type: 'text', text: '文' }] })
    expect(() => schema.nodeFromJSON(wrap([p('a')])).check()).not.toThrow()
    expect(() => schema.nodeFromJSON(wrap([])).check()).toThrow()
    expect(() => schema.nodeFromJSON(wrap([{ type: 'note', attrs: { nodeId: 'n' }, content: [{ type: 'text', text: 'x' }] }])).check()).toThrow()
    expect(() => schema.nodeFromJSON(wrap([{ type: 'noteBlock', attrs: { nodeId: 'n2' }, content: [p('b')] }])).check()).toThrow()
    expect(() => schema.nodeFromJSON(wrap([{ type: 'text', text: '直接文字' }])).check()).toThrow()
  })

  it('只出现在块位置：术语条目、图不接受 noteBlock/exampleBlock（那些位置仍用旧的单段 note/example）', () => {
    const p = (id: string): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [{ type: 'text', text: '文' }] })
    const block = (type: 'noteBlock' | 'exampleBlock', id: string): PMJsonNode => ({ type, attrs: { nodeId: id }, content: [p(`${id}-p`)] })
    const title = (type: string): PMJsonNode => ({ type, content: [{ type: 'text', text: '标题' }] })
    const holders: Record<string, (child: PMJsonNode) => PMJsonNode> = {
      foreword: child => ({ type: 'doc', content: [{ type: 'foreword', content: [child] }] }),
      introduction: child => ({ type: 'doc', content: [{ type: 'introduction', content: [child] }] }),
      chapter: child => ({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [title('chapterTitle'), child] }] }),
      clause: child => ({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [title('chapterTitle'),
        { type: 'clause', attrs: { nodeId: 'cl', level: 1 }, content: [title('clauseTitle'), child] }] }] }),
      appendix: child => ({ type: 'doc', content: [{ type: 'appendix', attrs: { nodeId: 'a' }, content: [title('appendixLabel'), title('appendixTitle'), child] }] }),
      warning: child => ({ type: 'doc', content: [{ type: 'foreword', content: [{ type: 'warning', attrs: { nodeId: 'w' }, content: [child] }] }] }),
    }
    for (const [name, wrap] of Object.entries(holders)) {
      expect(() => schema.nodeFromJSON(wrap(block('noteBlock', 'nb'))).check(), `${name}.noteBlock`).not.toThrow()
      expect(() => schema.nodeFromJSON(wrap(block('exampleBlock', 'eb'))).check(), `${name}.exampleBlock`).not.toThrow()
    }
    // 单元格（夹具里的 g7-t1-note）已在上一个用例通过校验；术语条目、表注行、图的内容表达式是显式列表，不接受
    const match = (parent: string, child: string) => schema.nodes[parent]!.contentMatch.matchType(schema.nodes[child]!)
    expect(match('termDef', 'noteBlock')).toBeNull()
    expect(match('tableNoteRow', 'noteBlock')).toBeNull()
    expect(match('figure', 'noteBlock')).toBeNull()
  })
})

describe('[M-5.6-05] 往返：生产 PM → pmToIr → Resolver → irToPm → 生产 PM', () => {
  const original = schema.nodeFromJSON(createG7NoteFixture())
  original.check()
  const originalJson = original.toJSON() as PMJsonNode

  function clauseChildren(doc: ReturnType<typeof pmToIr>['doc'], index: number) {
    const clause = doc.body[0]!.children[index]!
    if (clause.kind !== 'clause') throw new Error('期望条')
    return clause.children
  }

  it('pmToIr：无 warning、无 unsupportedContent；多块注/示例映射为 IRNote/IRExample，子块保留各自的 id；extensionVersion 为 1', () => {
    const { doc, warnings } = pmToIr(originalJson)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.extensionVersion).toBe(1)
    expect(errorsOf(doc)).toEqual([])

    const [forewordNote] = doc.front.foreword as IRNote[]
    expect(forewordNote).toMatchObject({ kind: 'note', id: 'g7-fw-note' })
    expect(forewordNote!.content.map(block => [block.kind, block.id])).toEqual([['paragraph', 'g7-fw-note-p1'], ['paragraph', 'g7-fw-note-p2']])

    const children = clauseChildren(doc, 0)
    const byIdMap = new Map(children.map(child => [child.id, child]))
    // 旧式单段注：派生段落 id
    expect((byIdMap.get('g7-n1') as IRNote).content.map(block => block.id)).toEqual(['g7-n1.p0'])
    // 多块注：段落、带脚注的段落、dash 列项
    const multi = byIdMap.get('g7-n2') as IRNote
    expect(multi.content.map(block => block.kind)).toEqual(['paragraph', 'paragraph', 'list'])
    expect(multi.content.map(block => block.id)).toEqual(['g7-n2-p1', 'g7-n2-p2', 'g7-n2-l'])
    const footnoteRun = (multi.content[1] as Extract<IRBlock, { kind: 'paragraph' }>).content.find(run => run.footnote)
    expect(footnoteRun?.footnote?.id).toBe('g7-fn1')
    // 单段但段落 id 非派生：仍保留段落 id
    expect((byIdMap.get('g7-n3') as IRNote).content.map(block => block.id)).toEqual(['g7-n3-p'])
    // 多块示例：段落 + 罗马列项
    const example = byIdMap.get('g7-e2') as Extract<IRBlock, { kind: 'example' }>
    expect(example.kind).toBe('example')
    expect(example.content.map(block => block.kind)).toEqual(['paragraph', 'list'])
    expect((example.content[1] as IRList).listType).toBe('roman')
    // 单元格内的注：IR 单元格内容是 note 块
    const table = clauseChildren(doc, 1)[0]!
    expect(table.kind).toBe('table')
    const cell = (table as Extract<IRBlock, { kind: 'table' }>).rows[1]!.cells[1]!
    expect(cell.content.map(block => [block.kind, block.id])).toEqual([['note', 'g7-t1-note']])
  })

  it('Resolver：同一作用域的注/示例连续编号（注1：/注2：/注3：、示例1：/示例2：），单元格与前言里的单个注为「注：」；引用目标可解析', () => {
    const { labels } = resolve(pmToIr(originalJson).doc)
    for (const [id, label] of Object.entries(WP8M_G7_NOTE_LABELS.notes)) expect(labels[id]?.label, id).toBe(label)
    for (const [id, label] of Object.entries(WP8M_G7_NOTE_LABELS.examples)) expect(labels[id]?.label, id).toBe(label)
    expect(labels['g7-fw-note']?.label).toBe('注：')
    expect(labels['g7-t1-note']?.label).toBe('注：')
    expect(labels['g7-r3']).toMatchObject({ label: 'iii）', refText: '1.1 iii）' })
    expect(labels['g7-fn1']?.label).toBe('1)')
  })

  it('irToPm 后 Schema 校验通过，与原文档逐节点相同（noteBlock/exampleBlock 不被改写为旧节点）；经 JSON 冷重开、再次 pmToIr 后 IR 深度相等', () => {
    const first = pmToIr(originalJson).doc
    const roundtrip = schema.nodeFromJSON(irToPm(first))
    roundtrip.check()
    const before = byId(originalJson)
    const after = byId(roundtrip.toJSON() as PMJsonNode)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [id, record] of before) {
      expect(after.get(id)?.type, id).toBe(record.type)
      for (const [key, value] of Object.entries(record.attrs ?? {})) {
        if (value !== null && value !== undefined) expect(after.get(id)?.attrs?.[key], `${id}.${key}`).toEqual(value)
      }
    }
    expect(roundtrip.toJSON()).toEqual(originalJson)
    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(roundtrip.toJSON())) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(first)
  })

  it('canonical 规则：只含一个派生 id 段落的 noteBlock 规范化为旧 note（输出稳定，之后再往返不变）；旧 note 保持 note', () => {
    const doc: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c', secType: 'general' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
      { type: 'noteBlock', attrs: { nodeId: 'nb' }, content: [{ type: 'stdParagraph', attrs: { nodeId: 'nb.p0' }, content: [{ type: 'text', text: '仅派生 id 的单段' }] }] },
      { type: 'note', attrs: { nodeId: 'old' }, content: [{ type: 'text', text: '旧注' }] },
    ] }] }
    schema.nodeFromJSON(doc).check()
    const once = irToPm(pmToIr(doc).doc)
    const chapter = once.content!.find(node => node.type === 'chapter')!
    expect(chapter.content!.slice(1).map(node => node.type)).toEqual(['note', 'note'])
    expect(irToPm(pmToIr(once).doc)).toEqual(once)
  })

  it('无法投影的内容给出带路径与 nodeId 的诊断：注里放表、列项项里有第二段；空内容', () => {
    const { doc } = pmToIr(originalJson)
    const mutated = JSON.parse(JSON.stringify(doc)) as typeof doc
    const clause = mutated.body[0]!.children[0]!
    if (clause.kind !== 'clause') throw new Error('期望条')
    const note = clause.children.find(child => child.id === 'g7-n2') as IRNote
    note.content.push(clauseChildren(doc, 1)[0]! as IRBlock)
    ;(note.content[2] as IRList).items[0]!.content.push({ kind: 'paragraph', id: 'extra', content: [{ text: '同项第二段' }] })
    let caught: unknown
    try { irToPm(mutated) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    const diagnostics = (caught as IRToPmError).diagnostics
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: 'g7-t1', reason: expect.stringContaining('只接受段落与列项') }))
    expect(diagnostics.some(item => item.nodeId === 'g7-n2-l' && item.reason.includes('简单列项'))).toBe(true)

    const empty = JSON.parse(JSON.stringify(doc)) as typeof doc
    const emptyClause = empty.body[0]!.children[0]!
    if (emptyClause.kind !== 'clause') throw new Error('期望条')
    ;(emptyClause.children.find(child => child.id === 'g7-n2') as IRNote).content = []
    let emptyError: unknown
    try { irToPm(empty) } catch (error) { emptyError = error }
    expect((emptyError as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({ nodeId: 'g7-n2', reason: expect.stringContaining('至少需要') }))
  })

  it('术语条目内的注仍是单段：多块在那里继续报错，文案指向该位置的限制', () => {
    const { doc } = pmToIr(originalJson)
    const mutated = JSON.parse(JSON.stringify(doc)) as typeof doc
    mutated.body[0]!.children.push({
      kind: 'termEntry', id: 'term-x', term: [{ text: '术语' }], definition: [{ kind: 'paragraph', id: 'term-x.def0', content: [{ text: '定义' }] }],
      notes: [{ kind: 'note', id: 'term-note', content: [
        { kind: 'paragraph', id: 'term-note.p0', content: [{ text: '甲' }] }, { kind: 'paragraph', id: 'term-note-p2', content: [{ text: '乙' }] },
      ] }], examples: [],
    })
    let caught: unknown
    try { irToPm(mutated) } catch (error) { caught = error }
    expect((caught as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][2].notes.term-note', reason: expect.stringContaining('该位置的注/示例只支持单段落'),
    }))
  })

  it('没有块内容注/示例/罗马列项的旧文档往返后不出现 extensionVersion（旧文档不被误标）', () => {
    const legacy: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c', secType: 'general' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
      { type: 'note', attrs: { nodeId: 'n' }, content: [{ type: 'text', text: '注' }] },
      { type: 'example', attrs: { nodeId: 'e' }, content: [{ type: 'text', text: '例' }] },
    ] }] }
    const ir = pmToIr(legacy).doc
    expect(ir.extensionVersion).toBeUndefined()
    expect(irToPm(ir).attrs).toBeUndefined()
  })
})

describe('[M-5.6-05] HTML 往返：DOMSerializer / DOMParser 两轮后节点类型、nodeId、属性不变', () => {
  it('noteBlock/exampleBlock 序列化为 div[data-type=note-block|example-block]（保留子块与列表），旧 note/example 的 HTML 不变，重新解析得到同样的文档', () => {
    const fixture = schema.nodeFromJSON(createG7NoteFixture()).toJSON() as PMJsonNode
    const { html, current } = roundtripHtml(fixture)
    const rendered = document.createElement('div')
    rendered.innerHTML = html
    expect([...rendered.querySelectorAll('div[data-type="note-block"]')].map(element => element.getAttribute('data-node-id'))).toEqual(['g7-fw-note', 'g7-n2', 'g7-n3', 'g7-t1-note'])
    expect([...rendered.querySelectorAll('div[data-type="example-block"]')].map(element => element.getAttribute('data-node-id'))).toEqual(['g7-e2'])
    expect(rendered.querySelectorAll('div[data-type="note"]')).toHaveLength(1)
    expect(rendered.querySelectorAll('div[data-type="example"]')).toHaveLength(1)
    const multi = rendered.querySelector('div[data-type="note-block"][data-node-id="g7-n2"]')!
    expect([...multi.children].map(child => child.getAttribute('data-type'))).toEqual(['std-paragraph', 'std-paragraph', 'std-list'])
    expect(multi.classList.contains('std-note')).toBe(true)
    const after = byId(current)
    expect(current.content).toEqual(fixture.content)
    for (const id of ['g7-fw-note', 'g7-n2', 'g7-n3', 'g7-t1-note']) expect(after.get(id)?.type, id).toBe('noteBlock')
    expect(after.get('g7-e2')?.type).toBe('exampleBlock')
    expect(after.get('g7-n1')?.type).toBe('note')
    expect(after.get('g7-n3-p')?.attrs?.nodeId).toBe('g7-n3-p')
    expect(after.get('g7-e2-l')?.attrs).toMatchObject({ listType: 'roman' })
  })
})

describe('[M-5.6-05] 保存重开：Editor + replaceEditorDocument + exportSemanticJson', () => {
  it('加载 → 导出语义 JSON → 再加载 → 再导出：JSON 相等；块内容的注/示例保持 noteBlock/exampleBlock 与子块 id', () => {
    const editor = mountedEditor()
    expect(replaceEditorDocument(editor, createG7NoteFixture() as unknown as Record<string, unknown>)).toBe(true)
    const firstSave = editor.getJSON() as PMJsonNode
    const firstExport = exportSemanticJson(editor.state.doc)
    expect(nodesOfType(firstSave, 'noteBlock').map(node => node.attrs?.nodeId)).toEqual(['g7-fw-note', 'g7-n2', 'g7-n3', 'g7-t1-note'])
    expect(nodesOfType(firstSave, 'exampleBlock').map(node => node.attrs?.nodeId)).toEqual(['g7-e2'])
    expect(JSON.stringify(firstSave)).not.toContain('resolvedLabel')

    const reopened = mountedEditor()
    replaceEditorDocument(reopened, JSON.parse(JSON.stringify(firstSave)) as Record<string, unknown>)
    expect(reopened.getJSON()).toEqual(firstSave)
    expect(exportSemanticJson(reopened.state.doc)).toEqual(firstExport)
    // 再经 IR 往返保存一次（真实保存路径之一：PM → IR → PM），仍一致（编辑器在文档末尾补的空 paragraph 不属于文档内容，不参与比较）
    const viaIr = mountedEditor()
    replaceEditorDocument(viaIr, irToPm(pmToIr(firstSave).doc) as unknown as Record<string, unknown>)
    // 前言容器在 IR 里没有 id（沿用旧契约），经 IR 往返后由编辑器重新生成容器 nodeId，所以也不参与比较。
    const comparable = (json: ReturnType<typeof exportSemanticJson>) => ({
      ...json,
      content: json.content!.filter(node => node.type !== 'paragraph').map(node => node.type === 'foreword' ? { ...node, attrs: undefined } : node),
    })
    expect(comparable(exportSemanticJson(viaIr.state.doc))).toEqual(comparable(firstExport))
    for (const target of [editor, reopened, viaIr]) target.destroy()
  })

  it('docDiff 文本化：多块注/示例的每个子块都进入版本比对文本（只改注内第二段也能看出差异）', () => {
    const text = docToText(createG7NoteFixture() as unknown as Record<string, unknown>)
    expect(text).toContain('注：多块注的第一段。')
    expect(text).toContain('第二段带脚注')
    expect(text).toContain('注内列项一')
    expect(text).toContain('示例：多块示例的引语：')
    expect(text).toContain('示例项乙')
    expect(text).toContain('注：前言注的第一段。')
    expect(text).toContain('前言注的第二段。')
  })
})

describe('[M-5.6-05] 输出边界：HTML、DOCX 放行块内容的注/示例（真排）；XML/XML46687 的字段表放行；旧 XML 序列化器拒绝拍平', () => {
  const { doc } = pmToIr(schema.nodeFromJSON(createG7NoteFixture()).toJSON() as PMJsonNode)
  /** 夹具里有两个罗马列表（旧 XML 另行阻断，见罗马列项的边界用例）；换成字母列表后，注/示例本身在旧 XML 的字段表里放行 */
  const withoutRoman = (): PMJsonNode => {
    const copy = createG7NoteFixture()
    for (const list of nodesOfType(copy, 'stdList')) if (list.attrs?.listType === 'roman') list.attrs.listType = 'alpha'
    return copy
  }

  it.each(['HTML', 'DOCX', 'XML46687'] as const)('%s：getOutputSupportProblems 为空', format => {
    expect(getOutputSupportProblems(doc, format)).toEqual([])
  })

  it('XML：字段表放行 note/example 的块内容，唯一的问题是夹具里的两个罗马列表；换成字母列表后为空', () => {
    expect(getOutputSupportProblems(doc, 'XML').map(problem => problem.nodeId)).toEqual(['g7-l-roman', 'g7-e2-l'])
    expect(getOutputSupportProblems(pmToIr(schema.nodeFromJSON(withoutRoman()).toJSON() as PMJsonNode).doc, 'XML')).toEqual([])
  })

  it('旧 XML 序列化器（serializeToXml）遇到 noteBlock/exampleBlock 报 UnsupportedOutputError，不把它们静默拍平成普通段落', () => {
    const pmDoc = schema.nodeFromJSON(withoutRoman())
    let caught: unknown
    try { serializeToXml(pmDoc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(UnsupportedOutputError)
    const problems = (caught as UnsupportedOutputError).problems
    expect(problems.map(problem => problem.nodeId)).toEqual(expect.arrayContaining(['g7-fw-note', 'g7-n2', 'g7-n3', 'g7-e2', 'g7-t1-note']))
    for (const id of ['g7-fw-note', 'g7-n2', 'g7-n3', 'g7-e2']) {
      expect(problems.find(problem => problem.nodeId === id)?.message, id).toContain('块内容的')
    }
  })
})

describe('[M-5.6-05] 显示：编辑器 NodeView 标记、标签装饰与样式', () => {
  it('noteBlock 的 NodeView：div.std-note.std-note-editor.std-note-block，标记由 Resolver 作用域写入（注1：/注2：/注：），内容块在 contentDOM 内', () => {
    const editor = mountedEditor(createG7NoteFixture())
    const labels = resolve(pmToIr(editor.getJSON() as PMJsonNode).doc).labels
    const marker = (id: string) => editor.view.dom.querySelector<HTMLElement>(`[data-node-id="${id}"].std-note-editor > .std-note-marker`)?.textContent
    expect(marker('g7-n2')).toBe('注2：')
    expect(marker('g7-n3')).toBe('注3：')
    expect(marker('g7-fw-note')).toBe('注：')
    expect(marker('g7-t1-note')).toBe('注：')
    for (const id of ['g7-n2', 'g7-n3', 'g7-fw-note', 'g7-t1-note']) expect(marker(id)).toBe(labels[id]!.label)
    // 旧的单段 note 的 NodeView 同样被刷新，标记与 Resolver 一致
    expect(marker('g7-n1')).toBe('注1：')
    const block = editor.view.dom.querySelector<HTMLElement>('[data-node-id="g7-n2"].std-note-block')!
    expect(block.dataset.type).toBe('note-block')
    const content = block.querySelector<HTMLElement>(':scope > .std-note-block-content')!
    expect([...content.children].map(child => child.getAttribute('data-type'))).toEqual(['std-paragraph', 'std-paragraph', 'std-list'])
    editor.destroy()
  })

  it('exampleBlock：FootnoteLabels 的 Decoration 写入 data-resolved-label（示例2：），与旧 example（示例1：）同一编号序列', () => {
    const editor = mountedEditor(createG7NoteFixture())
    const labelOf = (id: string) => editor.view.dom.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.dataset.resolvedLabel
    expect(labelOf('g7-e1')).toBe('示例1：')
    expect(labelOf('g7-e2')).toBe('示例2：')
    const block = editor.view.dom.querySelector<HTMLElement>('[data-node-id="g7-e2"]')!
    expect(block.classList.contains('std-example-block')).toBe(true)
    expect(block.getAttribute('data-type')).toBe('example-block')
    editor.destroy()
  })

  it('样式：noteBlock 标记在左、内容块在右（flex），示例标签单独成行；段落在注内不缩进', () => {
    const css = readFileSync(resolvePath(process.cwd(), 'src/styles/standard-nodes.css'), 'utf8')
    expect(css).toMatch(/\.std-note-block \{\s*display: flex;/)
    expect(css).toMatch(/\.std-note-block > \.std-note-block-content \{[^}]*flex: 1;/)
    expect(css).toMatch(/\.std-note-block \.std-paragraph \{\s*text-indent: 0;/)
    expect(css).toMatch(/\.std-example-block::before \{\s*display: block;/)
  })

  it('脚注：块内容注里的段落可插入脚注（canInsertBodyFootnote 的 stdParagraph 白名单），表格单元格内仍禁止', () => {
    const editor = mountedEditor(createG7NoteFixture())
    selectInside(editor, 'g7-n2-p1')
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(true)
    selectInside(editor, 'g7-t1-note-p1')
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(false)
    editor.destroy()
  })
})

describe('[M-5.6-05] 编辑守卫：不识别 noteBlock 的格式命令返回「不支持」而不是抛错，文档保持合法', () => {
  it('光标在 noteBlock 段落内：insertNote/insertExample 不改文档；setClauseFormat/setParagraphFormat/setListFormat 不抛错', () => {
    const editor = mountedEditor(createG7NoteFixture())
    const chapterJson = () => JSON.stringify(byId(editor.getJSON() as PMJsonNode).get('g7-ch1'))
    const before = chapterJson()
    selectInside(editor, 'g7-n2-p1')
    expect(editor.commands.insertNote()).toBe(false)
    expect(editor.commands.insertExample()).toBe(false)
    expect(chapterJson()).toBe(before)
    for (const run of [
      () => setClauseFormat(editor, 2),
      () => setParagraphFormat(editor),
      () => setListFormat(editor, 'dash'),
    ]) {
      expect(() => run()).not.toThrow()
      expect(() => editor.state.doc.check()).not.toThrow()
    }
    // 不得留下破损的文档：仍能通过 pmToIr，且没有 unsupportedContent
    expect(pmToIr(editor.getJSON() as PMJsonNode).doc.unsupportedContent).toBeUndefined()
    editor.destroy()
  })
})

describe('[M-5.6-05] 粘贴重映射：noteBlock 及其子块的 nodeId 随副本换新，副本内引用跟随', () => {
  it('remapPastedSliceIds：整条复制到同一文档时，noteBlock/exampleBlock、其段落与列项都换新 id，副本内的 note 引用指向副本', () => {
    const editor = new Editor({ extensions, content: createG7NoteFixture() })
    try {
      const chapter = editor.state.doc.child(1)
      const clause = chapter.child(1) // g7-c11
      const slice = remapPastedSliceIds(new Slice(Fragment.from(clause), 0, 0), editor.state.doc)
      const copied = slice.content.child(0).toJSON() as PMJsonNode
      const ids = (type: string) => nodesOfType(copied, type).map(node => String(node.attrs?.nodeId))
      expect(ids('noteBlock')).toHaveLength(2)
      expect(ids('exampleBlock')).toHaveLength(1)
      const all = [...ids('noteBlock'), ...ids('exampleBlock'), ...ids('stdParagraph'), ...ids('stdListItem'), ...ids('stdList')]
      expect(all.some(id => id.startsWith('g7-'))).toBe(false)
      expect(new Set(all).size).toBe(all.length)
      // 引言段里对 g7-n3（noteBlock）的 note 引用跟随到副本 noteBlock 的新 id
      const noteRef = nodesOfType(copied, 'text').flatMap(node => node.marks ?? []).find(mark => mark.type === 'crossRef' && mark.attrs?.refType === 'note')
      expect(noteRef?.attrs?.targetId).toBe(ids('noteBlock')[1])
    } finally {
      editor.destroy()
    }
  })
})
