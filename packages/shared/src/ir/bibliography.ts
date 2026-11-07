import type { PMJsonNode } from './pmToIr'

const PRESENTATION_MARKS = new Set(['bold', 'italic', 'underline', 'subscript', 'superscript'])

/** Older editor entries stored their display number in the leading text.
 * Recognize it across text marks without crossing inline atoms or metadata.
 */
export function legacyBibliographyPrefixLength(content: readonly PMJsonNode[] = []): number {
  let leadingText = ''
  for (const node of content) {
    if (node.type !== 'text') break
    if (node.marks != null && (!Array.isArray(node.marks)
      || node.marks.some(mark => !mark || typeof mark !== 'object' || !PRESENTATION_MARKS.has(mark.type)))) break
    leadingText += node.text ?? ''
  }
  return /^\s*\[[1-9]\d*\](?:[ \t\u3000]+|$)/.exec(leadingText)?.[0].length ?? 0
}
