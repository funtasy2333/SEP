import type { CreateDocumentDto, Document, DocumentMeta, PMJsonNode } from '@ses/shared'

const COVER_META_KEYS = [
  'standardType', 'standardNo', 'titleCn', 'titleEn', 'icsCode', 'ccsCode', 'issuer',
  'publishDate', 'implementDate', 'replaces', 'consistency', 'filingNo', 'industryName', 'regionName', 'coverDesignation',
] as const satisfies ReadonlyArray<keyof DocumentMeta>

/** 复制正文为独立对象，并把库中明确保存的封面元数据同步到副本供XML读取。 */
export function createDocumentDuplicate(source: Pick<Document, 'title' | 'meta' | 'content'>): CreateDocumentDto {
  const title = `${source.meta.titleCn || source.title}（副本）`
  const meta: DocumentMeta = { ...source.meta, titleCn: title }
  const content = JSON.parse(JSON.stringify(source.content)) as Record<string, unknown>
  // 空内容仍走编辑器已有的初始化路径，不把它改成只有封面的不完整正文。
  if (Array.isArray(content.content) && content.content.length > 0) {
    const nodes = content.content as PMJsonNode[]
    const rootAttrs = content.attrs && typeof content.attrs === 'object'
      ? content.attrs as Record<string, unknown> : undefined
    const cover = nodes.find((node) => node.type === 'coverPage')
    const attrs: Record<string, unknown> = {}
    for (const key of COVER_META_KEYS) {
      // 缺省字段继续允许原封面回退；明确的空值则清除旧值，保持DOCX显式元数据覆盖契约。
      if (meta[key] !== undefined) attrs[key] = meta[key]
      else if (!cover && rootAttrs?.[key] !== undefined) attrs[key] = rootAttrs[key]
    }
    if (cover) cover.attrs = { ...cover.attrs, ...attrs }
    else nodes.unshift({ type: 'coverPage', attrs, content: [{ type: 'paragraph' }] })

    // 兼容旧JSON根属性优先于封面的读取规则，避免旧题名再次盖过同步后的封面。
    if (rootAttrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (Object.prototype.hasOwnProperty.call(rootAttrs, key)) rootAttrs[key] = value
      }
    }
  }
  return { title, meta, stage: 'working_draft', content }
}
