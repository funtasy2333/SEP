import { describe, expect, it } from 'vitest'
import { pmToIr, renderHtml, resolve, type PMJsonNode } from '@ses/shared'
import { buildPdfExportRequest, extractPdfTocTargets } from './pdfExport'

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const paragraph = (nodeId: string, value: string): PMJsonNode => ({
  type: 'stdParagraph',
  attrs: { nodeId },
  content: [text(value)],
})

/** 前言、引言、带特殊字符标题的章/条、附录、参考文献俱全的文档。 */
function fullDoc(): PMJsonNode {
  return {
    type: 'doc',
    content: [
      { type: 'foreword', attrs: { nodeId: 'fw' }, content: [paragraph('fw-p', '前言正文')] },
      { type: 'introduction', attrs: { nodeId: 'intro' }, content: [paragraph('in-p', '引言正文')] },
      {
        type: 'chapter',
        attrs: { nodeId: 'c1' },
        content: [
          { type: 'chapterTitle', content: [text('范围 & "A" <b> > c')] },
          paragraph('p1', '正文'),
          {
            type: 'clause',
            attrs: { nodeId: 'cl1', level: 1, hasTitle: true },
            content: [
              { type: 'clauseTitle', attrs: { level: 1 }, content: [text('条&amp;')] },
              paragraph('p2', '条正文'),
            ],
          },
        ],
      },
      {
        type: 'appendix',
        attrs: { nodeId: 'a1', normative: true },
        content: [
          { type: 'appendixLabel', content: [text('（规范性）')] },
          { type: 'appendixTitle', content: [text('附 <录> & "x"')] },
          paragraph('ap', '附录正文'),
        ],
      },
      {
        type: 'bibliography',
        content: [
          { type: 'bibliographyTitle', content: [text('参考文献')] },
          { type: 'bibEntry', attrs: { nodeId: 'b1' }, content: [text('GB/T 1')] },
        ],
      },
    ],
  }
}

/** 手写一个 print 变体目次条目（与 shared renderToc 的输出同形）。 */
function tocItem(innerText: string, target: string, level = 1): string {
  return [
    `<li class="ses-toc-item ses-toc-l${level}">`,
    `<span class="ses-toc-text">${innerText}</span>`,
    `<span class="ses-toc-page" data-target="${target}">　</span>`,
    '</li>',
  ].join('\n')
}

describe('extractPdfTocTargets', () => {
  it('从 print HTML 提取目次：前言/引言归前置分区，章、条、附录、参考文献归正文分区，并还原转义', () => {
    const request = buildPdfExportRequest(fullDoc(), { title: '标题' })
    expect(request.toc).toEqual([
      { target: 'front_foreword', text: '前言', division: 'front' },
      { target: 'front_intro', text: '引言', division: 'front' },
      { target: 'sec_1', text: '1　范围 & "A" <b> > c', division: 'body' },
      { target: 'sec_1.1', text: '1.1　条&amp;', division: 'body' },
      { target: 'sec_A', text: '附录A　（规范性）附 <录> & "x"', division: 'body' },
      { target: 'sec_bibliography', text: '参考文献', division: 'body' },
    ])
    // 渲染后的 HTML 里是转义形态，提取结果是还原后的文本。
    expect(request.html).toContain('<span class="ses-toc-text">1　范围 &amp; "A" &lt;b&gt; &gt; c</span>')
    expect(extractPdfTocTargets(request.html)).toEqual(request.toc)
  })

  it('没有前言/引言/参考文献时只含有的分区', () => {
    const doc: PMJsonNode = {
      type: 'doc',
      content: [{
        type: 'chapter',
        attrs: { nodeId: 'c1' },
        content: [{ type: 'chapterTitle', content: [text('范围')] }, paragraph('p1', '正文')],
      }],
    }
    expect(buildPdfExportRequest(doc, {}).toc).toEqual([
      { target: 'sec_1', text: '1　范围', division: 'body' },
    ])
  })

  it('字符引用只还原一层：原文就是 &amp; 的文字经 &amp;amp; 还原回 &amp;', () => {
    const html = tocItem('A &amp;amp; B &amp;lt; C &amp;quot;', 'sec_x')
    expect(extractPdfTocTargets(html)).toEqual([
      { target: 'sec_x', text: 'A &amp; B &lt; C &quot;', division: 'body' },
    ])
  })

  it('data-target 属性值同样还原 &amp; &lt; &gt; &quot;', () => {
    const html = tocItem('标题', 'a&amp;b&lt;c&gt;d&quot;e')
    expect(extractPdfTocTargets(html)[0]?.target).toBe('a&b<c>d"e')
  })

  it('文本按 String.prototype.trim 去除首尾空白（含全角空格、NBSP、BOM、换行）', () => {
    const html = tocItem('　 ﻿ 标题 　\n', 'sec_x')
    expect(extractPdfTocTargets(html)).toEqual([{ target: 'sec_x', text: '标题', division: 'body' }])
  })

  it('只有空白的文本、缺少 target 的条目被跳过', () => {
    const html = [
      tocItem('　 \n', 'sec_blank'),
      tocItem('有文本', ''),
      '<li class="ses-toc-item ses-toc-l1"><span class="ses-toc-text">没有页码占位</span></li>',
      '<li class="ses-toc-item ses-toc-l1"><span class="ses-toc-page" data-target="sec_notext">　</span></li>',
      tocItem('保留', 'sec_keep'),
    ].join('\n')
    expect(extractPdfTocTargets(html)).toEqual([{ target: 'sec_keep', text: '保留', division: 'body' }])
  })

  it('screen 变体的目次没有页码占位，提取为空（与原 DOMParser 实现一致）', () => {
    const ir = pmToIr(fullDoc()).doc
    const html = renderHtml(ir, resolve(ir).labels, { variant: 'screen' })
    expect(html).toContain('ses-toc-item')
    expect(extractPdfTocTargets(html)).toEqual([])
  })

  it('不含目次或空串返回空数组', () => {
    expect(extractPdfTocTargets('')).toEqual([])
    expect(extractPdfTocTargets('<html><body><p>没有目次</p></body></html>')).toEqual([])
  })

  it('正文里长得像目次标记的文字已被转义，不会被当成目次条目', () => {
    const doc: PMJsonNode = {
      type: 'doc',
      content: [{
        type: 'chapter',
        attrs: { nodeId: 'c1' },
        content: [
          {
            type: 'chapterTitle',
            content: [text('<li class="ses-toc-item"><span class="ses-toc-text">伪造</span><span class="ses-toc-page" data-target="evil">')],
          },
          paragraph('p1', '<li class="ses-toc-item ses-toc-l1"><span class="ses-toc-text">伪造</span><span class="ses-toc-page" data-target="evil2">'),
        ],
      }],
    }
    const { toc } = buildPdfExportRequest(doc, {})
    expect(toc.map((entry) => entry.target)).toEqual(['sec_1'])
    expect(toc[0]?.text).toContain('<li class="ses-toc-item">')
  })

  // 以下期望值取自 Chromium 的 DOMParser（textContent.trim() / getAttribute）：
  // 输入流预处理把 CR、CRLF 变成 LF；NUL 在文本里被忽略、在属性值里变成 U+FFFD；孤立代理项原样保留。
  it('与浏览器解析器一致：CR/CRLF 归一为 LF', () => {
    const html = tocItem('a\rb\r\nc', 'x\ry\r\nz')
    expect(extractPdfTocTargets(html)).toEqual([{ target: 'x\ny\nz', text: 'a\nb\nc', division: 'body' }])
  })

  it('与浏览器解析器一致：文本里的 NUL 被忽略、属性值里的 NUL 变为 U+FFFD', () => {
    const html = tocItem('a\u0000b', 'a\u0000b')
    expect(extractPdfTocTargets(html)).toEqual([{ target: 'a�b', text: 'ab', division: 'body' }])
  })

  it('与浏览器解析器一致：孤立代理项原样保留', () => {
    const html = tocItem('a\uD800b', 'a\uD800b')
    expect(extractPdfTocTargets(html)).toEqual([{ target: 'a\uD800b', text: 'a\uD800b', division: 'body' }])
  })
})

describe('buildPdfExportRequest', () => {
  it('生成 print 变体 HTML，目次由 HTML 提取，面板 meta 覆盖标题与编号字段', () => {
    const request = buildPdfExportRequest(fullDoc(), {
      title: '面板标题',
      titleEn: 'Panel title',
      stdCode: 'GB/T 99999—2026',
      icsCode: '01.120',
      ccsCode: 'A 00',
    })
    expect(request.html).toContain('data-variant="print"')
    expect(request.html).toContain('data-standard-no="GB/T 99999—2026"')
    expect(request.html).toContain('data-title-cn="面板标题"')
    expect(request.html).toContain('<h1 class="ses-doc-title">面板标题</h1>')
    expect(request.docTitle).toBe('面板标题')
    expect(request.filename).toBe('面板标题')
    expect(request.toc).toEqual(extractPdfTocTargets(request.html))
  })

  it('未提供 meta 标题时：docTitle 取文档自身的标题（可为空串），filename 回退「标准文件」', () => {
    const request = buildPdfExportRequest(fullDoc(), {})
    expect(request.docTitle).toBe('')
    expect(request.filename).toBe('标准文件')

    const titled = fullDoc()
    titled.attrs = { titleCn: '文档自带标题' }
    const fromDoc = buildPdfExportRequest(titled, {})
    expect(fromDoc.docTitle).toBe('文档自带标题')
    expect(fromDoc.filename).toBe('标准文件')
  })

  it('meta.title 为空串时覆盖文档标题，filename 仍回退「标准文件」', () => {
    const titled = fullDoc()
    titled.attrs = { titleCn: '文档自带标题' }
    const request = buildPdfExportRequest(titled, { title: '' })
    expect(request.docTitle).toBe('')
    expect(request.filename).toBe('标准文件')
  })

  it('不修改入参，重复调用结果相同', () => {
    const doc = fullDoc()
    const snapshot = JSON.parse(JSON.stringify(doc)) as PMJsonNode
    const first = buildPdfExportRequest(doc, { title: '标题' })
    expect(doc).toEqual(snapshot)
    expect(buildPdfExportRequest(doc, { title: '标题' })).toEqual(first)
  })
})
