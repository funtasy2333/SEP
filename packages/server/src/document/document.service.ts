import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentEntity } from './document.entity';

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
    const doc = this.docRepo.create(data);
    return this.docRepo.save(doc);
  }

  async update(
    id: number,
    data: Partial<DocumentEntity>,
  ): Promise<DocumentEntity> {
    const doc = await this.findOne(id);
    Object.assign(doc, data);
    return this.docRepo.save(doc);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.docRepo.delete(id);
  }
}
