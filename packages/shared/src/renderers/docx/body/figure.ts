/**
 * DOCX 图片块渲染（docs/wp7-docx-delivery.md §5.8）。
 *
 * 图片数据由宿主提供；本模块只把数据转成 DrawingML 和 package related part，不读取文件、
 * 不解码图片、不使用浏览器或 Node API。图注及图内注由块分发器按 IR 顺序输出。
 */

import type { IRFigure, NodeId } from '../../../ir/types'
import { emitParagraph, warn, type RenderContext } from './context'
import { plainRun } from './inline'
import { mmToEmu } from '../units'
import type { DocxRelatedPart } from '../package'
import type { DocxRenderOptions } from '../types'
import { escapeXmlAttr } from '../xml'

export type DocxImage = DocxRenderOptions['images'][NodeId]

export interface FigureImageOptions {
  /** 写入 document.xml.rels 的关系 ID，必须由 renderDocx 的公共分配器提供。 */
  relationshipId?: string
  /** 用于 media 路径和 wp:docPr id；按文档遍历顺序从 1 开始。 */
  mediaIndex?: number
  /** 版心最大宽度。默认按 orientation 使用 165 mm 或 252 mm。 */
  maxWidthMm?: number
}

export interface RenderedFigureImage {
  /** `P(SesFigure, drawing)`；资源缺失时是带提示文字的 SesFigure 段。 */
  xml: string
  /** 有图像时必须追加到 buildPackage 的 relatedParts。 */
  relatedPart?: DocxRelatedPart
}

const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const IMAGE_NAMESPACES =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function extensionFor(contentType: DocxImage['contentType']): 'png' | 'jpg' | 'gif' {
  switch (contentType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
  }
}

function isValidImage(image: DocxImage): boolean {
  const dpi = image.dpi ?? 96
  const supportedType = image.contentType === 'image/png' || image.contentType === 'image/jpeg' || image.contentType === 'image/gif'
  return supportedType && typeof image.base64 === 'string' && image.base64.length > 0 &&
    Number.isFinite(image.widthPx) && image.widthPx > 0 &&
    Number.isFinite(image.heightPx) && image.heightPx > 0 &&
    Number.isFinite(dpi) && dpi > 0 &&
    Number.isFinite((image.widthPx * 914400) / dpi) &&
    Number.isFinite((image.heightPx * 914400) / dpi)
}

function drawingXml(figure: IRFigure, image: DocxImage, relationshipId: string, mediaIndex: number, maxWidthMm: number): string {
  const dpi = image.dpi ?? 96
  const naturalWidthEmu = (image.widthPx * 914400) / dpi
  const naturalHeightEmu = (image.heightPx * 914400) / dpi
  const maxWidthEmu = mmToEmu(maxWidthMm)
  const scale = naturalWidthEmu > maxWidthEmu ? maxWidthEmu / naturalWidthEmu : 1
  const widthEmu = Math.round(naturalWidthEmu * scale)
  const heightEmu = Math.round(naturalHeightEmu * scale)
  const name = `Image ${mediaIndex}`
  const alt = figure.caption.map((run) => run.text).join('')
  const rid = escapeXmlAttr(relationshipId)
  const safeName = escapeXmlAttr(name)
  const safeAlt = escapeXmlAttr(alt)

  return `<w:drawing ${IMAGE_NAMESPACES}><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:docPr id="${mediaIndex}" name="${safeName}" descr="${safeAlt}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr>' +
    `<pic:cNvPr id="${mediaIndex}" name="${safeName}" descr="${safeAlt}"/><pic:cNvPicPr/>` +
    '</pic:nvPicPr><pic:blipFill>' +
    `<a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch>` +
    '</pic:blipFill><pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing>'
}

/**
 * 渲染一个 IRFigure 的图片段，并返回对应图片关系部件。
 * 缺图或尺寸元数据无效时输出用户可见提示，并在 ctx.warnings 记录原因。
 */
export function renderFigureImage(
  ctx: RenderContext,
  figure: IRFigure,
  image: DocxImage | undefined,
  options: FigureImageOptions = {},
): RenderedFigureImage {
  if (!image) {
    warn(ctx, 'image-missing', `图片 "${figure.id}" 未提供资源，输出图片缺失提示`, figure.id)
    return { xml: emitParagraph(ctx, 'SesFigure', { runsXml: plainRun('〔图片缺失〕') }) }
  }
  if (!isValidImage(image)) {
    warn(ctx, 'image-invalid', `图片 "${figure.id}" 的字节或尺寸元数据无效，输出图片缺失提示`, figure.id)
    return { xml: emitParagraph(ctx, 'SesFigure', { runsXml: plainRun('〔图片缺失〕') }) }
  }

  const relationshipId = options.relationshipId
  const mediaIndex = options.mediaIndex
  if (!relationshipId || typeof mediaIndex !== 'number' || !Number.isSafeInteger(mediaIndex) || mediaIndex < 1) {
    throw new Error('renderFigureImage: 有效图片必须提供 relationshipId 与从 1 开始的 mediaIndex')
  }

  const maxWidthMm = options.maxWidthMm ?? (figure.orientation === 'landscape' ? 252 : 165)
  if (!Number.isFinite(maxWidthMm) || maxWidthMm <= 0) throw new Error('renderFigureImage: maxWidthMm 必须为正数')
  const extension = extensionFor(image.contentType)
  const target = `word/media/image${mediaIndex}.${extension}`
  return {
    xml: emitParagraph(ctx, 'SesFigure', {
      runsXml: `<w:r>${drawingXml(figure, image, relationshipId, mediaIndex, maxWidthMm)}</w:r>`,
    }),
    relatedPart: {
      id: relationshipId,
      target,
      relationshipType: REL_IMAGE,
      content: image.base64,
      binary: true,
    },
  }
}
