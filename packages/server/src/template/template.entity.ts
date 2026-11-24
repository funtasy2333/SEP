import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  CoverLayoutConfig,
  DocumentStage,
  StandardType,
  TemplateDefaultMeta,
  TemplateSource,
} from '@ses/shared';

@Entity('templates')
export class TemplateEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 36, unique: true })
  uid: string;

  @Column()
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 32 })
  baseType: StandardType;

  @Column({ type: 'varchar', length: 32, default: 'working_draft' })
  defaultStage: DocumentStage;

  @Column('simple-json')
  defaultMeta: TemplateDefaultMeta;

  @Column('simple-json', { nullable: true })
  coverLayout: CoverLayoutConfig | null;

  @Column('simple-json')
  content: Record<string, unknown>;

  @Column('simple-json', { nullable: true })
  previousContent: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 16, default: 'human' })
  source: TemplateSource;

  @Column({ type: 'integer', default: 0 })
  revision: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
