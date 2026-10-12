/**
 * Renderer-only variant of the historical full fixture with crossRef marks
 * typed to match their explicitly authored targets. Kept outside the model
 * fixture module so its byte-locked JSON contract remains unchanged.
 */

import { fullFixture } from '../../ir/__tests__/fixtures'
import type { PMJsonNode } from '../../ir/pmToIr'

/**
 * Renderer-only copy of the historical full fixture with crossRef marks typed
 * to match their explicitly authored targets. `fullFixture()` intentionally
 * stays unchanged for existing model/JSON contracts; this variant exists so
 * output-boundary tests exercise valid printable input without inferring kinds
 * from generated IDs.
 */
export function fullRendererFixture(): PMJsonNode {
  const fixture = JSON.parse(JSON.stringify(fullFixture())) as PMJsonNode
  const targetKinds = new Map<string, string>([
    ['cl-42', 'clause'],
    ['tbl-1', 'table'],
    ['fig-1', 'figure'],
    ['f-1', 'formula'],
    ['bib-2', 'bibEntry'],
  ])
  const seen = new Set<string>()
  const visit = (node: PMJsonNode): void => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== 'crossRef') continue
      const refId = mark.attrs?.refId
      if (typeof refId !== 'string') continue
      const refType = targetKinds.get(refId)
      if (!refType) continue
      mark.attrs = { ...mark.attrs, refType }
      seen.add(refId)
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(fixture)
  for (const refId of targetKinds.keys()) {
    if (!seen.has(refId)) throw new Error(`fullRendererFixture is missing the expected crossRef reference ${refId}`)
  }
  return fixture
}
