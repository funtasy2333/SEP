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
const FRAME_LOGO: NonNullable<CoverFrame> = { xMm: 143, yMm: 12.03, widthMm: 40 }
const FRAME_DB_LOGO: NonNullable<CoverFrame> = { xMm: 143, yMm: 16.53, widthMm: 22 }
const FRAME_DB_REGION: NonNullable<CoverFrame> = { xMm: 154.2, yMm: 3.5, widthMm: 40 }
const FRAME_DESIGNATION: NonNullable<CoverFrame> = { xMm: 25, yMm: 37.54, widthMm: 170 }
const FRAME_STD_NO: NonNullable<CoverFrame> = { xMm: 100, yMm: 54.59, widthMm: 90 }
const FRAME_REPLACES: NonNullable<CoverFrame> = { xMm: 100, yMm: 64.41, widthMm: 90 }
const FRAME_RULE: NonNullable<CoverFrame> = { xMm: 25, yMm: 69.16, widthMm: 170 }
const FRAME_TITLE_FLOW: NonNullable<CoverFrame> = { xMm: 25, yMm: 112.55, widthMm: 170 }
const FRAME_DATES: NonNullable<CoverFrame> = { xMm: 25, yMm: 249.6, widthMm: 170 }
const FRAME_ISSUER: NonNullable<CoverFrame> = { xMm: 25, yMm: 262.5, widthMm: 170 }

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
  const { relationshipId, mediaIndex } = registerImage(ctx, asset)
  return emitParagraph(ctx, 'SesCoverLogo', {
    runsXml: `<w:r>${imageDrawing(asset, relationshipId, mediaIndex, description)}</w:r>`,
    framePr,
  })
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

function industryLogoText(meta: IRDocMeta): string {
  const code = normalizeCoverStdCode(meta.stdCode)
  const family = /^([A-Z]{2,6})(?:\/T)?\s+\d+(?:\.\d+)*(?:—\d{4})?$/i.exec(code)?.[1]?.toUpperCase()
  // GB is national and DB is local; neither is an industry-family mark. Require a complete
  // family/serial code after normalization so malformed strings such as "HH malformed" stay XX.
  return family && family !== 'GB' && family !== 'DB' ? family : 'XX'
}

function localRegionCode(meta: IRDocMeta): string {
  const code = meta.stdCode ?? ''
  return /^DB([A-Z0-9]+)\/T(?=\s|\d)/i.exec(code)?.[1] ??
    /^DB([A-Z0-9]+)\s+\d/i.exec(code)?.[1] ?? ''
}

function renderLogo(ctx: RenderContext, meta: IRDocMeta): string {
  switch (meta.standardType) {
    case 'gb':
    case 'guide':
      return frameImage(ctx, COVER_ASSETS.gbLogo, 'GB 标志', FRAME_LOGO)
    case 'local': {
      warn(ctx, 'cover-asset-approximation', 'DB 标志使用仓库 TIFF 转换素材，原始来源未核实')
      return frameImage(ctx, COVER_ASSETS.dbLogo, 'DB 标志', FRAME_DB_LOGO) +
        frameText(ctx, 'SesCoverDbRegion', localRegionCode(meta), FRAME_DB_REGION)
    }
    case 'industry':
      warn(ctx, 'cover-asset-approximation', '行业代号标志使用黑体加粗可编辑文字近似专用美术体')
      return frameText(ctx, 'SesCoverLogoText', industryLogoText(meta), { ...FRAME_LOGO, yMm: 3.5 })
    case 'group':
      warn(ctx, 'cover-asset-approximation', '团体标准按国标布局近似；T 标志暂无合格来源素材，使用黑体加粗可编辑文字近似')
      return frameText(ctx, 'SesCoverGroupLogo', 'T', { ...FRAME_LOGO, xMm: 139.1, yMm: 3.44, widthMm: 44 })
    case 'enterprise':
      warn(ctx, 'cover-asset-approximation', '企业标准按国标布局近似；Q 标志暂无合格来源素材，使用黑体加粗可编辑文字近似')
      return frameText(ctx, 'SesCoverEnterpriseLogo', 'Q', { ...FRAME_LOGO, xMm: 141, yMm: 3.3, widthMm: 41.7 })
  }
}

function issuerReleaseRuns(issuer: string): string {
  return (issuer ? plainRun(issuer) + plainRun('　', RELEASE_LABEL_RPR) : '') + plainRun('发　布', RELEASE_TEXT_RPR)
}

function renderIssuer(ctx: RenderContext, meta: IRDocMeta): string {
  if (meta.standardType === 'gb' || meta.standardType === 'guide') {
    // Use the fixed two-line raster cut from the 2020 source cover; meta.issuer cannot customize it.
    const { relationshipId, mediaIndex } = registerImage(ctx, COVER_ASSETS.nationalIssuer)
    return emitParagraph(ctx, 'SesCoverIssuer', {
      runsXml: `<w:r>${imageDrawing(COVER_ASSETS.nationalIssuer, relationshipId, mediaIndex, '国家标准发布机构')}</w:r>` +
        plainRun('　', RELEASE_LABEL_RPR) + plainRun('发　布', RELEASE_TEXT_RPR),
      framePr: FRAME_ISSUER,
    })
  }

  const issuer = meta.issuer?.trim() ?? ''
  if (!issuer) warn(ctx, 'cover-field-missing', 'meta.issuer 缺失，非国标发布机构名称留空')
  else warn(ctx, 'cover-asset-approximation', '非国标发布机构用宋体加粗小二可编辑文字近似专用字')
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
