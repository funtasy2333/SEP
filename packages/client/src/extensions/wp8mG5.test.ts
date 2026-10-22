// @vitest-environment happy-dom
/**
 * WP8.M G5：术语领域 termSubjectField（M-9.2.9-01）与 termEntry 独立 id（M-9.2.1-05）——生产 Schema / client 层。
 *
 * 设计 §3.6 四类用例：Schema、往返（PM → IR → PM）、HTML 往返、保存重开（Editor + replaceEditorDocument +
 * exportSemanticJson）。另覆盖编辑器显示、键盘行为、导出链路（HTML/DOCX 放行，旧 XML 阻断）。
 * shared 层的映射、Resolver、边界与排版细节见 shared 的 wp8mG5*.test.ts。
 */

import JSZip from 'jszip'
import { Editor, getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { checkExportGuard } from '@ses/io'
import { irToPm, pmToIr, resolve, type IRChapterChild, type IRDoc, type IRTermEntry, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'
import {
  G5_EXPECTED_TERM_IDS, G5_SUBJECT_CUSTOMER, G5_SUBJECT_FIELDS, createWp8mG5Fixture,
} from './__fixtures__/wp8m-g5'
import { NODE_ID_TYPES } from './plugins/ensureNodeId'
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

function termDefs(root: PMJsonNode): PMJsonNode[] {
  const found: PMJsonNode[] = []
  visit(root, node => { if (node.type === 'termDef') found.push(node) })
  return found
}

function textOf(node: PMJsonNode | undefined): string {
  if (!node) return ''
  if (node.text !== undefined) return node.text
  return (node.content ?? []).map(textOf).join('')
}

function termEntries(children: IRChapterChild[], out: IRTermEntry[] = []): IRTermEntry[] {
  for (const child of children) {
    if (child.kind === 'termEntry') {
      out.push(child)
      termEntries(child.nestedEntries ?? [], out)
    } else if (child.kind === 'clause') termEntries(child.children, out)
  }
  return out
}

function allTerms(doc: IRDoc): IRTermEntry[] {
  return [...doc.body.flatMap(chapter => termEntries(chapter.children)), ...doc.appendices.flatMap(appendix => termEntries(appendix.children))]
}

/** nodeId → 术语条目的子节点类型序列与领域文本。 */
function termShapes(root: PMJsonNode): Record<string, { children: string[]; subject: string | undefined }> {
  const shapes: Record<string, { children: string[]; subject: string | undefined }> = {}
  for (const term of termDefs(root)) {
    const subject = term.content?.find(child => child.type === 'termSubjectField')
    shapes[String(term.attrs?.nodeId)] = {
      children: (term.content ?? []).map(child => child.type),
      subject: subject ? textOf(subject) : undefined,
    }
  }
  return shapes
}

/**
 * 比较“经 IR 再写回”的文档与原文档时剔除两类与 G5 无关的既有差异：irToPm 写出的 chapter.secType（由标题推断），
 * 以及 Tiptap 在文档末尾补的空段（每个编辑器实例各自生成随机 nodeId）。
 */
function withoutSecType(root: PMJsonNode): PMJsonNode {
  const copy = structuredClone(root)
  visit(copy, node => { if (node.attrs && 'secType' in node.attrs) delete node.attrs.secType })
  copy.content = (copy.content ?? []).filter(node => !(node.type === 'paragraph' && !node.content?.length))
  return copy
}

/** 可输出到 HTML/DOCX 的变体：去掉嵌套术语（nestedEntries 本阶段不输出）与 termRef mark（不在输出 mark 白名单内）。 */
function printable(root: PMJsonNode): PMJsonNode {
  const copy = structuredClone(root)
  for (const term of termDefs(copy)) term.content = term.content!.filter(child => child.type !== 'termDef')
  visit(copy, node => { if (node.marks) node.marks = node.marks.filter(mark => mark.type !== 'termRef') })
  return copy
}

function press(editor: Editor, key: string): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

function caretInto(editor: Editor, nodeName: string, offset: number, nodeId?: string): void {
  let pos: number | undefined
  editor.state.doc.descendants((node, nodePos, parent) => {
    if (pos !== undefined) return false
    if (node.type.name === nodeName && (!nodeId || parent?.attrs.nodeId === nodeId)) {
      pos = nodePos + 1 + offset
      return false
    }
    return true
  })
  if (pos === undefined) throw new Error(`找不到节点 ${nodeName}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

function mountEditor(content: Record<string, unknown> | string = '<p></p>'): Editor {
  const editor = new Editor({ extensions, content: content as never })
  editor.mount(document.createElement('div'))
  return editor
}

describe('[M-9.2.9-01] 生产 Schema：termSubjectField', () => {
  it('fixture 通过 Schema 校验；termDef 内容表达式放宽为 termNameEn? termSubjectField? termDefinition', () => {
    const root = schema.nodeFromJSON(createWp8mG5Fixture())
    expect(() => root.check()).not.toThrow()
    expect(schema.nodes.termDef!.spec.content).toBe(
      'termName termNameEn? termSubjectField? termDefinition (stdParagraph | note | example | termDef | tbxLangSet | termSource)*',
    )
  })

  it('termSubjectField 是 inline* 文本块，不属于任何 group，不带 nodeId 属性', () => {
    const type = schema.nodes.termSubjectField!
    expect(type.spec.content).toBe('inline*')
    expect(type.spec.group).toBeUndefined()
    expect(type.isTextblock).toBe(true)
    expect(Object.keys(type.spec.attrs ?? {})).toEqual([])
    expect(NODE_ID_TYPES).not.toContain('termSubjectField')
  })

  it('旧文档仍然合法：不含领域的术语条目（WP6 fixture、g5-t2）无需迁移', () => {
    expect(() => schema.nodeFromJSON(createWp6Fixture()).check()).not.toThrow()
    const legacy = createWp8mG5Fixture()
    for (const term of termDefs(legacy)) term.content = term.content!.filter(child => child.type !== 'termSubjectField')
    expect(() => schema.nodeFromJSON(legacy).check()).not.toThrow()
  })

  it('新建的最小术语条目不自动带出领域节点', () => {
    const filled = schema.nodes.termDef!.createAndFill()!
    expect(filled.content.content.map(child => child.type.name)).toEqual(['termName', 'termDefinition'])
  })

  it('非法位置/数量被 Schema 拒绝：领域在英文名之前、在定义之后、重复、位于 termDef 之外', () => {
    const base = () => createWp8mG5Fixture()
    const withTerm = (mutate: (term: PMJsonNode) => void): PMJsonNode => {
      const doc = base()
      mutate(termDefs(doc).find(term => term.attrs?.nodeId === 'g5-t1')!)
      return doc
    }
    const move = (term: PMJsonNode, from: string, to: string, after: boolean): void => {
      const content = term.content!
      const [moved] = content.splice(content.findIndex(child => child.type === from), 1)
      const targetIndex = content.findIndex(child => child.type === to)
      content.splice(after ? targetIndex + 1 : targetIndex, 0, moved!)
    }
    // 领域在英文名之前（termName 之后紧跟领域，再英文名）
    expect(() => schema.nodeFromJSON(withTerm(term => move(term, 'termSubjectField', 'termNameEn', false))).check()).toThrow()
    // 领域在定义之后
    expect(() => schema.nodeFromJSON(withTerm(term => move(term, 'termSubjectField', 'termDefinition', true))).check()).toThrow()
    // 领域重复
    expect(() => schema.nodeFromJSON(withTerm(term => {
      const index = term.content!.findIndex(child => child.type === 'termSubjectField')
      term.content!.splice(index, 0, { type: 'termSubjectField', content: [{ type: 'text', text: '第二个' }] })
    })).check()).toThrow()
    // 领域位于章内而不是 termDef 内
    const outside = base()
    outside.content!.find(node => node.type === 'chapter')!.content!.push({ type: 'termSubjectField', content: [{ type: 'text', text: '游离' }] })
    expect(() => schema.nodeFromJSON(outside).check()).toThrow()
    // 缺少定义仍不合法（领域不能顶替定义）
    expect(() => schema.nodeFromJSON(withTerm(term => {
      term.content = term.content!.filter(child => child.type !== 'termDefinition')
    })).check()).toThrow()
  })
})

describe('[M-9.2.9-01][M-9.2.1-05] 往返：生产 PM → IR → Resolver → PM', () => {
  it('pmToIr 无告警；领域按条目保留，extensionVersion=1', () => {
    const fixture = schema.nodeFromJSON(createWp8mG5Fixture()).toJSON() as PMJsonNode
    const { doc, warnings } = pmToIr(fixture)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    expect(doc.extensionVersion).toBe(1)
    const subjects = Object.fromEntries(allTerms(doc).filter(entry => entry.subjectField).map(entry => [entry.id, entry.subjectField!.map(run => run.text).join('')]))
    expect(subjects).toEqual(G5_SUBJECT_FIELDS)
    expect(allTerms(doc).find(entry => entry.id === 'g5-t332')!.subjectField).toEqual([{ text: '化学', marks: [{ type: 'bold' }] }])
    expect(allTerms(doc).find(entry => entry.id === 'g5-t2')).not.toHaveProperty('subjectField')
  })

  it('Resolver 无 error；每个术语条目 termEntryXmlId = term_<编号>，与 sec_<编号> 并存（M-9.2.1-05）', () => {
    const { doc } = pmToIr(createWp8mG5Fixture())
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    for (const [id, [label, termId]] of Object.entries(G5_EXPECTED_TERM_IDS)) {
      expect(labels[id], id).toEqual({ label, xmlId: `sec_${label}`, refText: label, termEntryXmlId: termId })
    }
    expect(Object.keys(labels).filter(id => labels[id]!.termEntryXmlId !== undefined).sort()).toEqual(Object.keys(G5_EXPECTED_TERM_IDS).sort())
  })

  it('IR → PM 通过 Schema 校验，节点类型序列与领域文本逐条一致，再经 JSON 冷重开后 IR 深度相等', () => {
    const original = schema.nodeFromJSON(createWp8mG5Fixture())
    original.check()
    const first = pmToIr(original.toJSON() as PMJsonNode)
    const rewritten = irToPm(first.doc)
    const projected = schema.nodeFromJSON(rewritten)
    projected.check()
    expect(termShapes(projected.toJSON() as PMJsonNode)).toEqual(termShapes(original.toJSON() as PMJsonNode))
    // 逐属性（nodeId、level 等）保持；领域节点本身没有属性。
    const attrsById = (root: PMJsonNode) => Object.fromEntries(termDefs(root).map(term => [String(term.attrs?.nodeId), term.attrs]))
    expect(attrsById(projected.toJSON() as PMJsonNode)).toEqual(attrsById(original.toJSON() as PMJsonNode))
    const cold = schema.nodeFromJSON(JSON.parse(JSON.stringify(projected.toJSON())) as PMJsonNode)
    cold.check()
    expect(pmToIr(cold.toJSON() as PMJsonNode).doc).toEqual(first.doc)
  })

  it('保持“领域在英文名之后、定义之前”的位置；领域节点不会获得 nodeId', () => {
    const rewritten = irToPm(pmToIr(createWp8mG5Fixture()).doc)
    const shapes = termShapes(rewritten)
    expect(shapes['g5-t1']!.children).toEqual(['termName', 'termNameEn', 'termSubjectField', 'termDefinition'])
    expect(shapes['g5-t332']!.children).toEqual(['termName', 'termSubjectField', 'termDefinition'])
    expect(shapes['g5-t331']!.children).toEqual(['termName', 'termNameEn', 'termSubjectField', 'termDefinition', 'termSource', 'note'])
    expect(shapes['g5-t2']!.children).toEqual(['termName', 'termDefinition'])
    visit(rewritten, node => { if (node.type === 'termSubjectField') expect(node.attrs?.nodeId).toBeUndefined() })
  })
})

describe('[M-9.2.9-01] HTML 往返（DOMSerializer / DOMParser 两轮）', () => {
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

  it('renderHTML 带 data-type 与 class；两轮后节点类型序列、nodeId、属性、领域文本不变', () => {
    const source = createWp8mG5Fixture()
    const { html, reopened } = roundtripHtml(source)
    const container = document.createElement('div')
    container.innerHTML = html
    const fields = [...container.querySelectorAll('[data-type="term-subject-field"]')]
    expect(fields).toHaveLength(Object.keys(G5_SUBJECT_FIELDS).length)
    expect(fields.every(field => field.tagName === 'DIV' && field.classList.contains('std-term-subject-field'))).toBe(true)
    // 位置：紧跟在术语名/英文名之后，紧邻其后的是术语定义。
    const first = container.querySelector('[data-node-id="g5-t1"]')!
    expect([...first.children].map(child => child.getAttribute('data-type'))).toEqual(['term-name', 'term-name-en', 'term-subject-field', 'term-definition'])
    expect(termShapes(reopened.toJSON() as PMJsonNode)).toEqual(termShapes(schema.nodeFromJSON(source).toJSON() as PMJsonNode))
    const attrsById = (root: PMJsonNode) => Object.fromEntries(termDefs(root).map(term => [String(term.attrs?.nodeId), term.attrs]))
    expect(attrsById(reopened.toJSON() as PMJsonNode)).toEqual(attrsById(schema.nodeFromJSON(source).toJSON() as PMJsonNode))
  })

  it('括号不进入内容：序列化后的 HTML 文本与回读的 PM 文本都不含 〈〉', () => {
    const { html, reopened } = roundtripHtml(createWp8mG5Fixture())
    const container = document.createElement('div')
    container.innerHTML = html
    for (const field of container.querySelectorAll('[data-type="term-subject-field"]')) expect(field.textContent).not.toMatch(/[〈〉]/)
    expect(textOf(reopened.toJSON() as PMJsonNode)).not.toMatch(/[〈〉]/)
  })

  it('不含领域的旧 HTML（无 term-subject-field）仍按原样解析', () => {
    const legacy = createWp8mG5Fixture()
    for (const term of termDefs(legacy)) term.content = term.content!.filter(child => child.type !== 'termSubjectField')
    const { reopened } = roundtripHtml(legacy)
    expect(Object.values(termShapes(reopened.toJSON() as PMJsonNode)).every(shape => shape.subject === undefined)).toBe(true)
  })
})

describe('[M-9.2.9-01][M-9.2.1-05] 保存重开：Editor + replaceEditorDocument + exportSemanticJson', () => {
  it('加载 → 保存 → 重开：PM JSON 与语义 JSON 都相等，领域与 nodeId 无损', () => {
    const first = mountEditor()
    expect(replaceEditorDocument(first, createWp8mG5Fixture() as unknown as Record<string, unknown>)).toBe(true)
    expect(first.getJSON().attrs).toMatchObject({ extensionVersion: 1 })
    const saved = JSON.parse(JSON.stringify(first.getJSON())) as PMJsonNode
    const exportedFirst = exportSemanticJson(first.state.doc)

    const second = mountEditor()
    replaceEditorDocument(second, saved as unknown as Record<string, unknown>)
    expect(second.getJSON()).toEqual(first.getJSON())
    expect(exportSemanticJson(second.state.doc)).toEqual(exportedFirst)
    expect(termShapes(second.getJSON() as PMJsonNode)['g5-t1']!.subject).toBe(G5_SUBJECT_CUSTOMER)

    // 经 IR 再写回（等同服务端 documentOps 等路径）后重开，语义 JSON 仍相等。
    const third = mountEditor()
    replaceEditorDocument(third, irToPm(pmToIr(saved).doc) as unknown as Record<string, unknown>)
    // irToPm 会把由标题推断出的章角色写成 chapter.secType（既有行为，与 G5 无关），比较时剔除。
    expect(withoutSecType(exportSemanticJson(third.state.doc) as unknown as PMJsonNode)).toEqual(withoutSecType(exportedFirst as unknown as PMJsonNode))
    expect(JSON.stringify(exportedFirst)).toContain('termSubjectField')
    for (const editor of [first, second, third]) editor.destroy()
  })

  it('编辑领域文字后保存重开，新值保留且术语编号不变', () => {
    const editor = mountEditor()
    replaceEditorDocument(editor, createWp8mG5Fixture() as unknown as Record<string, unknown>)
    caretInto(editor, 'termSubjectField', G5_SUBJECT_CUSTOMER.length, 'g5-t1')
    editor.view.dispatch(editor.state.tr.insertText('度'))
    const saved = JSON.parse(JSON.stringify(editor.getJSON())) as PMJsonNode
    expect(termShapes(saved)['g5-t1']!.subject).toBe(`${G5_SUBJECT_CUSTOMER}度`)

    const reopened = mountEditor()
    replaceEditorDocument(reopened, saved as unknown as Record<string, unknown>)
    const { doc } = pmToIr(reopened.getJSON() as PMJsonNode)
    expect(allTerms(doc).find(entry => entry.id === 'g5-t1')!.subjectField).toEqual([{ text: `${G5_SUBJECT_CUSTOMER}度` }])
    expect(resolve(doc).labels['g5-t1']).toMatchObject({ label: '3.1', termEntryXmlId: 'term_3.1' })
    editor.destroy()
    reopened.destroy()
  })

  it('删除领域节点后保存重开：IR 不再带该字段，旧式条目仍合法', () => {
    const editor = mountEditor()
    replaceEditorDocument(editor, createWp8mG5Fixture() as unknown as Record<string, unknown>)
    let removeAt: { from: number; to: number } | undefined
    editor.state.doc.descendants((node, pos) => {
      if (!removeAt && node.type.name === 'termSubjectField' && textOf(node.toJSON() as PMJsonNode) === G5_SUBJECT_CUSTOMER) removeAt = { from: pos, to: pos + node.nodeSize }
    })
    editor.view.dispatch(editor.state.tr.delete(removeAt!.from, removeAt!.to))
    const saved = JSON.parse(JSON.stringify(editor.getJSON())) as PMJsonNode
    expect(termShapes(saved)['g5-t1']!.children).toEqual(['termName', 'termNameEn', 'termDefinition'])
    expect(allTerms(pmToIr(saved).doc).find(entry => entry.id === 'g5-t1')).not.toHaveProperty('subjectField')
    expect(() => schema.nodeFromJSON(saved).check()).not.toThrow()
    editor.destroy()
  })
})

describe('[M-9.2.9-01] 编辑器显示与键盘', () => {
  it('DOM：领域节点位于英文名之后、定义之前；括号由 CSS 添加，DOM 文本不含 〈〉', () => {
    const editor = mountEditor(createWp8mG5Fixture() as unknown as Record<string, unknown>)
    const term = editor.view.dom.querySelector<HTMLElement>('[data-node-id="g5-t1"]')!
    expect([...term.children].map(child => child.className.split(' ')[0])).toEqual([
      'std-term-name', 'std-term-name-en', 'std-term-subject-field', 'std-term-definition',
    ])
    expect(term.querySelector('.std-term-subject-field')!.textContent).toBe(G5_SUBJECT_CUSTOMER)
    expect(editor.view.dom.textContent).not.toMatch(/[〈〉]/)
    editor.destroy()
  })

  it('Enter：在领域字段内回车进入术语定义（与术语名、英文名一致），文档结构不变', () => {
    const editor = mountEditor(createWp8mG5Fixture() as unknown as Record<string, unknown>)
    caretInto(editor, 'termSubjectField', 2, 'g5-t1')
    const before = editor.getJSON() // 首个事务之后（Tiptap 的末尾空段已补齐），Enter 不应再改动文档
    press(editor, 'Enter')
    expect(editor.state.selection.$from.parent.type.name).toBe('termDefinition')
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })

  it('Enter：英文名/术语名处回车仍进入定义（不受领域节点存在影响）', () => {
    const editor = mountEditor(createWp8mG5Fixture() as unknown as Record<string, unknown>)
    caretInto(editor, 'termNameEn', 1, 'g5-t1')
    press(editor, 'Enter')
    expect(editor.state.selection.$from.parent.type.name).toBe('termDefinition')
    caretInto(editor, 'termName', 1, 'g5-t332')
    press(editor, 'Enter')
    expect(editor.state.selection.$from.parent.type.name).toBe('termDefinition')
    editor.destroy()
  })

  it('版本对比文本包含领域（〈领域〉），不含领域的条目文本不变', () => {
    const text = docToText(schema.nodeFromJSON(createWp8mG5Fixture()).toJSON() as unknown as Record<string, unknown>)
    expect(text).toContain(`〈${G5_SUBJECT_CUSTOMER}〉`)
    expect(text).toContain('〈化学〉')
    const lines = text.split('\n')
    const index = lines.findIndex(line => line.includes('无领域术语'))
    expect(lines[index + 1]).toContain('没有领域字段的旧式术语条目。')
  })
})

describe('[M-9.2.9-01] 导出链路：HTML、DOCX 放行并排版；旧 XML 阻断（§7.1）', () => {
  it('checkExportGuard：html/pdf/docx 通过，xml 被输出边界阻止且指向 subjectField', () => {
    const doc = schema.nodeFromJSON(createWp8mG5Fixture()).toJSON() as PMJsonNode
    // 完整 fixture 含嵌套术语与 termRef：它们本阶段仍被 HTML/DOCX 阻断，与领域无关；放行结论用可输出变体断言。
    expect(checkExportGuard(doc, 'html')?.problems.every(problem => !(problem.path ?? '').endsWith('.subjectField'))).toBe(true)
    expect(checkExportGuard(printable(doc), 'html')).toBeNull()
    expect(checkExportGuard(printable(doc), 'pdf')).toBeNull()
    expect(checkExportGuard(printable(doc), 'docx')).toBeNull()
    expect(checkExportGuard(doc, 'json')).toBeNull()
    const xml = checkExportGuard(doc, 'xml')
    expect(xml?.source).toBe('output-boundary')
    // 3.4.1 位于 nestedEntries 内，整体被 nestedEntries 阻断，不再单独报它的领域：其余 4 条各报一次。
    expect(xml?.problems.map(problem => problem.path ?? '').filter(path => path.endsWith('.subjectField'))).toHaveLength(Object.keys(G5_SUBJECT_FIELDS).length - 1)
  })

  it('HTML：领域并入定义段开头，“〈领域〉”紧邻定义；无领域的条目不带 span', () => {
    const editor = mountEditor(printable(createWp8mG5Fixture()) as unknown as Record<string, unknown>)
    const html = exportSemanticHtml(editor.state.doc)
    expect(html).toContain('<span class="ses-term-subject-field" data-type="term-subject-field">〈顾客满意〉</span>由成员组织或个人组成的组织。</p>')
    expect(html).toContain('〈<strong>化学</strong>〉</span>没有英文名、领域含粗体的术语条目。')
    expect(html).toContain('<p class="ses-term-def" data-node-id="g5-t2-def">没有领域字段的旧式术语条目。</p>')
    editor.destroy()
  })

  it('DOCX：document.xml 的定义首段以 〈领域〉 开头，同一段内无额外段落', async () => {
    const editor = mountEditor(printable(createWp8mG5Fixture()) as unknown as Record<string, unknown>)
    const json = editor.getJSON() as PMJsonNode
    const { blob } = await buildDocxBlob({ pmDoc: json, createdAt: '2026-10-22T00:00:00Z' })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const paragraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(match => [...match[1]!.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(run => run[1]).join(''))
    expect(paragraphs).toContain('〈顾客满意〉由成员组织或个人组成的组织。')
    expect(paragraphs).toContain('〈ISO 和/或 IEC 发布的〉现阶段处在发展阶段的标准化文件。')
    expect(paragraphs).toContain('〈化学〉没有英文名、领域含粗体的术语条目。')
    expect(paragraphs).toContain('没有领域字段的旧式术语条目。')
    expect(paragraphs).not.toContain('〈顾客满意〉')
    editor.destroy()
  })

  it('旧 XML：serializeToXml 拒绝含领域的文档，而不是静默丢弃', () => {
    const editor = mountEditor(createWp8mG5Fixture() as unknown as Record<string, unknown>)
    expect(() => serializeToXml(editor.state.doc)).toThrow()
    editor.destroy()
  })
})
