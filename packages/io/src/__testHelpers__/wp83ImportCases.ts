/** Identical unmodified WP8.2 XML and byte-exact test resources for both host runtimes. */
import { getXmlAttr, parseXml46687, XLINK_NS, type IRDoc, type XmlElement } from '@ses/shared'
import { packageXml46687 } from '../xml46687Package'

export const GOLDEN_NAMES = ['wp82', 'fullRenderer', 'wp8m', 'wp6'] as const
export type GoldenName = typeof GOLDEN_NAMES[number]
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
export const PNG_URL = `data:image/png;base64,${PNG_BASE64}`
export const pngBytes = () => Uint8Array.from(atob(PNG_BASE64), char => char.charCodeAt(0))

/** 给有效 PNG 增加合法 tEXt 元数据，使不同 href 的资源字节可区分。 */
export function pngWithLabel(label: string): Uint8Array {
  const original = pngBytes()
  const type = new TextEncoder().encode('tEXt')
  const content = new TextEncoder().encode(`source\0${label}`)
  const chunk = new Uint8Array(12 + content.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, content.length)
  chunk.set(type, 4)
  chunk.set(content, 8)
  let crc = 0xffffffff
  for (const byte of chunk.subarray(4, 8 + content.length)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  view.setUint32(8 + content.length, (crc ^ 0xffffffff) >>> 0)
  const result = new Uint8Array(original.length + chunk.length)
  result.set(original.subarray(0, -12))
  result.set(chunk, original.length - 12)
  result.set(original.subarray(-12), original.length - 12 + chunk.length)
  return result
}
export const nextIds = () => { let sequence = 0; return () => `n${++sequence}` }

export function makeCase(xml: string) {
  const parsed = parseXml46687(xml)
  if (!parsed.tree) throw new Error(JSON.stringify(parsed.problems))
  const resources = new Map<string, { src: string; mediaType: string }>()
  const xmlIds = new Map<string, string>()
  const references: Array<{ rid: string; type: string; customType?: string }> = []
  let sequence = 0
  const visit = (element: XmlElement, parent?: { local: string; nodeId: string }) => {
    const nodeId = `n${++sequence}`
    const xmlId = getXmlAttr(element, null, 'id')
    if (xmlId) xmlIds.set(xmlId, element.name.local === 'termEntry' && parent?.local === 'term-sec' ? parent.nodeId : nodeId)
    if (element.name.ns === null && ['graphic', 'inline-graphic'].includes(element.name.local)) {
      const href = getXmlAttr(element, XLINK_NS, 'href')
      if (href) resources.set(href, { src: PNG_URL, mediaType: 'image/png' })
    }
    if (element.name.ns === null && element.name.local === 'xref') {
      const rid = getXmlAttr(element, null, 'rid')
      const type = getXmlAttr(element, null, 'ref-type')
      if (rid && type && type !== 'fn' && type !== 'table-fn') references.push({ rid, type, customType: getXmlAttr(element, null, 'custom-type') })
    }
    for (const child of element.children) if (child.type === 'element') visit(child, { local: element.name.local, nodeId })
  }
  visit(parsed.tree.root)
  return { xml, resources, xmlIds, references }
}

/** packageXml46687 是产品出包 API；不同运行时使用字节相同的输入。 */
export async function packageCase(input: ReturnType<typeof makeCase>) {
  const files: Record<string, Uint8Array> = {}
  const entries = [...input.resources.keys()].map((href, index) => {
    const fileName = `${href}.png`
    files[fileName] = pngBytes()
    return { href, key: `asset-${index + 1}`, fileName, mediaType: 'image/png', source: 'src' as const }
  })
  return packageXml46687(input.xml, { version: 1, entries }, files)
}

/** 原样保留所有 ID 和引用，供两端对完整 IR 做深比较。 */
export function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(records)
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  return [object, ...Object.values(object).flatMap(records)]
}

/** 唯一批准的原文差异：表注多段以换行合并，并必须附有 xml-normalized warning。 */
export function expectedGoldenXml(name: GoldenName, xml: string): string {
  if (name !== 'wp8m') return xml
  const original = '<p>单元格内注的第一段。</p>\n              <p>单元格内注的第二段。</p>'
  if (!xml.includes(original)) throw new Error('WP8.M 原版表注与预期不符')
  return xml.replace(original, '<p>单元格内注的第一段。<break/>单元格内注的第二段。</p>')
}

export function evidence(doc: IRDoc) {
  const all = records(doc)
  const ids = all.flatMap(entry => typeof entry.id === 'string' ? [entry.id] : [])
  const targets = all.flatMap(entry => typeof entry.targetId === 'string' ? [entry.targetId] : [])
  const mathml = all.flatMap(entry => typeof entry.mathml === 'string' && entry.mathml ? [entry.mathml] : [])
  return { all, ids, targets, mathml, figures: all.filter(entry => entry.kind === 'figure'), tables: all.filter(entry => entry.kind === 'table'), terms: all.filter(entry => entry.kind === 'termEntry') }
}

/** Align only host-generated PM node IDs by identical tree position; stable input IDs and all references remain checked. */
export function alignHostIds(candidate: unknown, reference: unknown): unknown {
  const forward = new Map<string, string>()
  const reverse = new Map<string, string>()
  const walk = (a: unknown, b: unknown) => {
    if (Array.isArray(a) && Array.isArray(b)) { a.forEach((item, i) => walk(item, b[i])); return }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>
    if (left.type === right.type && left.attrs && right.attrs && typeof left.attrs === 'object' && typeof right.attrs === 'object') {
      const from = (left.attrs as Record<string, unknown>).nodeId
      const to = (right.attrs as Record<string, unknown>).nodeId
      if (typeof from === 'string' && typeof to === 'string' && from !== to) {
        if (/^n\d+(?:\.p\d+)?$/.test(from) || /^n\d+(?:\.p\d+)?$/.test(to)) throw new Error(`输入节点 ID 不一致：${from} / ${to}`)
        if ((forward.has(from) && forward.get(from) !== to) || (reverse.has(to) && reverse.get(to) !== from)) throw new Error('节点 ID 对应不是一对一')
        forward.set(from, to); reverse.set(to, from)
      }
    }
    for (const key of Object.keys(left)) if (key in right) walk(left[key], right[key])
  }
  walk(candidate, reference)
  const idFields = new Set(['id', 'nodeId', 'targetId', 'resourceId'])
  const idArrays = new Set(['resourceRefs', 'targets', 'seeAlso'])
  const replace = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') return idFields.has(key) || idArrays.has(key) ? forward.get(value) ?? value : value
    if (Array.isArray(value)) return value.map(child => replace(child, key))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, replace(child, childKey)]))
  }
  return replace(candidate)
}

/** Compare MathML by namespace, element order, text, and attributes; only root id/display and indentation normalize. */
export function mathShape(element: XmlElement, root = true, inheritedPreserve = false): unknown {
  const space = getXmlAttr(element, 'http://www.w3.org/XML/1998/namespace', 'space')
  const preserve = space === 'preserve' ? true : space === 'default' ? false : inheritedPreserve
  const tokens = ['mi', 'mn', 'mo', 'mtext', 'ms', 'annotation']
  return {
    ns: element.name.ns,
    local: element.name.local,
    attrs: element.attrs.filter(attr => !(root && attr.name.ns === null && ['id', 'display'].includes(attr.name.local)))
      .map(attr => ({ ns: attr.name.ns, local: attr.name.local, value: attr.value })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    children: element.children.flatMap(child => {
      if (child.type === 'element') return [mathShape(child, false, preserve)]
      if (child.type === 'text' && (preserve || tokens.includes(element.name.local) || child.value.trim())) return [child.value]
      return []
    }),
  }
}

export function sourceMathShapes(xml: string): unknown[] {
  const parsed = parseXml46687(xml)
  if (!parsed.tree) throw new Error(JSON.stringify(parsed.problems))
  const result: unknown[] = []
  const walk = (element: XmlElement, inheritedPreserve = false) => {
    const space = getXmlAttr(element, 'http://www.w3.org/XML/1998/namespace', 'space')
    const preserve = space === 'preserve' ? true : space === 'default' ? false : inheritedPreserve
    if (element.name.ns === 'http://www.w3.org/1998/Math/MathML' && element.name.local === 'math') { result.push(mathShape(element, true, inheritedPreserve)); return }
    for (const child of element.children) if (child.type === 'element') walk(child, preserve)
  }
  walk(parsed.tree.root)
  return result
}
export function importedMathShapes(doc: IRDoc): unknown[] {
  return evidence(doc).mathml.map(value => {
    const parsed = parseXml46687(value)
    if (!parsed.tree) throw new Error(JSON.stringify(parsed.problems))
    return mathShape(parsed.tree.root)
  })
}

/** Explicitly assert typed targets where the IR entity has a kind discriminant. */
export function expectedTargetKind(type: string, customType?: string): string | undefined {
  const kinds: Record<string, string> = { fig: 'figure', table: 'table', 'disp-formula': 'formula', bibr: 'bibEntry', app: 'appendix' }
  if (type === 'custom') return customType === 'term-entry' ? 'termEntry' : customType === 'note' || customType === 'example' ? customType : undefined
  return kinds[type]
}

/** 公式注由公式的 notes 集合承载，它的对象本身没有 kind 字段。 */
export function targetEntityKind(doc: IRDoc, id: string): unknown {
  const all = records(doc)
  const entity = all.find(entry => entry.id === id)
  if (entity?.kind !== undefined) return entity.kind
  const inFormulaNotes = all.some(entry => entry.kind === 'formula' && Array.isArray(entry.notes)
    && entry.notes.some(note => note && typeof note === 'object' && (note as Record<string, unknown>).id === id))
  return inFormulaNotes ? 'note' : undefined
}
