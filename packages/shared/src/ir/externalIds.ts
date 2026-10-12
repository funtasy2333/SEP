import type { IRDoc, IRProblem, NodeId } from './types'

/**
 * Map an external ID and its namespace to a stable internal ID.
 *
 * Each UTF-16 code unit is encoded as four hex digits and prefixed by its
 * code-unit length. This is injective for arbitrary JavaScript strings,
 * including delimiter characters, Unicode normalization variants, and lone
 * surrogates. This is an internal mapping format, not a standards XML-ID rule.
 */
export function externalIdToNodeId(externalId: string, namespace = ''): NodeId {
  const encodePart = (value: string): string => {
    let encoded = ''
    for (let index = 0; index < value.length; index += 1) {
      encoded += value.charCodeAt(index).toString(16).padStart(4, '0')
    }
    return `${value.length.toString(36)}:${encoded}`
  }

  return `external:v1:${encodePart(namespace)}:${encodePart(externalId)}`
}

type ReferenceKey = 'targetId' | 'resourceId' | 'resourceRefs' | 'targets' | 'seeAlso'

const REFERENCE_ARRAY_KEYS = new Set<ReferenceKey>(['resourceRefs', 'targets', 'seeAlso'])

function setOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

function collectDefinitionCounts(value: unknown, counts: Map<string, number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectDefinitionCounts(item, counts)
    return
  }
  if (value === null || typeof value !== 'object') return

  for (const [key, item] of Object.entries(value)) {
    if (key === 'id' && typeof item === 'string') counts.set(item, (counts.get(item) ?? 0) + 1)
    collectDefinitionCounts(item, counts)
  }
}

function problemCode(key: ReferenceKey): IRProblem['code'] {
  if (key === 'resourceId' || key === 'resourceRefs') return 'dangling-resource'
  if (key === 'targets' || key === 'seeAlso') return 'dangling-index-target'
  return 'dangling-typed-ref'
}

/**
 * Clone an IRDoc while consistently remapping entity IDs and typed references.
 * IR is a JSON-shaped typed model without opaque attrs, so every own `id` field
 * is an entity definition; only the explicit reference keys below are targets.
 */
export function remapExternalIds(
  doc: IRDoc,
  namespace = '',
): { doc: IRDoc; idMap: Readonly<Record<string, NodeId>>; problems: IRProblem[] } {
  const counts = new Map<string, number>()
  collectDefinitionCounts(doc, counts)

  const nodeIds = new Map<string, NodeId>()
  const idMap: Record<string, NodeId> = {}
  for (const externalId of counts.keys()) {
    if (externalId.length === 0) continue
    const nodeId = externalIdToNodeId(externalId, namespace)
    nodeIds.set(externalId, nodeId)
    setOwn(idMap, externalId, nodeId)
  }

  const problems: IRProblem[] = []
  for (const [externalId, count] of counts) {
    if (externalId.length === 0) {
      for (let occurrence = 0; occurrence < count; occurrence += 1) {
        problems.push({
          code: 'missing-id',
          nodeId: null,
          severity: 'error',
          message: '实体定义缺少稳定 ID；空 ID 已保留且未映射',
        })
      }
      continue
    }
    if (count < 2) continue
    problems.push({
      code: 'duplicate-id',
      nodeId: nodeIds.get(externalId) ?? null,
      severity: 'error',
      message: `外部 ID「${externalId}」有 ${count} 个定义；同名定义及其引用已一致映射，需在导入数据中消除重复`,
    })
  }

  const remapReference = (
    externalTarget: string,
    key: ReferenceKey,
    path: string,
    ownerExternalId: string | undefined,
  ): string => {
    const mapped = nodeIds.get(externalTarget)
    if (mapped !== undefined) return mapped

    problems.push({
      code: problemCode(key),
      nodeId: ownerExternalId !== undefined ? nodeIds.get(ownerExternalId) ?? null : null,
      severity: 'error',
      message: `引用字段「${path}」指向未定义的外部 ID「${externalTarget}」，已保留原值`,
    })
    return externalTarget
  }

  const clone = (value: unknown, path: string, ownerExternalId?: string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => clone(item, `${path}[${index}]`, ownerExternalId))
    if (value === null || typeof value !== 'object') return value

    const source = value as Record<string, unknown>
    const localOwner = typeof source.id === 'string' ? source.id : ownerExternalId
    const result: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(source)) {
      const fieldPath = path ? `${path}.${key}` : key
      if (key === 'id' && typeof item === 'string') {
        setOwn(result, key, nodeIds.get(item) ?? item)
      } else if ((key === 'targetId' || key === 'resourceId') && typeof item === 'string') {
        setOwn(result, key, remapReference(item, key, fieldPath, localOwner))
      } else if (REFERENCE_ARRAY_KEYS.has(key as ReferenceKey) && Array.isArray(item)) {
        const referenceKey = key as ReferenceKey
        setOwn(result, key, item.map((target, index) => typeof target === 'string'
          ? remapReference(target, referenceKey, `${fieldPath}[${index}]`, localOwner)
          : clone(target, `${fieldPath}[${index}]`, localOwner)))
      } else if (key === 'nodeId' && typeof item === 'string') {
        // unsupportedContent and unmappedFootnotes identify an existing source entity;
        // these context IDs are references, never definitions.
        setOwn(result, key, nodeIds.get(item) ?? item)
      } else {
        setOwn(result, key, clone(item, fieldPath, localOwner))
      }
    }
    return result
  }

  return {
    doc: clone(doc, '') as IRDoc,
    idMap,
    problems,
  }
}
