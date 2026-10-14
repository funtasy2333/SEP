import { HttpException } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** 工具失败时 `isError` 结果的正文（JSON 序列化后放进 text 内容）。 */
export interface McpErrorBody {
  /** 对应的 HTTP 状态码，与同一操作的 REST 接口一致。 */
  status: number;
  /** 引擎或服务给出的机器可读代码（如 `node-not-found`）。 */
  code?: string;
  message: string;
  /** 409 时文档当前的 revision。 */
  revision?: number;
  /** operations 的逐项问题（400、422）。 */
  issues?: unknown[];
  /** 文档结构问题（422）。 */
  problems?: unknown[];
}

const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;

/** 非 HTTP 异常（含 5xx）统一返回的消息：不泄露堆栈、SQL 或文件路径。 */
export const INTERNAL_ERROR_MESSAGE = '服务端内部错误';

/** 409 的消息后缀：写入基于过期的 revision，必须重新读取。 */
export const REREAD_HINT = '请重新读取后再修改';

function responseObject(error: HttpException): Record<string, unknown> {
  const response = error.getResponse();
  return typeof response === 'object' && response !== null
    ? (response as Record<string, unknown>)
    : {};
}

function messageOf(
  error: HttpException,
  response: Record<string, unknown>,
): string {
  const { message } = response;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
    return message.join('；');
  }
  return error.message;
}

/**
 * 把服务层抛出的异常映射为工具错误正文：
 * - `HttpException`（4xx）：沿用 REST 的状态码与响应体里的 `code`、`revision`、`issues`、`problems`；
 *   409 在消息后追加「请重新读取后再修改」；
 * - 其余（非 HTTP 异常、5xx）：通用的「服务端内部错误」，调用方据此记录日志，正文不含异常消息。
 */
export function toErrorBody(error: unknown): McpErrorBody {
  if (
    !(error instanceof HttpException) ||
    error.getStatus() >= HTTP_INTERNAL_ERROR
  ) {
    return {
      status: HTTP_INTERNAL_ERROR,
      message: INTERNAL_ERROR_MESSAGE,
    };
  }
  const status = error.getStatus();
  const response = responseObject(error);
  const message = messageOf(error, response);
  return {
    status,
    ...(typeof response.code === 'string' ? { code: response.code } : {}),
    message: status === HTTP_CONFLICT ? `${message}；${REREAD_HINT}` : message,
    ...(typeof response.revision === 'number'
      ? { revision: response.revision }
      : {}),
    ...(Array.isArray(response.issues) ? { issues: response.issues } : {}),
    ...(Array.isArray(response.problems)
      ? { problems: response.problems }
      : {}),
  };
}

/** 成功结果：JSON 文本，同时作为 structuredContent。 */
export function jsonResult(result: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
  };
}

/** 失败结果：`isError: true`，正文是 {@link McpErrorBody} 的 JSON。 */
export function errorResult(body: McpErrorBody): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(body) }],
  };
}
