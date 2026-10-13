import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  buildPdfExportRequest,
  exportSemanticHtml,
  exportSemanticJson,
  synchronizeCoverMetadata,
} from '@ses/io';
import {
  irMetaFromDocumentMeta,
  type DocumentMeta,
  type PMJsonNode,
} from '@ses/shared';
import request from 'supertest';
import { ConvertService } from '../convert/convert.service';
import { DocumentEntity } from '../document/document.entity';
import { DocumentModule } from '../document/document.module';
import { VersionEntity } from '../version/version.entity';
import {
  CONTENT_DISPOSITION_MAX_LENGTH,
  WARNING_COUNT_HEADER,
  WARNINGS_HEADER,
  type ExportWarning,
} from './export-http';
import { EXTERNAL_IMAGE_REJECTED_MESSAGE } from './external-images';
import { ExportModule } from './export.module';

/**
 * PDF / HTML / 语义 JSON 导出接口。夹具与 export.spec.ts 的 DOCX 用例相同（standard-document.json，
 * 编辑器 getJSON() 形态；封面的标准编号等字段故意与文档库 meta 不一致，用来证明导出前做了封面同步），
 * 另在其上补引言、附录、参考文献，并让标题带上 & < > " 等需要转义的字符。
 *
 * PDF 管线（vivliostyle + poppler）在这里用桩替换：接口的职责是按编辑器同样的方式构建请求并交给管线，
 * 管线本身由 convert 模块的测试与打包产物上的端到端比对覆盖。
 */
const fixtureContent = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__', 'standard-document.json'),
    'utf8',
  ),
) as { type: string; content: PMJsonNode[] } & Record<string, unknown>;

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

const text = (value: string): PMJsonNode => ({ type: 'text', text: value });
const paragraph = (nodeId: string, value: string): PMJsonNode => ({
  type: 'stdParagraph',
  attrs: { nodeId },
  content: [text(value)],
});

/** 夹具 + 引言 + 两个附录 + 参考文献；附录与参考文献标题含需转义的字符。 */
function richContent(): Record<string, unknown> {
  const head = fixtureContent.content.filter((node) => node.type !== 'chapter');
  const chapters = fixtureContent.content.filter(
    (node) => node.type === 'chapter',
  );
  const appendix = (
    nodeId: string,
    normative: boolean,
    title: string,
  ): PMJsonNode => ({
    type: 'appendix',
    attrs: { nodeId, normative },
    content: [
      {
        type: 'appendixLabel',
        content: [text(normative ? '（规范性）' : '（资料性）')],
      },
      { type: 'appendixTitle', content: [text(title)] },
      paragraph(`${nodeId}-p`, '附录正文'),
    ],
  });
  return {
    ...fixtureContent,
    content: [
      ...head,
      {
        type: 'introduction',
        attrs: { nodeId: 'intro' },
        content: [paragraph('intro-p', '引言正文')],
      },
      ...chapters,
      appendix('app-a', true, '附 <录> & "甲"'),
      appendix('app-b', false, '&amp; 乙'),
      {
        type: 'bibliography',
        content: [
          { type: 'bibliographyTitle', content: [text('参考文献')] },
          {
            type: 'bibEntry',
            attrs: { nodeId: 'bib-1' },
            content: [text('GB/T 1—2020 "标准" & <说明>')],
          },
        ],
      },
    ],
  };
}

/** 单元格里只有一段文字的表；footnoteRef 为单元格内的表脚注引用目标（可指向不存在的定义）。 */
function table(nodeId: string, footnoteRef?: string): PMJsonNode {
  return {
    type: 'stdTable',
    attrs: { nodeId },
    content: [
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
                      ...(footnoteRef === undefined
                        ? []
                        : [
                            {
                              type: 'tableFootnoteRef',
                              attrs: { targetId: footnoteRef },
                            },
                          ]),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** 表脚注引用指向不存在的定义：脚注校验会拦下 HTML/PDF（json 不检查）。 */
function danglingFootnoteDoc(): Record<string, unknown> {
  return chapterOnlyDoc(table('t1', 'missing'));
}

/**
 * 把表当作条来引用（refType 为 clause 而目标是表）：输出边界检查拦下 HTML/PDF，
 * 语义 JSON 不检查、保留原稿。
 */
function wrongTypeReferenceDoc(): Record<string, unknown> {
  return chapterOnlyDoc(
    {
      type: 'stdParagraph',
      attrs: { nodeId: 'p1' },
      content: [
        text('见'),
        {
          type: 'text',
          text: '表1',
          marks: [
            { type: 'crossRef', attrs: { refId: 't1', refType: 'clause' } },
          ],
        },
      ],
    },
    table('t1'),
  );
}

function chapterOnlyDoc(...children: PMJsonNode[]): Record<string, unknown> {
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

interface ErrorBody {
  statusCode: number;
  message: string;
  detail?: string;
  source?: string;
  problems?: { source: string; code: string; message: string }[];
  missingDependencies?: string[];
}

interface Download {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
}

type Format = 'pdf' | 'html' | 'json';
const EXPORT_PATH = (id: number | string, format: Format) =>
  `/api/documents/${id}/export/${format}`;
const disposition = (filename: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
const PDF_BYTES = Buffer.from('%PDF-1.7\n% 测试桩生成，不是真实 PDF\n', 'utf8');

describe('GET /api/documents/:id/export/{pdf,html,json}', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  /** 桩的当前状态；每个用例开始前复位。 */
  const stubState = { htmlToPdf: true, missing: [] as string[] };
  /** 替换 ConvertService：不依赖本机是否装有 vivliostyle/poppler，并可记录管线调用。 */
  const convertStub = {
    getCapabilities: jest.fn(() => ({ htmlToPdf: stubState.htmlToPdf })),
    getHtmlPdfMissingDependencies: jest.fn(() => stubState.missing),
    convertHtmlToPdf: jest.fn<Promise<Buffer>, [unknown]>(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [DocumentEntity, VersionEntity],
          synchronize: true,
        }),
        DocumentModule,
        ExportModule,
      ],
    })
      .overrideProvider(ConvertService)
      .useValue(convertStub)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    http = request(await app.getUrl());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    stubState.htmlToPdf = true;
    stubState.missing = [];
    convertStub.getCapabilities.mockClear();
    convertStub.getHtmlPdfMissingDependencies.mockClear();
    convertStub.convertHtmlToPdf.mockReset();
    convertStub.convertHtmlToPdf.mockResolvedValue(PDF_BYTES);
  });

  async function createDoc(
    overrides: {
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
        content: richContent(),
        ...overrides,
      })
      .expect(201);
    return (res.body as { id: number }).id;
  }

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

  const errorBody = (result: Download) =>
    JSON.parse(result.bytes.toString('utf8')) as ErrorBody;

  /** 编辑器在导出前对文档做的封面同步（接口应当对同一份库内容做同样的事）。 */
  const synchronized = (
    content: Record<string, unknown> = richContent(),
    meta: Record<string, unknown> = fixtureMeta,
  ): PMJsonNode =>
    synchronizeCoverMetadata(
      content,
      meta as unknown as DocumentMeta,
    ) as unknown as PMJsonNode;

  describe.each<Format>(['pdf', 'html', 'json'])('%s：错误响应', (format) => {
    it('文档不存在返回 404', async () => {
      expect((await download(EXPORT_PATH(987654, format))).status).toBe(404);
    });

    it('id 不是整数返回 400', async () => {
      expect((await download(EXPORT_PATH('abc', format))).status).toBe(400);
    });

    it('内容为空返回 422 与中文说明（null、空对象、无顶层节点）', async () => {
      for (const content of [
        null,
        {},
        { type: 'doc' },
        { type: 'doc', content: [] },
      ]) {
        const id = await createDoc({ content });
        const res = await download(EXPORT_PATH(id, format));
        expect(res.status).toBe(422);
        const body = errorBody(res);
        expect(body.statusCode).toBe(422);
        expect(body.message).toContain('文档内容为空');
        expect(body.message).toContain(format.toUpperCase());
      }
      expect(convertStub.convertHtmlToPdf).not.toHaveBeenCalled();
    });

    it('库中内容结构损坏（节点为 null）返回 422，而不是 500', async () => {
      const id = await createDoc({
        content: { type: 'doc', content: [null] } as never,
      });
      const res = await download(EXPORT_PATH(id, format));
      expect(res.status).toBe(422);
      expect(errorBody(res).message).toContain('文档内容结构无法解析');
      expect(convertStub.convertHtmlToPdf).not.toHaveBeenCalled();
    });
  });

  describe.each<Format>(['pdf', 'html'])('%s：导出前检查', (format) => {
    it('脚注校验未通过返回 422，含 message、detail、problems', async () => {
      const id = await createDoc({ content: danglingFootnoteDoc() });
      const res = await download(EXPORT_PATH(id, format));
      expect(res.status).toBe(422);
      const body = errorBody(res);
      expect(body.source).toBe('footnote');
      expect(body.message).toContain('脚注校验未通过，暂不能导出');
      expect(body.detail).toBe(body.message);
      expect(body.problems?.map((p) => p.code)).toEqual(['dangling-footnote']);
      expect(convertStub.convertHtmlToPdf).not.toHaveBeenCalled();
    });

    it('输出边界问题返回 422，含 detail 与带位置的 problems', async () => {
      const id = await createDoc({
        content: wrongTypeReferenceDoc(),
      });
      const res = await download(EXPORT_PATH(id, format));
      expect(res.status).toBe(422);
      const body = errorBody(res);
      expect(body.source).toBe('output-boundary');
      expect(body.message).toContain('导出被阻止');
      expect(body.detail).toContain('导出被阻止');
      expect(body.problems?.[0]).toMatchObject({
        source: 'output-boundary',
        code: 'unsupported-output',
      });
      expect(convertStub.convertHtmlToPdf).not.toHaveBeenCalled();
    });
  });

  describe('HTML', () => {
    it('响应头：text/html、attachment 与 UTF-8 文件名、内容长度', async () => {
      const id = await createDoc();
      const res = await download(EXPORT_PATH(id, 'html'));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(
        disposition('标准机器语言表达.html'),
      );
      expect(res.headers['content-length']).toBe(String(res.bytes.length));
    });

    it('内容与「同步封面后直接调用 @ses/io 的 exportSemanticHtml」逐字相同', async () => {
      const id = await createDoc();
      const res = await download(EXPORT_PATH(id, 'html'));
      const expected = exportSemanticHtml(synchronized());
      expect(res.bytes.toString('utf8')).toBe(expected);

      // 不是空转：是 screen 变体的完整页面，含附录与转义后的标题，封面按文档库 meta 同步。
      expect(expected).toContain('data-variant="screen"');
      expect(expected).toContain('附 &lt;录&gt; &amp; "甲"');
      expect(expected).toContain('GB/T 46687.3');
      expect(expected).not.toContain('GB/T 00000');
      expect(convertStub.convertHtmlToPdf).not.toHaveBeenCalled();
    });

    it('文件名：titleCn 为空白用「标准文件」，特殊字符按 RFC 5987 转义，极长标题有上界', async () => {
      const blank = await download(
        EXPORT_PATH(
          await createDoc({ meta: { ...fixtureMeta, titleCn: '  ' } }),
          'html',
        ),
      );
      expect(blank.headers['content-disposition']).toBe(
        disposition('标准文件.html'),
      );
      const special = await download(
        EXPORT_PATH(
          await createDoc({ meta: { ...fixtureMeta, titleCn: "A(1)'*!/" } }),
          'html',
        ),
      );
      expect(special.headers['content-disposition']).toBe(
        "attachment; filename*=UTF-8''A%281%29%27%2A%21%2F.html",
      );
      const long = await download(
        EXPORT_PATH(
          await createDoc({
            meta: { ...fixtureMeta, titleCn: '标准机器语言表达'.repeat(250) },
          }),
          'html',
        ),
      );
      expect(long.status).toBe(200);
      expect(long.headers['content-disposition'].length).toBeLessThanOrEqual(
        CONTENT_DISPOSITION_MAX_LENGTH,
      );
      expect(long.headers['content-disposition']).toMatch(
        /…\.html$|%E2%80%A6\.html$/,
      );
    });
  });

  describe('JSON', () => {
    it('响应头：application/json、attachment 与 UTF-8 文件名、内容长度', async () => {
      const id = await createDoc();
      const res = await download(EXPORT_PATH(id, 'json'));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(
        'application/json; charset=utf-8',
      );
      expect(res.headers['content-disposition']).toBe(
        disposition('标准机器语言表达.json'),
      );
      expect(res.headers['content-length']).toBe(String(res.bytes.length));
    });

    it('内容与「同步封面后直接调用 @ses/io 的 exportSemanticJson，两空格缩进」逐字相同', async () => {
      const id = await createDoc();
      const res = await download(EXPORT_PATH(id, 'json'));
      const expected = JSON.stringify(
        exportSemanticJson(synchronized()),
        null,
        2,
      );
      expect(res.bytes.toString('utf8')).toBe(expected);

      // 不是空转：是语义 JSON（含编号），封面按文档库 meta 同步。
      const parsed = JSON.parse(expected) as unknown;
      expect(typeof parsed).toBe('object');
      expect(expected).toContain('GB/T 46687.3');
      expect(expected).not.toContain('GB/T 00000');
      expect(expected).toContain('"number"');
      expect(expected).toContain('附 <录> & \\"甲\\"');
    });

    it('不做导出前检查（与编辑器一致）：HTML/PDF 会被拦下的内容仍可导出 JSON', async () => {
      for (const content of [danglingFootnoteDoc(), wrongTypeReferenceDoc()]) {
        const id = await createDoc({ content });
        expect((await download(EXPORT_PATH(id, 'html'))).status).toBe(422);
        const res = await download(EXPORT_PATH(id, 'json'));
        expect(res.status).toBe(200);
        expect(res.bytes.toString('utf8')).toBe(
          JSON.stringify(exportSemanticJson(synchronized(content)), null, 2),
        );
      }
    });

    it('文件名：titleCn 为空用「标准文件」', async () => {
      const res = await download(
        EXPORT_PATH(
          await createDoc({ meta: { ...fixtureMeta, titleCn: '' } }),
          'json',
        ),
      );
      expect(res.headers['content-disposition']).toBe(
        disposition('标准文件.json'),
      );
    });
  });

  describe('PDF', () => {
    it('管线不可用（htmlToPdf 为 false）返回 503，说明缺少的依赖，不调用管线', async () => {
      stubState.htmlToPdf = false;
      stubState.missing = ['@vivliostyle/cli', 'poppler(pdftotext/pdfinfo)'];
      const id = await createDoc();
      const res = await download(EXPORT_PATH(id, 'pdf'));
      expect(res.status).toBe(503);
      const body = errorBody(res);
      expect(body.statusCode).toBe(503);
      expect(body.message).toContain('PDF 导出不可用');
      expect(body.message).toContain('@vivliostyle/cli');
      expect(body.message).toContain('poppler(pdftotext/pdfinfo)');
      expect(body.missingDependencies).toEqual([
        '@vivliostyle/cli',
        'poppler(pdftotext/pdfinfo)',
      ]);
      expect(convertStub.getCapabilities).toHaveBeenCalled();
      expect(convertStub.convertHtmlToPdf).not.toHaveBeenCalled();
    });

    it('管线不可用但依赖列表为空时仍给出可读的 503 说明', async () => {
      stubState.htmlToPdf = false;
      const id = await createDoc();
      const res = await download(EXPORT_PATH(id, 'pdf'));
      expect(res.status).toBe(503);
      expect(errorBody(res).message).toContain('@vivliostyle/cli 或 poppler');
    });

    it('管线不可用时，404 与 422 仍先于 503 返回', async () => {
      stubState.htmlToPdf = false;
      expect((await download(EXPORT_PATH(987654, 'pdf'))).status).toBe(404);
      const emptyId = await createDoc({
        content: { type: 'doc', content: [] },
      });
      expect((await download(EXPORT_PATH(emptyId, 'pdf'))).status).toBe(422);
      const blockedId = await createDoc({
        content: wrongTypeReferenceDoc(),
      });
      expect((await download(EXPORT_PATH(blockedId, 'pdf'))).status).toBe(422);
    });

    it('管线可用：返回 application/pdf、文件名头与管线产出的字节', async () => {
      const id = await createDoc();
      const res = await download(EXPORT_PATH(id, 'pdf'));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        disposition('标准机器语言表达.pdf'),
      );
      expect(res.headers['content-length']).toBe(String(PDF_BYTES.length));
      expect(res.bytes.equals(PDF_BYTES)).toBe(true);
      expect(convertStub.convertHtmlToPdf).toHaveBeenCalledTimes(1);
    });

    it('交给管线的 html、toc、docTitle 与编辑器路径构建的请求完全一致', async () => {
      const id = await createDoc();
      await download(EXPORT_PATH(id, 'pdf'));

      // 编辑器：封面同步 → buildPdfExportRequest(doc, irMetaFromDocumentMeta(文档 meta))，再取 html/toc/docTitle POST。
      const editorRequest = buildPdfExportRequest(
        synchronized(),
        irMetaFromDocumentMeta(fixtureMeta as unknown as DocumentMeta),
      );
      expect(convertStub.convertHtmlToPdf).toHaveBeenCalledTimes(1);
      const input = convertStub.convertHtmlToPdf.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(input).sort()).toEqual(['docTitle', 'html', 'toc']);
      expect(input.html).toBe(editorRequest.html);
      expect(input.toc).toEqual(editorRequest.toc);
      expect(input.docTitle).toBe(editorRequest.docTitle);

      // 不是空转：print 变体、封面已同步、目次含前置与正文分区且还原了转义。
      expect(editorRequest.html).toContain('data-variant="print"');
      expect(editorRequest.html).toContain('GB/T 46687.3');
      expect(editorRequest.html).not.toContain('GB/T 00000');
      expect(editorRequest.docTitle).toBe('标准机器语言表达');
      const divisions = new Set(editorRequest.toc.map((e) => e.division));
      expect(divisions).toEqual(new Set(['front', 'body']));
      expect(editorRequest.toc.map((e) => e.target)).toEqual(
        expect.arrayContaining([
          'front_foreword',
          'front_intro',
          'sec_A',
          'sec_B',
          'sec_bibliography',
        ]),
      );
      expect(editorRequest.toc.map((e) => e.text)).toEqual(
        expect.arrayContaining([
          '附录A　（规范性）附 <录> & "甲"',
          '附录B　（资料性）&amp; 乙',
        ]),
      );
    });

    it('docTitle 取文档库 meta 的标题（覆盖文档内旧值），而不是封面里的旧标题', async () => {
      const id = await createDoc({
        meta: { ...fixtureMeta, titleCn: '新标题 & "更新"' },
      });
      await download(EXPORT_PATH(id, 'pdf'));
      const input = convertStub.convertHtmlToPdf.mock.calls[0][0] as {
        docTitle: string;
        html: string;
      };
      expect(input.docTitle).toBe('新标题 & "更新"');
      expect(input.html).toContain(
        '<h1 class="ses-doc-title">新标题 &amp; "更新"</h1>',
      );
    });

    it('文件名：titleCn 为空白用「标准文件」', async () => {
      const res = await download(
        EXPORT_PATH(
          await createDoc({ meta: { ...fixtureMeta, titleCn: ' ' } }),
          'pdf',
        ),
      );
      expect(res.headers['content-disposition']).toBe(
        disposition('标准文件.pdf'),
      );
    });

    describe('不访问网络资源（防 SSRF，与 DOCX 一致）', () => {
      const DATA_URL =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const EXTERNAL_SOURCES = [
        'http://127.0.0.1:9/a.png',
        'https://127.0.0.1:9/b.png',
        '//127.0.0.1:9/c.png',
        '/relative/d.png',
        'file:///etc/hostname',
        'asset:abc',
        ' http://127.0.0.1:9/e.png',
      ];

      const warningsOf = (result: Download): ExportWarning[] => {
        const header = result.headers[WARNINGS_HEADER.toLowerCase()];
        return header
          ? (JSON.parse(decodeURIComponent(header)) as ExportWarning[])
          : [];
      };

      it('非 data URL 的图片在交给管线前被清空，并以 image-resource-failed 告警写入响应头；data URL 图片原样保留', async () => {
        const content = chapterOnlyDoc(
          ...EXTERNAL_SOURCES.map((src, i) => figure(`fig-${i}`, src)),
          figure('fig-data', DATA_URL),
        );
        const id = await createDoc({ content });
        const res = await download(EXPORT_PATH(id, 'pdf'));
        expect(res.status).toBe(200);

        const input = convertStub.convertHtmlToPdf.mock.calls[0][0] as {
          html: string;
        };
        // 页面里没有任何外部地址，data URL 仍在；被清空的图是 src=""。
        for (const src of EXTERNAL_SOURCES) {
          expect(input.html).not.toContain(src.trim());
        }
        expect(input.html).toContain(`src="${DATA_URL}"`);
        expect(
          input.html.match(/<img class="ses-figure-image" src=""/g),
        ).toHaveLength(EXTERNAL_SOURCES.length);
        // 除被清空的 src 外与编辑器路径构建的 print HTML 完全相同。
        const blanked = chapterOnlyDoc(
          ...EXTERNAL_SOURCES.map((_, i) => figure(`fig-${i}`, '')),
          figure('fig-data', DATA_URL),
        );
        expect(input.html).toBe(
          buildPdfExportRequest(
            synchronized(blanked),
            irMetaFromDocumentMeta(fixtureMeta as unknown as DocumentMeta),
          ).html,
        );

        expect(warningsOf(res)).toEqual(
          EXTERNAL_SOURCES.map((_, i) => ({
            code: 'image-resource-failed',
            nodeId: `fig-${i}`,
            message: EXTERNAL_IMAGE_REJECTED_MESSAGE,
          })),
        );
        expect(res.headers[WARNING_COUNT_HEADER.toLowerCase()]).toBe(
          String(EXTERNAL_SOURCES.length),
        );
      });

      it('只含 data URL 图片的文档没有告警', async () => {
        const id = await createDoc();
        const res = await download(EXPORT_PATH(id, 'pdf'));
        expect(res.status).toBe(200);
        expect(res.headers[WARNING_COUNT_HEADER.toLowerCase()]).toBe('0');
        expect(res.headers[WARNINGS_HEADER.toLowerCase()]).toBeUndefined();
      });
    });

    it('管线执行失败返回 500，消息带原因', async () => {
      convertStub.convertHtmlToPdf.mockRejectedValue(
        new Error('vivliostyle 退出码 1'),
      );
      const id = await createDoc();
      const res = await download(EXPORT_PATH(id, 'pdf'));
      expect(res.status).toBe(500);
      expect(errorBody(res).message).toContain('PDF 导出失败');
      expect(errorBody(res).message).toContain('vivliostyle 退出码 1');
    });
  });
});
