import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VERSION_SOURCES, VersionEntity } from './version.entity';

const MAX_CLIENT_LENGTH = 200;

@Injectable()
export class VersionService {
  constructor(
    @InjectRepository(VersionEntity)
    private readonly versionRepo: Repository<VersionEntity>,
  ) {}

  async findByDocument(documentId: number): Promise<VersionEntity[]> {
    return this.versionRepo.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<VersionEntity> {
    const version = await this.versionRepo.findOne({ where: { id } });
    if (!version) throw new NotFoundException(`Version #${id} not found`);
    return version;
  }

  async create(data: Partial<VersionEntity>): Promise<VersionEntity> {
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
    const version = this.versionRepo.create(data);
    return this.versionRepo.save(version);
  }
}
