import type { SesImportPreview } from '@/api/document'

export type SesImportPrompt =
  | { kind: 'new'; details: string[] }
  | { kind: 'trash'; details: string[] }
  | { kind: 'match'; details: string[] }

/** 把 preview 数据转为确认框可直接展示的安全文本，不经过 HTML 插值。 */
export function sesImportPromptOf(preview: SesImportPreview): SesImportPrompt {
  if (!preview.match) return { kind: 'new', details: [] }
  if (preview.inTrash) {
    return {
      kind: 'trash',
      details: ['同一文档已在回收站。请先恢复，或另存为新文档。'],
    }
  }

  // 最新稿包不含版本历史：本地「独有」版本只是包里没带，不是对方删除，所以不展示版本数量。
  const latestOnly = preview.versionScope === 'latest'
  const details = latestOnly
    ? ['此文档包只含最新稿，不含版本历史；本地已有版本全部保留。']
    : [`包中新增 ${preview.newVersions} 个版本；本地独有 ${preview.localOnlyVersions} 个版本。`]
  details.push(
    preview.contentDiffers
      ? '正文不同：包正文成为当前正文。版本历史会记录本次导入，可查看本次修改或回滚到导入前。'
      : latestOnly
        ? '正文相同，导入不会追加版本，不改动当前正文。'
        : '正文相同，导入只追加版本，不改动当前正文。',
  )
  if (preview.versionNoCollisions.length > 0) {
    details.push(`版本号冲突：${preview.versionNoCollisions.join('、')}；导入时会续编并在说明中保留原版本号。`)
  }
  return { kind: 'match', details }
}

function messageOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (Array.isArray(value)) {
    const messages = value.map(messageOf).filter((message): message is string => Boolean(message))
    return messages.length ? messages.join('；') : undefined
  }
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return messageOf((value as { message?: unknown }).message)
  }
  return undefined
}

function responseData(error: unknown): { status?: number; data?: unknown } | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const response = (error as { response?: unknown }).response
  if (typeof response !== 'object' || response === null) return undefined
  const candidate = response as { status?: unknown; data?: unknown }
  return {
    ...(typeof candidate.status === 'number' ? { status: candidate.status } : {}),
    ...(candidate.data === undefined ? {} : { data: candidate.data }),
  }
}

export function sesImportStatus(error: unknown): number | undefined {
  return responseData(error)?.status
}

/** 提取 Nest 错误体里的 message；Blob 错误体也读取 JSON，而不是显示成 [object Blob]。 */
export async function sesImportErrorMessage(error: unknown): Promise<string> {
  const data = responseData(error)?.data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const body = await data.text().catch(() => '')
    try {
      const message = messageOf(JSON.parse(body))
      if (message) return message
    } catch {
      if (body.trim()) return body
    }
  }
  const fromBody = messageOf(data)
  if (fromBody) return fromBody
  return error instanceof Error && error.message ? error.message : String(error)
}
