import { describe, expect, it } from 'vitest'
import { buildContentIndex } from './contentIndex'
import { resolve } from '../ir/resolve'
import type { IRAppendix, IRDoc, IRInline } from '../ir/types'

const text = (value: string, marks?: IRInline['marks']): IRInline => marks ? { text: value, marks } : { text: value }
const paragraph = (id: string, content: IRInline[]) => ({ kind: 'paragraph' as const, id, content })
const doc: IRDoc = {
  schemaVersion: 1,
  meta: { standardType: 'gb' },
  front: { foreword: [paragraph('front-p', [text('前言提及表1')])], introduction: [] },
  body: [
    { kind: 'chapter', id: 'norms', secType: 'norm-refs', title: [text('规范性引用文件')], children: [paragraph('norm-p', [text('GB/T 1—2020 文件名称')])] },
    { kind: 'chapter', id: 'terms', secType: 'terms', title: [text('术语和定义')], children: [
      { kind: 'termEntry', id: 'term-1', term: [text('标准')], definition: [paragraph('term-def', [text('定义')])], notes: [], examples: [] },
    ] },
    { kind: 'chapter', id: 'body', secType: 'general', title: [text('正文')], children: [
      paragraph('body-p', [text('参见'), text('表', [{ type: 'bold' }]), text('1', [{ type: 'italic' }, { type: 'crossRef', targetId: 'table-1', targetKind: 'table' }]), text('。')]),
      { kind: 'table', id: 'table-1', caption: [text('表1 自身题注')], orientation: 'portrait', headerRowCount: 0, rows: [], notes: [], footnotes: [{ id: 'table-fn', content: [text('表脚注文本')] }] },
      { kind: 'figure', id: 'fig-1', caption: [text('图1 自身题注')], orientation: 'portrait', src: 'resource', notes: [{ kind: 'note', id: 'fig-note', content: [paragraph('fig-note-p', [text('图注内容')])] }] },
      paragraph('uses', [text('标准'), { text: '标', footnote: { id: 'fn-1', content: [text('脚注内容')] } }, text('准')]),
    ] },
  ],
  appendices: [{ kind: 'appendix', id: 'app-a', normative: false, title: [text('附录内容')], children: [paragraph('app-p', [text('附录正文')])] }],
  bibliography: [{ kind: 'bibEntry', id: 'bib-1', content: [text('参考文献内容')] }],
}

describe('buildContentIndex', () => {
  it('preserves region, role, path, and stable text for body, terms, references, appendices, captions, notes, and footnotes', () => {
    const index = buildContentIndex(doc, resolve(doc))
    const byId = (nodeId: string, role?: string) => index.texts.find(item => item.nodeId === nodeId && (!role || item.role === role))
    expect(byId('norm-p')).toMatchObject({ area: 'normativeReferences', role: 'paragraph' })
    expect(byId('term-1', 'termName')).toMatchObject({ area: 'terms', text: '标准' })
    expect(byId('term-def')).toMatchObject({ area: 'terms', role: 'termDefinition' })
    expect(byId('body-p')).toMatchObject({ area: 'body', text: '参见表1。' })
    expect(byId('table-1', 'caption')).toMatchObject({ text: '表1 自身题注' })
    expect(byId('fig-note-p')).toMatchObject({ area: 'note', role: 'note' })
    expect(byId('table-fn')).toMatchObject({ area: 'tableFootnote', role: 'tableFootnote' })
    expect(byId('fn-1')).toMatchObject({ area: 'footnote', role: 'footnote', text: '脚注内容' })
    expect(byId('app-p')).toMatchObject({ area: 'appendix', role: 'paragraph' })
    expect(byId('bib-1')).toMatchObject({ area: 'bibliography' })
  })

  it('joins inline styles, indexes references once, and deduplicates text with a structured target', () => {
    const index = buildContentIndex(doc, resolve(doc))
    expect(index.texts.find(item => item.nodeId === 'body-p')?.text).toBe('参见表1。')
    expect(index.references.filter(ref => ref.nodeId === 'body-p')).toEqual([
      expect.objectContaining({ targetId: 'table-1', kind: 'crossRef', from: 3, to: 4 }),
    ])
    expect(index.mentions.filter(mention => mention.nodeId === 'body-p' && mention.targetId === 'table-1')).toHaveLength(1)
    expect(index.mentions.find(mention => mention.nodeId === 'body-p' && mention.targetId === 'table-1')?.source).toBe('structured')
  })

  it('resolves explicit enumerations and ranges only to existing Resolver labels', () => {
    const tables = Array.from({ length: 3 }, (_, i) => ({
      kind: 'table' as const, id: `range-table-${i + 1}`, caption: [text(`表${i + 1}`)], orientation: 'portrait' as const, headerRowCount: 0, rows: [], notes: [],
    }))
    const figures = Array.from({ length: 10 }, (_, i) => ({
      kind: 'figure' as const, id: `range-figure-${i + 1}`, caption: [text(`图${i + 1}`)], orientation: 'portrait' as const, src: 'resource', notes: [],
    }))
    const rangeDoc: IRDoc = {
      ...doc,
      front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'range-body', secType: 'general', title: [text('正文')], children: [
        paragraph('range-table-refs', [text('见表1～表3。')]),
        ...tables,
        paragraph('figure-enum-refs', [text('见图1和图10。')]),
        ...figures,
      ] }],
      appendices: [],
      bibliography: [],
    }
    const index = buildContentIndex(rangeDoc, resolve(rangeDoc))
    expect(index.mentions.filter(mention => mention.nodeId === 'range-table-refs').map(mention => mention.targetId).sort()).toEqual([
      'range-table-1', 'range-table-2', 'range-table-3',
    ])
    expect(index.mentions.filter(mention => mention.nodeId === 'figure-enum-refs').map(mention => mention.targetId).sort()).toEqual([
      'range-figure-1', 'range-figure-10',
    ])
  })

  it('does not confuse table A.1 with A.10 and retains self-table ownership', () => {
    const appendixTables = Array.from({ length: 10 }, (_, i) => ({
      kind: 'table' as const, id: `app-table-${i + 1}`, caption: [text(`表${i + 1}`)], orientation: 'portrait' as const, headerRowCount: 0, rows: [], notes: [],
    }))
    const appendix: IRAppendix = {
      kind: 'appendix', id: 'appendix-a', normative: false, title: [text('附录A')], children: [
        paragraph('appendix-labels', [text('见表A.1和表A.10。')]),
        ...appendixTables,
      ],
    }
    const localDoc: IRDoc = {
      ...doc,
      front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'only-body', secType: 'general', title: [text('正文')], children: [
        { kind: 'table', id: 'self-table', caption: [text('自身表格')], orientation: 'portrait', headerRowCount: 1, rows: [{ id: 'row', cells: [{
          id: 'cell', colspan: 1, rowspan: 1, header: false, content: [paragraph('self-cell-p', [text('见表1。')])],
        }] }], notes: [] },
      ] }],
      appendices: [appendix],
      bibliography: [],
    }
    const index = buildContentIndex(localDoc, resolve(localDoc))
    expect(index.mentions.filter(mention => mention.nodeId === 'appendix-labels').map(mention => mention.targetId).sort()).toEqual(['app-table-1', 'app-table-10'])
    expect(index.mentions.find(mention => mention.nodeId === 'self-cell-p')).toMatchObject({ targetId: 'self-table', containerId: 'self-table' })
  })

  it('coalesces adjacent styled term references and counts an ID-only term target once', () => {
    const referenceDoc: IRDoc = {
      ...doc,
      front: { foreword: [], introduction: [] },
      body: [
        { kind: 'chapter', id: 'term-chapter', secType: 'terms', title: [text('术语和定义')], children: [
          { kind: 'termEntry', id: 'term-target', term: [text('系统')], definition: [], notes: [], examples: [] },
          { kind: 'termEntry', id: 'id-only-target', term: [text('接口')], definition: [], notes: [], examples: [] },
        ] },
        { kind: 'chapter', id: 'body-only', secType: 'general', title: [text('正文')], children: [
          paragraph('split-ref', [
            text('系', [{ type: 'termRef', targetId: 'term-target' }]),
            text('统', [{ type: 'bold' }, { type: 'termRef', targetId: 'term-target' }]),
            text('', [{ type: 'termRef', targetId: 'id-only-target' }]),
          ]),
        ] },
      ],
      appendices: [],
      bibliography: [],
    }
    const index = buildContentIndex(referenceDoc, resolve(referenceDoc))
    expect(index.references.filter(reference => reference.kind === 'termRef')).toHaveLength(3)
    expect(index.mentions.filter(mention => mention.kind === 'term' && mention.nodeId === 'split-ref')).toHaveLength(2)
    expect(index.mentions.find(mention => mention.targetId === 'id-only-target')).toMatchObject({ text: '', from: 2, to: 2 })
  })
})
