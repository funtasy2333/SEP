import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestApp, type TestApp } from '../test-support/test-app';
import { VersionEntity } from '../version/version.entity';
import { WARNING_COUNT_HEADER, WARNINGS_HEADER } from '../export/export-http';
import { parseSesPackage } from './ses-package-format';

const EXPORT_PATH = (id: number) => `/api/documents/${id}/export/ses`;
const EXTERNAL_IMAGE_WARNING =
  '服务端导出不访问网络资源，请使用内嵌（data URL）图片';

type JsonNode = Record<string, unknown> & {
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  type?: string;
};

interface ExportedDocument extends Record<string, unknown> {
  uid: string;
  title: string;
  meta: Record<string, unknown>;
  stage: string;
  content: JsonNode;
  createdAt: string;
  updatedAt: string;
}

interface ExportedVersion extends Record<string, unknown> {
  uid: string;
  versionNo: string;
  stage: string;
  content: unknown;
  baseContent: unknown;
  note: string | null;
  source: string;
  client: string | null;
  createdAt: string;
}

interface ExportedPackage extends Record<string, unknown> {
  format: string;
  formatVersion: number;
  versionScope?: string;
  document: ExportedDocument;
  versions: ExportedVersion[];
}

function fixtureContent(): JsonNode {
  return JSON.parse(
    readFileSync(
      join(__dirname, '../export/__fixtures__/standard-document.json'),
      'utf8',
    ),
  ) as JsonNode;
}

function findNode(root: JsonNode, type: string): JsonNode | undefined {
  if (root.type === type) return root;
  for (const child of root.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
}

describe('GET /api/documents/:id/export/ses', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('downloads the explicit UTF-8 package with every version and its baseContent', async () => {
    const content = fixtureContent();
    const figureResource = {
      type: 'figureResource',
      attrs: {
        nodeId: 'resource-1',
        mediaType: 'image/svg+xml',
        name: '标记.svg',
        encoding: 'dataUrl',
        data: 'data:image/svg+xml;base64,PHN2Zz4=',
      },
    };
    content.content!.push(figureResource);
    const originalContent = structuredClone(content);
    const meta = {
      standardNo: 'GB/T 1234—2026',
      titleCn: '元数据标题',
      titleEn: 'Metadata title',
      standardType: 'national',
    };
    const document = await testApp.documents.create({
      title: '安全规则',
      meta,
      stage: 'review_draft',
      content,
    });

    const early = new Date('2021-05-06T07:08:09.000Z');
    const tied = new Date('2022-05-06T07:08:09.000Z');
    const earlyVersionContent = fixtureContent();
    const versionContent = fixtureContent();
    const laterVersionContent = fixtureContent();
    const baseContent = fixtureContent();
    baseContent.attrs = { legacyMarker: '写入前正文' };
    const versionRepo = testApp.dataSource.getRepository(VersionEntity);
    await versionRepo.save([
      versionRepo.create({
        id: 9,
        uid: '10000000-0000-4000-8000-000000000009',
        documentId: document.id,
        versionNo: '2.0',
        stage: 'review_draft',
        content: versionContent,
        baseContent,
        note: '第二版',
        source: 'ai',
        client: 'test-agent',
        xml: '<legacy/>',
        createdAt: tied,
      }),
      versionRepo.create({
        id: 4,
        uid: '10000000-0000-4000-8000-000000000004',
        documentId: document.id,
        versionNo: '1.0',
        stage: 'working_draft',
        content: earlyVersionContent,
        baseContent: null,
        note: null,
        source: 'human',
        client: null,
        createdAt: early,
      }),
      versionRepo.create({
        id: 11,
        uid: '10000000-0000-4000-8000-000000000011',
        documentId: document.id,
        versionNo: '2.1',
        stage: 'approval_draft',
        content: laterVersionContent,
        baseContent: null,
        note: '同时间后保存',
        source: 'human',
        client: null,
        createdAt: tied,
      }),
    ]);

    const response = await testApp.http
      .get(EXPORT_PATH(document.id))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe(
      'application/vnd.ses-package+json',
    );
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('安全规则.ses')}`,
    );
    expect(Number(response.headers['content-length'])).toBe(
      (response.body as Buffer).length,
    );
    const bytes = response.body as Buffer;
    expect(Buffer.from(bytes.toString('utf8'), 'utf8')).toEqual(bytes);

    const pack = JSON.parse(bytes.toString('utf8')) as ExportedPackage;
    expect(pack.format).toBe('ses-document-package');
    expect(pack.formatVersion).toBe(1);
    expect(pack.document).toEqual({
      uid: document.uid,
      title: '安全规则',
      meta,
      stage: 'review_draft',
      content: originalContent,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    });
    expect(pack.document.content.content?.at(-1)).toEqual(figureResource);
    expect(findNode(pack.document.content, 'figureImage')?.attrs?.src).toBe(
      findNode(originalContent, 'figureImage')?.attrs?.src,
    );
    expect(Object.keys(pack.document).sort()).toEqual(
      [
        'uid',
        'title',
        'meta',
        'stage',
        'content',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(pack).not.toHaveProperty('document.id');
    expect(pack).not.toHaveProperty('document.revision');
    expect(pack).not.toHaveProperty('document.deletedAt');
    expect(pack.versions.map((version) => version.versionNo)).toEqual([
      '1.0',
      '2.0',
      '2.1',
    ]);
    expect(pack.versions.map((version) => version.createdAt)).toEqual([
      early.toISOString(),
      tied.toISOString(),
      tied.toISOString(),
    ]);
    expect(pack.versions.map((version) => version.content)).toEqual([
      earlyVersionContent,
      versionContent,
      laterVersionContent,
    ]);
    expect(pack.versions.map((version) => version.baseContent)).toEqual([
      null,
      baseContent,
      null,
    ]);
    expect(pack.versions[1]).toMatchObject({
      uid: '10000000-0000-4000-8000-000000000009',
      versionNo: '2.0',
      baseContent,
      note: '第二版',
      source: 'ai',
      client: 'test-agent',
    });
    expect(Object.keys(pack.versions[1]).sort()).toEqual(
      [
        'uid',
        'versionNo',
        'stage',
        'content',
        'baseContent',
        'note',
        'source',
        'client',
        'createdAt',
      ].sort(),
    );
    expect(pack.versions[1]).not.toHaveProperty('id');
    expect(pack.versions[1]).not.toHaveProperty('xml');
    expect(response.headers[WARNING_COUNT_HEADER.toLowerCase()]).toBe('0');
  });

  it('reports external image URLs without changing them and tolerates arbitrary historical node shapes', async () => {
    const content = fixtureContent();
    const figureImage = findNode(content, 'figureImage');
    expect(figureImage?.attrs).toBeDefined();
    figureImage!.attrs!.src = 'https://images.example.invalid/current.png';
    const paragraph = findNode(content, 'stdParagraph');
    expect(paragraph?.content).toBeDefined();
    paragraph!.content!.push({
      type: 'inlineImage',
      attrs: {
        src: 'https://images.example.invalid/inline.png',
        resourceId: null,
        alt: '行内图',
        size: null,
      },
    });
    const savedContent = structuredClone(content);
    const document = await testApp.documents.create({
      title: '外部图片告警',
      meta: { titleCn: '外部图片告警', standardType: 'national' },
      content,
    });
    const oldVersionContent = [
      {
        type: 'image',
        attrs: { nodeId: 'legacy-image', src: 'ftp://example.invalid/old.png' },
        content: { invalidOldShape: true },
      },
      null,
      [{ type: 'unknown-array-node', attrs: [], content: 'not an array' }],
    ];
    const oldBaseContent = {
      type: 'legacy-doc',
      attrs: [],
      content: [
        null,
        {
          type: 'old-container',
          attrs: { nodeId: 'legacy-section' },
          content: [
            { type: 'inlineImage', attrs: { src: 'blob:legacy-image-id' } },
            { type: 'not-an-image', attrs: 'malformed', content: false },
          ],
        },
      ],
    };
    const versionRepo = testApp.dataSource.getRepository(VersionEntity);
    await versionRepo.save(
      versionRepo.create({
        uid: '20000000-0000-4000-8000-000000000001',
        documentId: document.id,
        versionNo: 'old-1',
        stage: 'working_draft',
        content: oldVersionContent as unknown as Record<string, unknown>,
        baseContent: oldBaseContent,
        source: 'human',
        createdAt: new Date('2019-01-01T00:00:00.000Z'),
      }),
    );

    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      const response = await testApp.http
        .get(EXPORT_PATH(document.id))
        .expect(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(response.headers[WARNING_COUNT_HEADER.toLowerCase()]).toBe('4');
      const warnings = JSON.parse(
        decodeURIComponent(response.headers[WARNINGS_HEADER.toLowerCase()]),
      ) as Array<{ code: string; nodeId?: string; message: string }>;
      expect(warnings).toEqual([
        {
          code: 'image-resource-failed',
          nodeId: 'foreword-p',
          message: EXTERNAL_IMAGE_WARNING,
        },
        {
          code: 'image-resource-failed',
          nodeId: 'fig-1',
          message: EXTERNAL_IMAGE_WARNING,
        },
        {
          code: 'image-resource-failed',
          nodeId: 'legacy-image',
          message: EXTERNAL_IMAGE_WARNING,
        },
        {
          code: 'image-resource-failed',
          nodeId: 'legacy-section',
          message: EXTERNAL_IMAGE_WARNING,
        },
      ]);
      const pack = JSON.parse(response.text) as ExportedPackage;
      expect(pack.document.content).toEqual(savedContent);
      expect(findNode(pack.document.content, 'inlineImage')?.attrs?.src).toBe(
        'https://images.example.invalid/inline.png',
      );
      expect(findNode(pack.document.content, 'figureImage')?.attrs?.src).toBe(
        'https://images.example.invalid/current.png',
      );
      expect(pack.versions[0].content).toEqual(oldVersionContent);
      expect(pack.versions[0].baseContent).toEqual(oldBaseContent);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  describe('versions query parameter', () => {
    async function createWithVersions(
      title: string,
      content = fixtureContent(),
    ) {
      const document = await testApp.documents.create({
        title,
        meta: { titleCn: title, standardType: 'national' },
        content,
      });
      const versionRepo = testApp.dataSource.getRepository(VersionEntity);
      await versionRepo.save([
        versionRepo.create({
          uid: '30000000-0000-4000-8000-000000000001',
          documentId: document.id,
          versionNo: '1.0',
          stage: 'working_draft',
          content: fixtureContent(),
          baseContent: null,
          source: 'human',
          createdAt: new Date('2021-01-01T00:00:00.000Z'),
        }),
        versionRepo.create({
          uid: '30000000-0000-4000-8000-000000000002',
          documentId: document.id,
          versionNo: '2.0',
          stage: 'working_draft',
          content: fixtureContent(),
          baseContent: fixtureContent(),
          source: 'ai',
          createdAt: new Date('2021-02-01T00:00:00.000Z'),
        }),
      ]);
      return document;
    }

    it('defaults to every version and marks versionScope all', async () => {
      const document = await createWithVersions('默认范围');
      const implicit = await testApp.http
        .get(EXPORT_PATH(document.id))
        .expect(200);
      const explicit = await testApp.http
        .get(`${EXPORT_PATH(document.id)}?versions=all`)
        .expect(200);
      for (const response of [implicit, explicit]) {
        const pack = JSON.parse(response.text) as ExportedPackage;
        expect(pack.versionScope).toBe('all');
        expect(pack.versions.map((version) => version.versionNo)).toEqual([
          '1.0',
          '2.0',
        ]);
        expect(response.headers['content-disposition']).toBe(
          `attachment; filename*=UTF-8''${encodeURIComponent('默认范围.ses')}`,
        );
      }
    });

    it('versions=none exports only the current content with versionScope latest and no version query', async () => {
      const content = fixtureContent();
      const document = await createWithVersions('仅最新稿', content);
      const versionRepo = testApp.dataSource.getRepository(VersionEntity);
      const findSpy = jest.spyOn(versionRepo, 'find');
      const builderSpy = jest.spyOn(versionRepo, 'createQueryBuilder');

      const response = await testApp.http
        .get(`${EXPORT_PATH(document.id)}?versions=none`)
        .expect(200);
      expect(builderSpy).not.toHaveBeenCalled();
      expect(findSpy).not.toHaveBeenCalled();
      builderSpy.mockRestore();
      findSpy.mockRestore();

      const pack = JSON.parse(response.text) as ExportedPackage;
      expect(pack.versionScope).toBe('latest');
      expect(pack.versions).toEqual([]);
      expect(pack.document.content).toEqual(content);
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename*=UTF-8''${encodeURIComponent('仅最新稿（最新稿）.ses')}`,
      );
      expect(parseSesPackage(response.text).versionScope).toBe('latest');
    });

    it.each(['', 'ALL', 'latest', 'true'])(
      'rejects versions=%p with a Chinese 400 message',
      async (value) => {
        const document = await createWithVersions(`非法参数${value}`);
        const response = await testApp.http
          .get(`${EXPORT_PATH(document.id)}?versions=${value}`)
          .expect(400);
        expect((response.body as { message: string }).message).toBe(
          'versions 必须是 all 或 none',
        );
      },
    );

    it('rejects a repeated versions parameter', async () => {
      const document = await createWithVersions('重复参数');
      await testApp.http
        .get(`${EXPORT_PATH(document.id)}?versions=all&versions=none`)
        .expect(400);
    });

    it('versions=none only warns about external images in the current content', async () => {
      const document = await createWithVersions('告警范围');
      const versionRepo = testApp.dataSource.getRepository(VersionEntity);
      const external = fixtureContent();
      const figureImage = findNode(external, 'figureImage');
      figureImage!.attrs!.src = 'https://images.example.invalid/old.png';
      await versionRepo.save(
        versionRepo.create({
          uid: '30000000-0000-4000-8000-000000000003',
          documentId: document.id,
          versionNo: '3.0',
          stage: 'working_draft',
          content: external,
          baseContent: structuredClone(external),
          source: 'human',
          createdAt: new Date('2021-03-01T00:00:00.000Z'),
        }),
      );

      const all = await testApp.http.get(EXPORT_PATH(document.id)).expect(200);
      expect(all.headers[WARNING_COUNT_HEADER.toLowerCase()]).toBe('2');
      const none = await testApp.http
        .get(`${EXPORT_PATH(document.id)}?versions=none`)
        .expect(200);
      expect(none.headers[WARNING_COUNT_HEADER.toLowerCase()]).toBe('0');
    });
  });

  it('returns 422 with a clear message for a document whose content was never written', async () => {
    const document = await testApp.documents.create({
      title: '空正文',
      meta: { titleCn: '空正文', standardType: 'national' },
      stage: 'working_draft',
    });

    const response = await testApp.http
      .get(EXPORT_PATH(document.id))
      .expect(422);
    expect((response.body as { message: string }).message).toBe(
      '文档内容为空，无法导出 SES 文档包；请先在编辑器中打开该文档并保存正文',
    );
  });

  it('returns 404 for missing documents and documents in the trash', async () => {
    await testApp.http.get(EXPORT_PATH(999999)).expect(404);
    const document = await testApp.documents.create({
      title: '回收站文档',
      meta: { titleCn: '回收站文档', standardType: 'national' },
      content: fixtureContent(),
    });
    await testApp.documents.remove(document.id);
    await testApp.http.get(EXPORT_PATH(document.id)).expect(404);
  });
});
