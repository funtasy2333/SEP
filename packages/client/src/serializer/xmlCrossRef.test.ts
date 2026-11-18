// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { buildXml46687Package } from '@ses/io'
import type { IRDoc, IRInline, IRReferenceTargetKind, PMJsonNode } from '@ses/shared'
import { irToPm } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

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
    { text: '；' },
    crossRef('注目标', 'note-target', 'note'),
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
    body: [
      {
        kind: 'chapter', id: 'chapter-target', secType: 'general', title: [{ text: '正文' }],
        children: [{
          kind: 'clause', id: 'clause-target', level: 1, titled: true, title: [{ text: '目标条' }],
          children: [
            { kind: 'paragraph', id: 'reference-paragraph', content: referenceParagraph },
            {
              kind: 'table', id: 'table-target', caption: [{ text: '目标表' }], orientation: 'portrait',
              headerRowCount: 0, notes: [], rows: [{
                id: 'table-row', cells: [{
                  id: 'table-cell', colspan: 1, rowspan: 1, header: false,
                  content: [{ kind: 'paragraph', id: 'table-cell-paragraph', content: [{ text: '值' }] }],
                }],
              }],
            },
            { kind: 'figure', id: 'figure-target', caption: [{ text: '目标图' }], orientation: 'portrait', src: TINY_PNG, notes: [] },
            { kind: 'formula', id: 'formula-target', latex: 'x = 1', numbered: true, whereList: [] },
            { kind: 'note', id: 'note-target', content: [{ kind: 'paragraph', id: 'note-target.p0', content: [{ text: '目标注内容' }] }] },
          ],
        }],
      },
      {
        kind: 'chapter', id: 'terms-chapter', secType: 'terms', title: [{ text: '术语和定义' }],
        children: [{
          kind: 'termEntry', id: 'term-target', term: [{ text: '测试术语' }],
          definition: [{ kind: 'paragraph', id: 'term-definition', content: [{ text: '术语定义' }] }],
          notes: [], examples: [],
        }],
      },
    ],
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

function findTextNode(root: PMNode, text: string): PMNode {
  let found: PMNode | undefined
  root.descendants(node => {
    if (node.isText && node.text === text) found = node
  })
  if (!found) throw new Error(`找不到文本节点：${text}`)
  return found
}

function xmlDoc(xml: string): Document {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
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

async function exportXmlOk(pm: PMNode): Promise<string> {
  const result = await buildXml46687Package({ pmDoc: pm.toJSON() as PMJsonNode })
  const errors = result.problems.filter(problem => problem.severity === 'error')
  expect(errors).toEqual([])
  expect(result.xml).toBeTruthy()
  return result.xml!
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

describe('生产 GB/T 46687.2 XML 交叉引用序列化', () => {
  it('IR→真实生产 schema 后，正文、术语、附录与脚注引用都指向唯一输出定义且不改 PM 树', async () => {
    const pm = toProductionNode(baseDoc())
    const before = structuredClone(pm.toJSON())
    const xml = await exportXmlOk(pm)

    expectEveryXrefHasOneTarget(xml)
    const docEl = xmlDoc(xml)
    const refParagraph = Array.from(docEl.getElementsByTagName('p')).find(p => p.textContent?.includes('术语目标'))!
    const refXrefs = Array.from(refParagraph.getElementsByTagName('xref')).map(el => ({
      refType: el.getAttribute('ref-type'),
      customType: el.getAttribute('custom-type'),
      rid: el.getAttribute('rid'),
      text: el.textContent,
    }))
    expect(refXrefs).toEqual([
      { refType: 'sec', customType: null, rid: 'sec_1', text: '第1章' },
      { refType: 'sec', customType: null, rid: 'sec_1.1', text: '1.1' },
      { refType: 'custom', customType: 'term-entry', rid: 'term_2.1', text: '术语目标' },
      { refType: 'table', customType: null, rid: 'tab_1', text: '表1' },
      { refType: 'fig', customType: null, rid: 'fig_1', text: '图1' },
      { refType: 'disp-formula', customType: null, rid: 'formula_1', text: '公式(1)' },
      { refType: 'bibr', customType: null, rid: 'biblref_1', text: '文献目标' },
      { refType: 'app', customType: null, rid: 'sec_A', text: '附录A' },
      { refType: 'custom', customType: 'note', rid: 'note_1', text: '注' },
      { refType: 'fn', customType: null, rid: 'fn_1', text: '1)' },
      { refType: 'sec', customType: null, rid: 'sec_1', text: '第1章' },
    ])
    const fnXref = Array.from(docEl.getElementsByTagName('fn')[0]!.getElementsByTagName('xref'))[0]!
    expect(fnXref.getAttribute('ref-type')).toBe('sec')
    expect(fnXref.getAttribute('rid')).toBe('sec_1')
    expect(pm.toJSON()).toEqual(before)
    expect(xml).toContain('<app id="sec_A"')
    expect(xml).toContain('<tbx:termEntry id="term_2.1"')
    expect(xml).toContain('<table-wrap id="tab_1"')
    expect(xml).toContain('<fig id="fig_1"')
    expect(xml).toContain('<disp-formula id="formula_1"')
    expect(xml).toContain('<ref id="biblref_1">')
    expect(xml).toContain('<non-normative-note id="note_1">')
  })

  it('优先用非空 targetId；targetId 为 null 时回退 refId 命中稳定 nodeId', async () => {
    const pm = toProductionNode(baseDoc())
    const source = findTextNode(pm, '章节目标')
    const original = source.marks.find(mark => mark.type.name === 'crossRef')!
    const priority = setCrossRefAttrs(pm, { refId: 'other-target' })
    expect(xmlDoc(await exportXmlOk(priority)).getElementsByTagName('xref')[0]?.getAttribute('rid')).toBe('sec_1')
    expect(original.attrs.targetId).toBe('chapter-target')

    const byStableId = setCrossRefAttrs(pm, { targetId: null, refId: 'chapter-target' })
    expect(xmlDoc(await exportXmlOk(byStableId)).getElementsByTagName('xref')[0]?.getAttribute('rid')).toBe('sec_1')

    const unknownRefId = setCrossRefAttrs(pm, { targetId: null, refId: 'legacy-chapter-id' })
    const res = await buildXml46687Package({ pmDoc: unknownRefId.toJSON() as PMJsonNode })
    expect(res.xml).toBeNull()
    expect(res.problems.some(problem => problem.severity === 'error' && problem.code === 'xml-xref-target-missing')).toBe(true)
  })

  it('空 targetId、悬空目标及 XML46687 无编号载体均阻断导出并返回明确错误', async () => {
    const pm = toProductionNode(baseDoc())
    const emptyTarget = setCrossRefAttrs(pm, { targetId: '', refId: 'chapter-target' })
    const emptyRes = await buildXml46687Package({ pmDoc: emptyTarget.toJSON() as PMJsonNode })
    expect(emptyRes.xml).toBeNull()
    expect(emptyRes.problems.some(problem => problem.severity === 'error')).toBe(true)

    const unresolved = setCrossRefAttrs(pm, { targetId: 'missing-target', refId: 'chapter-target' })
    const unresolvedRes = await buildXml46687Package({ pmDoc: unresolved.toJSON() as PMJsonNode })
    expect(unresolvedRes.xml).toBeNull()
    expect(unresolvedRes.problems.some(problem => problem.severity === 'error' && problem.message.includes('missing-target'))).toBe(true)

    const paraTargetDoc = baseDoc()
    const paraClause = paraTargetDoc.body[0]!.children[0]!
    if (paraClause.kind !== 'clause') throw new Error('预期正文条款')
    paraClause.children.push({ kind: 'paragraph', id: 'plain-para-target', content: [{ text: '无编号普通段落' }] })
    paraClause.children[0] = {
      kind: 'paragraph', id: 'para-reference', content: [crossRef('不可定位的段落', 'plain-para-target', 'paragraph')],
    }
    const noIdCarrier = toProductionNode(paraTargetDoc)
    const noIdRes = await buildXml46687Package({ pmDoc: noIdCarrier.toJSON() as PMJsonNode })
    expect(noIdRes.xml).toBeNull()
    expect(noIdRes.problems.some(problem => problem.severity === 'error' && problem.code === 'xml-xref-target-unsupported')).toBe(true)
  })

  it('引用无编号公式时按 GB/T 46687.2 阻断导出并返回明确错误', async () => {
    const doc = baseDoc()
    const clause = doc.body[0]!.children[0]!
    if (clause.kind !== 'clause') throw new Error('预期正文条款')
    const formula = clause.children.find(child => child.kind === 'formula')!
    if (formula.kind !== 'formula') throw new Error('预期测试公式')
    formula.numbered = false
    const pm = toProductionNode(doc)
    const res = await buildXml46687Package({ pmDoc: pm.toJSON() as PMJsonNode })
    expect(res.xml).toBeNull()
    expect(res.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'xml-xref-target-unsupported' }),
    ]))
  })

  it('普通 untyped crossRef 指向正文脚注或表脚注时阻断导出并返回明确错误', async () => {
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

    const res = await buildXml46687Package({ pmDoc: toProductionNode(doc).toJSON() as PMJsonNode })
    expect(res.xml).toBeNull()
    const unsupported = res.problems.filter(problem => problem.severity === 'error' && problem.code === 'xml-xref-target-unsupported')
    expect(unsupported.some(problem => problem.message.includes('body-footnote'))).toBe(true)
    expect(unsupported.some(problem => problem.message.includes('table-footnote'))).toBe(true)
  })

  it('异常调用后不泄露引用上下文，后续有效文档仍生成完整 ID', async () => {
    const valid = toProductionNode(baseDoc())
    const invalidDoc = baseDoc()
    const clause = invalidDoc.body[0]!.children[0]!
    if (clause.kind !== 'clause') throw new Error('预期正文条款')
    clause.children.push({ kind: 'paragraph', id: 'plain-para-target', content: [{ text: '普通段落' }] })
    clause.children[0] = {
      kind: 'paragraph', id: 'para-reference', content: [crossRef('不可定位的段落', 'plain-para-target', 'paragraph')],
    }
    const invalid = toProductionNode(invalidDoc)
    const invalidRes = await buildXml46687Package({ pmDoc: invalid.toJSON() as PMJsonNode })
    expect(invalidRes.xml).toBeNull()
    expect(invalidRes.problems.some(problem => problem.severity === 'error')).toBe(true)

    const xml = await exportXmlOk(valid)
    expectEveryXrefHasOneTarget(xml)
    expect(xmlDoc(xml).getElementsByTagName('xref')[0]?.getAttribute('rid')).toBe('sec_1')
  })
})
