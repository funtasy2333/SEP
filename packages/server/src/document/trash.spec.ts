import { get } from 'http';
import { createTestApp, type TestApp } from '../test-support/test-app';
import { canonical, sampleDocument } from '../test-support/sample-documents';
import { DocumentEntity } from './document.entity';
import { VersionEntity } from '../version/version.entity';
import request from 'supertest';

interface DocumentBody extends DocumentEntity {
  deletedAt?: string | null;
}

interface TrashItem {
  id: number;
  title: string;
  meta: Record<string, unknown>;
  stage: string;
  revision: number;
  deletedAt: string;
}

const meta = {
  titleCn: '回收站生命周期测试',
  standardNo: 'GB/T 90000—2026',
  standardType: 'national',
};

const content = canonical(sampleDocument());

async function reply<T>(test: request.Test, status: number): Promise<T> {
  const response = await test.expect(status);
  return response.body as T;
}

function eventStatus(url: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = get(
      `${url}${path}`,
      { headers: { Accept: 'text/event-stream' } },
      (res) => {
        const status = res.statusCode ?? 0;
        res.destroy();
        resolve(status);
      },
    );
    req.on('error', (error) => {
      if (!req.destroyed) reject(error);
    });
  });
}

describe('文档回收站生命周期', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.app.close();
  });

  async function createDocument(title = meta.titleCn): Promise<DocumentBody> {
    const response = await t.http
      .post('/api/documents')
      .send({
        title,
        meta: { ...meta, titleCn: title },
        stage: 'working_draft',
        content,
      })
      .expect(201);
    return response.body as DocumentBody;
  }

  async function createVersion(documentId: number): Promise<VersionEntity> {
    const response = await t.http
      .post('/api/versions')
      .send({
        documentId,
        versionNo: '1.0',
        stage: 'working_draft',
        content,
        note: '删除前版本',
      })
      .expect(201);
    return response.body as VersionEntity;
  }

  it('普通删除移入回收站，活动列表隐藏且正文、元数据、版本都保留', async () => {
    const doc = await createDocument();
    const version = await createVersion(doc.id);

    await t.http.delete(`/api/documents/${doc.id}`).expect(200);

    const active = await reply<DocumentBody[]>(
      t.http.get('/api/documents'),
      200,
    );
    expect(active).toEqual([]);
    await t.http.get(`/api/documents/${doc.id}`).expect(404);

    const trash = await reply<TrashItem[]>(
      t.http.get('/api/documents/trash'),
      200,
    );
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({
      id: doc.id,
      title: doc.title,
      meta,
      stage: doc.stage,
      revision: 1,
      deletedAt: expect.any(String) as unknown,
    });
    expect(trash[0]).not.toHaveProperty('content');
    expect(trash[0]).not.toHaveProperty('versions');

    const stored = await t.dataSource
      .getRepository(DocumentEntity)
      .findOneByOrFail({ id: doc.id });
    expect(stored.content).toEqual(content);
    expect(stored.meta).toEqual(meta);
    expect(stored.revision).toBe(1);
    const retainedVersions = await t.dataSource
      .getRepository(VersionEntity)
      .findBy({ documentId: doc.id });
    expect(retainedVersions.map((entry) => entry.id)).toEqual([version.id]);
  });

  it('恢复保留原 id、正文、元数据和版本，并让删除前 revision 失效', async () => {
    const doc = await createDocument();
    const version = await createVersion(doc.id);
    const lifecycle: unknown[] = [];
    const subscription = t.events
      .events(doc.id)
      .subscribe((event) => lifecycle.push(event));
    await t.http.delete(`/api/documents/${doc.id}`).expect(200);

    const restored = await reply<DocumentBody>(
      t.http.post(`/api/documents/${doc.id}/restore`),
      200,
    );
    subscription.unsubscribe();
    expect(restored).toMatchObject({
      id: doc.id,
      title: doc.title,
      meta,
      content,
      revision: 2,
      deletedAt: null,
    });
    const versions = await reply<VersionEntity[]>(
      t.http.get(`/api/versions/document/${doc.id}`),
      200,
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: version.id,
      note: '删除前版本',
    });

    const stale = await reply<{ revision: number }>(
      t.http.put(`/api/documents/${doc.id}`).send({
        baseRevision: 0,
        title: '旧页面覆盖',
      }),
      409,
    );
    expect(stale.revision).toBe(2);
    const current = await reply<DocumentBody>(
      t.http.get(`/api/documents/${doc.id}`),
      200,
    );
    expect(current.title).toBe(doc.title);
    expect(current.content).toEqual(content);
    expect(lifecycle).toHaveLength(2);
    expect(lifecycle).toMatchObject([
      { source: 'human', lifecycle: 'deleted', revision: 1 },
      { source: 'human', lifecycle: 'restored', revision: 2 },
    ]);
  });

  it('回收站文档不能经版本、operations、导出或 SSE 活动入口读取或写入', async () => {
    const doc = await createDocument();
    const version = await createVersion(doc.id);

    // 先确认这些活动入口真实存在且请求有效，之后的 404 才能证明删除隔离。
    await t.http.get(`/api/versions/document/${doc.id}`).expect(200);
    await t.http.get(`/api/versions/${version.id}`).expect(200);
    await t.http
      .post('/api/versions')
      .send({
        documentId: doc.id,
        versionNo: '1.1',
        stage: 'working_draft',
        content,
      })
      .expect(201);
    await t.http.get(`/api/documents/${doc.id}/outline`).expect(200);
    await t.http
      .post(`/api/documents/${doc.id}/operations`)
      .send({
        baseRevision: 0,
        source: 'human',
        operations: [{ op: 'delete', nodeId: 'p-extra' }],
      })
      .expect(200);
    await t.http.get(`/api/documents/${doc.id}/export/json`).expect(200);
    expect(await eventStatus(t.url, `/api/documents/${doc.id}/events`)).toBe(
      200,
    );

    await t.http.delete(`/api/documents/${doc.id}`).expect(200);

    await t.http.get(`/api/versions/document/${doc.id}`).expect(404);
    await t.http.get(`/api/versions/${version.id}`).expect(404);
    await t.http
      .post('/api/versions')
      .send({
        documentId: doc.id,
        versionNo: '1.1',
        content,
      })
      .expect(404);
    await t.http.get(`/api/documents/${doc.id}/outline`).expect(404);
    await t.http
      .post(`/api/documents/${doc.id}/operations`)
      .send({
        baseRevision: 1,
        source: 'ai',
        operations: [{ op: 'delete', nodeId: 'missing' }],
      })
      .expect(404);
    await t.http.get(`/api/documents/${doc.id}/export/json`).expect(404);
    expect(await eventStatus(t.url, `/api/documents/${doc.id}/events`)).toBe(
      404,
    );
  });

  it('新建接口忽略显式 id 与 lifecycle 字段，不能覆写或复活回收站条目', async () => {
    const trashed = await createDocument();
    await t.http.delete(`/api/documents/${trashed.id}`).expect(200);

    const created = await reply<DocumentBody>(
      t.http.post('/api/documents').send({
        id: trashed.id,
        title: '伪装的新文档',
        meta: { ...meta, titleCn: '伪装的新文档' },
        stage: 'working_draft',
        content: { type: 'doc', content: [] },
        deletedAt: null,
        revision: 99,
      }),
      201,
    );

    expect(created.id).not.toBe(trashed.id);
    expect(created.revision).toBe(0);
    const old = await t.dataSource
      .getRepository(DocumentEntity)
      .findOneByOrFail({ id: trashed.id });
    expect(old.title).toBe(trashed.title);
    expect(old.revision).toBe(1);
    const lifecycle = await t.dataSource.query<Array<{ deletedAt: string }>>(
      'SELECT deletedAt FROM documents WHERE id = ?',
      [trashed.id],
    );
    expect(lifecycle[0]?.deletedAt).toEqual(expect.any(String));
    const active = await reply<DocumentBody[]>(
      t.http.get('/api/documents'),
      200,
    );
    expect(active.map((entry) => entry.id)).toContain(created.id);
    expect(active.map((entry) => entry.id)).not.toContain(trashed.id);
  });

  it('单项永久删除只接受回收站条目的当前 revision，并级联清除版本', async () => {
    const doc = await createDocument();
    await createVersion(doc.id);

    await t.http
      .delete(`/api/documents/${doc.id}/permanent`)
      .send({ baseRevision: 0 })
      .expect(409);
    expect(
      await t.dataSource.getRepository(DocumentEntity).countBy({ id: doc.id }),
    ).toBe(1);

    await t.http.delete(`/api/documents/${doc.id}`).expect(200);
    await t.http
      .delete(`/api/documents/${doc.id}/permanent`)
      .send({ baseRevision: 0 })
      .expect(409);
    await t.http
      .delete(`/api/documents/${doc.id}/permanent`)
      .send({ baseRevision: 1 })
      .expect(200);

    expect(
      await t.dataSource.getRepository(DocumentEntity).countBy({ id: doc.id }),
    ).toBe(0);
    expect(
      await t.dataSource
        .getRepository(VersionEntity)
        .countBy({ documentId: doc.id }),
    ).toBe(0);
  });

  it('清空只清理确认快照内仍处于回收站且 revision 未变的文档', async () => {
    const first = await createDocument('快照中的文档');
    const later = await createDocument('确认后移入的文档');
    await createVersion(first.id);
    await createVersion(later.id);
    await t.http.delete(`/api/documents/${first.id}`).expect(200);
    const snapshot = [{ id: first.id, revision: 1 }];
    await t.http.delete(`/api/documents/${later.id}`).expect(200);

    await t.http
      .post('/api/documents/trash/empty')
      .send({ documents: snapshot })
      .expect(200);

    expect(
      await t.dataSource
        .getRepository(DocumentEntity)
        .countBy({ id: first.id }),
    ).toBe(0);
    expect(
      await t.dataSource
        .getRepository(VersionEntity)
        .countBy({ documentId: first.id }),
    ).toBe(0);
    const trash = await reply<TrashItem[]>(
      t.http.get('/api/documents/trash'),
      200,
    );
    expect(trash.map((entry) => entry.id)).toEqual([later.id]);
    expect(
      await t.dataSource
        .getRepository(VersionEntity)
        .countBy({ documentId: later.id }),
    ).toBe(1);
  });

  it('清空快照任一条目过期时整批冲突，不先删除有效的其他条目', async () => {
    const first = await createDocument('快照有效文档');
    const second = await createDocument('快照已恢复文档');
    await createVersion(first.id);
    await t.http.delete(`/api/documents/${first.id}`).expect(200);
    await t.http.delete(`/api/documents/${second.id}`).expect(200);
    const snapshot = [
      { id: first.id, revision: 1 },
      { id: second.id, revision: 1 },
    ];
    await t.http.post(`/api/documents/${second.id}/restore`).expect(200);

    await t.http
      .post('/api/documents/trash/empty')
      .send({ documents: snapshot })
      .expect(409);

    expect(
      await t.dataSource
        .getRepository(DocumentEntity)
        .countBy({ id: first.id }),
    ).toBe(1);
    expect(
      await t.dataSource
        .getRepository(VersionEntity)
        .countBy({ documentId: first.id }),
    ).toBe(1);
    await t.http.get(`/api/documents/${second.id}`).expect(200);
  });

  it('回收站请求校验正整数 id、非负 revision 和重复快照项；空快照安全无操作', async () => {
    await t.http
      .post('/api/documents/trash/empty')
      .send({
        documents: [{ id: 0, revision: 0 }],
      })
      .expect(400);
    await t.http
      .post('/api/documents/trash/empty')
      .send({
        documents: [{ id: 1, revision: -1 }],
      })
      .expect(400);
    await t.http
      .post('/api/documents/trash/empty')
      .send({
        documents: [
          { id: 1, revision: 0 },
          { id: 1, revision: 0 },
        ],
      })
      .expect(400);
    await t.http
      .post('/api/documents/trash/empty')
      .send({ documents: [] })
      .expect(200);
    await t.http
      .delete('/api/documents/1/permanent')
      .send({ baseRevision: -1 })
      .expect(400);
  });

  it('POST 版本忽略显式 id，不能把已有版本 upsert 到另一个文档', async () => {
    const first = await createDocument('原始文档');
    const second = await createDocument('目标文档');
    const version = await createVersion(first.id);

    await t.http
      .post('/api/versions')
      .send({
        id: version.id,
        documentId: second.id,
        versionNo: '9.9',
        stage: 'working_draft',
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '篡改' }] },
          ],
        },
      })
      .expect(201);

    const original = await t.dataSource
      .getRepository(VersionEntity)
      .findOneByOrFail({ id: version.id });
    expect(original.documentId).toBe(first.id);
    expect(original.versionNo).toBe('1.0');
    const secondVersions = await t.dataSource
      .getRepository(VersionEntity)
      .findBy({ documentId: second.id });
    expect(secondVersions).toHaveLength(1);
    expect(secondVersions[0].id).not.toBe(version.id);
  });
});
