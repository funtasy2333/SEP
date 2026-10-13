import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  applyDocumentOperations,
  buildOutline,
  readContainer,
  readNode,
  type DocumentOperationWarning,
  type DocumentOutline,
  type DocumentProblem,
  type OperationEffect,
  type ReadContainerInfo,
  type ReadContainerResult,
  type ReadNodeInfo,
  type ReadNodeResult,
} from '@ses/io';
import type { PMJsonNode } from '@ses/shared';
import { schemaProblemDetails, unprocessable } from '../common/http-errors';
import { isEmptyContent } from '../document/document-content';
import {
  DocumentService,
  revisionConflict,
} from '../document/document.service';
import { EditorContentError } from '../editor-schema/editor-content-error';
import {
  editorContentValidator,
  normalizeContentDetailed,
  type NormalizedContent,
} from '../editor-schema/editor-schema';
import { VersionService } from '../version/version.service';
import type { DocumentOperationsRequest } from './operations-request';

/** 可通过 containers 接口读取的容器（正文章与附录请用结构树取得 id 后逐个读取节点）。 */
export const READABLE_CONTAINERS = [
  'foreword',
  'introduction',
  'bibliography',
] as const;

/**
 * 读取前补齐 nodeId 时，条件 UPDATE 因并发写入失败后，重新读取并重试的最大总次数（含第一次）。
 *
 * 失败只说明别人在这期间写了文档（编辑器自动保存、另一个 AI 写入）：重读之后新内容通常已经规范化
 * （编辑器保存的、operations 写入的内容都经过 nodeId 规范化），第二次就不需要再写。
 * 连续 3 次都被抢先，说明文档正在被高频改写，继续重试只会和写入方空耗，此时返回 409 让调用方稍后再来。
 */
export const MAX_NORMALIZE_ATTEMPTS = 3;

/** 读取接口与 operations 接口共同基于的文档状态。 */
interface PreparedDocument {
  revision: number;
  stage: string;
  /** 已按生产 schema 校验、nodeId 完整且唯一的 PM JSON。 */
  content: PMJsonNode;
}

export interface OperationsResult {
  /** 写入后的 revision，AI 下一次写入以此为 baseRevision。 */
  revision: number;
  /** 引擎返回的每个操作的影响（写入、移除、移动的 nodeId）。 */
  operations: OperationEffect[];
  /** 写入后文档的 Resolver 问题（`introduced` 标出本批新引入的）；不阻止写入。 */
  problems: DocumentProblem[];
  warnings: DocumentOperationWarning[];
  /** 本次写入生成的版本记录（仅 source 为 ai）。 */
  versionId?: number;
}

const OPERATION_LABELS = [
  ['insert', '插入'],
  ['replace', '替换'],
  ['delete', '删除'],
  ['move', '移动'],
] as const;

/** 请求没有给 note 时自动生成的中文摘要，如「AI 修改：插入 2 处、替换 1 处」。 */
export function summarizeOperations(
  effects: readonly OperationEffect[],
): string {
  const parts = OPERATION_LABELS.flatMap(([op, label]) => {
    const count = effects.filter((effect) => effect.op === op).length;
    return count > 0 ? [`${label} ${count} 处`] : [];
  });
  return `AI 修改：${parts.join('、')}`;
}

/**
 * 读取失败 → HTTP 错误。引擎的 code 原样放在响应体的 `code` 字段里：
 * - node-not-found → 404：文档里确实没有这个 id；
 * - node-not-addressable → 422：id 存在，但在表、列项、术语条目等内部，不能单独寻址
 *   （请求本身合法，是文档结构不允许；reason 指出应改为读取哪个外层节点）；
 * - node-ambiguous / container-ambiguous → 422：文档里有多个节点（容器）使用同一 id，无法确定指哪一个。
 *   读取前已经规范化 nodeId，正常不会出现，出现说明文档结构异常；不用 409，免得与 revision 冲突混淆；
 * - invalid-container → 400：容器名不在允许范围内。
 */
function readFailure(
  result: Extract<ReadNodeResult | ReadContainerResult, { ok: false }>,
): Error {
  const body = { code: result.code };
  switch (result.code) {
    case 'node-not-found':
      return new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: result.reason,
        ...body,
      });
    case 'invalid-container':
      return new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: result.reason,
        ...body,
      });
    default:
      return unprocessable(result.reason, body);
  }
}

@Injectable()
export class DocumentOpsService {
  private readonly logger = new Logger(DocumentOpsService.name);

  constructor(
    private readonly documents: DocumentService,
    private readonly versions: VersionService,
  ) {}

  async outline(
    id: number,
  ): Promise<{ revision: number; outline: DocumentOutline }> {
    const { revision, content } = await this.prepare(id, '读取');
    return { revision, outline: buildOutline(content) };
  }

  async node(
    id: number,
    nodeId: string,
  ): Promise<{ revision: number; node: ReadNodeInfo }> {
    const { revision, content } = await this.prepare(id, '读取');
    const result = readNode(content, nodeId);
    if (!result.ok) throw readFailure(result);
    return { revision, node: result.node };
  }

  async container(
    id: number,
    name: string,
  ): Promise<{ revision: number; container: ReadContainerInfo }> {
    if (!(READABLE_CONTAINERS as readonly string[]).includes(name)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `容器名只能是 ${READABLE_CONTAINERS.join(' / ')} 之一（收到「${name.slice(0, 40)}」）；正文章与附录请用结构树取得 id 后逐个读取节点`,
        code: 'invalid-container',
      });
    }
    const { revision, content } = await this.prepare(id, '读取');
    const result = readContainer(content, name);
    if (!result.ok) throw readFailure(result);
    return { revision, container: result.container };
  }

  /**
   * 批量执行文档操作。流程：
   * 1. 取得规范化的文档（缺失或重复的 nodeId 先补齐并持久化，见 {@link prepare}）；
   * 2. baseRevision 与当前 revision 不符 → 409（与 PUT 同一响应体）。此时如果刚发生过 nodeId 规范化，
   *    revision 已经加 1：调用方持有的 id 可能是占位值，必须重新读取；
   * 3. 引擎在内存中执行并用生产 schema 校验，任一问题整批拒绝 → 422，不写库；
   * 4. 在一个事务里做条件 UPDATE（revision + 1），source 为 ai 时同事务插入版本记录；
   *    任一失败整体回滚，文档和版本都不留下部分结果。提交之后才发布变更事件。
   *
   * 第 2 步只是尽早失败；真正防止覆盖并发写入的是第 4 步 UPDATE 的 `WHERE revision = baseRevision`。
   */
  async apply(
    id: number,
    request: DocumentOperationsRequest,
  ): Promise<OperationsResult> {
    const base = await this.prepare(id, '修改');
    if (base.revision !== request.baseRevision) {
      throw revisionConflict(base.revision, request.baseRevision);
    }

    const result = applyDocumentOperations(base.content, request.operations, {
      validateContent: editorContentValidator,
    });
    if (!result.ok) {
      const codes = [...new Set(result.issues.map((issue) => issue.code))];
      // 只记录问题数与代码；reason 与路径可能回显调用方给出的 id 或文字。
      this.logger.warn(
        `文档 #${id} 的操作被拒绝：${result.issues.length} 个问题（${codes.join('、')}）`,
      );
      const first = result.issues[0];
      throw unprocessable(
        `操作未通过检查，整批未写入（共 ${result.issues.length} 个问题）：${first.reason}`,
        { issues: result.issues },
      );
    }

    const content = result.doc as unknown as Record<string, unknown>;
    const { updated, version } = await this.documents.transaction(
      async (manager) => {
        const updated = await this.documents.updateWithin(
          manager,
          id,
          base.revision,
          { content },
        );
        const version =
          request.source === 'ai'
            ? await this.versions.createForAiWrite(manager, {
                documentId: id,
                stage: base.stage,
                content,
                baseContent: base.content as unknown as Record<string, unknown>,
                client: request.client ?? null,
                note: request.note ?? summarizeOperations(result.operations),
              })
            : undefined;
        return { updated, version };
      },
    );
    // 事务已提交：此时发布，订阅方收到事件后读到的一定是写入后的状态。
    this.documents.publishChange(updated, {
      source: request.source,
      client: request.client,
    });
    this.logger.log(
      `文档 #${id} 写入成功：${request.operations.length} 个操作，来源 ${request.source}，revision ${updated.revision}` +
        (version ? `，版本 #${version.id}` : ''),
    );

    return {
      revision: updated.revision,
      operations: result.operations,
      problems: result.problems,
      warnings: result.warnings,
      ...(version ? { versionId: version.id } : {}),
    };
  }

  /**
   * 取出可供引擎使用的文档：内容非空、通过生产 schema 校验，且每个节点都有唯一的 nodeId。
   *
   * 库内内容缺失或重复 nodeId 时（API 直接写入的内容；编辑器保存的总是完整的），与编辑器打开文档时一致：
   * 规范化（补齐缺失的、重新生成重复的）并立即持久化——revision 加 1，发布 system 事件，不生成版本记录。
   * 必须持久化：规范化生成的是随机 id，只在内存里补的话每次读到的 id 都不同，AI 拿着上一次读到的 id 来写，
   * 永远找不到节点。
   *
   * 持久化用条件 UPDATE（基于刚读到的 revision）。失败说明别人抢先写了：重新读取再判断，
   * 最多 {@link MAX_NORMALIZE_ATTEMPTS} 次，用尽后返回 409。
   * 不需要补 id 时只读，不写库、不改 revision。
   */
  private async prepare(
    id: number,
    action: '读取' | '修改',
  ): Promise<PreparedDocument> {
    for (let attempt = 1; ; attempt++) {
      const doc = await this.documents.findOne(id);
      if (isEmptyContent(doc.content)) {
        throw unprocessable(`文档内容为空，无法${action}`);
      }

      let normalized: NormalizedContent;
      try {
        normalized = normalizeContentDetailed(doc.content);
      } catch (error) {
        if (!(error instanceof EditorContentError)) throw error;
        // 只记录问题类别与 JSON Pointer，不记录节点类型、消息或正文。
        this.logger.warn(
          `文档 #${id} 内容不符合编辑器文档结构，${action}中止（${error.problem.code}，${error.problem.path || '根节点'}）`,
        );
        throw unprocessable(
          `文档内容不符合编辑器文档结构，无法${action}：${error.message}`,
          schemaProblemDetails(error),
        );
      }
      const { content } = normalized;

      if (!normalized.nodeIdsRepaired) {
        return { revision: doc.revision, stage: doc.stage, content };
      }
      try {
        const saved = await this.documents.update(
          id,
          doc.revision,
          { content: content as unknown as Record<string, unknown> },
          { source: 'system' },
        );
        this.logger.log(
          `文档 #${id} 的 nodeId 已规范化并保存，revision ${saved.revision}`,
        );
        return { revision: saved.revision, stage: saved.stage, content };
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        if (attempt >= MAX_NORMALIZE_ATTEMPTS) {
          const { revision } = error.getResponse() as { revision?: number };
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: `文档正在被频繁修改，连续 ${MAX_NORMALIZE_ATTEMPTS} 次补齐 nodeId 都被其他写入抢先，请稍后重试`,
            revision,
          });
        }
        // 别人在读取之后写了文档：重新读取，新内容可能已经不需要规范化。
      }
    }
  }
}
