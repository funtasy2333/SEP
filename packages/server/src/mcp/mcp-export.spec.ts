/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call --
   工具结果是运行时解析出来的 JSON（形状因工具而异），用例按需逐字段断言，不为每种形状单独声明类型。 */
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';
import { synchronizeCoverMetadata } from '@ses/io';
import {
  analyzeDocument,
  irMetaFromDocumentMeta,
  pmToIr,
  resolve,
  type DocumentMeta,
  type PMJsonNode,
} from '@ses/shared';
import request from 'supertest';
import { ConvertService } from '../convert/convert.service';
import { validateContent } from '../editor-schema/editor-schema';
import { readZipEntries } from '../export/__fixtures__/read-zip';
import { WARNING_COUNT_HEADER, WARNINGS_HEADER } from '../export/export-http';
import { EXTERNAL_IMAGE_REJECTED_MESSAGE } from '../export/external-images';
import { ExportService } from '../export/export.service';
import { canonical, sampleDocument } from '../test-support/sample-documents';
import {
  connectMcp,
  type McpTestClient,
} from '../test-support/mcp-test-client';
import { createTestApp, type TestApp } from '../test-support/test-app';
import {
  DEFAULT_OUTPUT_DIR_NAME,
  FILE_WRITE_ENV,
  OUTPUT_DIRS_ENV,
} from './mcp-file-output';
import { downloadBaseUrl, McpToolsService } from './mcp-tools.service';

/** 放进正文的标记串：用来证明错误响应与日志里没有文档正文。 */
const SECRET = '机密正文-8f3a91';
/** 放进目录名的标记串：用来证明日志里没有路径。 */
const DIR_TOKEN = '目录标记-c4e7d2';

const text = (value: string): PMJsonNode => ({ type: 'text', text: value });
const paragraph = (nodeId: string | null, value: string): PMJsonNode => ({
  type: 'stdParagraph',
  ...(nodeId === null ? {} : { attrs: { nodeId } }),
  content: [text(value)],
});

/** 单章文档（根为生产 schema 的 doc），章节内容放在章标题之后；nodeId 为 null 的节点不带 nodeId。 */
function chapterDoc(
  children: PMJsonNode[],
  chapterId: string | null = 'chapter-1',
): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      {
        type: 'chapter',
        ...(chapterId === null ? {} : { attrs: { nodeId: chapterId } }),
        content: [
          { type: 'chapterTitle', content: [text('范围')] },
          ...children,
        ],
      },
    ],
  };
}

/** 表脚注引用指向不存在的定义：脚注校验拦下 docx / pdf / html。 */
function danglingFootnoteDoc(): Record<string, unknown> {
  return chapterDoc([
    {
      type: 'stdTable',
      attrs: { nodeId: 't1' },
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
                        {
                          type: 'tableFootnoteRef',
                          attrs: { targetId: 'missing' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
}

/** 正文脚注内部的交叉引用悬空：旧 problems 保留，quality 必须过滤。 */
function danglingInlineFootnoteDoc(): Record<string, unknown> {
  return chapterDoc([
    {
      type: 'stdParagraph',
      attrs: { nodeId: 'p-footnote' },
      content: [
        text('正文'),
        {
          type: 'footnoteRef',
          attrs: {
            nodeId: 'fn-ref',
            content: [
              {
                type: 'text',
                text: '引用缺失条款',
                marks: [
                  {
                    type: 'crossRef',
                    attrs: { refId: 'missing-footnote-target', refType: 'clause' },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ]);
}

/** 同一段文字同时带上下标：输出边界检查拦下 DOCX。 */
function subSupDoc(): Record<string, unknown> {
  return chapterDoc([
    {
      type: 'stdParagraph',
      attrs: { nodeId: 'p1' },
      content: [
        {
          type: 'text',
          text: 'H2O',
          marks: [{ type: 'subscript' }, { type: 'superscript' }],
        },
      ],
    },
  ]);
}

/** 把表当作条来引用：输出边界检查拦下 docx / pdf / html（语义 JSON 不检查，仍可导出）。 */
function wrongTypeReferenceDoc(): Record<string, unknown> {
  return chapterDoc([
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
    {
      type: 'stdTable',
      attrs: { nodeId: 't1' },
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
                  content: [{ type: 'paragraph', content: [text('尺寸')] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
}

const figure = (nodeId: string, src: string): PMJsonNode => ({
  type: 'figure',
  attrs: { nodeId },
  content: [
    { type: 'figureImage', attrs: { src } },
    { type: 'figureCaption', content: [text('示意图')] },
  ],
});

const MCP_HEADERS = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};

const meta = { titleCn: '导出测试标准', standardType: 'national' };
const PDF_STUB = Buffer.from('%PDF-1.7\n% 测试桩\n', 'utf8');

/** 捕获并静默 Nest Logger 的输出，返回捕获到的全部日志文本。 */
function captureLogs() {
  const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
    (level) => jest.spyOn(Logger.prototype, level).mockImplementation(),
  );
  return {
    text: () =>
      spies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map(String).join(' '))
        .join('\n'),
  };
}

/** Windows 上创建符号链接需要权限，符号链接相关用例只在 POSIX 上运行。 */
const itPosix = process.platform === 'win32' ? it.skip : it;

describe('MCP 工具：validate_document 与 export_document', () => {
  let t: TestApp;
  let mcp: McpTestClient;
  let dir: string;
  let convert: ConvertService;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    t = await createTestApp();
    mcp = await connectMcp(t);
    dir = await mkdtemp(join(tmpdir(), 'ses-mcp-export-'));
    // outputPath 只能写到允许目录：测试把临时目录设为允许目录（真实的主目录与 ~/SES-exports 不会被碰到）。
    process.env[OUTPUT_DIRS_ENV] = dir;
    convert = t.app.get(ConvertService);
    // PDF 管线用桩替换：这里验证的是工具与导出接口的一致，不跑真实的 vivliostyle（端到端用例跑真实管线）。
    jest.spyOn(convert, 'getCapabilities').mockReturnValue({ htmlToPdf: true });
    jest.spyOn(convert, 'convertHtmlToPdf').mockResolvedValue(PDF_STUB);
  });
  afterEach(async () => {
    await mcp.close();
    await t.app.close();
    await rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
    delete process.env[FILE_WRITE_ENV];
    delete process.env[OUTPUT_DIRS_ENV];
    delete process.env.PORT;
  });

  async function createDoc(
    content: Record<string, unknown> | null = chapterDoc([
      paragraph('p1', '一段正文。'),
    ]),
    overrides: { meta?: Record<string, unknown> } = {},
  ): Promise<number> {
    const created = await t.documents.create({
      title: '导出测试标准',
      meta,
      stage: 'working_draft',
      content: content as never,
      ...overrides,
    });
    return created.id;
  }

  /** 以二进制取回 REST 响应体。 */
  async function rest(path: string): Promise<{
    status: number;
    bytes: Buffer;
    headers: Record<string, string>;
  }> {
    const res = await t.http
      .get(path)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return {
      status: res.status,
      bytes: res.body as Buffer,
      headers: res.headers as Record<string, string>,
    };
  }
  const restJson = (r: { bytes: Buffer }) =>
    JSON.parse(r.bytes.toString('utf8')) as Record<string, any>;

  // ---------------------------------------------------------------------------
  describe('validate_document', () => {
    it('保留 revision/problems/exports，并新增 quality，与 structuredContent 相同', async () => {
      const id = await createDoc();
      const result = await mcp.call('validate_document', { documentId: id });
      expect(result.isError).toBe(false);
      expect(Object.keys(result.body).sort()).toEqual([
        'exports',
        'problems',
        'quality',
        'revision',
      ]);
      expect(result.body.revision).toBe(0);
      expect(result.body.problems).toBeInstanceOf(Array);
      expect(result.body.exports).toEqual({
        docx: { ok: true },
        pdf: { ok: true, available: true },
        html: { ok: true },
      });
      // json 不做导出前检查，不列出。
      expect(result.body.exports).not.toHaveProperty('json');
      expect(result.body.quality).toMatchObject({
        profile: 'ses-phase6-manual-v2',
        coverage: {
          standardDatabase: { status: 'deferred' },
          termAuthority: { status: 'deferred' },
          bibliographyReminder: { status: 'excluded' },
          footnotes: { status: 'excluded' },
          tableFootnotes: { status: 'excluded' },
        },
      });
      expect(result.structured).toEqual(result.body);
    });

    it('从同一读取快照和前端相同的文档元数据覆盖生成 quality', async () => {
      const id = await createDoc(canonical(sampleDocument()), {
        meta: {
          ...meta,
          titleCn: '同快照元数据覆盖测试',
          standardNo: 'GB/T 12345—2026',
        },
      });
      const stored = await t.documents.findOne(id);
      const pmDoc = validateContent(
        synchronizeCoverMetadata(
          stored.content as unknown as Record<string, unknown>,
          stored.meta as unknown as DocumentMeta,
        ),
      ).toJSON() as PMJsonNode;
      const irDoc = pmToIr(pmDoc).doc;
      irDoc.meta = {
        ...irDoc.meta,
        ...irMetaFromDocumentMeta(stored.meta as unknown as DocumentMeta),
      };
      const expected = analyzeDocument(irDoc);
      const legacyProblems = resolve(pmToIr(pmDoc).doc).problems;
      const findOne = jest.spyOn(t.documents, 'findOne');

      const result = await mcp.call('validate_document', { documentId: id });

      expect(findOne).toHaveBeenCalledTimes(1);
      expect(result.body.quality).toEqual(expected.validation);
      // legacy problems 仍是原 Resolver 问题集合，metadata scalar 覆盖不改变它。
      expect(expected.resolution.problems).toEqual(legacyProblems);
      expect(result.body.problems).toEqual(legacyProblems);
    });

    it('quality 排除脚注与参考文献提醒，但保留导出脚注保护', async () => {
      const result = await mcp.call('validate_document', {
        documentId: await createDoc(danglingFootnoteDoc()),
      });

      expect(result.body.exports.docx).toMatchObject({
        ok: false,
        source: 'footnote',
      });
      expect(result.body.quality.coverage).toMatchObject({
        footnotes: { status: 'excluded' },
        tableFootnotes: { status: 'excluded' },
        bibliographyReminder: { status: 'excluded' },
      });
      expect(
        result.body.quality.issues
          .map((issue: { message: string }) => issue.message)
          .join('\n'),
      ).not.toMatch(/脚注|表脚注|参考文献.*未引用/);
    });

    it('脚注内部的旧 Resolver 问题仍保留在 problems，不进入 quality', async () => {
      const result = await mcp.call('validate_document', {
        documentId: await createDoc(danglingInlineFootnoteDoc()),
      });

      expect(result.body.problems).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'dangling-xref' })]),
      );
      expect(result.body.quality.issues).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ nodeId: 'fn-ref' })]),
      );
    });

    it('只读：不改 revision 与 updatedAt，不产生版本与变更事件', async () => {
      const id = await createDoc(canonical(sampleDocument()));
      const before = await t.documents.findOne(id);
      const events: unknown[] = [];
      t.events.events(id).subscribe((event) => events.push(event));
      const update = jest.spyOn(t.documents, 'update');
      const transaction = jest.spyOn(t.documents, 'transaction');

      await mcp.call('validate_document', { documentId: id });
      await mcp.call('validate_document', { documentId: id });

      const after = await t.documents.findOne(id);
      expect(after.revision).toBe(before.revision);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(after.content).toEqual(before.content);
      expect(await t.versions.findByDocument(id)).toEqual([]);
      expect(events).toEqual([]);
      expect(update).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('不补 nodeId、不写库：没有 nodeId 的文档校验后 revision 仍是 0（而 get_outline 会补齐并加 1）', async () => {
      const id = await createDoc(
        chapterDoc([paragraph(null, '没有 nodeId 的段落')], null),
      );
      const events: unknown[] = [];
      t.events.events(id).subscribe((event) => events.push(event));

      const result = await mcp.call('validate_document', { documentId: id });
      expect(result.isError).toBe(false);
      expect(result.body.revision).toBe(0);
      expect(
        result.body.problems.map((p: { code: string }) => p.code),
      ).toContain('missing-id');
      expect((await t.documents.findOne(id)).revision).toBe(0);
      expect(events).toEqual([]);

      // 对照：读取类工具会补齐 nodeId（写库，revision 加 1），之后校验不再报 missing-id。
      const outline = await mcp.call('get_outline', { documentId: id });
      expect(outline.body.revision).toBe(1);
      const again = await mcp.call('validate_document', { documentId: id });
      expect(again.body.revision).toBe(1);
      expect(
        again.body.problems.map((p: { code: string }) => p.code),
      ).not.toContain('missing-id');
    });

    it('problems 与 apply_operations 返回的 problems 同一来源与形状（没有 introduced）', async () => {
      // 在「附加要求」里放一个指向不存在目标的交叉引用 → dangling-xref。
      const base = sampleDocument();
      const extra = base.content!.find(
        (node) => node.attrs?.nodeId === 'ch-extra',
      )!;
      extra.content!.push({
        type: 'stdParagraph',
        attrs: { nodeId: 'p-bad' },
        content: [
          text('见'),
          {
            type: 'text',
            text: '第9章',
            marks: [
              { type: 'crossRef', attrs: { refId: 'nope', refType: 'clause' } },
            ],
          },
        ],
      });
      const id = await createDoc(canonical(base));

      const applied = await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [
          { op: 'replace', nodeId: 'p-scope', content: ['改写后的范围。'] },
        ],
      });
      expect(applied.isError).toBe(false);
      const validated = await mcp.call('validate_document', { documentId: id });

      const codes = validated.body.problems.map(
        (p: { code: string }) => p.code,
      );
      expect(codes).toContain('dangling-xref');
      for (const problem of validated.body.problems) {
        expect(Object.keys(problem).sort()).toEqual([
          'code',
          'message',
          'nodeId',
          'severity',
        ]);
        expect(problem).not.toHaveProperty('introduced');
      }
      // 同一份文档，两个工具报告的问题完全相同（apply 的多一个 introduced）。
      const withoutIntroduced = (applied.body.problems as any[]).map(
        (problem) => {
          const { introduced, ...rest } = problem as { introduced: boolean };
          expect(introduced).toBe(false); // 本批只改了无关的段落，没有新引入的问题
          return rest;
        },
      );
      expect(withoutIntroduced).toEqual(validated.body.problems);
    });

    describe.each([
      [
        '脚注校验未通过（三种格式都被拦下）',
        danglingFootnoteDoc,
        ['docx', 'pdf', 'html'],
      ],
      ['输出边界：上下标叠加（拦下 DOCX）', subSupDoc, ['docx']],
      [
        '输出边界：交叉引用类型不符（三种格式都被拦下）',
        wrongTypeReferenceDoc,
        ['docx', 'pdf', 'html'],
      ],
    ] as const)('未通过的情形：%s', (_name, build, blocked) => {
      it('exports 与各导出接口的 422 完全一致；export_document 以同样的原因失败', async () => {
        const id = await createDoc(build());
        const validated = await mcp.call('validate_document', {
          documentId: id,
        });
        expect(validated.isError).toBe(false);

        for (const format of ['docx', 'pdf', 'html'] as const) {
          const check = validated.body.exports[format];
          const response = await rest(`/api/documents/${id}/export/${format}`);
          const exported = await mcp.call('export_document', {
            documentId: id,
            format,
          });
          if (!(blocked as readonly string[]).includes(format)) {
            expect(check.ok).toBe(true);
            expect(response.status).toBe(200);
            expect(exported.isError).toBe(false);
            continue;
          }
          const body = restJson(response);
          expect(response.status).toBe(422);
          expect(check).toMatchObject({ ok: false });
          expect(check.source).toBe(body.source);
          expect(check.message).toBe(body.message);
          expect(check.problems).toEqual(body.problems);
          expect(check.problems.length).toBeGreaterThan(0);
          // 校验结果里不带 detail（与 message 的重复内容、或在 problems 里已逐项列出）。
          expect(check).not.toHaveProperty('detail');
          expect(exported.isError).toBe(true);
          expect(exported.body).toMatchObject({
            status: 422,
            message: body.message,
            problems: body.problems,
          });
        }
        // pdf 的可用性与未通过互不影响。
        expect(validated.body.exports.pdf.available).toBe(true);
        // 文档问题（Resolver）是另一回事：这里没有对错之分，只要是数组。
        expect(validated.body.problems).toBeInstanceOf(Array);
      });
    });

    it('脚注未通过时 source 为 footnote，输出边界未通过时为 output-boundary', async () => {
      const footnote = await mcp.call('validate_document', {
        documentId: await createDoc(danglingFootnoteDoc()),
      });
      expect(footnote.body.exports.docx).toMatchObject({
        ok: false,
        source: 'footnote',
      });
      expect(footnote.body.exports.docx.message).toContain(
        '脚注校验未通过，暂不能导出',
      );
      expect(
        (footnote.body.exports.docx.problems as Array<{ code: string }>).map(
          (p) => p.code,
        ),
      ).toEqual(['dangling-footnote']);

      const boundary = await mcp.call('validate_document', {
        documentId: await createDoc(subSupDoc()),
      });
      expect(boundary.body.exports.docx).toMatchObject({
        ok: false,
        source: 'output-boundary',
      });
      expect(boundary.body.exports.docx.problems[0]).toMatchObject({
        source: 'output-boundary',
        code: 'unsupported-output',
      });
    });

    it('pdf.available 与 /api/convert/capabilities 一致；管线不可用时检查通过的 pdf 仍是 ok: true', async () => {
      const id = await createDoc();
      jest
        .spyOn(convert, 'getCapabilities')
        .mockReturnValue({ htmlToPdf: false });
      const capabilities = await t.http.get('/api/convert/capabilities');
      expect((capabilities.body as { htmlToPdf: boolean }).htmlToPdf).toBe(
        false,
      );

      const result = await mcp.call('validate_document', { documentId: id });
      expect(result.body.exports.pdf).toEqual({ ok: true, available: false });
      expect(result.body.exports.docx).toEqual({ ok: true });
    });

    it('检查与导出的先后一致：未通过的 pdf 同时 available 为 false 时，导出仍先报 422', async () => {
      const id = await createDoc(danglingFootnoteDoc());
      jest
        .spyOn(convert, 'getCapabilities')
        .mockReturnValue({ htmlToPdf: false });
      const result = await mcp.call('validate_document', { documentId: id });
      expect(result.body.exports.pdf).toMatchObject({
        ok: false,
        source: 'footnote',
        available: false,
      });
      expect((await rest(`/api/documents/${id}/export/pdf`)).status).toBe(422);
    });

    it('校验里通过的格式，导出接口在检查这一步也通过；未通过的，导出接口也拦下', async () => {
      const id = await createDoc(wrongTypeReferenceDoc());
      const validated = await mcp.call('validate_document', { documentId: id });
      for (const format of ['docx', 'pdf', 'html'] as const) {
        const response = await rest(`/api/documents/${id}/export/${format}`);
        expect(validated.body.exports[format].ok).toBe(response.status === 200);
      }
    });

    describe('文档本身不可校验：整个工具 isError（422），与导出接口一致', () => {
      const cases: Array<[string, Record<string, unknown> | null]> = [
        ['null', null],
        ['空对象', {}],
        ['没有顶层节点', { type: 'doc', content: [] }],
      ];
      it.each(cases)('内容为空（%s）', async (_name, content) => {
        const id = await createDoc(content);
        const result = await mcp.call('validate_document', { documentId: id });
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(422);
        expect(result.body.message).toContain('文档内容为空');
        expect(result.body.message).toContain('无法校验');
        const response = await rest(`/api/documents/${id}/export/docx`);
        expect(response.status).toBe(422);
        expect(restJson(response).message).toContain('文档内容为空');
      });

      it('内容不符合生产 schema：422，source 为 schema，带 problems（与导出接口一致）；响应与日志不含正文', async () => {
        const logs = captureLogs();
        const id = await createDoc(
          chapterDoc([
            paragraph('p1', SECRET),
            { type: 'mystery', attrs: { nodeId: 'bad-1' } },
          ]),
        );
        const result = await mcp.call('validate_document', { documentId: id });
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(422);
        expect(result.body.message).toContain('文档内容不符合编辑器文档结构');
        expect(result.body.message).toContain('无法校验');
        expect(result.body.message).toContain('未知的节点类型「mystery」');
        expect(result.body.problems).toEqual([
          expect.objectContaining({
            source: 'schema',
            code: 'unknown-node-type',
            nodeType: 'mystery',
            nodeId: 'bad-1',
          }),
        ]);
        const response = await rest(`/api/documents/${id}/export/docx`);
        expect(restJson(response).problems).toEqual(result.body.problems);

        expect(JSON.stringify(result.body)).not.toContain(SECRET);
        const logged = logs.text();
        expect(logged).toContain(`文档 #${id} 内容不符合编辑器文档结构`);
        expect(logged).toContain('校验中止');
        expect(logged).not.toContain('mystery');
        expect(logged).not.toContain(SECRET);
      });

      it('库里的内容无法解析（节点为 null）：422，而不是 500', async () => {
        const id = await createDoc({ type: 'doc', content: [null] } as never);
        const result = await mcp.call('validate_document', { documentId: id });
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(422);
        expect(result.body.message).toContain('文档内容结构无法解析');
      });
    });

    it('未知文档 404；documentId 缺失或不是正整数、多余参数 400', async () => {
      const missing = await mcp.call('validate_document', {
        documentId: 987654,
      });
      expect(missing.isError).toBe(true);
      expect(missing.body.status).toBe(404);

      for (const args of [{}, { documentId: 0 }, { documentId: '1' }]) {
        const result = await mcp.call('validate_document', args);
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(400);
        expect(result.body.message).toContain('documentId');
      }
      const id = await createDoc();
      const extra = await mcp.call('validate_document', {
        documentId: id,
        format: 'docx',
      });
      expect(extra.isError).toBe(true);
      expect(extra.body.status).toBe(400);
      expect(extra.body.message).toContain('format');
    });

    it('日志只有文档 id、数量与通过情况，不含正文', async () => {
      const logs = captureLogs();
      const id = await createDoc(chapterDoc([paragraph('p1', SECRET)]));
      await mcp.call('validate_document', { documentId: id });
      const logged = logs.text();
      expect(logged).toContain(`文档 #${id} 校验完成`);
      expect(logged).not.toContain(SECRET);
    });
  });

  // ---------------------------------------------------------------------------
  describe('export_document（不给 outputPath）', () => {
    it.each(['docx', 'pdf', 'html', 'json'] as const)(
      '%s：返回 { format, filename, size, warnings, downloadUrl }，没有 savedTo，不写文件，size 与 REST 一致',
      async (format) => {
        const id = await createDoc();
        const result = await mcp.call('export_document', {
          documentId: id,
          format,
        });
        expect(result.isError).toBe(false);
        expect(Object.keys(result.body).sort()).toEqual([
          'downloadUrl',
          'filename',
          'format',
          'size',
          'warnings',
        ]);
        expect(result.body.format).toBe(format);
        expect(result.body.filename).toBe(`导出测试标准.${format}`);
        expect(result.body.downloadUrl).toBe(
          `${t.url}/api/documents/${id}/export/${format}`,
        );
        expect(result.structured).toEqual(result.body);

        const response = await rest(`/api/documents/${id}/export/${format}`);
        expect(response.status).toBe(200);
        expect(response.headers['content-disposition']).toContain(
          encodeURIComponent(result.body.filename),
        );
        if (format !== 'docx')
          expect(result.body.size).toBe(response.bytes.length);
        else expect(result.body.size).toBeGreaterThan(1000);
        // 文件内容不在结果里。
        expect(result.body.size).toBeGreaterThan(0);
        expect(JSON.stringify(result.body)).not.toContain('一段正文');
        expect(await readdir(dir)).toEqual([]);
      },
    );

    it('走与 REST 完全相同的服务方法：每种格式恰好调用一次对应的 ExportService.export*', async () => {
      const id = await createDoc();
      const service = t.app.get(ExportService);
      const spies = {
        docx: jest.spyOn(service, 'exportDocx'),
        pdf: jest.spyOn(service, 'exportPdf'),
        html: jest.spyOn(service, 'exportHtml'),
        json: jest.spyOn(service, 'exportJson'),
      };
      for (const format of ['docx', 'pdf', 'html', 'json'] as const) {
        await mcp.call('export_document', { documentId: id, format });
        for (const [name, spy] of Object.entries(spies)) {
          expect(spy).toHaveBeenCalledTimes(name === format ? 1 : 0);
        }
        expect(spies[format]).toHaveBeenCalledWith(id);
        Object.values(spies).forEach((spy) => spy.mockClear());
      }
    });

    it('导出不修改文档：revision、版本、事件都不变', async () => {
      const id = await createDoc(canonical(sampleDocument()));
      const events: unknown[] = [];
      t.events.events(id).subscribe((event) => events.push(event));
      for (const format of ['docx', 'pdf', 'html', 'json'] as const) {
        await mcp.call('export_document', { documentId: id, format });
      }
      expect((await t.documents.findOne(id)).revision).toBe(0);
      expect(await t.versions.findByDocument(id)).toEqual([]);
      expect(events).toEqual([]);
    });

    it('warnings 原样返回，与 REST 响应头 X-SES-Export-Warnings 同一来源', async () => {
      const id = await createDoc(
        chapterDoc([
          figure('fig-1', 'https://127.0.0.1:9/a.png'),
          figure('fig-2', '/relative/b.png'),
        ]),
      );
      const result = await mcp.call('export_document', {
        documentId: id,
        format: 'pdf',
      });
      expect(result.isError).toBe(false);
      const expected = ['fig-1', 'fig-2'].map((nodeId) => ({
        code: 'image-resource-failed',
        nodeId,
        message: EXTERNAL_IMAGE_REJECTED_MESSAGE,
      }));
      expect(result.body.warnings).toEqual(expected);

      const response = await rest(`/api/documents/${id}/export/pdf`);
      expect(response.headers[WARNING_COUNT_HEADER.toLowerCase()]).toBe('2');
      expect(
        JSON.parse(
          decodeURIComponent(response.headers[WARNINGS_HEADER.toLowerCase()]),
        ),
      ).toEqual(result.body.warnings);

      // docx 同样（封面告警之外的图片告警也在）。
      const docx = await mcp.call('export_document', {
        documentId: id,
        format: 'docx',
      });
      const docxRest = await rest(`/api/documents/${id}/export/docx`);
      expect(
        JSON.parse(
          decodeURIComponent(docxRest.headers[WARNINGS_HEADER.toLowerCase()]),
        ),
      ).toEqual(docx.body.warnings);
      expect(
        docx.body.warnings.filter(
          (w: any) => w.code === 'image-resource-failed',
        ),
      ).toEqual(expected);
    });

    it('html / json 没有告警，warnings 为空数组', async () => {
      const id = await createDoc(
        chapterDoc([figure('fig-1', 'https://127.0.0.1:9/a.png')]),
      );
      for (const format of ['html', 'json'] as const) {
        const result = await mcp.call('export_document', {
          documentId: id,
          format,
        });
        expect(result.body.warnings).toEqual([]);
      }
    });

    describe('downloadUrl 取本次请求的 Host', () => {
      /** 不经 SDK 客户端（它不允许改 Host），直接发 JSON-RPC：initialize 之后调用 export_document。 */
      async function callWithHost(host: string, id: number): Promise<any> {
        const init = await request(t.url)
          .post('/mcp')
          .set(MCP_HEADERS)
          .set('Host', host)
          .send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'host-test', version: '1' },
            },
          })
          .expect(200);
        const res = await request(t.url)
          .post('/mcp')
          .set(MCP_HEADERS)
          .set('Host', host)
          .set('Mcp-Session-Id', init.headers['mcp-session-id'])
          .send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'export_document',
              arguments: { documentId: id, format: 'html' },
            },
          })
          .expect(200);
        const body = res.body as { result: { content: { text: string }[] } };
        return JSON.parse(body.result.content[0].text);
      }

      it.each([
        'localhost:3000',
        '127.0.0.1:8123',
        '[::1]:4000',
        'LOCALHOST:5173',
        'localhost',
      ])('Host 为 %s → 原样用在下载地址里', async (host) => {
        const id = await createDoc();
        const result = await callWithHost(host, id);
        expect(result.downloadUrl).toBe(
          `http://${host}/api/documents/${id}/export/html`,
        );
      });

      it('SDK 客户端连 127.0.0.1:<端口> 时，下载地址就是这个地址', async () => {
        const id = await createDoc();
        const result = await mcp.call('export_document', {
          documentId: id,
          format: 'json',
        });
        expect(result.body.downloadUrl).toBe(
          `${t.url}/api/documents/${id}/export/json`,
        );
        // 地址可直接下载。
        const response = await fetch(result.body.downloadUrl);
        expect(response.status).toBe(200);
      });

      it('取不到 Host 时退回 http://localhost:${PORT ?? 3000}（工具服务不依赖 express 请求）', async () => {
        const id = await createDoc();
        const tools = t.app.get(McpToolsService);
        const context = { clientName: undefined, host: undefined };
        delete process.env.PORT;
        const byDefault = await tools.call(
          'export_document',
          { documentId: id, format: 'html' },
          context,
        );
        expect(JSON.parse((byDefault.content[0] as any).text).downloadUrl).toBe(
          `http://localhost:3000/api/documents/${id}/export/html`,
        );
        process.env.PORT = '4567';
        const byEnv = await tools.call(
          'export_document',
          { documentId: id, format: 'html' },
          context,
        );
        expect(JSON.parse((byEnv.content[0] as any).text).downloadUrl).toBe(
          `http://localhost:4567/api/documents/${id}/export/html`,
        );
      });

      it('downloadBaseUrl：允许的 Host 原样使用；缺失、非本机或带路径的值退回默认', () => {
        delete process.env.PORT;
        expect(downloadBaseUrl('localhost:3000')).toBe('http://localhost:3000');
        expect(downloadBaseUrl('[::1]:80')).toBe('http://[::1]:80');
        for (const host of [
          undefined,
          '',
          'evil.com',
          'evil.com:3000',
          'localhost.evil.com',
          '127.0.0.1.nip.io:3000',
          'localhost:3000/path',
          'user@localhost:3000',
        ]) {
          expect(downloadBaseUrl(host)).toBe('http://localhost:3000');
        }
        process.env.PORT = ' 8080 ';
        expect(downloadBaseUrl(undefined)).toBe('http://localhost:8080');
        process.env.PORT = '';
        expect(downloadBaseUrl(undefined)).toBe('http://localhost:3000');
      });
    });

    describe('错误', () => {
      it('未知文档 404', async () => {
        const result = await mcp.call('export_document', {
          documentId: 987654,
          format: 'docx',
        });
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(404);
      });

      it('导出前检查未通过 422（message、problems 与 REST 一致），不写文件', async () => {
        const id = await createDoc(danglingFootnoteDoc());
        const outputPath = join(dir, 'a.docx');
        const result = await mcp.call('export_document', {
          documentId: id,
          format: 'docx',
          outputPath,
        });
        const body = restJson(await rest(`/api/documents/${id}/export/docx`));
        expect(result.isError).toBe(true);
        expect(result.body).toMatchObject({
          status: 422,
          message: body.message,
          problems: body.problems,
        });
        expect(await readdir(dir)).toEqual([]);
      });

      it('内容为空 422', async () => {
        const id = await createDoc(null);
        const result = await mcp.call('export_document', {
          documentId: id,
          format: 'json',
        });
        expect(result.body.status).toBe(422);
        expect(result.body.message).toContain('文档内容为空，无法导出 JSON');
      });

      it('PDF 管线缺依赖：503 保留状态码与消息（列出缺少的依赖），与 REST 一致；不当作内部错误记日志', async () => {
        const id = await createDoc();
        jest
          .spyOn(convert, 'getCapabilities')
          .mockReturnValue({ htmlToPdf: false });
        jest
          .spyOn(convert, 'getHtmlPdfMissingDependencies')
          .mockReturnValue(['@vivliostyle/cli', 'poppler(pdftotext/pdfinfo)']);
        const error = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();

        const result = await mcp.call('export_document', {
          documentId: id,
          format: 'pdf',
          outputPath: join(dir, 'a.pdf'),
        });
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(503);
        expect(result.body.message).toContain('PDF 导出不可用');
        expect(result.body.message).toContain('@vivliostyle/cli');
        expect(result.body.message).toContain('poppler(pdftotext/pdfinfo)');
        expect(result.body.message).not.toBe('服务端内部错误');
        expect(await readdir(dir)).toEqual([]);

        const response = await rest(`/api/documents/${id}/export/pdf`);
        expect(response.status).toBe(503);
        expect(result.body.message).toBe(restJson(response).message);
        expect(error).not.toHaveBeenCalled();

        // 其他格式不受影响。
        const html = await mcp.call('export_document', {
          documentId: id,
          format: 'html',
        });
        expect(html.isError).toBe(false);
      });

      it('PDF 管线缺依赖但依赖列表为空：503 仍给出可读说明', async () => {
        const id = await createDoc();
        jest
          .spyOn(convert, 'getCapabilities')
          .mockReturnValue({ htmlToPdf: false });
        jest
          .spyOn(convert, 'getHtmlPdfMissingDependencies')
          .mockReturnValue([]);
        const result = await mcp.call('export_document', {
          documentId: id,
          format: 'pdf',
        });
        expect(result.body.status).toBe(503);
        expect(result.body.message).toContain('@vivliostyle/cli 或 poppler');
      });

      it('管线执行失败（500）仍是通用消息，不泄露原因；错误日志只有文档 id 与错误类型', async () => {
        const id = await createDoc();
        jest
          .spyOn(convert, 'convertHtmlToPdf')
          .mockRejectedValue(
            new Error('vivliostyle 退出码 1 /srv/tmp/内部路径'),
          );
        const error = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();
        const result = await mcp.call('export_document', {
          documentId: id,
          format: 'pdf',
        });
        expect(result.isError).toBe(true);
        expect(result.body).toEqual({ status: 500, message: '服务端内部错误' });
        const logged = error.mock.calls.map((args) =>
          args.map(String).join(' '),
        );
        expect(logged.join('\n')).not.toContain('内部路径');
        expect(logged.join('\n')).toContain('export_document');
      });
    });

    describe('参数校验（400）', () => {
      const cases: Array<[string, Record<string, unknown>, string]> = [
        ['缺少 documentId', { format: 'docx' }, 'documentId'],
        ['缺少 format', { documentId: 1 }, 'format'],
        [
          '未知格式 xml',
          { documentId: 1, format: 'xml' },
          'docx / pdf / html / json',
        ],
        ['format 大写', { documentId: 1, format: 'DOCX' }, 'format'],
        ['format 不是字符串', { documentId: 1, format: 1 }, 'format'],
        [
          'outputPath 为空串',
          { documentId: 1, format: 'docx', outputPath: '' },
          'outputPath',
        ],
        [
          'outputPath 为空白',
          { documentId: 1, format: 'docx', outputPath: '  ' },
          'outputPath',
        ],
        [
          'outputPath 不是字符串',
          { documentId: 1, format: 'docx', outputPath: 5 },
          'outputPath',
        ],
        [
          'overwrite 是字符串',
          { documentId: 1, format: 'docx', overwrite: 'true' },
          'overwrite',
        ],
        [
          'overwrite 是数字',
          { documentId: 1, format: 'docx', overwrite: 1 },
          'overwrite',
        ],
        [
          '未知参数',
          { documentId: 1, format: 'docx', path: '/tmp/a.docx' },
          'path',
        ],
        [
          '未知参数 createdAt',
          { documentId: 1, format: 'docx', createdAt: '2026-01-01T00:00:00Z' },
          'createdAt',
        ],
      ];
      it.each(cases)('%s', async (_name, args, mention) => {
        const id = await createDoc();
        const service = t.app.get(ExportService);
        const exportDocx = jest.spyOn(service, 'exportDocx');
        const result = await mcp.call(
          'export_document',
          args.documentId === undefined ? args : { ...args, documentId: id },
        );
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(400);
        expect(result.body.message).toContain(mention);
        expect(exportDocx).not.toHaveBeenCalled();
        expect(await readdir(dir)).toEqual([]);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('export_document 的 outputPath（本地部署：写到本机的允许目录）', () => {
    /** 允许目录（dir）之外的另一个目录。 */
    let outside: string;
    beforeEach(async () => {
      outside = await mkdtemp(join(tmpdir(), 'ses-mcp-outside-'));
    });
    afterEach(async () => {
      await rm(outside, { recursive: true, force: true });
    });

    const exportTo = (
      id: number,
      format: string,
      outputPath: string,
      overwrite?: boolean,
    ) =>
      mcp.call('export_document', {
        documentId: id,
        format,
        outputPath,
        ...(overwrite === undefined ? {} : { overwrite }),
      });

    it.each(['docx', 'pdf', 'html', 'json'] as const)(
      '%s：写入文件，savedTo 是最终绝对路径，size 等于文件大小',
      async (format) => {
        const id = await createDoc();
        const outputPath = join(dir, `result.${format}`);
        const result = await exportTo(id, format, outputPath);
        expect(result.isError).toBe(false);
        expect(result.body.savedTo).toBe(outputPath);
        expect(result.body.downloadUrl).toBe(
          `${t.url}/api/documents/${id}/export/${format}`,
        );
        const file = await readFile(outputPath);
        expect(result.body.size).toBe(file.length);
        if (format === 'pdf') expect(file.equals(PDF_STUB)).toBe(true);
        if (format === 'docx') {
          expect(file.subarray(0, 2).toString('latin1')).toBe('PK');
          expect(readZipEntries(file).has('word/document.xml')).toBe(true);
        }
        if (format === 'html' || format === 'json') {
          const response = await rest(`/api/documents/${id}/export/${format}`);
          expect(file.equals(response.bytes)).toBe(true);
        }
        expect(await readdir(dir)).toEqual([`result.${format}`]);
      },
    );

    it('扩展名大小写不敏感；路径被规范化后返回', async () => {
      const id = await createDoc();
      await mkdir(join(dir, 'sub'));
      const result = await exportTo(id, 'json', `${dir}/sub/../Result.JSON`);
      expect(result.isError).toBe(false);
      expect(result.body.savedTo).toBe(join(dir, 'Result.JSON'));
      await expect(stat(join(dir, 'Result.JSON'))).resolves.toBeDefined();
    });

    describe('路径不合规：400，不导出、不写文件', () => {
      it.each([
        ['路径含空字符', () => `${dir}/result\0.docx`, 'invalid-output-path'],
        [
          '扩展名与格式不符',
          () => join(dir, 'result.pdf'),
          'invalid-output-extension',
        ],
        ['没有扩展名', () => join(dir, 'result'), 'invalid-output-extension'],
        [
          '父目录不存在',
          () => join(dir, 'missing', 'result.docx'),
          'parent-not-found',
        ],
      ])('%s', async (_name, path, code) => {
        const id = await createDoc();
        const service = t.app.get(ExportService);
        const exportDocx = jest.spyOn(service, 'exportDocx');
        const result = await exportTo(id, 'docx', path());
        expect(result.isError).toBe(true);
        expect(result.body).toMatchObject({ status: 400, code });
        expect(exportDocx).not.toHaveBeenCalled();
        expect(await readdir(dir)).toEqual([]);
      });

      it('父路径是文件', async () => {
        const id = await createDoc();
        await writeFile(join(dir, 'file'), 'x');
        const result = await exportTo(id, 'docx', join(dir, 'file', 'a.docx'));
        expect(result.body).toMatchObject({
          status: 400,
          code: 'parent-not-directory',
        });
        expect(await readFile(join(dir, 'file'), 'utf8')).toBe('x');
      });

      it('错误消息可以含路径（返回给调用方本人）', async () => {
        const id = await createDoc();
        const result = await exportTo(
          id,
          'docx',
          join(dir, 'missing', 'a.docx'),
        );
        expect(result.body.message).toContain(join(dir, 'missing'));
      });
    });

    describe('只能写到允许目录（SES_MCP_OUTPUT_DIRS）', () => {
      const NOT_ALLOWED = { status: 403, code: 'output-dir-not-allowed' };

      it('只给文件名：保存到第一个允许目录，savedTo 是实际路径', async () => {
        const id = await createDoc();
        const result = await exportTo(id, 'docx', '规范.docx');
        expect(result.isError).toBe(false);
        expect(result.body.savedTo).toBe(join(dir, '规范.docx'));
        const file = await readFile(join(dir, '规范.docx'));
        expect(result.body.size).toBe(file.length);
        expect(file.subarray(0, 2).toString('latin1')).toBe('PK');
        expect(await readdir(dir)).toEqual(['规范.docx']);
      });

      it('相对路径含已存在的子目录；overwrite 同样适用', async () => {
        const id = await createDoc();
        await mkdir(join(dir, 'sub'));
        const first = await exportTo(id, 'json', 'sub/./a.json');
        expect(first.body.savedTo).toBe(join(dir, 'sub', 'a.json'));
        const again = await exportTo(id, 'json', 'sub/a.json');
        expect(again.body).toMatchObject({ status: 409, code: 'file-exists' });
        const replaced = await exportTo(id, 'json', 'sub/a.json', true);
        expect(replaced.isError).toBe(false);
      });

      it.each([
        ['..', () => '../escape.json'],
        ['多级 ..', () => 'sub/../../escape.json'],
        ['绝对路径里的 ..', () => `${dir}/../escape.json`],
        ['兄弟目录', () => `../${basename(outside)}/escape.json`],
      ])('相对路径用 %s 逃逸 → 403，不导出、不写文件', async (_name, path) => {
        const id = await createDoc();
        await mkdir(join(dir, 'sub'));
        const exportJson = jest.spyOn(t.app.get(ExportService), 'exportJson');
        const result = await exportTo(id, 'json', path());
        expect(result.isError).toBe(true);
        expect(result.body).toMatchObject(NOT_ALLOWED);
        expect(exportJson).not.toHaveBeenCalled();
        expect(await readdir(outside)).toEqual([]);
        await expect(stat(join(dirname(dir), 'escape.json'))).rejects.toThrow();
        expect(await readdir(dir)).toEqual(['sub']);
      });

      it('绝对路径在允许目录之外 → 403：消息列出允许的目录并提示怎么办；不跑导出管线', async () => {
        const id = await createDoc();
        const convertHtmlToPdf = jest.spyOn(convert, 'convertHtmlToPdf');
        const target = join(outside, 'a.pdf');
        const result = await exportTo(id, 'pdf', target);
        expect(result.isError).toBe(true);
        expect(result.body).toMatchObject(NOT_ALLOWED);
        expect(result.body.message).toContain(`允许的目录：${dir}`);
        expect(result.body.message).toContain(`只给文件名即可保存到 ${dir}`);
        expect(result.body.message).toContain(OUTPUT_DIRS_ENV);
        expect(convertHtmlToPdf).not.toHaveBeenCalled();
        expect(await readdir(outside)).toEqual([]);
      });

      it('多个允许目录：都可以写，相对路径落在第一个，其余目录里的绝对路径照常；不在其中的仍被拒绝', async () => {
        process.env[OUTPUT_DIRS_ENV] = [dir, outside].join(delimiter);
        const id = await createDoc();
        const bare = await exportTo(id, 'json', 'a.json');
        expect(bare.body.savedTo).toBe(join(dir, 'a.json'));
        const second = await exportTo(id, 'json', join(outside, 'b.json'));
        expect(second.body.savedTo).toBe(join(outside, 'b.json'));
        expect(await readdir(outside)).toEqual(['b.json']);

        const third = await mkdtemp(join(tmpdir(), 'ses-mcp-third-'));
        try {
          const rejected = await exportTo(id, 'json', join(third, 'c.json'));
          expect(rejected.body).toMatchObject(NOT_ALLOWED);
          expect(rejected.body.message).toContain(`${dir}、${outside}`);
          expect(await readdir(third)).toEqual([]);
        } finally {
          await rm(third, { recursive: true, force: true });
        }
      });

      it('运行中修改 SES_MCP_OUTPUT_DIRS 立即生效（每次调用重新读取）', async () => {
        const id = await createDoc();
        const target = join(outside, 'a.json');
        expect((await exportTo(id, 'json', target)).body).toMatchObject(
          NOT_ALLOWED,
        );
        process.env[OUTPUT_DIRS_ENV] = [dir, outside].join(delimiter);
        expect((await exportTo(id, 'json', target)).isError).toBe(false);
      });

      it('无效配置项（相对路径、空项）被忽略', async () => {
        process.env[OUTPUT_DIRS_ENV] = ['relative/dir', '', dir, ' '].join(
          delimiter,
        );
        const id = await createDoc();
        const result = await exportTo(id, 'json', 'a.json');
        expect(result.body.savedTo).toBe(join(dir, 'a.json'));
        const rejected = await exportTo(id, 'json', join(outside, 'a.json'));
        expect(rejected.body).toMatchObject(NOT_ALLOWED);
        expect(rejected.body.message).not.toContain('relative');
      });

      itPosix(
        '允许目录内指向外部的符号链接目录 → 403，外部目录没有任何文件',
        async () => {
          const id = await createDoc();
          await symlink(outside, join(dir, 'out'));
          for (const path of [join(dir, 'out', 'a.json'), 'out/a.json']) {
            const result = await exportTo(id, 'json', path);
            expect(result.isError).toBe(true);
            expect(result.body).toMatchObject(NOT_ALLOWED);
            // overwrite 也不能绕过
            const forced = await exportTo(id, 'json', path, true);
            expect(forced.body).toMatchObject(NOT_ALLOWED);
          }
          expect(await readdir(outside)).toEqual([]);
        },
      );

      describe('未配置：默认导出目录 <主目录>/SES-exports', () => {
        let home: string;
        let defaultDir: string;
        beforeEach(async () => {
          // 注入主目录：替换 os.homedir()，真实的 ~/SES-exports 不会被碰到。
          home = await mkdtemp(join(tmpdir(), `ses-mcp-home-${DIR_TOKEN}-`));
          defaultDir = join(home, DEFAULT_OUTPUT_DIR_NAME);
          delete process.env[OUTPUT_DIRS_ENV];
          jest
            .spyOn(
              jest.requireActual<typeof import('node:os')>('node:os'),
              'homedir',
            )
            .mockReturnValue(home);
        });
        afterEach(async () => {
          await rm(home, { recursive: true, force: true });
        });

        it('只给文件名：自动创建默认导出目录并写入，savedTo 是该目录里的路径', async () => {
          const id = await createDoc();
          await expect(stat(defaultDir)).rejects.toThrow();
          const result = await exportTo(id, 'docx', '规范.docx');
          expect(result.isError).toBe(false);
          expect(result.body.savedTo).toBe(join(defaultDir, '规范.docx'));
          expect((await stat(defaultDir)).isDirectory()).toBe(true);
          if (process.platform !== 'win32') {
            expect((await stat(defaultDir)).mode & 0o777).toBe(0o700);
          }
          const file = await readFile(join(defaultDir, '规范.docx'));
          expect(result.body.size).toBe(file.length);
          expect(readZipEntries(file).has('word/document.xml')).toBe(true);
          expect(await readdir(home)).toEqual([DEFAULT_OUTPUT_DIR_NAME]);
          // 临时目录（本来的允许目录）没有被写。
          expect(await readdir(dir)).toEqual([]);
        });

        it('默认导出目录之外的绝对路径与 .. 逃逸 → 403，且不会为此创建目录', async () => {
          const id = await createDoc();
          for (const path of [join(dir, 'a.json'), '../a.json']) {
            const result = await exportTo(id, 'json', path);
            expect(result.body).toMatchObject(NOT_ALLOWED);
            expect(result.body.message).toContain(defaultDir);
          }
          expect(await readdir(home)).toEqual([]);
          expect(await readdir(dir)).toEqual([]);
        });

        it('不给 outputPath 时不创建任何目录', async () => {
          const id = await createDoc();
          const result = await mcp.call('export_document', {
            documentId: id,
            format: 'json',
          });
          expect(result.isError).toBe(false);
          expect(await readdir(home)).toEqual([]);
        });

        it('日志不含默认导出目录的路径', async () => {
          const logs = captureLogs();
          const id = await createDoc();
          const result = await exportTo(id, 'json', `${DIR_TOKEN}-文件.json`);
          expect(result.isError).toBe(false);
          const logged = logs.text();
          expect(logged).toContain(`文档 #${id} 的 json 导出文件已写入本机`);
          expect(logged).not.toContain(DIR_TOKEN);
          expect(logged).not.toContain(home);
        });
      });
    });

    describe('目标已存在', () => {
      it('不覆盖（默认）：409 file-exists，原文件不变；overwrite 为 false 同样', async () => {
        const id = await createDoc();
        const target = join(dir, 'a.json');
        await writeFile(target, '原内容');
        for (const overwrite of [undefined, false]) {
          const result = await exportTo(id, 'json', target, overwrite);
          expect(result.isError).toBe(true);
          expect(result.body.status).toBe(409);
          expect(result.body.code).toBe('file-exists');
          expect(result.body.message).toContain(target);
          expect(result.body.message).toContain('overwrite');
          expect(await readFile(target, 'utf8')).toBe('原内容');
        }
        expect(await readdir(dir)).toEqual(['a.json']);
      });

      it('不覆盖时先于导出失败（不白白跑一遍管线）', async () => {
        const id = await createDoc();
        const target = join(dir, 'a.pdf');
        await writeFile(target, '原内容');
        const convertHtmlToPdf = jest.spyOn(convert, 'convertHtmlToPdf');
        const result = await exportTo(id, 'pdf', target);
        expect(result.body.code).toBe('file-exists');
        expect(convertHtmlToPdf).not.toHaveBeenCalled();
      });

      it('overwrite: true：原子替换，内容是新导出的，不留临时文件', async () => {
        const id = await createDoc();
        const target = join(dir, 'a.html');
        await writeFile(target, '原内容');
        const result = await exportTo(id, 'html', target, true);
        expect(result.isError).toBe(false);
        expect(result.body.savedTo).toBe(target);
        const response = await rest(`/api/documents/${id}/export/html`);
        expect((await readFile(target)).equals(response.bytes)).toBe(true);
        expect(await readdir(dir)).toEqual(['a.html']);
      });

      itPosix(
        '目标是指向别处的符号链接：不覆盖 → 409，链接目标不变',
        async () => {
          const id = await createDoc();
          const real = join(dir, 'real.json');
          const link = join(dir, 'link.json');
          await writeFile(real, '链接目标');
          await symlink(real, link);
          const result = await exportTo(id, 'json', link);
          expect(result.body.code).toBe('file-exists');
          expect(await readFile(real, 'utf8')).toBe('链接目标');
        },
      );

      itPosix(
        '目标是指向别处的符号链接：overwrite 只替换链接本身，链接目标不变',
        async () => {
          const id = await createDoc();
          const real = join(dir, 'real.json');
          const link = join(dir, 'link.json');
          await writeFile(real, '链接目标');
          await symlink(real, link);
          const result = await exportTo(id, 'json', link, true);
          expect(result.isError).toBe(false);
          expect(await readFile(real, 'utf8')).toBe('链接目标');
          const response = await rest(`/api/documents/${id}/export/json`);
          expect((await readFile(link)).equals(response.bytes)).toBe(true);
          expect(await readdir(dir)).toEqual(['link.json', 'real.json']);
        },
      );

      itPosix(
        'overwrite 的目标是目录：400 path-is-directory，目录不变，不留临时文件',
        async () => {
          const id = await createDoc();
          const target = join(dir, 'a.json');
          await mkdir(target);
          const result = await exportTo(id, 'json', target, true);
          expect(result.body).toMatchObject({
            status: 400,
            code: 'path-is-directory',
          });
          expect((await stat(target)).isDirectory()).toBe(true);
          expect(await readdir(dir)).toEqual(['a.json']);
        },
      );
    });

    describe('环境变量 SES_MCP_ALLOW_FILE_WRITE 关闭写文件', () => {
      it.each(['0', 'false', 'FALSE', ' False '])(
        '设为 %j：给了 outputPath → 403 file-write-disabled，不导出、不写文件',
        async (value) => {
          process.env[FILE_WRITE_ENV] = value;
          const id = await createDoc();
          const service = t.app.get(ExportService);
          const exportHtml = jest.spyOn(service, 'exportHtml');
          const result = await exportTo(id, 'html', join(dir, 'a.html'));
          expect(result.isError).toBe(true);
          expect(result.body).toMatchObject({
            status: 403,
            code: 'file-write-disabled',
          });
          expect(result.body.message).toContain(FILE_WRITE_ENV);
          expect(exportHtml).not.toHaveBeenCalled();
          expect(await readdir(dir)).toEqual([]);
        },
      );

      it('关闭后不给 outputPath 照常导出，返回下载地址', async () => {
        process.env[FILE_WRITE_ENV] = '0';
        const id = await createDoc();
        const result = await mcp.call('export_document', {
          documentId: id,
          format: 'html',
        });
        expect(result.isError).toBe(false);
        expect(result.body.downloadUrl).toContain(`/export/html`);
        expect(result.body).not.toHaveProperty('savedTo');
      });

      it('关闭后 overwrite 也不能绕过', async () => {
        process.env[FILE_WRITE_ENV] = 'false';
        const id = await createDoc();
        const target = join(dir, 'a.json');
        await writeFile(target, '原内容');
        const result = await exportTo(id, 'json', target, true);
        expect(result.body.code).toBe('file-write-disabled');
        expect(await readFile(target, 'utf8')).toBe('原内容');
      });

      it.each([undefined, '', '1', 'true', 'TRUE'])(
        '设为 %j：允许写文件',
        async (value) => {
          if (value === undefined) delete process.env[FILE_WRITE_ENV];
          else process.env[FILE_WRITE_ENV] = value;
          const id = await createDoc();
          const result = await exportTo(id, 'json', join(dir, 'a.json'));
          expect(result.isError).toBe(false);
        },
      );

      it('运行中修改环境变量立即生效（每次调用重新读取）', async () => {
        const id = await createDoc();
        process.env[FILE_WRITE_ENV] = '0';
        expect((await exportTo(id, 'json', join(dir, 'a.json'))).isError).toBe(
          true,
        );
        process.env[FILE_WRITE_ENV] = '1';
        expect((await exportTo(id, 'json', join(dir, 'a.json'))).isError).toBe(
          false,
        );
      });
    });

    describe('日志不含路径', () => {
      let secretDir: string;
      beforeEach(async () => {
        secretDir = join(dir, `${DIR_TOKEN}-目录`);
        await mkdir(secretDir);
      });

      it('成功写入：日志有文档 id、格式、字节数，没有路径', async () => {
        const logs = captureLogs();
        const id = await createDoc();
        const target = join(secretDir, `${DIR_TOKEN}-文件.json`);
        const result = await exportTo(id, 'json', target);
        expect(result.isError).toBe(false);
        const logged = logs.text();
        expect(logged).toContain(`文档 #${id} 的 json 导出文件已写入本机`);
        expect(logged).not.toContain(DIR_TOKEN);
        expect(logged).not.toContain(dir);
      });

      it('各种失败（已存在、父目录不存在、扩展名不符、不在允许目录、开关关闭）：响应带路径，日志不带', async () => {
        const logs = captureLogs();
        const id = await createDoc();
        const target = join(secretDir, `${DIR_TOKEN}-文件.json`);
        await writeFile(target, 'x');
        const failures = [
          await exportTo(id, 'json', target), // 已存在
          await exportTo(id, 'json', join(dir, `${DIR_TOKEN}-缺失`, 'a.json')),
          await exportTo(id, 'json', join(secretDir, `${DIR_TOKEN}.txt`)),
          await exportTo(id, 'json', join(outside, `${DIR_TOKEN}-外部.json`)), // 不在允许目录
          await exportTo(id, 'json', `../${DIR_TOKEN}-逃逸.json`), // .. 逃逸
        ];
        process.env[FILE_WRITE_ENV] = '0';
        failures.push(await exportTo(id, 'json', target));
        expect(failures.every((f) => f.isError)).toBe(true);
        expect(failures[3].body).toMatchObject({
          status: 403,
          code: 'output-dir-not-allowed',
        });
        expect(failures[4].body.code).toBe('output-dir-not-allowed');
        // 响应里有路径（这是返回给调用方本人的）。
        expect(failures[0].body.message).toContain(DIR_TOKEN);
        expect(failures[1].body.message).toContain(DIR_TOKEN);
        expect(failures[3].body.message).toContain(DIR_TOKEN);
        // 日志里没有。
        expect(logs.text()).not.toContain(DIR_TOKEN);
        expect(logs.text()).not.toContain(dir);
        expect(logs.text()).not.toContain(outside);
      });

      itPosix(
        '写入阶段失败（覆盖目录）：日志只有错误码，没有路径',
        async () => {
          const logs = captureLogs();
          const id = await createDoc();
          const target = join(secretDir, `${DIR_TOKEN}.json`);
          await mkdir(target);
          const result = await exportTo(id, 'json', target, true);
          expect(result.body.code).toBe('path-is-directory');
          const logged = logs.text();
          expect(logged).toContain(
            `文档 #${id} 的 json 导出文件写入本机失败（path-is-directory）`,
          );
          expect(logged).not.toContain(DIR_TOKEN);
          expect(logged).not.toContain(dir);
        },
      );
    });

    it('不暴露文档正文：日志里没有正文', async () => {
      const logs = captureLogs();
      const id = await createDoc(chapterDoc([paragraph('p1', SECRET)]));
      await exportTo(id, 'html', join(dir, 'a.html'));
      await mcp.call('export_document', { documentId: id, format: 'docx' });
      expect(logs.text()).not.toContain(SECRET);
    });
  });
});
