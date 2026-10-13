import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DocumentEntity } from '../document/document.entity';

/** 版本来源：人工保存 / AI 写入前的快照 / 导入。 */
export const VERSION_SOURCES = ['human', 'ai', 'import'] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];

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

  @Column({ type: 'varchar', default: 'human' })
  source: VersionSource;

  /** 写入方标识（如 MCP 客户端名称），人工保存时为空。 */
  @Column({ type: 'text', nullable: true })
  client: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => DocumentEntity, (doc) => doc.versions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'documentId' })
  document: DocumentEntity;
}
