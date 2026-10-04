import type { DocxPackage } from '@ses/shared'

/** 供实际导出按钮和回归共同使用的导出结果提示。 */
export function getDocxExportFeedback(warnings: DocxPackage['warnings']) {
  const codes = new Set(warnings.map(warning => warning.code))
  const tableNotes: Record<string, string> = {
    'table-flow-estimate-unavailable': '部分表格前的内容无法可靠确定页位置，已从新页排起，请在 Word 中复核表前余量。',
    'table-row-too-tall': '部分表格的数据行或跨行合并组超出单页空间，请在 Word 中调整分页。',
    'table-footer-too-tall': '部分表格的表题、重复表头与表注/表脚注合计超出一页，请在 Word 中调整分页。',
    'table-final-segment-too-tall': '部分表格的末段余量不足以同时容纳数据行与表注/表脚注，请在 Word 中调整分页。',
    'table-header-rowspan-pagination': '部分表格的表头合并跨入数据行，首段可能超高，请在 Word 中核对分页。',
  }
  const tableIssues = Object.entries(tableNotes).filter(([code]) => codes.has(code)).map(([, message]) => message)
  const notes = [
    ...tableIssues,
    ...warnings.filter(warning => warning.code === 'footnote-landscape-separator').map(warning => warning.message),
    ...(codes.has('cover-asset-approximation') ? ['部分封面素材的来源或清晰度有限，请核对后使用。'] : []),
    ...(codes.has('cover-field-missing') ? ['部分封面信息未填写，请补齐后核对。'] : []),
  ]
  return notes.length
    ? { type: 'warning' as const, message: `DOCX 已导出。${notes.join('')}`, duration: tableIssues.length ? 0 : 8000, showClose: true }
    : { type: 'success' as const, message: 'DOCX 文件已导出', duration: 3000, showClose: false }
}
