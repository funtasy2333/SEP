import type {
  BackCoverAlign,
  BackCoverBlock,
  BackCoverConfig,
  BackCoverVerticalAlign,
  CoverLayoutConfig,
  CoverLogoConfig,
  CoverLogoPosition,
  CoverLogoWrap,
  CoverNoticeConfig,
  CoverNoticePosition,
  CoverTopRightMarkConfig,
  CoverTopRightMarkMode,
  WatermarkConfig,
  WatermarkFrequency,
  WatermarkKind,
} from './types/template';

export const COVER_LOGO_ALLOWED_MIMES = ['image/png', 'image/jpeg'] as const;
export const COVER_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_LOGO_MIN_MM = 5;
export const COVER_LOGO_MAX_WIDTH_MM = 170;
export const COVER_LOGO_MAX_HEIGHT_MM = 80;
export const COVER_NOTICE_MAX_LENGTH = 500;
export const BACK_COVER_FIELD_MAX_LENGTH = 2000;
export const TOP_RIGHT_MARK_MAX_LENGTH = 40;
export const TOP_RIGHT_MARK_MIN_PT = 12;
export const TOP_RIGHT_MARK_MAX_PT = 60;
export const BACK_COVER_MAX_BLOCKS = 30;
export const BACK_COVER_IMAGE_MAX_WIDTH_MM = 170;
export const BACK_COVER_IMAGE_MAX_HEIGHT_MM = 220;
export const BACK_COVER_FONT_MIN_PT = 8;
export const BACK_COVER_FONT_MAX_PT = 36;
export const WATERMARK_TEXT_MAX_LENGTH = 100;
export const WATERMARK_FONT_MIN_PT = 16;
export const WATERMARK_FONT_MAX_PT = 120;
export const WATERMARK_MIN_OPACITY = 0.01;
export const WATERMARK_MAX_OPACITY = 1;
export const WATERMARK_IMAGE_MAX_WIDTH_MM = 180;
export const WATERMARK_IMAGE_MAX_HEIGHT_MM = 240;

export interface ParsedCoverLogoDataUrl {
  mime: 'image/png' | 'image/jpeg';
  ext: 'png' | 'jpg';
  base64: string;
  bytes: number;
}

export interface CoverLayoutValidationError {
  path: string;
  code: string;
  message: string;
}

export type CoverLayoutValidationResult =
  | { valid: true; value: CoverLayoutConfig | undefined }
  | { valid: false; errors: CoverLayoutValidationError[] };

const LOGO_POSITIONS = new Set<string>(['replace_mark', 'top_left', 'center']);
const LOGO_WRAPS = new Set<string>(['behind_text', 'inline']);
const TOP_RIGHT_MODES = new Set<string>(['default', 'hidden', 'text']);
const NOTICE_POSITIONS = new Set<string>(['above_dates', 'below_issuer']);
const BACK_COVER_ALIGNS = new Set<string>(['left', 'center', 'right']);
const BACK_COVER_VALIGNS = new Set<string>(['top', 'middle', 'bottom']);
const WATERMARK_KINDS = new Set<string>(['text', 'image']);
const WATERMARK_FREQS = new Set<string>(['every', 'alternate']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DATA_URL_RE = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertNeverBackCoverBlock(block: never): never {
  throw new Error(`Unexpected backCover block: ${JSON.stringify(block)}`);
}

function cloneBackCoverBlock(block: BackCoverBlock): BackCoverBlock {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'image':
    case 'divider':
      return { ...block };
    default:
      return assertNeverBackCoverBlock(block);
  }
}

/** 国家标准（national/gb）与指导性技术文件（guidance/guide）禁止替换右上角法定 GB 标志 */
export function isReplaceMarkForbidden(standardType?: string): boolean {
  return standardType === 'national' || standardType === 'guidance' || standardType === 'gb' || standardType === 'guide';
}

/** 严格解析并校验内联 PNG/JPEG data URL 及解码后字节大小 */
export function parseCoverLogoDataUrl(dataUrl: string): ParsedCoverLogoDataUrl | null {
  if (typeof dataUrl !== 'string') return null;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] as 'image/png' | 'image/jpeg';
  const base64 = match[2]!;
  if (base64.length < 4 || base64.length % 4 !== 0) return null;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;
  if (bytes <= 0) return null;
  return {
    mime,
    ext: mime === 'image/png' ? 'png' : 'jpg',
    base64,
    bytes,
  };
}

/** 判断 coverLayout 是否包含任何会体现在打印排版上的有效配置 */
export function hasActiveCoverLayout(coverLayout?: CoverLayoutConfig | null): boolean {
  if (!coverLayout) return false;
  if (coverLayout.logo && typeof coverLayout.logo.dataUrl === 'string' && coverLayout.logo.dataUrl.length > 0) {
    return true;
  }
  if (coverLayout.topRightMark && coverLayout.topRightMark.mode !== 'default') {
    return true;
  }
  if (coverLayout.notice && typeof coverLayout.notice.text === 'string' && coverLayout.notice.text.trim().length > 0) {
    return true;
  }
  if (coverLayout.backCover?.enabled) {
    return true;
  }
  if (coverLayout.watermark?.enabled) {
    return true;
  }
  return false;
}

export function cloneCoverLayout(coverLayout?: CoverLayoutConfig | null): CoverLayoutConfig | undefined {
  if (!coverLayout) return undefined;
  const out: CoverLayoutConfig = {};
  if (coverLayout.logo) out.logo = { ...coverLayout.logo };
  if (coverLayout.topRightMark) out.topRightMark = { ...coverLayout.topRightMark };
  if (coverLayout.notice) out.notice = { ...coverLayout.notice };
  if (coverLayout.backCover) {
    out.backCover = {
      ...coverLayout.backCover,
      ...(coverLayout.backCover.blocks
        ? { blocks: coverLayout.backCover.blocks.map(cloneBackCoverBlock) }
        : {}),
    };
  }
  if (coverLayout.watermark) out.watermark = { ...coverLayout.watermark };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 若标准类别禁止修改/替换右上角 GB 标志，则降级 replace_mark -> top_left 并清除自定义右上角标志 */
export function downgradeCoverLayoutForStandardType(
  coverLayout: CoverLayoutConfig | undefined,
  standardType: string,
): { coverLayout: CoverLayoutConfig | undefined; downgraded: boolean } {
  const cloned = cloneCoverLayout(coverLayout);
  let downgraded = false;
  if (cloned && isReplaceMarkForbidden(standardType)) {
    if (cloned.logo?.position === 'replace_mark') {
      cloned.logo = { ...cloned.logo, position: 'top_left' };
      downgraded = true;
    }
    if (cloned.topRightMark && cloned.topRightMark.mode !== 'default') {
      delete cloned.topRightMark;
      downgraded = true;
    }
  }
  if (!cloned || Object.keys(cloned).length === 0) {
    return { coverLayout: undefined, downgraded };
  }
  return { coverLayout: cloned, downgraded };
}

function validateNumberInRange(
  val: unknown,
  min: number,
  max: number,
): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max;
}

/** 同构校验 CoverLayoutConfig 及 (standardType, coverLayout) 组合护栏 */
export function validateCoverLayout(
  value: unknown,
  standardType?: string,
  pathPrefix = 'coverLayout',
): CoverLayoutValidationResult {
  if (value === undefined || value === null) {
    return { valid: true, value: undefined };
  }
  const errors: CoverLayoutValidationError[] = [];
  const push = (subPath: string, code: string, message: string) => {
    errors.push({ path: subPath ? `${pathPrefix}.${subPath}` : pathPrefix, code, message });
  };
  const hasErrorsUnder = (prefix: string) => errors.some((e) => e.path === prefix || e.path.startsWith(`${prefix}.`));

  if (!isPlainObject(value)) {
    push('', 'invalid-type', `${pathPrefix} 必须是对象`);
    return { valid: false, errors };
  }

  const out: CoverLayoutConfig = {};

  if (value.logo !== undefined) {
    if (!isPlainObject(value.logo)) {
      push('logo', 'invalid-type', `${pathPrefix}.logo 必须是对象`);
    } else {
      const logoObj = value.logo;
      const parsed = typeof logoObj.dataUrl === 'string' ? parseCoverLogoDataUrl(logoObj.dataUrl) : null;
      if (!parsed) {
        push(
          'logo.dataUrl',
          'invalid-logo-data-url',
          `${pathPrefix}.logo.dataUrl 必须是内联 PNG 或 JPEG base64 data URL`,
        );
      } else if (parsed.bytes > COVER_LOGO_MAX_BYTES) {
        push(
          'logo.dataUrl',
          'logo-too-large',
          `${pathPrefix}.logo.dataUrl 解码体积不能超过 2 MB`,
        );
      }

      if (typeof logoObj.position !== 'string' || !LOGO_POSITIONS.has(logoObj.position)) {
        push(
          'logo.position',
          'invalid-logo-position',
          `${pathPrefix}.logo.position 必须是 replace_mark、top_left 或 center`,
        );
      } else if (logoObj.position === 'replace_mark' && isReplaceMarkForbidden(standardType)) {
        push(
          'logo.position',
          'replace-mark-forbidden',
          `${pathPrefix}.logo.position 在国家标准或指导性技术文件中不允许使用 replace_mark`,
        );
      }

      if (!validateNumberInRange(logoObj.widthMm, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_WIDTH_MM)) {
        push(
          'logo.widthMm',
          'invalid-logo-dimensions',
          `${pathPrefix}.logo.widthMm 必须在 ${COVER_LOGO_MIN_MM}–${COVER_LOGO_MAX_WIDTH_MM} mm 之间`,
        );
      }

      if (!validateNumberInRange(logoObj.heightMm, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_HEIGHT_MM)) {
        push(
          'logo.heightMm',
          'invalid-logo-dimensions',
          `${pathPrefix}.logo.heightMm 必须在 ${COVER_LOGO_MIN_MM}–${COVER_LOGO_MAX_HEIGHT_MM} mm 之间`,
        );
      }

      if (logoObj.wrap !== undefined && (typeof logoObj.wrap !== 'string' || !LOGO_WRAPS.has(logoObj.wrap))) {
        push('logo.wrap', 'invalid-logo-wrap', `${pathPrefix}.logo.wrap 必须是 behind_text 或 inline`);
      }
      if (logoObj.offsetXMm !== undefined && !validateNumberInRange(logoObj.offsetXMm, -50, 210)) {
        push('logo.offsetXMm', 'invalid-logo-offset', `${pathPrefix}.logo.offsetXMm 必须在 -50–210 mm 之间`);
      }
      if (logoObj.offsetYMm !== undefined && !validateNumberInRange(logoObj.offsetYMm, -50, 297)) {
        push('logo.offsetYMm', 'invalid-logo-offset', `${pathPrefix}.logo.offsetYMm 必须在 -50–297 mm 之间`);
      }
      if (logoObj.alt !== undefined && (typeof logoObj.alt !== 'string' || logoObj.alt.length > 200)) {
        push('logo.alt', 'invalid-logo-alt', `${pathPrefix}.logo.alt 必须是不超过 200 字的字符串`);
      }

      if (!hasErrorsUnder(`${pathPrefix}.logo`)) {
        const logo: CoverLogoConfig = {
          dataUrl: logoObj.dataUrl as string,
          position: logoObj.position as CoverLogoPosition,
          widthMm: logoObj.widthMm as number,
          heightMm: logoObj.heightMm as number,
          ...(typeof logoObj.wrap === 'string' ? { wrap: logoObj.wrap as CoverLogoWrap } : {}),
          ...(typeof logoObj.offsetXMm === 'number' ? { offsetXMm: logoObj.offsetXMm } : {}),
          ...(typeof logoObj.offsetYMm === 'number' ? { offsetYMm: logoObj.offsetYMm } : {}),
          ...(typeof logoObj.alt === 'string' && logoObj.alt ? { alt: logoObj.alt } : {}),
        };
        out.logo = logo;
      }
    }
  }

  if (value.topRightMark !== undefined) {
    if (!isPlainObject(value.topRightMark)) {
      push('topRightMark', 'invalid-type', `${pathPrefix}.topRightMark 必须是对象`);
    } else {
      const markObj = value.topRightMark;
      if (typeof markObj.mode !== 'string' || !TOP_RIGHT_MODES.has(markObj.mode)) {
        push(
          'topRightMark.mode',
          'invalid-top-right-mark-mode',
          `${pathPrefix}.topRightMark.mode 必须是 default、hidden 或 text`,
        );
      } else if (markObj.mode !== 'default' && isReplaceMarkForbidden(standardType)) {
        push(
          'topRightMark.mode',
          'replace-mark-forbidden',
          `${pathPrefix}.topRightMark 在国家标准或指导性技术文件中不允许隐藏或替换`,
        );
      }

      if (markObj.mode === 'text') {
        if (
          typeof markObj.text !== 'string' ||
          markObj.text.trim().length === 0 ||
          markObj.text.length > TOP_RIGHT_MARK_MAX_LENGTH
        ) {
          push(
            'topRightMark.text',
            'invalid-top-right-mark-text',
            `${pathPrefix}.topRightMark.text 必须为 1–${TOP_RIGHT_MARK_MAX_LENGTH} 字的非空文本`,
          );
        }
      } else if (markObj.text !== undefined && (typeof markObj.text !== 'string' || markObj.text.length > TOP_RIGHT_MARK_MAX_LENGTH)) {
        push(
          'topRightMark.text',
          'invalid-top-right-mark-text',
          `${pathPrefix}.topRightMark.text 不能超过 ${TOP_RIGHT_MARK_MAX_LENGTH} 字`,
        );
      }

      if (
        markObj.fontSizePt !== undefined &&
        !validateNumberInRange(markObj.fontSizePt, TOP_RIGHT_MARK_MIN_PT, TOP_RIGHT_MARK_MAX_PT)
      ) {
        push(
          'topRightMark.fontSizePt',
          'invalid-top-right-mark-size',
          `${pathPrefix}.topRightMark.fontSizePt 必须在 ${TOP_RIGHT_MARK_MIN_PT}–${TOP_RIGHT_MARK_MAX_PT} pt 之间`,
        );
      }

      if (!hasErrorsUnder(`${pathPrefix}.topRightMark`) && markObj.mode !== 'default') {
        const mark: CoverTopRightMarkConfig = {
          mode: markObj.mode as CoverTopRightMarkMode,
          ...(typeof markObj.text === 'string' && markObj.text ? { text: markObj.text } : {}),
          ...(typeof markObj.fontSizePt === 'number' ? { fontSizePt: markObj.fontSizePt } : {}),
        };
        out.topRightMark = mark;
      }
    }
  }

  if (value.notice !== undefined) {
    if (!isPlainObject(value.notice)) {
      push('notice', 'invalid-type', `${pathPrefix}.notice 必须是对象`);
    } else {
      const noticeObj = value.notice;
      if (typeof noticeObj.text !== 'string' || noticeObj.text.length > COVER_NOTICE_MAX_LENGTH) {
        push(
          'notice.text',
          'invalid-notice-text',
          `${pathPrefix}.notice.text 必须是不超过 ${COVER_NOTICE_MAX_LENGTH} 字的字符串`,
        );
      }
      if (typeof noticeObj.position !== 'string' || !NOTICE_POSITIONS.has(noticeObj.position)) {
        push(
          'notice.position',
          'invalid-notice-position',
          `${pathPrefix}.notice.position 必须是 above_dates 或 below_issuer`,
        );
      }
      if (!hasErrorsUnder(`${pathPrefix}.notice`)) {
        const notice: CoverNoticeConfig = {
          text: noticeObj.text as string,
          position: noticeObj.position as CoverNoticePosition,
        };
        out.notice = notice;
      }
    }
  }

  if (value.backCover !== undefined) {
    if (!isPlainObject(value.backCover)) {
      push('backCover', 'invalid-type', `${pathPrefix}.backCover 必须是对象`);
    } else {
      const bcObj = value.backCover;
      if (typeof bcObj.enabled !== 'boolean') {
        push('backCover.enabled', 'invalid-type', `${pathPrefix}.backCover.enabled 必须是布尔值`);
      }
      if (
        bcObj.verticalAlign !== undefined &&
        (typeof bcObj.verticalAlign !== 'string' || !BACK_COVER_VALIGNS.has(bcObj.verticalAlign))
      ) {
        push(
          'backCover.verticalAlign',
          'invalid-back-cover-align',
          `${pathPrefix}.backCover.verticalAlign 必须是 top、middle 或 bottom`,
        );
      }
      if (bcObj.boxed !== undefined && typeof bcObj.boxed !== 'boolean') {
        push('backCover.boxed', 'invalid-type', `${pathPrefix}.backCover.boxed 必须是布尔值`);
      }
      const optionalFields = ['title', 'copyrightNotice', 'publisherInfo', 'contactInfo', 'note'] as const;
      for (const field of optionalFields) {
        const val = bcObj[field];
        if (val !== undefined && (typeof val !== 'string' || val.length > BACK_COVER_FIELD_MAX_LENGTH)) {
          push(
            `backCover.${field}`,
            'invalid-back-cover-field',
            `${pathPrefix}.backCover.${field} 必须是不超过 ${BACK_COVER_FIELD_MAX_LENGTH} 字的字符串`,
          );
        }
      }

      let validatedBlocks: BackCoverBlock[] | undefined;
      if (bcObj.blocks !== undefined) {
        if (!Array.isArray(bcObj.blocks)) {
          push('backCover.blocks', 'invalid-type', `${pathPrefix}.backCover.blocks 必须是数组`);
        } else if (bcObj.blocks.length > BACK_COVER_MAX_BLOCKS) {
          push(
            'backCover.blocks',
            'too-many-back-cover-blocks',
            `${pathPrefix}.backCover.blocks 最多包含 ${BACK_COVER_MAX_BLOCKS} 个内容块`,
          );
        } else {
          validatedBlocks = [];
          bcObj.blocks.forEach((rawBlock, idx) => {
            const subPath = `backCover.blocks[${idx}]`;
            if (!isPlainObject(rawBlock)) {
              push(subPath, 'invalid-type', `${pathPrefix}.${subPath} 必须是对象`);
              return;
            }
            const id = typeof rawBlock.id === 'string' && rawBlock.id ? rawBlock.id : `blk-${idx + 1}`;
            if (rawBlock.spaceBeforeMm !== undefined && !validateNumberInRange(rawBlock.spaceBeforeMm, 0, 80)) {
              push(`${subPath}.spaceBeforeMm`, 'invalid-back-cover-spacing', `${pathPrefix}.${subPath}.spaceBeforeMm 必须在 0–80 mm 之间`);
            }
            if (rawBlock.spaceAfterMm !== undefined && !validateNumberInRange(rawBlock.spaceAfterMm, 0, 80)) {
              push(`${subPath}.spaceAfterMm`, 'invalid-back-cover-spacing', `${pathPrefix}.${subPath}.spaceAfterMm 必须在 0–80 mm 之间`);
            }
            const spacingProps = {
              ...(typeof rawBlock.spaceBeforeMm === 'number' ? { spaceBeforeMm: rawBlock.spaceBeforeMm } : {}),
              ...(typeof rawBlock.spaceAfterMm === 'number' ? { spaceAfterMm: rawBlock.spaceAfterMm } : {}),
            };
            const alignVal = rawBlock.align;
            if (alignVal !== undefined && (typeof alignVal !== 'string' || !BACK_COVER_ALIGNS.has(alignVal))) {
              push(`${subPath}.align`, 'invalid-back-cover-align', `${pathPrefix}.${subPath}.align 必须是 left、center 或 right`);
            }
            const blockType = rawBlock.type;
            if (blockType === 'heading' || blockType === 'paragraph') {
              if (typeof rawBlock.text !== 'string' || rawBlock.text.length > BACK_COVER_FIELD_MAX_LENGTH) {
                push(`${subPath}.text`, 'invalid-back-cover-field', `${pathPrefix}.${subPath}.text 必须是不超过 ${BACK_COVER_FIELD_MAX_LENGTH} 字的字符串`);
              }
              if (rawBlock.fontSizePt !== undefined && !validateNumberInRange(rawBlock.fontSizePt, BACK_COVER_FONT_MIN_PT, BACK_COVER_FONT_MAX_PT)) {
                push(`${subPath}.fontSizePt`, 'invalid-back-cover-font-size', `${pathPrefix}.${subPath}.fontSizePt 必须在 ${BACK_COVER_FONT_MIN_PT}–${BACK_COVER_FONT_MAX_PT} pt 之间`);
              }
              if (rawBlock.bold !== undefined && typeof rawBlock.bold !== 'boolean') {
                push(`${subPath}.bold`, 'invalid-type', `${pathPrefix}.${subPath}.bold 必须是布尔值`);
              }
              if (blockType === 'paragraph' && rawBlock.indent !== undefined && typeof rawBlock.indent !== 'boolean') {
                push(`${subPath}.indent`, 'invalid-type', `${pathPrefix}.${subPath}.indent 必须是布尔值`);
              }
              if (!hasErrorsUnder(`${pathPrefix}.${subPath}`)) {
                validatedBlocks!.push({
                  id,
                  type: blockType,
                  text: rawBlock.text as string,
                  ...(typeof alignVal === 'string' ? { align: alignVal as BackCoverAlign } : {}),
                  ...(typeof rawBlock.fontSizePt === 'number' ? { fontSizePt: rawBlock.fontSizePt } : {}),
                  ...(typeof rawBlock.bold === 'boolean' ? { bold: rawBlock.bold } : {}),
                  ...(blockType === 'paragraph' && typeof rawBlock.indent === 'boolean' ? { indent: rawBlock.indent } : {}),
                  ...spacingProps,
                });
              }
            } else if (blockType === 'image') {
              const parsedImg = typeof rawBlock.dataUrl === 'string' ? parseCoverLogoDataUrl(rawBlock.dataUrl) : null;
              if (!parsedImg) {
                push(`${subPath}.dataUrl`, 'invalid-logo-data-url', `${pathPrefix}.${subPath}.dataUrl 必须是内联 PNG 或 JPEG base64 data URL`);
              } else if (parsedImg.bytes > COVER_LOGO_MAX_BYTES) {
                push(`${subPath}.dataUrl`, 'logo-too-large', `${pathPrefix}.${subPath}.dataUrl 解码体积不能超过 2 MB`);
              }
              if (!validateNumberInRange(rawBlock.widthMm, COVER_LOGO_MIN_MM, BACK_COVER_IMAGE_MAX_WIDTH_MM)) {
                push(`${subPath}.widthMm`, 'invalid-logo-dimensions', `${pathPrefix}.${subPath}.widthMm 必须在 ${COVER_LOGO_MIN_MM}–${BACK_COVER_IMAGE_MAX_WIDTH_MM} mm 之间`);
              }
              if (!validateNumberInRange(rawBlock.heightMm, COVER_LOGO_MIN_MM, BACK_COVER_IMAGE_MAX_HEIGHT_MM)) {
                push(`${subPath}.heightMm`, 'invalid-logo-dimensions', `${pathPrefix}.${subPath}.heightMm 必须在 ${COVER_LOGO_MIN_MM}–${BACK_COVER_IMAGE_MAX_HEIGHT_MM} mm 之间`);
              }
              if (!hasErrorsUnder(`${pathPrefix}.${subPath}`)) {
                validatedBlocks!.push({
                  id,
                  type: 'image',
                  dataUrl: rawBlock.dataUrl as string,
                  widthMm: rawBlock.widthMm as number,
                  heightMm: rawBlock.heightMm as number,
                  ...(typeof alignVal === 'string' ? { align: alignVal as BackCoverAlign } : {}),
                  ...spacingProps,
                });
              }
            } else if (blockType === 'divider') {
              if (!hasErrorsUnder(`${pathPrefix}.${subPath}`)) {
                validatedBlocks!.push({
                  id,
                  type: 'divider',
                  ...spacingProps,
                });
              }
            } else {
              push(`${subPath}.type`, 'invalid-back-cover-block-type', `${pathPrefix}.${subPath}.type 必须是 heading、paragraph、image 或 divider`);
            }
          });
        }
      }

      if (!hasErrorsUnder(`${pathPrefix}.backCover`)) {
        const backCover: BackCoverConfig = {
          enabled: bcObj.enabled as boolean,
          ...(validatedBlocks ? { blocks: validatedBlocks } : {}),
          ...(typeof bcObj.verticalAlign === 'string' ? { verticalAlign: bcObj.verticalAlign as BackCoverVerticalAlign } : {}),
          ...(typeof bcObj.boxed === 'boolean' ? { boxed: bcObj.boxed } : {}),
          ...(typeof bcObj.title === 'string' ? { title: bcObj.title } : {}),
          ...(typeof bcObj.copyrightNotice === 'string' ? { copyrightNotice: bcObj.copyrightNotice } : {}),
          ...(typeof bcObj.publisherInfo === 'string' ? { publisherInfo: bcObj.publisherInfo } : {}),
          ...(typeof bcObj.contactInfo === 'string' ? { contactInfo: bcObj.contactInfo } : {}),
          ...(typeof bcObj.note === 'string' ? { note: bcObj.note } : {}),
        };
        out.backCover = backCover;
      }
    }
  }

  if (value.watermark !== undefined) {
    if (!isPlainObject(value.watermark)) {
      push('watermark', 'invalid-type', `${pathPrefix}.watermark 必须是对象`);
    } else {
      const wmObj = value.watermark;
      if (typeof wmObj.enabled !== 'boolean') {
        push('watermark.enabled', 'invalid-type', `${pathPrefix}.watermark.enabled 必须是布尔值`);
      }
      if (typeof wmObj.kind !== 'string' || !WATERMARK_KINDS.has(wmObj.kind)) {
        push('watermark.kind', 'invalid-watermark-kind', `${pathPrefix}.watermark.kind 必须是 text 或 image`);
      }
      if (typeof wmObj.frequency !== 'string' || !WATERMARK_FREQS.has(wmObj.frequency)) {
        push('watermark.frequency', 'invalid-watermark-frequency', `${pathPrefix}.watermark.frequency 必须是 every 或 alternate`);
      }
      if (wmObj.opacity !== undefined && !validateNumberInRange(wmObj.opacity, WATERMARK_MIN_OPACITY, WATERMARK_MAX_OPACITY)) {
        push('watermark.opacity', 'invalid-watermark-opacity', `${pathPrefix}.watermark.opacity 必须在 ${WATERMARK_MIN_OPACITY}–${WATERMARK_MAX_OPACITY} 之间`);
      }
      if (wmObj.rotationDeg !== undefined && !validateNumberInRange(wmObj.rotationDeg, -90, 90)) {
        push('watermark.rotationDeg', 'invalid-watermark-rotation', `${pathPrefix}.watermark.rotationDeg 必须在 -90–90 度之间`);
      }

      if (wmObj.enabled === true && wmObj.kind === 'text') {
        if (typeof wmObj.text !== 'string' || wmObj.text.trim().length === 0 || wmObj.text.length > WATERMARK_TEXT_MAX_LENGTH) {
          push('watermark.text', 'invalid-watermark-text', `${pathPrefix}.watermark.text 必须为 1–${WATERMARK_TEXT_MAX_LENGTH} 字的非空文本`);
        }
        if (wmObj.fontSizePt !== undefined && !validateNumberInRange(wmObj.fontSizePt, WATERMARK_FONT_MIN_PT, WATERMARK_FONT_MAX_PT)) {
          push('watermark.fontSizePt', 'invalid-watermark-font-size', `${pathPrefix}.watermark.fontSizePt 必须在 ${WATERMARK_FONT_MIN_PT}–${WATERMARK_FONT_MAX_PT} pt 之间`);
        }
        if (wmObj.color !== undefined && (typeof wmObj.color !== 'string' || !HEX_COLOR_RE.test(wmObj.color))) {
          push('watermark.color', 'invalid-watermark-color', `${pathPrefix}.watermark.color 必须是 #RRGGBB 十六进制颜色`);
        }
      } else if (wmObj.enabled === true && wmObj.kind === 'image') {
        const parsedWm = typeof wmObj.dataUrl === 'string' ? parseCoverLogoDataUrl(wmObj.dataUrl) : null;
        if (!parsedWm) {
          push('watermark.dataUrl', 'invalid-logo-data-url', `${pathPrefix}.watermark.dataUrl 必须是内联 PNG 或 JPEG base64 data URL`);
        } else if (parsedWm.bytes > COVER_LOGO_MAX_BYTES) {
          push('watermark.dataUrl', 'logo-too-large', `${pathPrefix}.watermark.dataUrl 解码体积不能超过 2 MB`);
        }
        if (wmObj.widthMm !== undefined && !validateNumberInRange(wmObj.widthMm, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_WIDTH_MM)) {
          push('watermark.widthMm', 'invalid-logo-dimensions', `${pathPrefix}.watermark.widthMm 必须在 ${COVER_LOGO_MIN_MM}–${WATERMARK_IMAGE_MAX_WIDTH_MM} mm 之间`);
        }
        if (wmObj.heightMm !== undefined && !validateNumberInRange(wmObj.heightMm, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_HEIGHT_MM)) {
          push('watermark.heightMm', 'invalid-logo-dimensions', `${pathPrefix}.watermark.heightMm 必须在 ${COVER_LOGO_MIN_MM}–${WATERMARK_IMAGE_MAX_HEIGHT_MM} mm 之间`);
        }
      }

      if (!hasErrorsUnder(`${pathPrefix}.watermark`) && wmObj.enabled === true) {
        const watermark: WatermarkConfig = {
          enabled: true,
          kind: wmObj.kind as WatermarkKind,
          frequency: wmObj.frequency as WatermarkFrequency,
          ...(typeof wmObj.text === 'string' ? { text: wmObj.text } : {}),
          ...(typeof wmObj.fontSizePt === 'number' ? { fontSizePt: wmObj.fontSizePt } : {}),
          ...(typeof wmObj.color === 'string' ? { color: wmObj.color } : {}),
          ...(typeof wmObj.rotationDeg === 'number' ? { rotationDeg: wmObj.rotationDeg } : {}),
          ...(typeof wmObj.opacity === 'number' ? { opacity: wmObj.opacity } : {}),
          ...(typeof wmObj.dataUrl === 'string' ? { dataUrl: wmObj.dataUrl } : {}),
          ...(typeof wmObj.widthMm === 'number' ? { widthMm: wmObj.widthMm } : {}),
          ...(typeof wmObj.heightMm === 'number' ? { heightMm: wmObj.heightMm } : {}),
        };
        out.watermark = watermark;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: Object.keys(out).length > 0 ? out : undefined };
}
