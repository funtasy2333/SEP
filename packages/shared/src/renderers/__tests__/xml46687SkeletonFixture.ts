/**
 * T2.4a-1 的黄金样例夹具：只含本任务领域的 IR（元数据、前言/引言/引言条、章/条/无标题条/附录、行内标记与引用、
 * 脚注、外链、列项、注/示例/警告/摘录/代码），不含表、图、公式、术语条目、规范性引用清单、参考文献、索引（这些归 T2.4b/T2.4c，
 * 桩函数遇到会抛“未实现”）。
 *
 * 为什么不直接用 `fullRendererFixture()`：它含表、图、公式、术语与参考文献，T2.4a-1 的桩无法导出；它的黄金样例留给 T2.6
 * （设计 §7.2：fullRenderer 的 XML 快照是 T2.4a 的第一个黄金样例，在 T2.4b/T2.4c 完成后才能落地）。
 */

import type { IRDoc, IRList, IRNote, IRExample, IRParagraph } from '../../ir/types'
import { appendix, chapter, clause, makeDoc, para, run } from './xml46687Kit'

const note = (id: string, text: string): IRNote => ({ kind: 'note', id, content: [para(`${id}.p0`, text)] })
const example = (id: string, text: string): IRExample => ({ kind: 'example', id, content: [para(`${id}.p0`, text)] })

function list(id: string, listType: IRList['listType'], items: Array<[string, string, IRList?]>): IRList {
  return {
    kind: 'list', id, listType,
    items: items.map(([itemId, text, nested]) => ({ id: itemId, content: [para(`${itemId}.p0`, text), ...(nested ? [nested] : [])] })),
  }
}

/** 骨架夹具：元数据齐全，所有 SES 必填项都有，导出不产生 `meta-required-missing`。 */
export function skeletonDoc(): IRDoc {
  const intro1 = clause('intro-c1', 1, '背景', [para('intro-c1-p', '引言中的第一个条。')])
  const intro2 = clause('intro-c2', 1, '目的', [clause('intro-c2-1', 2, '起因', [para('intro-c2-1-p', '引言中的二级条。')])])

  const ch1 = chapter('ch-scope', '范围', [
    para('scope-p1', '本文件规定了骨架样例的内容，参见', run('附录A', { type: 'crossRef', targetId: 'app-a', targetKind: 'appendix' }), '。'),
    para('scope-p2',
      '格式有', run('粗体', { type: 'bold' }), '、', run('斜体', { type: 'italic' }), '、', run('下划线', { type: 'underline' }),
      '和', run('删除线', { type: 'strike' }), '；变量', run('x', { type: 'variable' }), run('2', { type: 'variable' }, { type: 'sup' }),
      '，调用', run('init(&ctx)', { type: 'code' }), '。'),
  ], 'scope')

  const ch2 = chapter('ch-refs', '规范性引用文件', [
    para('refs-p', '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。'),
  ], 'norm-refs')

  const ch3 = chapter('ch-terms', '术语和定义', [para('terms-p', '本文件没有需要界定的术语和定义。')], 'terms')

  const ch4 = chapter('ch-tech', '技术要求', [
    clause('cl-41', 1, '总体要求', [
      para('p-41a',
        '各项要求应符合', run('4.2', { type: 'crossRef', targetId: 'cl-42', targetKind: 'clause' }),
        '的规定，见', run('注', { type: 'crossRef', targetId: 'note-41b', targetKind: 'note' }),
        '与', run('示例', { type: 'crossRef', targetId: 'ex-41a', targetKind: 'example' }),
        '，以及列项', run('c', { type: 'crossRef', targetId: 'li-alpha-3', targetKind: 'listItem' }), '。'),
      para('p-41b',
        '参照', run('GB/T 1.1—2020', { type: 'stdRef' }), '，另见', run('Example Corp. Interface specification', { type: 'mixedCitation' }),
        '，访问', run('示例网站', { type: 'externalLink', href: 'https://example.org/' }),
        '，脚注', { text: '内容', footnote: { id: 'fn-1', content: [{ text: '正文脚注的内容。' }] } }, '。'),
      list('list-alpha', 'alpha', [
        ['li-alpha-1', '第一项；', list('list-alpha-nested', 'number', [['li-num-1', '嵌套数字项；'], ['li-num-2', '嵌套数字项。']])],
        ['li-alpha-2', '第二项；'],
        ['li-alpha-3', '第三项。'],
      ]),
      list('list-dash', 'dash', [['li-dash-1', '无序项一；'], ['li-dash-2', '无序项二。']]),
      list('list-dot', 'dot', [['li-dot-1', '圆点项。']]),
      list('list-roman', 'roman', [['li-roman-1', '罗马项一；'], ['li-roman-2', '罗马项二。']]),
      note('note-41a', '没有被引用的注，不带 id。'),
      note('note-41b', '被引用的注，带 id。'),
      example('ex-41a', '被引用的示例，带 id。'),
      example('ex-41b', '没有被引用的示例，不带 id。'),
    ]),
    clause('cl-42', 1, '详细要求', [
      clause('cl-421', 2, null, [para('p-421', '这是一个无标题条，没有 title，带 numbered-paragraph 属性。')]),
      clause('cl-422', 2, '警告与摘录', [
        { kind: 'warning', id: 'warn-1', content: [para('warn-1.p0', '警告是带有警告标签的注。')] },
        { kind: 'quote', id: 'quote-1', content: [para('quote-1.p0', '被缩进的单段引文。')] },
        { kind: 'code', id: 'code-1', language: 'c', text: 'for (i = 0; i < n; i++) {\n    total += a[i];\n}' },
      ]),
      note('note-42', '子条之后的尾部注：写在子条之后。'),
    ]),
  ])

  const appA = appendix('app-a', false, '资料性附录示例', [
    clause('app-a-1', 1, '附录中的条', [para('app-a-1-p', '附录中的条沿用附录字母作编号前缀。')]),
  ])
  const appB = appendix('app-b', true, '规范性附录示例', [para('app-b-p', '规范性附录的正文。')])

  return makeDoc([ch1, ch2, ch3, ch4], {
    meta: {
      standardType: 'gb',
      titleParts: [
        { id: 'tp-zh-main', lang: 'zh', role: 'main', content: [{ text: '网络设备安全要求' }] },
        { id: 'tp-zh-compl', lang: 'zh', role: 'compl', content: [{ text: '第1部分：总则' }] },
        { id: 'tp-zh-full', lang: 'zh', role: 'full', content: [{ text: '网络设备安全要求 第1部分：总则' }] },
        { id: 'tp-en-main', lang: 'en', role: 'main', content: [{ text: 'Security requirements for network devices' }] },
        { id: 'tp-en-full', lang: 'en', role: 'full', content: [{ text: 'Security requirements for network devices Part 1: General' }] },
      ],
      identifiers: [
        {
          id: 'ident-1', scheme: 'dated', value: 'GB/T 99999.1—2026',
          parts: [
            { id: 'ident-1-p1', kind: 'originator', content: [{ text: 'SAC' }] },
            { id: 'ident-1-p2', kind: 'doc-type', content: [{ text: 'GB/T' }] },
            { id: 'ident-1-p3', kind: 'doc-number', content: [{ text: '99999' }] },
            { id: 'ident-1-p4', kind: 'part-number', content: [{ text: '1' }] },
            { id: 'ident-1-p5', kind: 'version', content: [{ text: '1' }, { text: 'a', marks: [{ type: 'sup' }] }] },
          ],
        },
        { id: 'ident-2', scheme: 'undated', value: 'GB/T 99999.1', parts: [] },
      ],
      languages: [{ id: 'lang-zh', tag: 'zh' }, { id: 'lang-en', tag: 'en' }],
      publishers: [
        { id: 'pub-1', name: [{ text: '国家市场监督管理总局' }], role: 'lead', identifier: 'SAMR' },
        { id: 'pub-2', name: [{ text: '国家标准化管理委员会' }], role: 'lead', identifier: 'SAC' },
      ],
      copyrights: [{ id: 'cp-1', statement: [{ text: '版权专有 侵权必究' }], year: '2026', holder: [{ text: '国家标准化管理委员会' }] }],
      replacedStandards: [
        { id: 'rs-1', reference: 'GB/T 99999.1—2020', relation: 'replaces' },
        { id: 'rs-2', reference: 'GB/T 88888', relation: 'revises' },
      ],
      publishDate: '2026-04-30',
      implementDate: '2026-11-01',
      icsCode: '35.240.30',
      ccsCode: 'L 72',
      technicalCommittee: 'SAC/TC 28',
      filingNo: '2026-0001',
      industryName: '信息技术',
      regionName: '全国',
      coverDesignation: '中华人民共和国国家标准',
      applicant: '起草单位',
      proposer: '提出单位',
    },
    front: {
      foreword: [
        para('fw-p1', '本文件按照GB/T 1.1—2020的规定起草。'),
        note('fw-note', '前言中的注。'),
      ],
      introduction: [para('intro-p1', '引言的正文。')],
      introductionClauses: [intro1, intro2],
    },
    appendices: [appA, appB],
  })
}

export type { IRParagraph }
