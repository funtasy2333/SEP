import type { DocxPackage } from '@ses/shared'

type DocxWarning = DocxPackage['warnings'][number]

/** 同类告警涉及的表编号（Resolver labels，如“表3”“表A.1”），按文档顺序去重。 */
function affectedTables(warnings: DocxPackage['warnings'], code: string): string {
  const labels = warnings.filter(warning => warning.code === code && warning.label).map(warning => warning.label!)
  return labels.length ? [...new Set(labels)].join('、') : '部分表格'
}

/** 供实际导出按钮和回归共同使用的导出结果提示。 */
export function getDocxExportFeedback(warnings: DocxPackage['warnings']) {
  const codes = new Set(warnings.map((warning: DocxWarning) => warning.code))
  const tables = (code: string) => affectedTables(warnings, code)
  const tableNotes: Array<[string, () => string]> = [
    ['table-flow-natural-fallback', () => `${tables('table-flow-natural-fallback')}前的页位置无法可靠确定，` +
      '已改按 Word 自然分页排版（整表输出、表头逐页重复），续页没有“表X（续）”，请在 Word 中复核分页并按需补写。'],
    ['table-row-too-tall', () => `${tables('table-row-too-tall')}的数据行或跨行合并组超出单页空间，请在 Word 中调整分页。`],
    ['table-footer-too-tall', () => `${tables('table-footer-too-tall')}的表题、重复表头与表注/表脚注合计超出一页，请在 Word 中调整分页。`],
    ['table-final-segment-too-tall', () => `${tables('table-final-segment-too-tall')}的末段余量不足以同时容纳数据行与表注/表脚注，请在 Word 中调整分页。`],
    ['table-header-rowspan-pagination', () => `${tables('table-header-rowspan-pagination')}的表头合并跨入数据行，续页重复的表头可能被截断，请在 Word 中核对分页。`],
  ]
  const tableIssues = tableNotes.filter(([code]) => codes.has(code)).map(([, message]) => message())
  const tocPending = codes.has('toc-pages-pending')
  const notes = [
    ...(tocPending ? ['目次页码待更新：请用 Microsoft Word 打开文件，打开时会依次出现两个提示：' +
      '询问是否更新域时选“是”，“更新目录”时选“更新整个目录”，完成后保存。' +
      '若打开时未更新，可在目次上右键选择“更新域”→“更新整个目录”。'] : []),
    ...tableIssues,
    ...warnings.filter(warning => warning.code === 'footnote-landscape-separator').map(warning => warning.message),
    ...(codes.has('cover-asset-approximation') ? ['部分封面素材的来源或清晰度有限，请核对后使用。'] : []),
    ...(codes.has('cover-field-missing') ? ['部分封面信息未填写，请补齐后核对。'] : []),
  ]
  return notes.length
    ? { type: 'warning' as const, message: `DOCX 已导出。${notes.join('')}`, duration: tableIssues.length || tocPending ? 0 : 8000, showClose: true }
    : { type: 'success' as const, message: 'DOCX 文件已导出', duration: 3000, showClose: false }
}
