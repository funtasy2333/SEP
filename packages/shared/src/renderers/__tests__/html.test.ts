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
import type { IRDoc, NodeId, ResolvedLabel } from '../../ir/types'

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
    expect(html).toMatch(/<thead>\s*<tr>\s*<th scope="col">项目<\/th>\s*<th scope="col">指标<\/th>/)
    expect(html).toContain('<tbody>')
  })

  it('tbody 内首列行表头保留 <th scope="row">，数据单元格为 <td>', () => {
    const html = renderFixture('print')
    expect(html).toMatch(/<tbody>\s*<tr>\s*<th scope="row">精度<\/th>\s*<td>0\.1<\/td>/)
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
  it('对 standardNo 中的裸换行/控制字符做转义，避免截断 CSS 字符串', () => {
    const css = printCss({ standardNo: 'GB/T\n1—2026' })
    // content 字符串内不得出现裸换行（会终止 CSS 字符串字面量）
    expect(css).toContain('GB/T\\a 1—2026')
    expect(css).not.toMatch(/content: "GB\/T\n/)
  })
})

// ② 显式契约测试：参考文献展示顺序 = xmlId 的 bib_<n> 数字后缀（renderHtml 固定签名拿不到
// bibliographyOrder，只能逆向 xmlId；此测试钉住该契约，xmlId 方案若变更立即报错而非静默退化）。
describe('参考文献顺序契约：按 xmlId 数字后缀排序', () => {
  const doc: IRDoc = {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [],
    appendices: [],
    bibliography: [
      { kind: 'bibEntry', id: 'a', content: [{ text: 'Entry A' }] },
      { kind: 'bibEntry', id: 'b', content: [{ text: 'Entry B' }] },
      { kind: 'bibEntry', id: 'c', content: [{ text: 'Entry C' }] },
    ],
  }
  // 文档顺序 a,b,c，但 xmlId 后缀打乱为 3,1,2 → 展示顺序应为 b,c,a
  const labels: Record<NodeId, ResolvedLabel> = {
    a: { label: '[3]', xmlId: 'bib_3', refText: '[3]' },
    b: { label: '[1]', xmlId: 'bib_1', refText: '[1]' },
    c: { label: '[2]', xmlId: 'bib_2', refText: '[2]' },
  }
  const html = renderHtml(doc, labels, { variant: 'screen' })

  it('展示顺序由 bib_<n> 后缀决定（b→c→a），与文档顺序无关', () => {
    const ib = html.indexOf('Entry B')
    const ic = html.indexOf('Entry C')
    const ia = html.indexOf('Entry A')
    expect(ib).toBeGreaterThan(-1)
    expect(ib).toBeLessThan(ic)
    expect(ic).toBeLessThan(ia)
  })

  it('编号标签取自 labels 而非位置', () => {
    expect(html).toContain('[1]　Entry B')
    expect(html).toContain('[3]　Entry A')
  })
})

// ③ 横排命名页包裹路径（全要素 fixture 不含 landscape，单独覆盖渲染分支）。
describe('横排（landscape）表/图的命名页包裹', () => {
  const doc: IRDoc = {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [
      {
        kind: 'chapter',
        id: 'ch',
        secType: 'general',
        title: [{ text: '横排' }],
        children: [
          {
            kind: 'table',
            id: 't',
            caption: [{ text: '宽表' }],
            orientation: 'landscape',
            headerRowCount: 1,
            rows: [
              {
                id: 't.r0',
                cells: [
                  { id: 't.r0c0', colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: 'tp', content: [{ text: '列' }] }] },
                ],
              },
            ],
            notes: [],
          },
          {
            kind: 'figure',
            id: 'f',
            caption: [{ text: '宽图' }],
            orientation: 'landscape',
            src: 'data:image/png;base64,xx',
            notes: [],
          },
        ],
      },
    ],
    appendices: [],
    bibliography: [],
  }
  const labels: Record<NodeId, ResolvedLabel> = {
    ch: { label: '1', xmlId: 'sec_1', refText: '第1章' },
    t: { label: '表1', xmlId: 'tab_1', refText: '表1' },
    f: { label: '图1', xmlId: 'fig_1', refText: '图1' },
  }
  const html = renderHtml(doc, labels, { variant: 'print' })

  it('表与图各被 <div class="ses-landscape"> 包裹（共两处）', () => {
    const wraps = html.match(/<div class="ses-landscape">/g) ?? []
    expect(wraps.length).toBe(2)
  })

  it('包裹内仍为正常的表/图结构', () => {
    expect(html).toMatch(/<div class="ses-landscape">\s*<div class="ses-table-block"/)
    expect(html).toMatch(/<div class="ses-landscape">\s*<figure class="ses-figure-block"/)
  })
})
