import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { connectMcp } from '../test-support/mcp-test-client';
import { createTestApp, type TestApp } from '../test-support/test-app';
import {
  checkMcpAccess,
  isAllowedHost,
  isAllowedOrigin,
  isLoopbackAddress,
  McpAccessGuard,
} from './mcp-access';

describe('MCP 访问控制：判断函数', () => {
  describe('isLoopbackAddress', () => {
    it.each([
      '127.0.0.1',
      '127.0.0.2',
      '127.1.2.3',
      '127.255.255.255',
      '::1',
      '::ffff:127.0.0.1',
      '::FFFF:127.0.0.1',
      '::ffff:127.8.9.10',
    ])('%s 是回环地址', (address) => {
      expect(isLoopbackAddress(address)).toBe(true);
    });

    it.each([
      undefined,
      '',
      '0.0.0.0',
      '126.255.255.255',
      '128.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '192.168.1.20',
      '8.8.8.8',
      '::',
      '::2',
      '2001:db8::1',
      'fe80::1',
      '::ffff:192.168.1.20',
      '::ffff:10.0.0.1',
      // 形似回环的非回环写法
      '127.0.0.1.evil.com',
      '127.0.0.256',
      '127.0.0',
      '127.0.0.1.5',
      '1.127.0.0.1',
      '0127.0.0.1',
      '127.00.0.1',
      ' 127.0.0.1',
      '127.0.0.1 ',
      '127.0.0.1\n',
      'localhost',
      '::ffff:127.0.0.1:80',
      '[::1]',
    ])('%j 不是回环地址', (address) => {
      expect(isLoopbackAddress(address)).toBe(false);
    });
  });

  describe('isAllowedHost', () => {
    it.each([
      'localhost',
      'LOCALHOST',
      'LocalHost',
      'localhost:3000',
      'localhost:1',
      'localhost:65535',
      '127.0.0.1',
      '127.0.0.1:3000',
      '[::1]',
      '[::1]:3000',
    ])('%s 放行', (host) => {
      expect(isAllowedHost(host)).toBe(true);
    });

    it.each([
      undefined,
      '',
      'evil.com',
      'evil.com:3000',
      // 子串、前缀、后缀都不算
      'localhost.evil.com',
      'localhost.evil.com:3000',
      'evil.localhost.com',
      'notlocalhost',
      'localhost.',
      '127.0.0.1.nip.io',
      '127.0.0.1.nip.io:3000',
      '127.0.0.1.evil.com',
      'localhost@evil.com',
      'evil.com@localhost',
      'user:pass@localhost',
      'evil.com#localhost',
      'evil.com/localhost',
      // 回环网段里只认 127.0.0.1；其他写法一律不认
      '127.0.0.2',
      '127.0.1',
      '0.0.0.0',
      '2130706433',
      '0x7f.0.0.1',
      '::1',
      '[::2]',
      '[::1',
      '[0:0:0:0:0:0:0:1]',
      // 端口不合法
      'localhost:',
      'localhost:abc',
      'localhost:0x50',
      'localhost:-1',
      'localhost:65536',
      'localhost:99999',
      'localhost:123456',
      'localhost:3000:4000',
      ' localhost',
      'localhost ',
      'localhost\n',
      'localhost, evil.com',
    ])('%j 拒绝', (host) => {
      expect(isAllowedHost(host)).toBe(false);
    });
  });

  describe('isAllowedOrigin', () => {
    it.each([
      undefined, // 非浏览器客户端不带 Origin
      'http://localhost',
      'http://localhost:5173',
      'http://127.0.0.1',
      'http://127.0.0.1:3000',
      'http://[::1]',
      'http://[::1]:5173',
      'HTTP://LOCALHOST:5173',
      'http://LocalHost:80',
    ])('%j 放行', (origin) => {
      expect(isAllowedOrigin(origin)).toBe(true);
    });

    it.each([
      '',
      'null',
      'https://localhost',
      'https://127.0.0.1:3000',
      'http://evil.com',
      'http://evil.com:5173',
      'http://localhost.evil.com',
      'http://localhost.evil.com:5173',
      'http://127.0.0.1.nip.io',
      'http://127.0.0.1.nip.io:3000',
      'http://localhost@evil.com',
      'http://evil.com@localhost',
      'http://evil.com/localhost',
      'http://localhost:5173/',
      'http://localhost/path',
      'http://localhost:99999',
      'http://localhost:',
      'http://127.0.0.2',
      'http://0.0.0.0',
      'localhost',
      'localhost:5173',
      '//localhost',
      'file://localhost',
      'chrome-extension://abcdefgh',
      // 重复的 Origin 头会被 Node 用逗号拼起来
      'http://localhost, http://evil.com',
      'http://evil.com, http://localhost',
      ' http://localhost',
    ])('%j 拒绝', (origin) => {
      expect(isAllowedOrigin(origin)).toBe(false);
    });
  });

  describe('checkMcpAccess', () => {
    const ok = {
      remoteAddress: '127.0.0.1',
      host: 'localhost:3000',
      origin: undefined,
    };

    it('三条都满足时放行', () => {
      expect(checkMcpAccess(ok)).toBeNull();
      expect(
        checkMcpAccess({
          remoteAddress: '::ffff:127.0.0.1',
          host: '[::1]:3000',
          origin: 'http://localhost:5173',
        }),
      ).toBeNull();
    });

    it('各条独立生效，并按 地址 → Host → Origin 的顺序报告第一条被违反的', () => {
      expect(checkMcpAccess({ ...ok, remoteAddress: '192.168.1.20' })).toBe(
        'non-loopback-address',
      );
      expect(checkMcpAccess({ ...ok, host: 'evil.com' })).toBe('invalid-host');
      expect(checkMcpAccess({ ...ok, host: undefined })).toBe('invalid-host');
      expect(checkMcpAccess({ ...ok, origin: 'http://evil.com' })).toBe(
        'invalid-origin',
      );
      // 地址不对时，即使 Host 与 Origin 看起来都对（局域网上的机器可以随意伪造 Host），也必须拒绝。
      expect(
        checkMcpAccess({
          remoteAddress: '192.168.1.20',
          host: 'localhost:3000',
          origin: 'http://localhost:5173',
        }),
      ).toBe('non-loopback-address');
      expect(
        checkMcpAccess({
          remoteAddress: '192.168.1.20',
          host: 'evil.com',
          origin: 'http://evil.com',
        }),
      ).toBe('non-loopback-address');
      expect(
        checkMcpAccess({ ...ok, host: 'evil.com', origin: 'http://evil.com' }),
      ).toBe('invalid-host');
    });
  });
});

describe('MCP 访问控制：守卫', () => {
  const guard = new McpAccessGuard();

  function contextFor(request: {
    remoteAddress?: string;
    host?: string;
    origin?: string;
  }): ExecutionContext {
    const req = {
      socket: { remoteAddress: request.remoteAddress },
      headers: { host: request.host, origin: request.origin },
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('满足全部条件时放行', () => {
    expect(
      guard.canActivate(
        contextFor({ remoteAddress: '::1', host: '[::1]:3000' }),
      ),
    ).toBe(true);
  });

  it.each([
    ['非回环地址', { remoteAddress: '192.168.1.20', host: 'localhost' }],
    ['缺少对端地址', { host: 'localhost' }],
    ['Host 不合法', { remoteAddress: '127.0.0.1', host: 'evil.com' }],
    ['缺少 Host', { remoteAddress: '127.0.0.1' }],
    [
      'Origin 不合法',
      {
        remoteAddress: '127.0.0.1',
        host: 'localhost',
        origin: 'http://evil.com',
      },
    ],
  ])('%s：403', (_name, request) => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    expect(() => guard.canActivate(contextFor(request))).toThrow(
      ForbiddenException,
    );
  });

  it('日志只记录拒绝原因，不含地址、Host 与 Origin 的值', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    expect(() =>
      guard.canActivate(
        contextFor({
          remoteAddress: '203.0.113.77',
          host: 'secret-host.example',
          origin: 'http://secret-origin.example',
        }),
      ),
    ).toThrow(ForbiddenException);
    const logged = warn.mock.calls.map((args) => args.map(String).join(' '));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('non-loopback-address');
    expect(logged[0]).not.toContain('203.0.113.77');
    expect(logged[0]).not.toContain('secret');
  });
});

describe('MCP 访问控制：端到端', () => {
  let t: TestApp;

  const INITIALIZE = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'access-test', version: '1' },
    },
  };

  /** 发一个合法的 MCP initialize 请求，可替换 Host / Origin。 */
  function postInitialize(
    headers: Record<string, string> = {},
    url = t.url,
  ): request.Test {
    return request(url)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(INITIALIZE);
  }

  beforeEach(async () => {
    t = await createTestApp();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await t.app.close();
  });

  describe('Host 头', () => {
    it.each([
      'evil.com',
      'evil.com:3000',
      'localhost.evil.com',
      'localhost.evil.com:3000',
      '127.0.0.1.nip.io',
      '127.0.0.2',
    ])('Host: %s → 403，不创建会话', async (host) => {
      const res = await postInitialize({ Host: host }).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403 });
      expect((res.body as { message: string }).message).toContain('Host');
      expect(t.mcp.size).toBe(0);
    });

    it.each([
      ['GET', 'get'],
      ['DELETE', 'delete'],
    ] as const)('%s 同样检查 Host', async (_method, verb) => {
      await request(t.url)
        [verb]('/mcp')
        .set('Host', 'evil.com')
        .set('Accept', 'text/event-stream')
        .set('Mcp-Session-Id', 'whatever')
        .expect(403);
    });

    it.each(['localhost', 'LOCALHOST:8080', '127.0.0.1', '[::1]:3000'])(
      'Host: %s → 放行（端口任意）',
      async (host) => {
        await postInitialize({ Host: host }).expect(200);
        expect(t.mcp.size).toBeGreaterThan(0);
      },
    );
  });

  describe('Origin 头', () => {
    it.each([
      'http://evil.com',
      'http://evil.com:5173',
      'http://localhost.evil.com',
      'http://127.0.0.1.nip.io:3000',
      'https://localhost',
      'null',
    ])('Origin: %s → 403，不创建会话', async (origin) => {
      const res = await postInitialize({ Origin: origin }).expect(403);
      expect((res.body as { message: string }).message).toContain('Origin');
      expect(t.mcp.size).toBe(0);
    });

    it('Host 合法但 Origin 不合法（浏览器里的其他网页）→ 403', async () => {
      await postInitialize({
        Host: 'localhost:3000',
        Origin: 'http://attacker.example',
      }).expect(403);
    });

    it.each([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
    ])('Origin: %s → 放行', async (origin) => {
      await postInitialize({ Origin: origin }).expect(200);
    });

    it('没有 Origin（非浏览器客户端）→ 放行', async () => {
      await postInitialize().expect(200);
    });
  });

  describe('对端地址', () => {
    /**
     * 让服务端看到的对端地址变成指定值。remoteAddress 是 net.Socket.prototype 上不可配置的访问器，
     * 不能整体替换，但可以在每个请求到达 Express 之前，在该连接的套接字实例上定义同名属性。
     */
    function spoofRemoteAddress(address: string): void {
      const server = t.app.getHttpServer() as Server;
      server.prependListener('request', (req) => {
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: address,
          configurable: true,
        });
      });
    }

    it.each(['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '2001:db8::1'])(
      '对端 %s（Host、Origin 都合法）→ 403，不创建会话',
      async (address) => {
        spoofRemoteAddress(address);
        const res = await postInitialize({
          Host: 'localhost:3000',
          Origin: 'http://localhost:5173',
        }).expect(403);
        expect((res.body as { message: string }).message).toContain(
          '只接受来自本机的连接',
        );
        await request(t.url)
          .get('/mcp')
          .set('Accept', 'text/event-stream')
          .expect(403);
        await request(t.url).delete('/mcp').expect(403);
        expect(t.mcp.size).toBe(0);
      },
    );

    it('SDK 客户端连不上：initialize 被拒绝', async () => {
      spoofRemoteAddress('192.168.1.20');
      await expect(connectMcp(t)).rejects.toThrow();
      expect(t.mcp.size).toBe(0);
    });

    it('回环形式的对端地址（含 IPv4 映射）放行', async () => {
      spoofRemoteAddress('::ffff:127.0.0.1');
      await postInitialize().expect(200);
    });

    it('只限制 /mcp：其余接口不受影响', async () => {
      spoofRemoteAddress('192.168.1.20');
      await t.http.get('/api/documents').expect(200);
    });
  });

  it('被拒绝的请求不泄露内部信息，也不记录请求头的值', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockClear();
    const res = await postInitialize({ Host: 'attacker-host.example' }).expect(
      403,
    );
    expect(JSON.stringify(res.body)).not.toContain('attacker-host');
    const logged = warn.mock.calls.map((args) => args.map(String).join(' '));
    expect(logged.join('\n')).toContain('invalid-host');
    expect(logged.join('\n')).not.toContain('attacker-host');
  });
});
