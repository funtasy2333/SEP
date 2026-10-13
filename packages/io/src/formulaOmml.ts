/**
 * 公式转换：KaTeX → MathML → OMML（平台无关，client 与服务端共用）。
 *
 * mathml2omml 按需动态导入，保持独立的异步构建 chunk（docs/wp7-docx-delivery.md §8.1、§8.5）。
 * shared 渲染器只接收已经生成的 OMML，不依赖 KaTeX、浏览器或转换库。
 */

import katex from 'katex'
import type { IRBlock, IRChapter, IRChapterChild, IRClause, IRDoc, IRTermEntry, NodeId } from '@ses/shared'

export interface FormulaConversionWarning {
  code: 'formula-conversion-failed'
  nodeId: NodeId
  message: string
}

export interface FormulaOmmlResult {
  formulaOmml: Record<NodeId, string>
  warnings: FormulaConversionWarning[]
}

interface MathMlText {
  text: string
}

interface MathMlElement {
  tag: string
  attrs: string
  children: MathMlNode[]
}

type MathMlNode = MathMlText | MathMlElement

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

function isElement(node: MathMlNode): node is MathMlElement {
  return 'tag' in node
}

function parseMathMl(xml: string): MathMlElement {
  const root: MathMlElement = { tag: '#root', attrs: '', children: [] }
  const stack: MathMlElement[] = [root]
  const tokenPattern = /<!--[\s\S]*?-->|<(\/?)(([A-Za-z][\w:.-]*))([^<>]*?)(\/?)>|([^<]+)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(xml))) {
    if (match.index !== cursor) throw new Error('KaTeX 输出的 MathML 含有无法解析的 XML 片段')
    cursor = tokenPattern.lastIndex
    const token = match[0]
    if (token.startsWith('<!--')) continue

    const closing = match[1] === '/'
    const tag = match[3]
    const attrs = match[4] ?? ''
    const selfClosing = match[5] === '/'
    const text = match[6]
    if (text !== undefined) {
      stack[stack.length - 1]!.children.push({ text })
      continue
    }
    if (!tag) throw new Error('KaTeX 输出的 MathML 标签为空')
    if (closing) {
      const open = stack.pop()
      if (!open || open === root || open.tag !== tag) throw new Error(`KaTeX 输出的 MathML 标签不匹配：${tag}`)
      continue
    }

    const element: MathMlElement = { tag, attrs, children: [] }
    stack[stack.length - 1]!.children.push(element)
    if (!selfClosing) stack.push(element)
  }

  if (cursor !== xml.length || stack.length !== 1) throw new Error('KaTeX 输出的 MathML 未闭合')
  const math = root.children.find((child): child is MathMlElement => isElement(child) && child.tag === 'math')
  if (!math) throw new Error('KaTeX 未输出 MathML `<math>` 元素')
  return math
}

function serializeMathMl(node: MathMlNode): string {
  if (!isElement(node)) return node.text
  if (node.tag === '#root') return node.children.map(serializeMathMl).join('')
  return `<${node.tag}${node.attrs}>${node.children.map(serializeMathMl).join('')}</${node.tag}>`
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

function removeAnnotations(node: MathMlElement): void {
  node.children = node.children.filter((child) => !(isElement(child) && child.tag === 'annotation'))
  for (const child of node.children) if (isElement(child)) removeAnnotations(child)
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
export async function convertFormulaToOmml(latex: string): Promise<string> {
  const rendered = katex.renderToString(latex, {
    output: 'mathml',
    displayMode: true,
    throwOnError: true,
  })
  const mathStart = rendered.indexOf('<math')
  const mathEnd = rendered.lastIndexOf('</math>')
  if (mathStart < 0 || mathEnd < mathStart) throw new Error('KaTeX 未输出完整 MathML')

  const math = parseMathMl(rendered.slice(mathStart, mathEnd + '</math>'.length))
  removeAnnotations(math)
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

function visitBlock(block: IRBlock, visitFormula: (id: NodeId, latex: string) => void): void {
  switch (block.kind) {
    case 'formula':
      visitFormula(block.id, block.latex)
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

function visitTermEntry(entry: IRTermEntry, visitFormula: (id: NodeId, latex: string) => void): void {
  for (const block of entry.definition) visitBlock(block, visitFormula)
  for (const note of entry.notes) for (const block of note.content) visitBlock(block, visitFormula)
  for (const example of entry.examples) for (const block of example.content) visitBlock(block, visitFormula)
}

function visitStructuredChild(
  child: IRChapterChild | IRClause,
  visitFormula: (id: NodeId, latex: string) => void,
): void {
  if (child.kind === 'clause') {
    for (const nested of child.children) visitStructuredChild(nested, visitFormula)
  } else if (child.kind === 'termEntry') {
    visitTermEntry(child, visitFormula)
  } else {
    visitBlock(child, visitFormula)
  }
}

function visitChapter(chapter: IRChapter, visitFormula: (id: NodeId, latex: string) => void): void {
  for (const child of chapter.children) visitStructuredChild(child, visitFormula)
}

/**
 * 转换 IR 文档里的全部公式。失败项不写入公式资源表；shared 渲染器随后输出 LaTeX 文本。
 * 导出器应将返回的 warnings 合并到 DocxPackage.warnings。
 */
export async function convertFormulasToOmml(doc: IRDoc): Promise<FormulaOmmlResult> {
  const formulaOmml: Record<NodeId, string> = {}
  const warnings: FormulaConversionWarning[] = []
  const convert = async (id: NodeId, latex: string) => {
    try {
      if (!latex.trim()) throw new Error('公式源代码为空')
      formulaOmml[id] = await convertFormulaToOmml(latex)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      warnings.push({
        code: 'formula-conversion-failed',
        nodeId: id,
        message: `公式 "${id}" 转换为 OMML 失败，导出时将回退为 LaTeX 源码：${detail}`,
      })
    }
  }

  const formulas: { id: NodeId; latex: string }[] = []
  const collect = (id: NodeId, latex: string) => formulas.push({ id, latex })
  for (const block of doc.front.foreword) visitBlock(block, collect)
  for (const block of doc.front.introduction) visitBlock(block, collect)
  for (const chapter of doc.body) visitChapter(chapter, collect)
  for (const appendix of doc.appendices) {
    for (const child of appendix.children) visitStructuredChild(child, collect)
  }
  for (const formula of formulas) await convert(formula.id, formula.latex)

  return { formulaOmml, warnings }
}
