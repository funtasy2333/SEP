// @vitest-environment happy-dom
/**
 * WP8.M G8：表的名义列宽 `stdTable.columns`（M-6.1-03）与单元格分边边框样式（M-6.3.3.1-01）——生产 Schema / client 层。
 *
 * 设计 §3.6 四类用例：Schema、往返（PM → IR → PM）、HTML 往返、保存重开（Editor + replaceEditorDocument + exportSemanticJson）。
 * 另覆盖：同步插件 tableColumnsSync（D-M-11，列数变化时清空 columns）、编辑器里的内联边框样式、导出链路（§7.1：四种格式一律阻断）。
 * shared 层的映射、边界与诊断见 shared 的 wp8mG8*.test.ts；真实浏览器里的列宽显示见 styles/wp8mG8Css.test.ts 与报告中的 spike 结论。
 *
 * 两套列宽的关系：`columns` 是源文档的名义宽度（XML `col/@width`），单元格 `colwidth` 是编辑器拖拽得到的 px。
 * 二者独立保存、互不推导；显示时 px 优先，导出 `col` 时只取 columns。
 */

import { Editor, getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { describe, expect, it } from 'vitest'
import { checkExportGuard } from '@ses/io'
import { IRToPmError, irToPm, pmToIr, resolve, type IRBlock, type IRTable, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'
import { G8_COLUMNS_2, G8_COLUMNS_3, createWp8mG8Fixture } from './__fixtures__/wp8m-g8'
import { cellBorderCss } from './nodes/semantic'
import { stdTableGridWidth } from './plugins/tableColumnsSync'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { serializeToXml } from '../serializer/xmlSerializer'
import { replaceEditorDocument } from '../utils/editorDocument'

const extensions = createEditorExtensions()
const schema = getSchema(extensions)
const BORDER_STYLE_KEYS = ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'] as const

function visit(node: PMJsonNode, fn: (node: PMJsonNode) => void): void {
  fn(node)
  node.content?.forEach(child => visit(child, fn))
}

function findJson(root: PMJsonNode, nodeId: string): PMJsonNode {
  let found: PMJsonNode | undefined
  visit(root, node => { if (!found && node.attrs?.nodeId === nodeId) found = node })
  if (!found) throw new Error(`找不到节点 ${nodeId}`)
  return found
}

function cellsOf(table: PMJsonNode): PMJsonNode[] {
  return table.content!.find(child => child.type === 'table')!.content!.flatMap(row => row.content ?? [])
}

function irTables(root: PMJsonNode): IRTable[] {
  const found: IRTable[] = []
  const walk = (blocks: ReadonlyArray<IRBlock>): void => {
    for (const block of blocks) {
      if (block.kind === 'table') found.push(block)
      else if ('children' in block) walk(block.children as IRBlock[])
    }
  }
  for (const chapter of pmToIr(root).doc.body) walk(chapter.children as IRBlock[])
  return found
}

function mountEditor(content: Record<string, unknown> | string = '<p></p>'): Editor {
  const editor = new Editor({ extensions, content: content as never })
  editor.mount(document.createElement('div'))
  return editor
}

/** 文档中带给定 nodeId 的节点位置（节点起点）。 */
function posOf(editor: Editor, nodeId: string): number {
  let found: number | undefined
  editor.state.doc.descendants((node, pos) => {
    if (found === undefined && node.attrs.nodeId === nodeId) found = pos
    return found === undefined
  })
  if (found === undefined) throw new Error(`找不到节点 ${nodeId}`)
  return found
}

/** 把光标放进某个单元格的第一个段落。 */
function caretInCell(editor: Editor, cellId: string): void {
  const pos = posOf(editor, cellId)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 2)))
}

function columnsOf(editor: Editor, tableId: string): unknown {
  return findJson(editor.getJSON() as PMJsonNode, tableId).attrs?.columns ?? null
}

function stdTableNode(editor: Editor, tableId: string): PMNode {
  const node = editor.state.doc.nodeAt(posOf(editor, tableId))
  if (!node || node.type.name !== 'stdTable') throw new Error(`${tableId} 不是 stdTable`)
  return node
}

/** 把 style 属性解析成 属性→值（happy-dom 会规范化简写与末尾分号，故不比较原串）。 */
function styleMap(element: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
    const index = declaration.indexOf(':')
    if (index > 0) out[declaration.slice(0, index).trim()] = declaration.slice(index + 1).trim()
  }
  return out
}

function cellRowCounts(editor: Editor, tableId: string): number[] {
  const rows = findJson(editor.getJSON() as PMJsonNode, tableId).content!.find(child => child.type === 'table')!.content!
  return rows.map(row => row.content!.length)
}

describe('[M-6.1-03][M-6.3.3.1-01] 生产 Schema：stdTable.columns 与单元格边框样式属性', () => {
  it('fixture 通过 Schema 校验；stdTable 内容表达式不变，columns 属性默认 null', () => {
    expect(() => schema.nodeFromJSON(createWp8mG8Fixture()).check()).not.toThrow()
    const type = schema.nodes.stdTable!
    expect(type.spec.content).toBe('tableCaption tableCaptionEn? table tableFootnote? tableNoteRow? tableFootnoteRow?')
    expect(type.create().attrs.columns).toBeNull()
    expect(type.create({ nodeId: 't' }, undefined).attrs.columns).toBeNull()
  })

  it('tableCell 与 tableHeader 各有四个边框样式属性，默认 null', () => {
    for (const name of ['tableCell', 'tableHeader']) {
      const type = schema.nodes[name]!
      for (const key of BORDER_STYLE_KEYS) {
        expect(type.create().attrs, `${name}.${key}`).toHaveProperty(key, null)
      }
    }
  })

  it('属性值原样保留（Schema 不拦截取值，合法性由 pmToIr 诊断）；旧文档（WP6 fixture）无需迁移，columns 与样式皆为 null', () => {
    expect(() => schema.nodeFromJSON(createWp6Fixture()).check()).not.toThrow()
    const legacy = schema.nodeFromJSON(createWp6Fixture())
    let tables = 0
    legacy.descendants((node) => {
      if (node.type.name === 'stdTable') {
        tables += 1
        expect(node.attrs.columns).toBeNull()
      }
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        for (const key of BORDER_STYLE_KEYS) expect(node.attrs[key]).toBeNull()
      }
    })
    expect(tables).toBeGreaterThan(0)
    const bad = schema.nodeFromJSON(createWp8mG8Fixture())
    expect(() => bad.check()).not.toThrow()
  })

  it('扩展追加在 createEditorExtensions() 中 inlineFormulaEditing 之后；同步插件是纯插件，不新增节点', () => {
    const names = extensions.map(extension => extension.name)
    expect(names).toContain('tableColumnsSync')
    expect(names.indexOf('tableColumnsSync')).toBeGreaterThan(names.indexOf('inlineFormulaEditing'))
    // 不改变 block 组默认填充节点（P3）。
    expect(schema.nodes.chapter!.contentMatch.defaultType?.name).not.toBe('tableColumnsSync')
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] 往返：生产 PM → IR → Resolver → PM', () => {
  it('pmToIr 无告警；四张表的 columns 与边框样式逐项映射，extensionVersion=1', () => {
    const fixture = schema.nodeFromJSON(createWp8mG8Fixture()).toJSON() as PMJsonNode
    const { doc, warnings } = pmToIr(fixture)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    expect(doc.extensionVersion).toBe(1)
    const [two, merged, px, legacy] = irTables(fixture)
    expect(two!.columns).toEqual([
      { width: { value: 40, unit: '%' }, textAlign: 'center', verticalAlign: 'middle' },
      { width: { value: 60, unit: '%' } },
    ])
    expect(merged!.columns).toEqual([
      { width: { value: 20, unit: '%' } }, {}, { width: { value: 50, unit: '%' }, textAlign: 'right', verticalAlign: 'bottom' },
    ])
    expect(px!.columns).toHaveLength(2)
    expect('columns' in legacy!).toBe(false)
    expect(two!.rows[1]!.cells[0]!.style).toEqual({
      borderLeft: { value: 1, unit: 'px' }, borderLeftStyle: 'solid',
      borderTop: { value: 5, unit: 'px' }, borderTopStyle: 'solid',
      borderRightStyle: 'none',
      borderBottom: { value: 3, unit: 'px' }, borderBottomStyle: 'dashed',
    })
  })

  it('两条列宽通路并存：columns 与 colwidth 各自保留，互不推导', () => {
    const [, , px] = irTables(schema.nodeFromJSON(createWp8mG8Fixture()).toJSON() as PMJsonNode)
    expect(px!.columns).toEqual([{ width: { value: 50, unit: '%' } }, { width: { value: 50, unit: '%' } }])
    expect(px!.rows.map(row => row.cells.map(item => item.columnWidths))).toEqual([[[200], [320]], [[200], [320]]])
  })

  it('Resolver 无 error（表编号、引用解析不受 columns 影响）', () => {
    const { doc } = pmToIr(createWp8mG8Fixture())
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['g8-tbl-2col']).toMatchObject({ label: '表1' })
    expect(Object.values(labels).some(label => label.xmlId.startsWith('ext_'))).toBe(false)
  })

  it('IR → PM 通过 Schema 校验，columns 与边框样式属性逐项一致，再经 JSON 冷重开后 IR 深度相等', () => {
    const original = schema.nodeFromJSON(createWp8mG8Fixture())
    original.check()
    const first = pmToIr(original.toJSON() as PMJsonNode)
    const projected = schema.nodeFromJSON(irToPm(first.doc))
    projected.check()
    const sourceJson = original.toJSON() as PMJsonNode
    const projectedJson = projected.toJSON() as PMJsonNode
    for (const id of ['g8-tbl-2col', 'g8-tbl-merged', 'g8-tbl-px', 'g8-tbl-legacy']) {
      expect(findJson(projectedJson, id).attrs?.columns ?? null, id).toEqual(findJson(sourceJson, id).attrs?.columns ?? null)
      const before = cellsOf(findJson(sourceJson, id))
      const after = cellsOf(findJson(projectedJson, id))
      expect(after.map(cell => cell.attrs?.nodeId)).toEqual(before.map(cell => cell.attrs?.nodeId))
      for (const [index, cell] of after.entries()) {
        for (const key of BORDER_STYLE_KEYS) expect(cell.attrs?.[key] ?? null, `${id}[${index}].${key}`).toEqual(before[index]!.attrs?.[key] ?? null)
        expect(cell.attrs?.colwidth ?? null, `${id}[${index}].colwidth`).toEqual(before[index]!.attrs?.colwidth ?? null)
      }
    }
    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(projectedJson)) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(first.doc)
  })

  it('列数与网格不符的 columns 被 pmToIr 报告（不静默丢弃）；带 unsupportedContent 的 IR 不能再投影回 PM（既有口径）', () => {
    const doc = createWp8mG8Fixture()
    findJson(doc, 'g8-tbl-2col').attrs!.columns = [G8_COLUMNS_2[0]]
    const { doc: ir } = pmToIr(doc)
    expect(ir.unsupportedContent).toEqual([expect.objectContaining({
      nodeId: 'g8-tbl-2col', reason: expect.stringContaining('有 1 项，与表格网格列数 2 不符'),
    })])
    expect('columns' in irTables(doc)[0]!).toBe(false)
    expect(() => irToPm(ir)).toThrow(IRToPmError)
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] HTML 往返（DOMSerializer / DOMParser 两轮）', () => {
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

  it('两轮后 columns、边框样式、colwidth 与 nodeId 不变', () => {
    const source = schema.nodeFromJSON(createWp8mG8Fixture()).toJSON() as PMJsonNode
    const { reopened } = roundtripHtml(createWp8mG8Fixture())
    const after = reopened.toJSON() as PMJsonNode
    for (const id of ['g8-tbl-2col', 'g8-tbl-merged', 'g8-tbl-px', 'g8-tbl-legacy']) {
      expect(findJson(after, id).attrs?.columns ?? null, id).toEqual(findJson(source, id).attrs?.columns ?? null)
      const before = cellsOf(findJson(source, id))
      const cells = cellsOf(findJson(after, id))
      expect(cells.map(cell => cell.attrs?.nodeId)).toEqual(before.map(cell => cell.attrs?.nodeId))
      for (const [index, cell] of cells.entries()) {
        for (const key of BORDER_STYLE_KEYS) expect(cell.attrs?.[key] ?? null, `${id}[${index}].${key}`).toEqual(before[index]!.attrs?.[key] ?? null)
        expect(cell.attrs?.colwidth ?? null, `${id}[${index}].colwidth`).toEqual(before[index]!.attrs?.colwidth ?? null)
      }
    }
  })

  it('renderHTML：stdTable 写 data-columns（JSON）与 --ses-col-<n> 自定义属性；没有名义宽度的列不写变量；旧表不带这些', () => {
    const { html } = roundtripHtml(createWp8mG8Fixture(), 1)
    const container = document.createElement('div')
    container.innerHTML = html
    const wrapper = (id: string) => container.querySelector<HTMLElement>(`[data-type="std-table"][data-node-id="${id}"]`)!
    expect(JSON.parse(wrapper('g8-tbl-2col').getAttribute('data-columns')!)).toEqual(G8_COLUMNS_2)
    expect(styleMap(wrapper('g8-tbl-2col'))).toEqual({ '--ses-col-1': '40%', '--ses-col-2': '60%' })
    expect(JSON.parse(wrapper('g8-tbl-merged').getAttribute('data-columns')!)).toEqual(G8_COLUMNS_3)
    expect(styleMap(wrapper('g8-tbl-merged'))).toEqual({ '--ses-col-1': '20%', '--ses-col-3': '50%' })
    expect(wrapper('g8-tbl-legacy').hasAttribute('data-columns')).toBe(false)
    expect(wrapper('g8-tbl-legacy').hasAttribute('style')).toBe(false)
  })

  it('不合法的宽度（单位含符号、非正数）不写进样式，但 data-columns 仍原样往返，由 pmToIr 诊断', () => {
    const source = createWp8mG8Fixture()
    findJson(source, 'g8-tbl-2col').attrs!.columns = [
      { width: 10, widthUnit: '%;color:red', textAlign: null, verticalAlign: null },
      { width: -5, widthUnit: '%', textAlign: null, verticalAlign: null },
    ]
    const { html, reopened } = roundtripHtml(source, 1)
    const container = document.createElement('div')
    container.innerHTML = html
    const wrapper = container.querySelector<HTMLElement>('[data-type="std-table"][data-node-id="g8-tbl-2col"]')!
    expect(wrapper.getAttribute('style')).toBeNull()
    expect(wrapper.getAttribute('data-columns')).toContain('%;color:red')
    expect(findJson(reopened.toJSON() as PMJsonNode, 'g8-tbl-2col').attrs?.columns).toEqual(findJson(source, 'g8-tbl-2col').attrs?.columns)
  })

  it('data-columns 不是合法 JSON：回读为 null（不抛错，不带入垃圾）', () => {
    const container = document.createElement('div')
    container.innerHTML = '<div data-type="std-table" data-node-id="t" data-columns="{oops"><div data-type="table-caption"></div><table><tbody><tr><td>a</td></tr></tbody></table></div>'
    const parsed = DOMParser.fromSchema(schema).parse(container)
    let columns: unknown = 'unset'
    parsed.descendants(node => { if (node.type.name === 'stdTable') columns = node.attrs.columns })
    expect(columns).toBeNull()
  })

  it('单元格：边框宽度与样式落成内联 CSS（仅宽度与样式分量，不用简写）；无边框信息的单元格不带 style', () => {
    const { html } = roundtripHtml(createWp8mG8Fixture(), 1)
    const container = document.createElement('div')
    container.innerHTML = html
    const cell = (id: string) => container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!
    // happy-dom 会把 border-*-style 合并为简写，故用逐边 getPropertyValue 读取（真实浏览器同样按逐边解析）。
    const sides = (id: string) => (['top', 'right', 'bottom', 'left'] as const).map(side => [
      cell(id).style.getPropertyValue(`border-${side}-width`), cell(id).style.getPropertyValue(`border-${side}-style`),
    ])
    expect(sides('g8-tbl-2col.r1c0')).toEqual([['5px', 'solid'], ['', 'none'], ['3px', 'dashed'], ['1px', 'solid']])
    expect(sides('g8-tbl-2col.r1c1')).toEqual([['2px', 'dotted'], ['2px', 'dotted'], ['2px', 'dotted'], ['2px', 'dotted']])
    expect(cell('g8-tbl-2col.r0c0').getAttribute('style')).toBeNull()
    expect(cell('g8-tbl-legacy.r1c0').getAttribute('style')).toBeNull()
  })

  it('不含 columns 的旧 HTML（无 data-columns）仍按原样解析', () => {
    const { reopened } = roundtripHtml(createWp6Fixture())
    let tables = 0
    reopened.descendants(node => { if (node.type.name === 'stdTable') { tables += 1; expect(node.attrs.columns).toBeNull() } })
    expect(tables).toBeGreaterThan(0)
  })
})

describe('[M-6.3.3.1-01] cellBorderCss：内联样式的取值过滤', () => {
  it('合法宽度单位与四个样式取值输出；%、未知单位、负数、非数字、未知样式一律跳过', () => {
    expect(cellBorderCss({ borderTop: 1, borderTopUnit: 'px', borderTopStyle: 'dashed' })).toBe('border-top-width: 1px; border-top-style: dashed')
    expect(cellBorderCss({ borderLeft: 0.25, borderLeftUnit: 'pt', borderRightStyle: 'none', borderBottomStyle: 'dotted' }))
      .toBe('border-right-style: none; border-bottom-style: dotted; border-left-width: 0.25pt')
    expect(cellBorderCss({ borderTop: 10, borderTopUnit: '%' })).toBe('')
    expect(cellBorderCss({ borderTop: 1, borderTopUnit: 'px;color:red' })).toBe('')
    expect(cellBorderCss({ borderTop: -1, borderTopUnit: 'px' })).toBe('')
    expect(cellBorderCss({ borderTop: '1', borderTopUnit: 'px' })).toBe('')
    expect(cellBorderCss({ borderTopStyle: 'groove', borderLeftStyle: 'none; x' })).toBe('')
    expect(cellBorderCss({})).toBe('')
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] 保存重开：Editor + replaceEditorDocument + exportSemanticJson', () => {
  it('加载 → 保存 → 重开：PM JSON 与语义 JSON 都相等，columns、边框样式、colwidth 无损', () => {
    const first = mountEditor()
    expect(replaceEditorDocument(first, createWp8mG8Fixture() as unknown as Record<string, unknown>)).toBe(true)
    expect(first.getJSON().attrs).toMatchObject({ extensionVersion: 1 })
    const saved = JSON.parse(JSON.stringify(first.getJSON())) as PMJsonNode
    const exportedFirst = exportSemanticJson(first.state.doc)

    const second = mountEditor()
    replaceEditorDocument(second, saved as unknown as Record<string, unknown>)
    expect(second.getJSON()).toEqual(first.getJSON())
    expect(exportSemanticJson(second.state.doc)).toEqual(exportedFirst)
    expect(columnsOf(second, 'g8-tbl-2col')).toEqual(G8_COLUMNS_2)
    expect(columnsOf(second, 'g8-tbl-merged')).toEqual(G8_COLUMNS_3)
    expect(columnsOf(second, 'g8-tbl-legacy')).toBeNull()
    expect(stdTableNode(second, 'g8-tbl-px').firstChild).toBeTruthy()
    const semantic = JSON.stringify(exportedFirst)
    expect(semantic).toContain('borderTopStyle')
    expect(semantic).toContain('"columns"')

    // 经 IR 再写回（等同服务端 documentOps 等路径）后重开，两张表的 columns 仍保持。
    const third = mountEditor()
    replaceEditorDocument(third, irToPm(pmToIr(saved).doc) as unknown as Record<string, unknown>)
    expect(columnsOf(third, 'g8-tbl-2col')).toEqual(G8_COLUMNS_2)
    expect(columnsOf(third, 'g8-tbl-merged')).toEqual(G8_COLUMNS_3)
    for (const editor of [first, second, third]) editor.destroy()
  })

  it('旧文档（WP6 fixture）保存重开：语义 JSON 不出现 columns 与边框样式（P2，JSON golden 不变）', () => {
    const editor = mountEditor()
    replaceEditorDocument(editor, createWp6Fixture() as unknown as Record<string, unknown>)
    const semantic = JSON.stringify(exportSemanticJson(editor.state.doc))
    expect(semantic).not.toContain('"columns"')
    expect(semantic).not.toMatch(/border(Top|Right|Bottom|Left)Style/)
    editor.destroy()
  })

  it('编辑单元格文字后保存重开：columns 保持，文字更新', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    caretInCell(editor, 'g8-tbl-2col.r1c0')
    editor.view.dispatch(editor.state.tr.insertText('丙'))
    const saved = JSON.parse(JSON.stringify(editor.getJSON())) as PMJsonNode
    expect(columnsOf(editor, 'g8-tbl-2col')).toEqual(G8_COLUMNS_2)
    const reopened = mountEditor()
    replaceEditorDocument(reopened, saved as unknown as Record<string, unknown>)
    expect(columnsOf(reopened, 'g8-tbl-2col')).toEqual(G8_COLUMNS_2)
    expect(JSON.stringify(reopened.getJSON())).toContain('丙')
    editor.destroy()
    reopened.destroy()
  })
})

describe('[M-6.1-03] tableColumnsSync：列数变化时清空 columns（D-M-11）', () => {
  it('stdTableGridWidth：按 colspan / rowspan 展开（合并表 3 列），与 IR 侧 tableGridWidth 一致', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    expect(stdTableGridWidth(stdTableNode(editor, 'g8-tbl-2col'))).toBe(2)
    expect(stdTableGridWidth(stdTableNode(editor, 'g8-tbl-merged'))).toBe(3)
    editor.destroy()
  })

  it('插入列（后）：columns 置 null，每行多一个单元格；其它表不受影响', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    caretInCell(editor, 'g8-tbl-2col.r1c0')
    expect(editor.commands.addColumnAfter()).toBe(true)
    expect(columnsOf(editor, 'g8-tbl-2col')).toBeNull()
    expect(cellRowCounts(editor, 'g8-tbl-2col')).toEqual([3, 3])
    expect(columnsOf(editor, 'g8-tbl-merged')).toEqual(G8_COLUMNS_3)
    expect(columnsOf(editor, 'g8-tbl-px')).toHaveLength(2)
    // 清空后文档不再带 unsupportedContent：保存即可导出 JSON，不被阻断。
    expect(pmToIr(editor.getJSON() as PMJsonNode).doc.unsupportedContent ?? []).toEqual([])
    editor.destroy()
  })

  it('插入列（前）、删除列、合并表的插入列同样清空', () => {
    for (const [tableId, cellId, command] of [
      ['g8-tbl-2col', 'g8-tbl-2col.r1c1', 'addColumnBefore'],
      ['g8-tbl-2col', 'g8-tbl-2col.r1c1', 'deleteColumn'],
      ['g8-tbl-merged', 'g8-tbl-merged.r1c1', 'addColumnAfter'],
    ] as const) {
      const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
      caretInCell(editor, cellId)
      expect(editor.commands[command](), `${tableId} ${command}`).toBe(true)
      expect(columnsOf(editor, tableId), `${tableId} ${command}`).toBeNull()
      editor.destroy()
    }
  })

  it('撤销“插入列”同时还原 columns（追加事务与原事务同属一个撤销组）；重做再次清空', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    caretInCell(editor, 'g8-tbl-2col.r1c0')
    editor.commands.addColumnAfter()
    expect(columnsOf(editor, 'g8-tbl-2col')).toBeNull()
    expect(editor.commands.undo()).toBe(true)
    expect(columnsOf(editor, 'g8-tbl-2col')).toEqual(G8_COLUMNS_2)
    expect(cellRowCounts(editor, 'g8-tbl-2col')).toEqual([2, 2])
    expect(editor.commands.redo()).toBe(true)
    expect(columnsOf(editor, 'g8-tbl-2col')).toBeNull()
    editor.destroy()
  })

  it('不改变列数的编辑保留 columns：插入行、输入文字、合并同行单元格', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    caretInCell(editor, 'g8-tbl-2col.r1c0')
    expect(editor.commands.addRowAfter()).toBe(true)
    expect(cellRowCounts(editor, 'g8-tbl-2col')).toEqual([2, 2, 2])
    expect(columnsOf(editor, 'g8-tbl-2col')).toEqual(G8_COLUMNS_2)

    editor.view.dispatch(editor.state.tr.insertText('x'))
    expect(columnsOf(editor, 'g8-tbl-2col')).toEqual(G8_COLUMNS_2)

    // 合并表头行的两个单元格：网格仍是 2 列。
    const anchor = posOf(editor, 'g8-tbl-2col.r0c0')
    const head = posOf(editor, 'g8-tbl-2col.r0c1')
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, anchor, head)))
    expect(editor.commands.mergeCells()).toBe(true)
    expect(stdTableGridWidth(stdTableNode(editor, 'g8-tbl-2col'))).toBe(2)
    expect(columnsOf(editor, 'g8-tbl-2col')).toEqual(G8_COLUMNS_2)
    editor.destroy()
  })

  it('没有 columns 的表（旧表）：插入列不受影响，没有多余事务', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    caretInCell(editor, 'g8-tbl-legacy.r1c0')
    const before = editor.state.doc
    expect(editor.commands.addColumnAfter()).toBe(true)
    expect(editor.state.doc).not.toBe(before)
    expect(columnsOf(editor, 'g8-tbl-legacy')).toBeNull()
    expect(cellRowCounts(editor, 'g8-tbl-legacy')).toEqual([3, 3])
    editor.destroy()
  })

  it('载入时就列数不符的数据不被悄悄“修好”：仍保留，由 pmToIr 诊断并阻断导出', () => {
    const doc = createWp8mG8Fixture()
    findJson(doc, 'g8-tbl-2col').attrs!.columns = [G8_COLUMNS_2[0]]
    const editor = mountEditor()
    replaceEditorDocument(editor, doc as unknown as Record<string, unknown>)
    expect(columnsOf(editor, 'g8-tbl-2col')).toEqual([G8_COLUMNS_2[0]])
    const { doc: ir } = pmToIr(editor.getJSON() as PMJsonNode)
    expect(ir.unsupportedContent).toEqual([expect.objectContaining({ nodeId: 'g8-tbl-2col' })])
    // 编辑它的文字也不会触发清空（列数没变）。
    caretInCell(editor, 'g8-tbl-2col.r1c0')
    editor.view.dispatch(editor.state.tr.insertText('x'))
    expect(columnsOf(editor, 'g8-tbl-2col')).toEqual([G8_COLUMNS_2[0]])
    editor.destroy()
  })

  it('列数不符的坏数据：再次改变列数时才清空（用户有了修复途径）', () => {
    const doc = createWp8mG8Fixture()
    findJson(doc, 'g8-tbl-2col').attrs!.columns = [G8_COLUMNS_2[0]]
    const editor = mountEditor()
    replaceEditorDocument(editor, doc as unknown as Record<string, unknown>)
    caretInCell(editor, 'g8-tbl-2col.r1c0')
    // 2 → 3 列后仍与 1 项不符，且列数变了：清空。
    expect(editor.commands.addColumnAfter()).toBe(true)
    expect(columnsOf(editor, 'g8-tbl-2col')).toBeNull()
    editor.destroy()
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] 编辑器显示', () => {
  it('DOM：stdTable 外层带 data-columns 与 --ses-col-n，每个网格列一个 <col>（无 colwidth 的列仅内联 min-width）', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    const wrapper = editor.view.dom.querySelector<HTMLElement>('[data-type="std-table"][data-node-id="g8-tbl-2col"]')!
    expect(styleMap(wrapper)).toEqual({ '--ses-col-1': '40%', '--ses-col-2': '60%' })
    expect(JSON.parse(wrapper.getAttribute('data-columns')!)).toEqual(G8_COLUMNS_2)
    const cols = [...wrapper.querySelectorAll('colgroup > col')]
    expect(cols).toHaveLength(2)
    // spike 结论：内联样式里没有 width（只有 min-width），样式表的 width: var(--ses-col-n) 才能生效。
    expect(cols.every(col => !/(^|;\s*)width\s*:/.test(col.getAttribute('style') ?? ''))).toBe(true)
    const merged = editor.view.dom.querySelector<HTMLElement>('[data-node-id="g8-tbl-merged"]')!
    expect(merged.querySelectorAll('colgroup > col')).toHaveLength(3)
    editor.destroy()
  })

  it('DOM：拖拽得到 colwidth 的列，<col> 内联 width（px）；此时 columns 属性仍在外层、不被改写', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    const wrapper = editor.view.dom.querySelector<HTMLElement>('[data-node-id="g8-tbl-px"]')!
    const cols = [...wrapper.querySelectorAll('colgroup > col')].map(col => col.getAttribute('style'))
    expect(cols).toEqual(['width: 200px;', 'width: 320px;'])
    expect(JSON.parse(wrapper.getAttribute('data-columns')!)).toHaveLength(2)
    editor.destroy()
  })

  it('DOM：单元格边框样式显示为内联 CSS；列数变化清空 columns 后外层不再带 data-columns / --ses-col', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    const cell = editor.view.dom.querySelector<HTMLElement>('[data-node-id="g8-tbl-2col.r1c0"]')!
    expect(cell.style.getPropertyValue('border-top-width')).toBe('5px')
    expect(cell.style.getPropertyValue('border-bottom-style')).toBe('dashed')
    caretInCell(editor, 'g8-tbl-2col.r1c0')
    editor.commands.addColumnAfter()
    const wrapper = editor.view.dom.querySelector<HTMLElement>('[data-node-id="g8-tbl-2col"]')!
    expect(wrapper.hasAttribute('data-columns')).toBe(false)
    expect(wrapper.getAttribute('style') ?? '').not.toContain('--ses-col')
    editor.destroy()
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] 导出链路：四种格式一律阻断（§7.1，本阶段不排版）', () => {
  it('checkExportGuard：html / pdf / docx / xml 都被输出边界阻止，问题指向 columns 与单元格 style；json 不检查', () => {
    const doc = schema.nodeFromJSON(createWp8mG8Fixture()).toJSON() as PMJsonNode
    expect(checkExportGuard(doc, 'json')).toBeNull()
    for (const format of ['html', 'pdf', 'docx', 'xml'] as const) {
      const failure = checkExportGuard(doc, format)
      expect(failure?.source, format).toBe('output-boundary')
      const paths = failure!.problems.map(problem => problem.path ?? '')
      expect(paths.filter(path => path.endsWith('.columns')), format).toHaveLength(3)
      expect(paths.some(path => /\.cells\[\d+\]\.style$/.test(path)), format).toBe(true)
    }
  })

  it('去掉 columns 与边框样式后，同一文档可以导出 html / pdf / docx（阻断只来自新字段）', () => {
    const doc = schema.nodeFromJSON(createWp8mG8Fixture()).toJSON() as PMJsonNode
    visit(doc, node => {
      if (node.type === 'stdTable') delete node.attrs!.columns
      for (const key of BORDER_STYLE_KEYS) if (node.attrs && key in node.attrs) delete node.attrs[key]
      // 单元格的 border* 宽度属性在输出边界里同属 cell.style，一并去掉，才能观察到“只有新字段在阻断”。
      if (node.attrs && (node.type === 'tableCell' || node.type === 'tableHeader')) {
        for (const key of Object.keys(node.attrs)) if (/^border(Top|Right|Bottom|Left)(Unit)?$/.test(key)) delete node.attrs[key]
      }
    })
    // 两条通路并存的表带 colwidth（px）：html 本来就不放行 columnWidths，这里只验证 docx 与 columns 无关。
    visit(doc, node => { if (node.attrs && 'colwidth' in node.attrs) delete node.attrs.colwidth })
    for (const format of ['html', 'pdf', 'docx'] as const) expect(checkExportGuard(doc, format), format).toBeNull()
  })

  it('旧 XML：serializeToXml 拒绝含 columns 的文档，而不是静默丢弃', () => {
    const editor = mountEditor(createWp8mG8Fixture() as unknown as Record<string, unknown>)
    expect(() => serializeToXml(editor.state.doc)).toThrow()
    editor.destroy()
  })
})
