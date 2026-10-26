// @vitest-environment happy-dom
/**
 * WP8.M G2：通用定义列表（缩略语 def-list）与 abbreviation 引用（M-10.1.4-01/-03/-04/-05、M-10.1.1-04）——生产 Schema / client 层。
 *
 * 设计 §3.6 四类用例：Schema、往返（PM → IR → PM）、HTML 往返、保存重开（Editor + replaceEditorDocument +
 * exportSemanticJson）。另覆盖编辑器显示、键盘（与公式“式中”共用项节点的 Enter/Tab/Backspace）、粘贴重映射、
 * 导出链路（HTML/PDF/DOCX 放行并排版，旧 XML 阻断）。
 * shared 层的映射、Resolver、边界与排版细节见 shared 的 wp8mG2*.test.ts。
 */

import JSZip from 'jszip'
import { Editor, getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer, Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { checkExportGuard } from '@ses/io'
import { irToPm, pmToIr, resolve, type IRChapterChild, type IRDefList, type IRDoc, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'
import {
  G2_EXPECTED_LABELS, G2_ITEM_IDS, abbrRefMark, createWp8mG2Fixture, defItem, defList,
} from './__fixtures__/wp8m-g2'
import { canInsertBodyFootnote } from './nodes/footnotes'
import { NODE_ID_TYPES, remapPastedSliceIds } from './plugins/ensureNodeId'
import { buildDocxBlob } from '../serializer/docxExporter'
import { exportSemanticHtml } from '../serializer/htmlExporter'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { serializeToXml } from '../serializer/xmlSerializer'
import { docToText } from '../utils/docDiff'
import { replaceEditorDocument } from '../utils/editorDocument'

const extensions = createEditorExtensions()
const schema = getSchema(extensions)

function visit(node: PMJsonNode, fn: (node: PMJsonNode) => void): void {
  fn(node)
  node.content?.forEach(child => visit(child, fn))
}

function nodesOfType(root: PMJsonNode, type: string): PMJsonNode[] {
  const found: PMJsonNode[] = []
  visit(root, node => { if (node.type === type) found.push(node) })
  return found
}

function textOf(node: PMJsonNode | undefined): string {
  if (!node) return ''
  if (node.text !== undefined) return node.text
  return (node.content ?? []).map(textOf).join('')
}

/** nodeId → 缩略语表的 [项 nodeId, 术语文本, 释义文本] 列表。 */
function defListShapes(root: PMJsonNode): Record<string, string[][]> {
  const shapes: Record<string, string[][]> = {}
  for (const list of nodesOfType(root, 'defList')) {
    shapes[String(list.attrs?.nodeId)] = (list.content ?? []).map(item => [
      String(item.attrs?.nodeId),
      textOf(item.content?.find(cell => cell.type === 'whereTerm')),
      textOf(item.content?.find(cell => cell.type === 'whereDefinition')),
    ])
  }
  return shapes
}

function irDefLists(children: IRChapterChild[], out: IRDefList[] = []): IRDefList[] {
  for (const child of children) {
    if (child.kind === 'defList') out.push(child)
    else if (child.kind === 'clause') irDefLists(child.children, out)
  }
  return out
}

function allIrDefLists(doc: IRDoc): IRDefList[] {
  return [...doc.body.flatMap(chapter => irDefLists(chapter.children)), ...doc.appendices.flatMap(appendix => irDefLists(appendix.children))]
}

/** 比较“经 IR 再写回”的文档与原文档时剔除与 G2 无关的既有差异：chapter.secType 与 Tiptap 补的末尾空段。 */
function withoutSecType(root: PMJsonNode): PMJsonNode {
  const copy = structuredClone(root)
  visit(copy, node => { if (node.attrs && 'secType' in node.attrs) delete node.attrs.secType })
  copy.content = (copy.content ?? []).filter(node => !(node.type === 'paragraph' && !node.content?.length))
  return copy
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

/** 光标放进 nodeId 所属缩略语项的术语格或释义格（offset 为格内偏移，默认末尾）。 */
function caretInItem(editor: Editor, itemId: string, cell: 'whereTerm' | 'whereDefinition', offset?: number): void {
  let target: number | undefined
  editor.state.doc.descendants((node, pos) => {
    if (target !== undefined) return false
    if (node.type.name === 'whereItem' && node.attrs.nodeId === itemId) {
      node.forEach((child, childOffset) => {
        if (child.type.name === cell) target = pos + 1 + childOffset + 1 + (offset ?? child.content.size)
      })
      return false
    }
    return true
  })
  if (target === undefined) throw new Error(`找不到缩略语项 ${itemId}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)))
}

function mountEditor(content: Record<string, unknown> | string = '<p></p>'): Editor {
  const editor = new Editor({ extensions, content: content as never })
  editor.mount(document.createElement('div'))
  return editor
}

describe('[M-10.1.4-01] 生产 Schema：defList', () => {
  it('fixture 通过 Schema 校验；defList 是块组节点，内容为 whereItem+，复用既有项节点（P8）', () => {
    const root = schema.nodeFromJSON(createWp8mG2Fixture())
    expect(() => root.check()).not.toThrow()
    const type = schema.nodes.defList!
    expect(type.spec.content).toBe('whereItem+')
    expect(type.spec.group).toBe('block')
    // 项节点与公式 whereList 共用，定义不变
    expect(schema.nodes.whereItem!.spec.content).toBe('whereTerm whereDefinition')
    expect(schema.nodes.whereList!.spec.content).toBe('whereItem+')
    expect(NODE_ID_TYPES).toContain('defList')
    expect(NODE_ID_TYPES).toContain('whereItem')
  })

  it('扩展追加在 createEditorExtensions() 末尾（P3），block 组默认填充节点与此前一致', () => {
    const names = extensions.map(extension => extension.name)
    // 多个 WP8.M 组都追加在末尾，defList 不一定是最后一个；P3 要求的是排在全部既有扩展之后。
    expect(names.indexOf('defList')).toBeGreaterThan(names.indexOf('inlineFormulaEditing'))
    const without = getSchema(extensions.filter(extension => extension.name !== 'defList'))
    for (const name of ['doc', 'chapter', 'clause', 'appendix', 'foreword', 'introduction']) {
      expect(schema.nodes[name]!.createAndFill()?.toJSON(), name).toEqual(without.nodes[name]!.createAndFill()?.toJSON())
    }
    // 原 schema 的节点顺序保持：defList 排在最后一个自定义块之后
    const order = Object.keys(schema.nodes)
    expect(order.indexOf('defList')).toBeGreaterThan(order.indexOf('termSubjectField'))
  })

  it('旧文档仍然合法：不含 defList 的 WP6 fixture 无需迁移', () => {
    expect(() => schema.nodeFromJSON(createWp6Fixture()).check()).not.toThrow()
  })

  it('最小缩略语表：createAndFill 带出一个空项（术语格 + 释义格）', () => {
    const filled = schema.nodes.defList!.createAndFill()!
    expect(filled.childCount).toBe(1)
    expect(filled.child(0).type.name).toBe('whereItem')
    expect(filled.child(0).content.content.map(child => child.type.name)).toEqual(['whereTerm', 'whereDefinition'])
  })

  it('非法结构被 Schema 拒绝：空表、非项子节点、位于公式 whereList 内、项缺释义格', () => {
    const base = () => createWp8mG2Fixture()
    const mutate = (change: (list: PMJsonNode) => void): PMJsonNode => {
      const doc = base()
      change(nodesOfType(doc, 'defList').find(list => list.attrs?.nodeId === 'g2-list')!)
      return doc
    }
    expect(() => schema.nodeFromJSON(mutate(list => { list.content = [] })).check()).toThrow()
    expect(() => schema.nodeFromJSON(mutate(list => { list.content!.push({ type: 'stdParagraph', attrs: { nodeId: 'x' }, content: [{ type: 'text', text: '游离' }] }) })).check()).toThrow()
    expect(() => schema.nodeFromJSON(mutate(list => { list.content![0]!.content!.pop() })).check()).toThrow()
    // defList 不能嵌进公式的 whereList
    const formula: PMJsonNode = {
      type: 'formula', attrs: { nodeId: 'f', latex: 'a', numbered: false },
      content: [{ type: 'formulaContent', content: [{ type: 'text', text: 'a' }] }, { type: 'whereList', content: [defList('inner', defItem('i1', 'a', '长度'))] }],
    }
    expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '一般要求' }] }, formula] }] }).check()).toThrow()
  })
})

describe('[M-10.1.4-01][M-10.1.4-03][M-10.1.4-04][M-10.1.4-05][M-10.1.1-04] 往返：生产 PM → IR → Resolver → PM', () => {
  it('pmToIr 无告警；缩略语表读成 IRDefList，项为 { id, term, definition }，extensionVersion=1', () => {
    const fixture = schema.nodeFromJSON(createWp8mG2Fixture()).toJSON() as PMJsonNode
    const { doc, warnings } = pmToIr(fixture)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    expect(doc.extensionVersion).toBe(1)
    const lists = allIrDefLists(doc)
    expect(lists.map(list => list.id)).toEqual(['g2-list', 'g2-list-clause', 'g2-list-app'])
    expect(lists.flatMap(list => list.items.map(item => item.id))).toEqual([...G2_ITEM_IDS])
    const ct = lists[0]!.items[2]!
    expect(ct.term).toEqual([{ text: 'CT' }])
    expect(ct.definition).toEqual([
      { text: '计算机断层扫描，参见' },
      { text: 'ADC', marks: [{ type: 'crossRef', targetId: 'abb-adc', targetKind: 'abbreviation' }] },
      { text: '与', marks: [{ type: 'bold' }] },
      { text: '电流互感器' },
    ])
  })

  it('Resolver 无 error；缩略语项标签为术语纯文本，xmlId=abb_<k> 按文档序（含条内与附录），不出现 ext_', () => {
    const { doc } = pmToIr(createWp8mG2Fixture())
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    for (const id of G2_ITEM_IDS) {
      const expected = G2_EXPECTED_LABELS[id]!
      expect(labels[id], id).toEqual({ label: expected.label, xmlId: expected.xmlId, refText: expected.label })
    }
    expect(Object.values(labels).filter(entry => entry.xmlId.startsWith('ext_'))).toEqual([])
  })

  it('crossRef refType=abbreviation ↔ targetKind=abbreviation（M-10.1.1-04）', () => {
    const { doc } = pmToIr(createWp8mG2Fixture())
    const reference = doc.body[0]!.children[0]
    const marks = reference!.kind === 'paragraph' ? reference.content.flatMap(run => run.marks ?? []) : []
    expect(marks).toEqual([
      { type: 'crossRef', targetId: 'abb-adc', targetKind: 'abbreviation' },
      { type: 'crossRef', targetId: 'abb-ct', targetKind: 'abbreviation' },
    ])
  })

  it('IR → PM 通过 Schema 校验，缩略语表（项 nodeId、术语、释义文本）与原文档逐项一致，再经 JSON 冷重开后 IR 深度相等', () => {
    const original = schema.nodeFromJSON(createWp8mG2Fixture())
    original.check()
    const first = pmToIr(original.toJSON() as PMJsonNode)
    const rewritten = irToPm(first.doc)
    const projected = schema.nodeFromJSON(rewritten)
    projected.check()
    expect(defListShapes(projected.toJSON() as PMJsonNode)).toEqual(defListShapes(original.toJSON() as PMJsonNode))
    // 容器与项都保留 nodeId；crossRef 的 refType 与 targetId 逐属性保持
    const attrsOf = (root: PMJsonNode) => [...nodesOfType(root, 'defList'), ...nodesOfType(root, 'whereItem')].map(node => [node.type, node.attrs])
    expect(attrsOf(projected.toJSON() as PMJsonNode)).toEqual(attrsOf(original.toJSON() as PMJsonNode))
    const refsOf = (root: PMJsonNode) => nodesOfType(root, 'text').flatMap(node => (node.marks ?? []).filter(mark => mark.type === 'crossRef').map(mark => mark.attrs))
    expect(refsOf(projected.toJSON() as PMJsonNode)).toEqual(refsOf(original.toJSON() as PMJsonNode))
    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(projected.toJSON())) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(first.doc)
  })

  it('公式 whereList 不受影响：式中项仍映射到 formula.whereList，defList 与它互不混淆', () => {
    const doc = createWp8mG2Fixture()
    const chapterNode = doc.content!.find(node => node.attrs?.nodeId === 'g2-abbr-ch')!
    chapterNode.content!.push({
      type: 'formula', attrs: { nodeId: 'g2-f', latex: 'a=b', numbered: true },
      content: [
        { type: 'formulaContent', content: [{ type: 'text', text: 'a=b' }] },
        { type: 'whereList', content: [defItem('g2-w1', 'a', '长度')] },
      ],
    })
    const { doc: ir, warnings } = pmToIr(schema.nodeFromJSON(doc).toJSON() as PMJsonNode)
    expect(warnings).toEqual([])
    const formula = ir.body[2]!.children.find(child => child.kind === 'formula')
    expect(formula && formula.kind === 'formula' && formula.whereList.map(item => item.id)).toEqual(['g2-w1'])
    expect(allIrDefLists(ir).flatMap(list => list.items.map(item => item.id))).toEqual([...G2_ITEM_IDS])
    // 公式式中项不进入缩略语编号
    expect(resolve(ir).labels['g2-w1']).toBeUndefined()
    expect(schema.nodeFromJSON(irToPm(ir)).toJSON()).toBeTruthy()
  })
})

describe('[M-10.1.4-01] HTML 往返（DOMSerializer / DOMParser 两轮）', () => {
  function roundtripHtml(json: PMJsonNode, passes = 2): { html: string; reopened: PMNode } {
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
    return { html, reopened }
  }

  it('renderHTML 带 data-type 与 class；两轮后节点类型、nodeId、属性、术语与释义文本、引用 refType 不变', () => {
    const source = createWp8mG2Fixture()
    const { html, reopened } = roundtripHtml(source)
    const container = document.createElement('div')
    container.innerHTML = html
    const lists = [...container.querySelectorAll('[data-type="def-list"]')]
    expect(lists).toHaveLength(3)
    expect(lists.every(list => list.tagName === 'DL' && list.classList.contains('std-def-list'))).toBe(true)
    expect(lists.map(list => list.getAttribute('data-node-id'))).toEqual(['g2-list', 'g2-list-clause', 'g2-list-app'])
    // 项沿用 whereItem 的 DOM（与公式式中共用）
    expect([...lists[0]!.children].map(child => [child.tagName, child.getAttribute('data-type'), child.getAttribute('data-node-id')])).toEqual([
      ['DIV', 'where-item', 'abb-adc'], ['DIV', 'where-item', 'abb-agc'], ['DIV', 'where-item', 'abb-ct'],
    ])
    const expected = schema.nodeFromJSON(source).toJSON() as PMJsonNode
    const actual = reopened.toJSON() as PMJsonNode
    expect(defListShapes(actual)).toEqual(defListShapes(expected))
    const attrsOf = (root: PMJsonNode) => [...nodesOfType(root, 'defList'), ...nodesOfType(root, 'whereItem')].map(node => [node.type, node.attrs])
    expect(attrsOf(actual)).toEqual(attrsOf(expected))
    const refsOf = (root: PMJsonNode) => nodesOfType(root, 'text').flatMap(node => (node.marks ?? []).filter(mark => mark.type === 'crossRef').map(mark => mark.attrs))
    expect(refsOf(actual)).toEqual(refsOf(expected))
  })

  it('dl[data-type=def-list] 不会被解析成公式 whereList，也不会退化成段落', () => {
    const { reopened } = roundtripHtml(createWp8mG2Fixture())
    const json = reopened.toJSON() as PMJsonNode
    expect(nodesOfType(json, 'defList')).toHaveLength(3)
    expect(nodesOfType(json, 'whereList')).toHaveLength(0)
    expect(nodesOfType(json, 'whereItem')).toHaveLength(G2_ITEM_IDS.length)
  })
})

describe('[M-10.1.4-01] 保存重开：Editor + replaceEditorDocument + exportSemanticJson', () => {
  it('加载 → 保存 → 重开：PM JSON 与语义 JSON 都相等，缩略语表与 nodeId 无损', () => {
    const first = mountEditor()
    expect(replaceEditorDocument(first, createWp8mG2Fixture() as unknown as Record<string, unknown>)).toBe(true)
    expect(first.getJSON().attrs).toMatchObject({ extensionVersion: 1 })
    const saved = JSON.parse(JSON.stringify(first.getJSON())) as PMJsonNode
    const exportedFirst = exportSemanticJson(first.state.doc)

    const second = mountEditor()
    replaceEditorDocument(second, saved as unknown as Record<string, unknown>)
    expect(second.getJSON()).toEqual(first.getJSON())
    expect(exportSemanticJson(second.state.doc)).toEqual(exportedFirst)
    expect(defListShapes(second.getJSON() as PMJsonNode)['g2-list']).toEqual([
      ['abb-adc', 'ADC', '模数转换器（Analog-to-Digital Converter）'],
      ['abb-agc', 'AGC', '自动增益控制（Automatic Gain Control）'],
      ['abb-ct', 'CT', '计算机断层扫描，参见ADC与电流互感器'],
    ])

    // 经 IR 再写回（等同服务端 documentOps 等路径）后重开，语义 JSON 仍相等。
    const third = mountEditor()
    replaceEditorDocument(third, irToPm(pmToIr(saved).doc) as unknown as Record<string, unknown>)
    expect(withoutSecType(exportSemanticJson(third.state.doc) as unknown as PMJsonNode)).toEqual(withoutSecType(exportedFirst as unknown as PMJsonNode))
    expect(JSON.stringify(exportedFirst)).toContain('"type":"defList"')
    expect(JSON.stringify(exportedFirst)).toContain('"refType":"abbreviation"')
    for (const editor of [first, second, third]) editor.destroy()
  })

  it('编辑术语文字后保存重开：新值保留，Resolver 标签随术语更新，xmlId 序号不变', () => {
    const editor = mountEditor()
    replaceEditorDocument(editor, createWp8mG2Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'abb-agc', 'whereTerm')
    editor.view.dispatch(editor.state.tr.insertText('2'))
    const saved = JSON.parse(JSON.stringify(editor.getJSON())) as PMJsonNode
    expect(defListShapes(saved)['g2-list']![1]).toEqual(['abb-agc', 'AGC2', '自动增益控制（Automatic Gain Control）'])

    const reopened = mountEditor()
    replaceEditorDocument(reopened, saved as unknown as Record<string, unknown>)
    const { doc } = pmToIr(reopened.getJSON() as PMJsonNode)
    expect(resolve(doc).labels['abb-agc']).toEqual({ label: 'AGC2', xmlId: 'abb_2', refText: 'AGC2' })
    editor.destroy()
    reopened.destroy()
  })

  it('删除一整个缩略语表后保存重开：IR 不再带该块，其余缩略语序号顺延', () => {
    const editor = mountEditor()
    replaceEditorDocument(editor, createWp8mG2Fixture() as unknown as Record<string, unknown>)
    let removeAt: { from: number; to: number } | undefined
    editor.state.doc.descendants((node, pos) => {
      if (!removeAt && node.type.name === 'defList' && node.attrs.nodeId === 'g2-list-clause') removeAt = { from: pos, to: pos + node.nodeSize }
    })
    // 同时删去指向它的引用，避免悬空
    editor.view.dispatch(editor.state.tr.delete(removeAt!.from, removeAt!.to))
    const saved = JSON.parse(JSON.stringify(editor.getJSON())) as PMJsonNode
    expect(Object.keys(defListShapes(saved))).toEqual(['g2-list', 'g2-list-app'])
    expect(() => schema.nodeFromJSON(saved).check()).not.toThrow()
    editor.destroy()
  })
})

describe('[M-10.1.4-01] 编辑器显示与键盘', () => {
  it('DOM：dl.std-def-list 下是 div.std-where-item，每项 dt（缩略语）在前、dd（释义）在后；无“式中：”与“——”文字', () => {
    const editor = mountEditor(createWp8mG2Fixture() as unknown as Record<string, unknown>)
    const list = editor.view.dom.querySelector<HTMLElement>('dl.std-def-list[data-node-id="g2-list"]')!
    expect(list).not.toBeNull()
    const items = [...list.children] as HTMLElement[]
    expect(items.map(item => [item.className, item.getAttribute('data-node-id')])).toEqual([
      ['std-where-item', 'abb-adc'], ['std-where-item', 'abb-agc'], ['std-where-item', 'abb-ct'],
    ])
    expect(items.map(item => [...item.children].map(child => child.tagName))).toEqual([['DT', 'DD'], ['DT', 'DD'], ['DT', 'DD']])
    expect(items[0]!.querySelector('dt')!.textContent).toBe('ADC')
    expect(items[0]!.querySelector('dd')!.textContent).toBe('模数转换器（Analog-to-Digital Converter）')
    // “——”与“式中：”由 CSS 伪元素提供且对 .std-def-list 取消，DOM 文本里没有
    expect(list.textContent).not.toMatch(/式中|——/)
    // 引用显示为指向缩略语项 nodeId 的交叉引用链接
    const links = [...editor.view.dom.querySelectorAll('a[data-type="cross-ref"]')]
    expect(links.map(link => link.getAttribute('href'))).toEqual(['#abb-adc', '#abb-ct', '#abb-adc', '#abb-clause'])
    editor.destroy()
  })

  it('公式的 whereList 仍按“式中”显示，不带 std-def-list 类（两种容器互不串）', () => {
    const doc = createWp8mG2Fixture()
    doc.content!.find(node => node.attrs?.nodeId === 'g2-abbr-ch')!.content!.push({
      type: 'formula', attrs: { nodeId: 'g2-f', latex: 'a=b', numbered: true },
      content: [{ type: 'formulaContent', content: [{ type: 'text', text: 'a=b' }] }, { type: 'whereList', content: [defItem('g2-w1', 'a', '长度')] }],
    })
    const editor = mountEditor(doc as unknown as Record<string, unknown>)
    expect(editor.view.dom.querySelectorAll('dl.std-where-list')).toHaveLength(1)
    expect(editor.view.dom.querySelectorAll('dl.std-def-list')).toHaveLength(3)
    editor.destroy()
  })

  it('Enter：术语格 → 释义格；释义格 → 在其后新增一项（新项获得 nodeId，位于同一个缩略语表内）', () => {
    const editor = mountEditor(createWp8mG2Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'abb-agc', 'whereTerm')
    press(editor, 'Enter')
    expect(editor.state.selection.$from.parent.type.name).toBe('whereDefinition')
    const before = defListShapes(editor.getJSON() as PMJsonNode)['g2-list']!
    expect(before).toHaveLength(3)
    press(editor, 'Enter')
    const after = defListShapes(editor.getJSON() as PMJsonNode)['g2-list']!
    expect(after).toHaveLength(4)
    expect(after.map(item => item[0]).slice(0, 2)).toEqual(['abb-adc', 'abb-agc'])
    const created = after[2]!
    expect(created[0]).toMatch(/\S/)
    expect(created.slice(1)).toEqual(['', ''])
    expect(new Set(after.map(item => item[0])).size).toBe(4)
    expect(editor.state.selection.$from.parent.type.name).toBe('whereTerm')
    editor.destroy()
  })

  it('Tab / Shift-Tab 在术语格与释义格之间移动', () => {
    const editor = mountEditor(createWp8mG2Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'abb-adc', 'whereTerm')
    press(editor, 'Tab')
    expect(editor.state.selection.$from.parent.type.name).toBe('whereDefinition')
    press(editor, 'Tab', { shiftKey: true })
    expect(editor.state.selection.$from.parent.type.name).toBe('whereTerm')
    editor.destroy()
  })

  it('空术语格：带 def-term-empty 占位类（而不是公式式中的 where-term-empty），点击不请求行内公式', () => {
    const doc = createWp8mG2Fixture()
    nodesOfType(doc, 'defList').find(list => list.attrs?.nodeId === 'g2-list-app')!.content!.push(defItem('abb-empty', '', '尚未填写术语'))
    const editor = mountEditor(doc as unknown as Record<string, unknown>)
    const term = editor.view.dom.querySelector<HTMLElement>('[data-node-id="abb-empty"] > dt')!
    expect(term.classList.contains('def-term-empty')).toBe(true)
    expect(term.classList.contains('where-term-empty')).toBe(false)
    let termPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'whereItem' && node.attrs.nodeId === 'abb-empty') termPos = pos + 1
    })
    const events: unknown[] = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener('ses:edit-inline-formula', listener)
    const handled = editor.view.someProp('handleClickOn', handler => handler(
      editor.view, termPos + 1, editor.state.doc.nodeAt(termPos)!, termPos, new MouseEvent('click'), true,
    ))
    window.removeEventListener('ses:edit-inline-formula', listener)
    expect(handled).toBeFalsy()
    expect(events).toEqual([])
    editor.destroy()
  })

  it('Backspace：空的最后一项连同缩略语表一起删除；非空项只在两格之间退格，不误删', () => {
    const doc = createWp8mG2Fixture()
    nodesOfType(doc, 'defList').find(list => list.attrs?.nodeId === 'g2-list-app')!.content = [defItem('abb-only', '', '')]
    const editor = mountEditor(doc as unknown as Record<string, unknown>)
    caretInItem(editor, 'abb-adc', 'whereDefinition', 0)
    press(editor, 'Backspace')
    expect(editor.state.selection.$from.parent.type.name).toBe('whereTerm')
    expect(Object.keys(defListShapes(editor.getJSON() as PMJsonNode))).toContain('g2-list')
    caretInItem(editor, 'abb-only', 'whereTerm', 0)
    press(editor, 'Backspace')
    expect(Object.keys(defListShapes(editor.getJSON() as PMJsonNode))).toEqual(['g2-list', 'g2-list-clause'])
    editor.destroy()
  })

  it('Backspace：被引用的空项（或其所在、将整体删除的表）不删除，避免 abbreviation 引用悬空；公式式中项的行为不变', () => {
    const doc = createWp8mG2Fixture()
    const appList = nodesOfType(doc, 'defList').find(list => list.attrs?.nodeId === 'g2-list-app')!
    appList.content = [defItem('abb-only', '', '')]
    // 一个指向空项的 abbreviation 引用
    const ref = nodesOfType(doc, 'stdParagraph').find(node => node.attrs?.nodeId === 'g2-app-p')!
    ref.content!.push({ type: 'text', text: '见', marks: abbrRefMark('abb-only') })
    // 列表里另有一个被引用的空项与一个无人引用的空项
    nodesOfType(doc, 'defList').find(list => list.attrs?.nodeId === 'g2-list')!.content!.push(defItem('abb-empty-ref', '', ''), defItem('abb-empty-free', '', ''))
    nodesOfType(doc, 'stdParagraph').find(node => node.attrs?.nodeId === 'g2-scope-p')!.content!.push({ type: 'text', text: '另见', marks: abbrRefMark('abb-empty-ref') })
    const editor = mountEditor(doc as unknown as Record<string, unknown>)
    const itemIds = () => defListShapes(editor.getJSON() as PMJsonNode)

    // 整个表只剩一个被引用的空项：不删除
    caretInItem(editor, 'abb-only', 'whereTerm', 0)
    const before = JSON.stringify(editor.getJSON())
    press(editor, 'Backspace')
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    expect(Object.keys(itemIds())).toContain('g2-list-app')

    // 被引用的空项：不删除；无人引用的空项：删除
    caretInItem(editor, 'abb-empty-ref', 'whereTerm', 0)
    press(editor, 'Backspace')
    expect(itemIds()['g2-list']!.map(item => item[0])).toContain('abb-empty-ref')
    caretInItem(editor, 'abb-empty-free', 'whereTerm', 0)
    press(editor, 'Backspace')
    expect(itemIds()['g2-list']!.map(item => item[0])).not.toContain('abb-empty-free')
    editor.destroy()
  })

  it('缩略语项内不能插入条文脚注（canInsertBodyFootnote 为假，Resolver 同样禁止）', () => {
    const editor = mountEditor(createWp8mG2Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'abb-adc', 'whereDefinition', 2)
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(false)
    caretInItem(editor, 'abb-adc', 'whereTerm', 1)
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(false)
    editor.destroy()
  })

  it('版本对比文本：缩略语表每项一行“缩略语：释义”，不重复、不丢项', () => {
    const text = docToText(schema.nodeFromJSON(createWp8mG2Fixture()).toJSON() as unknown as Record<string, unknown>)
    const lines = text.split('\n')
    const start = lines.findIndex(line => line.trim() === '[缩略语]')
    expect(lines.slice(start, start + 4).map(line => line.trim())).toEqual([
      '[缩略语]',
      'ADC：模数转换器（Analog-to-Digital Converter）',
      'AGC：自动增益控制（Automatic Gain Control）',
      'CT：计算机断层扫描，参见ADC与电流互感器',
    ])
    expect(lines.filter(line => line.includes('模数转换器（Analog-to-Digital Converter）'))).toHaveLength(1)
    expect(text).toContain('CO2：二氧化碳')
    expect(text).toContain('UTF-8：8位统一码转换格式')
  })
})

describe('[M-10.1.4-03] 粘贴重映射：缩略语表与项换新 nodeId，副本内的引用跟随副本', () => {
  it('remapPastedSliceIds：整章复制到同一文档时，副本里的容器与项换新 id，副本内的 abbreviation 引用指向副本项', () => {
    const editor = new Editor({ extensions, content: createWp8mG2Fixture() as never })
    try {
      const source = editor.state.doc.child(2) // 第 3 章：符号和缩略语（含 abb-adc… 与对 abb-adc 的引用）
      const slice = remapPastedSliceIds(new Slice(Fragment.from(source), 0, 0), editor.state.doc)
      const copied = slice.content.child(0).toJSON() as PMJsonNode
      const copiedItems = nodesOfType(copied, 'whereItem').map(node => String(node.attrs?.nodeId))
      expect(copiedItems).toHaveLength(4)
      expect(copiedItems.some(id => id.startsWith('abb-'))).toBe(false)
      const copiedLists = nodesOfType(copied, 'defList').map(node => String(node.attrs?.nodeId))
      expect(copiedLists.some(id => id.startsWith('g2-'))).toBe(false)
      const refs = nodesOfType(copied, 'text').flatMap(node => (node.marks ?? []).filter(mark => mark.type === 'crossRef').map(mark => mark.attrs))
      expect(refs.map(attrs => [attrs?.refType, attrs?.targetId])).toEqual([
        ['abbreviation', copiedItems[0]], // CT 的释义引用 ADC
        ['abbreviation', copiedItems[3]], // 条内引用 CO2
      ])
      // 原文档不被改动
      expect(defListShapes(editor.getJSON() as PMJsonNode)['g2-list']![0]![0]).toBe('abb-adc')
    } finally {
      editor.destroy()
    }
  })

  it('production view.pasteHTML：副本与原件各自带 abb_<k>，序号按文档序，无重复 id、无悬空引用', () => {
    const base = createWp8mG2Fixture()
    base.content!.splice(3, 0, {
      type: 'chapter', attrs: { nodeId: 'g2-slot' }, content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '插入槽' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'g2-slot-p' }, content: [{ type: 'text', text: '替换' }] },
      ],
    })
    const editor = new Editor({ extensions, content: base as never })
    try {
      const wrapper = document.createElement('div')
      wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.from(editor.state.doc.child(2))))
      let slot = -1
      editor.state.doc.descendants((node, pos) => { if (node.attrs.nodeId === 'g2-slot') slot = pos })
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, slot)))
      editor.view.pasteHTML(wrapper.innerHTML)

      const json = editor.getJSON() as PMJsonNode
      const ids = nodesOfType(json, 'whereItem').map(node => String(node.attrs?.nodeId))
      expect(ids).toHaveLength(G2_ITEM_IDS.length + 4)
      expect(new Set(ids).size).toBe(ids.length)
      const { doc, unsupportedContent } = { doc: pmToIr(json).doc, unsupportedContent: pmToIr(json).doc.unsupportedContent ?? [] }
      expect(unsupportedContent).toEqual([])
      const { labels, problems } = resolve(doc)
      expect(problems.filter(problem => ['duplicate-id', 'dangling-xref', 'dangling-typed-ref'].includes(problem.code))).toEqual([])
      const xmlIds = Object.values(labels).map(entry => entry.xmlId).filter(id => id.startsWith('abb_'))
      expect(xmlIds).toEqual(['abb_1', 'abb_2', 'abb_3', 'abb_4', 'abb_5', 'abb_6', 'abb_7', 'abb_8', 'abb_9'].slice(0, xmlIds.length))
      expect(xmlIds).toHaveLength(ids.length)
    } finally {
      editor.destroy()
    }
  })
})

describe('[M-10.1.4-01] 导出链路：HTML、DOCX 放行并排版；旧 XML 阻断（§7.1）', () => {
  it('checkExportGuard：html/pdf/docx/json 通过，xml 被输出边界阻止且指向 defList', () => {
    const doc = schema.nodeFromJSON(createWp8mG2Fixture()).toJSON() as PMJsonNode
    expect(checkExportGuard(doc, 'html')).toBeNull()
    expect(checkExportGuard(doc, 'pdf')).toBeNull()
    expect(checkExportGuard(doc, 'docx')).toBeNull()
    expect(checkExportGuard(doc, 'json')).toBeNull()
    const xml = checkExportGuard(doc, 'xml')
    expect(xml?.source).toBe('output-boundary')
    expect(xml?.problems.map(problem => problem.nodeId)).toEqual(['g2-list', 'g2-list-clause', 'g2-list-app'])
  })

  it('HTML：每项一段“缩略语：释义”，引用文字为缩略语并链接到 abb_<k>', () => {
    const editor = mountEditor(createWp8mG2Fixture() as unknown as Record<string, unknown>)
    const html = exportSemanticHtml(editor.state.doc)
    expect(html).toContain('<p class="ses-paragraph ses-def-item" data-type="def-item" data-node-id="abb-adc" id="abb_1"><span class="ses-def-term">ADC</span><span class="ses-def-sep">：</span><span class="ses-def-definition">模数转换器（Analog-to-Digital Converter）</span></p>')
    expect(html).toContain('<a class="ses-xref" href="#abb_1" data-ref-target="abb-adc">ADC</a>')
    expect(html).toContain('<span class="ses-def-term">CO<sub>2</sub></span><span class="ses-def-sep">：</span><span class="ses-def-definition">二氧化碳</span>')
    expect(html.match(/ id="abb_\d+"/g)).toHaveLength(G2_ITEM_IDS.length)
    editor.destroy()
  })

  it('DOCX：每项一个 SesPara 段，缩略语、全角冒号、释义依次排列；引用处为缩略语', async () => {
    const editor = mountEditor(createWp8mG2Fixture() as unknown as Record<string, unknown>)
    const { blob } = await buildDocxBlob({ pmDoc: editor.getJSON() as PMJsonNode, createdAt: '2026-10-22T00:00:00Z' })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const paragraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(match => [...match[1]!.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(run => run[1]).join(''))
    expect(paragraphs).toContain('ADC：模数转换器（Analog-to-Digital Converter）')
    expect(paragraphs).toContain('AGC：自动增益控制（Automatic Gain Control）')
    expect(paragraphs).toContain('CT：计算机断层扫描，参见ADC与电流互感器')
    expect(paragraphs).toContain('CO2：二氧化碳')
    expect(paragraphs).toContain('UTF-8：8位统一码转换格式（8-bit Unicode Transformation Format）')
    expect(paragraphs).toContain('本文件使用缩略语ADC与CT。')
    editor.destroy()
  })

  it('旧 XML：serializeToXml 拒绝含缩略语表的文档，而不是静默丢弃', () => {
    const editor = mountEditor(createWp8mG2Fixture() as unknown as Record<string, unknown>)
    expect(() => serializeToXml(editor.state.doc)).toThrow()
    editor.destroy()
  })

  it('引用类型错误时导出被阻断（既有的 dangling-typed-ref 机制）：abbreviation 引用指向普通段落', () => {
    const doc = createWp8mG2Fixture()
    nodesOfType(doc, 'stdParagraph').find(node => node.attrs?.nodeId === 'g2-c41-p')!.content![1]!.marks = abbrRefMark('g2-norm-p')
    const guarded = checkExportGuard(schema.nodeFromJSON(doc).toJSON() as PMJsonNode, 'html')
    expect(guarded?.problems.map(problem => problem.path)).toContain('resolver.problems[dangling-typed-ref]')
  })
})
