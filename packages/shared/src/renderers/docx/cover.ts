/**
 * 六类 DOCX 封面（docs/wp7-docx-delivery.md §6）。
 *
 * 所有段落都经 body/context.ts 的 emitParagraph 输出；图文框位置使用页面坐标，
 * 封面素材来自本模块之外的静态 PNG 常量，host 仍负责打包而 shared 不访问文件或浏览器 API。
 */

import type { IRDocMeta } from '../../ir/types'
import type { DocumentStage } from '../../types/document'
import { COVER_ASSETS } from './assets'
import type { DocxRelatedPart } from './package'
import { mmToEmu } from './units'
import { emitParagraph, warn, type RenderContext } from './body/context'
import { plainRun, tabRun } from './body/inline'
import { escapeXmlAttr } from './xml'
import { buildCoverReleaseRunPr } from './styles'

type CoverFrame = NonNullable<Parameters<typeof emitParagraph>[2]>['framePr']
type CoverAsset = typeof COVER_ASSETS[keyof typeof COVER_ASSETS]

// Word for Mac 16.113.3，300dpi墨迹校准值；§6.1的图文框列只是起始值。
const FRAME_CODES: NonNullable<CoverFrame> = { xMm: 25, yMm: 9.17, widthMm: 90 }
const FRAME_LOGO: NonNullable<CoverFrame> = { xMm: 139.01, yMm: 12.03, widthMm: 40 }
const FRAME_MARKS = {
  industry: { xMm: 100, yMm: 18.30, widthMm: 81.06 },
  local: { xMm: 100, yMm: 14.50, widthMm: 81.48 },
  group: { xMm: 100, yMm: 19.15, widthMm: 83.25 },
  enterprise: { xMm: 100, yMm: 14.50, widthMm: 83.17 },
} as const
const FRAME_DESIGNATION: NonNullable<CoverFrame> = { xMm: 25, yMm: 37.54, widthMm: 170 }
const FRAME_STD_NO: NonNullable<CoverFrame> = { xMm: 100, yMm: 54.59, widthMm: 90 }
const FRAME_REPLACES: NonNullable<CoverFrame> = { xMm: 100, yMm: 64.41, widthMm: 90 }
const FRAME_RULE: NonNullable<CoverFrame> = { xMm: 25, yMm: 69.16, widthMm: 170 }
const FRAME_TITLE_FLOW: NonNullable<CoverFrame> = { xMm: 25, yMm: 112.55, widthMm: 170 }
const FRAME_DATES: NonNullable<CoverFrame> = { xMm: 25, yMm: 249.6, widthMm: 170 }
const FRAME_ISSUER: NonNullable<CoverFrame> = { xMm: 25, yMm: 268.77, widthMm: 170 }
const FRAME_NATIONAL_ISSUERS = {
  gb: { xMm: 25, yMm: 261.57, widthMm: 170 },
  guide: { xMm: 25, yMm: 263.34, widthMm: 170 },
} as const
const SMALL_MARK_GAP_RPR = '<w:rPr><w:b w:val="0"/><w:bCs w:val="0"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>'

const RELEASE_LABEL_RPR = buildCoverReleaseRunPr(false)
const RELEASE_TEXT_RPR = buildCoverReleaseRunPr(true)

const IMAGE_NAMESPACES =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

const STAGE_LABELS: Record<DocumentStage, string | undefined> = {
  working_draft: '（工作草案）',
  comment_draft: '（征求意见稿）',
  review_discussion_draft: '（送审讨论稿）',
  review_draft: '（送审稿）',
  approval_draft: '（报批稿）',
  public_draft: '（公示稿）',
  published: undefined,
}

/** 封面与 STYLEREF 缓存共用，避免目视编号和书眉缓存显示不同字符串。 */
export function normalizeCoverStdCode(stdCode: string | undefined): string {
  const code = stdCode?.trim().replace(/\s+/g, ' ')
  if (!code) return ''

  // GB 的代号固定，紧贴序号时可安全拆分（如 GB12345）；DB 地方代码只有在 /T 或空格
  // 明确了地方代码边界时才拆（DB33 123），以免把 DB33123 中的行政代码数字切开。
  // 行业代号允许 /T 和旧式紧接数字写法（HG1234）。T/Q 团体/企业代号则必须有空格，
  // 否则 Q/TEST123 里的数字可能仍属于机构代号，不能由渲染器猜测。
  const match =
    /^(GB(?:\/[TZ])?)\s*(\d+(?:\.\d+)*)(.*)$/i.exec(code) ??
    /^(DB[A-Z0-9]+\/T)\s*(\d+(?:\.\d+)*)(.*)$/i.exec(code) ??
    /^(DB[A-Z0-9]+)\s+(\d+(?:\.\d+)*)(.*)$/i.exec(code) ??
    /^([A-Z]{2,6}\/[TZ])\s*(\d+(?:\.\d+)*)(.*)$/i.exec(code) ??
    /^([TQ]\/[^\s]+)\s+(\d+(?:\.\d+)*)(.*)$/i.exec(code) ??
    (!/^DB/i.test(code) ? /^([A-Z]{2,6})\s*(\d+(?:\.\d+)*)(.*)$/i.exec(code) : null)
  const normalized = match ? `${match[1]} ${match[2]}${match[3]}` : code
  return normalized.replace(/\s*[-‐‑‒–—－]\s*(\d{4})$/, '—$1')
}

function frameText(ctx: RenderContext, styleId: string, text: string, framePr: NonNullable<CoverFrame>): string {
  return emitParagraph(ctx, styleId, { runsXml: plainRun(text), framePr })
}

function imageRun(ctx: RenderContext, asset: CoverAsset, description: string): string {
  const { relationshipId, mediaIndex } = registerImage(ctx, asset)
  return `<w:r>${imageDrawing(asset, relationshipId, mediaIndex, description)}</w:r>`
}

function frameRuns(ctx: RenderContext, styleId: string, runsXml: string, framePr: NonNullable<CoverFrame>): string {
  return emitParagraph(ctx, styleId, { runsXml, framePr })
}

function smallMarkGap(chineseFont = false): string {
  // 模板 DB/T 图片后的空格使用中文字体度量；Q 的斜杠后保持西文字体度量。
  const rPr = chineseFont
    ? SMALL_MARK_GAP_RPR.replace('<w:rPr>', '<w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/>')
    : SMALL_MARK_GAP_RPR
  return plainRun(' ', rPr)
}

function imageDrawing(asset: CoverAsset, relationshipId: string, mediaIndex: number, description: string): string {
  const cx = mmToEmu(asset.widthMm)
  const cy = mmToEmu(asset.heightMm)
  const name = escapeXmlAttr(`Cover image ${mediaIndex}`)
  const descr = escapeXmlAttr(description)
  const rid = escapeXmlAttr(relationshipId)
  return `<w:drawing ${IMAGE_NAMESPACES}><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${mediaIndex}" name="${name}" descr="${descr}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr>' +
    `<pic:cNvPr id="${mediaIndex}" name="${name}" descr="${descr}"/><pic:cNvPicPr/>` +
    '</pic:nvPicPr><pic:blipFill>' +
    `<a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch>` +
    '</pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
}

function frameImage(
  ctx: RenderContext,
  asset: CoverAsset,
  description: string,
  framePr: NonNullable<CoverFrame>,
): string {
  return frameRuns(ctx, 'SesCoverLogo', imageRun(ctx, asset, description), framePr)
}

function registerImage(ctx: RenderContext, asset: CoverAsset): { relationshipId: string; mediaIndex: number } {
  const { relationshipId, mediaIndex } = ctx.allocateImage()
  const relatedPart: DocxRelatedPart = {
    id: relationshipId,
    target: `word/media/image${mediaIndex}.png`,
    relationshipType: IMAGE_REL,
    content: asset.base64,
    binary: true,
  }
  ctx.relatedParts.push(relatedPart)
  return { relationshipId, mediaIndex }
}

function designation(meta: IRDocMeta): { text: string; styleId: string } {
  switch (meta.standardType) {
    case 'gb': return { text: '中华人民共和国国家标准', styleId: 'SesCoverDesignationGb' }
    case 'guide': return { text: '中华人民共和国国家标准化指导性技术文件', styleId: 'SesCoverDesignationGuide' }
    case 'industry': return { text: `中华人民共和国${meta.industryName ?? ''}行业标准`, styleId: 'SesCoverDesignationOther' }
    case 'local': return { text: `${meta.regionName ?? ''}地方标准`, styleId: 'SesCoverDesignationOther' }
    case 'group': return { text: '团体标准', styleId: 'SesCoverDesignationOther' }
    case 'enterprise': return { text: '企业标准', styleId: 'SesCoverDesignationOther' }
  }
}

// 新建草案使用显式 XXXXX—XXXX 占位编号；已填写的家族/地区/机构代码仍应显示。
function industryLogoFamily(meta: IRDocMeta): string | undefined {
  const code = normalizeCoverStdCode(meta.stdCode)
  const family = /^([A-Z]{2,6})(?:\/T)?\s+(?:\d+(?:\.\d+)*|XXXXX)(?:—(?:\d{4}|XXXX))?$/i.exec(code)?.[1]?.toUpperCase()
  // GB is national and DB is local; neither is an industry-family mark. Require a complete
  // family/serial code after normalization so malformed strings such as "HH malformed" stay XX.
  return family && family !== 'GB' && family !== 'DB' ? family : undefined
}

function warnMissingMarkCode(ctx: RenderContext, meta: IRDocMeta, code: string, message: string): void {
  if (meta.stdCode?.trim() && !code) warn(ctx, 'cover-field-missing', message)
}

function localRegionCode(meta: IRDocMeta): string {
  const code = normalizeCoverStdCode(meta.stdCode)
  return /^DB(\d{2}|\d{4}|XX)(?:\/T)?\s+(?:\d+(?:\.\d+)*|XXXXX)(?:—(?:\d{4}|XXXX))?$/i.exec(code)?.[1] ?? ''
}

function typeMarkCode(meta: IRDocMeta, type: 'T' | 'Q'): string {
  const code = normalizeCoverStdCode(meta.stdCode)
  const match = /^([TQ])\/([^\s]+)\s+(?:\d+(?:\.\d+)*|XXXXX)(?:—(?:\d{4}|XXXX))?$/i.exec(code)
  return match?.[1]?.toUpperCase() === type ? match[2]! : ''
}

function renderLogo(ctx: RenderContext, meta: IRDocMeta): string {
  switch (meta.standardType) {
    case 'gb':
    case 'guide':
      return frameImage(ctx, COVER_ASSETS.gbLogo, 'GB 标志', FRAME_LOGO)
    case 'local': {
      warn(ctx, 'cover-asset-approximation', '地方标准 DB 标志采用用户提供模板 TIFF 转换素材，原始来源未核实')
      const region = localRegionCode(meta)
      warnMissingMarkCode(ctx, meta, region, 'meta.stdCode 无法可靠提取地方标准地区代码，封面仅显示 DB 标志')
      return frameRuns(
        ctx,
        'SesCoverDbRegion',
        imageRun(ctx, COVER_ASSETS.dbLogo, 'DB 地方标准标志') + (region ? smallMarkGap(true) + plainRun(region) : ''),
        FRAME_MARKS.local,
      )
    }
    case 'industry': {
      warn(ctx, 'cover-asset-approximation', '行业代号采用用户模板中的可编辑字样；行业专用标志字形尚未核验')
      const family = industryLogoFamily(meta)
      const mark = family ?? 'XX'
      warnMissingMarkCode(ctx, meta, family ?? '', 'meta.stdCode 无法可靠提取行业代号，封面标志显示 XX')
      return frameText(ctx, 'SesCoverLogoText', mark, FRAME_MARKS.industry)
    }
    case 'group': {
      warn(ctx, 'cover-asset-approximation', '团体标准标志采用用户提供模板图片，原始来源未核实')
      const code = typeMarkCode(meta, 'T')
      warnMissingMarkCode(ctx, meta, code, 'meta.stdCode 无法可靠提取团体标准机构代码，封面仅显示 T/ 标志')
      return frameRuns(
        ctx,
        'SesCoverGroupLogo',
        imageRun(ctx, COVER_ASSETS.groupLogo, '团体标准 T 标志') +
          imageRun(ctx, COVER_ASSETS.groupSlash, '团体标准斜线标志') +
          (code ? smallMarkGap(true) + plainRun(code) : ''),
        FRAME_MARKS.group,
      )
    }
    case 'enterprise': {
      warn(ctx, 'cover-asset-approximation', '企业标准 Q 标志采用用户提供模板图片（34×35 px，72 dpi），清晰度有限且原始来源未核实')
      const code = typeMarkCode(meta, 'Q')
      warnMissingMarkCode(ctx, meta, code, 'meta.stdCode 无法可靠提取企业标准机构代码，封面仅显示 Q 标志')
      return frameRuns(
        ctx,
        'SesCoverEnterpriseLogo',
        imageRun(ctx, COVER_ASSETS.enterpriseLogo, '企业标准 Q 标志') +
          (code ? plainRun('/') + smallMarkGap() + plainRun(code) : ''),
        FRAME_MARKS.enterprise,
      )
    }
  }
}

function issuerReleaseRuns(issuer: string): string {
  return (issuer ? plainRun(issuer) + plainRun('　', RELEASE_LABEL_RPR) : '') + plainRun('发　布', RELEASE_TEXT_RPR)
}

function renderIssuer(ctx: RenderContext, meta: IRDocMeta): string {
  if (meta.standardType === 'gb' || meta.standardType === 'guide') {
    // 图片已经包含固定的两行发布机构和「发布」；meta.issuer 不能定制国家标准机构名称。
    warn(ctx, 'cover-asset-approximation', '国家标准发布机构与「发布」采用用户提供模板整幅图片，来源未核实且机构文字固定为模板内容')
    return frameRuns(ctx, 'SesCoverIssuer', imageRun(ctx, COVER_ASSETS.nationalIssuer, '国家标准发布机构与发布'), FRAME_NATIONAL_ISSUERS[meta.standardType])
  }

  const issuer = meta.issuer?.trim() ?? ''
  if (!issuer) warn(ctx, 'cover-field-missing', 'meta.issuer 缺失，非国标发布机构名称留空')
  else warn(ctx, 'cover-asset-approximation', '非国标发布机构按用户模板用黑体四号可编辑文字排版，专用机构字形未核验')
  return emitParagraph(ctx, 'SesCoverIssuer', {
    runsXml: issuerReleaseRuns(issuer),
    framePr: FRAME_ISSUER,
  })
}

/** 按元数据和阶段生成封面，始终保留且只输出一个 SesCoverStdNo 段。 */
export function renderCover(ctx: RenderContext, meta: IRDocMeta, stage: DocumentStage): string {
  let xml = ''

  const codeLines: string[] = []
  if (meta.icsCode) codeLines.push(`ICS ${meta.icsCode}`)
  if (meta.ccsCode) codeLines.push(`CCS ${meta.ccsCode}`)
  if (meta.standardType === 'industry') codeLines.push(`备案号：${meta.filingNo ?? ''}`)
  if (codeLines.length > 0) xml += frameText(ctx, 'SesCoverIcs', codeLines.join('\n'), FRAME_CODES)

  if (meta.standardType === 'industry' && !meta.industryName?.trim()) {
    warn(ctx, 'cover-field-missing', 'meta.industryName 缺失，封面标准称谓中的行业名称留空')
  }
  if (meta.standardType === 'local' && !meta.regionName?.trim()) {
    warn(ctx, 'cover-field-missing', 'meta.regionName 缺失，封面标准称谓中的地方名称留空')
  }

  xml += renderLogo(ctx, meta)

  const heading = designation(meta)
  xml += frameText(ctx, heading.styleId, heading.text, { ...FRAME_DESIGNATION, xMm: meta.standardType === 'gb' || meta.standardType === 'guide' ? 24.7 : 25, yMm: meta.standardType === 'gb' || meta.standardType === 'guide' ? 37.54 : 40.12, widthMm: meta.standardType === 'guide' ? 171 : 170 })

  const stdCode = normalizeCoverStdCode(meta.stdCode)
  if (!stdCode) warn(ctx, 'cover-field-missing', 'meta.stdCode 缺失，封面文件编号段输出空段')
  xml += emitParagraph(ctx, 'SesCoverStdNo', {
    runsXml: stdCode ? plainRun(stdCode) : '',
    framePr: FRAME_STD_NO,
  })

  if (meta.replaces) {
    xml += frameText(ctx, 'SesCoverReplaces', `代替 ${normalizeCoverStdCode(meta.replaces)}`, FRAME_REPLACES)
  }

  xml += emitParagraph(ctx, 'SesCoverRule', { framePr: FRAME_RULE })

  // 正文首页名称会为缺失的 meta.title 记录 cover-field-missing；封面保留空段但不重复告警。
  xml += frameText(ctx, 'SesCoverName', meta.title ?? '', FRAME_TITLE_FLOW)
  if (meta.titleEn && ['gb', 'guide', 'industry', 'group'].includes(meta.standardType)) {
    xml += frameText(ctx, 'SesCoverEnglish', meta.titleEn, FRAME_TITLE_FLOW)
  }
  if (meta.consistency) xml += frameText(ctx, 'SesCoverConsistency', meta.consistency, FRAME_TITLE_FLOW)
  const stageLabel = STAGE_LABELS[stage]
  if (stageLabel) xml += frameText(ctx, 'SesCoverStage', stageLabel, FRAME_TITLE_FLOW)
  if (stage === 'comment_draft' || stage === 'review_draft') {
    xml += frameText(ctx, 'SesCoverPatent', '在提交反馈意见时，请将您知道的相关专利连同支持性文件一并附上。', FRAME_TITLE_FLOW)
  }

  const dates: string[] = []
  if (meta.publishDate) dates.push(`${meta.publishDate} 发布`)
  if (meta.implementDate) dates.push(`${meta.implementDate} 实施`)
  if (dates.length > 0) {
    const runs = dates.length === 2
      ? plainRun(dates[0]) + tabRun() + plainRun(dates[1])
      : meta.publishDate
        ? plainRun(dates[0])
        : tabRun() + plainRun(dates[0])
    xml += emitParagraph(ctx, 'SesCoverDates', { runsXml: runs, framePr: FRAME_DATES })
  }

  xml += renderIssuer(ctx, meta)
  return xml
}
