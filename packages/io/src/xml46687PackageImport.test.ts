import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
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
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
const imageBytes = Uint8Array.from(atob(pngBase64), char => char.charCodeAt(0))
const bmpBytes = new Uint8Array(58)
const bmpView = new DataView(bmpBytes.buffer)
bmpBytes.set([0x42, 0x4d])
bmpView.setUint32(2, bmpBytes.length, true)
bmpView.setUint32(10, 54, true)
bmpView.setUint32(14, 40, true)
bmpView.setInt32(18, 1, true)
bmpView.setInt32(22, 1, true)
bmpView.setUint16(26, 1, true)
bmpView.setUint16(28, 24, true)
bmpView.setUint32(34, 4, true)
bmpBytes.set([0x00, 0x00, 0xff, 0x00], 54)
const bmpBase64 = btoa(String.fromCharCode(...bmpBytes))
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
    expect(pmToIr(schema.nodeFromJSON(result.pmDoc!).toJSON()).doc.resources).toEqual([expect.objectContaining({ data: `data:image/png;base64,${pngBase64}`, mediaType: 'image/png' })])
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
    const crcFailure = await importXml46687Package(corrupted, options())
    expect(crcFailure.pmDoc).toBeNull()
    expect(crcFailure.problems[0]?.message).toContain('CRC')
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
  it('自定义 resolver 已返回持久资源时不分配多余的包 data URL', async () => {
    const bytes = await make()
    const encode = vi.spyOn(globalThis, 'btoa')
    try {
      const result = await importXml46687Package(bytes, { ...options(), resolveResource: async () => ({ src: 'https://example.org/image.png', mediaType: 'image/png' }) })
      expect(result.pmDoc).not.toBeNull()
      expect(encode).not.toHaveBeenCalled()
    } finally { encode.mockRestore() }
  })
  it('合法 image/* 子类型经资源包导入、生产 Schema 保存重开后保留 MIME 和原始字节', async () => {
    const bmpEntry = { ...entry, fileName: 'picture.bmp', mediaType: 'image/bmp' }
    const bytes = await packageXml46687(imageXml, { version: 1, entries: [bmpEntry] }, { 'picture.bmp': bmpBytes })
    const result = await importXml46687Package(bytes, options())
    expect(result.problems.filter(problem => problem.severity === 'error')).toEqual([])
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(result.pmDoc)))
    reopened.check()
    expect(pmToIr(reopened.toJSON()).doc.resources).toEqual([
      expect.objectContaining({ encoding: 'dataUrl', data: `data:image/bmp;base64,${bmpBase64}`, mediaType: 'image/bmp' }),
    ])
  })
  it.each([
    ['非图片 MIME', 'text/html'],
    ['语法无效的图片子类型', 'image/not valid'],
  ])('资源包仍拒绝%s', async (_label, mediaType) => {
    const bytes = await make([{ ...entry, mediaType }])
    const result = await importXml46687Package(bytes, options())
    expect(result.pmDoc).toBeNull()
    expect(result.problems[0]?.code).toBe('xml-unsupported')
  })
  it('清单和实际文件必须一一对应，并拒绝含歧义的文件名回退', async () => {
    const manifest = (entries: unknown[]) => JSON.stringify({ format: 'GB/T 46687.2—2026 XML', version: 1, xml: 'standard.xml', entries })
    const noXml = new JSZip(); noXml.file('manifest.json', manifest([]))
    expect((await importXml46687Package(await noXml.generateAsync({ type: 'uint8array' }), options())).problems[0]?.code).toBe('xml-unsupported')
    const extra = new JSZip(); extra.file('standard.xml', xml); extra.file('manifest.json', manifest([])); extra.file('resources/extra.png', imageBytes, { createFolders: false })
    expect((await importXml46687Package(await extra.generateAsync({ type: 'uint8array' }), options())).problems[0]?.code).toBe('xml-unsupported')
    const ambiguous = new JSZip()
    ambiguous.file('standard.xml', imageXml.replace('xlink:href="picture"', 'xlink:href="dir/picture"'))
    ambiguous.file('manifest.json', manifest([{ ...entry, href: 'one/picture' }, { ...entry, href: 'two/picture', fileName: 'other.png' }]))
    ambiguous.file('resources/picture.png', imageBytes, { createFolders: false }); ambiguous.file('resources/other.png', imageBytes, { createFolders: false })
    const result = await importXml46687Package(await ambiguous.generateAsync({ type: 'uint8array' }), options())
    expect(result.pmDoc).toBeNull(); expect(result.problems[0]?.message).toContain('歧义')
  })
  it('拒绝本地文件名与中央目录不一致', async () => {
    const bytes = await packageXml46687(xml, { version: 1, entries: [] }, {})
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const nameAt = 30
    expect(new TextDecoder().decode(bytes.subarray(nameAt, nameAt + view.getUint16(26, true)))).toBe('standard.xml')
    bytes[nameAt] = 'S'.charCodeAt(0)
    const result = await importXml46687Package(bytes, options())
    expect(result.pmDoc).toBeNull(); expect(result.problems[0]?.message).toContain('文件名')
  })
  it('拒绝压缩包声称小于实际解压量的资源', async () => {
    const z = new JSZip(); z.file('standard.xml', xml); z.file('manifest.json', JSON.stringify({ format: 'GB/T 46687.2—2026 XML', version: 1, xml: 'standard.xml', entries: [entry] })); z.file('resources/picture.png', new Uint8Array(48 * 1024 * 1024), { createFolders: false })
    const bytes = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) {
      const n = view.getUint16(i + 28, true); const name = new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + n))
      if (name === 'resources/picture.png') { view.setUint32(i + 24, 1, true); const local = view.getUint32(i + 42, true); view.setUint32(local + 22, 1, true) }
    }
    // 观察真实 JSZip 流，而非替换解压；超过预算时必须调用 pause，且不把后续数据存入结果。
    const req = createRequire(import.meta.url)
    const helper = req('jszip/lib/stream/StreamHelper') as { prototype: { on: (...args: any[]) => any; pause: (...args: any[]) => any } }
    const originalOn = helper.prototype.on
    let emitted = 0, afterPause = 0, paused = false
    const on = vi.spyOn(helper.prototype, 'on').mockImplementation(function (this: unknown, event: string, listener: (...args: any[]) => void) {
      return originalOn.call(this, event, event === 'data' ? (chunk: Uint8Array, ...args: any[]) => {
        emitted += chunk.length
        if (paused) afterPause += chunk.length
        listener(chunk, ...args)
      } : listener)
    })
    const originalPause = helper.prototype.pause
    const pause = vi.spyOn(helper.prototype, 'pause').mockImplementation(function (this: unknown) {
      paused = true
      return originalPause.call(this)
    })
    try {
      const result = await importXml46687Package(bytes, options())
      expect(result.pmDoc).toBeNull(); expect(result.problems[0].code).toBe('xml-limit')
      expect(paused).toBe(true)
      expect(emitted).toBeGreaterThan(32 * 1024 * 1024)
      expect(afterPause).toBeLessThanOrEqual(17 * 1024 * 1024)
    } finally { on.mockRestore(); pause.mockRestore() }
  })
})
