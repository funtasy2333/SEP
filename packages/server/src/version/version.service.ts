import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VersionEntity } from './version.entity';

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
    const version = this.versionRepo.create(data);
    return this.versionRepo.save(version);
  }
}
