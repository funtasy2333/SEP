/**
 * XmlDocument → XML 文本的确定性写出器（同构纯函数）。
 *
 * 只负责语法层面的正确性：转义、字符合法性、命名空间声明、缩进。不含任何 46687 标签约定，
 * 也不做 DTD/XSD 校验。同样的输入必然产出逐字节相同的输出；遇到无法无损表示的数据一律抛
 * XmlWriteError（带元素路径），绝不静默替换或丢弃。
 */

import type { XmlDoctype, XmlDocument, XmlElement, XmlName, XmlNode } from './tree'

export interface XmlWriteOptions {
  /**
   * 前缀 → 命名空间 URI；前缀 '' 表示默认命名空间。全部在根元素上声明（默认命名空间最先，
   * 其余按前缀字典序），不论是否被使用。元素/属性使用的命名空间必须在这里有前缀。
   * `xml` 前缀由 XML 规范内建，无需也不会被声明。
   */
  namespaces: Record<string, string>
  /**
   * 缩进单位（仅空格/制表符）。缺省为两个空格；null 表示元素内容不插入任何空白。
   * 无论取值，XML 声明、DOCTYPE 与根元素各占一行，输出以换行结尾。
   */
  indent?: string | null
  /**
   * 返回 true 的元素及其全部后代原样串联：不缩进、不丢弃空白文本。
   * 仅对仍处于可缩进上下文的元素调用（先序）。xml:space 不会被自动识别，需由本函数表达。
   */
  preserveSpace?: (element: XmlElement) => boolean
}

export class XmlWriteError extends Error {
  /** 出问题的节点路径，如 /standard[1]/body[1]/sec[3]、/a[1]/b[2]/@id、/a[1]/text()[1] */
  readonly path: string
  constructor(message: string, path: string) {
    super(`${message}（位置：${path}）`)
    this.name = 'XmlWriteError'
    this.path = path
  }
}

/** 内建的 xml: 前缀所绑定的命名空间（XML 规范固定，非 46687 约定）。 */
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
/** xmlns 属性所属的保留命名空间，不允许作为属性命名空间使用。 */
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'
const NAMESPACES_PATH = 'options.namespaces'
const DOCTYPE_PATH = '/!DOCTYPE'

// XML 1.0（第五版）NameStartChar / NameChar；NCName 即不含 ':' 的 Name。
const NAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF'
  + '\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const NAME_CHAR = `${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`
const NCNAME = new RegExp(`^[${NAME_START}][${NAME_CHAR}]*$`, 'u')
const XML_NAME = new RegExp(`^[:${NAME_START}][:${NAME_CHAR}]*$`, 'u')
const PUBID_LITERAL = /^[ \r\na-zA-Z0-9\-'()+,./:=?;!*#@$_%]*$/
const XML_SPACE_ONLY = /^[ \t\r\n]*$/
const INDENT_UNIT = /^[ \t]*$/

interface Context {
  /** 根元素上的全部 xmlns 声明，含前导空格 */
  declarations: string
  hasDefaultNamespace: boolean
  /** 命名空间 URI → 可用前缀（字典序，'' 在最前） */
  prefixesByUri: Map<string, string[]>
  pretty: boolean
  unit: string
  preserveSpace: ((element: XmlElement) => boolean) | undefined
}

interface Entry {
  node: XmlNode
  path: string
}

function fail(message: string, path: string): never {
  throw new XmlWriteError(message, path)
}

function hex(codeUnit: number): string {
  return `U+${codeUnit.toString(16).toUpperCase().padStart(4, '0')}`
}

/** 返回第一个 XML 1.0 不允许的字符（孤立代理项按码元报告）；全部合法时返回 -1。 */
function findIllegalChar(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0x20 && unit <= 0xd7ff) continue
    if (unit === 0x9 || unit === 0xa || unit === 0xd) continue
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { index += 1; continue }
      return unit
    }
    if (unit >= 0xe000 && unit <= 0xfffd) continue
    return unit
  }
  return -1
}

function checkChars(value: string, what: string, path: string): void {
  const illegal = findIllegalChar(value)
  if (illegal >= 0) fail(`${what}含有 XML 1.0 不允许的字符 ${hex(illegal)}`, path)
}

const TEXT_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\r': '&#13;' }
const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\t': '&#9;', '\n': '&#10;', '\r': '&#13;',
}

function escapeText(value: string): string {
  return value.replace(/[&<>\r]/g, char => TEXT_ESCAPES[char]!)
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"\t\n\r]/g, char => ATTR_ESCAPES[char]!)
}

// ---------------------------------------------------------------------------
// 命名空间与名称
// ---------------------------------------------------------------------------

function buildContext(options: XmlWriteOptions): Context {
  const prefixes = Object.keys(options.namespaces).sort()
  const prefixesByUri = new Map<string, string[]>()
  let declarations = ''
  for (const prefix of prefixes) {
    const uri = options.namespaces[prefix]!
    if (typeof uri !== 'string' || uri === '') fail(`前缀 '${prefix}' 的命名空间 URI 不能为空`, NAMESPACES_PATH)
    checkChars(uri, `前缀 '${prefix}' 的命名空间 URI `, NAMESPACES_PATH)
    if (prefix === 'xmlns') fail("不能声明保留前缀 'xmlns'", NAMESPACES_PATH)
    if (uri === XMLNS_NS) fail(`命名空间 ${XMLNS_NS} 为 xmlns 保留，不能绑定前缀`, NAMESPACES_PATH)
    if (prefix === 'xml') {
      if (uri !== XML_NS) fail(`前缀 'xml' 只能绑定 ${XML_NS}`, NAMESPACES_PATH)
    } else {
      if (uri === XML_NS) fail(`命名空间 ${XML_NS} 只能使用前缀 'xml'，不能绑定 '${prefix}'`, NAMESPACES_PATH)
      if (prefix !== '' && !NCNAME.test(prefix)) fail(`命名空间前缀 '${prefix}' 不是合法的 NCName`, NAMESPACES_PATH)
      declarations += prefix === '' ? ` xmlns="${escapeAttr(uri)}"` : ` xmlns:${prefix}="${escapeAttr(uri)}"`
    }
    const list = prefixesByUri.get(uri)
    if (list) list.push(prefix)
    else prefixesByUri.set(uri, [prefix])
  }
  // 内建的 xml 前缀：不出现在声明里，但可用于 xml:lang 等属性。
  if (!prefixesByUri.has(XML_NS)) prefixesByUri.set(XML_NS, ['xml'])

  const indent = options.indent === undefined ? '  ' : options.indent
  if (indent !== null && !INDENT_UNIT.test(indent)) fail('缩进只能由空格或制表符组成', 'options.indent')

  return {
    declarations,
    hasDefaultNamespace: prefixes.includes(''),
    prefixesByUri,
    pretty: indent !== null,
    unit: indent ?? '',
    preserveSpace: options.preserveSpace,
  }
}

/** 为带命名空间的名称选前缀：前缀提示匹配则用之；否则元素优先默认命名空间，其次字典序最小。 */
function prefixFor(context: Context, name: XmlName, forAttribute: boolean): string | undefined {
  if (name.ns === null) return undefined
  const declared = context.prefixesByUri.get(name.ns)
  if (!declared) return undefined
  // 属性无前缀即无命名空间，所以不能借用默认命名空间。
  const usable = forAttribute ? declared.filter(prefix => prefix !== '') : declared
  if (name.prefix !== undefined && usable.includes(name.prefix)) return name.prefix
  return usable[0]
}

/** 仅用于路径显示：能解析就用实际写出的限定名，否则退回本地名，不抛错。 */
function labelOf(context: Context, name: XmlName, forAttribute: boolean): string {
  const prefix = prefixFor(context, name, forAttribute)
  return prefix === undefined || prefix === '' ? name.local : `${prefix}:${name.local}`
}

function qualifiedName(context: Context, name: XmlName, forAttribute: boolean, path: string): string {
  if (!NCNAME.test(name.local)) fail(`名称 '${name.local}' 不是合法的 NCName`, path)
  if (name.ns === null) {
    if (forAttribute) {
      if (name.local === 'xmlns') fail('不能手写 xmlns 属性，命名空间只能通过 options.namespaces 声明', path)
    } else if (context.hasDefaultNamespace) {
      fail('已声明默认命名空间，无命名空间的元素无法表示（需要 xmlns="" 反声明）', path)
    }
    return name.local
  }
  if (name.ns === '') fail('命名空间 URI 不能为空串（无命名空间请使用 null）', path)
  if (name.ns === XMLNS_NS) fail('不能使用 xmlns 保留命名空间的名称', path)
  const prefix = prefixFor(context, name, forAttribute)
  if (prefix === undefined) {
    fail(`命名空间 ${name.ns} 没有在 options.namespaces 中声明可用的前缀`, path)
  }
  return prefix === '' ? name.local : `${prefix}:${name.local}`
}

// ---------------------------------------------------------------------------
// 节点
// ---------------------------------------------------------------------------

function childEntries(context: Context, element: XmlElement, path: string): Entry[] {
  const counts = new Map<string, number>()
  const next = (key: string): number => {
    const count = (counts.get(key) ?? 0) + 1
    counts.set(key, count)
    return count
  }
  return element.children.map((node): Entry => {
    switch (node.type) {
      case 'element':
        return {
          node,
          path: `${path}/${labelOf(context, node.name, false)}[${next(`e${JSON.stringify([node.name.ns, node.name.local])}`)}]`,
        }
      case 'text': return { node, path: `${path}/text()[${next('t')}]` }
      case 'comment': return { node, path: `${path}/comment()[${next('c')}]` }
      case 'pi': return { node, path: `${path}/processing-instruction('${node.target}')[${next(`p${node.target}`)}]` }
      default: return { node, path: `${path}/node()[${next('?')}]` }
    }
  })
}

function writeAttributes(context: Context, element: XmlElement, path: string): string {
  const seen = new Set<string>()
  let out = ''
  for (const attr of element.attrs) {
    const attrPath = `${path}/@${labelOf(context, attr.name, true)}`
    const key = JSON.stringify([attr.name.ns, attr.name.local])
    if (seen.has(key)) fail(`属性 '${attr.name.local}' 在同一元素上重复`, attrPath)
    seen.add(key)
    const name = qualifiedName(context, attr.name, true, attrPath)
    checkChars(attr.value, '属性值', attrPath)
    out += ` ${name}="${escapeAttr(attr.value)}"`
  }
  return out
}

function writeLeaf(entry: Entry): string {
  const { node, path } = entry
  switch (node.type) {
    case 'text':
      checkChars(node.value, '文本', path)
      return escapeText(node.value)
    case 'comment':
      checkChars(node.value, '注释', path)
      if (node.value.includes('--')) fail("注释内容不能含有 '--'", path)
      if (node.value.endsWith('-')) fail("注释内容不能以 '-' 结尾", path)
      return `<!--${node.value}-->`
    case 'pi':
      if (!NCNAME.test(node.target)) fail(`处理指令目标 '${node.target}' 不是合法的 NCName`, path)
      if (node.target.toLowerCase() === 'xml') fail("处理指令目标不能是 'xml'", path)
      checkChars(node.data, '处理指令数据', path)
      if (node.data.includes('?>')) fail("处理指令数据不能含有 '?>'", path)
      if (/^[ \t\r\n]/.test(node.data)) fail('处理指令数据不能以空白开头（读回时会丢失）', path)
      return node.data === '' ? `<?${node.target}?>` : `<?${node.target} ${node.data}?>`
    default:
      return fail(`未知的节点类型 '${String((node as { type?: unknown }).type)}'`, path)
  }
}

/**
 * @param raw 祖先已要求原样串联（混合内容或 preserveSpace）；此时本元素及其后代都不缩进。
 */
function writeElement(context: Context, element: XmlElement, path: string, depth: number, raw: boolean, isRoot: boolean): string {
  const tag = qualifiedName(context, element.name, false, path)
  const open = `<${tag}${isRoot ? context.declarations : ''}${writeAttributes(context, element, path)}`
  const preserved = !raw && context.pretty && context.preserveSpace?.(element) === true

  // 空字符串文本节点不产生任何内容。
  const entries = childEntries(context, element, path).filter(({ node }) => node.type !== 'text' || node.value !== '')
  if (entries.length === 0) return `${open}/>`

  const hasStructure = entries.some(({ node }) => node.type !== 'text')
  const mixed = entries.some(({ node }) => node.type === 'text' && !XML_SPACE_ONLY.test(node.value))
  const verbatim = raw || !context.pretty || preserved || !hasStructure || mixed

  const writeChild = (entry: Entry, childDepth: number, childRaw: boolean): string => entry.node.type === 'element'
    ? writeElement(context, entry.node, entry.path, childDepth, childRaw, false)
    : writeLeaf(entry)

  if (verbatim) {
    // 原样串联：子孙一律按原样处理（text/comment/pi 本就没有缩进）。
    const inner = entries.map(entry => writeChild(entry, depth + 1, true)).join('')
    return `${open}>${inner}</${tag}>`
  }
  // 纯元素内容：仅空白文本是排版空白，丢弃；其余节点各占一行。
  const lines = entries
    .filter(({ node }) => node.type !== 'text')
    .map(entry => `${context.unit.repeat(depth + 1)}${writeChild(entry, depth + 1, false)}`)
  return `${open}>\n${lines.join('\n')}\n${context.unit.repeat(depth)}</${tag}>`
}

function quoteLiteral(value: string, what: string): string {
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  return fail(`${what}同时含有单引号和双引号，无法加引号`, DOCTYPE_PATH)
}

function writeDoctype(doctype: XmlDoctype): string {
  if (!XML_NAME.test(doctype.name)) fail(`DOCTYPE 名称 '${doctype.name}' 不是合法的名称`, DOCTYPE_PATH)
  if (doctype.publicId !== undefined) {
    if (doctype.systemId === undefined) fail('DOCTYPE 有公共标识符时必须同时提供系统标识符', DOCTYPE_PATH)
    if (!PUBID_LITERAL.test(doctype.publicId)) fail('DOCTYPE 公共标识符含有不允许的字符', DOCTYPE_PATH)
    checkChars(doctype.systemId, 'DOCTYPE 系统标识符', DOCTYPE_PATH)
    return `<!DOCTYPE ${doctype.name} PUBLIC ${quoteLiteral(doctype.publicId, '公共标识符')} ${quoteLiteral(doctype.systemId, '系统标识符')}>`
  }
  if (doctype.systemId !== undefined) {
    checkChars(doctype.systemId, 'DOCTYPE 系统标识符', DOCTYPE_PATH)
    return `<!DOCTYPE ${doctype.name} SYSTEM ${quoteLiteral(doctype.systemId, '系统标识符')}>`
  }
  return `<!DOCTYPE ${doctype.name}>`
}

/**
 * 写出 XML 文本。纯函数：不修改入参，同样的输入逐字节产出同样的输出。
 *
 * 缩进规则：含非空白文本的元素是混合内容，其内部原样串联；只含元素/注释/处理指令（和仅空白文本）
 * 的元素是纯元素内容，仅空白文本被丢弃，其余子节点各占一行；只含文本的元素文本原样保留。
 * 子节点的 position 仅供诊断，不影响输出。
 */
export function writeXml(doc: XmlDocument, options: XmlWriteOptions): string {
  const context = buildContext(options)
  const parts = [XML_DECLARATION]
  if (doc.doctype) parts.push(writeDoctype(doc.doctype))
  const rootPath = `/${labelOf(context, doc.root.name, false)}[1]`
  parts.push(writeElement(context, doc.root, rootPath, 0, false, true))
  return `${parts.join('\n')}\n`
}
