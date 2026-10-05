/** Client adapter for the shared semantic JSON renderer. */

import type { Node as PMNode } from '@tiptap/pm/model'
import { pmToIr, renderSemanticJson, resolve, type PMJsonNode, type SemanticJsonNode } from '@ses/shared'

export type { SemanticJsonNode } from '@ses/shared'

const NUMBERED_NODE_TYPES = new Set(['chapter', 'clause', 'termDef', 'appendix'])

interface ResolverInput {
  pmJson: PMJsonNode
  /** Temporary Resolver IDs keyed by source ProseMirror child-index path. */
  temporaryIdsByPath: Record<string, string>
}

function pathKey(path: readonly number[]): string {
  return path.join('.')
}

function collectStrings(value: unknown, used: Set<string>): void {
  if (typeof value === 'string') {
    used.add(value)
  } else if (Array.isArray(value)) {
    value.forEach(entry => collectStrings(entry, used))
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(entry => collectStrings(entry, used))
  }
}

function exportLocalId(path: readonly number[], used: Set<string>): string {
  let candidate = `__ses_json_export__${pathKey(path) || 'root'}`
  while (used.has(candidate)) candidate += '_'
  used.add(candidate)
  return candidate
}

/**
 * Clone the PM tree and fill missing IDs only on legacy numbered nodes. These
 * IDs exist for this resolver call only; rendering always reads the untouched
 * source tree and receives the temporary-node labels through its path map.
 */
function prepareResolverInput(source: PMJsonNode): ResolverInput {
  const used = new Set<string>()
  collectStrings(source, used)
  const temporaryIdsByPath: Record<string, string> = {}

  const clone = (node: PMJsonNode, path: readonly number[]): PMJsonNode => {
    const attrs = node.attrs ? { ...node.attrs } : NUMBERED_NODE_TYPES.has(node.type) ? {} : undefined
    const stableId = attrs?.nodeId
    if (NUMBERED_NODE_TYPES.has(node.type) && !(typeof stableId === 'string' && stableId.length > 0)) {
      const id = exportLocalId(path, used)
      temporaryIdsByPath[pathKey(path)] = id
      attrs!.nodeId = id
    }

    const result: PMJsonNode = { ...node }
    if (attrs) result.attrs = attrs
    if (node.content) result.content = node.content.map((child, index) => clone(child, [...path, index]))
    return result
  }

  return { pmJson: clone(source, []), temporaryIdsByPath }
}

/** Export a ProseMirror document using labels from the shared IR Resolver. */
export function exportSemanticJson(doc: PMNode): SemanticJsonNode {
  const source = doc.toJSON() as PMJsonNode
  const resolverInput = prepareResolverInput(source)
  const { doc: irDoc } = pmToIr(resolverInput.pmJson)
  const { labels } = resolve(irDoc)

  const labelsByPath: Record<string, (typeof labels)[string]> = {}
  for (const [path, temporaryId] of Object.entries(resolverInput.temporaryIdsByPath)) {
    const label = labels[temporaryId]
    if (label) labelsByPath[path] = label
  }

  return renderSemanticJson(source, labels, { labelsByPath })
}
