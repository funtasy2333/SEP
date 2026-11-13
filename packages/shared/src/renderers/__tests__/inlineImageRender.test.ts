/**
 * 段落行内图片与表格单元格内图片的 HTML / PDF CSS / DOCX 渲染测试。
 *
 * 验证：
 * 1. HTML（screen / print）与 printCss 正确输出 <img class="ses-inline-image" ...>、data-size="S|M|L" 及表格单元格内自适应样式；
 * 2. DOCX 在普通段落、列表项、注及表格单元格（含纯图片单元格、图文混排单元格）内正确输出 <w:drawing><wp:inline>，
 *    并验证自然尺寸、S/M/L 行高尺寸、窄列单元格等比缩放、word/media 二进制部件与关系完整性。
 */

import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import type { IRBlock, IRDoc } from '../../ir/types'
import { renderHtml } from '../html'
import { printCss } from '../printCss'
import { inlineImageResourceKey, renderDocx } from '../docx'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from '../docx/__tests__/helpers/checks'
import { docxOutline } from '../docx/__tests__/helpers/outline'

const SAMPLE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_B64}`

function makeDoc(children: IRBlock[]): IRDoc {
  return {
    schemaVersion: 1,
    meta: {
      standardType: 'gb',
      stdCode: 'GB/T 99999—2026',
      title: '段落与表格内图片测试',
    },
    front: { foreword: [], introduction: [] },
    body: [
      {
        kind: 'chapter',
        id: 'ch-1',
        secType: 'general',
        title: [{ text: '技术要求' }],
        children,
      },
    ],
    appendices: [],
    bibliography: [],
  }
}

describe('HTML 与 printCss 行内图片及表格单元格内图片渲染', () => {
  it('HTML screen / print 正确渲染段落行内图片（S/M/L/缺省）与表格单元格内图片，保持行内顺序且不生成图号/图题', () => {
    const doc = makeDoc([
      {
        kind: 'paragraph',
        id: 'p-inline',
        content: [
          { text: '请按按钮' },
          { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '电源键', size: 'S' } },
          { text: '启动，状态见' },
          { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '指示灯', size: 'M' } },
          { text: '与' },
          { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '大图标', size: 'L' } },
          { text: '。' },
        ],
      },
      {
        kind: 'table',
        id: 'tbl-1',
        caption: [{ text: '图形符号对照表' }],
        orientation: 'portrait',
        headerRowCount: 1,
        rows: [
          {
            id: 'r0',
            cells: [
              { id: 'r0c0', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'r0c0-p', content: [{ text: '名称' }] }] },
              { id: 'r0c1', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'r0c1-p', content: [{ text: '图形符号' }] }] },
            ],
          },
          {
            id: 'r1',
            cells: [
              { id: 'r1c0', colspan: 1, rowspan: 1, header: false, content: [{ kind: 'paragraph', id: 'r1c0-p', content: [{ text: '接地符号' }] }] },
              {
                id: 'r1c1',
                colspan: 1,
                rowspan: 1,
                header: false,
                content: [{
                  kind: 'paragraph',
                  id: 'r1c1-p',
                  content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '接地' } }],
                }],
              },
            ],
          },
        ],
        notes: [],
      },
    ])
    const { labels, problems } = resolve(doc)
    expect(problems).toEqual([])

    for (const variant of ['screen', 'print'] as const) {
      const html = renderHtml(doc, labels, { variant })
      expect(html).toContain(
        '请按按钮<img class="ses-inline-image" src="' + SAMPLE_PNG_DATA_URL + '" alt="电源键" data-size="S" />' +
        '启动，状态见<img class="ses-inline-image" src="' + SAMPLE_PNG_DATA_URL + '" alt="指示灯" data-size="M" />' +
        '与<img class="ses-inline-image" src="' + SAMPLE_PNG_DATA_URL + '" alt="大图标" data-size="L" />。',
      )
      expect(html).toContain(
        '<td><img class="ses-inline-image" src="' + SAMPLE_PNG_DATA_URL + '" alt="接地" /></td>',
      )
      // 表格单元格内图片不应产生 figure 元素或图1 编号
      expect(html).not.toContain('data-type="figure"')
      expect(html).not.toContain('图1')
    }

    const screenHtml = renderHtml(doc, labels, { variant: 'screen' })
    expect(screenHtml).toContain('.ses-inline-image')
    expect(screenHtml).toContain('.ses-inline-image[data-size="S"]')

    const pdfCss = printCss()
    expect(pdfCss).toContain('.ses-inline-image')
    expect(pdfCss).toContain('.ses-inline-image[data-size="S"]')
    expect(pdfCss).toContain('.ses-inline-image[data-size="M"]')
    expect(pdfCss).toContain('.ses-inline-image[data-size="L"]')
  })
})

describe('DOCX 行内图片与表格单元格内图片渲染', () => {
  it('段落与表格单元格内的图片生成 wp:inline、正确的 EMU 尺寸、word/media 二进制与关系，纯图片单元格不被替换为“—”', () => {
    const doc = makeDoc([
      {
        kind: 'paragraph',
        id: 'p-1',
        content: [
          { text: '行内小图' },
          { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '小图', size: 'S' } },
          { text: '行内中图' },
          { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '中图', size: 'M' } },
          { text: '行内大图' },
          { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '大图', size: 'L' } },
        ],
      },
      {
        kind: 'table',
        id: 'tbl-img',
        caption: [{ text: '带图片的表格' }],
        orientation: 'portrait',
        headerRowCount: 1,
        rows: [
          {
            id: 'tr-0',
            cells: [
              { id: 'tc-00', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'tc-00-p', content: [{ text: '项目' }] }] },
              { id: 'tc-01', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'tc-01-p', content: [{ text: '纯图片单元格' }] }] },
              { id: 'tc-02', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'tc-02-p', content: [{ text: '超宽图片缩放单元格' }] }] },
            ],
          },
          {
            id: 'tr-1',
            cells: [
              { id: 'tc-10', colspan: 1, rowspan: 1, header: false, content: [{ kind: 'paragraph', id: 'tc-10-p', content: [{ text: '示例A' }] }] },
              {
                id: 'tc-11',
                colspan: 1,
                rowspan: 1,
                header: false,
                content: [{
                  kind: 'paragraph',
                  id: 'tc-11-p',
                  content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '单元格示意图' } }],
                }],
              },
              {
                id: 'tc-12',
                colspan: 1,
                rowspan: 1,
                header: false,
                content: [{
                  kind: 'paragraph',
                  id: 'tc-12-p',
                  content: [
                    { text: '左文' },
                    { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '超宽图' } },
                    { text: '右文' },
                  ],
                }],
              },
            ],
          },
        ],
        notes: [],
      },
    ])

    const { labels, problems } = resolve(doc)
    expect(problems).toEqual([])

    const pkg = renderDocx(doc, labels, {
      formulaOmml: {},
      images: {
        // S (2:1 宽高比)：高 = 12.6pt = 4.445mm = 160020 EMU，宽 = 8.89mm = 320040 EMU
        [inlineImageResourceKey('p-1', 0)]: {
          base64: SAMPLE_PNG_B64,
          contentType: 'image/png',
          widthPx: 40,
          heightPx: 20,
        },
        // M (1:1 宽高比)：高 = 25.2pt = 8.89mm = 320040 EMU，宽 = 8.89mm = 320040 EMU
        [inlineImageResourceKey('p-1', 1)]: {
          base64: SAMPLE_PNG_B64,
          contentType: 'image/png',
          widthPx: 30,
          heightPx: 30,
        },
        // L (1:1 宽高比)：高 = 37.8pt = 13.335mm = 480060 EMU，宽 = 13.335mm = 480060 EMU
        [inlineImageResourceKey('p-1', 2)]: {
          base64: SAMPLE_PNG_B64,
          contentType: 'image/png',
          widthPx: 30,
          heightPx: 30,
        },
        // 表格纯图片单元格（96px × 48px @ 96dpi = 25.4mm × 12.7mm = 914400 × 457200 EMU，小于 3 列单元格可用宽度 ~51.4mm）
        [inlineImageResourceKey('tc-11-p', 0)]: {
          base64: SAMPLE_PNG_B64,
          contentType: 'image/png',
          widthPx: 96,
          heightPx: 48,
        },
        // 表格超宽图片单元格（800px × 400px @ 96dpi = 211.67mm × 105.83mm，超出 3 列单元格可用宽度 ~51.41mm，自动等比缩放）
        [inlineImageResourceKey('tc-12-p', 0)]: {
          base64: SAMPLE_PNG_B64,
          contentType: 'image/png',
          widthPx: 800,
          heightPx: 400,
        },
      },
      stage: 'approval_draft',
      createdAt: '2026-11-13T00:00:00.000Z',
    })

    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()

    const documentXml = pkg.parts['word/document.xml']!
    // S / M / L 尺寸
    expect(documentXml).toContain('<wp:extent cx="320040" cy="160020"/>')
    expect(documentXml).toContain('<wp:extent cx="320040" cy="320040"/>')
    expect(documentXml).toContain('<wp:extent cx="480060" cy="480060"/>')
    // 表格单元格自然尺寸（25.4mm × 12.7mm = 914400 × 457200 EMU）
    expect(documentXml).toContain('<wp:extent cx="914400" cy="457200"/>')
    // 表格单元格超宽图等比缩放到单元格可用宽度（3 列均分 9355 twips -> 3118 twips，减左右边距 2×102 twips = 2914 twips ≈ 51.40mm ≈ 1850390 EMU，高为宽的一半 925195 EMU）
    const oversizedMatch = /<wp:inline\b[^>]*><wp:extent cx="(\d+)" cy="(\d+)"\/>[^<]*<wp:effectExtent[^>]*\/><wp:docPr[^>]*descr="超宽图"/.exec(documentXml)
    expect(oversizedMatch).not.toBeNull()
    const scaledCx = Number(oversizedMatch![1])
    const scaledCy = Number(oversizedMatch![2])
    expect(scaledCx).toBeGreaterThan(1800000)
    expect(scaledCx).toBeLessThan(1900000)
    expect(Math.abs(scaledCx - scaledCy * 2)).toBeLessThanOrEqual(2)

    // 表格中没有产生任何图题样式 SesFigCap / SesAppFigCap，且纯图片单元格没有被填成“—”
    expect(documentXml).not.toContain('SesFigCap')
    expect(documentXml).not.toContain('SesAppFigCap')
    const outline = docxOutline(pkg)
    expect(outline).toContain('SesPara │ — │ 行内小图〔图〕行内中图〔图〕行内大图〔图〕')
    expect(outline).toContain('┆SesTableCenter │ — │ 〔图〕')
    expect(outline).toContain('┆SesTableText │ — │ 左文〔图〕右文')
    expect(outline).not.toContain('┆SesTableCenter │ — │ —')

    // 封面 2 张内置图 + 正文/表格 5 张行内图片全部写入 word/media/image1..7.png
    expect(Object.keys(pkg.binaries).sort()).toEqual([
      'word/media/image1.png',
      'word/media/image2.png',
      'word/media/image3.png',
      'word/media/image4.png',
      'word/media/image5.png',
      'word/media/image6.png',
      'word/media/image7.png',
    ])
  })

  it('行内图片资源缺失时输出〔图片缺失〕占位符并记录 image-missing 警告', () => {
    const doc = makeDoc([
      {
        kind: 'paragraph',
        id: 'p-missing',
        content: [{ text: '缺失示例：' }, { text: '', image: { src: 'asset:missing' } }],
      },
    ])
    const { labels } = resolve(doc)
    const pkg = renderDocx(doc, labels, {
      formulaOmml: {},
      images: {},
      stage: 'approval_draft',
      createdAt: '2026-11-13T00:00:00.000Z',
    })
    expect(pkg.parts['word/document.xml']).toContain('缺失示例：')
    expect(pkg.parts['word/document.xml']).toContain('〔图片缺失〕')
    expect(pkg.warnings.some((w) => w.code === 'image-missing' && w.nodeId === 'p-missing')).toBe(true)
  })
})
