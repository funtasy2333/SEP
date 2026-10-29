/** Validate persisted graphic attributes before accepting or projecting them. */
export function graphicAttributeProblem(value: unknown, primary = false, pm = false): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '必须为对象'
  const row = value as Record<string, unknown>
  const idKey = pm ? 'nodeId' : 'id'
  const allowed = new Set(primary ? ['contentType', 'specificUse'] : [idKey, 'src', 'resourceId', 'contentType', 'specificUse'])
  if (Object.keys(row).some(key => !allowed.has(key))) return '包含未知字段'
  if (!primary && (typeof row[idKey] !== 'string' || !row[idKey] || typeof row.src !== 'string' || !row.src)) return '必须具有非空 id 和 src'
  for (const key of ['resourceId', 'contentType']) {
    if (row[key] !== undefined && (typeof row[key] !== 'string' || !row[key])) return `${key} 必须是非空字符串`
  }
  if (row.specificUse !== undefined && !['size:T', 'size:S', 'size:M', 'size:L'].includes(String(row.specificUse))) return 'specificUse 无效'
  return null
}
