import { MAX_CLIENT_LENGTH } from '../version/version.service';

/** 客户端没有报告名称（或清洗后为空）时写入版本记录的标识。 */
export const FALLBACK_CLIENT_NAME = 'mcp';

/**
 * 控制字符（含换行、制表、DEL 与 C1）、格式字符（零宽字符、双向文字覆盖符等，可用来伪造版本面板里的显示）
 * 以及 Unicode 行/段分隔符。
 */
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * 把 `initialize` 里客户端自报的 `clientInfo.name` 整理为写入版本记录和变更事件的 `client`：
 * 去掉不安全字符、去掉首尾空白、按 UTF-16 长度截断到 {@link MAX_CLIENT_LENGTH}（不会把代理对截成两半），
 * 结果为空则用 {@link FALLBACK_CLIENT_NAME}。
 *
 * 名称由客户端自己声明、不能证明身份，只用于在版本面板里标注「是谁改的」。
 */
export function normalizeClientName(name: unknown): string {
  if (typeof name !== 'string') return FALLBACK_CLIENT_NAME;
  const cleaned = name.replace(UNSAFE_CHARACTERS, '').trim();
  let truncated = '';
  for (const character of cleaned) {
    if (truncated.length + character.length > MAX_CLIENT_LENGTH) break;
    truncated += character;
  }
  return truncated.trim() || FALLBACK_CLIENT_NAME;
}
