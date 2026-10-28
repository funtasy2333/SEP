/**
 * 语义检查用的最小 XML 解析与查询（T2.6，设计 §7.5）。
 *
 * 为什么不复用渲染器自己的检查函数（`xml46687Parts/ids.ts` 的 `checkOutputTree`）也不用渲染器的 `XmlDocument`：
 * 语义检查要**独立**复算——从写出的 XML 文本重新解析，再用与渲染器无关的实现核对 id、rid、必备 id、资源、日期、MathML 编号等，
 * 这样渲染器与写出器的任何一处错误都会在这里暴露。只支持写出器会产生的子集：XML 声明、元素、双引号属性、文本；
 * 实体只有 `&amp; &lt; &gt; &quot;`。遇到注释、CDATA、DOCTYPE 或标签不配对即抛错（它们本来就不该出现）。
 */

export interface XNode {
  /** 带前缀的原名，如 `tbx:termEntry`、`mml:math`。 */
  name: string
  attrs: Record<string, string>
  children: Array<XNode | string>
  parent: XNode | null
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' }
const unescapeXml = (value: string): string => value.replace(/&(?:amp|lt|gt|quot);/g, entity => ENTITIES[entity]!)

const TOKEN = /<\?[\s\S]*?\?>|<!--|<!\[CDATA\[|<!DOCTYPE|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+="[^"]*")*)\s*(\/?)>|([^<]+)/g
const ATTRIBUTE = /([^\s=]+)="([^"]*)"/g

/** 解析 XML 文本，返回根元素。 */
export function parseXml(xml: string): XNode {
  let root: XNode | null = null
  let current: XNode | null = null
  TOKEN.lastIndex = 0
  for (let match = TOKEN.exec(xml); match !== null; match = TOKEN.exec(xml)) {
    const [token, closing, opening, attributes, selfClosing, text] = match
    if (token.startsWith('<?')) continue
    if (token === '<!--' || token === '<![CDATA[' || token === '<!DOCTYPE') throw new Error(`不应出现的 XML 构造：${token}`)
    if (closing !== undefined) {
      if (current === null || current.name !== closing) throw new Error(`标签不配对：</${closing}>（当前 ${current?.name ?? '无'}）`)
      current = current.parent
    } else if (opening !== undefined) {
      const attrs: Record<string, string> = {}
      for (const attribute of (attributes ?? '').matchAll(ATTRIBUTE)) {
        if (Object.prototype.hasOwnProperty.call(attrs, attribute[1]!)) throw new Error(`属性重复：${opening}@${attribute[1]}`)
        attrs[attribute[1]!] = unescapeXml(attribute[2]!)
      }
      const node: XNode = { name: opening, attrs, children: [], parent: current }
      if (current === null) {
        if (root !== null) throw new Error('多个根元素')
        root = node
      } else current.children.push(node)
      if (selfClosing !== '/') current = node
    } else if (text !== undefined) {
      if (current === null) {
        if (text.trim() !== '') throw new Error(`根元素之外有文本：${text.trim().slice(0, 20)}`)
      } else current.children.push(unescapeXml(text))
    }
  }
  if (root === null) throw new Error('没有根元素')
  if (current !== null) throw new Error(`标签未闭合：${current.name}`)
  return root
}

export const isNode = (value: XNode | string): value is XNode => typeof value !== 'string'

/** 先序（文档序）遍历：自身与全部后代元素。 */
export function allElements(root: XNode): XNode[] {
  const result: XNode[] = []
  const visit = (node: XNode): void => {
    result.push(node)
    for (const child of node.children) if (isNode(child)) visit(child)
  }
  visit(root)
  return result
}

export const childElements = (node: XNode): XNode[] => node.children.filter(isNode)

export function textOf(node: XNode): string {
  return node.children.map(child => (isNode(child) ? textOf(child) : child)).join('')
}

export function hasAncestor(node: XNode, name: string): boolean {
  for (let parent = node.parent; parent !== null; parent = parent.parent) if (parent.name === name) return true
  return false
}

/** 直接子元素 `label` 且文本非空（validate.py 的 `_has_text_label` 同义，独立实现）。 */
export function hasTextLabel(node: XNode): boolean {
  return childElements(node).some(child => child.name === 'label' && textOf(child).trim() !== '')
}

/** `YYYY-MM-DD` 且是真实日历日（独立于渲染器的日期检查）。 */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
