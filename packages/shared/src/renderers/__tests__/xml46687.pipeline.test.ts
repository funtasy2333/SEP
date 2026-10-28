import { describe, expect, it } from 'vitest'
import { XmlExportError, buildXml46687Document, exportXml46687, renderXml46687, type RenderXml46687Options } from '../xml46687'
import { EMPTY_OPTIONS, chapter, codesOf, deepFreeze, exportDoc, find, labelsOf, makeDoc, para, renderOk, run } from './xml46687Kit'
import { skeletonDoc } from './xml46687SkeletonFixture'

/** 管线 P0～P5 与 7.3 的幂等/不变性质（WP8.2 设计 §2.0.1、§7.3）。 */

const tiny = () => makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')])

describe('入口与失败方式（P0、P5）', () => {
  it('renderXml46687 与 exportXml46687 对同一输入给出同一份 XML；render 返回字符串、export 返回 { xml, problems }', () => {
    const doc = tiny()
    const labels = labelsOf(doc)
    const text = renderXml46687(doc, labels, EMPTY_OPTIONS)
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(typeof text).toBe('string')
    expect(result.xml).toBe(text)
    expect(result.problems.every(problem => problem.severity !== 'error')).toBe(true)
  })

  it('有 error 时 renderXml46687 抛 XmlExportError，携带全部问题（含 warning 与 info），exportXml46687 返回 xml:null 与同一份问题', () => {
    const doc = makeDoc([chapter('ch1', '范围', [para('p1', run('链', { type: 'externalLink', href: 'javascript:1' })), para('p2', run('x', { type: 'variable', kind: 'k' }))], 'scope')])
    const labels = labelsOf(doc)
    let thrown: unknown
    try { renderXml46687(doc, labels, EMPTY_OPTIONS) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(XmlExportError)
    const problems = (thrown as XmlExportError).problems
    expect(codesOf(problems, 'error')).toEqual(['xml-link-protocol'])
    expect(codesOf(problems, 'warning')).toContain('variable-attr-not-expressed')
    expect(codesOf(problems, 'info')).toContain('meta-not-expressed')
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(result.xml).toBeNull()
    expect(result.problems).toEqual(problems)
    expect((thrown as XmlExportError).message).toContain('javascript:1')
  })

  it('xml-write-failed：写出器拒绝的字符（XML 1.0 不允许的控制字符）被包装成问题，不抛 XmlWriteError', () => {
    const doc = makeDoc([chapter('ch1', '范围', [para('p1', '坏\u0001字符')], 'scope')])
    const result = exportDoc(doc)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-write-failed')).toHaveLength(1)
    expect(find(result.problems, 'xml-write-failed')[0]).toMatchObject({ severity: 'error' })
    expect(find(result.problems, 'xml-write-failed')[0]!.path.startsWith('xml:')).toBe(true)
    expect(find(result.problems, 'xml-write-failed')[0]!.message).toContain('U+0001')
    expect(() => renderXml46687(doc, labelsOf(doc), EMPTY_OPTIONS)).toThrow(XmlExportError)
  })

  it('options 的形状错误是编程错误：抛 TypeError（mathml 不是对象、值不是字符串、resources 缺 entries）', () => {
    const doc = tiny()
    const labels = labelsOf(doc)
    const bad = (options: unknown) => () => exportXml46687(doc, labels, options as RenderXml46687Options)
    expect(bad(undefined)).toThrow(TypeError)
    expect(bad({ resources: EMPTY_OPTIONS.resources })).toThrow(TypeError)
    expect(bad({ mathml: [], resources: EMPTY_OPTIONS.resources })).toThrow(TypeError)
    expect(bad({ mathml: { f1: 3 }, resources: EMPTY_OPTIONS.resources })).toThrow(TypeError)
    expect(bad({ mathml: {} })).toThrow(TypeError)
    expect(bad({ mathml: {}, resources: { version: 1 } })).toThrow(TypeError)
  })

  it('buildXml46687Document：返回写出前的 XmlDocument（可 JSON 往返无损）与全部问题，不做入口断言、不写出文本', () => {
    const doc = skeletonDoc()
    const { document, problems } = buildXml46687Document(doc, labelsOf(doc), EMPTY_OPTIONS)
    expect(document.root.name).toEqual({ ns: null, local: 'standard' })
    expect(document.doctype).toBeUndefined()
    expect(JSON.parse(JSON.stringify(document))).toEqual(document)
    expect(codesOf(problems, 'error')).toEqual([])
  })
})

describe('确定性与不变性（设计 §7.3）', () => {
  it('同一输入连续渲染两次，字符串逐字节相同；export 同', () => {
    const doc = skeletonDoc()
    const labels = labelsOf(doc)
    const first = exportXml46687(doc, labels, EMPTY_OPTIONS)
    const second = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(second.xml).toBe(first.xml)
    expect(second.problems).toEqual(first.problems)
    expect(first.xml).not.toBeNull()
  })

  it('不修改输入：渲染前后 doc、labels、options 的 JSON 相同；递归冻结的副本也能渲染', () => {
    const doc = skeletonDoc()
    const labels = labelsOf(doc)
    const options: RenderXml46687Options = { mathml: { f1: '<mml:math/>' }, resources: { version: 1, entries: [] } }
    const before = JSON.stringify({ doc, labels, options })
    const expected = exportXml46687(doc, labels, options)
    expect(JSON.stringify({ doc, labels, options })).toBe(before)
    const frozen = deepFreeze(JSON.parse(before) as { doc: typeof doc; labels: typeof labels; options: typeof options })
    const result = exportXml46687(frozen.doc, frozen.labels, frozen.options)
    expect(result.xml).toBe(expected.xml)
  })

  it('键序无关：打乱 labels 的键序与 options.mathml 的键序，输出不变（渲染器按 IR 文档序取值，不遍历对象键）', () => {
    const doc = skeletonDoc()
    const labels = labelsOf(doc)
    const shuffled = Object.fromEntries(Object.entries(labels).reverse())
    const mathml = { b: '<x/>', a: '<y/>' }
    const reversedMathml = { a: '<y/>', b: '<x/>' }
    const one = exportXml46687(doc, labels, { mathml, resources: EMPTY_OPTIONS.resources })
    const two = exportXml46687(doc, shuffled, { mathml: reversedMathml, resources: EMPTY_OPTIONS.resources })
    expect(two.xml).toBe(one.xml)
    expect(two.problems).toEqual(one.problems)
  })
})

describe('输出外形（设计 §2.0.2）', () => {
  const { xml } = renderOk(skeletonDoc())

  it('[M-5.1-08] 内容布局不使用空格和制表符实现：含文本或行内元素的元素（p、title、label…）逐字写出，不被缩进空白污染', () => {
    // 只含一个 xref 的 p 也在一行内（preserveSpace 看树结构，不看是否有文本节点）
    const only = renderOk(makeDoc([chapter('ch1', '范围', [
      para('p1', run('条', { type: 'crossRef', targetId: 'c1', targetKind: 'clause' })),
      { kind: 'clause', id: 'c1', level: 1, titled: true, title: [{ text: '条' }], children: [para('p0', '正文')] },
    ], 'scope')])).xml
    expect(only).toMatch(/<p><xref ref-type="sec" rid="sec_1\.1">1\.1<\/xref><\/p>/)
    for (const match of xml.matchAll(/<(p|title|label)>([\s\S]*?)<\/\1>/g)) {
      expect(match[2], match[0]).not.toMatch(/^\s|\s$|\n\s/)
    }
  })

  it('属性次序固定：id → sec-type/content-type/list-type/ref-type/custom-type → rid → xlink:href', () => {
    expect(xml).toContain('<sec id="sec_1" sec-type="scope">')
    expect(xml).toContain('<app id="sec_A" content-type="informative">')
    expect(xml).toContain('<xref ref-type="custom" custom-type="note" rid="note_3">')
    expect(xml).toContain('<ext-link ext-link-type="uri" xlink:href="https://example.org/">')
  })

  it('没有 DOCTYPE、tex-math、alternatives，没有以 ext_ 开头的 id/rid/target', () => {
    expect(xml).not.toMatch(/<!DOCTYPE|tex-math|alternatives/)
    expect(xml).not.toMatch(/\b(?:id|rid|target)="ext_/)
  })
})
