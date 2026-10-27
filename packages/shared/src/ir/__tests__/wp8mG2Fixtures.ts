/**
 * WP8.M G2 测试 fixture：通用定义列表（缩略语 def-list）与 abbreviation 引用。
 * 矩阵行：M-10.1.4-01、-03、-04、-05，M-10.1.1-04。约定：C-T-48、C-T-51、X-26（补缺，D-M-02 的 abb_<k>）。
 *
 * - IR 原生构造器（`g2IrDoc`）：Resolver、PM 投影、输出边界与渲染器测试共用。
 * - PM JSON 构造器（`g2PmDoc`）：shared 层 pmToIr/irToPm 测试用的纯对象文档（不依赖 Tiptap）。
 *
 * 不修改字节锁定的 fixtures.ts；与 client 侧 `wp8m-g2.ts`（生产 PM JSON）配套。
 *
 * 文档结构（id 即语义）：
 *   g2-scope 范围            ── 引用段：见 ADC（abbreviation）与 CT
 *   g2-norm 规范性引用文件
 *   g2-abbr-ch 符号和缩略语    ── 引导语 + 缩略语表 g2-list（abb-adc、abb-agc、abb-ct）→ abb_1、abb_2、abb_3
 *   附录 A                    ── 缩略语表 g2-list-app（abb-app）→ abb_4
 */

import type { PMJsonNode } from '../pmToIr'
import type { IRAppendix, IRChapter, IRDefItem, IRDefList, IRDoc, IRInline, NodeId } from '../types'
import { appendix as pmAppendix, chapter as pmChapter, para as pmPara, text as pmText } from './fixtures'

const plain = (value: string): IRInline[] => [{ text: value }]

/** 指向缩略语项的 crossRef 行内；显示文字由 Resolver 的 refText 替换，作者原文仅作回退。 */
export function abbrRef(targetId: NodeId, text = '缩略语', targetKind: 'abbreviation' | null = 'abbreviation'): IRInline {
  return { text, marks: [{ type: 'crossRef', targetId, ...(targetKind ? { targetKind } : {}) }] }
}

export function defItem(id: NodeId, term: string | IRInline[], definition: string | IRInline[]): IRDefItem {
  return {
    id,
    term: typeof term === 'string' ? plain(term) : term,
    definition: typeof definition === 'string' ? plain(definition) : definition,
  }
}

export function defList(id: NodeId, ...items: IRDefItem[]): IRDefList {
  return { kind: 'defList', id, items }
}

/** 主缩略语表：三项，CT 的释义里带一个指向 ADC 的引用与粗体，覆盖行内内容。 */
export function g2MainList(): IRDefList {
  return defList(
    'g2-list',
    defItem('abb-adc', 'ADC', '模数转换器（Analog-to-Digital Converter）'),
    defItem('abb-agc', 'AGC', '自动增益控制（Automatic Gain Control）'),
    defItem('abb-ct', 'CT', [
      { text: '计算机断层扫描，参见' },
      abbrRef('abb-adc', 'ADC'),
      { text: '与', marks: [{ type: 'bold' }] },
      { text: '电流互感器' },
    ]),
  )
}

export function g2Appendix(): IRAppendix {
  return {
    kind: 'appendix', id: 'g2-app-a', normative: false, title: plain('补充缩略语'),
    children: [
      { kind: 'paragraph', id: 'g2-app-p', content: plain('下列缩略语适用于本附录。') },
      defList('g2-list-app', defItem('abb-app', 'UTF-8', '8位统一码转换格式（8-bit Unicode Transformation Format）')),
    ],
  }
}

/**
 * HTML/DOCX 渲染与边界测试、Resolver 测试共用的 IR 文档。
 * `refs` 为范围章引用段的内容，默认引用 ADC（abbreviation）与 CT（无类型引用，旧写法）。
 */
export function g2IrDoc(refs?: IRInline[]): IRDoc {
  const body: IRChapter[] = [
    {
      kind: 'chapter', id: 'g2-scope', secType: 'scope', title: plain('范围'),
      children: [{
        kind: 'paragraph', id: 'g2-scope-p',
        content: refs ?? [
          { text: '本文件使用缩略语' }, abbrRef('abb-adc', '模数转换器'), { text: '与' },
          abbrRef('abb-ct', '计算机断层扫描', null), { text: '。' },
        ],
      }],
    },
    {
      kind: 'chapter', id: 'g2-norm', secType: 'norm-refs', title: plain('规范性引用文件'),
      children: [{ kind: 'paragraph', id: 'g2-norm-p', content: plain('本文件没有规范性引用文件。') }],
    },
    {
      kind: 'chapter', id: 'g2-abbr-ch', secType: 'general', title: plain('符号和缩略语'),
      children: [
        { kind: 'paragraph', id: 'g2-abbr-intro', content: plain('下列缩略语适用于本文件。') },
        g2MainList(),
      ],
    },
  ]
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: 'G2 缩略语测试', stdCode: 'GB/T 99999—2026' },
    front: { foreword: [], introduction: [] },
    body,
    appendices: [g2Appendix()],
    bibliography: [],
  }
}

// ---------- PM JSON（shared 层纯对象） ----------

export function pmDefItem(nodeId: string, term: string | PMJsonNode[], definition: string | PMJsonNode[]): PMJsonNode {
  const inline = (value: string | PMJsonNode[]): PMJsonNode[] => typeof value === 'string' ? (value ? [pmText(value)] : []) : value
  return {
    type: 'whereItem',
    attrs: { nodeId },
    content: [
      { type: 'whereTerm', content: inline(term) },
      { type: 'whereDefinition', content: inline(definition) },
    ],
  }
}

export function pmDefList(nodeId: string, ...items: PMJsonNode[]): PMJsonNode {
  return { type: 'defList', attrs: { nodeId }, content: items }
}

/** 与 g2IrDoc 同构的 PM 文档（章：范围、规范性引用文件、符号和缩略语；附录 A）。 */
export function g2PmDoc(): PMJsonNode {
  const refMark = (targetId: string, refType = 'abbreviation'): PMJsonNode['marks'] => [{ type: 'crossRef', attrs: { targetId, refType } }]
  return {
    type: 'doc',
    content: [
      pmChapter('g2-scope', '范围', pmPara('g2-scope-p',
        pmText('本文件使用缩略语'), pmText('模数转换器', refMark('abb-adc')), pmText('与'), pmText('计算机断层扫描', [{ type: 'crossRef', attrs: { targetId: 'abb-ct' } }]), pmText('。'))),
      pmChapter('g2-norm', '规范性引用文件', pmPara('g2-norm-p', pmText('本文件没有规范性引用文件。'))),
      pmChapter('g2-abbr-ch', '符号和缩略语',
        pmPara('g2-abbr-intro', pmText('下列缩略语适用于本文件。')),
        pmDefList('g2-list',
          pmDefItem('abb-adc', 'ADC', '模数转换器（Analog-to-Digital Converter）'),
          pmDefItem('abb-agc', 'AGC', '自动增益控制（Automatic Gain Control）'),
          pmDefItem('abb-ct', 'CT', [pmText('计算机断层扫描，参见'), pmText('ADC', refMark('abb-adc')), pmText('与', [{ type: 'bold' }]), pmText('电流互感器')]),
        )),
      pmAppendix('g2-app-a', false, '补充缩略语',
        pmPara('g2-app-p', pmText('下列缩略语适用于本附录。')),
        pmDefList('g2-list-app', pmDefItem('abb-app', 'UTF-8', '8位统一码转换格式（8-bit Unicode Transformation Format）'))),
    ],
  }
}
