import { BadRequestException } from '@nestjs/common';

/** 导出告警：与 @ses/io buildDocx 返回的 warnings 同形。 */
export interface ExportWarning {
  code: string;
  nodeId?: string;
  message: string;
}

/** 告警条数（全量），始终返回。 */
export const WARNING_COUNT_HEADER = 'X-SES-Export-Warning-Count';
/** 告警明细：`encodeURIComponent(JSON.stringify(ExportWarning[]))`，仅在有告警时返回。 */
export const WARNINGS_HEADER = 'X-SES-Export-Warnings';
/** 明细被截断（条数少于 Count）时为 `true`。 */
export const WARNINGS_TRUNCATED_HEADER = 'X-SES-Export-Warnings-Truncated';

/**
 * 告警明细头编码后的长度上限。Node 客户端默认只接受 16 KiB 的响应头，
 * 常见反向代理（nginx）的上游响应头缓冲区默认只有 4～8 KiB，取 4 KiB 以保证经代理仍可到达。
 */
const WARNINGS_HEADER_MAX_LENGTH = 4096;
/** 单条告警消息的字符上限；公式转换告警会带上 LaTeX 源码，可能很长。 */
const WARNING_MESSAGE_MAX_CHARS = 200;

const CREATED_AT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const CREATED_AT_HINT =
  'createdAt 必须是带时区的 ISO 8601 时间，例如 2026-01-01T00:00:00Z（时区偏移中的 + 在查询参数里需编码为 %2B）';

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * 解析 createdAt 查询参数：缺省返回 undefined（由 buildDocx 取当前时间）；
 * 格式或取值非法 → 400。合法值原样透传，写入 docProps/core.xml 的就是调用方给出的字符串，
 * 因此必须是严格的 `YYYY-MM-DDThh:mm:ss[.fff](Z|±hh:mm)`，同时排除 2026-02-30 这类
 * Date.parse 会宽松接受的日期。
 */
export function parseCreatedAt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(CREATED_AT_HINT);
  const match = CREATED_AT_PATTERN.exec(value);
  if (!match) throw new BadRequestException(CREATED_AT_HINT);

  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const valid =
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    // xsd:dateTime 的偏移范围为 -14:00～+14:00。
    offsetMinute <= 59 &&
    (offsetHour < 14 || (offsetHour === 14 && offsetMinute === 0));
  if (!valid) throw new BadRequestException(CREATED_AT_HINT);
  return value;
}

function clipMessage(message: string): string {
  const chars = Array.from(message);
  return chars.length > WARNING_MESSAGE_MAX_CHARS
    ? `${chars.slice(0, WARNING_MESSAGE_MAX_CHARS).join('')}…`
    : message;
}

/**
 * 把告警放进响应头（文件本身不混入告警）。明细按原顺序整条放入，直到编码后长度
 * 超过上限；放不下的尾部丢弃，并以 Truncated 头标明，完整条数见 Count 头。
 */
export function buildWarningHeaders(
  warnings: readonly ExportWarning[],
): Record<string, string> {
  const headers: Record<string, string> = {
    [WARNING_COUNT_HEADER]: String(warnings.length),
  };
  if (warnings.length === 0) return headers;

  const kept: ExportWarning[] = [];
  let encoded = '';
  for (const warning of warnings) {
    const candidate = [
      ...kept,
      {
        code: warning.code,
        ...(warning.nodeId === undefined ? {} : { nodeId: warning.nodeId }),
        message: clipMessage(warning.message),
      },
    ];
    const candidateEncoded = encodeURIComponent(JSON.stringify(candidate));
    if (candidateEncoded.length > WARNINGS_HEADER_MAX_LENGTH) break;
    kept.push(candidate[candidate.length - 1]);
    encoded = candidateEncoded;
  }
  if (kept.length > 0) headers[WARNINGS_HEADER] = encoded;
  if (kept.length < warnings.length)
    headers[WARNINGS_TRUNCATED_HEADER] = 'true';
  return headers;
}

/**
 * Content-Disposition 整个头值（含 `attachment; filename*=UTF-8''` 前缀）的长度上限。
 * 文件名来自 titleCn，创建/更新接口都不限长，而一个汉字百分号编码后占 9 个字符，
 * 不设上限时几百字的标题就会让头超出代理/浏览器的头部缓冲区（取值依据同
 * WARNINGS_HEADER_MAX_LENGTH：nginx 上游响应头缓冲区默认 4～8 KiB），导出成功却下载不了。
 * 同一响应里告警头最多还有约 4 KiB，再加 Content-Type、Content-Length 等通用头，
 * 所以这里只取 1 KiB（约 4 KiB 的 1/4）：满载时整个响应头约 5.5 KiB，仍在 8 KiB 之内；
 * 1 KiB 扣掉前缀、扩展名与省略号后，还能放 109 个汉字，足够常见的标准名称。
 */
export const CONTENT_DISPOSITION_MAX_LENGTH = 1024;

const DISPOSITION_PREFIX = "attachment; filename*=UTF-8''";
/** 文件名被截短时接在保留部分之后（扩展名之前）的标记，占用长度预算。 */
const TRUNCATION_MARK = '…';
/** 截短时原样保留的扩展名：末尾的 `.` 加 1～10 位 ASCII 字母数字，如 `.docx`。 */
const EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,10}$/;

/**
 * filename* 的百分号编码。encodeURIComponent 不转义 !'()*，
 * 其中 `'` 是 filename* 的分隔符，一并转成百分号编码。
 */
function encodeFilename(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * 把文件名截短到编码后不超过 budget 个字符：保留扩展名，主体按码点逐个累加
 * （代理对不会被劈开，百分号编码也不会被截成半截），截短处补省略号，省略号与扩展名都计入预算。
 */
function encodeClippedFilename(filename: string, budget: number): string {
  const extension = EXTENSION_PATTERN.exec(filename)?.[0] ?? '';
  const stem = filename.slice(0, filename.length - extension.length);
  const mark = encodeFilename(TRUNCATION_MARK);

  let remaining = budget - mark.length - extension.length;
  let kept = '';
  for (const char of stem) {
    const encoded = encodeFilename(char);
    if (encoded.length > remaining) break;
    kept += encoded;
    remaining -= encoded.length;
  }
  return `${kept}${mark}${extension}`;
}

/**
 * Content-Disposition（RFC 6266 / 5987 的 filename*）。整个头值不超过
 * CONTENT_DISPOSITION_MAX_LENGTH；超出时按上面的规则截短文件名，不超出的与原样编码逐字节相同。
 */
export function attachmentDisposition(filename: string): string {
  const header = `${DISPOSITION_PREFIX}${encodeFilename(filename)}`;
  if (header.length <= CONTENT_DISPOSITION_MAX_LENGTH) return header;
  return `${DISPOSITION_PREFIX}${encodeClippedFilename(
    filename,
    CONTENT_DISPOSITION_MAX_LENGTH - DISPOSITION_PREFIX.length,
  )}`;
}
