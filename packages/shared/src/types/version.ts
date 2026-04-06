import { DocumentStage } from './document';

/**
 * 版本实体
 */
export interface Version {
  id: number;
  documentId: number;
  /** 版本号，如 "1.0", "1.1" */
  versionNo: string;
  /** 该版本所处阶段 */
  stage: DocumentStage;
  /** ProseMirror JSON 快照 */
  content: Record<string, unknown>;
  /** XML 快照 */
  xml?: string;
  /** 版本备注 */
  note?: string;
  createdAt: string;
}

/**
 * 创建版本 DTO
 */
export interface CreateVersionDto {
  documentId: number;
  versionNo: string;
  stage: DocumentStage;
  content: Record<string, unknown>;
  xml?: string;
  note?: string;
}
