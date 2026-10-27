/**
 * WP8.M G6「引言中的条」的 IR 原生 fixture（矩阵 M-4.3.4-02、M-4.3.4-03）。
 *
 * 不修改字节锁定的 fixtures.ts；这里只构造 G6 需要的最小文档。引言没有正文块、只有条（避免悬置段告警），
 * 条里放图/表/注/脚注，用来验证：编号 0.1/0.1.1/0.2、图表编号从引言起算并接续正文、脚注顺序、
 * 正文章条的编号不受引言条影响、正文对引言条的交叉引用。
 */

import type { IRClause, IRDoc, IRInline, IRList, IRNote, IRParagraph, IRTable, IRFigure, NodeId } from '../types'

const t = (text: string): IRInline => ({ text })
const para = (id: NodeId, ...content: IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content })
const xref = (text: string, targetId: NodeId): IRInline => ({ text, marks: [{ type: 'crossRef', targetId, targetKind: 'clause' }] })
const note = (id: NodeId, text: string): IRNote => ({ kind: 'note', id, content: [para(`${id}.p0`, t(text))] })

function table(id: NodeId, caption: string): IRTable {
  return {
    kind: 'table', id, caption: [t(caption)], orientation: 'portrait', headerRowCount: 1, notes: [],
    rows: [
      { id: `${id}-r1`, cells: [
        { id: `${id}-r1c1`, colspan: 1, rowspan: 1, header: true, content: [para(`${id}-r1c1-p`, t('项目'))] },
        { id: `${id}-r1c2`, colspan: 1, rowspan: 1, header: true, content: [para(`${id}-r1c2-p`, t('备注'))] },
      ] },
      { id: `${id}-r2`, cells: [
        { id: `${id}-r2c1`, colspan: 1, rowspan: 1, header: false, content: [para(`${id}-r2c1-p`, t('来由'))] },
        { id: `${id}-r2c2`, colspan: 1, rowspan: 1, header: false, content: [para(`${id}-r2c2-p`, t('编制缘由'))] },
      ] },
    ],
  }
}

const SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4='
function figure(id: NodeId, caption: string): IRFigure {
  return { kind: 'figure', id, caption: [t(caption)], orientation: 'portrait', src: SVG, alt: '', notes: [] }
}

function alphaList(id: NodeId): IRList {
  return { kind: 'list', id, listType: 'alpha', items: [
    { id: `${id}-i1`, content: [para(`${id}-i1.p0`, t('第一项'))] },
    { id: `${id}-i2`, content: [para(`${id}-i2.p0`, t('第二项'))] },
  ] }
}

/** 引言条：0.1 背景（含 0.1.1 起因、0.1.2 脚注）、0.2 目的（列项、表、图）、0.3 无题条。 */
export function introductionClauses(): IRClause[] {
  return [
    {
      kind: 'clause', id: 'intro-c1', level: 1, titled: true, title: [t('背景')], children: [
        {
          kind: 'clause', id: 'intro-c1-1', level: 2, titled: true, title: [t('起因')], children: [
            para('intro-c1-1-p1', t('编制起因。')),
            note('intro-c1-1-note', '引言条内的注。'),
          ],
        },
        {
          kind: 'clause', id: 'intro-c1-2', level: 2, titled: true, title: [t('说明')], children: [
            para('intro-c1-2-p1', t('本文件的编制背景。'), { text: '', footnote: { id: 'intro-fn1', content: [t('引言条中的脚注。')] } }),
          ],
        },
      ],
    },
    {
      kind: 'clause', id: 'intro-c2', level: 1, titled: true, title: [t('目的')], children: [
        para('intro-c2-p1', t('编制目的，见'), xref('0.1', 'intro-c1'), t('。')),
        alphaList('intro-c2-list'),
        table('intro-tab', '引言表'),
        figure('intro-fig', '引言图'),
      ],
    },
    {
      kind: 'clause', id: 'intro-c3', level: 1, titled: false, title: [], children: [
        para('intro-c3-p1', t('无标题条的条文。')),
      ],
    },
  ]
}

/** 正文：第 1 章只含 1.1 条（避免悬置段），引用引言条 0.1、0.1.1；正文图表接续引言之后编号。 */
function body(): IRDoc['body'] {
  return [{
    kind: 'chapter', id: 'ch1', secType: 'scope', title: [t('范围')], children: [
      {
        kind: 'clause', id: 'ch1-c1', level: 1, titled: true, title: [t('一般要求')], children: [
          para('ch1-c1-p1', t('见引言'), xref('占位', 'intro-c1'), t('与'), xref('占位', 'intro-c1-1'), t('，脚注'), { text: '', footnote: { id: 'body-fn1', content: [t('正文脚注。')] } }),
          table('body-tab', '正文表'),
          figure('body-fig', '正文图'),
        ],
      },
    ],
  }]
}

/** 引言只有条（没有正文块）的完整文档。 */
export function createG6IrDoc(): IRDoc {
  return {
    schemaVersion: 1,
    extensionVersion: 1,
    meta: { standardType: 'gb', title: '引言分条示例', stdCode: 'GB/T 99999—2026' },
    front: { foreword: [para('fw-p1', t('本文件的前言。'))], introduction: [], introductionClauses: introductionClauses() },
    body: body(),
    appendices: [],
    bibliography: [],
  }
}

/** 与 {@link createG6IrDoc} 相同，但引言没有条（旧形态，用于证明无条引言的行为不变）。 */
export function createG6IrDocWithoutClauses(): IRDoc {
  const doc = createG6IrDoc()
  doc.front = { foreword: doc.front.foreword, introduction: [para('intro-p1', t('引言的正文。'))] }
  delete doc.extensionVersion
  // 去掉对引言条的交叉引用与脚注，使文档在没有条时仍自洽
  doc.body = [{
    kind: 'chapter', id: 'ch1', secType: 'scope', title: [t('范围')], children: [
      { kind: 'clause', id: 'ch1-c1', level: 1, titled: true, title: [t('一般要求')], children: [para('ch1-c1-p1', t('正文条文。'))] },
    ],
  }]
  return doc
}
