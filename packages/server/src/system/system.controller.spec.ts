import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SES_SERVER_VERSION } from '../common/app-version';
import {
  createSystemTestApp,
  type SystemTestApp,
} from '../test-support/system-test-app';
import { SystemService } from './system.service';
import type { DownloadStatus, SystemInfo } from './system.types';

const COMMIT = 'a'.repeat(40);

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('GET /api/system/info', () => {
  let t: SystemTestApp;
  afterEach(async () => t?.close());

  const info = async (): Promise<SystemInfo> => {
    const res = await t.http.get('/api/system/info');
    expect(res.status).toBe(200);
    return res.body as SystemInfo;
  };

  it('发布包里正常运行（有 launcher、无 .git、脚本齐全）：可升级可退出', async () => {
    t = await createSystemTestApp({
      build: { version: '0.1.2-preview', channel: 'stable', commit: COMMIT },
    });
    expect(await info()).toEqual({
      version: '0.1.2-preview',
      channel: 'stable',
      commit: COMMIT,
      launcher: 'macos',
      canShutdown: true,
      shutdownBlockedReason: null,
      canUpgrade: true,
      upgradeBlockedReason: null,
      upgrade: {
        download: {
          phase: 'idle',
          receivedBytes: 0,
          totalBytes: null,
          error: null,
          startedAt: null,
        },
        last: null,
      },
    });
  });

  it('没有 ses-build.json：version 为服务端版本，channel/commit 为 null', async () => {
    t = await createSystemTestApp();
    expect(await info()).toMatchObject({
      version: SES_SERVER_VERSION,
      channel: null,
      commit: null,
    });
  });

  it('开发模式（无 launcher）：不能退出也不能升级', async () => {
    t = await createSystemTestApp({ launcher: null });
    const result = await info();
    expect(result).toMatchObject({
      launcher: null,
      canShutdown: false,
      shutdownBlockedReason: '开发模式下请在终端停止 SES',
      canUpgrade: false,
    });
    expect(result.upgradeBlockedReason).toBeTruthy();
  });

  it('根目录有 .git（源码目录）：不能升级，但可以退出', async () => {
    t = await createSystemTestApp({ git: true });
    expect(await info()).toMatchObject({
      canUpgrade: false,
      upgradeBlockedReason: '源码目录请使用 git pull 更新',
      canShutdown: true,
    });
  });

  it.each([
    ['macos', 'darwin', 'apply-update.cjs'],
    ['macos', 'darwin', 'ses-upgrade.sh'],
    ['windows', 'win32', 'apply-update.cjs'],
    ['windows', 'win32', 'ses-upgrade.ps1'],
    ['windows', 'win32', 'run-detached.cjs'],
  ] as const)(
    '%s 缺少 scripts/%s：不能升级并指明文件',
    async (launcher, platform, missing) => {
      t = await createSystemTestApp({
        launcher,
        platform,
        omitScripts: [missing],
      });
      const result = await info();
      expect(result.canUpgrade).toBe(false);
      expect(result.upgradeBlockedReason).toContain(`scripts/${missing}`);
    },
  );

  it('只缺另一平台的升级脚本：不影响', async () => {
    t = await createSystemTestApp({ omitScripts: ['ses-upgrade.ps1'] });
    expect((await info()).canUpgrade).toBe(true);
    await t.close();
    t = await createSystemTestApp({
      launcher: 'windows',
      platform: 'win32',
      omitScripts: ['ses-upgrade.sh'],
    });
    expect((await info()).canUpgrade).toBe(true);
  });

  it.each([
    ['macos', 'win32'],
    ['macos', 'linux'],
    ['windows', 'darwin'],
  ] as const)(
    'launcher=%s 与 process.platform=%s 不符：不能升级',
    async (launcher, platform) => {
      t = await createSystemTestApp({ launcher, platform });
      const result = await info();
      expect(result.canUpgrade).toBe(false);
      expect(result.upgradeBlockedReason).toContain(launcher);
    },
  );

  it('Windows 缺少 scripts/run-detached.cjs：不能退出', async () => {
    t = await createSystemTestApp({
      launcher: 'windows',
      platform: 'win32',
      omitScripts: ['run-detached.cjs'],
    });
    const result = await info();
    expect(result.canShutdown).toBe(false);
    expect(result.shutdownBlockedReason).toContain('run-detached.cjs');
  });

  it('macOS 缺少 run-detached.cjs：不受影响', async () => {
    t = await createSystemTestApp({ omitScripts: ['run-detached.cjs'] });
    const result = await info();
    expect(result.canShutdown).toBe(true);
    expect(result.canUpgrade).toBe(true);
  });

  it('缺少退出脚本：不能退出', async () => {
    t = await createSystemTestApp({ omitScripts: ['ses-local.sh'] });
    const result = await info();
    expect(result.canShutdown).toBe(false);
    expect(result.shutdownBlockedReason).toContain('ses-local.sh');
  });

  it('返回执行器状态文件；损坏时 last 为 null', async () => {
    t = await createSystemTestApp();
    const file = join(t.root, '.ses-run', 'upgrade-status.json');
    mkdirSync(join(t.root, '.ses-run'));
    const status = {
      state: 'rolled-back',
      step: 'health-check',
      from: '0.1.1',
      to: '0.1.2-preview',
      message: '新版本启动失败，已回滚',
      log: join(t.root, '.ses-run', 'upgrade.log'),
      updatedAt: '2026-01-01T00:00:00Z',
    };
    writeFileSync(file, JSON.stringify(status));
    expect((await info()).upgrade.last).toEqual(status);
    writeFileSync(file, '{broken');
    expect((await info()).upgrade.last).toBeNull();
  });
});

describe('系统写接口的跨站防护', () => {
  let t: SystemTestApp;
  beforeEach(async () => {
    t = await createSystemTestApp({ config: { shutdownDelayMs: 5 } });
  });
  afterEach(async () => t.close());

  const targets = ['/api/system/shutdown', '/api/system/update'] as const;
  const body = { channel: 'commit', commit: COMMIT };

  it.each(targets)('POST %s：Content-Type 不是 JSON → 415', async (path) => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await t.http.post(path).set('Content-Type', type).send('x=1');
      expect(res.status).toBe(415);
    }
    // 没有请求体、没有 Content-Type
    expect((await t.http.post(path)).status).toBe(415);
  });

  it.each(targets)('POST %s：Origin 不是本机前端 → 403', async (path) => {
    for (const origin of [
      'https://evil.example',
      'http://localhost:5174',
      'http://localhost:3000',
      'http://localhost',
      'null',
    ]) {
      const res = await t.http.post(path).set('Origin', origin).send(body);
      expect(res.status).toBe(403);
    }
  });

  it('被拒绝的请求不会触发任何动作', async () => {
    await t.http
      .post('/api/system/shutdown')
      .set('Origin', 'https://evil.example')
      .send({});
    await t.http
      .post('/api/system/shutdown')
      .set('Content-Type', 'text/plain')
      .send('x');
    await new Promise((r) => setTimeout(r, 60));
    expect(t.spawns).toHaveLength(0);
  });

  it('允许 localhost:5173 与 127.0.0.1:5173，也允许不带 Origin 的客户端和带 charset 的类型', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const res = await t.http
        .post('/api/system/shutdown')
        .set('Origin', origin)
        .send({});
      expect(res.status).toBe(202);
    }
    const res = await t.http
      .post('/api/system/shutdown')
      .set('Content-Type', 'Application/JSON; charset=utf-8')
      .send('{}');
    expect(res.status).toBe(202);
  });

  it('Origin 先于 Content-Type 检查：跨站且非 JSON 的请求得到 403', async () => {
    const res = await t.http
      .post('/api/system/shutdown')
      .set('Origin', 'https://evil.example')
      .set('Content-Type', 'text/plain')
      .send('x');
    expect(res.status).toBe(403);
  });

  it('GET 接口不受影响', async () => {
    const res = await t.http
      .get('/api/system/info')
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/system/shutdown', () => {
  let t: SystemTestApp;
  afterEach(async () => t?.close());

  it('202，并在响应发出之后才拉起 macOS 退出脚本', async () => {
    t = await createSystemTestApp({ config: { shutdownDelayMs: 200 } });
    const res = await t.http.post('/api/system/shutdown').send({});
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    expect(t.spawns).toHaveLength(0); // 响应已收到，但脚本还在延迟中
    await waitFor(() => t.spawns.length === 1);
    expect(t.spawns[0]).toEqual({
      command: '/bin/bash',
      args: [join(t.root, 'scripts', 'ses-local.sh'), 'stop'],
      cwd: t.root,
      logFile: join(t.root, '.ses-run', 'shutdown.log'),
    });
  });

  it('Windows：经 node 运行 run-detached.cjs 中转，用 powershell.exe 调 ses-windows.ps1 stop', async () => {
    t = await createSystemTestApp({
      launcher: 'windows',
      platform: 'win32',
      config: { shutdownDelayMs: 5 },
    });
    expect((await t.http.post('/api/system/shutdown').send({})).status).toBe(
      202,
    );
    await waitFor(() => t.spawns.length === 1);
    expect(t.spawns[0]).toEqual({
      command: t.config.nodePath,
      args: [
        join(t.root, 'scripts', 'run-detached.cjs'),
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(t.root, 'scripts', 'ses-windows.ps1'),
        'stop',
      ],
      cwd: t.root,
      logFile: join(t.root, '.ses-run', 'shutdown.log'),
    });
  });

  it('开发模式：409，不拉起进程', async () => {
    t = await createSystemTestApp({
      launcher: null,
      config: { shutdownDelayMs: 5 },
    });
    const res = await t.http.post('/api/system/shutdown').send({});
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toBe(
      '开发模式下请在终端停止 SES',
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(t.spawns).toHaveLength(0);
  });

  it('重复请求只拉起一次', async () => {
    t = await createSystemTestApp({ config: { shutdownDelayMs: 5 } });
    await t.http.post('/api/system/shutdown').send({});
    await t.http.post('/api/system/shutdown').send({});
    await new Promise((r) => setTimeout(r, 80));
    expect(t.spawns).toHaveLength(1);
  });

  it('拉起失败后允许再次退出', async () => {
    let calls = 0;
    t = await createSystemTestApp({
      config: { shutdownDelayMs: 5 },
      spawner: () =>
        ++calls === 1
          ? Promise.reject(new Error('spawn failed'))
          : Promise.resolve(),
    });
    await t.http.post('/api/system/shutdown').send({});
    await waitFor(() => calls === 1);
    await new Promise((r) => setTimeout(r, 20));
    await t.http.post('/api/system/shutdown').send({});
    await waitFor(() => calls === 2);
  });
});

describe('POST /api/system/update：请求校验、阻断与锁', () => {
  let t: SystemTestApp;
  afterEach(async () => t?.close());

  const post = (body: unknown) =>
    t.http.post('/api/system/update').send(body as object);
  const lockDir = () => join(t.root, '.ses-update', 'lock');
  /** 等后台下载流程结束，避免测试收尾时临时目录被提前删除。 */
  const settle = () =>
    waitFor(() =>
      ['handed-off', 'error'].includes(
        t.app.get(SystemService).downloadStatus().phase,
      ),
    );

  /** 让 main 提交为 `sha` 的 commit 通道可升级。 */
  const seedMain = (sha: string) => {
    t.github.commits.set('main', { sha });
    t.github.compares.set(`${COMMIT}...${sha}`, { status: 'ahead' });
    t.github.downloads.set(`/funtasy2333/SEP/zip/${sha}`, {
      kind: 'body',
      body: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    });
  };

  it('channel 或 commit 缺失、格式不对：400', async () => {
    t = await createSystemTestApp();
    for (const body of [
      {},
      { channel: 'commit' },
      { commit: COMMIT },
      { channel: 'nightly', commit: COMMIT },
      { channel: 'commit', commit: 'main' },
      { channel: 'commit', commit: 123 },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
  });

  it('不能升级（开发模式 / 源码目录）：409 并给出原因，不创建锁', async () => {
    t = await createSystemTestApp({ git: true });
    const res = await post({ channel: 'commit', commit: COMMIT });
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toBe(
      '源码目录请使用 git pull 更新',
    );
    expect(existsSync(lockDir())).toBe(false);
  });

  it('.ses-run/start.lock 存在：409', async () => {
    t = await createSystemTestApp();
    mkdirSync(join(t.root, '.ses-run', 'start.lock'), { recursive: true });
    const res = await post({ channel: 'commit', commit: COMMIT });
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toContain('启动');
    expect(existsSync(lockDir())).toBe(false);
  });

  it('升级锁已存在且新鲜：409「已有升级在进行」，且不删除别人的锁', async () => {
    t = await createSystemTestApp({
      build: { version: '0.1.1-preview', channel: 'commit', commit: COMMIT },
    });
    seedMain('d'.repeat(40));
    mkdirSync(lockDir(), { recursive: true });
    const res = await post({ channel: 'commit', commit: 'd'.repeat(40) });
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toBe('已有升级在进行');
    expect(existsSync(lockDir())).toBe(true);
  });

  it('陈旧的升级锁（超过 60 分钟、无状态文件）会被清理，升级继续', async () => {
    t = await createSystemTestApp({
      build: { version: '0.1.1-preview', channel: 'commit', commit: COMMIT },
    });
    seedMain('d'.repeat(40));
    mkdirSync(lockDir(), { recursive: true });
    const old = new Date(Date.now() - 61 * 60 * 1000);
    utimesSync(lockDir(), old, old);
    const res = await post({ channel: 'commit', commit: 'd'.repeat(40) });
    expect(res.status).toBe(202);
    await settle();
  });

  it('commit 与服务端重新检查的最新提交不一致：409，释放锁，下载状态保持 idle', async () => {
    t = await createSystemTestApp({
      build: { version: '0.1.1-preview', channel: 'commit', commit: COMMIT },
    });
    seedMain('d'.repeat(40));
    const res = await post({ channel: 'commit', commit: 'e'.repeat(40) });
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toContain('重新检查');
    expect(existsSync(lockDir())).toBe(false);
    expect(
      ((await t.http.get('/api/system/update/status')).body as DownloadStatus)
        .phase,
    ).toBe('idle');
    expect(t.spawns).toHaveLength(0);
  });

  it('commit 大小写不敏感', async () => {
    t = await createSystemTestApp({
      build: { version: '0.1.1-preview', channel: 'commit', commit: COMMIT },
    });
    seedMain('d'.repeat(40));
    const res = await post({ channel: 'commit', commit: 'D'.repeat(40) });
    expect(res.status).toBe(202);
    await settle();
  });

  it('重新检查发现已是最新 / 无法降级：409 带 reason，并释放锁', async () => {
    t = await createSystemTestApp({
      build: { version: '0.1.1-preview', channel: 'commit', commit: COMMIT },
    });
    t.github.commits.set('main', { sha: 'd'.repeat(40) });
    t.github.compares.set(`${COMMIT}...${'d'.repeat(40)}`, {
      status: 'behind',
    });
    const res = await post({ channel: 'commit', commit: 'd'.repeat(40) });
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toContain('无法降级');
    expect(existsSync(lockDir())).toBe(false);
  });

  it('无法连接 GitHub：409 带原因，释放锁', async () => {
    t = await createSystemTestApp();
    await t.github.stop();
    const res = await post({ channel: 'commit', commit: COMMIT });
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toContain(
      '无法连接 GitHub',
    );
    expect(existsSync(lockDir())).toBe(false);
    await t.github.start();
  });
});
