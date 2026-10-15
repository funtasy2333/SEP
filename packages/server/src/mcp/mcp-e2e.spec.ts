/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call --
   工具结果是运行时解析出来的 JSON（形状因工具而异），用例按需逐字段断言，不为每种形状单独声明类型。 */
import { get, type ClientRequest } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { PMJsonNode } from '@ses/shared';
import { ConvertService } from '../convert/convert.service';
import { pdfPageCount } from '../convert/pdf/build';
import type { DocumentChangeEvent } from '../document/document-events.service';
import { readZipEntries } from '../export/__fixtures__/read-zip';
import { WARNING_COUNT_HEADER, WARNINGS_HEADER } from '../export/export-http';
import {
  connectMcp,
  TEST_CLIENT_INFO,
  type McpTestClient,
} from '../test-support/mcp-test-client';
import { createTestApp, type TestApp } from '../test-support/test-app';
import { OUTPUT_DIRS_ENV } from './mcp-file-output';

/**
 * 端到端（WP9.3b）：经 SDK Client 走真实 HTTP，模拟人机接力——
 * AI 建文档并写入 → 人在编辑器里修改并保存 → AI 用过期 revision 写入被拒 → AI 重读后续写 →
 * 校验 → 出件（DOCX/PDF/HTML/JSON）→ 核对版本记录与变更事件。
 *
 * 用例按顺序共享状态（同一个文档），不要单独运行其中某一个。
 */

/** 真实 SSE 连接：累积收到的事件，供等待与断言。 */
interface SseStream {
  events(): DocumentChangeEvent[];
  waitForEvents(count: number, timeoutMs?: number): Promise<void>;
  close(): void;
}

function openSse(url: string): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    let received = '';
    const waiters = new Set<() => void>();
    const parse = (): DocumentChangeEvent[] =>
      received
        .split('\n\n')
        .filter((block) => block.includes('event: document-changed'))
        .map((block) => {
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          return JSON.parse(line!.slice(6)) as DocumentChangeEvent;
        });
    const request: ClientRequest = get(
      url,
      { headers: { Accept: 'text/event-stream' } },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          received += chunk;
          waiters.forEach((wake) => wake());
          // 服务端先写 `retry:` 再订阅（同一同步段内），收到它就说明订阅已建立。
          if (received.includes('retry:')) resolveOnce();
        });
        res.on('error', () => undefined);
      },
    );
    let resolved = false;
    const resolveOnce = () => {
      if (resolved) return;
      resolved = true;
      resolve({
        events: parse,
        waitForEvents: (count, timeoutMs = 5000) =>
          new Promise<void>((done, fail) => {
            const check = () => {
              if (parse().length >= count) {
                clearTimeout(timer);
                waiters.delete(check);
                done();
              }
            };
            const timer = setTimeout(() => {
              waiters.delete(check);
              fail(new Error(`等待 ${count} 个 SSE 事件超时：${received}`));
            }, timeoutMs);
            waiters.add(check);
            check();
          }),
        close: () => request.destroy(),
      });
    };
    request.on('error', (error) => {
      if (!request.destroyed) reject(error);
    });
  });
}

describe('人机接力端到端（MCP + REST，真实 HTTP）', () => {
  let t: TestApp;
  let mcp: McpTestClient;
  let sse: SseStream;
  let dir: string;

  // 跨用例共享的状态。
  let documentId: number;
  let scopeChapterId: string;
  let afterAiFirst: number;
  const HUMAN_TEXT = '人在编辑器里补充的一段。';
  const AI_TEXT_1 = '本文件规定了标准化文件编辑系统的通用要求。';
  const AI_TEXT_2 = 'AI 读到人的修改后续写的一段。';
  const AI_STALE_TEXT = '这段基于过期 revision，不应写入。';

  /** PDF 管线是否可用：与导出接口、/api/convert/capabilities 是同一个判断。 */
  let pdfAvailable: boolean;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    t = await createTestApp();
    mcp = await connectMcp(t);
    dir = await mkdtemp(join(tmpdir(), 'ses-mcp-e2e-'));
    // outputPath 只能写到允许目录：把临时目录设为唯一的允许目录（不会碰真实的 ~/SES-exports）。
    process.env[OUTPUT_DIRS_ENV] = dir;
    pdfAvailable = t.app.get(ConvertService).getCapabilities().htmlToPdf;
  });
  afterAll(async () => {
    sse?.close();
    await mcp.close();
    await t.app.close();
    delete process.env[OUTPUT_DIRS_ENV];
    await rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  /** 以二进制取回 REST 响应体。 */
  async function download(path: string): Promise<{
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

  const chapterTitle = (node: PMJsonNode): string =>
    node.content
      ?.find((child) => child.type === 'chapterTitle')
      ?.content?.map((text) => text.text ?? '')
      .join('') ?? '';

  it('1. AI 新建文档，并用返回的 revision 写入「范围」一段', async () => {
    const created = await mcp.call('create_document', {
      titleCn: '端到端测试标准',
      standardType: 'national',
    });
    expect(created.isError).toBe(false);
    documentId = created.body.documentId;
    expect(created.body.revision).toBe(0);

    // 先订阅事件，再开始写入（SSE 不重放历史事件）。
    sse = await openSse(`${t.url}/api/documents/${documentId}/events`);

    const outline = await mcp.call('get_outline', { documentId });
    expect(outline.body.revision).toBe(0); // create_document 产出的内容已规范，读取不写库
    const scope = outline.body.outline.body.find(
      (item: { title: string }) => item.title === '范围',
    );
    expect(scope).toBeDefined();
    scopeChapterId = scope.nodeId;

    const applied = await mcp.call('apply_operations', {
      documentId,
      baseRevision: created.body.revision,
      operations: [
        {
          op: 'insert',
          parent: scopeChapterId,
          position: 'end',
          content: [AI_TEXT_1],
        },
      ],
      note: '写入范围',
    });
    expect(applied.isError).toBe(false);
    expect(applied.body.revision).toBe(1);
    afterAiFirst = applied.body.revision;
  });

  it('2. 人按编辑器的做法保存：GET 文档、在内容里加一段、PUT 带 baseRevision', async () => {
    const fetched = await t.http
      .get(`/api/documents/${documentId}`)
      .expect(200);
    const doc = fetched.body as {
      revision: number;
      content: PMJsonNode;
    };
    expect(doc.revision).toBe(afterAiFirst);

    const chapter = doc.content.content!.find(
      (node) => node.type === 'chapter' && chapterTitle(node) === '范围',
    )!;
    // AI 写入的那一段已经在文档里。
    expect(JSON.stringify(chapter)).toContain(AI_TEXT_1);
    chapter.content!.push({
      type: 'stdParagraph',
      attrs: { nodeId: 'human-p-1' },
      content: [{ type: 'text', text: HUMAN_TEXT }],
    });

    const saved = await t.http
      .put(`/api/documents/${documentId}`)
      .send({ baseRevision: doc.revision, content: doc.content })
      .expect(200);
    expect((saved.body as { revision: number }).revision).toBe(2);
  });

  it('3. AI 用旧 revision 写入被拒（409）；重读后看到人的修改，用新 revision 续写成功', async () => {
    const stale = await mcp.call('apply_operations', {
      documentId,
      baseRevision: afterAiFirst, // 人保存之前的 revision
      operations: [
        {
          op: 'insert',
          parent: scopeChapterId,
          position: 'end',
          content: [AI_STALE_TEXT],
        },
      ],
    });
    expect(stale.isError).toBe(true);
    expect(stale.body.status).toBe(409);
    expect(stale.body.revision).toBe(2);
    expect(stale.body.message).toContain('请重新读取');

    const outline = await mcp.call('get_outline', { documentId });
    expect(outline.body.revision).toBe(2);
    const node = await mcp.call('get_node', {
      documentId,
      nodeId: scopeChapterId,
    });
    expect(node.body.revision).toBe(2);
    const seen = JSON.stringify(node.body.node);
    expect(seen).toContain(AI_TEXT_1);
    expect(seen).toContain(HUMAN_TEXT);
    expect(seen).not.toContain(AI_STALE_TEXT);

    const resumed = await mcp.call('apply_operations', {
      documentId,
      baseRevision: node.body.revision,
      operations: [
        {
          op: 'insert',
          parent: scopeChapterId,
          position: 'end',
          content: [AI_TEXT_2],
        },
      ],
      note: '续写范围',
    });
    expect(resumed.isError).toBe(false);
    expect(resumed.body.revision).toBe(3);

    // 文档里按顺序是：AI、人、AI；过期的那段没有写入。
    const stored = JSON.stringify(
      (await t.documents.findOne(documentId)).content,
    );
    expect(stored.indexOf(AI_TEXT_1)).toBeLessThan(stored.indexOf(HUMAN_TEXT));
    expect(stored.indexOf(HUMAN_TEXT)).toBeLessThan(stored.indexOf(AI_TEXT_2));
    expect(stored).not.toContain(AI_STALE_TEXT);
  });

  it('4. validate_document：三种格式的导出前检查都通过，且不修改文档', async () => {
    const before = await t.documents.findOne(documentId);
    const result = await mcp.call('validate_document', { documentId });
    expect(result.isError).toBe(false);
    expect(result.body.revision).toBe(3);
    expect(result.body.exports).toEqual({
      docx: { ok: true },
      pdf: { ok: true, available: pdfAvailable },
      html: { ok: true },
    });
    expect(result.body.problems).toBeInstanceOf(Array);
    // 初始骨架的空章节只是提示级别，不应有 error。
    expect(
      result.body.problems.filter(
        (problem: { severity: string }) => problem.severity === 'error',
      ),
    ).toEqual([]);

    const after = await t.documents.findOne(documentId);
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  /** 调用 export_document（只给文件名）保存到允许目录（临时目录），返回工具结果与文件内容。 */
  async function exportToFile(
    format: 'docx' | 'pdf' | 'html' | 'json',
  ): Promise<{
    result: Awaited<ReturnType<McpTestClient['call']>>;
    file: Buffer;
  }> {
    const outputPath = join(dir, `result.${format}`);
    const result = await mcp.call('export_document', {
      documentId,
      format,
      outputPath: `result.${format}`,
    });
    expect(result.isError).toBe(false);
    // 只给文件名 → 保存到第一个允许目录，savedTo 是实际路径。
    expect(result.body.savedTo).toBe(outputPath);
    expect(result.body.format).toBe(format);
    expect(result.body.filename).toBe(`端到端测试标准.${format}`);
    expect(result.body.downloadUrl).toBe(
      `${t.url}/api/documents/${documentId}/export/${format}`,
    );
    const file = await readFile(outputPath);
    expect(result.body.size).toBe(file.length);
    // 工具结果里没有文件内容。
    expect(JSON.stringify(result.body).length).toBeLessThan(1000);
    return { result, file };
  }

  it('5a. export_document docx：写到临时目录，各部件与 REST 导出一致（core.xml 的时间除外）', async () => {
    const { result, file } = await exportToFile('docx');
    expect(file.subarray(0, 2).toString('latin1')).toBe('PK');

    // 下载地址可直接使用，得到的就是 REST 导出。
    const rest = await download(new URL(result.body.downloadUrl).pathname);
    expect(rest.status).toBe(200);

    // 告警与 REST 响应头 X-SES-Export-Warnings 同一来源（头里是 encodeURIComponent 的 JSON，条数在 Count 头）。
    const header = rest.headers[WARNINGS_HEADER.toLowerCase()];
    const headerWarnings = JSON.parse(decodeURIComponent(header));
    expect(result.body.warnings).toEqual(headerWarnings);
    expect(result.body.warnings).toHaveLength(
      Number(rest.headers[WARNING_COUNT_HEADER.toLowerCase()]),
    );
    // 国家标准封面的发布机构图片取自模板，导出时有这条告警。
    expect(result.body.warnings.map((w: { code: string }) => w.code)).toContain(
      'cover-asset-approximation',
    );

    const mine = readZipEntries(file);
    const theirs = readZipEntries(rest.bytes);
    expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort());
    expect(mine.has('word/document.xml')).toBe(true);
    for (const [name, content] of mine) {
      if (name === 'docProps/core.xml') continue; // 含导出时间
      expect(content.equals(theirs.get(name)!)).toBe(true);
    }
    // 文档里的内容确实在 DOCX 里。
    const body = mine.get('word/document.xml')!.toString('utf8');
    expect(body).toContain(AI_TEXT_1);
    expect(body).toContain(HUMAN_TEXT);
    expect(body).toContain(AI_TEXT_2);
  });

  it.each(['html', 'json'] as const)(
    '5b. export_document %s：文件与 REST 导出逐字节一致',
    async (format) => {
      const { result, file } = await exportToFile(format);
      expect(result.body.warnings).toEqual([]);
      const rest = await download(
        `/api/documents/${documentId}/export/${format}`,
      );
      expect(rest.status).toBe(200);
      expect(file.equals(rest.bytes)).toBe(true);
      expect(file.toString('utf8')).toContain(HUMAN_TEXT);
    },
  );

  it('5c. export_document pdf：管线可用时文件是 PDF 且页数与 REST 一致；不可用时映射为 503', async () => {
    if (!pdfAvailable) {
      const result = await mcp.call('export_document', {
        documentId,
        format: 'pdf',
        outputPath: 'unavailable.pdf',
      });
      expect(result.isError).toBe(true);
      expect(result.body.status).toBe(503);
      expect(result.body.message).toContain('PDF 导出不可用');
      await expect(stat(join(dir, 'unavailable.pdf'))).rejects.toThrow();
      const rest = await download(`/api/documents/${documentId}/export/pdf`);
      expect(rest.status).toBe(503);
      return;
    }

    const { result, file } = await exportToFile('pdf');
    expect(result.body.warnings).toEqual([]);
    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const rest = await download(`/api/documents/${documentId}/export/pdf`);
    expect(rest.status).toBe(200);
    expect(rest.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const restPath = join(dir, 'rest.pdf');
    await writeFile(restPath, rest.bytes);
    const pages = await pdfPageCount(join(dir, 'result.pdf'));
    expect(pages).toBeGreaterThan(0);
    expect(pages).toBe(await pdfPageCount(restPath));
  }, 240_000);

  it('5d. export_document：绝对路径在允许目录之外、或用 .. 逃出允许目录 → 403 output-dir-not-allowed，不写任何文件', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'ses-mcp-e2e-outside-'));
    try {
      for (const outputPath of [
        join(outside, 'result.json'),
        '../ses-mcp-e2e-escape.json',
      ]) {
        const result = await mcp.call('export_document', {
          documentId,
          format: 'json',
          outputPath,
        });
        expect(result.isError).toBe(true);
        expect(result.body).toMatchObject({
          status: 403,
          code: 'output-dir-not-allowed',
        });
        expect(result.body.message).toContain(dir);
      }
      await expect(stat(join(outside, 'result.json'))).rejects.toThrow();
      await expect(
        stat(join(dirname(dir), 'ses-mcp-e2e-escape.json')),
      ).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('6. 版本记录与变更事件：两条 AI 版本（client 为测试客户端名），人的保存不产生版本；事件顺序 ai → human → ai', async () => {
    const versions = await t.versions.findByDocument(documentId);
    expect(versions).toHaveLength(2);
    // 最新在前。
    expect(versions.map((v) => v.note)).toEqual(['续写范围', '写入范围']);
    for (const version of versions) {
      expect(version.source).toBe('ai');
      expect(version.client).toBe(TEST_CLIENT_INFO.name);
    }

    await sse.waitForEvents(3);
    const events = sse.events();
    expect(events.map((e) => [e.source, e.revision])).toEqual([
      ['ai', 1],
      ['human', 2],
      ['ai', 3],
    ]);
    expect(events.map((e) => e.client)).toEqual([
      TEST_CLIENT_INFO.name,
      undefined,
      TEST_CLIENT_INFO.name,
    ]);
    // 失败的写入（409）、只读的 validate 与导出都没有产生事件。
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.documentId === documentId)).toBe(true);
  });
});
