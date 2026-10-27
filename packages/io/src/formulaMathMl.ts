/**
 * 公式转换的 MathML 层：KaTeX → MathML 与一个小型 MathML 解析/序列化器（平台无关，client 与服务端共用）。
 *
 * 从 `formulaOmml.ts` 提取（WP8.2 设计 §5.2 (a)）：OMML 转换与 XML46687 导出共用这一层，
 * 二者都从 KaTeX 的 MathML 出发，shared 渲染器不依赖 KaTeX 或浏览器。
 */

import katex from 'katex'
import type { IRDoc, NodeId, Xml46687Problem } from '@ses/shared'

export interface MathMlText {
  text: string
}

export interface MathMlElement {
  tag: string
  attrs: string
  children: MathMlNode[]
}

export type MathMlNode = MathMlText | MathMlElement

export function isElement(node: MathMlNode): node is MathMlElement {
  return 'tag' in node
}

export function parseMathMl(xml: string): MathMlElement {
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

export function serializeMathMl(node: MathMlNode): string {
  if (!isElement(node)) return node.text
  if (node.tag === '#root') return node.children.map(serializeMathMl).join('')
  return `<${node.tag}${node.attrs}>${node.children.map(serializeMathMl).join('')}</${node.tag}>`
}

export function removeAnnotations(node: MathMlElement): void {
  node.children = node.children.filter((child) => !(isElement(child) && child.tag === 'annotation'))
  for (const child of node.children) if (isElement(child)) removeAnnotations(child)
}

export function latexToMathMl(latex: string, display: boolean): MathMlElement {
  const rendered = katex.renderToString(latex, {
    output: 'mathml',
    displayMode: display,
    throwOnError: true,
  })
  const mathStart = rendered.indexOf('<math')
  const mathEnd = rendered.lastIndexOf('</math>')
  if (mathStart < 0 || mathEnd < mathStart) throw new Error('KaTeX 未输出完整 MathML')
  const math = parseMathMl(rendered.slice(mathStart, mathEnd + '</math>'.length))
  removeAnnotations(math)
  return math
}

export interface ConvertLatexToMathMlOptions {
  /** false 时按行内公式布局（KaTeX displayMode:false）；默认 true，即块级公式 */
  display?: boolean
}

/**
 * 单条 LaTeX → MathML 字符串（XML46687 导出用，设计 §5.2 (a)）。
 *
 * 同步（KaTeX 是同步的）；输出 `<math xmlns="http://www.w3.org/1998/Math/MathML" …>…</math>`，
 * 已去掉 `annotation`（不带 TeX 源码）。失败时抛 `Error`：KaTeX 的 `ParseError` 原样向上，
 * 消息保留 “at position N” 字样；源码为空白同样视为失败，不会产出空公式。
 */
export function convertLatexToMathMl(latex: string, options: ConvertLatexToMathMlOptions = {}): string {
  if (!latex.trim()) throw new Error('公式源代码为空')
  return serializeMathMl(latexToMathMl(latex, options.display ?? true))
}

export interface ConvertFormulasToMathMlResult {
  /** 公式 NodeId → MathML 元素字符串。只含 IR 自身没有 MathML 而由 LaTeX 转出的公式（原生 MathML 由渲染器直接取用 IR 值）。 */
  mathml: Record<NodeId, string>
  problems: Xml46687Problem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** KaTeX 的 ParseError 消息里，出错位置用组合下划线（U+0332）标注，面向用户的消息里去掉它。 */
function describeKatexError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  let detail = raw.replace(/̲/g, '')
  const position = (error as { position?: unknown } | null)?.position
  // 个别 KaTeX 错误（如 “at end of input”）消息里没有 “at position N”，补上 ParseError 自带的位置（与 KaTeX 同样从 1 起算）。
  if (!/at position \d+/.test(detail) && typeof position === 'number' && Number.isInteger(position)) {
    detail += `（位置 ${position + 1}）`
  }
  return detail
}

/**
 * 转换 IR 文档里全部公式为 MathML（设计 §5.2 (a)、§4.5）。
 *
 * - **原生 MathML 优先**：`IRFormula.mathml` / `IRInlineFormula.mathml` 非空白的公式不转换，渲染器直接用 IR 值。
 * - 只转换缺 `mathml` 而有 `latex` 的公式；`latex` 缺失或空白 → error `mathml-empty-source`；
 *   KaTeX 抛错 → error `mathml-conversion-failed`（带公式 NodeId、IR 路径与 KaTeX 的位置）。
 * - 失败不用图片或空公式代替（C-T-19）：失败的公式不进 `mathml`，由渲染器随后报 `mathml-missing`。
 * - 键为公式的 NodeId：块公式 `IRFormula.id`，行内公式 `IRInlineFormula.id`。
 * - 对整篇 IR 做通用深度遍历（不按块种类枚举），列表、图注、单元格、式中、术语、嵌套条等任何深度的公式都不会漏；
 *   `problems` 与 `mathml` 的顺序均为 IR 文档序。IR 路径与 `getOutputSupportProblems` 同写法，块公式指向公式块，行内公式指向所在 run。
 */
export function convertFormulasToMathMl(doc: IRDoc): ConvertFormulasToMathMlResult {
  const mathml: Record<NodeId, string> = Object.create(null) as Record<NodeId, string>
  const problems: Xml46687Problem[] = []
  const seen = new Set<NodeId>()

  const convert = (
    id: NodeId,
    nativeMathml: unknown,
    latex: unknown,
    display: boolean,
    path: string,
  ): void => {
    if (seen.has(id)) return
    seen.add(id)
    if (typeof nativeMathml === 'string' && nativeMathml.trim() !== '') return
    if (typeof latex !== 'string' || latex.trim() === '') {
      problems.push({
        code: 'mathml-empty-source',
        severity: 'error',
        nodeId: id,
        path,
        message: `公式（节点 ${id}）没有 LaTeX 源码，无法转换为 MathML：${path}。请补全公式内容或删除该公式。`,
      })
      return
    }
    try {
      mathml[id] = convertLatexToMathMl(latex, { display })
    } catch (error) {
      problems.push({
        code: 'mathml-conversion-failed',
        severity: 'error',
        nodeId: id,
        path,
        message: `公式（节点 ${id}）无法转换为 MathML：${describeKatexError(error)}（${path}）。请修正公式的 LaTeX 源码。`,
      })
    }
  }

  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`))
      return
    }
    if (!isRecord(value)) return

    if (value.kind === 'formula' && typeof value.id === 'string') {
      convert(value.id, value.mathml, value.latex, true, path)
    }
    const inline = value.formula
    if (typeof value.text === 'string' && isRecord(inline) && typeof inline.id === 'string') {
      convert(inline.id, inline.mathml, inline.latex, false, path)
    }

    for (const [name, child] of Object.entries(value)) visit(child, `${path}.${name}`)
  }

  visit(doc, 'doc')
  return { mathml, problems }
}
