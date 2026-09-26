/**
 * 最小 XML 解析器（docs/wp7-docx-delivery.md §10.2 helpers/xmlTree.ts）。
 *
 * 只解析测试需要的子集：XML 声明、带前缀的元素名/属性名、单双引号属性值、5 个预定义实体、
 * 数字字符引用（十进制/十六进制）、自闭合标签、命名空间前缀作用域。文本节点与元素节点都作为
 * 独立子节点收集。
 *
 * 不支持注释、CDATA、DTD、处理指令（XML 声明除外）——本包的生成器（xml.ts 及其调用方）从不
 * 产出这些结构，解析器遇到就说明生成器出了问题，因此直接抛错，不做兼容。
 *
 * 严格性（都是审查实测确认过的坑）：
 * - 预定义实体表用 Map 查找，不用带原型链的 plain object——否则 `&constructor;` 会解析成
 *   `Object` 构造函数对应的字符串表示，冒充合法实体；
 * - 拒绝 XML 1.0 不允许的字符（U+0000–U+0008、U+000B、U+000C、U+000E–U+001F、U+FFFE、
 *   U+FFFF、孤立代理项），不论字符是直接出现在源文本里，还是由数字字符引用解出来的；
 *   数字字符引用超出 0x10FFFF 时给出解析错误，不让 String.fromCodePoint 抛 RangeError 漏出去；
 * - 元素名、属性名的前缀必须在祖先或自身通过 `xmlns:前缀` 声明过（`xml` 前缀例外，天然合法；
 *   `xmlns`/`xmlns:*` 属性本身不受这条检查约束；不带前缀的属性不检查）——不声明就用，Word 会
 *   拒绝打开。
 *
 * 这是测试代码（属于 shared 测试基建），不从任何 index.ts 导出，但同样不得使用 Node 或浏览器
 * 专有 API：只用字符串扫描，不用 DOMParser / xml2js 等。
 */

export interface XmlElement {
  kind: 'element'
  /** 完整标签名，含前缀（如 "w:pStyle"、"m:mathPr"），原样保留，不拆分前缀 */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}

export interface XmlText {
  kind: 'text'
  text: string
}

export type XmlNode = XmlElement | XmlText

/** 用 Map 而不是 plain object：plain object 的查找会命中 Object.prototype 上的属性
 *（如 `constructor`/`toString`/`hasOwnProperty`），让恶意或偶然撞名的实体名被当作合法实体。 */
const PREDEFINED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['apos', "'"],
  ['quot', '"'],
])

const NAME_START = /[A-Za-z_:]/
const NAME_CHAR = /[A-Za-z0-9_:.-]/
const WHITESPACE = /[ \t\r\n]/

/** XML 1.0 Char 产生式排除的码点：控制字符（保留 TAB/LF/CR）、noncharacter U+FFFE/U+FFFF。
 * 代理项区（U+D800–U+DFFF）单独判断——合法的代理对会被逐码点扫描合并，走不到这个判断；
 * 走到这里说明是孤立代理项。 */
function isForbiddenScalarCodePoint(cp: number): boolean {
  if (cp <= 0x8) return true
  if (cp === 0xb || cp === 0xc) return true
  if (cp >= 0xe && cp <= 0x1f) return true
  if (cp === 0xfffe || cp === 0xffff) return true
  return false
}

function hex4(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

/** 解析整份 XML 文本，返回根元素；不合法时抛错（错误信息带行列位置） */
export function parseXml(source: string): XmlElement {
  return new Parser(source).parseDocument()
}

/**
 * 找 el 的第一个名为 name 的直接子元素（不递归）。通用导航工具，供 checks.ts/outline.ts/
 * numberingSim.ts 等复用，避免各自重复实现（也避免它们之间因各写一份而产生循环依赖）。
 */
export function findChild(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === 'element' && c.name === name)
}

class Parser {
  private i = 0
  private readonly s: string
  /** 命名空间前缀作用域栈：每个已打开的元素一帧，帧内是这个元素自己声明的前缀集合；
   *  查找时从栈顶到栈底找，对应「祖先或自身声明过」。 */
  private readonly nsScopes: Set<string>[] = []

  constructor(s: string) {
    this.s = s
  }

  private get eof(): boolean {
    return this.i >= this.s.length
  }

  private peek(): string {
    return this.s[this.i] ?? ''
  }

  private locate(pos: number): string {
    let line = 1
    let col = 1
    for (let k = 0; k < pos && k < this.s.length; k++) {
      if (this.s[k] === '\n') {
        line += 1
        col = 1
      } else {
        col += 1
      }
    }
    return `第 ${line} 行第 ${col} 列（偏移 ${pos}）`
  }

  private fail(message: string, pos = this.i): never {
    throw new Error(`XML 解析错误：${message}；位置：${this.locate(pos)}`)
  }

  private skipWhitespace(): void {
    while (!this.eof && WHITESPACE.test(this.peek())) this.i += 1
  }

  parseDocument(): XmlElement {
    this.skipXmlDecl()
    this.skipMiscBeforeRoot()
    if (this.eof) this.fail('文档为空，没有根元素')
    if (this.peek() !== '<') this.fail(`期望 "<" 开始根元素，实际是 "${this.peek()}"`)
    const root = this.parseElement()
    this.skipWhitespace()
    if (!this.eof) {
      if (this.peek() === '<' && !this.s.startsWith('<!--', this.i)) {
        this.fail('多个根元素：根元素之后不能再出现元素')
      }
      this.fail('根元素之后还有内容')
    }
    return root
  }

  private skipXmlDecl(): void {
    if (this.s.startsWith('<?xml', this.i)) {
      const end = this.s.indexOf('?>', this.i)
      if (end === -1) this.fail('XML 声明未闭合')
      this.i = end + 2
    }
  }

  private skipMiscBeforeRoot(): void {
    this.skipWhitespace()
    if (this.s.startsWith('<!--', this.i)) this.fail('不支持注释')
    if (this.s.startsWith('<!DOCTYPE', this.i)) this.fail('不支持 DTD')
    if (this.s.startsWith('<![CDATA[', this.i)) this.fail('不支持 CDATA')
    if (this.s.startsWith('<?', this.i)) this.fail('不支持处理指令')
  }

  private parseName(): string {
    if (this.eof || !NAME_START.test(this.peek())) this.fail('期望元素名或属性名')
    const start = this.i
    this.i += 1
    while (!this.eof && NAME_CHAR.test(this.peek())) this.i += 1
    return this.s.slice(start, this.i)
  }

  // ---------------- 命名空间前缀作用域 ----------------

  private prefixOf(qualifiedName: string): string | null {
    const idx = qualifiedName.indexOf(':')
    return idx === -1 ? null : qualifiedName.slice(0, idx)
  }

  private isPrefixDeclared(prefix: string): boolean {
    for (const scope of this.nsScopes) {
      if (scope.has(prefix)) return true
    }
    return false
  }

  private checkPrefixDeclared(qualifiedName: string, pos: number, kind: string): void {
    const prefix = this.prefixOf(qualifiedName)
    if (prefix === null) return
    if (prefix === 'xml') return // 预定义前缀，天然合法，不需要声明
    if (!this.isPrefixDeclared(prefix)) {
      this.fail(`${kind} "${qualifiedName}" 的前缀 "${prefix}" 没有声明（缺少 xmlns:${prefix}，祖先或自身都没有）`, pos)
    }
  }

  // ---------------- 元素与属性 ----------------

  private parseElement(): XmlElement {
    const startPos = this.i
    this.i += 1 // 跳过 '<'
    const name = this.parseName()
    const attrs: Record<string, string> = {}
    const attrPositions = new Map<string, number>()
    for (;;) {
      this.skipWhitespace()
      if (this.eof) this.fail(`元素 "${name}" 未闭合（缺少 ">" 或 "/>"）`, startPos)
      const c = this.peek()
      if (c === '/' || c === '>') break
      const attrNamePos = this.i
      const attrName = this.parseName()
      this.skipWhitespace()
      if (this.peek() !== '=') this.fail(`属性 "${attrName}" 缺少 "="`)
      this.i += 1
      this.skipWhitespace()
      const quote = this.peek()
      if (quote !== '"' && quote !== "'") this.fail(`属性 "${attrName}" 的值必须用单引号或双引号包裹`)
      this.i += 1
      const value = this.parseQuotedValue(quote, attrName)
      if (Object.prototype.hasOwnProperty.call(attrs, attrName)) {
        this.fail(`元素 "${name}" 的属性 "${attrName}" 重复`, attrNamePos)
      }
      attrs[attrName] = value
      attrPositions.set(attrName, attrNamePos)
    }

    // 这个元素自己声明的前缀（xmlns:p="uri"）先入栈，命名空间声明对元素自身的标签名和
    // 同一开始标签内的属性名同样生效（不要求声明写在使用之前）。
    const declaredHere = new Set<string>()
    for (const attrName of Object.keys(attrs)) {
      if (attrName === 'xmlns') continue // 默认命名空间声明，不是「前缀」
      if (attrName.startsWith('xmlns:')) declaredHere.add(attrName.slice('xmlns:'.length))
    }
    this.nsScopes.push(declaredHere)

    this.checkPrefixDeclared(name, startPos, '元素名')
    for (const attrName of Object.keys(attrs)) {
      if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) continue // xmlns 声明本身豁免
      this.checkPrefixDeclared(attrName, attrPositions.get(attrName)!, '属性名')
    }

    if (this.peek() === '/') {
      this.i += 1
      if (this.peek() !== '>') this.fail('自闭合标签缺少 ">"')
      this.i += 1
      this.nsScopes.pop()
      return { kind: 'element', name, attrs, children: [] }
    }
    this.i += 1 // 跳过 '>'
    const children = this.parseContent(name, startPos)
    this.nsScopes.pop()
    return { kind: 'element', name, attrs, children }
  }

  private parseQuotedValue(quote: string, attrName: string): string {
    const start = this.i
    let value = ''
    for (;;) {
      if (this.eof) this.fail(`属性 "${attrName}" 的值未闭合`, start)
      const c = this.peek()
      if (c === quote) break
      if (c === '<') this.fail(`属性 "${attrName}" 的值中出现未转义的 "<"`)
      if (c === '&') {
        value += this.parseEntity()
        continue
      }
      value += this.consumeChar(`属性 "${attrName}" 的值`)
    }
    this.i += 1 // 跳过闭合引号
    return value
  }

  /** 消费当前位置的一个「字符」（正确处理代理对），并拒绝 XML 1.0 不允许的字符 */
  private consumeChar(context: string): string {
    const pos = this.i
    const unit = this.s.charCodeAt(this.i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = this.s.charCodeAt(this.i + 1)
      if (Number.isNaN(low) || low < 0xdc00 || low > 0xdfff) {
        this.fail(`${context}中出现孤立代理项 ${hex4(unit)}`, pos)
      }
      this.i += 2
      return this.s.slice(pos, pos + 2)
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      this.fail(`${context}中出现孤立代理项 ${hex4(unit)}`, pos)
    }
    if (isForbiddenScalarCodePoint(unit)) {
      this.fail(`${context}中出现 XML 不允许的字符 ${hex4(unit)}`, pos)
    }
    this.i += 1
    return this.s[pos]
  }

  private parseEntity(): string {
    const start = this.i
    this.i += 1 // 跳过 '&'
    if (this.peek() === '#') {
      this.i += 1
      let hex = false
      if (this.peek() === 'x' || this.peek() === 'X') {
        hex = true
        this.i += 1
      }
      const digitsStart = this.i
      const digitPattern = hex ? /[0-9a-fA-F]/ : /[0-9]/
      while (!this.eof && digitPattern.test(this.peek())) this.i += 1
      const digits = this.s.slice(digitsStart, this.i)
      if (digits === '' || this.peek() !== ';') this.fail('数字字符引用格式错误', start)
      this.i += 1
      const code = parseInt(digits, hex ? 16 : 10)
      if (code > 0x10ffff) this.fail(`数字字符引用码点超出 Unicode 范围：&#${hex ? 'x' : ''}${digits};`, start)
      if (code >= 0xd800 && code <= 0xdfff) this.fail(`数字字符引用指向代理项码点 ${hex4(code)}，非法`, start)
      if (isForbiddenScalarCodePoint(code)) this.fail(`数字字符引用指向 XML 不允许的字符 ${hex4(code)}`, start)
      return String.fromCodePoint(code)
    }
    const nameStart = this.i
    while (!this.eof && this.peek() !== ';' && this.peek() !== '<') this.i += 1
    if (this.eof || this.peek() !== ';') this.fail('实体引用未闭合（缺少 ";"）', start)
    const entityName = this.s.slice(nameStart, this.i)
    this.i += 1
    const resolved = PREDEFINED_ENTITIES.get(entityName)
    if (resolved === undefined) {
      this.fail(`未知实体 "&${entityName};"（只支持 amp/lt/gt/apos/quot 与数字字符引用）`, start)
    }
    return resolved
  }

  /** 解析元素内容直到匹配的结束标签为止；文本与子元素都作为独立节点收集 */
  private parseContent(openName: string, openPos: number): XmlNode[] {
    const children: XmlNode[] = []
    let text = ''
    const flushText = () => {
      if (text !== '') {
        children.push({ kind: 'text', text })
        text = ''
      }
    }
    for (;;) {
      if (this.eof) this.fail(`元素 "${openName}" 未闭合（缺少 "</${openName}>"）`, openPos)
      const c = this.peek()
      if (c === '<') {
        if (this.s.startsWith('</', this.i)) {
          flushText()
          const closeTagPos = this.i
          this.i += 2
          const closeName = this.parseName()
          this.skipWhitespace()
          if (this.peek() !== '>') this.fail(`结束标签 "</${closeName}>" 缺少 ">"`, closeTagPos)
          this.i += 1
          if (closeName !== openName) {
            this.fail(`标签不配对：期望 "</${openName}>"，实际是 "</${closeName}>"`, closeTagPos)
          }
          return children
        }
        if (this.s.startsWith('<!--', this.i)) this.fail('不支持注释')
        if (this.s.startsWith('<![CDATA[', this.i)) this.fail('不支持 CDATA')
        if (this.s.startsWith('<!DOCTYPE', this.i)) this.fail('不支持 DTD')
        if (this.s.startsWith('<?', this.i)) this.fail('不支持处理指令')
        // 无法识别的 "<x" 会在 parseElement → parseName 里因不是合法名字起始字符而报错，
        // 这就是「文本中出现未转义的 <」的检出点。
        flushText()
        children.push(this.parseElement())
        continue
      }
      if (c === '&') {
        text += this.parseEntity()
        continue
      }
      text += this.consumeChar('文本')
    }
  }
}
