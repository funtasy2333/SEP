import { createHash, randomBytes } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  createSystemTestApp,
  type SystemTestApp,
  type SystemTestAppOptions,
} from '../test-support/system-test-app';
import type { DownloadStatus, SystemInfo, UpgradePlan } from './system.types';

const CURRENT = 'c'.repeat(40);
const TARGET = 'd'.repeat(40);

const zipBytes = (size = 4096) =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(size)]);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('升级：下载、校验与交接', () => {
  let t: SystemTestApp;
  afterEach(async () => t?.close());

  const status = async (): Promise<DownloadStatus> =>
    (await t.http.get('/api/system/update/status')).body as DownloadStatus;
  const settled = async () => {
    await waitFor(async () =>
      ['handed-off', 'error'].includes((await status()).phase),
    );
    return status();
  };
  const dir = (...p: string[]) => join(t.root, '.ses-update', ...p);
  const lockExists = () => existsSync(dir('lock'));

  /** 登记 stable 通道：release 资产 + 提交 + compare。 */
  const seedStable = (
    body: Buffer,
    opts: {
      digest?: string | null;
      size?: number;
      behavior?: 'body' | 'redirect';
    } = {},
  ) => {
    const assetName = (p: string) => `SES-0.1.2-preview-${p}.zip`;
    t.github.releases = [
      {
        tag_name: 'v0.1.2-preview',
        prerelease: true,
        body: '发布说明',
        assets: ['macos', 'windows'].map((p) => ({
          name: assetName(p),
          size: opts.size ?? body.length,
          browser_download_url: t.github.assetUrl(assetName(p)),
          digest:
            opts.digest === undefined ? `sha256:${sha256(body)}` : opts.digest,
        })),
      },
    ];
    for (const p of ['macos', 'windows']) {
      t.github.downloads.set(`/dl/${assetName(p)}`, {
        kind: opts.behavior ?? 'redirect',
        body,
      });
    }
    t.github.commits.set('v0.1.2-preview', { sha: TARGET });
    t.github.compares.set(`${CURRENT}...${TARGET}`, { status: 'ahead' });
  };

  const stableOptions = (extra: Partial<SystemTestAppOptions> = {}) => ({
    build: { version: '0.1.1-preview', channel: 'stable', commit: CURRENT },
    ...extra,
  });

  describe('stable 通道', () => {
    it('macOS：下载（跟随重定向）→ 校验 sha256 → 写 plan.json → 复制脚本 → 拉起 ses-upgrade.sh', async () => {
      t = await createSystemTestApp(stableOptions());
      const zip = zipBytes();
      seedStable(zip);

      const res = await t.http
        .post('/api/system/update')
        .send({ channel: 'stable', commit: TARGET });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ accepted: true });

      const final = await settled();
      expect(final).toMatchObject({
        phase: 'handed-off',
        receivedBytes: zip.length,
        totalBytes: zip.length,
        error: null,
      });
      expect(final.startedAt).toMatch(/^\d{4}-\d\d-\d\dT/);

      expect(readFileSync(dir('download.zip')).equals(zip)).toBe(true);
      expect(existsSync(dir('download.zip.partial'))).toBe(false);

      const plan = JSON.parse(
        readFileSync(dir('plan.json'), 'utf8'),
      ) as UpgradePlan;
      expect(plan).toEqual({
        zip: dir('download.zip'),
        channel: 'stable',
        targetVersion: '0.1.2-preview',
        targetCommit: TARGET,
        fromVersion: '0.1.1-preview',
        fromCommit: CURRENT,
        node: process.execPath,
        platform: 'macos',
        requestedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/) as string,
      });

      expect(readdirSync(dir()).sort()).toEqual(
        [
          'apply-update.cjs',
          'download.zip',
          'lock',
          'plan.json',
          'ses-upgrade.sh',
        ].sort(),
      );
      expect(readFileSync(dir('ses-upgrade.sh'), 'utf8')).toBe(
        '# ses-upgrade.sh\n',
      );
      expect(readFileSync(dir('apply-update.cjs'), 'utf8')).toBe(
        '# apply-update.cjs\n',
      );

      expect(t.spawns).toEqual([
        {
          command: '/bin/bash',
          args: [dir('ses-upgrade.sh'), t.root],
          cwd: t.root,
          logFile: join(t.root, '.ses-run', 'upgrade.log'),
        },
      ]);
      // 交接后锁由执行器负责释放
      expect(lockExists()).toBe(true);
    });

    it('Windows：复制 ses-upgrade.ps1 与 run-detached.cjs，经 node 中转拉起 powershell.exe，plan.platform 为 windows', async () => {
      t = await createSystemTestApp(
        stableOptions({ launcher: 'windows', platform: 'win32' }),
      );
      seedStable(zipBytes(), { behavior: 'body' });

      await t.http
        .post('/api/system/update')
        .send({ channel: 'stable', commit: TARGET });
      expect((await settled()).phase).toBe('handed-off');

      expect(readdirSync(dir()).sort()).toEqual(
        [
          'apply-update.cjs',
          'download.zip',
          'lock',
          'plan.json',
          'run-detached.cjs',
          'ses-upgrade.ps1',
        ].sort(),
      );
      expect(
        (JSON.parse(readFileSync(dir('plan.json'), 'utf8')) as UpgradePlan)
          .platform,
      ).toBe('windows');
      expect(t.spawns).toEqual([
        {
          command: t.config.nodePath,
          args: [
            dir('run-detached.cjs'),
            'powershell.exe',
            '-NoLogo',
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            dir('ses-upgrade.ps1'),
            '-Root',
            t.root,
          ],
          cwd: t.root,
          logFile: join(t.root, '.ses-run', 'upgrade.log'),
        },
      ]);
    });

    it('资产没有 digest：不校验 sha256，只校验 zip 魔数与大小', async () => {
      t = await createSystemTestApp(stableOptions());
      seedStable(zipBytes(), { digest: null });
      await t.http
        .post('/api/system/update')
        .send({ channel: 'stable', commit: TARGET });
      expect((await settled()).phase).toBe('handed-off');
    });

    it('sha256 不一致：报错，删除下载文件与锁，不交接', async () => {
      t = await createSystemTestApp(stableOptions());
      seedStable(zipBytes(), { digest: `sha256:${'0'.repeat(64)}` });

      await t.http
        .post('/api/system/update')
        .send({ channel: 'stable', commit: TARGET });
      const final = await settled();

      expect(final.phase).toBe('error');
      expect(final.error).toContain('校验失败');
      expect(existsSync(dir('download.zip'))).toBe(false);
      expect(existsSync(dir('download.zip.partial'))).toBe(false);
      expect(existsSync(dir('plan.json'))).toBe(false);
      expect(lockExists()).toBe(false);
      expect(t.spawns).toHaveLength(0);
    });

    it('下载大小与资产大小不符：报错', async () => {
      t = await createSystemTestApp(stableOptions());
      const zip = zipBytes();
      seedStable(zip, { size: zip.length + 10, digest: null });
      await t.http
        .post('/api/system/update')
        .send({ channel: 'stable', commit: TARGET });
      const final = await settled();
      expect(final.phase).toBe('error');
      expect(final.error).toContain('不完整');
      expect(existsSync(dir('download.zip.partial'))).toBe(false);
    });

    it('错误后可以重新发起升级（下载状态被重置）', async () => {
      t = await createSystemTestApp(stableOptions());
      const zip = zipBytes();
      seedStable(zip, { digest: `sha256:${'0'.repeat(64)}` });
      await t.http
        .post('/api/system/update')
        .send({ channel: 'stable', commit: TARGET });
      expect((await settled()).phase).toBe('error');

      seedStable(zip); // 这次校验和正确
      const res = await t.http
        .post('/api/system/update')
        .send({ channel: 'stable', commit: TARGET });
      expect(res.status).toBe(202);
      const final = await settled();
      expect(final).toMatchObject({ phase: 'handed-off', error: null });
    });
  });

  describe('commit 通道', () => {
    it('从 codeload 下载，只做 zip 魔数校验；plan 的 targetVersion 为 null', async () => {
      t = await createSystemTestApp({
        build: { version: '0.1.1-preview', channel: 'commit', commit: CURRENT },
      });
      const zip = zipBytes();
      t.github.commits.set('main', { sha: TARGET });
      t.github.compares.set(`${CURRENT}...${TARGET}`, { status: 'ahead' });
      t.github.downloads.set(`/funtasy2333/SEP/zip/${TARGET}`, {
        kind: 'body',
        body: zip,
      });

      const res = await t.http
        .post('/api/system/update')
        .send({ channel: 'commit', commit: TARGET });
      expect(res.status).toBe(202);
      expect((await settled()).phase).toBe('handed-off');

      expect(readFileSync(dir('download.zip')).equals(zip)).toBe(true);
      expect(JSON.parse(readFileSync(dir('plan.json'), 'utf8'))).toMatchObject({
        channel: 'commit',
        targetVersion: null,
        targetCommit: TARGET,
        fromCommit: CURRENT,
        platform: 'macos',
      });
    });

    it('当前提交未知：fromCommit 为 null，仍可升级', async () => {
      t = await createSystemTestApp();
      t.github.commits.set('main', { sha: TARGET });
      t.github.downloads.set(`/funtasy2333/SEP/zip/${TARGET}`, {
        kind: 'body',
        body: zipBytes(),
      });
      await t.http
        .post('/api/system/update')
        .send({ channel: 'commit', commit: TARGET });
      expect((await settled()).phase).toBe('handed-off');
      expect(JSON.parse(readFileSync(dir('plan.json'), 'utf8'))).toMatchObject({
        fromCommit: null,
      });
    });

    it('下载的不是 zip（魔数不对）：报错并清理', async () => {
      t = await createSystemTestApp();
      t.github.commits.set('main', { sha: TARGET });
      t.github.downloads.set(`/funtasy2333/SEP/zip/${TARGET}`, {
        kind: 'body',
        body: Buffer.from('<html>rate limited</html>'),
      });
      await t.http
        .post('/api/system/update')
        .send({ channel: 'commit', commit: TARGET });
      const final = await settled();
      expect(final.phase).toBe('error');
      expect(final.error).toContain('zip');
      expect(existsSync(dir('download.zip.partial'))).toBe(false);
      expect(existsSync(dir('download.zip'))).toBe(false);
      expect(lockExists()).toBe(false);
    });

    it('下载地址返回 HTTP 错误：报错并释放锁', async () => {
      t = await createSystemTestApp();
      t.github.commits.set('main', { sha: TARGET });
      t.github.downloads.set(`/funtasy2333/SEP/zip/${TARGET}`, {
        kind: 'status',
        status: 503,
      });
      await t.http
        .post('/api/system/update')
        .send({ channel: 'commit', commit: TARGET });
      const final = await settled();
      expect(final.phase).toBe('error');
      expect(final.error).toContain('503');
      expect(lockExists()).toBe(false);
    });

    it('读取停滞超过阈值：失败；停滞期间进度可见，且重复发起会 409', async () => {
      t = await createSystemTestApp({ config: { stallTimeoutMs: 700 } });
      t.github.commits.set('main', { sha: TARGET });
      t.github.downloads.set(`/funtasy2333/SEP/zip/${TARGET}`, {
        kind: 'stall',
        head: Buffer.concat([
          Buffer.from([0x50, 0x4b, 0x03, 0x04]),
          Buffer.alloc(96),
        ]),
      });

      await t.http
        .post('/api/system/update')
        .send({ channel: 'commit', commit: TARGET });
      await waitFor(async () => (await status()).receivedBytes === 100);
      const mid = await status();
      expect(mid.phase).toBe('downloading');
      expect(mid.totalBytes).toBeNull();

      const again = await t.http
        .post('/api/system/update')
        .send({ channel: 'commit', commit: TARGET });
      expect(again.status).toBe(409);
      expect((again.body as { message: string }).message).toBe(
        '已有升级在进行',
      );
      expect(lockExists()).toBe(true); // 409 不能删掉进行中的锁

      const final = await settled();
      expect(final.phase).toBe('error');
      expect(final.error).toContain('停滞');
      expect(existsSync(dir('download.zip.partial'))).toBe(false);
      expect(lockExists()).toBe(false);
    });
  });

  it('拉起升级脚本失败：报错，清理 plan 与下载文件并释放锁', async () => {
    t = await createSystemTestApp(
      stableOptions({
        spawner: () => Promise.reject(new Error('spawn ENOENT')),
      }),
    );
    seedStable(zipBytes());
    await t.http
      .post('/api/system/update')
      .send({ channel: 'stable', commit: TARGET });
    const final = await settled();
    expect(final.phase).toBe('error');
    expect(final.error).toContain('ENOENT');
    expect(existsSync(dir('plan.json'))).toBe(false);
    expect(existsSync(dir('download.zip'))).toBe(false);
    expect(lockExists()).toBe(false);
  });

  it('GET /api/system/info 反映下载进度', async () => {
    t = await createSystemTestApp(stableOptions());
    seedStable(zipBytes());
    await t.http
      .post('/api/system/update')
      .send({ channel: 'stable', commit: TARGET });
    await settled();
    const info = (await t.http.get('/api/system/info')).body as SystemInfo;
    expect(info.upgrade.download.phase).toBe('handed-off');
  });
});
