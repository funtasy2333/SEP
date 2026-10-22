/**
 * WP8.M / G4（列项引用与列项 id）的 IR 原生 fixture。
 * 不修改字节锁定的 fixtures.ts；与 client 侧 `wp8m-g4.ts`（生产 PM JSON）配套。
 *
 * 文档结构（id 即语义）：
 *   foreword            ── 前言：字母列表 fw-list（fw-a、fw-b）
 *   ch1 范围            ── 直属字母列表 ch1-list（ch1-a、ch1-b）
 *   ch2 规范性引用文件 / ch3 术语和定义 / ch4 一般要求 ── 各一段正文，仅为凑出 5.2 的章序
 *   ch5 技术要求
 *     c51 (5.1)         ── 正文段
 *     c52 (5.2)         ── 引用段 + 字母列表 l-alpha（a1、a2、a3）+ 破折号列表 l-dash（d1、d2）
 *                          + 数字列表 l-number（n1…n3）+ 罗马列表 l-roman（r1…r4）+ 大写罗马列表 l-romanUpper
 *   附录 A              ── 字母列表 ap-list（ap-a、ap-b）
 */

import type {
  IRAppendix, IRBlock, IRChapter, IRClause, IRDoc, IRExample, IRFigure, IRInline, IRList, IRNote, IRParagraph,
  IRReferenceTargetKind, IRTable, IRTermEntry, NodeId,
} from '../types'

export type ListItem = IRList['items'][number]

export const para = (id: NodeId, ...content: IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content })

/** 引用行内：显示文字由 Resolver 的 refText 替换，作者原文仅作回退 */
export function xref(targetId: NodeId, targetKind?: IRReferenceTargetKind, text = '见列项'): IRInline {
  return { text, marks: [{ type: 'crossRef', targetId, ...(targetKind ? { targetKind } : {}) }] }
}

/** 列项：单段落，段落 id 为 `<项 id>.p0`（与生产 stdListItem 的派生规则一致），可挂嵌套子列表 */
export function item(id: NodeId, text: string, ...nested: IRList[]): ListItem {
  return { id, content: [para(`${id}.p0`, { text }), ...nested] }
}

export function list(id: NodeId, listType: IRList['listType'], items: ListItem[], level?: 1 | 2): IRList {
  return { kind: 'list', id, listType, ...(level ? { level } : {}), items }
}

export const note = (id: NodeId, ...content: IRBlock[]): IRNote => ({ kind: 'note', id, content })
export const example = (id: NodeId, ...content: IRBlock[]): IRExample => ({ kind: 'example', id, content })

/** 单格表：表内容为 cell 里的块，notes 为表注 */
export function table(id: NodeId, cellContent: IRBlock[], notes: IRNote[] = []): IRTable {
  return {
    kind: 'table', id, caption: [{ text: '表题' }], orientation: 'portrait', headerRowCount: 0, notes,
    rows: [{ id: `${id}-row`, cells: [{ id: `${id}-cell`, colspan: 1, rowspan: 1, header: false, content: cellContent }] }],
  }
}

export function figure(id: NodeId, notes: IRNote[] = []): IRFigure {
  return { kind: 'figure', id, caption: [{ text: '图题' }], orientation: 'portrait', src: 'data:image/png;base64,xx', notes }
}

export function termEntry(id: NodeId, extra: Partial<Pick<IRTermEntry, 'notes' | 'examples' | 'definition'>> = {}): IRTermEntry {
  return {
    kind: 'termEntry', id, term: [{ text: '术语' }],
    definition: extra.definition ?? [para(`${id}-def`, { text: '定义' })],
    notes: extra.notes ?? [], examples: extra.examples ?? [],
  }
}

export function clause(id: NodeId, level: IRClause['level'], title: string, ...children: IRBlock[]): IRClause {
  return { kind: 'clause', id, level, titled: true, title: [{ text: title }], children }
}

export function chapter(id: NodeId, secType: IRChapter['secType'], title: string, ...children: IRChapter['children']): IRChapter {
  return { kind: 'chapter', id, secType, title: [{ text: title }], children }
}

export function appendix(id: NodeId, title: string, ...children: IRAppendix['children']): IRAppendix {
  return { kind: 'appendix', id, normative: true, title: [{ text: title }], children }
}

export function docOf(body: IRChapter[], extra: Partial<Pick<IRDoc, 'appendices' | 'bibliography' | 'index'>> & { foreword?: IRBlock[] } = {}): IRDoc {
  const { foreword, ...rest } = extra
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: foreword ?? [], introduction: [] },
    body,
    appendices: [],
    bibliography: [],
    ...(Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) as typeof rest),
  }
}

/** 5.2 条下的各类列表。refs 为 c52 引用段里要写的引用。 */
export function clause52(refs: IRInline[] = [], ...extra: IRBlock[]): IRClause {
  return clause('c52', 1, '列项条',
    para('c52-ref', { text: '参见' }, ...refs),
    list('l-alpha', 'alpha', [item('a1', '甲'), item('a2', '乙'), item('a3', '丙')]),
    list('l-dash', 'dash', [item('d1', '一'), item('d2', '二')]),
    list('l-number', 'number', [item('n1', '壹'), item('n2', '贰'), item('n3', '叁')], 2),
    list('l-roman', 'roman', [item('r1', 'Ⅰ'), item('r2', 'Ⅱ'), item('r3', 'Ⅲ'), item('r4', 'Ⅳ')]),
    list('l-romanUpper', 'romanUpper', [item('u1', 'Ⅴ'), item('u2', 'Ⅵ')]),
    ...extra,
  )
}

/** 带章序的完整文档：技术要求为第 5 章，列项条为 5.2。 */
export function listItemDoc(refs: IRInline[] = [], opts: { extra?: IRBlock[]; foreword?: IRBlock[]; appendices?: IRAppendix[]; ch1?: IRBlock[] } = {}): IRDoc {
  return docOf([
    chapter('ch1', 'scope', '范围', para('ch1-p', { text: '范围正文' }), ...(opts.ch1 ?? [])),
    chapter('ch2', 'norm-refs', '规范性引用文件', para('ch2-p', { text: '无' })),
    chapter('ch3', 'general', '章三', para('ch3-p', { text: '章三正文' })),
    chapter('ch4', 'general', '章四', para('ch4-p', { text: '章四正文' })),
    chapter('ch5', 'general', '技术要求',
      clause('c51', 1, '前一条', para('c51-p', { text: '前一条正文' })),
      clause52(refs, ...(opts.extra ?? [])),
    ),
  ], { foreword: opts.foreword, appendices: opts.appendices })
}

/** 可被 PM 往返的子集（无罗马、无嵌套）：5.2 条下的字母/数字/破折号列表 + 引用段。 */
export function pmProjectableDoc(): IRDoc {
  return docOf([
    chapter('ch1', 'general', '一般要求',
      clause('c11', 1, '列项条',
        para('c11-ref', { text: '见' }, xref('a3', 'listItem', '占位'), { text: '与' }, xref('n2', 'listItem', '占位')),
        list('l-alpha', 'alpha', [item('a1', '甲'), item('a2', '乙'), item('a3', '丙')]),
        list('l-number', 'number', [item('n1', '壹'), item('n2', '贰')], 2),
        list('l-dash', 'dash', [item('d1', '一'), item('d2', '二')]),
      ),
    ),
  ])
}
