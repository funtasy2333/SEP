import { Logger } from '@nestjs/common';
import request from 'supertest';
import { createSystemTestApp } from '../test-support/system-test-app';
import { createTestApp, type TestApp } from '../test-support/test-app';
import { ALLOWED_HOSTS_ENV } from './allowed-host';
import { HOST_FORBIDDEN_BODY } from './host-check';

const SAVED_ENV = {
  [ALLOWED_HOSTS_ENV]: process.env[ALLOWED_HOSTS_ENV],
  SES_LISTEN_HOST: process.env.SES_LISTEN_HOST,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('全局 Host 检查（防 DNS 重绑定）', () => {
  let t: TestApp;
  let warn: jest.SpyInstance;

  const INITIALIZE = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'host-check-test', version: '1' },
    },
  };

  const port = () => new URL(t.url).port;

  beforeEach(async () => {
    delete process.env[ALLOWED_HOSTS_ENV];
    delete process.env.SES_LISTEN_HOST;
    t = await createTestApp();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    restoreEnv();
    await t.app.close();
  });

  describe('伪造 Host: attacker.example:3000', () => {
    const FORGED = 'attacker.example:3000';

    it('GET /api/documents → 403，响应体是约定的 JSON', async () => {
      const res = await t.http.get('/api/documents').set('Host', FORGED);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(HOST_FORBIDDEN_BODY);
      expect((res.body as { message: string }).message).toContain(
        'SES_ALLOWED_HOSTS',
      );
    });

    it('POST /api/documents → 403，且没有创建文档', async () => {
      const before = (await t.http.get('/api/documents').expect(200))
        .body as unknown[];
      await t.http
        .post('/api/documents')
        .set('Host', FORGED)
        .send({ title: '攻击者创建的文档' })
        .expect(403);
      const after = (await t.http.get('/api/documents').expect(200))
        .body as unknown[];
      expect(after).toHaveLength(before.length);
    });

    it('POST /mcp → 403', async () => {
      const res = await t.http
        .post('/mcp')
        .set('Host', FORGED)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(INITIALIZE)
        .expect(403);
      expect(res.body).toEqual(HOST_FORBIDDEN_BODY);
      expect(t.mcp.size).toBe(0);
    });

    it('SSE /api/documents/:id/events → 403', async () => {
      await t.http
        .get('/api/documents/00000000-0000-0000-0000-000000000000/events')
        .set('Host', FORGED)
        .set('Accept', 'text/event-stream')
        .expect(403);
    });

    it('GET /api/system/info → 403（系统模块的接口同样受保护）', async () => {
      const s = await createSystemTestApp();
      try {
        const res = await s.http.get('/api/system/info').set('Host', FORGED);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(HOST_FORBIDDEN_BODY);
        await s.http.get('/api/system/info').expect(200);
      } finally {
        await s.close();
      }
    });

    it('请求体不会先被解析：超大或畸形的 JSON 也直接 403', async () => {
      await t.http
        .post('/api/documents')
        .set('Host', FORGED)
        .set('Content-Type', 'application/json')
        .send('{ 不是合法 JSON')
        .expect(403);
    });

    it('日志只记录拒绝这件事，不含 Host 的值', async () => {
      await t.http.get('/api/documents').set('Host', FORGED).expect(403);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('attacker');
    });
  });

  it.each([
    ['localhost.evil.com'],
    ['127.0.0.1.nip.io'],
    ['127.0.0.2'],
    ['localhost:65536'],
  ])('Host: %s → 403', async (host) => {
    await t.http.get('/api/documents').set('Host', host).expect(403);
  });

  it('Host 头缺失 → 403', async () => {
    // supertest 总会带 Host，这里用原始请求去掉它。
    const net = await import('node:net');
    const status = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(Number(port()), '127.0.0.1', () => {
        socket.write('GET /api/documents HTTP/1.0\r\n\r\n');
      });
      let data = '';
      socket.on('data', (chunk) => (data += chunk.toString()));
      socket.on('end', () => resolve(data.split('\r\n')[0]));
      socket.on('error', reject);
    });
    expect(status).toContain('403');
  });

  describe('正常 Host 放行', () => {
    it('默认的 127.0.0.1:<port>', async () => {
      await t.http.get('/api/documents').expect(200);
    });

    it.each([
      () => 'localhost',
      () => `localhost:${port()}`,
      () => `LOCALHOST:${port()}`,
      () => `127.0.0.1:${port()}`,
      () => `[::1]:${port()}`,
    ])('显式设置 Host（%#）', async (host) => {
      await t.http.get('/api/documents').set('Host', host()).expect(200);
    });

    it('MCP 守卫原有行为不变：Host 合法才能建立会话', async () => {
      await t.http
        .post('/mcp')
        .set('Host', 'localhost')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(INITIALIZE)
        .expect(200);
    });
  });

  describe('SES_ALLOWED_HOSTS', () => {
    it('配置后对应的 Host 放行（含大小写与端口），其余仍拒绝', async () => {
      process.env[ALLOWED_HOSTS_ENV] = ' 192.168.1.20 , My-PC.local:3000 ,,';
      await t.http
        .get('/api/documents')
        .set('Host', '192.168.1.20:3000')
        .expect(200);
      await t.http
        .get('/api/documents')
        .set('Host', 'MY-PC.LOCAL:3000')
        .expect(200);
      await t.http
        .get('/api/documents')
        .set('Host', 'my-pc.local:3001')
        .expect(403);
      await t.http
        .get('/api/documents')
        .set('Host', 'attacker.example:3000')
        .expect(403);
      await t.http
        .get('/api/documents')
        .set('Host', '192.168.1.20.nip.io')
        .expect(403);
    });

    it('取消配置后恢复拒绝', async () => {
      process.env[ALLOWED_HOSTS_ENV] = 'lan.example';
      await t.http.get('/api/documents').set('Host', 'lan.example').expect(200);
      delete process.env[ALLOWED_HOSTS_ENV];
      await t.http.get('/api/documents').set('Host', 'lan.example').expect(403);
    });

    it('SES_LISTEN_HOST 为具体地址时自动放行该地址；通配地址不放行', async () => {
      process.env.SES_LISTEN_HOST = '192.168.1.20';
      await t.http
        .get('/api/documents')
        .set('Host', '192.168.1.20:3000')
        .expect(200);
      process.env.SES_LISTEN_HOST = '0.0.0.0';
      await t.http
        .get('/api/documents')
        .set('Host', '192.168.1.20:3000')
        .expect(403);
    });
  });

  it('request 直连回环地址的其他写法不受影响（supertest 默认 Host）', async () => {
    await request(t.url).get('/api/documents').expect(200);
  });
});
