import { Logger } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import request from 'supertest';
import {
  connectMcp,
  type McpTestClient,
} from '../test-support/mcp-test-client';
import { createTestApp, type TestApp } from '../test-support/test-app';

const MCP_HEADERS = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};

describe('MCP 会话', () => {
  let t: TestApp;
  let appClosed: boolean;
  const clients: McpTestClient[] = [];
  /** 假时钟（毫秒），用例里手动推进。 */
  const clock = { value: 1_000_000 };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    clock.value = 1_000_000;
    appClosed = false;
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) await client.close();
    if (!appClosed) await t.app.close();
    jest.restoreAllMocks();
  });

  async function start(options: {
    idleTimeoutMs?: number;
    maxSessions?: number;
  }): Promise<void> {
    t = await createTestApp({
      mcp: { now: () => clock.value, ...options },
    });
  }

  async function connect(name = 'ses-test-client'): Promise<McpTestClient> {
    const client = await connectMcp(t, { name, version: '1' });
    clients.push(client);
    return client;
  }

  const sessionIdOf = (client: McpTestClient): string => {
    const id = client.transport.sessionId;
    if (!id) throw new Error('客户端没有会话 id');
    return id;
  };

  /** 不经 SDK 客户端，直接发 initialize，返回会话 id（因此不会自动打开 SSE 流）。 */
  async function rawInitialize(name = 'raw-client'): Promise<string> {
    const res = await request(t.url)
      .post('/mcp')
      .set(MCP_HEADERS)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name, version: '1' },
        },
      })
      .expect(200);
    return res.headers['mcp-session-id'];
  }

  /** 带会话 id 的原始 JSON-RPC 请求（tools/list）。 */
  const listTools = (sessionId: string) =>
    request(t.url)
      .post('/mcp')
      .set(MCP_HEADERS)
      .set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} });

  /**
   * 监视会话关闭：Server.close 与 transport.close 各被调用了几次。
   * Node 版 StreamableHTTPServerTransport 只是包装，真正的 close 在 Web 标准版 transport 上
   * （DELETE 请求也是直接调用它，不经过 Server.close）。
   */
  function spyOnClose() {
    return {
      server: jest.spyOn(Server.prototype, 'close'),
      transport: jest.spyOn(
        WebStandardStreamableHTTPServerTransport.prototype,
        'close',
      ),
    };
  }

  // ---------------------------------------------------------------------------
  describe('路由与会话约定', () => {
    beforeEach(async () => {
      await start({});
    });

    it('端点是 /mcp，不带 api 前缀；/api/mcp 不存在', async () => {
      await request(t.url)
        .post('/mcp')
        .set(MCP_HEADERS)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'route-test', version: '1' },
          },
        })
        .expect(200);
      await request(t.url)
        .post('/api/mcp')
        .set(MCP_HEADERS)
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
        .expect(404);
      // 其余接口仍在 /api 下
      await t.http.get('/api/documents').expect(200);
      await request(t.url).get('/documents').expect(404);
    });

    it('initialize 返回 JSON（不是 SSE 流）和会话 id', async () => {
      const res = await request(t.url)
        .post('/mcp')
        .set(MCP_HEADERS)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'json-test', version: '1' },
          },
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['mcp-session-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(res.body).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'ses' } },
      });
      expect(t.mcp.size).toBe(1);
    });

    it('没有会话 id 的非 initialize 请求 → 400', async () => {
      const post = await request(t.url)
        .post('/mcp')
        .set(MCP_HEADERS)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
        .expect(400);
      expect(
        (post.body as { error: { message: string } }).error.message,
      ).toContain('Mcp-Session-Id');

      await request(t.url)
        .get('/mcp')
        .set('Accept', 'text/event-stream')
        .expect(400);
      await request(t.url).delete('/mcp').expect(400);
      expect(t.mcp.size).toBe(0);
    });

    it('未知的会话 id → 404（客户端据此重新 initialize）', async () => {
      const post = await listTools(
        '00000000-0000-4000-8000-000000000000',
      ).expect(404);
      expect(post.body).toMatchObject({
        jsonrpc: '2.0',
        error: { code: -32001 },
        id: null,
      });
      await request(t.url)
        .get('/mcp')
        .set('Accept', 'text/event-stream')
        .set('Mcp-Session-Id', 'nope')
        .expect(404);
      await request(t.url)
        .delete('/mcp')
        .set('Mcp-Session-Id', 'nope')
        .expect(404);
      // 带着未知会话 id 的 initialize 也是 404：规范要求重新 initialize 时不带会话 id
      await request(t.url)
        .post('/mcp')
        .set(MCP_HEADERS)
        .set('Mcp-Session-Id', 'nope')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'x', version: '1' },
          },
        })
        .expect(404);
      expect(t.mcp.size).toBe(0);
    });

    it('已初始化的会话重复 initialize → 400，不新增会话', async () => {
      const client = await connect();
      await request(t.url)
        .post('/mcp')
        .set(MCP_HEADERS)
        .set('Mcp-Session-Id', sessionIdOf(client))
        .send({
          jsonrpc: '2.0',
          id: 9,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'again', version: '1' },
          },
        })
        .expect(400);
      expect(t.mcp.size).toBe(1);
    });

    it('initialize 失败（Accept 头不对）：不留下会话，临时的 Server 与 transport 被关闭', async () => {
      const closed = spyOnClose();
      await request(t.url)
        .post('/mcp')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'x', version: '1' },
          },
        })
        .expect(406);
      expect(t.mcp.size).toBe(0);
      expect(closed.server).toHaveBeenCalledTimes(1);
      expect(closed.transport).toHaveBeenCalledTimes(1);
    });

    it('会话 id 对应各自的 Server：两个客户端互不影响', async () => {
      const [a, b] = [await connect('a'), await connect('b')];
      expect(sessionIdOf(a)).not.toBe(sessionIdOf(b));
      expect(t.mcp.size).toBe(2);
      expect((await a.client.listTools()).tools).toHaveLength(8);
      expect((await b.client.listTools()).tools).toHaveLength(8);
    });
  });

  // ---------------------------------------------------------------------------
  describe('DELETE 结束会话', () => {
    beforeEach(async () => {
      await start({});
    });

    it('DELETE 关闭会话：Server 与 transport 都关闭，随后该会话 id 返回 404', async () => {
      const client = await connect();
      const other = await connect('other');
      const sessionId = sessionIdOf(client);
      const closed = spyOnClose();

      await client.transport.terminateSession();

      // DELETE 由 transport 自己关闭（不经过 Server.close）；会话表里的条目是被 Server 的 onclose 移除的，
      // 说明 transport 的关闭已传到 Server。
      expect(closed.transport).toHaveBeenCalledTimes(1);
      expect(t.mcp.size).toBe(1);
      await listTools(sessionId).expect(404);
      // 另一个会话不受影响
      await listTools(sessionIdOf(other)).expect(200);
    });

    it('原始 DELETE 请求同样有效；重复 DELETE 得到 404', async () => {
      const client = await connect();
      const sessionId = sessionIdOf(client);
      await request(t.url)
        .delete('/mcp')
        .set('Mcp-Session-Id', sessionId)
        .expect(200);
      expect(t.mcp.size).toBe(0);
      await request(t.url)
        .delete('/mcp')
        .set('Mcp-Session-Id', sessionId)
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // 下面两组用例依赖假时钟，所以用 rawInitialize 建立会话：SDK 客户端在握手后还会在后台打开 SSE 流，
  // 那个请求到达的时刻不确定，会刷新会话的最近使用时间，让用例变得不稳定。
  describe('空闲超时', () => {
    const IDLE = 60_000;
    beforeEach(async () => {
      await start({ idleTimeoutMs: IDLE });
    });

    it('空闲不足超时的会话照常使用；每次请求都会刷新空闲计时', async () => {
      const sessionId = await rawInitialize();

      clock.value += IDLE - 1;
      await listTools(sessionId).expect(200);
      clock.value += IDLE - 1; // 距上一次请求仍不足 IDLE
      await listTools(sessionId).expect(200);
      clock.value += IDLE - 1;
      await listTools(sessionId).expect(200);
      expect(t.mcp.size).toBe(1);
    });

    it('空闲满超时的会话失效：返回 404，Server 与 transport 被关闭，会话数减少', async () => {
      const sessionId = await rawInitialize();
      const closed = spyOnClose();

      clock.value += IDLE;
      await listTools(sessionId).expect(404);

      expect(t.mcp.size).toBe(0);
      expect(closed.server).toHaveBeenCalledTimes(1);
      expect(closed.transport).toHaveBeenCalledTimes(1);
      // 之后也是 404，客户端需要重新 initialize
      await listTools(sessionId).expect(404);
      expect(closed.server).toHaveBeenCalledTimes(1);
      const fresh = await rawInitialize();
      expect(fresh).not.toBe(sessionId);
      await listTools(fresh).expect(200);
    });

    it('SDK 客户端的会话过期后，重新 initialize 即可继续使用', async () => {
      const client = await connect();
      const oldId = sessionIdOf(client);
      clock.value += IDLE;
      await listTools(oldId).expect(404);

      const again = await connect();
      expect(sessionIdOf(again)).not.toBe(oldId);
      expect((await again.client.listTools()).tools).toHaveLength(8);
    });

    it('GET 与 DELETE 对已过期的会话同样是 404', async () => {
      const sessionId = await rawInitialize();
      clock.value += IDLE;
      await request(t.url)
        .get('/mcp')
        .set('Accept', 'text/event-stream')
        .set('Mcp-Session-Id', sessionId)
        .expect(404);
      await request(t.url)
        .delete('/mcp')
        .set('Mcp-Session-Id', sessionId)
        .expect(404);
    });

    it('sweep 关闭所有已过期的会话，保留仍活跃的', async () => {
      const stale1 = await rawInitialize('stale-1');
      const stale2 = await rawInitialize('stale-2');
      clock.value += IDLE / 2;
      const fresh = await rawInitialize('fresh');
      clock.value += IDLE / 2; // stale 空闲 IDLE，fresh 空闲 IDLE / 2
      const closed = spyOnClose();

      expect(t.mcp.sweep()).toBe(2);

      expect(t.mcp.size).toBe(1);
      expect(closed.server).toHaveBeenCalledTimes(2);
      expect(closed.transport).toHaveBeenCalledTimes(2);
      await listTools(stale1).expect(404);
      await listTools(stale2).expect(404);
      await listTools(fresh).expect(200);
      expect(t.mcp.sweep()).toBe(0);
    });

    it('后台定时清理：定时器不阻止进程退出，应用关闭时被清除', async () => {
      // beforeEach 里的应用已经创建过定时器；这里另建一个应用，监视它创建和清除的定时器。
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const other = await createTestApp();
      try {
        const index = setIntervalSpy.mock.calls.findIndex(
          ([, ms]) => ms === 5 * 60 * 1000,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const timer = setIntervalSpy.mock.results[index]
          .value as NodeJS.Timeout;
        expect(timer.hasRef()).toBe(false);

        await other.app.close();
        expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('会话数上限', () => {
    beforeEach(async () => {
      await start({ maxSessions: 2 });
    });

    it('满时淘汰最久未使用的会话，而不是最早创建的', async () => {
      const a = await rawInitialize('a'); // 创建于 t0
      clock.value += 10;
      const b = await rawInitialize('b'); // t0 + 10
      clock.value += 10;
      await listTools(a).expect(200); // a 在 t0 + 20 被使用，b 变成最久未使用
      clock.value += 10;
      const closed = spyOnClose();

      const c = await rawInitialize('c'); // 达到上限：淘汰 b

      expect(t.mcp.size).toBe(2);
      expect(closed.server).toHaveBeenCalledTimes(1);
      expect(closed.transport).toHaveBeenCalledTimes(1);
      await listTools(b).expect(404);
      await listTools(a).expect(200);
      await listTools(c).expect(200);
    });

    it('时间相同时淘汰先建立的', async () => {
      const a = await rawInitialize('a');
      const b = await rawInitialize('b');
      const c = await rawInitialize('c');
      await listTools(a).expect(404);
      await listTools(b).expect(200);
      await listTools(c).expect(200);
    });

    it('被淘汰的会话已完全关闭之后，新会话的 initialize 才返回', async () => {
      const a = await rawInitialize('a');
      clock.value += 1;
      await rawInitialize('b');
      clock.value += 1;
      const order: string[] = [];
      const originalClose = Reflect.get(Server.prototype, 'close') as (
        this: Server,
      ) => Promise<void>;
      jest.spyOn(Server.prototype, 'close').mockImplementation(async function (
        this: Server,
      ) {
        await originalClose.call(this);
        order.push('closed');
      });
      const c = await rawInitialize('c');
      order.push('initialized');
      expect(order).toEqual(['closed', 'initialized']);
      await listTools(a).expect(404);
      await listTools(c).expect(200);
    });

    it('并发建立大量会话也不会突破上限', async () => {
      const ids = await Promise.all(
        Array.from({ length: 6 }, (_, i) => rawInitialize(`c${i}`)),
      );
      expect(new Set(ids).size).toBe(6);
      expect(t.mcp.size).toBe(2);
    });

    it('未满时不淘汰', async () => {
      const closed = spyOnClose();
      await rawInitialize('a');
      await rawInitialize('b');
      expect(t.mcp.size).toBe(2);
      expect(closed.server).not.toHaveBeenCalled();
    });

    it('SDK 客户端的会话也按同样的规则淘汰', async () => {
      const first = await connect('first');
      await connect('second');
      await connect('third'); // 此时 first 最久未使用（假时钟没有推进，同时间取先建立的）
      expect(t.mcp.size).toBe(2);
      await listTools(sessionIdOf(first)).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('应用关闭', () => {
    it('关闭应用时所有会话的 Server 与 transport 都被关闭（含保持中的 SSE 流），关闭不会挂起', async () => {
      await start({});
      const ids = [
        await rawInitialize('a'),
        await rawInitialize('b'),
        await rawInitialize('c'),
      ];
      expect(t.mcp.size).toBe(3);
      // 每个会话打开一条服务端到客户端的 SSE 流：不先关闭会话，HTTP 服务器就无法正常关闭。
      const streams = await Promise.all(
        ids.map((id) =>
          fetch(`${t.url}/mcp`, {
            headers: { Accept: 'text/event-stream', 'Mcp-Session-Id': id },
          }),
        ),
      );
      expect(streams.map((res) => res.status)).toEqual([200, 200, 200]);
      const closed = spyOnClose();

      appClosed = true;
      await t.app.close();

      expect(closed.server).toHaveBeenCalledTimes(3);
      expect(closed.transport).toHaveBeenCalledTimes(3);
      expect(t.mcp.size).toBe(0);
      // SSE 流已由服务端结束，读取会正常返回
      for (const res of streams) {
        await expect(res.text()).resolves.toBeDefined();
      }
    });

    it('关闭后会话表为空，没有会话时关闭也正常', async () => {
      await start({});
      appClosed = true;
      await t.app.close();
      expect(t.mcp.size).toBe(0);
    });
  });
});
