import type { ExternalChange } from './documentChangeSync'

/** 编辑器对一次外部修改的归因：只区分「AI 改的」与「其他地方改的」（含无法判断来源的情形）。 */
export interface ExternalCause {
  kind: 'ai' | 'other'
  /** AI 写入方标识（如 MCP 客户端名称） */
  client?: string
}

export function externalCauseOf(change: Pick<ExternalChange, 'source' | 'client'>): ExternalCause {
  return change.source === 'ai'
    ? { kind: 'ai', ...(change.client ? { client: change.client } : {}) }
    : { kind: 'other' }
}

/** 句首主语：「AI（client 名）」或「AI 」（无 client 时带一个空格，与后面的中文隔开）。 */
function aiSubject(cause: ExternalCause): string {
  return cause.client ? `AI（${cause.client}）` : 'AI '
}

/** 无未保存修改、已自动载入最新内容时的提示。 */
export function externalUpdateNotice(cause: ExternalCause): string {
  return cause.kind === 'ai'
    ? `${aiSubject(cause)}已更新文档，已载入最新内容`
    : '文档已在其他地方更新，已载入最新内容'
}

/** 冲突横幅（关闭对话框后常驻）。非 AI 时沿用 9.1d 的原文案。 */
export function externalConflictBanner(cause?: ExternalCause): string {
  return cause?.kind === 'ai'
    ? `${aiSubject(cause)}已修改此文档，当前内容未保存；自动保存已暂停。`
    : '文档已在其他地方被修改，当前内容未保存；自动保存已暂停。'
}

/** 冲突对话框标题。非 AI 时沿用 9.1d 的原文案。 */
export function externalConflictTitle(cause?: ExternalCause): string {
  return cause?.kind === 'ai' ? 'AI 已修改此文档' : '文档已在其他地方被修改'
}

/** 冲突对话框里说明原因的一句话；没有归因（如保存时才发现 409）时为空。 */
export function externalConflictCauseSentence(cause?: ExternalCause): string {
  if (!cause) return ''
  return cause.kind === 'ai'
    ? `${aiSubject(cause)}在你编辑期间修改了这份文档。`
    : '这份文档在你编辑期间被其他地方修改。'
}
