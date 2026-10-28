import type { XmlAttr, XmlDocument, XmlElement, XmlName, XmlText } from './tree'

export const XML46687_PARSE_LIMITS = { maxInputBytes: 16 * 1024 * 1024, maxDepth: 128, maxTextBytes: 1024 * 1024, maxNodes: 500000 } as const
export interface Xml46687ParseProblem { code: 'xml-syntax' | 'xml-namespace' | 'xml-forbidden-doctype' | 'xml-forbidden-entity' | 'xml-forbidden-pi' | 'xml-encoding' | 'xml-limit'; severity: 'error'; message: string; xml: { line: number; column: number; path: string } }
export interface Xml46687ParseResult { tree: XmlDocument | null; problems: Xml46687ParseProblem[] }

type Code = Xml46687ParseProblem['code']
type Position = { line: number; column: number; path: string }
type Frame = { el: XmlElement; raw: string; changes: Array<[string, string | undefined]>; counts: Map<string, number>; textBytes: number; textParts: string[] | null; textNode: XmlText | null; textCount: number; commentCount: number }
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'
const nameStart = /[:A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}]/u
const nameChar = /[:A-Z_a-z\-.0-9\u00b7\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0300-\u036f\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u203f-\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}]/u
function validChar(c: number): boolean { return c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff) }
function bytes(s: string): number { let n = 0; for (const c of s) { const x = c.codePointAt(0)!; n += x < 0x80 ? 1 : x < 0x800 ? 2 : x < 0x10000 ? 3 : 4 } return n }

export function parseXml46687(input: string): Xml46687ParseResult {
  let line = 1, column = 1, i = 0, nodeCount = 0
  const stack: Frame[] = []
  const bindings = new Map<string, string>([['xml', XML_NS]])
  let root: XmlElement | null = null
  const path = () => stack.length ? stack[stack.length - 1].el.position!.path : '/'
  const pos = (): Position => ({ line, column, path: path() })
  const fail = (code: Code, message: string, at: Position = pos()): never => { throw { code, severity: 'error', message, xml: at } satisfies Xml46687ParseProblem }
  if (bytes(input) > XML46687_PARSE_LIMITS.maxInputBytes) return { tree: null, problems: [{ code: 'xml-limit', severity: 'error', message: 'XML 输入超过 16 MiB 上限', xml: { line: 1, column: 1, path: '/' } }] }
  // XML 1.0 normalizes source line endings before tokenization; references are decoded later.
  const s = input.replace(/\r\n?/g, '\n')
  const take = (n: number) => { const end = i + n; while (i < end) { if (s[i++] === '\n') { line++; column = 1 } else column++ } }
  const starts = (v: string) => s.startsWith(v, i)
  const ws = () => { const start = i; while (i < s.length && /[ \t\n]/.test(s[i])) take(1); return i > start }
  const addNode = () => { if (nodeCount >= XML46687_PARSE_LIMITS.maxNodes) fail('xml-limit', 'XML 节点数超过上限'); nodeCount++ }
  const readName = (): string => {
    const start = i; let cp = s.codePointAt(i); if (cp === undefined || !nameStart.test(String.fromCodePoint(cp))) fail('xml-syntax', 'XML 名称无效')
    take(cp! > 0xffff ? 2 : 1)
    while ((cp = s.codePointAt(i)) !== undefined && nameChar.test(String.fromCodePoint(cp))) take(cp > 0xffff ? 2 : 1)
    const result = s.slice(start, i); const pieces = result.split(':')
    if (pieces.length > 2 || pieces.some(p => !p || !nameStart.test(String.fromCodePoint(p.codePointAt(0)!)) || p[0] === ':')) fail('xml-syntax', '限定名称无效')
    return result
  }
  const checkChars = (v: string) => { for (const c of v) if (!validChar(c.codePointAt(0)!)) fail('xml-syntax', 'XML 包含非法字符') }
  const decode = (v: string, attr: boolean, budget = Infinity): string => {
    const parts: string[] = []; let from = 0, size = 0
    const push = (part: string) => { size += bytes(part); if (size > budget) fail('xml-limit', '连续文本超过 1 MiB 上限'); parts.push(part) }
    while (from < v.length) {
      const amp = v.indexOf('&', from); const end = amp < 0 ? v.length : amp
      const plain = v.slice(from, end); checkChars(plain); push(attr ? plain.replace(/[\t\n]/g, ' ') : plain)
      if (amp < 0) break
      const semi = v.indexOf(';', amp + 1); if (semi < 0) fail('xml-syntax', '字符引用缺少分号')
      const entity = v.slice(amp + 1, semi); let value!: string
      const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' }
      if (Object.prototype.hasOwnProperty.call(predefined, entity)) value = predefined[entity]
      else if (/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) { const n = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10); if (!validChar(n)) fail('xml-syntax', '字符引用不是合法 XML 字符'); value = String.fromCodePoint(n) }
      else if (entity.startsWith('#')) fail('xml-syntax', '字符引用格式无效')
      else fail('xml-forbidden-entity', '禁止使用非预定义实体')
      push(value); from = semi + 1
    }
    return parts.join('')
  }
  const resolve = (raw: string, attr: boolean): XmlName => {
    const parts = raw.split(':'); if (parts.length === 1) return { ns: attr ? null : bindings.get('') || null, local: raw }
    if (parts[0] === 'xmlns') fail('xml-namespace', '禁止使用 xmlns 前缀作为名称')
    const ns = bindings.get(parts[0]); if (!ns) fail('xml-namespace', '名称使用未绑定前缀')
    return { ns: ns!, local: parts[1], prefix: parts[0] }
  }
  const flushText = (frame: Frame) => { if (frame.textNode && frame.textParts) frame.textNode.value = frame.textParts.join(''); frame.textNode = null; frame.textParts = null }
  const appendText = (value: string, at: Position) => {
    if (!value) return
    const frame = stack[stack.length - 1]; if (!frame) { if (/[^ \t\n]/.test(value)) fail('xml-syntax', '根元素外存在文本', at); return }
    const size = bytes(value); if (frame.textBytes + size > XML46687_PARSE_LIMITS.maxTextBytes) fail('xml-limit', '连续文本超过 1 MiB 上限', at)
    frame.textBytes += size
    if (!frame.textNode) { addNode(); frame.textNode = { type: 'text', value: '', position: { ...at, path: frame.el.position!.path + '/text()[' + (++frame.textCount) + ']' } }; frame.textParts = []; frame.el.children.push(frame.textNode) }
    frame.textParts!.push(value)
  }
  const close = () => { const frame = stack.pop()!; flushText(frame); for (let j = frame.changes.length - 1; j >= 0; j--) { const [key, old] = frame.changes[j]; if (old === undefined) bindings.delete(key); else bindings.set(key, old) } }
  try {
    if (s.charCodeAt(0) === 0xfeff) take(1)
    if (starts('<?xml') && /[ \t\n?]/.test(s[i + 5] || '')) {
      const end = s.indexOf('?>', i); if (end < 0) fail('xml-syntax', 'XML 声明未闭合')
      const declaration = s.slice(i, end + 2)
      if (!/^<\?xml[ \t\n]+version[ \t\n]*=[ \t\n]*(['"])1\.0\1(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(['"])[Uu][Tt][Ff]-8\2)?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(['"])(?:yes|no)\3)?[ \t\n]*\?>$/.test(declaration) || !/^<\?xml[ \t\n]/.test(declaration)) fail('xml-encoding', '仅支持 XML 1.0 和 UTF-8 声明')
      take(end + 2 - i)
    }
    while (i < s.length) {
      const at = pos()
      if (starts('<!--')) {
        const end = s.indexOf('-->', i + 4); if (end < 0) fail('xml-syntax', '注释未闭合')
        const value = s.slice(i + 4, end); if (value.includes('--') || value.endsWith('-')) fail('xml-syntax', '注释包含非法连字符'); checkChars(value)
        if (stack.length) { const f = stack[stack.length - 1]; flushText(f); addNode(); f.el.children.push({ type: 'comment', value, position: { ...at, path: f.el.position!.path + '/comment()[' + (++f.commentCount) + ']' } }) }
        take(end + 3 - i); continue
      }
      if (starts('<![CDATA[')) { if (!stack.length) fail('xml-syntax', 'CDATA 必须在根元素内'); const end = s.indexOf(']]>', i + 9); if (end < 0) fail('xml-syntax', 'CDATA 未闭合'); const value = s.slice(i + 9, end); checkChars(value); appendText(value, at); take(end + 3 - i); continue }
      if (starts('<!DOCTYPE')) fail('xml-forbidden-doctype', '禁止 DOCTYPE')
      if (starts('<!ENTITY')) fail('xml-forbidden-entity', '禁止实体声明')
      if (starts('<?')) fail('xml-forbidden-pi', '禁止处理指令')
      if (starts('</')) { take(2); const name = readName(); ws(); if (!starts('>')) fail('xml-syntax', '结束标签无效'); take(1); if (!stack.length || stack[stack.length - 1].raw !== name) fail('xml-syntax', '结束标签不匹配', at); close(); continue }
      if (starts('<!')) fail('xml-syntax', '不支持的标记声明')
      if (starts('<')) {
        if (!stack.length && root) fail('xml-syntax', '只能有一个根元素', at)
        if (stack.length >= XML46687_PARSE_LIMITS.maxDepth) fail('xml-limit', '元素嵌套深度超过上限', at)
        take(1); const raw = readName(); const rawAttrs: Array<[string, string]> = []; let selfClose = false
        while (true) {
          const hadSpace = ws(); if (starts('/>')) { take(2); selfClose = true; break } if (starts('>')) { take(1); break }
          if (!hadSpace) fail('xml-syntax', '属性之间必须有空白')
          const name = readName(); ws(); if (!starts('=')) fail('xml-syntax', '属性缺少等号'); take(1); ws(); const quote = s[i]; if (quote !== '"' && quote !== "'") fail('xml-syntax', '属性值必须带引号'); take(1); const end = s.indexOf(quote, i); if (end < 0) fail('xml-syntax', '属性值未闭合'); const source = s.slice(i, end); if (source.includes('<')) fail('xml-syntax', '属性值不能包含小于号'); const value = decode(source, true); take(end + 1 - i); rawAttrs.push([name, value])
        }
        const changes: Frame['changes'] = []; const declared = new Set<string>()
        for (const [name, value] of rawAttrs) if (name === 'xmlns' || name.startsWith('xmlns:')) {
          const prefix = name === 'xmlns' ? '' : name.slice(6)
          if (declared.has(prefix)) fail('xml-namespace', '重复命名空间声明', at); declared.add(prefix)
          if (prefix === 'xmlns' || value === XMLNS_NS || (prefix === 'xml') !== (value === XML_NS) || (prefix !== '' && value === '')) fail('xml-namespace', '非法命名空间绑定', at)
          changes.push([prefix, bindings.get(prefix)]); if (value) bindings.set(prefix, value); else bindings.delete(prefix)
        }
        const name = resolve(raw, false); const attrs: XmlAttr[] = []; const seen = new Set<string>()
        for (const [key, value] of rawAttrs) { if (key === 'xmlns' || key.startsWith('xmlns:')) continue; const an = resolve(key, true); const expanded = JSON.stringify([an.ns, an.local]); if (seen.has(expanded)) fail('xml-namespace', '重复的展开属性名', at); seen.add(expanded); attrs.push({ name: an, value }) }
        const parent = stack[stack.length - 1]; let itemPath: string
        if (parent) { flushText(parent); parent.textBytes = 0; const key = JSON.stringify([name.ns, name.local]); const count = (parent.counts.get(key) || 0) + 1; parent.counts.set(key, count); itemPath = parent.el.position!.path + '/' + name.local + '[' + count + ']' } else itemPath = '/' + name.local + '[1]'
        addNode(); const el: XmlElement = { type: 'element', name, attrs, children: [], position: { ...at, path: itemPath } }; if (parent) parent.el.children.push(el); else root = el
        stack.push({ el, raw, changes, counts: new Map(), textBytes: 0, textParts: null, textNode: null, textCount: 0, commentCount: 0 }); if (selfClose) close(); continue
      }
      const end = s.indexOf('<', i); const stop = end < 0 ? s.length : end; const value = s.slice(i, stop); if (value.includes(']]>')) fail('xml-syntax', '普通文本不能包含 CDATA 结束符'); if (!stack.length && value.includes('&')) fail('xml-syntax', '根元素外不能包含引用', at); const budget = stack.length ? XML46687_PARSE_LIMITS.maxTextBytes - stack[stack.length - 1].textBytes : Infinity; appendText(decode(value, false, budget), at); take(stop - i)
    }
    if (stack.length || !root) fail('xml-syntax', 'XML 根元素缺失或未闭合')
    return { tree: { root: root! }, problems: [] }
  } catch (e) { return { tree: null, problems: [e as Xml46687ParseProblem] } }
}
