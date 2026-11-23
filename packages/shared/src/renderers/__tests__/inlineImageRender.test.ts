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
import { getOutputSupportProblems } from '../outputBoundary'
import { printCss } from '../printCss'
import { inlineImageResourceKey, renderDocx } from '../docx'
import { paginateTable } from '../docx/body/tablePagination'
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
        '<td class="ses-image-only-cell"><img class="ses-inline-image" src="' + SAMPLE_PNG_DATA_URL + '" alt="接地" /></td>',
      )
      // 表格单元格内图片不应产生 figure 元素或图1 编号
      expect(html).not.toContain('data-type="figure"')
      expect(html).not.toContain('图1')
    }

    const screenHtml = renderHtml(doc, labels, { variant: 'screen' })
    expect(screenHtml).toContain('.ses-inline-image')
    expect(screenHtml).toContain('.ses-inline-image[data-size="S"] { max-height: 1.2em; }')
    expect(screenHtml).toContain('.ses-inline-image[data-size="M"] { max-height: 2.4em; }')
    expect(screenHtml).toContain('.ses-inline-image[data-size="L"] { max-height: 3.6em; }')

    const pdfCss = printCss()
    expect(pdfCss).toContain('.ses-inline-image')
    expect(pdfCss).toContain('.ses-inline-image[data-size="S"] { max-height: 1.2em; }')
    expect(pdfCss).toContain('.ses-inline-image[data-size="M"] { max-height: 2.4em; }')
    expect(pdfCss).toContain('.ses-inline-image[data-size="L"] { max-height: 3.6em; }')
  })

  it('outputBoundary 阻断混合了 text/marks/footnote/formula 或非法 size 的行内图 run，HTML 不输出非法 data-size', () => {
    const invalidDoc = makeDoc([
      {
        kind: 'paragraph',
        id: 'p-bad',
        content: [
          {
            text: '多余文字',
            marks: [{ type: 'bold' }],
            footnote: { id: 'fn-1', content: [{ text: '注' }] },
            formula: { id: 'fm-1', latex: 'x' },
            image: { src: SAMPLE_PNG_DATA_URL, size: 'XL' as never },
          },
        ],
      },
    ])
    for (const format of ['HTML', 'DOCX'] as const) {
      const paths = getOutputSupportProblems(invalidDoc, format).map((p) => p.path)
      expect(paths).toContain('doc.body[0].children[0].content[0].text')
      expect(paths).toContain('doc.body[0].children[0].content[0].marks')
      expect(paths).toContain('doc.body[0].children[0].content[0].footnote')
      expect(paths).toContain('doc.body[0].children[0].content[0].formula')
      expect(paths).toContain('doc.body[0].children[0].content[0].image.size')
    }

    const sizeDoc = makeDoc([
      {
        kind: 'paragraph',
        id: 'p-size',
        content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, size: 'XL' as never } }],
      },
    ])
    const { labels } = resolve(sizeDoc)
    expect(() => renderHtml(sizeDoc, labels, { variant: 'screen' })).toThrow(/image\.size/)
  })
})

describe('DOCX 列表行内图宽度', () => {
  it('正文注首段及续段按单条或多条注的缩进限制图片宽度', () => {
    const para = (id: string) => ({ kind: 'paragraph' as const, id, content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: id } }] })
    const note = (id: string) => ({ kind: 'note' as const, id, content: [para(`${id}-first`), para(`${id}-rest`)] })
    const image = { base64: SAMPLE_PNG_B64, contentType: 'image/png', widthPx: 1200, heightPx: 600 }
    const drawings = [makeDoc([note('single')]), makeDoc([note('multi1'), note('multi2')])].flatMap(doc => {
      const { labels } = resolve(doc)
      const xml = renderDocx(doc, labels, { formulaOmml: {}, images: { [SAMPLE_PNG_DATA_URL]: image }, stage: 'approval_draft', createdAt: '2026-11-13T00:00:00.000Z' }).parts['word/document.xml']!
      return [...xml.matchAll(/<wp:inline\b[^>]*><wp:extent cx="(\d+)" cy="(\d+)"\/>[^<]*<wp:effectExtent[^>]*\/><wp:docPr[^>]*descr="([^"]+)"/g)]
    })
    for (const id of ['single', 'multi1', 'multi2']) for (const part of ['first', 'rest']) {
      const drawing = drawings.find(m => m[3] === `${id}-${part}`)
      expect(drawing).toBeDefined()
      const expected = (165 - (id === 'single' ? 780 : 870) * 25.4 / 1440) * 36000
      expect(Number(drawing![1])).toBeCloseTo(expected, -1)
    }
  })

  it.each([['dash', 1, 840], ['dot', 1, 1260], ['alpha', 2, 1260], ['number', 1, 1260]] as const)('%s 列表的图片按实际缩进缩放', (listType, level, indent) => {
    const doc = makeDoc([{ kind: 'list', id: 'variants', listType, level, items: [{ id: 'variant-item', content: [{ kind: 'paragraph', id: 'variant-p', content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: 'variant' } }] }] }] }])
    const { labels } = resolve(doc)
    const image = { base64: SAMPLE_PNG_B64, contentType: 'image/png', widthPx: 1200, heightPx: 600 }
    const xml = renderDocx(doc, labels, { formulaOmml: {}, images: { [SAMPLE_PNG_DATA_URL]: image }, stage: 'approval_draft', createdAt: '2026-11-13T00:00:00.000Z' }).parts['word/document.xml']!
    const drawing = /<wp:inline\b[^>]*><wp:extent cx="(\d+)" cy="(\d+)"\/>[^<]*<wp:effectExtent[^>]*\/><wp:docPr[^>]*descr="variant"/.exec(xml)!
    expect(Number(drawing[1])).toBeCloseTo((165 - indent * 25.4 / 1440) * 36000, -1)
  })

  it('表格分页估算使用扣除列表缩进后的图片高度', () => {
    const table = { kind: 'table' as const, id: 'page-table', caption: [], orientation: 'portrait' as const, headerRowCount: 0, notes: [], rows: [{ id: 'page-row', cells: [{ id: 'page-cell', colspan: 1, rowspan: 1, header: false, columnWidths: [200], content: [{ kind: 'list' as const, id: 'page-list', listType: 'alpha' as const, items: [{ id: 'page-item', content: [{ kind: 'paragraph' as const, id: 'page-p', content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL } }] }] }] }] }] }] }
    const image = { base64: SAMPLE_PNG_B64, contentType: 'image/png', widthPx: 1200, heightPx: 600 }
    const result = paginateTable(table, { images: { [SAMPLE_PNG_DATA_URL]: image } })
    const width = (3000 - 204 - 840) * 25.4 / 1440
    const empty = paginateTable({ ...table, rows: [] }, { images: {} })
    expect(result.totalHeightMm - empty.totalHeightMm).toBeCloseTo(Math.ceil(width / 2 / 4.2) * 4.2 + 0.2, 5)
  })

  it('注内列表使用容器的绝对缩进，极窄单元格输出正数图片尺寸', () => {
    const imageRun = (id: string) => ({ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: id } })
    const list = (id: string) => ({ kind: 'list' as const, id: `${id}-list`, listType: 'alpha' as const, items: [{ id: `${id}-item`, content: [{ kind: 'paragraph' as const, id, content: [imageRun(id)] }] }] })
    const doc = makeDoc([
      { kind: 'note', id: 'note-list', content: [{ kind: 'paragraph', id: 'note-text', content: [{ text: '注' }] }, list('nested') ] },
      { kind: 'table', id: 'narrow-table', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [], rows: [{ id: 'narrow-row', cells: [{ id: 'narrow-cell', colspan: 1, rowspan: 1, header: false, columnWidths: [10], content: [list('narrow')] }] }] },
    ])
    const { labels } = resolve(doc)
    const image = { base64: SAMPLE_PNG_B64, contentType: 'image/png', widthPx: 1200, heightPx: 600 }
    const xml = renderDocx(doc, labels, { formulaOmml: {}, images: { [SAMPLE_PNG_DATA_URL]: image }, stage: 'approval_draft', createdAt: '2026-11-13T00:00:00.000Z' }).parts['word/document.xml']!
    const drawings = [...xml.matchAll(/<wp:inline\b[^>]*><wp:extent cx="(\d+)" cy="(\d+)"\/>[^<]*<wp:effectExtent[^>]*\/><wp:docPr[^>]*descr="([^"]+)"/g)]
    const nested = drawings.find(m => m[3] === 'nested')!
    expect(Number(nested[1])).toBeCloseTo((165 - 840 * 25.4 / 1440) * 36000, -1)
    const narrow = drawings.find(m => m[3] === 'narrow')!
    expect(Number(narrow[1])).toBeGreaterThan(0)
    expect(Number(narrow[2])).toBeGreaterThan(0)
  })

  it('按正文和单元格的列表层级扣除缩进，首段和续段均等比缩放', () => {
    const paragraph = (id: string) => ({ kind: 'paragraph' as const, id, content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: id } }] })
    const list = (prefix: string) => ({
      kind: 'list' as const, id: `${prefix}-list`, listType: 'alpha' as const,
      items: [{ id: `${prefix}-item`, content: [paragraph(`${prefix}-first`), paragraph(`${prefix}-rest`), {
        kind: 'list' as const, id: `${prefix}-nested`, listType: 'number' as const,
        items: [{ id: `${prefix}-nested-item`, content: [paragraph(`${prefix}-nested-first`), paragraph(`${prefix}-nested-rest`)] }],
      }] }],
    })
    const doc = makeDoc([list('body'), {
      kind: 'table', id: 'table-list', caption: [{ text: '列表' }], orientation: 'portrait', headerRowCount: 0, notes: [],
      rows: [{ id: 'row-list', cells: [{ id: 'cell-list', colspan: 1, rowspan: 1, header: false, columnWidths: [200], content: [list('cell')] }] }],
    }])
    const { labels } = resolve(doc)
    const image = { base64: SAMPLE_PNG_B64, contentType: 'image/png', widthPx: 1200, heightPx: 600 }
    const pkg = renderDocx(doc, labels, { formulaOmml: {}, images: { [SAMPLE_PNG_DATA_URL]: image }, stage: 'approval_draft', createdAt: '2026-11-13T00:00:00.000Z' })
    const xml = pkg.parts['word/document.xml']!
    for (const prefix of ['body', 'cell']) for (const part of ['first', 'rest', 'nested-first', 'nested-rest']) {
      // Match the extent adjacent to this particular drawing, not an earlier drawing.
      const drawing = [...xml.matchAll(/<wp:inline\b[^>]*><wp:extent cx="(\d+)" cy="(\d+)"\/>[^<]*<wp:effectExtent[^>]*\/><wp:docPr[^>]*descr="([^"]+)"/g)].find(m => m[3] === `${prefix}-${part}`)
      expect(drawing).toBeDefined()
      const cx = Number(drawing![1]), cy = Number(drawing![2])
      const containerMm = prefix === 'body' ? 165 : (3000 - 204) * 25.4 / 1440
      const indentTwips = part.startsWith('nested') ? 1260 : 840
      expect(cx).toBeCloseTo(Math.round((containerMm - indentTwips * 25.4 / 1440) * 36000), -1)
      expect(Math.abs(cx - cy * 2)).toBeLessThanOrEqual(2)
    }
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
    // 表格混排图的默认高度不超过小五号字单行高度，宽高比不变。
    const oversizedMatch = /<wp:inline\b[^>]*><wp:extent cx="(\d+)" cy="(\d+)"\/>[^<]*<wp:effectExtent[^>]*\/><wp:docPr[^>]*descr="超宽图"/.exec(documentXml)
    expect(oversizedMatch).not.toBeNull()
    const scaledCx = Number(oversizedMatch![1])
    const scaledCy = Number(oversizedMatch![2])
    expect(scaledCy).toBeCloseTo(10.8 * 25.4 / 72 * 36000, -1)
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

  it('表格分页按单元格宽度与自然尺寸图片的实际渲染高度切分续表', () => {
    // 单图单元格限高 50mm；增加到 6 行仍应超出一页并生成续表题。
    const doc = makeDoc([
      {
        kind: 'table',
        id: 'tbl-tall-img',
        caption: [{ text: '大图续表测试' }],
        orientation: 'portrait',
        headerRowCount: 1,
        rows: [
          {
            id: 'tr-h',
            cells: [
              { id: 'tc-h0', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'tc-h0-p', content: [{ text: '图形列' }] }] },
            ],
          },
          ...([1, 2, 3, 4, 5, 6] as const).map((i) => ({
            id: `tr-${i}`,
            cells: [
              {
                id: `tc-${i}`,
                colspan: 1,
                rowspan: 1,
                header: false,
                content: [{
                  kind: 'paragraph' as const,
                  id: `tc-${i}-p`,
                  content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: `大图${i}` } }],
                }],
              },
            ],
          })),
        ],
        notes: [],
      },
    ])
    const { labels } = resolve(doc)
    const tallImage = {
      base64: SAMPLE_PNG_B64,
      contentType: 'image/png' as const,
      widthPx: 400,
      heightPx: 400,
    }
    const pkg = renderDocx(doc, labels, {
      formulaOmml: {},
      images: {
        [inlineImageResourceKey('tc-1-p', 0)]: tallImage,
        [inlineImageResourceKey('tc-2-p', 0)]: tallImage,
        [inlineImageResourceKey('tc-3-p', 0)]: tallImage,
        [inlineImageResourceKey('tc-4-p', 0)]: tallImage,
        [inlineImageResourceKey('tc-5-p', 0)]: tallImage,
        [inlineImageResourceKey('tc-6-p', 0)]: tallImage,
      },
      stage: 'approval_draft',
      createdAt: '2026-11-13T00:00:00.000Z',
    })
    const outline = docxOutline(pkg)
    expect(outline).toContain('SesTblCapCont │ — │ 表1　大图续表测试（续）')
  })

  it('单元格内由换行符分隔的多张高窄行内图片按分行累加高度并正确切分续表', () => {
    // 12 行数据，每行含两张显式 L 尺寸的图并由换行符分隔；总高度超过一页，须生成续表。
    const doc = makeDoc([
      {
        kind: 'table',
        id: 'tbl-br-img',
        caption: [{ text: '换行双图续表测试' }],
        orientation: 'portrait',
        headerRowCount: 1,
        rows: [
          {
            id: 'tr-h',
            cells: [
              { id: 'tc-h0', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'tc-h0-p', content: [{ text: '图形列' }] }] },
            ],
          },
          ...Array.from({ length: 12 }, (_, index) => index + 1).map((i) => ({
            id: `tr-${i}`,
            cells: [
              {
                id: `tc-${i}`,
                colspan: 1,
                rowspan: 1,
                header: false,
                content: [{
                  kind: 'paragraph' as const,
                  id: `tc-${i}-p`,
                  content: [
                    { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: `上图${i}`, size: 'L' as const } },
                    { text: '\n' },
                    { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: `下图${i}`, size: 'L' as const } },
                  ],
                }],
              },
            ],
          })),
        ],
        notes: [],
      },
    ])
    const { labels } = resolve(doc)
    const narrowTallImage = {
      base64: SAMPLE_PNG_B64,
      contentType: 'image/png' as const,
      widthPx: 80,
      heightPx: 380,
    }
    const pkg = renderDocx(doc, labels, {
      formulaOmml: {},
      images: {
        [SAMPLE_PNG_DATA_URL]: narrowTallImage,
        [inlineImageResourceKey('tc-1-p', 0)]: narrowTallImage,
        [inlineImageResourceKey('tc-1-p', 1)]: narrowTallImage,
        [inlineImageResourceKey('tc-2-p', 0)]: narrowTallImage,
        [inlineImageResourceKey('tc-2-p', 1)]: narrowTallImage,
      },
      stage: 'approval_draft',
      createdAt: '2026-11-13T00:00:00.000Z',
    })
    const outline = docxOutline(pkg)
    expect(outline).toContain('SesTblCapCont │ — │ 表1　换行双图续表测试（续）')
  })

  it('横向附录内的行内图片按横排版心宽度（252mm）上限缩放，不被截断在竖排 165mm', () => {
    const doc: IRDoc = {
      ...makeDoc([]),
      appendices: [
        {
          kind: 'appendix',
          id: 'app-land',
          normative: false,
          orientation: 'landscape',
          title: [{ text: '横向附录' }],
          children: [
            {
              kind: 'paragraph',
              id: 'app-p',
              content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '横排宽图' } }],
            },
          ],
        },
      ],
    }
    const { labels } = resolve(doc)
    // 756px @ 96dpi = 200.025mm > 165mm 且 < 252mm，在横向附录中应保持原始 200.025mm 宽（7200900 EMU）
    const pkg = renderDocx(doc, labels, {
      formulaOmml: {},
      images: {
        [inlineImageResourceKey('app-p', 0)]: {
          base64: SAMPLE_PNG_B64,
          contentType: 'image/png',
          widthPx: 756,
          heightPx: 96,
        },
      },
      stage: 'approval_draft',
      createdAt: '2026-11-13T00:00:00.000Z',
    })
    expect(pkg.parts['word/document.xml']).toContain('<wp:extent cx="7200900" cy="914400"/>')
  })
})


describe('图片尺寸与纯图片单元格', () => {
  it('正文图使用保存的 CSS 像素尺寸输出 HTML 和 DOCX，与资源 DPI 无关', () => {
    const doc = makeDoc([{ kind: 'figure', id: 'sized-fig', orientation: 'portrait', caption: [{ text: '图题' }], notes: [], src: SAMPLE_PNG_DATA_URL, imageWidth: { value: 192, unit: 'px' }, imageHeight: { value: 96, unit: 'px' } }])
    const { labels } = resolve(doc)
    expect(renderHtml(doc, labels, { variant: 'screen' })).toContain('width:192px;aspect-ratio:192 / 96;height:auto')
    const image = { base64: SAMPLE_PNG_B64, contentType: 'image/png', widthPx: 1200, heightPx: 600, dpi: 300 }
    const xml = renderDocx(doc, labels, { formulaOmml: {}, images: { 'sized-fig': image }, stage: 'approval_draft', createdAt: '2026-11-13T00:00:00.000Z' }).parts['word/document.xml']!
    expect(xml).toContain('<wp:extent cx="1828800" cy="914400"/>')
  })
  it.each(['screen', 'print'] as const)('%s 下仅指定高度的图按原始比例同时适配版心宽度和指定高度', (variant) => {
    const doc = makeDoc([{
      kind: 'figure', id: 'height-only', orientation: 'portrait', caption: [], notes: [],
      src: SAMPLE_PNG_DATA_URL, imageHeight: { value: 100, unit: 'mm' },
    }])
    const { labels } = resolve(doc)
    const html = renderHtml(doc, labels, { variant })
    expect(html).toContain('style="width:100%;height:auto;max-height:100mm;object-fit:contain"')
  })
  it('合并单元格仅图居中并受内容宽高约束，图文混排保持原有尺寸', () => {
    const doc = makeDoc([{ kind: 'table', id: 'image-grid', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [], rows: [
      { id: 'r1', cells: [{ id: 'merged', colspan: 2, rowspan: 1, header: false, columnWidths: [240, 240], content: [{ kind: 'paragraph', id: 'only', content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '仅图' } }] }] }] },
      { id: 'r2', cells: [{ id: 'mixed', colspan: 1, rowspan: 1, header: false, columnWidths: [240], content: [{ kind: 'paragraph', id: 'mixed-p', content: [{ text: '文字' }, { text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '混排' } }] }] },
        { id: 'sized', colspan: 1, rowspan: 1, header: false, columnWidths: [240], content: [{ kind: 'paragraph', id: 'sized-p', content: [{ text: '', image: { src: SAMPLE_PNG_DATA_URL, alt: '小图', size: 'S' } }] }] }] },
    ] }])
    const { labels } = resolve(doc)
    const html = renderHtml(doc, labels, { variant: 'screen' })
    expect(html).toContain('<td colspan="2" class="ses-image-only-cell">')
    expect(html).toContain('<td class="ses-image-only-cell"><img class="ses-inline-image"')
    const image = { base64: SAMPLE_PNG_B64, contentType: 'image/png', widthPx: 1200, heightPx: 600 }
    const xml = renderDocx(doc, labels, { formulaOmml: {}, images: { [SAMPLE_PNG_DATA_URL]: image }, stage: 'approval_draft', createdAt: '2026-11-13T00:00:00.000Z' }).parts['word/document.xml']!
    const drawings = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>[^<]*<wp:effectExtent[^>]*\/><wp:docPr[^>]*descr="([^"]+)"/g)]
    const one = drawings.find(m => m[3] === '仅图')!
    const mixed = drawings.find(m => m[3] === '混排')!
    const sized = drawings.find(m => m[3] === '小图')!
    expect(Number(one[1])).toBeCloseTo((7200 - 204) * 25.4 / 1440 * 0.8 * 36000, -1)
    expect(Number(one[2])).toBeLessThanOrEqual(50 * 36000)
    expect(Number(mixed[2])).toBeCloseTo(10.8 * 25.4 / 72 * 36000, -1)
    expect(html).toContain('.ses-table-block td:not(.ses-image-only-cell) .ses-inline-image:not([data-size])')
    expect(Number(sized[2])).toBeCloseTo(12.6 * 25.4 / 72 * 36000, -1)
    expect(xml).toContain('<w:vAlign w:val="center"/>')
  })

})
