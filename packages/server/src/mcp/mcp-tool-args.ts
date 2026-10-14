import { BadRequestException } from '@nestjs/common';

/**
 * 工具参数的解析辅助。参数来自 AI 客户端，不可信：这里只检查形状，失败抛 400，
 * 由 {@link toErrorBody} 映射为 `isError` 结果（不是协议级错误），让模型据消息自行改正。
 */

export type ToolArgs = Record<string, unknown>;

/** 错误消息里回显的调用方字符串的最大长度。 */
const ECHO_LENGTH = 40;

function invalid(message: string): BadRequestException {
  return new BadRequestException(message);
}

/** 拒绝未知参数（多半是拼写错误，静默忽略会让模型以为设置已生效）。值为 undefined 的键视为未给出。 */
export function assertOnlyKeys(
  args: ToolArgs,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(args).filter(
    (key) => args[key] !== undefined && !allowed.includes(key),
  );
  if (unknown.length === 0) return;
  const shown = unknown.map((key) => `「${key.slice(0, ECHO_LENGTH)}」`);
  throw invalid(`未知参数 ${shown.join('、')}（支持：${allowed.join('、')}）`);
}

/** 文档 id：正整数。 */
export function parseDocumentId(value: unknown): number {
  if (value === undefined) {
    throw invalid(
      '缺少参数「documentId」（文档 id，可由 list_documents 取得）',
    );
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalid('参数「documentId」必须是正整数');
  }
  return value;
}

export function optionalString(
  args: ToolArgs,
  key: string,
): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalid(`参数「${key}」必须是字符串`);
  return value;
}

/** 可选的非空字符串：给出时类型不对，或（去掉首尾空白后）为空都拒绝。 */
export function optionalNonEmptyString(
  args: ToolArgs,
  key: string,
  what: string,
): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`参数「${key}」必须是非空字符串（${what}）`);
  }
  return value;
}

/** 必填的非空字符串：缺失、类型不对，或（去掉首尾空白后）为空都拒绝。 */
export function requiredNonEmptyString(
  args: ToolArgs,
  key: string,
  what: string,
): string {
  const value = optionalNonEmptyString(args, key, what);
  if (value === undefined) throw invalid(`缺少参数「${key}」（${what}）`);
  return value;
}

function parseEnum<T extends string>(
  value: unknown,
  key: string,
  allowed: readonly T[],
): T {
  if (
    typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
  ) {
    return value as T;
  }
  const shown =
    typeof value === 'string' ? `「${value.slice(0, ECHO_LENGTH)}」` : '';
  throw invalid(`参数「${key}」${shown}必须是 ${allowed.join(' / ')} 之一`);
}

export function requiredEnum<T extends string>(
  args: ToolArgs,
  key: string,
  allowed: readonly T[],
): T {
  if (args[key] === undefined) {
    throw invalid(`缺少参数「${key}」（${allowed.join(' / ')} 之一）`);
  }
  return parseEnum(args[key], key, allowed);
}

export function optionalEnum<T extends string>(
  args: ToolArgs,
  key: string,
  allowed: readonly T[],
): T | undefined {
  return args[key] === undefined
    ? undefined
    : parseEnum(args[key], key, allowed);
}
