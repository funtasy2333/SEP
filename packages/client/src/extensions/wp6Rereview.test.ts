// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import {
  IRToPmError, UnsupportedOutputError, getOutputSupportProblems, irToPm, pmToIr, resolve,
  type IRDoc, type IRInline, type IRList, type IRTable, type IRTermEntry, type PMJsonNode,
} from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { StandardDoc } from './nodes/standard-doc'
import { serializeToXml } from '../serializer/xmlSerializer'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { buildDocxBlob } from '../serializer/docxExporter'

const schema = getSchema(createEditorExtensions())
const base = (): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'ch', secType: 'general', title: [{ text: '正文' }], children: [] }],
  appendices: [], bibliography: [],
})

describe('bd0c6eb3 review through production schema and outputs', () => {
  it.each([false, true])('projects text with a table-footnote reference as a node, with inline formula=%s', formula => {
    const run: IRInline = {
      text: '原文', marks: [{ type: 'bold' }, { type: 'tableFootnoteRef', id: 'ref', targetId: 'fn' }],
      ...(formula ? { formula: { id: 'inline-math', latex: 'x+1' } } : {}),
    }
    const authored = base()
    const table: IRTable = {
      kind: 'table', id: 't', orientation: 'portrait', caption: [], headerRowCount: 0, notes: [],
      rows: [{ id: 'row', cells: [{ id: 'cell', header: false, colspan: 1, rowspan: 1,
        content: [{ kind: 'paragraph', id: 'p', content: [run] }],
      }] }], footnotes: [{ id: 'fn', content: [{ text: '表脚注' }] }],
    }
    authored.body[0].children = [table]
    const loaded = schema.nodeFromJSON(irToPm(authored))
    loaded.check()
    const atoms: string[] = []
    loaded.descendants(node => {
      expect(node.marks.some(mark => mark.type.name === 'tableFootnoteRef')).toBe(false)
      if (node.type.name === 'tableFootnoteRef') atoms.push(node.attrs.nodeId)
    })
    expect(atoms).toEqual(['ref'])
    const reopened = pmToIr(loaded.toJSON() as PMJsonNode).doc
    const inlines = (reopened.body[0].children[0] as IRTable).rows[0].cells[0].content[0]
    if (inlines.kind !== 'paragraph') throw new Error('Missing paragraph')
    expect(inlines.content[0]).toEqual({ text: '原文', marks: [{ type: 'bold' }] })
    expect(inlines.content.at(-1)).toEqual({ text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'fn', id: 'ref' }] })
    if (formula) expect(inlines.content[1]).toEqual({ text: '', formula: { id: 'inline-math', latex: 'x+1' }, marks: [{ type: 'bold' }] })
    expect(resolve(reopened).problems.filter(problem => problem.severity === 'error')).toEqual([])
  })

  it.each(['warning', 'quote'] as const)('rejects empty %s with a projection diagnostic, permits a valid paragraph', kind => {
    const authored = base()
    authored.body[0].children = [{ kind, id: 'block', content: [] }]
    expect(() => irToPm(authored)).toThrow(IRToPmError)
    try { irToPm(authored) } catch (error) {
      expect((error as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({ nodeId: 'block', path: expect.stringContaining('body[0]') }))
    }
    authored.body[0].children = [{ kind, id: 'block', content: [{ kind: 'paragraph', id: 'p', content: [] }] }]
    const loaded = schema.nodeFromJSON(irToPm(authored))
    loaded.check()
    expect(pmToIr(loaded.toJSON() as PMJsonNode).doc.body[0].children).toEqual(authored.body[0].children)
  })

  it.each(['proposer', 'technicalCommittee'] as const)('keeps %s in JSON while blocking old XML and DOCX outputs', async field => {
    const authored = base()
    authored.meta[field] = '必须保留的单位'
    const loaded = schema.nodeFromJSON(irToPm(authored))
    loaded.check()
    const source = loaded.toJSON() as PMJsonNode
    const reopened = pmToIr(source).doc
    expect(reopened.meta[field]).toBe(authored.meta[field])
    expect(getOutputSupportProblems(reopened, 'XML')).toContainEqual(expect.objectContaining({ path: `doc.meta.${field}` }))
    expect(() => serializeToXml(loaded)).toThrow(UnsupportedOutputError)
    await expect(buildDocxBlob({ pmDoc: source, documentMeta: { titleCn: '标题', standardType: 'national' } })).rejects.toThrow(UnsupportedOutputError)
    expect(JSON.stringify(exportSemanticJson(loaded))).toContain('必须保留的单位')
    expect(loaded.toJSON()).toEqual(source)
  })
})


it('rejects native structures that cannot satisfy production child cardinalities', () => {
  const cases: Array<{ id: string; authored: IRDoc }> = []
  const withChild = (child: IRDoc['body'][number]['children'][number]): IRDoc => {
    const authored = base()
    authored.body[0].children = [child]
    return authored
  }
  const list: IRList = { kind: 'list', id: 'empty-list', listType: 'dash', items: [] }
  cases.push({ id: list.id, authored: withChild(list) })
  const emptyRow: IRTable = { kind: 'table', id: 'empty-table', caption: [], orientation: 'portrait', headerRowCount: 0, rows: [], notes: [] }
  cases.push({ id: emptyRow.id, authored: withChild(emptyRow) })
  cases.push({ id: 'empty-row', authored: withChild({ ...emptyRow, rows: [{ id: 'empty-row', cells: [] }] }) })
  cases.push({ id: 'empty-cell', authored: withChild({ ...emptyRow, rows: [{ id: 'row', cells: [{ id: 'empty-cell', colspan: 1, rowspan: 1, header: false, content: [] }] }] }) })
  const term: IRTermEntry = {
    kind: 'termEntry', id: 'term', term: [{ text: '术语' }], definition: [{ kind: 'paragraph', id: 'definition', content: [] }], notes: [], examples: [],
  }
  cases.push({ id: 'empty-lang', authored: withChild({ ...term, languageSets: [{ id: 'empty-lang', language: 'en', groups: [] }] }) })
  cases.push({ id: 'empty-tig', authored: withChild({ ...term, languageSets: [{ id: 'lang', language: 'en', groups: [{ id: 'empty-tig', terms: [] }] }] }) })
  const indexDoc = base()
  indexDoc.index = { id: 'index', groups: [{ id: 'empty-index-group', entries: [] }] }
  cases.push({ id: 'empty-index-group', authored: indexDoc })
  for (const { id, authored } of cases) {
    let error: unknown
    try { schema.nodeFromJSON(irToPm(authored)).check() } catch (caught) { error = caught }
    expect(error, id).toBeInstanceOf(IRToPmError)
    expect((error as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({ nodeId: id, path: expect.any(String) }))
  }
})


it.each(['doc', 'standardDoc'] as const)('rejects empty %s roots and loads valid chapter roots', rootType => {
  const extensions = createEditorExtensions().map(extension => extension.name === 'starterKit' && rootType === 'standardDoc'
    ? extension.configure({ document: false }) : extension)
  const targetSchema = rootType === 'standardDoc' ? getSchema([...extensions, StandardDoc]) : schema
  const empty = base()
  empty.body = []
  expect(() => irToPm(empty, { rootType })).toThrow(IRToPmError)
  targetSchema.nodeFromJSON(irToPm(base(), { rootType })).check()
})

it.each(['proposer', 'technicalCommittee'] as const)('cannot bypass DOCX metadata protection when %s comes only from document settings', async field => {
  const loaded = schema.nodeFromJSON(irToPm(base()))
  const source = loaded.toJSON() as PMJsonNode
  await expect(buildDocxBlob({
    pmDoc: loaded, documentMeta: { titleCn: '标题', standardType: 'national', [field]: '文档设置中的单位' },
  })).rejects.toThrow(UnsupportedOutputError)
  expect(loaded.toJSON()).toEqual(source)
})

it.each(['dash', 'number'] as const)('loads valid Starter %s lists with an empty first paragraph', listType => {
  const authored = base()
  authored.body[0].children = [{
    kind: 'list', id: 'list', listType, ...(listType === 'number' ? { level: 2 as const } : {}), items: [{
      id: 'item', content: [
        { kind: 'paragraph', id: 'first', content: [] },
        { kind: 'paragraph', id: 'second', content: [{ text: '后续段落' }] },
      ],
    }],
  }]
  const loaded = schema.nodeFromJSON(irToPm(authored))
  loaded.check()
  expect(pmToIr(loaded.toJSON() as PMJsonNode).doc.body[0].children).toEqual(authored.body[0].children)
})
