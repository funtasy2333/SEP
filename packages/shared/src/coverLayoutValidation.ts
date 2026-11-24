import type {
  BackCoverConfig,
  CoverLayoutConfig,
  CoverLogoConfig,
  CoverLogoPosition,
  CoverNoticeConfig,
  CoverNoticePosition,
} from './types/template';

export const COVER_LOGO_ALLOWED_MIMES = ['image/png', 'image/jpeg'] as const;
export const COVER_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_LOGO_MIN_MM = 5;
export const COVER_LOGO_MAX_WIDTH_MM = 170;
export const COVER_LOGO_MAX_HEIGHT_MM = 80;
export const COVER_NOTICE_MAX_LENGTH = 500;
export const BACK_COVER_FIELD_MAX_LENGTH = 2000;

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
const NOTICE_POSITIONS = new Set<string>(['above_dates', 'below_issuer']);
const DATA_URL_RE = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
  if (coverLayout.notice && typeof coverLayout.notice.text === 'string' && coverLayout.notice.text.trim().length > 0) {
    return true;
  }
  if (coverLayout.backCover?.enabled) {
    return true;
  }
  return false;
}

export function cloneCoverLayout(coverLayout?: CoverLayoutConfig | null): CoverLayoutConfig | undefined {
  if (!coverLayout) return undefined;
  const out: CoverLayoutConfig = {};
  if (coverLayout.logo) out.logo = { ...coverLayout.logo };
  if (coverLayout.notice) out.notice = { ...coverLayout.notice };
  if (coverLayout.backCover) out.backCover = { ...coverLayout.backCover };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 若标准类别禁止 replace_mark，则将已有徽标位置自动降级为 top_left */
export function downgradeCoverLayoutForStandardType(
  coverLayout: CoverLayoutConfig | undefined,
  standardType: string,
): { coverLayout: CoverLayoutConfig | undefined; downgraded: boolean } {
  const cloned = cloneCoverLayout(coverLayout);
  if (cloned?.logo?.position === 'replace_mark' && isReplaceMarkForbidden(standardType)) {
    cloned.logo = { ...cloned.logo, position: 'top_left' };
    return { coverLayout: cloned, downgraded: true };
  }
  return { coverLayout: cloned, downgraded: false };
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

      if (
        typeof logoObj.widthMm !== 'number' ||
        !Number.isFinite(logoObj.widthMm) ||
        logoObj.widthMm < COVER_LOGO_MIN_MM ||
        logoObj.widthMm > COVER_LOGO_MAX_WIDTH_MM
      ) {
        push(
          'logo.widthMm',
          'invalid-logo-dimensions',
          `${pathPrefix}.logo.widthMm 必须在 ${COVER_LOGO_MIN_MM}–${COVER_LOGO_MAX_WIDTH_MM} mm 之间`,
        );
      }

      if (
        typeof logoObj.heightMm !== 'number' ||
        !Number.isFinite(logoObj.heightMm) ||
        logoObj.heightMm < COVER_LOGO_MIN_MM ||
        logoObj.heightMm > COVER_LOGO_MAX_HEIGHT_MM
      ) {
        push(
          'logo.heightMm',
          'invalid-logo-dimensions',
          `${pathPrefix}.logo.heightMm 必须在 ${COVER_LOGO_MIN_MM}–${COVER_LOGO_MAX_HEIGHT_MM} mm 之间`,
        );
      }

      if (logoObj.alt !== undefined && (typeof logoObj.alt !== 'string' || logoObj.alt.length > 200)) {
        push('logo.alt', 'invalid-logo-alt', `${pathPrefix}.logo.alt 必须是不超过 200 字的字符串`);
      }

      if (errors.length === 0) {
        const logo: CoverLogoConfig = {
          dataUrl: logoObj.dataUrl as string,
          position: logoObj.position as CoverLogoPosition,
          widthMm: logoObj.widthMm as number,
          heightMm: logoObj.heightMm as number,
          ...(typeof logoObj.alt === 'string' && logoObj.alt ? { alt: logoObj.alt } : {}),
        };
        out.logo = logo;
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
      if (!errors.some((e) => e.path.startsWith(`${pathPrefix}.notice`))) {
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
      if (!errors.some((e) => e.path.startsWith(`${pathPrefix}.backCover`))) {
        const backCover: BackCoverConfig = {
          enabled: bcObj.enabled as boolean,
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

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: Object.keys(out).length > 0 ? out : undefined };
}
