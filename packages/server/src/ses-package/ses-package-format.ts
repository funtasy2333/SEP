import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { TextDecoder } from 'node:util';
import type { DocumentEntity } from '../document/document.entity';
import { parseDocumentMeta } from '../document/document-update';
import { EditorContentError } from '../editor-schema/editor-content-error';
import { normalizeContent } from '../editor-schema/editor-schema';
import { schemaProblemDetails, unprocessable } from '../common/http-errors';
import { parseCreatedAt } from '../export/export-http';
import { MAX_CLIENT_LENGTH } from '../version/version.service';
import {
  VERSION_SOURCES,
  type VersionEntity,
  type VersionSource,
} from '../version/version.entity';

export const SES_PACKAGE_FORMAT = 'ses-document-package';
export const SES_PACKAGE_FORMAT_VERSION = 1;
export const SES_PACKAGE_MIME = 'application/vnd.ses-package+json';
export const SES_PACKAGE_BODY_LIMIT = '200mb';

export interface SesPackageDocument {
  uid: string;
  title: string;
  meta: DocumentEntity['meta'];
  stage: string;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SesPackageVersion {
  uid: string;
  versionNo: string;
  stage: string;
  content: Record<string, unknown>;
  baseContent: Record<string, unknown> | null;
  note: string | null;
  source: VersionSource;
  client: string | null;
  createdAt: string;
}

export interface SesPackage {
  format: typeof SES_PACKAGE_FORMAT;
  formatVersion: typeof SES_PACKAGE_FORMAT_VERSION;
  exportedAt: string;
  generator: { name: string; version: string };
  document: SesPackageDocument;
  versions: SesPackageVersion[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badRequest(path: string, detail: string): BadRequestException {
  return new BadRequestException(`${path} ${detail}`);
}

function requiredObject(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) throw badRequest(path, '必须是 JSON 对象');
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw badRequest(path, '必须是字符串');
  return value;
}

function requiredUid(value: unknown, path: string): string {
  const uid = requiredString(value, path);
  if (!UUID_PATTERN.test(uid)) throw badRequest(path, '必须是合法 UUID');
  return uid;
}

function requiredDate(value: unknown, path: string): string {
  const date = requiredString(value, path);
  try {
    const parsed = parseCreatedAt(date);
    if (parsed === undefined) {
      throw badRequest(path, '必须是有效的带时区 ISO 8601 时间');
    }
    return parsed;
  } catch {
    throw badRequest(path, '必须是有效的带时区 ISO 8601 时间');
  }
}

function validateCurrentContent(
  content: unknown,
): asserts content is Record<string, unknown> {
  try {
    // normalizeContent 的返回值会补属性或修复 nodeId；包格式必须保留原 JSON，所以这里只校验。
    normalizeContent(content);
  } catch (error) {
    if (error instanceof EditorContentError) {
      throw unprocessable(
        `document.content 校验失败：${error.message}`,
        schemaProblemDetails(error),
      );
    }
    throw error;
  }
  if (!isObject(content)) {
    throw unprocessable('当前正文必须是 JSON 对象', {
      source: 'schema',
      detail: '当前正文必须是 JSON 对象',
      problems: [],
    });
  }
}

function requiredDocumentMeta(value: unknown): DocumentEntity['meta'] {
  try {
    return parseDocumentMeta(value);
  } catch (error) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof response === 'object' && response !== null
            ? (response as { message?: unknown }).message
            : undefined;
      if (typeof message === 'string') {
        if (message.startsWith('meta.')) {
          throw new BadRequestException(`document.${message}`);
        }
        throw badRequest('document.meta', message);
      }
    }
    throw error;
  }
}

function requiredVersionContent(
  value: unknown,
  path: string,
): Record<string, unknown> {
  const content = requiredObject(value, path);
  if (content.type !== 'doc') {
    throw badRequest(`${path}.type`, '必须是字符串 "doc"');
  }
  return content;
}

function parseVersion(
  value: unknown,
  index: number,
  usedUids: Set<string>,
): SesPackageVersion {
  const path = `versions[${index}]`;
  const source = requiredObject(value, path);
  const uid = requiredUid(source.uid, `${path}.uid`);
  if (usedUids.has(uid.toLowerCase())) {
    throw badRequest(`${path}.uid`, '不能与其他版本 uid 重复');
  }
  usedUids.add(uid.toLowerCase());

  const rawSource = requiredString(source.source, `${path}.source`);
  if (!(VERSION_SOURCES as readonly string[]).includes(rawSource)) {
    throw badRequest(
      `${path}.source`,
      `必须是 ${VERSION_SOURCES.join(' / ')} 之一`,
    );
  }

  let client: string | null;
  if (source.client === null) {
    client = null;
  } else {
    client = requiredString(source.client, `${path}.client`);
    if (client.length > MAX_CLIENT_LENGTH) {
      throw badRequest(
        `${path}.client`,
        `长度不能超过 ${MAX_CLIENT_LENGTH} 个字符`,
      );
    }
  }

  let note: string | null;
  if (source.note === null) note = null;
  else note = requiredString(source.note, `${path}.note`);

  let baseContent: Record<string, unknown> | null;
  if (source.baseContent === null) {
    baseContent = null;
  } else {
    baseContent = requiredVersionContent(
      source.baseContent,
      `${path}.baseContent`,
    );
  }

  return {
    uid,
    versionNo: requiredString(source.versionNo, `${path}.versionNo`),
    stage: requiredString(source.stage, `${path}.stage`),
    content: requiredVersionContent(source.content, `${path}.content`),
    baseContent,
    note,
    source: rawSource as VersionSource,
    client,
    createdAt: requiredDate(source.createdAt, `${path}.createdAt`),
  };
}

/**
 * 构建 SES v1 包，仅显式摘取允许出包的字段。版本顺序沿用调用方提供的顺序。
 */
export function buildSesPackage(
  document: DocumentEntity,
  versions: VersionEntity[],
  exportedAt: Date = new Date(),
): SesPackage {
  if (document.uid === null) {
    throw new InternalServerErrorException(
      '文档 uid 缺失，无法导出 SES 文档包',
    );
  }
  for (const [index, version] of versions.entries()) {
    if (version.uid === null) {
      throw new InternalServerErrorException(
        `版本 #${index + 1} uid 缺失，无法导出 SES 文档包`,
      );
    }
  }

  validateCurrentContent(document.content);

  return {
    format: SES_PACKAGE_FORMAT,
    formatVersion: SES_PACKAGE_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    generator: { name: 'SES', version: '0.1.0' },
    document: {
      uid: document.uid,
      title: document.title,
      meta: document.meta,
      stage: document.stage,
      content: document.content,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    },
    versions: versions.map((version) => ({
      uid: version.uid as string,
      versionNo: version.versionNo,
      stage: version.stage,
      content: version.content,
      baseContent: version.baseContent,
      note: version.note,
      source: version.source,
      client: version.client,
      createdAt: version.createdAt.toISOString(),
    })),
  };
}

/** 解析和逐字段校验 SES v1 JSON；未知可选字段忽略，所有输出均显式摘取。 */
export function parseSesPackage(input: Buffer | string): SesPackage {
  let json: string;
  if (typeof input === 'string') {
    json = input;
  } else if (Buffer.isBuffer(input)) {
    try {
      json = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw new BadRequestException('SES 文档包包含无效的 UTF-8 字节');
    }
  } else {
    throw new BadRequestException('SES 文档包必须是 UTF-8 字符串或 Buffer');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new BadRequestException('SES 文档包 JSON 格式无效');
  }

  const root = requiredObject(parsed, 'package');
  if (root.format !== SES_PACKAGE_FORMAT) {
    throw badRequest('format', `必须是 "${SES_PACKAGE_FORMAT}"`);
  }
  if (
    typeof root.formatVersion !== 'number' ||
    !Number.isSafeInteger(root.formatVersion) ||
    root.formatVersion < 1
  ) {
    throw badRequest('formatVersion', '必须是正整数');
  }
  if (root.formatVersion > SES_PACKAGE_FORMAT_VERSION) {
    throw badRequest(
      'formatVersion',
      `包格式版本 ${root.formatVersion} 高于当前支持版本 ${SES_PACKAGE_FORMAT_VERSION}，请升级 SES 后再导入`,
    );
  }
  if (root.formatVersion !== SES_PACKAGE_FORMAT_VERSION) {
    throw badRequest(
      'formatVersion',
      `当前仅支持版本 ${SES_PACKAGE_FORMAT_VERSION}`,
    );
  }

  const generator = requiredObject(root.generator, 'generator');
  const document = requiredObject(root.document, 'document');
  const rawContent = document.content;
  validateCurrentContent(rawContent);

  const rawVersions = root.versions;
  if (!Array.isArray(rawVersions)) {
    throw badRequest('versions', '必须是数组');
  }
  const usedUids = new Set<string>();
  const versions = rawVersions.map((version, index) =>
    parseVersion(version, index, usedUids),
  );

  return {
    format: SES_PACKAGE_FORMAT,
    formatVersion: SES_PACKAGE_FORMAT_VERSION,
    exportedAt: requiredDate(root.exportedAt, 'exportedAt'),
    generator: {
      name: requiredString(generator.name, 'generator.name'),
      version: requiredString(generator.version, 'generator.version'),
    },
    document: {
      uid: requiredUid(document.uid, 'document.uid'),
      title: requiredString(document.title, 'document.title'),
      meta: requiredDocumentMeta(document.meta),
      stage: requiredString(document.stage, 'document.stage'),
      // 上面的 normalizeContent 只校验当前编辑器 schema；正文仍保留调用方传入的原始 JSON。
      content: rawContent,
      createdAt: requiredDate(document.createdAt, 'document.createdAt'),
      updatedAt: requiredDate(document.updatedAt, 'document.updatedAt'),
    },
    versions,
  };
}
