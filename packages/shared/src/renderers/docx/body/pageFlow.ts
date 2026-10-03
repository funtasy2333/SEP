/** 首段接排的高度估算。使用同一份段落样式、版心与网格参数；不替代 Word 实排。 */
import { styleSpecs } from '../styles'

const MM_PER_POINT = 25.4 / 72
const GRID_LINE_MM = 15.6 * MM_PER_POINT
const specs = new Map(styleSpecs().map(spec => [spec.id, spec]))

function attr(xml: string | undefined, name: string): number {
  const value = new RegExp(`w:${name}="([0-9.]+)"`).exec(xml ?? '')?.[1]
  return value === undefined ? 0 : Number(value)
}

function decode(text: string): string {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, value: string) =>
    String.fromCodePoint(value[0]?.toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function units(text: string): number {
  return [...text].reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? 0.55 : 1), 0)
}

function lines(text: string, capacity: number, firstCapacity: number): number {
  return text.split('\n').reduce((sum, line, index) => {
    const width = units(line)
    const first = index === 0 ? firstCapacity : capacity
    return sum + 1 + Math.max(0, Math.ceil((width - first) / capacity))
  }, 0)
}

export interface ParagraphFlowOptions {
  numberingIndent?: string
  indent?: { left: number; hanging: number }
  pageBreakBefore?: boolean
}

interface ParagraphMeasure {
  contentHeight: number
  before: number
  after: number
  atomic: boolean
  ids: number[]
}

export interface PageFlow {
  readonly availableMm: number | undefined
  readonly estimateUnavailable: boolean
  readonly isSuspended: boolean
  startSection(): void
  setOrientation(landscape: boolean): void
  withElement<T>(landscape: boolean, render: () => T): T
  suspend<T>(render: () => T): T
  recordParagraph(styleId: string, runsXml: string, numbered: boolean, options?: ParagraphFlowOptions): void
  beforeTable(): void
  placeTable(heightsMm: readonly number[], startOnNewPage: boolean): void
  setFootnoteHeights(heights: ReadonlyMap<number, number>): void
}

export function createPageFlow(): PageFlow {
  let pending: ParagraphMeasure[] = []
  let active = false
  let known = true
  let landscape = false
  let used = 0
  let previousAfter = 0
  let paused = 0
  let elementDepth = 0
  let lastWasTable = false
  let footnoteHeight = 0
  let footnotes = new Set<number>()
  let definitionHeights: ReadonlyMap<number, number> = new Map()
  const capacity = () => landscape ? 151 : 238 // A4 less the existing 34/25 mm margins.
  const remaining = () => Math.max(0, capacity() - used - footnoteHeight)
  const nextPage = () => {
    used = 0
    lastWasTable = false
    previousAfter = 0
    footnoteHeight = 0
    footnotes = new Set()
    known = true
  }
  const setOrientation = (value: boolean) => {
    if (landscape !== value) { flushPending(); landscape = value; nextPage() }
  }
  const advance = (height: number, atomic: boolean) => {
    if (atomic && height <= capacity() && height > remaining()) nextPage()
    let rest = height
    while (rest > remaining() + 0.001) {
      rest -= remaining()
      nextPage()
    }
    used += rest
  }
  // Defer a keepNext chain until its following paragraph is known. Measurements queried
  // mid-chain are projected without consuming it, so the next paragraph can still relocate it.
  function flushPending(): void {
    if (pending.length === 0) return
    const chain = pending; pending = []
    const ids = [...new Set(chain.flatMap(paragraph => paragraph.ids))]
    const totalHeight = () => {
      let after = previousAfter
      let height = 0
      for (const paragraph of chain) {
        height += Math.max(0, paragraph.before - after) + paragraph.contentHeight + paragraph.after
        after = paragraph.after
      }
      return height
    }
    const reserveHeight = () => {
      const newIds = ids.filter(id => !footnotes.has(id))
      return newIds.reduce((sum, id) => sum + (definitionHeights.get(id) ?? 8), 0) +
        (newIds.length > 0 && footnotes.size === 0 ? 6 : 0)
    }
    const wasKnown = known
    let height = totalHeight()
    let reserve = reserveHeight()
    const atomic = chain.length > 1 || chain.some(paragraph => paragraph.atomic) || ids.length > 0
    const freshHeight = height + Math.min(previousAfter, chain[0]!.before)
    const freshReserve = ids.length > 0 ? 6 + ids.reduce((sum, id) => sum + (definitionHeights.get(id) ?? 8), 0) : 0
    if (atomic && height + reserve > remaining() && freshHeight + freshReserve <= capacity()) {
      nextPage()
      height = totalHeight(); reserve = reserveHeight()
    }
    footnoteHeight += reserve
    for (const id of ids) footnotes.add(id)
    const fitsPage = (!atomic || height + reserve <= capacity()) && footnoteHeight < capacity()
    advance(height, atomic)
    // Oversized chains and previously unknown positions cannot be inferred from natural wrapping.
    known = wasKnown && fitsPage
    previousAfter = chain[chain.length - 1]!.after
  }
  function projectedRemaining(): number | undefined {
    if (!active || !known) return undefined
    const saved = {used, previousAfter, footnoteHeight, footnotes, known, lastWasTable, pending}
    footnotes = new Set(footnotes)
    flushPending()
    const result = known ? remaining() : undefined
    ;({used, previousAfter, footnoteHeight, footnotes, known, lastWasTable, pending} = saved)
    return result
  }
  return {
    get availableMm() { return projectedRemaining() },
    get estimateUnavailable() { return active && projectedRemaining() === undefined },
    get isSuspended() { return paused > 0 },
    startSection() { pending = []; active = true; landscape = false; nextPage() },
    setOrientation,
    setFootnoteHeights(heights) { definitionHeights = heights },
    withElement(value, render) {
      if (elementDepth === 0) setOrientation(value)
      elementDepth += 1
      try { return render() } finally { elementDepth -= 1 }
    },
    suspend(render) {
      paused += 1
      try { return render() } finally { paused -= 1 }
    },
    recordParagraph(styleId, runsXml, numbered, options = {}) {
      if (!active || paused > 0) return
      if (elementDepth === 0) setOrientation(false)
      if (options.pageBreakBefore) { flushPending(); nextPage() }
      lastWasTable = false
      // OMML's physical height depends on its layout. Do not turn an unknown formula into
      // a made-up page position; the next table will use the existing fresh-page fallback.
      if (styleId === 'SesFormula' || runsXml.includes('<m:oMath')) { flushPending(); known = false; return }
      const spec = specs.get(styleId)
      if (!spec) { flushPending(); known = false; return }
      const fontMm = ((spec.sz ?? 21) / 2) * MM_PER_POINT
      const text = [...runsXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>|<w:tab\/>/g)]
        .map(match => match[0].startsWith('<w:br') ? '\n' : match[0] === '<w:tab/>' ? '　' : decode(match[1] ?? '')).join('')
      const effective = (name: string) => {
        const source = options.numberingIndent?.includes(`w:${name}=`) ? options.numberingIndent : spec.ind
        return attr(source, name)
      }
      const left = options.indent?.left ?? effective('left')
      const right = effective('right')
      const firstIndent = (options.indent ? 0 : effective('firstLine')) / 20 * MM_PER_POINT
      // Hanging indentation locates the marker; Word's body text and every wrapped line
      // begin at the left indent. Keep the conservative marker deduction on the first line.
      const width = (landscape ? 252 : 165) - (left + right) / 20 * MM_PER_POINT
      const capacityUnits = Math.max(4, width / fontMm)
      const firstUnits = Math.max(4, (width - firstIndent) / fontMm - (numbered ? 5 : 0))
      const count = lines(text, capacityUnits, firstUnits)
      const exactLine = attr(spec.spacing, 'line') / 20 * MM_PER_POINT
      const lineHeight = exactLine || (spec.snapToGridOff ? fontMm * 1.25 : GRID_LINE_MM)
      const before = attr(spec.spacing, 'before') / 20 * MM_PER_POINT
      const after = attr(spec.spacing, 'after') / 20 * MM_PER_POINT
      const imageHeight = Number(/<wp:extent\b[^>]*\bcy="([0-9]+)"/.exec(runsXml)?.[1] ?? 0) / 36000
      const ids = [...runsXml.matchAll(/<w:footnoteReference\b[^>]*w:id="([0-9]+)"/g)].map(match => Number(match[1]))
      pending.push({
        contentHeight: imageHeight > 0 ? imageHeight + 3 : count * lineHeight,
        before, after, ids,
        atomic: spec.keepLines === true || imageHeight > 0,
      })
      if (!spec.keepNext) flushPending()
    },
    beforeTable() {
      flushPending()
      if (active && lastWasTable) advance(GRID_LINE_MM, false)
      lastWasTable = false
    },
    placeTable(heights, startOnNewPage) {
      if (!active) return
      flushPending()
      heights.forEach((height, index) => {
        if (index > 0 || startOnNewPage) nextPage()
        const wasKnown = known
        advance(height, true)
        if (index === 0 && !startOnNewPage && !wasKnown) known = false
      })
      previousAfter = 0
      lastWasTable = true
    },
  }
}
