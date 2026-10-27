// @vitest-environment happy-dom
/**
 * WP8.M M-Z-a：全要素 fixture 的总往返与输出边界集成测试
 * （docs/wp8.m/design.md §3.4、§4.9 第 1～2 项、§7.1）。
 *
 * 一篇生产 PM 文档（`__fixtures__/wp8m.ts`，复用 G1～G8 各组 fixture）一次覆盖 32 个矩阵行对应的全部新结构：
 *   1. Schema、IR 原生版本一致（shared 的 wp8mFixtures.ts）；
 *   2. 总往返：生产 Schema → PM → IR → PM → 保存重开（Editor + replaceEditorDocument）→ exportSemanticJson，两轮后 JSON 相等，Resolver 无 error；
 *   3. HTML 往返（DOMSerializer / DOMParser）；
 *   4. 输出边界：HTML、DOCX、XML、XML46687 与设计 §3.4 表 + §7.1 逐项一致；
 *   5. 把 §7.1 暂不排版的结构（图例、图中示例、行内图、列宽、边框样式）剥掉后，文档能真实渲染 HTML 与 DOCX。
 */

import { getSchema } from '@tiptap/core'
import { Editor } from '@tiptap/vue-3'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import {
  XML46687_DECLARED_DIFFERENCES, findDeclaredDifference, getOutputSupportProblems, irToPm, pmToIr, renderDocx, renderHtml, resolve,
  type IRDoc, type OutputBoundaryFormat, type OutputSupportProblem, type PMJsonNode,
} from '@ses/shared'
import { replaceEditorDocument } from '../utils/editorDocument'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { createWp8mIrDoc } from '../../../shared/src/ir/__tests__/wp8mFixtures'
import { createEditorExtensions } from './editorExtensions'
import { createWp8mFixture, WP8M_NEW_MARK_TYPES, WP8M_NEW_NODE_TYPES } from './__fixtures__/wp8m'

const extensions = createEditorExtensions()
const schema = getSchema(extensions)
const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function visit(node: PMJsonNode, fn: (node: PMJsonNode) => void): void {
  fn(node)
  node.content?.forEach(child => visit(child, fn))
}

function nodesOfType(root: PMJsonNode, type: string): PMJsonNode[] {
  const found: PMJsonNode[] = []
  visit(root, node => { if (node.type === type) found.push(node) })
  return found
}

function mountedEditor(): Editor {
  const editor = new Editor({ extensions, content: '<p></p>' })
  editor.mount(document.createElement('div'))
  return editor
}

/** 用 replaceEditorDocument 加载（实际加载入口），返回保存用 JSON 与语义 JSON。 */
function saveAndReopen(json: PMJsonNode) {
  const editor = mountedEditor()
  try {
    expect(replaceEditorDocument(editor, json as unknown as Record<string, unknown>)).toBe(true)
    return { saved: clone(editor.getJSON()) as PMJsonNode, exported: exportSemanticJson(editor.state.doc) }
  } finally {
    editor.destroy()
  }
}

function roundtripHtml(json: PMJsonNode, passes = 2) {
  let current: PMJsonNode = json
  let html = ''
  for (let pass = 0; pass < passes; pass += 1) {
    const source = schema.nodeFromJSON(current)
    source.check()
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
    html = container.innerHTML
    const input = document.createElement('div')
    input.innerHTML = html
    const reopened = DOMParser.fromSchema(schema).parse(input)
    reopened.check()
    current = reopened.toJSON() as PMJsonNode
  }
  return { html, current }
}

const errorsOf = (doc: IRDoc) => resolve(doc).problems.filter(problem => problem.severity === 'error')

/** 生产 PM fixture 经 Schema 规范化后的 JSON（补齐默认属性；与编辑器持有的形态一致）。 */
function canonicalFixture(): PMJsonNode {
  const node = schema.nodeFromJSON(createWp8mFixture())
  node.check()
  return node.toJSON() as PMJsonNode
}

/**
 * 经过一次 PM → IR → PM 后的稳定形态。各组 fixture 沿用 WP6 之前的写法（章不写 secType、表不写 headerRowCount、
 * 单元格里是不带 nodeId 的 `paragraph`），第一次 irToPm 会把它们规范化；之后再经任意多次往返都不再变化（见下方不动点用例）。
 */
function normalizedFixture(): PMJsonNode {
  const node = schema.nodeFromJSON(irToPm(pmToIr(canonicalFixture()).doc))
  node.check()
  return node.toJSON() as PMJsonNode
}

/**
 * 编辑器加载时会给没有 IR 实体 ID 的容器（前言、引言、参考文献等）随机补 nodeId，并在文档末尾保留一个光标段落。
 * 比较保存结果时把 fixture 里没有的 nodeId 记为 null，并去掉末尾那个编辑器补的空段落；fixture 自带的 nodeId 必须原样保留。
 */
function maskGenerated<T>(json: T, knownIds: ReadonlySet<string>): T {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key === 'nodeId' && typeof child === 'string') return [key, knownIds.has(child) ? child : null]
      return [key, walk(child)]
    }))
  }
  return walk(json) as T
}

function knownIdsOf(root: PMJsonNode): Set<string> {
  const ids = new Set<string>()
  visit(root, node => { if (typeof node.attrs?.nodeId === 'string') ids.add(node.attrs.nodeId) })
  return ids
}

/** 去掉编辑器在文档末尾补的空光标段落（若有），并遮蔽自动生成的 nodeId。 */
function comparableSave(saved: PMJsonNode, knownIds: ReadonlySet<string>): PMJsonNode {
  const content = [...(saved.content ?? [])]
  const last = content.at(-1)
  if (last && ['stdParagraph', 'paragraph'].includes(last.type) && !last.content?.length && !knownIds.has(String(last.attrs?.nodeId))) content.pop()
  return maskGenerated({ ...saved, content }, knownIds)
}

/** 两份 JSON 的差异路径（只比较到叶子）。 */
function diffPaths(left: unknown, right: unknown, path = '$', out: string[] = []): string[] {
  if (JSON.stringify(left) === JSON.stringify(right)) return out
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      diffPaths((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}.${key}`, out)
    }
    return out
  }
  out.push(path)
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. fixture 覆盖
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-4.4.2.3-02] [M-10.1.4-01] [M-8.5-01] [M-8.3-02] [M-9.2.9-01] [M-5.6-05] 全要素 fixture：覆盖设计 §3.3 的 12 个新节点与 2 个新 mark', () => {
  const fixture = canonicalFixture()

  it('Schema 校验通过；每个新节点类型、每个新 mark 类型至少出现一次', () => {
    for (const type of WP8M_NEW_NODE_TYPES) expect(nodesOfType(fixture, type).length, type).toBeGreaterThan(0)
    const marks = new Set<string>()
    visit(fixture, node => node.marks?.forEach(mark => marks.add(mark.type)))
    for (const type of WP8M_NEW_MARK_TYPES) expect(marks.has(type), type).toBe(true)
  })

  it('既有节点的新写法也都在：roman 列项、figure 内 note / example / figureLegend、termDef 内 termSubjectField、stdTable.columns、单元格边框样式', () => {
    expect(nodesOfType(fixture, 'stdList').some(list => list.attrs?.listType === 'roman')).toBe(true)
    const figures = nodesOfType(fixture, 'figure')
    expect(figures.some(figure => figure.content?.some(child => child.type === 'note'))).toBe(true)
    expect(figures.some(figure => figure.content?.some(child => child.type === 'example'))).toBe(true)
    expect(figures.some(figure => figure.content?.some(child => child.type === 'figureLegend'))).toBe(true)
    expect(nodesOfType(fixture, 'termDef').some(term => term.content?.some(child => child.type === 'termSubjectField'))).toBe(true)
    expect(nodesOfType(fixture, 'stdTable').some(table => Array.isArray(table.attrs?.columns))).toBe(true)
    const cells = [...nodesOfType(fixture, 'tableCell'), ...nodesOfType(fixture, 'tableHeader')]
    expect(cells.some(cell => ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'].some(key => typeof cell.attrs?.[key] === 'string'))).toBe(true)
    expect(fixture.content?.some(node => node.type === 'introduction' && node.content?.some(child => child.type === 'clause'))).toBe(true)
    expect(nodesOfType(fixture, 'bibliographyTitle')[0]?.content?.[0]?.text).toBe('参考书目')
    const refTypes = new Set<string>()
    visit(fixture, node => node.marks?.forEach(mark => { if (mark.type === 'crossRef') refTypes.add(String(mark.attrs?.refType)) }))
    expect(refTypes.has('abbreviation')).toBe(true)
    expect(refTypes.has('listItem')).toBe(true)
  })

  it('nodeId 全文唯一（各组 fixture 的 g1-…g8- 前缀不冲突）', () => {
    const ids: string[] = []
    visit(fixture, node => { if (typeof node.attrs?.nodeId === 'string') ids.push(node.attrs.nodeId) })
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(150)
  })

  it('文档带 extensionVersion=1（G1～G8 全部是语义扩展）', () => {
    expect(fixture.attrs).toMatchObject({ extensionVersion: 1 })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// 2. IR 原生版本与 Resolver
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-4.3.4-03] [M-9.2.1-05] [M-10.1.5-02] IR 原生版本与 Resolver', () => {
  const original = canonicalFixture()

  it('pmToIr(生产 PM fixture) 与 IR 原生版本（shared 的 wp8mFixtures.ts）深度相等；无 warning、无 unsupportedContent', () => {
    const { doc, warnings } = pmToIr(original)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.extensionVersion).toBe(1)
    expect(clone(doc)).toEqual(clone(createWp8mIrDoc()))
  })

  it('IR 原生版本经 irToPm 得到的文档，与生产 PM fixture 经一次往返后的稳定形态逐节点相同', () => {
    const emitted = schema.nodeFromJSON(irToPm(createWp8mIrDoc()))
    emitted.check()
    expect(emitted.toJSON()).toEqual(normalizedFixture())
  })

  it('Resolver 不报 error；warning 只有两条既有 fixture 写法带来的悬置段提示（术语章、缩略语章的引导语与条并存）', () => {
    const problems = resolve(pmToIr(original).doc).problems
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(problems.map(problem => [problem.code, problem.severity, problem.nodeId])).toEqual([
      ['hanging-paragraph', 'warning', 'g5-terms'],
      ['hanging-paragraph', 'warning', 'g2-abbr-ch'],
    ])
    expect(errorsOf(createWp8mIrDoc())).toEqual([])
  })

  it('各组新增的标签与 xmlId 在同一篇文档里同时正确（G1 ref_n、G2 abb_k、G4 li_k、G5 term_n、G6 sec_0.n、图注作用域）', () => {
    const { labels } = resolve(pmToIr(original).doc)
    // G1 规范性引用条目：ref_<清单内序号>，label 为空
    for (const [index, id] of ['g1-nr-1', 'g1-nr-2', 'g1-nr-3', 'g1-nr-4'].entries()) expect(labels[id], id).toMatchObject({ label: '', xmlId: `ref_${index + 1}` })
    // G2 缩略语项：abb_<全文序>，label 为缩略语文本
    const abbreviations = ['abb-adc', 'abb-agc', 'abb-ct', 'abb-clause', 'abb-app']
    for (const [index, id] of abbreviations.entries()) expect(labels[id]?.xmlId, id).toBe(`abb_${index + 1}`)
    expect(labels['abb-adc']).toMatchObject({ label: 'ADC', refText: 'ADC' })
    // G4 / G7 被引用的有序列项：li_<被引用者的文档序>，refText = 条编号 + 标记（全角右括号）
    expect(labels['g4-a3']).toMatchObject({ label: 'c）', xmlId: 'li_1', refText: '7.1 c）' })
    expect(labels['g4-n2']).toMatchObject({ label: '2）', xmlId: 'li_2', refText: '7.1 2）' })
    expect(labels['g7-r3']).toMatchObject({ label: 'iii）', xmlId: 'li_3', refText: '8.1 iii）' })
    for (const id of ['g4-a1', 'g4-d1', 'g7-r1', 'g7-e2-a']) expect(labels[id], `${id} 未被引用，不赋标签`).toBeUndefined()
    // G5 术语条目：独立 xmlId term_<编号>，与 sec_<编号> 并存
    expect(labels['g5-t1']).toMatchObject({ label: '3.1', xmlId: 'sec_3.1', termEntryXmlId: 'term_3.1' })
    expect(labels['g5-t331']).toMatchObject({ label: '3.3.1', termEntryXmlId: 'term_3.3.1' })
    expect(labels['g5-t-app']).toMatchObject({ label: 'C.1', termEntryXmlId: 'term_C.1' })
    // G6 引言中的条：0.n，xmlId sec_0.n
    expect(labels['g6-c1']).toMatchObject({ label: '0.1', xmlId: 'sec_0.1' })
    expect(labels['g6-c1-1']).toMatchObject({ label: '0.1.1', xmlId: 'sec_0.1.1' })
    expect(labels['g6-c3']).toMatchObject({ label: '0.3', xmlId: 'sec_0.3' })
    // G3 图与图内注 / 示例：作用域为所在图；G7 条内注 / 示例连续编号
    expect(labels['g3-fig-1']).toMatchObject({ label: '图1' })
    expect(labels['g3-fig-a1']).toMatchObject({ label: '图B.1' })
    expect(labels['g3-fig1-n1']?.label).toBe('注1：')
    expect(labels['g3-fig1-n2']?.label).toBe('注2：')
    expect(labels['g3-fig2-n1']?.label).toBe('注：')
    expect(labels['g3-fig1-e1']?.label).toBe('示例：')
    expect(['g7-n1', 'g7-n2', 'g7-n3'].map(id => labels[id]?.label)).toEqual(['注1：', '注2：', '注3：'])
    expect(['g7-e1', 'g7-e2'].map(id => labels[id]?.label)).toEqual(['示例1：', '示例2：'])
    // 任何目标都没有退化成 ext_ 占位标签（R-5：XML 不得出现 ext_）；文档级资源（行内图的 resourceId 指向它）不是 XML 元素，
    // 沿用 WP6 的 registerExtendedData 占位口径，其导出归 WP8.2（D-M-08），不在 WP8.M 范围
    expect(Object.entries(labels).filter(([id, label]) => label.xmlId.startsWith('ext_') && id !== 'g3-res-1').map(([id]) => id)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// 3. 总往返
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-Z] 总往返：生产 Schema → PM → IR → PM → 保存重开 → exportSemanticJson，两轮后 JSON 相等', () => {
  it('PM → IR → PM：只规范化旧写法（章 secType、表 headerRowCount、单元格段落），之后是不动点；冷重开再 pmToIr，IR 深度相等', () => {
    const original = canonicalFixture()
    const normalized = normalizedFixture()
    // 第一次往返只改动三类旧写法，新结构一个字节都不变
    const changed = diffPaths(original, normalized)
    expect(changed.length).toBeGreaterThan(0)
    const at = (root: unknown, path: string) => path.split('.').slice(1).reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], root)
    for (const path of changed) {
      const [before, after] = [at(original, path), at(normalized, path)]
      if (path.endsWith('.attrs.secType')) expect([before, ['terms', 'general'].includes(String(after))], path).toEqual([null, true])
      else if (path.endsWith('.attrs.headerRowCount')) expect([before, typeof after], path).toEqual([null, 'number'])
      else if (path.endsWith('.attrs.nodeId')) expect([before, /\.p0$/.test(String(after))], path).toEqual([null, true])
      else expect([path.endsWith('.type'), before, after], path).toEqual([true, 'paragraph', 'stdParagraph'])
    }
    // 不动点：再往返一次完全相同
    const again = schema.nodeFromJSON(irToPm(pmToIr(normalized).doc))
    again.check()
    expect(again.toJSON()).toEqual(normalized)
    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(again.toJSON())) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(pmToIr(original).doc)
  })

  it('两轮保存重开：每一轮都 PM → IR → PM 再用 Editor + replaceEditorDocument 加载，保存 JSON 与语义 JSON 两轮相等', () => {
    const original = canonicalFixture()
    const normalized = normalizedFixture()
    const known = knownIdsOf(normalized)
    const mask = <T>(json: T) => maskGenerated(json, known)

    // 第一轮：fixture → IR → PM → 加载 → 保存 → 导出
    const ir1 = pmToIr(original)
    expect(ir1.warnings).toEqual([])
    expect(errorsOf(ir1.doc)).toEqual([])
    const pm1 = irToPm(ir1.doc)
    schema.nodeFromJSON(pm1).check()
    const round1 = saveAndReopen(pm1)
    expect(comparableSave(round1.saved, known)).toEqual(mask(normalized))

    // 第二轮：把保存下来的 JSON 再走一遍同样的链路
    const ir2 = pmToIr(round1.saved)
    expect(ir2.warnings).toEqual([])
    expect(ir2.doc.unsupportedContent).toBeUndefined()
    expect(errorsOf(ir2.doc)).toEqual([])
    expect(ir2.doc).toEqual(ir1.doc)
    const pm2 = irToPm(ir2.doc)
    schema.nodeFromJSON(pm2).check()
    const round2 = saveAndReopen(pm2)

    expect(comparableSave(round2.saved, known)).toEqual(comparableSave(round1.saved, known))
    expect(mask(round2.exported)).toEqual(mask(round1.exported))
    // 不经 IR 的直接加载稳定形态（最接近“打开已保存文档”）与经 IR 往返后的语义 JSON 一致
    expect(mask(saveAndReopen(clone(normalized)).exported)).toEqual(mask(round1.exported))
    // 同一份保存结果原样再打开、再导出：逐字相等（含编辑器补的 nodeId）
    expect(saveAndReopen(round1.saved).exported).toEqual(round1.exported)
  })

  it('语义 JSON 里出现全部新节点类型与新 mark，各组的编号都已由 Resolver 写入；没有 ext_ 占位 ID', () => {
    const { exported } = saveAndReopen(canonicalFixture())
    const text = JSON.stringify(exported)
    for (const type of [...WP8M_NEW_NODE_TYPES, ...WP8M_NEW_MARK_TYPES]) expect(text, type).toContain(`"${type}"`)
    expect(text).not.toContain('ext_')
    expect(text).toContain('"listType":"roman"')
    expect(text).toContain('"refType":"abbreviation"')
    expect(text).toContain('"refType":"listItem"')
    // G6 引言条编号 0.n、G5 术语编号（含附录 C.1）由 Resolver 写入语义 JSON
    for (const number of ['0.1', '0.1.1', '0.1.2', '0.2', '0.3', '3.3.1', '3.3.2', 'C.1']) expect(text, number).toContain(`"number":"${number}"`)
  })

  it('保存重开后文档根属性 extensionVersion=1 仍在，Editor 加载入口没有改写新结构', () => {
    const editor = mountedEditor()
    try {
      const normalized = normalizedFixture()
      replaceEditorDocument(editor, normalized as unknown as Record<string, unknown>)
      expect(editor.getJSON().attrs).toMatchObject({ extensionVersion: 1 })
      expect(comparableSave(editor.getJSON() as PMJsonNode, knownIdsOf(normalized)).content).toEqual(maskGenerated(normalized, knownIdsOf(normalized)).content)
    } finally {
      editor.destroy()
    }
  })
})

describe('[M-Z] HTML 往返：DOMSerializer / DOMParser 两轮后节点类型、nodeId 与属性不变', () => {
  it('全要素文档两轮 HTML 往返后内容与规范化 JSON 相同（根属性 extensionVersion 不随 HTML 片段走）', () => {
    const original = canonicalFixture()
    const { html, current } = roundtripHtml(original)
    expect(current.content).toEqual(original.content)
    const rendered = document.createElement('div')
    rendered.innerHTML = html
    for (const selector of [
      '[data-type="norm-ref-list"]', '[data-type="def-list"]', '[data-type="figure-legend"]', '[data-type="inline-image"]',
      '[data-type="term-subject-field"]', '[data-type="note-block"]', '[data-type="example-block"]', '[data-type="std-ref"]', '[data-type="mixed-citation"]',
      '[data-list-type="roman"]', '[data-columns]',
    ]) expect(rendered.querySelector(selector), selector).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// 4. 输出边界
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-Z] 输出边界：全要素文档的 getOutputSupportProblems 与设计 §3.4 + §7.1 逐项一致', () => {
  const { doc } = pmToIr(canonicalFixture())
  const problemsOf = (format: OutputBoundaryFormat) => getOutputSupportProblems(doc, format)
  const pairs = (problems: OutputSupportProblem[]) => problems.map(problem => `${problem.nodeId ?? '-'} ${problem.path.replace(/^doc\./, '')}`)

  /** §7.1 暂报 unsupported-output 的结构（HTML 与 DOCX 的全部问题只能是这些）。 */
  const G3_BLOCKED = [
    'g3-scope-p body[0].children[2].content[1].image',
    'g3-ch-p body[5].children[0].content[1].image',
    'g3-ch-p body[5].children[0].content[3].image',
    'g3-fig-1 body[5].children[1].legend',
    'g3-fig-1 body[5].children[1].examples',
    'g3-fig-2 body[5].children[2].examples',
    'g3-list-i1.p0 body[5].children[3].items[0].content[0].content[1].image',
    'g3-note.p0 body[5].children[4].content[0].content[1].image',
    'g3-tab-r1c1.p0 body[5].children[5].rows[0].cells[0].content[0].content[1].image',
    'g3-fig-a1 appendices[1].children[1].legend',
    // 行内图通过 resourceId 引用的文档级资源：doc.resources 本就不在任何格式的 doc 字段表内
    '- resources',
  ]
  const G8_BLOCKED = [
    'g8-tbl-2col.r1c0 body[8].children[1].rows[1].cells[0].style',
    'g8-tbl-2col.r1c1 body[8].children[1].rows[1].cells[1].style',
    'g8-tbl-2col body[8].children[1].columns',
    'g8-tbl-merged body[8].children[2].columns',
  ]

  it.each(['HTML', 'DOCX'] as const)('%s：G1、G2、G5、G6、G7 与 figure.notes 放行；只有图例、图中示例、行内图（G3）与列宽、边框样式（G8）被阻断', format => {
    expect(pairs(problemsOf(format)).sort()).toEqual([...G3_BLOCKED, ...G8_BLOCKED].sort())
  })

  it.each(['HTML', 'DOCX'] as const)('%s：放行项逐一核对——规范性引用清单、两种 mark、自定义标题、缩略语表、术语领域、引言条、罗马列项、多块注 / 示例、图注、列项 / 缩略语引用', format => {
    const blockedIds = new Set(problemsOf(format).map(problem => problem.nodeId))
    for (const id of [
      'g1-nrl', 'g1-nr-1', 'g1-nr-4', 'g1-ch3-p1', 'g1-ch3-p2', 'g1-list-i1.p0', 'g1-note.p0', // G1：清单、stdRef、mixedCitation
      'g2-list', 'abb-adc', 'g2-list-clause', 'g2-list-app', 'g2-scope-p', // G2：缩略语表与 abbreviation 引用
      'g4-ref', 'g4-l-alpha', 'g7-intro', // G4：列项引用
      'g5-t1', 'g5-t331', 'g5-t332', 'g5-t-app', // G5：领域
      'g6-c1', 'g6-c2', 'g6-c3', 'g6-ch1-c1-p', // G6：引言中的条
      'g7-l-roman', 'g7-e2-l', 'g7-n2', 'g7-e2', 'g7-fw-note', 'g7-t1-note', // G7：罗马列项、多块注 / 示例
      'g3-fig1-n1', 'g3-fig1-n2', 'g3-fig2-n1', 'g3-figa1-n1', // G3：图注 figure.notes
    ]) expect(blockedIds.has(id), `${format} 不应阻断 ${id}`).toBe(false)
    // figure.notes 放行：没有任何问题路径指向 .notes
    expect(problemsOf(format).some(problem => problem.path.endsWith('.notes'))).toBe(false)
    // 引言条、自定义标题的字段本身放行
    expect(problemsOf(format).some(problem => /introductionClauses|bibliographyTitle|subjectField|\.kind$|marks\[\d+\]\.type/.test(problem.path))).toBe(false)
  })

  it('XML：G1（清单、两种 mark、标题）、G2（缩略语表）、G5（领域）、G6（引言条）、G3、G8 全部阻断；罗马列项因旧序列化器降级为数字也阻断', () => {
    const paths = problemsOf('XML').map(problem => problem.path.replace(/^doc\./, ''))
    for (const pattern of [
      /^front\.introductionClauses$/, /^bibliographyTitle$/, /\.kind$/, /\.subjectField$/, /marks\[\d+\]\.type$/,
      /\.image$/, /\.legend$/, /\.examples$/, /\.columns$/, /\.style$/, /^resources$/, /\.listType$/,
    ]) expect(paths.some(path => pattern.test(path)), String(pattern)).toBe(true)
    // 清单与缩略语表两种新 kind 各被阻断
    const kinds = problemsOf('XML').filter(problem => problem.path.endsWith('.kind')).map(problem => problem.nodeId)
    expect(kinds).toEqual(expect.arrayContaining(['g1-nrl', 'g2-list', 'g2-list-clause', 'g2-list-app']))
    // 每个罗马列项各一条（正文列表与示例块内的列表）
    expect(problemsOf('XML').filter(problem => problem.path.endsWith('.listType')).map(problem => problem.nodeId)).toEqual(['g7-l-roman', 'g7-e2-l'])
    // figure.notes 与多块注 / 示例在 XML 字段表内放行
    expect(paths.some(path => path.endsWith('.notes'))).toBe(false)
    expect(problemsOf('XML').some(problem => ['g7-n2', 'g7-e2', 'g7-fw-note', 'g7-t1-note'].includes(problem.nodeId ?? ''))).toBe(false)
  })

  // WP8.2 T2.4a-1：XML46687 不再与 XML 一致。差集（XML 阻断而 XML46687 放行）必须逐条落在 XML46687_DECLARED_DIFFERENCES 内，
  // XML46687 不得比 XML 多阻断，共同阻断的问题逐条相同。差集是计算值，T2.4b / T2.4c 再放行字段时本测试无需修改。
  const keyOf = (problem: OutputSupportProblem) => `${problem.nodeId ?? '-'} ${problem.path}`
  const differenceOf = () => {
    const xml = problemsOf('XML')
    const xml46687 = problemsOf('XML46687')
    const xmlKeys = new Set(xml.map(keyOf))
    const nextKeys = new Set(xml46687.map(keyOf))
    return {
      xml, xml46687,
      onlyXml: xml.filter(problem => !nextKeys.has(keyOf(problem))),
      onlyNew: xml46687.filter(problem => !xmlKeys.has(keyOf(problem))),
      common: xml.filter(problem => nextKeys.has(keyOf(problem))),
    }
  }

  it('XML46687 与 XML 的差集恰等于已声明差异（XML46687_DECLARED_DIFFERENCES，计算值）：不比 XML 多阻断，共同阻断的逐条相同', () => {
    const { xml46687, onlyXml, onlyNew, common } = differenceOf()
    expect(XML46687_DECLARED_DIFFERENCES.length).toBeGreaterThan(0)
    expect(onlyNew).toEqual([])
    expect(onlyXml.length).toBeGreaterThan(0)
    for (const problem of onlyXml) expect(findDeclaredDifference(doc, problem.path), `${keyOf(problem)} 应是已声明差异`).toBeDefined()
    // 共同阻断的问题：nodeId 与路径相同，消息只差格式名
    const strip = (problem: OutputSupportProblem) => ({ nodeId: problem.nodeId, path: problem.path })
    expect(xml46687.map(strip)).toEqual(common.map(strip))
    expect(xml46687.map(problem => problem.message)).toEqual(common.map(problem => problem.message.replace(/^XML /, 'XML46687 ')))
  })

  it('差集里包含旧 XML 阻断的两个罗马列项（XML46687 的 roman-lower 自 T2.4a-1 起消费），且每个罗马列项都被声明项覆盖', () => {
    const { onlyXml } = differenceOf()
    const roman = onlyXml.filter(problem => problem.path.endsWith('.listType'))
    expect(roman.map(problem => problem.nodeId)).toEqual(['g7-l-roman', 'g7-e2-l'])
    for (const problem of roman) expect(findDeclaredDifference(doc, problem.path)).toMatchObject({ kind: 'field', name: 'listType' })
    expect(problemsOf('XML46687').some(problem => problem.path.endsWith('.listType'))).toBe(false)
  })

  it('没有 unsupportedContent 或 Resolver unsupported-content error 带来的额外阻断：每种格式都没有 resolver 来源的问题', () => {
    for (const format of FORMATS) expect(problemsOf(format).some(problem => problem.path.startsWith('resolver.')), format).toBe(false)
  })

  it('四种格式的问题数量（回归基线）：HTML 15、DOCX 15、XML 与 XML46687 之差恰为被声明差异覆盖的问题数（计算值）', () => {
    expect(problemsOf('HTML')).toHaveLength(G3_BLOCKED.length + G8_BLOCKED.length)
    expect(problemsOf('DOCX')).toHaveLength(G3_BLOCKED.length + G8_BLOCKED.length)
    const covered = problemsOf('XML').filter(problem => findDeclaredDifference(doc, problem.path) !== undefined)
    expect(problemsOf('XML').length - problemsOf('XML46687').length).toBe(covered.length)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// 5. 真实渲染
// ---------------------------------------------------------------------------------------------------------------------

/** 去掉 §7.1 暂不排版的结构：图例、图中示例、行内图（含其资源）、名义列宽、单元格边框样式。 */
function withoutBlockedStructures(source: IRDoc): IRDoc {
  const doc = clone(source)
  const strip = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(strip); return }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (row.kind === 'figure') { delete row.legend; delete row.examples }
    if (row.kind === 'table') delete row.columns
    if (Array.isArray(row.cells)) for (const cell of row.cells as Record<string, unknown>[]) delete cell.style
    for (const [key, child] of Object.entries(row)) {
      if (Array.isArray(child)) row[key] = child.filter(entry => !(entry && typeof entry === 'object' && 'image' in entry))
      strip(row[key])
    }
  }
  strip(doc)
  delete doc.resources
  return doc
}

describe('[M-Z] 真实渲染：去掉 §7.1 暂不排版的结构后，HTML（screen / print）与 DOCX 可以完整输出', () => {
  const stripped = withoutBlockedStructures(pmToIr(canonicalFixture()).doc)
  const { labels } = resolve(stripped)
  const docxOptions = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-26T08:00:00.000Z' }

  it('剥离后 HTML、DOCX 没有任何 unsupported-output；旧 XML 仍因 G1/G2/G5/G6 的新结构阻断；XML46687 的阻断是 XML 的子集', () => {
    expect(getOutputSupportProblems(stripped, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(stripped, 'DOCX')).toEqual([])
    expect(getOutputSupportProblems(stripped, 'XML').length).toBeGreaterThan(0)
    // WP8.2 逐步放行：XML46687 阻断的路径都是 XML 也阻断的（随 T2.4b / T2.4c 放行而减少，不在这里钉数量）
    const xmlPaths = new Set(getOutputSupportProblems(stripped, 'XML').map(problem => problem.path))
    for (const problem of getOutputSupportProblems(stripped, 'XML46687')) expect(xmlPaths.has(problem.path), problem.path).toBe(true)
  })

  it.each(['screen', 'print'] as const)('HTML %s：各组结构都按 §7.1 排版', variant => {
    const html = renderHtml(stripped, labels, { variant })
    for (const fragment of [
      'data-type="norm-ref-list"', 'class="ses-norm-ref-no">GB/T 321</span>　<span class="ses-norm-ref-title">优先数和优先数系</span>', // G1 清单
      '<h2 class="ses-bib-title">参考书目</h2>', // G1 标题
      'GB/T 3102.1的规定，并遵守《中华人民共和国计量法》。', // G1 mark 按普通文本输出
      'class="ses-def-list"', '<span class="ses-def-term">ADC</span><span class="ses-def-sep">：</span>', 'id="abb_1"', // G2
      '〈顾客满意〉', '〈<strong>化学</strong>〉', // G5 领域
      '<span class="ses-num">0.1</span>背景', 'id="sec_0.1"', 'id="sec_0.3"', // G6 引言条
      'ses-list-roman', 'id="li_1"', 'id="li_3"', '7.1 c）', '8.1 iii）', // G4 / G7 列项与引用
      'ses-note-multi', '<span class="ses-note-marker">注1：</span>图注一。', '<span class="ses-note-marker">注2：</span>图注二。', // G7 多块注、G3 图注
      'ses-example-multi',
    ]) expect(html, `${variant} 应含 ${fragment}`).toContain(fragment)
  })

  it('DOCX：段落文本含清单、缩略语表、术语领域、引言条、罗马列项引用文字、多块注', () => {
    const pkg = renderDocx(stripped, labels, docxOptions)
    const xml = pkg.parts['word/document.xml']!
    const text = xml.split('</w:p>').map(paragraph => paragraph.replace(/<w:instrText[^>]*>[^<]*<\/w:instrText>/g, '').replace(/<[^>]+>/g, '')).join('\n')
    for (const fragment of [
      'GB/T 321　优先数和优先数系', '《中华人民共和国计量法》', // G1
      'ADC：模数转换器（Analog-to-Digital Converter）', 'CO2：二氧化碳', // G2
      '〈顾客满意〉由成员组织或个人组成的组织。', '〈化学〉没有英文名、领域含粗体的术语条目。', // G5
      '编制目的，见0.1。', '无标题条的条文。', // G6
      '见7.1 c）与7.1 2）', '分下列步骤，见8.1 iii），并见注3。', // G4 / G7
      '多块注的第一段。', '第二段带脚注', '前言注的第二段。', '单元格内注的第二段。', // G7
      '图注一。', '图注二。', // G3 图注
    ]) expect(text, `应含 ${fragment}`).toContain(fragment)
    expect(pkg.parts['word/footnotes.xml']).toContain('注内段落的脚注。')
  })
})
