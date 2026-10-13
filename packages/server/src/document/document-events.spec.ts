import { get, type ClientRequest, type IncomingMessage } from 'http';
import { canonical, sampleDocument } from '../test-support/sample-documents';
import { createTestApp, type TestApp } from '../test-support/test-app';

/** 一个已建立的 SSE 连接：累积收到的文本，可以等待某段文本出现，也可以主动断开。 */
interface Stream {
  res: IncomingMessage;
  request: ClientRequest;
  text(): string;
  /** 解析为 SSE 事件块（不含只有注释的块）。 */
  events(): Array<{ event?: string; id?: string; data?: unknown }>;
  waitFor(
    predicate: (text: string) => boolean,
    timeoutMs?: number,
  ): Promise<void>;
  ended(): boolean;
  close(): void;
}

function openStream(baseUrl: string, path: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    let received = '';
    let ended = false;
    const listeners = new Set<() => void>();
    const request = get(
      `${baseUrl}${path}`,
      { headers: { Accept: 'text/event-stream' } },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          received += chunk;
          listeners.forEach((listener) => listener());
        });
        res.on('end', () => {
          ended = true;
          listeners.forEach((listener) => listener());
        });
        res.on('error', () => undefined);
        resolve({
          res,
          request,
          text: () => received,
          events: () =>
            received
              .split('\n\n')
              .filter((block) =>
                block
                  .split('\n')
                  .some((line) => /^(event|data|id):/.test(line)),
              )
              .map((block) => {
                const fields: { event?: string; id?: string; data?: unknown } =
                  {};
                for (const line of block.split('\n')) {
                  if (line.startsWith('event: ')) fields.event = line.slice(7);
                  else if (line.startsWith('id: ')) fields.id = line.slice(4);
                  else if (line.startsWith('data: '))
                    fields.data = JSON.parse(line.slice(6));
                }
                return fields;
              }),
          waitFor: (predicate, timeoutMs = 3000) =>
            new Promise<void>((done, fail) => {
              const check = () => {
                if (predicate(received)) {
                  clearTimeout(timer);
                  listeners.delete(check);
                  done();
                }
              };
              const timer = setTimeout(() => {
                listeners.delete(check);
                fail(
                  new Error(
                    `等待 SSE 内容超时，已收到：${JSON.stringify(received)}`,
                  ),
                );
              }, timeoutMs);
              listeners.add(check);
              check();
            }),
          ended: () => ended,
          close: () => request.destroy(),
        });
      },
    );
    request.on('error', (error) => {
      // 主动 destroy 会触发 ECONNRESET；连接建立之前的错误才是失败。
      if (!request.destroyed) reject(error);
    });
  });
}

async function waitUntil(
  condition: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('等待条件超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('GET /api/documents/:id/events（SSE）', () => {
  let t: TestApp;
  const openStreams: Stream[] = [];

  beforeEach(async () => {
    // 心跳间隔调小，让心跳用例不必等 15 秒。
    t = await createTestApp({ heartbeatMs: 40 });
  });
  afterEach(async () => {
    openStreams.splice(0).forEach((stream) => stream.close());
    await t.app.close();
  });

  async function createDoc(): Promise<number> {
    const res = await t.http
      .post('/api/documents')
      .send({
        title: '事件测试',
        meta: { titleCn: '事件测试', standardType: 'national' },
        content: canonical(sampleDocument()),
      })
      .expect(201);
    return (res.body as { id: number }).id;
  }

  async function subscribe(id: number): Promise<Stream> {
    const stream = await openStream(t.url, `/api/documents/${id}/events`);
    openStreams.push(stream);
    return stream;
  }

  const put = (id: number, body: Record<string, unknown>) =>
    t.http.put(`/api/documents/${id}`).send(body);

  it('响应头是 text/event-stream，连接建立后先给出重连间隔', async () => {
    const id = await createDoc();
    const stream = await subscribe(id);
    expect(stream.res.statusCode).toBe(200);
    expect(stream.res.headers['content-type']).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(stream.res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(stream.res.headers['x-accel-buffering']).toBe('no');
    await stream.waitFor((text) => text.includes('retry: 3000\n\n'));
    expect(t.events.subscriberCount(id)).toBe(1);
    // 没有事件：不推送当前内容或 revision。
    expect(stream.events()).toEqual([]);
  });

  it('PUT 之后收到 document-changed 事件：id 为 revision，data 只含元数据，不含文档内容', async () => {
    const id = await createDoc();
    const stream = await subscribe(id);
    await stream.waitFor((text) => text.includes('retry:'));

    await put(id, { baseRevision: 0, title: '改名' }).expect(200);
    await stream.waitFor((text) => text.includes('event: document-changed'));

    const [event] = stream.events();
    expect(event.event).toBe('document-changed');
    expect(event.id).toBe('1');
    expect(event.data).toEqual({
      documentId: id,
      revision: 1,
      source: 'human',
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
    });
    expect(stream.text()).not.toContain('前言第一段');
  });

  it('operations（ai）与读接口触发的规范化（system）也会推送，带 source 与 client', async () => {
    const id = await createDoc();
    const damaged = await t.http
      .post('/api/documents')
      .send({
        title: '缺 id',
        meta: { titleCn: '缺 id', standardType: 'national' },
        content: {
          type: 'doc',
          content: [
            {
              type: 'chapter',
              attrs: { nodeId: 'c1', secType: 'general' },
              content: [
                {
                  type: 'chapterTitle',
                  content: [{ type: 'text', text: '章' }],
                },
                {
                  type: 'stdParagraph',
                  content: [{ type: 'text', text: '缺 id' }],
                },
              ],
            },
          ],
        },
      })
      .expect(201);
    const damagedId = (damaged.body as { id: number }).id;

    const stream = await subscribe(id);
    const damagedStream = await subscribe(damagedId);
    await stream.waitFor((text) => text.includes('retry:'));
    await damagedStream.waitFor((text) => text.includes('retry:'));

    await t.http
      .post(`/api/documents/${id}/operations`)
      .send({
        baseRevision: 0,
        source: 'ai',
        client: 'claude-code',
        operations: [{ op: 'delete', nodeId: 'p-extra' }],
      })
      .expect(200);
    await t.http.get(`/api/documents/${damagedId}/outline`).expect(200);

    await stream.waitFor((text) => text.includes('event: document-changed'));
    await damagedStream.waitFor((text) =>
      text.includes('event: document-changed'),
    );
    expect(stream.events()[0].data).toMatchObject({
      documentId: id,
      revision: 1,
      source: 'ai',
      client: 'claude-code',
    });
    expect(damagedStream.events()[0].data).toMatchObject({
      documentId: damagedId,
      revision: 1,
      source: 'system',
    });
    expect(damagedStream.events()[0].data).not.toHaveProperty('client');
  });

  it('只推送所订阅文档的事件；多个订阅者各自收到', async () => {
    const a = await createDoc();
    const b = await createDoc();
    const first = await subscribe(a);
    const second = await subscribe(a);
    const other = await subscribe(b);
    for (const stream of [first, second, other]) {
      await stream.waitFor((text) => text.includes('retry:'));
    }

    await put(b, { baseRevision: 0, title: 'B' }).expect(200);
    await put(a, { baseRevision: 0, title: 'A' }).expect(200);
    await other.waitFor((text) => text.includes('event: document-changed'));
    await first.waitFor((text) => text.includes('event: document-changed'));
    await second.waitFor((text) => text.includes('event: document-changed'));

    expect(
      first
        .events()
        .map((event) => (event.data as { documentId: number }).documentId),
    ).toEqual([a]);
    expect(second.events()).toHaveLength(1);
    expect(
      other
        .events()
        .map((event) => (event.data as { documentId: number }).documentId),
    ).toEqual([b]);
  });

  it('定期发送心跳注释', async () => {
    const id = await createDoc();
    const stream = await subscribe(id);
    await stream.waitFor(
      (text) => (text.match(/^: heartbeat$/gm) ?? []).length >= 2,
    );
    // 心跳不是事件。
    expect(stream.events()).toEqual([]);
  });

  it('客户端断开后订阅被清理；其他订阅者不受影响', async () => {
    const id = await createDoc();
    const staying = await subscribe(id);
    const leaving = await subscribe(id);
    await staying.waitFor((text) => text.includes('retry:'));
    await leaving.waitFor((text) => text.includes('retry:'));
    expect(t.events.subscriberCount(id)).toBe(2);

    leaving.close();
    await waitUntil(() => t.events.subscriberCount(id) === 1);

    await put(id, { baseRevision: 0, title: '断开后的写入' }).expect(200);
    await staying.waitFor((text) => text.includes('event: document-changed'));

    staying.close();
    await waitUntil(() => t.events.subscriberCount(id) === 0);
  });

  it('断开之后心跳定时器被清除', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    try {
      const id = await createDoc();
      const stream = await subscribe(id);
      await stream.waitFor((text) => text.includes('retry:'));
      // 心跳定时器：间隔为测试配置的 40 毫秒。
      const call = setIntervalSpy.mock.calls.findIndex(
        ([, delay]) => delay === 40,
      );
      expect(call).toBeGreaterThanOrEqual(0);
      const handle = setIntervalSpy.mock.results[call].value as unknown;

      stream.close();
      await waitUntil(() =>
        clearIntervalSpy.mock.calls.some(([cleared]) => cleared === handle),
      );
      await waitUntil(() => t.events.subscriberCount(id) === 0);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('应用关闭时，仍在连接的 SSE 流会正常结束，app.close() 不会被拖住', async () => {
    const id = await createDoc();
    const stream = await subscribe(id);
    await stream.waitFor((text) => text.includes('retry:'));

    await t.app.close();
    await stream.waitFor(() => stream.ended());
    expect(t.events.subscriberCount(id)).toBe(0);
  });

  it('文档不存在返回 404（JSON，不进入事件流）；id 不是整数返回 400', async () => {
    const missing = await t.http
      .get('/api/documents/987654/events')
      .expect(404);
    expect(missing.headers['content-type']).toContain('application/json');
    await t.http.get('/api/documents/abc/events').expect(400);
    expect(t.events.subscriberCount(987654)).toBe(0);
  });
});
