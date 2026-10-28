/**
 * MathML 片段解析与规范化（WP8.2 设计 §4.5）。
 *
 * 契约：输入是一个完整的 MathML 元素字符串（`<mml:math …>` 或默认命名空间的 `<math xmlns=…>`），
 * 输出统一成 `mml:` 前缀的 `XmlElement`；解析器**严格**（良构 XML、纯 TS、不依赖 DOM/Node），内容模型不检查（保真，C-T-19）：
 *
 * - 拒绝：DOCTYPE 与任何 `<!…>` 声明（实体声明在其中）、处理指令（含 XML 声明）、命名实体（如 `&InvisibleTimes;`）、
 *   以 `on` 开头的属性（V-10）、`href`/`src`/`altimg` 的危险协议或含控制字符的取值（V-11）、
 *   不在 MathML 命名空间的元素、除 `xlink:`/`xml:` 之外的命名空间属性、非 `math` 根；
 * - 接受：五个预定义实体与数字字符引用、CDATA（归一为文本）、注释（丢弃）、`mml:` 前缀或默认命名空间两种写法；
 * - 规范化（§4.5-5）：去掉 `annotation`/`annotation-xml` 中 `encoding` 为 TeX 的项（输出绝不含 `tex-math`/TeX 源码），
 *   `semantics` 只剩一个子元素时展开；其他注释原样保留；元素内容里仅由缩进产生的空白（元素间）丢弃，
 *   令牌元素（`mi`、`mn`、`mo`、`mtext`、`ms`）与 `annotation` 的文本逐字保留。
 *
 * 解析失败抛 `MathMlParseError`（带字符偏移与行列）；由 `formulas.ts` 转成 `mathml-invalid`。
 * 根上的 `id` 与 `display` 由调用方（`formulas.ts` 与 `ids.ts` 的 P3）处理，本解析器不赋 `mml_m<k>`。
 */

import { MATHML_NS, XLINK_NS, qname, xmlAttr, xmlElement, xmlText, type XmlAttr, type XmlElement, type XmlNode } from '../../xml46687/tree'

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
/** 根元素的初始命名空间环境：`mml`、`xlink` 预先绑定（没有默认命名空间）。 */
const DEFAULT_SCOPE: ReadonlyMap<string, string> = new Map([['mml', MATHML_NS], ['xlink', XLINK_NS]])

/** 解析失败：`offset` 是出错位置在（行结束符归一化后的）输入中的字符偏移，`line`/`column` 从 1 起。 */
export class MathMlParseError extends Error {
  readonly offset: number
  readonly line: number
  readonly column: number
  /** 不含位置信息的原因。 */
  readonly reason: string
  constructor(reason: string, source: string, offset: number) {
    const before = source.slice(0, offset)
    const line = before.split('\n').length
    const column = offset - (before.lastIndexOf('\n') + 1) + 1
    super(`${reason}（第 ${line} 行第 ${column} 列，字符偏移 ${offset}）`)
    this.name = 'MathMlParseError'
    this.reason = reason
    this.offset = offset
    this.line = line
    this.column = column
  }
}

export interface ParsedMathMl {
  /** `mml:math` 根（前缀统一为 `mml`）。 */
  root: XmlElement
  /** 被去掉的 TeX 注释个数（`annotation`/`annotation-xml`，`encoding` 为 TeX）。 */
  removedAnnotations: number
}

// ---------------------------------------------------------------------------
// 词法常量
// ---------------------------------------------------------------------------

const NAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF'
  + '\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const NAME_CHAR = `${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`
const NCNAME_SOURCE = `[${NAME_START}][${NAME_CHAR}]*`
const QNAME = new RegExp(`^(?:(${NCNAME_SOURCE}):)?(${NCNAME_SOURCE})$`, 'u')
/** XML 1.0 不允许的字符：C0 控制字符（除 TAB/LF/CR）、U+FFFE/U+FFFF、孤立代理项。 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const XML_SPACE = /^[ \t\n\r]*$/
const PREDEFINED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
/** 令牌元素与 annotation：文本逐字保留，不丢弃“仅空白”文本。 */
const TOKEN_ELEMENTS = new Set(['mi', 'mn', 'mo', 'mtext', 'ms', 'annotation'])
const TEX_ENCODINGS = new Set(['application/x-tex', 'tex', 'latex', 'application/x-latex', 'text/x-tex'])
const URL_ATTRIBUTES = new Set(['href', 'src', 'altimg'])
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'ftp'])
/** 嵌套深度上限：真实公式远小于此；后续的树遍历与写出器是递归的，所以必须设限。 */
const MAX_DEPTH = 256

// eslint-disable-next-line no-control-regex
const C0_CONTROL = /[\u0000-\u001f\u007f]/
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/

/** 与 `validate.py` 的 `url_value_problem`（V-11）同口径：控制字符一律拒绝；有协议时须在白名单内，相对地址不限。 */
function urlProblem(value: string): string | undefined {
  const control = C0_CONTROL.exec(value)
  if (control) return `含控制字符 U+${control[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
  const scheme = SCHEME.exec(value.trim())
  if (scheme && !ALLOWED_URL_SCHEMES.has(scheme[1]!.toLowerCase())) return `使用了不允许的协议「${scheme[1]}」（只接受 ${[...ALLOWED_URL_SCHEMES].sort().join('、')}）`
  return undefined
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

interface RawAttribute { name: string; value: string; offset: number }

interface Frame {
  element: XmlElement
  rawName: string
  /** 前缀 → 命名空间 URI（'' 是默认命名空间）。 */
  scope: ReadonlyMap<string, string>
}

function isCodePointLegal(code: number): boolean {
  return code === 0x9 || code === 0xA || code === 0xD || (code >= 0x20 && code <= 0xD7FF)
    || (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF)
}

/**
 * 解码字符引用：只收五个预定义实体与数字引用；命名实体与裸 `&` 拒绝。
 * `base` 是 `text` 在输入中的起始偏移，用于报告位置。
 */
function decodeReferences(source: string, text: string, base: number): string {
  if (!text.includes('&')) return text
  let out = ''
  let cursor = 0
  while (cursor < text.length) {
    const amp = text.indexOf('&', cursor)
    if (amp < 0) { out += text.slice(cursor); break }
    out += text.slice(cursor, amp)
    const semi = text.indexOf(';', amp)
    const entity = semi < 0 ? undefined : text.slice(amp + 1, semi)
    if (entity === undefined || entity === '') throw new MathMlParseError('字符引用没有以分号结束（裸 & 字符须写成 &amp;）', source, base + amp)
    if (entity.startsWith('#')) {
      const hex = /^#x([0-9A-Fa-f]+)$/.exec(entity)
      const dec = /^#([0-9]+)$/.exec(entity)
      const code = hex ? parseInt(hex[1]!, 16) : dec ? parseInt(dec[1]!, 10) : NaN
      if (!Number.isFinite(code) || !isCodePointLegal(code)) throw new MathMlParseError(`数字字符引用 &${entity}; 不是合法的 XML 字符`, source, base + amp)
      out += String.fromCodePoint(code)
    } else if (Object.prototype.hasOwnProperty.call(PREDEFINED, entity)) {
      out += PREDEFINED[entity]
    } else {
      throw new MathMlParseError(`不允许命名实体 &${entity};（只接受 amp、lt、gt、quot、apos 与数字字符引用）`, source, base + amp)
    }
    cursor = semi! + 1
  }
  return out
}

function checkChars(source: string, text: string, base: number): void {
  const bad = ILLEGAL_CHAR.exec(text)
  if (bad) throw new MathMlParseError(`含 XML 不允许的字符 U+${bad[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`, source, base + bad.index)
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

function resolveNamespace(scope: ReadonlyMap<string, string>, prefix: string | undefined): string | undefined {
  if (prefix === 'xml') return XML_NAMESPACE
  return scope.get(prefix ?? '')
}

function parseDocument(rawSource: string): XmlElement {
  // XML 的行结束符归一化（\r\n 与 \r → \n）；数字引用 &#13; 不受影响
  const source = rawSource.replace(/\r\n?/g, '\n')
  let index = source.charCodeAt(0) === 0xFEFF ? 1 : 0
  const stack: Frame[] = []
  let root: XmlElement | undefined

  function fail(reason: string, offset: number): never { throw new MathMlParseError(reason, source, offset) }

  const appendText = (value: string, offset: number): void => {
    if (value === '') return
    const frame = stack[stack.length - 1]
    if (!frame) {
      if (!XML_SPACE.test(value)) fail('元素之外不允许出现文本', offset)
      return
    }
    const last = frame.element.children[frame.element.children.length - 1]
    if (last && last.type === 'text') frame.element.children[frame.element.children.length - 1] = xmlText(last.value + value)
    else frame.element.children.push(xmlText(value))
  }

  while (index < source.length) {
    const lt = source.indexOf('<', index)
    if (lt < 0) {
      const tail = source.slice(index)
      if (stack.length > 0) fail(`元素 <${stack[stack.length - 1]!.rawName}> 没有结束标签`, source.length)
      if (!XML_SPACE.test(tail)) fail('根元素之后不允许出现文本', index)
      index = source.length
      break
    }
    if (lt > index) {
      const raw = source.slice(index, lt)
      if (stack.length > 0) {
        checkChars(source, raw, index)
        const closing = raw.indexOf(']]>')
        if (closing >= 0) fail('文本内容里不允许出现 ]]>', index + closing)
        appendText(decodeReferences(source, raw, index), index)
      } else if (!XML_SPACE.test(raw)) {
        fail(root ? '根元素之后不允许出现文本' : '根元素之前不允许出现文本', index)
      }
    }
    index = lt

    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4)
      if (end < 0) fail('注释没有结束（缺少 -->）', index)
      const body = source.slice(index + 4, end)
      if (body.includes('--') || body.endsWith('-')) fail('注释内容里不允许出现 --', index)
      checkChars(source, body, index + 4)
      index = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', index)) {
      if (stack.length === 0) fail('CDATA 只能出现在元素内', index)
      const end = source.indexOf(']]>', index + 9)
      if (end < 0) fail('CDATA 没有结束（缺少 ]]>）', index)
      const body = source.slice(index + 9, end)
      checkChars(source, body, index + 9)
      appendText(body, index)
      index = end + 3
      continue
    }
    if (source.startsWith('<!', index)) {
      fail(/^<!DOCTYPE/i.test(source.slice(index, index + 9)) ? '不允许 DOCTYPE 声明' : '不允许文档类型或实体声明（<!…>）', index)
    }
    if (source.startsWith('<?', index)) fail('不允许处理指令（含 XML 声明）', index)

    if (source.startsWith('</', index)) {
      const close = source.indexOf('>', index)
      if (close < 0) fail('结束标签没有以 > 结束', index)
      const name = source.slice(index + 2, close).replace(/[ \t\n\r]+$/, '')
      const frame = stack[stack.length - 1]
      if (!frame) fail(`多余的结束标签 </${name}>`, index)
      if (frame!.rawName !== name) fail(`结束标签 </${name}> 与开始标签 <${frame!.rawName}> 不匹配`, index)
      stack.pop()
      index = close + 1
      continue
    }

    // 开始标签
    const tagStart = index
    index += 1
    let nameEnd = index
    while (nameEnd < source.length && !isWhitespace(source[nameEnd]) && source[nameEnd] !== '/' && source[nameEnd] !== '>') nameEnd += 1
    const rawName = source.slice(index, nameEnd)
    if (!QNAME.test(rawName)) fail(`元素名「${rawName}」不是合法的 XML 名称`, index)
    index = nameEnd
    const attributes: RawAttribute[] = []
    let selfClosing = false
    for (;;) {
      const beforeSpace = index
      while (isWhitespace(source[index])) index += 1
      const char = source[index]
      if (char === undefined) fail(`开始标签 <${rawName}> 没有以 > 结束`, tagStart)
      if (char === '>') { index += 1; break }
      if (char === '/') {
        if (source[index + 1] !== '>') fail('空元素标签的 / 之后必须紧跟 >', index)
        selfClosing = true
        index += 2
        break
      }
      if (index === beforeSpace) fail('属性之间必须有空白', index)
      let attrEnd = index
      while (attrEnd < source.length && !isWhitespace(source[attrEnd]) && !'=/>'.includes(source[attrEnd]!)) attrEnd += 1
      const attrName = source.slice(index, attrEnd)
      if (!QNAME.test(attrName)) fail(`属性名「${attrName}」不是合法的 XML 名称`, index)
      const nameOffset = index
      index = attrEnd
      while (isWhitespace(source[index])) index += 1
      if (source[index] !== '=') fail(`属性 ${attrName} 缺少 =`, index)
      index += 1
      while (isWhitespace(source[index])) index += 1
      const quote = source[index]
      if (quote !== '"' && quote !== "'") fail(`属性 ${attrName} 的值必须用引号括起`, index)
      const valueStart = index + 1
      const valueEnd = source.indexOf(quote!, valueStart)
      if (valueEnd < 0) fail(`属性 ${attrName} 的值没有结束引号`, index)
      const rawValue = source.slice(valueStart, valueEnd)
      if (rawValue.includes('<')) fail(`属性 ${attrName} 的值里不允许出现 <`, valueStart + rawValue.indexOf('<'))
      checkChars(source, rawValue, valueStart)
      // 属性值规范化：字面的 TAB/LF/CR 变空格；字符引用解码后不再规范化
      const value = decodeReferences(source, rawValue.replace(/[\t\n\r]/g, ' '), valueStart)
      if (attributes.some((entry) => entry.name === attrName)) fail(`属性 ${attrName} 重复`, nameOffset)
      attributes.push({ name: attrName, value, offset: nameOffset })
      index = valueEnd + 1
    }

    if (stack.length >= MAX_DEPTH) fail(`元素嵌套超过 ${MAX_DEPTH} 层`, tagStart)
    if (stack.length === 0 && root) fail('根元素之后不允许再有元素', tagStart)

    // 命名空间声明（`mml`、`xlink` 前缀预先绑定：片段常取自根上已声明命名空间的文档，本身不带声明）
    const parentScope = stack[stack.length - 1]?.scope ?? DEFAULT_SCOPE
    let scope: ReadonlyMap<string, string> = parentScope
    let owned: Map<string, string> | undefined
    for (const attribute of attributes) {
      const isDefault = attribute.name === 'xmlns'
      const prefixed = attribute.name.startsWith('xmlns:') ? attribute.name.slice(6) : undefined
      if (!isDefault && prefixed === undefined) continue
      if (!owned) { owned = new Map(parentScope); scope = owned }
      const prefix = isDefault ? '' : prefixed!
      if (prefix === 'xmlns') fail('不允许声明 xmlns 前缀', attribute.offset)
      if (prefix === 'xml' && attribute.value !== XML_NAMESPACE) fail('xml 前缀只能绑定到 XML 命名空间', attribute.offset)
      if (attribute.value === XMLNS_NAMESPACE || (prefix !== 'xml' && attribute.value === XML_NAMESPACE)) fail('命名空间 URI 为保留值', attribute.offset)
      if (!isDefault && attribute.value === '') fail(`前缀 ${prefix} 的命名空间不能为空`, attribute.offset)
      owned.set(prefix, attribute.value)
    }

    // 元素名解析：必须在 MathML 命名空间
    const nameMatch = QNAME.exec(rawName)!
    const elementPrefix = nameMatch[1]
    const local = nameMatch[2]!
    const uri = resolveNamespace(scope, elementPrefix)
    if (uri === undefined) fail(elementPrefix ? `元素 <${rawName}> 的命名空间前缀 ${elementPrefix} 没有声明` : `元素 <${rawName}> 没有命名空间（须在 ${MATHML_NS}）`, tagStart)
    if (uri !== MATHML_NS) fail(`元素 <${rawName}> 不在 MathML 命名空间（${uri}）`, tagStart)
    if (stack.length === 0 && local !== 'math') fail(`根元素必须是 math，现为 <${rawName}>`, tagStart)

    // 属性：安全检查并解析命名空间
    const attrs: XmlAttr[] = []
    const seen = new Set<string>()
    for (const attribute of attributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue
      const match = QNAME.exec(attribute.name)!
      const prefix = match[1]
      const attrLocal = match[2]!
      let ns: string | null = null
      if (prefix !== undefined) {
        const attrUri = resolveNamespace(scope, prefix)
        if (attrUri === undefined) fail(`属性 ${attribute.name} 的命名空间前缀 ${prefix} 没有声明`, attribute.offset)
        if (attrUri !== XLINK_NS && attrUri !== XML_NAMESPACE) fail(`属性 ${attribute.name} 在不受支持的命名空间（只接受 xlink 与 xml）`, attribute.offset)
        ns = attrUri!
      }
      const key = `${ns ?? ''}|${attrLocal}`
      if (seen.has(key)) fail(`属性 ${attribute.name} 重复（命名空间展开后同名）`, attribute.offset)
      seen.add(key)
      const lowered = attrLocal.toLowerCase()
      if (lowered.startsWith('on')) fail(`不允许事件属性 ${attribute.name}`, attribute.offset)
      if (URL_ATTRIBUTES.has(lowered)) {
        const problem = urlProblem(attribute.value)
        if (problem) fail(`属性 ${attribute.name} ${problem}`, attribute.offset)
      }
      attrs.push(xmlAttr(ns === null ? attrLocal : qname(ns, attrLocal, ns === XLINK_NS ? 'xlink' : 'xml'), attribute.value))
    }

    const element = xmlElement(qname(MATHML_NS, local, 'mml'), attrs, [])
    const parent = stack[stack.length - 1]
    if (parent) parent.element.children.push(element)
    else root = element
    if (!selfClosing) stack.push({ element, rawName, scope })
  }

  if (stack.length > 0) fail(`元素 <${stack[stack.length - 1]!.rawName}> 没有结束标签`, source.length)
  if (!root) fail('没有找到根元素', 0)
  return root!
}

// ---------------------------------------------------------------------------
// 规范化
// ---------------------------------------------------------------------------

function isMathElement(node: XmlNode, local: string | readonly string[]): node is XmlElement {
  if (node.type !== 'element' || node.name.ns !== MATHML_NS) return false
  return typeof local === 'string' ? node.name.local === local : local.includes(node.name.local)
}

function isTexAnnotation(node: XmlNode): boolean {
  if (!isMathElement(node, ['annotation', 'annotation-xml'])) return false
  const encoding = node.attrs.find((attr) => attr.name.ns === null && attr.name.local === 'encoding')?.value
  return encoding !== undefined && TEX_ENCODINGS.has(encoding.trim().toLowerCase())
}

/** 自底向上：去 TeX 注释 → 展开只剩一个子元素的 `semantics` → 丢弃元素之间的缩进空白。返回去掉的注释个数。 */
function normalize(element: XmlElement): number {
  let removed = 0
  for (const child of element.children) if (child.type === 'element') removed += normalize(child)

  const kept: XmlNode[] = []
  for (const child of element.children) {
    if (isTexAnnotation(child)) { removed += 1; continue }
    kept.push(child)
  }
  const unwrapped: XmlNode[] = []
  for (const child of kept) {
    if (isMathElement(child, 'semantics')) {
      const elements = child.children.filter((entry): entry is XmlElement => entry.type === 'element')
      const hasText = child.children.some((entry) => entry.type === 'text' && !XML_SPACE.test(entry.value))
      if (elements.length === 1 && !hasText) { unwrapped.push(elements[0]!); continue }
    }
    unwrapped.push(child)
  }
  const isToken = element.name.ns === MATHML_NS && TOKEN_ELEMENTS.has(element.name.local)
  element.children = !isToken && unwrapped.some((child) => child.type === 'element')
    ? unwrapped.filter((child) => !(child.type === 'text' && XML_SPACE.test(child.value)))
    : unwrapped
  return removed
}

/** 解析并规范化；同时返回被去掉的 TeX 注释个数（供 `formulas.ts` 报 info `mathml-annotation-removed`）。 */
export function parseMathMlDetailed(source: string): ParsedMathMl {
  const root = parseDocument(source)
  const removedAnnotations = normalize(root)
  return { root, removedAnnotations }
}

/** 解析并规范化一个完整的 MathML 元素字符串；失败抛 `MathMlParseError`。 */
export function parseMathMl(source: string): XmlElement {
  return parseMathMlDetailed(source).root
}
