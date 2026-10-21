/**
 * GB/T 46687.2 XML 的纯数据树（同构，无 DOM、无类实例、无函数，可 JSON.stringify 往返）。
 *
 * 只描述 XML 信息集本身，不含任何 46687 的标签约定：具体元素/属性/命名空间由 WP8.1 的约定表决定。
 * 解析端（client/server 适配层）把 DOM 转成本树，渲染端构造本树后交给 writeXml 写出。
 */

/** XLink 命名空间（xlink:href 等）。 */
export const XLINK_NS = 'http://www.w3.org/1999/xlink'
/** MathML 命名空间。 */
export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

export interface XmlName {
  /** 命名空间 URI；null 表示无命名空间 */
  ns: string | null
  local: string
  /** 仅为写出时的前缀提示，不参与名称相等判断；写出器只在它与命名空间声明一致时才采用 */
  prefix?: string
}

export interface XmlPosition {
  /** 形如 /standard[1]/body[1]/sec[3]，供问题报告定位 */
  path: string
  line?: number
  column?: number
}

export interface XmlAttr {
  name: XmlName
  value: string
}

export interface XmlElement {
  type: 'element'
  name: XmlName
  /** 顺序即写出顺序；确定性由调用方保证 */
  attrs: XmlAttr[]
  children: XmlNode[]
  position?: XmlPosition
}

/** CDATA 由解析端归一为 text。 */
export interface XmlText {
  type: 'text'
  value: string
  position?: XmlPosition
}

export interface XmlComment {
  type: 'comment'
  value: string
  position?: XmlPosition
}

export interface XmlProcessingInstruction {
  type: 'pi'
  target: string
  data: string
  position?: XmlPosition
}

export type XmlNode = XmlElement | XmlText | XmlComment | XmlProcessingInstruction

export interface XmlDoctype {
  name: string
  publicId?: string
  systemId?: string
}

export interface XmlDocument {
  doctype?: XmlDoctype
  root: XmlElement
}

// ---------------------------------------------------------------------------
// 构造辅助（不产生值为 undefined 的字段，保证 JSON 往返严格相等）
// ---------------------------------------------------------------------------

export function qname(ns: string | null, local: string, prefix?: string): XmlName {
  return prefix === undefined ? { ns, local } : { ns, local, prefix }
}

function toName(name: XmlName | string): XmlName {
  return typeof name === 'string' ? { ns: null, local: name } : name
}

/** 字符串名称表示无命名空间的本地名。 */
export function xmlAttr(name: XmlName | string, value: string): XmlAttr {
  return { name: toName(name), value }
}

/** name 为字符串时表示无命名空间的本地名；字符串子节点按文本节点处理。 */
export function xmlElement(
  name: XmlName | string,
  attrs: XmlAttr[] = [],
  children: Array<XmlNode | string> = [],
): XmlElement {
  return {
    type: 'element',
    name: toName(name),
    attrs,
    children: children.map((child): XmlNode => (typeof child === 'string' ? xmlText(child) : child)),
  }
}

export function xmlText(value: string): XmlText {
  return { type: 'text', value }
}

export function xmlComment(value: string): XmlComment {
  return { type: 'comment', value }
}

export function xmlPi(target: string, data: string): XmlProcessingInstruction {
  return { type: 'pi', target, data }
}

// ---------------------------------------------------------------------------
// 只读查询辅助
// ---------------------------------------------------------------------------

export function isXmlElement(node: XmlNode): node is XmlElement {
  return node.type === 'element'
}

/** 按命名空间 URI 与本地名比较，前缀提示不参与。 */
export function xmlNameIs(name: XmlName, ns: string | null, local: string): boolean {
  return name.ns === ns && name.local === local
}

/** 直接子元素中匹配 ns+local 的全部元素（不下钻）。 */
export function findXmlChildren(element: XmlElement, ns: string | null, local: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.type === 'element' && xmlNameIs(child.name, ns, local))
}

export function findXmlChild(element: XmlElement, ns: string | null, local: string): XmlElement | undefined {
  return element.children.find((child): child is XmlElement => child.type === 'element' && xmlNameIs(child.name, ns, local))
}

export function getXmlAttr(element: XmlElement, ns: string | null, local: string): string | undefined {
  return element.attrs.find(attr => xmlNameIs(attr.name, ns, local))?.value
}

/** 后代文本节点按文档顺序拼接（XPath string-value 语义：忽略注释与处理指令）。 */
export function xmlTextContent(node: XmlNode): string {
  switch (node.type) {
    case 'text': return node.value
    case 'element': return node.children.map(xmlTextContent).join('')
    default: return ''
  }
}
