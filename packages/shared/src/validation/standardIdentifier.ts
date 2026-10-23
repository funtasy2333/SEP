export interface ParsedStandardIdentifier {
  recognized: boolean
  valid: boolean
  identifier?: string
  family?: string
  title?: string
  dated?: boolean
}

const FAMILY_SOURCE = '(?:ISO\\s*\\/\\s*IEC|GB\\s*\\/\\s*T|GB\\s*\\/\\s*Z|YY\\s*\\/\\s*T|WS\\s*\\/\\s*T|DB\\s*\\d{2}\\s*\\/\\s*T|JB\\s*\\/\\s*T|QC\\s*\\/\\s*T|DL\\s*\\/\\s*T|NY\\s*\\/\\s*T|SN\\s*\\/\\s*T|GA\\s*\\/\\s*T|CJJ\\s*\\/\\s*T|T\\s*\\/\\s*[A-Z0-9\\u3400-\\u9fff.-]+|ISO|IEC|GB|JGJ)'
const NORMALIZED_FAMILY = new RegExp(`^${FAMILY_SOURCE}(?=\\s|$)`, 'i')
const IDENTIFIER = new RegExp(`^(${FAMILY_SOURCE})\\s+(\\d+(?:\\.\\d+)*(?:-(?!\\d{4}(?:\\b|$))\\d+)?)(?:(?:\\s*[:：]\\s*|\\s*[-—–]\\s*)(\\d{4}))?(?:\\s+|$)(.*)$`, 'i')

export function normalizeStandardText(value: string): string {
  return value.normalize('NFKC').replace(/\u00a0/g, ' ').replace(/[‐‑‒–−]/g, '—')
}

/** Parse only identifier syntax supported locally; no publication database lookup is performed. */
export function parseStandardIdentifier(value: string): ParsedStandardIdentifier {
  const normalized = normalizeStandardText(value).trim()
  const family = NORMALIZED_FAMILY.exec(normalized)?.[0]
  if (!family) return { recognized: false, valid: false }
  const match = IDENTIFIER.exec(normalized)
  if (!match) return { recognized: true, valid: false, family: family.replace(/\s+/g, '').toUpperCase() }
  const canonicalFamily = match[1]!.replace(/\s+/g, '').toUpperCase().replace('GB/T', 'GB/T')
  const number = match[2]!.replace(/\s+/g, '')
  const year = match[3]
  const separator = match[0].match(/([:：]|[-—–])\s*\d{4}/)?.[1]
  const dated = Boolean(year)
  const date = year ? `${separator === ':' || separator === '：' ? ':' : '—'}${year}` : ''
  const title = match[4]?.trim().replace(/^[，,：:。\s]+/, '') ?? ''
  return {
    recognized: true,
    valid: true,
    family: canonicalFamily,
    identifier: `${canonicalFamily} ${number}${date}`,
    title,
    dated,
  }
}

