export interface XmlProblemLike {
  message: string
  nodeId?: string
  path?: string
}

/** 提示框（ElMessage）默认最多展示的问题条数，避免批量报错撑爆视口。 */
export const DEFAULT_XML_PROBLEM_LIMIT = 3

/**
 * 将 XML 导入/导出错误列表格式化为适合提示框展示的摘要文本。
 * - ≤ maxItems 项时完整拼接（保留 `nodeId` / `path` 定位信息）；
 * - 超过 maxItems 项时仅展示前 maxItems 项，并附加 `……等共 N 项问题`。
 */
export function formatXmlProblems(
  problems: readonly XmlProblemLike[],
  maxItems = DEFAULT_XML_PROBLEM_LIMIT,
): string {
  if (problems.length === 0) return ''
  const limit = Number.isInteger(maxItems) && maxItems > 0 ? maxItems : DEFAULT_XML_PROBLEM_LIMIT
  const summary = problems
    .slice(0, limit)
    .map((problem) => {
      const location = [
        problem.nodeId ? `节点 ${problem.nodeId}` : '',
        problem.path ? `位置 ${problem.path}` : '',
      ].filter(Boolean).join('，')
      return `${problem.message}${location ? `【${location}】` : ''}`
    })
    .join('；')
  if (problems.length > limit) {
    return `${summary}……等共 ${problems.length} 项问题`
  }
  return summary
}
