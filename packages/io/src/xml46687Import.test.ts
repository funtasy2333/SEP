import { PNG_URL } from './__testHelpers__/wp83ImportCases'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pmToIr } from '@ses/shared'
import { createEditorSchema } from '../../client/src/extensions/editorSchema'
import type { ContentValidator } from './documentOps/types'
import { importXml46687 } from './xml46687Import'

const xml = readFileSync(resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')
const schema = createEditorSchema()
const validator: ContentValidator = content => {
  try {
    const node = schema.nodeFromJSON(content)
    node.check()
    return { ok: true, content: node.toJSON() }
  } catch {
    return { ok: false, message: '生产 Schema 不接受文档' }
  }
}
it('最小 XML 经生产 Schema 保存重开并保留正文', async () => {
  let serial = 0
  const options = { validateContent: validator, generateId: () => `id${++serial}` }
  const result = await importXml46687(xml, options)
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(result.pmDoc).not.toBeNull()
  const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(result.pmDoc)))
  reopened.check()
  expect(pmToIr(reopened.toJSON()).doc.body[0]?.children[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '本文件给出一个只含必需结构的最小文档。' }] })
})
it('无效 XML 和缺少校验器阻断导入', async () => {
  const invalid = await importXml46687('<!DOCTYPE standard><standard/>', { validateContent: validator })
  expect(invalid.pmDoc).toBeNull()
  expect(invalid.problems[0]?.code).toBe('xml-forbidden-doctype')
  const missing = await importXml46687(xml, {} as never)
  expect(missing.pmDoc).toBeNull()
  expect(missing.problems[0]?.code).toBe('xml-schema-invalid')
})

it('图片缺资源阻断；准备的 data URL 真实写入资源节点并在保存重开后保留', async () => {
  const imageXml = xml.replace('</p>', '</p><fig id="opaque"><label>图1</label><caption><title>图题</title></caption><graphic content-type="image" xlink:href="picture"/></fig>')
  let n = 0
  const missing = await importXml46687(imageXml, { validateContent: validator, generateId: () => `a${++n}` })
  expect(missing.pmDoc).toBeNull()
  expect(missing.problems.map(p => p.code)).toContain('xml-resource-missing')
  const data = PNG_URL
  const resources = new Map([['picture', Object.freeze({ src: data, mediaType: 'image/png' })]])
  n = 0
  const result = await importXml46687(imageXml, { validateContent: validator, generateId: () => `a${++n}`, resources })
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(result.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', severity: 'warning', message: expect.stringContaining('空替代文字') }))
  const doc = pmToIr(schema.nodeFromJSON(JSON.parse(JSON.stringify(result.pmDoc))).toJSON()).doc
  expect(doc.resources).toEqual([expect.objectContaining({ encoding: 'dataUrl', data, mediaType: 'image/png' })])
  expect(resources.get('picture')).toEqual({ src: data, mediaType: 'image/png' })
})

it('异步 resolver 获得原始 href，且缺失资源不会调用生产校验', async () => {
  const imageXml = xml.replace('</p>', '</p><fig id="opaque"><label>图1</label><caption><title>图题</title></caption><graphic content-type="image" xlink:href="picture"/></fig>')
  let calls = 0
  let n = 0
  const result = await importXml46687(imageXml, {
    validateContent: validator,
    generateId: () => `id${++n}`,
    resolveResource: async request => {
      calls++
      expect(request).toMatchObject({ href: 'picture', basename: 'picture', kind: 'graphic' })
      return { src: PNG_URL, mediaType: 'image/png' }
    },
  })
  expect(result.pmDoc).not.toBeNull()
  expect(calls).toBe(1)
  let validatorCalls = 0
  const missing = await importXml46687(imageXml, { validateContent: () => { validatorCalls++; return { ok: true } } })
  expect(missing.pmDoc).toBeNull()
  expect(validatorCalls).toBe(0)
})

it('临时 blob 地址不能作为可持久资源', async () => {
  const imageXml = xml.replace('</p>', '</p><fig id="opaque"><label>图1</label><caption><title>图题</title></caption><graphic content-type="image" xlink:href="picture"/></fig>')
  const result = await importXml46687(imageXml, { validateContent: validator, resources: new Map([['picture', { src: 'blob:temporary', mediaType: 'image/png' }]]) })
  expect(result.pmDoc).toBeNull()
  expect(result.problems.map(p => p.code)).toContain('xml-resource-missing')
})

it('生产校验更改引用身份时回检拒绝且不污染原始输入', async () => {
  const altered: ContentValidator = content => {
    const copy = JSON.parse(JSON.stringify(content))
    const visit = (node: { attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (node.attrs?.nodeId) node.attrs.nodeId = 'changed-id'
      else node.content?.forEach(child => visit(child as typeof node))
    }
    visit(copy)
    return { ok: true, content: copy }
  }
  const original = xml
  const result = await importXml46687(xml, { validateContent: altered })
  expect(result.pmDoc).toBeNull()
  expect(result.problems).toContainEqual(expect.objectContaining({ code: 'xml-roundtrip-loss', path: expect.stringMatching(/id/) }))
  expect(xml).toBe(original)
})

it('生成器的重复值和派生段落 ID 冲突必须在生产校验前阻断', async () => {
  let calls = 0
  const validation: ContentValidator = () => { calls++; return { ok: true } }
  const duplicate = await importXml46687(xml, { validateContent: validation, generateId: () => 'same' })
  expect(duplicate.pmDoc).toBeNull()
  expect(duplicate.problems.map(p => p.code)).toContain('xml-node-id-duplicate')
  let sequence = 0
  const collision = await importXml46687(xml, { validateContent: validation, generateId: () => ++sequence === 1 ? 'owner' : sequence === 2 ? 'owner.p0' : `id${sequence}` })
  expect(collision.pmDoc).toBeNull()
  expect(collision.problems.map(p => p.code)).toContain('xml-node-id-duplicate')
  expect(calls).toBe(0)
})

it('同一资源 ID 对应同一内容的多个 href 共享资源身份，冲突内容则拒绝', async () => {
  const imageXml = xml.replace('</p>', '</p><fig id="one"><label>图1</label><caption><title>甲</title></caption><graphic content-type="image" xlink:href="a"/></fig><fig id="two"><label>图2</label><caption><title>乙</title></caption><graphic content-type="image" xlink:href="b"/></fig>')
  const item = { src: PNG_URL, mediaType: 'image/png', resourceId: 'shared-resource' }
  const result = await importXml46687(imageXml, { validateContent: validator, resources: new Map([['a', item], ['b', item]]) })
  expect(result.pmDoc).not.toBeNull()
  expect(pmToIr(result.pmDoc!).doc.resources).toHaveLength(1)
  const conflict = await importXml46687(imageXml, { validateContent: validator, resources: new Map([['a', item], ['b', { ...item, src: 'data:image/png;base64,AA==' }]]) })
  expect(conflict.pmDoc).toBeNull()
  expect(conflict.problems.map(p => p.code)).toContain('xml-node-id-duplicate')
})

it('标记排序比较仍会拒绝丢失或更改标记', async () => {
  const marked = xml.replace('本文件给出一个只含必需结构的最小文档。', '<bold><italic>保留样式</italic></bold>')
  const altered: ContentValidator = content => {
    const copy = JSON.parse(JSON.stringify(content))
    const visit = (node: { marks?: { type: string }[]; content?: unknown[] }): void => {
      if (node.marks?.length) node.marks.pop()
      else node.content?.forEach(child => visit(child as typeof node))
    }
    visit(copy)
    return { ok: true, content: copy }
  }
  const result = await importXml46687(marked, { validateContent: altered })
  expect(result.pmDoc).toBeNull()
  expect(result.problems.map(p => p.code)).toContain('xml-roundtrip-loss')
})

describe('图片资源校验', () => {
  const imageXml = xml.replace('</p>', '</p><fig id="opaque"><label>图1</label><caption><title>图题</title></caption><graphic content-type="image" xlink:href="picture"/></fig>')
  it.each([
    ['空数据', { src: 'data:image/png;base64,', mediaType: 'image/png' }],
    ['错误填充位', { src: 'data:image/png;base64,AB==', mediaType: 'image/png' }],
    ['非图片 MIME', { src: 'data:text/html;base64,PGgxPg==', mediaType: 'text/html' }],
    ['伪造 HTTP 地址', { src: 'http://', mediaType: 'image/png' }],
    ['URL 控制字符', { src: 'https://example.com/\nimage.png', mediaType: 'image/png' }],
    ['src 类型错误', { src: 23, mediaType: 'image/png' }],
    ['MIME 类型错误', { src: 'https://example.com/image.png', mediaType: 4 }],
    ['resourceId 类型错误', { src: 'data:image/png;base64,AA==', mediaType: 'image/png', resourceId: 1 }],
  ])('拒绝%s', async (_name, resource) => {
    const result = await importXml46687(imageXml, { validateContent: validator, resources: new Map([['picture', resource]]) as never })
    expect(result.pmDoc).toBeNull()
    expect(result.problems.map(p => p.code)).toContain('xml-resource-missing')
  })
  it('无选项时返回 Schema 问题', async () => {
    expect(await importXml46687(xml, undefined as never)).toMatchObject({ pmDoc: null, problems: [{ code: 'xml-schema-invalid' }] })
  })
  it('拒绝大于 32 MiB 的图片而不先分配解码字节', async () => {
    const encoded = 'A'.repeat((32 * 1024 * 1024 + 1) * 4 / 3 + 4)
    const result = await importXml46687(imageXml, { validateContent: validator, resources: new Map([['picture', { src: `data:image/png;base64,${encoded}`, mediaType: 'image/png' }]]) })
    expect(result.pmDoc).toBeNull()
    expect(result.problems.map(p => p.code)).toContain('xml-resource-missing')
  })
  it('累计图片数据超过 128 MiB 时阻断', async () => {
    const base64 = 'A'.repeat(4 * Math.floor((32 * 1024 * 1024) / 3)) + 'AAA='
    const image = { src: `data:image/png;base64,${base64}`, mediaType: 'image/png' }
    const figures = Array.from({ length: 5 }, (_, i) => `<fig id="f${i}"><label>图${i + 1}</label><caption><title>题</title></caption><graphic content-type="image" xlink:href="p${i}"/></fig>`).join('')
    const manyXml = xml.replace('</p>', `</p>${figures}`)
    const resources = new Map(Array.from({ length: 5 }, (_, i) => [`p${i}`, image]))
    const result = await importXml46687(manyXml, { validateContent: validator, resources })
    expect(result.pmDoc).toBeNull()
    expect(result.problems.map(p => p.code)).toContain('xml-resource-missing')
  })
  it('损坏的资源容器和 resolver 选项返回资源问题', async () => {
    for (const bad of [{ resources: {} }, { resolveResource: 'not-a-function' }]) {
      const result = await importXml46687(imageXml, { validateContent: validator, ...bad } as never)
      expect(result.pmDoc).toBeNull()
      expect(result.problems.map(p => p.code)).toContain('xml-resource-missing')
    }
  })
  it('resolver 抛出的意外异常传播', async () => {
    await expect(importXml46687(imageXml, { validateContent: validator, resolveResource: async () => { throw new Error('resolver failure') } })).rejects.toThrow('resolver failure')
  })
})
