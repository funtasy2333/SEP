import { irToPm, pmToIr, type IRDoc, type IRFormula, type IRInline, type PMJsonNode } from '@ses/shared'

/**
 * 旧的自由文本式中（formulaDescription「式中：A——定义；…」）一键转换为结构化式中。
 *
 * 拆条沿用 pmToIr 的 parseWhereList 规则；符号只在能可靠还原时转成行内公式：
 * 纯文字加斜体/上下标标记，字符限于拉丁字母、数字、常用标点和希腊字母。
 * 基线字母按数学斜体；脚标沿用作者的标记：带斜体的保持斜体，未标斜体的字母写成 \mathrm（与原排版一致）。
 */

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'varepsilon', ζ: 'zeta', η: 'eta', θ: 'theta',
  ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma',
  τ: 'tau', υ: 'upsilon', φ: 'varphi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
}
const PLAIN = /^[0-9.,()+\-/]$/
const LATIN = /^[A-Za-z]$/
const PRIME = /^['′]$/

/** 把一段文字转成 LaTeX；upright 为 true 时拉丁字母串写成 \mathrm{…}。遇到无法可靠转换的字符返回 null。 */
function textToLatex(text: string, upright: boolean): string | null {
  let out = ''
  let latin = ''
  const flushLatin = () => {
    if (latin) out += upright ? `\\mathrm{${latin}}` : latin
    latin = ''
  }
  for (const char of text) {
    if (LATIN.test(char)) {
      // 希腊字母命令后紧跟字母时需要空格分隔（\Delta p）。
      if (!latin && !upright && /\\[A-Za-z]+$/.test(out)) out += ' '
      latin += char
      continue
    }
    flushLatin()
    if (PLAIN.test(char)) out += char
    else if (PRIME.test(char)) out += "'"
    else if (GREEK[char]) out += `\\${GREEK[char]}`
    else return null
  }
  flushLatin()
  return out
}

/** 旧式中符号 → LaTeX；不能可靠转换时返回 null（保留为文字）。 */
export function termToLatex(term: IRInline[]): string | null {
  let out = ''
  let sub = ''
  let sup = ''
  let hasBase = false
  const flushScripts = () => {
    if (sub) out += `_{${sub}}`
    if (sup) out += `^{${sup}}`
    sub = ''
    sup = ''
  }
  for (const run of term) {
    if (run.footnote || run.formula || run.style || !run.text) return null
    const marks = (run.marks ?? []).map(mark => mark.type)
    if (marks.some(type => type !== 'italic' && type !== 'sub' && type !== 'sup')) return null
    const isSub = marks.includes('sub')
    const isSup = marks.includes('sup')
    if (isSub && isSup) return null
    if (isSub || isSup) {
      if (!hasBase) return null
      const latex = textToLatex(run.text, !marks.includes('italic'))
      if (latex === null) return null
      if (isSub) sub += latex
      else sup += latex
      continue
    }
    flushScripts()
    const latex = textToLatex(run.text, false)
    if (latex === null) return null
    out += latex
    hasBase = true
  }
  flushScripts()
  return out || null
}

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
