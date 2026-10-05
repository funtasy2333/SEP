// @vitest-environment happy-dom
import { Editor, getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { IRToPmError, irToPm, pmToIr, resolve, type IRBlock, type IRChapterChild, type IRClauseChild, type IRDoc, type IRTermEntry, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { StandardDoc } from '../extensions/nodes/standard-doc'
import { NODE_ID_TYPES } from '../extensions/plugins/ensureNodeId'
import { createWp6Fixture } from '../extensions/__fixtures__/wp6'
import { exportSemanticJson } from '../serializer/jsonExporter'

const extensions = createEditorExtensions()
const schema = getSchema(extensions)

function visit(node: PMJsonNode, fn: (node: PMJsonNode) => void): void {
  fn(node)
  node.content?.forEach(child => visit(child, fn))
}

function typedNode(doc: PMJsonNode, type: string, nodeId?: string): PMJsonNode | undefined {
  let result: PMJsonNode | undefined
  visit(doc, node => {
    if (node.type === type && (!nodeId || node.attrs?.nodeId === nodeId)) result = node
  })
  return result
}

function findTermEntry(children: IRChapterChild[]): IRTermEntry | undefined {
  for (const child of children) {
    if (child.kind === 'termEntry') return child
    if (child.kind === 'clause') {
      const nested = findTermEntry(child.children)
      if (nested) return nested
    }
  }
  return undefined
}

function blocksFromChildren(children: IRClauseChild[]): IRBlock[] {
  const blocks: IRBlock[] = []
  for (const child of children) {
    if (child.kind === 'clause') blocks.push(...blocksFromChildren(child.children))
    else if (child.kind !== 'termEntry') blocks.push(child)
  }
  return blocks
}

function allDocumentBlocks(doc: IRDoc): IRBlock[] {
  return [
    ...doc.front.foreword,
    ...doc.front.introduction,
    ...doc.body.flatMap(chapter => blocksFromChildren(chapter.children)),
    ...doc.appendices.flatMap(appendix => blocksFromChildren(appendix.children)),
  ]
}

describe('WP6 production schema round trip', () => {
  it('mounts all typed fields and preserves them through PM→IR→PM, JSON cold reopen, and JSON export', () => {
    const fixture = createWp6Fixture()
    const root = schema.nodeFromJSON(fixture)
    root.check()
    expect(root.type.name).toBe('doc')

    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({ element, extensions, content: fixture })
    try {
      const html = editor.getHTML()
      const rendered = document.createElement('div')
      rendered.innerHTML = html
      for (const kind of [
        'metadata-block', 'title-part', 'standard-identifier', 'identifier-part', 'metadata-language', 'term-source',
        'publisher', 'adoption', 'replaced-standard', 'copyright', 'tbx-lang-set', 'tbx-tig',
        'tbx-term-variant', 'tbx-term-descriptor', 'formula-inline', 'formula-note', 'where-list',
        'figure-group', 'figure-description', 'figure-resource', 'warning', 'quote-block', 'code-block',
        'bib-structured', 'bib-field', 'bib-identifier', 'index', 'index-group', 'index-entry',
      ]) expect(rendered.querySelector(`[data-type="${kind}"]`), `HTML renders ${kind}`).not.toBeNull()
      expect(rendered.querySelector('.std-title-part-content')?.textContent).toContain('标准机器语言表达')
      expect(rendered.querySelector('.std-term-source-label')?.textContent).toBe('来源：')
      expect(rendered.querySelector('.std-tbx-descriptor-label')?.textContent).toContain('partOfSpeech')
      expect(rendered.querySelector('.std-formula-inline')?.textContent).toContain('x^2 + 1')
      expect(rendered.querySelector('.std-table-cell-unit')?.textContent).toBe('mm')
      expect(rendered.querySelector('.std-code-block code')?.textContent).toBe('key = value')

      const savedJson = JSON.parse(JSON.stringify(editor.getJSON())) as PMJsonNode
      const requiredStableTypes = [
        'titlePart', 'standardIdentifier', 'identifierPart', 'language', 'publisher', 'adoption', 'replacedStandard', 'copyright',
        'termDefinition', 'tbxLangSet', 'tbxTig', 'tbxTermVariant', 'tbxTermDescriptor', 'formulaInline', 'formulaNote', 'whereItem',
        'tableRow', 'tableHeader', 'tableCell', 'figureGroup', 'figureDescription', 'figureResource', 'bibField', 'bibIdentifier',
        'indexBlock', 'indexGroup', 'indexEntry', 'warning', 'quoteBlock', 'codeBlock',
      ]
      const nodesWithIds: PMJsonNode[] = []
      visit(savedJson, node => { if (requiredStableTypes.includes(node.type)) nodesWithIds.push(node) })
      expect(new Set(nodesWithIds.map(node => node.type))).toEqual(new Set(requiredStableTypes))
      expect(nodesWithIds.every(node => typeof node.attrs?.nodeId === 'string' && node.attrs.nodeId.length > 0)).toBe(true)
      expect(new Set(NODE_ID_TYPES).size).toBe(NODE_ID_TYPES.length)
      const initial = pmToIr(savedJson)
      expect(initial.doc.extensionVersion).toBe(1)
      expect(initial.doc.meta.titleParts?.map(part => part.id)).toEqual(['meta-title-zh', 'meta-title-en'])
      expect(initial.doc.meta.titleParts?.some(part => part.id === 'fallback-title')).toBe(false)
      expect(initial.doc.meta.identifiers?.[0]?.parts.map(part => part.id)).toEqual([
        'meta-identifier-scheme', 'meta-identifier-number', 'meta-identifier-year',
      ])
      expect(initial.doc.meta.languages).toEqual([
        { id: 'meta-language-zh', tag: 'zh-Hans', usage: 'document' },
        { id: 'meta-language-en', tag: 'en', usage: 'title' },
      ])
      expect(initial.doc.meta.publishers?.[0]).toMatchObject({ id: 'meta-publisher', role: 'publisher', identifier: 'SAMR' })
      expect(initial.doc.meta.adoptions?.[0]).toMatchObject({ id: 'meta-adoption', reference: 'ISO 1234:2024', degree: 'modified' })
      expect(initial.doc.meta.replacedStandards?.[0]).toMatchObject({ id: 'meta-replaced', reference: 'GB/T 46687.1—2026' })
      expect(initial.doc.meta.copyrights?.[0]).toMatchObject({ id: 'meta-copyright', holder: [{ text: '国家市场监督管理总局' }], year: '2026' })
      const termEntry = findTermEntry(initial.doc.body[0]?.children ?? [])
      expect(termEntry?.definition[0]?.id).toBe('term-definition-main')
      expect(termEntry?.source).toEqual([{ text: 'ISO vocabulary' }])
      expect(termEntry?.languageSets?.map(set => ({
        id: set.id,
        language: set.language,
        groups: set.groups.map(group => ({
          id: group.id,
          terms: group.terms.map(term => ({ id: term.id, descriptorIds: term.descriptors.map(descriptor => descriptor.id) })),
        })),
      }))).toEqual([
        { id: 'term-lang-zh', language: 'zh-Hans', groups: [{ id: 'term-tig-zh', terms: [
          { id: 'term-variant-zh', descriptorIds: ['term-pos-zh', 'term-domain-zh'] },
          { id: 'term-variant-short', descriptorIds: ['term-status-short'] },
        ] }, { id: 'term-tig-zh-alt', terms: [
          { id: 'term-variant-zh-alt', descriptorIds: ['term-type-alt', 'term-usage-alt'] },
        ] }] },
        { id: 'term-lang-en', language: 'en', groups: [{ id: 'term-tig-en', terms: [
          { id: 'term-variant-en', descriptorIds: ['term-source-en'] },
        ] }] },
      ])
      const blocks = allDocumentBlocks(initial.doc)
      const formulaBlock = blocks.find(block => block.kind === 'formula')
      expect(formulaBlock).toMatchObject({
        id: 'formula-block',
        mathml: '<math><mi>x</mi><mo>=</mo><mn>2</mn></math>',
        notes: [{ id: 'formula-note', content: [{ text: '公式注：等式中的变量取实数。' }] }],
        whereList: [{ id: 'where-x', term: [{ text: 'x' }], definition: [{ text: '自变量' }] }],
      })
      const tableBlock = blocks.find(block => block.kind === 'table')
      expect(tableBlock).toMatchObject({
        id: 'table-main', unit: 'mm', width: { value: 120, unit: 'mm' },
        style: { layout: 'fixed', borderWidth: { value: 0.5, unit: 'pt' }, cellPadding: { value: 1.5, unit: 'mm' } },
      })
      if (tableBlock?.kind === 'table') {
        expect(tableBlock.rows[0]).toMatchObject({ id: 'table-row-header', style: { height: { value: 8, unit: 'mm' } } })
        expect(tableBlock.rows[0]?.cells[0]).toMatchObject({
          id: 'table-cell-h1', cellType: 'columnHeader', unit: 'mm', width: { value: 40, unit: 'mm' }, columnWidths: [151],
        })
        expect(tableBlock.rows[1]?.cells[0]).toMatchObject({
          id: 'table-cell-1', style: { borderTop: { value: 0.25, unit: 'pt' }, paddingLeft: { value: 2, unit: 'mm' } },
        })
      }
      const figureBlock = blocks.find(block => block.kind === 'figure')
      expect(figureBlock).toMatchObject({
        id: 'figure-main', unit: 'mm', imageWidth: { value: 12, unit: 'mm' }, imageHeight: { value: 8, unit: 'mm' },
        alt: '一像素示意图', title: '资源测试图', descriptions: [{ id: 'figure-description' }],
        groups: [{ id: 'figure-group', descriptions: [{ id: 'figure-group-description' }], resourceRefs: ['figure-resource'] }],
      })
      expect(blocks.filter(block => block.kind === 'warning' || block.kind === 'quote' || block.kind === 'code').map(block => block.kind)).toEqual(['warning', 'quote', 'code'])
      const styledText = blocks.find(block => block.kind === 'paragraph' && block.content.some(run => run.text === 'x'))
      expect(styledText?.kind === 'paragraph' && styledText.content.find(run => run.text === 'x')).toMatchObject({
        style: { fontFamily: 'SimSun', fontSize: '12pt', color: '#112233', textTransform: 'none' },
        marks: [{ type: 'variable', kind: 'symbol', name: 'x' }],
      })
      expect(initial.doc.bibliography[0]).toMatchObject({ id: 'bib-entry', entryType: 'standard' })
      expect(initial.doc.bibliography[0]?.fields?.map(field => [field.id, field.name])).toEqual([
        ['bib-title', 'title'], ['bib-author', 'author'],
      ])
      expect(initial.doc.bibliography[0]?.identifiers).toEqual([
        { id: 'bib-identifier', scheme: 'GB/T', value: '46687.2—2026' },
      ])
      expect(initial.doc.index?.groups[0]?.entries[0]).toEqual({
        id: 'index-entry-main', term: [{ text: '术语条目' }], targets: ['term-main', 'clause-main'], seeAlso: ['bib-entry'],
      })
      const formula = initial.doc.body[0]?.children.find(child => child.kind === 'clause')
      expect(formula).toBeDefined()
      const jsonSource = JSON.stringify(initial.doc)
      for (const value of ['MathML', 'term-lang-en', 'formula-note', 'figure-resource', 'index-entry-main', 'key = value']) {
        expect(jsonSource.toLowerCase()).toContain(value.toLowerCase())
      }
      expect(resolve(initial.doc).problems.filter(problem => problem.severity === 'error')).toEqual([])

      let emitted: PMJsonNode
      try {
        emitted = irToPm(initial.doc)
      } catch (error) {
        if (error instanceof IRToPmError) throw new Error(JSON.stringify(error.diagnostics))
        throw error
      }
      expect(emitted.type).toBe('doc')
      const roundtrip = schema.nodeFromJSON(emitted)
      roundtrip.check()
      const coldReopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(roundtrip.toJSON())) as PMJsonNode)
      coldReopened.check()
      const after = pmToIr(coldReopened.toJSON() as PMJsonNode)
      expect(after.doc.meta.titleParts).toEqual(initial.doc.meta.titleParts)
      expect(after.doc.meta.identifiers).toEqual(initial.doc.meta.identifiers)
      expect(after.doc.meta.publishers).toEqual(initial.doc.meta.publishers)
      expect(after.doc.meta.copyrights).toEqual(initial.doc.meta.copyrights)
      expect(after.doc.resources).toEqual(initial.doc.resources)
      expect(after.doc.index).toEqual(initial.doc.index)
      expect(allDocumentBlocks(after.doc).find(block => block.kind === 'table')).toEqual(tableBlock)
      expect(allDocumentBlocks(after.doc).find(block => block.kind === 'figure')).toEqual(figureBlock)
      expect(after.doc.bibliography[0]).toEqual(initial.doc.bibliography[0])
      expect(JSON.stringify(after.doc)).toContain('x = 2')
      expect(JSON.stringify(after.doc)).toContain('key = value')
      const afterParagraph = allDocumentBlocks(after.doc).find(block => block.kind === 'paragraph' && block.content.some(run => run.text === 'x'))
      expect(afterParagraph?.kind === 'paragraph' && afterParagraph.content.find(run => run.text === 'x')).toMatchObject({
        style: { fontFamily: 'SimSun', fontSize: '12pt', color: '#112233', textTransform: 'none' },
        marks: [{ type: 'variable', kind: 'symbol', name: 'x' }],
      })
      expect(typedNode(coldReopened.toJSON() as PMJsonNode, 'formulaInline', 'formula-inline')?.attrs).toMatchObject({
        latex: 'x^2 + 1', mathml: '<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math>',
      })

      const semanticExport = JSON.stringify(exportSemanticJson(coldReopened))
      for (const value of ['standardIdentifier', 'tbxTermDescriptor', 'formulaInline', '<math><msup>', 'figureResource', 'bibStructured', 'indexEntry']) {
        expect(semanticExport).toContain(value)
      }
    } finally {
      editor.destroy()
      element.remove()
    }
  })

  it('does not resurrect deleted typed metadata and does not render executable external links', () => {
    const deletedTitleFixture = createWp6Fixture()
    const metadataBlock = deletedTitleFixture.content?.find(node => node.type === 'metadataBlock')
    if (!metadataBlock) throw new Error('metadataBlock fixture missing')
    metadataBlock.content = metadataBlock.content?.filter(node => node.type !== 'titlePart')
    const deleted = pmToIr(deletedTitleFixture).doc.meta
    expect(deleted.titleParts ?? []).toEqual([])

    const unsafeContent: PMJsonNode = {
      type: 'doc',
      content: [{
        type: 'stdParagraph',
        attrs: { nodeId: 'unsafe-link-paragraph' },
        content: [{ type: 'text', text: 'unsafe', marks: [{ type: 'externalLink', attrs: { href: 'javascript:alert(1)' } }] }],
      }],
    }
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({ element, extensions, content: unsafeContent })
    try {
      const serialized = editor.getJSON() as PMJsonNode
      const retained = JSON.stringify(serialized)
      expect(retained).toContain('javascript:alert(1)')
      const output = document.createElement('div')
      output.innerHTML = editor.getHTML()
      const href = output.querySelector('a[data-type="external-link"]')?.getAttribute('href')
      expect(href ?? '').not.toMatch(/^javascript:/i)
    } finally {
      editor.destroy()
      element.remove()
    }
  })

  it('builds typed metadata, TBX, formulas, tables, figures, bib and index from a new IR document', () => {
    const authored: IRDoc = {
      schemaVersion: 1,
      extensionVersion: 1,
      meta: {
        standardType: 'gb',
        titleParts: [{ id: 'ir-title', lang: 'zh-Hans', role: 'main', content: [{ text: 'IR新建标题' }] }],
        identifiers: [{ id: 'ir-identifier', scheme: 'GB/T', value: 'GB/T 9000—2026', parts: [
          { id: 'ir-ident-part', kind: 'number', position: 1, content: [{ text: '9000' }] },
        ] }],
        languages: [{ id: 'ir-language', tag: 'zh-Hans', usage: 'document' }],
        publishers: [{ id: 'ir-publisher', name: [{ text: '标准出版社' }], role: 'publisher' }],
        adoptions: [{ id: 'ir-adoption', reference: 'ISO 9000:2026', degree: 'identical' }],
        replacedStandards: [{ id: 'ir-replaced', reference: 'GB/T 8999—2020', relation: 'revises' }],
        copyrights: [{ id: 'ir-copyright', holder: [{ text: '发布机构' }], year: '2026', statement: [{ text: '版权声明' }] }],
      },
      front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'ir-chapter', secType: 'general', title: [{ text: '正文' }], children: [{
        kind: 'clause', id: 'ir-clause', level: 1, titled: true, title: [{ text: '语义结构' }], children: [
          { kind: 'paragraph', id: 'ir-paragraph', content: [
            { text: 'v', marks: [{ type: 'variable', kind: 'symbol', name: 'v' }], style: { fontSize: '11pt', color: '#123456' } },
            { text: '', formula: { id: 'ir-inline-formula', mathml: '<math><mi>v</mi></math>', source: 'mathml' } },
            { text: ' 链接', marks: [{ type: 'externalLink', href: 'https://example.org/ir' }] },
          ] },
          { kind: 'termEntry', id: 'ir-term', term: [{ text: '术语' }], definition: [{ kind: 'paragraph', id: 'ir-term-definition', content: [{ text: '定义' }] }], source: [{ text: 'ISO vocabulary' }], notes: [], examples: [], languageSets: [{
            id: 'ir-langset', language: 'zh-Hans', groups: [{ id: 'ir-tig', terms: [{
              id: 'ir-variant', content: [{ text: '标准术语' }], descriptors: [{ id: 'ir-descriptor', kind: 'subjectField', value: [{ text: '标准化' }] }],
            }] }],
          }] },
          { kind: 'formula', id: 'ir-formula', latex: 'v=1', mathml: '<math><mi>v</mi><mo>=</mo><mn>1</mn></math>', numbered: true, whereList: [
            { id: 'ir-where', term: [{ text: 'v' }], definition: [{ text: '变量' }] },
          ], notes: [{ id: 'ir-formula-note', content: [{ text: '公式注' }] }] },
          { kind: 'table', id: 'ir-table', caption: [{ text: '属性表' }], orientation: 'portrait', headerRowCount: 1, unit: 'mm', width: { value: 80, unit: 'mm' }, style: { layout: 'fixed', borderWidth: { value: 0.5, unit: 'pt' } }, notes: [], rows: [{
            id: 'ir-row', style: { height: { value: 8, unit: 'mm' } }, cells: [{
              id: 'ir-cell', colspan: 1, rowspan: 1, header: true, cellType: 'columnHeader', unit: 'mm', width: { value: 30, unit: 'mm' },
              columnWidths: [113], style: { textAlign: 'center', paddingLeft: { value: 2, unit: 'mm' } }, content: [{ kind: 'paragraph', id: 'ir-cell-paragraph', content: [{ text: '字段' }] }],
            }],
          }] },
          { kind: 'figure', id: 'ir-figure', caption: [{ text: '图题' }], orientation: 'portrait', src: 'data:image/svg+xml;base64,PHN2Zy8+', resourceId: 'ir-resource', imageWidth: { value: 10, unit: 'mm' }, alt: '示意图', title: '资源', unit: 'mm', notes: [], descriptions: [{ id: 'ir-figure-desc', content: [{ text: '图说明' }] }], groups: [{ id: 'ir-figure-group', descriptions: [{ id: 'ir-group-desc', content: [{ text: '组合说明' }] }], resourceRefs: ['ir-resource'] }] },
          { kind: 'warning', id: 'ir-warning', content: [{ kind: 'paragraph', id: 'ir-warning-p', content: [{ text: '警告文本' }] }] },
          { kind: 'quote', id: 'ir-quote', content: [{ kind: 'paragraph', id: 'ir-quote-p', content: [{ text: '引文文本' }] }] },
          { kind: 'code', id: 'ir-code', language: 'text', text: 'code = 1' },
        ],
      }] }],
      appendices: [],
      bibliography: [{ kind: 'bibEntry', id: 'ir-bib', content: [{ text: '旧文献文本' }], entryType: 'standard', fields: [
        { id: 'ir-bib-title', name: 'title', value: [{ text: '新建文献' }] },
      ], identifiers: [{ id: 'ir-bib-id', scheme: 'DOI', value: '10.1000/example' }] }],
      resources: [{ id: 'ir-resource', mediaType: 'image/svg+xml', name: 'ir.svg', encoding: 'base64', data: 'PHN2Zy8+' }],
      index: { id: 'ir-index', title: [{ text: '索引' }], groups: [{ id: 'ir-index-group', label: [{ text: '主题' }], entries: [{
        id: 'ir-index-entry', term: [{ text: '语义模型' }], targets: ['ir-clause'], seeAlso: ['ir-bib'],
      }] }] },
    }
    const output = irToPm(authored)
    expect(output.type).toBe('doc')
    const root = schema.nodeFromJSON(output)
    root.check()
    const json = root.toJSON() as PMJsonNode
    for (const [type, id] of [
      ['titlePart', 'ir-title'], ['standardIdentifier', 'ir-identifier'], ['tbxLangSet', 'ir-langset'],
      ['formulaInline', 'ir-inline-formula'], ['formulaNote', 'ir-formula-note'], ['figureResource', 'ir-resource'],
      ['warning', 'ir-warning'], ['quoteBlock', 'ir-quote'], ['codeBlock', 'ir-code'], ['bibField', 'ir-bib-title'],
      ['indexEntry', 'ir-index-entry'],
    ]) expect(typedNode(json, type, id), `${type} ${id}`).toBeDefined()
    expect(typedNode(json, 'figureImage')?.attrs).toMatchObject({ width: 10, widthUnit: 'mm', title: '资源' })
    expect(typedNode(json, 'termDefinition')?.attrs?.nodeId).toBe('ir-term-definition')
    expect(typedNode(json, 'termSource')?.content?.map(node => node.text).join('')).toBe('ISO vocabulary')
    expect(JSON.stringify(json)).toContain('code = 1')
    expect(JSON.stringify(json)).toContain('PHN2Zy8+')

    const standardSchema = getSchema([...extensions, StandardDoc])
    const standardRoot = standardSchema.nodeFromJSON(irToPm(authored, { rootType: 'standardDoc' }))
    standardRoot.check()
    expect(standardRoot.type.name).toBe('standardDoc')
    expect(standardRoot.lastChild?.type.name).toBe('figureResource')
  })
})
