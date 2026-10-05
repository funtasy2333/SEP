/**
 * Semantic JSON renderer.
 *
 * This renderer preserves the ProseMirror JSON tree and adds the numbering fields
 * historically emitted for chapters, clauses, term definitions, and appendices.
 * Numbering is supplied by the shared Resolver; this module has no counters.
 */

import type { PMJsonNode } from '../ir/pmToIr'
import type { IRDoc, ResolvedLabel } from '../ir/types'
import { irToPm } from '../ir/irToPm'

export interface SemanticJsonMark {
  type: string
  attrs?: Record<string, unknown>
  [key: string]: unknown
}

export interface SemanticJsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: SemanticJsonNode[]
  text?: string
  marks?: SemanticJsonMark[]
  number?: string
  path?: string
  [key: string]: unknown
}

export interface RenderSemanticJsonOptions {
  /**
   * Resolver labels for export-local IDs attached to the input tree only for
   * this render. Keys are dot-separated ProseMirror child indexes (root child 0
   * is `0`, its first child is `0.0`).
   */
  labelsByPath?: Readonly<Record<string, ResolvedLabel>>
}

const SEMANTIC_NUMBER_TYPES = new Set(['chapter', 'clause', 'termDef', 'appendix'])
const LEGACY_PATHS: Readonly<Record<string, string>> = {
  foreword: '前言',
  introduction: '引言',
  bibliography: '参考文献',
}
const NODE_FIELDS = new Set(['type', 'attrs', 'content', 'text', 'marks', 'number', 'path'])

function nonNullRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry != null) setOwn(result, key, entry)
  }
  return Object.keys(result).length ? result : undefined
}

function setOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

function copyUnknownFields(source: Record<string, unknown>, target: SemanticJsonNode): void {
  for (const [key, value] of Object.entries(source)) {
    if (!NODE_FIELDS.has(key)) setOwn(target, key, value)
  }
}

function copyMarks(node: PMJsonNode, target: SemanticJsonNode): void {
  if (!node.marks) return
  if (node.marks.length === 0) {
    target.marks = []
    return
  }
  target.marks = node.marks.map(mark => {
    const rendered: SemanticJsonMark = { type: mark.type }
    const markAttrs = nonNullRecord(mark.attrs)
    if (markAttrs) rendered.attrs = markAttrs
    for (const [key, value] of Object.entries(mark as unknown as Record<string, unknown>)) {
      if (key !== 'type' && key !== 'attrs') setOwn(rendered, key, value)
    }
    return rendered
  })
}

function semanticLabel(
  node: PMJsonNode,
  labels: Readonly<Record<string, ResolvedLabel>>,
  labelsByPath: Readonly<Record<string, ResolvedLabel>> | undefined,
  pathKey: string,
): ResolvedLabel | undefined {
  const nodeId = node.attrs?.nodeId
  if (typeof nodeId === 'string' && nodeId.length > 0) {
    return Object.prototype.hasOwnProperty.call(labels, nodeId) ? labels[nodeId] : undefined
  }
  return labelsByPath && Object.prototype.hasOwnProperty.call(labelsByPath, pathKey)
    ? labelsByPath[pathKey]
    : undefined
}

function renderNode(
  node: PMJsonNode,
  labels: Readonly<Record<string, ResolvedLabel>>,
  labelsByPath: Readonly<Record<string, ResolvedLabel>> | undefined,
  path: readonly number[],
): SemanticJsonNode {
  const result: SemanticJsonNode = { type: node.type }
  const attrs = nonNullRecord(node.attrs)
  if (attrs) result.attrs = attrs

  if (node.type === 'text') {
    result.text = node.text || ''
    copyMarks(node, result)
    copyUnknownFields(node as unknown as Record<string, unknown>, result)
    return result
  }

  copyMarks(node, result)
  copyUnknownFields(node as unknown as Record<string, unknown>, result)

  if (Object.prototype.hasOwnProperty.call(LEGACY_PATHS, node.type)) {
    result.path = LEGACY_PATHS[node.type]
  } else if (SEMANTIC_NUMBER_TYPES.has(node.type)) {
    const label = semanticLabel(node, labels, labelsByPath, path.join('.'))
    if (label) {
      result.number = node.type === 'appendix' && label.label.startsWith('附录')
        ? label.label.slice('附录'.length)
        : label.label
      result.path = label.label
    }
  }

  if (node.content !== undefined) {
    result.content = node.content.map((child, index) => renderNode(child, labels, labelsByPath, [...path, index]))
  }
  return result
}

/**
 * Compatibility projection for existing ProseMirror documents. The caller
 * supplies labels produced by `pmToIr → resolve`; existing `nodeId` values are
 * the primary association, and `labelsByPath` supports export-local legacy IDs.
 */
export function renderSemanticJson(
  pmJson: PMJsonNode,
  labels: Readonly<Record<string, ResolvedLabel>>,
  options: RenderSemanticJsonOptions = {},
): SemanticJsonNode {
  return renderNode(pmJson, labels, options.labelsByPath, [])
}

/**
 * IR-native semantic JSON contract. `irToPm` is the single authoring-IR
 * projection; unsupported IR content raises its diagnostic error and is not
 * silently omitted. Existing PM-based exports should use `renderSemanticJson`.
 */
export function renderJson(doc: IRDoc, labels: Readonly<Record<string, ResolvedLabel>>): SemanticJsonNode {
  return renderSemanticJson(irToPm(doc), labels)
}
