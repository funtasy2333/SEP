import { canonical, doc, para } from '../test-support/sample-documents';
import { createTestApp, type TestApp } from '../test-support/test-app';
import { DocumentEntity } from '../document/document.entity';
import type {
  DocumentChangeEvent,
  DocumentChangeOrigin,
} from '../document/document-events.service';
import { VersionEntity } from '../version/version.entity';
import type { EntityManager } from 'typeorm';
import request from 'supertest';
import {
  SES_PACKAGE_MIME,
  type SesPackage,
  type SesPackageVersion,
} from './ses-package-format';

const IMPORT_PATH = '/api/documents/import/ses';
const DOC_UID = 'a0000000-0000-4000-8000-000000000001';
const VERSION_UID = 'a0000000-0000-4000-8000-000000000010';
const ADDED_VERSION_UID = 'a0000000-0000-4000-8000-000000000011';
const META = {
  titleCn: '元数据中的标题',
  standardType: 'national',
  standardNo: 'GB/T 1234—2026',
};

interface ImportedDocumentBody {
  id: number;
  uid: string;
  title: string;
  meta: Record<string, unknown>;
  stage: string;
  content: Record<string, unknown> | null;
  revision: number;
  deletedAt: string | null;
  createdAt: string;
}

interface ImportPreviewBody {
  match: { id: number; title: string; revision: number } | null;
  inTrash: boolean;
  newVersions: number;
  localOnlyVersions: number;
  contentDiffers: boolean;
  versionNoCollisions: string[];
}

interface ImportErrorBody {
  message: string;
  revision?: number;
}

function content(value: string): Record<string, unknown> {
  return canonical(doc(para('p-import', value)));
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)]),
  );
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
    content: content(`版本 ${versionNo}`),
    baseContent: null,
    note: null,
    source: 'human',
    client: null,
    createdAt: '2024-01-02T03:04:05.678Z',
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
      uid: DOC_UID,
      title: '包内标题',
      meta: { ...META },
      stage: 'working_draft',
      content: content('包内当前正文'),
      createdAt: '2024-01-02T03:04:05.678Z',
      updatedAt: '2024-02-03T04:05:06.789Z',
    },
    versions: [],
    ...overrides,
  };
}

function postPackage(testApp: TestApp, pkg: unknown, query: string) {
  return testApp.http
    .post(`${IMPORT_PATH}?${query}`)
    .send(JSON.stringify(pkg))
    .set('Content-Type', SES_PACKAGE_MIME);
}

async function expectBody<T>(test: request.Test, status: number): Promise<T> {
  const response = await test.expect(status);
  return response.body as T;
}

async function addLocalVersion(
  testApp: TestApp,
  documentId: number,
  uid: string,
  versionNo: string,
  createdAt: Date,
): Promise<VersionEntity> {
  const repo = testApp.dataSource.getRepository(VersionEntity);
  return repo.save(
    repo.create({
      uid,
      documentId,
      versionNo,
      stage: 'working_draft',
      content: content(`本地版本 ${versionNo}`),
      baseContent: null,
      xml: null,
      note: null,
      source: 'human',
      client: null,
      createdAt,
    }),
  );
}

describe('POST /api/documents/import/ses', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
  });

  afterEach(async () => {
    await testApp.app.close();
    jest.restoreAllMocks();
  });

  it('preview is read-only, matches UUIDs case-insensitively, and compares JSON independent of key order', async () => {
    const active = await testApp.documents.create({
      title: '本地活动文档',
      meta: META,
      stage: 'working_draft',
      content: content('本地正文'),
    });
    const trash = await testApp.documents.create({
      title: '同身份回收站副本',
      meta: META,
      stage: 'working_draft',
      content: content('回收站正文'),
    });
    const documents = testApp.dataSource.getRepository(DocumentEntity);
    await documents.update(active.id, { uid: DOC_UID.toLowerCase() });
    await documents.update(trash.id, { uid: DOC_UID.toLowerCase() });
    await testApp.documents.remove(trash.id);

    await addLocalVersion(
      testApp,
      active.id,
      VERSION_UID.toLowerCase(),
      '1.0',
      new Date('2023-01-01T00:00:00.000Z'),
    );
    await addLocalVersion(
      testApp,
      active.id,
      'a0000000-0000-4000-8000-000000000012',
      '2.0',
      new Date('2023-02-01T00:00:00.000Z'),
    );

    const beforeDoc = await documents.findOneByOrFail({ id: active.id });
    const versionRepo = testApp.dataSource.getRepository(VersionEntity);
    const beforeVersions = await versionRepo.find({
      where: { documentId: active.id },
      order: { id: 'ASC' },
    });
    const publish = jest.spyOn(testApp.documents, 'publishChange');
    publish.mockClear();
    const pkg = packageFixture({
      document: {
        ...packageFixture().document,
        uid: DOC_UID.toUpperCase(),
        content: reverseObjectKeys(beforeDoc.content) as Record<
          string,
          unknown
        >,
      },
      versions: [
        packageVersion(VERSION_UID.toUpperCase(), '1.0'),
        packageVersion(ADDED_VERSION_UID, '1.0'),
      ],
    });

    const response = await expectBody<ImportPreviewBody>(
      postPackage(testApp, pkg, 'mode=preview'),
      200,
    );
    expect(response).toEqual({
      match: {
        id: active.id,
        title: '本地活动文档',
        revision: beforeDoc.revision,
      },
      inTrash: false,
      newVersions: 1,
      localOnlyVersions: 1,
      contentDiffers: false,
      versionNoCollisions: ['1.0'],
    });

    const afterDoc = await documents.findOneByOrFail({ id: active.id });
    const afterVersions = await versionRepo.find({
      where: { documentId: active.id },
      order: { id: 'ASC' },
    });
    expect(afterDoc).toMatchObject({
      uid: DOC_UID.toLowerCase(),
      revision: beforeDoc.revision,
      updatedAt: beforeDoc.updatedAt,
      content: beforeDoc.content,
    });
    expect(afterVersions).toEqual(beforeVersions);
    expect(publish).not.toHaveBeenCalled();
  });

  it('preview without a matching uid counts every package version and returns empty local differences', async () => {
    const pkg = packageFixture({
      versions: [
        packageVersion(VERSION_UID, '1.0'),
        packageVersion(ADDED_VERSION_UID, '2.0'),
      ],
    });
    const response = await expectBody<ImportPreviewBody>(
      postPackage(testApp, pkg, 'mode=preview'),
      200,
    );
    expect(response).toEqual({
      match: null,
      inTrash: false,
      newVersions: 2,
      localOnlyVersions: 0,
      contentDiffers: false,
      versionNoCollisions: [],
    });
  });

  it('preview reports a matching trashed document and update refuses it', async () => {
    const document = await testApp.documents.create({
      title: '已删除文档',
      meta: META,
      stage: 'working_draft',
      content: content('本地正文'),
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(document.id, { uid: DOC_UID });
    await testApp.documents.remove(document.id);

    const preview = await expectBody<ImportPreviewBody>(
      postPackage(testApp, packageFixture(), 'mode=preview'),
      200,
    );
    expect(preview).toMatchObject({
      match: { id: document.id, title: '已删除文档' },
      inTrash: true,
    });

    await postPackage(
      testApp,
      packageFixture(),
      `mode=update&targetId=${document.id}&baseRevision=${document.revision + 1}`,
    ).expect(409);
  });

  it('new preserves the package UUID and the original version timestamp to the millisecond', async () => {
    const pkg = packageFixture({
      document: {
        ...packageFixture().document,
        uid: DOC_UID.toUpperCase(),
      },
      versions: [
        packageVersion(VERSION_UID.toUpperCase(), '1.0', {
          source: 'ai',
          client: 'writer',
          baseContent: content('AI 写入前正文'),
        }),
      ],
    });
    const publish = jest.spyOn(testApp.documents, 'publishChange');
    const response = await expectBody<ImportedDocumentBody>(
      postPackage(testApp, pkg, 'mode=new'),
      201,
    );
    expect(response).toMatchObject({
      uid: DOC_UID.toUpperCase(),
      title: '包内标题',
      meta: META,
      revision: 0,
      deletedAt: null,
    });
    expect(new Date(response.createdAt).getTime()).not.toBe(
      new Date(pkg.document.createdAt).getTime(),
    );
    expect(publish).not.toHaveBeenCalled();

    const version = await testApp.dataSource
      .getRepository(VersionEntity)
      .createQueryBuilder('version')
      .addSelect('version.baseContent')
      .where('LOWER(version.uid) = :uid', {
        uid: VERSION_UID.toLowerCase(),
      })
      .getOneOrFail();
    expect(version.uid).toBe(VERSION_UID.toUpperCase());
    expect(version.createdAt.toISOString()).toBe('2024-01-02T03:04:05.678Z');
    expect(version).toMatchObject({
      documentId: response.id,
      versionNo: '1.0',
      source: 'ai',
      client: 'writer',
      baseContent: content('AI 写入前正文'),
    });
  });

  it('new creates a case-insensitive identity copy when the uid is occupied in the trash', async () => {
    const existing = await testApp.documents.create({
      title: '已存在',
      meta: META,
      stage: 'working_draft',
      content: content('正文'),
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(existing.id, { uid: DOC_UID.toLowerCase() });
    await testApp.documents.remove(existing.id);
    const pkg = packageFixture({
      document: {
        ...packageFixture().document,
        uid: DOC_UID.toUpperCase(),
        meta: { ...META, titleCn: '仍应保留的元数据标题' },
      },
    });

    const response = await expectBody<ImportedDocumentBody>(
      postPackage(testApp, pkg, 'mode=new'),
      201,
    );
    expect(response.uid.toLowerCase()).not.toBe(DOC_UID.toLowerCase());
    expect(response.title).toBe('包内标题（导入副本）');
    expect(response.meta).toEqual({
      ...pkg.document.meta,
      titleCn: '包内标题（导入副本）',
    });
    expect(response.content).toEqual(pkg.document.content);
    expect(response.revision).toBe(0);
    expect(response.deletedAt).toBeNull();
  });

  it('new ignores unknown and server-owned fields from the package', async () => {
    const pkg = packageFixture({
      document: {
        ...packageFixture().document,
        id: 777,
        revision: 12,
        deletedAt: '2020-01-01T00:00:00.000Z',
        unknown: 'must not persist',
      } as SesPackage['document'],
    });
    const response = await expectBody<ImportedDocumentBody>(
      postPackage(testApp, pkg, 'mode=new'),
      201,
    );
    expect(response.id).not.toBe(777);
    expect(response.revision).toBe(0);
    expect(response.deletedAt).toBeNull();
    expect(response).not.toHaveProperty('unknown');
  });

  it('update records the import with the local content as baseContent, appends only new versions, resolves collisions, increments revision, and publishes after commit', async () => {
    const localContent = content('导入前本地正文');
    const local = await testApp.documents.create({
      title: '旧标题',
      meta: META,
      stage: 'working_draft',
      content: localContent,
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(local.id, { uid: DOC_UID.toLowerCase() });
    await addLocalVersion(
      testApp,
      local.id,
      VERSION_UID.toLowerCase(),
      '1.0',
      new Date('2023-01-01T00:00:00.000Z'),
    );
    await addLocalVersion(
      testApp,
      local.id,
      'a0000000-0000-4000-8000-000000000020',
      '2.0',
      new Date('2025-01-01T00:00:00.000Z'),
    );
    await addLocalVersion(
      testApp,
      local.id,
      'a0000000-0000-4000-8000-000000000021',
      '2.1',
      new Date('2024-01-01T00:00:00.000Z'),
    );

    const pkg = packageFixture({
      document: {
        ...packageFixture().document,
        uid: DOC_UID.toUpperCase(),
        title: '更新后的标题',
        meta: { ...META, titleCn: '包内中文标题' },
        stage: 'review_draft',
        content: content('包内更新正文'),
      },
      versions: [
        packageVersion(VERSION_UID.toUpperCase(), '1.0', {
          note: '已有身份的内容不得覆盖',
        }),
        packageVersion(ADDED_VERSION_UID, '1.0', {
          note: '新增版本备注',
        }),
        packageVersion('a0000000-0000-4000-8000-000000000013', '8.0'),
      ],
    });
    const events: DocumentChangeEvent[] = [];
    const subscription = testApp.events
      .events(local.id)
      .subscribe((event) => events.push(event));

    const transaction = testApp.documents.transaction.bind(
      testApp.documents,
    ) as <T>(work: (manager: EntityManager) => Promise<T>) => Promise<T>;
    let committed = false;
    jest
      .spyOn(testApp.documents, 'transaction')
      .mockImplementation(
        async <T>(work: (manager: EntityManager) => Promise<T>) => {
          const result = await transaction(work);
          committed = true;
          return result;
        },
      );
    const publish = testApp.documents.publishChange.bind(testApp.documents) as (
      document: Pick<DocumentEntity, 'id' | 'revision'>,
      origin: DocumentChangeOrigin,
    ) => void;
    jest
      .spyOn(testApp.documents, 'publishChange')
      .mockImplementation((document, origin) => {
        expect(committed).toBe(true);
        publish(document, origin);
      });

    const first = await expectBody<ImportedDocumentBody>(
      postPackage(
        testApp,
        pkg,
        `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
      ),
      200,
    );
    expect(first).toMatchObject({
      id: local.id,
      uid: DOC_UID.toLowerCase(),
      title: '更新后的标题',
      meta: { ...META, titleCn: '包内中文标题' },
      stage: 'review_draft',
      content: pkg.document.content,
      revision: local.revision + 1,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      documentId: local.id,
      revision: local.revision + 1,
      source: 'import',
    });

    const versionRepo = testApp.dataSource.getRepository(VersionEntity);
    const versionsAfterFirst = await versionRepo
      .createQueryBuilder('version')
      .addSelect('version.baseContent')
      .where('version.documentId = :documentId', { documentId: local.id })
      .orderBy('version.createdAt', 'ASC')
      .addOrderBy('version.id', 'ASC')
      .getMany();
    const importRecord = versionsAfterFirst.find(
      (version) => version.note === '导入 .ses 文档包',
    );
    expect(importRecord).toMatchObject({
      versionNo: '2.3',
      stage: 'review_draft',
      content: pkg.document.content,
      baseContent: localContent,
      note: '导入 .ses 文档包',
      source: 'import',
      client: null,
      xml: null,
    });
    expect(typeof importRecord?.uid).toBe('string');
    expect(importRecord?.uid).not.toBe(VERSION_UID);

    const importedCollision = versionsAfterFirst.find(
      (version) => version.uid === ADDED_VERSION_UID,
    );
    expect(importedCollision?.versionNo).toBe('2.2');
    expect(importedCollision?.note).toContain('原版本号 1.0');
    expect(importedCollision?.note).toContain('新增版本备注');
    expect(
      versionsAfterFirst.filter(
        (version) => version.uid?.toLowerCase() === VERSION_UID.toLowerCase(),
      ),
    ).toHaveLength(1);
    expect(
      versionsAfterFirst.find(
        (version) => version.uid?.toLowerCase() === VERSION_UID.toLowerCase(),
      )?.note,
    ).toBeNull();
    expect(
      versionsAfterFirst.find(
        (version) => version.uid === 'a0000000-0000-4000-8000-000000000013',
      )?.versionNo,
    ).toBe('8.0');

    committed = false;
    const second = await expectBody<ImportedDocumentBody>(
      postPackage(
        testApp,
        pkg,
        `mode=update&targetId=${local.id}&baseRevision=${first.revision}`,
      ),
      200,
    );
    expect(second.revision).toBe(first.revision + 1);
    const versionsAfterSecond = await versionRepo.find({
      where: { documentId: local.id },
    });
    expect(versionsAfterSecond).toHaveLength(versionsAfterFirst.length);
    expect(events).toHaveLength(2);
    subscription.unsubscribe();
  });

  describe('round trip where only the other side saved a new version', () => {
    const B_VERSION_UID = 'a0000000-0000-4000-8000-000000000040';

    /** A 有 1.0（正文与当前正文 localContent 相同）；包是 B 在 1.0 之后新增的 1.1。 */
    async function setUp(localContent: Record<string, unknown>) {
      const local = await testApp.documents.create({
        title: '本地标题',
        meta: META,
        stage: 'working_draft',
        content: localContent,
      });
      await testApp.dataSource
        .getRepository(DocumentEntity)
        .update(local.id, { uid: DOC_UID.toLowerCase() });
      const repo = testApp.dataSource.getRepository(VersionEntity);
      await repo.save(
        repo.create({
          uid: VERSION_UID.toLowerCase(),
          documentId: local.id,
          versionNo: '1.0',
          stage: 'working_draft',
          content: content('导出时正文'),
          baseContent: null,
          xml: null,
          note: null,
          source: 'human',
          client: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
        }),
      );
      const bContent = content('B 修改后正文');
      const pkg = packageFixture({
        document: { ...packageFixture().document, content: bContent },
        versions: [
          packageVersion(VERSION_UID, '1.0', {
            content: content('导出时正文'),
            createdAt: '2024-01-01T00:00:00.000Z',
          }),
          packageVersion(B_VERSION_UID, '1.1', {
            content: bContent,
            note: 'B 新增版本',
            createdAt: '2024-06-01T00:00:00.000Z',
          }),
        ],
      });
      return { local, pkg };
    }

    async function versionsOf(documentId: number) {
      // baseContent 是 select: false 列，需要显式取出。
      return testApp.dataSource
        .getRepository(VersionEntity)
        .createQueryBuilder('version')
        .addSelect('version.baseContent')
        .where('version.documentId = :documentId', { documentId })
        .orderBy('version.id', 'ASC')
        .getMany();
    }

    it('keeps the other side version number and numbers the import record after it', async () => {
      const { local, pkg } = await setUp(content('导出时正文'));

      const preview = await expectBody<ImportPreviewBody>(
        postPackage(testApp, pkg, 'mode=preview'),
        200,
      );
      expect(preview).toMatchObject({
        contentDiffers: true,
        versionNoCollisions: [],
      });

      await expectBody<ImportedDocumentBody>(
        postPackage(
          testApp,
          pkg,
          `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
        ),
        200,
      );
      const versions = await versionsOf(local.id);
      expect(
        versions.map((version) => [
          version.versionNo,
          version.source,
          version.note,
        ]),
      ).toEqual([
        ['1.0', 'human', null],
        ['1.1', 'human', 'B 新增版本'],
        ['1.2', 'import', '导入 .ses 文档包'],
      ]);
      // 导入记录：baseContent → content 就是这次导入带来的修改。
      expect(versions[2].baseContent).toEqual(content('导出时正文'));
      expect(versions[2].content).toEqual(content('B 修改后正文'));
    });

    it('keeps unsaved local edits as the import record baseContent', async () => {
      const localEdited = content('A 未存版本的本地修改');
      const { local, pkg } = await setUp(localEdited);

      const preview = await expectBody<ImportPreviewBody>(
        postPackage(testApp, pkg, 'mode=preview'),
        200,
      );
      expect(preview).toMatchObject({
        contentDiffers: true,
        versionNoCollisions: [],
      });

      await expectBody<ImportedDocumentBody>(
        postPackage(
          testApp,
          pkg,
          `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
        ),
        200,
      );
      const versions = await versionsOf(local.id);
      expect(
        versions.map((version) => [
          version.versionNo,
          version.source,
          version.note,
        ]),
      ).toEqual([
        ['1.0', 'human', null],
        ['1.1', 'human', 'B 新增版本'],
        ['1.2', 'import', '导入 .ses 文档包'],
      ]);
      expect(versions[2].baseContent).toEqual(localEdited);
    });
  });

  it('falls back to the first free number when a colliding huge minor version cannot advance', async () => {
    const sharedContent = content('两边相同的正文');
    const local = await testApp.documents.create({
      title: '同一标题',
      meta: META,
      stage: 'working_draft',
      content: sharedContent,
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(local.id, { uid: DOC_UID });
    const hugeVersionNo = '1.9007199254740992';
    await addLocalVersion(
      testApp,
      local.id,
      VERSION_UID,
      hugeVersionNo,
      new Date('2025-01-01T00:00:00.000Z'),
    );
    const pkg = packageFixture({
      document: {
        ...packageFixture().document,
        content: sharedContent,
      },
      versions: [
        packageVersion(ADDED_VERSION_UID, hugeVersionNo, {
          note: '大整数碰撞',
        }),
      ],
    });

    await postPackage(
      testApp,
      pkg,
      `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
    ).expect(200);
    const imported = await testApp.dataSource
      .getRepository(VersionEntity)
      .findOneByOrFail({ uid: ADDED_VERSION_UID });
    expect(imported.versionNo).toBe('1.0');
    expect(imported.note).toContain(`原版本号 ${hugeVersionNo}`);
    expect(imported.note).toContain('大整数碰撞');
  });

  it('rolls back the import record and appended versions if the document update fails', async () => {
    const local = await testApp.documents.create({
      title: '写入前标题',
      meta: META,
      stage: 'working_draft',
      content: content('写入前正文'),
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(local.id, { uid: DOC_UID });
    const before = await testApp.documents.findOne(local.id);
    const publish = jest.spyOn(testApp.documents, 'publishChange');
    jest
      .spyOn(testApp.documents, 'updateWithin')
      .mockImplementation(() => Promise.reject(new Error('forced failure')));
    const pkg = packageFixture({
      document: {
        ...packageFixture().document,
        title: '包内新标题',
        content: content('包内新正文'),
      },
      versions: [packageVersion(ADDED_VERSION_UID, '1.0')],
    });

    await postPackage(
      testApp,
      pkg,
      `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
    ).expect(500);
    expect(publish).not.toHaveBeenCalled();
    expect(await testApp.documents.findOne(local.id)).toMatchObject({
      title: before.title,
      content: before.content,
      revision: before.revision,
      updatedAt: before.updatedAt,
    });
    expect(
      await testApp.dataSource
        .getRepository(VersionEntity)
        .find({ where: { documentId: local.id } }),
    ).toEqual([]);
  });

  it('returns 409 before local content validation for a stale revision and leaves all state unchanged', async () => {
    const local = await testApp.documents.create({
      title: '当前标题',
      meta: META,
      stage: 'working_draft',
      content: null,
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(local.id, { uid: DOC_UID });
    await testApp.documents.update(local.id, 0, { title: '另一次写入' });
    const before = await testApp.dataSource
      .getRepository(DocumentEntity)
      .findOneByOrFail({ id: local.id });
    const beforeVersions = await testApp.dataSource
      .getRepository(VersionEntity)
      .find({ where: { documentId: local.id } });
    const publish = jest.spyOn(testApp.documents, 'publishChange');
    publish.mockClear();

    const response = await expectBody<ImportErrorBody>(
      postPackage(
        testApp,
        packageFixture(),
        `mode=update&targetId=${local.id}&baseRevision=0`,
      ),
      409,
    );
    expect(response.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
    expect(
      await testApp.dataSource
        .getRepository(DocumentEntity)
        .findOneByOrFail({ id: local.id }),
    ).toMatchObject({
      title: before.title,
      content: before.content,
      revision: before.revision,
      updatedAt: before.updatedAt,
    });
    expect(
      await testApp.dataSource
        .getRepository(VersionEntity)
        .find({ where: { documentId: local.id } }),
    ).toEqual(beforeVersions);
  });

  it('rejects an update whose non-document local body cannot be recorded as baseContent with 422 and no writes', async () => {
    const local = await testApp.documents.create({
      title: '空正文文档',
      meta: META,
      stage: 'working_draft',
      content: null,
    });
    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(local.id, { uid: DOC_UID });
    const before = await testApp.dataSource
      .getRepository(DocumentEntity)
      .findOneByOrFail({ id: local.id });
    const publish = jest.spyOn(testApp.documents, 'publishChange');

    const response = await expectBody<ImportErrorBody>(
      postPackage(
        testApp,
        packageFixture(),
        `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
      ),
      422,
    );
    expect(response.message).toContain(
      '本地正文无法记录为导入前内容，请先在编辑器保存合法正文或另存为新文档',
    );
    expect(publish).not.toHaveBeenCalled();
    expect(
      await testApp.dataSource
        .getRepository(DocumentEntity)
        .findOneByOrFail({ id: local.id }),
    ).toMatchObject({
      title: before.title,
      content: null,
      revision: before.revision,
      updatedAt: before.updatedAt,
    });
    expect(
      await testApp.dataSource
        .getRepository(VersionEntity)
        .find({ where: { documentId: local.id } }),
    ).toEqual([]);

    await testApp.dataSource
      .getRepository(DocumentEntity)
      .update(local.id, { content: { type: 'paragraph' } as never });
    const beforeLegacyBody = await testApp.dataSource
      .getRepository(DocumentEntity)
      .findOneByOrFail({ id: local.id });
    publish.mockClear();
    await postPackage(
      testApp,
      packageFixture(),
      `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
    ).expect(422);
    expect(publish).not.toHaveBeenCalled();
    expect(
      await testApp.dataSource
        .getRepository(DocumentEntity)
        .findOneByOrFail({ id: local.id }),
    ).toMatchObject({
      content: { type: 'paragraph' },
      revision: beforeLegacyBody.revision,
      updatedAt: beforeLegacyBody.updatedAt,
    });
    expect(
      await testApp.dataSource
        .getRepository(VersionEntity)
        .find({ where: { documentId: local.id } }),
    ).toEqual([]);
  });

  it('rejects a target with a different uid and leaves it unchanged', async () => {
    const local = await testApp.documents.create({
      title: '不同身份',
      meta: META,
      stage: 'working_draft',
      content: content('原正文'),
    });
    const before = await testApp.documents.findOne(local.id);
    const publish = jest.spyOn(testApp.documents, 'publishChange');
    await postPackage(
      testApp,
      packageFixture(),
      `mode=update&targetId=${local.id}&baseRevision=${local.revision}`,
    ).expect(400);
    expect(publish).not.toHaveBeenCalled();
    expect(await testApp.documents.findOne(local.id)).toMatchObject({
      title: before.title,
      content: before.content,
      revision: before.revision,
    });
  });

  it('returns 422 for package schema validation without creating a document', async () => {
    const pkg = packageFixture({
      document: {
        ...packageFixture().document,
        content: { type: 'not-a-document' },
      },
    });
    const before = await testApp.documents.findAll();
    await postPackage(testApp, pkg, 'mode=new').expect(422);
    expect(await testApp.documents.findAll()).toEqual(before);
  });

  it('validates mode and query values, requires baseRevision, and rejects the wrong MIME type', async () => {
    const body = Buffer.from(JSON.stringify(packageFixture()), 'utf8');
    const request = (query: string) =>
      testApp.http
        .post(`${IMPORT_PATH}${query ? `?${query}` : ''}`)
        .send(body.toString('utf8'))
        .set('Content-Type', SES_PACKAGE_MIME);

    await request('').expect(400);
    await request('mode=merge').expect(400);
    await request('mode=preview&mode=new').expect(400);
    await request('mode=update&targetId=1&baseRevision=nope').expect(400);
    await request('mode=update&targetId=nope&baseRevision=0').expect(400);
    await request('mode=update&targetId=1&targetId=2&baseRevision=0').expect(
      400,
    );
    await request(
      'mode=update&targetId=1&baseRevision=0&baseRevision=1',
    ).expect(400);
    await request('mode=update&targetId=1').expect(428);
    await testApp.http
      .post(`${IMPORT_PATH}?mode=preview`)
      .send(body.toString('utf8'))
      .set('Content-Type', 'application/json')
      .expect(415);
    await testApp.http
      .post(`${IMPORT_PATH}?mode=preview`)
      .set('Content-Type', `${SES_PACKAGE_MIME}; charset=utf-8`)
      .expect(400);
  });

  it('accepts a raw package larger than the JSON body limit', async () => {
    const json = Buffer.from(JSON.stringify(packageFixture()), 'utf8');
    const body = Buffer.alloc(25 * 1024 * 1024 + 1, 0x20);
    json.copy(body);
    await testApp.http
      .post(`${IMPORT_PATH}?mode=preview`)
      .send(body.toString('utf8'))
      .set('Content-Type', SES_PACKAGE_MIME)
      .timeout({ response: 30_000 })
      .expect(200);
  });
});
