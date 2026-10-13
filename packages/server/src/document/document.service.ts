import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, type UpdateQueryBuilder } from 'typeorm';
import { AsyncMutex } from '../common/async-mutex';
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

@Injectable()
export class DocumentService {
  /**
   * 串行化需要数据库事务的写入（见 {@link transaction}）。
   * PUT 的 {@link update} 也经过它：单条 UPDATE 本身是原子的，但 SQLite 只有一个共享连接，
   * 若恰好落在别人已开启、随后又回滚的事务里，会被一并回滚，而调用方已经收到了成功响应。
   */
  private readonly writeLock = new AsyncMutex();

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly docRepo: Repository<DocumentEntity>,
    private readonly events: DocumentEventsService,
  ) {}

  async findAll(): Promise<DocumentEntity[]> {
    return this.docRepo.find({ order: { updatedAt: 'DESC' } });
  }

  async findOne(id: number): Promise<DocumentEntity> {
    return this.findOneIn(this.docRepo, id);
  }

  /** 只确认文档存在（不读取正文）；不存在抛 404。 */
  async assertExists(id: number): Promise<void> {
    const found = await this.docRepo.exists({ where: { id } });
    if (!found) throw new NotFoundException(`Document #${id} not found`);
  }

  async create(data: Partial<DocumentEntity>): Promise<DocumentEntity> {
    // 新文档的修订号固定从 0 开始，不接受客户端指定。
    const doc = this.docRepo.create({ ...data, revision: 0 });
    return this.docRepo.save(doc);
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
    const updated = await this.writeLock.runExclusive(() =>
      this.conditionalUpdate(this.docRepo, id, baseRevision, data),
    );
    this.publishChange(updated, origin);
    return updated;
  }

  /**
   * 在调用方开启的事务（{@link transaction}）里执行同一条条件 UPDATE。
   * 事务尚未提交，所以这里不发布事件：调用方在 `transaction()` 返回（已提交）之后再
   * 调用 {@link publishChange}。revision 不符时抛 409，由事务回滚。
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
   * 同一时刻只运行一个这样的事务（以及一个 {@link update}）：TypeORM 的 SQLite 驱动整个进程共用
   * 一个连接，并发的 `transaction()` 不隔离——后开始的变成前者事务里的 SAVEPOINT，
   * 任何一方回滚都可能连带撤销另一方已完成的写入。所以排队执行，而不是依赖事件循环的调度碰巧不交错。
   *
   * `work` 内只能用传入的 manager（以及 {@link updateWithin}），不能调用 {@link update} 或再次调用本方法：
   * 锁不可重入，会死锁。
   */
  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.writeLock.runExclusive(() =>
      this.docRepo.manager.transaction(work),
    );
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
      at: new Date().toISOString(),
    });
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.docRepo.delete(id);
  }

  private async findOneIn(
    repo: Repository<DocumentEntity>,
    id: number,
  ): Promise<DocumentEntity> {
    const doc = await repo.findOne({ where: { id } });
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
      .where('id = :id AND revision = :baseRevision', { id, baseRevision })
      .execute();
    if (result.affected === 1) return this.findOneIn(repo, id);

    // 没有匹配到行：区分「文档不存在」与「revision 已变化」。
    const current = await repo.findOne({
      where: { id },
      select: { id: true, revision: true },
    });
    if (!current) throw new NotFoundException(`Document #${id} not found`);
    throw revisionConflict(current.revision, baseRevision);
  }
}
