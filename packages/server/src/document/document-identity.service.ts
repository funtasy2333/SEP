import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { WriteCoordinator } from '../common/write-coordinator';
import { VersionEntity } from '../version/version.entity';
import { DocumentEntity } from './document.entity';

/** 为旧数据库中尚无稳定身份的文档与版本补齐 UUID。 */
@Injectable()
export class DocumentIdentityService implements OnModuleInit {
  constructor(
    @InjectRepository(VersionEntity)
    private readonly versionRepo: Repository<VersionEntity>,
    private readonly writes: WriteCoordinator,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.writes.run(() =>
      this.versionRepo.manager.transaction(async (manager) => {
        const documents = await manager.getRepository(DocumentEntity).find({
          select: { id: true },
          where: { uid: IsNull() },
        });
        for (const document of documents) {
          // 直接更新只填身份列，避免 ORM 自动改写 updatedAt 或碰 revision、删除态等字段。
          await manager.query(
            'UPDATE "documents" SET "uid" = ? WHERE "id" = ? AND "uid" IS NULL',
            [randomUUID(), document.id],
          );
        }

        const versions = await manager.getRepository(VersionEntity).find({
          select: { id: true },
          where: { uid: IsNull() },
        });
        for (const version of versions) {
          await manager.query(
            'UPDATE "versions" SET "uid" = ? WHERE "id" = ? AND "uid" IS NULL',
            [randomUUID(), version.id],
          );
        }
      }),
    );
  }
}
