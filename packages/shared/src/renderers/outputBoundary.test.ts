import { describe, expect, it } from 'vitest'
import { renderHtml } from './html'
import { renderDocx } from './docx'
import { getOutputSupportProblems, UnsupportedOutputError } from './outputBoundary'
import { resolve } from '../ir/resolve'
import type { IRDoc, IRInline, IRParagraph } from '../ir/types'

const base = (): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' },
  front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'chapter', secType: 'scope', title: [{ text: '范围' }], children: [{ kind: 'paragraph', id: 'p1', content: [{ text: '原正文' }] }] }],
  appendices: [], bibliography: [],
})
const options = { images: {}, formulaOmml: {}, stage: 'working_draft' as const, createdAt: '2026-10-05T00:00:00.000Z' }

describe('新增语义的实际输出边界', () => {
  it('旧文档照常输出，新MathML不得被静默丢弃', () => {
    const doc = base()
    expect(renderHtml(doc, resolve(doc).labels)).toContain('原正文')
    expect(renderDocx(doc, resolve(doc).labels, options).parts['word/document.xml']).toContain('原正文')
    doc.body[0]!.children.push({ kind: 'formula', id: 'math', latex: '', numbered: true, whereList: [], mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>' } as IRDoc['body'][number]['children'][number])
    const before = JSON.stringify(doc)
    expect(() => renderHtml(doc, resolve(doc).labels)).toThrow(UnsupportedOutputError)
    expect(() => renderDocx(doc, resolve(doc).labels, options)).toThrow(/mathml/)
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual(expect.arrayContaining([expect.objectContaining({ nodeId: 'math', path: 'doc.body[0].children[1].mathml' })]))
    expect(JSON.stringify(doc)).toBe(before)
  })
  it('图组、TBX、完整样式、索引的遗漏都带定位阻断', () => {
    const doc = base() as IRDoc & Record<string, unknown>
    doc.index = { id: 'index1', groups: [{ id: 'index-group1', entries: [{ id: 'entry1', term: [{ text: '正文' }], targets: ['p1'], seeAlso: [] }] }] }
    Object.assign(doc.body[0]!.children[0]!, { content: [{ text: '文字', style: { color: '#ff0000' } }] })
    doc.body[0]!.children.push({ kind: 'termEntry', id: 'term1', term: [{ text: '术语' }], definition: [], notes: [], examples: [], languageSets: [{ id: 'lang-fr', language: 'fr', groups: [{ id: 'tig-fr', terms: [{ id: 'variant-fr', content: [{ text: 'terme' }], descriptors: [] }] }] }] } as never)
    doc.body[0]!.children.push({ kind: 'figure', id: 'fig1', caption: [], orientation: 'portrait', src: '', notes: [], groups: [{ id: 'group1', descriptions: [], resourceRefs: [] }] } as never)
    const issues = getOutputSupportProblems(doc, 'DOCX')
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['doc.index', 'doc.body[0].children[0].content[0].style', 'doc.body[0].children[1].languageSets', 'doc.body[0].children[2].groups']))
    expect(() => renderHtml(doc, resolve(doc).labels)).toThrow(/请保留 JSON 文档/)
  })
})

it.each(['proposer', 'technicalCommittee'] as const)('preserves %s in print metadata while keeping legacy XML guarded', field => {
  const doc = base()
  doc.meta[field] = '单位 <甲> & "乙"'
  const before = JSON.stringify(doc)
  const html = renderHtml(doc, resolve(doc).labels)
  expect(html).toContain(`<meta name="ses-${field}" content="单位 &lt;甲&gt; &amp; &quot;乙&quot;" />`)
  const pkg = renderDocx(doc, resolve(doc).labels, options)
  expect(pkg.parts['docProps/custom.xml']).toContain(`name="ses-${field}"`)
  expect(pkg.parts['docProps/custom.xml']).toContain('单位 &lt;甲&gt; &amp; "乙"')
  expect(pkg.parts['_rels/.rels']).toContain('relationships/custom-properties')
  expect(pkg.parts['_rels/.rels']).toContain('Target="docProps/custom.xml"')
  expect(pkg.parts['[Content_Types].xml']).toContain('PartName="/docProps/custom.xml"')
  expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
  expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
  expect(getOutputSupportProblems(doc, 'XML')).toContainEqual(expect.objectContaining({ path: `doc.meta.${field}` }))
  expect(JSON.stringify(doc)).toBe(before)
})

it('keeps packages without authoring metadata unchanged and handles both property IDs deterministically', () => {
  const doc = base()
  expect(renderDocx(doc, resolve(doc).labels, options).parts['docProps/custom.xml']).toBeUndefined()
  doc.meta.proposer = '提出甲'
  doc.meta.technicalCommittee = '归口乙'
  const pkg = renderDocx(doc, resolve(doc).labels, options)
  expect(pkg.parts['docProps/custom.xml']).toContain('pid="2" name="ses-proposer"')
  expect(pkg.parts['docProps/custom.xml']).toContain('pid="3" name="ses-technicalCommittee"')
  expect(renderDocx(doc, resolve(doc).labels, options).parts).toEqual(pkg.parts)
})

it.each(['proposer', 'technicalCommittee'] as const)('keeps legacy output available when %s has no data', field => {
  for (const value of [undefined, '']) {
    const doc = base()
    doc.meta[field] = value
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(doc, 'XML')).toEqual([])
  }
})


it.each(['HTML', 'DOCX', 'XML'] as const)('rejects rich or divergent formula source in %s but accepts equivalent plain text', format => {
  const rich = base()
  rich.body[0]!.children.push({
    kind: 'formula', id: 'rich-formula', latex: 'x', numbered: false, whereList: [],
    sourceInlines: [{ text: 'x', marks: [{ type: 'bold' }] }],
  } as IRDoc['body'][number]['children'][number])
  expect(getOutputSupportProblems(rich, format)).toEqual(expect.arrayContaining([
    expect.objectContaining({ nodeId: 'rich-formula', path: 'doc.body[0].children[1].sourceInlines' }),
  ]))

  const divergent = base()
  divergent.body[0]!.children.push({
    kind: 'formula', id: 'divergent-formula', latex: 'x', numbered: false, whereList: [],
    sourceInlines: [{ text: 'y' }],
  } as IRDoc['body'][number]['children'][number])
  expect(getOutputSupportProblems(divergent, format)).toEqual(expect.arrayContaining([
    expect.objectContaining({ nodeId: 'divergent-formula', path: 'doc.body[0].children[1].sourceInlines' }),
  ]))

  const equivalent = base()
  equivalent.body[0]!.children.push({
    kind: 'formula', id: 'plain-formula', latex: 'x', numbered: false, whereList: [],
    sourceInlines: [{ text: ' x ', marks: [], style: {} }],
  } as IRDoc['body'][number]['children'][number])
  expect(getOutputSupportProblems(equivalent, format)).toEqual([])
})

it('preserves applicant in HTML and DOCX metadata while keeping the established legacy XML contract', () => {
  const doc = base()
  doc.meta.applicant = '起草单位 <甲> & "乙"'
  expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
  expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
  // applicant is outside the legacy XML front. Import deliberately keeps the current editor value;
  // this is not a claim that XML independently carries the metadata.
  expect(getOutputSupportProblems(doc, 'XML')).toEqual([])

  const html = renderHtml(doc, resolve(doc).labels)
  expect(html).toContain('<meta name="ses-applicant" content="起草单位 &lt;甲&gt; &amp; &quot;乙&quot;" />')
  const pkg = renderDocx(doc, resolve(doc).labels, options)
  expect(pkg.parts['docProps/custom.xml']).toContain('name="ses-applicant"')
  expect(pkg.parts['docProps/custom.xml']).toContain('起草单位 &lt;甲&gt; &amp; "乙"')
})


it('blocks XML only when explicit headerRowCount cannot be represented by legacy cell tags', () => {
  const doc = base()
  doc.body[0]!.children.push({
    kind: 'table', id: 'mixed-header-table', caption: [], orientation: 'portrait', headerRowCount: 1, notes: [],
    rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [{ kind: 'paragraph', id: 'cell-p', content: [{ text: '值' }] }] }] }],
  })
  expect(getOutputSupportProblems(doc, 'XML')).toEqual(expect.arrayContaining([
    expect.objectContaining({ nodeId: 'mixed-header-table', path: 'doc.body[0].children[1].headerRowCount' }),
  ]))
  expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
  expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])

  const equivalent = base()
  equivalent.body[0]!.children.push({
    kind: 'table', id: 'all-header-table', caption: [], orientation: 'portrait', headerRowCount: 1, notes: [],
    rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'cell-p', content: [{ text: '列名' }] }] }] }],
  })
  expect(getOutputSupportProblems(equivalent, 'XML')).toEqual([])
})

const outputFormats = ['HTML', 'DOCX', 'XML'] as const

function setReference(doc: IRDoc, inline: IRInline): void {
  ;(doc.body[0]!.children[0] as IRParagraph).content = [inline]
}

it('rejects a mismatched typed cross-reference through all non-JSON boundaries, regardless of labels', () => {
  const doc = base()
  setReference(doc, { text: '图引用', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'figure' }] })
  const before = JSON.stringify(doc)
  const resolverProblem = resolve(doc).problems.find(problem => problem.code === 'dangling-typed-ref')
  expect(resolverProblem).toMatchObject({ code: 'dangling-typed-ref', nodeId: 'p1', severity: 'error' })

  for (const format of outputFormats) {
    expect(getOutputSupportProblems(doc, format)).toContainEqual(expect.objectContaining({
      code: 'unsupported-output',
      nodeId: 'p1',
      path: 'resolver.problems[dangling-typed-ref]',
      message: expect.stringContaining(resolverProblem!.message),
    }))
  }

  expect(() => renderHtml(doc, {})).toThrow(UnsupportedOutputError)
  expect(() => renderHtml(doc, { chapter: { label: '图1', xmlId: 'fig_1', refText: '图1' } })).toThrow(UnsupportedOutputError)
  expect(() => renderDocx(doc, {}, options)).toThrow(UnsupportedOutputError)
  expect(() => renderDocx(doc, { chapter: { label: '图1', xmlId: 'fig_1', refText: '图1' } }, options)).toThrow(UnsupportedOutputError)
  expect(JSON.stringify(doc)).toBe(before)
})

it('covers typed errors in footnotes and nested notes, including bibRef and termRef', () => {
  const doc = base()
  const paragraph = doc.body[0]!.children[0] as IRParagraph
  paragraph.content = [{
    text: '脚注',
    footnote: {
      id: 'footnote-owner',
      content: [{ text: '错类型', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'figure' }] }],
    },
  }]
  doc.body[0]!.children.push({
    kind: 'note', id: 'nested-note-owner',
    content: [
      { text: '文献错类型', marks: [{ type: 'bibRef', targetId: 'chapter' }] },
      { text: '术语错类型', marks: [{ type: 'termRef', targetId: 'chapter' }] },
    ],
  })

  const resolverProblems = resolve(doc).problems.filter(problem => problem.code === 'dangling-typed-ref')
  expect(resolverProblems.map(problem => problem.nodeId)).toEqual(['footnote-owner', 'nested-note-owner', 'nested-note-owner'])
  for (const format of outputFormats) {
    const problems = getOutputSupportProblems(doc, format).filter(problem => problem.path === 'resolver.problems[dangling-typed-ref]')
    expect(problems.map(problem => problem.nodeId)).toEqual(['footnote-owner', 'nested-note-owner', 'nested-note-owner'])
    for (const resolverProblem of resolverProblems) {
      expect(problems).toContainEqual(expect.objectContaining({ nodeId: resolverProblem.nodeId, message: expect.stringContaining(resolverProblem.message) }))
    }
  }
})

it('allows correctly typed, untyped, and valid unnumbered paragraph/formula references', () => {
  const cases: IRDoc[] = []

  const chapterRef = base()
  setReference(chapterRef, { text: '章引用', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] })
  cases.push(chapterRef)

  const legacyUntypedRef = base()
  setReference(legacyUntypedRef, { text: '旧引用', marks: [{ type: 'crossRef', targetId: 'chapter' }] })
  cases.push(legacyUntypedRef)

  const paragraphRef = base()
  setReference(paragraphRef, { text: '段落引用', marks: [{ type: 'crossRef', targetId: 'p1', targetKind: 'paragraph' }] })
  cases.push(paragraphRef)

  const formulaRef = base()
  formulaRef.body[0]!.children.push({ kind: 'formula', id: 'unnumbered-formula', latex: 'x', numbered: false, whereList: [] })
  setReference(formulaRef, { text: '公式引用', marks: [{ type: 'crossRef', targetId: 'unnumbered-formula', targetKind: 'formula' }] })
  cases.push(formulaRef)

  for (const doc of cases) {
    const labels = resolve(doc).labels
    for (const format of outputFormats) expect(getOutputSupportProblems(doc, format)).toEqual([])
    expect(() => renderHtml(doc, labels)).not.toThrow()
    expect(() => renderDocx(doc, labels, options)).not.toThrow()
  }
})

it('does not widen the boundary to unrelated Resolver errors', () => {
  const doc = base()
  setReference(doc, { text: '未类型化缺失引用', marks: [{ type: 'crossRef', targetId: 'missing-target' }] })
  doc.body[0]!.children.push({
    kind: 'clause', id: 'skipped-level', level: 2, titled: true,
    title: [{ text: '跳级' }], children: [{ kind: 'paragraph', id: 'nested-paragraph', content: [{ text: '正文' }] }],
  } as never)
  expect(resolve(doc).problems).toContainEqual(expect.objectContaining({ code: 'dangling-xref', severity: 'error', nodeId: 'p1' }))
  expect(resolve(doc).problems).toContainEqual(expect.objectContaining({ code: 'heading-skip', severity: 'warning', nodeId: 'skipped-level' }))
  for (const format of outputFormats) expect(getOutputSupportProblems(doc, format)).toEqual([])
  expect(() => renderHtml(doc, resolve(doc).labels)).not.toThrow()
  expect(() => renderDocx(doc, resolve(doc).labels, options)).not.toThrow()
})
