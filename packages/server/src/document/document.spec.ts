import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { VersionEntity } from '../version/version.entity';
import { VersionModule } from '../version/version.module';
import { DocumentEntity } from './document.entity';
import { DocumentModule } from './document.module';
import { DocumentService } from './document.service';

/** HTTP 响应里的文档（日期序列化为字符串）。 */
interface DocBody {
  id: number;
  title: string;
  meta: Record<string, unknown>;
  stage: string;
  content: Record<string, unknown> | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface ErrorBody {
  statusCode: number;
  message: string;
  revision?: number;
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
  // 并发用例需要真实监听端口：同一个未监听的 http.Server 不能被多个请求同时临时 listen。
  await app.listen(0, '127.0.0.1');
  return app;
}

/** supertest 的 res.body 是 any：断言状态码后按预期形状收窄。 */
async function reply<T = DocBody>(
  test: request.Test,
  status: number,
): Promise<T> {
  const res = await test.expect(status);
  return res.body as T;
}

const meta = {
  titleCn: '测试标准',
  standardType: 'national',
  standardNo: 'GB/T 1—2020',
};
const content = { type: 'doc', content: [{ type: 'paragraph' }] };

describe('文档修订号与乐观锁', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeEach(async () => {
    app = await createApp();
    http = request(await app.getUrl());
  });
  afterEach(async () => {
    await app.close();
  });

  function createDoc(extra: Record<string, unknown> = {}) {
    return reply(
      http.post('/api/documents').send({
        title: '测试标准',
        meta,
        stage: 'working_draft',
        content,
        ...extra,
      }),
      201,
    );
  }

  it('POST 返回 revision=0，GET 单个与列表都带 revision', async () => {
    const created = await createDoc();
    expect(created.revision).toBe(0);

    const one = await reply(http.get(`/api/documents/${created.id}`), 200);
    expect(one.revision).toBe(0);
    const list = await reply<DocBody[]>(http.get('/api/documents'), 200);
    expect(list).toHaveLength(1);
    expect(list[0].revision).toBe(0);
  });

  it('POST 不接受客户端指定的 revision', async () => {
    const created = await createDoc({ revision: 7 });
    expect(created.revision).toBe(0);
  });

  it('PUT 带正确 baseRevision：写入、revision 加 1、updatedAt 更新', async () => {
    const created = await createDoc();
    // updatedAt 精度为秒：先改成过去的时间，避免与更新时刻落在同一秒。
    await app
      .get(DataSource)
      .query(`UPDATE documents SET updatedAt = '2000-01-01 00:00:00'`);

    const newContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '第一次保存' }] },
      ],
    };
    const first = await reply(
      http
        .put(`/api/documents/${created.id}`)
        .send({ baseRevision: 0, content: newContent }),
      200,
    );
    expect(first.revision).toBe(1);
    expect(first.content).toEqual(newContent);
    expect(new Date(first.updatedAt).getUTCFullYear()).toBeGreaterThan(2000);
    expect(first.createdAt).toBe(created.createdAt);

    // 用上一次响应里的 revision 继续保存。
    const second = await reply(
      http
        .put(`/api/documents/${created.id}`)
        .send({ baseRevision: first.revision, title: '改名' }),
      200,
    );
    expect(second.revision).toBe(2);
    expect(second.title).toBe('改名');
    // 未提供的字段保持不变。
    expect(second.content).toEqual(newContent);
    expect(second.meta).toEqual(meta);
  });

  it('过期的 baseRevision 返回 409 与当前 revision，且不写入', async () => {
    const created = await createDoc();
    await reply(
      http
        .put(`/api/documents/${created.id}`)
        .send({ baseRevision: 0, title: '甲写入' }),
      200,
    );

    const stale = await reply<ErrorBody>(
      http
        .put(`/api/documents/${created.id}`)
        .send({ baseRevision: 0, title: '乙的覆盖' }),
      409,
    );
    expect(stale.revision).toBe(1);
    expect(stale.statusCode).toBe(409);
    expect(stale.message).toContain('文档已被修改');

    const current = await reply(http.get(`/api/documents/${created.id}`), 200);
    expect(current.title).toBe('甲写入');
    expect(current.revision).toBe(1);

    // 比当前更大的 baseRevision 同样视为不一致。
    await http
      .put(`/api/documents/${created.id}`)
      .send({ baseRevision: 5, title: '超前' })
      .expect(409);
  });

  it('缺失 baseRevision 返回 428，类型不对返回 400，均不写入', async () => {
    const created = await createDoc();
    const url = `/api/documents/${created.id}`;

    const missing = await reply<ErrorBody>(
      http.put(url).send({ title: '无锁写入' }),
      428,
    );
    expect(missing.message).toContain('baseRevision');

    for (const bad of ['0', null, -1, 1.5, true, [0], {}]) {
      await http
        .put(url)
        .send({ baseRevision: bad, title: '坏值' })
        .expect(400);
    }
    await http.put(url).send([]).expect(400);
    await http.put(url).send({ baseRevision: 0, title: 123 }).expect(400);
    await http.put(url).send({ baseRevision: 0, meta: [] }).expect(400);
    await http.put(url).send({ baseRevision: 0, content: 'x' }).expect(400);

    const current = await reply(http.get(url), 200);
    expect(current.title).toBe('测试标准');
    expect(current.revision).toBe(0);
  });

  it('文档不存在返回 404', async () => {
    await http
      .put('/api/documents/9999')
      .send({ baseRevision: 0, title: 'x' })
      .expect(404);
  });

  it('请求体里的 id / revision / createdAt / updatedAt 不会覆盖服务端值', async () => {
    const created = await createDoc();
    const updated = await reply(
      http.put(`/api/documents/${created.id}`).send({
        baseRevision: 0,
        title: '正常更新',
        id: 999,
        revision: 99,
        createdAt: '2001-01-01T00:00:00.000Z',
        updatedAt: '2001-01-01T00:00:00.000Z',
      }),
      200,
    );
    expect(updated.id).toBe(created.id);
    expect(updated.revision).toBe(1);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getUTCFullYear()).toBeGreaterThan(2001);
    await http.get('/api/documents/999').expect(404);
  });

  it('两个并发 PUT 使用同一个 baseRevision 时只有一个成功', async () => {
    const created = await createDoc();
    const url = `/api/documents/${created.id}`;
    const attempts = 8;
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_, index) =>
        http.put(url).send({ baseRevision: 0, title: `写入者${index}` }),
      ),
    );
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses).toEqual([200, ...Array<number>(attempts - 1).fill(409)]);

    const winner = responses.find((res) => res.status === 200)!.body as DocBody;
    expect(winner.revision).toBe(1);
    for (const loser of responses.filter((res) => res.status === 409)) {
      expect((loser.body as ErrorBody).revision).toBe(1);
    }
    const current = await reply(http.get(url), 200);
    expect(current.revision).toBe(1);
    expect(current.title).toBe(winner.title);
  });

  // HTTP 请求各自在独立的 I/O 回调里处理，同步的 better-sqlite3 下不会交错；
  // 要真正复现「两个写入者都读到旧 revision」，必须在同一个 tick 里直接并发调用服务。
  it('服务层同一 tick 并发调用同一个 baseRevision，只有一个成功', async () => {
    const created = await createDoc();
    const service = app.get(DocumentService);
    const attempts = 8;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, index) =>
        service.update(created.id, 0, { title: `写入者${index}` }),
      ),
    );
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<DocumentEntity> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(attempts - 1);
    for (const { reason } of rejected) {
      expect(reason).toBeInstanceOf(ConflictException);
      expect((reason as ConflictException).getResponse()).toMatchObject({
        revision: 1,
      });
    }
    const current = await service.findOne(created.id);
    expect(current.revision).toBe(1);
    expect(current.title).toBe(fulfilled[0].value.title);
  });

  it('meta / content 的 JSON 经 QueryBuilder 更新后往返一致', async () => {
    const created = await createDoc();
    const richMeta = {
      titleCn: '含"引号"、\\反斜杠与换行\n的标题',
      titleEn: 'Émoji 😀 / 中文',
      standardType: 'national',
      nested: { list: [1, 2.5, null, true, '末'], empty: {} },
    };
    const richContent = {
      type: 'doc',
      attrs: { extensionVersion: 1 },
      content: [
        {
          type: 'paragraph',
          attrs: { nodeId: 'a-1' },
          content: [{ type: 'text', text: '行一\n行二\t制表 "引" \\ ★' }],
        },
      ],
    };
    const updated = await reply(
      http
        .put(`/api/documents/${created.id}`)
        .send({ baseRevision: 0, meta: richMeta, content: richContent }),
      200,
    );
    expect(updated.meta).toEqual(richMeta);
    expect(updated.content).toEqual(richContent);

    const reread = await reply(http.get(`/api/documents/${created.id}`), 200);
    expect(reread.meta).toEqual(richMeta);
    expect(reread.content).toEqual(richContent);

    // 库中存的必须是 JSON 文本，而不是 [object Object] 之类的序列化错误。
    const rows: Array<{ meta: string; content: string }> = await app
      .get(DataSource)
      .query(`SELECT meta, content FROM documents WHERE id = ?`, [created.id]);
    expect(JSON.parse(rows[0].meta)).toEqual(richMeta);
    expect(JSON.parse(rows[0].content)).toEqual(richContent);
  });

  it('content 可以被显式置空', async () => {
    const created = await createDoc();
    const updated = await reply(
      http
        .put(`/api/documents/${created.id}`)
        .send({ baseRevision: 0, content: null }),
      200,
    );
    expect(updated.content).toBeNull();
  });
});

describe('旧库升级', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ses-legacy-db-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('synchronize 给旧表补上 revision / source / client，原有数据不丢失', async () => {
    const file = join(dir, 'legacy.db');
    const legacyMeta = {
      titleCn: '旧库文档',
      standardType: 'national',
      standardNo: 'GB/T 1—2020',
      icsCode: '01.120',
    };
    const legacyContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '旧库正文 ★ "quote" \\ 换行\n第二行' },
          ],
        },
      ],
    };

    // 改动前代码（synchronize）建出的表结构：没有 revision / source / client。
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE "documents" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "title" varchar NOT NULL, "meta" text NOT NULL, "stage" varchar NOT NULL DEFAULT ('working_draft'), "content" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE "versions" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "documentId" integer NOT NULL, "versionNo" varchar NOT NULL, "stage" varchar NOT NULL DEFAULT ('working_draft'), "content" text NOT NULL, "xml" text, "note" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_8ce14e37a63a94abf452fbd1723" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE NO ACTION);
    `);
    legacy
      .prepare(
        `INSERT INTO documents (title, meta, stage, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, '2026-10-13 04:17:06', '2026-10-13 04:17:06')`,
      )
      .run(
        '旧库文档',
        JSON.stringify(legacyMeta),
        'working_draft',
        JSON.stringify(legacyContent),
      );
    legacy
      .prepare(
        `INSERT INTO versions (documentId, versionNo, stage, content, note) VALUES (1, '1.0', 'working_draft', ?, '旧库版本')`,
      )
      .run(JSON.stringify({ type: 'doc', content: [] }));
    legacy.close();

    const app = await createApp(file);
    try {
      const http = request(await app.getUrl());
      const doc = await reply(http.get('/api/documents/1'), 200);
      expect(doc).toMatchObject({
        id: 1,
        title: '旧库文档',
        stage: 'working_draft',
        revision: 0,
        meta: legacyMeta,
        content: legacyContent,
      });
      expect(doc.createdAt).toBe('2026-10-13T04:17:06.000Z');

      const versions = await reply<unknown[]>(
        http.get('/api/versions/document/1'),
        200,
      );
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        versionNo: '1.0',
        note: '旧库版本',
        source: 'human',
        client: null,
      });

      // 旧行可直接用 baseRevision=0 保存。
      const saved = await reply(
        http
          .put('/api/documents/1')
          .send({ baseRevision: 0, title: '升级后保存' }),
        200,
      );
      expect(saved.revision).toBe(1);
      expect(saved.meta).toEqual(legacyMeta);
    } finally {
      await app.close();
    }
  });
});
