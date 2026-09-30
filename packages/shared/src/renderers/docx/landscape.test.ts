import { describe, expect, it } from 'vitest'
import type { IRDoc, IRFigure, IRTable } from '../../ir/types'
import { resolve } from '../../ir/resolve'
import { renderDocxTraced } from './render'
import { docxOutline } from './__tests__/helpers/outline'
import { assertWellFormed } from './__tests__/helpers/checks'

const image = {
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oJ8AAAAASUVORK5CYII=',
  contentType: 'image/png' as const,
  widthPx: 1,
  heightPx: 1,
}

function landscapeFigure(id: string): IRFigure {
  return { kind: 'figure', id, caption: [{ text: id }], orientation: 'landscape', src: `asset:${id}`, notes: [] }
}

function landscapeTable(id: string): IRTable {
  return {
    kind: 'table', id, caption: [{ text: id }], orientation: 'landscape', headerRowCount: 1,
    rows: [{ id: `${id}-row`, cells: [{ id: `${id}-cell`, colspan: 1, rowspan: 1, header: true, content: [{ kind: 'paragraph', id: `${id}-p`, content: [{ text: '测试' }] }] }] }],
    notes: [],
  }
}

function docWith(children: IRDoc['body'][number]['children']): IRDoc {
  return {
    schemaVersion: 1,
    meta: { title: '横排样稿', stdCode: 'GB/T 12345—2026', standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'ch1', secType: 'general', title: [{ text: '范围' }], children }],
    appendices: [], bibliography: [],
  }
}

function render(doc: IRDoc) {
  const { labels } = resolve(doc)
  return renderDocxTraced(doc, labels, {
    images: { fig1: image }, formulaOmml: {}, stage: 'working_draft', createdAt: '2026-09-29T08:00:00Z',
  }).pkg
}

describe('WP7.4 横排分节', () => {
  it('引言内横排节沿用罗马页码，正文仍从阿拉伯页码 1 开始', () => {
    const doc = docWith([])
    doc.front.introduction = [landscapeFigure('fig1')]
    const sections = docxOutline(render(doc)).split('\n').filter((line) => line.startsWith('§'))
    expect(sections).toEqual([
      '§ type=nextPage pgNumType=— start=— orient=— refs=0',
      '§ type=oddPage pgNumType=upperRoman start=1 orient=— refs=4',
      '§ type=nextPage pgNumType=upperRoman start=— orient=— refs=4',
      '§ type=nextPage pgNumType=upperRoman start=— orient=landscape refs=4',
      '§ type=oddPage pgNumType=decimal start=1 orient=— refs=4',
    ])
  })

  it('连续横排图和表共用一节，后续竖排内容恢复纸张方向并续编页码', () => {
    const doc = docWith([
      { kind: 'paragraph', id: 'p1', content: [{ text: '竖排前' }] },
      landscapeFigure('fig1'), landscapeTable('tab1'),
      { kind: 'paragraph', id: 'p2', content: [{ text: '竖排后' }] },
    ])
    const pkg = render(doc)
    expect(() => assertWellFormed(pkg)).not.toThrow()
    const outline = docxOutline(pkg)
    const sections = outline.split('\n').filter((line) => line.startsWith('§'))
    expect(sections.map((line) => line.match(/orient=([^ ]+)/)?.[1])).toEqual(['—', '—', '—', 'landscape', '—'])
    expect(sections[3]).toContain('pgNumType=decimal start=—')
    expect(sections[4]).toContain('pgNumType=decimal start=—')
    expect(pkg.parts['word/document.xml']).not.toContain('<!--SES:landscape:')
    expect(Object.keys(pkg.binaries)).toEqual([
      'word/media/image1.png', // GB 封面标志
      'word/media/image2.png', // 国家标准发布机构
      'word/media/image3.png', // 横排图
    ])
    expect(pkg.binaries['word/media/image3.png']).toBe(image.base64)
  })

  it('末要素为横排表时终结线保留在横排节，且不额外开竖排节', () => {
    const finalTable = landscapeTable('tab-end')
    finalTable.rows.push({
      id: 'tab-end-body',
      cells: [{ id: 'tab-end-body-cell', colspan: 1, rowspan: 1, header: false,
        content: [{ kind: 'paragraph', id: 'tab-end-body-p', content: [{ text: '末行数据' }] }] }],
    })
    const pkg = render(docWith([finalTable]))
    const outline = docxOutline(pkg)
    const sections = outline.split('\n').filter((line) => line.startsWith('§'))
    expect(sections.map((line) => line.match(/orient=([^ ]+)/)?.[1])).toEqual(['—', '—', '—', 'landscape'])
    expect(outline).toMatch(/SesEndMarkLandscape │ — │\n§ type=nextPage pgNumType=decimal start=— orient=landscape refs=4$/)
    const xml = pkg.parts['word/document.xml']!
    const lastRow = xml.slice(xml.lastIndexOf('<w:tr>'), xml.lastIndexOf('</w:tr>') + '</w:tr>'.length)
    expect(lastRow).toContain('<w:cantSplit/>')
    expect(lastRow).toContain('<w:keepNext/>')
    expect(lastRow).toContain('末行数据')
  })
})
