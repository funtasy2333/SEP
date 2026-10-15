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

  /**
   * 写入前的文档内容：仅 AI 写入的版本记录有（`source = 'ai'` 且由 operations 接口生成），其余为 null。
   * `baseContent → content` 就是这一批 AI 修改，不混入其间人的编辑。
   *
   * select: false：版本列表不返回它（列表已经带着每个版本的完整 content，再带 baseContent 体积会翻倍），
   * 只有单个版本的详情接口显式取出（VersionService.findOne）。
   */
  @Column({ type: 'simple-json', nullable: true, select: false })
  baseContent: Record<string, unknown> | null;

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
