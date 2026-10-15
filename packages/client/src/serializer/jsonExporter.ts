/**
 * Client adapter for the semantic JSON export.
 *
 * The export itself (shared Resolver labels + `renderSemanticJson`) lives in @ses/io so the server can produce
 * the same JSON for a stored document; this file only turns the Tiptap/ProseMirror node into plain JSON.
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { exportSemanticJson as exportSemanticJsonFromJson } from '@ses/io'
import type { PMJsonNode, SemanticJsonNode } from '@ses/shared'

export type { SemanticJsonNode } from '@ses/shared'

/** Export a ProseMirror document using labels from the shared IR Resolver. */
export function exportSemanticJson(doc: PMNode): SemanticJsonNode {
  return exportSemanticJsonFromJson(doc.toJSON() as PMJsonNode)
}
