import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DocumentEntity } from '../document/document.entity';

@Entity('versions')
export class VersionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  documentId: number;

  @Column()
  versionNo: string;

  @Column({ default: 'working_draft' })
  stage: string;

  @Column({ type: 'simple-json' })
  content: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  xml: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => DocumentEntity, (doc) => doc.versions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'documentId' })
  document: DocumentEntity;
}
