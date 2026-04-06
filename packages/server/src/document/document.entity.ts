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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => VersionEntity, (version) => version.document)
  versions: VersionEntity[];
}
