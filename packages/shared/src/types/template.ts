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

/** 封面徽标环绕方式：默认衬于文字下方 */
export const CoverLogoWrap = {
  BEHIND_TEXT: 'behind_text',
  INLINE: 'inline',
} as const;

export type CoverLogoWrap = (typeof CoverLogoWrap)[keyof typeof CoverLogoWrap];

/** 封面徽标图片配置（仅接受内联 PNG/JPEG data URL） */
export interface CoverLogoConfig {
  dataUrl: string;
  position: CoverLogoPosition;
  widthMm: number;
  heightMm: number;
  wrap?: CoverLogoWrap;
  offsetXMm?: number;
  offsetYMm?: number;
  alt?: string;
}

/** 封面右上角标准标志模式（非国标/指导性文件可隐藏或改文字） */
export const CoverTopRightMarkMode = {
  DEFAULT: 'default',
  HIDDEN: 'hidden',
  TEXT: 'text',
} as const;

export type CoverTopRightMarkMode = (typeof CoverTopRightMarkMode)[keyof typeof CoverTopRightMarkMode];

export interface CoverTopRightMarkConfig {
  mode: CoverTopRightMarkMode;
  text?: string;
  fontSizePt?: number;
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

export const BackCoverAlign = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
} as const;

export type BackCoverAlign = (typeof BackCoverAlign)[keyof typeof BackCoverAlign];

export const BackCoverVerticalAlign = {
  TOP: 'top',
  MIDDLE: 'middle',
  BOTTOM: 'bottom',
} as const;

export type BackCoverVerticalAlign = (typeof BackCoverVerticalAlign)[keyof typeof BackCoverVerticalAlign];

/** 独立封底 / 版权页自由内容块 */
export type BackCoverBlock =
  | {
      id: string;
      type: 'heading';
      text: string;
      align?: BackCoverAlign;
      fontSizePt?: number;
      bold?: boolean;
      spaceBeforeMm?: number;
      spaceAfterMm?: number;
    }
  | {
      id: string;
      type: 'paragraph';
      text: string;
      align?: BackCoverAlign;
      fontSizePt?: number;
      bold?: boolean;
      indent?: boolean;
      spaceBeforeMm?: number;
      spaceAfterMm?: number;
    }
  | {
      id: string;
      type: 'image';
      dataUrl: string;
      widthMm: number;
      heightMm: number;
      align?: BackCoverAlign;
      spaceBeforeMm?: number;
      spaceAfterMm?: number;
    }
  | {
      id: string;
      type: 'divider';
      spaceBeforeMm?: number;
      spaceAfterMm?: number;
    };

/** 封底 / 版权页配置（独立末页、无页眉页脚与页码） */
export interface BackCoverConfig {
  enabled: boolean;
  /** 新版自由块列表；提供时优先按 blocks 顺序渲染，否则兼容下方固定字段 */
  blocks?: BackCoverBlock[];
  verticalAlign?: BackCoverVerticalAlign;
  boxed?: boolean;
  title?: string;
  copyrightNotice?: string;
  publisherInfo?: string;
  contactInfo?: string;
  note?: string;
}

export const WatermarkKind = {
  TEXT: 'text',
  IMAGE: 'image',
} as const;

export type WatermarkKind = (typeof WatermarkKind)[keyof typeof WatermarkKind];

export const WatermarkFrequency = {
  EVERY: 'every',
  ALTERNATE: 'alternate',
} as const;

export type WatermarkFrequency = (typeof WatermarkFrequency)[keyof typeof WatermarkFrequency];

/** 正文页水印配置（目录/前言/引言/正文/附录/参考文献生效，封面与封底不渲染） */
export interface WatermarkConfig {
  enabled: boolean;
  kind: WatermarkKind;
  frequency: WatermarkFrequency;
  text?: string;
  fontSizePt?: number;
  color?: string;
  rotationDeg?: number;
  opacity?: number;
  dataUrl?: string;
  widthMm?: number;
  heightMm?: number;
}

/**
 * 封面与版式视觉扩展配置。
 * 仅存储在 DocumentMeta.coverLayout 与 templates.coverLayout，不写入 ProseMirror coverPage.attrs 或 IRDoc.meta。
 */
export interface CoverLayoutConfig {
  logo?: CoverLogoConfig;
  topRightMark?: CoverTopRightMarkConfig;
  notice?: CoverNoticeConfig;
  backCover?: BackCoverConfig;
  watermark?: WatermarkConfig;
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
