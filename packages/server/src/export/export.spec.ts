import { readFileSync } from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDocx, DOCX_MIME_TYPE, synchronizeCoverMetadata } from '@ses/io';
import type { DocumentMeta, PMJsonNode } from '@ses/shared';
import request from 'supertest';
import { DocumentEntity } from '../document/document.entity';
import { DocumentModule } from '../document/document.module';
import { VersionEntity } from '../version/version.entity';
import { readZipEntries } from './__fixtures__/read-zip';
import {
  WARNING_COUNT_HEADER,
  WARNINGS_HEADER,
  WARNINGS_TRUNCATED_HEADER,
  type ExportWarning,
} from './export-http';
import { ExportModule } from './export.module';

/**
 * 夹具 standard-document.json：由 irToPm 生成，经 client 生产 schema（getSchema(createEditorExtensions())）
 * 的 nodeFromJSON().check() 校验并用 toJSON() 规范化，即编辑器 getJSON() 的形态。内容含 3 个公式
 * （\dfrac、求和+根号、含 \vdots 的列向量）、1 张 data URL PNG、1 个表格、1 个条文脚注；封面的标准
 * 编号等字段故意与下面的文档库 meta 不一致，用来证明导出前做了封面同步。
 * \vdots 选自 KaTeX 0.16.11 与 0.16.44 输出不同 MathML（进而不同 OMML）的写法：在打包产物上做
 * 端到端比对时，只有 io 用的是 0.16.44，字节才会与编辑器一致（jest 下按 Node 解析，io 天然取自己的版本）。
 *
 * 本文件含公式的用例依赖 mathml2omml（ESM-only）的动态导入，jest 必须以 --experimental-vm-modules
 * 运行（见 package.json 的 test 脚本）；缺少该标志时公式会静默降级为 LaTeX 文本，
 * 因此下面的用例显式断言 DOCX 中存在 OMML，不让降级悄悄通过。
 */
const fixtureContent = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__', 'standard-document.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const fixtureMeta = {
  standardNo: 'GB/T 46687.3—2026',
  icsCode: '01.120',
  ccsCode: 'A 00',
  titleCn: '标准机器语言表达',
  titleEn: 'Machine-readable representation of standards',
  standardType: 'national',
  issuer: '国家市场监督管理总局',
  publishDate: '2026-06-01',
  implementDate: '2026-12-01',
  proposer: '提出单位',
  technicalCommittee: '归口单位',
};

const CREATED_AT = '2026-01-01T00:00:00Z';
const EXPORT_PATH = (id: number | string) => `/api/documents/${id}/export/docx`;

interface ErrorBody {
  statusCode: number;
  message: string;
  detail?: string;
  source?: string;
  problems?: { source: string; code: string; message: string }[];
}

interface Download {
  status: number;
  headers: Record<string, string>;
  /** 响应原始字节（成功时为 DOCX，失败时为 JSON 文本）。 */
  bytes: Buffer;
}

const text = (value: string): PMJsonNode => ({ type: 'text', text: value });

/** 单章文档，children 放在章标题之后。 */
function chapterDoc(...children: PMJsonNode[]): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      {
        type: 'chapter',
        attrs: { nodeId: 'chapter-1' },
        content: [
          { type: 'chapterTitle', content: [text('范围')] },
          ...children,
        ],
      },
    ],
  };
}

function figure(nodeId: string, src: string): PMJsonNode {
  return {
    type: 'figure',
    attrs: { nodeId },
    content: [
      { type: 'figureImage', attrs: { src } },
      { type: 'figureCaption', content: [text('示意图')] },
    ],
  };
}

/** 一张只有一个单元格的表；refs 为单元格内的表脚注引用，definitions 为表脚注定义 id。 */
function footnoteTable(
  nodeId: string,
  refs: string[],
  definitions: string[],
): PMJsonNode {
  const content: PMJsonNode[] = [
    { type: 'tableCaption', content: [text('尺寸表')] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1 },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    text('尺寸'),
                    ...refs.map(
                      (targetId): PMJsonNode => ({
                        type: 'tableFootnoteRef',
                        attrs: { targetId },
                      }),
                    ),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  if (definitions.length) {
    content.push({
      type: 'tableFootnoteRow',
      content: definitions.map(
        (id): PMJsonNode => ({
          type: 'tableFootnoteEntry',
          attrs: { nodeId: id },
          content: [text(`${id}的说明`)],
        }),
      ),
    });
  }
  return { type: 'stdTable', attrs: { nodeId }, content };
}

/** 输出边界检查会拦下 DOCX 的内容：同一段文字同时带上下标（来自 io 的 exportGuard 测试）。 */
const subSupParagraph = (): PMJsonNode => ({
  type: 'stdParagraph',
  attrs: { nodeId: 'p1' },
  content: [
    {
      type: 'text',
      text: 'H2O',
      marks: [{ type: 'subscript' }, { type: 'superscript' }],
    },
  ],
});

/** 旧版 standardDoc 根，与 io 的 exportGuard.test 同形。 */
function standardDoc(...children: PMJsonNode[]): Record<string, unknown> {
  return {
    type: 'standardDoc',
    attrs: { standardType: 'national' },
    content: [
      {
        type: 'chapter',
        attrs: { nodeId: 'chapter-1' },
        content: [
          { type: 'chapterTitle', content: [text('范围')] },
          ...children,
        ],
      },
    ],
  };
}

describe('GET /api/documents/:id/export/docx', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // 内存 SQLite：不触碰 data/ses.db。
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [DocumentEntity, VersionEntity],
          synchronize: true,
        }),
        DocumentModule,
        ExportModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    http = request(await app.getUrl());
  });
  afterAll(async () => {
    await app.close();
  });

  async function createDoc(
    overrides: {
      title?: string;
      meta?: Record<string, unknown>;
      stage?: string;
      content?: Record<string, unknown> | null;
    } = {},
  ): Promise<number> {
    const res = await http
      .post('/api/documents')
      .send({
        title: '测试标准',
        meta: fixtureMeta,
        stage: 'working_draft',
        content: fixtureContent,
        ...overrides,
      })
      .expect(201);
    return (res.body as { id: number }).id;
  }

  /** 以二进制取回响应体（DOCX 不能按文本解析）。 */
  async function download(path: string): Promise<Download> {
    const res = await http
      .get(path)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return {
      status: res.status,
      headers: res.headers as Record<string, string>,
      bytes: res.body as Buffer,
    };
  }

  const errorBody = (download: Download) =>
    JSON.parse(download.bytes.toString('utf8')) as ErrorBody;

  const warningsOf = (download: Download): ExportWarning[] => {
    const header = download.headers[WARNINGS_HEADER.toLowerCase()];
    return header
      ? (JSON.parse(decodeURIComponent(header)) as ExportWarning[])
      : [];
  };

  const part = (download: Download, name: string): string => {
    const entry = readZipEntries(download.bytes).get(name);
    if (!entry) throw new Error(`DOCX 中没有部件 ${name}`);
    return entry.toString('utf8');
  };

  describe('错误响应', () => {
    it('文档不存在返回 404', async () => {
      const res = await download(EXPORT_PATH(987654));
      expect(res.status).toBe(404);
    });

    it('id 不是整数返回 400', async () => {
      expect((await download(EXPORT_PATH('abc'))).status).toBe(400);
    });

    it('内容为空返回 422 与中文说明（null、空对象、无顶层节点）', async () => {
      for (const content of [
        null,
        {},
        { type: 'doc' },
        { type: 'doc', content: [] },
      ]) {
        const id = await createDoc({ content });
        const res = await download(EXPORT_PATH(id));
        expect(res.status).toBe(422);
        const body = errorBody(res);
        expect(body.statusCode).toBe(422);
        expect(body.message).toContain('文档内容为空');
      }
    });

    it('库中内容结构损坏（节点为 null）返回 422，而不是 500', async () => {
      const id = await createDoc({
        content: { type: 'doc', content: [null] } as never,
      });
      const res = await download(EXPORT_PATH(id));
      expect(res.status).toBe(422);
      expect(errorBody(res).message).toContain('文档内容结构无法解析');
    });

    it('脚注校验未通过返回 422，含 message、detail、problems', async () => {
      const id = await createDoc({
        content: standardDoc(footnoteTable('t1', ['missing'], [])),
      });
      const res = await download(EXPORT_PATH(id));
      expect(res.status).toBe(422);
      const body = errorBody(res);
      expect(body.source).toBe('footnote');
      expect(body.message).toContain('脚注校验未通过，暂不能导出');
      expect(body.detail).toBe(body.message);
      expect(body.problems?.map((p) => p.code)).toEqual(['dangling-footnote']);
      expect(body.problems?.[0].source).toBe('footnote');
    });

    it('脚注定义未被引用同样返回 422', async () => {
      const id = await createDoc({
        content: standardDoc(footnoteTable('t1', [], ['unused'])),
      });
      const body = errorBody(await download(EXPORT_PATH(id)));
      expect(body.source).toBe('footnote');
      expect(body.problems?.map((p) => p.code)).toEqual([
        'unreferenced-footnote',
      ]);
    });

    it('输出边界问题返回 422，含 detail 与带位置的 problems', async () => {
      const id = await createDoc({
        content: standardDoc(subSupParagraph()),
      });
      const res = await download(EXPORT_PATH(id));
      expect(res.status).toBe(422);
      const body = errorBody(res);
      expect(body.source).toBe('output-boundary');
      expect(body.message).toContain('导出被阻止');
      expect(body.detail).toContain('导出被阻止');
      expect(body.problems?.length).toBeGreaterThan(0);
      expect(body.problems?.[0]).toMatchObject({
        source: 'output-boundary',
        code: 'unsupported-output',
      });
    });

    it('脚注错误优先于输出边界问题（与编辑器一致）', async () => {
      const id = await createDoc({
        content: standardDoc(
          footnoteTable('t1', ['missing'], []),
          subSupParagraph(),
        ),
      });
      expect(errorBody(await download(EXPORT_PATH(id))).source).toBe(
        'footnote',
      );
    });

    it('createdAt 非法返回 400（先于读取文档，不存在的 id 也是 400）', async () => {
      const id = await createDoc();
      for (const value of [
        'yesterday',
        '2026-01-01',
        '2026-01-01T00:00:00',
        '2026-02-30T00:00:00Z',
        '',
      ]) {
        const res = await download(
          `${EXPORT_PATH(id)}?createdAt=${encodeURIComponent(value)}`,
        );
        expect(res.status).toBe(400);
        expect(errorBody(res).message).toContain('createdAt');
      }
      // 重复参数得到数组。
      expect(
        (
          await download(
            `${EXPORT_PATH(id)}?createdAt=${CREATED_AT}&createdAt=${CREATED_AT}`,
          )
        ).status,
      ).toBe(400);
      expect(
        (await download(`${EXPORT_PATH(987654)}?createdAt=yesterday`)).status,
      ).toBe(400);
    });
  });

  describe('成功导出', () => {
    it('响应头：DOCX MIME、attachment 与 UTF-8 文件名、告警条数', async () => {
      const id = await createDoc();
      const res = await download(`${EXPORT_PATH(id)}?createdAt=${CREATED_AT}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(DOCX_MIME_TYPE);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename*=UTF-8''${encodeURIComponent('标准机器语言表达.docx')}`,
      );
      expect(res.headers['content-length']).toBe(String(res.bytes.length));
      expect(res.headers[WARNING_COUNT_HEADER.toLowerCase()]).toMatch(/^\d+$/);

      // 是合法的 DOCX 包：ZIP 魔数 + 主要部件。
      expect(res.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
      const entries = readZipEntries(res.bytes);
      expect(entries.has('[Content_Types].xml')).toBe(true);
      expect(entries.has('word/document.xml')).toBe(true);
    });

    it('文件内容：公式为 OMML、data URL 图片落为媒体部件、封面按 meta 同步、无告警混入文件', async () => {
      const id = await createDoc();
      const res = await download(`${EXPORT_PATH(id)}?createdAt=${CREATED_AT}`);
      const documentXml = part(res, 'word/document.xml');
      // 3 个公式都转成了 OMML。缺 --experimental-vm-modules 时 import('mathml2omml') 失败，
      // io 会把公式降级为 LaTeX 文本并只记告警；这里显式失败，并指明原因。
      const ommlCount = documentXml.match(/<m:oMath\b/g)?.length ?? 0;
      if (ommlCount < 3) {
        const reasons = warningsOf(res)
          .filter((w) => w.code === 'formula-conversion-failed')
          .map((w) => w.message);
        throw new Error(
          `公式未转换为 OMML（${ommlCount}/3）。请用 pnpm test 运行（需要 node --experimental-vm-modules，` +
            `mathml2omml 是 ESM-only）。告警：${reasons.join('；')}`,
        );
      }
      expect(
        [...readZipEntries(res.bytes).keys()].some((name) =>
          name.startsWith('word/media/'),
        ),
      ).toBe(true);
      // 封面用文档库 meta 的标准编号，而不是夹具里过期的值。
      expect(documentXml).toContain('GB/T 46687.3');
      expect(documentXml).not.toContain('GB/T 00000');
      expect(part(res, 'docProps/core.xml')).toContain(CREATED_AT);

      const codes = warningsOf(res).map((w) => w.code);
      expect(codes).not.toContain('formula-conversion-failed');
      expect(codes).not.toContain('image-resource-failed');
      expect(
        res.headers[WARNINGS_TRUNCATED_HEADER.toLowerCase()],
      ).toBeUndefined();
      expect(warningsOf(res)).toHaveLength(
        Number(res.headers[WARNING_COUNT_HEADER.toLowerCase()]),
      );
    });

    it('指定 createdAt 时结果可复现；缺省时取当前时间', async () => {
      const id = await createDoc();
      const first = await download(
        `${EXPORT_PATH(id)}?createdAt=${CREATED_AT}`,
      );
      const second = await download(
        `${EXPORT_PATH(id)}?createdAt=${CREATED_AT}`,
      );
      expect(first.bytes.equals(second.bytes)).toBe(true);

      const other = await download(
        `${EXPORT_PATH(id)}?createdAt=${encodeURIComponent('2026-02-03T04:05:06+08:00')}`,
      );
      expect(part(other, 'docProps/core.xml')).toContain(
        '2026-02-03T04:05:06+08:00',
      );
      expect(other.bytes.equals(first.bytes)).toBe(false);

      const before = Date.now();
      const now = await download(EXPORT_PATH(id));
      const after = Date.now();
      const created = /<dcterms:created[^>]*>([^<]+)</.exec(
        part(now, 'docProps/core.xml'),
      )?.[1];
      // core.xml 的时间精确到秒。
      expect(Date.parse(created ?? '')).toBeGreaterThanOrEqual(
        Math.floor(before / 1000) * 1000,
      );
      expect(Date.parse(created ?? '')).toBeLessThanOrEqual(after);
    });

    it('文件名：titleCn 为空或全空白用「标准文件」，特殊字符按 RFC 5987 转义', async () => {
      const blank = await download(
        EXPORT_PATH(
          await createDoc({ meta: { ...fixtureMeta, titleCn: '  ' } }),
        ),
      );
      expect(blank.headers['content-disposition']).toBe(
        `attachment; filename*=UTF-8''${encodeURIComponent('标准文件.docx')}`,
      );
      const special = await download(
        EXPORT_PATH(
          await createDoc({ meta: { ...fixtureMeta, titleCn: "A(1)'*!/" } }),
        ),
      );
      expect(special.headers['content-disposition']).toBe(
        "attachment; filename*=UTF-8''A%281%29%27%2A%21%2F.docx",
      );
    });
  });

  describe('与 @ses/io 直接导出一致', () => {
    it('同一份 content/meta/stage/createdAt，接口字节与先同步封面再 buildDocx 完全相同', async () => {
      for (const stage of ['working_draft', 'approval_draft']) {
        const id = await createDoc({ stage });
        const res = await download(
          `${EXPORT_PATH(id)}?createdAt=${CREATED_AT}`,
        );
        expect(res.status).toBe(200);

        const expected = await buildDocx({
          pmDoc: synchronizeCoverMetadata(
            fixtureContent,
            fixtureMeta as unknown as DocumentMeta,
          ) as unknown as PMJsonNode,
          documentMeta: fixtureMeta as unknown as DocumentMeta,
          stage,
          createdAt: CREATED_AT,
        });
        expect(res.bytes.equals(Buffer.from(expected.bytes))).toBe(true);
        // 告警也与直接调用一致（条数不多，不会被截断）。
        expect(warningsOf(res)).toEqual(expected.warnings);
      }
    });

    it('阶段确实参与导出（不同 stage 的字节不同），一致性用例不是空转', async () => {
      const draft = await download(
        `${EXPORT_PATH(await createDoc({ stage: 'working_draft' }))}?createdAt=${CREATED_AT}`,
      );
      const approval = await download(
        `${EXPORT_PATH(await createDoc({ stage: 'approval_draft' }))}?createdAt=${CREATED_AT}`,
      );
      expect(draft.bytes.equals(approval.bytes)).toBe(false);
    });
  });

  describe('不发起网络请求（防 SSRF）', () => {
    let sink: Server;
    let sinkPort: number;
    let connections: number;
    let requests: string[];

    beforeAll(async () => {
      sink = createServer((req, res) => {
        requests.push(req.url ?? '');
        res.end();
      });
      sink.on('connection', () => {
        connections += 1;
      });
      await new Promise<void>((resolve) =>
        sink.listen(0, '127.0.0.1', resolve),
      );
      sinkPort = (sink.address() as AddressInfo).port;
    });
    beforeEach(() => {
      connections = 0;
      requests = [];
    });
    afterAll(async () => {
      await new Promise((resolve) => sink.close(resolve));
    });

    it('http(s)、协议相对、相对路径、自定义 scheme 的图片都不会被抓取，只产生 image-resource-failed 告警', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      try {
        const sources = [
          `http://127.0.0.1:${sinkPort}/a.png`,
          `https://127.0.0.1:${sinkPort}/b.png`,
          `//127.0.0.1:${sinkPort}/c.png`,
          '/relative/d.png',
          'asset:abc',
        ];
        const id = await createDoc({
          content: chapterDoc(
            ...sources.map((src, i) => figure(`fig-${i}`, src)),
          ),
        });
        const res = await download(
          `${EXPORT_PATH(id)}?createdAt=${CREATED_AT}`,
        );

        // 导出照常完成，而不是失败。
        expect(res.status).toBe(200);
        expect(readZipEntries(res.bytes).has('word/document.xml')).toBe(true);
        const failed = warningsOf(res).filter(
          (w) => w.code === 'image-resource-failed',
        );
        expect(failed.map((w) => w.nodeId)).toEqual(
          sources.map((_, i) => `fig-${i}`),
        );
        expect(failed[0].message).toContain('不访问网络资源');
        expect(failed[4].message).toContain('resource key'); // 无解析器的 key
        // 缺图在 DOCX 里由渲染器另有 image-missing 告警。
        expect(warningsOf(res).map((w) => w.code)).toContain('image-missing');

        // 没有任何出站请求：全局 fetch 未被调用，本地监听端口没有收到连接。
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(connections).toBe(0);
        expect(requests).toEqual([]);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('data URL 图片不受影响（本地解码）', async () => {
      const id = await createDoc();
      const res = await download(`${EXPORT_PATH(id)}?createdAt=${CREATED_AT}`);
      expect(warningsOf(res).map((w) => w.code)).not.toContain(
        'image-resource-failed',
      );
      expect(connections).toBe(0);
    });

    it('告警很多时响应头截断并标明，文件本身不受影响', async () => {
      const id = await createDoc({
        content: chapterDoc(
          ...Array.from({ length: 150 }, (_, i) =>
            figure(`fig-${i}`, `http://127.0.0.1:${sinkPort}/${i}.png`),
          ),
        ),
      });
      const res = await download(`${EXPORT_PATH(id)}?createdAt=${CREATED_AT}`);
      expect(res.status).toBe(200);
      const total = Number(res.headers[WARNING_COUNT_HEADER.toLowerCase()]);
      expect(total).toBeGreaterThanOrEqual(150);
      expect(res.headers[WARNINGS_TRUNCATED_HEADER.toLowerCase()]).toBe('true');
      expect(
        res.headers[WARNINGS_HEADER.toLowerCase()].length,
      ).toBeLessThanOrEqual(4096);
      expect(warningsOf(res).length).toBeLessThan(total);
      expect(connections).toBe(0);
    });
  });
});
