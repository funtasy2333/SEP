import type { ContentIndex, IndexedTerm, IndexedText } from '../contentIndex'
import { evidence, makeIssue } from '../issues'
import type { ValidationIssue } from '../types'

interface TermHit {
  term: IndexedTerm
  start: number
  end: number
}

interface TrieNode {
  next: Map<string, TrieNode>
  fail?: TrieNode
  output: { term: IndexedTerm; value: string }[]
}

interface CompactText {
  value: string
  from: number[]
  to: number[]
  source: string
}

const termBasis = { kind: 'standard' as const, reference: 'GB/T 1.1—2020 8.7.3.2；项目约定（2026-10-22）', text: '术语在正文中应至少使用两次；本规则采用规范化后的字面识别。' }

function compact(value: string): CompactText {
  let normalized = ''
  const from: number[] = []
  const to: number[] = []
  for (let offset = 0; offset < value.length;) {
    const point = value.codePointAt(offset)!
    const source = String.fromCodePoint(point)
    const end = offset + source.length
    const mapped = source.normalize('NFKC').toLocaleLowerCase('en-US')
    if (!/\s/u.test(mapped)) {
      normalized += mapped
      for (let i = 0; i < mapped.length; i++) {
        from.push(offset)
        to.push(end)
      }
    }
    offset = end
  }
  return { value: normalized, from, to, source: value }
}

function asciiBoundaryOkay(text: CompactText, term: string, start: number, end: number): boolean {
  if (!/[a-z]/i.test(term)) return true
  const sourceFrom = text.from[start]
  const sourceTo = text.to[end - 1]
  if (sourceFrom === undefined || sourceTo === undefined) return false
  if (/^[a-z]/i.test(term) && sourceFrom > 0 && /[a-z0-9_]/i.test(text.source[sourceFrom - 1]!)) return false
  if (/[a-z]$/i.test(term) && sourceTo < text.source.length && /[a-z0-9_]/i.test(text.source[sourceTo]!)) return false
  return true
}

function createTrie(terms: IndexedTerm[]): TrieNode {
  const root: TrieNode = { next: new Map(), output: [] }
  for (const term of terms) {
    const value = compact(term.name).value
    if (!value) continue
    let current = root
    for (const char of value) {
      let child = current.next.get(char)
      if (!child) {
        child = { next: new Map(), output: [] }
        current.next.set(char, child)
      }
      current = child
    }
    current.output.push({ term, value })
  }
  const queue: TrieNode[] = []
  for (const child of root.next.values()) {
    child.fail = root
    queue.push(child)
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = queue[cursor]!
    for (const [char, child] of node.next) {
      let failure = node.fail
      while (failure && failure !== root && !failure.next.has(char)) failure = failure.fail
      child.fail = failure?.next.get(char) ?? root
      child.output.push(...(child.fail.output ?? []))
      queue.push(child)
    }
  }
  return root
}

function findHits(text: IndexedText, root: TrieNode): { hits: TermHit[]; compactText: CompactText } {
  const compactText = compact(text.text)
  const hits: TermHit[] = []
  let state = root
  let offset = 0
  for (const char of compactText.value) {
    while (state !== root && !state.next.has(char)) state = state.fail ?? root
    state = state.next.get(char) ?? root
    offset += char.length
    for (const output of state.output) {
      const start = offset - output.value.length
      const end = offset
      if (!asciiBoundaryOkay(compactText, output.value, start, end)) continue
      hits.push({ term: output.term, start, end })
    }
  }
  const ordered = hits.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start) || left.term.nodeId.localeCompare(right.term.nodeId))
  const longest: TermHit[] = []
  let furthestEarlierEnd = -1
  let position = 0
  while (position < ordered.length) {
    const start = ordered[position]!.start
    let endOfGroup = position + 1
    while (endOfGroup < ordered.length && ordered[endOfGroup]!.start === start) endOfGroup += 1
    const group = ordered.slice(position, endOfGroup)
    const longestLength = group[0]!.end - start
    const sameStartLongest = group.filter(hit => hit.end - start === longestLength)
    if (furthestEarlierEnd < sameStartLongest[0]!.end) longest.push(...sameStartLongest)
    furthestEarlierEnd = Math.max(furthestEarlierEnd, ...group.map(hit => hit.end))
    position = endOfGroup
  }
  return { hits: longest, compactText }
}

export function validateTermUsage(index: ContentIndex): ValidationIssue[] {
  const resolvable = index.terms.filter(term => term.name.trim())
  const trie = createTrie(resolvable)
  const counts = new Map<string, number>(resolvable.map(term => [term.nodeId, 0]))
  const evidenceByTerm = new Map<string, ReturnType<typeof evidence>[]>(resolvable.map(term => [term.nodeId, []]))
  const eligible = index.texts.filter(text => text.area === 'body' && ['paragraph', 'listItem', 'tableCell'].includes(text.role))
  const structuredByNode = new Map<string, typeof index.mentions>()
  for (const mention of index.mentions) {
    if (mention.kind !== 'term' || mention.source !== 'structured' || !mention.nodeId) continue
    const values = structuredByNode.get(mention.nodeId) ?? []
    values.push(mention)
    structuredByNode.set(mention.nodeId, values)
  }

  for (const text of eligible) {
    const { hits, compactText } = findHits(text, trie)
    const structuredTerms = text.nodeId ? structuredByNode.get(text.nodeId) ?? [] : []
    const structuredByTarget = new Map<string, typeof structuredTerms>()
    for (const mention of structuredTerms) {
      const values = structuredByTarget.get(mention.targetId) ?? []
      values.push(mention)
      structuredByTarget.set(mention.targetId, values)
    }
    for (const hit of hits) {
      const from = compactText.from[hit.start]
      const to = compactText.to[hit.end - 1]
      if (from === undefined || to === undefined) continue
      const duplicatedByReference = (structuredByTarget.get(hit.term.nodeId) ?? []).some(mention =>
        mention.from !== undefined && mention.to !== undefined
          && mention.from < to && from < mention.to,
      )
      if (duplicatedByReference) continue
      counts.set(hit.term.nodeId, (counts.get(hit.term.nodeId) ?? 0) + 1)
      evidenceByTerm.get(hit.term.nodeId)?.push(evidence(text.nodeId, text.text.slice(from, to), { from, to, path: text.path, role: text.role }))
    }
    for (const reference of structuredTerms) {
      counts.set(reference.targetId, (counts.get(reference.targetId) ?? 0) + 1)
      const from = reference.from
      const to = reference.to
      const hitText = from !== undefined && to !== undefined && from < to ? text.text.slice(from, to) : index.terms.find(term => term.nodeId === reference.targetId)?.name ?? reference.text
      evidenceByTerm.get(reference.targetId)?.push(evidence(text.nodeId, hitText, { from, to, path: reference.path, role: 'termRef' }))
    }
  }

  const issues: ValidationIssue[] = []
  for (const term of index.terms) {
    const name = term.name.trim()
    if (!name) {
      issues.push(makeIssue({
        ruleId: 'coverage.term-name-unresolved', severity: 'suggestion', category: 'coverage', nodeId: term.nodeId, path: term.path,
        message: '无法确定该术语条目的主术语名，本期未覆盖其使用次数。',
        suggestion: '核对术语条目的主术语字段后重新检查。',
        basis: { kind: 'system', text: '术语计数只处理可读取到主术语名称的条目。' },
        evidence: [evidence(term.nodeId, '')],
      }))
      continue
    }
    const count = counts.get(term.nodeId) ?? 0
    if (count >= 2) continue
    const nameMatches = evidenceByTerm.get(term.nodeId) ?? []
    issues.push(makeIssue({
      ruleId: 'term.minimum-usage', severity: 'warning', category: 'terms', nodeId: term.nodeId, path: term.path,
      message: `术语「${name}」：正文识别到 ${count} 次，要求至少 2 次。`,
      suggestion: '核对该术语是否确需保留，并在正文中按需使用；本结果不判断术语定义是否准确。',
      basis: termBasis,
      evidence: count ? nameMatches : [evidence(term.nodeId, name, { path: `${term.path}.term`, role: 'term-name' })],
      count,
      threshold: 2,
    }))
  }
  return issues
}

