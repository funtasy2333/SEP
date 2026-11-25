/** PDF cover: share the DOCX cover's metadata rules and embedded logo assets. */
import type { IRDocMeta } from '../ir/types'
import type { DocumentStage } from '../types/document'
import type { BackCoverAlign, BackCoverBlock, BackCoverConfig, CoverLayoutConfig, WatermarkConfig } from '../types/template'
import { getCoverDesignation } from '../coverDesignation'
import { isReplaceMarkForbidden, parseCoverLogoDataUrl } from '../coverLayoutValidation'
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

function customLogoHtml(coverLayout: CoverLayoutConfig | undefined, meta: IRDocMeta): { replacedMark: boolean; html: string } {
  const logoCfg = coverLayout?.logo
  if (!logoCfg) return { replacedMark: false, html: '' }
  const parsed = parseCoverLogoDataUrl(logoCfg.dataUrl)
  if (!parsed) return { replacedMark: false, html: '' }

  const behind = logoCfg.wrap !== 'inline'
  const wrapClass = behind ? 'ses-cover-custom-logo-behind' : 'ses-cover-custom-logo-inline'
  const offsetX = logoCfg.offsetXMm ?? 0
  const offsetY = logoCfg.offsetYMm ?? 0
  const transformStyle = offsetX !== 0 || offsetY !== 0 ? `;transform:translate(${offsetX}mm,${offsetY}mm)` : ''
  const alt = text(logoCfg.alt?.trim() || '组织封面徽标')
  const imgTag = `<img src="${logoCfg.dataUrl}" alt="${alt}" style="width:${logoCfg.widthMm}mm;height:${logoCfg.heightMm}mm;object-fit:fill" />`
  const canReplace = logoCfg.position === 'replace_mark' && !isReplaceMarkForbidden(meta.standardType)
  if (canReplace) {
    return {
      replacedMark: true,
      html: `<div class="${wrapClass}" style="display:inline-block${transformStyle}">${imgTag}</div>`,
    }
  }
  const posClass = logoCfg.position === 'center' ? 'ses-cover-custom-logo-center' : 'ses-cover-custom-logo-top-left'
  return {
    replacedMark: false,
    html: `<div class="ses-cover-custom-logo ${posClass} ${wrapClass}"${transformStyle ? ` style="${transformStyle.slice(1)}"` : ''}>${imgTag}</div>`,
  }
}

export function renderCoverHtml(meta: IRDocMeta, stage: DocumentStage, coverLayout?: CoverLayoutConfig): string {
  const national = meta.standardType === 'gb' || meta.standardType === 'guide'
  const classes = `ses-cover-layout ses-cover-${text(meta.standardType)}${national ? ' ses-cover-national' : ''}`
  const customLogo = customLogoHtml(coverLayout, meta)
  const noticeText = coverLayout?.notice?.text?.trim() ?? ''
  const noticePos = coverLayout?.notice?.position

  const out = [`<section class="ses-cover" data-type="cover" data-standard-type="${text(meta.standardType)}"><div class="${classes}">`]
  out.push('<div class="ses-cover-codes">')
  if (meta.icsCode) out.push(`<div>ICS ${text(meta.icsCode)}</div>`)
  if (meta.ccsCode) out.push(`<div>CCS ${text(meta.ccsCode)}</div>`)
  if (meta.standardType === 'industry') out.push(`<div>备案号：${text(meta.filingNo ?? '')}</div>`)
  out.push('</div>')
  if (customLogo.replacedMark) {
    out.push(`<div class="ses-cover-logo ses-cover-logo-custom">${customLogo.html}</div>`)
  } else {
    const topRight = coverLayout?.topRightMark
    if (!national && topRight?.mode === 'hidden') {
      // 右上角标准标志已隐藏
    } else if (!national && topRight?.mode === 'text' && topRight.text?.trim()) {
      const sizePt = topRight.fontSizePt ?? 36
      out.push(`<div class="ses-cover-logo ses-cover-logo-text-custom" style="font-size:${sizePt}pt;font-family:var(--ses-song)">${text(topRight.text.trim())}</div>`)
    } else {
      out.push(`<div class="ses-cover-logo">${logo(meta)}</div>`)
    }
    if (customLogo.html) out.push(customLogo.html)
  }
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
  if (noticeText && noticePos === 'above_dates') {
    out.push(`<div class="ses-cover-notice ses-cover-notice-above-dates">${text(noticeText).replace(/\n/g, '<br />')}</div>`)
  }
  out.push(`<div class="ses-cover-dates"><span>${text(meta.publishDate?.trim() || 'XXXX-XX-XX')} 发布</span><span>${text(meta.implementDate?.trim() || 'XXXX-XX-XX')} 实施</span></div>`)
  out.push(`<div class="ses-cover-issuer">${national ? image(COVER_ASSETS.nationalIssuer, '国家标准发布机构与发布') : `${text(meta.issuer?.trim() ?? '')}　发　布`}</div>`)
  if (noticeText && noticePos === 'below_issuer') {
    out.push(`<div class="ses-cover-notice ses-cover-notice-below-issuer">${text(noticeText).replace(/\n/g, '<br />')}</div>`)
  }
  out.push('</div></section>')
  return out.join('\n')
}

function assertNeverBackCoverBlockHtml(block: never): never {
  throw new Error(`renderBackCoverHtml: unexpected block ${JSON.stringify(block)}`)
}

function cssAlign(align: BackCoverAlign | undefined, fallback: BackCoverAlign): string {
  return align ?? fallback
}

function renderBackCoverBlockHtml(block: BackCoverBlock): string {
  const mt = block.spaceBeforeMm !== undefined ? `${block.spaceBeforeMm}mm` : block.type === 'heading' ? '4mm' : '2mm'
  const mb = block.spaceAfterMm !== undefined ? `${block.spaceAfterMm}mm` : block.type === 'heading' ? '3mm' : '2mm'

  switch (block.type) {
    case 'heading':
    case 'paragraph': {
      const isHeading = block.type === 'heading'
      const fontPt = block.fontSizePt ?? (isHeading ? 15 : 10.5)
      const bold = block.bold ?? isHeading
      const align = cssAlign(block.align, isHeading ? 'center' : 'left')
      const fontFamily = isHeading ? 'var(--ses-hei)' : 'var(--ses-song)'
      const indent = !isHeading && block.indent ? 'text-indent:2em;' : ''
      const content = text(block.text).replace(/\r?\n/g, '<br />')
      return `<div class="ses-bc-block ses-bc-${block.type}" style="text-align:${align};font-family:${fontFamily};font-size:${fontPt}pt;font-weight:${bold ? 'bold' : 'normal'};margin:${mt} 0 ${mb};line-height:1.6;${indent}">${content}</div>`
    }
    case 'image': {
      const parsed = parseCoverLogoDataUrl(block.dataUrl)
      if (!parsed) return ''
      const align = cssAlign(block.align, 'center')
      return `<div class="ses-bc-block ses-bc-image" style="text-align:${align};margin:${mt} 0 ${mb};line-height:1"><img src="${block.dataUrl}" alt="封底图片" style="width:${block.widthMm}mm;height:${block.heightMm}mm;object-fit:fill" /></div>`
    }
    case 'divider':
      return `<hr class="ses-bc-divider" style="margin:${mt} 0 ${mb};border:0;border-top:0.75pt solid #333" />`
    default:
      return assertNeverBackCoverBlockHtml(block)
  }
}

export function renderBackCoverHtml(meta: IRDocMeta, backCover: BackCoverConfig): string {
  const vAlign = backCover.verticalAlign ?? 'bottom'
  const justify = vAlign === 'top' ? 'flex-start' : vAlign === 'middle' ? 'center' : 'flex-end'
  const boxClass = backCover.boxed ? ' ses-back-cover-boxed' : ''

  if (Array.isArray(backCover.blocks) && backCover.blocks.length > 0) {
    const body = backCover.blocks.map(renderBackCoverBlockHtml).filter(Boolean).join('\n')
    const inner = `<div class="ses-back-cover-blocks${boxClass}">${body}</div>`
    return [
      '<section class="ses-back-cover" data-type="back-cover">',
      `<div class="ses-back-cover-layout" style="justify-content:${justify};text-align:left">`,
      inner,
      '</div></section>',
    ].join('\n')
  }

  const lines = (raw: string | undefined, cls: string): string => {
    const trimmed = raw?.trim()
    if (!trimmed) return ''
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<div class="${cls}">${text(line)}</div>`)
      .join('\n')
  }

  const title = backCover.title?.trim() || meta.title?.trim() || ''
  const parts = [
    '<section class="ses-back-cover" data-type="back-cover">',
    `<div class="ses-back-cover-layout" style="justify-content:${justify}">`,
  ]
  if (title) parts.push(`<div class="ses-back-cover-title">${text(title)}</div>`)
  const bodyBlocks = [
    lines(backCover.copyrightNotice, 'ses-back-cover-copyright'),
    lines(backCover.publisherInfo, 'ses-back-cover-line'),
    lines(backCover.contactInfo, 'ses-back-cover-line'),
    lines(backCover.note, 'ses-back-cover-line'),
  ].filter(Boolean)
  if (bodyBlocks.length > 0) {
    parts.push(`<div class="ses-back-cover-meta">${bodyBlocks.join('\n')}</div>`)
  }
  parts.push('</div></section>')
  return parts.join('\n')
}

export function renderWatermarkLayerHtml(watermark: WatermarkConfig, forPreview = false): string {
  if (!watermark.enabled) return ''
  const opacity = watermark.opacity ?? 0.2
  const posCls = forPreview ? 'ses-watermark-preview-layer' : 'ses-watermark-print-layer'
  if (watermark.kind === 'text') {
    const wmText = watermark.text?.trim() || '内部草案'
    const fontSizePt = watermark.fontSizePt ?? 48
    const color = watermark.color ?? '#8c8c8c'
    const deg = watermark.rotationDeg ?? -45
    return `<div class="${posCls}" aria-hidden="true"><span class="ses-watermark-text" style="font-size:${fontSizePt}pt;color:${text(color)};opacity:${opacity};transform:rotate(${deg}deg)">${text(wmText)}</span></div>`
  }
  if (watermark.kind === 'image' && watermark.dataUrl) {
    const parsed = parseCoverLogoDataUrl(watermark.dataUrl)
    if (!parsed) return ''
    const w = watermark.widthMm ?? 90
    const h = watermark.heightMm ?? 90
    return `<div class="${posCls}" aria-hidden="true"><img class="ses-watermark-image" src="${watermark.dataUrl}" alt="正文水印" style="width:${w}mm;height:${h}mm;opacity:${opacity};object-fit:fill" /></div>`
  }
  return ''
}

export function renderWatermarkPreviewHtml(meta: IRDocMeta, watermark: WatermarkConfig): string {
  if (!watermark.enabled) return ''
  const stdCode = normalizeCoverStdCode(meta.stdCode) || '标准编号示例'
  const renderSamplePage = (pageNum: number, withWm: boolean) => [
    `<section class="ses-body-preview" data-page="${pageNum}">`,
    withWm ? renderWatermarkLayerHtml(watermark, true) : '',
    `<div class="ses-body-preview-hdr">${text(stdCode)}</div>`,
    '<div class="ses-body-preview-inner">',
    '<div class="ses-body-preview-title">1 范围（正文页水印示例）</div>',
    '<p class="ses-body-preview-p">本文件规定了标准化文件的编排格式、技术要素表达与相关排版要求，用于展示正文页水印及奇偶页应用频率效果。</p>',
    '<p class="ses-body-preview-p">本文件适用于各行业及团体标准化文件的起草与发布。</p>',
    '</div>',
    `<div class="ses-body-preview-ftr">第 ${pageNum} 页（${pageNum % 2 === 1 ? '奇数页' : '偶数页'}${withWm ? ' · 含水印' : ' · 无水印'}）</div>`,
    '</section>',
  ].join('\n')

  if (watermark.frequency === 'alternate') {
    return `${renderSamplePage(1, true)}\n${renderSamplePage(2, false)}`
  }
  return renderSamplePage(1, true)
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
.ses-cover-english { font-family: var(--ses-song); }
.ses-cover-english, .ses-cover-consistency, .ses-cover-stage { font-size: 14pt; line-height: 1.5; margin-bottom: 5mm; }
.ses-cover-patent { font-family: var(--ses-song); font-size: 10.5pt; line-height: 1.5; margin-top: 8mm; }
.ses-cover-dates { position: absolute; left: 25mm; right: 15mm; top: 249.6mm; display: flex; justify-content: space-between; padding-bottom: 4mm; border-bottom: 0.75pt solid black; font-size: 14pt; }
.ses-cover-issuer { position: absolute; left: 25mm; right: 15mm; top: 268.77mm; text-align: center; font-size: 14pt; }
.ses-cover-national .ses-cover-issuer { top: 261.57mm; }
`

export const COVER_LAYOUT_PRINT_CSS = `
@page back-cover {
  size: A4; margin: 0;
  @top-left { content: none; } @top-center { content: none; } @top-right { content: none; }
  @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; }
}
section.ses-back-cover { page: back-cover; break-before: page; break-after: page; }
.ses-back-cover-anchor { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
.ses-cover-codes, .ses-cover-logo, .ses-cover-designation, .ses-cover-number, .ses-cover-replaces, .ses-cover-rule, .ses-cover-titles, .ses-cover-dates, .ses-cover-issuer, .ses-cover-notice { z-index: 1; }
.ses-cover-custom-logo-behind { z-index: 0 !important; }
.ses-cover-custom-logo-inline { z-index: 2 !important; }
.ses-cover-custom-logo-top-left { position: absolute; left: 25mm; top: 23.5mm; line-height: 1; }
.ses-cover-custom-logo-center { position: absolute; left: 25mm; right: 15mm; top: 78mm; text-align: center; line-height: 1; }
.ses-cover-notice { position: absolute; left: 25mm; right: 15mm; text-align: center; font-family: var(--ses-song); font-size: 10.5pt; line-height: 1.45; }
.ses-cover-notice-above-dates { top: 232mm; }
.ses-cover-notice-below-issuer { top: 278mm; }
.ses-back-cover-layout { position: relative; width: 210mm; height: 297mm; box-sizing: border-box; padding: 34mm 20mm 25mm 25mm; display: flex; flex-direction: column; justify-content: space-between; text-align: center; font-family: var(--ses-song); }
.ses-back-cover-blocks { width: 100%; }
.ses-back-cover-boxed { border: 0.75pt solid #333; padding: 6mm 8mm; box-sizing: border-box; }
.ses-back-cover-title { font-family: var(--ses-hei); font-size: 16pt; font-weight: bold; margin-top: 10mm; }
.ses-back-cover-meta { margin-top: auto; margin-bottom: 12mm; font-size: 10.5pt; line-height: 1.6; }
.ses-back-cover-copyright { margin-bottom: 4mm; }
.ses-body-preview { position: relative; width: 210mm; height: 297mm; box-sizing: border-box; padding: 34mm 20mm 25mm 25mm; background: #fff; font-family: var(--ses-song); display: flex; flex-direction: column; overflow: hidden; }
.ses-body-preview-hdr { position: absolute; top: 15mm; left: 25mm; right: 20mm; text-align: right; font-family: var(--ses-hei); font-size: 10.5pt; border-bottom: 0.5pt solid #ccc; padding-bottom: 2mm; z-index: 1; }
.ses-body-preview-inner { position: relative; z-index: 1; font-size: 10.5pt; line-height: 1.8; }
.ses-body-preview-title { font-family: var(--ses-hei); font-size: 14pt; font-weight: bold; margin-bottom: 4mm; }
.ses-body-preview-p { text-indent: 2em; margin: 0 0 3mm; }
.ses-body-preview-ftr { margin-top: auto; text-align: center; font-size: 9pt; color: #666; position: relative; z-index: 1; }
.ses-watermark-preview-layer { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 0; overflow: hidden; }
.ses-watermark-print-layer { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 0; overflow: hidden; }
.ses-watermark-text { font-family: var(--ses-song); white-space: nowrap; user-select: none; }
`
