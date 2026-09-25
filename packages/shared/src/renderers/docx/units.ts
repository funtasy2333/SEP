/**
 * DOCX 渲染器的单位换算（docs/wp7-docx-delivery.md §1.2）。
 *
 * 全部结果取整（Word 的这些属性本身就是整数单位，不支持小数）。
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

/** 毫米 → twips（缇；1 英寸 = 1440 twips = 25.4 mm），用于 pgSz/pgMar/ind/spacing 等 */
export function mmToTwips(mm: number): number {
  return Math.round((mm * 1440) / 25.4)
}

/** 磅 → 半磅（OOXML 里 w:sz/w:szCs 字号属性的单位是半磅；边框粗细的 w:sz 不是半磅，见 ptToEighthPoint） */
export function ptToHalfPoint(pt: number): number {
  return Math.round(pt * 2)
}

/** 磅 → 1/8 磅（OOXML 边框粗细属性——w:pBdr/w:tcBorders/w:tblBorders 等的 w:sz——单位是 1/8 磅，
 *  不是半磅；§3.3 表格线：粗 0.75 磅 → sz=6，细 0.25 磅 → sz=2） */
export function ptToEighthPoint(pt: number): number {
  return Math.round(pt * 8)
}

/** 毫米 → EMU（English Metric Units；1 mm = 36000 EMU），用于 wp:extent 等图片尺寸 */
export function mmToEmu(mm: number): number {
  return Math.round(mm * 36000)
}

/** 五号字一个汉字的宽度（twips），用于「空 N 个汉字」「首行缩进 2 字」等版式计算（§3.1） */
export const CHAR_WIDTH_TWIPS = 210
