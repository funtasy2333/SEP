/**
 * WP4 渲染器测试：全要素 fixture → pmToIr → resolve → renderHtml。
 * 覆盖 screen/print 两变体的快照、编号一致性、print 无内部链接约束、printCss 关键选择器。
 */

import { describe, it, expect } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import { renderHtml } from '../html'
import { printCss } from '../printCss'
import { fullFixture, landscapeFixture } from '../../ir/__tests__/fixtures'
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

  it('screen 变体为间隔号和数字列项提供标记及二级缩进', () => {
    const screen = renderFixture('screen')
    expect(screen).toContain('.ses-list-dot > .ses-list-item::before { content: "·"')
    expect(screen).toContain('.ses-list-number > .ses-list-item::before { content: counter(ses-li) "） "')
    expect(screen).toContain('.ses-list[data-level="2"], .ses-list-number, .ses-list-dot { padding-left: 4em; }')
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

describe('print 变体：英文译名/图表英文题不输出（封面专属，F5/F8）', () => {
  const print = renderFixture('print')
  const screen = renderFixture('screen')

  it('print 不含正文首页英文名标题（ses-doc-title-en 元素）', () => {
    // 可见英文标题不输出；data-title-en 作为元数据保留（IR 字段不删）属预期
    expect(print).not.toContain('class="ses-doc-title ses-doc-title-en"')
    expect(print).not.toContain('<h1 class="ses-doc-title ses-doc-title-en"')
  })
  it('print 不含图题/表题英文（class="ses-table-caption-en" / class="ses-figure-caption-en" 元素）', () => {
    expect(print).not.toContain('class="ses-table-caption-en"')
    expect(print).not.toContain('class="ses-figure-caption-en"')
    expect(print).not.toContain('Performance')
    expect(print).not.toContain('System architecture')
  })
  it('screen 仍保留以上英文（IR 字段未删）', () => {
    expect(screen).toContain('ses-doc-title-en')
    expect(screen).toContain('Standardization document editing system')
    expect(screen).toContain('ses-table-caption-en')
    expect(screen).toContain('ses-figure-caption-en')
  })
})

describe('术语三段式结构（F6）', () => {
  const html = renderFixture('print')
  it('编号独占一行（ses-term-num-line）', () => {
    expect(html).toContain('<p class="ses-term-num-line">3.1</p>')
  })
  it('术语与英文对应词同一行、英文行内（ses-term-head 内含 ses-term-name 与 ses-term-name-en）', () => {
    expect(html).toMatch(
      /<p class="ses-term-head"><span class="ses-term-name">标准<\/span>　<span class="ses-term-name-en" lang="en">standard<\/span><\/p>/,
    )
  })
  it('term-2（编号 numbering）同样为编号行 + 术语英文同行结构', () => {
    expect(html).toContain('<p class="ses-term-num-line">3.2</p>')
    expect(html).toMatch(
      /<p class="ses-term-head"><span class="ses-term-name">编号<\/span>　<span class="ses-term-name-en" lang="en">numbering<\/span><\/p>/,
    )
  })
})

describe('终结线（F9）', () => {
  it('print 正文末尾输出 ses-end-mark（位于 body-content 收尾前）', () => {
    const html = renderFixture('print')
    expect(html).toContain('<div class="ses-end-mark" role="presentation"></div>')
    const mark = html.indexOf('ses-end-mark')
    const bodyClose = html.indexOf('</div>\n</article>')
    expect(mark).toBeGreaterThan(-1)
    expect(mark).toBeLessThan(bodyClose)
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

  it('print 正文首页注入隐藏哨兵锚点（供出件管线稳健定位正文起始页）', () => {
    expect(html).toContain(
      '<span class="ses-body-anchor" aria-hidden="true">SESBODYSTARTANCHOR</span>',
    )
    // 哨兵排在正文内容容器起始、文件名称之前（用完整标签比较，避开内嵌 CSS 选择器同名串）
    expect(html.indexOf('<span class="ses-body-anchor"')).toBeLessThan(
      html.indexOf('<h1 class="ses-doc-title">'),
    )
  })

  it('screen 变体不含哨兵锚点', () => {
    expect(renderFixture('screen')).not.toContain('SESBODYSTARTANCHOR')
  })

  it('无题条编号与首段同排，且首段顶格（ses-clause-numbered-para，非 ses-paragraph，F7）', () => {
    // cl-421 无题条，编号 4.2.1；首段用顶格类、编号顶格起排
    expect(html).toMatch(
      /<p class="ses-clause-numbered-para" data-type="paragraph"[^>]*><span class="ses-clause-num-only">4\.2\.1<\/span>/,
    )
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
    // F2：上 30mm（书眉下 5mm 起版心）、下 20mm（页码距纸底 20mm）；左右镜像不变
    expect(css).toContain('@page :right { size: A4; margin: 30mm 20mm 20mm 25mm; }')
    expect(css).toContain('@page :left  { size: A4; margin: 30mm 25mm 20mm 20mm; }')
    expect(css).toContain('size: A4 landscape')
    expect(css).toContain('@page front:blank')
    expect(css).toContain('counter-reset: page 1')
  })
  it('五号正文字号（10.5pt）', () => {
    expect(printCss()).toContain('--ses-fs-wu: 10.5pt')
  })
  it('F1：书眉无下划线（含横排 @top-center）', () => {
    expect(printCss({ standardNo: 'GB/T 1—2026' })).not.toContain('text-decoration: underline')
  })
  it('F4：目次页码占位保留预留宽度但收窄至 2em（codex #28 评审采纳）', () => {
    const css = printCss()
    expect(css).toContain('.ses-toc-page { min-width: 2em; text-align: right; white-space: nowrap; }')
    expect(css).not.toContain('min-width: 3em')
  })
  it('F10：表内文字为小五号（表 F.1 #40 注 a）', () => {
    expect(printCss()).toMatch(/\.ses-table-block table \{[^}]*font-size: var\(--ses-fs-xiaowu\)/)
  })
  it('F9：含终结线样式（版心宽 1/4 ≈41mm、break-before: avoid）', () => {
    const css = printCss()
    expect(css).toContain('.ses-end-mark')
    expect(css).toMatch(/\.ses-end-mark \{[^}]*width: 41mm/)
    expect(css).toMatch(/\.ses-end-mark \{[^}]*break-before: avoid/)
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
  it('item1：正文不强制单数页起排（break-before: page，非 right），避免正文前空白页', () => {
    const css = printCss()
    expect(css).toMatch(/\.ses-body-content \{[^}]*break-before: page/)
    expect(css).not.toMatch(/\.ses-body-content \{[^}]*break-before: right/)
  })
  it('item2：目次内容不加粗黑体（仅标题 .ses-front-heading 为黑体）', () => {
    const css = printCss()
    expect(css).not.toContain('.ses-toc-l1 > .ses-toc-text { font-family: var(--ses-hei)')
  })
})

describe('电子出版交付订正（PDF 级，item1-4）', () => {
  const print = renderFixture('print')

  it('item3：前置三标题两字间为全角间隔（目　次/前　言/引　言）', () => {
    expect(print).toContain('<h1 class="ses-front-heading">目　次</h1>')
    expect(print).toContain('<h1 class="ses-front-heading">前　言</h1>')
    expect(print).toContain('<h1 class="ses-front-heading">引　言</h1>')
    // 不得为连排无间隔
    expect(print).not.toContain('>目次</h1>')
    expect(print).not.toContain('>前言</h1>')
  })

  it('item4：print 不渲染封面（本期范围差距，coverPage 仅入元数据）', () => {
    // 首个可见区块为目次，非封面；不含封面正文文本
    expect(print).not.toContain('data-type="cover"')
    expect(print.indexOf('id="front_toc"')).toBeLessThan(print.indexOf('<div class="ses-body-content">'))
    const firstSection = print.indexOf('data-type="toc"')
    expect(firstSection).toBeGreaterThan(-1)
  })

  it('item7：图片为有效 data URI（非破图占位 base64,xx/yy）', () => {
    expect(print).not.toContain('data:image/png;base64,xx')
    expect(print).not.toContain('data:image/png;base64,yy')
    expect(print).toContain('data:image/png;base64,iVBOR')
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

  it('表、图各被 <div class="ses-landscape"> 包裹，末要素为横排图时终结线亦包入横排（共三处，item6）', () => {
    const wraps = html.match(/<div class="ses-landscape">/g) ?? []
    expect(wraps.length).toBe(3)
  })

  it('包裹内仍为正常的表/图结构', () => {
    expect(html).toMatch(/<div class="ses-landscape">\s*<div class="ses-table-block"/)
    expect(html).toMatch(/<div class="ses-landscape">\s*<figure class="ses-figure-block"/)
  })

  it('末要素为横排图：终结线包入横排命名页上下文（item6，避免另起空白终结线页）', () => {
    expect(html).toMatch(
      /<div class="ses-landscape">\s*<div class="ses-end-mark" role="presentation"><\/div>\s*<\/div>\s*<\/div>\s*<\/article>/,
    )
  })
})

// ④ landscapeFixture（F12）：经真实管线渲染后含横排包裹，供 e2e 出件核对横排页
describe('landscapeFixture（F12 横排核对用）', () => {
  it('经 pmToIr → resolve → renderHtml(print) 后含 ses-landscape 包裹', () => {
    const { doc } = pmToIr(landscapeFixture())
    const { labels } = resolve(doc)
    const html = renderHtml(doc, labels, { variant: 'print' })
    expect(html).toContain('<div class="ses-landscape">')
    expect(html).toMatch(/<div class="ses-landscape">\s*<div class="ses-table-block"/)
    // 超宽表 9 列表头
    expect(html).toContain('<th scope="col">参数H</th>')
  })
})
