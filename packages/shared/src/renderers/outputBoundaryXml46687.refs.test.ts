import { describe, expect, it } from 'vitest'
import type { IRBibEntry, IRDoc, IRIndex, IRNormRefList } from '../ir/types'
import { getOutputSupportProblems } from './outputBoundary'
import { findDeclaredDifference, type Xml46687DeclaredDifference } from './xml46687Boundary'
import { XML46687_REFS_BOUNDARY } from './xml46687Parts/refs'
import {
  asXml, describeDeclared, expectDeclaredDifferences, expectReleased, pathsOf,
} from './__tests__/xml46687BoundaryKit'

/**
 * XML46687 输出边界：规范性引用、参考文献、索引域（T2.4c，WP8.2 设计 §1.3.2～§1.3.4）的“逐项正例”。
 * 核心断言（差集恰等于声明集合、永久阻断项）在 `outputBoundaryXml46687.test.ts`；本文件持有 `refs.ts` 登记的声明项：
 * `doc.bibliographyTitle`、`doc.index`（含分组/条目 shape）、`normRefList`（kind）、`bibEntry` 的类型化字段（含字段/标识符/外链 shape）。
 */

const para = (id: string, text: string) => ({ kind: 'paragraph' as const, id, content: [{ text }] })

/** 范围章 + 规范性引用文件章（引导语）的最小文档（没有任何 T2.4c 放行项）。 */
function base(): IRDoc {
  return {
    schemaVersion: 1, meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [
      { kind: 'chapter', id: 'chapter', secType: 'scope', title: [{ text: '范围' }], children: [para('p1', '正文')] },
      { kind: 'chapter', id: 'chapter-refs', secType: 'norm-refs', title: [{ text: '规范性引用文件' }], children: [para('p2', '引导语')] },
    ],
    appendices: [], bibliography: [],
  }
}

const bibEntry = (extra: Partial<IRBibEntry> = {}): IRBibEntry => ({ kind: 'bibEntry', id: 'bib1', content: [{ text: '文献' }], ...extra })
const list: IRNormRefList = {
  kind: 'normRefList', id: 'nrl',
  entries: [
    { kind: 'normRef', id: 'nr1', entryType: 'std', ref: [{ text: 'GB/T 1' }], title: [{ text: '名称', marks: [{ type: 'bold' }] }] },
    { kind: 'normRef', id: 'nr2', entryType: 'mixed', content: [{ text: '非标准化文件' }] },
  ],
}
const index: IRIndex = {
  id: 'idx', title: [{ text: '索引' }],
  groups: [{ id: 'g1', label: [{ text: 'A' }], entries: [{ id: 'e1', term: [{ text: '词' }], targets: ['p1'], seeAlso: [] }] }],
}

type Install = (doc: IRDoc) => void
const INSTALLERS: Record<string, Install> = {
  'field:bibliographyTitle': doc => { doc.bibliographyTitle = [{ text: '参考书目' }] },
  'kind:normRefList': doc => { doc.body[1]!.children.push(list) },
  'field:index': doc => { doc.index = structuredClone(index) },
  'field:entryType': doc => { doc.bibliography.push(bibEntry({ entryType: 'standard' })) },
  'field:fields': doc => { doc.bibliography.push(bibEntry({ fields: [{ id: 'f1', name: 'title', value: [{ text: '名称', marks: [{ type: 'italic' }] }] }] })) },
  'field:identifiers': doc => { doc.bibliography.push(bibEntry({ identifiers: [{ id: 'i1', scheme: 'DOI', value: '10.1/x' }] })) },
  'field:externalLink': doc => {
    doc.bibliography.push(bibEntry({ externalLink: { href: 'https://example.org/', title: '提示', target: '_blank', rel: 'noopener', displayText: '在线' } }))
  },
}
/** 各声明项在最小文档里触发的（旧 XML 的）问题路径。 */
const PATHS: Record<string, string> = {
  'field:bibliographyTitle': 'doc.bibliographyTitle',
  'kind:normRefList': 'doc.body[1].children[1].kind',
  'field:index': 'doc.index',
  'field:entryType': 'doc.bibliography[0].entryType',
  'field:fields': 'doc.bibliography[0].fields',
  'field:identifiers': 'doc.bibliography[0].identifiers',
  'field:externalLink': 'doc.bibliography[0].externalLink',
}

const OWN: readonly Xml46687DeclaredDifference[] = XML46687_REFS_BOUNDARY.declared
const keyOf = (declared: Xml46687DeclaredDifference): string => `${declared.kind}:${declared.name}`
const installed = (declared: Xml46687DeclaredDifference): IRDoc => {
  const doc = base()
  INSTALLERS[keyOf(declared)]!(doc)
  return doc
}

describe('[M-4.5.3-02] [M-4.4.2.3-02] [M-4.5.4-01] refs.ts 的声明项：均为 T2.4c，登记完整', () => {
  it('参考文献/索引域的每个声明项都有安装器，也没有多余的安装器', () => {
    expect(OWN.length).toBe(7)
    expect(OWN.every(declared => declared.task === 'T2.4c')).toBe(true)
    expect(OWN.map(keyOf).sort()).toEqual(Object.keys(INSTALLERS).sort())
    expect(Object.keys(PATHS).sort()).toEqual(Object.keys(INSTALLERS).sort())
  })

  it('这些声明项出现在汇总常量 XML46687_DECLARED_DIFFERENCES 里，并能按问题路径找回', () => {
    for (const declared of OWN) expect(findDeclaredDifference(installed(declared), PATHS[keyOf(declared)]!), describeDeclared(declared)).toBe(declared)
  })
})

describe('逐项正例：最小文档里旧 XML 阻断，XML46687 放行', () => {
  it.each(OWN.map(declared => [describeDeclared(declared), declared] as const))('[M-4.5.3-02] [M-4.4.2.3-02] [M-4.4.2.3-03] [M-4.4.2.3-04] [M-4.5.3-05] [M-4.5.3-08] [M-4.5.3.1-03] [M-4.5.3.3-02] [M-4.5.4-01] %s', (_title, declared) => {
    const doc = installed(declared)
    expectReleased(doc, declared)
    expectDeclaredDifferences(doc, [declared])
    expect(pathsOf(getOutputSupportProblems(doc, 'XML'))).toEqual([PATHS[keyOf(declared)]])
  })

  it('七个声明项同在一份文档里：差集恰为这七项，XML46687 一条都不阻断', () => {
    const doc = base()
    for (const declared of OWN) INSTALLERS[keyOf(declared)]!(doc)
    // 四个文献声明项各装了一个同 id 的条目；边界不查 id 唯一，这里换成互不相同的 id 以免混淆
    doc.bibliography = [
      bibEntry({ id: 'b-a', entryType: 'standard' }),
      bibEntry({ id: 'b-b', fields: [{ id: 'f1', name: 'title', value: [{ text: '名称' }] }] }),
      bibEntry({ id: 'b-c', identifiers: [{ id: 'i1', scheme: 'DOI', value: '10.1/x' }] }),
      bibEntry({ id: 'b-d', externalLink: { href: 'https://example.org/' } }),
    ]
    const triggered = expectDeclaredDifferences(doc, OWN)
    expect(triggered.size).toBe(7)
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
  })
})

describe('[M-4.5.4-03] [M-4.5.4-04] [M-4.5.4-05] [M-4.5.4-06] 各层 shape 放行后零问题，且不连带放行未知字段', () => {
  it('索引的三层（索引、分组、条目）放行后 XML46687 零问题；旧 XML 在 doc.index 一处阻断，不下钻', () => {
    const doc = base()
    doc.index = structuredClone(index)
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    expect(pathsOf(getOutputSupportProblems(doc, 'XML'))).toEqual(['doc.index'])
  })

  it.each([
    ['索引', (doc: IRDoc) => doc.index as unknown as Record<string, unknown>, 'doc.index.extra'],
    ['索引分组', (doc: IRDoc) => doc.index!.groups[0] as unknown as Record<string, unknown>, 'doc.index.groups[0].extra'],
    ['索引条目', (doc: IRDoc) => doc.index!.groups[0]!.entries[0] as unknown as Record<string, unknown>, 'doc.index.groups[0].entries[0].extra'],
  ] as const)('%s上的未声明字段仍被 XML46687 阻断，路径精确', (_name, pick, path) => {
    const doc = base()
    doc.index = structuredClone(index)
    pick(doc).extra = '未声明'
    expect(pathsOf(getOutputSupportProblems(doc, 'XML46687'))).toEqual([path])
  })

  it('[M-4.4.2.3-03] normRefList / normRef：条目字段放行后零问题；清单与条目上的未声明字段（label、xmlId）仍被阻断', () => {
    const doc = base()
    doc.body[1]!.children.push(structuredClone(list))
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    const extra = doc.body[1]!.children[1] as unknown as Record<string, unknown>
    extra.label = '附加'
    ;(extra.entries as Array<Record<string, unknown>>)[0]!.xmlId = 'ref_x'
    expect(pathsOf(getOutputSupportProblems(doc, 'XML46687')).sort()).toEqual(['doc.body[1].children[1].entries[0].xmlId', 'doc.body[1].children[1].label'])
  })

  it('[M-4.5.3.1-04] [M-4.5.3-08] 文献字段、标识符、外链放行后零问题；它们上面的未声明字段仍被阻断', () => {
    const doc = base()
    doc.bibliography.push(bibEntry({
      entryType: 'standard',
      fields: [{ id: 'f1', name: 'std-ref', value: [{ text: 'GB/T 1' }] }],
      identifiers: [{ id: 'i1', scheme: 'DOI', value: '10.1/x' }],
      externalLink: { href: 'https://example.org/', displayText: '在线' },
    }))
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    const entry = doc.bibliography[0] as unknown as Record<string, unknown>
    ;(entry.fields as Array<Record<string, unknown>>)[0]!.extra = 'a'
    ;(entry.identifiers as Array<Record<string, unknown>>)[0]!.extra = 'b'
    ;(entry.externalLink as Record<string, unknown>).extra = 'c'
    entry.extra = 'd'
    expect(pathsOf(getOutputSupportProblems(doc, 'XML46687')).sort()).toEqual([
      'doc.bibliography[0].externalLink.extra',
      'doc.bibliography[0].extra',
      'doc.bibliography[0].fields[0].extra',
      'doc.bibliography[0].identifiers[0].extra',
    ])
  })

  it('[M-4.5.3-02] 自定义参考文献标题里的行内内容沿用既有白名单：格式放行；行内样式仍被阻断', () => {
    const marked = base()
    marked.bibliographyTitle = [{ text: '参考', marks: [{ type: 'bold' }] }]
    expect(getOutputSupportProblems(marked, 'XML46687')).toEqual([])
    const styled = base()
    styled.bibliographyTitle = [{ text: '参考', style: { color: '#f00' } } as never]
    expect(pathsOf(getOutputSupportProblems(styled, 'XML46687'))).toEqual(['doc.bibliographyTitle[0].style'])
  })

  it('其余问题与旧 XML 逐字相同：放行只由新结构触发（未知字段两者同样报告）', () => {
    const plain = base()
    expect(getOutputSupportProblems(plain, 'XML46687')).toEqual([])
    const withUnrelated = base()
    ;(withUnrelated.body[0]!.children[0] as unknown as Record<string, unknown>).extra = '未知'
    expect(asXml(getOutputSupportProblems(withUnrelated, 'XML46687'))).toEqual(getOutputSupportProblems(withUnrelated, 'XML'))
  })
})
