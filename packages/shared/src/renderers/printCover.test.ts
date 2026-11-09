import { describe, expect, it } from 'vitest'
import { renderHtml } from './html'
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
})
