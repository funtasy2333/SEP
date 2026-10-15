/** null、非对象，或没有任何顶层节点：视为空内容（新建后尚未写入正文的文档）。 */
export function isEmptyContent(content: unknown): boolean {
  if (typeof content !== 'object' || content === null) return true;
  const nodes = (content as { content?: unknown }).content;
  return !Array.isArray(nodes) || nodes.length === 0;
}
