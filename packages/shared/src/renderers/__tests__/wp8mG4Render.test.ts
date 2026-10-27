import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import type { IRDoc } from '../../ir/types'
import { listItemDoc, xref } from '../../ir/__tests__/wp8mG4Fixtures'
import { renderDocxTraced } from '../docx/render'
import { renderHtml } from '../html'

const DOCX_OPTIONS = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-22T00:00:00.000Z' }

function html(doc: IRDoc, variant: 'screen' | 'print'): string {
  const { labels } = resolve(doc)
  return renderHtml(doc, labels, { variant })
}

function documentXml(doc: IRDoc): string {
  const { labels } = resolve(doc)
  return renderDocxTraced(doc, labels, DOCX_OPTIONS).pkg.parts['word/document.xml']!
}

const referenced = () => listItemDoc([xref('a3', 'listItem'), { text: '与' }, xref('n2', 'listItem')])

describe('[M-10.1.5-01] HTML：引用处输出 refText', () => {
  it('screen：内部链接指向被引用列项的 id，文字为「容器编号 + 标记」', () => {
    const out = html(referenced(), 'screen')
    expect(out).toContain('<a class="ses-xref" href="#li_1" data-ref-target="a3">5.2 c）</a>')
    expect(out).toContain('<a class="ses-xref" href="#li_2" data-ref-target="n2">5.2 2）</a>')
    expect(out).not.toContain('见列项')
  })

  it('print：只输出文本 span，不输出内部链接', () => {
    const out = html(referenced(), 'print')
    expect(out).toContain('<span class="ses-xref" data-ref-target="a3">5.2 c）</span>')
    expect(out).not.toMatch(/<a[\s>]/)
  })
})

describe('[M-10.1.5-02] HTML：被引用的列项带 id=li_k', () => {
  it('被引用的列项 div 多出 id，且每个 id 恰好出现一次', () => {
    for (const variant of ['screen', 'print'] as const) {
      const out = html(referenced(), variant)
      expect(out).toContain('<div class="ses-list-item" data-node-id="a3" id="li_1">')
      expect(out).toContain('<div class="ses-list-item" data-node-id="n2" id="li_2">')
      expect(out.match(/ id="li_\d+"/g)).toHaveLength(2)
    }
  })

  it('未被引用的列项和列表不带 id；没有任何列项引用时整篇输出不含 li_', () => {
    const out = html(referenced(), 'screen')
    expect(out).toContain('<div class="ses-list-item" data-node-id="a1">')
    expect(out).toContain('<div class="ses-list-item" data-node-id="d1">')
    for (const variant of ['screen', 'print'] as const) expect(html(listItemDoc(), variant)).not.toContain('li_')
  })

  it('引用无序列项：不生成 id，也不生成链接，回退作者原文', () => {
    const out = html(listItemDoc([xref('d2', 'listItem', '见破折号项')]), 'screen')
    expect(out).toContain('<span class="ses-xref" data-ref-target="d2">见破折号项</span>')
    expect(out).not.toContain('li_')
  })

  it('同一文档重复渲染结果一致（纯函数）', () => {
    const doc = referenced()
    expect(html(doc, 'screen')).toBe(html(doc, 'screen'))
  })
})

describe('[M-10.1.5-01] DOCX：引用处输出 refText', () => {
  it('文字为 refText，作者原文被替换；列项本身不新增书签', () => {
    const baseline = documentXml(listItemDoc())
    const xml = documentXml(referenced())
    expect(xml).toContain('<w:t xml:space="preserve">5.2 c）</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">5.2 2）</w:t>')
    expect(xml).not.toContain('见列项')
    expect(xml).not.toContain('li_')
    // 引用只改变引用段本身：书签总数与无引用文档相同
    expect(xml.match(/<w:bookmarkStart /g)?.length ?? 0).toBe(baseline.match(/<w:bookmarkStart /g)?.length ?? 0)
  })

  it('引用无序列项：回退作者原文', () => {
    const xml = documentXml(listItemDoc([xref('d2', 'listItem', '见破折号项')]))
    expect(xml).toContain('见破折号项')
  })
})
