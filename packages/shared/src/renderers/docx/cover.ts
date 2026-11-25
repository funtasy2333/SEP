/**
 * 六类 DOCX 封面（docs/wp7-docx-delivery.md §6）。
 *
 * 所有段落都经 body/context.ts 的 emitParagraph 输出；图文框位置使用页面坐标，
 * 封面素材来自本模块之外的静态 PNG 常量，host 仍负责打包而 shared 不访问文件或浏览器 API。
 */

import type { IRDocMeta } from '../../ir/types'
import { getCoverDesignation } from '../../coverDesignation'
import { isReplaceMarkForbidden, parseCoverLogoDataUrl } from '../../coverLayoutValidation'
import type { DocumentStage } from '../../types/document'
import type { BackCoverConfig, CoverLayoutConfig } from '../../types/template'
import { COVER_ASSETS } from './assets'
import type { DocxRelatedPart } from './package'
import { mmToEmu, mmToTwips } from './units'
import { emitParagraph, warn, type RenderContext } from './body/context'
import { plainRun, tabRun, wrapTitleAtSeparator } from './body/inline'
import { escapeXmlAttr, pBdr, pPr, rPr, tbl, tblBorders, tblPr, tcPr, tr, type XmlChild } from './xml'
import { buildCoverReleaseRunPr } from './styles'
import type { BackCoverAlign, BackCoverBlock } from '../../types/template'

type CoverFrame = NonNullable<Parameters<typeof emitParagraph>[2]>['framePr']
type CoverAsset = { readonly base64: string; readonly widthMm: number; readonly heightMm: number; readonly ext?: 'png' | 'jpg' }

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

const RELEASE_LABEL_RPR = buildCoverReleaseRunPr()
const RELEASE_TEXT_RPR = buildCoverReleaseRunPr(87)
const GROUP_RELEASE_TEXT_RPR = buildCoverReleaseRunPr(100)

const IMAGE_NAMESPACES =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

export const STAGE_LABELS: Record<DocumentStage, string | undefined> = {
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

function imageDrawing(
  asset: CoverAsset,
  relationshipId: string,
  mediaIndex: number,
  description: string,
  lockAspect = true,
): string {
  const cx = mmToEmu(asset.widthMm)
  const cy = mmToEmu(asset.heightMm)
  const name = escapeXmlAttr(`Cover image ${mediaIndex}`)
  const descr = escapeXmlAttr(description)
  const rid = escapeXmlAttr(relationshipId)
  return `<w:drawing ${IMAGE_NAMESPACES}><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${mediaIndex}" name="${name}" descr="${descr}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="${lockAspect ? 1 : 0}"/></wp:cNvGraphicFramePr>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr>' +
    `<pic:cNvPr id="${mediaIndex}" name="${name}" descr="${descr}"/><pic:cNvPicPr/>` +
    '</pic:nvPicPr><pic:blipFill>' +
    `<a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch>` +
    '</pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
}

function floatingImageDrawing(
  asset: CoverAsset,
  relationshipId: string,
  mediaIndex: number,
  description: string,
  xMm: number,
  yMm: number,
  behindDoc = true,
): string {
  const cx = mmToEmu(asset.widthMm)
  const cy = mmToEmu(asset.heightMm)
  const posX = mmToEmu(xMm)
  const posY = mmToEmu(yMm)
  const name = escapeXmlAttr(`Cover image ${mediaIndex}`)
  const descr = escapeXmlAttr(description)
  const rid = escapeXmlAttr(relationshipId)
  return `<w:drawing ${IMAGE_NAMESPACES}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="${behindDoc ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${posX}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${posY}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${mediaIndex}" name="${name}" descr="${descr}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="0"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr>' +
    `<pic:cNvPr id="${mediaIndex}" name="${name}" descr="${descr}"/><pic:cNvPicPr/>` +
    '</pic:nvPicPr><pic:blipFill>' +
    `<a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch>` +
    '</pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>'
}

function frameImage(
  ctx: RenderContext,
  asset: CoverAsset,
  description: string,
  framePr: NonNullable<CoverFrame>,
  lockAspect = true,
): string {
  const { relationshipId, mediaIndex } = registerImage(ctx, asset)
  const drawing = imageDrawing(asset, relationshipId, mediaIndex, description, lockAspect)
  return frameRuns(ctx, 'SesCoverLogo', `<w:r>${drawing}</w:r>`, framePr)
}

function floatingImageParagraph(
  ctx: RenderContext,
  asset: CoverAsset,
  description: string,
  xMm: number,
  yMm: number,
): string {
  const { relationshipId, mediaIndex } = registerImage(ctx, asset)
  const drawing = floatingImageDrawing(asset, relationshipId, mediaIndex, description, xMm, yMm, true)
  const pprXml = pPr([
    ['pStyle', '<w:pStyle w:val="SesCoverLogo"/>'],
    ['spacing', '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'],
  ])
  return `<w:p>${pprXml}<w:r>${drawing}</w:r></w:p>`
}

function registerImage(ctx: RenderContext, asset: CoverAsset): { relationshipId: string; mediaIndex: number } {
  const { relationshipId, mediaIndex } = ctx.allocateImage()
  const ext = asset.ext ?? 'png'
  const relatedPart: DocxRelatedPart = {
    id: relationshipId,
    target: `word/media/image${mediaIndex}.${ext}`,
    relationshipType: IMAGE_REL,
    content: asset.base64,
    binary: true,
  }
  ctx.relatedParts.push(relatedPart)
  return { relationshipId, mediaIndex }
}

function designation(meta: IRDocMeta): { text: string; styleId: string } {
  const styleId = meta.standardType === 'gb'
    ? 'SesCoverDesignationGb'
    : meta.standardType === 'guide'
      ? 'SesCoverDesignationGuide'
      : 'SesCoverDesignationOther'
  return { text: getCoverDesignation(meta), styleId }
}

// 新建草案使用显式 XXXXX—XXXX 占位编号；已填写的家族/地区/机构代码仍应显示。
export function industryLogoFamily(meta: IRDocMeta): string | undefined {
  const code = normalizeCoverStdCode(meta.stdCode)
  const family = /^([A-Z]{2,6})(?:\/T)?\s+(?:\d+(?:\.\d+)*|XXXXX)(?:—(?:\d{4}|XXXX))?$/i.exec(code)?.[1]?.toUpperCase()
  // GB is national and DB is local; neither is an industry-family mark. Require a complete
  // family/serial code after normalization so malformed strings such as "HH malformed" stay XX.
  return family && family !== 'GB' && family !== 'DB' ? family : undefined
}

function warnMissingMarkCode(ctx: RenderContext, meta: IRDocMeta, code: string, message: string): void {
  if (meta.stdCode?.trim() && !code) warn(ctx, 'cover-field-missing', message)
}

export function localRegionCode(meta: IRDocMeta): string {
  const code = normalizeCoverStdCode(meta.stdCode)
  return /^DB(\d{2}|\d{4}|XX)(?:\/T)?\s+(?:\d+(?:\.\d+)*|XXXXX)(?:—(?:\d{4}|XXXX))?$/i.exec(code)?.[1] ?? ''
}

export function typeMarkCode(meta: IRDocMeta, type: 'T' | 'Q'): string {
  const code = normalizeCoverStdCode(meta.stdCode)
  const match = /^([TQ])\/([^\s]+)\s+(?:\d+(?:\.\d+)*|X{4,5})(?:—(?:\d{4}|XXXX))?$/i.exec(code)
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

function issuerReleaseRuns(issuer: string, standardType: IRDocMeta['standardType']): string {
  return (issuer ? plainRun(issuer) + plainRun('　', RELEASE_LABEL_RPR) : '') + plainRun('发　布', standardType === 'group' ? GROUP_RELEASE_TEXT_RPR : RELEASE_TEXT_RPR)
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
    runsXml: issuerReleaseRuns(issuer, meta.standardType),
    framePr: FRAME_ISSUER,
  })
}

/** 按元数据和阶段生成封面，始终保留且只输出一个 SesCoverStdNo 段。 */
export function renderCover(
  ctx: RenderContext,
  meta: IRDocMeta,
  stage: DocumentStage,
  coverLayout?: CoverLayoutConfig,
): string {
  let xml = ''

  const codeLines: string[] = []
  if (meta.icsCode) codeLines.push(`ICS ${meta.icsCode}`)
  if (meta.ccsCode) codeLines.push(`CCS ${meta.ccsCode}`)
  if (meta.standardType === 'industry') codeLines.push(`备案号：${meta.filingNo ?? ''}`)
  if (codeLines.length > 0) xml += frameText(ctx, 'SesCoverIcs', codeLines.join('\n'), FRAME_CODES)

  if (meta.standardType === 'industry' && !meta.coverDesignation?.trim() && !meta.industryName?.trim()) {
    warn(ctx, 'cover-field-missing', 'meta.industryName 缺失，封面标准称谓中的行业名称留空')
  }
  if (meta.standardType === 'local' && !meta.coverDesignation?.trim() && !meta.regionName?.trim()) {
    warn(ctx, 'cover-field-missing', 'meta.regionName 缺失，封面标准称谓中的地方名称留空')
  }

  const parsedCustomLogo = coverLayout?.logo ? parseCoverLogoDataUrl(coverLayout.logo.dataUrl) : null
  const customLogoAsset: CoverAsset | undefined = parsedCustomLogo && coverLayout?.logo
    ? {
        base64: parsedCustomLogo.base64,
        widthMm: coverLayout.logo.widthMm,
        heightMm: coverLayout.logo.heightMm,
        ext: parsedCustomLogo.ext,
      }
    : undefined

  const canReplaceMark =
    Boolean(customLogoAsset) &&
    coverLayout?.logo?.position === 'replace_mark' &&
    !isReplaceMarkForbidden(meta.standardType)

  const renderTopRightStandardMark = (): string => {
    const topRight = coverLayout?.topRightMark
    if (!isReplaceMarkForbidden(meta.standardType)) {
      if (topRight?.mode === 'hidden') return ''
      if (topRight?.mode === 'text' && topRight.text?.trim()) {
        const halfPt = Math.round((topRight.fontSizePt ?? 36) * 2)
        const markRPr = rPr([
          ['rFonts', '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>'],
          ['b', '<w:b/>'],
          ['bCs', '<w:bCs/>'],
          ['sz', `<w:sz w:val="${halfPt}"/>`],
          ['szCs', `<w:szCs w:val="${halfPt}"/>`],
        ])
        return frameRuns(ctx, 'SesCoverLogoText', plainRun(topRight.text.trim(), markRPr), { xMm: 100, yMm: 14.5, widthMm: 83.25 })
      }
    }
    return renderLogo(ctx, meta)
  }

  const emitCustomLogo = (
    logoAsset: CoverAsset,
    logoConfig: NonNullable<CoverLayoutConfig['logo']>,
  ): string => {
    const offsetX = logoConfig.offsetXMm ?? 0
    const offsetY = logoConfig.offsetYMm ?? 0
    const baseX =
      logoConfig.position === 'replace_mark'
        ? (canReplaceMark ? 185 - logoAsset.widthMm : Math.max(100, 190 - logoAsset.widthMm))
        : logoConfig.position === 'center'
          ? Math.max(25, (210 - logoAsset.widthMm) / 2)
          : 25
    const baseY =
      logoConfig.position === 'replace_mark'
        ? (canReplaceMark ? 14.5 : 12.03)
        : logoConfig.position === 'center'
          ? 78
          : 23.5
    const xMm = baseX + offsetX
    const yMm = baseY + offsetY
    const desc = logoConfig.alt?.trim() || '组织封面徽标'
    if (logoConfig.wrap === 'inline') {
      return frameImage(ctx, logoAsset, desc, { xMm, yMm, widthMm: logoAsset.widthMm }, false)
    }
    return floatingImageParagraph(ctx, logoAsset, desc, xMm, yMm)
  }

  if (canReplaceMark && customLogoAsset && coverLayout?.logo) {
    xml += emitCustomLogo(customLogoAsset, coverLayout.logo)
  } else {
    xml += renderTopRightStandardMark()
    if (customLogoAsset && coverLayout?.logo) {
      xml += emitCustomLogo(customLogoAsset, coverLayout.logo)
    }
  }

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
  xml += frameText(ctx, 'SesCoverName', wrapTitleAtSeparator(meta.title ?? '', 18), FRAME_TITLE_FLOW)
  // GB/T 1.1 8.1 只强制国家标准、行业标准标英文译名；地方标准不强制，但用户填写了英文名称时照常输出，
  // 与编辑器封面预览一致，避免导出时静默丢失。企业标准模板不含英文译名，保持不输出。
  if (meta.titleEn && ['gb', 'guide', 'industry', 'local', 'group'].includes(meta.standardType)) {
    xml += frameText(ctx, 'SesCoverEnglish', meta.titleEn, FRAME_TITLE_FLOW)
  }
  if (meta.consistency) xml += frameText(ctx, 'SesCoverConsistency', meta.consistency, FRAME_TITLE_FLOW)
  const stageLabel = STAGE_LABELS[stage]
  if (stageLabel) xml += frameText(ctx, 'SesCoverStage', stageLabel, FRAME_TITLE_FLOW)
  if (stage === 'comment_draft' || stage === 'review_draft') {
    xml += frameText(ctx, 'SesCoverPatent', '在提交反馈意见时，请将您知道的相关专利连同支持性文件一并附上。', FRAME_TITLE_FLOW)
  }

  const noticeText = coverLayout?.notice?.text?.trim()
  if (noticeText && coverLayout?.notice?.position === 'above_dates') {
    xml += frameText(ctx, 'SesCoverNotice', noticeText, { xMm: 25, yMm: 232, widthMm: 170 })
  }

  // 未知日期只在封面显示占位，不写入元数据；日期下横线属于固定封面结构。
  const publishDate = meta.publishDate?.trim() || 'XXXX-XX-XX'
  const implementDate = meta.implementDate?.trim() || 'XXXX-XX-XX'
  xml += emitParagraph(ctx, 'SesCoverDates', {
    runsXml: plainRun(`${publishDate} 发布`) + tabRun() + plainRun(`${implementDate} 实施`),
    framePr: FRAME_DATES,
  })

  xml += renderIssuer(ctx, meta)

  if (noticeText && coverLayout?.notice?.position === 'below_issuer') {
    xml += frameText(ctx, 'SesCoverNotice', noticeText, { xMm: 25, yMm: 278, widthMm: 170 })
  }
  return xml
}

function assertNeverBackCoverBlock(block: never): never {
  throw new Error(`renderBackCover: 未知封底块类型 ${JSON.stringify(block)}`)
}

function jcForAlign(align?: BackCoverAlign): string {
  return align === 'left' || align === 'center' || align === 'right' ? align : 'center'
}

function renderBackCoverBlock(ctx: RenderContext, block: BackCoverBlock): string {
  const beforeTwips = mmToTwips(block.spaceBeforeMm ?? (block.type === 'heading' ? 4 : 2))
  const afterTwips = mmToTwips(block.spaceAfterMm ?? (block.type === 'heading' ? 3 : 2))

  switch (block.type) {
    case 'heading':
    case 'paragraph': {
      const isHeading = block.type === 'heading'
      const defaultPt = isHeading ? 15 : 10.5
      const sz = Math.round((block.fontSizePt ?? defaultPt) * 2)
      const bold = block.bold ?? isHeading
      const align = jcForAlign(block.align ?? (isHeading ? 'center' : 'left'))
      const indent = !isHeading && block.indent
      const fontXml = isHeading
        ? '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="黑体"/>'
        : '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>'
      const rprChildren: XmlChild[] = [
        ['rFonts', fontXml],
        ...(bold ? ([['b', '<w:b/>'], ['bCs', '<w:bCs/>']] as XmlChild[]) : []),
        ['sz', `<w:sz w:val="${sz}"/>`],
        ['szCs', `<w:szCs w:val="${sz}"/>`],
      ]
      const runPrXml = rPr(rprChildren)
      const rawLines = block.text.split(/\r?\n/)
      const pprChildren: XmlChild[] = [
        ['spacing', `<w:spacing w:before="${beforeTwips}" w:after="${afterTwips}" w:line="320" w:lineRule="auto"/>`],
        ...(indent ? ([['ind', '<w:ind w:firstLine="420"/>']] as XmlChild[]) : []),
        ['jc', `<w:jc w:val="${align}"/>`],
      ]
      const runs = rawLines
        .map((line, i) => `${i > 0 ? '<w:r><w:br/></w:r>' : ''}${plainRun(line, runPrXml)}`)
        .join('')
      return `<w:p>${pPr(pprChildren)}${runs}</w:p>`
    }
    case 'image': {
      const parsed = parseCoverLogoDataUrl(block.dataUrl)
      if (!parsed) return ''
      const { relationshipId, mediaIndex } = registerImage(ctx, {
        base64: parsed.base64,
        widthMm: block.widthMm,
        heightMm: block.heightMm,
        ext: parsed.ext,
      })
      const drawing = imageDrawing(
        { base64: parsed.base64, widthMm: block.widthMm, heightMm: block.heightMm, ext: parsed.ext },
        relationshipId,
        mediaIndex,
        '封底图片',
        false,
      )
      const align = jcForAlign(block.align ?? 'center')
      const pprChildren: XmlChild[] = [
        ['spacing', `<w:spacing w:before="${beforeTwips}" w:after="${afterTwips}"/>`],
        ['jc', `<w:jc w:val="${align}"/>`],
      ]
      return `<w:p>${pPr(pprChildren)}<w:r>${drawing}</w:r></w:p>`
    }
    case 'divider': {
      const pprChildren: XmlChild[] = [
        ['pBdr', pBdr([['bottom', '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="333333"/>']])],
        ['spacing', `<w:spacing w:before="${beforeTwips}" w:after="${afterTwips}" w:line="120" w:lineRule="exact"/>`],
      ]
      return `<w:p>${pPr(pprChildren)}</w:p>`
    }
    default:
      return assertNeverBackCoverBlock(block)
  }
}

/** 渲染独立封底 / 版权页内容（置于封面之后、目次之前的 backCover 节内，不计入页码）。 */
export function renderBackCover(ctx: RenderContext, meta: IRDocMeta, backCover: BackCoverConfig): string {
  let xml = ''

  if (Array.isArray(backCover.blocks) && backCover.blocks.length > 0) {
    xml = backCover.blocks.map((block) => renderBackCoverBlock(ctx, block)).join('')
    if (!xml) {
      xml = emitParagraph(ctx, 'SesBackCoverText', {})
    }
    if (backCover.boxed) {
      const boxBorders = tblBorders([
        ['top', '<w:top w:val="single" w:sz="6" w:space="0" w:color="333333"/>'],
        ['left', '<w:left w:val="single" w:sz="6" w:space="0" w:color="333333"/>'],
        ['bottom', '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="333333"/>'],
        ['right', '<w:right w:val="single" w:sz="6" w:space="0" w:color="333333"/>'],
      ])
      const tblPrXml = tblPr([
        ['tblW', '<w:tblW w:w="9354" w:type="dxa"/>'],
        ['jc', '<w:jc w:val="center"/>'],
        ['tblBorders', boxBorders],
        ['tblLayout', '<w:tblLayout w:type="fixed"/>'],
        ['tblCellMar', '<w:tblCellMar><w:top w:w="220" w:type="dxa"/><w:left w:w="300" w:type="dxa"/><w:bottom w:w="220" w:type="dxa"/><w:right w:w="300" w:type="dxa"/></w:tblCellMar>'],
      ])
      const cellPr = tcPr([['tcW', '<w:tcW w:w="9354" w:type="dxa"/>']])
      const rowXml = tr([['tc', `<w:tc>${cellPr}${xml}</w:tc>`]])
      return tbl([
        ['tblPr', tblPrXml],
        ['tblGrid', '<w:tblGrid><w:gridCol w:w="9354"/></w:tblGrid>'],
        ['tr', rowXml],
      ])
    }
    return xml
  }

  const emitLines = (styleId: string, raw: string | undefined): void => {
    const trimmed = raw?.trim()
    if (!trimmed) return
    for (const line of trimmed.split(/\r?\n/)) {
      const clean = line.trim()
      if (clean) {
        xml += emitParagraph(ctx, styleId, { runsXml: plainRun(clean) })
      }
    }
  }

  const titleText = backCover.title?.trim() || meta.title?.trim()
  if (titleText) {
    xml += emitParagraph(ctx, 'SesBackCoverTitle', { runsXml: plainRun(titleText) })
  }
  emitLines('SesBackCoverCopyright', backCover.copyrightNotice)
  emitLines('SesBackCoverText', backCover.publisherInfo)
  emitLines('SesBackCoverText', backCover.contactInfo)
  emitLines('SesBackCoverText', backCover.note)

  if (!xml) {
    xml = emitParagraph(ctx, 'SesBackCoverText', {})
  }
  return xml
}
