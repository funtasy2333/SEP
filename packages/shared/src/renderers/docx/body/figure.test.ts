import { describe, expect, it } from 'vitest'
import type { IRFigure } from '../../../ir/types'
import { assertWellFormed } from '../__tests__/helpers/checks'
import { findChild, parseXml } from '../__tests__/helpers/xmlTree'
import { buildPackage } from '../package'
import { createRenderContext } from './context'
import { renderFigureImage, type DocxImage } from './figure'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function figure(orientation: IRFigure['orientation'] = 'portrait'): IRFigure {
  return {
    kind: 'figure', id: 'fig-1', caption: [{ text: 'A <图> & 说明' }], orientation,
    src: 'asset:fig-1', notes: [],
  }
}

function root(xml: string) {
  return parseXml(`<w:root xmlns:w="${W_NS}">${xml}</w:root>`)
}

describe('renderFigureImage', () => {
  it('用 dpi 把图片尺寸换为 EMU，并按竖排 165 mm 上限等比缩小', () => {
    const image: DocxImage = {
      base64: 'aGVsbG8=', contentType: 'image/png', widthPx: 1920, heightPx: 960, dpi: 96,
    }
    const ctx = createRenderContext({})
    const result = renderFigureImage(ctx, figure(), image, { relationshipId: 'rId5', mediaIndex: 1 })
    const drawing = findChild(findChild(root(result.xml), 'w:p')!, 'w:r')!.children
      .find((child) => child.kind === 'element' && child.name === 'w:drawing')
    expect(drawing?.kind).toBe('element')
    if (drawing?.kind !== 'element') throw new Error('expected w:drawing')
    const extent = findChild(findChild(drawing, 'wp:inline')!, 'wp:extent')!
    expect(extent.attrs).toEqual({ cx: '5940000', cy: '2970000' })
    expect(findChild(findChild(drawing, 'wp:inline')!, 'wp:docPr')?.attrs.descr).toBe('A <图> & 说明')
    expect(result.relatedPart).toEqual({
      id: 'rId5',
      target: 'word/media/image1.png',
      relationshipType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      content: 'aGVsbG8=',
      binary: true,
    })
    expect(ctx.warnings).toEqual([])
  })

  it('横排图按 252 mm 上限缩放，并将 JPEG 关系指向 jpg 媒体', () => {
    const image: DocxImage = {
      base64: 'aGVsbG8=', contentType: 'image/jpeg', widthPx: 1600, heightPx: 900,
    }
    const result = renderFigureImage(createRenderContext({}), figure('landscape'), image, {
      relationshipId: 'rId8', mediaIndex: 4,
    })
    const drawing = findChild(findChild(root(result.xml), 'w:p')!, 'w:r')!.children
      .find((child) => child.kind === 'element' && child.name === 'w:drawing')
    if (drawing?.kind !== 'element') throw new Error('expected w:drawing')
    expect(findChild(findChild(drawing, 'wp:inline')!, 'wp:extent')?.attrs).toEqual({
      cx: '9072000', cy: '5103000',
    })
    expect(result.relatedPart?.target).toBe('word/media/image4.jpg')
    expect(result.xml).toContain('r:embed="rId8"')
  })

  it('可将图片关系、二进制部件与 Content Types 一起装入 DOCX 包', () => {
    const image: DocxImage = {
      base64: 'aGVsbG8=', contentType: 'image/png', widthPx: 100, heightPx: 50,
    }
    const result = renderFigureImage(createRenderContext({}), figure(), image, {
      relationshipId: 'rId1', mediaIndex: 1,
    })
    const pkg = buildPackage({
      documentXml: `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${result.xml}</w:body></w:document>`,
      title: 'test', createdAt: '2026-09-29T00:00:00.000Z',
      relatedParts: [result.relatedPart!],
    })
    assertWellFormed(pkg)
    expect(pkg.binaries['word/media/image1.png']).toBe('aGVsbG8=')
    expect(pkg.parts['word/_rels/document.xml.rels']).toContain('Target="media/image1.png"')
    expect(pkg.parts['[Content_Types].xml']).toContain('Extension="png" ContentType="image/png"')
  })

  it('资源缺失时输出提示和 image-missing warning，不创建媒体关系', () => {
    const ctx = createRenderContext({})
    const result = renderFigureImage(ctx, figure(), undefined)
    expect(result.xml).toContain('〔图片缺失〕')
    expect(result.relatedPart).toBeUndefined()
    expect(ctx.warnings).toEqual([{
      code: 'image-missing', nodeId: 'fig-1', message: '图片 "fig-1" 未提供资源，输出图片缺失提示',
    }])
  })

  it('无效的尺寸数据安全降级', () => {
    const ctx = createRenderContext({})
    const image: DocxImage = {
      base64: 'aGVsbG8=', contentType: 'image/gif', widthPx: 100, heightPx: 0,
    }
    const result = renderFigureImage(ctx, figure(), image)
    expect(result.xml).toContain('〔图片缺失〕')
    expect(result.relatedPart).toBeUndefined()
    expect(ctx.warnings[0]?.code).toBe('image-invalid')
  })

  it('有资源却未提供关系信息时拒绝生成悬空 r:embed', () => {
    const image: DocxImage = {
      base64: 'aGVsbG8=', contentType: 'image/gif', widthPx: 100, heightPx: 100,
    }
    expect(() => renderFigureImage(createRenderContext({}), figure(), image)).toThrow(/relationshipId/)
  })
})
