import type {
  IRAppendix, IRBlock, IRChapter, IRClauseChild, IRDoc, IRInline, IRMark, IRTermEntry, ResolveResult,
} from '../ir/types'
import { STANDARD_IDENTIFIER_FAMILY_SOURCE } from './standardIdentifier'

export type ContentArea = 'body' | 'terms' | 'normativeReferences' | 'appendix' | 'frontMatter' | 'bibliography' | 'index' | 'note' | 'example' | 'footnote' | 'tableFootnote'
export type TextRole = 'paragraph' | 'listItem' | 'tableCell' | 'caption' | 'title' | 'termName' | 'termDefinition' | 'termSource' | 'note' | 'example' | 'footnote' | 'tableFootnote' | 'formula' | 'code' | 'bibliography' | 'index' | 'other'
export type ReferenceKind = 'crossRef' | 'termRef' | 'bibRef'

export interface IndexedText {
  nodeId: string | null
  path: string
  area: ContentArea
  role: TextRole
  text: string
  chapterId?: string
  appendixId?: string
  containerId?: string
  objectAncestors?: string[]
}

export interface IndexedReference {
  nodeId: string | null
  targetId: string
  kind: ReferenceKind
  path: string
  area: ContentArea
  role: TextRole
  text: string
  from: number
  to: number
  chapterId?: string
  appendixId?: string
  containerId?: string
  objectAncestors?: string[]
}

export interface IndexedTerm {
  nodeId: string
  path: string
  name: string
}

export interface IndexedObject {
  nodeId: string
  path: string
  kind: 'chapter' | 'clause' | 'appendix' | 'term' | 'figure' | 'table' | 'formula'
  label?: string
  area: ContentArea
  chapterId?: string
  appendixId?: string
  containerId?: string
  objectAncestors?: string[]
}

export interface IndexedMention {
  nodeId: string | null
  targetId: string
  kind: IndexedObject['kind']
  source: 'literal' | 'structured'
  path: string
  area: ContentArea
  text: string
  from?: number
  to?: number
  chapterId?: string
  appendixId?: string
  /** A table cell or other block container that owns the source text. */
  containerId?: string
  objectAncestors?: string[]
}

export interface IndexedSequenceItem {
  kind: string
  nodeId: string | null
  path: string
  area: ContentArea
  chapterId?: string
  appendixId?: string
  containerId?: string
  objectAncestors?: string[]
  text?: IndexedText
  objectKind?: 'figure' | 'table'
}

export interface ContentIndex {
  resolution: ResolveResult
  texts: IndexedText[]
  references: IndexedReference[]
  mentions: IndexedMention[]
  terms: IndexedTerm[]
  objects: IndexedObject[]
  sequences: Map<string, IndexedSequenceItem[]>
  nodeAreas: Map<string, ContentArea[]>
  labels: Map<string, IndexedObject[]>
  mentionsByTarget: Map<string, IndexedMention[]>
}

function inlineText(inlines: IRInline[], maskCode = false): string {
  return inlines.map(run => run.footnote ? ''
    : maskCode && run.formula ? '\uFFFC'
      : maskCode && run.marks?.some(mark => mark.type === 'code') ? '\uFFFC'.repeat(run.text.length)
      : run.text).join('')
}

function addText(index: ContentIndex, value: IndexedText): IndexedText {
  index.texts.push(value)
  if (value.nodeId !== null) {
    const areas = index.nodeAreas.get(value.nodeId) ?? []
    areas.push(value.area)
    index.nodeAreas.set(value.nodeId, areas)
  }
  return value
}

function markReference(mark: IRMark): { targetId: string; kind: ReferenceKind } | undefined {
  if (mark.type === 'crossRef' || mark.type === 'termRef' || mark.type === 'bibRef') return { targetId: mark.targetId, kind: mark.type }
  return undefined
}

function addInlines(
  index: ContentIndex,
  inlines: IRInline[],
  context: Omit<IndexedText, 'text'>,
  includeReference = true,
): IndexedText {
  const text = inlineText(inlines, true)
  const value = addText(index, { ...context, text })
  if (includeReference) {
    let offset = 0
    for (const run of inlines) {
      const isCode = run.marks?.some(mark => mark.type === 'code') === true
      const isFormula = Boolean(run.formula)
      const shown = run.footnote ? '' : isFormula ? '\uFFFC' : isCode ? '\uFFFC'.repeat(run.text.length) : run.text
      const from = offset
      const to = from + shown.length
      if (!run.footnote && !isCode && !isFormula) {
        for (const mark of run.marks ?? []) {
          const ref = markReference(mark)
          if (ref) index.references.push({ ...ref, nodeId: context.nodeId, path: context.path, area: context.area, role: context.role, text: shown, from, to, chapterId: context.chapterId, appendixId: context.appendixId, containerId: context.containerId, objectAncestors: context.objectAncestors })
        }
      }
      if (run.footnote) addInlines(index, run.footnote.content, { ...context, nodeId: run.footnote.id, path: `${context.path}.footnote`, area: 'footnote', role: 'footnote' })
      offset = to
    }
  }
  return value
}

function addObject(index: ContentIndex, value: IndexedObject): void {
  index.objects.push(value)
  if (value.label) {
    const key = value.label.normalize('NFKC').replace(/[\s\u3000]/g, '').toLocaleUpperCase('en-US')
    const objects = index.labels.get(key) ?? []
    objects.push(value)
    index.labels.set(key, objects)
  }
  const areas = index.nodeAreas.get(value.nodeId) ?? []
  areas.push(value.area)
  index.nodeAreas.set(value.nodeId, areas)
}

function areaForChapter(chapter: IRChapter): ContentArea {
  if (chapter.secType === 'terms') return 'terms'
  if (chapter.secType === 'norm-refs') return 'normativeReferences'
  return 'body'
}

function addSequenceItem(index: ContentIndex, key: string, item: IndexedSequenceItem): void {
  const sequence = index.sequences.get(key) ?? []
  sequence.push(item)
  index.sequences.set(key, sequence)
}

function visitFootnote(index: ContentIndex, note: { id: string; content: IRInline[] }, path: string, context: Pick<IndexedText, 'chapterId' | 'appendixId' | 'containerId' | 'objectAncestors'>, tableFootnote = false): void {
  const area: ContentArea = tableFootnote ? 'tableFootnote' : 'footnote'
  addInlines(index, note.content, { nodeId: note.id, path, area, role: tableFootnote ? 'tableFootnote' : 'footnote', ...context })
}

function visitTerm(
  index: ContentIndex,
  entry: IRTermEntry,
  path: string,
  context: Pick<IndexedText, 'chapterId' | 'appendixId' | 'containerId' | 'objectAncestors'>,
): void {
  const name = inlineText(entry.term).normalize('NFKC').trim()
  addObject(index, { nodeId: entry.id, path, kind: 'term', label: undefined, area: 'terms', ...context })
  if (name) index.terms.push({ nodeId: entry.id, path, name })
  else index.terms.push({ nodeId: entry.id, path, name: '' })
  addInlines(index, entry.term, { nodeId: entry.id, path: `${path}.term`, area: 'terms', role: 'termName', ...context })
  if (entry.termEn) addInlines(index, entry.termEn, { nodeId: entry.id, path: `${path}.termEn`, area: 'terms', role: 'termName', ...context })
  entry.definition.forEach((block, i) => visitBlock(index, block, `${path}.definition[${i}]`, 'terms', 'termDefinition', context))
  if (entry.source) addInlines(index, entry.source, { nodeId: entry.id, path: `${path}.source`, area: 'terms', role: 'termSource', ...context })
  entry.notes.forEach((note, i) => visitBlock(index, note, `${path}.notes[${i}]`, 'note', 'note', context))
  entry.examples.forEach((example, i) => visitBlock(index, example, `${path}.examples[${i}]`, 'example', 'example', context))
  entry.nestedEntries?.forEach((nested, i) => visitTerm(index, nested, `${path}.nestedEntries[${i}]`, context))
  entry.languageSets?.forEach((set, i) => set.groups.forEach((group, j) => group.terms.forEach((variant, k) => {
    addInlines(index, variant.content, { nodeId: variant.id, path: `${path}.languageSets[${i}].groups[${j}].terms[${k}]`, area: 'terms', role: 'termName', ...context })
    variant.descriptors.forEach((descriptor, n) => addInlines(index, descriptor.value, { nodeId: descriptor.id, path: `${path}.languageSets[${i}].groups[${j}].terms[${k}].descriptors[${n}]`, area: 'terms', role: 'termDefinition', ...context }))
  })))
}

function visitBlock(
  index: ContentIndex,
  block: IRBlock,
  path: string,
  area: ContentArea,
  nestedRole: TextRole | undefined,
  context: Pick<IndexedText, 'chapterId' | 'appendixId' | 'containerId' | 'objectAncestors'>,
): void {
  switch (block.kind) {
    case 'paragraph':
      addInlines(index, block.content, { nodeId: block.id, path, area, role: nestedRole ?? (area === 'terms' ? 'termDefinition' : area === 'note' ? 'note' : area === 'example' ? 'example' : area === 'footnote' ? 'footnote' : area === 'tableFootnote' ? 'tableFootnote' : 'paragraph'), ...context })
      break
    case 'list':
      block.items.forEach((item, i) => {
        const childPath = `${path}.items[${i}].content`
        visitChildren(index, item.content, childPath, childPath, area, { ...context, containerId: item.id }, index.resolution, nestedRole ?? 'listItem')
      })
      break
    case 'table':
      addInlines(index, block.caption, { nodeId: block.id, path: `${path}.caption`, area, role: 'caption', ...context }, false)
      if (block.captionEn) addInlines(index, block.captionEn, { nodeId: block.id, path: `${path}.captionEn`, area, role: 'caption', ...context }, false)
      block.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
        const childPath = `${path}.rows[${r}].cells[${c}].content`
        visitChildren(index, cell.content, childPath, childPath, area, { ...context, containerId: block.id, objectAncestors: [...(context.objectAncestors ?? []), block.id] }, index.resolution, 'tableCell')
      }))
      block.notes.forEach((note, i) => visitBlock(index, note, `${path}.notes[${i}]`, 'note', 'note', { ...context, containerId: block.id }))
      block.footnotes?.forEach((note, i) => visitFootnote(index, note, `${path}.footnotes[${i}]`, { ...context, containerId: block.id }, true))
      break
    case 'figure':
      addInlines(index, block.caption, { nodeId: block.id, path: `${path}.caption`, area, role: 'caption', ...context }, false)
      if (block.captionEn) addInlines(index, block.captionEn, { nodeId: block.id, path: `${path}.captionEn`, area, role: 'caption', ...context }, false)
      block.descriptions?.forEach((description, i) => addInlines(index, description.content, { nodeId: description.id, path: `${path}.descriptions[${i}]`, area, role: 'caption', ...context }, false))
      block.notes.forEach((note, i) => visitBlock(index, note, `${path}.notes[${i}]`, 'note', 'note', { ...context, containerId: block.id }))
      break
    case 'formula':
      if (block.sourceInlines) addInlines(index, block.sourceInlines, { nodeId: block.id, path: `${path}.sourceInlines`, area, role: 'formula', ...context }, false)
      block.whereList.forEach((item, i) => {
        addInlines(index, item.term, { nodeId: item.id, path: `${path}.whereList[${i}].term`, area, role: 'formula', ...context }, false)
        addInlines(index, item.definition, { nodeId: item.id, path: `${path}.whereList[${i}].definition`, area, role: 'formula', ...context }, false)
      })
      block.notes?.forEach((note, i) => addInlines(index, note.content, { nodeId: note.id, path: `${path}.notes[${i}]`, area: 'note', role: 'note', ...context }))
      break
    case 'note':
      block.content.forEach((child, i) => visitBlock(index, child, `${path}.content[${i}]`, 'note', 'note', context))
      break
    case 'example':
      block.content.forEach((child, i) => visitBlock(index, child, `${path}.content[${i}]`, 'example', 'example', context))
      break
    case 'warning':
    case 'quote':
      visitChildren(index, block.content, `${path}.content`, `${path}.content`, area, { ...context, containerId: block.id }, index.resolution, nestedRole)
      break
    case 'code':
      addText(index, { nodeId: block.id, path, area, role: 'code', text: block.text, ...context })
      break
  }
}

function visitChildren(
  index: ContentIndex,
  children: IRClauseChild[],
  key: string,
  path: string,
  area: ContentArea,
  context: Pick<IndexedText, 'chapterId' | 'appendixId' | 'containerId' | 'objectAncestors'>,
  result: ResolveResult,
  nestedRole?: TextRole,
): void {
  children.forEach((child, i) => {
    const childPath = `${path}[${i}]`
    if (child.kind === 'clause') {
      const label = result.labels[child.id]?.label
      addObject(index, { nodeId: child.id, path: childPath, kind: 'clause', label, area, ...context })
      addSequenceItem(index, key, { kind: 'clause', nodeId: child.id, path: childPath, area, ...context })
      addInlines(index, child.title, { nodeId: child.id, path: `${childPath}.title`, area, role: 'title', ...context }, false)
      visitChildren(index, child.children, `${childPath}.children`, `${childPath}.children`, area, { ...context, containerId: child.id }, result)
    } else if (child.kind === 'termEntry') {
      addSequenceItem(index, key, { kind: 'termEntry', nodeId: child.id, path: childPath, area, ...context })
      visitTerm(index, child, childPath, context)
    } else {
      const item: IndexedSequenceItem = { kind: child.kind, nodeId: child.id, path: childPath, area, ...context, objectKind: child.kind === 'figure' || child.kind === 'table' ? child.kind : undefined }
      if (child.kind === 'paragraph') {
        const text = addInlines(index, child.content, { nodeId: child.id, path: childPath, area, role: nestedRole ?? (area === 'terms' ? 'termDefinition' : 'paragraph'), ...context })
        item.text = text
      }
      addSequenceItem(index, key, item)
      if (child.kind === 'figure' || child.kind === 'table') {
        const kind = child.kind
        addObject(index, { nodeId: child.id, path: childPath, kind, label: result.labels[child.id]?.label, area, ...context })
      }
      if (child.kind === 'formula') addObject(index, { nodeId: child.id, path: childPath, kind: 'formula', label: result.labels[child.id]?.label, area, ...context })
      if (child.kind !== 'paragraph') visitBlock(index, child, childPath, area, nestedRole, context)
    }
  })
}

function compactWithOffsets(text: string): { compact: string; from: number[]; to: number[] } {
  let compact = ''
  const from: number[] = []
  const to: number[] = []
  for (let offset = 0; offset < text.length;) {
    const point = text.codePointAt(offset)!
    const source = String.fromCodePoint(point)
    const next = offset + source.length
    const normalized = source.normalize('NFKC')
    if (!/\s/u.test(normalized)) {
      compact += normalized
      for (let i = 0; i < normalized.length; i++) {
        from.push(offset)
        to.push(next)
      }
    }
    offset = next
  }
  return { compact: compact.toLocaleUpperCase('en-US'), from, to }
}

function isExternalFileMention(text: string, from: number, to: number): boolean {
  const before = text.slice(0, from)
  const sentenceStart = Math.max(...['。', '！', '？', '；', ';', '\n'].map(separator => before.lastIndexOf(separator))) + 1
  const prefix = before.slice(sentenceStart).normalize('NFKC').replace(/[\s\u3000]/g, '')
  const external = new RegExp(`${STANDARD_IDENTIFIER_FAMILY_SOURCE}[A-Z0-9./:—–-]+.*?(?:中的|中|的)`, 'ig')
  const matches = [...prefix.matchAll(external)]
  const lastExternal = matches[matches.length - 1]
  const localAt = Math.max(prefix.lastIndexOf('本文件'), prefix.lastIndexOf('本标准'), prefix.lastIndexOf('本文档'))
  if (lastExternal && localAt < (lastExternal.index ?? 0)) return true
  if (localAt >= 0) return false
  const suffix = text.slice(to).normalize('NFKC')
  return new RegExp(`^\\s*\\([^()。！？]{0,160}${STANDARD_IDENTIFIER_FAMILY_SOURCE}\\s*\\d[^()。！？]*\\)`, 'i').test(suffix)
}

function addLiteralMentions(index: ContentIndex): IndexedMention[] {
  const result: IndexedMention[] = []
  const objectLabels = index.labels
  const prose = index.texts.filter(item =>
    (item.area === 'body' || item.area === 'terms' || item.area === 'normativeReferences' || item.area === 'appendix')
      && ['paragraph', 'listItem', 'tableCell'].includes(item.role),
  )
  const recordTarget = (entry: IndexedText, mapped: ReturnType<typeof compactWithOffsets>, key: string, wholeFrom: number, wholeTo: number, expectedKind?: IndexedObject['kind']) => {
    const from = mapped.from[wholeFrom]
    const to = mapped.to[wholeTo - 1]
    if (from === undefined || to === undefined || isExternalFileMention(entry.text, from, to)) return
    const targets = objectLabels.get(key.normalize('NFKC').replace(/[\s\u3000]/g, '').toLocaleUpperCase('en-US')) ?? []
    if (targets.length !== 1) return
    const target = targets[0]!
    if (expectedKind && target.kind !== expectedKind) return
    result.push({
      nodeId: entry.nodeId,
      targetId: target.nodeId,
      kind: target.kind,
      source: 'literal',
      path: entry.path,
      area: entry.area,
      text: entry.text.slice(from, to),
      from,
      to,
      chapterId: entry.chapterId,
      appendixId: entry.appendixId,
      containerId: entry.containerId,
      objectAncestors: entry.objectAncestors,
    })
  }
  const numberSource = '(?:[A-Z]{1,2}\\.)?\\d+(?:\\.\\d+)*'
  const literalPatterns: { regex: RegExp; kind: IndexedObject['kind']; keyPrefix: string; explicitPrefix: boolean }[] = [
    { regex: new RegExp(`(图)(${numberSource})(?![0-9.])`, 'g'), kind: 'figure', keyPrefix: '图', explicitPrefix: true },
    { regex: new RegExp(`(表)(${numberSource})(?![0-9.])`, 'g'), kind: 'table', keyPrefix: '表', explicitPrefix: true },
    { regex: /附录([A-Z]{1,2})(?![A-Z0-9])/g, kind: 'appendix', keyPrefix: '附录', explicitPrefix: true },
    { regex: new RegExp(`(?:公式|式)?\\((${numberSource})(?![A-Z0-9.])\\)`, 'g'), kind: 'formula', keyPrefix: '(', explicitPrefix: false },
  ]
  const rangePattern = new RegExp(`(图|表)(${numberSource})(至|到|[-~～—–])(?:(图|表))?(${numberSource}|\\d+)(?![A-Z0-9.])`, 'g')

  const expandRange = (prefix: '图' | '表', start: string, endInput: string): string[] => {
    const end = endInput.includes('.') || /^[A-Z]{1,2}\./.test(endInput) ? endInput : endInput
    const startParts = start.split('.')
    const endParts = end.split('.')
    if (startParts.length !== endParts.length || startParts.slice(0, -1).join('.') !== endParts.slice(0, -1).join('.')) return [`${prefix}${start}`, `${prefix}${end}`]
    const first = Number(startParts[startParts.length - 1])
    const last = Number(endParts[endParts.length - 1])
    if (!Number.isInteger(first) || !Number.isInteger(last) || last < first || last - first > 100) return [`${prefix}${start}`, `${prefix}${end}`]
    return Array.from({ length: last - first + 1 }, (_, offset) => `${prefix}${[...startParts.slice(0, -1), String(first + offset)].join('.')}`)
  }
  for (const entry of prose) {
    const mapped = compactWithOffsets(entry.text)
    const rangeSpans: { from: number; to: number; kind: 'figure' | 'table' }[] = []
    // First expand explicit ranges using only identifiers already supplied by Resolver.
    rangePattern.lastIndex = 0
    for (let match = rangePattern.exec(mapped.compact); match; match = rangePattern.exec(mapped.compact)) {
      const prefix = match[1] as '图' | '表'
      const secondPrefix = match[4]
      if (secondPrefix && secondPrefix !== prefix) continue
      const expanded = expandRange(prefix, match[2]!, match[5]!)
      rangeSpans.push({ from: match.index, to: match.index + match[0].length, kind: prefix === '图' ? 'figure' : 'table' })
      for (const key of expanded) recordTarget(entry, mapped, key, match.index, match.index + match[0].length, prefix === '图' ? 'figure' : 'table')
    }
    for (const pattern of literalPatterns) {
      pattern.regex.lastIndex = 0
      for (let match = pattern.regex.exec(mapped.compact); match; match = pattern.regex.exec(mapped.compact)) {
        const wholeFrom = match.index
        const wholeTo = wholeFrom + match[0].length
        const sourceEnd = mapped.to[wholeTo - 1]
        if ((pattern.kind === 'figure' || pattern.kind === 'table') && sourceEnd !== undefined
          && /^[A-Z0-9.]/i.test(entry.text.slice(sourceEnd, sourceEnd + 1).normalize('NFKC'))) continue
        if (rangeSpans.some(span => span.kind === pattern.kind && wholeFrom >= span.from && wholeTo <= span.to)) continue
        let key: string
        if (pattern.kind === 'appendix') key = `附录${match[1]}`
        else if (pattern.kind === 'formula') key = `(${match[1]})`
        else key = `${pattern.keyPrefix}${match[2]}`
        recordTarget(entry, mapped, key, wholeFrom, wholeTo, pattern.kind)
      }
    }
  }
  return result
}

function buildMentions(index: ContentIndex): IndexedMention[] {
  const objectById = new Map(index.objects.map(object => [object.nodeId, object]))
  const structured = index.references.flatMap(reference => {
    if (reference.kind !== 'crossRef' && reference.kind !== 'termRef') return []
    const target = objectById.get(reference.targetId)
    if (!target) return []
    return [{
      nodeId: reference.nodeId,
      targetId: reference.targetId,
      kind: target.kind,
      source: 'structured' as const,
      path: reference.path,
      area: reference.area,
      text: reference.text,
      from: reference.from,
      to: reference.to,
      chapterId: reference.chapterId,
      appendixId: reference.appendixId,
      containerId: reference.containerId,
      objectAncestors: reference.objectAncestors,
    }]
  })
  const literal = addLiteralMentions(index)
  const structuredByLocation = new Map<string, IndexedMention[]>()
  for (const reference of structured) {
    const key = `${reference.targetId}\u0000${reference.nodeId ?? ''}`
    const values = structuredByLocation.get(key) ?? []
    values.push(reference)
    structuredByLocation.set(key, values)
  }
  const merged = literal.filter(candidate => {
    const key = `${candidate.targetId}\u0000${candidate.nodeId ?? ''}`
    return !(structuredByLocation.get(key) ?? []).some(reference =>
      reference.from !== undefined && reference.to !== undefined
        && candidate.from !== undefined && candidate.to !== undefined
        && reference.from < candidate.to && candidate.from < reference.to,
    )
  })
  const structuredMerged: IndexedMention[] = []
  const termGroups = new Map<string, IndexedMention[]>()
  for (const mention of structured) {
    if (mention.kind !== 'term') {
      structuredMerged.push(mention)
      continue
    }
    const key = `${mention.targetId}\u0000${mention.nodeId ?? ''}\u0000${mention.path}`
    const values = termGroups.get(key) ?? []
    values.push(mention)
    termGroups.set(key, values)
  }
  const textsByNode = new Map(index.texts.filter(text => text.nodeId !== null).map(text => [`${text.nodeId}\u0000${text.path}`, text]))
  for (const values of termGroups.values()) {
    values.sort((left, right) => (left.from ?? 0) - (right.from ?? 0) || (left.to ?? 0) - (right.to ?? 0))
    const groups: IndexedMention[] = []
    for (const mention of values) {
      const last = groups[groups.length - 1]
      if (last && (last.to ?? 0) >= (mention.from ?? 0)) {
        last.to = Math.max(last.to ?? 0, mention.to ?? 0)
        continue
      }
      groups.push({ ...mention })
    }
    for (const group of groups) {
      const text = textsByNode.get(`${group.nodeId ?? ''}\u0000${group.path}`)?.text
      if (text && group.from !== undefined && group.to !== undefined) group.text = text.slice(group.from, group.to)
      structuredMerged.push(group)
    }
  }
  const unique = new Map<string, IndexedMention>()
  for (const mention of [...structuredMerged, ...merged]) {
    const key = `${mention.targetId}\u0000${mention.nodeId ?? ''}\u0000${mention.from ?? ''}\u0000${mention.to ?? ''}`
    if (!unique.has(key)) unique.set(key, mention)
  }
  return [...unique.values()]
}

export function buildContentIndex(doc: IRDoc, result: ResolveResult): ContentIndex {
  const index: ContentIndex = { resolution: result, texts: [], references: [], mentions: [], terms: [], objects: [], sequences: new Map(), nodeAreas: new Map(), labels: new Map(), mentionsByTarget: new Map() }
  doc.front.foreword.forEach((block, i) => visitBlock(index, block, `front.foreword[${i}]`, 'frontMatter', undefined, {}))
  doc.front.introduction.forEach((block, i) => visitBlock(index, block, `front.introduction[${i}]`, 'frontMatter', undefined, {}))
  doc.body.forEach((chapter: IRChapter, chapterIndex) => {
    const path = `body[${chapterIndex}]`
    const area = areaForChapter(chapter)
    const label = result.labels[chapter.id]?.label
    addObject(index, { nodeId: chapter.id, path, kind: 'chapter', label, area, chapterId: chapter.id })
    addInlines(index, chapter.title, { nodeId: chapter.id, path: `${path}.title`, area, role: 'title', chapterId: chapter.id }, false)
    visitChildren(index, chapter.children, `${path}.children`, `${path}.children`, area, { chapterId: chapter.id, containerId: chapter.id }, result)
  })
  doc.appendices.forEach((appendix: IRAppendix, appendixIndex) => {
    const path = `appendices[${appendixIndex}]`
    const label = result.labels[appendix.id]?.label
    addObject(index, { nodeId: appendix.id, path, kind: 'appendix', label, area: 'appendix', appendixId: appendix.id })
    addInlines(index, appendix.title, { nodeId: appendix.id, path: `${path}.title`, area: 'appendix', role: 'title', appendixId: appendix.id }, false)
    visitChildren(index, appendix.children, `${path}.children`, `${path}.children`, 'appendix', { appendixId: appendix.id, containerId: appendix.id }, result)
  })
  doc.bibliography.forEach((entry, i) => addInlines(index, entry.content, { nodeId: entry.id, path: `bibliography[${i}]`, area: 'bibliography', role: 'bibliography' }, true))
  if (doc.index) {
    if (doc.index.title) addInlines(index, doc.index.title, { nodeId: doc.index.id, path: 'index.title', area: 'index', role: 'index' })
    doc.index.groups.forEach((group, i) => group.entries.forEach((entry, j) => addInlines(index, entry.term, { nodeId: entry.id, path: `index.groups[${i}].entries[${j}]`, area: 'index', role: 'index' })))
  }
  // Label reverse lookup is built once. Numbering remains exclusively owned by Resolver.
  index.mentions = buildMentions(index)
  for (const mention of index.mentions) {
    const values = index.mentionsByTarget.get(mention.targetId) ?? []
    values.push(mention)
    index.mentionsByTarget.set(mention.targetId, values)
  }
  return index
}

export function textForInlines(inlines: IRInline[]): string {
  return inlineText(inlines)
}
