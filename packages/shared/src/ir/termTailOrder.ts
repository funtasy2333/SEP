import type { IRBlock, IRTermEntry, IRTermTailOrderItem, IRInline } from './types'

export type TermTailOrderDefault = 'pm' | 'resolver' | 'html'

export type OrderedTermTailItem =
  | { kind: 'definition'; index: number; value: IRBlock }
  | { kind: 'source'; index: 0; value: IRInline[] }
  | { kind: 'note'; index: number; value: IRTermEntry['notes'][number] }
  | { kind: 'example'; index: number; value: IRTermEntry['examples'][number] }
  | { kind: 'nestedEntry'; index: number; value: IRTermEntry }
  | { kind: 'languageSet'; index: number; value: NonNullable<IRTermEntry['languageSets']>[number] }

export interface TermTailOrderResult {
  items: OrderedTermTailItem[]
  /** When present, items use the requested legacy fallback only to continue diagnostics. */
  issue?: string
}

const categories = ['definition', 'source', 'note', 'example', 'nestedEntry', 'languageSet'] as const
type TermTailCategory = typeof categories[number]

function counts(entry: IRTermEntry): Record<TermTailCategory, number> {
  return {
    definition: Math.max(0, entry.definition.length - 1),
    source: entry.source === undefined ? 0 : 1,
    note: entry.notes.length,
    example: entry.examples.length,
    nestedEntry: entry.nestedEntries?.length ?? 0,
    languageSet: entry.languageSets?.length ?? 0,
  }
}

function item(kind: TermTailCategory, index: number): IRTermTailOrderItem {
  if (kind === 'source') return { kind, index: 0 }
  return { kind, index }
}

export function isTermTailOrderApplicable(entry: IRTermEntry): boolean {
  return (entry.nestedEntries?.length ?? 0) > 0 || (entry.languageSets?.length ?? 0) > 0
}

/**
 * Build the established sequence for consumers that receive native IR without
 * explicit authored order. `definition` indices address entry.definition.slice(1).
 */
export function canonicalTermTailOrder(
  entry: IRTermEntry,
  consumer: TermTailOrderDefault,
): IRTermTailOrderItem[] {
  const currentCounts = counts(entry)
  const order: readonly TermTailCategory[] = consumer === 'pm'
    ? ['definition', 'source', 'note', 'example', 'nestedEntry', 'languageSet']
    : consumer === 'html'
      ? ['definition', 'source', 'note', 'example', 'nestedEntry', 'languageSet']
      : ['definition', 'example', 'note', 'source', 'nestedEntry', 'languageSet']
  return order.flatMap(kind => Array.from({ length: currentCounts[kind] }, (_, index) => item(kind, index)))
}

function isTailOrderItem(value: unknown): value is IRTermTailOrderItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 2 || !Object.prototype.hasOwnProperty.call(row, 'kind')
    || !Object.prototype.hasOwnProperty.call(row, 'index')) return false
  if (!categories.includes(row.kind as TermTailCategory) || !Number.isInteger(row.index) || (row.index as number) < 0) return false
  return row.kind !== 'source' || row.index === 0
}

export function sameTermTailOrder(
  left: readonly IRTermTailOrderItem[],
  right: readonly IRTermTailOrderItem[],
): boolean {
  return left.length === right.length && left.every((part, index) =>
    part.kind === right[index]?.kind && part.index === right[index]?.index)
}

function validateOrder(entry: IRTermEntry, order: unknown): { order: IRTermTailOrderItem[] } | { issue: string } {
  if (!isTermTailOrderApplicable(entry)) {
    return { issue: 'tailOrder 仅适用于包含嵌套术语或 TBX 语言集的术语条目' }
  }
  if (!Array.isArray(order)) return { issue: 'tailOrder 必须是尾项顺序数组' }
  const validatedOrder: IRTermTailOrderItem[] = []
  for (let index = 0; index < order.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(order, index)) {
      return { issue: 'tailOrder 项必须严格包含有效的 kind 与非负整数 index' }
    }
    const candidate: unknown = order[index]
    if (!isTailOrderItem(candidate)) return { issue: 'tailOrder 项必须严格包含有效的 kind 与非负整数 index' }
    validatedOrder.push(candidate)
  }

  const expectedCounts = counts(entry)
  const seen = new Set<string>()
  for (const part of validatedOrder) {
    const key = `${part.kind}:${part.index}`
    if (seen.has(key)) return { issue: `tailOrder 重复包含「${key}」` }
    seen.add(key)
    if (part.index >= expectedCounts[part.kind]) return { issue: `tailOrder「${key}」超出当前尾项范围` }
  }
  const expectedLength = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0)
  if (validatedOrder.length !== expectedLength) return { issue: 'tailOrder 未完整覆盖全部主定义后的尾项' }
  for (const kind of categories) {
    for (let index = 0; index < expectedCounts[kind]; index += 1) {
      if (!seen.has(`${kind}:${index}`)) return { issue: `tailOrder 缺少「${kind}:${index}」` }
    }
  }
  return { order: validatedOrder.map(part => ({ ...part })) }
}

function resolveItem(entry: IRTermEntry, part: IRTermTailOrderItem): OrderedTermTailItem {
  switch (part.kind) {
    case 'definition': return { ...part, value: entry.definition[part.index + 1]! }
    case 'source': return { ...part, value: entry.source! }
    case 'note': return { ...part, value: entry.notes[part.index]! }
    case 'example': return { ...part, value: entry.examples[part.index]! }
    case 'nestedEntry': return { ...part, value: entry.nestedEntries![part.index]! }
    case 'languageSet': return { ...part, value: entry.languageSets![part.index]! }
  }
}

/** Resolve explicit order, or retain each consumer's pre-metadata default. */
export function orderedTermTail(
  entry: IRTermEntry,
  fallback: TermTailOrderDefault,
): TermTailOrderResult {
  const defaultOrder = canonicalTermTailOrder(entry, fallback)
  if (entry.tailOrder === undefined) return { items: defaultOrder.map(part => resolveItem(entry, part)) }
  const validation = validateOrder(entry, entry.tailOrder)
  if ('issue' in validation) return { items: defaultOrder.map(part => resolveItem(entry, part)), issue: validation.issue }
  return { items: validation.order.map(part => resolveItem(entry, part)) }
}
