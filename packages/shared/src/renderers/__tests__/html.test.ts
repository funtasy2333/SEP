/**
 * WP4 渲染器测试：全要素 fixture → pmToIr → resolve → renderHtml。
 * 覆盖 screen/print 两变体的快照、编号一致性、print 无内部链接约束、printCss 关键选择器。
 */

import { describe, it, expect } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import { renderHtml } from '../html'
import { printCss } from '../printCss'
import { fullFixture } from '../../ir/__tests__/fixtures'

function renderFixture(variant: 'screen' | 'print'): string {
  const { doc } = pmToIr(fullFixture())
  const { labels } = resolve(doc)
  return renderHtml(doc, labels, { variant })
}

describe('renderHtml — 全要素 fixture', () => {
  it('screen 变体快照', () => {
    expect(renderFixture('screen')).toMatchSnapshot()
  })

  it('print 变体快照', () => {
    expect(renderFixture('print')).toMatchSnapshot()
  })

  it('纯函数：两次渲染输出字节级相同', () => {
    expect(renderFixture('print')).toBe(renderFixture('print'))
    expect(renderFixture('screen')).toBe(renderFixture('screen'))
  })
})

describe('编号一致性（编号全部取自 labels，渲染器无计数器）', () => {
  const html = renderFixture('screen')

  it.each([
    ['章编号', '<span class="ses-num">1</span>'],
    ['术语条目编号', '3.1'],
    ['图编号', '图1'],
    ['表编号', '表1'],
    ['公式编号', '<span class="ses-formula-num">(1)</span>'],
    ['附录编号', '附录A'],
    ['附录字母前缀图', '图A.1'],
    ['附录字母前缀表', '表A.1'],
    ['多条注编号', '注1：'],
    ['多条示例编号', '示例1：'],
    ['参考文献编号', '[1]'],
  ])('包含 %s（%s）', (_name, needle) => {
    expect(html).toContain(needle)
  })

  it('交叉引用渲染为 Resolver 解析的 refText（screen 为 <a>）', () => {
    // fixture: xref('4.2', 'cl-42') → refText "4.2"；xref('表1','tbl-1') → "表1"
    expect(html).toContain('class="ses-xref" href="#sec_4.2"')
    expect(html).toContain('class="ses-xref" href="#tab_1"')
  })

  it('参考文献按引用顺序：被引用的 bib-2 排为 [1]', () => {
    // fixture 中正文先引用 bib-2，故其编号为 [1]
    const ix1 = html.indexOf('ISO/IEC Directives')
    const ix2 = html.indexOf('GB/T 20000.1—2014 标准化工作指南')
    expect(ix1).toBeGreaterThan(-1)
    expect(ix1).toBeLessThan(ix2) // 被引用者居前
  })
})

describe('print 变体：无内部链接（WP0 结论 1）', () => {
  const html = renderFixture('print')

  it('不含任何 <a 标签', () => {
    expect(html).not.toMatch(/<a[\s>]/)
  })

  it('交叉引用为纯文本 span，保留 data-ref-target', () => {
    expect(html).toContain('<span class="ses-xref" data-ref-target="cl-42">4.2</span>')
  })

  it('目次页码为定宽占位（无数字，待 WP5 注入）', () => {
    expect(html).toContain('class="ses-toc-page" data-target="sec_1">　</span>')
  })

  it('内嵌 printCss（含命名页与镜像版心）', () => {
    expect(html).toContain('@page :right')
    expect(html).toContain('@page body:blank')
  })
})

describe('前置页顺序与正文首页', () => {
  const html = renderFixture('print')

  it('顺序为 目次 → 前言 → 引言 → 正文', () => {
    const toc = html.indexOf('id="front_toc"')
    const fw = html.indexOf('id="front_foreword"')
    const intro = html.indexOf('id="front_intro"')
    const body = html.indexOf('<div class="ses-body-content">')
    expect(toc).toBeGreaterThan(-1)
    expect(toc).toBeLessThan(fw)
    expect(fw).toBeLessThan(intro)
    expect(intro).toBeLessThan(body)
  })

  it('正文首页含文件名称（三号黑体块）', () => {
    expect(html).toContain('<h1 class="ses-doc-title">标准化文件编辑系统</h1>')
  })

  it('无题条编号与首段同排', () => {
    // cl-421 无题条，编号 4.2.1
    expect(html).toContain('<span class="ses-clause-num-only">4.2.1</span>')
  })
})

describe('表格 thead 跨页重复（含表头行）', () => {
  it('表头行进 <thead>，数据行进 <tbody>', () => {
    const html = renderFixture('print')
    expect(html).toMatch(/<thead>\s*<tr>\s*<th>项目<\/th>\s*<th>指标<\/th>/)
    expect(html).toContain('<tbody>')
  })
})

describe('公式：KaTeX 占位 + 式中键值列表', () => {
  const html = renderFixture('screen')
  it('输出 ses-formula 占位且不渲染 KaTeX', () => {
    expect(html).toContain('class="ses-formula" data-latex="E = mc^2"')
  })
  it('式中列表解析为 dt/dd', () => {
    expect(html).toContain('<dl class="ses-where-list">')
    expect(html).toMatch(/<dt[^>]*>E<\/dt><dd>能量，单位为焦耳（J）<\/dd>/)
  })
})

describe('printCss', () => {
  it('注入书眉文件编号', () => {
    expect(printCss({ standardNo: 'GB/T 12345—2026' })).toContain('"GB/T 12345—2026"')
  })
  it('含镜像版心、外侧页码、命名横排页、空白页抑制', () => {
    const css = printCss()
    expect(css).toContain('@page :right { size: A4; margin: 28mm 20mm 24mm 25mm; }')
    expect(css).toContain('@page :left  { size: A4; margin: 28mm 25mm 24mm 20mm; }')
    expect(css).toContain('size: A4 landscape')
    expect(css).toContain('@page front:blank')
    expect(css).toContain('counter-reset: page 1')
  })
  it('五号正文字号（10.5pt）', () => {
    expect(printCss()).toContain('--ses-fs-wu: 10.5pt')
  })
  it('对 standardNo 中的尖括号做 CSS 转义，防止突破 <style> 注入脚本', () => {
    const css = printCss({ standardNo: '</style><script>x</script>' })
    expect(css).not.toContain('</style')
    expect(css).not.toContain('<script')
  })
})
