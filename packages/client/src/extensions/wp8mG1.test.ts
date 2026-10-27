// @vitest-environment happy-dom
/**
 * WP8.M G1：规范性引用文件清单、正文 std / mixed-citation 引用、参考文献标题
 * （docs/wp8.m/design.md §3.6、§4.1；矩阵 M-4.4.2.3-02/-03/-04、M-4.4.2.3.2-01、M-10.2-01/-02、M-10.1.7-01、M-4.5.3-02、M-E-06）。
 *
 * 四类用例：Schema、往返（PM→IR→PM）、HTML 往返、保存重开（Editor + replaceEditorDocument + exportSemanticJson）；
 * 外加粘贴 nodeId 重映射、输出边界（HTML/DOCX/XML/XML46687）与编辑器显示。
 */

import { getSchema } from '@tiptap/core'
import { Editor } from '@tiptap/vue-3'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems, irToPm, pmToIr, resolve, renderHtml, type IRNormRefList, type OutputBoundaryFormat, type PMJsonNode } from '@ses/shared'
import { docToText } from '../utils/docDiff'
import { replaceEditorDocument } from '../utils/editorDocument'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { createEditorExtensions } from './editorExtensions'
import { NODE_ID_TYPES, findNodeIdFixes, normalizeNodeIds } from './plugins/ensureNodeId'
import { createG1Fixture, createG1LegacyFixture } from './__fixtures__/wp8m-g1'

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

function normalized(): PMJsonNode {
  const node = schema.nodeFromJSON(createG1Fixture())
  node.check()
  return node.toJSON() as PMJsonNode
}

function mountedEditor(content: unknown = '<p></p>'): Editor {
  const editor = new Editor({ extensions, content: content as never })
  editor.mount(document.createElement('div'))
  return editor
}

describe('[M-4.4.2.3-02] 生产 Schema：normRefList 节点结构', () => {
  it('fixture 通过 Schema 校验；清单是 block 组节点，可作为章的子节点', () => {
    expect(() => schema.nodeFromJSON(createG1Fixture()).check()).not.toThrow()
    expect(schema.nodes.normRefList!.spec.group).toBe('block')
    expect(schema.nodes.chapter!.contentMatch.matchType(schema.nodes.chapterTitle!)?.matchType(schema.nodes.normRefList!)).not.toBeNull()
    expect(schema.nodes.normRefList!.spec.content).toBe('(normRefStd | normRefMixed)+')
  })

  it('条目节点不属于任何 group：只能出现在 normRefList 内，不能直接放在章里', () => {
    for (const name of ['normRefStd', 'normRefMixed', 'normRefStdRef', 'normRefStdTitle']) {
      expect(schema.nodes[name]!.spec.group, name).toBeUndefined()
    }
    const stray = createG1Fixture()
    const chapter = stray.content!.find(node => node.attrs?.nodeId === 'g1-ch2')!
    chapter.content!.push({ type: 'normRefMixed', attrs: { nodeId: 'g1-stray' }, content: [{ type: 'text', text: '游离条目' }] })
    expect(() => schema.nodeFromJSON(stray).check()).toThrow()
  })

  it('空清单被拒绝；清单内只能是 normRefStd / normRefMixed', () => {
    const empty = createG1Fixture()
    visit(empty, node => { if (node.type === 'normRefList') node.content = [] })
    expect(() => schema.nodeFromJSON(empty).check()).toThrow()
    const wrongChild = createG1Fixture()
    visit(wrongChild, node => { if (node.type === 'normRefList') node.content!.push({ type: 'stdParagraph', attrs: { nodeId: 'g1-x' } }) })
    expect(() => schema.nodeFromJSON(wrongChild).check()).toThrow()
  })

  it('标准化文件条目必须恰有 编号、名称 两个子节点，顺序固定', () => {
    const missingTitle = createG1Fixture()
    visit(missingTitle, node => { if (node.type === 'normRefStd' && node.attrs?.nodeId === 'g1-nr-1') node.content = node.content!.slice(0, 1) })
    expect(() => schema.nodeFromJSON(missingTitle).check()).toThrow()
    const swapped = createG1Fixture()
    visit(swapped, node => { if (node.type === 'normRefStd' && node.attrs?.nodeId === 'g1-nr-1') node.content = [...node.content!].reverse() })
    expect(() => schema.nodeFromJSON(swapped).check()).toThrow()
  })

  it('nodeId 属性：清单、std 条目、mixed 条目带 nodeId；两个子节点没有（IR 无对应 id）', () => {
    expect(NODE_ID_TYPES).toEqual(expect.arrayContaining(['normRefList', 'normRefStd', 'normRefMixed']))
    for (const name of ['normRefList', 'normRefStd', 'normRefMixed']) expect(schema.nodes[name]!.spec.attrs, name).toHaveProperty('nodeId')
    for (const name of ['normRefStdRef', 'normRefStdTitle']) expect(schema.nodes[name]!.spec.attrs?.nodeId, name).toBeUndefined()
  })

  it('扩展追加在 createEditorExtensions() 末尾：既有 block 组节点顺序不变，block 组默认填充节点仍是段落', () => {
    const names = createEditorExtensions().map(extension => extension.name)
    // 多个 WP8.M 组都追加在末尾，G1 不一定是最后一组；P3 要求的是：G1 的扩展连续、按序，且排在全部既有扩展之后。
    const g1 = ['normRefList', 'normRefStd', 'normRefStdRef', 'normRefStdTitle', 'normRefMixed', 'stdRef', 'mixedCitation']
    const start = names.indexOf('normRefList')
    expect(names.slice(start, start + g1.length)).toEqual(g1)
    expect(start).toBeGreaterThan(names.indexOf('inlineFormulaEditing'))
    expect(schema.nodes.chapter!.contentMatch.defaultType?.name).not.toBe('normRefList')
  })
})

describe('[M-10.2-01] [M-10.2-02] [M-10.1.7-01] 生产 Schema：stdRef / mixedCitation mark', () => {
  it('两个 mark 互斥：给带 stdRef 的文本再加 mixedCitation 会替换它；同类型不重复', () => {
    const std = schema.marks.stdRef!.create()
    const mixed = schema.marks.mixedCitation!.create()
    expect(mixed.addToSet([std]).map(mark => mark.type.name)).toEqual(['mixedCitation'])
    expect(std.addToSet([mixed]).map(mark => mark.type.name)).toEqual(['stdRef'])
    expect(std.addToSet([std]).map(mark => mark.type.name)).toEqual(['stdRef'])
    const bold = schema.marks.bold!.create()
    expect(std.addToSet([bold]).map(mark => mark.type.name).sort()).toEqual(['bold', 'stdRef'])
  })

  it('同一段文字同时带两个 mark 的 JSON：Schema 校验失败（excludes），不会被静默接受', () => {
    const both = createG1Fixture()
    visit(both, node => { if (node.type === 'text' && node.text === 'GB/T 3102.1') node.marks = [{ type: 'stdRef' }, { type: 'mixedCitation' }] })
    expect(() => schema.nodeFromJSON(both).check()).toThrow()
  })

  it('mark 不带属性，inclusive=false（在引用文字末尾继续输入不会延长引用范围）', () => {
    for (const name of ['stdRef', 'mixedCitation']) {
      expect(schema.marks[name]!.spec.inclusive, name).toBe(false)
      expect(Object.keys(schema.marks[name]!.spec.attrs ?? {}), name).toEqual([])
    }
  })
})

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] [M-E-06] [M-10.2-01] [M-10.1.7-01] [M-4.5.3-02] 往返：生产 PM → pmToIr → Resolver → irToPm → 生产 PM', () => {
  const originalJson = normalized()

  it('pmToIr：无 warning、无 unsupportedContent；清单 4 个条目，extensionVersion 为 1；Resolver 无 error', () => {
    const { doc, warnings } = pmToIr(originalJson)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.extensionVersion).toBe(1)
    const list = doc.body[1]!.children.find(child => child.kind === 'normRefList') as IRNormRefList
    expect(list.entries.map(entry => [entry.id, entry.entryType])).toEqual([
      ['g1-nr-1', 'std'], ['g1-nr-2', 'std'], ['g1-nr-3', 'std'], ['g1-nr-4', 'mixed'],
    ])
    expect(doc.bibliographyTitle).toEqual([{ text: '参考书目' }])
    expect(resolve(doc).problems.filter(problem => problem.severity === 'error')).toEqual([])
  })

  it('Resolver：条目 xmlId 依序为 ref_1…ref_4（R-8、X-10），label 为空；脚注 1)', () => {
    const { labels } = resolve(pmToIr(originalJson).doc)
    expect(['g1-nr-1', 'g1-nr-2', 'g1-nr-3', 'g1-nr-4'].map(id => [labels[id]!.label, labels[id]!.xmlId])).toEqual([
      ['', 'ref_1'], ['', 'ref_2'], ['', 'ref_3'], ['', 'ref_4'],
    ])
    expect(labels['g1-fn-nr']).toMatchObject({ label: '1)', xmlId: 'fn_1' })
    expect(labels['g1-bib-1']).toMatchObject({ label: '[1]', xmlId: 'bib_1' })
  })

  it('irToPm 后 Schema 校验通过，节点 ID、属性、标记与原文档逐节点相同；JSON 冷重开、再次 pmToIr 后 IR 深度相等', () => {
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

  it('mark 往返：stdRef / mixedCitation 的文本、叠加的 bold / crossRef 与顺序保持；列项、注内同样保持', () => {
    const doc = schema.nodeFromJSON(irToPm(pmToIr(originalJson).doc)).toJSON() as PMJsonNode
    const marked: [string, string[]][] = []
    visit(doc, node => {
      if (node.type === 'text' && node.marks?.some(mark => mark.type === 'stdRef' || mark.type === 'mixedCitation')) {
        marked.push([node.text!, node.marks.map(mark => mark.type)])
      }
    })
    expect(marked).toEqual([
      ['GB/T 3102.1', ['stdRef']],
      ['《中华人民共和国计量法》', ['mixedCitation']],
      ['GB/T 321', ['bold', 'stdRef']],
      ['2', ['crossRef', 'stdRef']],
      ['GB/T 321', ['stdRef']],
      ['GB/T 3102', ['stdRef']],
    ])
  })

  it('旧形态文档（默认标题、无清单、无 mark）：往返后不出现任何 G1 字段，也不写 extensionVersion', () => {
    const legacy = schema.nodeFromJSON(createG1LegacyFixture()).toJSON() as PMJsonNode
    const { doc } = pmToIr(legacy)
    expect(doc.extensionVersion).toBeUndefined()
    expect('bibliographyTitle' in doc).toBe(false)
    expect(JSON.stringify(doc)).not.toMatch(/normRef|stdRef|mixedCitation/)
    expect(irToPm(doc).attrs).toBeUndefined()
    expect(schema.nodeFromJSON(irToPm(doc)).toJSON()).toEqual(legacy)
  })
})

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] [M-10.2-01] [M-10.1.7-01] [M-4.5.3-02] HTML 往返：DOMSerializer / DOMParser 两轮后节点、nodeId、属性、标记不变', () => {
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

  const fixture = normalized()
  const { html, current } = roundtripHtml(fixture)

  it('清单序列化为 div[data-type=norm-ref-list]，std 条目含两个 span，mixed 条目为 div；重新解析后文档逐节点相同', () => {
    const rendered = document.createElement('div')
    rendered.innerHTML = html
    const list = rendered.querySelector('div[data-type="norm-ref-list"]')!
    expect(list.getAttribute('data-node-id')).toBe('g1-nrl')
    expect([...list.children].map(child => [child.getAttribute('data-type'), child.getAttribute('data-node-id')])).toEqual([
      ['norm-ref-std', 'g1-nr-1'], ['norm-ref-std', 'g1-nr-2'], ['norm-ref-std', 'g1-nr-3'], ['norm-ref-mixed', 'g1-nr-4'],
    ])
    const first = list.children[0]!
    expect([...first.children].map(child => [child.tagName, child.getAttribute('data-type'), child.textContent])).toEqual([
      ['SPAN', 'norm-ref-std-ref', 'GB/T 321'], ['SPAN', 'norm-ref-std-title', '优先数和优先数系'],
    ])
    // 文件编号与名称之间没有写入文本间隔：间隔由 CSS 添加（不入内容）
    expect(first.textContent).toBe('GB/T 321优先数和优先数系')
    // 根节点的 extensionVersion 不经 HTML 传递（它由 pmToIr/irToPm 维护），其余内容逐节点相同
    expect(current.content).toEqual(fixture.content)
  })

  it('mark 序列化为 span[data-type=std-ref|mixed-citation]，重新解析后仍是对应 mark，叠加的 bold / crossRef 不丢', () => {
    const rendered = document.createElement('div')
    rendered.innerHTML = html
    expect([...rendered.querySelectorAll('span[data-type="std-ref"]')].map(element => element.textContent)).toEqual(['GB/T 3102.1', 'GB/T 321', '2', 'GB/T 321', 'GB/T 3102'])
    expect([...rendered.querySelectorAll('span[data-type="mixed-citation"]')].map(element => element.textContent)).toEqual(['《中华人民共和国计量法》'])
    const before = byId(fixture)
    const after = byId(current)
    for (const id of ['g1-nrl', 'g1-nr-1', 'g1-nr-2', 'g1-nr-3', 'g1-nr-4', 'g1-fn-nr', 'g1-ch3-p1', 'g1-ch3-p2', 'g1-list-i1', 'g1-note']) {
      expect(after.get(id)?.type, id).toBe(before.get(id)?.type)
      expect(after.get(id)?.attrs?.nodeId, id).toBe(id)
    }
  })

  it('自定义参考文献标题在 HTML 往返后保持（h2[data-type=bibliography-title] 内容不变）', () => {
    const rendered = document.createElement('div')
    rendered.innerHTML = html
    expect(rendered.querySelector('h2[data-type="bibliography-title"]')?.textContent).toBe('参考书目')
    const bibliography = current.content!.find(node => node.type === 'bibliography')!
    expect(bibliography.content![0]).toEqual({ type: 'bibliographyTitle', content: [{ type: 'text', text: '参考书目' }] })
  })
})

describe('[M-4.4.2.3-02] [M-4.5.3-02] 保存重开：Editor + replaceEditorDocument + exportSemanticJson', () => {
  it('加载 → 导出语义 JSON → 再加载 → 再导出：编辑器 JSON 与语义 JSON 逐字相等；extensionVersion=1，标题与清单完整', () => {
    const editor = mountedEditor()
    expect(replaceEditorDocument(editor, createG1Fixture() as unknown as Record<string, unknown>)).toBe(true)
    expect(editor.getJSON().attrs).toMatchObject({ extensionVersion: 1 })
    const firstSave = editor.getJSON() as PMJsonNode
    const firstExport = exportSemanticJson(editor.state.doc)
    // 编辑器会为 bibliography 补 nodeId、并在末尾保留一个光标段落；正文三章与原文档逐节点相同
    expect(firstSave.content!.slice(0, 3)).toEqual(normalized().content!.slice(0, 3))

    const reopened = mountedEditor()
    replaceEditorDocument(reopened, JSON.parse(JSON.stringify(firstSave)) as Record<string, unknown>)
    expect(reopened.getJSON()).toEqual(firstSave)
    expect(exportSemanticJson(reopened.state.doc)).toEqual(firstExport)
    const third = mountedEditor()
    replaceEditorDocument(third, JSON.parse(JSON.stringify(reopened.getJSON())) as Record<string, unknown>)
    expect(exportSemanticJson(third.state.doc)).toEqual(firstExport)
    expect(JSON.stringify(firstSave)).not.toContain('resolvedLabel')
    for (const target of [editor, reopened, third]) target.destroy()
  })

  it('导出的语义 JSON 保留清单结构与自定义标题；不把条目 xmlId 写成 PM 属性', () => {
    const editor = mountedEditor()
    replaceEditorDocument(editor, createG1Fixture() as unknown as Record<string, unknown>)
    const exported = exportSemanticJson(editor.state.doc)
    const types: string[] = []
    const walk = (node: ReturnType<typeof exportSemanticJson>): void => { types.push(node.type); node.content?.forEach(walk) }
    walk(exported)
    expect(types.filter(type => type === 'normRefStd')).toHaveLength(3)
    expect(types.filter(type => type === 'normRefMixed')).toHaveLength(1)
    expect(types.filter(type => type === 'normRefStdRef')).toHaveLength(3)
    expect(JSON.stringify(exported)).toContain('参考书目')
    expect(JSON.stringify(editor.getJSON())).not.toMatch(/ref_\d/)
    editor.destroy()
  })

  it('编辑后重开：改标题为默认“参考文献”，保存的 JSON 与旧形态等价（IR 不再有 bibliographyTitle）', () => {
    const editor = mountedEditor()
    replaceEditorDocument(editor, createG1Fixture() as unknown as Record<string, unknown>)
    let titlePos = -1
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'bibliographyTitle') titlePos = pos })
    const title = editor.state.doc.nodeAt(titlePos)!
    editor.view.dispatch(editor.state.tr.replaceWith(titlePos + 1, titlePos + 1 + title.content.size, schema.text('参考文献')))
    const saved = editor.getJSON() as PMJsonNode
    expect('bibliographyTitle' in pmToIr(saved).doc).toBe(false)
    const reopened = mountedEditor()
    replaceEditorDocument(reopened, JSON.parse(JSON.stringify(saved)) as Record<string, unknown>)
    expect(reopened.getJSON()).toEqual(saved)
    editor.destroy()
    reopened.destroy()
  })

  it('docDiff 文本化：清单条目与自定义标题可读（版本对比不丢内容）', () => {
    const text = docToText(createG1Fixture() as unknown as Record<string, unknown>)
    expect(text).toContain('GB/T 321')
    expect(text).toContain('优先数和优先数系')
    expect(text).toContain('《中华人民共和国计量法》')
    expect(text).toContain('[参考书目]')
    // 每个条目恰好一行，std 条目为“文件编号　文件名称”（一个汉字的间隔）；清单不被拼成一行，子节点不重复输出
    const lines = text.split('\n')
    expect(lines.filter(line => line.includes('优先数和优先数系'))).toEqual(['  GB/T 321　优先数和优先数系'])
    expect(lines).toContain('  GB/T 3102（所有部分）　量和单位')
    expect(lines).toContain('  ISO 80000（所有部分）　量和单位（Quantities and units）')
    expect(lines).toContain('  《中华人民共和国计量法》')
  })
})

describe('[M-4.4.2.3-03] [M-E-06] 粘贴与编辑：nodeId 唯一性', () => {
  it('重复的条目 nodeId：后出现者被重新生成（清单、条目都在 NODE_ID_TYPES 内）', () => {
    const duplicated = createG1Fixture()
    visit(duplicated, node => { if (node.type === 'normRefStd' && node.attrs?.nodeId === 'g1-nr-2') node.attrs!.nodeId = 'g1-nr-1' })
    const doc = schema.nodeFromJSON(duplicated)
    const entryPositions: Record<string, number> = {}
    doc.descendants((node, pos) => { if (node.type.name === 'normRefStd') entryPositions[String(node.attrs.nodeId) + pos] = pos })
    const secondPos = Object.values(entryPositions)[1]!
    expect(findNodeIdFixes(doc).map(fix => fix.pos)).toContain(secondPos)
    const repaired = normalizeNodeIds(doc).toJSON() as PMJsonNode
    const ids: string[] = []
    visit(repaired, node => { if (typeof node.attrs?.nodeId === 'string') ids.push(node.attrs.nodeId) })
    expect(new Set(ids).size).toBe(ids.length)
    const stds = byId(repaired)
    expect(stds.get('g1-nr-1')?.type).toBe('normRefStd')
    // 第二个条目（原 g1-nr-2）得到了新 ID，内容不变
    const entries: PMJsonNode[] = []
    visit(repaired, node => { if (node.type === 'normRefStd') entries.push(node) })
    expect(entries.map(entry => entry.content![0]!.content![0]!.text)).toEqual(['GB/T 321', 'GB/T 3102（所有部分）', 'ISO 80000（所有部分）'])
    expect(entries[1]!.attrs!.nodeId).not.toBe('g1-nr-1')
  })

  it('缺少 nodeId 的清单与条目：编辑器加载后自动补齐', () => {
    const missing = createG1Fixture()
    visit(missing, node => { if (node.type === 'normRefList' || node.type === 'normRefStd' || node.type === 'normRefMixed') delete node.attrs })
    const editor = mountedEditor()
    replaceEditorDocument(editor, missing as unknown as Record<string, unknown>)
    const ids: Record<string, string[]> = {}
    editor.state.doc.descendants(node => {
      if (['normRefList', 'normRefStd', 'normRefMixed'].includes(node.type.name)) (ids[node.type.name] ??= []).push(String(node.attrs.nodeId))
    })
    expect(ids.normRefList).toHaveLength(1)
    expect(ids.normRefStd).toHaveLength(3)
    expect(ids.normRefMixed).toHaveLength(1)
    const all = Object.values(ids).flat()
    expect(all.every(id => id.length > 0 && id !== 'null')).toBe(true)
    expect(new Set(all).size).toBe(all.length)
    editor.destroy()
  })

  it('在 mixed 条目内按 Enter：拆出一个新的 mixed 条目（新 nodeId），文档仍通过 Schema 校验', () => {
    const editor = mountedEditor()
    replaceEditorDocument(editor, createG1Fixture() as unknown as Record<string, unknown>)
    let pos = -1
    editor.state.doc.descendants((node, nodePos) => { if (node.attrs.nodeId === 'g1-nr-4') pos = nodePos })
    editor.commands.setTextSelection(pos + 3)
    editor.commands.splitBlock()
    editor.state.doc.check()
    const ids: string[] = []
    editor.state.doc.descendants(node => { if (node.type.name === 'normRefMixed') ids.push(String(node.attrs.nodeId)) })
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('g1-nr-4')
    expect(ids[1]).not.toBe('g1-nr-4')
    editor.destroy()
  })

  it('在 std 条目的两个子节点内按 Enter：不破坏文档（Schema 不允许再拆出第二个编号/名称），校验仍通过', () => {
    for (const child of ['normRefStdRef', 'normRefStdTitle']) {
      const editor = mountedEditor()
      replaceEditorDocument(editor, createG1Fixture() as unknown as Record<string, unknown>)
      const before = editor.getJSON()
      let pos = -1
      editor.state.doc.descendants((node, nodePos) => { if (node.type.name === child && pos < 0) pos = nodePos })
      editor.commands.setTextSelection(pos + 2)
      editor.commands.splitBlock()
      editor.state.doc.check()
      // Schema 不允许一个条目里有两个编号或两个名称：Enter 不拆分，条目与子节点数量、内容不变
      expect(editor.getJSON().content).toEqual(before.content)
      editor.destroy()
    }
  })
})

describe('[M-4.4.2.3-02] [M-10.2-01] [M-10.1.7-01] [M-4.5.3-02] 输出边界（来自生产 PM）：HTML、DOCX 放行，XML、XML46687 阻断', () => {
  const { doc } = pmToIr(normalized())

  it.each(['HTML', 'DOCX'] as const)('%s：没有 unsupported-output', format => {
    expect(getOutputSupportProblems(doc, format)).toEqual([])
  })

  it.each(['XML', 'XML46687'] as const)('%s：清单（kind）、两个 mark（type）、标题各被阻断', format => {
    const paths = getOutputSupportProblems(doc, format).map(problem => problem.path)
    expect(paths).toContain('doc.body[1].children[1].kind')
    expect(paths).toContain('doc.bibliographyTitle')
    expect(paths.filter(path => path.endsWith('.marks[0].type') || path.endsWith('.marks[1].type'))).toHaveLength(6)
  })

  it('旧形态文档：四种格式都没有问题', () => {
    const { doc: legacy } = pmToIr(schema.nodeFromJSON(createG1LegacyFixture()).toJSON() as PMJsonNode)
    for (const format of FORMATS) expect(getOutputSupportProblems(legacy, format), format).toEqual([])
  })

  it('HTML 出件：清单按 10.3.4 输出，标题与目次随自定义标题', () => {
    const output = renderHtml(doc, resolve(doc).labels, { variant: 'print' })
    expect(output).toContain('<span class="ses-norm-ref-no">GB/T 321</span>　<span class="ses-norm-ref-title">优先数和优先数系</span>')
    expect(output).toContain('<h2 class="ses-bib-title">参考书目</h2>')
  })
})

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] [M-10.2-01] [M-10.1.7-01] 显示：编辑器 DOM', () => {
  it('清单、条目、两个子节点与两个 mark 都有预期的 DOM 结构与类名（样式由 standard-nodes.css 提供）', () => {
    const editor = mountedEditor()
    replaceEditorDocument(editor, createG1Fixture() as unknown as Record<string, unknown>)
    const dom = editor.view.dom
    const list = dom.querySelector('div.std-norm-ref-list[data-type="norm-ref-list"]')!
    expect(list).not.toBeNull()
    expect(list.querySelectorAll(':scope > div.std-norm-ref')).toHaveLength(4)
    expect(list.querySelectorAll('div.std-norm-ref-std > span.std-norm-ref-no')).toHaveLength(3)
    expect(list.querySelectorAll('div.std-norm-ref-std > span.std-norm-ref-title')).toHaveLength(3)
    expect(list.querySelectorAll('div.std-norm-ref-mixed')).toHaveLength(1)
    expect([...dom.querySelectorAll('span.std-std-ref')].map(element => element.textContent)).toEqual(['GB/T 3102.1', 'GB/T 321', '2', 'GB/T 321', 'GB/T 3102'])
    expect([...dom.querySelectorAll('span.std-mixed-citation')].map(element => element.textContent)).toEqual(['《中华人民共和国计量法》'])
    expect(dom.querySelector('h2.std-bibliography-title')?.textContent).toBe('参考书目')
    editor.destroy()
  })
})
