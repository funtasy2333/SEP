// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { IRDoc, IRInline, IRReferenceTargetKind, PMJsonNode } from '@ses/shared'
import { irToPm } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { serializeToXml, XmlCrossRefValidationError } from './xmlSerializer'

const crossRef = (text: string, targetId: string, targetKind?: IRReferenceTargetKind): IRInline => ({
  text,
  marks: [{ type: 'crossRef', targetId, ...(targetKind ? { targetKind } : {}) }],
})

function baseDoc(): IRDoc {
  const referenceParagraph: IRInline[] = [
    crossRef('章节目标', 'chapter-target', 'chapter'),
    { text: '；' },
    crossRef('条款目标', 'clause-target', 'clause'),
    { text: '；' },
    crossRef('术语目标', 'term-target', 'term'),
    { text: '；' },
    crossRef('表格目标', 'table-target', 'table'),
    { text: '；' },
    crossRef('图片目标', 'figure-target', 'figure'),
    { text: '；' },
    crossRef('公式目标', 'formula-target', 'formula'),
    { text: '；' },
    crossRef('文献目标', 'bib-target', 'bibliography'),
    { text: '；' },
    crossRef('附录目标', 'appendix-target', 'appendix'),
    { text: '。' },
    {
      text: '脚注引文',
      footnote: {
        id: 'body-footnote',
        content: [crossRef('脚注中的章节目标', 'chapter-target', 'chapter')],
      },
    },
  ]

  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: '交叉引用测试' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter-target', secType: 'general', title: [{ text: '正文' }],
      children: [{
        kind: 'clause', id: 'clause-target', level: 1, titled: true, title: [{ text: '目标条' }],
        children: [
          { kind: 'paragraph', id: 'reference-paragraph', content: referenceParagraph },
          {
            kind: 'termEntry', id: 'term-target', term: [{ text: '测试术语' }],
            definition: [{ kind: 'paragraph', id: 'term-definition', content: [{ text: '术语定义' }] }],
            notes: [], examples: [],
          },
          {
            kind: 'table', id: 'table-target', caption: [{ text: '目标表' }], orientation: 'portrait',
            headerRowCount: 0, notes: [], rows: [{
              id: 'table-row', cells: [{
                id: 'table-cell', colspan: 1, rowspan: 1, header: false,
                content: [{ kind: 'paragraph', id: 'table-cell-paragraph', content: [{ text: '值' }] }],
              }],
            }],
          },
          { kind: 'figure', id: 'figure-target', caption: [{ text: '目标图' }], orientation: 'portrait', src: '', notes: [] },
          { kind: 'formula', id: 'formula-target', latex: 'x = 1', numbered: true, whereList: [] },
        ],
      }],
    }],
    appendices: [{
      kind: 'appendix', id: 'appendix-target', normative: false, title: [{ text: '附录' }],
      children: [{ kind: 'paragraph', id: 'appendix-paragraph', content: [{ text: '附录回引：' }, crossRef('正文目标', 'chapter-target', 'chapter')] }],
    }],
    bibliography: [{ kind: 'bibEntry', id: 'bib-target', content: [{ text: '文献条目' }] }],
  }
}

function toProductionNode(doc: IRDoc): PMNode {
  const schema = getSchema(createEditorExtensions())
  const node = schema.nodeFromJSON(irToPm(doc))
  node.check()
  return node
}

function toJsonBackedPmTree(json: PMJsonNode): PMNode {
  const children = (json.content ?? []).map(toJsonBackedPmTree)
  return {
    type: { name: json.type },
    attrs: json.attrs ?? {},
    isText: json.type === 'text',
    isTextblock: ['paragraph', 'stdParagraph', 'chapterTitle'].includes(json.type),
    text: json.text,
    childCount: children.length,
    forEach: (visit: (child: PMNode) => void) => children.forEach(visit),
    toJSON: () => structuredClone(json),
  } as unknown as PMNode
}

function findTextNode(root: PMNode, text: string): PMNode {
  let found: PMNode | undefined
  root.descendants(node => {
    if (node.isText && node.text === text) found = node
  })
  if (!found) throw new Error(`找不到文本节点：${text}`)
  return found
}

function xmlDoc(xml: string): Document {
  // happy-dom rejects the serializer's valid CDATA wrapper; removing only the delimiters
  // preserves the XML element/attribute tree under test, including every xref and id.
  const parseable = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  const parsed = new DOMParser().parseFromString(parseable, 'application/xml')
  expect(parsed.getElementsByTagName('parsererror'), parsed.getElementsByTagName('parsererror').item(0)?.textContent).toHaveLength(0)
  return parsed
}

function expectEveryXrefHasOneTarget(xml: string): void {
  const parsed = xmlDoc(xml)
  const ids = Array.from(parsed.getElementsByTagName('*'))
    .map(element => element.getAttribute('id'))
    .filter((id): id is string => !!id)
  for (const xref of Array.from(parsed.getElementsByTagName('xref'))) {
    const rid = xref.getAttribute('rid')
    expect(rid, `xref ${xref.textContent} 应有 rid`).toBeTruthy()
    expect(ids.filter(id => id === rid), `xref ${xref.textContent} 的 rid=${rid} 应命中唯一 id`).toHaveLength(1)
  }
}

function xrefRidFor(xml: string, label: string): string | null {
  const match = Array.from(xmlDoc(xml).getElementsByTagName('xref')).find(element => element.textContent === label)
  return match?.getAttribute('rid') ?? null
}

function setCrossRefAttrs(node: PMNode, attrs: Record<string, unknown>, label = '章节目标'): PMNode {
  const json = structuredClone(node.toJSON()) as PMJsonNode
  let changed = false
  const visit = (current: PMJsonNode) => {
    if (changed) return
    if (current.type === 'text' && current.text === label) {
      const mark = current.marks?.find(candidate => candidate.type === 'crossRef')
      if (!mark) return
      mark.attrs = { ...mark.attrs, ...attrs }
      changed = true
      return
    }
    current.content?.forEach(visit)
  }
  visit(json)
  if (!changed) throw new Error(`找不到交叉引用文本：${label}`)
  const updated = getSchema(createEditorExtensions()).nodeFromJSON(json)
  updated.check()
  return updated
}

describe('生产 XML 交叉引用序列化', () => {
  it('IR→真实生产 schema 后，正文、附录与脚注引用都指向唯一输出定义且不改 PM 树', () => {
    const pm = toProductionNode(baseDoc())
    const before = structuredClone(pm.toJSON())
    const xml = serializeToXml(pm)

    expectEveryXrefHasOneTarget(xml)
    expect(xrefRidFor(xml, '章节目标')).toBe('sec_1')
    expect(xrefRidFor(xml, '附录目标')).toBe('sec_A')
    expect(xrefRidFor(xml, '术语目标')).toMatch(/^sec_/)
    expect(xrefRidFor(xml, '表格目标')).toBe('tab_1')
    expect(xrefRidFor(xml, '图片目标')).toBe('fig_1')
    expect(xrefRidFor(xml, '公式目标')).toBe('formula_1')
    expect(xrefRidFor(xml, '文献目标')).toBe('biblref_1')
    expect(xrefRidFor(xml, '脚注中的章节目标')).toBe('sec_1')
    expect(pm.toJSON()).toEqual(before)
    expect(xml).toContain('<app id="sec_A"')
    expect(xml).toContain('<term-sec id="sec_')
    expect(xml).toContain('<table-wrap id="tab_1"')
    expect(xml).toContain('<fig id="fig_1"')
    expect(xml).toContain('<disp-formula id="formula_1"')
    expect(xml).toContain('<ref id="biblref_1">')
  })

  it('优先用非空 targetId；targetId 为 null 时兼容稳定 nodeId 与唯一 attrs.id 别名', () => {
    const pm = toProductionNode(baseDoc())
    const source = findTextNode(pm, '章节目标')
    const original = source.marks.find(mark => mark.type.name === 'crossRef')!
    const priority = setCrossRefAttrs(pm, { refId: 'other-target' })
    expect(xrefRidFor(serializeToXml(priority), '章节目标')).toBe('sec_1')
    expect(original.attrs.targetId).toBe('chapter-target')

    const byStableId = setCrossRefAttrs(pm, { targetId: null, refId: 'chapter-target' })
    expect(xrefRidFor(serializeToXml(byStableId), '章节目标')).toBe('sec_1')

    const legacyJson = structuredClone(pm.toJSON()) as PMJsonNode
    const chapter = legacyJson.content!.find(node => node.type === 'chapter')!
    chapter.attrs = { ...chapter.attrs, id: 'legacy-chapter-id' }
    let legacyMark: NonNullable<PMJsonNode['marks']>[number] | undefined
    const findLegacyMark = (current: PMJsonNode): void => {
      if (current.type === 'text' && current.text === '章节目标') {
        legacyMark = current.marks?.find(mark => mark.type === 'crossRef')
        return
      }
      current.content?.forEach(findLegacyMark)
    }
    findLegacyMark(legacyJson)
    if (!legacyMark) throw new Error('找不到章节目标交叉引用')
    legacyMark.attrs = { ...legacyMark.attrs, targetId: null, refId: 'legacy-chapter-id' }
    const legacy = getSchema(createEditorExtensions()).nodeFromJSON(legacyJson)
    expect(xrefRidFor(serializeToXml(legacy), '章节目标')).toBe('sec_1')
  })

  it('空 targetId 不回退 refId；无法映射与 XML 无 ID 契约的目标均有明确诊断', () => {
    const pm = toProductionNode(baseDoc())
    const emptyTarget = setCrossRefAttrs(pm, { targetId: '', refId: 'chapter-target' })
    expect(() => serializeToXml(emptyTarget)).toThrow(XmlCrossRefValidationError)
    expect(() => serializeToXml(emptyTarget)).toThrow(/空 targetId/)

    const unresolved = setCrossRefAttrs(pm, { targetId: 'missing-target', refId: 'chapter-target' })
    expect(() => serializeToXml(unresolved)).toThrow(/missing-target/)

    const noteDoc = baseDoc()
    const noteClause = noteDoc.body[0]!.children[0]!
    if (noteClause.kind !== 'clause') throw new Error('预期正文条款')
    noteClause.children.push({ kind: 'note', id: 'note-target', content: [{ kind: 'paragraph', id: 'note-target.p0', content: [{ text: '说明' }] }] })
    noteClause.children[0] = {
      kind: 'paragraph', id: 'note-reference', content: [crossRef('不可定位的说明', 'note-target', 'note')],
    }
    const noIdCarrier = toProductionNode(noteDoc)
    expect(() => serializeToXml(noIdCarrier)).toThrow(/未在当前 XML 输出中出现/)
  })

  it('无编号公式的 Resolver extension ID 也写入既有 disp-formula id 属性', () => {
    const doc = baseDoc()
    const clause = doc.body[0]!.children[0]!
    if (clause.kind !== 'clause') throw new Error('预期正文条款')
    const formula = clause.children.find(child => child.kind === 'formula')!
    if (formula.kind !== 'formula') throw new Error('预期测试公式')
    formula.numbered = false
    const pm = toProductionNode(doc)
    const xml = serializeToXml(pm)
    const parsed = xmlDoc(xml)
    const formulaId = parsed.getElementsByTagName('disp-formula')[0]?.getAttribute('id')
    expect(formulaId).toBeTruthy()
    expect(xrefRidFor(xml, '公式目标')).toBe(formulaId)
    expectEveryXrefHasOneTarget(xml)
  })

  it('普通 untyped crossRef 可定位正文脚注与表脚注的既有 fn 定义', () => {
    const doc = baseDoc()
    const clause = doc.body[0]!.children[0]!
    if (clause.kind !== 'clause') throw new Error('预期正文条款')
    const reference = clause.children.find(child => child.kind === 'paragraph' && child.id === 'reference-paragraph')
    if (reference?.kind !== 'paragraph') throw new Error('找不到引用段落')
    reference.content.push(
      { text: '；' }, crossRef('正文脚注目标', 'body-footnote'),
      { text: '；' }, crossRef('表脚注目标', 'table-footnote'),
    )

    const table = clause.children.find(child => child.kind === 'table')
    if (table?.kind !== 'table') throw new Error('找不到目标表')
    table.footnotes = [{ id: 'table-footnote', content: [{ text: '表脚注内容' }] }]
    const tableCellParagraph = table.rows[0]!.cells[0]!.content[0]!
    if (tableCellParagraph.kind !== 'paragraph') throw new Error('预期表格单元格段落')
    tableCellParagraph.content.push({
      text: '表脚注上标',
      marks: [{ type: 'tableFootnoteRef', targetId: 'table-footnote', id: 'table-footnote-ref' }],
    })

    const xml = serializeToXml(toProductionNode(doc))
    expectEveryXrefHasOneTarget(xml)
    expect(xrefRidFor(xml, '正文脚注目标')).toBe('fn_1')
    expect(xrefRidFor(xml, '表脚注目标')).toBe('table-fn_1.1')
  })

  it('legacy refId 命中不同的 stable ID 与 emitted XML ID 时拒绝歧义', () => {
    const doc = baseDoc()
    doc.body.push({ kind: 'chapter', id: 'sec_1', secType: 'general', title: [{ text: '第二章' }], children: [] })
    const pm = toProductionNode(doc)
    const ambiguous = setCrossRefAttrs(pm, { targetId: null, refId: 'sec_1' })
    expect(() => serializeToXml(ambiguous)).toThrow(/歧义/)
  })

  it('兼容边界：schema 外的重复 bibliography 容器由既有输出边界阻止 dangling XML', () => {
    const json = irToPm(baseDoc())
    const bibliography = json.content!.find(node => node.type === 'bibliography')!
    const duplicate = structuredClone(bibliography)
    const uniquifyNodeIds = (node: PMJsonNode): void => {
      if (typeof node.attrs?.nodeId === 'string') node.attrs.nodeId = `${node.attrs.nodeId}-duplicate-container`
      node.content?.forEach(uniquifyNodeIds)
    }
    uniquifyNodeIds(duplicate)
    json.content!.push(duplicate)

    // StandardDoc's production schema permits only one bibliography. This JSON-backed PM tree
    // isolates the legacy serializer's last-container behavior without pretending it is a valid editor doc.
    const compatibilityTree = toJsonBackedPmTree(json)
    expect(() => serializeToXml(compatibilityTree)).toThrow(/bibliography.*容器/)
  })

  it('生产 schema：note 的 Resolver ID 与章节 fallback ID 重名时不把引用指向章节', () => {
    const doc: IRDoc = {
      schemaVersion: 1,
      meta: { standardType: 'gb', title: '定义身份回归' },
      front: { foreword: [], introduction: [] },
      body: [{
        kind: 'chapter', id: 'chapter-target', secType: 'general', title: [{ text: '正文' }],
        children: [
          { kind: 'paragraph', id: 'note-reference', content: [crossRef('说明目标', 'note-target', 'note')] },
          { kind: 'note', id: 'note-target', content: [{ kind: 'paragraph', id: 'note-target.p0', content: [{ text: '注释内容' }] }] },
        ],
      }],
      appendices: [],
      bibliography: [],
    }
    const json = irToPm(doc)
    const chapter = json.content!.find(node => node.type === 'chapter')!
    const chapterAttrs: Record<string, unknown> = { ...chapter.attrs, id: 'note_1' }
    delete chapterAttrs.nodeId
    chapter.attrs = chapterAttrs

    const pm = getSchema(createEditorExtensions()).nodeFromJSON(json)
    pm.check()
    expect(() => serializeToXml(pm)).toThrow(XmlCrossRefValidationError)
  })

  it('完整 schema 中无 nodeId 的旧章节仅在其原始 fallback XML id 实际输出时兼容 refId', () => {
    const json = irToPm(baseDoc())
    const chapter = json.content!.find(node => node.type === 'chapter')!
    const chapterAttrs = { ...chapter.attrs }
    delete chapterAttrs.nodeId
    chapter.attrs = chapterAttrs
    let legacyReferences = 0
    const updateReferences = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(updateReferences)
        return
      }
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (record.type === 'crossRef' && record.attrs && typeof record.attrs === 'object') {
        const attrs = record.attrs as Record<string, unknown>
        if (attrs.targetId === 'chapter-target') {
          record.attrs = { ...attrs, targetId: null, refId: 'sec_1' }
          legacyReferences += 1
        }
      }
      Object.values(record).forEach(updateReferences)
    }
    updateReferences(json)
    expect(legacyReferences).toBeGreaterThan(0)

    const pm = getSchema(createEditorExtensions()).nodeFromJSON(json)
    pm.check()
    const xml = serializeToXml(pm)
    expect(xml).toContain('<sec id="sec_1">')
    expect(xrefRidFor(xml, '章节目标')).toBe('sec_1')
  })

  it('未引用的重复 attrs.id 别名不阻止导出，Resolver ID 仍统一到旧有定义属性', () => {
    const doc: IRDoc = {
      schemaVersion: 1,
      meta: { standardType: 'gb', title: '无引用 ID 回归' },
      front: { foreword: [], introduction: [] },
      body: [
        { kind: 'chapter', id: 'first-chapter', secType: 'general', title: [{ text: '第一章' }], children: [] },
        { kind: 'chapter', id: 'second-chapter', secType: 'general', title: [{ text: '第二章' }], children: [] },
      ],
      appendices: [],
      bibliography: [],
    }
    const json = irToPm(doc)
    const chapters = json.content!.filter(node => node.type === 'chapter')
    for (const chapter of chapters) chapter.attrs = { ...chapter.attrs, id: 'unused-duplicate-alias' }
    const pm = getSchema(createEditorExtensions()).nodeFromJSON(json)
    const xml = serializeToXml(pm)
    expect(xml).not.toContain('<xref')
    expect(xml).toContain('<sec id="sec_1">')
    expect(xml).toContain('<sec id="sec_2">')
  })

  it('没有引用时也沿用 Resolver 为旧有 ID 属性输出的定义 ID', () => {
    const doc = baseDoc()
    const firstChapter = doc.body[0]!
    if (firstChapter.kind !== 'chapter') throw new Error('预期正文篇章')
    const clause = firstChapter.children[0]!
    if (clause.kind !== 'clause') throw new Error('预期正文条款')
    clause.children = clause.children.filter(child => child.id !== 'reference-paragraph')
    const appendix = doc.appendices[0]!
    appendix.children = [{ kind: 'paragraph', id: 'appendix-paragraph', content: [{ text: '附录正文' }] }]

    const xml = serializeToXml(toProductionNode(doc))
    expect(xml).not.toContain('<xref')
    expect(xml).toContain('<app id="sec_A"')
    expect(xml).toMatch(/<term-sec id="sec_[^"]+"/)
    expect(xml).toContain('<table-wrap id="tab_1"')
    expect(xml).toContain('<fig id="fig_1"')
    expect(xml).toContain('<disp-formula id="formula_1"')
    expect(xml).toContain('<ref id="biblref_1">')
  })

  it('异常调用后不泄露引用上下文，后续有效文档仍生成完整 ID', () => {
    const valid = toProductionNode(baseDoc())
    const invalidDoc = baseDoc()
    const clause = invalidDoc.body[0]!.children[0]!
    if (clause.kind !== 'clause') throw new Error('预期正文条款')
    clause.children.push({ kind: 'note', id: 'note-target', content: [{ kind: 'paragraph', id: 'note-target.p0', content: [{ text: '说明' }] }] })
    clause.children[0] = {
      kind: 'paragraph', id: 'note-reference', content: [crossRef('不可定位的说明', 'note-target', 'note')],
    }
    const invalid = toProductionNode(invalidDoc)
    expect(() => serializeToXml(invalid)).toThrow(XmlCrossRefValidationError)
    const xml = serializeToXml(valid)
    expectEveryXrefHasOneTarget(xml)
    expect(xrefRidFor(xml, '章节目标')).toBe('sec_1')
  })

  it('无 Resolver 的旧最小树沿用 refId 原值并以现有 attrs.id 定义为目标', () => {
    const node = (name: string, attrs: Record<string, unknown> = {}, children: PMNode[] = [], text = ''): PMNode => ({
      type: { name }, attrs, isText: name === 'text', text,
      isTextblock: name === 'paragraph' || name === 'chapterTitle', marks: [],
      forEach: (visit: (child: PMNode) => void) => children.forEach(visit),
    } as unknown as PMNode)
    const text = node('text', {}, [], '旧引用')
    ;(text as unknown as { marks: Array<{ type: { name: string }; attrs: Record<string, unknown> }> }).marks = [
      { type: { name: 'crossRef' }, attrs: { targetId: null, refId: 'legacy-id', refType: 'sec' } },
    ]
    const doc = node('doc', {}, [node('chapter', { id: 'legacy-id' }, [node('chapterTitle', {}, [node('text', {}, [], '章节')]), node('paragraph', {}, [text])])])
    const xml = serializeToXml(doc)
    expect(xml).toContain('<sec id="legacy-id">')
    expect(xml).toContain('<xref ref-type="sec" rid="legacy-id">旧引用</xref>')
  })
})
