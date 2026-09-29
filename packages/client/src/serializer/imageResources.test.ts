import { describe, expect, it, vi } from 'vitest'
import type { IRBlock, IRDoc, IRFigure, IRNote, IRTable } from '@ses/shared'
import { collectImageResources } from './imageResources'

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  writeUint32BE(bytes, 16, width)
  writeUint32BE(bytes, 20, height)
  return bytes
}

function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(23)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0)
  bytes[7] = (height >>> 8) & 0xff
  bytes[8] = height & 0xff
  bytes[9] = (width >>> 8) & 0xff
  bytes[10] = width & 0xff
  bytes[11] = 3
  bytes.set([0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9], 12)
  return bytes
}

function gifBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    width & 0xff, (width >>> 8) & 0xff,
    height & 0xff, (height >>> 8) & 0xff,
    0x00, 0x00,
  ])
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function figure(id: string, src: string, notes: IRNote[] = []): IRFigure {
  return { kind: 'figure', id, caption: [], orientation: 'portrait', src, notes }
}

function note(id: string, content: IRBlock[]): IRNote {
  return { kind: 'note', id, content }
}

function doc(blocks: IRBlock[]): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: blocks }],
    appendices: [],
    bibliography: [],
  }
}

describe('collectImageResources', () => {
  it.each([
    { contentType: 'image/png', bytes: pngBytes(120, 60), widthPx: 120, heightPx: 60 },
    { contentType: 'image/jpeg', bytes: jpegBytes(640, 480), widthPx: 640, heightPx: 480 },
    { contentType: 'image/gif', bytes: gifBytes(32, 24), widthPx: 32, heightPx: 24 },
  ] as const)('解析 $contentType data URL 的字节和像素尺寸', async ({ contentType, bytes, widthPx, heightPx }) => {
    const src = `data:${contentType};base64,${base64(bytes)}`
    const { images, diagnostics } = await collectImageResources(doc([figure('image', src)]))

    expect(images.image).toEqual({
      base64: base64(bytes), contentType, widthPx, heightPx,
    })
    expect(diagnostics).toEqual([])
  })

  it('通过 fetch 读取 blob URL，按二进制签名识别 JPEG 尺寸', async () => {
    const bytes = jpegBytes(320, 240)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes.slice().buffer as ArrayBuffer, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg; charset=binary' },
    }))
    const { images, diagnostics } = await collectImageResources(doc([figure('blob', 'blob:editor/image-1')]), { fetcher })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith('blob:editor/image-1')
    expect(images.blob).toMatchObject({ contentType: 'image/jpeg', widthPx: 320, heightPx: 240 })
    expect(images.blob?.base64).toBe(base64(bytes))
    expect(diagnostics).toEqual([])
  })

  it('通过可 fetch 的 HTTPS URL 读取 PNG，并以实际字节签名为准', async () => {
    const bytes = pngBytes(18, 9)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes.slice().buffer as ArrayBuffer, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    }))
    const { images } = await collectImageResources(doc([figure('remote', 'https://example.test/figure')]), { fetcher })

    expect(images.remote).toMatchObject({ contentType: 'image/png', widthPx: 18, heightPx: 9 })
  })

  it('透過資源 key resolver 读取 Blob，并缓存相同 src 的重复读取', async () => {
    const bytes = gifBytes(40, 30)
    const resolveResourceKey = vi.fn(async () => new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/gif' }))
    const sameSource = 'asset:shared-image'
    const { images, diagnostics } = await collectImageResources(doc([
      figure('first', sameSource), figure('second', sameSource),
    ]), { resolveResourceKey })

    expect(resolveResourceKey).toHaveBeenCalledOnce()
    expect(images.first).toEqual(images.second)
    expect(images.first).toMatchObject({ contentType: 'image/gif', widthPx: 40, heightPx: 30 })
    expect(diagnostics).toEqual([])
  })

  it('收集前言、表格单元格和表注、术语定义及附录子句中的图', async () => {
    const src = `data:image/png;base64,${base64(pngBytes(2, 1))}`
    const nestedTable: IRTable = {
      kind: 'table', id: 'table', caption: [], orientation: 'portrait', headerRowCount: 0,
      rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [figure('in-cell', src)] }] }],
      notes: [note('table-note', [figure('in-table-note', src)])],
    }
    const { images } = await collectImageResources({
      ...doc([nestedTable]),
      front: { foreword: [figure('front', src)], introduction: [] },
      body: [{
        kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [nestedTable, {
          kind: 'termEntry', id: 'term', term: [], definition: [figure('term-definition', src)],
          notes: [note('term-note', [figure('term-note-figure', src)])],
          examples: [{ kind: 'example', id: 'example', content: [figure('term-example', src)] }],
        }],
      }],
      appendices: [{
        kind: 'appendix', id: 'appendix', normative: false, title: [],
        children: [{
          kind: 'clause', id: 'clause', level: 1, titled: true, title: [], children: [figure('appendix-figure', src)],
        }],
      }],
    })

    expect(Object.keys(images).sort()).toEqual([
      'appendix-figure', 'front', 'in-cell', 'in-table-note', 'term-definition', 'term-example', 'term-note-figure',
    ])
  })

  it('单张图片读取失败仅返回诊断并省略 images 项，留给 shared 输出 image-missing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not found', { status: 404 }))
    const { images, diagnostics } = await collectImageResources(doc([figure('missing', 'https://example.test/missing.png')]), { fetcher })

    expect(images.missing).toBeUndefined()
    expect(diagnostics).toEqual([{ nodeId: 'missing', message: '读取图片失败，HTTP 404' }])
  })

  it('无法解析的 resource key 与损坏的 data URL 都逐图诊断，不中断其他图片', async () => {
    const good = `data:image/gif;base64,${base64(gifBytes(6, 4))}`
    const { images, diagnostics } = await collectImageResources(doc([
      figure('broken', 'data:image/png;base64,not-base64!'),
      figure('unresolved', 'asset:not-found'),
      figure('good', good),
    ]))

    expect(images.broken).toBeUndefined()
    expect(images.unresolved).toBeUndefined()
    expect(images.good).toMatchObject({ contentType: 'image/gif', widthPx: 6, heightPx: 4 })
    expect(diagnostics.map(({ nodeId }) => nodeId)).toEqual(['broken', 'unresolved'])
  })
})
