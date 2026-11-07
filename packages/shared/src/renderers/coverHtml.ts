/** PDF cover: share the DOCX cover's metadata rules and embedded logo assets. */
import type { IRDocMeta } from '../ir/types'
import type { DocumentStage } from '../types/document'
import { getCoverDesignation } from '../coverDesignation'
import { COVER_ASSETS } from './docx/assets'
import { industryLogoFamily, localRegionCode, normalizeCoverStdCode, STAGE_LABELS, typeMarkCode } from './docx/cover'

function text(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function image(asset: typeof COVER_ASSETS[keyof typeof COVER_ASSETS], alt: string): string {
  return `<img src="data:image/png;base64,${asset.base64}" alt="${alt}" style="width:${asset.widthMm}mm;height:${asset.heightMm}mm" />`
}

function logo(meta: IRDocMeta): string {
  switch (meta.standardType) {
    case 'gb':
    case 'guide': return image(COVER_ASSETS.gbLogo, 'GB 标志')
    case 'local': return image(COVER_ASSETS.dbLogo, 'DB 地方标准标志') + text(localRegionCode(meta))
    case 'industry': return text(industryLogoFamily(meta) ?? 'XX')
    case 'group': return image(COVER_ASSETS.groupLogo, '团体标准 T 标志') + image(COVER_ASSETS.groupSlash, '团体标准斜线标志') + text(typeMarkCode(meta, 'T'))
    case 'enterprise': return image(COVER_ASSETS.enterpriseLogo, '企业标准 Q 标志') + '/' + text(typeMarkCode(meta, 'Q'))
  }
}

export function renderCoverHtml(meta: IRDocMeta, stage: DocumentStage): string {
  const national = meta.standardType === 'gb' || meta.standardType === 'guide'
  const classes = `ses-cover-layout ses-cover-${text(meta.standardType)}${national ? ' ses-cover-national' : ''}`
  const out = [`<section class="ses-cover" data-type="cover" data-standard-type="${text(meta.standardType)}"><div class="${classes}">`]
  out.push('<div class="ses-cover-codes">')
  if (meta.icsCode) out.push(`<div>ICS ${text(meta.icsCode)}</div>`)
  if (meta.ccsCode) out.push(`<div>CCS ${text(meta.ccsCode)}</div>`)
  if (meta.standardType === 'industry') out.push(`<div>备案号：${text(meta.filingNo ?? '')}</div>`)
  out.push('</div>')
  out.push(`<div class="ses-cover-logo">${logo(meta)}</div>`)
  out.push(`<div class="ses-cover-designation">${text(getCoverDesignation(meta))}</div>`)
  out.push(`<div class="ses-cover-number">${text(normalizeCoverStdCode(meta.stdCode))}</div>`)
  if (meta.replaces) out.push(`<div class="ses-cover-replaces">代替 ${text(normalizeCoverStdCode(meta.replaces))}</div>`)
  out.push('<div class="ses-cover-rule"></div><div class="ses-cover-titles">')
  out.push(`<div class="ses-cover-title">${text(meta.title ?? '').replace(/\n/g, '<br />')}</div>`)
  if (meta.titleEn && meta.standardType !== 'enterprise') out.push(`<div class="ses-cover-english" lang="en">${text(meta.titleEn).replace(/\n/g, '<br />')}</div>`)
  if (meta.consistency) out.push(`<div class="ses-cover-consistency">${text(meta.consistency)}</div>`)
  const stageLabel = STAGE_LABELS[stage]
  if (stageLabel) out.push(`<div class="ses-cover-stage">${text(stageLabel)}</div>`)
  if (stage === 'comment_draft' || stage === 'review_draft') {
    out.push('<div class="ses-cover-patent">在提交反馈意见时，请将您知道的相关专利连同支持性文件一并附上。</div>')
  }
  out.push('</div>')
  out.push(`<div class="ses-cover-dates"><span>${text(meta.publishDate?.trim() || 'XXXX-XX-XX')} 发布</span><span>${text(meta.implementDate?.trim() || 'XXXX-XX-XX')} 实施</span></div>`)
  out.push(`<div class="ses-cover-issuer">${national ? image(COVER_ASSETS.nationalIssuer, '国家标准发布机构与发布') : `${text(meta.issuer?.trim() ?? '')}　发　布`}</div>`)
  out.push('</div></section>')
  return out.join('\n')
}

export const COVER_PRINT_CSS = `
/* A4 cover has no running header, footer or printed page number. */
@page cover {
  size: A4; margin: 0;
  @top-left { content: none; } @top-center { content: none; } @top-right { content: none; }
  @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; }
}
section.ses-cover { page: cover; break-after: page; }
.ses-cover-layout { position: relative; width: 210mm; height: 297mm; box-sizing: border-box; text-align: left; font-family: var(--ses-hei); }
.ses-cover-codes { position: absolute; left: 25mm; top: 9.17mm; font-size: 10.5pt; line-height: 1.5; }
.ses-cover-logo { position: absolute; right: 25mm; top: 14.5mm; font-family: var(--ses-song); font-size: 48pt; font-weight: bold; line-height: 1; white-space: nowrap; }
.ses-cover-logo img { vertical-align: baseline; }
.ses-cover-national .ses-cover-logo { top: 12.03mm; right: 30.99mm; }
.ses-cover-designation { position: absolute; left: 25mm; right: 15mm; top: 40.12mm; font-size: 24pt; text-align: justify; text-align-last: justify; line-height: 1.3; }
.ses-cover-national .ses-cover-designation { top: 37.54mm; font-family: var(--ses-song); font-size: 26pt; font-weight: bold; }
.ses-cover-guide .ses-cover-designation { font-size: 21pt; }
.ses-cover-number, .ses-cover-replaces { position: absolute; left: 25mm; right: 15mm; text-align: right; }
.ses-cover-number { top: 54.59mm; font-size: 14pt; }
.ses-cover-replaces { top: 64.41mm; font-size: 10.5pt; }
.ses-cover-rule { position: absolute; left: 25mm; right: 15mm; top: 69.16mm; border-top: 0.75pt solid black; }
.ses-cover-titles { position: absolute; left: 25mm; right: 15mm; top: 112.55mm; text-align: center; overflow-wrap: anywhere; }
.ses-cover-title { font-size: 26pt; line-height: 1.4; margin-bottom: 8mm; }
.ses-cover-english, .ses-cover-consistency, .ses-cover-stage { font-size: 14pt; line-height: 1.5; margin-bottom: 5mm; }
.ses-cover-patent { font-family: var(--ses-song); font-size: 10.5pt; line-height: 1.5; margin-top: 8mm; }
.ses-cover-dates { position: absolute; left: 25mm; right: 15mm; top: 249.6mm; display: flex; justify-content: space-between; padding-bottom: 4mm; border-bottom: 0.75pt solid black; font-size: 14pt; }
.ses-cover-issuer { position: absolute; left: 25mm; right: 15mm; top: 268.77mm; text-align: center; font-size: 14pt; }
.ses-cover-national .ses-cover-issuer { top: 261.57mm; }
`
