import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M G2 生产 Schema fixture：通用定义列表（缩略语 def-list，M-10.1.4-01/-03/-04/-05）与
 * abbreviation 引用（M-10.1.1-04）。仿 wp6.ts 的 pm()/txt() 写法；不修改 wp6.ts（它被多个既有测试共用）。
 */

const pm = (
  type: string,
  attrs?: Record<string, unknown>,
  content?: PMJsonNode[],
  text?: string,
  marks?: NonNullable<PMJsonNode['marks']>,
): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
  ...(text !== undefined ? { text } : {}),
  ...(marks ? { marks } : {}),
})

const txt = (text: string, marks?: NonNullable<PMJsonNode['marks']>) => pm('text', undefined, undefined, text, marks)
const para = (nodeId: string, ...content: PMJsonNode[]) => pm('stdParagraph', { nodeId }, content)

/** 指向缩略语项的 crossRef mark：PM 侧 refType 取 `abbreviation`（对应 IR targetKind）。 */
export const abbrRefMark = (targetId: string, refType = 'abbreviation'): NonNullable<PMJsonNode['marks']> =>
  [{ type: 'crossRef', attrs: { targetId, refType } }]

export const defItem = (nodeId: string, term: PMJsonNode[] | string, definition: PMJsonNode[] | string): PMJsonNode =>
  pm('whereItem', { nodeId }, [
    pm('whereTerm', undefined, typeof term === 'string' ? (term ? [txt(term)] : []) : term),
    pm('whereDefinition', undefined, typeof definition === 'string' ? (definition ? [txt(definition)] : []) : definition),
  ])

export const defList = (nodeId: string, ...items: PMJsonNode[]): PMJsonNode => pm('defList', { nodeId }, items)

/**
 * 全文缩略语项（Resolver 按文档序赋 abb_<k>）：
 * 第 4 章 g2-list（abb-adc、abb-agc、abb-ct）→ abb_1…3；4.1 条内 g2-list-clause（abb-clause）→ abb_4；
 * 附录 A g2-list-app（abb-app）→ abb_5。
 */
export const G2_ITEM_IDS = ['abb-adc', 'abb-agc', 'abb-ct', 'abb-clause', 'abb-app'] as const
export const G2_EXPECTED_LABELS: Record<string, { label: string; xmlId: string }> = {
  'abb-adc': { label: 'ADC', xmlId: 'abb_1' },
  'abb-agc': { label: 'AGC', xmlId: 'abb_2' },
  'abb-ct': { label: 'CT', xmlId: 'abb_3' },
  'abb-clause': { label: 'CO2', xmlId: 'abb_4' },
  'abb-app': { label: 'UTF-8', xmlId: 'abb_5' },
}

export function createWp8mG2Fixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('chapter', { nodeId: 'g2-scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('g2-scope-p',
        txt('本文件使用缩略语'),
        txt('模数转换器', abbrRefMark('abb-adc')),
        txt('与'),
        txt('计算机断层扫描', abbrRefMark('abb-ct')),
        txt('。'),
      ),
    ]),
    pm('chapter', { nodeId: 'g2-norm' }, [
      pm('chapterTitle', undefined, [txt('规范性引用文件')]),
      para('g2-norm-p', txt('本文件没有规范性引用文件。')),
    ]),
    pm('chapter', { nodeId: 'g2-abbr-ch' }, [
      pm('chapterTitle', undefined, [txt('符号和缩略语')]),
      para('g2-abbr-intro', txt('下列缩略语适用于本文件。')),
      defList('g2-list',
        defItem('abb-adc', 'ADC', '模数转换器（Analog-to-Digital Converter）'),
        defItem('abb-agc', 'AGC', '自动增益控制（Automatic Gain Control）'),
        defItem('abb-ct', 'CT', [
          txt('计算机断层扫描，参见'),
          txt('ADC', abbrRefMark('abb-adc')),
          txt('与', [{ type: 'bold' }]),
          txt('电流互感器'),
        ]),
      ),
      pm('clause', { nodeId: 'g2-c41', level: 1, hasTitle: true }, [
        pm('clauseTitle', { level: 1 }, [txt('化学符号')]),
        defList('g2-list-clause',
          defItem('abb-clause', [txt('CO'), txt('2', [{ type: 'subscript' }])], '二氧化碳'),
        ),
        para('g2-c41-p', txt('见'), txt('CO', abbrRefMark('abb-clause')), txt('。')),
      ]),
    ]),
    pm('appendix', { nodeId: 'g2-app-a', normative: false }, [
      pm('appendixLabel', undefined, [txt('（资料性）')]),
      pm('appendixTitle', undefined, [txt('补充缩略语')]),
      para('g2-app-p', txt('下列缩略语适用于本附录。')),
      defList('g2-list-app', defItem('abb-app', 'UTF-8', '8位统一码转换格式（8-bit Unicode Transformation Format）')),
    ]),
  ])
}
