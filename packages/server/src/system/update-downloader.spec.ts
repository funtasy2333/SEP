import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { createServer, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { GithubClient } from './github-client';
import { createSystemConfig, type SystemConfig } from './system.config';
import { DownloadError, UpdateDownloader } from './update-downloader';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const zipBytes = (size: number) =>
  Buffer.concat([ZIP_MAGIC, randomBytes(size)]);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

type Handler = (
  req: { url: string },
  res: ServerResponse,
  server: { url: string },
) => void;

/** 分多块写出，产生背压；write 返回 false 时等 drain。 */
async function writeChunked(
  res: ServerResponse,
  body: Buffer,
  chunk = 64 * 1024,
) {
  for (let i = 0; i < body.length; i += chunk) {
    if (!res.write(body.subarray(i, i + chunk))) {
      await new Promise<void>((resolve) => res.once('drain', resolve));
    }
  }
}

describe('UpdateDownloader（node:http 流式下载）', () => {
  let server: Server;
  let base = '';
  let handler: Handler;
  let dir: string;
  let partial: string;
  let downloader: UpdateDownloader;
  const sockets = new Set<import('net').Socket>();
  const uncaught: unknown[] = [];
  const onUncaught = (e: unknown) => uncaught.push(e);
  const progress: [number, number | null][] = [];
  const hooks = {
    onProgress: (r: number, t: number | null) => void progress.push([r, t]),
    onVerifying: () => undefined,
  };

  const make = (config: Partial<SystemConfig> = {}) => {
    const full: SystemConfig = {
      ...createSystemConfig({ SES_ROOT: dir }),
      stallTimeoutMs: 1000,
      ...config,
    };
    downloader = new UpdateDownloader(full, new GithubClient(full));
  };

  beforeEach(async () => {
    uncaught.length = 0;
    progress.length = 0;
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUncaught);
    dir = mkdtempSync(join(tmpdir(), 'ses-dl-'));
    partial = join(dir, 'download.zip.partial');
    server = createServer((req, res) =>
      handler({ url: req.url ?? '' }, res, { url: base }),
    );
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    make();
  });

  afterEach(async () => {
    // 给潜在的未处理异常留出事件循环轮次
    await new Promise((r) => setTimeout(r, 50));
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUncaught);
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
    expect(uncaught).toEqual([]);
  });

  const target = (path: string, body?: Buffer, size = true) => ({
    url: `${base}${path}`,
    sha256: body ? sha256(body) : null,
    size: body && size ? body.length : null,
  });

  it('成功：写入文件、上报进度、sha256 正确，并带上 octet-stream 请求头', async () => {
    const body = zipBytes(100_000);
    let accept: string | undefined;
    handler = (req, res) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    };
    server.on('request', (req) => (accept = req.headers.accept));
    await downloader.download(target('/a.zip', body), partial, hooks);
    expect(readFileSync(partial).equals(body)).toBe(true);
    expect(accept).toBe('application/octet-stream');
    expect(progress[0]).toEqual([0, body.length]);
    expect(progress[progress.length - 1]).toEqual([body.length, body.length]);
  });

  it('服务器发完大响应立即关闭连接（HTTP/1.0 / Connection: close）：成功且 sha256 正确', async () => {
    const body = zipBytes(6 * 1024 * 1024);
    handler = (req, res) => {
      if (req.url === '/close') {
        res.setHeader('Connection', 'close');
        res.writeHead(200, { 'Content-Length': body.length });
        void writeChunked(res, body).then(() => res.end());
      } else {
        // 无 Content-Length，以关闭连接标记结束（HTTP/1.0 风格）
        res.socket!.write('HTTP/1.0 200 OK\r\n\r\n');
        void (async () => {
          for (let i = 0; i < body.length; i += 64 * 1024) {
            if (!res.socket!.write(body.subarray(i, i + 64 * 1024))) {
              await new Promise((r) => res.socket!.once('drain', r));
            }
          }
          res.socket!.end();
        })();
      }
    };
    for (const path of ['/close', '/http10']) {
      await downloader.download(target(path, body), partial, hooks);
      expect(sha256(readFileSync(partial))).toBe(sha256(body));
      rmSync(partial);
    }
  });

  it('多级重定向（含相对 Location）成功', async () => {
    const body = zipBytes(5000);
    handler = (req, res) => {
      const redirect = (location: string, status = 302) => {
        res.writeHead(status, { Location: location });
        res.end();
      };
      switch (req.url) {
        case '/r0':
          return redirect('/r1', 301);
        case '/r1':
          return redirect('sub/r2', 307);
        case '/sub/r2':
          return redirect('../final.zip', 303);
        case '/final.zip':
          return redirect(`${base}/blob`, 308);
        default:
          res.writeHead(200, { 'Content-Length': body.length });
          res.end(body);
      }
    };
    await downloader.download(target('/r0', body), partial, hooks);
    expect(readFileSync(partial).equals(body)).toBe(true);
  });

  it('恰好 5 次重定向可以成功，超过 5 次失败并清理', async () => {
    const body = zipBytes(100);
    // 5 次：/hop0 → ... → /hop5
    let limit = 5;
    handler = (req, res) => {
      const n = Number(req.url.slice('/hop'.length));
      if (req.url.startsWith('/hop') && n < limit) {
        res.writeHead(302, { Location: `/hop${n + 1}` });
        return void res.end();
      }
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    };
    await downloader.download(target('/hop0', body), partial, hooks);
    expect(readFileSync(partial).equals(body)).toBe(true);

    limit = 6;
    await expect(
      downloader.download(target('/hop0', body), partial, hooks),
    ).rejects.toThrow(/重定向次数过多/);
    expect(existsSync(partial)).toBe(false);
  });

  it('重定向没有 Location：失败', async () => {
    handler = (_req, res) => {
      res.writeHead(302);
      res.end();
    };
    await expect(
      downloader.download(target('/x'), partial, hooks),
    ).rejects.toThrow(/没有给出跳转地址/);
  });

  it('非 2xx：DownloadError 带状态码并清理', async () => {
    handler = (_req, res) => {
      res.writeHead(503);
      res.end('busy');
    };
    const p = downloader.download(target('/x'), partial, hooks);
    await expect(p).rejects.toBeInstanceOf(DownloadError);
    await expect(p).rejects.toThrow('下载失败：服务器返回 HTTP 503');
    expect(existsSync(partial)).toBe(false);
  });

  it('sha256 不一致 / 大小不符 / 非 zip：失败并删除 partial', async () => {
    const body = zipBytes(2000);
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    };
    await expect(
      downloader.download(
        { ...target('/x', body), sha256: 'a'.repeat(64) },
        partial,
        hooks,
      ),
    ).rejects.toThrow('SHA-256');
    await expect(
      downloader.download(
        { ...target('/x', body), size: body.length + 10 },
        partial,
        hooks,
      ),
    ).rejects.toThrow('下载不完整');
    const text = Buffer.from('not a zip at all');
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Length': text.length });
      res.end(text);
    };
    await expect(
      downloader.download(target('/x'), partial, hooks),
    ).rejects.toThrow('不是有效的 zip');
    expect(existsSync(partial)).toBe(false);
  });

  it('连接中途被服务器 destroy：DownloadError、partial 被删除、无未处理异常', async () => {
    const body = zipBytes(2 * 1024 * 1024);
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.write(body.subarray(0, 300_000), () => {
        setTimeout(() => res.destroy(), 20);
      });
    };
    const p = downloader.download(target('/x'), partial, hooks);
    await expect(p).rejects.toBeInstanceOf(DownloadError);
    await expect(p).rejects.toThrow(/^下载失败：/);
    expect(existsSync(partial)).toBe(false);
  });

  it('响应提前结束（字节数少于 Content-Length，无 size 校验）：报下载不完整', async () => {
    const body = zipBytes(10_000);
    handler = (req, res) => {
      // 声明更长的 Content-Length 后直接发 FIN
      res.socket!.write(
        `HTTP/1.1 200 OK\r\nContent-Length: ${body.length + 500}\r\n\r\n`,
      );
      res.socket!.end(body);
    };
    const p = downloader.download(target('/x'), partial, hooks);
    await expect(p).rejects.toBeInstanceOf(DownloadError);
    expect(existsSync(partial)).toBe(false);
  });

  it('连接被拒绝：DownloadError', async () => {
    await new Promise<void>((r) => server.close(() => r()));
    for (const s of sockets) s.destroy();
    const p = downloader.download(target('/x'), partial, hooks);
    await expect(p).rejects.toBeInstanceOf(DownloadError);
    await expect(p).rejects.toThrow(/^下载失败：/);
    server = createServer(); // 供 afterEach 关闭
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  it('停滞超过阈值：中止并报停滞，partial 被删除', async () => {
    make({ stallTimeoutMs: 300 });
    handler = (_req, res) => {
      res.writeHead(200);
      res.write(ZIP_MAGIC);
    };
    const p = downloader.download(target('/x'), partial, hooks);
    await expect(p).rejects.toThrow('下载停滞超过');
    expect(existsSync(partial)).toBe(false);
  });

  it('连接阶段无响应也按停滞处理', async () => {
    make({ stallTimeoutMs: 300 });
    handler = () => undefined;
    await expect(
      downloader.download(target('/x'), partial, hooks),
    ).rejects.toThrow('下载停滞超过');
  });

  it('非 http(s) 协议与非法地址：DownloadError', async () => {
    await expect(
      downloader.download(
        { url: 'ftp://x/y.zip', sha256: null, size: null },
        partial,
        hooks,
      ),
    ).rejects.toBeInstanceOf(DownloadError);
    await expect(
      downloader.download(
        { url: 'not a url', sha256: null, size: null },
        partial,
        hooks,
      ),
    ).rejects.toBeInstanceOf(DownloadError);
    expect(existsSync(partial)).toBe(false);
  });
});
