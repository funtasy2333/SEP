/**
 * 公式转换：KaTeX → MathML → OMML（平台无关，client 与服务端共用）。
 *
 * mathml2omml 按需动态导入，保持独立的异步构建 chunk（docs/wp7-docx-delivery.md §8.1、§8.5）。
 * shared 渲染器只接收已经生成的 OMML，不依赖 KaTeX、浏览器或转换库。
 */

import type { IRBlock, IRChapter, IRChapterChild, IRClause, IRDoc, IRTermEntry, NodeId } from '@ses/shared'
import {
  isElement,
  latexToMathMl,
  serializeMathMl,
  type MathMlElement,
  type MathMlNode,
} from './formulaMathMl'

export interface FormulaConversionWarning {
  code: 'formula-conversion-failed'
  nodeId: NodeId
  message: string
}

export interface FormulaOmmlResult {
  formulaOmml: Record<NodeId, string>
  /** 式中符号行内公式的估算宽度（汉字宽），供 DOCX 计算破折号制表位；key = 行内公式 id */
  formulaWidths: Record<NodeId, number>
  warnings: FormulaConversionWarning[]
}

export interface FormulaConversionOptions {
  /** false 时按行内公式布局（KaTeX displayMode:false）；默认 true，即块级公式 */
  display?: boolean
}

const NARY_OPERATORS = new Set(Array.from('∑∏∐∫∬∭∮∯∰⋀⋁⋂⋃⨀⨁⨂'))
const STOP_OPERATORS = new Set(Array.from('=+−-±∓<>≤≥≈≠≡∼,;'))
const OPEN_FENCES = new Set(Array.from('([{⟨'))
const CLOSE_FENCES = new Set(Array.from(')]}⟩'))
const POSITIONAL_ELEMENTS = new Set([
  'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mfrac', 'mroot', 'mmultiscripts',
])
const SEQUENTIAL_CONTAINERS = new Set([
  'math', 'semantics', 'mrow', 'mstyle', 'mtd', 'msqrt', 'menclose', 'mpadded', 'merror', 'mphantom',
])
const ENTITY_PLACEHOLDERS = [
  ['&lt;', '\uE001'],
  ['&gt;', '\uE002'],
  ['&amp;', '\uE003'],
] as const

let converterPromise: Promise<(mathml: string) => string> | undefined

async function loadMathMlConverter(): Promise<(mathml: string) => string> {
  converterPromise ??= import('mathml2omml')
    .then(({ mml2omml }) => mml2omml)
    .catch((error: unknown) => {
      // 不缓存一次性的加载失败，让后续导出能够重新请求转换器 chunk。
      converterPromise = undefined
      throw error
    })
  return converterPromise
}

function textContent(node: MathMlNode): string {
  return isElement(node) ? node.children.map(textContent).join('') : node.text
}

function operatorText(node: MathMlNode): string {
  return textContent(node)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .trim()
}

function elementChildren(node: MathMlElement): MathMlElement[] {
  return node.children.filter(isElement)
}

function naryOperator(node: MathMlNode): string | undefined {
  if (!isElement(node)) return undefined
  const base = POSITIONAL_ELEMENTS.has(node.tag) ? elementChildren(node)[0] : node
  if (!base || base.tag !== 'mo') return undefined
  const operator = operatorText(base)
  return NARY_OPERATORS.has(operator) ? operator : undefined
}

function fenceChange(node: MathMlNode): -1 | 0 | 1 {
  if (!isElement(node)) return 0
  let fence = ''
  if (node.tag === 'mo') {
    fence = operatorText(node)
  } else if (['msub', 'msup', 'msubsup'].includes(node.tag)) {
    const base = elementChildren(node)[0]
    if (base?.tag === 'mo') fence = operatorText(base)
  }
  if (OPEN_FENCES.has(fence)) return 1
  if (CLOSE_FENCES.has(fence)) return -1
  return 0
}

/** 修复 mathml2omml 对 n-ary 主体边界的处理，并保留外层括号和运算符。 */
function absorbNaryBodies(node: MathMlElement): void {
  for (const child of node.children) if (isElement(child)) absorbNaryBodies(child)
  if (!SEQUENTIAL_CONTAINERS.has(node.tag) || POSITIONAL_ELEMENTS.has(node.tag)) return

  const output: MathMlNode[] = []
  for (let i = 0; i < node.children.length; i++) {
    const current = node.children[i]!
    output.push(current)
    if (!naryOperator(current)) continue

    const body: MathMlNode[] = []
    let depth = 0
    let j = i + 1
    for (; j < node.children.length; j++) {
      const sibling = node.children[j]!
      const isStop = isElement(sibling) && sibling.tag === 'mo' && depth === 0 && STOP_OPERATORS.has(operatorText(sibling))
      if (isStop) break
      const change = fenceChange(sibling)
      // 深度为 0 时的右括号属于 n-ary 外层分组，保留在吸收范围外。
      if (depth + change < 0) break
      depth += change
      body.push(sibling)
    }
    if (body.length > 0) {
      output.push({ tag: 'mrow', attrs: '', children: body })
      i = j - 1
    }
  }
  node.children = output
}

function protectMathMlEntities(mathml: string): string {
  let output = mathml
  for (const [entity, placeholder] of ENTITY_PLACEHOLDERS) output = output.replaceAll(entity, placeholder)
  return output
}

function restoreMathMlEntities(omml: string): string {
  let output = omml
  for (const [entity, placeholder] of ENTITY_PLACEHOLDERS) output = output.replaceAll(placeholder, entity)
  return output
}

/**
 * mathml2omml 0.5.0 有三类不符合 OMML schema 的冗余输出：
 * - 变量样式同时写重复的 w:rPr 与 m:rPr；
 * - 未识别样式写成 m:sty val="undefined"；
 * - 将 MathML scriptlevel 写入不存在的 m:scrLvl。
 * 这里只规整可等价映射的格式属性，不改 m:t、分式、矩阵、上下标等公式主体。
 */
function normalizeMathMl2Omml(omml: string): string {
  let normalized = omml.replace(/<m:r\b([^>]*)>([\s\S]*?)<\/m:r>/g, (_run, attrs: string, rawChildren: string) => {
    let children = rawChildren.replace(/<m:sty\s+m:val="undefined"\s*\/>/g, '')
    const runStyle = /<m:sty\s+m:val="(b|i|bi|p)"\s*\/>/.exec(children)?.[1]
    if (children.includes('<m:nor/>') && runStyle && runStyle !== 'p') {
      // CT_RPr chooses either nor or the script/style pair; preserve explicit bold/italic style.
      children = children.replace('<m:nor/>', '')
    } else if (children.includes('<m:nor/>') && runStyle === 'p') {
      // Plain text remains normal text, represented by nor rather than a conflicting sty child.
      children = children.replace(/<m:sty\s+m:val="p"\s*\/>/, '')
    }
    const wordRunProperties = /<w:rPr\s*\/>|<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(children)
    if (wordRunProperties) {
      const propertyBody = wordRunProperties[1]
      if (propertyBody === undefined || propertyBody.trim() === '') {
        children = children.replace(wordRunProperties[0], '')
      } else {
        const wordStyles = Array.from(propertyBody.matchAll(/<w:([bi])\s*\/>/g), (match) => match[1]!)
        const unsupportedWordProperties = propertyBody.replace(/<w:[bi]\s*\/>/g, '').trim()
        const mathRunProperties = /<m:rPr\b[^>]*>([\s\S]*?)<\/m:rPr>/.exec(children)?.[1]
        const mathStyle = mathRunProperties?.match(/<m:sty\s+m:val="(b|i|bi)"\s*\/>/)?.[1]
        const equivalentStyles: Record<string, readonly string[]> = {
          b: ['b'],
          i: ['i'],
          bi: ['b', 'i'],
        }
        const expectedWordStyles = mathStyle ? equivalentStyles[mathStyle] : undefined
        if (
          unsupportedWordProperties === '' && expectedWordStyles &&
          wordStyles.length === expectedWordStyles.length &&
          expectedWordStyles.every((style) => wordStyles.includes(style))
        ) {
          // mathml2omml duplicates bold/italic in w:rPr and m:rPr; m:sty is the
          // schema-native representation for a math run, so retain it.
          children = children.replace(wordRunProperties[0], '')
        }
      }
    }
    return `<m:r${attrs}>${children}</m:r>`
  })

  normalized = normalized.replace(
    /<m:argPr>\s*<m:scrLvl\s+m:val="([012])"\s*\/>\s*<\/m:argPr>/g,
    (_property, level: string) => level === '0'
      // Argument size defaults to zero; omitting this invalid explicit default
      // keeps the converter's intended base size without adding an OMML node.
      ? ''
      // MathML script levels 1/2 mean one/two steps smaller than the base size.
      : `<m:argPr><m:argSz m:val="-${level}"/></m:argPr>`,
  )

  normalized = normalized.replace(
    /(?:<m:argPr><m:argSz\s+m:val="(-[12])"\s*\/><\/m:argPr>\s*){2,}/g,
    (properties) => {
      const sizes = Array.from(properties.matchAll(/m:val="(-[12])"/g), (match) => match[1]!)
      if (new Set(sizes).size !== 1) throw new Error('MathML 转换器为同一公式参数输出了互相冲突的 scriptlevel')
      return `<m:argPr><m:argSz m:val="${sizes[0]}"/></m:argPr>`
    },
  )

  if (/<m:scrLvl\b|<m:sty\s+m:val="undefined"/.test(normalized)) {
    throw new Error('MathML 转换器输出了无法无损规范化的 OMML 样式属性')
  }
  return normalized
}

/** 单条 LaTeX → OMML。转换异常向调用方抛出，由批量函数记录告警并按 LaTeX 降级。 */
export async function convertFormulaToOmml(latex: string, options: FormulaConversionOptions = {}): Promise<string> {
  const math = latexToMathMl(latex, options.display ?? true)
  absorbNaryBodies(math)
  const safeMathMl = protectMathMlEntities(serializeMathMl(math))
  const omml = normalizeMathMl2Omml(restoreMathMlEntities(await (await loadMathMlConverter())(safeMathMl)))
  if (!/^\s*<m:oMath\b/.test(omml) || !/<\/m:oMath>\s*$/.test(omml)) {
    throw new Error('MathML 转换器未返回完整的 OMML `<m:oMath>` 元素')
  }
  if (ENTITY_PLACEHOLDERS.some(([, placeholder]) => omml.includes(placeholder))) {
    throw new Error('OMML 中残留实体占位符')
  }
  return omml
}

/** 脚标相对基线的缩放；Word 公式的上下标约为基线字号的七成。 */
const SCRIPT_SCALE = 0.7
/** 估算偏小会让制表符跳到下一个默认制表位，统一留出余量。 */
const WIDTH_MARGIN = 0.25

function charWidth(char: string): number {
  return /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(char) ? 1 : 0.5
}

function mathWidth(node: MathMlNode, scale: number): number {
  if (!isElement(node)) {
    let width = 0
    for (const char of operatorText(node)) if (char.trim()) width += charWidth(char)
    return width * scale
  }
  const children = elementChildren(node)
  const width = (child: MathMlElement | undefined, childScale = scale) => child ? mathWidth(child, childScale) : 0
  switch (node.tag) {
    case 'msub':
    case 'msup':
      return width(children[0]) + width(children[1], scale * SCRIPT_SCALE)
    case 'msubsup':
      return width(children[0]) + Math.max(width(children[1], scale * SCRIPT_SCALE), width(children[2], scale * SCRIPT_SCALE))
    case 'munder':
    case 'mover':
    case 'munderover':
      return Math.max(width(children[0]), ...children.slice(1).map(child => width(child, scale * SCRIPT_SCALE)))
    case 'mfrac':
      return Math.max(width(children[0]), width(children[1]))
    case 'msqrt':
      return node.children.reduce((sum, child) => sum + mathWidth(child, scale), 0) + 0.5 * scale
    case 'mroot':
      return width(children[0]) + width(children[1], scale * SCRIPT_SCALE) + 0.5 * scale
    case 'mspace': {
      // KaTeX 把 \quad、\hspace{…}、\kern 等统一换算成 em；1em 按一个汉字宽计。负宽度按 0 计（宁可估大）。
      const em = /\bwidth="(-?\d*\.?\d+)em"/.exec(node.attrs)
      return em ? Math.max(0, Number(em[1])) * scale : 0
    }
    case 'mphantom':
      // 幻影不显示但占位（\phantom、\hphantom），按内容测量。
      return node.children.reduce((sum, child) => sum + mathWidth(child, scale), 0)
    default:
      return node.children.reduce((sum, child) => sum + mathWidth(child, scale), 0)
  }
}

/**
 * 估算行内公式的排版宽度（汉字宽）。Word 不测量 OMML，制表位只能事先估算：
 * 基线字符按汉字 1、其余 0.5，脚标乘 0.7，空白按 em 计、幻影按内容计，最后加 0.25 余量（docs/wp7-docx-delivery.md §5.10）。
 */
export function estimateFormulaWidth(latex: string): number {
  return mathWidth(latexToMathMl(latex, false), 1) + WIDTH_MARGIN
}

type FormulaVisitor = (id: NodeId, latex: string, display: boolean) => void

/**
 * 行内公式可以出现在任何正文类位置（段落、单元格、注、脚注、表脚注、式中……，见 docs/phase7-inline-formula.md），
 * 是否允许由导出边界决定；这里对整篇 IR 通用遍历，收集所有带 LaTeX 的行内公式片段。
 */
function collectInlineFormulas(value: unknown, visitFormula: FormulaVisitor): void {
  if (Array.isArray(value)) {
    for (const item of value) collectInlineFormulas(item, visitFormula)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  const formula = record.formula as { id?: unknown; latex?: unknown } | undefined
  if (typeof record.text === 'string' && formula && typeof formula.id === 'string' && typeof formula.latex === 'string') {
    visitFormula(formula.id, formula.latex, false)
  }
  for (const child of Object.values(record)) collectInlineFormulas(child, visitFormula)
}

function visitBlock(block: IRBlock, visitFormula: FormulaVisitor): void {
  switch (block.kind) {
    case 'formula':
      visitFormula(block.id, block.latex, true)
      break
    case 'list':
      for (const item of block.items) {
        for (const child of item.content) if (child.kind === 'list') visitBlock(child, visitFormula)
      }
      break
    case 'table':
      for (const row of block.rows) {
        for (const cell of row.cells) for (const child of cell.content) visitBlock(child, visitFormula)
      }
      for (const note of block.notes) for (const child of note.content) visitBlock(child, visitFormula)
      break
    case 'figure':
      for (const note of block.notes) for (const child of note.content) visitBlock(child, visitFormula)
      break
    case 'note':
    case 'example':
      for (const child of block.content) visitBlock(child, visitFormula)
      break
    case 'paragraph':
      break
  }
}

function visitTermEntry(entry: IRTermEntry, visitFormula: FormulaVisitor): void {
  for (const block of entry.definition) visitBlock(block, visitFormula)
  for (const note of entry.notes) for (const block of note.content) visitBlock(block, visitFormula)
  for (const example of entry.examples) for (const block of example.content) visitBlock(block, visitFormula)
}

function visitStructuredChild(
  child: IRChapterChild | IRClause,
  visitFormula: FormulaVisitor,
): void {
  if (child.kind === 'clause') {
    for (const nested of child.children) visitStructuredChild(nested, visitFormula)
  } else if (child.kind === 'termEntry') {
    visitTermEntry(child, visitFormula)
  } else {
    visitBlock(child, visitFormula)
  }
}

function visitChapter(chapter: IRChapter, visitFormula: FormulaVisitor): void {
  for (const child of chapter.children) visitStructuredChild(child, visitFormula)
}

/**
 * 转换 IR 文档里的全部公式。失败项不写入公式资源表；shared 渲染器随后输出 LaTeX 文本。
 * 导出器应将返回的 warnings 合并到 DocxPackage.warnings。
 */
export async function convertFormulasToOmml(doc: IRDoc): Promise<FormulaOmmlResult> {
  const formulaOmml: Record<NodeId, string> = {}
  const formulaWidths: Record<NodeId, number> = {}
  const warnings: FormulaConversionWarning[] = []
  const convert = async (id: NodeId, latex: string, display: boolean) => {
    try {
      if (!latex.trim()) throw new Error('公式源代码为空')
      const omml = await convertFormulaToOmml(latex, { display })
      if (!display) formulaWidths[id] = estimateFormulaWidth(latex)
      formulaOmml[id] = omml
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      warnings.push({
        code: 'formula-conversion-failed',
        nodeId: id,
        message: `公式 "${id}" 转换为 OMML 失败，导出时将回退为 LaTeX 源码：${detail}`,
      })
    }
  }

  const formulas: { id: NodeId; latex: string; display: boolean }[] = []
  const collect: FormulaVisitor = (id, latex, display) => formulas.push({ id, latex, display })
  for (const block of doc.front.foreword) visitBlock(block, collect)
  for (const block of doc.front.introduction) visitBlock(block, collect)
  for (const clause of doc.front.introductionClauses ?? []) visitStructuredChild(clause, collect)
  for (const chapter of doc.body) visitChapter(chapter, collect)
  for (const appendix of doc.appendices) {
    for (const child of appendix.children) visitStructuredChild(child, collect)
  }
  collectInlineFormulas(doc, collect)
  for (const formula of formulas) await convert(formula.id, formula.latex, formula.display)

  return { formulaOmml, formulaWidths, warnings }
}
