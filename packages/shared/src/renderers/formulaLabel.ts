/**
 * 公式编号的显示形式：GB/T 1.1-2020 9.9.2 示例用中文（全角）圆括号「（1）」「（A.1）」。
 * Resolver 的 label 保持「(1)」（正文引用文字「公式(1)」按原文用半角括号），只在编号本身显示时转换；
 * DOCX 与 HTML/PDF 共用。
 */
export function fullWidthFormulaLabel(label: string): string {
  const wrapped = /^(?:\((.*)\)|（(.*)）)$/.exec(label)
  const inner = wrapped ? (wrapped[1] ?? wrapped[2]) : label
  return `（${inner}）`
}
