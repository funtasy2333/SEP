import { describe, expect, it } from 'vitest'
import type { IRAppendix, IRDoc, IRTable } from '../../ir/types'
import { resolve } from '../../ir/resolve'
import { renderDocxTraced } from './render'
import { docxOutline } from './__tests__/helpers/outline'
import { assertWellFormed } from './__tests__/helpers/checks'

/** #75 附录整体横页（DOCX）。 */

function table(id: string, orientation: IRTable['orientation'] = 'portrait', rows = 1): IRTable {
  return {
    kind: 'table', id, caption: [{ text: `${id}题` }], orientation, headerRowCount: 1,
    rows: Array.from({ length: rows + 1 }, (_, index) => ({
      id: `${id}-r${index}`,
      cells: ['甲', '乙', '丙'].map((value, col) => ({
        id: `${id}-r${index}-c${col}`, colspan: 1, rowspan: 1, header: index === 0,
        content: [{ kind: 'paragraph' as const, id: `${id}-r${index}-c${col}-p`, content: [{ text: `${value}${index}` }] }],
      })),
    })),
    notes: [],
  }
}

function appendix(id: string, title: string, children: IRAppendix['children'], orientation?: 'landscape'): IRAppendix {
  return { kind: 'appendix', id, normative: false, title: [{ text: title }], children, ...(orientation ? { orientation } : {}) }
}

function docWith(appendices: IRAppendix[], bibliography: IRDoc['bibliography'] = []): IRDoc {
  return {
    schemaVersion: 1,
    meta: { title: '附录横页样稿', stdCode: 'GB/T 12345—2026', standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'ch1', secType: 'scope', title: [{ text: '范围' }], children: [
      { kind: 'paragraph', id: 'p1', content: [{ text: '本文件规定了检验方法。' }] },
    ] }],
    appendices, bibliography,
  }
}

function render(doc: IRDoc) {
  const { labels } = resolve(doc)
  return renderDocxTraced(doc, labels, { images: {}, formulaOmml: {}, stage: 'working_draft', createdAt: '2026-11-02T08:00:00Z' }).pkg
}

function sectionsOf(outline: string) {
  return outline.split('\n').filter((line) => line.startsWith('§'))
}

/** 把大纲按分节行切成各节的段落行。 */
function sectionBodies(outline: string): string[][] {
  const groups: string[][] = [[]]
  for (const line of outline.split('\n')) {
    if (line.startsWith('§')) groups.push([])
    else groups[groups.length - 1]!.push(line)
  }
  return groups.slice(0, -1)
}

function gridWidth(xml: string, tableCaption: string): number {
  const start = xml.indexOf(tableCaption)
  const tbl = xml.slice(xml.indexOf('<w:tblGrid>', start), xml.indexOf('</w:tblGrid>', start))
  return [...tbl.matchAll(/<w:gridCol w:w="(\d+)"/g)].reduce((sum, match) => sum + Number(match[1]), 0)
}

describe('#75 附录整体横页（DOCX）', () => {
  it('issue 案例：附录 B 从横页起排，编号、性质、标题、引导文字与表 B.1 在同一横排节，不再单独占竖页', () => {
    const doc = docWith([appendix('app-b', '49 种 PFAS LC-MS/MS 方法验证汇总', [
      { kind: 'paragraph', id: 'lead', content: [{ text: '49 种 PFAS 的 LC-MS/MS 方法参数及验证结果见表B.1。' }] },
      table('tab-b1', 'landscape'),
    ], 'landscape')])
    const pkg = render(doc)
    expect(() => assertWellFormed(pkg)).not.toThrow()
    const outline = docxOutline(pkg)
    const sections = sectionsOf(outline)
    // 封面、目次、正文、附录 B：附录 B 只有一节且是横向，不因横排表再拆节。
    expect(sections.map((line) => line.match(/orient=([^ ]+)/)?.[1])).toEqual(['—', '—', '—', 'landscape'])
    expect(sections[3]).toContain('type=nextPage pgNumType=decimal start=—')
    const appendixSection = sectionBodies(outline)[3]!.join('\n')
    expect(appendixSection).toMatch(/SesAppendix /)
    expect(appendixSection).toContain('（资料性）')
    expect(appendixSection).toContain('方法验证汇总')
    expect(appendixSection).toContain('方法参数及验证结果见表B.1')
    expect(appendixSection).toContain('tab-b1题')
    expect(pkg.parts['word/document.xml']).not.toContain('<!--SES:landscape:')
    // 末要素在横向附录内：终结线留在横排节。
    expect(outline).toMatch(/SesEndMarkLandscape │ — │\n§ type=nextPage pgNumType=decimal start=— orient=landscape refs=4$/)
  })

  it('横向附录中的竖排表也按横排版心计算列宽，与正文横排表一致', () => {
    const doc = docWith([appendix('app-a', '汇总', [table('tab-in-appendix', 'portrait')], 'landscape')])
    doc.body[0]!.children.push(table('tab-body-landscape', 'landscape'))
    const xml = render(doc).parts['word/document.xml']!
    expect(gridWidth(xml, 'tab-in-appendix题')).toBe(gridWidth(xml, 'tab-body-landscape题'))
    const portraitDoc = docWith([appendix('app-a', '汇总', [table('tab-in-appendix', 'portrait')])])
    const portraitXml = render(portraitDoc).parts['word/document.xml']!
    expect(gridWidth(xml, 'tab-in-appendix题')).toBeGreaterThan(gridWidth(portraitXml, 'tab-in-appendix题'))
  })

  it('相邻附录纵、横、纵互不影响，页码续编；含条的横向附录跨条保持横向', () => {
    const doc = docWith([
      appendix('app-a', '纵向附录', [{ kind: 'paragraph', id: 'pa', content: [{ text: '附录A正文' }] }]),
      appendix('app-b', '横向附录', [
        { kind: 'paragraph', id: 'pb', content: [{ text: '引导文字' }] },
        { kind: 'clause', id: 'cb1', level: 1, titled: true, title: [{ text: '第一条' }], children: [table('tab-b', 'landscape', 3)] },
        { kind: 'clause', id: 'cb2', level: 1, titled: true, title: [{ text: '第二条' }], children: [
          { kind: 'paragraph', id: 'pb2', content: [{ text: '表后段落' }] },
        ] },
      ], 'landscape'),
      appendix('app-c', '又一纵向附录', [table('tab-c', 'portrait')]),
    ])
    const outline = docxOutline(render(doc))
    const sections = sectionsOf(outline)
    expect(sections.map((line) => line.match(/orient=([^ ]+)/)?.[1])).toEqual(['—', '—', '—', '—', 'landscape', '—'])
    for (const line of sections.slice(3)) expect(line).toContain('pgNumType=decimal start=—')
    const bodies = sectionBodies(outline)
    expect(bodies[4]!.join('\n')).toContain('第二条')
    expect(bodies[4]!.join('\n')).toContain('表后段落')
    expect(bodies[5]!.join('\n')).toContain('又一纵向附录')
    expect(outline).toMatch(/SesEndMark │ — │\n§ type=nextPage pgNumType=decimal start=— orient=— refs=4$/)
  })

  it('未设方向的附录保持原有行为：横排表单独分节，其后回到竖页', () => {
    const doc = docWith([appendix('app-a', '附录', [
      { kind: 'paragraph', id: 'pa', content: [{ text: '引导文字' }] },
      table('tab-a', 'landscape'),
      { kind: 'paragraph', id: 'pa2', content: [{ text: '表后' }] },
    ])])
    const sections = sectionsOf(docxOutline(render(doc)))
    expect(sections.map((line) => line.match(/orient=([^ ]+)/)?.[1])).toEqual(['—', '—', '—', '—', 'landscape', '—'])
  })
})
