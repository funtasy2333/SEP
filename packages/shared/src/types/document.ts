/**
 * 标准文件类型
 *
 * 使用 const 对象 + 联合类型而非 enum，以兼容 client 的 erasableSyntaxOnly
 */
export const StandardType = {
  /** 国家标准 */
  NATIONAL: 'national',
  /** 行业标准 */
  INDUSTRY: 'industry',
  /** 地方标准 */
  LOCAL: 'local',
  /** 团体标准 */
  GROUP: 'group',
  /** 企业标准 */
  ENTERPRISE: 'enterprise',
  /** 标准化指导性技术文件 */
  GUIDANCE: 'guidance',
} as const;

export type StandardType = (typeof StandardType)[keyof typeof StandardType];

/**
 * 标准文件阶段
 */
export const DocumentStage = {
  /** 工作草案 */
  WORKING_DRAFT: 'working_draft',
  /** 征求意见稿 */
  COMMENT_DRAFT: 'comment_draft',
  /** 送审讨论稿 */
  REVIEW_DISCUSSION_DRAFT: 'review_discussion_draft',
  /** 送审稿 */
  REVIEW_DRAFT: 'review_draft',
  /** 报批稿 */
  APPROVAL_DRAFT: 'approval_draft',
  /** 公示稿 */
  PUBLIC_DRAFT: 'public_draft',
  /** 发布稿 */
  PUBLISHED: 'published',
} as const;

export type DocumentStage = (typeof DocumentStage)[keyof typeof DocumentStage];

/**
 * 文档元数据
 */
export interface DocumentMeta {
  /** 标准编号 */
  standardNo?: string;
  /** ICS 分类号 */
  icsCode?: string;
  /** CCS 分类号 */
  ccsCode?: string;
  /** 标准名称(中文) */
  titleCn: string;
  /** 标准名称(英文) */
  titleEn?: string;
  /** 发布日期 */
  publishDate?: string;
  /** 实施日期 */
  implementDate?: string;
  /** 标准类型 */
  standardType: StandardType;
  /** 标准发布单位 */
  issuer?: string;
  /** 标准申请单位 */
  applicant?: string;
  /** 被代替的标准文件编号 */
  replaces?: string;
  /** 一致性程度标识 */
  consistency?: string;
  /** 备案号（行业标准封面） */
  filingNo?: string;
  /** 行业名称 */
  industryName?: string;
  /** 地方名称 */
  regionName?: string;
  /** 封面标准称谓完整覆盖值；仅行业、地方、团体、企业标准使用 */
  coverDesignation?: string;
  /** 提出单位 */
  proposer?: string;
  /** 归口单位 */
  technicalCommittee?: string;
}

/**
 * 文档实体
 */
export interface Document {
  id: number;
  title: string;
  meta: DocumentMeta;
  /** 当前阶段 */
  stage: DocumentStage;
  /** ProseMirror JSON 内容 */
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * 创建文档 DTO
 */
export interface CreateDocumentDto {
  title: string;
  meta: DocumentMeta;
  stage?: DocumentStage;
  content?: Record<string, unknown>;
}

/**
 * 更新文档 DTO
 */
export interface UpdateDocumentDto {
  title?: string;
  meta?: Partial<DocumentMeta>;
  stage?: DocumentStage;
  content?: Record<string, unknown>;
}
