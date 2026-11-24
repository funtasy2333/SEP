import type { DocumentMeta, DocumentStage, StandardType } from './document';

/**
 * 模板来源：
 * - builtin: 系统内置 6 类只读标准模板
 * - human: 用户在网页端创建或从文档保存
 * - agent: AI Agent 通过 MCP 工具创建
 * - import: 通过 .sestpl 单模板包导入
 *
 * 使用 const 对象 + 联合类型而非 enum，以兼容 client 的 erasableSyntaxOnly。
 */
export const TemplateSource = {
  BUILTIN: 'builtin',
  HUMAN: 'human',
  AGENT: 'agent',
  IMPORT: 'import',
} as const;

export type TemplateSource = (typeof TemplateSource)[keyof typeof TemplateSource];

/** 封面徽标定位 */
export const CoverLogoPosition = {
  REPLACE_MARK: 'replace_mark',
  TOP_LEFT: 'top_left',
  CENTER: 'center',
} as const;

export type CoverLogoPosition = (typeof CoverLogoPosition)[keyof typeof CoverLogoPosition];

/** 封面徽标图片配置（仅接受内联 PNG/JPEG data URL） */
export interface CoverLogoConfig {
  dataUrl: string;
  position: CoverLogoPosition;
  widthMm: number;
  heightMm: number;
  alt?: string;
}

/** 封面附加声明位置 */
export const CoverNoticePosition = {
  ABOVE_DATES: 'above_dates',
  BELOW_ISSUER: 'below_issuer',
} as const;

export type CoverNoticePosition = (typeof CoverNoticePosition)[keyof typeof CoverNoticePosition];

/** 封面附加声明配置 */
export interface CoverNoticeConfig {
  text: string;
  position: CoverNoticePosition;
}

/** 封底 / 版权页配置（独立末页、无页眉页脚与页码） */
export interface BackCoverConfig {
  enabled: boolean;
  title?: string;
  copyrightNotice?: string;
  publisherInfo?: string;
  contactInfo?: string;
  note?: string;
}

/**
 * 封面与版式视觉扩展配置。
 * 仅存储在 DocumentMeta.coverLayout 与 templates.coverLayout，不写入 ProseMirror coverPage.attrs 或 IRDoc.meta。
 */
export interface CoverLayoutConfig {
  logo?: CoverLogoConfig;
  notice?: CoverNoticeConfig;
  backCover?: BackCoverConfig;
}

/** 模板预设元信息 */
export type TemplateDefaultMeta = Partial<
  Omit<DocumentMeta, 'titleCn' | 'coverLayout' | 'sourceTemplateUid' | 'sourceTemplateName'>
> & {
  /** 标准编号前缀（如 T/XXX、Q/XXX、DBXX/T） */
  stdPrefix?: string;
};

/** 标准模板（含内置只读模板与组织自定义模板） */
export interface StandardTemplate {
  id: string | number;
  uid: string;
  name: string;
  description: string;
  baseType: StandardType;
  defaultStage: DocumentStage;
  defaultMeta: TemplateDefaultMeta;
  coverLayout?: CoverLayoutConfig;
  content: Record<string, unknown>;
  source: TemplateSource;
  readonly: boolean;
  revision: number;
  hasPreviousContent?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
