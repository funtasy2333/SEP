import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { DocumentEntity } from './document.entity';

/**
 * PUT 允许客户端写入的字段。id、revision、createdAt、updatedAt 由服务端维护，
 * 请求体里即使带了这些字段也会被忽略（revision 只能由条件 UPDATE 递增）。
 */
export type DocumentUpdateFields = Partial<
  Pick<DocumentEntity, 'title' | 'meta' | 'stage' | 'content'>
>;

export interface DocumentUpdateRequest {
  baseRevision: number;
  fields: DocumentUpdateFields;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 缺失 → 428；不是非负整数 → 400。 */
export function parseBaseRevision(value: unknown): number {
  if (value === undefined) {
    throw new HttpException(
      {
        statusCode: HttpStatus.PRECONDITION_REQUIRED,
        error: 'Precondition Required',
        message:
          '更新文档必须提供 baseRevision（读取文档时得到的 revision），用于检测并发修改',
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException('baseRevision 必须是非负整数');
  }
  return value;
}

/** 解析 PUT /documents/:id 请求体：校验 baseRevision，并只摘出允许写入的字段。 */
export function parseDocumentUpdateRequest(
  body: unknown,
): DocumentUpdateRequest {
  if (!isPlainObject(body)) {
    throw new BadRequestException('请求体必须是 JSON 对象');
  }
  const baseRevision = parseBaseRevision(body.baseRevision);

  const fields: DocumentUpdateFields = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      throw new BadRequestException('title 必须是字符串');
    }
    fields.title = body.title;
  }
  if (body.meta !== undefined) {
    if (!isPlainObject(body.meta)) {
      throw new BadRequestException('meta 必须是 JSON 对象');
    }
    fields.meta = body.meta as unknown as DocumentEntity['meta'];
  }
  if (body.stage !== undefined) {
    if (typeof body.stage !== 'string') {
      throw new BadRequestException('stage 必须是字符串');
    }
    fields.stage = body.stage;
  }
  if (body.content !== undefined) {
    // content 列允许为空，保持与 save 时一致的取值范围。
    if (body.content !== null && !isPlainObject(body.content)) {
      throw new BadRequestException('content 必须是 JSON 对象');
    }
    fields.content = body.content as DocumentEntity['content'];
  }
  return { baseRevision, fields };
}
