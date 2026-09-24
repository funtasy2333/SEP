// 拟定的 client 侧公式转换 v2：KaTeX(displayMode) → MathML → n-ary 吸收 → mathml2omml → 转义还原
const katex = require('katex')
const { mml2omml } = require('mathml2omml')
const PH = { '&lt;': '', '&gt;': '', '&amp;': '' }
const NARY = new Set([...'∑∏∐∫∬∭∮∯∰⋀⋁⋂⋃⨀⨁⨂'])
const STOP = new Set([...'=+−-±∓<>≤≥≈≠≡∼,;'])
const OPEN = new Set([...'([{⟨'])
const CLOSE = new Set([...')]}⟩'])
// —— 极简 XML 树（KaTeX 输出良构，且已去掉 annotation）——
function parse(s) {
  const root = { tag: '#root', attrs: '', kids: [] }, stack = [root]
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1]
    if (m[5] !== undefined) { top.kids.push({ text: m[5] }); continue }
    if (m[1]) { stack.pop(); continue }
    const node = { tag: m[2], attrs: m[3], kids: [] }
    top.kids.push(node)
    if (!m[4]) stack.push(node)
  }
  return root
}
const ser = n => n.text !== undefined ? n.text : n.tag === '#root' ? n.kids.map(ser).join('') : `<${n.tag}${n.attrs}>${n.kids.map(ser).join('')}</${n.tag}>`
const text = n => n.text !== undefined ? n.text : n.kids.map(text).join('')
const els = n => n.kids.filter(k => k.tag)
function naryChar(n) {                  // n-ary 元素：munderover/msubsup/... 的底为大型运算符，或裸 mo
  if (!n.tag) return null
  const base = ['munderover', 'munder', 'mover', 'msubsup', 'msub', 'msup'].includes(n.tag) ? els(n)[0] : n
  return base && base.tag === 'mo' && NARY.has(text(base).trim()) ? text(base).trim() : null
}
function fenceDelta(n) {                // 括号深度变化（含上标挂在右括号上的情况）
  const t = n.tag === 'mo' ? text(n).trim() : (['msup', 'msub', 'msubsup'].includes(n.tag) && els(n)[0]?.tag === 'mo') ? text(els(n)[0]).trim() : ''
  return OPEN.has(t) ? 1 : CLOSE.has(t) ? -1 : 0
}
// 只在顺序容器里吸收；上下标、分式等「按位置取子节点」的元素不能改动子节点个数
const POSITIONAL = new Set(['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mfrac', 'mroot', 'mmultiscripts'])
function absorb(n) {
  if (!n.tag) return
  n.kids.forEach(absorb)
  if (POSITIONAL.has(n.tag)) return
  const out = []
  for (let i = 0; i < n.kids.length; i++) {
    const k = n.kids[i]; out.push(k)
    if (!naryChar(k)) continue
    const body = []; let depth = 0, j = i + 1
    for (; j < n.kids.length; j++) {
      const s = n.kids[j]
      if (s.tag === 'mo' && depth === 0 && STOP.has(text(s).trim())) break
      depth += s.tag ? fenceDelta(s) : 0
      body.push(s)
      if (depth < 0) break
    }
    if (body.length) { out.push({ tag: 'mrow', attrs: '', kids: body }); i = j - 1 }
  }
  n.kids = out
}
function latexToOmml(tex) {
  const html = katex.renderToString(tex, { output: 'mathml', displayMode: true, throwOnError: true })
  let mml = html.slice(html.indexOf('<math'), html.lastIndexOf('</math>') + 7).replace(/<annotation[\s\S]*?<\/annotation>/g, '')
  const tree = parse(mml); absorb(tree); mml = ser(tree)
  for (const [ent, ph] of Object.entries(PH)) mml = mml.split(ent).join(ph)
  let omml = mml2omml(mml)
  for (const [ent, ph] of Object.entries(PH)) omml = omml.split(ph).join(ent)
  return omml
}
module.exports = { latexToOmml }
if (require.main === module) {
  const f = {
    F1: 'w = \\frac{m_1 - m_2}{m_1} \\times 100\\%',
    F2: '\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i',
    F3: 'a < b \\leq c \\quad \\text{且} \\quad A \\& B',
    F4: 's = \\sqrt{\\frac{\\sum_{i=1}^{n}(x_i - \\bar{x})^2}{n-1}}',
    F5: '\\int_{0}^{\\infty} e^{-x^2}\\,\\mathrm{d}x = \\frac{\\sqrt{\\pi}}{2}',
  }
  const out = {}
  for (const [k, tex] of Object.entries(f)) out[k] = latexToOmml(tex)
  require('fs').writeFileSync('omml.json', JSON.stringify(out))
  for (const [k, v] of Object.entries(out)) {
    const e = (v.match(/<m:nary>[\s\S]*<\/m:nary>/) || [''])[0]
    console.log(k, 'nary:', /<m:nary>/.test(v), '| m:e 为空:', /<m:e\s*\/>|<m:e><\/m:e>/.test(e), '| limLoc:', (v.match(/m:limLoc m:val="(\w+)"/) || [])[1] || '-')
  }
}
