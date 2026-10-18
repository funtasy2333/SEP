import type { IRInline } from '@ses/shared'

/**
 * 文字形式的符号 → LaTeX（式中一键转换、正文选中文字转公式共用，docs/phase7-inline-formula.md）。
 *
 * 只在能可靠还原时转换：纯文字加斜体/上下标标记，字符限于拉丁字母、数字、常用标点、撇号和希腊字母。
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
