import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { pmToIr } from '@ses/shared'
import { createEditorSchema } from '../../client/src/extensions/editorSchema'
import type { ContentValidator } from './documentOps/types'
import { packageXml46687 } from './xml46687Package'
import { importXml46687Package } from './xml46687PackageImport'

const xml = readFileSync(resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')
const schema = createEditorSchema()
const validateContent: ContentValidator = content => {
  try { const node = schema.nodeFromJSON(content); node.check(); return { ok: true, content: node.toJSON() } }
  catch { return { ok: false, message: '生产 Schema 不接受文档' } }
}
const options = () => { let i = 0; return { validateContent, generateId: () => `id${++i}` } }
const imageXml = xml.replace('</p>', '</p><fig id="opaque"><label>图1</label><caption><title>图题</title></caption><graphic content-type="image" xlink:href="picture"/></fig>')
const entry = { href: 'picture', key: 'image', fileName: 'picture.png', mediaType: 'image/png', source: 'resource' as const }
const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const make = async (entries = [entry]) => packageXml46687(imageXml, { version: 1, entries }, { 'picture.png': imageBytes })

describe('XML 资源包导入', () => {
  it('无资源包经生产 Schema 保存重开', async () => {
    const bytes = await packageXml46687(xml, { version: 1, entries: [] }, {})
    const before = bytes.slice()
    const result = await importXml46687Package(bytes, options())
    expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(result.pmDoc)))
    reopened.check()
    expect(pmToIr(reopened.toJSON()).doc.body[0]?.children[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '本文件给出一个只含必需结构的最小文档。' }] })
    expect(bytes).toEqual(before)
  })
  it('真实图片字节保存为 data URL，resolver 获得独立副本且不覆盖调用者资源', async () => {
    const bytes = await make(); const supplied = new Map([['picture', { src: 'https://example.org/wrong', mediaType: 'image/png' }]])
    const result = await importXml46687Package(bytes, { ...options(), resources: supplied, resolveResource: async request => {
      expect(request).toMatchObject({ href: 'picture', mediaType: 'image/png', bytes: imageBytes })
      request.bytes![0] = 0
      return null
    } })
    expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
    expect(pmToIr(schema.nodeFromJSON(result.pmDoc!).toJSON()).doc.resources).toEqual([expect.objectContaining({ data: 'data:image/png;base64,iVBORw0KGgo=', mediaType: 'image/png' })])
    expect(supplied.get('picture')!.src).toBe('https://example.org/wrong')
  })
  it('缺少元数据或资源时阻断', async () => {
    const zip = new JSZip(); zip.file('standard.xml', xml)
    const missingManifest = await importXml46687Package(await zip.generateAsync({ type: 'uint8array' }), options())
    expect(missingManifest.pmDoc).toBeNull(); expect(missingManifest.problems[0].code).toBe('xml-unsupported')
    const z = await JSZip.loadAsync(await make()); z.remove('resources/picture.png')
    const missingImage = await importXml46687Package(await z.generateAsync({ type: 'uint8array' }), options())
    expect(missingImage.pmDoc).toBeNull(); expect(missingImage.problems[0].code).toBe('xml-resource-missing')
  })
  it('拒绝危险原始路径、大小写碰撞及不受支持的清单', async () => {
    const z = new JSZip(); z.file('../standard.xml', xml); z.file('manifest.json', '{}')
    expect((await importXml46687Package(await z.generateAsync({ type: 'uint8array' }), options())).pmDoc).toBeNull()
    const duplicate = new JSZip(); duplicate.file('standard.xml', xml); duplicate.file('STANDARD.XML', xml); duplicate.file('manifest.json', '{}')
    expect((await importXml46687Package(await duplicate.generateAsync({ type: 'uint8array' }), options())).pmDoc).toBeNull()
    const invalid = new JSZip(); invalid.file('standard.xml', xml); invalid.file('manifest.json', '{"version":1,"entries":[]}')
    expect((await importXml46687Package(await invalid.generateAsync({ type: 'uint8array' }), options())).pmDoc).toBeNull()
  })
  it('无效 options 返回中文错误，自定义 resolver 抛错继续向调用方传播', async () => {
    const bytes = await make()
    const absent = await importXml46687Package(bytes, undefined as never)
    expect(absent.problems[0]?.code).toBe('xml-schema-invalid')
    const badResolver = await importXml46687Package(bytes, { ...options(), resolveResource: 123 as never })
    expect(badResolver.problems[0]?.code).toBe('xml-resource-missing')
    const thrown = new Error('调用方失败')
    await expect(importXml46687Package(bytes, { ...options(), resolveResource: async () => { throw thrown } })).rejects.toBe(thrown)
  })
  it('导出器生成 UTF-8 资源文件名仍可导入', async () => {
    const chinese = { ...entry, fileName: '图.png' }
    const bytes = await packageXml46687(imageXml, { version: 1, entries: [chinese] }, { '图.png': imageBytes })
    const result = await importXml46687Package(bytes, options())
    expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
    expect(result.pmDoc).not.toBeNull()
  })
  it('拒绝数据描述符模式下本地头与中央目录冲突', async () => {
    const zip = new JSZip()
    zip.file('standard.xml', xml)
    zip.file('manifest.json', JSON.stringify({ format: 'GB/T 46687.2—2026 XML', version: 1, xml: 'standard.xml', entries: [] }))
    const bytes = await zip.generateAsync({ type: 'uint8array', streamFiles: true })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    view.setUint32(22, 123, true)
    const result = await importXml46687Package(bytes, options())
    expect(result.pmDoc).toBeNull()
    expect(result.problems[0]?.code).toBe('xml-unsupported')
  })
  it('拒绝伪造 CRC 和重复的原始中央目录名称', async () => {
    const zip = new JSZip()
    zip.file('standard.xml', xml); zip.file('manifest.json', '{}')
    const original = await zip.generateAsync({ type: 'uint8array' })
    const corrupted = original.slice(), view = new DataView(corrupted.buffer)
    const firstContent = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    corrupted[firstContent] ^= 1
    expect((await importXml46687Package(corrupted, options())).pmDoc).toBeNull()
    const dupZip = new JSZip(); dupZip.file('a.xml', xml); dupZip.file('b.xml', xml)
    const duplicate = await dupZip.generateAsync({ type: 'uint8array' })
    const dv = new DataView(duplicate.buffer)
    for (let i = 0; i < duplicate.length - 46; i++) {
      if (dv.getUint32(i, true) !== 0x02014b50 || new TextDecoder().decode(duplicate.subarray(i + 46, i + 51)) !== 'b.xml') continue
      duplicate[i + 46] = 97
      duplicate[dv.getUint32(i + 42, true) + 30] = 97
    }
    const result = await importXml46687Package(duplicate, options())
    expect(result.pmDoc).toBeNull()
    expect(result.problems[0]?.message).toContain('重复')
  })
  it('拒绝压缩包声称小于实际解压量的资源', async () => {
    const z = new JSZip(); z.file('standard.xml', xml); z.file('manifest.json', JSON.stringify({ format: 'GB/T 46687.2—2026 XML', version: 1, xml: 'standard.xml', entries: [entry] })); z.file('resources/picture.png', new Uint8Array(33 * 1024 * 1024), { createFolders: false })
    const bytes = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) {
      const n = view.getUint16(i + 28, true); const name = new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + n))
      if (name === 'resources/picture.png') { view.setUint32(i + 24, 1, true); const local = view.getUint32(i + 42, true); view.setUint32(local + 22, 1, true) }
    }
    const result = await importXml46687Package(bytes, options())
    expect(result.pmDoc).toBeNull(); expect(result.problems[0].code).toBe('xml-limit')
  })
})
