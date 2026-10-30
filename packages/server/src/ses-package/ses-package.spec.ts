import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';
import request from 'supertest';
import { DocumentEntity } from '../document/document.entity';
import { VersionEntity } from '../version/version.entity';
import { createTestApp, type TestApp } from '../test-support/test-app';
import {
  SES_PACKAGE_MIME,
  type SesPackage,
  type SesPackageVersion,
} from './ses-package-format';
import { WARNING_COUNT_HEADER, WARNINGS_HEADER } from '../export/export-http';
import { normalizeContent } from '../editor-schema/editor-schema';

const IMPORT_PATH = '/api/documents/import/ses';
const EXPORT_PATH = (id: number) => `/api/documents/${id}/export/ses`;
const DOCUMENT_UID = 'b0000000-0000-4000-8000-000000000001';
const SHARED_VERSION_UID = 'b0000000-0000-4000-8000-000000000010';
const AI_VERSION_UID = 'b0000000-0000-4000-8000-000000000011';
const IMPORT_VERSION_UID = 'b0000000-0000-4000-8000-000000000012';
const B_VERSION_UID = 'b0000000-0000-4000-8000-000000000020';
const A_VERSION_UID = 'b0000000-0000-4000-8000-000000000030';
const META = {
  standardNo: 'GB/T 12345—2026',
  icsCode: '01.120',
  ccsCode: 'A 00',
  titleCn: '封面使用的完整中文标题',
  titleEn: 'Complete English title',
  publishDate: '2026-01-02',
  implementDate: '2026-07-01',
  standardType: 'national',
  issuer: '发布单位',
  applicant: '申请单位',
  replaces: 'GB/T 1—2020',
  consistency: 'MOD',
  filingNo: '备案 123',
  industryName: '机械',
  regionName: '北京',
  coverDesignation: '国家标准',
  proposer: '提出单位',
  technicalCommittee: '技术委员会',
  customMeta: { preserved: true },
};
const FIGURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA';
const INLINE_DATA_URL =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
const EXTERNAL_IMAGE_URL = 'https://images.example.invalid/remote.png';
const EXTERNAL_IMAGE_WARNING =
  '服务端导出不访问网络资源，请使用内嵌（data URL）图片';

type JsonNode = Record<string, unknown> & {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
};

jest.setTimeout(180_000);

interface ExportedPackage extends Record<string, unknown> {
  format: string;
  formatVersion: number;
  exportedAt: string;
  generator: { name: string; version: string };
  document: {
    uid: string;
    title: string;
    meta: Record<string, unknown>;
    stage: string;
    content: JsonNode;
    createdAt: string;
    updatedAt: string;
  };
  versions: Array<{
    uid: string;
    versionNo: string;
    stage: string;
    content: Record<string, unknown>;
    baseContent: Record<string, unknown> | null;
    note: string | null;
    source: string;
    client: string | null;
    createdAt: string;
  }>;
}

interface ImportedDocument extends Record<string, unknown> {
  id: number;
  uid: string;
  title: string;
  meta: Record<string, unknown>;
  stage: string;
  content: Record<string, unknown> | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface PreviewBody {
  match: { id: number; title: string; revision: number } | null;
  inTrash: boolean;
  newVersions: number;
  localOnlyVersions: number;
  contentDiffers: boolean;
  versionNoCollisions: string[];
}

interface ErrorBody {
  message: string | string[];
  revision?: number;
}

function fixtureContent(): JsonNode {
  const content = JSON.parse(
    readFileSync(
      join(__dirname, '../export/__fixtures__/standard-document.json'),
      'utf8',
    ),
  ) as JsonNode;
  return content;
}

function findNode(root: JsonNode, type: string): JsonNode | undefined {
  if (root.type === type) return root;
  for (const child of root.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
}

/** 在标准库现有 root doc 样本上增加数据图、行内图与外部图。 */
function documentContent(text: string, includeExternal = false): JsonNode {
  const content = fixtureContent();
  const paragraph = findNode(content, 'stdParagraph');
  if (!paragraph?.content) throw new Error('标准库样本缺少 stdParagraph');
  const textNode = paragraph.content.find((node) => node.type === 'text');
  if (textNode) textNode.text = text;
  paragraph.content.push({
    type: 'inlineImage',
    attrs: {
      src: INLINE_DATA_URL,
      resourceId: 'acceptance-resource',
      alt: '内嵌行内图',
      size: 'S',
    },
  });
  if (includeExternal) {
    paragraph.content.push({
      type: 'inlineImage',
      attrs: {
        src: EXTERNAL_IMAGE_URL,
        resourceId: null,
        alt: '外部图片',
        size: null,
      },
    });
  }
  content.content?.push({
    type: 'figureResource',
    attrs: {
      nodeId: 'acceptance-resource',
      mediaType: 'image/svg+xml',
      name: '行内素材.svg',
      encoding: 'dataUrl',
      data: INLINE_DATA_URL,
    },
  });
  const figureImage = findNode(content, 'figureImage');
  if (figureImage?.attrs) figureImage.attrs.src = FIGURE_DATA_URL;
  return content;
}

function contentWithLegacyNode(label: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{ type: 'nodeFromOldEditor', attrs: { label } }],
  };
}

function packageVersion(
  uid: string,
  versionNo: string,
  options: Partial<SesPackageVersion> = {},
): SesPackageVersion {
  return {
    uid,
    versionNo,
    stage: 'working_draft',
    content: documentContent(`历史版本 ${versionNo}`),
    baseContent: null,
    note: null,
    source: 'human',
    client: null,
    createdAt: '2022-01-02T03:04:05.678Z',
    ...options,
  };
}

function packageFixture(overrides: Partial<SesPackage> = {}): SesPackage {
  return {
    format: 'ses-document-package',
    formatVersion: 1,
    exportedAt: '2026-10-30T08:00:00.000Z',
    generator: { name: 'SES', version: '0.1.0' },
    document: {
      uid: DOCUMENT_UID,
      title: '包内文档标题',
      meta: { ...META },
      stage: 'working_draft',
      content: documentContent('包内正文'),
      createdAt: '2020-01-02T03:04:05.000Z',
      updatedAt: '2021-02-03T04:05:06.000Z',
    },
    versions: [],
    ...overrides,
  };
}

function bodyBuffer(value: unknown): Buffer {
  return Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(value), 'utf8');
}

function postRaw(testApp: TestApp, query: string, body: unknown) {
  return testApp.http
    .post(`${IMPORT_PATH}?${query}`)
    .send(bodyBuffer(body).toString('utf8'))
    .set('Content-Type', SES_PACKAGE_MIME);
}

async function expectBody<T>(test: request.Test, status: number): Promise<T> {
  const response = await test.expect(status);
  return response.body as T;
}

async function exportPackage(
  testApp: TestApp,
  id: number,
): Promise<{ response: request.Response; package: ExportedPackage }> {
  const response = await testApp.http.get(EXPORT_PATH(id)).expect(200);
  return {
    response,
    package: JSON.parse(response.text) as ExportedPackage,
  };
}

function forbiddenRecordKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) =>
    ['id', 'revision', 'deletedAt', 'documentId', 'xml'].includes(key),
  );
}

function forbiddenPackageRecordKeys(pkg: ExportedPackage): string[] {
  return [
    ...forbiddenRecordKeys(pkg),
    ...forbiddenRecordKeys(pkg.document),
    ...pkg.versions.flatMap((version) => forbiddenRecordKeys(version)),
  ];
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseKeys(child)]),
  );
}

function getVersionRepo(testApp: TestApp) {
  return testApp.dataSource.getRepository(VersionEntity);
}

async function loadVersions(testApp: TestApp, documentId: number) {
  return getVersionRepo(testApp)
    .createQueryBuilder('version')
    .addSelect('version.baseContent')
    .where('version.documentId = :documentId', { documentId })
    .orderBy('version.createdAt', 'ASC')
    .addOrderBy('version.id', 'ASC')
    .getMany();
}

async function loadState(testApp: TestApp, documentId: number) {
  const document = await testApp.dataSource
    .getRepository(DocumentEntity)
    .findOneByOrFail({ id: documentId });
  return { document, versions: await loadVersions(testApp, documentId) };
}

async function addVersion(
  testApp: TestApp,
  documentId: number,
  values: Partial<VersionEntity> & Pick<VersionEntity, 'uid' | 'versionNo'>,
): Promise<VersionEntity> {
  const repo = getVersionRepo(testApp);
  return repo.save(
    repo.create({
      documentId,
      stage: 'working_draft',
      content: documentContent(`版本 ${values.versionNo}`),
      baseContent: null,
      xml: null,
      note: null,
      source: 'human',
      client: null,
      ...values,
    }),
  );
}

async function sendChunkedBodyOverLimit(urlString: string): Promise<{
  status: number;
  bytesQueued: number;
  transferEncoding: string | undefined;
  contentLength: string | undefined;
}> {
  const url = new URL(`${IMPORT_PATH}?mode=preview`, urlString);
  const limit = 200 * 1024 * 1024;
  const total = limit + 1;
  const chunk = Buffer.alloc(1024 * 1024, 0x20);

  let bytesQueued = 0;
  let status = 0;
  let responseReceived = false;
  let transferEncoding: string | undefined;
  let contentLength: string | undefined;
  let resolveResponseStarted!: () => void;
  const responseStarted = new Promise<void>((resolve) => {
    resolveResponseStarted = resolve;
  });
  let resolveResponseDone!: (value: number) => void;
  let rejectResponseDone!: (reason: Error) => void;
  const responseDone = new Promise<number>((resolve, reject) => {
    resolveResponseDone = resolve;
    rejectResponseDone = reject;
  });

  const req = http.request(
    {
      hostname: url.hostname,
      port: Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': SES_PACKAGE_MIME,
        'Transfer-Encoding': 'chunked',
      },
    },
    (res) => {
      responseReceived = true;
      status = res.statusCode ?? 0;
      resolveResponseStarted();
      res.on('end', () => resolveResponseDone(status));
      res.resume();
    },
  );
  req.setTimeout(150_000, () => req.destroy(new Error('超限请求超时')));
  req.on('error', (error) => {
    if (!responseReceived) rejectResponseDone(error);
  });

  void (async () => {
    try {
      while (bytesQueued < total && !responseReceived) {
        const length = Math.min(chunk.length, total - bytesQueued);
        const flushed = req.write(chunk.subarray(0, length));
        bytesQueued += length;
        if (!flushed) {
          await Promise.race([
            new Promise<void>((doneDrain) => req.once('drain', doneDrain)),
            responseStarted,
          ]);
        }
      }
      transferEncoding = req.getHeader('transfer-encoding') as
        | string
        | undefined;
      contentLength = req.getHeader('content-length') as string | undefined;
      req.end();
    } catch (error) {
      rejectResponseDone(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  })();

  await responseDone;
  return { status, bytesQueued, transferEncoding, contentLength };
}

function makeLegacyDatabase(file: string): void {
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE "documents" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "title" varchar NOT NULL,
      "meta" text NOT NULL,
      "stage" varchar NOT NULL DEFAULT ('working_draft'),
      "content" text,
      "revision" integer NOT NULL DEFAULT (0),
      "deletedAt" datetime,
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
      "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE "versions" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "documentId" integer NOT NULL,
      "versionNo" varchar NOT NULL,
      "stage" varchar NOT NULL DEFAULT ('working_draft'),
      "content" text NOT NULL,
      "baseContent" text,
      "xml" text,
      "note" text,
      "source" varchar NOT NULL DEFAULT ('human'),
      "client" text,
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT "FK_8ce14e37a63a94abf452fbd1723"
        FOREIGN KEY ("documentId") REFERENCES "documents" ("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    );
  `);

  const validContent = JSON.stringify(documentContent('旧库活动正文'));
  const oldVersionContent = JSON.stringify(contentWithLegacyNode('旧节点'));
  const oldBaseContent = JSON.stringify(contentWithLegacyNode('写入前旧节点'));
  const meta = JSON.stringify(META);
  legacy
    .prepare(
      `INSERT INTO documents
        (id, title, meta, stage, content, revision, deletedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      1,
      '旧库活动文档',
      meta,
      'review_draft',
      validContent,
      4,
      null,
      '2020-01-02 03:04:05',
      '2021-02-03 04:05:06',
    );
  legacy
    .prepare(
      `INSERT INTO documents
        (id, title, meta, stage, content, revision, deletedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      2,
      '旧库回收站文档',
      meta,
      'working_draft',
      validContent,
      9,
      '2022-03-04 05:06:07',
      '2019-01-02 03:04:05',
      '2022-03-04 05:06:07',
    );
  legacy
    .prepare(
      `INSERT INTO versions
        (id, documentId, versionNo, stage, content, baseContent, xml, note, source, client, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      1,
      1,
      '7.0',
      'review_draft',
      oldVersionContent,
      oldBaseContent,
      '<legacy-xml/>',
      '旧库人工版本',
      'ai',
      'old-editor',
      '2022-03-04 05:06:07.678',
    );
  legacy
    .prepare(
      `INSERT INTO versions
        (id, documentId, versionNo, stage, content, baseContent, xml, note, source, client, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      2,
      2,
      '2.0',
      'working_draft',
      oldVersionContent,
      null,
      '<trash-xml/>',
      '回收站版本',
      'human',
      null,
      '2021-03-04 05:06:07',
    );
  legacy.close();
}

describe('SES 文档包 HTTP 服务端验收', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await testApp?.app.close();
    jest.restoreAllMocks();
  });

  it('在独立 A/B 数据库间完成多轮往返并按版本 uid 收敛', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ses-package-roundtrip-'));
    let appA: TestApp | undefined;
    let appB: TestApp | undefined;
    let externalA: Database.Database | undefined;
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      appA = await createTestApp({ database: join(dir, 'A.db') });
      appB = await createTestApp({ database: join(dir, 'B.db') });
      const initialContent = documentContent('A 端原始正文', true);
      expect(initialContent.type).toBe('doc');
      expect(() => normalizeContent(initialContent)).not.toThrow();

      const docA = await appA.documents.create({
        title: 'A 端文档标题',
        meta: { ...META },
        stage: 'review_draft',
        content: initialContent,
      });
      await appA.dataSource
        .getRepository(DocumentEntity)
        .update(docA.id, { uid: DOCUMENT_UID.toUpperCase() });
      await appA.dataSource.query(
        'UPDATE "documents" SET "createdAt" = ?, "updatedAt" = ? WHERE "id" = ?',
        ['2020-01-02 03:04:05', '2021-02-03 04:05:06', docA.id],
      );

      await addVersion(appA, docA.id, {
        uid: SHARED_VERSION_UID.toUpperCase(),
        versionNo: '1.0',
        content: documentContent('共享人工版本'),
        baseContent: null,
        note: null,
        source: 'human',
        client: null,
        xml: '<must-not-leave-database/>',
        createdAt: new Date('2021-05-06T07:08:09.123Z'),
      });
      await addVersion(appA, docA.id, {
        uid: AI_VERSION_UID,
        versionNo: '2.0',
        content: contentWithLegacyNode('AI 历史版本未知节点'),
        baseContent: contentWithLegacyNode('AI 写入前未知节点'),
        note: 'AI 版本说明',
        source: 'ai',
        client: 'mcp-acceptance-agent',
        xml: '<old-ai-xml/>',
        createdAt: new Date('2022-05-06T07:08:09.456Z'),
      });
      await addVersion(appA, docA.id, {
        uid: IMPORT_VERSION_UID,
        versionNo: '3.0',
        content: documentContent('已有导入来源版本'),
        baseContent: null,
        note: '已有导入版本备注',
        source: 'import',
        client: null,
        createdAt: new Date('2023-05-06T07:08:09.789Z'),
      });

      const { response: exportAResponse, package: packageA } =
        await exportPackage(appA, docA.id);
      expect(exportAResponse.headers['content-type']).toContain(
        SES_PACKAGE_MIME,
      );
      expect(exportAResponse.headers['content-disposition']).toContain('.ses');
      expect(exportAResponse.headers[WARNING_COUNT_HEADER.toLowerCase()]).toBe(
        '1',
      );
      const warnings = JSON.parse(
        decodeURIComponent(
          exportAResponse.headers[WARNINGS_HEADER.toLowerCase()],
        ),
      ) as Array<{ message: string }>;
      expect(warnings.map((warning) => warning.message)).toEqual([
        EXTERNAL_IMAGE_WARNING,
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(packageA.document.content).toEqual(initialContent);
      expect(packageA.document.meta).toEqual(META);
      expect(packageA.document.stage).toBe('review_draft');
      expect(packageA.document.uid).toBe(DOCUMENT_UID.toUpperCase());
      expect(packageA.document.content.type).toBe('doc');
      expect(packageA.versions).toHaveLength(3);
      expect(packageA.versions.map((version) => version.source)).toEqual([
        'human',
        'ai',
        'import',
      ]);
      expect(packageA.versions[0]).toMatchObject({
        uid: SHARED_VERSION_UID.toUpperCase(),
        versionNo: '1.0',
        note: null,
        source: 'human',
        client: null,
        baseContent: null,
        createdAt: '2021-05-06T07:08:09.123Z',
      });
      expect(packageA.versions[1]).toMatchObject({
        uid: AI_VERSION_UID,
        versionNo: '2.0',
        note: 'AI 版本说明',
        source: 'ai',
        client: 'mcp-acceptance-agent',
        baseContent: contentWithLegacyNode('AI 写入前未知节点'),
        createdAt: '2022-05-06T07:08:09.456Z',
      });
      expect(packageA.versions[1].content).toEqual(
        contentWithLegacyNode('AI 历史版本未知节点'),
      );
      expect(packageA.versions[2]).toMatchObject({
        uid: IMPORT_VERSION_UID,
        note: '已有导入版本备注',
        source: 'import',
        createdAt: '2023-05-06T07:08:09.789Z',
      });
      expect(forbiddenPackageRecordKeys(packageA)).toEqual([]);
      expect(JSON.stringify(packageA)).not.toContain(
        '<must-not-leave-database/>',
      );
      expect(JSON.stringify(packageA)).not.toContain('<old-ai-xml/>');

      const previewOnB = await expectBody<PreviewBody>(
        postRaw(appB, 'mode=preview', bodyBuffer(packageA)),
        200,
      );
      expect(previewOnB).toEqual({
        match: null,
        inTrash: false,
        newVersions: 3,
        localOnlyVersions: 0,
        contentDiffers: false,
        versionNoCollisions: [],
      });
      const importedB = await expectBody<ImportedDocument>(
        postRaw(appB, 'mode=new', bodyBuffer(packageA)),
        201,
      );
      expect(importedB).toMatchObject({
        uid: DOCUMENT_UID.toUpperCase(),
        title: 'A 端文档标题',
        meta: META,
        stage: 'review_draft',
        content: initialContent,
        revision: 0,
        deletedAt: null,
      });
      expect(importedB.createdAt).not.toBe(packageA.document.createdAt);
      expect(importedB.updatedAt).not.toBe(packageA.document.updatedAt);
      const versionsOnB = await loadVersions(appB, importedB.id);
      expect(versionsOnB.map((version) => version.uid)).toEqual(
        packageA.versions.map((version) => version.uid),
      );
      expect(
        versionsOnB.map((version) => version.createdAt.toISOString()),
      ).toEqual(packageA.versions.map((version) => version.createdAt));
      expect(versionsOnB[1]?.content).toEqual(
        contentWithLegacyNode('AI 历史版本未知节点'),
      );
      expect(versionsOnB[1]?.baseContent).toEqual(
        contentWithLegacyNode('AI 写入前未知节点'),
      );
      expect(versionsOnB.every((version) => version.xml === null)).toBe(true);

      const { response: exportBInitialResponse, package: packageBInitial } =
        await exportPackage(appB, importedB.id);
      expect(packageBInitial.document.content).toEqual(
        packageA.document.content,
      );
      expect(packageBInitial.document.meta).toEqual(packageA.document.meta);
      expect(packageBInitial.versions).toEqual(packageA.versions);
      expect(
        exportBInitialResponse.headers[WARNING_COUNT_HEADER.toLowerCase()],
      ).toBe('1');
      expect(packageBInitial.document.content).toEqual(initialContent);

      const docRepoB = appB.dataSource.getRepository(DocumentEntity);
      const currentB = await docRepoB.findOneByOrFail({ id: importedB.id });
      const contentB = documentContent('B 端更新后的正文');
      const updatedB = await appB.documents.update(
        importedB.id,
        currentB.revision,
        {
          title: 'B 端更新标题',
          meta: { ...META, titleCn: 'B 端封面标题', customMeta: { side: 'B' } },
          stage: 'send_for_review',
          content: contentB,
        },
      );
      await addVersion(appB, updatedB.id, {
        uid: B_VERSION_UID,
        versionNo: '1.1',
        stage: 'send_for_review',
        content: contentB,
        baseContent: contentWithLegacyNode('B 写入前旧节点'),
        note: 'B 端新增版本',
        source: 'ai',
        client: 'B-agent',
        createdAt: new Date('2024-05-06T07:08:09.321Z'),
      });

      const versionRepoA = getVersionRepo(appA);
      const sharedOnA = await versionRepoA.findOneByOrFail({
        uid: SHARED_VERSION_UID.toUpperCase(),
      });
      await versionRepoA.update(sharedOnA.id, {
        stage: 'review_draft',
        content: contentWithLegacyNode('A 侧共享 uid 的独立内容'),
        baseContent: contentWithLegacyNode('A 侧共享 uid 的独立 base'),
        xml: '<A-side-private-xml/>',
        note: 'A 侧共享 uid 的本地备注',
        source: 'human',
        client: 'A-local-client',
      });
      const sharedOnABeforeUpdate = await versionRepoA
        .createQueryBuilder('version')
        .addSelect('version.baseContent')
        .where('version.id = :id', { id: sharedOnA.id })
        .getOneOrFail();
      await addVersion(appA, docA.id, {
        uid: A_VERSION_UID,
        versionNo: '1.1',
        stage: 'working_draft',
        content: contentWithLegacyNode('A 端本地独有版本'),
        baseContent: null,
        note: 'A 端本地备注',
        source: 'human',
        createdAt: new Date('2025-05-06T07:08:09.654Z'),
      });

      const { package: packageB } = await exportPackage(appB, importedB.id);
      const previewOnA = await expectBody<PreviewBody>(
        postRaw(appA, 'mode=preview', bodyBuffer(packageB)),
        200,
      );
      expect(previewOnA).toEqual({
        match: {
          id: docA.id,
          title: 'A 端文档标题',
          revision: 0,
        },
        inTrash: false,
        newVersions: 1,
        localOnlyVersions: 1,
        contentDiffers: true,
        versionNoCollisions: ['1.1'],
      });

      const importEvents: Array<{
        documentId: number;
        revision: number;
        source: string;
      }> = [];
      let committedRead:
        | { revision: number; content: Record<string, unknown> }
        | undefined;
      externalA = new Database(join(dir, 'A.db'), { readonly: true });
      const subscription = appA.events.events(docA.id).subscribe((event) => {
        importEvents.push(event);
        if (event.source === 'import') {
          const row = externalA!
            .prepare('SELECT revision, content FROM documents WHERE id = ?')
            .get(docA.id) as { revision: number; content: string };
          committedRead = {
            revision: row.revision,
            content: JSON.parse(row.content) as Record<string, unknown>,
          };
        }
      });
      const updatedA = await expectBody<ImportedDocument>(
        postRaw(
          appA,
          `mode=update&targetId=${docA.id}&baseRevision=0`,
          bodyBuffer(packageB),
        ),
        200,
      );
      expect(updatedA).toMatchObject({
        id: docA.id,
        uid: DOCUMENT_UID.toUpperCase(),
        title: 'B 端更新标题',
        meta: { ...META, titleCn: 'B 端封面标题', customMeta: { side: 'B' } },
        stage: 'send_for_review',
        content: contentB,
        revision: 1,
      });
      expect(importEvents).toHaveLength(1);
      expect(importEvents[0]).toMatchObject({
        documentId: docA.id,
        revision: 1,
        source: 'import',
      });
      expect(committedRead).toEqual({ revision: 1, content: contentB });
      subscription.unsubscribe();

      const versionsAfterUpdateA = await loadVersions(appA, docA.id);
      expect(versionsAfterUpdateA).toHaveLength(6);
      expect(
        new Set(
          versionsAfterUpdateA.map((version) => version.uid?.toLowerCase()),
        ).size,
      ).toBe(6);
      const importRecord = versionsAfterUpdateA.find(
        (version) => version.note === '导入 .ses 文档包',
      );
      expect(importRecord).toMatchObject({
        versionNo: '1.3',
        stage: 'send_for_review',
        content: contentB,
        baseContent: initialContent,
        note: '导入 .ses 文档包',
        source: 'import',
        client: null,
        xml: null,
      });
      expect(typeof importRecord?.uid).toBe('string');
      expect(importRecord?.uid).not.toBe(A_VERSION_UID);
      const importedBVersion = versionsAfterUpdateA.find(
        (version) => version.uid === B_VERSION_UID,
      );
      expect(importedBVersion).toMatchObject({
        versionNo: '1.2',
        note: '原版本号 1.1；B 端新增版本',
        stage: 'send_for_review',
        content: contentB,
        baseContent: contentWithLegacyNode('B 写入前旧节点'),
        source: 'ai',
        client: 'B-agent',
        createdAt: new Date('2024-05-06T07:08:09.321Z'),
      });
      const sharedOnAAfterUpdate = versionsAfterUpdateA.find(
        (version) => version.uid === SHARED_VERSION_UID.toUpperCase(),
      );
      expect(sharedOnAAfterUpdate).toEqual(sharedOnABeforeUpdate);
      expect(
        versionsAfterUpdateA.filter(
          (version) =>
            version.uid?.toLowerCase() === SHARED_VERSION_UID.toLowerCase(),
        ),
      ).toHaveLength(1);
      expect(
        versionsAfterUpdateA.some((version) => version.uid === A_VERSION_UID),
      ).toBe(true);

      const { package: packageASecondRound } = await exportPackage(
        appA,
        docA.id,
      );
      const reorderedContent = reverseKeys(
        packageASecondRound.document.content,
      );
      const reorderedPackage = {
        ...packageASecondRound,
        document: {
          ...packageASecondRound.document,
          content: reorderedContent,
        },
      };
      const previewOnBSecondRound = await expectBody<PreviewBody>(
        postRaw(appB, 'mode=preview', bodyBuffer(reorderedPackage)),
        200,
      );
      expect(previewOnBSecondRound).toEqual({
        match: {
          id: importedB.id,
          title: 'B 端更新标题',
          revision: updatedB.revision,
        },
        inTrash: false,
        newVersions: 2,
        localOnlyVersions: 0,
        contentDiffers: false,
        versionNoCollisions: ['1.1'],
      });
      await postRaw(
        appB,
        `mode=update&targetId=${importedB.id}&baseRevision=${updatedB.revision}`,
        bodyBuffer(reorderedPackage),
      ).expect(200);
      const countBeforeReturnToA = (await loadVersions(appB, importedB.id))
        .length;
      expect(countBeforeReturnToA).toBe(6);

      const { package: packageBSecondRound } = await exportPackage(
        appB,
        importedB.id,
      );
      const previewOnASecondRound = await expectBody<PreviewBody>(
        postRaw(appA, 'mode=preview', bodyBuffer(packageBSecondRound)),
        200,
      );
      expect(previewOnASecondRound).toEqual({
        match: {
          id: docA.id,
          title: 'B 端更新标题',
          revision: 1,
        },
        inTrash: false,
        newVersions: 0,
        localOnlyVersions: 0,
        contentDiffers: false,
        versionNoCollisions: [],
      });
      const updatedASecondRound = await expectBody<ImportedDocument>(
        postRaw(
          appA,
          `mode=update&targetId=${docA.id}&baseRevision=1`,
          bodyBuffer(packageBSecondRound),
        ),
        200,
      );
      expect(updatedASecondRound.revision).toBe(2);
      expect(await loadVersions(appA, docA.id)).toHaveLength(6);
      expect(importEvents).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();

      const { response: packageAfterBResponse, package: packageAfterB } =
        await exportPackage(appB, importedB.id);
      expect(
        packageAfterBResponse.headers[WARNING_COUNT_HEADER.toLowerCase()],
      ).toBe('1');
      const inlineImage = findNode(
        packageAfterB.document.content,
        'inlineImage',
      );
      expect(inlineImage?.attrs?.src).toBe(INLINE_DATA_URL);
      expect(packageAfterB.document.content).toEqual(contentB);
      const recordedOriginal = packageAfterB.versions.find(
        (version) =>
          version.source === 'import' &&
          JSON.stringify(version.baseContent).includes(EXTERNAL_IMAGE_URL),
      );
      expect(recordedOriginal).toBeDefined();
      expect(
        packageAfterB.versions.map((version) => version.uid?.toLowerCase()),
      ).toHaveLength(6);
      expect(
        new Set(
          packageAfterB.versions.map((version) => version.uid.toLowerCase()),
        ).size,
      ).toBe(6);
    } finally {
      fetchSpy.mockRestore();
      externalA?.close();
      await appB?.app.close();
      await appA?.app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('逐字段拒绝错误包，422 不泄漏正文且不写入数据库', async () => {
    testApp = await createTestApp();
    const base = packageFixture({
      versions: [packageVersion(SHARED_VERSION_UID, '1.0')],
    });
    const invalidFormat = { ...base, format: 'other-format' };
    const futureFormat = { ...base, formatVersion: 2 };
    const invalidMeta = {
      ...base,
      document: {
        ...base.document,
        meta: { ...META, titleCn: 12 },
      },
    };
    const invalidSource = {
      ...base,
      versions: [
        packageVersion(SHARED_VERSION_UID, '1.0', {
          source: 'robot' as SesPackageVersion['source'],
        }),
      ],
    };
    const invalidVersionContent = {
      ...base,
      versions: [
        packageVersion(SHARED_VERSION_UID, '1.0', {
          content: { type: 'legacy-root' },
        }),
      ],
    };
    const invalidBaseContent = {
      ...base,
      versions: [
        packageVersion(SHARED_VERSION_UID, '1.0', {
          baseContent: { type: 'legacy-root' },
        }),
      ],
    };
    const duplicateVersionUids = {
      ...base,
      versions: [
        packageVersion(SHARED_VERSION_UID, '1.0'),
        packageVersion(SHARED_VERSION_UID.toUpperCase(), '2.0'),
      ],
    };
    const invalidCurrentSchema = {
      ...base,
      document: {
        ...base.document,
        content: {
          type: 'doc',
          content: [
            {
              type: 'privateUnknownNode',
              attrs: { secretPayload: 'PRIVATE_BODY_SENTINEL' },
            },
          ],
        },
      },
    };
    const cases: Array<{
      name: string;
      body: unknown;
      status: number;
      message?: string;
      noLeak?: string;
    }> = [
      {
        name: 'format',
        body: invalidFormat,
        status: 400,
        message: 'format',
      },
      {
        name: '未来格式版本',
        body: futureFormat,
        status: 400,
        message: '升级 SES',
      },
      {
        name: 'JSON 语法',
        body: Buffer.from('{"format":', 'utf8'),
        status: 400,
        message: 'JSON',
      },
      {
        name: 'meta 已知字段类型',
        body: invalidMeta,
        status: 400,
        message: 'document.meta.titleCn',
      },
      {
        name: '未知 source',
        body: invalidSource,
        status: 400,
        message: 'versions[0].source',
      },
      {
        name: '历史 content 不是 doc',
        body: invalidVersionContent,
        status: 400,
        message: 'versions[0].content.type',
      },
      {
        name: '历史 baseContent 不是 doc',
        body: invalidBaseContent,
        status: 400,
        message: 'versions[0].baseContent.type',
      },
      {
        name: '重复版本 uid',
        body: duplicateVersionUids,
        status: 400,
        message: 'uid',
      },
      {
        name: '当前正文不符合生产 schema',
        body: invalidCurrentSchema,
        status: 422,
        noLeak: 'PRIVATE_BODY_SENTINEL',
      },
    ];

    for (const entry of cases) {
      const response = await postRaw(
        testApp,
        'mode=preview',
        entry.body,
      ).expect(entry.status);
      const responseText = JSON.stringify(response.body);
      if (entry.message) expect(responseText).toContain(entry.message);
      if (entry.noLeak) expect(responseText).not.toContain(entry.noLeak);
      expect(
        await testApp.dataSource.getRepository(DocumentEntity).count(),
      ).toBe(0);
      expect(await getVersionRepo(testApp).count()).toBe(0);
    }
  });

  it('拒绝 stale revision、跨 uid 和不可快照的旧正文时保留完整数据库状态', async () => {
    testApp = await createTestApp();
    const local = await testApp.documents.create({
      title: '导入前标题',
      meta: { ...META },
      stage: 'review_draft',
      content: documentContent('导入前正文'),
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(local.id, { uid: DOCUMENT_UID });
    const revised = await testApp.documents.update(local.id, 0, {
      title: '并发修改标题',
      meta: { ...META, titleCn: '并发封面标题' },
      stage: 'send_for_review',
      content: documentContent('并发修改正文'),
    });
    await addVersion(testApp, local.id, {
      uid: SHARED_VERSION_UID,
      versionNo: '1.0',
      content: contentWithLegacyNode('现存历史内容'),
      baseContent: contentWithLegacyNode('现存历史 baseContent'),
      xml: '<legacy-local-xml/>',
      note: '现存版本备注',
      source: 'ai',
      client: 'local-agent',
      createdAt: new Date('2024-04-05T06:07:08.901Z'),
    });
    const incoming = packageFixture({
      document: {
        ...packageFixture().document,
        content: documentContent('即将导入的新正文'),
      },
      versions: [
        packageVersion(B_VERSION_UID, '1.0', {
          baseContent: contentWithLegacyNode('待导入 baseContent'),
        }),
      ],
    });
    const events: string[] = [];
    const subscription = testApp.events
      .events(local.id)
      .subscribe((event) => events.push(event.source));

    const beforeStale = await loadState(testApp, local.id);
    const staleResponse = await expectBody<ErrorBody>(
      postRaw(
        testApp,
        `mode=update&targetId=${local.id}&baseRevision=0`,
        incoming,
      ),
      409,
    );
    expect(staleResponse.revision).toBe(revised.revision);
    expect(await loadState(testApp, local.id)).toEqual(beforeStale);
    expect(events).toEqual([]);

    const wrongUidPackage = {
      ...incoming,
      document: {
        ...incoming.document,
        uid: 'b0000000-0000-4000-8000-000000000099',
      },
    };
    await postRaw(
      testApp,
      `mode=update&targetId=${local.id}&baseRevision=${revised.revision}`,
      wrongUidPackage,
    ).expect(400);
    expect(await loadState(testApp, local.id)).toEqual(beforeStale);
    expect(events).toEqual([]);

    await testApp.dataSource.query(
      'UPDATE "documents" SET "content" = NULL WHERE "id" = ?',
      [local.id],
    );
    const beforeInvalidLocalBody = await loadState(testApp, local.id);
    const invalidLocalBodyResponse = await expectBody<ErrorBody>(
      postRaw(
        testApp,
        `mode=update&targetId=${local.id}&baseRevision=${revised.revision}`,
        incoming,
      ),
      422,
    );
    expect(JSON.stringify(invalidLocalBodyResponse)).not.toContain(
      '即将导入的新正文',
    );
    expect(await loadState(testApp, local.id)).toEqual(beforeInvalidLocalBody);
    expect(events).toEqual([]);
    subscription.unsubscribe();
  });

  it('事务最后一步失败会回滚快照和新增版本，并且不发布事件', async () => {
    testApp = await createTestApp();
    const local = await testApp.documents.create({
      title: '事务回滚标题',
      meta: { ...META },
      stage: 'working_draft',
      content: documentContent('事务回滚正文'),
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(local.id, { uid: DOCUMENT_UID });
    await addVersion(testApp, local.id, {
      uid: SHARED_VERSION_UID,
      versionNo: '1.0',
      baseContent: contentWithLegacyNode('回滚前 baseContent'),
      xml: '<keep-local/>',
    });
    const before = await loadState(testApp, local.id);
    const incoming = packageFixture({
      document: {
        ...packageFixture().document,
        content: documentContent('事务应回滚的正文'),
      },
      versions: [packageVersion(B_VERSION_UID, '1.0')],
    });
    const events: string[] = [];
    const subscription = testApp.events
      .events(local.id)
      .subscribe((event) => events.push(event.source));
    const updateSpy = jest
      .spyOn(testApp.documents, 'updateWithin')
      .mockRejectedValue(new Error('forced final update failure'));
    try {
      await postRaw(
        testApp,
        `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
        incoming,
      ).expect(500);
    } finally {
      updateSpy.mockRestore();
    }
    expect(await loadState(testApp, local.id)).toEqual(before);
    expect(events).toEqual([]);
    subscription.unsubscribe();
  });

  it('版本号冲突续编，活动/回收站 uid 都占用，并可另存为副本', async () => {
    testApp = await createTestApp();
    const original = await testApp.documents.create({
      title: '原文档标题',
      meta: { ...META, titleCn: '原封面标题' },
      stage: 'working_draft',
      content: documentContent('原文档正文'),
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(original.id, { uid: DOCUMENT_UID });
    await addVersion(testApp, original.id, {
      uid: SHARED_VERSION_UID,
      versionNo: '1.0',
      note: '原版本',
    });
    const pkg = packageFixture({
      versions: [
        packageVersion(SHARED_VERSION_UID, '1.0', {
          note: '同 uid 的包版本不得覆盖本地',
        }),
        packageVersion(B_VERSION_UID, '1.0', {
          note: '新增冲突版本备注',
        }),
      ],
    });
    const preview = await expectBody<PreviewBody>(
      postRaw(testApp, 'mode=preview', pkg),
      200,
    );
    expect(preview).toMatchObject({
      match: { id: original.id, title: '原文档标题', revision: 0 },
      inTrash: false,
      newVersions: 1,
      localOnlyVersions: 0,
      versionNoCollisions: ['1.0'],
    });

    const activeCopy = await expectBody<ImportedDocument>(
      postRaw(testApp, 'mode=new', pkg),
      201,
    );
    expect(activeCopy.uid).not.toBe(DOCUMENT_UID);
    expect(activeCopy.title).toBe('包内文档标题（导入副本）');
    expect(activeCopy.meta).toEqual({
      ...META,
      titleCn: '包内文档标题（导入副本）',
    });
    expect(activeCopy.content).toEqual(pkg.document.content);
    const copyVersions = await loadVersions(testApp, activeCopy.id);
    expect(copyVersions.map((version) => version.uid)).toEqual([
      SHARED_VERSION_UID,
      B_VERSION_UID,
    ]);
    expect(copyVersions.map((version) => version.versionNo)).toEqual([
      '1.0',
      '1.0',
    ]);
    expect(copyVersions[1]?.note).toBe('新增冲突版本备注');

    await testApp.documents.remove(original.id);
    const trashed = await testApp.dataSource
      .getRepository(DocumentEntity)
      .findOneByOrFail({ id: original.id });
    const trashPreview = await expectBody<PreviewBody>(
      postRaw(testApp, 'mode=preview', pkg),
      200,
    );
    expect(trashPreview).toMatchObject({
      match: {
        id: original.id,
        title: '原文档标题',
        revision: trashed.revision,
      },
      inTrash: true,
    });
    await postRaw(
      testApp,
      `mode=update&targetId=${original.id}&baseRevision=${trashed.revision}`,
      pkg,
    ).expect(409);
    await testApp.http.get(EXPORT_PATH(original.id)).expect(404);

    const trashCopy = await expectBody<ImportedDocument>(
      postRaw(testApp, 'mode=new', pkg),
      201,
    );
    expect(trashCopy.uid).not.toBe(DOCUMENT_UID);
    expect(trashCopy.uid).not.toBe(activeCopy.uid);
    expect(trashCopy.title).toBe('包内文档标题（导入副本）');
    expect(trashCopy.meta.titleCn).toBe('包内文档标题（导入副本）');
    expect(await loadVersions(testApp, trashCopy.id)).toHaveLength(2);
  });

  it('临时旧库启动时补齐身份、保留旧字段，导出后可导入历史未知节点并重启稳定', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ses-package-legacy-'));
    let appA: TestApp | undefined;
    let appB: TestApp | undefined;
    try {
      const fileA = join(dir, 'legacy.db');
      const fileB = join(dir, 'recipient.db');
      makeLegacyDatabase(fileA);
      appA = await createTestApp({ database: fileA });
      const documentRowsResult: unknown = await appA.dataSource.query(
        'SELECT id, uid, title, revision, deletedAt, createdAt, updatedAt, meta, content FROM documents ORDER BY id',
      );
      const versionRowsResult: unknown = await appA.dataSource.query(
        'SELECT id, uid, documentId, versionNo, baseContent, xml, note, source, client, createdAt FROM versions ORDER BY id',
      );
      if (
        !Array.isArray(documentRowsResult) ||
        !Array.isArray(versionRowsResult)
      ) {
        throw new Error('旧库查询没有返回行数组');
      }
      const documentRows = documentRowsResult as Array<{
        id: number;
        uid: string;
        title: string;
        revision: number;
        deletedAt: string | null;
        createdAt: string;
        updatedAt: string;
        meta: string;
        content: string;
      }>;
      const versionRows = versionRowsResult as Array<{
        id: number;
        uid: string;
        documentId: number;
        versionNo: string;
        baseContent: string | null;
        xml: string | null;
        note: string | null;
        source: string;
        client: string | null;
        createdAt: string;
      }>;
      expect(documentRows).toHaveLength(2);
      expect(versionRows).toHaveLength(2);
      expect(documentRows.map((row) => row.uid)).toEqual([
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
      ]);
      expect(versionRows.map((row) => row.uid)).toEqual([
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
      ]);
      expect(documentRows[0]).toMatchObject({
        id: 1,
        title: '旧库活动文档',
        revision: 4,
        deletedAt: null,
        createdAt: '2020-01-02 03:04:05',
        updatedAt: '2021-02-03 04:05:06',
        meta: JSON.stringify(META),
        content: JSON.stringify(documentContent('旧库活动正文')),
      });
      expect(documentRows[1]).toMatchObject({
        id: 2,
        title: '旧库回收站文档',
        revision: 9,
        deletedAt: '2022-03-04 05:06:07',
        meta: JSON.stringify(META),
        content: JSON.stringify(documentContent('旧库活动正文')),
      });
      expect(versionRows[0]).toMatchObject({
        id: 1,
        documentId: 1,
        versionNo: '7.0',
        baseContent: JSON.stringify(contentWithLegacyNode('写入前旧节点')),
        xml: '<legacy-xml/>',
        note: '旧库人工版本',
        source: 'ai',
        client: 'old-editor',
        createdAt: '2022-03-04 05:06:07.678',
      });
      const stableDocumentUid = documentRows[0].uid;
      const stableVersionUid = versionRows[0].uid;
      const { package: legacyPackage } = await exportPackage(appA, 1);
      expect(legacyPackage.document.uid).toBe(stableDocumentUid);
      expect(legacyPackage.versions[0]?.uid).toBe(stableVersionUid);
      expect(legacyPackage.versions[0]?.content).toEqual(
        contentWithLegacyNode('旧节点'),
      );
      expect(legacyPackage.versions[0]?.baseContent).toEqual(
        contentWithLegacyNode('写入前旧节点'),
      );
      expect(forbiddenPackageRecordKeys(legacyPackage)).toEqual([]);
      await appA.http.get(EXPORT_PATH(2)).expect(404);

      appB = await createTestApp({ database: fileB });
      const imported = await expectBody<ImportedDocument>(
        postRaw(appB, 'mode=new', legacyPackage),
        201,
      );
      expect(imported.uid).toBe(stableDocumentUid);
      const importedVersion = (await loadVersions(appB, imported.id))[0];
      expect(importedVersion?.uid).toBe(stableVersionUid);
      expect(importedVersion?.content).toEqual(contentWithLegacyNode('旧节点'));
      expect(importedVersion?.baseContent).toEqual(
        contentWithLegacyNode('写入前旧节点'),
      );

      await appA.app.close();
      appA = await createTestApp({ database: fileA });
      const { package: afterRestart } = await exportPackage(appA, 1);
      expect(afterRestart.document.uid).toBe(stableDocumentUid);
      expect(afterRestart.versions[0]?.uid).toBe(stableVersionUid);
      const stableRowsResult: unknown = await appA.dataSource.query(
        'SELECT uid FROM documents ORDER BY id',
      );
      const stableVersionRowsResult: unknown = await appA.dataSource.query(
        'SELECT uid FROM versions ORDER BY id',
      );
      if (
        !Array.isArray(stableRowsResult) ||
        !Array.isArray(stableVersionRowsResult)
      ) {
        throw new Error('重启后的身份查询没有返回行数组');
      }
      const stableRows = stableRowsResult as Array<{ uid: string }>;
      const stableVersionRows = stableVersionRowsResult as Array<{
        uid: string;
      }>;
      expect(stableRows[0]?.uid).toBe(stableDocumentUid);
      expect(stableVersionRows[0]?.uid).toBe(stableVersionUid);
    } finally {
      await appB?.app.close();
      await appA?.app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('通过已配置 raw MIME 接受大于 25 MB 的包，并对实际超过 200 MB 的分块流返回 413', async () => {
    testApp = await createTestApp();
    const pkg = packageFixture();
    const smallJson = bodyBuffer(pkg);
    const jsonLimit = 25 * 1024 * 1024;
    const largeValidBody = Buffer.alloc(jsonLimit + 1, 0x20);
    smallJson.copy(largeValidBody);
    const preview = await expectBody<PreviewBody>(
      postRaw(testApp, 'mode=preview', largeValidBody),
      200,
    );
    expect(preview.match).toBeNull();
    expect(await testApp.dataSource.getRepository(DocumentEntity).count()).toBe(
      0,
    );

    const oversized = await sendChunkedBodyOverLimit(testApp.url);
    expect(oversized.bytesQueued).toBeGreaterThan(200 * 1024 * 1024);
    expect(oversized.transferEncoding).toBe('chunked');
    expect(oversized.contentLength).toBeUndefined();
    expect(oversized.status).toBe(413);
    expect(await testApp.dataSource.getRepository(DocumentEntity).count()).toBe(
      0,
    );
    expect(await getVersionRepo(testApp).count()).toBe(0);
  });
});
