/**
 * 含各种“可被引用目标”的文档（章、条、附录、表、图、公式、注/示例、列项、警告、摘录、代码、术语条目、术语注/示例、
 * 缩略语、参考文献、规范性引用条目、索引）。T2.4a-1 用它测 xref 的目标映射（设计 §2.11）：目标只需存在于 IR 里，
 * 不必真的被渲染，所以 T2.4b/T2.4c 才实现的目标种类也能测。
 */

import type { IRDoc, IRList, IRNote, IRExample, IRTable } from '../../ir/types'
import { appendix, chapter, clause, makeDoc, para } from './xml46687Kit'

const list = (id: string, listType: IRList['listType'], items: Array<[string, string]>): IRList => ({
  kind: 'list', id, listType, items: items.map(([itemId, text]) => ({ id: itemId, content: [para(`${itemId}.p0`, text)] })),
})
const note = (id: string, text: string): IRNote => ({ kind: 'note', id, content: [para(`${id}.p0`, text)] })
const example = (id: string, text: string): IRExample => ({ kind: 'example', id, content: [para(`${id}.p0`, text)] })

const table: IRTable = {
  kind: 'table', id: 'tab-1', caption: [{ text: '表题' }], orientation: 'portrait', headerRowCount: 0, notes: [],
  footnotes: [{ id: 'tabfn-1', content: [{ text: '表脚注' }] }, { id: 'tabfn-2', content: [{ text: '第二个表脚注' }] }],
  rows: [{
    id: 'tab-1-r1',
    cells: [{
      id: 'tab-1-r1c1', colspan: 1, rowspan: 1, header: false,
      content: [para('tab-1-r1c1.p0', '值',
        { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'tabfn-1' }] },
        { text: '', marks: [{ type: 'tableFootnoteRef', targetId: 'tabfn-2' }] })],
    }],
  }],
}

/** 目标 id 一览：chapter ch-body、clause cl-1、appendix app-a、table tab-1、figure fig-1、formula f-num/f-un、…… */
export function targetsDoc(): IRDoc {
  return makeDoc([
    chapter('ch-scope', '范围', [para('scope-p', '范围正文')], 'scope'),
    chapter('ch-refs', '规范性引用文件', [
      para('refs-p', '引导语'),
      { kind: 'normRefList', id: 'nrl', entries: [{ kind: 'normRef', id: 'nr-1', entryType: 'std', ref: [{ text: 'GB/T 1' }], title: [{ text: '名称' }] }] },
    ], 'norm-refs'),
    chapter('ch-terms', '术语和定义', [
      para('terms-p', '下列术语和定义适用于本文件。'),
      {
        kind: 'termEntry', id: 'term-1', term: [{ text: '术语一' }], definition: [para('term-1-def', '定义')],
        notes: [note('term-note', '术语注')], examples: [example('term-ex', '术语示例')],
      },
    ], 'terms'),
    chapter('ch-body', '技术要求', [
      // 有序列项只有被 crossRef 引用时才有标签（li_<k>），所以在 IR 里引用 li-a2
      para('body-p', '正文', { text: '第二项', marks: [{ type: 'crossRef', targetId: 'li-a2', targetKind: 'listItem' }] }),
      table,
      { kind: 'figure', id: 'fig-1', caption: [{ text: '图题' }], orientation: 'portrait', src: '', notes: [] },
      { kind: 'formula', id: 'f-num', latex: 'a=b', numbered: true, whereList: [] },
      { kind: 'formula', id: 'f-un', latex: 'c=d', numbered: false, whereList: [] },
      { kind: 'defList', id: 'abbr-list', items: [{ id: 'abb-1', term: [{ text: 'ADC' }], definition: [{ text: '模数转换器' }] }] },
      clause('cl-1', 1, '总体要求', [
        para('cl-1-p', '条内正文'),
        list('list-alpha', 'alpha', [['li-a1', '第一项'], ['li-a2', '第二项']]),
        list('list-dash', 'dash', [['li-d1', '无序项']]),
        note('note-1', '一般注'),
        example('ex-1', '一般示例'),
        { kind: 'warning', id: 'warn-1', content: [para('warn-1.p0', '警告')] },
        { kind: 'quote', id: 'quote-1', content: [para('quote-1.p0', '摘录')] },
        { kind: 'code', id: 'code-1', text: 'a = 1' },
      ]),
    ]),
  ], {
    appendices: [appendix('app-a', false, '资料性附录', [para('app-a-p', '附录正文')])],
    bibliography: [{ kind: 'bibEntry', id: 'bib-1', content: [{ text: '文献一' }] }],
    index: { id: 'index-1', groups: [{ id: 'index-group', entries: [{ id: 'index-entry-1', term: [{ text: '正文' }], targets: ['body-p'], seeAlso: [] }] }] },
    front: { foreword: [], introduction: [] },
  })
}
