import {
  BadRequestException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SES_SERVER_VERSION } from '../common/app-version';
import type { DocumentEntity } from '../document/document.entity';
import { canonical, sampleDocument } from '../test-support/sample-documents';
import type { VersionEntity, VersionSource } from '../version/version.entity';
import {
  buildSesPackage,
  parseSesPackage,
  SES_PACKAGE_BODY_LIMIT,
  SES_PACKAGE_FORMAT,
  SES_PACKAGE_FORMAT_VERSION,
  SES_PACKAGE_MIME,
  type SesPackage,
} from './ses-package-format';

const DOCUMENT_UID = '6f1c0459-bf20-4d7c-9e8b-983f51bcab57';
const VERSION_UID = 'a2e9e2bc-63b8-4d53-a2ad-709357b111c0';
const SECOND_VERSION_UID = 'ec5df0e7-d24e-48f7-b8c3-42d013a998ae';
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

type MutablePackage = {
  [key: string]: unknown;
  document: {
    [key: string]: unknown;
    meta: Record<string, unknown>;
  };
  versions: Array<{ [key: string]: unknown }>;
};

function contentWithImages(): Record<string, unknown> {
  const content = structuredClone(canonical(sampleDocument()));
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const node = value as Record<string, unknown>;
    if (node.type === 'stdParagraph') {
      const children = node.content as Record<string, unknown>[];
      children.push({
        type: 'inlineImage',
        attrs: {
          src: PNG_DATA_URL,
          resourceId: 'resource-1',
          alt: '微小图像',
          size: 'S',
        },
      });
      return true;
    }
    return Array.isArray(node.content) && node.content.some(visit);
  };
  visit(content);
  (content.content as Record<string, unknown>[]).push({
    type: 'figureResource',
    attrs: {
      nodeId: 'resource-1',
      mediaType: 'image/png',
      name: 'tiny.png',
      encoding: 'dataUrl',
      data: PNG_DATA_URL,
    },
  });
  return content;
}

function validPackage(): SesPackage {
  return {
    format: SES_PACKAGE_FORMAT,
    formatVersion: SES_PACKAGE_FORMAT_VERSION,
    exportedAt: '2026-10-30T08:00:00.000Z',
    generator: { name: 'SES', version: '0.1.0' },
    document: {
      uid: DOCUMENT_UID,
      title: '测试标准',
      meta: {
        titleCn: '测试标准',
        titleEn: 'Test Standard',
        standardType: '国家标准',
        customValue: { preserved: true },
      } as DocumentEntity['meta'],
      stage: 'working_draft',
      content: contentWithImages(),
      createdAt: '2026-10-01T09:30:00.000Z',
      updatedAt: '2026-10-30T07:59:00+00:00',
    },
    versions: [
      {
        uid: VERSION_UID,
        versionNo: '1.0',
        stage: 'working_draft',
        content: canonical(sampleDocument()),
        baseContent: null,
        note: null,
        source: 'human',
        client: null,
        createdAt: '2026-10-01T09:30:00Z',
      },
    ],
  };
}

function exceptionMessage(error: unknown): string {
  if (
    error instanceof BadRequestException ||
    error instanceof UnprocessableEntityException
  ) {
    const response = error.getResponse();
    return typeof response === 'string' ? response : JSON.stringify(response);
  }
  return error instanceof Error ? error.message : String(error);
}

describe('SES package format', () => {
  it('exports the v1 media constants', () => {
    expect(SES_PACKAGE_FORMAT).toBe('ses-document-package');
    expect(SES_PACKAGE_FORMAT_VERSION).toBe(1);
    expect(SES_PACKAGE_MIME).toBe('application/vnd.ses-package+json');
    expect(SES_PACKAGE_BODY_LIMIT).toBe('200mb');
  });

  it('builds an explicit package projection and retains image and version data', () => {
    const content = contentWithImages();
    const document = {
      id: 12,
      uid: DOCUMENT_UID,
      title: '测试标准',
      meta: {
        titleCn: '测试标准',
        titleEn: 'Test Standard',
        standardType: '国家标准',
      },
      stage: 'working_draft',
      content,
      revision: 99,
      deletedAt: new Date('2026-10-29T00:00:00.000Z'),
      createdAt: new Date('2026-10-01T09:30:00.000Z'),
      updatedAt: new Date('2026-10-30T07:59:00.000Z'),
      unknown: 'must not leak',
    } as unknown as DocumentEntity & Record<string, unknown>;
    const versions = [
      {
        id: 31,
        uid: VERSION_UID,
        documentId: 12,
        versionNo: '1.0',
        stage: 'working_draft',
        content: { type: 'doc', custom: { roundTrip: true } },
        baseContent: { type: 'doc', legacyNode: true },
        xml: '<private/>',
        note: '原始快照',
        source: 'ai' as VersionSource,
        client: 'review-agent',
        createdAt: new Date('2026-10-02T10:11:12.000Z'),
        hidden: 'must not leak',
      },
      {
        id: 32,
        uid: SECOND_VERSION_UID,
        documentId: 12,
        versionNo: '2.0',
        stage: 'approval_draft',
        content: { type: 'doc', imageData: PNG_DATA_URL },
        baseContent: null,
        xml: null,
        note: null,
        source: 'import' as VersionSource,
        client: null,
        createdAt: new Date('2026-10-03T10:11:12.000Z'),
      },
    ] as unknown as VersionEntity[];

    const result = buildSesPackage(
      document,
      versions,
      new Date('2026-10-30T08:00:00.000Z'),
    );

    expect(result).toEqual({
      format: SES_PACKAGE_FORMAT,
      formatVersion: 1,
      exportedAt: '2026-10-30T08:00:00.000Z',
      generator: { name: 'SES', version: SES_SERVER_VERSION },
      document: {
        uid: DOCUMENT_UID,
        title: '测试标准',
        meta: document.meta,
        stage: 'working_draft',
        content,
        createdAt: '2026-10-01T09:30:00.000Z',
        updatedAt: '2026-10-30T07:59:00.000Z',
      },
      versions: [
        {
          uid: VERSION_UID,
          versionNo: '1.0',
          stage: 'working_draft',
          content: versions[0].content,
          baseContent: versions[0].baseContent,
          note: '原始快照',
          source: 'ai',
          client: 'review-agent',
          createdAt: '2026-10-02T10:11:12.000Z',
        },
        {
          uid: SECOND_VERSION_UID,
          versionNo: '2.0',
          stage: 'approval_draft',
          content: versions[1].content,
          baseContent: null,
          note: null,
          source: 'import',
          client: null,
          createdAt: '2026-10-03T10:11:12.000Z',
        },
      ],
    });
    expect(Object.keys(result.document)).toEqual([
      'uid',
      'title',
      'meta',
      'stage',
      'content',
      'createdAt',
      'updatedAt',
    ]);
    expect(Object.keys(result.versions[0])).toEqual([
      'uid',
      'versionNo',
      'stage',
      'content',
      'baseContent',
      'note',
      'source',
      'client',
      'createdAt',
    ]);
    expect(result.document).not.toHaveProperty('revision');
    expect(result.versions[0]).not.toHaveProperty('documentId');
    expect(result.versions[0]).not.toHaveProperty('xml');
    expect(result.document.content).toEqual(content);
  });

  it('treats a missing document or version uid as an internal invariant failure', () => {
    const document = {
      uid: null,
      content: canonical(sampleDocument()),
    } as unknown as DocumentEntity;
    expect(() => buildSesPackage(document, [])).toThrow(
      InternalServerErrorException,
    );

    const identifiedDocument = {
      ...document,
      uid: DOCUMENT_UID,
    } as DocumentEntity;
    const version = { uid: null } as unknown as VersionEntity;
    expect(() => buildSesPackage(identifiedDocument, [version])).toThrow(
      InternalServerErrorException,
    );
  });

  it('parses Buffer and string JSON without changing content or unknown meta fields', () => {
    const input = validPackage();
    const parsed = parseSesPackage(Buffer.from(JSON.stringify(input), 'utf8'));
    expect(parseSesPackage(JSON.stringify(input))).toEqual(input);
    expect(parsed.document.content).toEqual(input.document.content);
    expect(
      (parsed.document.meta as unknown as Record<string, unknown>).customValue,
    ).toEqual({ preserved: true });
  });

  it('ignores optional fields added by newer packages while keeping the v1 projection', () => {
    const input = {
      ...validPackage(),
      futureTopLevel: 'ignored',
      document: { ...validPackage().document, futureDocumentField: 4 },
      versions: [{ ...validPackage().versions[0], futureVersionField: true }],
    };
    const parsed = parseSesPackage(JSON.stringify(input));
    expect(parsed).not.toHaveProperty('futureTopLevel');
    expect(parsed.document).not.toHaveProperty('futureDocumentField');
    expect(parsed.versions[0]).not.toHaveProperty('futureVersionField');
  });

  it('reports JSON syntax and invalid UTF-8 as bad requests', () => {
    expect(() => parseSesPackage('{')).toThrow(BadRequestException);
    expect(() => parseSesPackage(Buffer.from([0xc3, 0x28]))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a bad format and future format versions with an SES upgrade hint', () => {
    const wrongFormat = validPackage();
    (wrongFormat as unknown as Record<string, unknown>).format = 'other';
    expect(() => parseSesPackage(JSON.stringify(wrongFormat))).toThrow(
      /format/,
    );

    const future = validPackage();
    (future as unknown as Record<string, unknown>).formatVersion = 2;
    expect(() => parseSesPackage(JSON.stringify(future))).toThrow(/升级 SES/);
    const nonInteger = validPackage();
    (nonInteger as unknown as Record<string, unknown>).formatVersion = 1.5;
    expect(() => parseSesPackage(JSON.stringify(nonInteger))).toThrow(
      /formatVersion/,
    );
  });

  const invalidFields: Array<[string, (pkg: MutablePackage) => void]> = [
    ['document.uid', (pkg) => (pkg.document.uid = 'doc-1')],
    ['document.meta.titleCn', (pkg) => (pkg.document.meta.titleCn = 7)],
    ['versions[0].source', (pkg) => (pkg.versions[0].source = 'robot')],
    ['versions[0].client', (pkg) => (pkg.versions[0].client = 'x'.repeat(201))],
    [
      'document.createdAt',
      (pkg) => (pkg.document.createdAt = '2026-02-30T00:00:00Z'),
    ],
    ['versions[0].content', (pkg) => (pkg.versions[0].content = [])],
    [
      'versions[0].baseContent',
      (pkg) => (pkg.versions[0].baseContent = { type: 'not-doc' }),
    ],
  ];

  it.each(invalidFields)(
    'reports the field path for invalid %s',
    (path, mutate) => {
      const input = structuredClone(
        validPackage(),
      ) as unknown as MutablePackage;
      mutate(input);
      let message = '';
      try {
        parseSesPackage(JSON.stringify(input));
      } catch (error) {
        message = exceptionMessage(error);
      }
      expect(message).toContain(path);
    },
  );

  it('rejects duplicate version uids and malformed generator or time fields with paths', () => {
    const duplicate = validPackage();
    duplicate.versions.push({
      ...duplicate.versions[0],
      uid: duplicate.versions[0].uid,
    });
    expect(() => parseSesPackage(JSON.stringify(duplicate))).toThrow(
      /versions\[1\]\.uid/,
    );

    const badGenerator = validPackage();
    (badGenerator.generator as unknown as Record<string, unknown>).name = 3;
    expect(() => parseSesPackage(JSON.stringify(badGenerator))).toThrow(
      /generator\.name/,
    );
    const badExportedAt = validPackage();
    badExportedAt.exportedAt = 'yesterday';
    expect(() => parseSesPackage(JSON.stringify(badExportedAt))).toThrow(
      /exportedAt/,
    );
  });

  it('returns 422 for current content outside the editor schema and keeps legacy version nodes structurally valid', () => {
    const badCurrent = validPackage();
    badCurrent.document.content = {
      type: 'doc',
      content: [{ type: 'unknown-current-node' }],
    };
    let thrown: unknown;
    try {
      parseSesPackage(JSON.stringify(badCurrent));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnprocessableEntityException);
    expect(exceptionMessage(thrown)).toContain('document.content');
    expect(exceptionMessage(thrown)).toContain('schema');

    const legacy = validPackage();
    legacy.versions[0].content = {
      type: 'doc',
      content: [{ type: 'removed-node', attrs: { value: '保留' } }],
    };
    legacy.versions[0].baseContent = {
      type: 'doc',
      content: [{ type: 'old-attribute-node', attrs: { raw: true } }],
    };
    expect(parseSesPackage(JSON.stringify(legacy)).versions[0]).toEqual(
      legacy.versions[0],
    );
  });
});
