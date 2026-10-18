import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { VersionEntity } from '../version/version.entity';

@Entity('documents')
export class DocumentEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'simple-json' })
  meta: {
    standardNo?: string;
    icsCode?: string;
    ccsCode?: string;
    titleCn: string;
    titleEn?: string;
    publishDate?: string;
    implementDate?: string;
    standardType: string;
  };

  @Column({ default: 'working_draft' })
  stage: string;

  @Column({ type: 'simple-json', nullable: true })
  content: Record<string, unknown>;

  /**
   * 修订号（乐观锁）：每次成功写入加 1，新文档与旧库已有文档均为 0。
   * 只能由 DocumentService.update 的条件 UPDATE 递增，客户端不能直接写入。
   */
  @Column({ type: 'integer', default: 0 })
  revision: number;

  /** 软删除时间；仅由 DocumentService 的回收站生命周期接口管理。 */
  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => VersionEntity, (version) => version.document)
  versions: VersionEntity[];
}
