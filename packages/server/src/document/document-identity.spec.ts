import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DocumentEntity } from './document.entity';
import { DocumentModule } from './document.module';
import { DocumentService } from './document.service';
import { VersionEntity } from '../version/version.entity';
import { VersionModule } from '../version/version.module';
import { VersionService } from '../version/version.service';

interface DocumentBody {
  id: number;
  uid: string | null;
  revision: number;
}

interface VersionBody {
  id: number;
  uid: string | null;
}

/** 用内存或临时文件 SQLite 起完整的文档/版本模块，不触碰 data/ses.db。 */
async function createApp(database = ':memory:'): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database,
        entities: [DocumentEntity, VersionEntity],
        synchronize: true,
      }),
      DocumentModule,
      VersionModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return app;
}

/** supertest 的 res.body 是 any：断言状态码后按预期形状收窄。 */
async function reply<T>(test: request.Test, status: number): Promise<T> {
  const res = await test.expect(status);
  return res.body as T;
}

const meta = { titleCn: '身份测试', standardType: 'national' };
const content = { type: 'doc', content: [] };
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('文档与版本的服务端身份', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let documentId: number;

  beforeEach(async () => {
    app = await createApp();
    http = request(await app.getUrl());
    const document = await reply<DocumentBody>(
      http.post('/api/documents').send({ title: '身份测试', meta, content }),
      201,
    );
    documentId = document.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('DocumentService.create 忽略请求 uid 并生成新的 UUID', async () => {
    const suppliedUid = 'client-chosen-document-id';
    const created = await reply<DocumentBody>(
      http.post('/api/documents').send({
        title: '请求 uid 不可写',
        meta,
        content,
        uid: suppliedUid,
      }),
      201,
    );

    expect(created.uid).toMatch(uuidPattern);
    expect(created.uid).not.toBe(suppliedUid);

    const updated = await reply<DocumentBody>(
      http.put(`/api/documents/${created.id}`).send({
        baseRevision: created.revision,
        title: '更新时 uid 仍不可写',
        uid: suppliedUid,
      }),
      200,
    );
    expect(updated.uid).toBe(created.uid);
  });

  it('VersionService.create 忽略请求 uid 并生成新的 UUID', async () => {
    const suppliedUid = 'client-chosen-version-id';
    const created = await reply<VersionBody>(
      http.post('/api/versions').send({
        documentId,
        versionNo: '1.0',
        stage: 'working_draft',
        content,
        uid: suppliedUid,
      }),
      201,
    );

    expect(created.uid).toMatch(uuidPattern);
    expect(created.uid).not.toBe(suppliedUid);
  });

  it('VersionService.createForAiWrite 在调用方事务中生成 UUID', async () => {
    const documentService = app.get(DocumentService);
    const versionService = app.get(VersionService);
    const created = await documentService.transaction((manager) =>
      versionService.createForAiWrite(manager, {
        documentId,
        stage: 'working_draft',
        content,
        baseContent: { type: 'doc', content: [{ type: 'paragraph' }] },
        client: 'mcp-test',
        note: 'AI 写入前快照',
      }),
    );

    expect(created.uid).toMatch(uuidPattern);
  });
});

describe('旧数据库身份迁移', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ses-identity-db-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('同步时给缺少 uid 列的旧表补列与 UUID，保留旧字段，重启稳定且只补 NULL', async () => {
    const file = join(dir, 'legacy.db');
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
    const legacyMeta = JSON.stringify({
      titleCn: '旧文档',
      standardType: 'national',
    });
    const legacyContent = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
    legacy
      .prepare(
        `INSERT INTO documents (id, title, meta, stage, content, revision, deletedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        1,
        '活动旧文档',
        legacyMeta,
        'working_draft',
        legacyContent,
        4,
        null,
        '2026-10-13 04:17:06',
        '2026-10-14 05:18:07',
      );
    legacy
      .prepare(
        `INSERT INTO documents (id, title, meta, stage, content, revision, deletedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        2,
        '回收站旧文档',
        legacyMeta,
        'review_draft',
        legacyContent,
        9,
        '2026-10-15 06:19:08',
        '2026-10-12 03:16:05',
        '2026-10-16 07:20:09',
      );
    legacy
      .prepare(
        `INSERT INTO versions (id, documentId, versionNo, stage, content, baseContent, xml, note, source, client, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        1,
        1,
        '1.0',
        'working_draft',
        legacyContent,
        null,
        null,
        '旧人工版本',
        'human',
        null,
        '2026-10-13 04:17:06',
      );
    legacy
      .prepare(
        `INSERT INTO versions (id, documentId, versionNo, stage, content, baseContent, xml, note, source, client, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        2,
        2,
        '2.0',
        'review_draft',
        legacyContent,
        legacyContent,
        '<old/>',
        '旧 AI 版本',
        'ai',
        'mcp-test',
        '2026-10-16 07:20:09',
      );
    legacy.close();

    let app: INestApplication | undefined;
    let firstDocumentUid = '';
    let firstVersionUid = '';
    let stableDocumentUid = '';
    let stableVersionUid = '';
    try {
      app = await createApp(file);
      const dataSource = app.get<DataSource>(DataSource);
      const documentColumns: Array<{
        name: string;
        type: string;
        notnull: number;
      }> = await dataSource.query('PRAGMA table_info("documents")');
      const versionColumns: Array<{
        name: string;
        type: string;
        notnull: number;
      }> = await dataSource.query('PRAGMA table_info("versions")');
      expect(
        documentColumns.find((column) => column.name === 'uid'),
      ).toMatchObject({
        type: 'varchar',
        notnull: 0,
      });
      expect(
        versionColumns.find((column) => column.name === 'uid'),
      ).toMatchObject({
        type: 'varchar',
        notnull: 0,
      });

      const documents: Array<{
        id: number;
        uid: string | null;
        title: string;
        revision: number;
        deletedAt: string | null;
        createdAt: string;
        updatedAt: string;
        meta: string;
        content: string;
      }> = await dataSource.query(
        'SELECT id, uid, title, revision, deletedAt, createdAt, updatedAt, meta, content FROM documents ORDER BY id',
      );
      const versions: Array<{
        id: number;
        uid: string | null;
        documentId: number;
        versionNo: string;
        baseContent: string | null;
        xml: string | null;
        note: string | null;
        source: string;
        client: string | null;
        createdAt: string;
      }> = await dataSource.query(
        'SELECT id, uid, documentId, versionNo, baseContent, xml, note, source, client, createdAt FROM versions ORDER BY id',
      );

      expect(documents).toHaveLength(2);
      expect(documents[0]).toMatchObject({
        id: 1,
        title: '活动旧文档',
        revision: 4,
        deletedAt: null,
        createdAt: '2026-10-13 04:17:06',
        updatedAt: '2026-10-14 05:18:07',
        meta: legacyMeta,
        content: legacyContent,
      });
      expect(documents[1]).toMatchObject({
        id: 2,
        title: '回收站旧文档',
        revision: 9,
        deletedAt: '2026-10-15 06:19:08',
        createdAt: '2026-10-12 03:16:05',
        updatedAt: '2026-10-16 07:20:09',
        meta: legacyMeta,
        content: legacyContent,
      });
      expect(versions).toHaveLength(2);
      expect(versions[0]).toMatchObject({
        id: 1,
        documentId: 1,
        versionNo: '1.0',
        baseContent: null,
        xml: null,
        note: '旧人工版本',
        source: 'human',
        client: null,
        createdAt: '2026-10-13 04:17:06',
      });
      expect(versions[1]).toMatchObject({
        id: 2,
        documentId: 2,
        versionNo: '2.0',
        baseContent: legacyContent,
        xml: '<old/>',
        note: '旧 AI 版本',
        source: 'ai',
        client: 'mcp-test',
        createdAt: '2026-10-16 07:20:09',
      });
      expect(documents[0].uid).toMatch(uuidPattern);
      expect(documents[1].uid).toMatch(uuidPattern);
      expect(versions[0].uid).toMatch(uuidPattern);
      expect(versions[1].uid).toMatch(uuidPattern);
      firstDocumentUid = documents[0].uid!;
      firstVersionUid = versions[0].uid!;
      stableDocumentUid = documents[1].uid!;
      stableVersionUid = versions[1].uid!;

      await app.close();
      app = await createApp(file);
      const restartedDocuments: Array<{ id: number; uid: string }> = await app
        .get(DataSource)
        .query('SELECT id, uid FROM documents ORDER BY id');
      const restartedVersions: Array<{ id: number; uid: string }> = await app
        .get(DataSource)
        .query('SELECT id, uid FROM versions ORDER BY id');
      expect(restartedDocuments.map((row) => row.uid)).toEqual([
        firstDocumentUid,
        stableDocumentUid,
      ]);
      expect(restartedVersions.map((row) => row.uid)).toEqual([
        firstVersionUid,
        stableVersionUid,
      ]);

      await app.close();
      app = undefined;
      const direct = new Database(file);
      direct.prepare('UPDATE documents SET uid = NULL WHERE id = 1').run();
      direct.prepare('UPDATE versions SET uid = NULL WHERE id = 1').run();
      direct.close();

      app = await createApp(file);
      const selectivelyMigratedDocuments: Array<{ id: number; uid: string }> =
        await app
          .get(DataSource)
          .query('SELECT id, uid FROM documents ORDER BY id');
      const selectivelyMigratedVersions: Array<{ id: number; uid: string }> =
        await app
          .get(DataSource)
          .query('SELECT id, uid FROM versions ORDER BY id');
      expect(selectivelyMigratedDocuments[0].uid).toMatch(uuidPattern);
      expect(selectivelyMigratedDocuments[0].uid).not.toBe(firstDocumentUid);
      expect(selectivelyMigratedDocuments[1].uid).toBe(stableDocumentUid);
      expect(selectivelyMigratedVersions[0].uid).toMatch(uuidPattern);
      expect(selectivelyMigratedVersions[0].uid).not.toBe(firstVersionUid);
      expect(selectivelyMigratedVersions[1].uid).toBe(stableVersionUid);
    } finally {
      await app?.close();
    }
  });
});
