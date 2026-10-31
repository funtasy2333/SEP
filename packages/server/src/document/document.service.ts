import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  IsNull,
  In,
  Not,
  Repository,
  type UpdateQueryBuilder,
} from 'typeorm';
import { WriteCoordinator } from '../common/write-coordinator';
import { DocumentEntity } from './document.entity';
import type { DocumentUpdateFields } from './document-update';
import {
  DocumentEventsService,
  type DocumentChangeOrigin,
} from './document-events.service';

/** QueryBuilder 的 set() 参数类型不接受 Record<string, unknown>，统一在此处断言。 */
type DocumentSetValues = Parameters<
  UpdateQueryBuilder<DocumentEntity>['set']
>[0];

/** PUT 与 operations 共用的 revision 冲突响应：409 + 当前 revision。 */
export function revisionConflict(
  currentRevision: number,
  baseRevision: number,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: `文档已被修改（当前 revision 为 ${currentRevision}，请求基于 ${baseRevision}），本次写入未保存`,
    revision: currentRevision,
  });
}

/** 文档列表摘要：不含 meta 与 content。 */
export type DocumentSummary = Pick<
  DocumentEntity,
  'id' | 'title' | 'stage' | 'revision' | 'updatedAt'
>;

/** 回收站只返回识别与恢复所需字段，不加载正文或版本。 */
export type TrashDocumentSummary = Pick<
  DocumentEntity,
  'id' | 'title' | 'meta' | 'stage' | 'revision' | 'deletedAt'
>;

export interface TrashSnapshotEntry {
  id: number;
  revision: number;
}

@Injectable()
export class DocumentService {
  /**
   * 本类所有公开的库访问都经过全服务端共用的写锁，原因与「不可重入」的约定见 {@link WriteCoordinator}：
   * - 写（{@link create}、{@link update}、{@link remove}、{@link transaction}）：
   *   单条 INSERT / UPDATE / DELETE 本身是原子的，但 SQLite 只有一个共享连接，
   *   若恰好落在别人已开启、随后又回滚的事务里，会被一并回滚，而调用方已经收到了成功响应；
   * - 读（{@link findAll}、{@link findSummaries}、{@link findOne}、{@link assertExists}）：
   *   事务进行期间，共享连接上的读会看到事务内尚未提交的数据（包括递增后的 revision）；
   *   事务若随后回滚，读方拿到的就是从未存在过的状态。所以读也排队，等事务结束后再读。
   *
   * 取舍：读和写因此串行，读与读之间也不并行。单连接的 SQLite 本来就不能并行执行语句，
   * 代价只是读要等在途事务（一次文档更新加一条版本插入）结束，可以接受。
   *
   * 约定：以上公开方法都**不可在锁内调用**（`transaction` 的回调、`WriteCoordinator.run` 的任务里）：
   * 锁不可重入，会死锁。锁内需要读取时使用传入的 manager / repository，
   * 或本类不加锁的内部读取（{@link findOneIn}）。
   */
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly docRepo: Repository<DocumentEntity>,
    private readonly events: DocumentEventsService,
    private readonly writes: WriteCoordinator,
  ) {}

  async findAll(): Promise<DocumentEntity[]> {
    return this.writes.run(() =>
      this.docRepo.find({
        where: { deletedAt: IsNull() },
        order: { updatedAt: 'DESC' },
      }),
    );
  }

  /**
   * 文档列表的摘要（最近修改的在前）：只读取这几列，不读 meta 与正文——正文可能含大量内嵌图片。
   * updatedAt 精度为秒，同一秒内以 id 倒序为准。
   */
  async findSummaries(): Promise<DocumentSummary[]> {
    return this.writes.run(() =>
      this.docRepo.find({
        select: {
          id: true,
          title: true,
          stage: true,
          revision: true,
          updatedAt: true,
        },
        where: { deletedAt: IsNull() },
        order: { updatedAt: 'DESC', id: 'DESC' },
      }),
    );
  }

  /** 读取单个文档；不存在抛 404。排在在途事务之后，只会读到已提交的数据；不可在锁内调用，见类注释。 */
  async findOne(id: number): Promise<DocumentEntity> {
    return this.writes.run(() => this.findOneIn(this.docRepo, id));
  }

  /** 回收站摘要只包含删除态文档；未选择 content 与 versions，避免读取大正文。 */
  async findTrash(): Promise<TrashDocumentSummary[]> {
    return this.writes.run(() =>
      this.docRepo.find({
        select: {
          id: true,
          title: true,
          meta: true,
          stage: true,
          revision: true,
          deletedAt: true,
        },
        where: { deletedAt: Not(IsNull()) },
        order: { deletedAt: 'DESC', id: 'DESC' },
      }),
    );
  }

  /** 只确认文档存在（不读取正文）；不存在抛 404。同样排在在途事务之后；不可在锁内调用。 */
  async assertExists(id: number): Promise<void> {
    const found = await this.writes.run(() =>
      this.docRepo.exists({ where: { id, deletedAt: IsNull() } }),
    );
    if (!found) throw new NotFoundException(`Document #${id} not found`);
  }

  async create(data: Partial<DocumentEntity>): Promise<DocumentEntity> {
    // 只接收文档内容字段：忽略 id / deletedAt / revision / timestamps / relations，避免 upsert 或复活旧行。
    const doc = this.docRepo.create({
      uid: randomUUID(),
      title: data.title,
      meta: data.meta,
      stage: data.stage,
      content: data.content,
      revision: 0,
    });
    return this.writes.run(() => this.docRepo.save(doc));
  }

  /**
   * 乐观锁更新：仅当文档当前 revision 等于 baseRevision 时写入并使 revision 加 1，成功后发布变更事件。
   *
   * 检查与写入必须是同一条 UPDATE（WHERE revision = :baseRevision），不能先读后写：
   * 两个带同一 baseRevision 的并发请求，数据库只会让其中一条匹配到行。
   * updatedAt 由 TypeORM 对 @UpdateDateColumn 自动附加到 SET 中。
   *
   * @param origin 事件里记录的写入来源；缺省为 human（PUT 来自编辑器）。
   */
  async update(
    id: number,
    baseRevision: number,
    data: DocumentUpdateFields,
    origin: DocumentChangeOrigin = { source: 'human' },
  ): Promise<DocumentEntity> {
    const updated = await this.writes.run(() =>
      this.conditionalUpdate(this.docRepo, id, baseRevision, data),
    );
    this.publishChange(updated, origin);
    return updated;
  }

  /**
   * 在调用方开启的事务（{@link transaction}）里执行同一条条件 UPDATE。
   * 事务尚未提交，所以这里不发布事件：调用方在 `transaction()` 返回（已提交）之后再
   * 调用 {@link publishChange}。revision 不符时抛 409，由事务回滚。
   *
   * 只能在 {@link transaction} 的回调里调用，并且**不加锁**：事务本身已经持有写锁，锁不可重入，
   * 再次加锁会死锁。写入必须走传入的 manager（同一事务），不要改用 docRepo。
   */
  updateWithin(
    manager: EntityManager,
    id: number,
    baseRevision: number,
    data: DocumentUpdateFields,
  ): Promise<DocumentEntity> {
    return this.conditionalUpdate(
      manager.getRepository(DocumentEntity),
      id,
      baseRevision,
      data,
    );
  }

  /**
   * 在一个数据库事务里执行 `work`：正常返回则提交，抛异常则回滚。
   *
   * 事务持有全服务端的写锁，直到提交或回滚：同一时刻不会有别的写入（本类的 create / update / remove、
   * 另一个事务、VersionService.create）开始。TypeORM 的 SQLite 驱动整个进程共用一个连接，事务期间
   * 别的写入会落进这个事务里，随它一起回滚（或在回滚时让已完成的删除被撤销）。
   * 所以排队执行，而不是依赖事件循环的调度碰巧不交错。
   *
   * `work` 内只能用传入的 manager（以及 {@link updateWithin}、`VersionService.createForAiWrite`
   * 这类接收 manager 且不加锁的方法）；不能调用 {@link create} / {@link update} / {@link remove}、
   * `VersionService.create` 或再次调用本方法，也不能调用公开的读取（{@link findAll} / {@link findSummaries} /
   * {@link findOne} / {@link assertExists}、`VersionService.findByDocument` / `findOne`）：
   * 锁不可重入，会死锁。事务内要读，用 manager 自己查（读到的正是本事务内的状态）。
   */
  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.writes.run(() => this.docRepo.manager.transaction(work));
  }

  /** 发布一次已提交写入的变更事件。 */
  publishChange(
    doc: Pick<DocumentEntity, 'id' | 'revision'>,
    origin: DocumentChangeOrigin,
  ): void {
    this.events.publish({
      documentId: doc.id,
      revision: doc.revision,
      source: origin.source,
      ...(origin.client === undefined ? {} : { client: origin.client }),
      ...(origin.lifecycle === undefined
        ? {}
        : { lifecycle: origin.lifecycle }),
      at: new Date().toISOString(),
    });
  }

  /** 将活动文档移入回收站；正文与版本均保留，deletedAt/revision 在同一持锁操作中更新。 */
  async remove(id: number): Promise<void> {
    const deleted = await this.writes.run(async () => {
      const current = await this.findOneIn(this.docRepo, id);
      const deletedAt = new Date();
      const result = await this.docRepo
        .createQueryBuilder()
        .update(DocumentEntity)
        .set({ deletedAt, revision: () => 'revision + 1' } as DocumentSetValues)
        .where('id = :id AND revision = :revision AND deletedAt IS NULL', {
          id,
          revision: current.revision,
        })
        .execute();
      if (result.affected !== 1)
        throw new NotFoundException(`Document #${id} not found`);
      return { id, revision: current.revision + 1 };
    });
    this.publishChange(deleted, { source: 'human', lifecycle: 'deleted' });
  }

  /** 恢复原文档，不重建正文或版本；revision 增加，令删除前页面的保存请求失效。 */
  async restore(id: number): Promise<DocumentEntity> {
    const restored = await this.writes.run(async () => {
      const current = await this.findStoredOneIn(this.docRepo, id);
      if (current.deletedAt === null) {
        throw new ConflictException(`Document #${id} is not in the trash`);
      }
      const result = await this.docRepo
        .createQueryBuilder()
        .update(DocumentEntity)
        .set({
          deletedAt: null,
          revision: () => 'revision + 1',
        } as DocumentSetValues)
        .where('id = :id AND revision = :revision AND deletedAt IS NOT NULL', {
          id,
          revision: current.revision,
        })
        .execute();
      if (result.affected !== 1)
        throw new ConflictException(`Document #${id} changed while restoring`);
      return this.findOneIn(this.docRepo, id);
    });
    this.publishChange(restored, { source: 'human', lifecycle: 'restored' });
    return restored;
  }

  /** 仅永久删除仍在回收站且 revision 与确认时一致的文档。 */
  async permanentDelete(id: number, baseRevision: number): Promise<void> {
    await this.writes.run(() =>
      this.docRepo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(DocumentEntity);
        const current = await this.findStoredOneIn(repo, id);
        if (current.deletedAt === null) {
          throw new ConflictException(`Document #${id} is not in the trash`);
        }
        if (current.revision !== baseRevision) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: `Document #${id} changed after trash confirmation`,
            revision: current.revision,
          });
        }
        await repo.delete(id);
      }),
    );
  }

  /**
   * 原子地清空用户确认时的快照：先在同一写锁与事务里校验整批状态，再删除快照内所有文档。
   * 快照之后新移入回收站的文档不在 ids 中，不会被清理。
   */
  async emptyTrash(snapshot: TrashSnapshotEntry[]): Promise<void> {
    if (snapshot.length === 0) return;
    await this.writes.run(() =>
      this.docRepo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(DocumentEntity);
        const ids = snapshot.map((entry) => entry.id);
        const current = await repo.find({
          select: { id: true, revision: true, deletedAt: true },
          where: { id: In(ids) },
        });
        const byId = new Map(current.map((doc) => [doc.id, doc]));
        for (const entry of snapshot) {
          const doc = byId.get(entry.id);
          if (
            !doc ||
            doc.deletedAt === null ||
            doc.revision !== entry.revision
          ) {
            throw new ConflictException(
              `Trash snapshot is stale for document #${entry.id}`,
            );
          }
        }
        await repo.delete(ids);
      }),
    );
  }

  /**
   * 不加锁的单文档读取，供已经持锁的代码使用（{@link remove}、{@link conditionalUpdate}，以及传入事务 manager
   * 的 repository）。公开读取 {@link findOne} 是它外面包一层锁。
   */
  private async findOneIn(
    repo: Repository<DocumentEntity>,
    id: number,
  ): Promise<DocumentEntity> {
    const doc = await repo.findOne({ where: { id, deletedAt: IsNull() } });
    if (!doc) throw new NotFoundException(`Document #${id} not found`);
    return doc;
  }

  /** 回收站生命周期操作所用的内部查询；允许取到已删除行，且不另加写锁。 */
  private async findStoredOneIn(
    repo: Repository<DocumentEntity>,
    id: number,
  ): Promise<DocumentEntity> {
    const doc = await repo.findOne({
      select: { id: true, revision: true, deletedAt: true },
      where: { id },
    });
    if (!doc) throw new NotFoundException(`Document #${id} not found`);
    return doc;
  }

  private async conditionalUpdate(
    repo: Repository<DocumentEntity>,
    id: number,
    baseRevision: number,
    data: DocumentUpdateFields,
  ): Promise<DocumentEntity> {
    const result = await repo
      .createQueryBuilder()
      .update(DocumentEntity)
      .set({ ...data, revision: () => 'revision + 1' } as DocumentSetValues)
      .where('id = :id AND revision = :baseRevision AND deletedAt IS NULL', {
        id,
        baseRevision,
      })
      .execute();
    if (result.affected === 1) return this.findOneIn(repo, id);

    // 没有匹配到行：区分「文档不存在」与「revision 已变化」。
    const current = await repo.findOne({
      where: { id, deletedAt: IsNull() },
      select: { id: true, revision: true },
    });
    if (!current) throw new NotFoundException(`Document #${id} not found`);
    throw revisionConflict(current.revision, baseRevision);
  }
}
