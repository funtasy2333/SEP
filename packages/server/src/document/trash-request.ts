import { BadRequestException } from '@nestjs/common';
import { parseBaseRevision } from './document-update';
import type { TrashSnapshotEntry } from './document.service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(`${label} 必须是正整数`);
  }
  return value;
}

/** DELETE /documents/:id/permanent 的确认 revision。 */
export function parsePermanentDeleteRequest(body: unknown): number {
  if (!isPlainObject(body)) {
    throw new BadRequestException('请求体必须是 JSON 对象');
  }
  return parseBaseRevision(body.baseRevision);
}

/** POST /documents/trash/empty 的确认快照。 */
export function parseEmptyTrashRequest(body: unknown): TrashSnapshotEntry[] {
  if (!isPlainObject(body) || !Array.isArray(body.documents)) {
    throw new BadRequestException('documents 必须是确认时的文档快照数组');
  }
  const seen = new Set<number>();
  return body.documents.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new BadRequestException(`documents[${index}] 必须是对象`);
    }
    const id = parsePositiveId(item.id, `documents[${index}].id`);
    if (seen.has(id)) {
      throw new BadRequestException(`documents 中不能重复包含文档 #${id}`);
    }
    seen.add(id);
    const revision = item.revision;
    if (
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    ) {
      throw new BadRequestException(
        `documents[${index}].revision 必须是非负整数`,
      );
    }
    return { id, revision };
  });
}
