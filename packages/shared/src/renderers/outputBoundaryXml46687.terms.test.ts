import { describe, expect, it } from 'vitest'
import type { IRDoc, IRTermEntry } from '../ir/types'
import { getOutputSupportProblems } from './outputBoundary'
import { findDeclaredDifference, type Xml46687DeclaredDifference } from './xml46687Boundary'
import { XML46687_TERMS_BOUNDARY } from './xml46687Parts/terms'
import {
  asXml, describeDeclared, expectDeclaredDifferences, expectReleased, pathsOf,
} from './__tests__/xml46687BoundaryKit'

/**
 * XML46687 输出边界：术语与缩略语域（T2.4c，WP8.2 设计 §1.3.2～§1.3.4）的“逐项正例”。
 * 核心断言（差集恰等于声明集合、永久阻断项）在 `outputBoundaryXml46687.test.ts`；本文件持有 `terms.ts` 登记的声明项：
 * `termEntry.subjectField`、`termEntry.languageSets`（含各层 shape）、`defList`（kind）。
 */

const para = (id: string, text: string) => ({ kind: 'paragraph' as const, id, content: [{ text }] })

/** 术语章里放一个条目的最小文档（没有任何 T2.4c 放行项）。 */
function docWith(...entries: IRTermEntry[]): IRDoc {
  return {
    schemaVersion: 1, meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter', secType: 'terms', title: [{ text: '术语和定义' }], children: entries }],
    appendices: [], bibliography: [],
  }
}

const entry = (extra: Partial<IRTermEntry> = {}): IRTermEntry => ({
  kind: 'termEntry', id: 'term1', term: [{ text: '术语' }], definition: [para('term1.d', '定义。')], notes: [], examples: [], ...extra,
})

const languageSets: NonNullable<IRTermEntry['languageSets']> = [{
  id: 'ls1', language: 'fr',
  groups: [{ id: 'g1', terms: [{ id: 'v1', content: [{ text: 'terme' }], descriptors: [
    { id: 'd1', kind: 'partOfSpeech', value: [{ text: 'noun' }] },
    { id: 'd2', kind: 'subjectField', value: [{ text: '化学', marks: [{ type: 'bold' }] }] },
  ] }] }],
}]

type Install = (doc: IRDoc) => void
const children = (doc: IRDoc) => doc.body[0]!.children as unknown[]
const INSTALLERS: Record<string, Install> = {
  'field:subjectField': doc => children(doc).push(entry({ subjectField: [{ text: '标准化' }] })),
  'field:languageSets': doc => children(doc).push(entry({ languageSets })),
  'kind:defList': doc => children(doc).push({ kind: 'defList', id: 'abbr', items: [{ id: 'abbr1', term: [{ text: 'CPU' }], definition: [{ text: '中央处理器' }] }] }),
}

const OWN: readonly Xml46687DeclaredDifference[] = XML46687_TERMS_BOUNDARY.declared
const keyOf = (declared: Xml46687DeclaredDifference): string => `${declared.kind}:${declared.name}`
const installed = (declared: Xml46687DeclaredDifference): IRDoc => {
  const doc = docWith()
  INSTALLERS[keyOf(declared)]!(doc)
  return doc
}

describe('[M-9.2.9-01] [M-9.2.1-06] [M-10.1.4-01] terms.ts 的声明项：均为 T2.4c，登记完整', () => {
  it('术语域的每个声明项都有安装器，也没有多余的安装器', () => {
    expect(OWN.length).toBe(3)
    expect(OWN.every(declared => declared.task === 'T2.4c')).toBe(true)
    expect(OWN.map(keyOf).sort()).toEqual(Object.keys(INSTALLERS).sort())
  })

  it('这些声明项出现在汇总常量 XML46687_DECLARED_DIFFERENCES 里', () => {
    for (const declared of OWN) expect(findDeclaredDifference(installed(declared), expectedPath(declared)), describeDeclared(declared)).toBe(declared)
  })
})

/** 声明项触发的问题路径（术语条目是术语章的第 1 个子节点）。 */
function expectedPath(declared: Xml46687DeclaredDifference): string {
  return declared.kind === 'kind' ? 'doc.body[0].children[0].kind' : `doc.body[0].children[0].${declared.name}`
}

describe('逐项正例：最小文档里旧 XML 阻断，XML46687 放行', () => {
  it.each(OWN.map(declared => [describeDeclared(declared), declared] as const))('[M-9.2.9-01] [M-9.2.1-06] [M-9.2.1-07] [M-10.1.4-01] %s', (_title, declared) => {
    const doc = installed(declared)
    expectReleased(doc, declared)
    expectDeclaredDifferences(doc, [declared])
    expect(pathsOf(getOutputSupportProblems(doc, 'XML'))).toEqual([expectedPath(declared)])
  })

  it('三个声明项同在一份文档里：差集恰为这三项，XML46687 一条都不阻断', () => {
    const doc = docWith()
    for (const declared of OWN) INSTALLERS[keyOf(declared)]!(doc)
    const triggered = expectDeclaredDifferences(doc, OWN)
    expect(triggered.size).toBe(3)
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
  })
})

describe('[M-9.2.1-06] 各层 shape 放行后零问题，且不连带放行未知字段', () => {
  it('languageSets 的四层（语言集、术语组、术语变体、术语描述符）放行后 XML46687 零问题；描述符的数据字段 kind 不被当成节点 kind', () => {
    const doc = docWith(entry({ languageSets }))
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    // 对照：描述符里的行内 mark（bold）走 inline shape，同样零问题；旧 XML 在 languageSets 一处阻断，不下钻
    expect(pathsOf(getOutputSupportProblems(doc, 'XML'))).toEqual(['doc.body[0].children[0].languageSets'])
  })

  it.each([
    ['语言集', (doc: IRDoc) => ((children(doc)[0] as IRTermEntry).languageSets![0] as unknown as Record<string, unknown>), 'doc.body[0].children[0].languageSets[0].extra'],
    ['术语组', (doc: IRDoc) => ((children(doc)[0] as IRTermEntry).languageSets![0]!.groups[0] as unknown as Record<string, unknown>), 'doc.body[0].children[0].languageSets[0].groups[0].extra'],
    ['术语变体', (doc: IRDoc) => ((children(doc)[0] as IRTermEntry).languageSets![0]!.groups[0]!.terms[0] as unknown as Record<string, unknown>), 'doc.body[0].children[0].languageSets[0].groups[0].terms[0].extra'],
    ['术语描述符', (doc: IRDoc) => ((children(doc)[0] as IRTermEntry).languageSets![0]!.groups[0]!.terms[0]!.descriptors[0] as unknown as Record<string, unknown>), 'doc.body[0].children[0].languageSets[0].groups[0].terms[0].descriptors[0].extra'],
  ] as const)('%s上的未声明字段仍被 XML46687 阻断，路径精确', (_name, pick, path) => {
    const doc = docWith(entry({ languageSets: structuredClone(languageSets) }))
    pick(doc).extra = '未声明'
    expect(pathsOf(getOutputSupportProblems(doc, 'XML46687'))).toEqual([path])
  })

  it('termEntry.nestedEntries 仍被阻断（D-T-09 永久阻断，不随 languageSets 放行）；与旧 XML 逐字相同', () => {
    const doc = docWith(entry({ languageSets, nestedEntries: [entry({ id: 'child' })] }))
    expect(pathsOf(getOutputSupportProblems(doc, 'XML46687'))).toEqual(['doc.body[0].children[0].nestedEntries'])
    expect(asXml(getOutputSupportProblems(doc, 'XML46687'))).toEqual(
      getOutputSupportProblems(doc, 'XML').filter(problem => problem.path.endsWith('.nestedEntries')),
    )
  })

  it('语言集里的 tailOrder（languageSet 项）仍按既有规则校验：顺序数组无效时 XML46687 阻断，有效时放行', () => {
    const valid = docWith(entry({ languageSets, tailOrder: [{ kind: 'languageSet', index: 0 }] }))
    expect(getOutputSupportProblems(valid, 'XML46687')).toEqual([])
    const invalid = docWith(entry({ languageSets, tailOrder: [{ kind: 'note', index: 0 }] }))
    expect(pathsOf(getOutputSupportProblems(invalid, 'XML46687'))).toEqual(['doc.body[0].children[0].tailOrder'])
  })
})

describe('[M-10.1.4-03] [M-10.1.4-04] [M-10.1.4-05] defList 放行后项沿用 where 形状，不连带放行未知字段', () => {
  it('项只有 id、term、definition；未声明字段（abbrType）与容器字段（listContent）仍被阻断，路径精确', () => {
    const doc = docWith()
    INSTALLERS['kind:defList']!(doc)
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    const list = children(doc)[0] as { items: Array<Record<string, unknown>> } & Record<string, unknown>
    list.items[0]!.abbrType = 'initialism'
    list.listContent = 'abbreviation'
    expect(pathsOf(getOutputSupportProblems(doc, 'XML46687')).sort()).toEqual([
      'doc.body[0].children[0].items[0].abbrType',
      'doc.body[0].children[0].listContent',
    ])
  })
})

describe('[M-9.2.9-01] subjectField 里的行内内容', () => {
  it('领域的行内内容沿用既有行内白名单：bold 等格式 mark 放行；行内样式（style）仍被阻断（D-S-06）', () => {
    const marked = docWith(entry({ subjectField: [{ text: '化学', marks: [{ type: 'bold' }] }] }))
    expect(getOutputSupportProblems(marked, 'XML46687')).toEqual([])
    const styled = docWith(entry({ subjectField: [{ text: '化学', style: { color: '#f00' } } as never] }))
    expect(pathsOf(getOutputSupportProblems(styled, 'XML46687'))).toEqual(['doc.body[0].children[0].subjectField[0].style'])
  })
})
