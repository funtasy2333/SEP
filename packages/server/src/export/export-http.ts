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
 * Content-Disposition（RFC 6266 / 5987 的 filename*）。encodeURIComponent 不转义 !'()*，
 * 其中 `'` 是 filename* 的分隔符，一并转成百分号编码。
 */
export function attachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}
