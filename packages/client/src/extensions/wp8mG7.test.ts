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
import {
  IRToPmError, getOutputSupportProblems, irToPm, pmToIr, resolve,
  type IRBlock, type IRList, type OutputBoundaryFormat, type PMJsonNode,
} from '@ses/shared'
import { replaceEditorDocument } from '../utils/editorDocument'
import { setListFormat } from '../utils/structureEditing'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { createEditorExtensions } from './editorExtensions'
import { normalizeStdListType } from './nodes/std-list'
import { createG7RomanFixture, WP8M_G7_ROMAN_LABELS } from './__fixtures__/wp8m-g7'

const extensions = createEditorExtensions()
const schema = getSchema(extensions)
const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']

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

  it('Resolver：被引用的罗马列项得到 i)…形式的标签（G4 的 gbT11Strategy.listItem），每个列表重新起编；未被引用的没有标签', () => {
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

describe('[M-5.7-04] 输出边界：HTML、DOCX 放行罗马列项（真排）；XML 系列字段表放行', () => {
  const { doc } = pmToIr(schema.nodeFromJSON(createG7RomanFixture()).toJSON() as PMJsonNode)

  it.each(FORMATS)('%s：没有 unsupported-output', format => {
    expect(getOutputSupportProblems(doc, format)).toEqual([])
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
    expect(resolve(ir).labels['g7-r3']).toMatchObject({ label: 'a)', refText: '1.1 a)' })
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
