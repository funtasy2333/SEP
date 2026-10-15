import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { DocumentEntity } from '../document/document.entity';
import { DocumentModule } from '../document/document.module';
import { VersionEntity } from './version.entity';
import { VersionModule } from './version.module';
import { MAX_CLIENT_LENGTH, nextVersionNo } from './version.service';

interface VersionBody {
  id: number;
  source: string;
  client: string | null;
}

/** supertest 的 res.body 是 any：断言状态码后按预期形状收窄。 */
async function reply<T>(test: request.Test, status: number): Promise<T> {
  const res = await test.expect(status);
  return res.body as T;
}

describe('版本来源字段', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let documentId: number;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [DocumentEntity, VersionEntity],
          synchronize: true,
        }),
        DocumentModule,
        VersionModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    http = request(await app.getUrl());

    const doc = await reply<{ id: number }>(
      http.post('/api/documents').send({
        title: '版本测试',
        meta: { titleCn: '版本测试', standardType: 'national' },
        content: { type: 'doc', content: [] },
      }),
      201,
    );
    documentId = doc.id;
  });
  afterEach(async () => {
    await app.close();
  });

  const versionBody = (extra: Record<string, unknown> = {}) => ({
    documentId,
    versionNo: '1.0',
    stage: 'working_draft',
    content: { type: 'doc', content: [] },
    ...extra,
  });

  it('不传 source / client 时默认为 human 与 null', async () => {
    const created = await reply<VersionBody>(
      http.post('/api/versions').send(versionBody()),
      201,
    );
    expect(created.source).toBe('human');
    expect(created.client).toBeNull();

    const one = await reply<VersionBody>(
      http.get(`/api/versions/${created.id}`),
      200,
    );
    expect(one.source).toBe('human');
    expect(one.client).toBeNull();
  });

  it.each(['human', 'ai', 'import'])(
    '接受 source=%s 并随版本读回',
    async (source) => {
      const created = await reply<VersionBody>(
        http
          .post('/api/versions')
          .send(versionBody({ source, client: 'claude-code' })),
        201,
      );
      expect(created).toMatchObject({ source, client: 'claude-code' });

      const list = await reply<VersionBody[]>(
        http.get(`/api/versions/document/${documentId}`),
        200,
      );
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ source, client: 'claude-code' });
    },
  );

  it('非法 source 或 client 返回 400，且不创建版本', async () => {
    for (const source of ['AI', 'robot', '', 1, null, ['ai']]) {
      await http
        .post('/api/versions')
        .send(versionBody({ source }))
        .expect(400);
    }
    await http
      .post('/api/versions')
      .send(versionBody({ client: { name: 'x' } }))
      .expect(400);
    await http
      .post('/api/versions')
      .send(versionBody({ client: 'x'.repeat(201) }))
      .expect(400);

    const list = await reply<VersionBody[]>(
      http.get(`/api/versions/document/${documentId}`),
      200,
    );
    expect(list).toEqual([]);
  });
});

describe('nextVersionNo（与 client 的 getNextVersionNo 同一规则）', () => {
  it('还没有版本时为 1.0', () => {
    expect(nextVersionNo(undefined)).toBe('1.0');
  });

  it('取最新一条的 major.minor，minor 加 1（按数值，不按字符串）', () => {
    expect(nextVersionNo('1.0')).toBe('1.1');
    expect(nextVersionNo('1.9')).toBe('1.10');
    expect(nextVersionNo('2.15')).toBe('2.16');
    expect(nextVersionNo('3.4')).toBe('3.5');
  });

  it('不规范的版本号与 client 的容错一致：major 取不到按 1，minor 取不到按 0', () => {
    expect(nextVersionNo('3')).toBe('3.1');
    expect(nextVersionNo('v2.3')).toBe('1.4');
    expect(nextVersionNo('abc')).toBe('1.1');
    expect(nextVersionNo('0.5')).toBe('1.6');
    expect(nextVersionNo('2.x')).toBe('2.1');
    // 多余的段被忽略。
    expect(nextVersionNo('1.2.3')).toBe('1.3');
  });

  it('client 长度上限为 200（operations 接口沿用）', () => {
    expect(MAX_CLIENT_LENGTH).toBe(200);
  });
});
