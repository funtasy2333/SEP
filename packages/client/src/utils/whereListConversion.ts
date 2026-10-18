import { irToPm, pmToIr, type IRDoc, type IRFormula, type IRInline, type PMJsonNode } from '@ses/shared'
import { termToLatex } from './inlineFormulaLatex'

export { termToLatex }

/**
 * 旧的自由文本式中（formulaDescription「式中：A——定义；…」）一键转换为结构化式中。
 *
 * 拆条沿用 pmToIr 的 parseWhereList 规则；符号只在能可靠还原时转成行内公式：
 * 纯文字加斜体/上下标标记，字符限于拉丁字母、数字、常用标点和希腊字母。
 * 基线字母按数学斜体；脚标沿用作者的标记：带斜体的保持斜体，未标斜体的字母写成 \mathrm（与原排版一致）。
 */

export interface WhereConversionRow {
  /** 原符号文字（不含格式） */
  termText: string
  /** 转换后的 LaTeX；null 表示保留为文字 */
  latex: string | null
  reason?: string
  definitionText: string
}

const plainText = (inlines: IRInline[]) => inlines.map(run => run.text).join('')

function stripNewIds(node: PMJsonNode): PMJsonNode {
  const copy: PMJsonNode = { ...node }
  if ((node.type === 'whereItem' || node.type === 'formulaInline') && copy.attrs) {
    const { nodeId: _nodeId, ...rest } = copy.attrs
    copy.attrs = rest
  }
  if (node.content) copy.content = node.content.map(stripNewIds)
  return copy
}

function wrap(formula: PMJsonNode): PMJsonNode {
  return { type: 'doc', content: [{ type: 'chapter', content: [{ type: 'chapterTitle' }, formula] }] }
}

/**
 * 返回转换后的公式 JSON（去掉 formulaDescription，式中条目追加到 whereList 末尾）与对照行。
 * 没有非空自由文本式中时原样返回、rows 为空。
 */
export function convertLegacyWhereDescription(formula: PMJsonNode): { formula: PMJsonNode; rows: WhereConversionRow[] } {
  const content = formula.content ?? []
  const description = content.find(child => child.type === 'formulaDescription')
  if (!description?.content?.length) return { formula, rows: [] }

  // 只解析自由文本：已有的结构化条目不参与 pmToIr 的二选一。
  const descriptionOnly = { ...formula, content: content.filter(child => child.type !== 'whereList') }
  const parsed = (pmToIr(wrap(descriptionOnly)).doc.body[0]?.children[0] as IRFormula | undefined)?.whereList ?? []

  const rows: WhereConversionRow[] = []
  const whereList: IRFormula['whereList'] = parsed.map((item, index) => {
    const latex = item.term.length ? termToLatex(item.term) : null
    rows.push({
      termText: plainText(item.term),
      latex,
      ...(latex === null ? { reason: item.term.length ? '符号含无法可靠转换的字符或格式，保留为文字' : '没有符号' } : {}),
      definitionText: plainText(item.definition),
    })
    return { ...item, term: latex === null ? item.term : [{ text: '', formula: { id: `conversion-${index}`, latex } }] }
  })

  const irDoc: IRDoc = {
    schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'conversion', secType: 'general', title: [], children: [
      { kind: 'formula', id: 'conversion-formula', latex: 'x', numbered: false, whereList },
    ] }],
    appendices: [], bibliography: [],
  }
  const projected = irToPm(irDoc).content?.[0]?.content?.find(child => child.type === 'formula')
  const newItems = (projected?.content?.find(child => child.type === 'whereList')?.content ?? []).map(stripNewIds)

  const existing = content.find(child => child.type === 'whereList')
  const list: PMJsonNode = { ...(existing ?? { type: 'whereList' }), content: [...(existing?.content ?? []), ...newItems] }
  const kept = content.filter(child => child.type !== 'formulaDescription' && child.type !== 'whereList')
  return { formula: { ...formula, content: [...kept, list] }, rows }
}
