/**
 * 最小 XML 解析器（docs/wp7-docx-delivery.md §10.2 helpers/xmlTree.ts）。
 *
 * 只解析测试需要的子集：XML 声明、带前缀的元素名/属性名、单双引号属性值、5 个预定义实体、
 * 数字字符引用（十进制/十六进制）、自闭合标签。文本节点与元素节点都作为独立子节点收集。
 *
 * 不支持注释、CDATA、DTD、处理指令（XML 声明除外）——本包的生成器（xml.ts 及其调用方）从不
 * 产出这些结构，解析器遇到就说明生成器出了问题，因此直接抛错，不做兼容。
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

const PREDEFINED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  quot: '"',
}

const NAME_START = /[A-Za-z_:]/
const NAME_CHAR = /[A-Za-z0-9_:.-]/
const WHITESPACE = /[ \t\r\n]/

/** 解析整份 XML 文本，返回根元素；不合法时抛错（错误信息带行列位置） */
export function parseXml(source: string): XmlElement {
  return new Parser(source).parseDocument()
}

class Parser {
  private i = 0
  private readonly s: string

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

  private parseElement(): XmlElement {
    const startPos = this.i
    this.i += 1 // 跳过 '<'
    const name = this.parseName()
    const attrs: Record<string, string> = {}
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
    }
    if (this.peek() === '/') {
      this.i += 1
      if (this.peek() !== '>') this.fail('自闭合标签缺少 ">"')
      this.i += 1
      return { kind: 'element', name, attrs, children: [] }
    }
    this.i += 1 // 跳过 '>'
    const children = this.parseContent(name, startPos)
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
      value += c
      this.i += 1
    }
    this.i += 1 // 跳过闭合引号
    return value
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
      return String.fromCodePoint(parseInt(digits, hex ? 16 : 10))
    }
    const nameStart = this.i
    while (!this.eof && this.peek() !== ';' && this.peek() !== '<') this.i += 1
    if (this.eof || this.peek() !== ';') this.fail('实体引用未闭合（缺少 ";"）', start)
    const entityName = this.s.slice(nameStart, this.i)
    this.i += 1
    const resolved = PREDEFINED_ENTITIES[entityName]
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
      text += c
      this.i += 1
    }
  }
}
