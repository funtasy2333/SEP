import { describe, expect, it } from 'vitest'
import { renderHtml } from './html'
import { renderWatermarkPreviewHtml } from './coverHtml'
import { resolve } from '../ir/resolve'
import type { IRDoc, IRDocMeta } from '../ir/types'

function doc(meta: Partial<IRDocMeta> = {}): IRDoc {
  return {
    schemaVersion: 1,
    meta: {
      standardType: 'gb', title: '测试标准', titleEn: 'Test standard', stdCode: 'GB/T 12345-2026',
      icsCode: '01.120', ccsCode: 'A 00', publishDate: '2026-11-07', implementDate: '2027-01-01',
      ...meta,
    },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'c1', secType: 'scope', title: [{ text: '范围' }], children: [] }],
    appendices: [], bibliography: [],
  }
}

function print(meta: Partial<IRDocMeta> = {}, stage: 'working_draft' | 'comment_draft' | 'published' = 'working_draft') {
  const input = doc(meta)
  return renderHtml(input, resolve(input).labels, { variant: 'print', stage })
}

describe('PDF 打印封面', () => {
  it('封面在目次和正文之前，含编号、分类号、题名、日期和国家标准标志', () => {
    const html = print()
    const cover = /<section class="ses-cover"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
    expect(cover).toContain('data-type="cover"')
    for (const value of ['ICS 01.120', 'CCS A 00', '中华人民共和国国家标准', 'GB/T 12345—2026', '测试标准', 'Test standard', '2026-11-07', '2027-01-01']) {
      expect(cover).toContain(value)
    }
    expect(cover).toContain('alt="GB 标志"')
    expect(cover).toContain('data:image/png;base64,')
    expect(html.indexOf('data-type="cover"')).toBeLessThan(html.indexOf('data-type="toc"'))
    expect(html.indexOf('data-type="toc"')).toBeLessThan(html.indexOf('<div class="ses-body-content">'))
    expect(html).toContain('.ses-cover-english { font-family: var(--ses-song); }')
  })

  it.each([
    ['industry', '中华人民共和国机械行业标准', { industryName: '机械', filingNo: '12345', stdCode: 'JB/T 1234—2026', issuer: '行业发布单位' }],
    ['local', '浙江省地方标准', { regionName: '浙江省', stdCode: 'DB33/T 1234—2026', issuer: '地方发布单位' }],
    ['group', '团体标准', { stdCode: 'T/ABC 123—2026', issuer: '某协会' }],
    ['enterprise', '企业标准', { stdCode: 'Q/ABC 123—2026', issuer: '某公司' }],
    ['guide', '中华人民共和国国家标准化指导性技术文件', { stdCode: 'GB/Z 123—2026' }],
  ] as const)('%s 封面使用对应称谓和发布单位', (standardType, designation, fields) => {
    const html = print({ standardType, ...fields })
    const cover = /<section class="ses-cover"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
    expect(cover).toContain(designation)
    if ('issuer' in fields) expect(cover).toContain(fields.issuer)
    if ('filingNo' in fields) expect(cover).toContain('备案号：12345')
  })

  it('草案有阶段标识，发布稿不显示草案标识；征求意见稿带专利反馈说明', () => {
    expect(print()).toContain('（工作草案）')
    expect(print({}, 'comment_draft')).toContain('（征求意见稿）')
    expect(print({}, 'comment_draft')).toContain('相关专利')
    expect(print({}, 'published')).not.toContain('（工作草案）')
  })

  it('缺失日期使用占位，封面元数据按文本转义，正文输入保持不变', () => {
    const input = doc({ title: '<img src=x onerror=alert(1)>', issuer: 'A&B', publishDate: '', implementDate: '' })
    const before = structuredClone(input)
    const html = renderHtml(input, resolve(input).labels, { variant: 'print' })
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('XXXX-XX-XX')
    expect(input).toEqual(before)
  })

  it('print 变体支持自定义徽标、附加声明与独立封底，screen 变体保持纯净', () => {
    const coverLayout = {
      logo: {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP///8AA/9oADAMBAAIRAxEAPwD/',
        position: 'replace_mark' as const,
        widthMm: 35,
        heightMm: 18,
      },
      notice: {
        text: '内部受控版本，禁止翻印',
        position: 'above_dates' as const,
      },
      backCover: {
        enabled: true,
        copyrightNotice: '© 2026 某团体标准组织',
        contactInfo: '联系电话：010-12345678',
      },
    }
    const input = doc({ standardType: 'group', stdCode: 'T/ABC 1—2026', issuer: '某协会' })
    const labels = resolve(input).labels
    const printHtml = renderHtml(input, labels, { variant: 'print', stage: 'working_draft', coverLayout })
    expect(printHtml).toContain('@page back-cover')
    expect(printHtml).toContain('ses-cover-logo-custom')
    expect(printHtml).toContain('内部受控版本，禁止翻印')
    expect(printHtml).toContain('SESBACKCOVERANCHOR')
    expect(printHtml).toContain('© 2026 某团体标准组织')
    expect(printHtml.indexOf('data-type="cover"')).toBeLessThan(printHtml.indexOf('data-type="back-cover"'))
    expect(printHtml.indexOf('data-type="back-cover"')).toBeLessThan(printHtml.indexOf('data-type="toc"'))

    const screenHtml = renderHtml(input, labels, { variant: 'screen', coverLayout })
    expect(screenHtml).not.toContain('ses-cover-logo-custom')
    expect(screenHtml).not.toContain('内部受控版本，禁止翻印')
    expect(screenHtml).not.toContain('SESBACKCOVERANCHOR')
  })

  it('支持衬于文字下方徽标、独立右上角标志、自由封底区块及正文水印预览与打印', () => {
    const coverLayout = {
      logo: {
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        position: 'top_left' as const,
        wrap: 'behind_text' as const,
        widthMm: 28,
        heightMm: 14,
        offsetXMm: 3,
        offsetYMm: -2,
      },
      topRightMark: { mode: 'text' as const, text: 'T/ZSM', fontSizePt: 22 },
      backCover: {
        enabled: true,
        verticalAlign: 'middle' as const,
        boxed: true,
        blocks: [
          { id: 'h1', type: 'heading' as const, text: '版权保护文件', align: 'center' as const },
          { id: 'p1', type: 'paragraph' as const, text: '请勿翻印。', indent: true },
        ],
      },
      watermark: {
        enabled: true,
        kind: 'text' as const,
        text: '评审草案',
        frequency: 'alternate' as const,
        opacity: 0.2,
      },
    }
    const input = doc({ standardType: 'group', stdCode: 'T/ZSM 1—2026', issuer: '学会' })
    const labels = resolve(input).labels
    const printHtml = renderHtml(input, labels, { variant: 'print', stage: 'working_draft', coverLayout })
    expect(printHtml).toContain('ses-cover-custom-logo-behind')
    expect(printHtml).toContain('ses-cover-logo-text-custom')
    expect(printHtml).toContain('T/ZSM')
    expect(printHtml).toContain('ses-back-cover-boxed')
    expect(printHtml).toContain('版权保护文件')
    expect(printHtml).toContain('<style id="ses-pdf-watermark">')
    expect(printHtml).toContain('@page body:nth(2n+1 of body)')
    expect(printHtml).not.toContain('<div class="ses-watermark-print-layer"')

    const screenHtml = renderHtml(input, labels, { variant: 'screen', coverLayout })
    expect(screenHtml).not.toContain('ses-watermark-layer')

    const previewAlt = renderWatermarkPreviewHtml(input.meta, coverLayout.watermark)
    expect(previewAlt).toContain('第 1 页（奇数页 · 含水印）')
    expect(previewAlt).toContain('第 2 页（偶数页 · 无水印）')

    const previewEvery = renderWatermarkPreviewHtml(input.meta, {
      ...coverLayout.watermark,
      frequency: 'every',
    })
    expect(previewEvery).toContain('第 1 页（奇数页 · 含水印）')
    expect(previewEvery).not.toContain('偶数页 · 无水印')
  })

  it('renders text and image watermarks as page backgrounds for front, body and landscape pages', () => {
    const input = doc()
    const labels = resolve(input).labels
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    for (const watermark of [
      { enabled: true, kind: 'text' as const, text: 'A<&B', color: '#112233', fontSizePt: 36, rotationDeg: -30, opacity: 0.3, frequency: 'every' as const },
      { enabled: true, kind: 'image' as const, dataUrl: image, widthMm: 50, heightMm: 30, opacity: 0.4, frequency: 'alternate' as const },
    ]) {
      const html = renderHtml(input, labels, { variant: 'print', coverLayout: { watermark } })
      const style = /<style id="ses-pdf-watermark">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
      expect(style).toContain(watermark.frequency === 'every' ? '@page front {' : '@page front:nth(2n+1 of front) {')
      expect(style).toContain(watermark.frequency === 'every' ? '@page body {' : '@page body:nth(2n+1 of body) {')
      expect(style).toContain(watermark.frequency === 'every' ? '@page landscape {' : '@page landscape:nth(2n+1 of body) {')
      expect(style).toContain('@page body:blank')
      expect(style).toContain('@page front:blank')
      expect(style).toContain('@page landscape:blank')
      const svg = decodeURIComponent(/data:image\/svg\+xml,([^"']+)/.exec(style)?.[1] ?? '')
      expect(style.match(/data:image\/svg\+xml,/g)).toHaveLength(1)
      if (watermark.kind === 'text') {
        expect(svg).toContain('A&lt;&amp;B')
        expect(svg).toContain('#112233')
      } else {
        expect(svg).toContain(image)
      }
      expect(renderHtml(input, labels, { variant: 'screen', coverLayout: { watermark } })).not.toContain('ses-pdf-watermark')
    }
  })

  it('omits invalid XML characters from watermark text without breaking print rendering', () => {
    const input = doc()
    const html = renderHtml(input, resolve(input).labels, { variant: 'print', coverLayout: {
      watermark: { enabled: true, kind: 'text', frequency: 'every', text: 'OK\u0000\ud800!' },
    } })
    const svg = decodeURIComponent(/data:image\/svg\+xml,([^"']+)/.exec(html)?.[1] ?? '')
    expect(svg).toContain('OK!')
    expect(svg).not.toContain('\u0000')
  })
})
