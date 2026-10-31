import { expect, it } from 'vitest'
import * as io from './index'

it('资源包导入入口从公共 io 包导出', () => {
  expect(io.importXml46687Package).toBeTypeOf('function')
})

it('包 resolver 的非图片 MIME 被纯 XML 层拒绝且保留调用者字节', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { createEditorSchema } = await import('../../client/src/extensions/editorSchema')
  const xml = readFileSync(resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')
    .replace('</p>', '</p><fig id="opaque"><label>图1</label><caption><title>图题</title></caption><graphic content-type="image" xlink:href="picture"/></fig>')
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL6UAAAAASUVORK5CYII='), c => c.charCodeAt(0))
  const zip = await io.packageXml46687(xml, { version: 1, entries: [{ href: 'picture', key: 'img', fileName: 'picture.png', mediaType: 'image/png', source: 'resource' }] }, { 'picture.png': png })
  const before = zip.slice()
  const schema = createEditorSchema()
  let calls = 0
  const result = await io.importXml46687Package(zip, {
    validateContent: content => { const node = schema.nodeFromJSON(content); node.check(); return { ok: true, content: node.toJSON() } },
    resolveResource: async request => {
      calls++
      expect(request.mediaType).toBe('image/png')
      expect(request.bytes).toEqual(png)
      request.bytes![0] = 0
      return { src: 'data:text/html;base64,PGgxPg==', mediaType: 'text/html' }
    },
  })
  expect(calls).toBe(1)
  expect(result.pmDoc).toBeNull()
  expect(result.problems.map(p => p.code)).toContain('xml-resource-missing')
  expect(zip).toEqual(before)
})

it('包 resolver 无法绕过纯 XML 的单图片 32 MiB 限额', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const xml = readFileSync(resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')
    .replace('</p>', '</p><fig id="opaque"><label>图1</label><caption><title>图题</title></caption><graphic content-type="image" xlink:href="picture"/></fig>')
  const zip = await io.packageXml46687(xml, { version: 1, entries: [{ href: 'picture', key: 'img', fileName: 'picture.png', mediaType: 'image/png', source: 'resource' }] }, { 'picture.png': Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL6UAAAAASUVORK5CYII='), c => c.charCodeAt(0)) })
  let validationCalls = 0
  const encoded = 'A'.repeat(4 * Math.ceil((32 * 1024 * 1024 + 1) / 3))
  const result = await io.importXml46687Package(zip, {
    validateContent: () => { validationCalls++; return { ok: true } },
    resolveResource: async () => ({ src: `data:image/png;base64,${encoded}`, mediaType: 'image/png' }),
  })
  expect(result.pmDoc).toBeNull()
  expect(result.problems.map(p => p.code)).toContain('xml-resource-missing')
  expect(validationCalls).toBe(0)
})
