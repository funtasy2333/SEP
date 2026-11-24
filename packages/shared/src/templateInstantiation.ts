import { buildCoverDesignation, getCoverDesignationName, getCoverDesignationParts } from './coverDesignation';
import { cloneCoverLayout, downgradeCoverLayoutForStandardType } from './coverLayoutValidation';
import type { PMJsonNode } from './ir/pmToIr';
import { DocumentStage, StandardType, type CreateDocumentDto, type DocumentMeta } from './types/document';
import type { CoverLayoutConfig, StandardTemplate } from './types/template';

export interface NewDocForm {
  type: StandardType;
  stage: DocumentStage;
  stdPrefix: string;
  stdNo: string;
  titleCn: string;
  titleEn: string;
  icsCode: string;
  ccsCode: string;
  issuer: string;
  applicant: string;
  proposer: string;
  technicalCommittee: string;
  replaces: string;
  consistency: string;
  filingNo?: string;
  industryName?: string;
  regionName?: string;
  coverDesignation?: string;
}

export const STANDARD_NO_PLACEHOLDER = 'XXXXX—XXXX';

export const STANDARD_TYPE_PREFIXES: Readonly<Record<StandardType, string>> = {
  national: 'GB/T',
  industry: 'XX/T',
  local: 'DBXX/T',
  group: 'T/XXX',
  enterprise: 'Q/XXX',
  guidance: 'GB/Z',
};

const COVER_ATTR_KEYS = [
  'standardType',
  'standardNo',
  'titleCn',
  'titleEn',
  'icsCode',
  'ccsCode',
  'issuer',
  'applicant',
  'proposer',
  'technicalCommittee',
  'publishDate',
  'implementDate',
  'replaces',
  'consistency',
  'filingNo',
  'industryName',
  'regionName',
  'coverDesignation',
] as const;

export const TEMPLATE_PLACEHOLDER_KEYS = [
  'titleCn',
  'titleEn',
  'standardNo',
  'proposer',
  'technicalCommittee',
  'applicant',
  'issuer',
  'icsCode',
  'ccsCode',
  'filingNo',
  'replaces',
  'consistency',
  'coverDesignation',
  'industryName',
  'regionName',
] as const;

export type TemplatePlaceholderKey = (typeof TEMPLATE_PLACEHOLDER_KEYS)[number];

const PLACEHOLDER_KEY_SET = new Set<string>(TEMPLATE_PLACEHOLDER_KEYS);
const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** 预览和创建共用，空编号也保存可见占位符；不推定未分配的年份。 */
export function newDocumentStandardNo(form: Pick<NewDocForm, 'type' | 'stdPrefix' | 'stdNo'>): string {
  const prefix = form.stdPrefix.trim() || STANDARD_TYPE_PREFIXES[form.type];
  return `${prefix} ${form.stdNo.trim() || STANDARD_NO_PLACEHOLDER}`;
}

const textParagraph = (text: string): PMJsonNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

/** 新建文档和手动添加前言使用同一默认文本。 */
export function createDefaultForeword(meta?: DocumentMeta): PMJsonNode {
  const foreword = [
    textParagraph('本文件按照GB/T 1.1-2020《标准化工作导则 第1部分：标准化文件的结构和起草规则》的规定起草。'),
    textParagraph('请注意本文件的某些内容可能涉及专利。本文件的发布机构不承担识别这些专利的责任。'),
  ];
  const proposer = meta?.proposer?.trim();
  const committee = meta?.technicalCommittee?.trim();
  const drafters = meta?.applicant?.trim();
  if (proposer) foreword.push(textParagraph(`本文件由${proposer}提出。`));
  if (committee) foreword.push(textParagraph(`本文件由${committee}归口。`));
  if (drafters) foreword.push(textParagraph(`本文件起草单位：${drafters}。`));

  foreword.push(textParagraph('本文件主要起草人：'));
  return { type: 'foreword', content: foreword };
}

/**
 * 规范性引用文件章的引导语（GB/T 1.1—2020 8.6.2），用于有规范性引用文件清单的情形。
 * 没有规范性引用文件时，应改为“本文件没有规范性引用文件。”。
 */
export const NORMATIVE_REFERENCES_LEAD =
  '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。' +
  '其中，注日期的引用文件，仅该日期对应的版本适用于本文件；不注日期的引用文件，其最新版本（包括所有的修改单）适用于本文件。';

/**
 * 术语和定义章的引导语（GB/T 1.1—2020 8.7.2），用于仅本文件界定的术语和定义适用的情形。其他情形应改为：
 * 没有需要界定的术语——“本文件没有需要界定的术语和定义。”；仅引用其他文件的术语——“……界定的术语和定义适用于本文件。”；
 * 同时采用其他文件和本文件界定的术语——“……界定的以及下列术语和定义适用于本文件。”。
 */
export const TERMS_AND_DEFINITIONS_LEAD = '下列术语和定义适用于本文件。';

const DEFAULT_CHAPTERS: ReadonlyArray<{ title: string; lead?: string }> = [
  { title: '范围' },
  { title: '规范性引用文件', lead: NORMATIVE_REFERENCES_LEAD },
  { title: '术语和定义', lead: TERMS_AND_DEFINITIONS_LEAD },
];

function buildCoverAttrsFromMeta(meta: DocumentMeta): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const key of COVER_ATTR_KEYS) {
    if (meta[key] !== undefined) attrs[key] = meta[key];
  }
  return attrs;
}

/** 仅用于新建/空内容初始化；正文已有内容时不重新套用模板（不覆盖、不重复插入用户已写的引导语）。 */
export function createDefaultDocumentContent(meta?: DocumentMeta): PMJsonNode & Record<string, unknown> {
  const content: PMJsonNode[] = [];
  if (meta) {
    // 保存到生产schema支持的封面属性，让XML/JSON和DOCX都能使用创建时的值。
    content.push({ type: 'coverPage', attrs: buildCoverAttrsFromMeta(meta), content: [{ type: 'paragraph' }] });
  }
  content.push(createDefaultForeword(meta));
  for (const [index, { title, lead }] of DEFAULT_CHAPTERS.entries()) {
    content.push({
      type: 'chapter',
      attrs: { number: String(index + 1) },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: title }] },
        // 引导语是无编号的普通正文段，可编辑；后续清单、术语条目由用户在其后添加。
        lead ? { type: 'stdParagraph', content: [{ type: 'text', text: lead }] } : { type: 'stdParagraph' },
      ],
    });
  }
  return { type: 'doc', content };
}

/** 一次创建即保存元数据和初始化正文，避免重新打开前文档只有空content。 */
export function createNewDocument(form: NewDocForm): CreateDocumentDto & { content: PMJsonNode & Record<string, unknown> } {
  const optional = (value: string) => value.trim() || undefined;
  const designationName = getCoverDesignationName({
    standardType: form.type,
    coverDesignation: form.coverDesignation,
    industryName: form.industryName,
    regionName: form.regionName,
  });
  const hasCustomParts = getCoverDesignationParts(form.type) !== undefined;
  const coverDesignation = hasCustomParts
    ? optional(designationName ? buildCoverDesignation(form.type, designationName) : '')
    : optional(form.coverDesignation ?? '');
  const meta: DocumentMeta = {
    titleCn: form.titleCn.trim(),
    titleEn: optional(form.titleEn),
    standardNo: newDocumentStandardNo(form),
    standardType: form.type,
    icsCode: optional(form.icsCode),
    ccsCode: optional(form.ccsCode),
    issuer: optional(form.issuer),
    applicant: optional(form.applicant),
    proposer: optional(form.proposer),
    technicalCommittee: optional(form.technicalCommittee),
    replaces: optional(form.replaces),
    consistency: optional(form.consistency),
    ...(form.filingNo !== undefined ? { filingNo: optional(form.filingNo) } : {}),
    industryName: form.type === 'industry' ? optional(designationName) : optional(form.industryName ?? ''),
    regionName: form.type === 'local' ? optional(designationName) : optional(form.regionName ?? ''),
    coverDesignation,
  };
  return { title: meta.titleCn, stage: form.stage, meta, content: createDefaultDocumentContent(meta) };
}

function makeBuiltinTemplate(
  idSuffix: StandardType,
  uid: string,
  name: string,
  description: string,
): StandardTemplate {
  const stdPrefix = STANDARD_TYPE_PREFIXES[idSuffix];
  const defaultMeta: DocumentMeta = {
    titleCn: '',
    standardType: idSuffix,
    standardNo: `${stdPrefix} ${STANDARD_NO_PLACEHOLDER}`,
  };
  return {
    id: `builtin:${idSuffix}`,
    uid,
    name,
    description,
    baseType: idSuffix,
    defaultStage: DocumentStage.WORKING_DRAFT,
    defaultMeta: {
      standardType: idSuffix,
      stdPrefix,
    },
    content: createDefaultDocumentContent(defaultMeta),
    source: 'builtin',
    readonly: true,
    revision: 0,
  };
}

/** 6 类只读内置标准模板（单一权威来源） */
export const BUILTIN_TEMPLATES: readonly StandardTemplate[] = [
  makeBuiltinTemplate(
    StandardType.NATIONAL,
    '00000000-0000-4000-8000-000000000001',
    '国家标准模板',
    'GB / GB/T 国家标准通用起草模板，内置 GB/T 1.1—2020 标准结构与封面格式。',
  ),
  makeBuiltinTemplate(
    StandardType.INDUSTRY,
    '00000000-0000-4000-8000-000000000002',
    '行业标准模板',
    '行业标准通用起草模板，支持行业代号、备案号及行业标准封面称谓配置。',
  ),
  makeBuiltinTemplate(
    StandardType.LOCAL,
    '00000000-0000-4000-8000-000000000003',
    '地方标准模板',
    'DB 地方标准通用起草模板，支持行政区划代号与地方标准封面称谓配置。',
  ),
  makeBuiltinTemplate(
    StandardType.GROUP,
    '00000000-0000-4000-8000-000000000004',
    '团体标准模板',
    'T/ 团体标准通用起草模板，支持学会/协会编号前缀与组织封面徽标定制。',
  ),
  makeBuiltinTemplate(
    StandardType.ENTERPRISE,
    '00000000-0000-4000-8000-000000000005',
    '企业标准模板',
    'Q/ 企业标准通用起草模板，支持企业代号、内控声明与版权封底配置。',
  ),
  makeBuiltinTemplate(
    StandardType.GUIDANCE,
    '00000000-0000-4000-8000-000000000006',
    '标准化指导性技术文件模板',
    'GB/Z 国家标准化指导性技术文件通用起草模板。',
  ),
];

export function getBuiltinTemplate(idOrUidOrType: string): StandardTemplate | undefined {
  const key = idOrUidOrType.trim();
  if (!key) return undefined;
  return BUILTIN_TEMPLATES.find(
    (tpl) => tpl.id === key || tpl.uid.toLowerCase() === key.toLowerCase() || tpl.baseType === key,
  );
}

/** 替换模板正文中的轻量占位变量 {{var}}；未填写/空白字段保留字面量原文 */
export function replaceTemplatePlaceholders(content: PMJsonNode, meta: DocumentMeta): PMJsonNode {
  const cloned = JSON.parse(JSON.stringify(content)) as PMJsonNode;

  const visit = (node: PMJsonNode): void => {
    if (node.type === 'coverPage') return;
    if (node.type === 'text' && typeof node.text === 'string') {
      node.text = node.text.replace(PLACEHOLDER_REGEX, (full, rawKey: string) => {
        if (!PLACEHOLDER_KEY_SET.has(rawKey)) return full;
        const val = meta[rawKey as TemplatePlaceholderKey];
        if (typeof val !== 'string') return full;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : full;
      });
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(child);
      }
    }
  };

  visit(cloned);
  return cloned;
}

export interface TemplateInstantiationOverrides {
  titleCn: string;
  titleEn?: string;
  type?: StandardType;
  stage?: DocumentStage;
  stdPrefix?: string;
  stdNo?: string;
  icsCode?: string;
  ccsCode?: string;
  issuer?: string;
  applicant?: string;
  proposer?: string;
  technicalCommittee?: string;
  replaces?: string;
  consistency?: string;
  filingNo?: string;
  industryName?: string;
  regionName?: string;
  coverDesignation?: string;
  coverLayout?: CoverLayoutConfig;
}

function mergeOptionalText(overrideValue: string | undefined, defaultValue: string | undefined): string | undefined {
  if (overrideValue !== undefined) {
    const trimmed = overrideValue.trim();
    return trimmed || undefined;
  }
  if (defaultValue !== undefined) {
    const trimmed = defaultValue.trim();
    return trimmed || undefined;
  }
  return undefined;
}

/** 根据模板与表单覆盖参数实例化新建文档（深拷贝并解耦，模板后续修改不影响已建文档） */
export function instantiateTemplateDocument(
  template: StandardTemplate,
  overrides: TemplateInstantiationOverrides,
): CreateDocumentDto {
  const type = overrides.type ?? template.baseType;
  const stage = overrides.stage ?? template.defaultStage ?? DocumentStage.WORKING_DRAFT;
  const defaults = template.defaultMeta ?? {};

  const stdPrefix =
    overrides.stdPrefix !== undefined
      ? overrides.stdPrefix.trim() || STANDARD_TYPE_PREFIXES[type]
      : defaults.stdPrefix?.trim() || STANDARD_TYPE_PREFIXES[type];
  const stdNoInput = overrides.stdNo?.trim() ?? '';
  const standardNo = stdNoInput
    ? `${stdPrefix} ${stdNoInput}`
    : defaults.standardNo?.trim() || `${stdPrefix} ${STANDARD_NO_PLACEHOLDER}`;

  const rawIndustryName = mergeOptionalText(overrides.industryName, defaults.industryName);
  const rawRegionName = mergeOptionalText(overrides.regionName, defaults.regionName);
  const rawCoverDesignation = mergeOptionalText(overrides.coverDesignation, defaults.coverDesignation);

  const designationName = getCoverDesignationName({
    standardType: type,
    coverDesignation: rawCoverDesignation,
    industryName: rawIndustryName,
    regionName: rawRegionName,
  });
  const hasCustomParts = getCoverDesignationParts(type) !== undefined;
  const coverDesignation = hasCustomParts
    ? (designationName ? buildCoverDesignation(type, designationName) : undefined)
    : rawCoverDesignation;

  const rawCoverLayout = cloneCoverLayout(overrides.coverLayout ?? template.coverLayout);
  const { coverLayout } = downgradeCoverLayoutForStandardType(rawCoverLayout, type);

  const meta: DocumentMeta = {
    titleCn: overrides.titleCn.trim(),
    titleEn: mergeOptionalText(overrides.titleEn, defaults.titleEn),
    standardNo,
    standardType: type,
    icsCode: mergeOptionalText(overrides.icsCode, defaults.icsCode),
    ccsCode: mergeOptionalText(overrides.ccsCode, defaults.ccsCode),
    issuer: mergeOptionalText(overrides.issuer, defaults.issuer),
    applicant: mergeOptionalText(overrides.applicant, defaults.applicant),
    proposer: mergeOptionalText(overrides.proposer, defaults.proposer),
    technicalCommittee: mergeOptionalText(overrides.technicalCommittee, defaults.technicalCommittee),
    publishDate: mergeOptionalText(undefined, defaults.publishDate),
    implementDate: mergeOptionalText(undefined, defaults.implementDate),
    replaces: mergeOptionalText(overrides.replaces, defaults.replaces),
    consistency: mergeOptionalText(overrides.consistency, defaults.consistency),
    ...(mergeOptionalText(overrides.filingNo, defaults.filingNo) !== undefined
      ? { filingNo: mergeOptionalText(overrides.filingNo, defaults.filingNo) }
      : {}),
    industryName: type === 'industry' ? designationName || undefined : rawIndustryName,
    regionName: type === 'local' ? designationName || undefined : rawRegionName,
    coverDesignation,
    ...(coverLayout ? { coverLayout } : {}),
    sourceTemplateUid: template.uid,
    sourceTemplateName: template.name,
  };

  let content: PMJsonNode & Record<string, unknown>;
  if (template.readonly || !template.content || !Array.isArray((template.content as { content?: unknown }).content)) {
    content = createDefaultDocumentContent(meta);
  } else {
    const replaced = replaceTemplatePlaceholders(template.content as unknown as PMJsonNode, meta);
    const children = Array.isArray(replaced.content) ? [...replaced.content] : [];
    const coverAttrs = buildCoverAttrsFromMeta(meta);
    if (children[0]?.type === 'coverPage') {
      children[0] = {
        ...children[0],
        attrs: { ...(children[0].attrs ?? {}), ...coverAttrs },
      };
    } else {
      children.unshift({ type: 'coverPage', attrs: coverAttrs, content: [{ type: 'paragraph' }] });
    }
    content = {
      ...replaced,
      type: 'doc',
      content: children,
    };
  }

  return {
    title: meta.titleCn,
    stage,
    meta,
    content,
  };
}
