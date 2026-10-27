/**
 * T2.5 (b)：XML46687 图片资源准备（WP8.2 设计 §5.2 (b)、§5.3）。
 * 清单条目来自 shared 的 collectXml46687ImageRefs（与渲染器同一函数）；这里验证取字节、媒体类型、命名与冲突。
 */

import { describe, expect, it, vi } from 'vitest'
import { collectXml46687ImageRefs, resolve } from '@ses/shared'
import type { IRBlock, IRChapter, IRDoc, IRFigure, IRInline, IRResource, ResolvedLabel } from '@ses/shared'
import { collectXml46687Resources } from './xml46687Resources'

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function ascii(value: string): number[] {
  return Array.from(value, character => character.charCodeAt(0))
}

const PNG = new Uint8Array([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), 0, 0, 0, 1, 0, 0, 0, 1])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])
const GIF = new Uint8Array([...ascii('GIF89a'), 1, 0, 1, 0, 0, 0, 0])
const WEBP = new Uint8Array([...ascii('RIFF'), 12, 0, 0, 0, ...ascii('WEBPVP8 '), 0, 0, 0, 0])
const SVG_TEXT = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>'
const SVG = new TextEncoder().encode(SVG_TEXT)
const UNKNOWN = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

const dataUrl = (type: string, bytes: Uint8Array) => `data:${type};base64,${base64(bytes)}`

const text = (value: string): IRInline => ({ text: value })
const figure = (id: string, src: string, extra: Partial<IRFigure> = {}): IRFigure => ({
  kind: 'figure', id, caption: [text(`图 ${id}`)], orientation: 'portrait', src, notes: [], ...extra,
})
const paragraphWithImages = (id: string, ...images: { src: string; resourceId?: string }[]): IRBlock => ({
  kind: 'paragraph', id, content: images.flatMap(image => [text('见'), { text: '', image }]),
})

function docOf(children: IRBlock[], resources?: IRResource[]): IRDoc {
  const chapter: IRChapter = { kind: 'chapter', id: 'c1', secType: 'general', title: [text('章')], children }
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [chapter],
    appendices: [],
    bibliography: [],
    ...(resources ? { resources } : {}),
  }
}

async function collect(doc: IRDoc, options: Parameters<typeof collectXml46687Resources>[2] = {}) {
  const { labels } = resolve(doc)
  return { labels, ...(await collectXml46687Resources(doc, labels, options)) }
}

const response = (bytes: Uint8Array, contentType?: string, status = 200) =>
  new Response(bytes.slice().buffer as ArrayBuffer, { status, headers: contentType ? { 'Content-Type': contentType } : {} })

describe('collectXml46687Resources：data URL 与文件名', () => {
  it.each([
    { name: 'PNG', type: 'image/png', bytes: PNG, ext: 'png' },
    { name: 'JPEG', type: 'image/jpeg', bytes: JPEG, ext: 'jpg' },
    { name: 'GIF', type: 'image/gif', bytes: GIF, ext: 'gif' },
    { name: 'WebP', type: 'image/webp', bytes: WEBP, ext: 'webp' },
    { name: 'SVG', type: 'image/svg+xml', bytes: SVG, ext: 'svg' },
  ])('$name data URL → fileName = <href>.$ext，字节原样，来源 dataUrl', async ({ type, bytes, ext }) => {
    const { manifest, files, problems } = await collect(docOf([figure('fig-a', dataUrl(type, bytes))]))
    expect(problems).toEqual([])
    expect(manifest).toEqual({
      version: 1,
      entries: [{ href: 'fig_1', key: dataUrl(type, bytes), fileName: `fig_1.${ext}`, mediaType: type, source: 'dataUrl' }],
    })
    expect(Object.keys(files)).toEqual([`fig_1.${ext}`])
    expect(files[`fig_1.${ext}`]).toEqual(bytes)
  })

  it('SVG 也可以是不带 base64 的百分号编码 data URL', async () => {
    const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG_TEXT)}`
    const { manifest, files, problems } = await collect(docOf([figure('fig-a', encoded)]))
    expect(problems).toEqual([])
    expect(manifest.entries[0]).toMatchObject({ fileName: 'fig_1.svg', mediaType: 'image/svg+xml', source: 'dataUrl' })
    expect(new TextDecoder().decode(files['fig_1.svg'])).toBe(SVG_TEXT)
  })

  it('手写的 SVG data URL 含未转义的 % 时按原文取用', async () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="50%"/>'
    const { manifest, files, problems } = await collect(docOf([figure('fig-a', `data:image/svg+xml;utf8,${raw}`)]))
    expect(problems).toEqual([])
    expect(manifest.entries[0]).toMatchObject({ fileName: 'fig_1.svg', mediaType: 'image/svg+xml' })
    expect(new TextDecoder().decode(files['fig_1.svg'])).toBe(raw)
  })

  it('块图与行内图共用同一函数给出的 href：fig_<n> 与 inl_<k>，条目按 IR 文档序', async () => {
    const doc = docOf([
      figure('fig-a', dataUrl('image/png', PNG)),
      paragraphWithImages('p1', { src: dataUrl('image/svg+xml', SVG) }, { src: dataUrl('image/webp', WEBP) }),
      figure('fig-b', dataUrl('image/gif', GIF)),
    ])
    const { labels, manifest, files, problems } = await collect(doc)
    expect(problems).toEqual([])
    expect(manifest.entries.map(entry => [entry.href, entry.fileName])).toEqual([
      ['fig_1', 'fig_1.png'], ['inl_1', 'inl_1.svg'], ['inl_2', 'inl_2.webp'], ['fig_2', 'fig_2.gif'],
    ])
    // 与渲染器共用的收集函数一一对应。
    expect(manifest.entries.map(entry => entry.href)).toEqual(collectXml46687ImageRefs(doc, labels).map(ref => ref.href))
    expect(Object.keys(files).sort()).toEqual(manifest.entries.map(entry => entry.fileName).sort())
  })

  it('同一资源被多处引用：各写各的文件，不去重，但字节只读取一次', async () => {
    const resolveResourceKey = vi.fn(async () => PNG)
    const doc = docOf([
      figure('fig-a', 'asset:shared'),
      paragraphWithImages('p1', { src: 'asset:shared' }),
      figure('fig-b', 'asset:shared'),
    ])
    const { manifest, files, problems } = await collect(doc, { resolveResourceKey })
    expect(problems).toEqual([])
    expect(resolveResourceKey).toHaveBeenCalledOnce()
    expect(manifest.entries.map(entry => [entry.href, entry.fileName, entry.source])).toEqual([
      ['fig_1', 'fig_1.png', 'src'], ['inl_1', 'inl_1.png', 'src'], ['fig_2', 'fig_2.png', 'src'],
    ])
    expect(Object.keys(files).sort()).toEqual(['fig_1.png', 'fig_2.png', 'inl_1.png'])
  })

  it('没有图片的文档：空清单、空文件', async () => {
    const { manifest, files, problems } = await collect(docOf([{ kind: 'paragraph', id: 'p1', content: [text('无图')] }]))
    expect(manifest).toEqual({ version: 1, entries: [] })
    expect(Object.keys(files)).toEqual([])
    expect(problems).toEqual([])
  })

  it('清单可 JSON 往返；输入的文档、labels 不被修改', async () => {
    const doc = docOf([figure('fig-a', dataUrl('image/png', PNG))])
    const { labels } = resolve(doc)
    const before = JSON.stringify({ doc, labels })
    const result = await collectXml46687Resources(doc, labels)
    expect(JSON.parse(JSON.stringify(result.manifest))).toEqual(result.manifest)
    expect(JSON.stringify({ doc, labels })).toBe(before)
  })
})

describe('collectXml46687Resources：IRDoc.resources 里的资源', () => {
  it('resourceId 指向 doc.resources：dataUrl / base64 / text 三种编码，媒体类型用资源自带值，来源 resource', async () => {
    const resources: IRResource[] = [
      { id: 'res-png', mediaType: 'image/png', encoding: 'dataUrl', data: dataUrl('image/png', PNG) },
      { id: 'res-jpeg', mediaType: 'image/jpeg', encoding: 'base64', data: base64(JPEG) },
      { id: 'res-svg', mediaType: 'image/svg+xml', encoding: 'text', data: SVG_TEXT },
    ]
    const doc = docOf([
      figure('fig-a', 'ignored-a', { resourceId: 'res-png' }),
      figure('fig-b', 'ignored-b', { resourceId: 'res-jpeg' }),
      paragraphWithImages('p1', { src: 'ignored-c', resourceId: 'res-svg' }),
    ], resources)
    const { manifest, files, problems } = await collect(doc)
    expect(problems).toEqual([])
    expect(manifest.entries).toEqual([
      { href: 'fig_1', key: 'res-png', fileName: 'fig_1.png', mediaType: 'image/png', source: 'resource' },
      { href: 'fig_2', key: 'res-jpeg', fileName: 'fig_2.jpg', mediaType: 'image/jpeg', source: 'resource' },
      { href: 'inl_1', key: 'res-svg', fileName: 'inl_1.svg', mediaType: 'image/svg+xml', source: 'resource' },
    ])
    expect(files['fig_1.png']).toEqual(PNG)
    expect(files['fig_2.jpg']).toEqual(JPEG)
    expect(new TextDecoder().decode(files['inl_1.svg'])).toBe(SVG_TEXT)
  })

  it('字节无法判定时取资源自带的媒体类型（如 image/bmp 取子类型作扩展名）', async () => {
    const doc = docOf([figure('fig-a', 'x', { resourceId: 'res-bmp' })], [
      { id: 'res-bmp', mediaType: 'image/bmp', encoding: 'base64', data: base64(UNKNOWN) },
    ])
    const { manifest, problems } = await collect(doc)
    expect(problems).toEqual([])
    expect(manifest.entries[0]).toMatchObject({ fileName: 'fig_1.bmp', mediaType: 'image/bmp' })
  })

  it('资源不是图片 → resource-media-type，且不进清单', async () => {
    const doc = docOf([figure('fig-a', 'x', { resourceId: 'res-pdf' })], [
      { id: 'res-pdf', mediaType: 'application/pdf', encoding: 'base64', data: base64(UNKNOWN) },
    ])
    const { manifest, files, problems } = await collect(doc)
    expect(manifest.entries).toEqual([])
    expect(Object.keys(files)).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({
      code: 'resource-media-type', severity: 'error', nodeId: 'fig-a', path: 'doc.body[0].children[0]',
    })
    expect(problems[0]!.message).toContain('application/pdf')
  })

  it('resourceId 不在 doc.resources 中：按资源键交给 resolver，没有 resolver 则读取失败', async () => {
    const doc = docOf([figure('fig-a', 'x', { resourceId: 'res-missing' })])
    const resolveResourceKey = vi.fn(async (key: string) => (key === 'res-missing' ? WEBP : GIF))
    const ok = await collect(doc, { resolveResourceKey })
    expect(resolveResourceKey).toHaveBeenCalledWith('res-missing')
    expect(ok.manifest.entries[0]).toMatchObject({ key: 'res-missing', fileName: 'fig_1.webp', source: 'src' })

    const failed = await collect(doc)
    expect(failed.manifest.entries).toEqual([])
    expect(failed.problems[0]).toMatchObject({ code: 'resource-load-failed', nodeId: 'fig-a' })
    expect(failed.problems[0]!.message).toContain('resource key 解析器')
  })

  it('空数据、base64 无效、不支持的资源编码 → resource-load-failed，带原因', async () => {
    const doc = docOf([
      figure('fig-a', 'x', { resourceId: 'res-1' }),
      figure('fig-b', 'x', { resourceId: 'res-2' }),
      figure('fig-c', 'x', { resourceId: 'res-3' }),
    ], [
      { id: 'res-1', mediaType: 'image/svg+xml', encoding: 'text', data: '' },
      { id: 'res-2', mediaType: 'image/png', encoding: 'base64', data: '!!!not-base64!!!' },
      { id: 'res-3', mediaType: 'image/png', encoding: 'binary' as unknown as IRResource['encoding'], data: 'AA==' },
    ])
    const { manifest, problems } = await collect(doc)
    expect(manifest.entries).toEqual([])
    expect(problems.map(problem => [problem.code, problem.nodeId])).toEqual([
      ['resource-load-failed', 'fig-a'], ['resource-load-failed', 'fig-b'], ['resource-load-failed', 'fig-c'],
    ])
    expect(problems[0]!.message).toContain('图片数据为空')
    expect(problems[1]!.message).toContain('base64')
    expect(problems[2]!.message).toContain('binary')
  })
})

describe('collectXml46687Resources：媒体类型（字节签名优先）', () => {
  it('字节签名与声明不符时以字节为准：声明 PNG 的实为 JPEG；声明 octet-stream 的 PNG', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(JPEG, 'image/png'))
      .mockResolvedValueOnce(response(PNG, 'application/octet-stream'))
      .mockResolvedValueOnce(response(WEBP, 'image/gif'))
    const doc = docOf([
      figure('fig-a', 'https://example.test/a'),
      figure('fig-b', 'https://example.test/b'),
      figure('fig-c', 'https://example.test/c'),
    ])
    const { manifest, problems } = await collect(doc, { fetcher })
    expect(problems).toEqual([])
    expect(manifest.entries.map(entry => [entry.fileName, entry.mediaType])).toEqual([
      ['fig_1.jpg', 'image/jpeg'], ['fig_2.png', 'image/png'], ['fig_3.webp', 'image/webp'],
    ])
  })

  it('data URL 声明与字节不符：声明 image/png 的实为 SVG 文本 → 按 SVG', async () => {
    const { manifest, problems } = await collect(docOf([figure('fig-a', dataUrl('image/png', SVG))]))
    expect(problems).toEqual([])
    expect(manifest.entries[0]).toMatchObject({ fileName: 'fig_1.svg', mediaType: 'image/svg+xml' })
  })

  it('SVG 带 BOM、注释、DOCTYPE 仍能按字节识别，不依赖声明', async () => {
    const svg = new TextEncoder().encode('﻿<!-- c --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(svg, 'application/octet-stream'))
    const { manifest, problems } = await collect(docOf([figure('fig-a', 'https://example.test/a')]), { fetcher })
    expect(problems).toEqual([])
    expect(manifest.entries[0]).toMatchObject({ fileName: 'fig_1.svg', mediaType: 'image/svg+xml' })
  })

  it('签名无法判定且声明不是 image/* → resource-media-type（不进清单）；没有声明同样', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(UNKNOWN, 'text/html; charset=utf-8'))
      .mockResolvedValueOnce(response(UNKNOWN))
      .mockResolvedValueOnce(response(PNG))
    const doc = docOf([
      figure('fig-a', 'https://example.test/a'),
      figure('fig-b', 'https://example.test/b'),
      figure('fig-c', 'https://example.test/c'),
    ])
    const { manifest, problems } = await collect(doc, { fetcher })
    expect(problems.map(problem => [problem.code, problem.nodeId])).toEqual([
      ['resource-media-type', 'fig-a'], ['resource-media-type', 'fig-b'],
    ])
    expect(problems[0]!.message).toContain('text/html')
    // 失败项不进清单；成功项照常，并保持自己的 href（不因前面的失败而重排）。
    expect(manifest.entries.map(entry => entry.href)).toEqual(['fig_3'])
  })

  it('resolver 返回的 Blob / Uint8Array / SVG 与 WebP 的 data URL 字符串都能收下', async () => {
    const resolveResourceKey = vi.fn(async (key: string) => {
      if (key === 'asset:blob') return new Blob([WEBP.slice().buffer as ArrayBuffer], { type: 'image/webp' })
      if (key === 'asset:svg') return dataUrl('image/svg+xml', SVG)
      if (key === 'asset:webp') return dataUrl('image/webp', WEBP)
      return JPEG
    })
    const doc = docOf([
      figure('fig-a', 'asset:blob'), figure('fig-b', 'asset:svg'), figure('fig-c', 'asset:webp'), figure('fig-d', 'asset:bytes'),
    ])
    const { manifest, problems } = await collect(doc, { resolveResourceKey })
    expect(problems).toEqual([])
    expect(manifest.entries.map(entry => entry.fileName)).toEqual(['fig_1.webp', 'fig_2.svg', 'fig_3.webp', 'fig_4.jpg'])
  })
})

describe('collectXml46687Resources：读取失败与缺失', () => {
  it('HTTP 失败 → resource-load-failed（带 nodeId、IR 路径、原因），失败项不进清单，其余照常', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => (
      String(input).endsWith('/missing') ? response(new Uint8Array(), undefined, 404) : response(PNG, 'image/png')
    ))
    const doc = docOf([
      figure('fig-a', 'https://example.test/missing'),
      paragraphWithImages('p1', { src: 'https://example.test/ok' }),
    ])
    const { manifest, files, problems } = await collect(doc, { fetcher })
    expect(manifest.entries.map(entry => entry.href)).toEqual(['inl_1'])
    expect(Object.keys(files)).toEqual(['inl_1.png'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({
      code: 'resource-load-failed', severity: 'error', nodeId: 'fig-a', path: 'doc.body[0].children[0]',
    })
    expect(problems[0]!.message).toContain('HTTP 404')
  })

  it('空 src、没有 resolver 的资源键 → resource-load-failed', async () => {
    const doc = docOf([figure('fig-a', ''), figure('fig-b', 'asset:unknown')])
    const { manifest, problems } = await collect(doc)
    expect(manifest.entries).toEqual([])
    expect(problems.map(problem => [problem.code, problem.nodeId])).toEqual([
      ['resource-load-failed', 'fig-a'], ['resource-load-failed', 'fig-b'],
    ])
    expect(problems[0]!.message).toContain('图片资源地址为空')
    expect(problems[1]!.message).toContain('resource key 解析器')
  })

  it('行内图读取失败：nodeId 为所在段落，路径指向 run', async () => {
    const { problems } = await collect(docOf([paragraphWithImages('p1', { src: 'asset:unknown' })]))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({
      code: 'resource-load-failed', nodeId: 'p1', path: 'doc.body[0].children[0].content[1]',
    })
  })

  it('resolver 抛错 → resource-load-failed，带原因', async () => {
    const resolveResourceKey = vi.fn(async () => { throw new Error('仓库不可用') })
    const { problems } = await collect(docOf([figure('fig-a', 'asset:a')]), { resolveResourceKey })
    expect(problems[0]).toMatchObject({ code: 'resource-load-failed', nodeId: 'fig-a' })
    expect(problems[0]!.message).toContain('仓库不可用')
  })

  it('问题与条目都按 IR 文档序，不受并发完成先后影响', async () => {
    const delays: Record<string, number> = { a: 30, b: 0, c: 15 }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const name = String(input).split('/').pop()!
      await new Promise(done => setTimeout(done, delays[name] ?? 0))
      return name === 'b' ? response(UNKNOWN, 'text/plain') : response(name === 'a' ? PNG : GIF, 'image/png')
    })
    const doc = docOf([
      figure('fig-a', 'https://example.test/a'),
      figure('fig-b', 'https://example.test/b'),
      figure('fig-c', 'https://example.test/c'),
    ])
    const { manifest, problems } = await collect(doc, { fetcher })
    expect(manifest.entries.map(entry => entry.href)).toEqual(['fig_1', 'fig_3'])
    expect(problems.map(problem => problem.nodeId)).toEqual(['fig-b'])
  })
})

describe('collectXml46687Resources：命名冲突', () => {
  function labelsWith(entries: Record<string, string>): Record<string, ResolvedLabel> {
    return Object.fromEntries(Object.entries(entries).map(([id, xmlId]) => [id, { label: id, xmlId, refText: id }]))
  }

  it('xmlId 在忽略大小写后重名（手写 labels）→ resource-name-conflict，先到者保留', async () => {
    const doc = docOf([
      figure('fig-a', dataUrl('image/png', PNG)),
      figure('fig-b', dataUrl('image/png', PNG)),
      figure('fig-c', dataUrl('image/png', PNG)),
    ])
    const labels = labelsWith({ 'fig-a': 'Fig_1', 'fig-b': 'fig_1', 'fig-c': 'fig_2' })
    const { manifest, files, problems } = await collectXml46687Resources(doc, labels)
    expect(manifest.entries.map(entry => entry.fileName)).toEqual(['Fig_1.png', 'fig_2.png'])
    expect(Object.keys(files)).toEqual(['Fig_1.png', 'fig_2.png'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({
      code: 'resource-name-conflict', severity: 'error', nodeId: 'fig-b', path: 'doc.body[0].children[1]',
    })
    expect(problems[0]!.message).toContain('Fig_1')
  })

  it('同一 href 的两个条目即使扩展名不同也冲突', async () => {
    const doc = docOf([
      figure('fig-a', dataUrl('image/png', PNG)),
      figure('fig-b', dataUrl('image/svg+xml', SVG)),
    ])
    const labels = labelsWith({ 'fig-a': 'fig_1', 'fig-b': 'fig_1' })
    const { manifest, problems } = await collectXml46687Resources(doc, labels)
    expect(manifest.entries.map(entry => entry.fileName)).toEqual(['fig_1.png'])
    expect(problems.map(problem => [problem.code, problem.nodeId])).toEqual([['resource-name-conflict', 'fig-b']])
  })

  it('失败项不占用名字：先到的读取失败时，后到的同名条目照常入清单', async () => {
    const doc = docOf([figure('fig-a', ''), figure('fig-b', dataUrl('image/png', PNG))])
    const labels = labelsWith({ 'fig-a': 'fig_1', 'fig-b': 'FIG_1' })
    const { manifest, problems } = await collectXml46687Resources(doc, labels)
    expect(manifest.entries.map(entry => entry.fileName)).toEqual(['FIG_1.png'])
    expect(problems.map(problem => problem.code)).toEqual(['resource-load-failed'])
  })

  it('labels 缺少某图时不生成条目（渲染器随后报 xml-label-missing），也不报资源问题', async () => {
    const doc = docOf([figure('fig-a', dataUrl('image/png', PNG))])
    const { manifest, problems } = await collectXml46687Resources(doc, {})
    expect(manifest.entries).toEqual([])
    expect(problems).toEqual([])
  })
})

describe('collectXml46687Resources：嵌套位置', () => {
  it('表格单元格、注、术语条目里的图都在清单中', async () => {
    const doc = docOf([
      {
        kind: 'table', id: 't1', caption: [text('表')], orientation: 'portrait', headerRowCount: 0,
        rows: [{ id: 'r1', cells: [{ id: 'cell1', colspan: 1, rowspan: 1, header: false, content: [
          figure('fig-in-cell', dataUrl('image/png', PNG)),
        ] }] }],
        notes: [],
      },
      { kind: 'note', id: 'n1', content: [paragraphWithImages('n1-p', { src: dataUrl('image/gif', GIF) })] },
    ])
    const { manifest, problems } = await collect(doc)
    expect(problems).toEqual([])
    expect(manifest.entries.map(entry => entry.fileName)).toEqual(['fig_1.png', 'inl_1.gif'])
  })
})
