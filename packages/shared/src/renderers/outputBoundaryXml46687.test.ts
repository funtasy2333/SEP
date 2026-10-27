import { describe, expect, it } from 'vitest'
import {
  UnsupportedOutputError,
  assertOutputSupported,
  getOutputSupportProblems,
  type OutputBoundaryFormat,
  type OutputSupportProblem,
} from './outputBoundary'
import type { IRDoc, IRInline } from '../ir/types'

/**
 * XML46687 在 WP8.1 支持矩阵确定前，允许表与特殊检查与 XML 完全相同（WP8.2 再放开）。
 * 本文件锁定这一点：任何一处让二者分叉的改动都必须同时更新这里。
 *
 * 已知例外（唯一一处）：小写罗马列项 `list.listType === 'roman'`（WP8.M G7，M-5.7-04）。旧 XML 序列化器会把它降为阿拉伯数字
 * （toXmlListType），为避免静默降级，`XML` 对它报 unsupported-output；`XML46687` 放行（GB/T 46687.2 5.7.2 有 roman-lower，
 * WP8.2 消费）。下面的「已知例外」用例显式列出这一差异；其余用例用的文档都不含罗马列项，一致性不受影响。
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

/** 把消息里的格式名统一成 XML，其余文字必须逐字相同。 */
const asXml = (problems: OutputSupportProblem[]): OutputSupportProblem[] =>
  problems.map(problem => ({ ...problem, message: problem.message.split('XML46687').join('XML') }))

const paths = (problems: OutputSupportProblem[]): string[] => problems.map(problem => problem.path)

describe('XML46687 输出边界目前与 XML 完全一致', () => {
  it('富文档：问题列表（含顺序、nodeId、path）在替换格式名后与 XML 逐项相同', () => {
    const doc = richDoc()
    const before = JSON.stringify(doc)
    const xml = getOutputSupportProblems(doc, 'XML')
    const xml46687 = getOutputSupportProblems(doc, 'XML46687')
    expect(xml.length).toBeGreaterThan(10)
    expect(asXml(xml46687)).toEqual(xml)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('富文档确实覆盖了各类阻断：元数据、扩展字段、行内样式、公式、表格、图、术语、类型错误引用', () => {
    const found = paths(getOutputSupportProblems(richDoc(), 'XML46687'))
    for (const expected of [
      'doc.index',
      'doc.meta.proposer', 'doc.meta.technicalCommittee', 'doc.meta.legacyExtra',
      'doc.body[0].children[0].content[0].style',
      'doc.body[0].children[0].content[2].marks[0].type',
      'doc.body[0].children[1].mathml',
      'doc.body[0].children[1].sourceInlines',
      'doc.body[0].children[2].headerRowCount',
      'doc.body[0].children[2].rows[0].cells[0].columnWidths',
      'doc.body[0].children[3].groups',
      'doc.body[0].children[4].tailOrder',
      'doc.body[0].children[5].languageSets',
      'doc.body[0].children[0]',
      'resolver.problems[dangling-typed-ref]',
    ]) expect(found, expected).toContain(expected)
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

  it('打印元数据 proposer/technicalCommittee 与 XML 一样被阻断，applicant 与 XML 一样放行；有数据时 HTML/DOCX 放行', () => {
    for (const field of ['proposer', 'technicalCommittee'] as const) {
      const doc = base()
      doc.meta[field] = '单位'
      expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
      expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
      expect(getOutputSupportProblems(doc, 'XML46687')).toContainEqual(expect.objectContaining({ path: `doc.meta.${field}` }))
      doc.meta[field] = ''
      expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    }
    const doc = base()
    doc.meta.applicant = '起草单位'
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
  })

  it('单元格列宽仅 DOCX 放行；XML46687 与 XML 一样阻断', () => {
    const doc = pushChild(base(), {
      kind: 'table', id: 'width-table', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [],
      rows: [{ id: 'r', cells: [{ id: 'c', colspan: 1, rowspan: 1, header: false, columnWidths: [70], content: [] }] }],
    })
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
    expect(paths(getOutputSupportProblems(doc, 'XML46687'))).toEqual(['doc.body[0].children[1].rows[0].cells[0].columnWidths'])
  })

  it('headerRowCount 仅在与旧表头推断一致时放行（与 XML 相同），一致时无问题', () => {
    const mismatch = pushChild(base(), {
      kind: 'table', id: 'mixed', caption: [], orientation: 'portrait', headerRowCount: 1, notes: [],
      rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [] }] }],
    })
    expect(paths(getOutputSupportProblems(mismatch, 'XML46687'))).toEqual(['doc.body[0].children[1].headerRowCount'])
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
  })

  it('已知例外：罗马列项（roman-lower）——旧 XML 阻断（旧序列化器降为阿拉伯数字），XML46687 放行；去掉这一项后二者仍逐项相同', () => {
    const doc = pushChild(richDoc(), {
      kind: 'list', id: 'roman-list', listType: 'roman',
      items: [{ id: 'roman-item', content: [{ kind: 'paragraph', id: 'roman-item.p0', content: [{ text: '项' }] }] }],
    })
    const romanPath = `doc.body[0].children[${doc.body[0]!.children.length - 1}].listType`
    const xml = getOutputSupportProblems(doc, 'XML')
    const xml46687 = getOutputSupportProblems(doc, 'XML46687')
    expect(paths(xml)).toContain(romanPath)
    expect(paths(xml46687)).not.toContain(romanPath)
    expect(xml.find(problem => problem.path === romanPath)).toMatchObject({ code: 'unsupported-output', nodeId: 'roman-list' })
    // 除这一条外，XML 与 XML46687 逐项相同（含顺序、nodeId、path、消息）
    expect(asXml(xml46687)).toEqual(xml.filter(problem => problem.path !== romanPath))
    // 只含罗马列项的最小文档：XML 一条、XML46687 为空
    const minimal = pushChild(base(), {
      kind: 'list', id: 'only-roman', listType: 'roman',
      items: [{ id: 'only-roman-i', content: [{ kind: 'paragraph', id: 'only-roman-i.p0', content: [{ text: '项' }] }] }],
    })
    expect(paths(getOutputSupportProblems(minimal, 'XML'))).toEqual(['doc.body[0].children[1].listType'])
    expect(getOutputSupportProblems(minimal, 'XML46687')).toEqual([])
    expect(getOutputSupportProblems(minimal, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(minimal, 'DOCX')).toEqual([])
    expect(() => assertOutputSupported(minimal, 'XML')).toThrow(UnsupportedOutputError)
    expect(() => assertOutputSupported(minimal, 'XML46687')).not.toThrow()
  })

  it('OutputBoundaryFormat 四个取值都可传入，旧的三个取值保持原样', () => {
    const formats: OutputBoundaryFormat[] = ['DOCX', 'HTML', 'XML', 'XML46687']
    for (const format of formats) expect(getOutputSupportProblems(base(), format)).toEqual([])
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
