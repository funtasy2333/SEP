/**
 * 公式转换的 MathML 层：KaTeX → MathML 与一个小型 MathML 解析/序列化器（平台无关，client 与服务端共用）。
 *
 * 从 `formulaOmml.ts` 提取（WP8.2 设计 §5.2 (a)）：OMML 转换与 XML46687 导出共用这一层，
 * 二者都从 KaTeX 的 MathML 出发，shared 渲染器不依赖 KaTeX 或浏览器。
 */

import katex from 'katex'

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
