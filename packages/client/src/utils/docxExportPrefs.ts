import type { TableContinuation } from '@ses/shared'

export type { TableContinuation }

/** DOCX 导出选项「续表方式」的本地偏好；只是每个浏览器的便利设置，不进入文档。 */
export const TABLE_CONTINUATION_STORAGE_KEY = 'ses.docx.tableContinuation'
export const DEFAULT_TABLE_CONTINUATION: TableContinuation = 'split'

export const TABLE_CONTINUATION_OPTIONS: ReadonlyArray<{
  value: TableContinuation
  label: string
  hint: string
}> = [
  {
    value: 'split',
    label: '自动续表（定稿）',
    hint: '页位置可估算的长表拆成多段，续页另起页并写“表X（续）”；位置无法确定的表改按 Word 自然分页并提示。',
  },
  {
    value: 'natural',
    label: 'Word 自然分页（编辑稿）',
    hint: '所有表整表输出、不加硬分页，便于在 Word 中调版；跨页时只重复列标题，没有“表X（续）”，定稿前需人工处理。',
  },
]

export function isTableContinuation(value: unknown): value is TableContinuation {
  return value === 'split' || value === 'natural'
}

/** localStorage 在隐私窗口、禁用站点数据等情况下可能不存在或抛错，一律回退默认值。 */
export function loadTableContinuation(): TableContinuation {
  try {
    const stored = globalThis.localStorage?.getItem(TABLE_CONTINUATION_STORAGE_KEY)
    return isTableContinuation(stored) ? stored : DEFAULT_TABLE_CONTINUATION
  } catch {
    return DEFAULT_TABLE_CONTINUATION
  }
}

export function saveTableContinuation(value: TableContinuation): void {
  try {
    globalThis.localStorage?.setItem(TABLE_CONTINUATION_STORAGE_KEY, value)
  } catch {
    // 无法持久化时仍按本次选择导出。
  }
}
