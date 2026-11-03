import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import type { IRAppendix, IRDoc } from '../../ir/types'
import { renderHtml } from '../html'

/** #75 附录整体横页（HTML/PDF）：附录 section 进入横排命名页。 */

function appendix(id: string, orientation?: 'landscape'): IRAppendix {
  return {
    kind: 'appendix', id, normative: false, title: [{ text: `${id}标题` }], ...(orientation ? { orientation } : {}),
    children: [
      { kind: 'paragraph', id: `${id}-lead`, content: [{ text: '引导文字' }] },
      { kind: 'table', id: `${id}-tab`, caption: [{ text: '汇总' }], orientation: 'landscape', headerRowCount: 0,
        rows: [{ id: `${id}-r`, cells: [{ id: `${id}-c`, colspan: 1, rowspan: 1, header: false, content: [{ kind: 'paragraph', id: `${id}-cp`, content: [{ text: '值' }] }] }] }], notes: [] },
    ],
  }
}

function doc(appendices: IRAppendix[]): IRDoc {
  return {
    schemaVersion: 1,
    meta: { title: '样稿', standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'ch1', secType: 'scope', title: [{ text: '范围' }], children: [{ kind: 'paragraph', id: 'p1', content: [{ text: '正文' }] }] }],
    appendices, bibliography: [],
  }
}

function html(input: IRDoc) {
  return renderHtml(input, resolve(input).labels, { variant: 'print' })
}

function sectionTag(out: string, id: string): string {
  return out.match(new RegExp(`<section[^>]*data-node-id="${id}"[^>]*>`))?.[0] ?? ''
}

describe('#75 附录整体横页（HTML）', () => {
  it('横向附录的 section 带 ses-landscape，标题与引导文字和表同在横排命名页', () => {
    const out = html(doc([appendix('app-a'), appendix('app-b', 'landscape')]))
    const landscapeTag = sectionTag(out, 'app-b')
    expect(landscapeTag).toContain('class="ses-appendix ses-landscape"')
    expect(landscapeTag).toContain('data-orientation="landscape"')
    const portraitTag = sectionTag(out, 'app-a')
    expect(portraitTag).toContain('class="ses-appendix"')
    expect(portraitTag).not.toContain('ses-landscape')
    expect(portraitTag).not.toContain('data-orientation')
  })

  it('末个附录为横向时，终结线包在横排上下文中，不回到竖页另起空白页', () => {
    const landscapeLast = html(doc([appendix('app-a'), appendix('app-b', 'landscape')]))
    expect(landscapeLast).toMatch(/<div class="ses-landscape">\s*<div class="ses-end-mark" role="presentation"><\/div>\s*<\/div>/)
    const portraitLast = html(doc([appendix('app-a', 'landscape'), { ...appendix('app-b'), children: [{ kind: 'paragraph', id: 'only', content: [{ text: '竖排' }] }] }]))
    expect(portraitLast).not.toMatch(/<div class="ses-landscape">\s*<div class="ses-end-mark"/)
    expect(portraitLast).toContain('<div class="ses-end-mark" role="presentation"></div>')
  })
})
