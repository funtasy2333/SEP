import type { IRDoc, IRParagraph } from '../../ir/types'

/** Creates a deterministic IR snapshot with a known number of direct body paragraphs. */
export function createParagraphDocument(count: number): IRDoc {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer')
  const children: IRParagraph[] = Array.from({ length: count }, (_, index) => ({
    kind: 'paragraph',
    id: `paragraph-${index + 1}`,
    content: [{ text: `要求正文 ${index + 1}。` }],
  }))
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter-1', secType: 'general', title: [{ text: '要求' }], children }],
    appendices: [],
    bibliography: [],
  }
}
