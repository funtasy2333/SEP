/**
 * T2.5 (c)：XML46687 资源包（WP8.2 设计 §5.2 (c)、§5.3）。
 *
 * 本文件用真实的 shared 链路。`exportXml46687` 的渲染管线由 T2.4a-1 实现，在它合入之前入口断言之后仍是占位，
 * 所以这里只覆盖：打包函数 `packageXml46687`（直接测试）、`prepareXml46687Input`，以及“有 error 不出包”路径
 * （用会触发入口断言的文档——入口断言已实现，不依赖渲染器）。
 * 成功路径的编排（把 MathML 与清单交给渲染器、合并问题、打包）见 `xml46687Package.wiring.test.ts`（替换渲染器），
 * 真实渲染器的端到端（含 `validate.py`、`xlink:href` 与清单一一对应）见 `xml46687Package.e2e.test.ts`（T2.6）。
 */

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { DocumentMeta, PMJsonNode, ResourceManifest } from '@ses/shared'
import {
  XML46687_PACKAGE_FORMAT,
  buildXml46687Package,
  packageXml46687,
  prepareXml46687Input,
} from './xml46687Package'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<standard>标准</standard>\n'

function manifestOf(...entries: ResourceManifest['entries']): ResourceManifest {
  return { version: 1, entries }
}

const PNG_ENTRY = { href: 'fig_1', key: 'asset:a', fileName: 'fig_1.png', mediaType: 'image/png', source: 'src' } as const
const SVG_ENTRY = { href: 'inl_1', key: 'asset:b', fileName: 'inl_1.svg', mediaType: 'image/svg+xml', source: 'src' } as const

async function unzip(bytes: Uint8Array) {
  return JSZip.loadAsync(bytes)
}

describe('packageXml46687：包布局', () => {
  it('standard.xml + manifest.json + resources/<fileName>；standard.xml 居首，其余按路径字典序', async () => {
    const bytes = await packageXml46687(XML, manifestOf(SVG_ENTRY, PNG_ENTRY), {
      'inl_1.svg': SVG,
      'fig_1.png': PNG,
    })
    const zip = await unzip(bytes)
    expect(Object.keys(zip.files)).toEqual(['standard.xml', 'manifest.json', 'resources/fig_1.png', 'resources/inl_1.svg'])
    expect(await zip.file('standard.xml')!.async('string')).toBe(XML)
    expect(await zip.file('resources/fig_1.png')!.async('uint8array')).toEqual(PNG)
    expect(await zip.file('resources/inl_1.svg')!.async('uint8array')).toEqual(SVG)
  })

  it('standard.xml 是 UTF-8、无 BOM', async () => {
    const zip = await unzip(await packageXml46687(XML, manifestOf(), {}))
    const raw = await zip.file('standard.xml')!.async('uint8array')
    expect(Array.from(raw.slice(0, 5))).toEqual(Array.from(new TextEncoder().encode('<?xml')))
    expect(new TextDecoder('utf-8', { fatal: true }).decode(raw)).toBe(XML)
  })

  it('manifest.json：format / version / xml / entries，键序固定，条目按 fileName 排序，无时间戳', async () => {
    const zip = await unzip(await packageXml46687(XML, manifestOf(SVG_ENTRY, PNG_ENTRY), { 'inl_1.svg': SVG, 'fig_1.png': PNG }))
    const text = await zip.file('manifest.json')!.async('string')
    const parsed = JSON.parse(text)
    expect(Object.keys(parsed)).toEqual(['format', 'version', 'xml', 'entries'])
    expect(parsed.format).toBe('GB/T 46687.2—2026 XML')
    expect(parsed.format).toBe(XML46687_PACKAGE_FORMAT)
    expect(parsed.version).toBe(1)
    expect(parsed.xml).toBe('standard.xml')
    expect(parsed.entries).toEqual([PNG_ENTRY, SVG_ENTRY])
    for (const entry of parsed.entries) expect(Object.keys(entry)).toEqual(['href', 'key', 'fileName', 'mediaType', 'source'])
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('manifest.json 里 dataUrl 条目的 key 是固定占位 data:<mediaType>;base64,…，不含数据；其余字段与内存清单一致', async () => {
    const base64Data = btoa(String.fromCharCode(...PNG))
    const svgData = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const pngEntry = {
      href: 'fig_1', key: `data:image/png;base64,${base64Data}`, fileName: 'fig_1.png', mediaType: 'image/png', source: 'dataUrl',
    } as const
    const svgEntry = {
      href: 'inl_1', key: `data:image/svg+xml;utf8,${svgData}`, fileName: 'inl_1.svg', mediaType: 'image/svg+xml', source: 'dataUrl',
    } as const
    const resourceEntry = { href: 'fig_2', key: 'res-1', fileName: 'fig_2.png', mediaType: 'image/png', source: 'resource' } as const
    const manifest = manifestOf(pngEntry, svgEntry, resourceEntry)
    const before = JSON.stringify(manifest)

    const zip = await unzip(await packageXml46687(XML, manifest, { 'fig_1.png': PNG, 'inl_1.svg': SVG, 'fig_2.png': PNG }))
    const text = await zip.file('manifest.json')!.async('string')
    expect(text).not.toContain(base64Data)
    expect(text).not.toContain(svgData)
    expect(text).not.toContain('iVBORw0KGgo')
    const entries: Record<string, string>[] = JSON.parse(text).entries
    expect(entries.map(entry => [entry.fileName, entry.key])).toEqual([
      ['fig_1.png', 'data:image/png;base64,…'],
      ['fig_2.png', 'res-1'],
      ['inl_1.svg', 'data:image/svg+xml;base64,…'],
    ])
    // 其余字段（href / fileName / mediaType / source）与内存清单一致；内存清单不被修改。
    const byFileName = new Map<string, ResourceManifest['entries'][number]>(manifest.entries.map(entry => [entry.fileName, entry]))
    for (const entry of entries) {
      const original = byFileName.get(entry.fileName!)!
      expect({ ...entry, key: undefined }).toEqual({ ...original, key: undefined })
    }
    expect(JSON.stringify(manifest)).toBe(before)
  })

  it('manifest.json 的键序不依赖调用方清单条目的键序', async () => {
    const shuffled = { source: 'src', mediaType: 'image/png', fileName: 'fig_1.png', key: 'asset:a', href: 'fig_1' } as const
    const first = await packageXml46687(XML, manifestOf(PNG_ENTRY), { 'fig_1.png': PNG })
    const second = await packageXml46687(XML, manifestOf(shuffled), { 'fig_1.png': PNG })
    expect(second).toEqual(first)
  })

  it('没有任何图片时仍按同一结构打包，不写 resources/ 目录', async () => {
    const zip = await unzip(await packageXml46687(XML, manifestOf(), {}))
    expect(Object.keys(zip.files)).toEqual(['standard.xml', 'manifest.json'])
    expect(JSON.parse(await zip.file('manifest.json')!.async('string')).entries).toEqual([])
  })

  it('条目日期固定为 1980-01-01 UTC，无隐式目录', async () => {
    const zip = await unzip(await packageXml46687(XML, manifestOf(PNG_ENTRY, SVG_ENTRY), { 'fig_1.png': PNG, 'inl_1.svg': SVG }))
    const entries = Object.values(zip.files)
    expect(entries.every(entry => !entry.dir)).toBe(true)
    expect(entries.map(entry => entry.date.toISOString())).toEqual(Array(4).fill('1980-01-01T00:00:00.000Z'))
  })
})

describe('packageXml46687：确定性', () => {
  it('同一输入重复打包得到逐字节相同的结果', async () => {
    const args = [XML, manifestOf(PNG_ENTRY, SVG_ENTRY), { 'fig_1.png': PNG, 'inl_1.svg': SVG }] as const
    expect(await packageXml46687(...args)).toEqual(await packageXml46687(...args))
  })

  it('与传入条目、文件的次序无关', async () => {
    const forward = await packageXml46687(XML, manifestOf(PNG_ENTRY, SVG_ENTRY), { 'fig_1.png': PNG, 'inl_1.svg': SVG })
    const backward = await packageXml46687(XML, manifestOf(SVG_ENTRY, PNG_ENTRY), { 'inl_1.svg': SVG, 'fig_1.png': PNG })
    expect(backward).toEqual(forward)
  })

  it('不修改传入的清单与文件', async () => {
    const manifest = manifestOf(SVG_ENTRY, PNG_ENTRY)
    const files = { 'inl_1.svg': SVG, 'fig_1.png': PNG }
    const before = JSON.stringify({ manifest, files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, Array.from(data)])) })
    await packageXml46687(XML, manifest, files)
    expect(manifest.entries.map(entry => entry.fileName)).toEqual(['inl_1.svg', 'fig_1.png'])
    expect(JSON.stringify({ manifest, files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, Array.from(data)])) })).toBe(before)
  })

  it('同一字节被多处引用：各写各的文件', async () => {
    const entries = [
      { ...PNG_ENTRY },
      { ...PNG_ENTRY, href: 'fig_2', fileName: 'fig_2.png' },
    ]
    const zip = await unzip(await packageXml46687(XML, manifestOf(...entries), { 'fig_1.png': PNG, 'fig_2.png': PNG }))
    expect(Object.keys(zip.files)).toEqual(['standard.xml', 'manifest.json', 'resources/fig_1.png', 'resources/fig_2.png'])
  })
})

describe('packageXml46687：清单与文件必须一一对应', () => {
  it('清单条目没有对应文件', async () => {
    await expect(packageXml46687(XML, manifestOf(PNG_ENTRY), {})).rejects.toThrow('没有对应的资源文件')
  })

  it('文件不在清单中', async () => {
    await expect(packageXml46687(XML, manifestOf(), { 'fig_1.png': PNG })).rejects.toThrow('不在清单中')
  })

  it('文件名忽略大小写重复', async () => {
    const upper = { ...PNG_ENTRY, href: 'FIG_1', fileName: 'FIG_1.png' }
    await expect(packageXml46687(XML, manifestOf(PNG_ENTRY, upper), { 'fig_1.png': PNG, 'FIG_1.png': PNG }))
      .rejects.toThrow('重复')
  })

  it.each(['', '.', '..', 'a/b.png', '../x.png', 'a\\b.png'])('文件名必须无目录：%j', async (fileName) => {
    await expect(packageXml46687(XML, manifestOf({ ...PNG_ENTRY, fileName }), { [fileName]: PNG }))
      .rejects.toThrow('资源文件名无效')
  })
})

describe('prepareXml46687Input', () => {
  const pmDoc: PMJsonNode = {
    type: 'standardDoc',
    attrs: { standardType: 'national', titleCn: 'PM 标题', standardNo: 'PM 1' },
    content: [],
  }

  it('与 prepareDocxInput 同构：用文档库元数据覆盖 IR，保留空字符串覆盖；PM JSON 与带 toJSON() 的对象等价', () => {
    const documentMeta: DocumentMeta = { titleCn: '数据库标题', standardNo: '', standardType: 'guidance' }
    const fromJson = prepareXml46687Input(pmDoc, documentMeta)
    const fromNode = prepareXml46687Input({ toJSON: () => pmDoc }, documentMeta)
    expect(fromJson.doc.meta).toMatchObject({ standardType: 'guide', title: '数据库标题', stdCode: '' })
    expect(fromNode.doc).toEqual(fromJson.doc)
    expect(fromNode.labels).toEqual(fromJson.labels)
    expect(fromNode.warnings).toEqual(fromJson.warnings)
  })
})

describe('buildXml46687Package：有 error 不出包（入口断言）', () => {
  const text = (value: string): PMJsonNode => ({ type: 'text', text: value })

  /** 行内样式（颜色）在 XML46687 里保持阻断（D-S-06），入口断言报 unsupported-output；另有无法转换的公式与读不到的图。 */
  const blockedDoc: PMJsonNode = {
    type: 'standardDoc',
    attrs: { standardType: 'national', titleCn: '阻断样稿', standardNo: 'GB/T 12345—2026' },
    content: [{
      type: 'chapter', attrs: { nodeId: 'ch1', secType: 'scope' }, content: [
        { type: 'chapterTitle', content: [text('范围')] },
        { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [
          { type: 'text', text: '红色文字', marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }] },
        ] },
        { type: 'figure', attrs: { nodeId: 'fig1' }, content: [
          { type: 'figureImage', attrs: { src: 'asset:unknown' } },
          { type: 'figureCaption', content: [text('读不到的图')] },
        ] },
        { type: 'formula', attrs: { nodeId: 'formula1' }, content: [
          { type: 'formulaContent', content: [text('\\undefinedmacro')] },
        ] },
      ],
    }],
  }

  it('入口断言失败、公式转换失败、图片读取失败：bytes 为空，xml 为 null，problems 为全部问题', async () => {
    const result = await buildXml46687Package({ pmDoc: blockedDoc })
    expect(result.bytes).toEqual(new Uint8Array(0))
    expect(result.xml).toBeNull()
    expect(result.manifest).toEqual({ version: 1, entries: [] })

    const byCode = (code: string) => result.problems.filter(problem => problem.code === code)
    expect(byCode('mathml-conversion-failed')).toHaveLength(1)
    expect(byCode('mathml-conversion-failed')[0]).toMatchObject({ severity: 'error', nodeId: 'formula1' })
    expect(byCode('resource-load-failed')).toHaveLength(1)
    expect(byCode('resource-load-failed')[0]).toMatchObject({ severity: 'error', nodeId: 'fig1' })
    expect(byCode('unsupported-output').length).toBeGreaterThan(0)
    expect(byCode('unsupported-output').every(problem => problem.severity === 'error')).toBe(true)
  })

  it('不依赖 imageResources 选项：提供 resolver 后图片读取失败的问题消失，其余照旧', async () => {
    const result = await buildXml46687Package({
      pmDoc: blockedDoc,
      imageResources: { resolveResourceKey: async () => PNG },
    })
    expect(result.bytes).toEqual(new Uint8Array(0))
    expect(result.problems.map(problem => problem.code)).not.toContain('resource-load-failed')
    expect(result.manifest.entries.map(entry => entry.fileName)).toEqual(['fig_1.png'])
  })
})
