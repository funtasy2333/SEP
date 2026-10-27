// @vitest-environment happy-dom
/**
 * WP8.M G6：引言中的条（docs/wp8.m/design.md §3.6、§4.6；矩阵 M-4.3.4-02、M-4.3.4-03；约定 C-S-10、X-05、R-7）。
 *
 * 四类用例：Schema、往返（PM→IR→PM）、HTML 往返、保存重开（Editor + replaceEditorDocument + exportSemanticJson）；
 * 外加输出边界（HTML/DOCX/XML/XML46687）与显示（编辑器编号投影、大纲）。生产 Schema 对引言不做改动：
 * `introduction` 的内容表达式 `block+` 本来就含 `clause`，缺的只是 pmToIr / irToPm 的映射。
 */

import { getSchema } from '@tiptap/core'
import { Editor } from '@tiptap/vue-3'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { describe, expect, it } from 'vitest'
import { findDeclaredDifference, getOutputSupportProblems, irToPm, pmToIr, resolve, type IRClause, type PMJsonNode, type OutputBoundaryFormat } from '@ses/shared'
import DocumentOutline from '../components/editor/DocumentOutline.vue'
import { docToText } from '../utils/docDiff'
import { replaceEditorDocument } from '../utils/editorDocument'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { createEditorExtensions } from './editorExtensions'
import { createG6Fixture, createG6IntroductionNode } from './__fixtures__/wp8m-g6'

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

function clauseIds(clauses: readonly IRClause[]): string[] {
  return clauses.flatMap(clause => [clause.id, ...clauseIds(clause.children.filter((child): child is IRClause => child.kind === 'clause'))])
}

function semanticNumbers(root: ReturnType<typeof exportSemanticJson>): Map<string, string> {
  const result = new Map<string, string>()
  const walk = (node: ReturnType<typeof exportSemanticJson>): void => {
    const id = node.attrs?.nodeId
    if (node.type === 'clause' && typeof id === 'string' && typeof node.number === 'string') result.set(id, node.number)
    node.content?.forEach(walk)
  }
  walk(root)
  return result
}

describe('[M-4.3.4-02] 生产 Schema：引言容器可以含条，Schema 不需要改', () => {
  it('fixture 通过 Schema 校验；introduction 的内容表达式允许 clause，空引言与缺标题的条被拒绝', () => {
    const root = schema.nodeFromJSON(createG6Fixture())
    expect(() => root.check()).not.toThrow()
    expect(schema.nodes.introduction!.contentMatch.matchType(schema.nodes.clause!)).not.toBeNull()
    expect(schema.nodes.introduction!.spec.content).toBe('block+')

    expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'introduction' }] }).check()).toThrow()
    const withoutTitle = createG6Fixture()
    const introduction = withoutTitle.content!.find(node => node.type === 'introduction')!
    introduction.content![0]!.content = introduction.content![0]!.content!.filter(node => node.type !== 'clauseTitle')
    expect(() => schema.nodeFromJSON(withoutTitle).check()).toThrow()
  })

  it('引言条与正文条是同一种 PM 节点：同一组属性（level、hasTitle），没有为引言新增节点或属性', () => {
    const clause = schema.nodes.clause!
    expect(Object.keys(clause.spec.attrs ?? {}).sort()).toEqual(['hasTitle', 'id', 'level', 'number', 'nodeId'].sort())
    expect(schema.nodes.introduction!.spec.attrs).toBeDefined()
  })
})

describe('[M-4.3.4-02][M-4.3.4-03] 往返：生产 PM → pmToIr → Resolver → irToPm → 生产 PM', () => {
  const fixture = createG6Fixture()
  const original = schema.nodeFromJSON(fixture)
  original.check()
  const originalJson = original.toJSON() as PMJsonNode

  it('pmToIr：无 warning、无 unsupportedContent；条进入 front.introductionClauses，extensionVersion 为 1', () => {
    const { doc, warnings } = pmToIr(originalJson)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.extensionVersion).toBe(1)
    expect(doc.front.introduction).toEqual([])
    expect(doc.front.introductionClauses?.map(clause => clause.id)).toEqual(['g6-c1', 'g6-c2', 'g6-c3'])
    expect(clauseIds(doc.front.introductionClauses!)).toEqual(['g6-c1', 'g6-c1-1', 'g6-c1-2', 'g6-c2', 'g6-c3'])
    expect(doc.front.introductionClauses?.map(clause => [clause.level, clause.titled])).toEqual([[1, true], [1, true], [1, false]])
    expect(resolve(doc).problems.filter(problem => problem.severity === 'error')).toEqual([])
  })

  it('Resolver：0.1、0.1.1、0.1.2、0.2、0.3；正文章条仍是 1、1.1；正文引用的 refText 为 0.1 / 0.1.1', () => {
    const { labels } = resolve(pmToIr(originalJson).doc)
    expect(Object.fromEntries(['g6-c1', 'g6-c1-1', 'g6-c1-2', 'g6-c2', 'g6-c3'].map(id => [id, [labels[id]!.label, labels[id]!.xmlId]]))).toEqual({
      'g6-c1': ['0.1', 'sec_0.1'], 'g6-c1-1': ['0.1.1', 'sec_0.1.1'], 'g6-c1-2': ['0.1.2', 'sec_0.1.2'],
      'g6-c2': ['0.2', 'sec_0.2'], 'g6-c3': ['0.3', 'sec_0.3'],
    })
    expect(labels['g6-ch1']).toMatchObject({ label: '1', xmlId: 'sec_1' })
    expect(labels['g6-ch1-c1']).toMatchObject({ label: '1.1', xmlId: 'sec_1.1' })
    expect(labels['g6-fn1']).toMatchObject({ label: '1)' })
  })

  it('irToPm 后 Schema 校验通过，节点 ID、属性与原文档逐节点相同；再经 JSON 冷重开、再次 pmToIr 后 IR 深度相等', () => {
    const first = pmToIr(originalJson).doc
    const emitted = irToPm(first)
    const roundtrip = schema.nodeFromJSON(emitted)
    roundtrip.check()
    const before = byId(originalJson)
    const after = byId(roundtrip.toJSON() as PMJsonNode)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [id, record] of before) {
      for (const [key, value] of Object.entries(record.attrs ?? {})) {
        if (value !== null && value !== undefined) expect(after.get(id)?.attrs?.[key], `${id}.${key}`).toEqual(value)
      }
    }
    // 引言子树完全相同（节点类型、顺序、文本）
    expect(roundtrip.toJSON().content.find((node: PMJsonNode) => node.type === 'introduction'))
      .toEqual(originalJson.content!.find(node => node.type === 'introduction'))
    expect(roundtrip.toJSON()).toEqual(originalJson)

    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(roundtrip.toJSON())) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(first)
  })

  it('引言块 + 条：块在前、条在后，往返后顺序不变；没有条的引言往返后不出现条也不写 extensionVersion', () => {
    const mixed = createG6Fixture()
    const introduction = mixed.content!.find(node => node.type === 'introduction')!
    introduction.content!.unshift({ type: 'stdParagraph', attrs: { nodeId: 'g6-lead' }, content: [{ type: 'text', text: '导语。' }] })
    const { doc, warnings } = pmToIr(schema.nodeFromJSON(mixed).toJSON() as PMJsonNode)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.front.introduction.map(block => block.id)).toEqual(['g6-lead'])
    const back = schema.nodeFromJSON(irToPm(doc))
    back.check()
    expect(back.toJSON()).toEqual(schema.nodeFromJSON(mixed).toJSON())

    const legacy: PMJsonNode = { type: 'doc', content: [
      { type: 'introduction', attrs: { nodeId: 'intro' }, content: [{ type: 'stdParagraph', attrs: { nodeId: 'intro-p' }, content: [{ type: 'text', text: '仅有引言正文。' }] }] },
      { type: 'chapter', attrs: { nodeId: 'ch' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] }, { type: 'stdParagraph', attrs: { nodeId: 'ch-p' }, content: [{ type: 'text', text: '正文' }] }] },
    ] }
    const legacyIr = pmToIr(legacy).doc
    expect(legacyIr.front.introductionClauses).toBeUndefined()
    expect(legacyIr.extensionVersion).toBeUndefined()
    expect(irToPm(legacyIr).attrs).toBeUndefined()
  })

  it('条之后的引言正文块（悬置段）：pmToIr 给 unsupportedContent，不重排、不静默丢弃；导出边界与 irToPm 都拒绝', () => {
    const dangling = createG6Fixture()
    const introduction = dangling.content!.find(node => node.type === 'introduction')!
    introduction.content!.push({ type: 'stdParagraph', attrs: { nodeId: 'g6-hanging' }, content: [{ type: 'text', text: '悬置段' }] })
    schema.nodeFromJSON(dangling).check() // Schema 允许（block+），问题要在映射层诊断
    const { doc } = pmToIr(dangling)
    expect(doc.unsupportedContent).toHaveLength(1)
    expect(doc.unsupportedContent![0]).toMatchObject({ nodeId: 'g6-hanging', nodeType: 'stdParagraph' })
    expect(doc.unsupportedContent![0]!.reason).toContain('悬置段')
    expect(doc.front.introduction.map(block => block.id)).toEqual(['g6-hanging'])
    for (const format of ['HTML', 'DOCX', 'XML', 'XML46687'] as OutputBoundaryFormat[]) {
      expect(getOutputSupportProblems(doc, format).some(problem => problem.nodeId === 'g6-hanging'), format).toBe(true)
    }
    expect(() => irToPm(doc)).toThrow()
    expect(resolve(doc).problems.some(problem => problem.code === 'unsupported-content' && problem.severity === 'error')).toBe(true)
  })

  it('一个条标题里没有内容的无题条：沿用正文无题条的映射（titled=false，title 为空）', () => {
    const { doc } = pmToIr(originalJson)
    const untitled = doc.front.introductionClauses!.find(clause => clause.id === 'g6-c3')!
    expect(untitled).toMatchObject({ titled: false, title: [] })
  })
})

describe('[M-4.3.4-02] HTML 往返：DOMSerializer / DOMParser 两轮后节点、nodeId、属性不变', () => {
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

  it('引言里的条序列化为 section[data-type=clause]（含 data-level、data-has-title），重新解析后得到同样的引言子树', () => {
    const fixture = schema.nodeFromJSON(createG6Fixture()).toJSON() as PMJsonNode
    const { html, current } = roundtripHtml(fixture)
    const rendered = document.createElement('div')
    rendered.innerHTML = html
    const intro = rendered.querySelector('section[data-type="introduction"]')!
    expect(intro).not.toBeNull()
    expect([...intro.querySelectorAll('section[data-type="clause"]')].map(element => element.getAttribute('data-level'))).toEqual(['1', '2', '2', '1', '1'])
    expect(intro.querySelector('section[data-type="clause"][data-has-title="false"]')).not.toBeNull()
    expect(intro.querySelector('h3[data-type="clause-title"]')?.textContent).toBe('背景')
    expect(current.content!.find(node => node.type === 'introduction')).toEqual(fixture.content!.find(node => node.type === 'introduction'))
    const before = byId(fixture)
    const after = byId(current)
    for (const id of ['g6-c1', 'g6-c1-1', 'g6-c1-2', 'g6-c2', 'g6-c3', 'g6-c1-1-note', 'g6-fn1']) {
      expect(after.get(id)?.type, id).toBe(before.get(id)?.type)
      expect(after.get(id)?.attrs?.nodeId, id).toBe(id)
    }
    expect(after.get('g6-c3')?.attrs).toMatchObject({ hasTitle: false, level: 1 })
    expect(after.get('g6-c1-1')?.attrs).toMatchObject({ level: 2 })
  })
})

describe('[M-4.3.4-02][M-4.3.4-03] 保存重开：Editor + replaceEditorDocument + exportSemanticJson', () => {
  function mountedEditor(): Editor {
    const editor = new Editor({ extensions, content: '<p></p>' })
    editor.mount(document.createElement('div'))
    return editor
  }

  it('加载 → 导出语义 JSON → 再加载 → 再导出：JSON 相等；引言条带 Resolver 编号（number/path 为 0.1…），正文章条编号不变', () => {
    const editor = mountedEditor()
    expect(replaceEditorDocument(editor, createG6Fixture() as unknown as Record<string, unknown>)).toBe(true)
    expect(editor.getJSON().attrs).toMatchObject({ extensionVersion: 1 })
    const firstSave = editor.getJSON() as PMJsonNode
    const firstExport = exportSemanticJson(editor.state.doc)
    expect(semanticNumbers(firstExport)).toEqual(new Map([
      ['g6-c1', '0.1'], ['g6-c1-1', '0.1.1'], ['g6-c1-2', '0.1.2'], ['g6-c2', '0.2'], ['g6-c3', '0.3'], ['g6-ch1-c1', '1.1'],
    ]))

    // 重开：用保存出来的 JSON（经 JSON 序列化，等价于落库再读回）加载到另一个编辑器
    const reopened = mountedEditor()
    replaceEditorDocument(reopened, JSON.parse(JSON.stringify(firstSave)) as Record<string, unknown>)
    expect(reopened.getJSON()).toEqual(firstSave)
    expect(exportSemanticJson(reopened.state.doc)).toEqual(firstExport)
    // 再保存一轮，仍然一致
    const secondSave = reopened.getJSON() as PMJsonNode
    const third = mountedEditor()
    replaceEditorDocument(third, JSON.parse(JSON.stringify(secondSave)) as Record<string, unknown>)
    expect(exportSemanticJson(third.state.doc)).toEqual(firstExport)
    expect(JSON.stringify(secondSave)).not.toContain('resolvedLabel')
    for (const target of [editor, reopened, third]) target.destroy()
  })

  it('导出的语义 JSON 里引言条的 number 与 Resolver 一致，引言容器带固定 path「引言」，不把编号写回 PM 属性', () => {
    const editor = mountedEditor()
    replaceEditorDocument(editor, createG6Fixture() as unknown as Record<string, unknown>)
    const exported = exportSemanticJson(editor.state.doc)
    const introduction = exported.content!.find(node => node.type === 'introduction')!
    expect(introduction.path).toBe('引言')
    expect(introduction.content!.map(node => [node.number, node.path])).toEqual([['0.1', '0.1'], ['0.2', '0.2'], ['0.3', '0.3']])
    expect(JSON.stringify(editor.getJSON())).not.toMatch(/"number":"/) // 编号不写回 PM 属性（number 属性恒为 null）
    editor.destroy()
  })

  it('docDiff 文本化：引言条带 0.n 编号（与大纲、导出同一个 Resolver）', () => {
    const text = docToText(createG6Fixture() as unknown as Record<string, unknown>)
    expect(text).toContain('0.1 背景')
    expect(text).toContain('0.1.1 起因')
    expect(text).toContain('0.2 目的')
    expect(text).toContain('0.3 [无题条]')
    expect(text).toContain('1.1 一般要求')
  })
})

describe('[M-4.3.4-02] 输出边界：HTML、DOCX、XML46687 放行，XML 阻断（来自生产 PM）', () => {
  const { doc } = pmToIr(schema.nodeFromJSON(createG6Fixture()).toJSON() as PMJsonNode)

  it.each([['HTML', []], ['DOCX', []]] as const)('%s：没有 unsupported-output', (format, expected) => {
    expect(getOutputSupportProblems(doc, format)).toEqual(expected)
  })

  it('XML：unsupported-output 指向 front.introductionClauses', () => {
    const problems = getOutputSupportProblems(doc, 'XML')
    expect(problems.map(problem => problem.path)).toEqual(['doc.front.introductionClauses'])
    expect(problems[0]).toMatchObject({ code: 'unsupported-output' })
  })

  // WP8.2 T2.4a-1：XML46687 放行引言条（写成 sec_0.<n>），并登记为已声明差异
  it('XML46687：放行 front.introductionClauses，该项是已声明差异', () => {
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    expect(findDeclaredDifference(doc, 'doc.front.introductionClauses')).toMatchObject({ kind: 'field', name: 'introductionClauses' })
  })
})

describe('[M-4.3.4-03] 显示：编辑器按 Resolver 标签显示 0.n，大纲遍历引言内的条', () => {
  it('编辑器 DOM：引言条标题带 data-resolved-label（0.1、0.1.1…），与 Resolver 一致；正文条为 1.1', () => {
    const editor = new Editor({ extensions, content: createG6Fixture() })
    editor.mount(document.createElement('div'))
    const labels = resolve(pmToIr(editor.getJSON() as PMJsonNode).doc).labels
    const titleOf = (id: string) => editor.view.dom.querySelector<HTMLElement>(`section[data-type="clause"][data-node-id="${id}"] > [data-type="clause-title"]`)
    expect(editor.view.dom.querySelector('section[data-type="introduction"]')).not.toBeNull()
    expect(titleOf('g6-c1')?.dataset.resolvedLabel).toBe('0.1')
    expect(titleOf('g6-c1-1')?.dataset.resolvedLabel).toBe('0.1.1')
    expect(titleOf('g6-c1-2')?.dataset.resolvedLabel).toBe('0.1.2')
    expect(titleOf('g6-c2')?.dataset.resolvedLabel).toBe('0.2')
    expect(titleOf('g6-ch1-c1')?.dataset.resolvedLabel).toBe('1.1')
    for (const element of editor.view.dom.querySelectorAll<HTMLElement>('[data-resolved-label]')) {
      const owner = element.closest<HTMLElement>('[data-node-id]')!
      expect(element.dataset.resolvedLabel).toBe(labels[owner.dataset.nodeId!]!.label)
    }
    // 引言里引用的标签随 Resolver 更新，且 PM JSON 里不缓存编号
    expect(JSON.stringify(editor.getJSON())).not.toContain('resolvedLabel')
    editor.destroy()
  })

  it('文档大纲：引言一项之下出现 0.1、0.1.1、0.1.2、0.2（无题条不进大纲），随后是第 1 章与 1.1；缩进层级与正文条一致', async () => {
    const editor = new Editor({ extensions, content: createG6Fixture() })
    editor.mount(document.createElement('div'))
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp({ render: () => h(DocumentOutline, { editor }) })
    app.use(ElementPlus).mount(root)
    await nextTick()
    const items = [...root.querySelectorAll<HTMLElement>('.outline-item')].map(element => ({
      text: element.querySelector('.outline-item-text')?.textContent,
      paddingLeft: element.style.paddingLeft,
    }))
    expect(items.map(item => item.text)).toEqual([
      '前言', '引言', '0.1 背景', '0.1.1 起因', '0.1.2 说明', '0.2 目的', '1 范围', '1.1 一般要求',
    ])
    // 层级按编号段数：引言 1 级、0.1 二级、0.1.1 三级，与 1 / 1.1 的缩进规则相同
    const padding = new Map(items.map(item => [item.text, item.paddingLeft]))
    expect(padding.get('引言')).toBe(padding.get('1 范围'))
    expect(padding.get('0.1 背景')).toBe(padding.get('1.1 一般要求'))
    expect(padding.get('0.1.1 起因')).not.toBe(padding.get('0.1 背景'))
    app.unmount()
    root.remove()
    editor.destroy()
  })

  it('大纲点击引言条会把光标移到该条标题处', async () => {
    const editor = new Editor({ extensions, content: createG6Fixture() })
    editor.mount(document.createElement('div'))
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp({ render: () => h(DocumentOutline, { editor }) })
    app.use(ElementPlus).mount(root)
    await nextTick()
    const target = [...root.querySelectorAll<HTMLElement>('.outline-item')].find(element => element.textContent?.includes('0.2 目的'))!
    target.click()
    await nextTick()
    const $from = editor.state.selection.$from
    expect($from.parent.type.name).toBe('clauseTitle')
    expect($from.node($from.depth - 1).attrs.nodeId).toBe('g6-c2')
    app.unmount()
    root.remove()
    editor.destroy()
  })
})

describe('[M-4.3.4-02] 引言节点单独往返（不依赖正文）', () => {
  it('createG6IntroductionNode 单独构成的引言在 irToPm(pmToIr()) 后保持不变', () => {
    const wrapper: PMJsonNode = { type: 'doc', attrs: { extensionVersion: 1 }, content: [
      createG6IntroductionNode(),
      { type: 'chapter', attrs: { nodeId: 'only-ch', secType: 'scope' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] }, { type: 'stdParagraph', attrs: { nodeId: 'only-p' }, content: [{ type: 'text', text: '正文' }] }] },
    ] }
    const normalized = schema.nodeFromJSON(wrapper).toJSON() as PMJsonNode
    const projected = schema.nodeFromJSON(irToPm(pmToIr(normalized).doc))
    projected.check()
    expect(projected.toJSON()).toEqual(normalized)
  })
})
