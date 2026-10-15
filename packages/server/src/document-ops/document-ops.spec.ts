import { get as httpGet } from 'http';
import { ConflictException, Logger } from '@nestjs/common';
import type { DocumentOutline, OutlineItem } from '@ses/io';
import type { PMJsonNode } from '@ses/shared';
import type request from 'supertest';
import { WriteCoordinator } from '../common/write-coordinator';
import type { DocumentChangeEvent } from '../document/document-events.service';
import {
  canonical,
  chapter,
  collectNodeIds,
  doc,
  para,
  sampleDocument,
} from '../test-support/sample-documents';
import {
  connectMcp,
  type McpTestClient,
} from '../test-support/mcp-test-client';
import { createTestApp, type TestApp } from '../test-support/test-app';
import { MAX_NORMALIZE_ATTEMPTS } from './document-ops.service';
import { MAX_NOTE_LENGTH } from './operations-request';

/** HTTP 响应里的文档（日期序列化为字符串）。 */
interface DocBody {
  id: number;
  title: string;
  stage: string;
  content: PMJsonNode | null;
  revision: number;
  updatedAt: string;
}

interface VersionBody {
  id: number;
  documentId: number;
  versionNo: string;
  stage: string;
  content: PMJsonNode;
  baseContent?: PMJsonNode | null;
  xml: string | null;
  note: string | null;
  source: string;
  client: string | null;
}

interface EffectBody {
  index: number;
  op: string;
  inserted: string[];
  removed: string[];
  moved: string[];
  createdContainer?: string;
}

interface OpsBody {
  revision: number;
  operations: EffectBody[];
  problems: Array<{ code: string; introduced: boolean }>;
  warnings: unknown[];
  versionId?: number;
}

interface IssueBody {
  code: string;
  path: string;
  reason: string;
  operationIndex?: number;
}

interface ErrorBody {
  statusCode: number;
  message: string;
  code?: string;
  revision?: number;
  issues?: IssueBody[];
  source?: string;
  detail?: string;
  problems?: Array<Record<string, unknown>>;
}

interface NodeBody {
  revision: number;
  node: {
    nodeId: string;
    kind: string;
    number?: string;
    parent: Record<string, unknown>;
    index: number;
    replaceable: boolean;
  };
}

interface ContainerBody {
  revision: number;
  container: {
    container: string;
    exists: boolean;
    context: Record<string, unknown>;
    nodes: Array<{ id: string; kind: string }>;
  };
}

const SECRET = '机密正文-8f3a91';

/**
 * 取得绑定了 this 的原始方法（在 jest.spyOn 之前调用，mock 实现里用它调用真实逻辑）。
 * 本项目 tsconfig 的 strictBindCallApply 为 false，直接 `.bind()` 得到 any，这里补回类型。
 */
function boundMethod<T extends object, K extends keyof T>(
  target: T,
  name: K,
): T[K] {
  const method = target[name] as unknown as (...args: unknown[]) => unknown;
  return method.bind(target) as T[K];
}

/** supertest 的 res.body 是 any：断言状态码后按预期形状收窄。 */
async function reply<T>(test: request.Test, status: number): Promise<T> {
  const res = await test.expect(status);
  return res.body as T;
}

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
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

const meta = { titleCn: '操作层测试标准', standardType: 'national' };

describe('文档操作层', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await t.app.close();
  });

  async function createDoc(
    content: Record<string, unknown> | null = canonical(sampleDocument()),
    extra: Record<string, unknown> = {},
  ): Promise<number> {
    const body = await reply<DocBody>(
      t.http.post('/api/documents').send({
        title: '测试标准',
        meta,
        stage: 'working_draft',
        content,
        ...extra,
      }),
      201,
    );
    return body.id;
  }

  const getDoc = (id: number) =>
    reply<DocBody>(t.http.get(`/api/documents/${id}`), 200);
  const getVersions = (id: number) =>
    reply<VersionBody[]>(t.http.get(`/api/versions/document/${id}`), 200);
  const getOutline = (id: number) =>
    reply<{ revision: number; outline: DocumentOutline }>(
      t.http.get(`/api/documents/${id}/outline`),
      200,
    );
  const postOps = (id: number, body: unknown) =>
    t.http.post(`/api/documents/${id}/operations`).send(body as object);

  /** 订阅某文档的变更事件，返回收集到的事件列表。 */
  function collectEvents(id: number): DocumentChangeEvent[] {
    const collected: DocumentChangeEvent[] = [];
    t.events.events(id).subscribe((event) => collected.push(event));
    return collected;
  }

  /** 在结构树里按 nodeId 递归查找。 */
  const findItem = (
    items: OutlineItem[],
    nodeId: string,
  ): OutlineItem | undefined => {
    for (const item of items) {
      if (item.nodeId === nodeId) return item;
      const inner = findItem(item.children ?? [], nodeId);
      if (inner) return inner;
    }
    return undefined;
  };

  // ---------------------------------------------------------------------------
  describe('读接口', () => {
    it('outline：返回 revision 与结构树（编号来自 Resolver）；只读，不改 revision、不产生事件和版本', async () => {
      const id = await createDoc();
      const events = collectEvents(id);

      const { revision, outline } = await getOutline(id);
      expect(revision).toBe(0);
      expect(
        outline.body.map((item) => [item.nodeId, item.number, item.title]),
      ).toEqual([
        ['ch-scope', '1', '范围'],
        ['ch-req', '2', '技术要求'],
        ['ch-extra', '3', '附加要求'],
      ]);
      expect(outline.foreword).toMatchObject({ present: true, blockCount: 1 });
      expect(findItem(outline.body, 'cl-2')).toMatchObject({
        kind: 'clause',
        number: '2.2',
        title: '特殊要求',
        level: 1,
      });
      expect(findItem(outline.body, 'tbl-1')).toMatchObject({
        kind: 'table',
        number: '表1',
        title: '性能指标',
      });

      expect((await getDoc(id)).revision).toBe(0);
      expect(await getVersions(id)).toEqual([]);
      expect(events).toEqual([]);
    });

    it('nodes：返回 revision 与节点（IR、编号、父节点、位置）', async () => {
      const id = await createDoc();

      const para = await reply<NodeBody>(
        t.http.get(`/api/documents/${id}/nodes/p-cl-1`),
        200,
      );
      expect(para.revision).toBe(0);
      expect(para.node).toMatchObject({
        nodeId: 'p-cl-1',
        kind: 'paragraph',
        parent: { nodeId: 'cl-1', kind: 'clause' },
        index: 0,
        replaceable: true,
      });

      const clause = await reply<NodeBody>(
        t.http.get(`/api/documents/${id}/nodes/cl-2`),
        200,
      );
      expect(clause.node).toMatchObject({
        kind: 'clause',
        number: '2.2',
        parent: { nodeId: 'ch-req', kind: 'chapter' },
        index: 1,
      });
    });

    it('nodes：找不到的节点 404（带 code），位于表内部的节点 422（带 code 与应读取的外层节点）', async () => {
      const id = await createDoc();

      const missing = await reply<ErrorBody>(
        t.http.get(`/api/documents/${id}/nodes/no-such-node`),
        404,
      );
      expect(missing).toMatchObject({
        statusCode: 404,
        code: 'node-not-found',
      });
      expect(missing.message).toContain('no-such-node');

      const inner = await reply<ErrorBody>(
        t.http.get(`/api/documents/${id}/nodes/tbl-1-r1c1`),
        422,
      );
      expect(inner).toMatchObject({
        statusCode: 422,
        code: 'node-not-addressable',
      });
      expect(inner.message).toContain('tbl-1');

      // 路径参数会被解码；含空格与中文的 id 同样走 404。
      await t.http
        .get(`/api/documents/${id}/nodes/${encodeURIComponent('不存在 的 id')}`)
        .expect(404);
    });

    it('containers：读取前言；不存在的容器 exists=false 且 nodes 为空', async () => {
      const id = await createDoc();

      const foreword = await reply<ContainerBody>(
        t.http.get(`/api/documents/${id}/containers/foreword`),
        200,
      );
      expect(foreword.revision).toBe(0);
      expect(foreword.container).toMatchObject({
        container: 'foreword',
        exists: true,
        context: { parent: 'foreword' },
      });
      expect(foreword.container.nodes.map((node) => node.id)).toEqual(['fw-1']);

      for (const name of ['introduction', 'bibliography']) {
        const absent = await reply<ContainerBody>(
          t.http.get(`/api/documents/${id}/containers/${name}`),
          200,
        );
        expect(absent.container).toMatchObject({
          container: name,
          exists: false,
          nodes: [],
        });
      }
    });

    it('containers：只允许 foreword / introduction / bibliography，其余 400 且不读取文档', async () => {
      const id = await createDoc();
      const findOne = jest.spyOn(t.documents, 'findOne');

      for (const name of ['body', 'appendices', 'chapter', 'x']) {
        const body = await reply<ErrorBody>(
          t.http.get(`/api/documents/${id}/containers/${name}`),
          400,
        );
        expect(body.code).toBe('invalid-container');
        expect(body.message).toContain('foreword');
      }
      expect(findOne).not.toHaveBeenCalled();
    });

    it('文档不存在 404；id 不是整数 400', async () => {
      for (const path of [
        'outline',
        'nodes/p-1',
        'containers/foreword',
        'events',
      ]) {
        await t.http.get(`/api/documents/987654/${path}`).expect(404);
        await t.http.get(`/api/documents/abc/${path}`).expect(400);
      }
    });

    it('内容为空（null、空对象、无顶层节点）读与写都返回 422，不写库', async () => {
      for (const content of [
        null,
        {},
        { type: 'doc' },
        { type: 'doc', content: [] },
      ]) {
        const id = await createDoc(content);
        for (const path of ['outline', 'nodes/p-1', 'containers/foreword']) {
          const body = await reply<ErrorBody>(
            t.http.get(`/api/documents/${id}/${path}`),
            422,
          );
          expect(body.message).toContain('文档内容为空');
        }
        const write = await reply<ErrorBody>(
          postOps(id, {
            baseRevision: 0,
            source: 'ai',
            operations: [{ op: 'delete', nodeId: 'p-1' }],
          }),
          422,
        );
        expect(write.message).toContain('文档内容为空');
        expect((await getDoc(id)).revision).toBe(0);
      }
    });

    it('内容不符合生产 schema：422，source=schema，问题带定位；响应与日志都不含正文', async () => {
      const logs = captureLogs();
      try {
        const id = await createDoc(
          doc(
            chapter('c1', '范围'),
            { type: 'mystery', attrs: { nodeId: 'bad-1' } },
            para('p1', SECRET),
          ) as unknown as Record<string, unknown>,
        );
        const body = await reply<ErrorBody>(
          t.http.get(`/api/documents/${id}/outline`),
          422,
        );
        expect(body.source).toBe('schema');
        expect(body.message).toContain(
          '文档内容不符合编辑器文档结构，无法读取',
        );
        expect(body.problems).toEqual([
          {
            source: 'schema',
            code: 'unknown-node-type',
            message: '未知的节点类型「mystery」',
            path: '/content/1',
            nodeType: 'mystery',
            nodeId: 'bad-1',
          },
        ]);
        expect(JSON.stringify(body)).not.toContain(SECRET);
        const logged = logs.text();
        expect(logged).toContain(`文档 #${id} 内容不符合编辑器文档结构`);
        expect(logged).toContain('unknown-node-type');
        expect(logged).not.toContain('mystery');
        expect(logged).not.toContain(SECRET);

        // 写入同样 422（"无法修改"），文档不变。
        const write = await reply<ErrorBody>(
          postOps(id, {
            baseRevision: 0,
            source: 'ai',
            operations: [{ op: 'delete', nodeId: 'p1' }],
          }),
          422,
        );
        expect(write.message).toContain('无法修改');
        expect((await getDoc(id)).revision).toBe(0);
      } finally {
        logs.restore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('读取前补齐 nodeId', () => {
    /** 第一个段落缺 nodeId，后两个段落 nodeId 重复。 */
    const damaged = () =>
      doc(
        chapter(
          'ch-1',
          '范围',
          para(null, '缺 id 的段落'),
          para('dup', '甲'),
          para('dup', '乙'),
        ),
      ) as unknown as Record<string, unknown>;

    it('规范化后持久化：revision+1、发布 system 事件、不生成版本；之后每次读到的 id 相同', async () => {
      const id = await createDoc(damaged());
      const events = collectEvents(id);

      const first = await getOutline(id);
      expect(first.revision).toBe(1);
      expect(first.outline.body[0]).toMatchObject({
        nodeId: 'ch-1',
        blockCount: 3,
      });

      const stored = await getDoc(id);
      expect(stored.revision).toBe(1);
      const ids = collectNodeIds(stored.content!) as string[];
      expect(ids.every((value) => typeof value === 'string' && value)).toBe(
        true,
      );
      expect(new Set(ids).size).toBe(ids.length);
      // 重复的 id 保留文档顺序里的第一个，其余重新生成。
      expect(ids[0]).toBe('ch-1');
      expect(ids.filter((value) => value === 'dup')).toHaveLength(1);

      // 事件：一次，来源 system，revision 为写入后的值。
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        documentId: id,
        revision: 1,
        source: 'system',
      });
      expect(await getVersions(id)).toEqual([]);

      // 生成的 id 已经持久化：能用它读节点，再读一次 revision 与 id 都不变，也没有新事件。
      const generated = ids[1];
      const node = await reply<NodeBody>(
        t.http.get(`/api/documents/${id}/nodes/${generated}`),
        200,
      );
      expect(node.revision).toBe(1);
      expect(node.node.nodeId).toBe(generated);
      const again = await getDoc(id);
      expect(again.content).toEqual(stored.content);
      expect((await getOutline(id)).revision).toBe(1);
      expect(events).toHaveLength(1);
    });

    it('operations 的 baseRevision 取自补齐前的 revision 时 409，附带补齐后的 revision；重读后可写', async () => {
      const id = await createDoc(damaged());
      const events = collectEvents(id);

      const stale = await reply<ErrorBody>(
        postOps(id, {
          baseRevision: 0,
          source: 'ai',
          operations: [{ op: 'delete', nodeId: 'ch-1' }],
        }),
        409,
      );
      expect(stale.revision).toBe(1);
      expect(stale.message).toContain('文档已被修改');
      // 补齐已持久化（revision 1）；本次写入没有生效，也没有版本。
      expect(events.map((event) => event.source)).toEqual(['system']);
      expect(await getVersions(id)).toEqual([]);

      const ok = await reply<OpsBody>(
        postOps(id, {
          baseRevision: 1,
          source: 'human',
          operations: [{ op: 'delete', nodeId: 'dup' }],
        }),
        200,
      );
      expect(ok.revision).toBe(2);
    });

    it('条件 UPDATE 被并发写入抢先时重读重试，第二次成功', async () => {
      const id = await createDoc(damaged());
      const events = collectEvents(id);
      const original = boundMethod(t.documents, 'update');
      // 第一次补齐：先让「别人」写一次（revision 变化），再执行原本的条件 UPDATE，必然 409。
      const update = jest
        .spyOn(t.documents, 'update')
        .mockImplementationOnce(async (docId, baseRevision, data, origin) => {
          await original(
            docId,
            baseRevision,
            { title: '抢先写入' },
            { source: 'human' },
          );
          return original(docId, baseRevision, data, origin);
        });

      const outline = await getOutline(id);
      expect(update).toHaveBeenCalledTimes(2);
      expect(outline.revision).toBe(2);
      const stored = await getDoc(id);
      expect(stored.title).toBe('抢先写入');
      expect(stored.revision).toBe(2);
      const ids = collectNodeIds(stored.content!) as string[];
      expect(ids.every((value) => typeof value === 'string' && value)).toBe(
        true,
      );
      expect(events.map((event) => [event.revision, event.source])).toEqual([
        [1, 'human'],
        [2, 'system'],
      ]);
    });

    it(`连续 ${MAX_NORMALIZE_ATTEMPTS} 次都被抢先则 409（带当前 revision），不写入补齐结果`, async () => {
      const id = await createDoc(damaged());
      const original = boundMethod(t.documents, 'update');
      const update = jest
        .spyOn(t.documents, 'update')
        .mockImplementation(async (docId, baseRevision, data, origin) => {
          await original(
            docId,
            baseRevision,
            { title: `抢先${baseRevision}` },
            { source: 'human' },
          );
          return original(docId, baseRevision, data, origin);
        });

      const body = await reply<ErrorBody>(
        t.http.get(`/api/documents/${id}/outline`),
        409,
      );
      // spy 只记录读取流程的调用（每次尝试一次）；mock 内部通过 original 发起的抢先写入不计入。
      expect(update).toHaveBeenCalledTimes(MAX_NORMALIZE_ATTEMPTS);
      expect(body.message).toContain('文档正在被频繁修改');
      expect(body.revision).toBe(MAX_NORMALIZE_ATTEMPTS);
      // 每次抢先写入只改了标题；内容没有被补齐：重复的 id 仍然重复。
      const stored = await getDoc(id);
      expect(stored.revision).toBe(MAX_NORMALIZE_ATTEMPTS);
      expect(stored.content).toEqual(damaged());
    });

    it('补齐过程中遇到的非冲突错误原样抛出（不被当作冲突重试）', async () => {
      const id = await createDoc(damaged());
      const update = jest
        .spyOn(t.documents, 'update')
        .mockRejectedValue(new Error('磁盘故障'));
      const logs = captureLogs();
      try {
        await t.http.get(`/api/documents/${id}/outline`).expect(500);
        expect(update).toHaveBeenCalledTimes(1);
      } finally {
        logs.restore();
      }
    });

    it('抢先写入后内容已规范：重读后不再写库', async () => {
      const id = await createDoc(damaged());
      const original = boundMethod(t.documents, 'update');
      const repaired = canonical(
        doc(chapter('ch-1', '范围', para('a', '甲'), para('b', '乙'))),
      );
      const update = jest
        .spyOn(t.documents, 'update')
        .mockImplementationOnce(async (docId, baseRevision, data, origin) => {
          // 别人（例如编辑器）保存了一份已经规范化的内容。
          await original(
            docId,
            baseRevision,
            { content: repaired },
            { source: 'human' },
          );
          return original(docId, baseRevision, data, origin);
        });

      const outline = await getOutline(id);
      // 只有第一次补齐尝试（它因抢先写入而失败）；重读后内容已经规范，不再尝试写库。
      expect(update).toHaveBeenCalledTimes(1);
      expect(outline.revision).toBe(1);
      expect((await getDoc(id)).content).toEqual(repaired);
    });
  });

  // ---------------------------------------------------------------------------
  describe('写接口：操作', () => {
    let id: number;
    beforeEach(async () => {
      id = await createDoc();
    });

    const apply = (
      operations: unknown[],
      extra: Record<string, unknown> = {},
    ) =>
      reply<OpsBody>(
        postOps(id, { baseRevision: 0, source: 'ai', operations, ...extra }),
        200,
      );

    it('insert：在章内某条之后插入新条；返回新节点 id，编号由 Resolver 计算', async () => {
      const result = await apply([
        {
          op: 'insert',
          parent: 'ch-req',
          position: { after: 'cl-2' },
          content: [
            {
              kind: 'clause',
              id: 'cl-new',
              title: '新增条',
              children: ['新增条正文。'],
            },
          ],
        },
      ]);
      expect(result.revision).toBe(1);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({ index: 0, op: 'insert' });
      expect(result.operations[0].inserted).toContain('cl-new');
      expect(result.warnings).toEqual([]);

      const { outline, revision } = await getOutline(id);
      expect(revision).toBe(1);
      expect(findItem(outline.body, 'cl-new')).toMatchObject({
        number: '2.3',
        title: '新增条',
      });
      const stored = await getDoc(id);
      expect(stored.revision).toBe(1);
    });

    it('insert：向不存在的前言/引言/参考文献容器插入时按顺序创建容器', async () => {
      const result = await apply([
        {
          op: 'insert',
          parent: 'introduction',
          position: 'end',
          content: ['引言第一段。'],
        },
        {
          op: 'insert',
          parent: 'bibliography',
          position: 'end',
          content: ['GB/T 1.1—2020 标准化工作导则'],
        },
      ]);
      expect(
        result.operations.map((effect) => effect.createdContainer),
      ).toEqual(['introduction', 'bibliography']);
      const { outline } = await getOutline(id);
      expect(outline.introduction).toMatchObject({
        present: true,
        blockCount: 1,
      });
      expect(outline.bibliography).toEqual({ present: true, entryCount: 1 });
      const types = (await getDoc(id)).content!.content!.map(
        (node) => node.type,
      );
      expect(types).toEqual([
        'foreword',
        'introduction',
        'chapter',
        'chapter',
        'chapter',
        'bibliography',
      ]);
    });

    it('replace：整体替换段落；旧 id 失效，新 id 可读', async () => {
      const result = await apply([
        { op: 'replace', nodeId: 'p-scope', content: ['替换后的范围。'] },
      ]);
      expect(result.operations[0]).toMatchObject({
        op: 'replace',
        removed: ['p-scope'],
      });
      const [newId] = result.operations[0].inserted;
      expect(newId).toBeTruthy();
      await t.http.get(`/api/documents/${id}/nodes/p-scope`).expect(404);
      const node = await reply<NodeBody>(
        t.http.get(`/api/documents/${id}/nodes/${newId}`),
        200,
      );
      expect(node.revision).toBe(1);
      expect(JSON.stringify(node.node)).toContain('替换后的范围。');
    });

    it('delete：删除节点', async () => {
      const result = await apply([{ op: 'delete', nodeId: 'p-extra' }]);
      expect(result.operations[0]).toMatchObject({
        op: 'delete',
        removed: ['p-extra'],
      });
      await t.http.get(`/api/documents/${id}/nodes/p-extra`).expect(404);
      expect(
        findItem((await getOutline(id)).outline.body, 'ch-extra'),
      ).toMatchObject({
        blockCount: 0,
      });
    });

    it('move：把条移到另一章，层级与编号随位置变化', async () => {
      const result = await apply([
        { op: 'move', nodeId: 'cl-2', parent: 'ch-extra', position: 'end' },
      ]);
      expect(result.operations[0]).toMatchObject({
        op: 'move',
        moved: ['cl-2'],
      });
      const { outline } = await getOutline(id);
      expect(findItem(outline.body, 'cl-2')).toMatchObject({ number: '3.1' });
      expect(
        outline.body
          .find((item) => item.nodeId === 'ch-req')!
          .children!.map((item) => item.nodeId),
      ).toEqual(['cl-1']);
    });

    it('一批多个操作按顺序执行，后一个可以引用前一个新建的节点', async () => {
      const result = await apply([
        {
          op: 'insert',
          parent: 'ch-extra',
          position: 'end',
          content: [
            {
              kind: 'clause',
              id: 'cl-a',
              title: '甲',
              children: ['甲的内容。'],
            },
          ],
        },
        {
          op: 'insert',
          parent: 'cl-a',
          position: 'end',
          content: ['追加到新条里的段落。'],
        },
        { op: 'replace', nodeId: 'p-scope', content: ['新的范围。'] },
      ]);
      expect(result.operations.map((effect) => effect.op)).toEqual([
        'insert',
        'insert',
        'replace',
      ]);
      expect(result.revision).toBe(1);
    });

    it('problems 带出写入后文档的 Resolver 问题，并标明哪些是本批新引入的', async () => {
      const result = await apply([
        {
          op: 'insert',
          parent: 'ch-extra',
          position: 'end',
          content: [
            {
              kind: 'paragraph',
              content: [
                '见',
                {
                  text: '表9',
                  marks: [
                    {
                      type: 'crossRef',
                      targetId: 'no-such-target',
                      targetKind: 'table',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      expect(result.problems.some((problem) => problem.introduced)).toBe(true);
    });

    it('replace 含无法表达内容的节点默认被引擎拒绝（422），acceptLoss 后成功并带 warnings', async () => {
      // 带列宽的表格：写作片段表达不了 colwidth。
      const lossy = canonical(
        doc(chapter('c1', '范围', para('p1', '正文')), {
          type: 'chapter',
          attrs: { nodeId: 'c2', secType: 'general' },
          content: [
            {
              type: 'chapterTitle',
              content: [{ type: 'text', text: '表格章' }],
            },
            {
              type: 'stdTable',
              attrs: {
                nodeId: 't1',
                orientation: 'portrait',
                headerRowCount: 1,
              },
              content: [
                {
                  type: 'tableCaption',
                  content: [{ type: 'text', text: '宽表' }],
                },
                {
                  type: 'table',
                  content: [
                    {
                      type: 'tableRow',
                      attrs: { nodeId: 't1-r1' },
                      content: [
                        {
                          type: 'tableHeader',
                          attrs: {
                            nodeId: 't1-c1',
                            colspan: 1,
                            rowspan: 1,
                            colwidth: [120],
                          },
                          content: [para('t1-c1p', '列')],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      const lossyId = await createDoc(lossy);
      const replacement = [
        { kind: 'table', caption: '新表', rows: [['列'], ['值']] },
      ];
      const rejected = await reply<ErrorBody>(
        postOps(lossyId, {
          baseRevision: 0,
          source: 'ai',
          operations: [{ op: 'replace', nodeId: 't1', content: replacement }],
        }),
        422,
      );
      expect(rejected.issues?.[0]).toMatchObject({
        code: 'replace-loses-content',
        operationIndex: 0,
      });
      expect((await getDoc(lossyId)).revision).toBe(0);

      const accepted = await reply<OpsBody>(
        postOps(lossyId, {
          baseRevision: 0,
          source: 'ai',
          operations: [
            {
              op: 'replace',
              nodeId: 't1',
              content: replacement,
              acceptLoss: true,
            },
          ],
        }),
        200,
      );
      expect(accepted.warnings).toHaveLength(1);
      expect(accepted.warnings[0]).toMatchObject({
        code: 'replace-loses-content',
        nodeId: 't1',
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('写接口：错误响应', () => {
    let id: number;
    let events: DocumentChangeEvent[];
    beforeEach(async () => {
      id = await createDoc();
      events = collectEvents(id);
    });

    const validOps = [{ op: 'delete', nodeId: 'p-extra' }];
    const expectUntouched = async () => {
      expect((await getDoc(id)).revision).toBe(0);
      expect(await getVersions(id)).toEqual([]);
      expect(events).toEqual([]);
    };

    it('400：请求体不是对象；source 缺失或非法；client / note 类型或长度不对', async () => {
      await t.http.post(`/api/documents/${id}/operations`).send([]).expect(400);
      const bad: Array<Record<string, unknown>> = [
        { baseRevision: 0, operations: validOps },
        { baseRevision: 0, operations: validOps, source: 'robot' },
        { baseRevision: 0, operations: validOps, source: 1 },
        { baseRevision: 0, operations: validOps, source: 'ai', client: 5 },
        {
          baseRevision: 0,
          operations: validOps,
          source: 'ai',
          client: 'x'.repeat(201),
        },
        { baseRevision: 0, operations: validOps, source: 'ai', note: ['a'] },
        {
          baseRevision: 0,
          operations: validOps,
          source: 'ai',
          note: 'n'.repeat(MAX_NOTE_LENGTH + 1),
        },
      ];
      for (const body of bad) {
        await postOps(id, body).expect(400);
      }
      // 上限本身可以通过（client 与版本服务同为 200）。
      await postOps(id, {
        baseRevision: 0,
        operations: validOps,
        source: 'human',
        client: 'x'.repeat(200),
        note: 'n'.repeat(MAX_NOTE_LENGTH),
      }).expect(200);
    });

    it('baseRevision：缺失 428，类型错误 400（与 PUT 一致）', async () => {
      const missing = await reply<ErrorBody>(
        postOps(id, { operations: validOps, source: 'ai' }),
        428,
      );
      expect(missing.message).toContain('baseRevision');
      for (const bad of ['0', null, -1, 1.5, true, [0], {}]) {
        await postOps(id, {
          baseRevision: bad,
          operations: validOps,
          source: 'ai',
        }).expect(400);
      }
      await expectUntouched();
    });

    it('400：operations 不是非空数组、操作形状不对；issues 列出全部问题', async () => {
      for (const operations of [undefined, null, 'x', {}, []]) {
        const body = await reply<ErrorBody>(
          postOps(id, { baseRevision: 0, source: 'ai', operations }),
          400,
        );
        expect(body.issues?.[0]).toMatchObject({ code: 'invalid-operations' });
      }

      const body = await reply<ErrorBody>(
        postOps(id, {
          baseRevision: 0,
          source: 'ai',
          operations: [
            { op: 'explode' },
            { op: 'delete' },
            { op: 'delete', nodeId: 'p-extra', extra: 1 },
            {
              op: 'insert',
              parent: 'ch-req',
              position: 'sideways',
              content: [],
            },
          ],
        }),
        400,
      );
      expect(body.statusCode).toBe(400);
      expect(body.message).toContain('operations 不合法');
      expect(
        body.issues?.map((issue) => [issue.operationIndex, issue.code]),
      ).toEqual([
        [0, 'unknown-operation'],
        [1, 'missing-field'],
        [2, 'unknown-field'],
        [3, 'invalid-value'],
      ]);
      await expectUntouched();
    });

    it('404：文档不存在', async () => {
      await postOps(987654, {
        baseRevision: 0,
        source: 'ai',
        operations: validOps,
      }).expect(404);
    });

    it('409：baseRevision 过期，响应体与 PUT 一致（当前 revision），不写入', async () => {
      await reply<DocBody>(
        t.http
          .put(`/api/documents/${id}`)
          .send({ baseRevision: 0, title: '别人先改了' }),
        200,
      );
      events.length = 0;

      const stale = await reply<ErrorBody>(
        postOps(id, { baseRevision: 0, source: 'ai', operations: validOps }),
        409,
      );
      expect(stale).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        revision: 1,
      });
      expect(stale.message).toBe(
        '文档已被修改（当前 revision 为 1，请求基于 0），本次写入未保存',
      );
      // 与 PUT 的 409 完全相同的响应体。
      const putConflict = await reply<ErrorBody>(
        t.http
          .put(`/api/documents/${id}`)
          .send({ baseRevision: 0, title: 'x' }),
        409,
      );
      expect(stale).toEqual(putConflict);

      // 比当前更大的 baseRevision 同样视为不一致。
      await postOps(id, {
        baseRevision: 9,
        source: 'ai',
        operations: validOps,
      }).expect(409);

      expect((await getDoc(id)).revision).toBe(1);
      expect(await getVersions(id)).toEqual([]);
      expect(events).toEqual([]);
    });

    it('422：引擎拒绝整批操作，issues 带定位；文档、版本、事件都不变', async () => {
      const body = await reply<ErrorBody>(
        postOps(id, {
          baseRevision: 0,
          source: 'ai',
          operations: [
            { op: 'delete', nodeId: 'p-extra' },
            { op: 'delete', nodeId: 'no-such-node' },
            { op: 'replace', nodeId: 'tbl-1-r1c1', content: ['x'] },
          ],
        }),
        422,
      );
      expect(body.statusCode).toBe(422);
      expect(body.message).toContain('整批未写入');
      expect(
        body.issues?.map((issue) => [issue.operationIndex, issue.code]),
      ).toEqual([
        [1, 'node-not-found'],
        [2, 'node-not-addressable'],
      ]);
      expect(body.issues?.[0].path).toContain('operations[1]');
      // 第一个操作本身合法，但整批不生效。
      await t.http.get(`/api/documents/${id}/nodes/p-extra`).expect(200);
      await expectUntouched();
    });

    it('422：全部操作执行后文档为空', async () => {
      const single = await createDoc(canonical(doc(chapter('only', '范围'))));
      const body = await reply<ErrorBody>(
        postOps(single, {
          baseRevision: 0,
          source: 'ai',
          operations: [{ op: 'delete', nodeId: 'only' }],
        }),
        422,
      );
      expect(body.issues?.[0].code).toBe('empty-document');
    });

    it('422 的日志只记录问题数与代码，不含 id 或正文', async () => {
      const logs = captureLogs();
      try {
        await postOps(id, {
          baseRevision: 0,
          source: 'ai',
          operations: [{ op: 'delete', nodeId: SECRET }],
        }).expect(422);
        const logged = logs.text();
        expect(logged).toContain(
          `文档 #${id} 的操作被拒绝：1 个问题（node-not-found）`,
        );
        expect(logged).not.toContain(SECRET);
      } finally {
        logs.restore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('AI 版本记录', () => {
    const deleteExtra = [{ op: 'delete', nodeId: 'p-extra' }];

    it('source=ai 时同一次写入生成版本：来源、client、阶段、写入前后内容、自动摘要、版本号、xml 为空', async () => {
      const id = await createDoc(canonical(sampleDocument()), {
        stage: 'committee_draft',
      });
      const before = (await getDoc(id)).content;

      const result = await reply<OpsBody>(
        postOps(id, {
          baseRevision: 0,
          source: 'ai',
          client: 'claude-code',
          operations: [
            {
              op: 'insert',
              parent: 'ch-extra',
              position: 'end',
              content: [
                { kind: 'clause', title: '甲', children: ['甲的内容。'] },
              ],
            },
            {
              op: 'insert',
              parent: 'ch-extra',
              position: 'end',
              content: [
                { kind: 'clause', title: '乙', children: ['乙的内容。'] },
              ],
            },
            { op: 'replace', nodeId: 'p-scope', content: ['新的范围。'] },
          ],
        }),
        200,
      );
      expect(result.versionId).toEqual(expect.any(Number));

      const after = (await getDoc(id)).content;
      expect(after).not.toEqual(before);

      // 版本列表：有 content，没有 baseContent。
      const list = await getVersions(id);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: result.versionId,
        documentId: id,
        versionNo: '1.0',
        stage: 'committee_draft',
        note: 'AI 修改：插入 2 处、替换 1 处',
        source: 'ai',
        client: 'claude-code',
        xml: null,
      });
      expect(list[0].content).toEqual(after);
      expect('baseContent' in list[0]).toBe(false);

      // 版本详情：baseContent 恰为写入前内容，content 恰为写入后内容。
      const detail = await reply<VersionBody>(
        t.http.get(`/api/versions/${result.versionId}`),
        200,
      );
      expect(detail.baseContent).toEqual(before);
      expect(detail.content).toEqual(after);
      expect(detail).toMatchObject({
        source: 'ai',
        client: 'claude-code',
        stage: 'committee_draft',
      });
    });

    it('请求带 note 时原样使用；只含空白视为没写；client 缺省为 null', async () => {
      const id = await createDoc();
      await reply<OpsBody>(
        postOps(id, {
          baseRevision: 0,
          source: 'ai',
          note: '按评审意见补充范围',
          operations: deleteExtra,
        }),
        200,
      );
      await reply<OpsBody>(
        postOps(id, {
          baseRevision: 1,
          source: 'ai',
          note: '   ',
          operations: [{ op: 'delete', nodeId: 'p-scope' }],
        }),
        200,
      );
      const list = await getVersions(id);
      expect(list.map((version) => version.note)).toEqual([
        'AI 修改：删除 1 处',
        '按评审意见补充范围',
      ]);
      expect(list.map((version) => version.client)).toEqual([null, null]);
    });

    it('版本号与 client 规则一致：无版本时 1.0，否则取最新一条的 major.minor 并 minor+1（含同一秒内的版本）', async () => {
      const id = await createDoc();
      const ai = (baseRevision: number, nodeId: string) =>
        reply<OpsBody>(
          postOps(id, {
            baseRevision,
            source: 'ai',
            operations: [{ op: 'delete', nodeId }],
          }),
          200,
        );

      // 人先保存了一个 3.4（POST /versions，与 AI 写入落在同一秒）。
      await reply<VersionBody>(
        t.http.post('/api/versions').send({
          documentId: id,
          versionNo: '3.4',
          stage: 'working_draft',
          content: { type: 'doc', content: [] },
        }),
        201,
      );
      await ai(0, 'p-extra');
      await ai(1, 'p-scope');
      await ai(2, 'p-cl-2');
      const list = await getVersions(id);
      expect(list.map((version) => version.versionNo)).toEqual([
        '3.7',
        '3.6',
        '3.5',
        '3.4',
      ]);
      expect(list.map((version) => version.source)).toEqual([
        'ai',
        'ai',
        'ai',
        'human',
      ]);
    });

    it('source=human 不生成版本记录（与编辑器保存一致），但仍写入文档并发布 human 事件', async () => {
      const id = await createDoc();
      const events = collectEvents(id);

      const result = await reply<OpsBody>(
        postOps(id, {
          baseRevision: 0,
          source: 'human',
          client: 'cli',
          operations: deleteExtra,
        }),
        200,
      );
      expect(result.revision).toBe(1);
      expect('versionId' in result).toBe(false);
      expect(await getVersions(id)).toEqual([]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        documentId: id,
        revision: 1,
        source: 'human',
        client: 'cli',
      });
    });

    it('baseContent 的来源是规范化之后的内容：版本差异只含这一批 AI 修改', async () => {
      // 库里缺 nodeId：AI 写入前先补齐（revision+1），baseContent 是补齐后的内容，不含随机 id 的差异。
      const id = await createDoc(
        doc(
          chapter('c1', '范围', para(null, '缺 id'), para('p2', '乙')),
        ) as unknown as Record<string, unknown>,
      );
      await getOutline(id);
      const normalized = (await getDoc(id)).content;

      const result = await reply<OpsBody>(
        postOps(id, {
          baseRevision: 1,
          source: 'ai',
          operations: [{ op: 'delete', nodeId: 'p2' }],
        }),
        200,
      );
      const detail = await reply<VersionBody>(
        t.http.get(`/api/versions/${result.versionId}`),
        200,
      );
      expect(detail.baseContent).toEqual(normalized);
      const baseIds = collectNodeIds(detail.baseContent!);
      const afterIds = collectNodeIds(detail.content);
      expect(afterIds).toEqual(baseIds.filter((value) => value !== 'p2'));
    });

    it('旧接口行为不变：POST /versions 仍可创建版本，baseContent 缺省为 null；非对象 baseContent 被拒绝', async () => {
      const id = await createDoc();
      const created = await reply<VersionBody>(
        t.http.post('/api/versions').send({
          documentId: id,
          versionNo: '1.0',
          stage: 'working_draft',
          content: { type: 'doc', content: [] },
        }),
        201,
      );
      const detail = await reply<VersionBody>(
        t.http.get(`/api/versions/${created.id}`),
        200,
      );
      expect(detail.baseContent).toBeNull();
      expect(detail.source).toBe('human');

      for (const baseContent of ['x', [], 1]) {
        await t.http
          .post('/api/versions')
          .send({
            documentId: id,
            versionNo: '1.1',
            stage: 'working_draft',
            content: { type: 'doc', content: [] },
            baseContent,
          })
          .expect(400);
      }
      await t.http.get('/api/versions/987654').expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('事务', () => {
    const FAIL_TRIGGER = 'fail_version_insert';
    const installFailingTrigger = () =>
      t.dataSource.query(
        `CREATE TRIGGER ${FAIL_TRIGGER} BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT, '注入的版本插入失败'); END`,
      );
    const dropFailingTrigger = () =>
      t.dataSource.query(`DROP TRIGGER ${FAIL_TRIGGER}`);

    it('版本插入失败时整体回滚：文档内容与 revision 都不变，没有版本，不发布事件；之后同一请求可以成功', async () => {
      const id = await createDoc();
      const before = await getDoc(id);
      const events = collectEvents(id);
      await installFailingTrigger();
      const logs = captureLogs();
      try {
        const body = {
          baseRevision: 0,
          source: 'ai',
          operations: [{ op: 'delete', nodeId: 'p-extra' }],
        };
        await postOps(id, body).expect(500);

        // 条件 UPDATE 已经在事务里执行过，但随版本插入一起回滚。
        const after = await getDoc(id);
        expect(after.revision).toBe(0);
        expect(after.content).toEqual(before.content);
        expect(after.updatedAt).toBe(before.updatedAt);
        expect(events).toEqual([]);
        const rows: unknown[] = await t.dataSource.query(
          `SELECT id FROM versions`,
        );
        expect(rows).toEqual([]);
        expect(t.dataSource.createQueryRunner().isTransactionActive).toBe(
          false,
        );

        // 故障排除后同一请求（同一个 baseRevision）可以直接成功：没有残留的事务或半个结果。
        await dropFailingTrigger();
        const ok = await reply<OpsBody>(postOps(id, body), 200);
        expect(ok.revision).toBe(1);
        expect(ok.versionId).toBeDefined();
        expect(events).toHaveLength(1);
      } finally {
        logs.restore();
      }
    });

    it('版本记录先于文档更新失败也不留下部分结果（反向：文档更新抛 409 时不写版本）', async () => {
      const id = await createDoc();
      const events = collectEvents(id);
      // 事务里的条件 UPDATE 因 revision 变化失败：绕过 prepare 的快速检查，直接让它在事务内才发现。
      const original = boundMethod(t.documents, 'updateWithin');
      jest
        .spyOn(t.documents, 'updateWithin')
        .mockImplementationOnce(async (manager, docId, baseRevision, data) => {
          await original(manager, docId, baseRevision, {
            title: '事务内先被改',
          });
          return original(manager, docId, baseRevision, data);
        });
      await postOps(id, {
        baseRevision: 0,
        source: 'ai',
        operations: [{ op: 'delete', nodeId: 'p-extra' }],
      }).expect(409);
      // 抢先的那次更新也在同一事务里，随 409 一起回滚。
      const after = await getDoc(id);
      expect(after.revision).toBe(0);
      expect(after.title).toBe('测试标准');
      expect(await getVersions(id)).toEqual([]);
      expect(events).toEqual([]);
    });

    it('回滚中的事务不会连带撤销同一时刻的 PUT（SQLite 单连接，事务必须与其他写入串行）', async () => {
      const a = await createDoc();
      const b = await createDoc();
      const inTransaction = t.documents.transaction(async (manager) => {
        await t.documents.updateWithin(manager, a, 0, {
          title: '事务内的修改',
        });
        // 事务打开期间让出事件循环：别的请求此时可以运行。
        await new Promise((resolve) => setImmediate(resolve));
        throw new Error('让事务回滚');
      });
      await new Promise((resolve) => setImmediate(resolve));
      const put = t.documents.update(b, 0, { title: 'B 的新标题' });

      const [txResult, putResult] = await Promise.allSettled([
        inTransaction,
        put,
      ]);
      expect(txResult.status).toBe('rejected');
      expect(putResult.status).toBe('fulfilled');
      expect((await getDoc(a)).title).toBe('测试标准');
      const savedB = await getDoc(b);
      expect(savedB.title).toBe('B 的新标题');
      expect(savedB.revision).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  /**
   * 全服务端共用一把写锁（WriteCoordinator）：operations 的事务打开期间，其他写库操作
   * （POST/DELETE 文档、POST 版本）必须排在事务之后，既不能落进事务里随它回滚，也不能让事务的失败撤销它们。
   *
   * 这些用例靠「在事务内真正让出事件循环」暴露问题：对 createForAiWrite 打桩，让它在 updateWithin 之后、
   * 版本插入之前一直等到别的写入请求都到达服务层，再继续。没有写锁时，这些请求会在这段时间里直接
   * 在事务所在的连接上执行。
   */
  describe('写入隔离（全服务端写锁）', () => {
    const FAIL_TRIGGER = 'fail_ai_version_insert';
    const aiBody = {
      baseRevision: 0,
      source: 'ai',
      operations: [{ op: 'delete', nodeId: 'p-extra' }],
    };

    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

    function deferred() {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => (resolve = done));
      return { promise, resolve };
    }

    /** supertest 的请求是惰性的：立即发出，并在稍后用 await 取结果。 */
    const send = (test: request.Test) => test.then((res) => res);

    const idsOf = (rows: unknown[]) =>
      rows.map((row) => (row as { id: number }).id);

    /**
     * 让 operations 事务停在「updateWithin 之后、版本插入之前」，直到 `until` 完成并再让出一次事件循环。
     * `entered` 在事务已打开、文档已更新时完成；`seen` 记录继续之前事务内能看到的行：
     * 被写锁挡住的写入此刻不应该已经执行。
     */
    function pauseInsideTransaction(until: Promise<unknown>) {
      const entered = deferred();
      const seen: { documentIds: number[]; versionIds: number[] } = {
        documentIds: [],
        versionIds: [],
      };
      const original = boundMethod(t.versions, 'createForAiWrite');
      jest
        .spyOn(t.versions, 'createForAiWrite')
        .mockImplementation(async (manager, input) => {
          entered.resolve();
          await until;
          await tick();
          seen.documentIds = idsOf(
            await manager.query<unknown[]>('SELECT id FROM documents'),
          );
          seen.versionIds = idsOf(
            await manager.query<unknown[]>('SELECT id FROM versions'),
          );
          return original(manager, input);
        });
      return { entered: entered.promise, seen };
    }

    it('operations 事务让出事件循环时到达的 DELETE 排在事务之后：operations 成功，文档随后被删除，不会复活，没有 500', async () => {
      const id = await createDoc();
      const events = collectEvents(id);
      const deleteReached = deferred();
      const originalRemove = boundMethod(t.documents, 'remove');
      jest.spyOn(t.documents, 'remove').mockImplementation((docId) => {
        deleteReached.resolve();
        return originalRemove(docId);
      });
      const paused = pauseInsideTransaction(deleteReached.promise);

      const ops = send(postOps(id, aiBody));
      await paused.entered;
      const del = send(t.http.delete(`/api/documents/${id}`));
      const [opsRes, delRes] = await Promise.all([ops, del]);

      // DELETE 已到达服务层，但没有在事务里执行：事务内文档仍在。
      expect(paused.seen.documentIds).toEqual([id]);
      // operations 的事务先提交（200、带版本号），DELETE 再执行。
      expect(opsRes.status).toBe(200);
      expect((opsRes.body as OpsBody).versionId).toBeDefined();
      expect(delRes.status).toBe(200);
      expect(events).toHaveLength(1);
      // 文档确实被删除（没有因为事务回滚而复活），版本随外键级联删除。
      await t.http.get(`/api/documents/${id}`).expect(404);
      expect(await t.dataSource.query(`SELECT id FROM versions`)).toEqual([]);
    });

    it('operations 事务回滚期间并发的 POST /documents、POST /versions、DELETE 都不会被一起回滚', async () => {
      const id = await createDoc();
      const other = await createDoc();
      const before = await getDoc(id);
      const events = collectEvents(id);
      // 真实的数据库错误：只让 AI 写入的版本插入失败，人工版本不受影响。
      await t.dataSource.query(
        `CREATE TRIGGER ${FAIL_TRIGGER} BEFORE INSERT ON versions WHEN NEW.source = 'ai' BEGIN SELECT RAISE(ABORT, '注入的版本插入失败'); END`,
      );
      const docCreateReached = deferred();
      const versionCreateReached = deferred();
      const deleteReached = deferred();
      const originalCreate = boundMethod(t.documents, 'create');
      jest.spyOn(t.documents, 'create').mockImplementation((data) => {
        docCreateReached.resolve();
        return originalCreate(data);
      });
      const originalVersionCreate = boundMethod(t.versions, 'create');
      jest.spyOn(t.versions, 'create').mockImplementation((data) => {
        versionCreateReached.resolve();
        return originalVersionCreate(data);
      });
      const originalRemove = boundMethod(t.documents, 'remove');
      jest.spyOn(t.documents, 'remove').mockImplementation((docId) => {
        deleteReached.resolve();
        return originalRemove(docId);
      });
      const paused = pauseInsideTransaction(
        Promise.all([
          docCreateReached.promise,
          versionCreateReached.promise,
          deleteReached.promise,
        ]),
      );
      const logs = captureLogs();
      try {
        const ops = send(postOps(id, aiBody));
        await paused.entered;
        const createdDoc = send(
          t.http.post('/api/documents').send({
            title: '事务期间新建',
            meta,
            stage: 'working_draft',
            content: null,
          }),
        );
        const createdVersion = send(
          t.http.post('/api/versions').send({
            documentId: id,
            versionNo: '7.0',
            stage: 'working_draft',
            content: { type: 'doc', content: [] },
          }),
        );
        const deleted = send(t.http.delete(`/api/documents/${other}`));
        const [opsRes, docRes, versionRes, deleteRes] = await Promise.all([
          ops,
          createdDoc,
          createdVersion,
          deleted,
        ]);

        // 被写锁挡住的三个写入在事务内还没有执行。
        expect(paused.seen.documentIds).toEqual([id, other]);
        expect(paused.seen.versionIds).toEqual([]);

        // 事务因版本插入失败回滚：500，文档恢复原状，没有事件。
        expect(opsRes.status).toBe(500);
        const after = await getDoc(id);
        expect(after.revision).toBe(0);
        expect(after.content).toEqual(before.content);
        expect(events).toEqual([]);

        // 并发的写入都返回了成功，也都真实保留下来。
        expect(docRes.status).toBe(201);
        const created = await getDoc((docRes.body as DocBody).id);
        expect(created.title).toBe('事务期间新建');
        expect(versionRes.status).toBe(201);
        const versions = await getVersions(id);
        expect(versions.map((version) => version.id)).toEqual([
          (versionRes.body as VersionBody).id,
        ]);
        expect(versions[0].versionNo).toBe('7.0');
        expect(deleteRes.status).toBe(200);
        await t.http.get(`/api/documents/${other}`).expect(404);

        expect(t.dataSource.createQueryRunner().isTransactionActive).toBe(
          false,
        );
      } finally {
        logs.restore();
      }
    });

    it('事务回调里使用传入的 manager 写入（updateWithin、createForAiWrite）不再加锁，不会死锁；事务结束后锁已释放', async () => {
      const id = await createDoc();
      const coordinator = t.app.get(WriteCoordinator);
      const run = jest.spyOn(coordinator, 'run');
      const withTimeout = async <T>(task: Promise<T>, label: string) => {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label}：超时，疑似死锁`)),
            2000,
          );
        });
        try {
          return await Promise.race([task, timeout]);
        } finally {
          clearTimeout(timer);
        }
      };

      const result = await withTimeout(
        t.documents.transaction(async (manager) => {
          const updated = await t.documents.updateWithin(manager, id, 0, {
            title: '事务内的修改',
          });
          const version = await t.versions.createForAiWrite(manager, {
            documentId: id,
            stage: updated.stage,
            content: { type: 'doc', content: [] },
            baseContent: { type: 'doc', content: [] },
            client: null,
            note: '事务内写入',
          });
          return { updated, version };
        }),
        '事务内写入',
      );
      expect(result.updated.revision).toBe(1);
      expect(result.version.documentId).toBe(id);
      // 整个事务只取得了一次写锁（transaction 自己）；回调里的写入没有再取。
      expect(run).toHaveBeenCalledTimes(1);

      // 事务结束后锁已释放：之后的写入照常完成。
      const next = await withTimeout(
        t.documents.update(id, 1, { title: '事务之后的修改' }),
        '事务之后的写入',
      );
      expect(next.revision).toBe(2);
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('每一个写库入口都经过同一个 WriteCoordinator 实例（create、update、remove、transaction、POST /versions）', async () => {
      const run = jest.spyOn(t.app.get(WriteCoordinator), 'run');
      const created = await t.documents.create({
        title: '写锁覆盖',
        meta,
        stage: 'working_draft',
        content: null,
      });
      expect(run).toHaveBeenCalledTimes(1);
      await t.documents.update(created.id, 0, { title: '写锁覆盖 2' });
      expect(run).toHaveBeenCalledTimes(2);
      await t.versions.create({
        documentId: created.id,
        versionNo: '1.0',
        stage: 'working_draft',
        content: { type: 'doc', content: [] },
      });
      expect(run).toHaveBeenCalledTimes(3);
      await t.documents.transaction(() => Promise.resolve());
      expect(run).toHaveBeenCalledTimes(4);
      await t.documents.remove(created.id);
      expect(run).toHaveBeenCalledTimes(5);
      // 校验失败的请求不写库：校验在取锁之前完成，不占用写锁。
      await expect(
        t.versions.create({ source: '未知' as never }),
      ).rejects.toThrow();
      expect(run).toHaveBeenCalledTimes(5);
    });

    // -------------------------------------------------------------------------
    /**
     * 读也经过写锁：事务进行期间，共享连接上的读会看到事务内尚未提交的数据（内容与递增后的 revision）。
     * 事务随后回滚的话，读方拿到的是从未存在过的状态，从它打开的编辑器会持有一个不存在的 revision。
     *
     * 做法：让 operations 事务停在 updateWithin 之后、版本插入之前（版本记录的读取则停在版本已插入之后，
     * 否则没有未提交的版本可读），此时发起各种读取，确认它们在事务结束前不返回；
     * 事务结束后：回滚的读到原状，提交的读到新值。去掉任何一个读方法的加锁，对应用例失败。
     */
    describe('读取排在在途事务之后（只读到已提交的数据）', () => {
      type Outcome = 'rollback' | 'commit';
      interface ReadContext {
        id: number;
        /** 事务内已插入（未提交）的版本 id；只有 after-version-insert 的用例有。 */
        versionId?: number;
      }
      interface ReadCase {
        name: string;
        /** 事务挂起的位置。 */
        holdAt: 'before-version-insert' | 'after-version-insert';
        start(ctx: ReadContext): Promise<unknown>;
        check(result: unknown, outcome: Outcome, before: DocBody): void;
      }
      /** 抹掉结果类型，让不同形状的用例可以放进同一个数组。 */
      const defineRead = <T>(def: {
        name: string;
        holdAt: ReadCase['holdAt'];
        start(ctx: ReadContext): Promise<T>;
        check(result: T, outcome: Outcome, before: DocBody): void;
      }): ReadCase => def as unknown as ReadCase;

      const sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));
      // aiBody 删除的就是这一段：回滚后应该还在，提交后应该没有。
      const hasExtra = (content: unknown) =>
        JSON.stringify(content).includes('附加要求正文');
      /** 回滚后读到写入前的 revision（0）与内容，提交后读到写入后的（1）。 */
      const expectRevision = (outcome: Outcome, revision: number) =>
        expect(revision).toBe(outcome === 'rollback' ? 0 : 1);
      const expectExtra = (outcome: Outcome, content: unknown) =>
        expect(hasExtra(content)).toBe(outcome === 'rollback');

      let mcp: McpTestClient;
      beforeEach(async () => {
        mcp = await connectMcp(t);
      });
      afterEach(async () => {
        await mcp.close();
      });

      /** 打开 SSE 连接，收到响应头（状态码）后立即断开。 */
      const openEvents = (id: number) =>
        new Promise<number | undefined>((resolve, reject) => {
          const req = httpGet(`${t.url}/api/documents/${id}/events`, (res) => {
            res.on('error', () => undefined);
            resolve(res.statusCode);
            res.destroy();
          });
          req.on('error', reject);
        });

      const readCases: ReadCase[] = [
        defineRead({
          name: 'GET /api/documents/:id（DocumentService.findOne）',
          holdAt: 'before-version-insert',
          start: ({ id }) => send(t.http.get(`/api/documents/${id}`)),
          check: (res, outcome, before) => {
            expect(res.status).toBe(200);
            const body = res.body as DocBody;
            expectRevision(outcome, body.revision);
            expectExtra(outcome, body.content);
            if (outcome === 'rollback') {
              expect(body.content).toEqual(before.content);
            }
          },
        }),
        defineRead({
          name: 'GET /api/documents（DocumentService.findAll）',
          holdAt: 'before-version-insert',
          start: () => send(t.http.get('/api/documents')),
          check: (res, outcome) => {
            expect(res.status).toBe(200);
            const [entry] = res.body as DocBody[];
            expectRevision(outcome, entry.revision);
            expectExtra(outcome, entry.content);
          },
        }),
        defineRead({
          name: 'DocumentService.findSummaries',
          holdAt: 'before-version-insert',
          start: () => t.documents.findSummaries(),
          check: (summaries, outcome) => {
            expect(summaries).toHaveLength(1);
            expectRevision(outcome, summaries[0].revision);
          },
        }),
        defineRead({
          name: 'DocumentService.assertExists',
          holdAt: 'before-version-insert',
          start: ({ id }) => t.documents.assertExists(id),
          check: (result) => expect(result).toBeUndefined(),
        }),
        defineRead({
          name: 'GET /api/documents/:id/events（SSE 首次读取，assertExists）',
          holdAt: 'before-version-insert',
          start: ({ id }) => openEvents(id),
          check: (status) => expect(status).toBe(200),
        }),
        defineRead({
          name: 'GET /api/documents/:id/outline（DocumentOpsService.prepare）',
          holdAt: 'before-version-insert',
          start: ({ id }) => send(t.http.get(`/api/documents/${id}/outline`)),
          check: (res, outcome) => {
            expect(res.status).toBe(200);
            expectRevision(
              outcome,
              (res.body as { revision: number }).revision,
            );
          },
        }),
        defineRead({
          name: 'MCP get_outline',
          holdAt: 'before-version-insert',
          start: ({ id }) => mcp.call('get_outline', { documentId: id }),
          check: (result, outcome) => {
            expect(result.isError).toBe(false);
            expectRevision(
              outcome,
              (result.body as { revision: number }).revision,
            );
          },
        }),
        defineRead({
          name: 'MCP list_documents（DocumentService.findSummaries）',
          holdAt: 'before-version-insert',
          start: () => mcp.call('list_documents'),
          check: (result, outcome) => {
            expect(result.isError).toBe(false);
            const { documents } = result.body as {
              documents: Array<{ revision: number }>;
            };
            expect(documents).toHaveLength(1);
            expectRevision(outcome, documents[0].revision);
          },
        }),
        defineRead({
          name: 'MCP validate_document（ExportService.inspect）',
          holdAt: 'before-version-insert',
          start: ({ id }) => mcp.call('validate_document', { documentId: id }),
          check: (result, outcome) => {
            expect(result.isError).toBe(false);
            expectRevision(
              outcome,
              (result.body as { revision: number }).revision,
            );
          },
        }),
        defineRead({
          name: 'GET /api/documents/:id/export/json（ExportService.inspect）',
          holdAt: 'before-version-insert',
          start: ({ id }) =>
            send(t.http.get(`/api/documents/${id}/export/json`)),
          check: (res, outcome) => {
            expect(res.status).toBe(200);
            expectExtra(outcome, res.text);
          },
        }),
        defineRead({
          name: 'GET /api/versions/document/:id（VersionService.findByDocument）',
          holdAt: 'after-version-insert',
          start: ({ id }) => send(t.http.get(`/api/versions/document/${id}`)),
          check: (res, outcome) => {
            expect(res.status).toBe(200);
            const versions = res.body as VersionBody[];
            // 回滚后版本从未存在过；提交后恰有这一条 AI 版本。
            expect(versions.map((version) => version.source)).toEqual(
              outcome === 'rollback' ? [] : ['ai'],
            );
          },
        }),
        defineRead({
          name: 'GET /api/versions/:id（VersionService.findOne）',
          holdAt: 'after-version-insert',
          start: ({ versionId }) =>
            send(t.http.get(`/api/versions/${versionId}`)),
          check: (res, outcome) => {
            expect(res.status).toBe(outcome === 'rollback' ? 404 : 200);
            if (outcome === 'commit') {
              expect((res.body as VersionBody).baseContent).toBeTruthy();
            }
          },
        }),
      ];

      /** 停在「版本已插入、尚未提交」；放行后：rollback 抛错让事务回滚，commit 正常返回。 */
      function pauseAfterVersionInsert(
        until: Promise<unknown>,
        outcome: Outcome,
      ) {
        const entered = deferred();
        const paused: { entered: Promise<void>; versionId?: number } = {
          entered: entered.promise,
        };
        const original = boundMethod(t.versions, 'createForAiWrite');
        jest
          .spyOn(t.versions, 'createForAiWrite')
          .mockImplementation(async (manager, input) => {
            const version = await original(manager, input);
            paused.versionId = version.id;
            entered.resolve();
            await until;
            if (outcome === 'rollback') throw new Error('让事务回滚');
            return version;
          });
        return paused;
      }

      /**
       * 发起一次读取，等它排到写锁上（或已经返回），再让出足够多次事件循环：没有加锁的读会在这期间完成。
       * 调用方随后断言 `isSettled()` 为 false。
       */
      async function startRead<T>(
        lockCount: () => number,
        read: () => Promise<T>,
      ) {
        const baseline = lockCount();
        let settled = false;
        const promise = read();
        const markSettled = () => {
          settled = true;
        };
        void promise.then(markSettled, markSettled);
        const deadline = Date.now() + 3000;
        while (lockCount() === baseline && !settled) {
          if (Date.now() > deadline) throw new Error('读取没有到达写锁');
          await tick();
        }
        for (let i = 0; i < 20; i++) await tick();
        await sleep(30);
        return { promise, isSettled: () => settled };
      }

      /** 挂起事务 → 发起读取 → 确认读取在等待 → 放行事务 → 检查读取结果与事务结果。 */
      async function readDuringTransaction(
        readCase: ReadCase,
        outcome: Outcome,
      ) {
        const id = await createDoc();
        const before = await getDoc(id);
        const events = collectEvents(id);
        const run = jest.spyOn(t.app.get(WriteCoordinator), 'run');
        const release = deferred();
        let paused: { entered: Promise<void>; versionId?: number };
        if (readCase.holdAt === 'before-version-insert') {
          // 回滚：版本插入真实失败（数据库触发器），与「事务」一节的注入方式相同；提交：不装触发器。
          if (outcome === 'rollback') {
            await t.dataSource.query(
              `CREATE TRIGGER ${FAIL_TRIGGER} BEFORE INSERT ON versions WHEN NEW.source = 'ai' BEGIN SELECT RAISE(ABORT, '注入的版本插入失败'); END`,
            );
          }
          paused = pauseInsideTransaction(release.promise);
        } else {
          paused = pauseAfterVersionInsert(release.promise, outcome);
        }
        const logs = captureLogs();
        try {
          const ops = send(postOps(id, aiBody));
          await paused.entered;

          const read = await startRead(
            () => run.mock.calls.length,
            () => readCase.start({ id, versionId: paused.versionId }),
          );
          // 事务还没有结束：读取不能已经返回（否则读到的就是未提交的状态）。
          expect(read.isSettled()).toBe(false);

          release.resolve();
          const [opsRes, result] = await Promise.all([ops, read.promise]);
          expect(opsRes.status).toBe(outcome === 'rollback' ? 500 : 200);
          readCase.check(result, outcome, before);
          expect(events).toHaveLength(outcome === 'rollback' ? 0 : 1);
        } finally {
          // 断言失败时也要放行事务，否则它永远挂起，app.close() 等不到在途请求结束。
          release.resolve();
          logs.restore();
        }
      }

      it.each(readCases)(
        '事务回滚：$name 在事务结束前不返回，之后读到回滚后的原状',
        (readCase) => readDuringTransaction(readCase, 'rollback'),
      );
      it.each(readCases)(
        '事务提交：$name 在事务结束前不返回，之后读到提交后的新值',
        (readCase) => readDuringTransaction(readCase, 'commit'),
      );
    });

    // -------------------------------------------------------------------------
    /**
     * 死锁回归：读也要取锁之后，任何「锁内再调用会取锁的方法」都会永远等待自己。
     * 这里逐条走通各调用链，断言每条链取锁的次数固定（读 1 次，prepare 补 nodeId 读 + 写共 2 次，
     * apply 读 + 事务共 2 次……）并且在超时内完成：多一次取锁就说明有人在锁内（或重复地）调用了公开方法。
     */
    describe('取锁次数与死锁回归', () => {
      const withTimeout = async <T>(task: Promise<T>, label: string) => {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label}：超时，疑似死锁`)),
            2000,
          );
        });
        try {
          return await Promise.race([task, timeout]);
        } finally {
          clearTimeout(timer);
        }
      };

      it('DocumentService / VersionService 的每个公开读取各取一次写锁；找不到时也释放锁', async () => {
        const id = await createDoc();
        const version = await t.versions.create({
          documentId: id,
          versionNo: '1.0',
          stage: 'working_draft',
          content: { type: 'doc', content: [] },
        });
        const run = jest.spyOn(t.app.get(WriteCoordinator), 'run');
        const once = async (label: string, call: () => Promise<unknown>) => {
          const before = run.mock.calls.length;
          await withTimeout(call(), label);
          expect(run.mock.calls.length - before).toBe(1);
        };

        await once('findAll', () => t.documents.findAll());
        await once('findSummaries', () => t.documents.findSummaries());
        await once('findOne', () => t.documents.findOne(id));
        await once('assertExists', () => t.documents.assertExists(id));
        await once('versions.findByDocument', () =>
          t.versions.findByDocument(id),
        );
        await once('versions.findOne', () => t.versions.findOne(version.id));

        // 找不到：抛 404，锁已释放，之后的读取照常完成。
        await expect(
          withTimeout(t.documents.findOne(9999), 'findOne 404'),
        ).rejects.toThrow('Document #9999 not found');
        await expect(
          withTimeout(t.documents.assertExists(9999), 'assertExists 404'),
        ).rejects.toThrow('Document #9999 not found');
        await expect(
          withTimeout(t.versions.findOne(9999), 'versions.findOne 404'),
        ).rejects.toThrow('Version #9999 not found');
        await once('找不到之后的 findOne', () => t.documents.findOne(id));
      });

      it('各调用链取锁次数固定且不死锁：读 1 次；补 nodeId 读 + 写 2 次；apply 读 + 事务 2 次；写 1 次；remove 只取 1 次', async () => {
        const id = await createDoc();
        const damagedId = await createDoc(
          doc(
            chapter(
              'ch-1',
              '范围',
              para(null, '缺 id 的段落'),
              para('dup', '甲'),
              para('dup', '乙'),
            ),
          ) as unknown as Record<string, unknown>,
        );
        const mcp = await connectMcp(t);
        const run = jest.spyOn(t.app.get(WriteCoordinator), 'run');
        let versionId = 0;
        const status = (test: request.Test) => test.then((res) => res.status);
        const get = (path: string) => () => status(t.http.get(path));
        const events = () =>
          new Promise<void>((resolve, reject) => {
            const req = httpGet(
              `${t.url}/api/documents/${id}/events`,
              (res) => {
                res.on('error', () => undefined);
                resolve();
                res.destroy();
              },
            );
            req.on('error', reject);
          });

        // [名称, 预期取锁次数, 调用]。顺序有意义：后面的写入依赖前面的 revision。
        const chains: Array<[string, number, () => Promise<unknown>]> = [
          // 读：各 1 次
          ['GET /documents/:id', 1, get(`/api/documents/${id}`)],
          ['GET /documents', 1, get('/api/documents')],
          ['GET outline', 1, get(`/api/documents/${id}/outline`)],
          ['GET node', 1, get(`/api/documents/${id}/nodes/p-extra`)],
          ['GET container', 1, get(`/api/documents/${id}/containers/foreword`)],
          ['GET export/json', 1, get(`/api/documents/${id}/export/json`)],
          ['GET export/html', 1, get(`/api/documents/${id}/export/html`)],
          ['GET export/docx', 1, get(`/api/documents/${id}/export/docx`)],
          ['GET /events（SSE 首次读取）', 1, events],
          ['MCP list_documents', 1, () => mcp.call('list_documents')],
          [
            'MCP get_outline',
            1,
            () => mcp.call('get_outline', { documentId: id }),
          ],
          [
            'MCP get_node',
            1,
            () => mcp.call('get_node', { documentId: id, nodeId: 'p-extra' }),
          ],
          [
            'MCP validate_document',
            1,
            () => mcp.call('validate_document', { documentId: id }),
          ],
          [
            'MCP export_document(json)',
            1,
            () =>
              mcp.call('export_document', { documentId: id, format: 'json' }),
          ],
          // 版本：创建、列表、详情各 1 次
          [
            'POST /versions',
            1,
            async () => {
              const res = await t.http.post('/api/versions').send({
                documentId: id,
                versionNo: '1.0',
                stage: 'working_draft',
                content: { type: 'doc', content: [] },
              });
              versionId = (res.body as VersionBody).id;
            },
          ],
          [
            'GET /versions/document/:id',
            1,
            get(`/api/versions/document/${id}`),
          ],
          [
            'GET /versions/:id',
            1,
            () => status(t.http.get(`/api/versions/${versionId}`)),
          ],
          // prepare 补 nodeId：读 + 条件 UPDATE 共 2 次；补齐之后再读只有 1 次
          [
            'GET outline（补 nodeId）',
            2,
            get(`/api/documents/${damagedId}/outline`),
          ],
          [
            'GET outline（已补齐）',
            1,
            get(`/api/documents/${damagedId}/outline`),
          ],
          // 写：apply 是 prepare 的读 + 事务，共 2 次
          ['POST operations（ai）', 2, () => status(postOps(id, aiBody))],
          [
            'MCP apply_operations',
            2,
            () =>
              mcp.call('apply_operations', {
                documentId: id,
                baseRevision: 1,
                operations: [
                  {
                    op: 'insert',
                    parent: 'ch-extra',
                    position: 'end',
                    content: ['新增段落。'],
                  },
                ],
              }),
          ],
          [
            'PUT /documents/:id',
            1,
            () =>
              status(
                t.http
                  .put(`/api/documents/${id}`)
                  .send({ baseRevision: 2, title: '新标题' }),
              ),
          ],
          [
            'POST /documents',
            1,
            () =>
              status(
                t.http.post('/api/documents').send({
                  title: '新文档',
                  meta,
                  stage: 'working_draft',
                  content: null,
                }),
              ),
          ],
          // remove 在锁内做存在性检查：用不加锁的读，所以只取 1 次（用公开 findOne 会死锁）
          [
            'DELETE /documents/:id',
            1,
            () => status(t.http.delete(`/api/documents/${id}`)),
          ],
          [
            'DELETE 不存在的文档',
            1,
            () => status(t.http.delete('/api/documents/9999')),
          ],
        ];

        try {
          for (const [label, locks, call] of chains) {
            const before = run.mock.calls.length;
            await withTimeout(call(), label);
            expect([label, run.mock.calls.length - before]).toEqual([
              label,
              locks,
            ]);
          }
        } finally {
          await mcp.close();
        }
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('并发', () => {
    const attempts = 6;
    const body = (index: number) => ({
      baseRevision: 0,
      source: 'ai',
      client: `客户端${index}`,
      operations: [
        {
          op: 'insert',
          parent: 'ch-extra',
          position: 'end',
          content: [`写入者${index}的段落。`],
        },
      ],
    });

    it('HTTP：多个 operations 使用同一个 baseRevision 时只有一个成功，其余 409，只有一个版本和一个事件', async () => {
      const id = await createDoc();
      const events = collectEvents(id);
      const responses = await Promise.all(
        Array.from({ length: attempts }, (_, index) =>
          postOps(id, body(index)),
        ),
      );
      expect(responses.map((res) => res.status).sort()).toEqual([
        200,
        ...Array<number>(attempts - 1).fill(409),
      ]);
      const winner = responses.find((res) => res.status === 200)!
        .body as OpsBody;
      for (const loser of responses.filter((res) => res.status === 409)) {
        expect((loser.body as ErrorBody).revision).toBe(1);
      }

      expect((await getDoc(id)).revision).toBe(1);
      const versions = await getVersions(id);
      expect(versions).toHaveLength(1);
      expect(versions[0].id).toBe(winner.versionId);
      expect(events).toHaveLength(1);
      // 文档里恰好只有胜出者的段落。
      expect(JSON.stringify((await getDoc(id)).content)).toContain(
        `写入者${versions[0].client!.slice(3)}的段落`,
      );
      expect(
        JSON.stringify((await getDoc(id)).content).match(/写入者\d的段落/g),
      ).toHaveLength(1);
    });

    it('服务层同一 tick 并发调用，结果相同（事务串行化，不会互相回滚或写出两份）', async () => {
      const id = await createDoc();
      const events = collectEvents(id);
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, (_, index) => {
          const request = body(index);
          return t.ops.apply(id, {
            ...request,
            source: 'ai',
            operations: request.operations as never,
          });
        }),
      );
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(attempts - 1);
      for (const { reason } of rejected) {
        expect(reason).toBeInstanceOf(ConflictException);
      }
      expect((await getDoc(id)).revision).toBe(1);
      expect(await getVersions(id)).toHaveLength(1);
      expect(events).toHaveLength(1);
    });

    it('PUT 与 operations 使用同一个 baseRevision 同时到达：只有一个成功', async () => {
      const id = await createDoc();
      const [put, ops] = await Promise.all([
        t.http
          .put(`/api/documents/${id}`)
          .send({ baseRevision: 0, title: '编辑器保存' }),
        postOps(id, body(0)),
      ]);
      expect([put.status, ops.status].sort()).toEqual([200, 409]);
      expect((await getDoc(id)).revision).toBe(1);
      // 版本记录与文档是否被 operations 写入一致。
      expect(await getVersions(id)).toHaveLength(ops.status === 200 ? 1 : 0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('变更事件', () => {
    it('PUT 发布 human 事件；409 的 PUT 不发布；事件不含文档内容', async () => {
      const id = await createDoc();
      const events = collectEvents(id);

      await reply<DocBody>(
        t.http
          .put(`/api/documents/${id}`)
          .send({ baseRevision: 0, title: '改名' }),
        200,
      );
      await t.http
        .put(`/api/documents/${id}`)
        .send({ baseRevision: 0, title: '过期' })
        .expect(409);

      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event).toEqual({
        documentId: id,
        revision: 1,
        source: 'human',
        at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) as unknown,
      });
      expect(Object.keys(event).sort()).toEqual([
        'at',
        'documentId',
        'revision',
        'source',
      ]);
    });

    it('operations 在提交之后发布，revision 与响应一致；被拒绝的请求不发布', async () => {
      const id = await createDoc();
      const events = collectEvents(id);
      let committedWhenPublished = false;
      t.events.events(id).subscribe(() => {
        // 事件到达时，库里已经是写入后的状态。
        void t.dataSource
          .query(`SELECT revision FROM documents WHERE id = ?`, [id])
          .then((rows: Array<{ revision: number }>) => {
            committedWhenPublished = rows[0].revision === 1;
          });
      });

      await postOps(id, {
        baseRevision: 5,
        source: 'ai',
        operations: [{ op: 'delete', nodeId: 'p-extra' }],
      }).expect(409);
      await postOps(id, {
        baseRevision: 0,
        source: 'ai',
        operations: [{ op: 'delete', nodeId: 'nope' }],
      }).expect(422);
      await postOps(id, {
        baseRevision: 0,
        source: 'ai',
        operations: [],
      }).expect(400);
      expect(events).toEqual([]);

      const ok = await reply<OpsBody>(
        postOps(id, {
          baseRevision: 0,
          source: 'ai',
          client: 'claude-code',
          operations: [{ op: 'delete', nodeId: 'p-extra' }],
        }),
        200,
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        documentId: id,
        revision: ok.revision,
        source: 'ai',
        client: 'claude-code',
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(committedWhenPublished).toBe(true);
    });

    it('事件按文档隔离', async () => {
      const a = await createDoc();
      const b = await createDoc();
      const eventsA = collectEvents(a);
      const eventsB = collectEvents(b);
      await reply<DocBody>(
        t.http.put(`/api/documents/${b}`).send({ baseRevision: 0, title: 'B' }),
        200,
      );
      expect(eventsA).toEqual([]);
      expect(eventsB).toHaveLength(1);
    });
  });
});
