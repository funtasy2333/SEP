// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as io from '@ses/io'
import { parseXml46687, pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorSchema, normalizeNodeIds } from './editorSchema'
import { GOLDEN_NAMES, PNG_URL, alignHostIds, evidence, expectedGoldenXml, expectedTargetKind, importedMathShapes, mathShape, makeCase, nextIds, packageCase, sourceMathShapes, targetEntityKind } from '../../../io/src/__testHelpers__/wp83ImportCases'

const schema = createEditorSchema()
const validateContent: io.ContentValidator = content => {
  try { const node = schema.nodeFromJSON(content); node.check(); return { ok: true, content: normalizeNodeIds(node).toJSON() as PMJsonNode } }
  catch (error) { return { ok: false, message: String(error) } }
}
const readGolden = (name: string) => readFileSync(pathResolve(process.cwd(), '../../packages/shared/src/renderers/__tests__/__snapshots__', `xml46687.${name}.xml`), 'utf8')
const packageImport = (io as typeof io & { importXml46687Package: (bytes: Uint8Array, options: io.Xml46687ImportOptions) => Promise<io.Xml46687ImportResult> }).importXml46687Package

async function importCase(xml: string) {
  const input = makeCase(xml)
  const result = await io.importXml46687(xml, { validateContent, resources: input.resources, generateId: nextIds() })
  expect(result.problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(result.pmDoc).not.toBeNull()
  const saved = JSON.parse(JSON.stringify(result.pmDoc))
  const reopened = schema.nodeFromJSON(saved)
  reopened.check()
  const converted = pmToIr(reopened.toJSON() as PMJsonNode)
  expect(converted.warnings).toEqual([])
  expect(converted.doc.unsupportedContent ?? []).toEqual([])
  return { input, result, doc: converted.doc, pm: reopened.toJSON() as PMJsonNode }
}

describe('WP8.3 client：原版黄金 XML 和资源包', () => {
  it.each(GOLDEN_NAMES)('%s 导入生产 Schema 后内容、引用、图表术语和原生公式可保存重开', async name => {
    const { input, doc } = await importCase(readGolden(name))
    const data = evidence(doc)
    for (const reference of input.references) {
      const target = input.xmlIds.get(reference.rid)
      expect(target, `${reference.type}:${reference.rid}`).toBeDefined()
      expect(data.ids, reference.rid).toContain(target)
      expect(data.targets.filter(value => value === target).length, reference.rid).toBeGreaterThanOrEqual(input.references.filter(value => value.rid === reference.rid).length)
      const kind = expectedTargetKind(reference.type, reference.customType)
      if (kind) expect(targetEntityKind(doc, target!), reference.rid).toBe(kind)
    }
    for (const resource of doc.resources ?? []) expect(resource).toMatchObject({ mediaType: 'image/png', encoding: 'dataUrl', data: PNG_URL })
    expect(doc.resources?.length ?? 0).toBe(input.resources.size)
    for (const item of data.all) if (typeof item.resourceId === 'string') expect(doc.resources?.some(resource => resource.id === item.resourceId)).toBe(true)
    expect(data.figures.length).toBeGreaterThan(0)
    expect(data.tables.length).toBeGreaterThan(0)
    expect(data.terms.length).toBeGreaterThan(0)
    expect(importedMathShapes(doc)).toEqual(sourceMathShapes(input.xml))
  })

  it.each(GOLDEN_NAMES)('%s XML → Schema → IR → 导出与原字节一致，第二遍保持不变', async name => {
    const xml = readGolden(name)
    const first = await importCase(xml)
    const exported = await io.buildXml46687Package({ pmDoc: first.pm })
    expect(exported.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(exported.xml).toBe(expectedGoldenXml(name, xml))
    if (name === 'wp8m') expect(first.result.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', severity: 'warning', message: expect.stringContaining('多段') }))
    const second = await importCase(exported.xml!)
    const again = await io.buildXml46687Package({ pmDoc: second.pm })
    expect(again.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(again.xml).toBe(exported.xml)
  })

  it.each(GOLDEN_NAMES)('%s 原版 XML 与相同图片字节打包后可导入', async name => {
    const input = makeCase(readGolden(name))
    const bytes = await packageCase(input)
    const before = [...bytes]
    expect(typeof packageImport).toBe('function')
    const result = await packageImport(bytes, { validateContent, generateId: nextIds() })
    expect([...bytes]).toEqual(before)
    expect(result.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(result.pmDoc).not.toBeNull()
    const node = schema.nodeFromJSON(JSON.parse(JSON.stringify(result.pmDoc)))
    node.check()
    const doc = pmToIr(node.toJSON() as PMJsonNode).doc
    for (const resource of doc.resources ?? []) expect(resource).toMatchObject({ mediaType: 'image/png', encoding: 'dataUrl', data: PNG_URL })
    if (input.resources.size) expect(doc.resources?.length).toBeGreaterThan(0)
  })

  it('非法 XML 返回中文位置错误且不修改输入', async () => {
    const malformed = '<standard><front></standard>'
    const broken = await io.importXml46687(malformed, { validateContent, generateId: nextIds() })
    expect(broken.pmDoc).toBeNull()
    expect(broken.problems).toContainEqual(expect.objectContaining({ severity: 'error', code: expect.stringMatching(/^xml-/), message: expect.stringMatching(/[\u3400-\u9fff]/), xml: expect.objectContaining({ line: expect.any(Number), column: expect.any(Number) }) }))
    expect(malformed).toBe('<standard><front></standard>')
  })

  it('缺失资源返回中文位置错误且不修改资源表', async () => {
    const input = makeCase(readGolden('wp82'))
    const empty = new Map<string, { src: string; mediaType: string }>()
    const missing = await io.importXml46687(input.xml, { validateContent, resources: empty, generateId: nextIds() })
    expect(missing.pmDoc).toBeNull()
    expect(missing.problems).toContainEqual(expect.objectContaining({ severity: 'error', code: 'xml-resource-missing', message: expect.stringMatching(/[\u3400-\u9fff]/), xml: expect.objectContaining({ line: expect.any(Number) }) }))
    expect(empty.size).toBe(0)
  })

  it('损坏包返回中文错误且不修改输入', async () => {
    const bytes = Uint8Array.of(1, 2, 3)
    expect(typeof packageImport).toBe('function')
    const invalid = await packageImport(bytes, { validateContent, generateId: nextIds() })
    expect(invalid.pmDoc).toBeNull()
    expect(invalid.problems).toContainEqual(expect.objectContaining({ severity: 'error', code: expect.stringMatching(/^xml-/), message: expect.stringMatching(/[\u3400-\u9fff]/) }))
    expect([...bytes]).toEqual([1, 2, 3])
  })
})


describe('跨端保真比较辅助函数', () => {
  it('仅对齐节点身份与引用，不改与生成 ID 同值的正文及其他属性', () => {
    const candidate = { type: 'paragraph', attrs: { nodeId: 'random-a', title: 'random-a', targetId: 'random-a', resourceRefs: ['random-a'] }, content: [{ type: 'text', text: 'random-a' }] }
    const expected = { type: 'paragraph', attrs: { nodeId: 'random-b', title: 'random-a', targetId: 'random-b', resourceRefs: ['random-b'] }, content: [{ type: 'text', text: 'random-a' }] }
    expect(alignHostIds(candidate, expected)).toEqual(expected)
    expect(alignHostIds(candidate, expected)).not.toEqual({ ...expected, content: [{ type: 'text', text: 'random-b' }] })
  })

  it('MathML 比较保留继承的 xml:space 空白和内层 math 属性', () => {
    const parse = (xml: string) => { const result = parseXml46687(xml); expect(result.tree).not.toBeNull(); return mathShape(result.tree!.root) }
    const prefix = '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML" xml:space="preserve"><m:mrow>'
    const suffix = '</m:mrow></m:math>'
    expect(parse(`${prefix} <m:mi>x</m:mi>${suffix}`)).not.toEqual(parse(`${prefix}<m:mi>x</m:mi>${suffix}`))
    const outer = (space: string) => `<standard xml:space="${space}"><m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mrow> <m:mi>x</m:mi></m:mrow></m:math></standard>`
    expect(sourceMathShapes(outer('preserve'))).not.toEqual(sourceMathShapes(outer('default')))
    expect(parse(`${prefix}<m:math id="a" display="inline"><m:mi>x</m:mi></m:math>${suffix}`)).not.toEqual(parse(`${prefix}<m:math id="b" display="block"><m:mi>x</m:mi></m:math>${suffix}`))
  })
})
