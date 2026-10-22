import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'

/** Resolve presentation labels without storing counters or generated IDs in the document. */
export function semanticLabels(source: PMJsonNode) {
  const ids = new Set<string>()
  const collect = (node: PMJsonNode): void => {
    if (typeof node.attrs?.nodeId === 'string') ids.add(node.attrs.nodeId)
    node.content?.forEach(collect)
  }
  collect(source)
  const sourceIds = new WeakMap<PMJsonNode, string>()
  const numbered = new Set(['chapter', 'clause', 'termDef', 'appendix', 'stdTable', 'table', 'figure', 'formula', 'example', 'exampleBlock', 'bibEntry'])
  let serial = 0
  const project = (node: PMJsonNode): PMJsonNode => {
    const copy: PMJsonNode = { ...node, attrs: node.attrs ? { ...node.attrs } : undefined }
    let id = node.attrs?.nodeId
    if (numbered.has(node.type) && (typeof id !== 'string' || !id)) {
      do { id = `_view_${++serial}` } while (ids.has(id as string))
      ids.add(id as string)
      copy.attrs = { ...copy.attrs, nodeId: id }
    }
    if (typeof id === 'string') sourceIds.set(node, id)
    if (node.content) copy.content = node.content.map(project)
    return copy
  }
  const labels = resolve(pmToIr(project(source)).doc).labels
  return {
    labels,
    labelFor: (node: PMJsonNode) => labels[sourceIds.get(node) ?? '']?.label ?? '?',
  }
}
