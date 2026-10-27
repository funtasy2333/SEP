import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as shared from '../index'
import {
  UnsupportedOutputError,
  assertOutputSupported,
  getOutputSupportProblems,
  type OutputBoundaryFormat,
} from './outputBoundary'
import {
  XML46687_DECLARED_DIFFERENCES,
  findDeclaredDifference,
  type Xml46687DeclaredDifference,
} from './xml46687Boundary'
import {
  asXml, boundaryDifference, describeDeclared, expectDeclaredDifferences, expectReleased, pathsOf,
} from './__tests__/xml46687BoundaryKit'
import type { IRDoc, IRInline, IRMark, IRParagraph } from '../ir/types'

/**
 * XML46687 输出边界（WP8.2 设计 §1.3.2～§1.3.4）。
 *
 * 旧版本的前提是“XML46687 与 XML 完全一致，唯一例外是罗马列项”。WP8.2 逐步放行后这句话不再成立，**不能**靠放宽断言
 * （例如把 `toEqual` 改成 `toContain`）来过关，所以改成显式的**差异集合**断言：
 *
 * 1. 常量 `XML46687_DECLARED_DIFFERENCES`（导出自 shared 的 `xml46687Boundary.ts`，由各领域文件里的分段常量拼成）穷举
 *    XML46687 比 XML 多放行的全部字段/kind/mark 类型；
 * 2. 差集（XML 阻断而 XML46687 不阻断）里每一条都落在某个已声明差异内；XML46687 不得比 XML 多阻断；
 *    已声明的项必须被真正触发——新增放行而不登记，或登记了却没有真正放行，测试都失败；
 * 3. 逐项正例（`it.each`，本文件覆盖 `task: 'T2.4a'` 的声明项；T2.4b/T2.4c 在各自的 `outputBoundaryXml46687.<域>.test.ts` 里覆盖自己的）；
 * 4. 仍阻断清单：行内样式、`figure.groups`、`termEntry.nestedEntries` 等永久阻断项，路径精确；
 * 5. 未声明差异的问题与 XML 逐字相同（只把格式名统一）。
 *
 * 差集一律是**计算值**，不写死个数。
 */

const base = (): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' },
  front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'chapter', secType: 'scope', title: [{ text: '范围' }], children: [{ kind: 'paragraph', id: 'p1', content: [{ text: '原正文' }] }] }],
  appendices: [], bibliography: [],
})

function setParagraph(doc: IRDoc, content: IRInline[]): IRDoc {
  const paragraph = doc.body[0]!.children[0]
  if (paragraph?.kind !== 'paragraph') throw new Error('test setup: paragraph missing')
  paragraph.content = content
  return doc
}

function pushChild(doc: IRDoc, child: unknown): IRDoc {
  doc.body[0]!.children.push(child as IRDoc['body'][number]['children'][number])
  return doc
}

/** 包含多种 WP6 扩展字段、元数据与行内数据的文档：各格式的问题集合互不相同。 */
function richDoc(): IRDoc {
  const doc = base() as IRDoc & Record<string, unknown>
  Object.assign(doc.meta, { applicant: '起草单位', proposer: '提出单位', technicalCommittee: '归口单位', legacyExtra: '未知元数据' })
  setParagraph(doc, [
    { text: '样式', style: { color: '#ff0000' } } as IRInline,
    { text: '上下标', marks: [{ type: 'sub' }, { type: 'sup' }] },
    { text: '文献', marks: [{ type: 'bibRef', targetId: 'chapter' }] },
    { text: '双引用', marks: [
      { type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' },
      { type: 'crossRef', targetId: 'figure1', targetKind: 'figure' },
    ] },
    { text: '换行\n引用', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] },
  ])
  pushChild(doc, { kind: 'formula', id: 'formula1', latex: 'x', numbered: true, whereList: [], mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>', sourceInlines: [{ text: 'y' }] })
  pushChild(doc, {
    kind: 'table', id: 'table1', caption: [], orientation: 'portrait', headerRowCount: 1, notes: [],
    rows: [{ id: 'row1', cells: [{ id: 'cell1', colspan: 1, rowspan: 1, header: false, columnWidths: [70], content: [] }] }],
  })
  pushChild(doc, { kind: 'figure', id: 'figure1', caption: [], orientation: 'portrait', src: '', notes: [], groups: [{ id: 'group1', descriptions: [], resourceRefs: [] }] })
  pushChild(doc, { kind: 'termEntry', id: 'term-plain', term: [{ text: '术语' }], definition: [], notes: [], examples: [], tailOrder: [{ kind: 'note', index: 0 }] })
  pushChild(doc, {
    kind: 'termEntry', id: 'term-lang', term: [{ text: '术语' }], definition: [], notes: [], examples: [],
    languageSets: [{ id: 'lang-fr', language: 'fr', groups: [{ id: 'tig-fr', terms: [{ id: 'variant-fr', content: [{ text: 'terme' }], descriptors: [] }] }] }],
    tailOrder: [{ kind: 'languageSet', index: 0 }],
  })
  doc.index = { id: 'index1', groups: [{ id: 'index-group1', entries: [{ id: 'entry1', term: [{ text: '正文' }], targets: ['p1'], seeAlso: [] }] }] }
  doc.unsupportedContent = [{ nodeId: 'p1', path: 'doc.body[0].children[0]', nodeType: 'oddNode', reason: '无法映射' }]
  return doc
}

// ---------------------------------------------------------------------------
// T2.4a 声明项的“安装器”：给 base() 加上恰好触发该声明项的最小内容
// ---------------------------------------------------------------------------

type Install = (doc: IRDoc) => void
const pushRun = (doc: IRDoc, text: string, ...marks: IRMark[]): void => {
  ;(doc.body[0]!.children[0] as IRParagraph).content.push({ text, marks })
}
const linkRun = (doc: IRDoc, extra: Record<string, unknown>): void => pushRun(doc, '链接', { type: 'externalLink', href: 'https://example.org/', ...extra } as IRMark)
const para = (id: string, text: string): IRParagraph => ({ kind: 'paragraph', id, content: [{ text }] })

const INSTALLERS: Record<string, Install> = {
  'field:titleParts': doc => { doc.meta.titleParts = [{ id: 'tp1', lang: 'zh', role: 'full', content: [{ text: '题名' }] }] },
  'field:identifiers': doc => {
    doc.meta.identifiers = [{ id: 'ident1', scheme: 'dated', value: 'GB/T 1—2026', parts: [{ id: 'identp1', kind: 'doc-type', position: 1, content: [{ text: 'GB/T' }] }] }]
  },
  'field:languages': doc => { doc.meta.languages = [{ id: 'lang1', tag: 'zh', usage: 'primary' }] },
  'field:publishers': doc => { doc.meta.publishers = [{ id: 'pub1', name: [{ text: '机构' }], role: 'lead', identifier: 'SAC' }] },
  'field:copyrights': doc => { doc.meta.copyrights = [{ id: 'cp1', statement: [{ text: '版权专有' }], year: '2026', holder: [{ text: '单位' }] }] },
  'field:replacedStandards': doc => { doc.meta.replacedStandards = [{ id: 'rs1', reference: 'GB/T 2—2020', relation: 'replaces' }] },
  'field:adoptions': doc => { doc.meta.adoptions = [{ id: 'ad1', reference: 'ISO 1', degree: 'IDT', language: 'en' }] },
  'field:proposer': doc => { doc.meta.proposer = '提出单位' },
  'field:technicalCommittee': doc => { doc.meta.technicalCommittee = '归口单位' },
  'field:introductionClauses': doc => {
    doc.front.introductionClauses = [{ kind: 'clause', id: 'ic1', level: 1, titled: true, title: [{ text: '背景' }], children: [para('ic1-p', '引言条')] }]
  },
  'kind:warning': doc => { pushChild(doc, { kind: 'warning', id: 'w1', content: [para('w1-p', '警告')] }) },
  'kind:quote': doc => { pushChild(doc, { kind: 'quote', id: 'q1', content: [para('q1-p', '摘录')] }) },
  'kind:code': doc => { pushChild(doc, { kind: 'code', id: 'c1', language: 'ts', text: 'a < b' }) },
  'field:listType': doc => {
    pushChild(doc, { kind: 'list', id: 'roman-list', listType: 'roman', items: [{ id: 'roman-item', content: [para('roman-item.p0', '项')] }] })
  },
  'markType:strike': doc => pushRun(doc, '删', { type: 'strike' }),
  'markType:code': doc => pushRun(doc, 'x', { type: 'code' }),
  'markType:variable': doc => pushRun(doc, 'x', { type: 'variable' }),
  'markType:externalLink': doc => linkRun(doc, {}),
  'markType:bibRef': doc => {
    doc.bibliography = [{ kind: 'bibEntry', id: 'bib1', content: [{ text: '文献一' }] }]
    pushRun(doc, '[1]', { type: 'bibRef', targetId: 'bib1' })
  },
  'markType:termRef': doc => {
    doc.body.push({ kind: 'chapter', id: 'chapter-terms', secType: 'terms', title: [{ text: '术语' }], children: [
      { kind: 'termEntry', id: 'term1', term: [{ text: '术语一' }], definition: [para('term1-def', '定义')], notes: [], examples: [] },
    ] })
    pushRun(doc, '术语一', { type: 'termRef', targetId: 'term1' })
  },
  'markType:stdRef': doc => pushRun(doc, 'GB/T 1', { type: 'stdRef' }),
  'markType:mixedCitation': doc => pushRun(doc, '原有格式', { type: 'mixedCitation' }),
  'field:href': doc => linkRun(doc, {}),
  'field:title': doc => linkRun(doc, { title: '提示' }),
  'field:target': doc => linkRun(doc, { target: '_blank' }),
  'field:rel': doc => linkRun(doc, { rel: 'noopener' }),
  'field:kind': doc => pushRun(doc, 'x', { type: 'variable', kind: 'quantity' }),
  'field:name': doc => pushRun(doc, 'x', { type: 'variable', name: 'x' }),
  'field:formula': doc => { (doc.body[0]!.children[0] as IRParagraph).content.push({ text: '', formula: { id: 'inline-f1', latex: 'x^2' } }) },
}

const keyOfEntry = (entry: Xml46687DeclaredDifference): string => `${entry.kind}:${entry.name}`
const OWN = XML46687_DECLARED_DIFFERENCES.filter(entry => entry.task === 'T2.4a')

/** 含全部 T2.4a 放行项的文档。 */
function releasedDoc(): IRDoc {
  const doc = base()
  for (const entry of OWN) INSTALLERS[keyOfEntry(entry)]!(doc)
  return doc
}

function installedDoc(entry: Xml46687DeclaredDifference): IRDoc {
  const doc = base()
  INSTALLERS[keyOfEntry(entry)]!(doc)
  return doc
}

describe('[M-4.3.2-30] XML46687_DECLARED_DIFFERENCES：导出自 shared，登记完整', () => {
  it('从 @ses/shared 的包入口可取到，且与边界模块是同一份常量', () => {
    expect(shared.XML46687_DECLARED_DIFFERENCES).toBe(XML46687_DECLARED_DIFFERENCES)
    expect(typeof shared.findDeclaredDifference).toBe('function')
  })

  it('每一项都有种类、名称、矩阵行、任务、原因；任务只能是 T2.4a/T2.4b/T2.4c；同一（种类，名称，后缀）不重复', () => {
    const seen = new Set<string>()
    for (const entry of XML46687_DECLARED_DIFFERENCES) {
      expect(['field', 'kind', 'markType']).toContain(entry.kind)
      expect(entry.name).not.toBe('')
      expect(entry.pathSuffix).not.toBe('')
      expect(entry.matrixIds.length, describeDeclared(entry)).toBeGreaterThan(0)
      expect(['T2.4a', 'T2.4b', 'T2.4c']).toContain(entry.task)
      expect(entry.reason).not.toBe('')
      const key = `${entry.kind}|${entry.name}|${entry.pathSuffix}`
      expect(seen.has(key), `重复的声明项 ${key}`).toBe(false)
      seen.add(key)
    }
  })

  it('声明项引用的矩阵行都存在于 docs/wp8.1 的矩阵（防笔误）', () => {
    const ids = new Set<string>()
    for (const file of ['matrix-S.json', 'matrix-T.json']) {
      const rows = JSON.parse(readFileSync(new URL(`../../../../docs/wp8.1/${file}`, import.meta.url), 'utf8')) as Array<{ id: string }>
      for (const row of rows) ids.add(row.id)
    }
    for (const entry of XML46687_DECLARED_DIFFERENCES) {
      for (const id of entry.matrixIds) expect(ids.has(id), `${describeDeclared(entry)} 引用了不存在的矩阵行 ${id}`).toBe(true)
    }
  })

  it('本文件为每个 T2.4a 声明项准备了安装器，也没有多余的安装器', () => {
    expect(OWN.length).toBeGreaterThan(0)
    expect(OWN.map(keyOfEntry).sort()).toEqual(Object.keys(INSTALLERS).sort())
  })
})

describe('XML46687 输出边界：差集恰等于声明集合（计算值）', () => {
  it('富文档（既有的 WP6 扩展字段、元数据与行内数据）：差集每条都已声明，XML46687 不比 XML 多阻断；共同阻断的问题逐条相同', () => {
    const doc = richDoc()
    const before = JSON.stringify(doc)
    expect(getOutputSupportProblems(doc, 'XML').length).toBeGreaterThan(10)
    const triggered = expectDeclaredDifferences(doc, [])
    // 既有富文档里至少触发了提出单位、归口单位这两项
    expect([...triggered].map(entry => entry.name)).toEqual(expect.arrayContaining(['proposer', 'technicalCommittee']))
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('T2.4a 放行项的富文档：全部 T2.4a 声明项都被触发，差集没有任何未声明的项，XML46687 一条都不阻断', () => {
    const doc = releasedDoc()
    const triggered = expectDeclaredDifferences(doc, OWN)
    expect([...triggered].filter(entry => entry.task === 'T2.4a')).toHaveLength(OWN.length)
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    expect(getOutputSupportProblems(doc, 'XML').length).toBeGreaterThanOrEqual(OWN.length)
  })

  it.each(OWN.map(entry => [describeDeclared(entry), entry] as const))('逐项正例 [%s]：最小文档里 XML 阻断，XML46687 放行', (_title, entry) => {
    const doc = installedDoc(entry)
    expectReleased(doc, entry)
    expectDeclaredDifferences(doc, [entry])
  })

  it('新增放行而不登记会被发现：把一个已放行的字段从声明集合里去掉，差集断言失败', () => {
    const doc = installedDoc(OWN.find(entry => entry.name === 'proposer')!)
    const problem = boundaryDifference(doc).onlyXml[0]!
    expect(findDeclaredDifference(doc, problem.path)?.name).toBe('proposer')
    // 对照：没有声明项能覆盖一个“假想的”路径
    expect(findDeclaredDifference(doc, 'doc.meta.notDeclared')).toBeUndefined()
  })
})

describe('XML46687 输出边界：既有检查与 XML 保持一致', () => {
  it('富文档确实覆盖了各类阻断，永久阻断项在 XML46687 下仍精确报出', () => {
    const found = pathsOf(getOutputSupportProblems(richDoc(), 'XML46687'))
    for (const expected of [
      'doc.meta.legacyExtra',
      'doc.body[0].children[0].content[0].style',
      'doc.body[0].children[1].sourceInlines',
      'doc.body[0].children[2].headerRowCount',
      'doc.body[0].children[3].groups',
      'doc.body[0].children[4].tailOrder',
      'doc.body[0].children[0]',
      'resolver.problems[dangling-typed-ref]',
    ]) expect(found, expected).toContain(expected)
    // 已放行的项不再出现
    expect(found).not.toContain('doc.meta.proposer')
    expect(found).not.toContain('doc.meta.technicalCommittee')
    expect(found).not.toContain('doc.body[0].children[0].content[2].marks[0].type')
  })

  it('消息中使用的是调用时传入的格式名', () => {
    const problems = getOutputSupportProblems(richDoc(), 'XML46687')
    expect(problems.some(problem => problem.message.includes('XML46687'))).toBe(true)
    expect(getOutputSupportProblems(richDoc(), 'XML').some(problem => problem.message.includes('XML46687'))).toBe(false)
  })

  it('仅属于 DOCX 的检查（上下标并存）与仅属于 HTML/DOCX 的检查（多 crossRef、crossRef 换行）不对 XML46687 生效', () => {
    const found = paths(getOutputSupportProblems(richDoc(), 'XML46687'))
    expect(found).not.toContain('doc.body[0].children[0].content[1].marks[1]')
    expect(found).not.toContain('doc.body[0].children[0].content[3].marks[1]')
    expect(found).not.toContain('doc.body[0].children[0].content[4].text')
    // 对照：这些检查在 HTML/DOCX 中确实存在，证明富文档触发了它们
    expect(paths(getOutputSupportProblems(richDoc(), 'DOCX'))).toContain('doc.body[0].children[0].content[1].marks[1]')
    expect(paths(getOutputSupportProblems(richDoc(), 'HTML'))).toContain('doc.body[0].children[0].content[3].marks[1]')
    expect(paths(getOutputSupportProblems(richDoc(), 'HTML'))).toContain('doc.body[0].children[0].content[4].text')
  })

  it('打印元数据 proposer/technicalCommittee：HTML/DOCX 放行；XML46687 自 T2.4a-1 起放行（已声明），旧 XML 阻断；applicant 各格式一致', () => {
    for (const field of ['proposer', 'technicalCommittee'] as const) {
      const doc = base()
      doc.meta[field] = '单位'
      expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
      expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
      expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
      expect(paths(getOutputSupportProblems(doc, 'XML'))).toEqual([`doc.meta.${field}`])
      expect(findDeclaredDifference(doc, `doc.meta.${field}`)).toMatchObject({ kind: 'field', name: field })
      doc.meta[field] = ''
      expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    }
    const doc = base()
    doc.meta.applicant = '起草单位'
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    expect(getOutputSupportProblems(doc, 'XML')).toEqual([])
  })

  it('单元格列宽仅 DOCX 放行；XML46687 在领域放行（T2.4b 的声明项）之前与 XML 一样阻断', () => {
    const doc = pushChild(base(), {
      kind: 'table', id: 'width-table', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [],
      rows: [{ id: 'r', cells: [{ id: 'c', colspan: 1, rowspan: 1, header: false, columnWidths: [70], content: [] }] }],
    })
    const path = 'doc.body[0].children[1].rows[0].cells[0].columnWidths'
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
    expect(paths(getOutputSupportProblems(doc, 'XML'))).toEqual([path])
    // 差异只由声明集合决定：登记了 columnWidths 才放行，否则与 XML 相同
    const declared = XML46687_DECLARED_DIFFERENCES.some(entry => entry.name === 'columnWidths')
    expect(paths(getOutputSupportProblems(doc, 'XML46687'))).toEqual(declared ? [] : [path])
  })

  it('headerRowCount 仅在与旧表头推断一致时放行（与 XML 相同），一致时无问题', () => {
    const mismatch = pushChild(base(), {
      kind: 'table', id: 'mixed', caption: [], orientation: 'portrait', headerRowCount: 1, notes: [],
      rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [] }] }],
    })
    expect(paths(getOutputSupportProblems(mismatch, 'XML46687'))).toEqual(['doc.body[0].children[1].headerRowCount'])
    expect(asXml(getOutputSupportProblems(mismatch, 'XML46687'))).toEqual(getOutputSupportProblems(mismatch, 'XML'))
    expect(getOutputSupportProblems(mismatch, 'HTML')).toEqual([])
    const consistent = pushChild(base(), {
      kind: 'table', id: 'consistent', caption: [], orientation: 'portrait', headerRowCount: 1, notes: [],
      rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: true, content: [] }] }],
    })
    expect(getOutputSupportProblems(consistent, 'XML46687')).toEqual([])
  })

  it('干净文档、类型错误的引用、合法的类型化引用：二者结论一致', () => {
    const clean = base()
    const typedMismatch = setParagraph(base(), [{ text: '图引用', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'figure' }] }])
    const typedOk = setParagraph(base(), [{ text: '章引用', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] }])
    for (const doc of [clean, typedMismatch, typedOk]) {
      expect(asXml(getOutputSupportProblems(doc, 'XML46687'))).toEqual(getOutputSupportProblems(doc, 'XML'))
    }
    expect(getOutputSupportProblems(clean, 'XML46687')).toEqual([])
    expect(getOutputSupportProblems(typedOk, 'XML46687')).toEqual([])
    expect(paths(getOutputSupportProblems(typedMismatch, 'XML46687'))).toEqual(['resolver.problems[dangling-typed-ref]'])
  })

  it('assertOutputSupported(XML46687)：有问题时抛 UnsupportedOutputError 且 problems 与检查结果相同，无问题时通过', () => {
    const doc = richDoc()
    let caught: unknown
    try { assertOutputSupported(doc, 'XML46687') } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(UnsupportedOutputError)
    expect((caught as UnsupportedOutputError).problems).toEqual(getOutputSupportProblems(doc, 'XML46687'))
    expect(() => assertOutputSupported(base(), 'XML46687')).not.toThrow()
    expect(() => assertOutputSupported(releasedDoc(), 'XML46687')).not.toThrow()
  })

  it('罗马列项（roman-lower，[M-5.7-04]）：旧 XML 阻断（旧序列化器降为阿拉伯数字），XML46687 放行并登记为已声明差异', () => {
    const minimal = pushChild(base(), {
      kind: 'list', id: 'only-roman', listType: 'roman',
      items: [{ id: 'only-roman-i', content: [{ kind: 'paragraph', id: 'only-roman-i.p0', content: [{ text: '项' }] }] }],
    })
    expect(paths(getOutputSupportProblems(minimal, 'XML'))).toEqual(['doc.body[0].children[1].listType'])
    expect(getOutputSupportProblems(minimal, 'XML')[0]).toMatchObject({ code: 'unsupported-output', nodeId: 'only-roman' })
    expect(getOutputSupportProblems(minimal, 'XML46687')).toEqual([])
    expect(getOutputSupportProblems(minimal, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(minimal, 'DOCX')).toEqual([])
    expect(() => assertOutputSupported(minimal, 'XML')).toThrow(UnsupportedOutputError)
    expect(() => assertOutputSupported(minimal, 'XML46687')).not.toThrow()
    expect(findDeclaredDifference(minimal, 'doc.body[0].children[1].listType')).toMatchObject({ kind: 'field', name: 'listType' })
  })

  it('OutputBoundaryFormat 四个取值都可传入，旧的三个取值保持原样', () => {
    const formats: OutputBoundaryFormat[] = ['DOCX', 'HTML', 'XML', 'XML46687']
    for (const format of formats) expect(getOutputSupportProblems(base(), format)).toEqual([])
  })
})

/** 仍阻断清单：永久阻断（丢弃会改变内容含义，或有用户已定决议），XML46687 精确报出路径。 */
const XML46687_STILL_BLOCKED: ReadonlyArray<{ name: string; build: () => IRDoc; paths: string[]; xmlAlsoBlocksReleased?: true }> = [
  {
    name: '行内样式（颜色、字号……）：D-S-06，5.1 只允许七种格式',
    build: () => setParagraph(base(), [{ text: '红字', style: { color: '#ff0000' } } as IRInline]),
    paths: ['doc.body[0].children[0].content[0].style'],
  },
  {
    name: 'figure.groups：多资源/分图本阶段不做（D-T-11、D-M-12）',
    build: () => pushChild(base(), { kind: 'figure', id: 'fig-groups', caption: [], orientation: 'portrait', src: '', notes: [], groups: [{ id: 'g1', descriptions: [], resourceRefs: [] }] }),
    paths: ['doc.body[0].children[1].groups'],
  },
  {
    name: 'termEntry.nestedEntries：D-T-09 不拍平',
    build: () => pushChild(base(), {
      kind: 'termEntry', id: 'term-nested', term: [{ text: '术语' }], definition: [], notes: [], examples: [],
      nestedEntries: [{ kind: 'termEntry', id: 'term-child', term: [{ text: '子术语' }], definition: [], notes: [], examples: [] }],
    }),
    paths: ['doc.body[0].children[1].nestedEntries'],
  },
  {
    name: 'pmToIr 的 unsupportedContent：无法表达的内容不得静默丢弃',
    build: () => { const doc = base(); doc.unsupportedContent = [{ nodeId: 'p1', path: 'doc.body[0].children[0]', nodeType: 'oddNode', reason: '无法映射' }]; return doc },
    paths: ['doc.body[0].children[0]'],
  },
  {
    name: '元数据里的未知字段',
    build: () => { const doc = base(); Object.assign(doc.meta, { legacyExtra: '未知元数据' }); return doc },
    paths: ['doc.meta.legacyExtra'],
  },
  {
    name: '带 marks 的行内公式：公式 run 不得同时带 marks',
    build: () => setParagraph(base(), [{ text: '', marks: [{ type: 'bold' }], formula: { id: 'f-marked', latex: 'x' } }]),
    paths: ['doc.body[0].children[0].content[0].marks'],
    xmlAlsoBlocksReleased: true,
  },
  {
    name: '行内样式即使与已放行的 mark 同在一个 run 上',
    build: () => setParagraph(base(), [{ text: '粗红', marks: [{ type: 'strike' }], style: { color: '#f00' } } as IRInline]),
    paths: ['doc.body[0].children[0].content[0].style'],
    xmlAlsoBlocksReleased: true,
  },
]

describe('XML46687 输出边界：仍阻断清单', () => {
  it.each(XML46687_STILL_BLOCKED.map(entry => [entry.name, entry] as const))('%s', (_title, entry) => {
    const doc = entry.build()
    expect(paths(getOutputSupportProblems(doc, 'XML46687'))).toEqual(entry.paths)
    for (const problem of getOutputSupportProblems(doc, 'XML46687')) expect(problem.code).toBe('unsupported-output')
    // 永久阻断项与旧 XML 完全相同（含顺序、nodeId、消息）；同一 run 上另有已放行项的，旧 XML 在别的路径上同样阻断
    if (entry.xmlAlsoBlocksReleased) expect(getOutputSupportProblems(doc, 'XML').length).toBeGreaterThan(0)
    else expect(asXml(getOutputSupportProblems(doc, 'XML46687'))).toEqual(getOutputSupportProblems(doc, 'XML'))
  })
})

describe('XML46687 输出边界：两处实现陷阱的回归', () => {
  it('[M-5.5-02] mark 对象的 kind 字段是数据，不是节点 kind：带 kind/name 的 variable mark 在 XML46687 下零问题', () => {
    const doc = setParagraph(base(), [{ text: 'x', marks: [{ type: 'variable', kind: 'quantity', name: 'x' }] }])
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    // 旧 XML：variable 类型不放行，kind/name 字段也不放行——报的是 type/kind/name 三个字段，而不是把 mark 当成“kind 为 quantity 的节点”
    expect(paths(getOutputSupportProblems(doc, 'XML'))).toEqual([
      'doc.body[0].children[0].content[0].marks[0].type',
      'doc.body[0].children[0].content[0].marks[0].kind',
      'doc.body[0].children[0].content[0].marks[0].name',
    ])
    expect(paths(getOutputSupportProblems(doc, 'HTML'))).toContain('doc.body[0].children[0].content[0].marks[0].type')
  })

  it('[M-5.5-02] 被误读为节点 kind 的症状：mark 的 kind 取值恰好是块 kind（如 paragraph）也不改变结论', () => {
    const doc = setParagraph(base(), [{ text: 'x', marks: [{ type: 'variable', kind: 'paragraph' }] }])
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
  })

  it('[M-7.1-04] 行内公式不再被 XML46687 提前拦截；旧 XML 仍一律阻断；HTML/DOCX 的容器限制不变', () => {
    const inParagraph = setParagraph(base(), [{ text: '', formula: { id: 'inline-f', latex: 'x^2' } }])
    expect(getOutputSupportProblems(inParagraph, 'XML46687')).toEqual([])
    expect(paths(getOutputSupportProblems(inParagraph, 'XML'))).toEqual(['doc.body[0].children[0].content[0].formula'])
    expect(getOutputSupportProblems(inParagraph, 'HTML')).toEqual([])
    // 标题里的行内公式：HTML/DOCX 仍拒绝；XML46687 边界放行（纯文本型容器由渲染器报 formula-in-text-only，标题是 inline 容器本就可写）
    const inTitle = base()
    inTitle.body[0]!.title = [{ text: '', formula: { id: 'title-f', latex: 'x' } }]
    expect(getOutputSupportProblems(inTitle, 'HTML').some(problem => problem.message.includes('行内公式'))).toBe(true)
    expect(getOutputSupportProblems(inTitle, 'XML46687')).toEqual([])
  })

  it('[M-7.1-05] 行内公式在 XML46687 下不要求 latex（MathML 可用与否由渲染器核对）；同一 run 上的 marks/footnote 仍阻断', () => {
    const noLatex = setParagraph(base(), [{ text: '', formula: { id: 'inline-f' } }])
    expect(getOutputSupportProblems(noLatex, 'XML46687')).toEqual([])
    expect(getOutputSupportProblems(noLatex, 'HTML').some(problem => problem.path.endsWith('.formula.latex'))).toBe(true)
    const withFootnote = setParagraph(base(), [{ text: '', formula: { id: 'inline-f', latex: 'x' }, footnote: { id: 'fn1', content: [{ text: '注' }] } }])
    expect(paths(getOutputSupportProblems(withFootnote, 'XML46687'))).toEqual(['doc.body[0].children[0].content[0].footnote'])
  })
})

describe('DOCX/HTML/XML 的行为不因新增格式而改变', () => {
  it('富文档在三个原有格式下的阻断路径保持各自的格式差异', () => {
    const docx = paths(getOutputSupportProblems(richDoc(), 'DOCX'))
    const html = paths(getOutputSupportProblems(richDoc(), 'HTML'))
    const xml = paths(getOutputSupportProblems(richDoc(), 'XML'))
    // 打印格式承认 proposer/technicalCommittee，XML 不承认
    expect(docx).not.toContain('doc.meta.proposer')
    expect(html).not.toContain('doc.meta.technicalCommittee')
    expect(xml).toContain('doc.meta.proposer')
    // 列宽仅 DOCX 承认；headerRowCount 仅 XML 额外检查
    expect(docx).not.toContain('doc.body[0].children[2].rows[0].cells[0].columnWidths')
    expect(html).toContain('doc.body[0].children[2].rows[0].cells[0].columnWidths')
    expect(xml).toContain('doc.body[0].children[2].rows[0].cells[0].columnWidths')
    expect(docx).not.toContain('doc.body[0].children[2].headerRowCount')
    expect(html).not.toContain('doc.body[0].children[2].headerRowCount')
    expect(xml).toContain('doc.body[0].children[2].headerRowCount')
  })
})

function paths(problems: ReturnType<typeof getOutputSupportProblems>): string[] {
  return pathsOf(problems)
}
