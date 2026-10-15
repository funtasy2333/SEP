import { BadRequestException } from '@nestjs/common';
import { parseDocumentOperations, type DocumentOperation } from '@ses/io';
import { parseBaseRevision } from '../document/document-update';
import { MAX_CLIENT_LENGTH } from '../version/version.service';

/** 请求里的 note（版本记录说明）长度上限：足够写一两句话，又不会把版本列表撑得过宽。 */
export const MAX_NOTE_LENGTH = 500;

/** 写入来源：AI 的写入会生成带「写入前内容」的版本记录，人的写入与编辑器保存一致、不生成版本。 */
export const OPERATION_SOURCES = ['ai', 'human'] as const;
export type OperationSource = (typeof OPERATION_SOURCES)[number];

export interface DocumentOperationsRequest {
  baseRevision: number;
  operations: DocumentOperation[];
  source: OperationSource;
  client?: string;
  note?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析 POST /documents/:id/operations 的请求体。
 *
 * 检查顺序与 PUT 一致：请求体 → baseRevision（缺失 428，非法 400）→ 其余字段 → operations 形状。
 * operations 的形状错误用 `parseDocumentOperations` 的问题列表，一次报出全部，放在响应体的 `issues` 里。
 */
export function parseDocumentOperationsRequest(
  body: unknown,
): DocumentOperationsRequest {
  if (!isPlainObject(body)) {
    throw new BadRequestException('请求体必须是 JSON 对象');
  }
  const baseRevision = parseBaseRevision(body.baseRevision);

  const source = body.source;
  if (
    typeof source !== 'string' ||
    !(OPERATION_SOURCES as readonly string[]).includes(source)
  ) {
    throw new BadRequestException(
      `source 必填，且必须是 ${OPERATION_SOURCES.join(' / ')} 之一`,
    );
  }

  let client: string | undefined;
  if (body.client !== undefined) {
    if (
      typeof body.client !== 'string' ||
      body.client.length > MAX_CLIENT_LENGTH
    ) {
      throw new BadRequestException(
        `client 必须是不超过 ${MAX_CLIENT_LENGTH} 个字符的字符串`,
      );
    }
    client = body.client;
  }

  let note: string | undefined;
  if (body.note !== undefined) {
    if (typeof body.note !== 'string' || body.note.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(
        `note 必须是不超过 ${MAX_NOTE_LENGTH} 个字符的字符串`,
      );
    }
    // 只含空白等于没写：交给服务端自动生成摘要。
    note = body.note.trim() === '' ? undefined : body.note;
  }

  const parsed = parseDocumentOperations(body.operations);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message:
        `operations 不合法（共 ${parsed.issues.length} 个问题）：${first.reason}` +
        `（${first.path}）`,
      issues: parsed.issues,
    });
  }

  return {
    baseRevision,
    operations: parsed.operations,
    source: source as OperationSource,
    ...(client === undefined ? {} : { client }),
    ...(note === undefined ? {} : { note }),
  };
}
