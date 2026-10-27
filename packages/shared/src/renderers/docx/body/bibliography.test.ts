/**
 * body/bibliography.ts 单元测试（docs/wp7-docx-delivery.md §9 WP7.2「测试」参考文献前缀剥离、
 * 参考文献顺序两项）。
 */

import { describe, expect, it } from 'vitest'
import type { IRBibEntry, IRInline, NodeId, ResolvedLabel } from '../../../ir/types'
import { createRenderContext } from './context'
import { renderBibliography, stripBibPrefix } from './bibliography'
import { docxOutline } from '../__tests__/helpers/outline'
import { buildPackage } from '../package'
import { buildStylesXml } from '../styles'

function t(text: string, marks?: IRInline['marks']): IRInline {
  return marks ? { text, marks } : { text }
}

describe('stripBibPrefix（§5.12）', () => {
  it('前缀在一个 run 里：整体剥离', () => {
    const out = stripBibPrefix([t('[9] 标准内容')])
    expect(out).toEqual([{ text: '标准内容' }])
  })

  it('前缀拆在多个 run 里：落在前缀内的 run 整个去掉，跨过前缀末尾的 run 只留后半、marks 不变', () => {
    const out = stripBibPrefix([t('['), t('9', [{ type: 'bold' }]), t('] 标准内容')])
    expect(out).toEqual([{ text: '标准内容' }])
  })

  it('跨 run 前缀之后还有别的 run：原样保留', () => {
    const out = stripBibPrefix([t('['), t('9'), t('] '), t('标准', [{ type: 'bold' }]), t('内容')])
    expect(out).toEqual([{ text: '标准', marks: [{ type: 'bold' }] }, { text: '内容' }])
  })

  it('全角方括号也能匹配', () => {
    const out = stripBibPrefix([t('［3］标准内容')])
    expect(out).toEqual([{ text: '标准内容' }])
  })

  it('前缀范围内有 crossRef run 时不剥离，原样输出', () => {
    const content: IRInline[] = [t('['), t('9', [{ type: 'crossRef', targetId: 'x' }]), t('] 标准内容')]
    const out = stripBibPrefix(content)
    expect(out).toBe(content) // 原样返回同一引用，未做任何剥离
  })

  it('没有前缀时原样输出', () => {
    const content: IRInline[] = [t('标准内容，无前缀')]
    const out = stripBibPrefix(content)
    expect(out).toEqual(content)
  })

  it('前缀后紧跟正文、无空格分隔也能匹配（\\s* 允许零个空格）', () => {
    const out = stripBibPrefix([t('[12]标准内容')])
    expect(out).toEqual([{ text: '标准内容' }])
  })
})

describe('renderBibliography：顺序（按 labels[id].xmlId 的序号，没有 label 的排在最后）', () => {
  const NO_LABELS: Record<NodeId, ResolvedLabel> = {}

  function bibEntry(id: NodeId, text: string): IRBibEntry {
    return { kind: 'bibEntry', id, content: [t(text)] }
  }

  function orderOf(entries: IRBibEntry[], labels: Record<NodeId, ResolvedLabel>): string[] {
    const ctx = createRenderContext(labels)
    const bodyXml = renderBibliography(ctx, entries)
    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${bodyXml}</w:body></w:document>`
    const pkg = buildPackage({ documentXml, title: 't', createdAt: '2026-09-25T08:00:00.000Z', stylesXml: buildStylesXml() })
    const outline = docxOutline(pkg)
    return outline
      .split('\n')
      .filter((l) => l.startsWith('SesBibEntry'))
      .map((l) => l.split('│')[2].trim())
  }

  it('按 xmlId 里的序号升序排列，不是数组原始顺序', () => {
    const labels: Record<NodeId, ResolvedLabel> = {
      'bib-a': { label: '[2]', xmlId: 'biblref_2', refText: '[2]' },
      'bib-b': { label: '[1]', xmlId: 'biblref_1', refText: '[1]' },
    }
    const entries = [bibEntry('bib-a', '条目A'), bibEntry('bib-b', '条目B')]
    expect(orderOf(entries, labels)).toEqual(['条目B', '条目A'])
  })

  it('没有 label 的条目排在最后，保持原数组的相对顺序', () => {
    const labels: Record<NodeId, ResolvedLabel> = {
      'bib-ref': { label: '[1]', xmlId: 'biblref_1', refText: '[1]' },
    }
    const entries = [bibEntry('bib-unref1', '未引用一'), bibEntry('bib-ref', '被引用'), bibEntry('bib-unref2', '未引用二')]
    expect(orderOf(entries, labels)).toEqual(['被引用', '未引用一', '未引用二'])
  })

  it('空数组时不输出标题段（renderBibliography 返回空串）', () => {
    const ctx = createRenderContext(NO_LABELS)
    expect(renderBibliography(ctx, [])).toBe('')
  })
})
