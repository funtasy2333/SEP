import { createServer, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

/** 假 GitHub：本机 HTTP 服务，同时扮演 REST API、release 资产下载与 codeload，用于系统模块测试。 */
export interface FakeCommit {
  sha: string;
  message?: string;
  date?: string;
  login?: string | null;
  name?: string;
}

export interface FakeRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  body?: string | null;
  html_url?: string;
  published_at?: string | null;
  assets?: {
    name: string;
    size?: number;
    browser_download_url?: string;
    digest?: string | null;
  }[];
}

export type DownloadBehavior =
  | { kind: 'body'; body: Buffer }
  /** 先 302 到 /blob/<name>，再返回内容（模拟 GitHub 资产重定向）。 */
  | { kind: 'redirect'; body: Buffer }
  | { kind: 'status'; status: number }
  /** 发出前 headBytes 字节后不再发送也不结束连接。 */
  | { kind: 'stall'; head: Buffer };

export class FakeGithub {
  releases: FakeRelease[] = [];
  /** ref（分支、标签或 sha）→ 提交。 */
  commits = new Map<string, FakeCommit>();
  /** "<base>...<head>" → compare 响应。 */
  compares = new Map<
    string,
    { status: string; commits?: FakeCommit[] } | number
  >();
  /** 下载路径（如 /dl/SES-0.1.2-preview-macos.zip 或 /funtasy2333/SEP/zip/<sha>）→ 行为。 */
  downloads = new Map<string, DownloadBehavior>();
  /** 记录所有请求路径，便于断言有没有多余的请求。 */
  requests: string[] = [];
  /** 为 true 时 API 请求挂起不响应（模拟超时）。 */
  hangApi = false;
  lastHeaders: Record<string, string | string[] | undefined> = {};

  private server: Server | null = null;
  private sockets = new Set<import('net').Socket>();
  url = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0]);
      this.requests.push(path);
      this.lastHeaders = req.headers;
      this.route(path, res);
    });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  /** 资产下载地址（browser_download_url）。 */
  assetUrl(name: string): string {
    return `${this.url}/dl/${name}`;
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private commitJson(c: FakeCommit) {
    return {
      sha: c.sha,
      commit: {
        message: c.message ?? 'msg',
        committer: { date: c.date ?? '2026-01-01T00:00:00Z' },
        author: {
          name: c.name ?? 'Tester',
          date: c.date ?? '2026-01-01T00:00:00Z',
        },
      },
      author: c.login === null ? null : { login: c.login ?? 'tester' },
    };
  }

  private route(path: string, res: ServerResponse) {
    const download = this.downloads.get(path);
    if (download) return this.serveDownload(path, download, res);
    if (path.startsWith('/blob/')) {
      const target = this.downloads.get(`/dl/${path.slice(6)}`);
      if (target?.kind === 'redirect') {
        res.writeHead(200, { 'Content-Length': target.body.length });
        return void res.end(target.body);
      }
    }
    if (!path.startsWith('/repos/funtasy2333/SEP/')) {
      return this.json(res, 404, { message: 'Not Found' });
    }
    if (this.hangApi) return; // 不响应
    const rest = path.slice('/repos/funtasy2333/SEP/'.length);
    if (rest === 'releases') return this.json(res, 200, this.releases);
    if (rest.startsWith('commits/')) {
      const commit = this.commits.get(rest.slice('commits/'.length));
      return commit
        ? this.json(res, 200, this.commitJson(commit))
        : this.json(res, 404, { message: 'Not Found' });
    }
    if (rest.startsWith('compare/')) {
      const entry = this.compares.get(rest.slice('compare/'.length));
      if (entry === undefined)
        return this.json(res, 404, { message: 'Not Found' });
      if (typeof entry === 'number')
        return this.json(res, entry, { message: 'err' });
      return this.json(res, 200, {
        status: entry.status,
        commits: (entry.commits ?? []).map((c) => this.commitJson(c)),
      });
    }
    this.json(res, 404, { message: 'Not Found' });
  }

  private serveDownload(
    path: string,
    d: DownloadBehavior,
    res: ServerResponse,
  ) {
    switch (d.kind) {
      case 'body':
        res.writeHead(200, { 'Content-Length': d.body.length });
        return void res.end(d.body);
      case 'redirect':
        res.writeHead(302, {
          Location: `${this.url}/blob/${path.slice('/dl/'.length)}`,
        });
        return void res.end();
      case 'status':
        res.writeHead(d.status);
        return void res.end();
      case 'stall':
        res.writeHead(200);
        res.write(d.head);
        return;
    }
  }
}
