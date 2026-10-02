import type { IRDoc, IRTable } from '../../ir/types'

export function footnoteFixture(): IRDoc {
  const table: IRTable = {
    kind: 'table',
    id: 'table-1',
    caption: [{ text: '脚注顺序测试' }],
    orientation: 'portrait',
    headerRowCount: 0,
    rows: [{
      id: 'row-1',
      cells: [{
        id: 'cell-1', colspan: 1, rowspan: 1, header: false,
        content: [{
          kind: 'paragraph', id: 'cell-p-1',
          content: [
            { text: '引用定义B', marks: [{ type: 'tableFootnoteRef', targetId: 'table-fn-b' }] },
            { text: '，再引用定义A', marks: [{ type: 'tableFootnoteRef', targetId: 'table-fn-a' }] },
          ],
        }],
      }, {
        id: 'cell-2', colspan: 1, rowspan: 1, header: false,
        content: [{ kind: 'paragraph', id: 'cell-p-2', content: [{ text: '辅助列' }] }],
      }],
    }],
    notes: [{
      kind: 'note', id: 'table-note-1',
      content: [{ kind: 'paragraph', id: 'table-note-p-1', content: [{ text: '表注内容' }] }],
    }],
    // Intentionally opposite to first-reference order: b receives a), a receives b).
    footnotes: [
      { id: 'table-fn-a', content: [{ text: '定义A' }] },
      { id: 'table-fn-b', content: [{ text: '定义B' }] },
    ],
  }

  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', stdCode: 'GB/T 12345—2026', title: '脚注测试' },
    front: {
      foreword: [{
        kind: 'paragraph', id: 'foreword-p-1',
        content: [{ text: '前言条文', footnote: { id: 'body-fn-1', content: [{ text: '前言脚注内容' }] } }],
      }],
      introduction: [],
    },
    body: [{ kind: 'chapter', id: 'chapter-1', secType: 'general', title: [{ text: '正文' }], children: [table] }],
    appendices: [],
    bibliography: [],
  }
}
