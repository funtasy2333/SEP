/**
 * T2.5 (c)：`buildXml46687Package` 的编排（WP8.2 设计 §5.2 (c)）——渲染器被替换成桩。
 *
 * `exportXml46687` 的渲染管线由 T2.4a-1 实现。这里把它换成可控的桩，验证 io 一侧的接线：
 * 并行准备的 MathML 与资源清单被交给渲染器、问题合并、有 error 不打包、成功时按固定布局打包且字节可复现。
 * 这不是端到端测试：真实渲染器的黄金样例、`validate.py`、`xlink:href` 与清单一一对应见 `xml46687Package.e2e.test.ts`（T2.6）。
 */

import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PMJsonNode, Xml46687Problem } from '@ses/shared'

vi.mock('@ses/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ses/shared')>()
  return { ...actual, exportXml46687: vi.fn() }
})

import { collectXml46687ImageRefs, exportXml46687 } from '@ses/shared'
import { buildXml46687Package, prepareXml46687Input } from './xml46687Package'

const exportMock = vi.mocked(exportXml46687)

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oJ8AAAAASUVORK5CYII='
const SVG_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<standard>桩</standard>\n'

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })

function pmDoc(formulaLatex = 'x^2'): PMJsonNode {
  return {
    type: 'standardDoc',
    attrs: { standardType: 'national', titleCn: '接线样稿', standardNo: 'GB/T 12345—2026' },
    content: [{
      type: 'chapter', attrs: { nodeId: 'ch1', secType: 'scope' }, content: [
        { type: 'chapterTitle', content: [text('范围')] },
        { type: 'figure', attrs: { nodeId: 'fig1' }, content: [
          { type: 'figureImage', attrs: { src: PNG_DATA_URL } },
          { type: 'figureCaption', content: [text('示意图')] },
        ] },
        { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [
          text('见'), { type: 'inlineImage', attrs: { src: SVG_DATA_URL } },
        ] },
        { type: 'formula', attrs: { nodeId: 'formula1' }, content: [
          { type: 'formulaContent', content: [text(formulaLatex)] },
        ] },
      ],
    }],
  }
}

const warning: Xml46687Problem = {
  code: 'meta-not-expressed', severity: 'warning', path: 'doc.meta', message: '元数据未表达',
}
const rendererError: Xml46687Problem = {
  code: 'xml-label-missing', severity: 'error', nodeId: 'fig1', path: 'doc.body[0].children[1]', message: '缺少标签',
}

beforeEach(() => {
  exportMock.mockReset()
})

describe('buildXml46687Package：成功路径的编排', () => {
  it('把并行准备的 MathML 与资源清单交给渲染器，渲染器的 XML 与资源按固定布局打包', async () => {
    exportMock.mockReturnValue({ xml: XML, problems: [warning] })
    const result = await buildXml46687Package({ pmDoc: pmDoc() })

    expect(exportMock).toHaveBeenCalledOnce()
    const [doc, labels, options] = exportMock.mock.calls[0]!
    // 公式：以公式 NodeId 为键的 MathML 元素字符串。
    expect(Object.keys(options.mathml)).toEqual(['formula1'])
    expect(options.mathml.formula1).toMatch(/^<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML" display="block">/)
    expect(options.mathml.formula1).not.toMatch(/annotation|tex-math/)
    // 资源：清单的 href 与渲染器共用的收集函数一致，文件名 = href + 扩展名。
    expect(options.resources.entries.map(entry => [entry.href, entry.fileName, entry.mediaType, entry.source])).toEqual([
      ['fig_1', 'fig_1.png', 'image/png', 'dataUrl'],
      ['inl_1', 'inl_1.svg', 'image/svg+xml', 'dataUrl'],
    ])
    expect(options.resources.entries.map(entry => entry.href)).toEqual(collectXml46687ImageRefs(doc, labels).map(ref => ref.href))

    expect(result.xml).toBe(XML)
    expect(result.manifest).toEqual(options.resources)
    expect(result.problems).toEqual([warning])

    const zip = await JSZip.loadAsync(result.bytes)
    expect(Object.keys(zip.files)).toEqual(['standard.xml', 'manifest.json', 'resources/fig_1.png', 'resources/inl_1.svg'])
    expect(await zip.file('standard.xml')!.async('string')).toBe(XML)
    const manifestJson = JSON.parse(await zip.file('manifest.json')!.async('string'))
    // manifest.json 与内存清单只在 dataUrl 条目的 key 上不同：写成固定占位，不带 base64 数据。
    const { manifest } = result
    expect(manifest.entries.every(entry => entry.source === 'dataUrl' && entry.key.startsWith('data:'))).toBe(true)
    expect(manifestJson.entries).toEqual(manifest.entries.map(entry => ({ ...entry, key: `data:${entry.mediaType};base64,…` })))
    expect(JSON.stringify(manifestJson)).not.toContain('iVBORw0KGgo')
    const png = await zip.file('resources/fig_1.png')!.async('uint8array')
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(await zip.file('resources/inl_1.svg')!.async('string')).toContain('<svg')
  })

  it('同一输入重复出件得到逐字节相同的结果（无时间戳）', async () => {
    exportMock.mockReturnValue({ xml: XML, problems: [] })
    const first = await buildXml46687Package({ pmDoc: pmDoc() })
    const second = await buildXml46687Package({ pmDoc: pmDoc() })
    expect(second.bytes).toEqual(first.bytes)
    expect(first.bytes.length).toBeGreaterThan(0)
  })

  it('没有图片时仍打包 standard.xml 与 manifest.json', async () => {
    exportMock.mockReturnValue({ xml: XML, problems: [] })
    const noImages: PMJsonNode = {
      type: 'standardDoc', attrs: { standardType: 'national', titleCn: '无图' },
      content: [{ type: 'chapter', attrs: { nodeId: 'ch1' }, content: [{ type: 'chapterTitle', content: [text('范围')] }] }],
    }
    const result = await buildXml46687Package({ pmDoc: noImages })
    const zip = await JSZip.loadAsync(result.bytes)
    expect(Object.keys(zip.files)).toEqual(['standard.xml', 'manifest.json'])
    expect(result.manifest).toEqual({ version: 1, entries: [] })
  })

  it('PM 节点（带 toJSON()）与 PM JSON 等价，documentMeta 覆盖元数据后交给渲染器', async () => {
    exportMock.mockReturnValue({ xml: XML, problems: [] })
    const source = pmDoc()
    const fromJson = await buildXml46687Package({ pmDoc: source, documentMeta: { titleCn: '库内标题', standardType: 'national' } })
    const fromNode = await buildXml46687Package({ pmDoc: { toJSON: () => source }, documentMeta: { titleCn: '库内标题', standardType: 'national' } })
    expect(fromNode.bytes).toEqual(fromJson.bytes)
    expect(exportMock.mock.calls[0]![0].meta.title).toBe('库内标题')
    expect(prepareXml46687Input(source, { titleCn: '库内标题', standardType: 'national' }).doc.meta.title).toBe('库内标题')
  })

  it('imageResources 选项透传给资源准备（resource key 解析器）', async () => {
    exportMock.mockReturnValue({ xml: XML, problems: [] })
    const resolveResourceKey = vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))
    const source = pmDoc()
    const figure = source.content![0]!.content![1]!
    figure.content![0]!.attrs!.src = 'asset:fig'
    const result = await buildXml46687Package({ pmDoc: source, imageResources: { resolveResourceKey } })
    expect(resolveResourceKey).toHaveBeenCalledWith('asset:fig')
    expect(result.manifest.entries[0]).toMatchObject({ href: 'fig_1', key: 'asset:fig', source: 'src' })
  })
})

describe('buildXml46687Package：有 error 不出包', () => {
  it('渲染器报 error：bytes 为空数组，xml 为 null，problems 为准备层与渲染器的全部问题', async () => {
    exportMock.mockReturnValue({ xml: null, problems: [rendererError, warning] })
    const result = await buildXml46687Package({ pmDoc: pmDoc() })
    expect(result.bytes).toEqual(new Uint8Array(0))
    expect(result.xml).toBeNull()
    expect(result.problems).toEqual([rendererError, warning])
    // 清单仍然返回（准备层成功读到的图片）。
    expect(result.manifest.entries.map(entry => entry.href)).toEqual(['fig_1', 'inl_1'])
  })

  it('准备层报 error（公式无法转换、图片读不到）：即使渲染器给出了 XML 也不打包；渲染器仍被调用，一次列出全部问题', async () => {
    exportMock.mockReturnValue({ xml: XML, problems: [warning] })
    const source = pmDoc('\\undefinedmacro')
    source.content![0]!.content![1]!.content![0]!.attrs!.src = 'asset:missing'
    const result = await buildXml46687Package({ pmDoc: source })
    expect(exportMock).toHaveBeenCalledOnce()
    expect(result.bytes).toEqual(new Uint8Array(0))
    expect(result.xml).toBeNull()
    // 准备层的问题在前（公式、资源），渲染器的问题在后。
    expect(result.problems.map(problem => problem.code)).toEqual([
      'mathml-conversion-failed', 'resource-load-failed', 'meta-not-expressed',
    ])
    expect(result.problems[0]).toMatchObject({ nodeId: 'formula1', severity: 'error' })
    expect(result.problems[1]).toMatchObject({ nodeId: 'fig1', severity: 'error' })
    // 转换失败的公式不进 options.mathml，读取失败的图不进清单——渲染器据此另报 mathml-missing / resource-missing。
    const options = exportMock.mock.calls[0]![2]
    expect(options.mathml).toEqual({})
    expect(options.resources.entries.map(entry => entry.href)).toEqual(['inl_1'])
  })

  it('只有 warning / info 时照常打包，problems 全部返回', async () => {
    const info: Xml46687Problem = { code: 'resource-unused', severity: 'info', path: 'doc', message: '多余条目' }
    exportMock.mockReturnValue({ xml: XML, problems: [warning, info] })
    const result = await buildXml46687Package({ pmDoc: pmDoc() })
    expect(result.bytes.length).toBeGreaterThan(0)
    expect(result.xml).toBe(XML)
    expect(result.problems).toEqual([warning, info])
  })

  it('渲染器返回 xml:null 却没有 error 级问题（契约被破坏）：同样不打包', async () => {
    exportMock.mockReturnValue({ xml: null, problems: [warning] })
    const result = await buildXml46687Package({ pmDoc: pmDoc() })
    expect(result.bytes).toEqual(new Uint8Array(0))
    expect(result.xml).toBeNull()
  })
})
