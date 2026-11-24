import { BadRequestException } from '@nestjs/common';
import { TextDecoder } from 'node:util';
import {
  DocumentStage,
  StandardType,
  validateCoverLayout,
  type CoverLayoutConfig,
  type StandardTemplate,
  type TemplateDefaultMeta,
} from '@ses/shared';
import { SES_SERVER_VERSION } from '../common/app-version';
import { schemaProblemDetails, unprocessable } from '../common/http-errors';
import { EditorContentError } from '../editor-schema/editor-content-error';
import { normalizeContent } from '../editor-schema/editor-schema';
import { parseCreatedAt } from '../export/export-http';

export const SES_TEMPLATE_FORMAT = 'ses-template-package';
export const SES_TEMPLATE_FORMAT_VERSION = 1;
export const SES_TEMPLATE_MIME = 'application/vnd.ses-template+json';
export const SES_TEMPLATE_BODY_LIMIT = '50mb';

export interface SesTemplatePackagePayload {
  uid: string;
  name: string;
  description: string;
  baseType: StandardType;
  defaultStage: DocumentStage;
  defaultMeta: TemplateDefaultMeta;
  coverLayout?: CoverLayoutConfig;
  content: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SesTemplatePackage {
  format: typeof SES_TEMPLATE_FORMAT;
  formatVersion: typeof SES_TEMPLATE_FORMAT_VERSION;
  exportedAt: string;
  generator: { name: string; version: string };
  template: SesTemplatePackagePayload;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STANDARD_TYPE_SET = new Set<string>(Object.values(StandardType));
const DOCUMENT_STAGE_SET = new Set<string>(Object.values(DocumentStage));
const DEFAULT_META_STRING_FIELDS = [
  'standardNo',
  'stdPrefix',
  'icsCode',
  'ccsCode',
  'titleEn',
  'publishDate',
  'implementDate',
  'standardType',
  'issuer',
  'applicant',
  'replaces',
  'consistency',
  'filingNo',
  'industryName',
  'regionName',
  'coverDesignation',
  'proposer',
  'technicalCommittee',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badRequest(path: string, detail: string): BadRequestException {
  return new BadRequestException(`${path} ${detail}`);
}

export function validateTemplateDefaultMeta(
  value: unknown,
  pathPrefix = 'defaultMeta',
): TemplateDefaultMeta {
  if (!isPlainObject(value)) {
    throw badRequest(pathPrefix, '必须是 JSON 对象');
  }
  const out: Record<string, string> = {};
  for (const key of DEFAULT_META_STRING_FIELDS) {
    const field = value[key];
    if (field !== undefined) {
      if (typeof field !== 'string') {
        throw badRequest(`${pathPrefix}.${key}`, '必须是字符串');
      }
      out[key] = field;
    }
  }
  return out as TemplateDefaultMeta;
}

export function validateTemplateContent(
  content: unknown,
  pathPrefix = 'template.content',
): Record<string, unknown> {
  if (!isPlainObject(content)) {
    throw unprocessable(`${pathPrefix} 必须是 JSON 对象`, {
      source: 'schema',
      detail: `${pathPrefix} 必须是 JSON 对象`,
      problems: [],
    });
  }
  try {
    normalizeContent(content);
  } catch (error) {
    if (error instanceof EditorContentError) {
      throw unprocessable(
        `${pathPrefix} 校验失败：${error.message}`,
        schemaProblemDetails(error),
      );
    }
    throw error;
  }
  return content;
}

export function buildTemplatePackage(
  template: StandardTemplate,
  exportedAt: Date = new Date(),
): SesTemplatePackage {
  validateTemplateContent(template.content, 'template.content');
  return {
    format: SES_TEMPLATE_FORMAT,
    formatVersion: SES_TEMPLATE_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    generator: { name: 'SES', version: SES_SERVER_VERSION },
    template: {
      uid: template.uid,
      name: template.name,
      description: template.description,
      baseType: template.baseType,
      defaultStage: template.defaultStage,
      defaultMeta: template.defaultMeta,
      ...(template.coverLayout ? { coverLayout: template.coverLayout } : {}),
      content: template.content,
      ...(template.createdAt ? { createdAt: template.createdAt } : {}),
      ...(template.updatedAt ? { updatedAt: template.updatedAt } : {}),
    },
  };
}

export function parseTemplatePackage(
  input: Buffer | string,
): SesTemplatePackage {
  let raw: string;
  if (typeof input === 'string') {
    raw = input;
  } else {
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw new BadRequestException('模板包不是有效的 UTF-8 文本');
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('模板包不是有效的 JSON');
  }
  if (!isPlainObject(parsed)) {
    throw new BadRequestException('模板包根节点必须是 JSON 对象');
  }

  if (parsed.format !== SES_TEMPLATE_FORMAT) {
    throw badRequest('format', `必须是 ${SES_TEMPLATE_FORMAT}`);
  }
  if (parsed.formatVersion !== SES_TEMPLATE_FORMAT_VERSION) {
    throw badRequest(
      'formatVersion',
      `必须是 ${SES_TEMPLATE_FORMAT_VERSION}`,
    );
  }
  if (typeof parsed.exportedAt !== 'string') {
    throw badRequest('exportedAt', '必须是有效的带时区 ISO 8601 时间');
  }
  try {
    if (parseCreatedAt(parsed.exportedAt) === undefined) {
      throw badRequest('exportedAt', '必须是有效的带时区 ISO 8601 时间');
    }
  } catch {
    throw badRequest('exportedAt', '必须是有效的带时区 ISO 8601 时间');
  }

  if (!isPlainObject(parsed.generator) || typeof parsed.generator.name !== 'string' || typeof parsed.generator.version !== 'string') {
    throw badRequest('generator', '必须包含 name 与 version 字符串');
  }

  if (!isPlainObject(parsed.template)) {
    throw badRequest('template', '必须是 JSON 对象');
  }
  const tpl = parsed.template;
  if (typeof tpl.uid !== 'string' || !UUID_PATTERN.test(tpl.uid)) {
    throw badRequest('template.uid', '必须是合法 UUID');
  }
  if (typeof tpl.name !== 'string' || tpl.name.trim().length === 0) {
    throw badRequest('template.name', '必须是非空字符串');
  }
  const description =
    tpl.description === undefined
      ? ''
      : typeof tpl.description === 'string'
        ? tpl.description
        : (() => {
            throw badRequest('template.description', '必须是字符串');
          })();

  if (typeof tpl.baseType !== 'string' || !STANDARD_TYPE_SET.has(tpl.baseType)) {
    throw badRequest(
      'template.baseType',
      `必须是 ${[...STANDARD_TYPE_SET].join(' / ')} 之一`,
    );
  }
  const baseType = tpl.baseType as StandardType;

  const defaultStageRaw = tpl.defaultStage ?? DocumentStage.WORKING_DRAFT;
  if (
    typeof defaultStageRaw !== 'string' ||
    !DOCUMENT_STAGE_SET.has(defaultStageRaw)
  ) {
    throw badRequest(
      'template.defaultStage',
      `必须是 ${[...DOCUMENT_STAGE_SET].join(' / ')} 之一`,
    );
  }
  const defaultStage = defaultStageRaw as DocumentStage;

  const defaultMeta =
    tpl.defaultMeta === undefined
      ? {}
      : validateTemplateDefaultMeta(tpl.defaultMeta, 'template.defaultMeta');

  let coverLayout: CoverLayoutConfig | undefined;
  if (tpl.coverLayout !== undefined && tpl.coverLayout !== null) {
    const check = validateCoverLayout(
      tpl.coverLayout,
      baseType,
      'template.coverLayout',
    );
    if (!check.valid) {
      throw new BadRequestException(check.errors[0]!.message);
    }
    coverLayout = check.value;
  }

  const content = validateTemplateContent(tpl.content, 'template.content');

  return {
    format: SES_TEMPLATE_FORMAT,
    formatVersion: SES_TEMPLATE_FORMAT_VERSION,
    exportedAt: parsed.exportedAt,
    generator: {
      name: parsed.generator.name,
      version: parsed.generator.version,
    },
    template: {
      uid: tpl.uid,
      name: tpl.name.trim(),
      description,
      baseType,
      defaultStage,
      defaultMeta,
      ...(coverLayout ? { coverLayout } : {}),
      content,
      ...(typeof tpl.createdAt === 'string' ? { createdAt: tpl.createdAt } : {}),
      ...(typeof tpl.updatedAt === 'string' ? { updatedAt: tpl.updatedAt } : {}),
    },
  };
}
