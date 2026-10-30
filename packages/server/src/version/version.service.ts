import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { WriteCoordinator } from '../common/write-coordinator';
import { DocumentEntity } from '../document/document.entity';
import { VERSION_SOURCES, VersionEntity } from './version.entity';

/** client（写入方标识）的最大长度；operations 接口的 client 字段沿用同一上限。 */
export const MAX_CLIENT_LENGTH = 200;

/**
 * 下一个版本号，规则与 client 的 `getNextVersionNo`（stores/version.ts）一致：
 * 取最新一条版本的 `major.minor`，minor 加 1；还没有版本时为 `1.0`。
 * 修改这里时必须同步 client。
 */
export function nextVersionNo(latestVersionNo: string | undefined): string {
  if (latestVersionNo === undefined) return '1.0';
  const parts = latestVersionNo.split('.');
  const major = parseInt(parts[0]) || 1;
  const minor = (parseInt(parts[1]) || 0) + 1;
  return `${major}.${minor}`;
}

/** 一次 AI 写入要记录的版本。stage、content 与 baseContent 的含义见 operations 接口。 */
export interface AiVersionInput {
  documentId: number;
  stage: string;
  /** 写入后的内容。 */
  content: Record<string, unknown>;
  /** 写入前的内容。 */
  baseContent: Record<string, unknown>;
  client: string | null;
  note: string;
}

@Injectable()
export class VersionService {
  constructor(
    @InjectRepository(VersionEntity)
    private readonly versionRepo: Repository<VersionEntity>,
    @InjectRepository(DocumentEntity)
    private readonly documentRepo: Repository<DocumentEntity>,
    private readonly writes: WriteCoordinator,
  ) {}

  /**
   * 版本列表（最新在前）。不含 baseContent（见 VersionEntity.baseContent）。
   * createdAt 精度为秒，同一秒内的多条以 id 倒序为准，保证「最新一条」始终确定。
   *
   * 读取经过全服务端共用的写锁（见 {@link WriteCoordinator}）：operations 的事务打开期间，共享连接上的读
   * 会看到事务里尚未提交的版本；事务回滚后，这条版本就是从未存在过的。所以读排在在途事务之后
   * （读与写因此串行，对单连接的 SQLite 可以接受）。不可在 `DocumentService.transaction` 的回调里调用
   * （锁不可重入，会死锁）：事务内要读请用事务传入的 manager。
   */
  async findByDocument(documentId: number): Promise<VersionEntity[]> {
    return this.writes.run(async () => {
      const active = await this.documentRepo.exist({
        where: { id: documentId, deletedAt: IsNull() },
      });
      if (!active)
        throw new NotFoundException(`Document #${documentId} not found`);
      return this.versionRepo.find({
        where: { documentId },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
    });
  }

  /** 单个版本的详情，含 baseContent（列表接口不返回）。同样经过写锁，约定见 {@link findByDocument}。 */
  async findOne(id: number): Promise<VersionEntity> {
    const version = await this.writes.run(() =>
      this.versionRepo
        .createQueryBuilder('version')
        .innerJoin('version.document', 'document')
        .addSelect('version.baseContent')
        .where('version.id = :id', { id })
        .andWhere('document.deletedAt IS NULL')
        .getOne(),
    );
    if (!version) throw new NotFoundException(`Version #${id} not found`);
    return version;
  }

  /**
   * 创建版本（POST /api/versions）。写入经过全服务端共用的写锁（见 {@link WriteCoordinator}）：
   * 否则它可能落进 operations 正在进行的事务，随事务回滚一起消失，而调用方已经收到了 201。
   *
   * 不可在 `DocumentService.transaction` 的回调里调用（锁不可重入，会死锁）：事务内请用
   * {@link createForAiWrite}，它使用事务传入的 manager。
   */
  async create(data: Partial<VersionEntity>): Promise<VersionEntity> {
    if (
      typeof data.documentId !== 'number' ||
      !Number.isSafeInteger(data.documentId) ||
      data.documentId <= 0
    ) {
      throw new BadRequestException('documentId 必须是正整数');
    }
    // source 缺省为 human；给出时必须是已知取值。client 可空，仅作标识。
    if (
      data.source !== undefined &&
      !(VERSION_SOURCES as readonly unknown[]).includes(data.source)
    ) {
      throw new BadRequestException(
        `source 必须是 ${VERSION_SOURCES.join(' / ')} 之一`,
      );
    }
    if (
      data.client !== undefined &&
      data.client !== null &&
      (typeof data.client !== 'string' ||
        data.client.length > MAX_CLIENT_LENGTH)
    ) {
      throw new BadRequestException(
        `client 必须是不超过 ${MAX_CLIENT_LENGTH} 个字符的字符串`,
      );
    }
    if (
      data.baseContent !== undefined &&
      data.baseContent !== null &&
      (typeof data.baseContent !== 'object' || Array.isArray(data.baseContent))
    ) {
      throw new BadRequestException('baseContent 必须是 JSON 对象');
    }
    // 仅复制 API 允许的字段，尤其忽略 id/createdAt/document，避免客户端显式 id 触发 upsert。
    const version = this.versionRepo.create({
      uid: randomUUID(),
      documentId: data.documentId,
      versionNo: data.versionNo,
      stage: data.stage,
      content: data.content,
      xml: data.xml,
      note: data.note,
      source: data.source,
      client: data.client,
      baseContent: data.baseContent,
    });
    return this.writes.run(async () => {
      const active = await this.documentRepo.exist({
        where: { id: data.documentId, deletedAt: IsNull() },
      });
      if (!active)
        throw new NotFoundException(`Document #${data.documentId} not found`);
      return this.versionRepo.save(version);
    });
  }

  /**
   * 在调用方的事务里插入一条 AI 写入的版本记录（source = 'ai'，xml 为空）。
   * 版本号在同一事务内按该文档最新一条版本计算，见 {@link nextVersionNo}。
   * 调用方（DocumentService.transaction）保证同一时刻只有一个这样的事务，所以「读最新版本号 → 插入」之间
   * 不会有别的 AI 写入插进来。
   *
   * 只能在 `DocumentService.transaction` 的回调里调用，并且**不加锁**：事务本身已经持有写锁，
   * 锁不可重入，再次加锁会死锁。写入必须走传入的 manager（同一事务），不要改用 versionRepo。
   */
  async createForAiWrite(
    manager: EntityManager,
    input: AiVersionInput,
  ): Promise<VersionEntity> {
    const repo = manager.getRepository(VersionEntity);
    const latest = await repo.findOne({
      where: { documentId: input.documentId },
      order: { createdAt: 'DESC', id: 'DESC' },
      select: { id: true, versionNo: true },
    });
    const version = repo.create({
      uid: randomUUID(),
      documentId: input.documentId,
      versionNo: nextVersionNo(latest?.versionNo),
      stage: input.stage,
      content: input.content,
      baseContent: input.baseContent,
      // xml 不赋值：列可空，AI 写入不生成 XML。
      note: input.note,
      source: 'ai',
      client: input.client,
    });
    return repo.save(version);
  }
}
