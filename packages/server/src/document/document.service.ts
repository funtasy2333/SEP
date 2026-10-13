import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type UpdateQueryBuilder } from 'typeorm';
import { DocumentEntity } from './document.entity';
import type { DocumentUpdateFields } from './document-update';

/** QueryBuilder 的 set() 参数类型不接受 Record<string, unknown>，统一在此处断言。 */
type DocumentSetValues = Parameters<
  UpdateQueryBuilder<DocumentEntity>['set']
>[0];

@Injectable()
export class DocumentService {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly docRepo: Repository<DocumentEntity>,
  ) {}

  async findAll(): Promise<DocumentEntity[]> {
    return this.docRepo.find({ order: { updatedAt: 'DESC' } });
  }

  async findOne(id: number): Promise<DocumentEntity> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException(`Document #${id} not found`);
    return doc;
  }

  async create(data: Partial<DocumentEntity>): Promise<DocumentEntity> {
    // 新文档的修订号固定从 0 开始，不接受客户端指定。
    const doc = this.docRepo.create({ ...data, revision: 0 });
    return this.docRepo.save(doc);
  }

  /**
   * 乐观锁更新：仅当文档当前 revision 等于 baseRevision 时写入并使 revision 加 1。
   *
   * 检查与写入必须是同一条 UPDATE（WHERE revision = :baseRevision），不能先读后写：
   * 两个带同一 baseRevision 的并发请求，数据库只会让其中一条匹配到行。
   * updatedAt 由 TypeORM 对 @UpdateDateColumn 自动附加到 SET 中。
   */
  async update(
    id: number,
    baseRevision: number,
    data: DocumentUpdateFields,
  ): Promise<DocumentEntity> {
    const result = await this.docRepo
      .createQueryBuilder()
      .update(DocumentEntity)
      .set({ ...data, revision: () => 'revision + 1' } as DocumentSetValues)
      .where('id = :id AND revision = :baseRevision', { id, baseRevision })
      .execute();
    if (result.affected === 1) return this.findOne(id);

    // 没有匹配到行：区分「文档不存在」与「revision 已变化」。
    const current = await this.docRepo.findOne({
      where: { id },
      select: { id: true, revision: true },
    });
    if (!current) throw new NotFoundException(`Document #${id} not found`);
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: `文档已被修改（当前 revision 为 ${current.revision}，请求基于 ${baseRevision}），本次写入未保存`,
      revision: current.revision,
    });
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.docRepo.delete(id);
  }
}
