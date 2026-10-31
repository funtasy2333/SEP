import JSZip from 'jszip'

/** 同时限制声明值和真实输出；清单也有独立上限。 */
export const XML46687_PACKAGE_LIMITS = {
  compressedBytes: 64 * 1024 * 1024,
  uncompressedBytes: 128 * 1024 * 1024,
  resourceBytes: 32 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024,
  manifestBytes: 1024 * 1024,
  entries: 1024,
} as const

type ZipErrorCode = 'xml-unsupported' | 'xml-limit' | 'xml-encoding' | 'xml-resource-missing'
export class ZipImportError extends Error {
  readonly code: ZipErrorCode
  readonly path: string
  constructor(code: ZipErrorCode, message: string, path = '/') {
    super(message)
    this.code = code
    this.path = path
  }
}
type Entry = { name: string; compressed: number; uncompressed: number; crc: number; start: number; end: number }
const invalid = (message: string, path = '/'): never => { throw new ZipImportError('xml-unsupported', message, path) }
const limit = (message: string, path = '/'): never => { throw new ZipImportError('xml-limit', message, path) }
const decoder = new TextDecoder('utf-8', { fatal: true })
const maxFor = (name: string) => name === 'standard.xml' ? XML46687_PACKAGE_LIMITS.xmlBytes : name === 'manifest.json' ? XML46687_PACKAGE_LIMITS.manifestBytes : XML46687_PACKAGE_LIMITS.resourceBytes

/** 按原始 ZIP 字节检验中央目录与本地头，避免 JSZip 清理路径后覆盖或隐藏冲突。 */
export function preflightZip(bytes: Uint8Array): Entry[] {
  if (bytes.byteLength > XML46687_PACKAGE_LIMITS.compressedBytes) limit('压缩包超过 64 MiB 上限')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const need = (p: number, n: number) => { if (p < 0 || n < 0 || p > bytes.length - n) invalid('ZIP 结构截断') }
  const u16 = (p: number) => { need(p, 2); return view.getUint16(p, true) }
  const u32 = (p: number) => { need(p, 4); return view.getUint32(p, true) }
  let eocd = -1
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { eocd = p; break }
  }
  if (eocd < 0) invalid('ZIP 目录缺失')
  if (u16(eocd + 4) || u16(eocd + 6) || u16(eocd + 8) !== u16(eocd + 10)) invalid('不支持多卷 ZIP')
  const count = u16(eocd + 10), size = u32(eocd + 12), offset = u32(eocd + 16)
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) invalid('不支持 ZIP64')
  if (count > XML46687_PACKAGE_LIMITS.entries) limit('ZIP 条目数超过上限')
  if (offset + size !== eocd) invalid('ZIP 中央目录位置无效')
  const names = new Set<string>(), entries: Entry[] = []
  let p = offset, total = 0
  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) invalid('ZIP 中央目录无效')
    need(p, 46)
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16)
    const compressed = u32(p + 20), uncompressed = u32(p + 24)
    const nameLength = u16(p + 28), extraLength = u16(p + 30), commentLength = u16(p + 32), disk = u16(p + 34), local = u32(p + 42)
    const next = p + 46 + nameLength + extraLength + commentLength
    need(p, next - p)
    if (next > eocd || disk || compressed === 0xffffffff || uncompressed === 0xffffffff || local === 0xffffffff) invalid('不支持多卷或 ZIP64')
    if ((flags & ~0x080e) !== 0 || (flags & 1) || (method !== 0 && method !== 8) || (method === 0 && (flags & 6))) invalid('ZIP 使用加密或不支持的压缩方法')
    const raw = bytes.subarray(p + 46, p + 46 + nameLength)
    let name: string
    try { name = decoder.decode(raw) } catch { invalid('ZIP 文件名不是 UTF-8') }
    if (!name! || name!.includes('\\') || name!.includes('\0') || name!.startsWith('/') || /^[a-z]:/i.test(name!) || name!.split('/').some(s => !s || s === '.' || s === '..')) invalid('ZIP 路径不安全', name!)
    const folded = name!.toLowerCase()
    if (names.has(folded)) invalid('ZIP 条目名称重复', name!)
    names.add(folded)
    const checkExtra = (start: number, length: number) => {
      const stop = start + length
      let unicodePath = false
      for (let x = start; x < stop;) {
        if (x + 4 > stop) invalid('ZIP 扩展字段无效', name!)
        const id = u16(x), len = u16(x + 2); x += 4
        if (x + len > stop || id === 1) invalid('不支持 ZIP64 或截断的扩展字段', name!)
        if (id === 0x7075) {
          if (unicodePath || len < 5 || bytes[x] !== 1 || u32(x + 1) !== crc32(raw)) invalid('ZIP Unicode 文件名无效', name!)
          unicodePath = true
          let alternative: string
          try { alternative = decoder.decode(bytes.subarray(x + 5, x + len)) } catch { invalid('ZIP Unicode 文件名无效', name!) }
          if (alternative! !== name!) invalid('ZIP 替代文件名不一致', name!)
        }
        x += len
      }
    }
    checkExtra(p + 46 + nameLength, extraLength)
    if (uncompressed > maxFor(name!)) limit('ZIP 条目解压大小超过上限', name!)
    total += uncompressed
    if (total > XML46687_PACKAGE_LIMITS.uncompressedBytes) limit('ZIP 总解压大小超过上限')
    if (u32(local) !== 0x04034b50) invalid('ZIP 本地头无效', name!)
    need(local, 30)
    const localNameLength = u16(local + 26), localExtra = u16(local + 28)
    const start = local + 30 + localNameLength + localExtra, end = start + compressed
    need(local, end - local)
    if (end > offset || u16(local + 4) !== u16(p + 6) || flags !== u16(local + 6) || method !== u16(local + 8) || u16(local + 10) !== u16(p + 12) || u16(local + 12) !== u16(p + 14) || localNameLength !== nameLength) invalid('ZIP 本地头与目录不一致', name!)
    checkExtra(local + 30 + localNameLength, localExtra)
    for (let j = 0; j < nameLength; j++) if (bytes[local + 30 + j] !== raw[j]) invalid('ZIP 本地文件名与目录不一致', name!)
    const localCrc = u32(local + 14), localCompressed = u32(local + 18), localUncompressed = u32(local + 22)
    const agrees = (actual: number, expected: number) => actual === expected || (!!(flags & 8) && actual === 0)
    if (!agrees(localCrc, crc) || !agrees(localCompressed, compressed) || !agrees(localUncompressed, uncompressed)) invalid('ZIP 本地大小与目录不一致', name!)
    let recordEnd = end
    if (flags & 8) {
      if (u32(recordEnd) === 0x08074b50) recordEnd += 4
      if (u32(recordEnd) !== crc || u32(recordEnd + 4) !== compressed || u32(recordEnd + 8) !== uncompressed) invalid('ZIP 数据描述符不一致', name!)
      recordEnd += 12
      if (recordEnd > offset) invalid('ZIP 数据描述符越界', name!)
    }
    entries.push({ name: name!, compressed, uncompressed, crc, start: local, end: recordEnd })
    p = next
  }
  if (p !== eocd) invalid('ZIP 中央目录长度不匹配')
  const ordered = [...entries].sort((a, b) => a.start - b.start)
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.start < ordered[i - 1]!.end) invalid('ZIP 条目互相重叠')
  return entries
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 流式消费，每个 chunk 在保存前检查单项及全包实际字节预算。 */
export async function openBoundedZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const entries = preflightZip(bytes)
  let zip: JSZip
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false }) }
  catch { return invalid('ZIP 无法解析') }
  const files = new Map<string, Uint8Array>()
  let total = 0
  for (const entry of entries) {
    const file = zip.file(entry.name)
    if (!file || file.dir || file.unsafeOriginalName !== entry.name) invalid('ZIP 条目名称不一致', entry.name)
    const chunks: Uint8Array[] = []
    let length = 0, crc = 0xffffffff
    await new Promise<void>((resolve, reject) => {
      // JSZip exposes this streaming API at runtime but omits it from JSZipObject's public types.
      const stream = (file! as unknown as { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array')
      let settled = false
      stream.on('data', (chunk: Uint8Array) => {
        if (settled) return
        if (chunk.byteLength > maxFor(entry.name) - length || chunk.byteLength > XML46687_PACKAGE_LIMITS.uncompressedBytes - total) {
          settled = true; stream.pause(); reject(new ZipImportError('xml-limit', 'ZIP 实际解压大小超过上限', entry.name)); return
        }
        length += chunk.byteLength; total += chunk.byteLength
        for (const b of chunk) crc = crcTable[(crc ^ b) & 255]! ^ (crc >>> 8)
        chunks.push(chunk)
      })
      stream.on('error', () => { if (!settled) { settled = true; reject(new ZipImportError('xml-unsupported', 'ZIP 解压失败', entry.name)) } })
      stream.on('end', () => { if (!settled) { settled = true; resolve() } })
      stream.resume()
    })
    if (length !== entry.uncompressed || (crc ^ 0xffffffff) >>> 0 !== entry.crc) invalid('ZIP 解压长度或 CRC 不匹配', entry.name)
    const result = new Uint8Array(length)
    let at = 0
    for (const chunk of chunks) { result.set(chunk, at); at += chunk.length }
    files.set(entry.name, result)
  }
  return files
}
