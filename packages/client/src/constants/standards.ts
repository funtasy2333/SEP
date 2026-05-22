/* Shared constants for stage / type labels.
   Single source of truth used by HomeView, EditorView, DocCard, NewDocDialog. */

export const STAGE_LABELS: Record<string, string> = {
  working_draft: '工作草案',
  comment_draft: '征求意见稿',
  review_discussion_draft: '送审讨论稿',
  review_draft: '送审稿',
  approval_draft: '报批稿',
  public_draft: '公示稿',
  published: '发布稿',
}

export const STAGE_SHORT: Record<string, string> = {
  working_draft: 'WD',
  comment_draft: 'CD',
  review_discussion_draft: 'RDD',
  review_draft: 'RD',
  approval_draft: 'AD',
  public_draft: 'PD',
  published: 'PUB',
}

export const STAGES = [
  'working_draft',
  'comment_draft',
  'review_discussion_draft',
  'review_draft',
  'approval_draft',
  'public_draft',
  'published',
] as const

export const TYPE_LABELS: Record<string, string> = {
  national: '国家标准',
  industry: '行业标准',
  local: '地方标准',
  group: '团体标准',
  enterprise: '企业标准',
  guidance: '指导性技术文件',
}

export const TYPE_DEFS = [
  { id: 'national',   glyph: '国', name: '国家标准',         code: 'GB / GB/T',         prefix: 'GB/T' },
  { id: 'industry',   glyph: '行', name: '行业标准',         code: 'SJ / DL / JC / …',  prefix: 'SJ/T' },
  { id: 'local',      glyph: '地', name: '地方标准',         code: 'DB',                prefix: 'DB31/T' },
  { id: 'group',      glyph: '团', name: '团体标准',         code: 'T/',                prefix: 'T/CESA' },
  { id: 'enterprise', glyph: '企', name: '企业标准',         code: 'Q/',                prefix: 'Q/COMPANY' },
  { id: 'guidance',   glyph: '导', name: '指导性技术文件',   code: 'GB/Z',              prefix: 'GB/Z' },
] as const
