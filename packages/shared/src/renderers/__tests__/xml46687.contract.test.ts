import { describe, expect, it } from 'vitest'
import * as shared from '../../index'
import { resolve } from '../../ir/resolve'
import type { IRDoc, IRInline } from '../../ir/types'
import { UnsupportedOutputError, getOutputSupportProblems } from '../outputBoundary'
import {
  XmlExportError,
  exportXml46687,
  renderXml46687,
  type RenderXml46687Options,
  type Xml46687ExportResult,
  type Xml46687Problem,
  type Xml46687ProblemCode,
} from '../xml46687'

/**
 * T2.4a-0 契约测试：类型与公共导出的冒烟、入口断言的顺序与两个入口各自的失败方式。
 * 渲染管线本身（P1～P5）属 T2.4a-1；它落地后“占位”两条用例改为真实输出断言，入口断言的用例保持不变。
 */

const doc = (content: IRInline[]): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' },
  front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'chapter', secType: 'scope', title: [{ text: '范围' }], children: [{ kind: 'paragraph', id: 'p1', content }] }],
  appendices: [], bibliography: [],
})

const options: RenderXml46687Options = { mathml: {}, resources: { version: 1, entries: [] } }

/** 通过输出边界和脚注核对的最小文档。 */
const validDoc = () => doc([{ text: '正文' }])
/** 行内样式（颜色）：XML46687 保持阻断（设计 §1.3.3），只触发输出边界。 */
const boundaryDoc = () => doc([{ text: '红字', style: { color: '#ff0000' } }])
/** 条文脚注内容为空：Resolver 报 invalid-footnote，只触发脚注核对。 */
const footnoteDoc = () => doc([{ text: '正文', footnote: { id: 'fn1', content: [{ text: '' }] } }])
/** 同时触发两道入口断言。 */
const bothDoc = () => doc([
  { text: '红字', style: { color: '#ff0000' } },
  { text: '正文', footnote: { id: 'fn1', content: [{ text: '' }] } },
])

const labelsOf = (value: IRDoc) => resolve(value).labels

describe('XML46687 导出契约：公共导出与类型', () => {
  it('包入口导出渲染器、导出函数、错误类、资源清单收集函数', () => {
    expect(typeof shared.renderXml46687).toBe('function')
    expect(typeof shared.exportXml46687).toBe('function')
    expect(typeof shared.collectXml46687ImageRefs).toBe('function')
    expect(shared.XmlExportError).toBe(XmlExportError)
    expect(shared.renderXml46687).toBe(renderXml46687)
    expect(shared.exportXml46687).toBe(exportXml46687)
  })

  it('选项、问题与结果的形状可构造且可 JSON 往返', () => {
    const problem: Xml46687Problem = { code: 'xml-label-missing', severity: 'error', nodeId: 'p1', path: 'doc.body[0]', message: '缺少标签' }
    const withoutNode: Xml46687Problem = { code: 'resource-unused', severity: 'info', path: 'resources', message: '多余条目' }
    const result: Xml46687ExportResult = { xml: null, problems: [problem, withoutNode] }
    const withResources: RenderXml46687Options = {
      mathml: { f1: '<mml:math><mml:mi>x</mml:mi></mml:math>' },
      resources: { version: 1, entries: [{ href: 'fig_1', key: 'res-1', fileName: 'fig_1.png', mediaType: 'image/png', source: 'resource' }] },
    }
    expect(JSON.parse(JSON.stringify({ result, withResources }))).toEqual({ result, withResources })
  })

  it('问题码联合恰好是设计 §4.4 的 73 个码，均为 kebab-case 且互不重复', () => {
    const codes: Record<Xml46687ProblemCode, true> = {
      'xml-label-missing': true, 'xml-body-empty': true, 'meta-required-missing': true, 'xml-date-invalid': true,
      'xml-block-after-subsec': true, 'xml-mark-combination': true, 'xml-link-protocol': true, 'xml-footnote-position': true,
      'formula-in-text-only': true, 'xml-list-type-unsupported': true, 'list-marker-missing': true, 'xml-list-empty': true,
      'xml-note-content': true, 'xml-quote-content': true, 'xml-cell-content': true, 'cell-unit-unsupported': true,
      'xml-table-empty': true, 'resource-missing': true, 'resource-mismatch': true, 'mathml-missing': true,
      'mathml-invalid': true, 'xml-term-outside-terms': true, 'term-language-missing': true, 'xml-term-empty': true,
      'xml-term-no-definition': true, 'xml-term-definition-block': true, 'xml-descriptor-value': true,
      'xml-descriptor-duplicate': true, 'term-subjectfield-conflict': true, 'xml-normref-outside': true,
      'xml-normref-incomplete': true, 'xml-xref-target-unsupported': true, 'xml-xref-target-missing': true,
      'xml-id-invalid': true, 'xml-id-duplicate': true, 'xml-rid-unresolved': true, 'xml-ext-id-leak': true,
      'xml-write-failed': true, 'mathml-empty-source': true, 'mathml-conversion-failed': true,
      'resource-load-failed': true, 'resource-name-conflict': true, 'resource-media-type': true,
      'meta-not-expressed': true, 'meta-date-order': true, 'title-missing': true, 'title-ignored': true,
      'mark-dropped-in-text-only': true, 'link-attr-not-expressed': true, 'variable-attr-not-expressed': true,
      'newline-flattened': true, 'empty-content': true, 'code-language-not-expressed': true, 'caption-empty': true,
      'caption-en-not-expressed': true, 'table-width-not-expressed': true, 'table-style-not-expressed': true,
      'figure-attr-not-expressed': true, 'term-subjectfield-duplicate': true, 'term-subjectfield-promoted': true,
      'term-subjectfield-brackets': true, 'term-descriptor-not-expressed': true, 'term-descriptor-missing': true,
      'bib-std-incomplete': true, 'bib-field-not-expressed': true, 'index-seealso-not-expressed': true, 'list-type-normalized': true,
      'cell-attr-not-expressed': true, 'px-width-ignored': true, 'term-language-merged': true,
      'term-tail-order-normalized': true, 'mathml-annotation-removed': true, 'resource-unused': true,
    }
    const names = Object.keys(codes)
    expect(names).toHaveLength(73)
    expect(new Set(names).size).toBe(73)
    for (const name of names) expect(name).toMatch(/^[a-z]+(?:-[a-z]+)+$/)
  })
})

describe('XmlExportError', () => {
  const problems: Xml46687Problem[] = [
    { code: 'xml-label-missing', severity: 'error', nodeId: 'a', path: 'doc.body[0]', message: '缺少标签 a' },
    { code: 'meta-not-expressed', severity: 'warning', path: 'doc.meta', message: '元数据未表达' },
    { code: 'xml-id-duplicate', severity: 'error', nodeId: 'b', path: 'doc.body[1]', message: 'id 重复 b' },
  ]

  it('携带全部问题（含 warning），消息只汇总 error', () => {
    const error = new XmlExportError(problems)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('XmlExportError')
    expect(error.problems).toBe(problems)
    expect(error.message).toBe('缺少标签 a\nid 重复 b')
  })

  it('没有 error 时消息退回全部问题', () => {
    const only = [problems[1]!]
    expect(new XmlExportError(only).message).toBe('元数据未表达')
  })
})

describe('XML46687 入口断言：先脚注、后输出边界；render 抛、export 转问题', () => {
  // T2.4a-1 把“到达占位”的两条用例改成真实管线断言（见本文件头注释）；入口断言的其余用例保持不变。
  it('文档通过两道断言后进入渲染管线：缺题名是内容 error——render 抛 XmlExportError，export 返回 xml:null 与问题', () => {
    const value = validDoc()
    expect(getOutputSupportProblems(value, 'XML46687')).toEqual([])
    let thrown: unknown
    try { renderXml46687(value, labelsOf(value), options) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(XmlExportError)
    expect((thrown as XmlExportError).problems.some((problem) => problem.code === 'meta-required-missing' && problem.severity === 'error')).toBe(true)
    const result = exportXml46687(value, labelsOf(value), options)
    expect(result.xml).toBeNull()
    expect(result.problems).toEqual((thrown as XmlExportError).problems)
  })

  it('文档元数据有题名时：render 返回 XML 字符串，export 返回同一份 XML 与 warning/info', () => {
    const value = validDoc()
    value.meta.title = '契约测试标准'
    const xml = renderXml46687(value, labelsOf(value), options)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<standard')).toBe(true)
    const result = exportXml46687(value, labelsOf(value), options)
    expect(result.xml).toBe(xml)
    expect(result.problems.every((problem) => problem.severity !== 'error')).toBe(true)
  })

  it('输出边界错误：render 抛 UnsupportedOutputError；export 返回 xml:null 与逐条映射的问题', () => {
    const value = boundaryDoc()
    const expected = getOutputSupportProblems(value, 'XML46687')
    expect(expected.length).toBeGreaterThan(0)

    let thrown: unknown
    try { renderXml46687(value, labelsOf(value), options) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(UnsupportedOutputError)
    expect((thrown as UnsupportedOutputError).problems).toEqual(expected)

    const result = exportXml46687(value, labelsOf(value), options)
    expect(result.xml).toBeNull()
    expect(result.problems).toEqual(expected.map((problem) => ({
      code: 'unsupported-output', severity: 'error', nodeId: problem.nodeId, path: problem.path, message: problem.message,
    })))
    expect(result.problems.every((problem) => problem.code === 'unsupported-output')).toBe(true)
  })

  it('输出边界问题没有 nodeId 时，export 的问题也不带 nodeId 字段', () => {
    const value = validDoc()
    value.unsupportedContent = [{ nodeId: null, path: 'doc.body[0]', nodeType: 'mystery', reason: '不能表达' }]
    const result = exportXml46687(value, labelsOf(value), options)
    expect(result.xml).toBeNull()
    expect(result.problems).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(result.problems[0], 'nodeId')).toBe(false)
    expect(result.problems[0]).toMatchObject({ code: 'unsupported-output', severity: 'error', path: 'doc.body[0]' })
  })

  it('脚注错误：render 抛朴素 Error（不是 UnsupportedOutputError）；export 返回 invalid-footnote 问题', () => {
    const value = footnoteDoc()
    let thrown: unknown
    try { renderXml46687(value, labelsOf(value), options) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(UnsupportedOutputError)
    expect((thrown as Error).message).toContain('脚注关联无效')

    const result = exportXml46687(value, labelsOf(value), options)
    expect(result.xml).toBeNull()
    expect(result.problems).toEqual([
      { code: 'invalid-footnote', severity: 'error', path: 'doc', message: (thrown as Error).message.replace(/^render: /, '') },
    ])
    expect(result.problems[0]!.message).not.toMatch(/^render:/)
  })

  it('传入 labels 与 Resolver 不一致的脚注同样走脚注问题', () => {
    const value = doc([{ text: '正文', footnote: { id: 'fn1', content: [{ text: '内容' }] } }])
    expect(() => renderXml46687(value, {}, options)).toThrow('传入 labels 与 Resolver 不一致')
    const result = exportXml46687(value, {}, options)
    expect(result.xml).toBeNull()
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toMatchObject({ code: 'invalid-footnote', severity: 'error' })
    expect(result.problems[0]!.message).toContain('fn1')
  })

  it('两类错误同时存在：脚注核对在前，render 抛脚注错误，export 只返回脚注问题（不再评估输出边界）', () => {
    const value = bothDoc()
    expect(getOutputSupportProblems(value, 'XML46687').length).toBeGreaterThan(0)

    let thrown: unknown
    try { renderXml46687(value, labelsOf(value), options) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(UnsupportedOutputError)
    expect((thrown as Error).message).toContain('脚注关联无效')

    const result = exportXml46687(value, labelsOf(value), options)
    expect(result.xml).toBeNull()
    expect(result.problems.map((problem) => problem.code)).toEqual(['invalid-footnote'])
  })

  it('入口断言之外的意外异常不被吞成问题：export 原样抛出', () => {
    const broken = { schemaVersion: 1 } as unknown as IRDoc
    expect(() => exportXml46687(broken, {}, options)).toThrow(TypeError)
    expect(() => renderXml46687(broken, {}, options)).toThrow(TypeError)
  })
})
