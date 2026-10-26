// @vitest-environment happy-dom
/**
 * WP8.M G3：图——图例 legend、行内图 inline-graphic、图注、图中示例（M-8.5-01～06、M-8.3-02、M-8.2-11、M-8.4-03）——
 * 生产 Schema / client 层。
 *
 * 设计 §3.6 四类用例：Schema、往返（PM → IR → PM）、HTML 往返、保存重开（Editor + replaceEditorDocument +
 * exportSemanticJson）。另覆盖编辑器显示、键盘（图例项与公式“式中”、缩略语共用项节点的 Enter/Tab/Backspace）、
 * 粘贴重映射、版本对比文本、导出链路（设计 §7.1：图例、图中示例、行内图本阶段不排版，HTML/PDF/DOCX/XML 一律阻断；
 * 图注 figure.notes 放行，HTML/DOCX 排版，旧 XML 序列化器拒绝而不是悄悄丢掉）。
 * shared 层的映射、Resolver、边界与排版细节见 shared 的 wp8mG3*.test.ts。
 */

import JSZip from 'jszip'
import { Editor, getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer, Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { checkExportGuard } from '@ses/io'
import { irToPm, pmToIr, resolve, UnsupportedOutputError, type IRDoc, type IRFigure, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'
import {
  G3_EXPECTED_NOTE_LABELS, G3_INLINE_PNG, createWp8mG3Fixture, figure, figureExample, figureLegend, figureNote, inlineImage, legendItem,
} from './__fixtures__/wp8m-g3'
import { Figure } from './nodes/figure'
import { canInsertBodyFootnote } from './nodes/footnotes'
import { NODE_ID_TYPES, remapPastedSliceIds } from './plugins/ensureNodeId'
import { buildDocxBlob } from '../serializer/docxExporter'
import { exportSemanticHtml } from '../serializer/htmlExporter'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { serializeToXml } from '../serializer/xmlSerializer'
import { docToText } from '../utils/docDiff'
import { replaceEditorDocument } from '../utils/editorDocument'
import { setClauseFormat, setListFormat, setParagraphFormat } from '../utils/structureEditing'

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

function byId(root: PMJsonNode, type: string, nodeId: string): PMJsonNode {
  const found = nodesOfType(root, type).find(node => node.attrs?.nodeId === nodeId)
  if (!found) throw new Error(`找不到 ${type}#${nodeId}`)
  return found
}

function textOf(node: PMJsonNode | undefined): string {
  if (!node) return ''
  if (node.text !== undefined) return node.text
  return (node.content ?? []).map(textOf).join('')
}

/** nodeId → 图的形状：图例（容器 id、标题、[项 id, 符号, 释义]）、注 [id, 文本]、示例 [id, 文本]。 */
function figureShapes(root: PMJsonNode): Record<string, unknown> {
  const shapes: Record<string, unknown> = {}
  for (const figureNode of nodesOfType(root, 'figure')) {
    const legend = figureNode.content?.find(child => child.type === 'figureLegend')
    shapes[String(figureNode.attrs?.nodeId)] = {
      children: (figureNode.content ?? []).map(child => child.type),
      legend: legend ? {
        id: legend.attrs?.nodeId,
        title: legend.content?.some(child => child.type === 'figureLegendTitle') ? textOf(legend.content.find(child => child.type === 'figureLegendTitle')) : null,
        items: (legend.content ?? []).filter(child => child.type === 'whereItem').map(item => [
          item.attrs?.nodeId,
          textOf(item.content?.find(cell => cell.type === 'whereTerm')),
          textOf(item.content?.find(cell => cell.type === 'whereDefinition')),
        ]),
      } : null,
      notes: (figureNode.content ?? []).filter(child => child.type === 'note').map(note => [note.attrs?.nodeId, textOf(note)]),
      examples: (figureNode.content ?? []).filter(child => child.type === 'example').map(example => [example.attrs?.nodeId, textOf(example)]),
    }
  }
  return shapes
}

/** 全部行内图的属性（文档序）。 */
const imagesOf = (root: PMJsonNode) => nodesOfType(root, 'inlineImage').map(node => node.attrs)

function irFigures(doc: IRDoc): IRFigure[] {
  const found: IRFigure[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (row.kind === 'figure') found.push(row as unknown as IRFigure)
    Object.values(row).forEach(walk)
  }
  walk(doc.body)
  walk(doc.appendices)
  return found
}

/**
 * 比较“经 IR 再写回”的文档与原文档时剔除与 G3 无关的既有差异：chapter.secType、Tiptap 补的末尾空段，
 * 以及表格（IR → PM 会补 headerRowCount、把单元格的 paragraph 规范成 stdParagraph——表格的既有行为；
 * 表格单元格里的行内图另由 imagesOf 逐属性比较）。
 */
function withoutSecType(root: PMJsonNode): PMJsonNode {
  const copy = structuredClone(root)
  visit(copy, node => {
    if (node.attrs && 'secType' in node.attrs) delete node.attrs.secType
    if (node.content) node.content = node.content.filter(child => child.type !== 'stdTable')
  })
  copy.content = (copy.content ?? []).filter(node => !(node.type === 'paragraph' && !node.content?.length))
  return copy
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

/** 光标放进 nodeId 所属图例项的符号格或释义格（offset 为格内偏移，默认末尾）。 */
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
  if (target === undefined) throw new Error(`找不到图例项 ${itemId}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)))
}

/** 光标放进图例标题的末尾。 */
function caretInLegendTitle(editor: Editor, legendId: string): void {
  let target: number | undefined
  editor.state.doc.descendants((node, pos) => {
    if (target !== undefined) return false
    if (node.type.name === 'figureLegend' && node.attrs.nodeId === legendId) {
      target = pos + 1 + 1 + node.child(0).content.size
      return false
    }
    return true
  })
  if (target === undefined) throw new Error(`找不到图例 ${legendId}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)))
}

function mountEditor(content: Record<string, unknown> | string = '<p></p>'): Editor {
  const editor = new Editor({ extensions, content: content as never })
  editor.mount(document.createElement('div'))
  return editor
}

/** 把 nodeId 为 legendId 的图例放进只含它的最小文档（用于不受其余内容影响的键盘用例）。 */
function legendOnlyDoc(legend: PMJsonNode): PMJsonNode {
  return {
    type: 'doc', content: [{
      type: 'chapter', attrs: { nodeId: 'k-ch' }, content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '章' }] },
        figure('k-fig', '图', legend),
      ],
    }],
  }
}

describe('[M-8.5-01] 生产 Schema：figure 尾部追加 figureLegend? note* example*，图例节点与行内图', () => {
  it('fixture 通过 Schema 校验；figure 表达式在旧表达式之后追加，节点登记 nodeId 类型', () => {
    const root = schema.nodeFromJSON(createWp8mG3Fixture())
    expect(() => root.check()).not.toThrow()
    expect(schema.nodes.figure!.spec.content).toBe('figureImage figureCaption figureCaptionEn? figureDescription* figureGroup* figureLegend? note* example*')
    expect(schema.nodes.figureLegend!.spec.content).toBe('figureLegendTitle? whereItem+')
    expect(schema.nodes.figureLegendTitle!.spec.content).toBe('inline*')
    // 容器与项带 nodeId（项复用 whereItem，P8）；标题与行内图没有
    expect(NODE_ID_TYPES).toContain('figureLegend')
    expect(NODE_ID_TYPES).toContain('whereItem')
    expect(NODE_ID_TYPES).not.toContain('figureLegendTitle')
    expect(NODE_ID_TYPES).not.toContain('inlineImage')
    expect(schema.nodes.figureLegend!.spec.group).toBeUndefined()
    expect(schema.nodes.inlineImage!.spec).toMatchObject({ group: 'inline', inline: true, atom: true, selectable: true })
    expect(Object.keys(schema.nodes.inlineImage!.spec.attrs ?? {}).sort()).toEqual(['alt', 'resourceId', 'size', 'src'])
  })

  it('扩展追加在 createEditorExtensions() 中 inlineFormulaEditing 之后，连续且按序（P3）；block 组默认填充节点与此前一致', () => {
    const names = extensions.map(extension => extension.name)
    // 多个 WP8.M 组都追加在末尾，G3 的三个扩展不一定是最后：P3 要求的是排在全部既有扩展之后，且本组三个扩展连续、按序。
    const start = names.indexOf('figureLegend')
    expect(start).toBeGreaterThan(names.indexOf('inlineFormulaEditing'))
    expect(names.slice(start, start + 3)).toEqual(['figureLegend', 'figureLegendTitle', 'inlineImage'])
    // 基线：figure 用旧内容表达式、不含 G3 三个扩展；其余扩展（含其它组追加者）不变。block 组默认填充节点不应因 G3 改变。
    const baseline = getSchema(extensions
      .filter(extension => !['figureLegend', 'figureLegendTitle', 'inlineImage'].includes(extension.name))
      .map(extension => extension.name === 'figure'
        ? Figure.extend({ content: 'figureImage figureCaption figureCaptionEn? figureDescription* figureGroup*' })
        : extension))
    for (const name of ['doc', 'chapter', 'clause', 'appendix', 'foreword', 'introduction', 'figure']) {
      expect(schema.nodes[name]!.createAndFill()?.toJSON(), name).toEqual(baseline.nodes[name]!.createAndFill()?.toJSON())
    }
    const order = Object.keys(schema.nodes)
    expect(order.indexOf('figureLegend')).toBeGreaterThan(order.indexOf('termSubjectField'))
    expect(order.indexOf('inlineImage')).toBeGreaterThan(order.indexOf('formulaInline'))
  })

  it('旧文档仍然合法：WP6 fixture 与没有图例 / 图注 / 示例的旧图无需迁移', () => {
    expect(() => schema.nodeFromJSON(createWp6Fixture()).check()).not.toThrow()
    const legacy: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, figure('f', '旧图')] }] }
    expect(() => schema.nodeFromJSON(legacy).check()).not.toThrow()
  })

  it('非法结构被 Schema 拒绝：图例位置、顺序、空图例、双标题、游离子节点', () => {
    const chapterOf = (...children: PMJsonNode[]): PMJsonNode => ({
      type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, ...children] }],
    })
    const legend = () => figureLegend('lg', '图例', legendItem('i1', 'a', '甲'))
    const note = () => figureNote('n1', '注')
    const example = () => figureExample('e1', '例')
    const bare = (...extra: PMJsonNode[]): PMJsonNode => {
      const base = figure('f', '图')
      return { ...base, content: [...base.content!.slice(0, 2), ...extra] }
    }
    // 合法：图例 → 注 → 示例
    expect(() => schema.nodeFromJSON(chapterOf(bare(legend(), note(), example()))).check()).not.toThrow()
    // 注在图例之前、示例在注之前、两个图例：拒绝
    expect(() => schema.nodeFromJSON(chapterOf(bare(note(), legend()))).check()).toThrow()
    expect(() => schema.nodeFromJSON(chapterOf(bare(example(), note()))).check()).toThrow()
    expect(() => schema.nodeFromJSON(chapterOf(bare(legend(), figureLegend('lg2', null, legendItem('i2', 'b', '乙'))))).check()).toThrow()
    // 空图例、只有标题的图例、两个标题、非项子节点：拒绝
    expect(() => schema.nodeFromJSON(chapterOf(bare({ type: 'figureLegend', attrs: { nodeId: 'lg' }, content: [] }))).check()).toThrow()
    expect(() => schema.nodeFromJSON(chapterOf(bare({ type: 'figureLegend', attrs: { nodeId: 'lg' }, content: [{ type: 'figureLegendTitle' }] }))).check()).toThrow()
    expect(() => schema.nodeFromJSON(chapterOf(bare({ type: 'figureLegend', attrs: { nodeId: 'lg' }, content: [{ type: 'figureLegendTitle' }, { type: 'figureLegendTitle' }, legendItem('i1', 'a', '甲')] }))).check()).toThrow()
    expect(() => schema.nodeFromJSON(chapterOf(bare({ type: 'figureLegend', attrs: { nodeId: 'lg' }, content: [legendItem('i1', 'a', '甲'), { type: 'stdParagraph', attrs: { nodeId: 'x' } }] }))).check()).toThrow()
    // 图例只能在 figure 内：直接放进章 / 放进公式 whereList / 放进缩略语表：拒绝
    expect(() => schema.nodeFromJSON(chapterOf(legend())).check()).toThrow()
  })

  it('行内图是行内原子：能放在文本块里，不能直接放在块级容器里；没有内容', () => {
    const ok: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, { type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [inlineImage()] }] }] }
    expect(() => schema.nodeFromJSON(ok).check()).not.toThrow()
    const bad: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, inlineImage()] }] }
    expect(() => schema.nodeFromJSON(bad).check()).toThrow()
    const withContent: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, { type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [{ ...inlineImage(), content: [{ type: 'text', text: '多余' }] }] }] }] }
    expect(() => schema.nodeFromJSON(withContent).check()).toThrow()
  })

  it('行内图可放进段落、列项、注、表格单元格；默认属性：src 空串、alt 空串、resourceId / size 为 null', () => {
    const root = schema.nodeFromJSON(createWp8mG3Fixture())
    root.check()
    const parents = new Set<string>()
    root.descendants((node, _pos, parent) => { if (node.type.name === 'inlineImage') parents.add(parent!.type.name) })
    expect([...parents].sort()).toEqual(['note', 'paragraph', 'stdListItem', 'stdParagraph'])
    expect(schema.nodes.inlineImage!.create().attrs).toEqual({ src: '', resourceId: null, alt: '', size: null })
  })
})

describe('[M-8.5-01][M-8.5-02][M-8.5-03][M-8.5-04][M-8.5-05][M-8.5-06][M-8.3-02][M-8.2-11][M-8.4-03] 往返：生产 PM → IR → Resolver → PM', () => {
  it('pmToIr 无告警：图例 / 图注 / 示例 / 行内图都读进 IR，extensionVersion=1', () => {
    const fixture = schema.nodeFromJSON(createWp8mG3Fixture()).toJSON() as PMJsonNode
    const { doc, warnings } = pmToIr(fixture)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    expect(doc.extensionVersion).toBe(1)
    const [fig1, fig2, figA] = irFigures(doc)
    expect(fig1!.legend).toMatchObject({ id: 'g3-legend-1', title: [{ text: '图例' }] })
    expect(fig1!.legend!.items.map(item => item.id)).toEqual(['g3-lg-1', 'g3-lg-2', 'g3-lg-3'])
    expect(fig1!.notes.map(note => note.id)).toEqual(['g3-fig1-n1', 'g3-fig1-n2'])
    expect(fig1!.examples?.map(example => example.id)).toEqual(['g3-fig1-e1'])
    expect(fig2!.legend).toBeUndefined()
    expect(figA!.legend?.title).toBeUndefined()
  })

  it('Resolver 无 error；图注 / 示例按“作用域 = 本图”编号，图例项不赋标签；不出现 ext_ 占位', () => {
    const { doc } = pmToIr(createWp8mG3Fixture())
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    for (const [id, expected] of Object.entries(G3_EXPECTED_NOTE_LABELS)) {
      expect(labels[id], id).toMatchObject({ label: expected.label, xmlId: expected.xmlId })
    }
    for (const id of ['g3-legend-1', 'g3-lg-1', 'g3-lg-2', 'g3-lg-3', 'g3-legend-a1', 'g3-lg-a1']) expect(labels[id], id).toBeUndefined()
    // 文档级资源（figureResource）本就由通用扫描给 ext_ 占位标签（WP6 起的既有行为）；G3 的结构一个都不应落到占位标签。
    expect(Object.entries(labels).filter(([id, entry]) => entry.xmlId.startsWith('ext_') && id !== 'g3-res-1')).toEqual([])
    expect(['g3-fig-1', 'g3-fig-2', 'g3-fig-a1'].map(id => labels[id]!.label)).toEqual(['图1', '图2', '图A.1'])
  })

  it('IR → PM 通过 Schema 校验；图例、注、示例的形状与行内图属性与原文档逐项一致，再经 JSON 冷重开后 IR 深度相等', () => {
    const original = schema.nodeFromJSON(createWp8mG3Fixture())
    original.check()
    const first = pmToIr(original.toJSON() as PMJsonNode)
    const rewritten = irToPm(first.doc)
    const projected = schema.nodeFromJSON(rewritten)
    projected.check()
    expect(figureShapes(projected.toJSON() as PMJsonNode)).toEqual(figureShapes(original.toJSON() as PMJsonNode))
    expect(imagesOf(projected.toJSON() as PMJsonNode)).toEqual(imagesOf(original.toJSON() as PMJsonNode))
    // 图例 / 图注 / 示例 / 项的 nodeId 与引用逐属性保持
    const attrsOf = (root: PMJsonNode) => ['figureLegend', 'whereItem', 'note', 'example'].flatMap(type => nodesOfType(root, type).map(node => [node.type, node.attrs]))
    expect(attrsOf(projected.toJSON() as PMJsonNode)).toEqual(attrsOf(original.toJSON() as PMJsonNode))
    const refsOf = (root: PMJsonNode) => nodesOfType(root, 'text').flatMap(node => (node.marks ?? []).filter(mark => mark.type === 'crossRef').map(mark => mark.attrs))
    expect(refsOf(projected.toJSON() as PMJsonNode)).toEqual(refsOf(original.toJSON() as PMJsonNode))
    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(projected.toJSON())) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(first.doc)
  })

  it('行内图的 resourceId 经往返保留，且指向文档级 figureResource（无 dangling-resource）', () => {
    const { doc } = pmToIr(createWp8mG3Fixture())
    expect(doc.resources?.map(resource => resource.id)).toEqual(['g3-res-1'])
    expect(resolve(doc).problems.filter(problem => problem.code === 'dangling-resource')).toEqual([])
    const rewritten = irToPm(doc)
    expect(imagesOf(rewritten).map(attrs => attrs?.resourceId)).toEqual([null, 'g3-res-1', null, null, null, null])
    expect(imagesOf(rewritten).map(attrs => attrs?.size)).toEqual(['M', 'S', null, 'L', null, 'S'])
  })

  it('行内图位置规则（Resolver）：标题 / 图题 / 图例里的行内图报 unsupported-content；段落、列项、注、单元格里的不报', () => {
    const doc = createWp8mG3Fixture()
    expect(resolve(pmToIr(doc).doc).problems.filter(problem => problem.code === 'unsupported-content')).toEqual([])
    const inTitle = structuredClone(doc)
    byId(inTitle, 'chapter', 'g3-scope').content![0]!.content!.push(inlineImage())
    byId(inTitle, 'figure', 'g3-fig-2').content![1]!.content!.push(inlineImage())
    byId(inTitle, 'whereItem', 'g3-lg-1').content![0]!.content!.push(inlineImage())
    // Schema 允许（inline*），由 Resolver 把关
    expect(() => schema.nodeFromJSON(inTitle).check()).not.toThrow()
    const problems = resolve(pmToIr(inTitle).doc).problems.filter(problem => problem.code === 'unsupported-content')
    expect(problems.map(problem => problem.nodeId).sort()).toEqual(['g3-fig-2', 'g3-lg-1', 'g3-scope'].sort())
  })

  it('图例项内的条文脚注：Schema 不会给出入口（canInsertBodyFootnote 为假），Resolver 同样禁止', () => {
    const doc = createWp8mG3Fixture()
    byId(doc, 'whereItem', 'g3-lg-1').content![1]!.content!.push({ type: 'footnoteRef', attrs: { nodeId: 'g3-fn', content: [{ type: 'text', text: '脚注' }] } })
    const { doc: ir } = pmToIr(doc)
    expect(resolve(ir).problems.some(problem => problem.code === 'invalid-footnote' && problem.nodeId === 'g3-lg-1')).toBe(true)
  })
})

describe('[M-8.5-01][M-8.3-02][M-8.2-11][M-8.4-03] HTML 往返（DOMSerializer / DOMParser 两轮）', () => {
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

  it('renderHTML 带 data-type 与 class：图例 div、标题 p、项沿用 where-item、行内图 img；两轮后结构与属性不变', () => {
    const source = createWp8mG3Fixture()
    const { html, reopened } = roundtripHtml(source)
    const container = document.createElement('div')
    container.innerHTML = html
    const legends = [...container.querySelectorAll('[data-type="figure-legend"]')]
    expect(legends.map(element => [element.tagName, element.getAttribute('data-node-id'), element.classList.contains('std-figure-legend')])).toEqual([
      ['DIV', 'g3-legend-1', true], ['DIV', 'g3-legend-a1', true],
    ])
    expect([...legends[0]!.children].map(child => [child.tagName, child.getAttribute('data-type'), child.getAttribute('data-node-id')])).toEqual([
      ['P', 'figure-legend-title', null], ['DIV', 'where-item', 'g3-lg-1'], ['DIV', 'where-item', 'g3-lg-2'], ['DIV', 'where-item', 'g3-lg-3'],
    ])
    const images = [...container.querySelectorAll('img[data-type="inline-image"]')]
    expect(images).toHaveLength(6)
    expect(images.every(image => image.classList.contains('std-inline-image'))).toBe(true)
    expect(images.map(image => image.getAttribute('data-size'))).toEqual(['M', 'S', null, 'L', null, 'S'])
    expect(images[1]!.getAttribute('resourceid')).toBe('g3-res-1')
    expect(images[0]!.getAttribute('alt')).toBe('箭头')
    // 行内图不会被解析成块级图（figureImage）或 Tiptap 通用 Image
    expect(container.querySelectorAll('img[data-type="figure-image"]')).toHaveLength(3)

    const expected = schema.nodeFromJSON(source).toJSON() as PMJsonNode
    const actual = reopened.toJSON() as PMJsonNode
    expect(figureShapes(actual)).toEqual(figureShapes(expected))
    expect(imagesOf(actual)).toEqual(imagesOf(expected))
    const attrsOf = (root: PMJsonNode) => ['figureLegend', 'whereItem', 'note', 'example'].flatMap(type => nodesOfType(root, type).map(node => [node.type, node.attrs]))
    expect(attrsOf(actual)).toEqual(attrsOf(expected))
  })

  it('图例标题的 p 不会退化成段落，图例的 div 不会被当作通用块；图内 note / example 仍是 note / example', () => {
    const { reopened } = roundtripHtml(createWp8mG3Fixture())
    const json = reopened.toJSON() as PMJsonNode
    expect(nodesOfType(json, 'figureLegend')).toHaveLength(2)
    expect(nodesOfType(json, 'figureLegendTitle')).toHaveLength(1)
    expect(byId(json, 'figure', 'g3-fig-1').content!.map(child => child.type)).toEqual(['figureImage', 'figureCaption', 'figureLegend', 'note', 'note', 'example'])
  })

  it('属性文本不被隐式转型：resourceId / alt 形如 007、true 的字符串保持原样', () => {
    const doc = createWp8mG3Fixture()
    byId(doc, 'stdParagraph', 'g3-scope-p').content![1] = inlineImage({ resourceId: '007', alt: 'true', size: 'S' })
    doc.content!.push({ type: 'figureResource', attrs: { nodeId: '007', mediaType: 'image/png', name: 'a.png', encoding: 'dataUrl', data: G3_INLINE_PNG } })
    const { reopened } = roundtripHtml(doc)
    expect(imagesOf(reopened.toJSON() as PMJsonNode)[0]).toMatchObject({ resourceId: '007', alt: 'true', size: 'S' })
  })
})

describe('[M-8.5-01][M-8.3-02][M-8.2-11][M-8.4-03] 保存重开：Editor + replaceEditorDocument + exportSemanticJson', () => {
  it('加载 → 保存 → 重开：PM JSON 与语义 JSON 都相等，图例 / 图注 / 示例 / 行内图与 nodeId 无损', () => {
    const first = mountEditor()
    expect(replaceEditorDocument(first, createWp8mG3Fixture() as unknown as Record<string, unknown>)).toBe(true)
    expect(first.getJSON().attrs).toMatchObject({ extensionVersion: 1 })
    const saved = JSON.parse(JSON.stringify(first.getJSON())) as PMJsonNode
    const exportedFirst = exportSemanticJson(first.state.doc)

    const second = mountEditor()
    replaceEditorDocument(second, saved as unknown as Record<string, unknown>)
    expect(second.getJSON()).toEqual(first.getJSON())
    expect(exportSemanticJson(second.state.doc)).toEqual(exportedFirst)
    expect(figureShapes(second.getJSON() as PMJsonNode)['g3-fig-1']).toMatchObject({
      children: ['figureImage', 'figureCaption', 'figureLegend', 'note', 'note', 'example'],
      legend: { id: 'g3-legend-1', title: '图例', items: [['g3-lg-1', '1', '主电路'], ['g3-lg-2', '2', '控制器，见图A.1'], ['g3-lg-3', 'Vo', '输出电压']] },
      notes: [['g3-fig1-n1', '图注一。'], ['g3-fig1-n2', '图注二。']],
      examples: [['g3-fig1-e1', '图中示例。']],
    })

    // 经 IR 再写回（等同服务端 documentOps 等路径）后重开，语义 JSON 仍相等。
    const third = mountEditor()
    replaceEditorDocument(third, irToPm(pmToIr(saved).doc) as unknown as Record<string, unknown>)
    expect(withoutSecType(exportSemanticJson(third.state.doc) as unknown as PMJsonNode)).toEqual(withoutSecType(exportedFirst as unknown as PMJsonNode))
    expect(imagesOf(third.getJSON() as PMJsonNode)).toEqual(imagesOf(first.getJSON() as PMJsonNode))
    expect(imagesOf(third.getJSON() as PMJsonNode)).toHaveLength(6)
    const json = JSON.stringify(exportedFirst)
    expect(json).toContain('"type":"figureLegend"')
    expect(json).toContain('"type":"figureLegendTitle"')
    expect(json).toContain('"type":"inlineImage"')
    for (const editor of [first, second, third]) editor.destroy()
  })

  it('旧文档（无图例 / 图注 / 示例 / 行内图）保存重开后语义 JSON 不含这些节点，也不带 extensionVersion', () => {
    const legacy: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, figure('f', '旧图')] }] }
    const editor = mountEditor()
    replaceEditorDocument(editor, legacy as unknown as Record<string, unknown>)
    const json = JSON.stringify(exportSemanticJson(editor.state.doc))
    for (const type of ['figureLegend', 'figureLegendTitle', 'inlineImage']) expect(json).not.toContain(type)
    expect(editor.getJSON().attrs?.extensionVersion ?? null).toBeNull()
    editor.destroy()
  })

  it('编辑图例项后保存重开：新值保留，图例 / 项 nodeId 不变，Resolver 仍不给图例项标签', () => {
    const editor = mountEditor()
    replaceEditorDocument(editor, createWp8mG3Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'g3-lg-1', 'whereDefinition')
    editor.view.dispatch(editor.state.tr.insertText('（含备用）'))
    const saved = JSON.parse(JSON.stringify(editor.getJSON())) as PMJsonNode
    expect((figureShapes(saved)['g3-fig-1'] as { legend: { items: unknown[][] } }).legend.items[0]).toEqual(['g3-lg-1', '1', '主电路（含备用）'])

    const reopened = mountEditor()
    replaceEditorDocument(reopened, saved as unknown as Record<string, unknown>)
    const { doc } = pmToIr(reopened.getJSON() as PMJsonNode)
    expect(resolve(doc).labels['g3-lg-1']).toBeUndefined()
    expect(irFigures(doc)[0]!.legend!.items[0]!.definition.map(run => run.text).join('')).toBe('主电路（含备用）')
    editor.destroy()
    reopened.destroy()
  })

  it('删除一条图注后保存重开：同图其余图注重新编号（注1：/注2： → 注：），示例不受影响', () => {
    const editor = mountEditor()
    replaceEditorDocument(editor, createWp8mG3Fixture() as unknown as Record<string, unknown>)
    let removeAt: { from: number; to: number } | undefined
    editor.state.doc.descendants((node, pos) => {
      if (!removeAt && node.type.name === 'note' && node.attrs.nodeId === 'g3-fig1-n2') removeAt = { from: pos, to: pos + node.nodeSize }
    })
    editor.view.dispatch(editor.state.tr.delete(removeAt!.from, removeAt!.to))
    const saved = JSON.parse(JSON.stringify(editor.getJSON())) as PMJsonNode
    expect(() => schema.nodeFromJSON(saved).check()).not.toThrow()
    const labels = resolve(pmToIr(saved).doc).labels
    expect(labels['g3-fig1-n1']!.label).toBe('注：')
    expect(labels['g3-fig1-e1']!.label).toBe('示例：')
    editor.destroy()
  })
})

describe('[M-8.5-01][M-8.3-02][M-8.2-11][M-8.4-03] 编辑器显示', () => {
  it('图例：div.std-figure-legend 下依次是标题 p 与 where-item（dt 符号在前、dd 释义在后）；无“式中：”与“——”文字', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    const legend = editor.view.dom.querySelector<HTMLElement>('div.std-figure-legend[data-node-id="g3-legend-1"]')!
    expect(legend).not.toBeNull()
    const children = [...legend.children] as HTMLElement[]
    expect(children.map(child => [child.tagName, child.className])).toEqual([
      ['P', 'std-figure-legend-title'], ['DIV', 'std-where-item'], ['DIV', 'std-where-item'], ['DIV', 'std-where-item'],
    ])
    expect(children[0]!.textContent).toBe('图例')
    expect(children.slice(1).map(item => [item.querySelector('dt')!.textContent, item.querySelector('dd')!.textContent])).toEqual([
      ['1', '主电路'], ['2', '控制器，见图A.1'], ['Vo', '输出电压'],
    ])
    expect(legend.textContent).not.toMatch(/式中|——/)
    // 无标题图例：直接是项
    const bare = editor.view.dom.querySelector<HTMLElement>('div.std-figure-legend[data-node-id="g3-legend-a1"]')!
    expect([...bare.children].map(child => child.className)).toEqual(['std-where-item'])
    editor.destroy()
  })

  it('图内顺序：图片 → 图题 → 图例 → 注 → 示例；注标记 注1：/注2：/注：，示例标签 示例：（均来自 Resolver，作用域 = 本图）', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    const fig1 = editor.view.dom.querySelector<HTMLElement>('figure[data-node-id="g3-fig-1"]')!
    expect([...fig1.children].map(child => child.getAttribute('data-type'))).toEqual(['figure-image', 'figure-caption', 'figure-legend', 'note', 'note', 'example'])
    const markers = (figureId: string) => [...editor.view.dom.querySelectorAll<HTMLElement>(`figure[data-node-id="${figureId}"] .std-note-marker`)].map(marker => marker.textContent)
    expect(markers('g3-fig-1')).toEqual(['注1：', '注2：'])
    expect(markers('g3-fig-2')).toEqual(['注：'])
    expect(markers('g3-fig-a1')).toEqual(['注：'])
    const exampleLabel = (id: string) => editor.view.dom.querySelector<HTMLElement>(`[data-node-id="${id}"][data-type="example"]`)!.getAttribute('data-resolved-label')
    expect(exampleLabel('g3-fig1-e1')).toBe('示例：')
    expect(exampleLabel('g3-fig2-e1')).toBe('示例：')
    // 图题的编号标签（图1、图2、图A.1）不受影响
    expect([...editor.view.dom.querySelectorAll<HTMLElement>('figcaption.std-figure-caption')].map(caption => caption.getAttribute('data-resolved-label'))).toEqual(['图1', '图2', '图A.1'])
    editor.destroy()
  })

  it('行内图：img.std-inline-image 是不可编辑的行内原子，data-size 表达 S/M/L，属性 src / alt / resourceid 如实带出', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    const images = [...editor.view.dom.querySelectorAll<HTMLImageElement>('img.std-inline-image')]
    expect(images).toHaveLength(6)
    expect(images.map(image => image.getAttribute('data-size'))).toEqual(['M', 'S', null, 'L', null, 'S'])
    expect(images.every(image => image.getAttribute('src') === G3_INLINE_PNG && image.getAttribute('contenteditable') === 'false')).toBe(true)
    expect(images[0]!.getAttribute('alt')).toBe('箭头')
    expect(images[1]!.getAttribute('resourceid')).toBe('g3-res-1')
    // 位置：段落、列项、章内的注、表格单元格
    const container = (image: HTMLElement) => image.closest('td') ? 'cell' : image.parentElement!.closest('[data-type]')!.getAttribute('data-type')
    expect(images.map(container)).toEqual(['std-paragraph', 'std-paragraph', 'std-paragraph', 'std-list-item', 'note', 'cell'])
    editor.destroy()
  })

  it('旧图（没有 G3 子节点）的 DOM 与此前一致：只有图片与图题', () => {
    const legacy: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, figure('f', '旧图')] }] }
    const editor = mountEditor(legacy as unknown as Record<string, unknown>)
    const fig = editor.view.dom.querySelector<HTMLElement>('figure')!
    expect([...fig.children].map(child => child.getAttribute('data-type'))).toEqual(['figure-image', 'figure-caption'])
    editor.destroy()
  })

  it('图例 / 图注 / 示例内不能插入条文脚注（canInsertBodyFootnote 为假，Resolver 同样禁止）', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'g3-lg-1', 'whereDefinition', 2)
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(false)
    caretInItem(editor, 'g3-lg-1', 'whereTerm', 1)
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(false)
    caretInLegendTitle(editor, 'g3-legend-1')
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(false)
    let notePos = -1
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'note' && node.attrs.nodeId === 'g3-fig1-n1') notePos = pos + 1 })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, notePos + 1)))
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(false)
    // 章内（非图内）的注仍可插入
    let bodyNote = -1
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'note' && node.attrs.nodeId === 'g3-note') bodyNote = pos + 1 })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, bodyNote + 1)))
    expect(canInsertBodyFootnote(editor.state.selection)).toBe(true)
    editor.destroy()
  })
})

describe('[M-8.5-03][M-8.5-04][M-8.5-05][M-8.5-06] 图例项键盘：与公式“式中”、缩略语共用 whereListEditing', () => {
  it('Enter：符号格 → 释义格；释义格 → 在其后新增一项（新项获得 nodeId，位于同一个图例内）', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'g3-lg-2', 'whereTerm')
    press(editor, 'Enter')
    expect(editor.state.selection.$from.parent.type.name).toBe('whereDefinition')
    press(editor, 'Enter')
    const items = (figureShapes(editor.getJSON() as PMJsonNode)['g3-fig-1'] as { legend: { items: unknown[][] } }).legend.items
    expect(items).toHaveLength(4)
    expect(items.map(item => item[0]).slice(0, 2)).toEqual(['g3-lg-1', 'g3-lg-2'])
    expect(items[2]![0]).toMatch(/\S/)
    expect(items[2]!.slice(1)).toEqual(['', ''])
    expect(new Set(items.map(item => item[0])).size).toBe(4)
    expect(editor.state.selection.$from.parent.type.name).toBe('whereTerm')
    expect(() => editor.state.doc.check()).not.toThrow()
    editor.destroy()
  })

  it('Enter：在图例标题里回车进入第一项的符号格，而不是把标题劈成两个（Schema 只允许一个标题）', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    caretInLegendTitle(editor, 'g3-legend-1')
    press(editor, 'Enter')
    expect(editor.state.selection.$from.parent.type.name).toBe('whereTerm')
    expect(editor.state.selection.$from.node(editor.state.selection.$from.depth - 1).attrs.nodeId).toBe('g3-lg-1')
    expect(nodesOfType(editor.getJSON() as PMJsonNode, 'figureLegendTitle')).toHaveLength(1)
    expect(() => editor.state.doc.check()).not.toThrow()
    editor.destroy()
  })

  it('Tab / Shift-Tab 在符号格与释义格之间移动', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'g3-lg-1', 'whereTerm')
    press(editor, 'Tab')
    expect(editor.state.selection.$from.parent.type.name).toBe('whereDefinition')
    press(editor, 'Tab', { shiftKey: true })
    expect(editor.state.selection.$from.parent.type.name).toBe('whereTerm')
    editor.destroy()
  })

  it('空符号格：占位类 def-term-empty（而不是公式式中的 where-term-empty），点击不请求行内公式', () => {
    const doc = legendOnlyDoc(figureLegend('k-lg', '图例', legendItem('k-i1', 'a', '甲'), legendItem('k-empty', '', '尚未填写')))
    const editor = mountEditor(doc as unknown as Record<string, unknown>)
    const term = editor.view.dom.querySelector<HTMLElement>('[data-node-id="k-empty"] > dt')!
    expect(term.classList.contains('def-term-empty')).toBe(true)
    expect(term.classList.contains('where-term-empty')).toBe(false)
    let termPos = -1
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'whereItem' && node.attrs.nodeId === 'k-empty') termPos = pos + 1 })
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

  it('Backspace：空的非最后一项删除，光标回到上一项释义末尾；第一项前面是标题节点时不当作“上一项”（不抛错、文档保持合法）', () => {
    const doc = legendOnlyDoc(figureLegend('k-lg', '图例', legendItem('k-i1', '', ''), legendItem('k-i2', 'b', '乙')))
    const editor = mountEditor(doc as unknown as Record<string, unknown>)
    caretInItem(editor, 'k-i1', 'whereTerm', 0)
    expect(() => press(editor, 'Backspace')).not.toThrow()
    expect(() => editor.state.doc.check()).not.toThrow()
    const shape = figureShapes(editor.getJSON() as PMJsonNode)['k-fig'] as { legend: { title: string | null; items: unknown[][] } }
    expect(shape.legend.title).toBe('图例')
    expect(shape.legend.items.map(item => item[0])).toEqual(['k-i2'])
    expect(editor.state.selection.$from.parent.type.name).toBeTruthy()
    editor.destroy()
  })

  it('Backspace：空的最后一项——标题有文字时不删除图例（避免丢字）；没有标题（或标题为空）时连同图例一起删除', () => {
    const titled = mountEditor(legendOnlyDoc(figureLegend('k-lg', '图例', legendItem('k-only', '', ''))) as unknown as Record<string, unknown>)
    caretInItem(titled, 'k-only', 'whereTerm', 0)
    const before = JSON.stringify(titled.getJSON())
    press(titled, 'Backspace')
    expect(JSON.stringify(titled.getJSON())).toBe(before)
    titled.destroy()

    const bare = mountEditor(legendOnlyDoc(figureLegend('k-lg', null, legendItem('k-only', '', ''))) as unknown as Record<string, unknown>)
    caretInItem(bare, 'k-only', 'whereTerm', 0)
    press(bare, 'Backspace')
    expect(nodesOfType(bare.getJSON() as PMJsonNode, 'figureLegend')).toHaveLength(0)
    expect(() => bare.state.doc.check()).not.toThrow()
    bare.destroy()

    const emptyTitle = mountEditor(legendOnlyDoc(figureLegend('k-lg', '', legendItem('k-only', '', ''))) as unknown as Record<string, unknown>)
    caretInItem(emptyTitle, 'k-only', 'whereTerm', 0)
    press(emptyTitle, 'Backspace')
    expect(nodesOfType(emptyTitle.getJSON() as PMJsonNode, 'figureLegend')).toHaveLength(0)
    emptyTitle.destroy()
  })

  it('Backspace：非空项只在两格之间退格，不误删', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    caretInItem(editor, 'g3-lg-1', 'whereDefinition', 0)
    press(editor, 'Backspace')
    expect(editor.state.selection.$from.parent.type.name).toBe('whereTerm')
    expect((figureShapes(editor.getJSON() as PMJsonNode)['g3-fig-1'] as { legend: { items: unknown[] } }).legend.items).toHaveLength(3)
    editor.destroy()
  })
})

describe('[M-8.2-11][M-8.4-03] 编辑命令遇到图内的注 / 示例：拒绝而不是抛错，文档不变', () => {
  /** 光标放进 nodeId 所属图内注 / 示例的文字里。 */
  function caretInFigureBlock(editor: Editor, type: 'note' | 'example', nodeId: string): void {
    let target = -1
    editor.state.doc.descendants((node, pos) => {
      if (target < 0 && node.type.name === type && node.attrs.nodeId === nodeId) target = pos + 1
    })
    if (target < 0) throw new Error(`找不到 ${type}#${nodeId}`)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target + 1)))
  }

  it('设为条 / 设为段落 / 设为列项：图内的注与示例都返回失败（它们只能是图的 note / example 子节点），文档不变', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    for (const [type, id] of [['note', 'g3-fig1-n1'], ['example', 'g3-fig1-e1']] as const) {
      caretInFigureBlock(editor, type, id)
      const before = JSON.stringify(editor.getJSON())
      expect(setClauseFormat(editor, 1).ok, `${type} 设为条`).toBe(false)
      expect(setParagraphFormat(editor).ok, `${type} 设为段落`).toBe(false)
      expect(setListFormat(editor, 'dash').ok, `${type} 设为列项`).toBe(false)
      expect(JSON.stringify(editor.getJSON()), type).toBe(before)
      expect(() => editor.state.doc.check()).not.toThrow()
    }
    editor.destroy()
  })

  it('insertNote / insertExample：在图内的注里不新增块、文档保持合法（把注就地“设为注”是幂等的；设为示例会破坏 注在前、示例在后 的顺序，被拒绝）', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    caretInFigureBlock(editor, 'note', 'g3-fig1-n1')
    const before = JSON.stringify(editor.getJSON())
    editor.commands.insertNote()
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    expect(editor.commands.insertExample()).toBe(false)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    expect(() => editor.state.doc.check()).not.toThrow()
    editor.destroy()
  })

  it('insertNote / insertExample 在图例项与图例标题里被拒绝（返回 false）：块插入会把图例劈开、让后面的项散落到图例之外；文档不变', () => {
    const editor = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    const placements: Array<() => void> = [
      () => caretInItem(editor, 'g3-lg-1', 'whereDefinition', 1),
      () => caretInItem(editor, 'g3-lg-2', 'whereTerm'),
      () => caretInLegendTitle(editor, 'g3-legend-1'),
    ]
    for (const place of placements) {
      place()
      // 基线在放好光标之后取：第一个事务会让 NodeId / 末尾空段插件补全 id（与本组无关）
      const before = JSON.stringify(editor.getJSON())
      expect(editor.commands.insertNote()).toBe(false)
      expect(editor.commands.insertExample()).toBe(false)
      expect(JSON.stringify(editor.getJSON())).toBe(before)
    }
    expect(figureShapes(editor.getJSON() as PMJsonNode)['g3-fig-1']).toMatchObject({
      children: ['figureImage', 'figureCaption', 'figureLegend', 'note', 'note', 'example'],
      legend: { items: [['g3-lg-1', '1', '主电路'], ['g3-lg-2', '2', '控制器，见图A.1'], ['g3-lg-3', 'Vo', '输出电压']] },
    })
    editor.destroy()
  })
})

describe('版本对比文本：图例、图注、图中示例、行内图', () => {
  it('图后依次输出 [图例] 标题、每项“符号：释义”、注、示例；行内图以 [行内图 …] 记号出现', () => {
    const text = docToText(schema.nodeFromJSON(createWp8mG3Fixture()).toJSON() as unknown as Record<string, unknown>)
    const lines = text.split('\n')
    const start = lines.findIndex(line => line.includes('[图] 测试图'))
    expect(lines.slice(start, start + 7).map(line => line.trim())).toEqual([
      '[图] 测试图',
      '[图例] 图例',
      '1：主电路',
      '2：控制器，见图A.1',
      'Vo：输出电压',
      '注：图注一。',
      '注：图注二。',
    ])
    expect(lines[start + 7]!.trim()).toBe('示例：图中示例。')
    expect(text).toContain('本文件的符号[行内图 箭头 size=M]见图。')
    expect(text).toContain('资源图：[行内图 图标 size=S res=g3-res-1]，无尺寸图：[行内图]')
  })

  it('只改图例项或图注的版本能在对比中看到差异', () => {
    const before = docToText(schema.nodeFromJSON(createWp8mG3Fixture()).toJSON() as unknown as Record<string, unknown>)
    const changed = createWp8mG3Fixture()
    byId(changed, 'whereItem', 'g3-lg-1').content![1]!.content![0]!.text = '改过的释义'
    const after = docToText(schema.nodeFromJSON(changed).toJSON() as unknown as Record<string, unknown>)
    expect(after).not.toBe(before)
    expect(after).toContain('1：改过的释义')
    const noteChanged = createWp8mG3Fixture()
    byId(noteChanged, 'note', 'g3-fig2-n1').content![0]!.text = '改过的图注。'
    expect(docToText(schema.nodeFromJSON(noteChanged).toJSON() as unknown as Record<string, unknown>)).toContain('注：改过的图注。')
  })
})

describe('[M-8.5-01][M-8.3-02] 粘贴重映射：图例换新 nodeId，行内图 resourceId 随资源一起重映射', () => {
  it('remapPastedSliceIds：整章复制到同一文档时，图例容器、项、图注 / 示例换新 id，副本里的图引用指向副本', () => {
    const editor = new Editor({ extensions, content: createWp8mG3Fixture() as never })
    try {
      const source = editor.state.doc.child(1) // 第 2 章：图的说明（含 g3-fig-1 等）
      const slice = remapPastedSliceIds(new Slice(Fragment.from(source), 0, 0), editor.state.doc)
      const copied = slice.content.child(0).toJSON() as PMJsonNode
      const ids = (type: string) => nodesOfType(copied, type).map(node => String(node.attrs?.nodeId))
      expect(ids('figureLegend')).toHaveLength(1)
      expect(ids('figureLegend')[0]).not.toBe('g3-legend-1')
      expect(ids('whereItem')).toHaveLength(3)
      expect(ids('whereItem').some(id => id.startsWith('g3-lg-'))).toBe(false)
      expect(ids('note').some(id => id.startsWith('g3-fig'))).toBe(false)
      expect(ids('example').some(id => id.startsWith('g3-fig'))).toBe(false)
      // 原文档不被改动
      expect(byId(editor.getJSON() as PMJsonNode, 'figureLegend', 'g3-legend-1')).toBeTruthy()
    } finally {
      editor.destroy()
    }
  })

  it('inlineImage.resourceId 在两张重映射表里：切片内同时含资源定义与行内图时，引用跟随资源的新 id', () => {
    const editor = new Editor({ extensions, content: createWp8mG3Fixture() as never })
    try {
      const paragraph = editor.state.doc.child(1).child(1) // g3-ch-p：含 resourceId=g3-res-1 的行内图
      const resource = editor.state.doc.lastChild!
      expect(resource.type.name).toBe('figureResource')
      const slice = remapPastedSliceIds(new Slice(Fragment.from([paragraph, resource]), 0, 0), editor.state.doc)
      const copiedResource = slice.content.child(1).toJSON() as PMJsonNode
      const copiedParagraph = slice.content.child(0).toJSON() as PMJsonNode
      const newId = String(copiedResource.attrs?.nodeId)
      expect(newId).not.toBe('g3-res-1')
      expect(imagesOf(copiedParagraph).map(attrs => attrs?.resourceId).filter(Boolean)).toEqual([newId])
    } finally {
      editor.destroy()
    }
  })

  it('切片只含行内图、不含资源定义时：resourceId 指向文档里原有的资源，保持不变（不被改写成悬空）', () => {
    const editor = new Editor({ extensions, content: createWp8mG3Fixture() as never })
    try {
      const paragraph = editor.state.doc.child(1).child(1)
      const slice = remapPastedSliceIds(new Slice(Fragment.from(paragraph), 0, 0), editor.state.doc)
      expect(imagesOf(slice.content.child(0).toJSON() as PMJsonNode).map(attrs => attrs?.resourceId).filter(Boolean)).toEqual(['g3-res-1'])
    } finally {
      editor.destroy()
    }
  })
})

describe('[M-8.5-01][M-8.4-03][M-8.3-02][M-8.2-11] 导出链路：图例、图中示例、行内图本阶段阻断；图注放行', () => {
  const guard = (doc: PMJsonNode, format: 'html' | 'pdf' | 'docx' | 'xml' | 'json') => checkExportGuard(schema.nodeFromJSON(doc).toJSON() as PMJsonNode, format)

  it('checkExportGuard：完整 G3 文档在 html/pdf/docx/xml 全部被输出边界阻止，json 通过', () => {
    const doc = createWp8mG3Fixture()
    expect(guard(doc, 'json')).toBeNull()
    for (const format of ['html', 'pdf', 'docx', 'xml'] as const) {
      const failure = guard(doc, format)
      expect(failure?.source, format).toBe('output-boundary')
      const paths = failure!.problems.map(problem => problem.path ?? '')
      expect(paths.some(path => path.endsWith('.legend')), format).toBe(true)
      expect(paths.some(path => path.endsWith('.examples')), format).toBe(true)
      expect(paths.some(path => path.endsWith('.image')), format).toBe(true)
      expect(paths.some(path => path.includes('.notes')), format).toBe(false)
    }
  })

  it('逐项：只有图例 → 阻断并指向 legend；只有图中示例 → 指向 examples；只有行内图 → 指向 image', () => {
    const base = (...extra: PMJsonNode[]): PMJsonNode => ({
      type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, ...extra] }],
    })
    const onlyLegend = base(figure('f', '图', figureLegend('lg', null, legendItem('i', 'a', '甲'))))
    const onlyExample = base(figure('f', '图', figureExample('e', '例')))
    const onlyImage = base({ type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [{ type: 'text', text: '见' }, inlineImage()] })
    for (const [doc, suffix] of [[onlyLegend, '.legend'], [onlyExample, '.examples'], [onlyImage, '.image']] as const) {
      for (const format of ['html', 'pdf', 'docx', 'xml'] as const) {
        const failure = guard(doc, format)
        expect(failure?.problems.map(problem => problem.path), `${suffix} ${format}`).toEqual([expect.stringMatching(new RegExp(`${suffix.replace('.', '\\.')}$`))])
      }
    }
  })

  const notesOnly = (): PMJsonNode => ({
    type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '图注测试' }] },
      figure('f1', '图一', figureNote('f1-n1', '图注一。'), figureNote('f1-n2', '图注二。')),
      figure('f2', '图二', figureNote('f2-n1', '唯一图注。')),
    ] }],
  })

  it('图注放行：html / pdf / docx 通过边界；HTML 输出按 Resolver 标签逐条排版', () => {
    const doc = notesOnly()
    for (const format of ['html', 'pdf', 'docx', 'json'] as const) expect(guard(doc, format), format).toBeNull()
    const editor = mountEditor(doc as unknown as Record<string, unknown>)
    const html = exportSemanticHtml(editor.state.doc)
    expect(html).toContain('<span class="ses-note-marker">注1：</span>图注一。')
    expect(html).toContain('<span class="ses-note-marker">注2：</span>图注二。')
    expect(html).toContain('<span class="ses-note-marker">注：</span>唯一图注。')
    editor.destroy()
  })

  it('图注放行：DOCX 逐条输出图注段落（位于图片之后、图题之前）', async () => {
    const editor = mountEditor(notesOnly() as unknown as Record<string, unknown>)
    const { blob } = await buildDocxBlob({ pmDoc: editor.getJSON() as PMJsonNode, createdAt: '2026-10-26T00:00:00Z' })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const paragraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(match => [...match[1]!.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(run => run[1]).join(''))
    const captionAt = paragraphs.indexOf('图一')
    expect(paragraphs.indexOf('图注一。')).toBeGreaterThan(-1)
    expect(paragraphs.indexOf('图注一。')).toBeLessThan(paragraphs.indexOf('图注二。'))
    expect(paragraphs.indexOf('图注二。')).toBeLessThan(captionAt)
    expect(paragraphs).toContain('唯一图注。')
    editor.destroy()
  })

  it('旧 XML：含图注的文档 serializeToXml 拒绝（旧序列化器不输出图中注，不能悄悄丢掉）；图例 / 示例 / 行内图同样拒绝', () => {
    const editor = mountEditor(notesOnly() as unknown as Record<string, unknown>)
    let caught: unknown
    try { serializeToXml(editor.state.doc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(UnsupportedOutputError)
    expect((caught as UnsupportedOutputError).problems.map(problem => problem.message).join('\n')).toContain('图中的注')
    editor.destroy()
    const full = mountEditor(createWp8mG3Fixture() as unknown as Record<string, unknown>)
    expect(() => serializeToXml(full.state.doc)).toThrow(UnsupportedOutputError)
    full.destroy()
  })

  it('无图注的旧图仍可导出旧 XML（回归：阻断只针对 figure 内的 note）', () => {
    const legacy: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '章' }] }, figure('f', '旧图'), { type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [{ type: 'text', text: '正文' }] }] }] }
    const editor = mountEditor(legacy as unknown as Record<string, unknown>)
    expect(() => serializeToXml(editor.state.doc)).not.toThrow()
    editor.destroy()
  })
})
