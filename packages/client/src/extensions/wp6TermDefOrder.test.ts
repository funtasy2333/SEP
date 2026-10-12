import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { IRToPmError, getOutputSupportProblems, irToPm, pmToIr, remapExternalIds, renderJson, resolve, type IRDoc, type IRTermEntry, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { createWp6Fixture } from './__fixtures__/wp6'
import { exportSemanticJson } from '../serializer/jsonExporter'

const schema = getSchema(createEditorExtensions())

function pm(type: string, attrs?: Record<string, unknown>, content?: PMJsonNode[]): PMJsonNode {
  return { type, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) }
}

function text(value: string, bibliographyId?: string): PMJsonNode {
  return {
    type: 'text',
    text: value,
    ...(bibliographyId ? { marks: [{ type: 'bibRef', attrs: { targetId: bibliographyId } }] } : {}),
  }
}

function findNode<T extends { type: string; attrs?: Record<string, unknown>; content?: T[] }>(root: T, type: string, nodeId: string): T {
  if (root.type === type && root.attrs?.nodeId === nodeId) return root
  for (const child of root.content ?? []) {
    try { return findNode(child, type, nodeId) } catch { /* continue */ }
  }
  throw new Error(`Missing ${type} node ${nodeId}`)
}

function languageSet(
  nodeId: string,
  language: string,
  variantId: string,
  descriptorId: string,
  variantBibId: string,
  descriptorBibId: string,
): PMJsonNode {
  return pm('tbxLangSet', { nodeId, lang: language }, [
    pm('tbxTig', { nodeId: `${nodeId}-tig` }, [
      pm('tbxTermVariant', { nodeId: variantId }, [
        pm('tbxTerm', undefined, [text(`词项-${variantId}`, variantBibId)]),
        pm('tbxTermDescriptor', { nodeId: descriptorId, type: 'subjectField' }, [text(`描述-${descriptorId}`, descriptorBibId)]),
      ]),
    ]),
  ])
}

function nestedTerm(nodeId: string, name: string, definitionBib: string, children: PMJsonNode[] = []): PMJsonNode {
  return pm('termDef', { nodeId, level: 2 }, [
    pm('termName', undefined, [text(name)]),
    pm('termDefinition', { nodeId: `${nodeId}-definition` }, [text(`定义-${name}`, definitionBib)]),
    ...children,
  ])
}

function bibliographyIds(root: PMJsonNode, ids: string[]): void {
  const bibliography = findNode(root, 'bibliography', 'bibliography-main')
  const title = bibliography.content?.find(child => child.type === 'bibliographyTitle')
  const originalFirstEntry = bibliography.content?.find(child => child.type === 'bibEntry' && child.attrs?.nodeId === 'bib-entry')
  bibliography.content = [
    ...(title ? [title] : []),
    ...(originalFirstEntry ? [originalFirstEntry] : []),
    ...ids.map(id => pm('bibEntry', { nodeId: id, entryType: 'standard' }, [text(`文献-${id}`)])),
  ]
}

function tailNodes(term: PMJsonNode): Array<[string, unknown]> {
  return (term.content ?? [])
    .filter(child => !['termName', 'termNameEn', 'termDefinition'].includes(child.type))
    .map(child => [child.type, child.attrs?.nodeId ?? child.content?.map(content => content.text ?? '').join('')])
}

describe('WP6 termDef production-schema ordered tail round trip', () => {
  it('preserves lang→nested→lang and recursive nested order, TBX descriptor refs, and first-reference order', () => {
    const source = createWp6Fixture()
    const term = findNode(source, 'termDef', 'term-main')
    const name = term.content?.find(child => child.type === 'termName')!
    const english = term.content?.find(child => child.type === 'termNameEn')!
    const definition = term.content?.find(child => child.type === 'termDefinition')!
    const nestedGrandchild = nestedTerm('term-grandchild', '孙术语', 'bib-grandchild')
    const nestedChild = nestedTerm('term-child', '子术语', 'bib-child', [nestedGrandchild])
    const nestedLanguage = languageSet('lang-nested', 'en', 'variant-nested', 'descriptor-nested', 'bib-nested-language', 'bib-nested-descriptor')
    const nested = nestedTerm('term-nested', '嵌套术语', 'bib-nested-definition', [nestedLanguage, nestedChild])
    const langBefore = languageSet('lang-before', 'zh-Hans', 'variant-before', 'descriptor-before', 'bib-before', 'bib-before-descriptor')
    const langAfter = languageSet('lang-after', 'fr', 'variant-after', 'descriptor-after', 'bib-after', 'bib-after-descriptor')
    const continuation = pm('stdParagraph', { nodeId: 'term-continuation' }, [text('补充定义')])
    const note = pm('note', { nodeId: 'term-note' }, [text('术语注')])
    const example = pm('example', { nodeId: 'term-example' }, [text('术语示例')])
    const sourceField = pm('termSource', undefined, [text('术语来源')])
    term.content = [name, english, definition, langBefore, continuation, note, example, sourceField, nested, langAfter]
    bibliographyIds(source, [
      'bib-before', 'bib-before-descriptor', 'bib-nested-definition', 'bib-nested-language', 'bib-nested-descriptor',
      'bib-child', 'bib-grandchild', 'bib-after', 'bib-after-descriptor',
    ])

    const sourceNode = schema.nodeFromJSON(source)
    sourceNode.check()
    const savedJson = JSON.parse(JSON.stringify(sourceNode.toJSON())) as PMJsonNode
    const sourceBefore = JSON.stringify(savedJson)
    const savedTerm = findNode(savedJson, 'termDef', 'term-main')
    const imported = pmToIr(savedJson).doc
    const importedBefore = JSON.stringify(imported)
    const importedTerm = imported.body[0]!.children
      .flatMap(child => child.kind === 'clause' ? child.children : [child])
      .find(child => child.kind === 'termEntry') as IRTermEntry

    const importedResolution = resolve(imported)
    expect(importedResolution.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(importedResolution.bibliographyOrder).toEqual([
      'bib-entry',
      'bib-before', 'bib-before-descriptor', 'bib-nested-definition', 'bib-nested-language', 'bib-nested-descriptor',
      'bib-child', 'bib-grandchild', 'bib-after', 'bib-after-descriptor',
    ])
    expect(importedResolution.bibliographyOrder.map(id => [id, importedResolution.labels[id]?.label]))
      .toEqual(importedResolution.bibliographyOrder.map((id, index) => [id, `[${index + 1}]`]))
    expect(importedTerm.tailOrder).toEqual([
      { kind: 'languageSet', index: 0 }, { kind: 'definition', index: 0 },
      { kind: 'note', index: 0 }, { kind: 'example', index: 0 }, { kind: 'source', index: 0 },
      { kind: 'nestedEntry', index: 0 }, { kind: 'languageSet', index: 1 },
    ])
    const remapped = remapExternalIds(imported, 'term-order-test')
    expect(remapped.problems).toEqual([])
    const remappedResolution = resolve(remapped.doc)
    expect(remappedResolution.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(remappedResolution.bibliographyOrder).toEqual(importedResolution.bibliographyOrder.map(id => remapped.idMap[id]))
    expect(remapped.doc.body[0]!.children
      .flatMap(child => child.kind === 'clause' ? child.children : [child])
      .find(child => child.kind === 'termEntry' && child.id === remapped.idMap['term-main']))
      .toMatchObject({ tailOrder: importedTerm.tailOrder })

    const projected = irToPm(imported)
    const projectedNode = schema.nodeFromJSON(projected)
    projectedNode.check()
    const coldReopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(projectedNode.toJSON())) as PMJsonNode)
    coldReopened.check()
    const reopenedJson = coldReopened.toJSON() as PMJsonNode
    const reopenedTerm = findNode(reopenedJson, 'termDef', 'term-main')

    expect(tailNodes(reopenedTerm)).toEqual(tailNodes(savedTerm))
    expect(tailNodes(reopenedTerm)).toEqual([
      ['tbxLangSet', 'lang-before'], ['stdParagraph', 'term-continuation'], ['note', 'term-note'],
      ['example', 'term-example'], ['termSource', '术语来源'], ['termDef', 'term-nested'], ['tbxLangSet', 'lang-after'],
    ])
    expect(tailNodes(findNode(reopenedJson, 'termDef', 'term-nested'))).toEqual([
      ['tbxLangSet', 'lang-nested'], ['termDef', 'term-child'],
    ])
    expect(JSON.stringify(savedJson)).toBe(sourceBefore)
    expect(JSON.stringify(imported)).toBe(importedBefore)
    expect(importedTerm.languageSets?.map(set => set.groups[0]?.terms[0]?.descriptors[0]?.id))
      .toEqual(['descriptor-before', 'descriptor-after'])
    expect(pmToIr(reopenedJson).doc.body[0]!.children
      .flatMap(child => child.kind === 'clause' ? child.children : [child])
      .find(child => child.kind === 'termEntry' && child.id === 'term-main'))
      .toMatchObject({ tailOrder: importedTerm.tailOrder })
    const reopenedResolution = resolve(pmToIr(reopenedJson).doc)
    expect(reopenedResolution.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(reopenedResolution.bibliographyOrder).toEqual([
      'bib-entry',
      'bib-before', 'bib-before-descriptor', 'bib-nested-definition', 'bib-nested-language', 'bib-nested-descriptor',
      'bib-child', 'bib-grandchild', 'bib-after', 'bib-after-descriptor',
    ])

    const secondProjection = schema.nodeFromJSON(irToPm(pmToIr(reopenedJson).doc))
    secondProjection.check()
    const secondColdReopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(secondProjection.toJSON())) as PMJsonNode)
    secondColdReopened.check()
    expect(tailNodes(findNode(secondColdReopened.toJSON() as PMJsonNode, 'termDef', 'term-main')))
      .toEqual(tailNodes(savedTerm))
    expect(resolve(pmToIr(secondColdReopened.toJSON() as PMJsonNode).doc).bibliographyOrder)
      .toEqual(importedResolution.bibliographyOrder)

    const sharedJson = renderJson(imported, importedResolution.labels)
    const sharedJsonReopened = schema.nodeFromJSON(sharedJson as PMJsonNode)
    sharedJsonReopened.check()
    expect(tailNodes(findNode(sharedJsonReopened.toJSON() as PMJsonNode, 'termDef', 'term-main')))
      .toEqual(tailNodes(savedTerm))

    const clientJson = exportSemanticJson(sourceNode)
    expect(tailNodes(findNode(clientJson, 'termDef', 'term-main')))
      .toEqual(tailNodes(savedTerm))
    expect(findNode(clientJson, 'termDef', 'term-main').number)
      .toBe(importedResolution.labels['term-main']?.label)
    const clientIr = pmToIr(sourceNode.toJSON() as PMJsonNode).doc
    const clientResolution = resolve(clientIr)
    const sourceBibRefs: string[] = []
    const collectBibRefs = (node: PMJsonNode): void => {
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bibRef' && typeof mark.attrs?.targetId === 'string') sourceBibRefs.push(mark.attrs.targetId)
      }
      for (const child of node.content ?? []) collectBibRefs(child)
    }
    collectBibRefs(savedJson)
    expect(sourceBibRefs).toEqual(clientResolution.bibliographyOrder)
    expect(clientResolution.bibliographyOrder).toEqual(importedResolution.bibliographyOrder)
    expect(clientResolution.bibliographyOrder.map(id => [id, clientResolution.labels[id]?.label]))
      .toEqual(clientResolution.bibliographyOrder.map((id, index) => [id, `[${index + 1}]`]))
  })

  it.each([
    {
      name: 'TBX语言集',
      category: 'languageSet' as const,
      makeScope: (): PMJsonNode => languageSet(
        'canonical-lang', 'en', 'canonical-variant', 'canonical-descriptor',
        'bib-canonical-tbx-term', 'bib-canonical-tbx-descriptor',
      ),
      scopeRefs: ['bib-canonical-tbx-term', 'bib-canonical-tbx-descriptor'],
    },
    {
      name: '嵌套术语',
      category: 'nestedEntry' as const,
      makeScope: (): PMJsonNode => nestedTerm('canonical-nested', '嵌套术语', 'bib-canonical-nested'),
      scopeRefs: ['bib-canonical-nested'],
    },
  ])('preserves PM canonical source→note→example order with $name across two reloads', ({ category, makeScope, scopeRefs }) => {
    const source = createWp6Fixture()
    const term = findNode(source, 'termDef', 'term-main')
    const name = term.content?.find(child => child.type === 'termName')!
    const english = term.content?.find(child => child.type === 'termNameEn')!
    const definition = term.content?.find(child => child.type === 'termDefinition')!
    const sourceField = pm('termSource', undefined, [text('术语来源', 'bib-canonical-source')])
    const note = pm('note', { nodeId: 'canonical-note' }, [text('术语注', 'bib-canonical-note')])
    const example = pm('example', { nodeId: 'canonical-example' }, [text('术语示例', 'bib-canonical-example')])
    term.content = [name, english, definition, sourceField, note, example, makeScope()]
    const additionalRefs = [
      'bib-canonical-source', 'bib-canonical-note', 'bib-canonical-example', ...scopeRefs,
    ]
    bibliographyIds(source, additionalRefs)

    const sourceNode = schema.nodeFromJSON(source)
    sourceNode.check()
    const savedJson = JSON.parse(JSON.stringify(sourceNode.toJSON())) as PMJsonNode
    const sourceBefore = JSON.stringify(savedJson)
    const imported = pmToIr(savedJson).doc
    const importedBefore = JSON.stringify(imported)
    const importedTerm = imported.body[0]!.children
      .flatMap(child => child.kind === 'clause' ? child.children : [child])
      .find(child => child.kind === 'termEntry') as IRTermEntry
    const expectedTail: NonNullable<IRTermEntry['tailOrder']> = [
      { kind: 'source', index: 0 },
      { kind: 'note', index: 0 },
      { kind: 'example', index: 0 },
      { kind: category, index: 0 },
    ]
    const expectedOrder = ['bib-entry', ...additionalRefs]
    const importedResolution = resolve(imported)

    expect(importedResolution.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(importedResolution.bibliographyOrder).toEqual(expectedOrder)
    expect(importedResolution.bibliographyOrder.map(id => [id, importedResolution.labels[id]?.label]))
      .toEqual(expectedOrder.map((id, index) => [id, '[' + (index + 1) + ']']))
    expect(importedTerm.tailOrder).toEqual(expectedTail)

    const firstProjection = schema.nodeFromJSON(irToPm(imported))
    firstProjection.check()
    const firstReopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(firstProjection.toJSON())) as PMJsonNode)
    firstReopened.check()
    const firstJson = firstReopened.toJSON() as PMJsonNode
    expect(tailNodes(findNode(firstJson, 'termDef', 'term-main')))
      .toEqual(tailNodes(findNode(savedJson, 'termDef', 'term-main')))
    const firstReimport = pmToIr(firstJson).doc
    const firstReimportTerm = firstReimport.body[0]!.children
      .flatMap(child => child.kind === 'clause' ? child.children : [child])
      .find(child => child.kind === 'termEntry') as IRTermEntry
    expect(firstReimportTerm.tailOrder).toEqual(expectedTail)
    expect(resolve(firstReimport).bibliographyOrder).toEqual(expectedOrder)

    const secondProjection = schema.nodeFromJSON(irToPm(firstReimport))
    secondProjection.check()
    const secondReopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(secondProjection.toJSON())) as PMJsonNode)
    secondReopened.check()
    const secondJson = secondReopened.toJSON() as PMJsonNode
    expect(tailNodes(findNode(secondJson, 'termDef', 'term-main')))
      .toEqual(tailNodes(findNode(savedJson, 'termDef', 'term-main')))
    const secondReimport = pmToIr(secondJson).doc
    const secondReimportTerm = secondReimport.body[0]!.children
      .flatMap(child => child.kind === 'clause' ? child.children : [child])
      .find(child => child.kind === 'termEntry') as IRTermEntry
    expect(secondReimportTerm.tailOrder).toEqual(expectedTail)
    expect(resolve(secondReimport).bibliographyOrder).toEqual(expectedOrder)

    const sharedJson = schema.nodeFromJSON(renderJson(imported, importedResolution.labels) as PMJsonNode)
    sharedJson.check()
    expect(tailNodes(findNode(sharedJson.toJSON() as PMJsonNode, 'termDef', 'term-main')))
      .toEqual(tailNodes(findNode(savedJson, 'termDef', 'term-main')))

    const clientJson = exportSemanticJson(sourceNode)
    expect(tailNodes(findNode(clientJson, 'termDef', 'term-main')))
      .toEqual(tailNodes(findNode(savedJson, 'termDef', 'term-main')))
    const clientResolution = resolve(pmToIr(sourceNode.toJSON() as PMJsonNode).doc)
    expect(clientResolution.bibliographyOrder).toEqual(expectedOrder)
    expect(clientResolution.bibliographyOrder.map(id => [id, clientResolution.labels[id]?.label]))
      .toEqual(expectedOrder.map((id, index) => [id, '[' + (index + 1) + ']']))

    expect(JSON.stringify(savedJson)).toBe(sourceBefore)
    expect(JSON.stringify(imported)).toBe(importedBefore)
  })

  it.each([
    {
      name: 'lang→nested',
      first: 'languageSet' as const,
      expectedRefs: ['bib-pair-language', 'bib-pair-descriptor', 'bib-pair-nested'],
    },
    {
      name: 'nested→lang',
      first: 'nestedEntry' as const,
      expectedRefs: ['bib-pair-nested', 'bib-pair-language', 'bib-pair-descriptor'],
    },
  ])('preserves the production-schema $name pair in the Resolver and PM projection', ({ first, expectedRefs }) => {
    const source = createWp6Fixture()
    const term = findNode(source, 'termDef', 'term-main')
    const name = term.content?.find(child => child.type === 'termName')!
    const english = term.content?.find(child => child.type === 'termNameEn')!
    const definition = term.content?.find(child => child.type === 'termDefinition')!
    const lang = languageSet('lang-pair', 'de', 'variant-pair', 'descriptor-pair', 'bib-pair-language', 'bib-pair-descriptor')
    const nested = nestedTerm('term-pair', '配对术语', 'bib-pair-nested')
    term.content = [name, english, definition, ...(first === 'languageSet' ? [lang, nested] : [nested, lang])]
    bibliographyIds(source, ['bib-pair-language', 'bib-pair-descriptor', 'bib-pair-nested'])

    const sourceNode = schema.nodeFromJSON(source)
    sourceNode.check()
    const sourceJson = sourceNode.toJSON() as PMJsonNode
    const imported = pmToIr(sourceJson).doc
    const resolution = resolve(imported)
    expect(resolution.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(resolution.bibliographyOrder).toEqual(['bib-entry', ...expectedRefs])

    const projectedNode = schema.nodeFromJSON(irToPm(imported))
    projectedNode.check()
    const projected = projectedNode.toJSON() as PMJsonNode
    expect(tailNodes(findNode(projected, 'termDef', 'term-main'))).toEqual(tailNodes(findNode(sourceJson, 'termDef', 'term-main')))
    expect(resolve(pmToIr(projected).doc).bibliographyOrder).toEqual(resolution.bibliographyOrder)
  })

  it('rejects plain native tailOrder and sparse category/index sequences with precise diagnostics', () => {
    const note = { kind: 'note' as const, id: 'plain-note', content: [{ kind: 'paragraph' as const, id: 'plain-note.p0', content: [{ text: '注' }] }] }
    const example = { kind: 'example' as const, id: 'plain-example', content: [{ kind: 'paragraph' as const, id: 'plain-example.p0', content: [{ text: '例' }] }] }
    const plainEntry: IRTermEntry = {
      kind: 'termEntry', id: 'plain-term', term: [{ text: '普通术语' }],
      definition: [{ kind: 'paragraph', id: 'plain-def', content: [{ text: '定义' }] }],
      source: [{ text: '来源' }], notes: [note], examples: [example],
      tailOrder: [
        { kind: 'note', index: 0 }, { kind: 'source', index: 0 }, { kind: 'example', index: 0 },
      ],
    }
    const sparseEntry: IRTermEntry = {
      kind: 'termEntry', id: 'sparse-term', term: [{ text: '稀疏顺序术语' }],
      definition: [{ kind: 'paragraph', id: 'sparse-def', content: [{ text: '定义' }] }],
      notes: [], examples: [],
      nestedEntries: [{
        kind: 'termEntry', id: 'sparse-nested', term: [{ text: '子术语' }],
        definition: [{ kind: 'paragraph', id: 'sparse-nested-def', content: [] }], notes: [], examples: [],
      }],
      tailOrder: new Array(1) as NonNullable<IRTermEntry['tailOrder']>,
    }
    const doc: IRDoc = {
      schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'term-chapter', secType: 'terms', title: [], children: [plainEntry, sparseEntry] }],
      appendices: [], bibliography: [],
    }

    let caught: unknown
    try { irToPm(doc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    expect((caught as IRToPmError).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'body[0][0].tailOrder', reason: expect.stringContaining('仅适用于') }),
      expect.objectContaining({ path: 'body[0][1].tailOrder', reason: expect.stringContaining('有效的 kind 与非负整数 index') }),
    ]))
    expect(resolve(doc).problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsupported-content', nodeId: 'plain-term', severity: 'error' }),
      expect.objectContaining({ code: 'unsupported-content', nodeId: 'sparse-term', severity: 'error' }),
    ]))
    for (const format of ['DOCX', 'HTML', 'XML'] as const) {
      expect(getOutputSupportProblems(doc, format)).toContainEqual(expect.objectContaining({
        nodeId: 'plain-term', path: 'doc.body[0].children[0].tailOrder',
      }))
      expect(getOutputSupportProblems(doc, format)).toContainEqual(expect.objectContaining({
        nodeId: 'sparse-term', path: 'doc.body[0].children[1].tailOrder',
      }))
    }
  })
})
