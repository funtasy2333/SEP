import { SES_SERVER_VERSION } from '../common/app-version';
import type { FakeGithub, FakeRelease } from '../test-support/fake-github';
import {
  createSystemTestApp,
  type SystemTestApp,
} from '../test-support/system-test-app';
import type { UpdateCheck } from './system.types';

const CURRENT = 'c'.repeat(40);
const TARGET = 'd'.repeat(40);

function release(
  version: string,
  extra: Partial<FakeRelease> = {},
): FakeRelease {
  const tag = `v${version}-preview`;
  return {
    tag_name: tag,
    prerelease: true,
    body: `notes for ${version}`,
    html_url: `https://github.com/funtasy2333/SEP/releases/tag/${tag}`,
    published_at: '2026-02-01T00:00:00Z',
    assets: ['macos', 'windows'].map((p) => ({
      name: `SES-${version}-preview-${p}.zip`,
      size: 1234,
      browser_download_url: `https://example.invalid/${p}.zip`,
      digest: `sha256:${'0'.repeat(64)}`,
    })),
    ...extra,
  };
}

/** 假 GitHub 上登记 main 与某个稳定版标签的提交。 */
function seedCommits(github: FakeGithub, tag = 'v0.1.2-preview') {
  github.commits.set('main', { sha: TARGET, date: '2026-03-01T00:00:00Z' });
  github.commits.set(tag, { sha: TARGET });
}

describe('GET /api/system/update/check', () => {
  let t: SystemTestApp;
  afterEach(async () => t?.close());

  const check = async (channel: string): Promise<UpdateCheck> => {
    const res = await t.http.get(`/api/system/update/check?channel=${channel}`);
    expect(res.status).toBe(200);
    return res.body as UpdateCheck;
  };

  describe('stable 通道', () => {
    it('排除 draft 与非 preview 标签，取版本最高者，并带上说明、链接与资产大小', async () => {
      t = await createSystemTestApp({
        build: { version: '0.1.1-preview', channel: 'stable', commit: CURRENT },
      });
      t.github.releases = [
        release('0.1.2'),
        release('0.1.10'),
        release('0.9.0', { draft: true }),
        release('0.1.9', { tag_name: 'v0.1.9' }), // 非 preview 标签
        release('0.1.9', { tag_name: 'nightly-0.2.0-preview' }),
      ];
      seedCommits(t.github, 'v0.1.10-preview');
      t.github.compares.set(`${CURRENT}...${TARGET}`, {
        status: 'ahead',
        commits: [],
      });

      const result = await check('stable');

      expect(result).toMatchObject({
        channel: 'stable',
        current: {
          version: '0.1.1-preview',
          commit: CURRENT,
          channel: 'stable',
        },
        available: true,
        reason: null,
        latest: {
          version: '0.1.10-preview',
          commit: TARGET,
          publishedAt: '2026-02-01T00:00:00Z',
          notes: 'notes for 0.1.10',
          assetSize: 1234,
        },
      });
      expect(t.github.requests).toContain(
        '/repos/funtasy2333/SEP/commits/v0.1.10-preview',
      );
    });

    it('请求头带 Accept 与 User-Agent: SES/<version>', async () => {
      t = await createSystemTestApp();
      t.github.releases = [release('0.1.2')];
      seedCommits(t.github);
      await check('stable');
      expect(t.github.lastHeaders['accept']).toBe(
        'application/vnd.github+json',
      );
      expect(t.github.lastHeaders['user-agent']).toBe(
        `SES/${SES_SERVER_VERSION}`,
      );
    });

    it('按 launcher 选平台资产：windows 缺资产时给出原因，仍返回 latest', async () => {
      t = await createSystemTestApp({
        launcher: 'windows',
        platform: 'win32',
        build: { version: '0.1.1-preview', channel: 'stable', commit: CURRENT },
      });
      t.github.releases = [
        release('0.1.2', {
          assets: [
            {
              name: 'SES-0.1.2-preview-macos.zip',
              browser_download_url: 'https://example.invalid/m.zip',
            },
          ],
        }),
      ];
      seedCommits(t.github);
      t.github.compares.set(`${CURRENT}...${TARGET}`, { status: 'ahead' });

      const result = await check('stable');

      expect(result.available).toBe(false);
      expect(result.reason).toContain('SES-0.1.2-preview-windows.zip');
      expect(result.latest).toMatchObject({
        version: '0.1.2-preview',
        commit: TARGET,
      });
    });

    it('没有任何符合条件的稳定版：latest 为 null', async () => {
      t = await createSystemTestApp();
      t.github.releases = [
        release('0.2.0', { draft: true }),
        release('0.1.0', { tag_name: 'v0.1.0' }),
      ];
      const result = await check('stable');
      expect(result).toMatchObject({ latest: null, available: false });
      expect(result.reason).toBeTruthy();
    });

    describe('当前提交已知：以 compare 为准', () => {
      beforeEach(async () => {
        t = await createSystemTestApp({
          build: {
            version: '0.1.1-preview',
            channel: 'commit',
            commit: CURRENT,
          },
        });
        t.github.releases = [release('0.1.2')];
        seedCommits(t.github);
      });

      it('ahead：可升级，commits 新→旧、message 取首行、最多 50 条', async () => {
        const commits = Array.from({ length: 60 }, (_, i) => ({
          sha: String(i).padStart(40, '0'),
          message: `提交 ${i}\n\n正文不应出现`,
          date: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
          login: i === 59 ? null : `user${i}`,
          name: `Name ${i}`,
        })); // GitHub 顺序：旧 → 新
        t.github.compares.set(`${CURRENT}...${TARGET}`, {
          status: 'ahead',
          commits,
        });

        const result = await check('stable');

        expect(result.available).toBe(true);
        expect(result.reason).toBeNull();
        expect(result.commits).toHaveLength(50);
        expect(result.commits[0]).toEqual({
          sha: String(59).padStart(40, '0'),
          message: '提交 59',
          date: '2026-01-01T00:00:59Z',
          author: 'Name 59', // 没有 GitHub 账号时回退到提交作者名
        });
        expect(result.commits[1].author).toBe('user58');
        expect(result.commits[49].message).toBe('提交 10');
      });

      it('identical：已是最新版本（即使提交 sha 不同）', async () => {
        t.github.compares.set(`${CURRENT}...${TARGET}`, {
          status: 'identical',
        });
        expect(await check('stable')).toMatchObject({
          available: false,
          reason: '已是最新版本',
        });
      });

      it('behind：当前提交版比最新稳定版更新，不可降级', async () => {
        t.github.compares.set(`${CURRENT}...${TARGET}`, { status: 'behind' });
        const result = await check('stable');
        expect(result.available).toBe(false);
        expect(result.reason).toBe(
          '当前提交版比最新稳定版更新，等下一个稳定版发布后再切换',
        );
      });

      it('diverged：不可升级', async () => {
        t.github.compares.set(`${CURRENT}...${TARGET}`, { status: 'diverged' });
        const result = await check('stable');
        expect(result.available).toBe(false);
        expect(result.reason).toContain('分叉');
      });

      it('当前提交与目标提交相同：不再请求 compare', async () => {
        await t.close();
        t = await createSystemTestApp({
          build: {
            version: '0.1.2-preview',
            channel: 'stable',
            commit: TARGET,
          },
        });
        t.github.releases = [release('0.1.2')];
        seedCommits(t.github);
        const result = await check('stable');
        expect(result).toMatchObject({
          available: false,
          reason: '已是最新版本',
        });
        expect(t.github.requests.some((p) => p.includes('/compare/'))).toBe(
          false,
        );
      });

      it('GitHub 不认识当前提交（compare 404）：按未知提交处理，用版本号比较', async () => {
        // 未登记 compare → 404；当前版本 0.1.1 < 0.1.2
        expect(await check('stable')).toMatchObject({
          available: true,
          reason: null,
        });
      });

      it('compare 返回 5xx：报告无法连接 GitHub，不可升级', async () => {
        t.github.compares.set(`${CURRENT}...${TARGET}`, 502);
        const result = await check('stable');
        expect(result.available).toBe(false);
        expect(result.latest).toBeNull();
        expect(result.reason).toMatch(
          /^无法连接 GitHub：.*HTTP 502.*请检查网络或代理$/,
        );
      });
    });

    describe('当前提交未知：按 x.y.z 比较', () => {
      const run = async (version: string | undefined, latest = '0.1.2') => {
        t = await createSystemTestApp(
          version === undefined
            ? {}
            : { build: { version, channel: null, commit: null } },
        );
        t.github.releases = [release(latest)];
        seedCommits(t.github, `v${latest}-preview`);
        return check('stable');
      };

      it('更低：可升级（-preview 后缀被忽略）', async () => {
        expect(await run('0.1.1-preview')).toMatchObject({
          available: true,
          reason: null,
          commits: [],
        });
      });

      it('没有 ses-build.json：用服务端版本号与更新的发布版本比较', async () => {
        const result = await run(undefined, '999.0.0');
        expect(result.current).toEqual({
          version: SES_SERVER_VERSION,
          commit: null,
          channel: null,
        });
        expect(result.available).toBe(true);
      });

      it('相同：已是最新版本', async () => {
        expect(await run('0.1.2-preview')).toMatchObject({
          available: false,
          reason: '已是最新版本',
        });
      });

      it('更高：不可降级', async () => {
        const result = await run('0.1.3-preview');
        expect(result.available).toBe(false);
        expect(result.reason).toContain('当前提交版比最新稳定版更新');
      });

      it('版本号无法识别：不可升级并说明', async () => {
        const result = await run('dev-build');
        expect(result.available).toBe(false);
        expect(result.reason).toContain('dev-build');
      });
    });
  });

  describe('commit 通道', () => {
    it('ahead：可升级，latest 是 main 最新提交（version 为 null）', async () => {
      t = await createSystemTestApp({
        build: { version: '0.1.1-preview', channel: 'commit', commit: CURRENT },
      });
      seedCommits(t.github);
      t.github.compares.set(`${CURRENT}...${TARGET}`, {
        status: 'ahead',
        commits: [{ sha: TARGET, message: 'feat: 新功能', login: 'dev' }],
      });

      const result = await check('commit');

      expect(result).toMatchObject({
        channel: 'commit',
        available: true,
        reason: null,
        latest: {
          version: null,
          commit: TARGET,
          publishedAt: '2026-03-01T00:00:00Z',
          notes: null,
          assetSize: null,
          url: `https://github.com/funtasy2333/SEP/commit/${TARGET}`,
        },
        commits: [{ sha: TARGET, message: 'feat: 新功能', author: 'dev' }],
      });
    });

    it('identical / behind / diverged 都不可升级', async () => {
      t = await createSystemTestApp({
        build: { version: '0.1.1-preview', channel: 'commit', commit: CURRENT },
      });
      seedCommits(t.github);
      for (const [status, expected] of [
        ['identical', '已是最新版本'],
        ['behind', '无法降级'],
        ['diverged', '分叉'],
      ] as const) {
        t.github.compares.set(`${CURRENT}...${TARGET}`, { status });
        const result = await check('commit');
        expect(result.available).toBe(false);
        expect(result.reason).toContain(expected);
      }
    });

    it('当前提交未知：仍可升级，reason 给出提示', async () => {
      t = await createSystemTestApp();
      seedCommits(t.github);
      expect(await check('commit')).toMatchObject({
        available: true,
        reason: '无法确认当前提交，升级后将以 main 最新提交为准',
        commits: [],
      });
    });
  });

  describe('错误处理', () => {
    it('无法连接 GitHub：available=false，reason 为中文说明', async () => {
      t = await createSystemTestApp();
      await t.github.stop(); // 端口已关闭 → 连接被拒绝
      const result = await check('stable');
      expect(result).toMatchObject({
        available: false,
        latest: null,
        commits: [],
      });
      expect(result.reason).toMatch(/^无法连接 GitHub：.+，请检查网络或代理$/);
      await t.github.start(); // close() 时需要可停止
    });

    it('API 超时', async () => {
      t = await createSystemTestApp({ config: { apiTimeoutMs: 150 } });
      t.github.hangApi = true;
      const result = await check('commit');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('无法连接 GitHub：请求超时，请检查网络或代理');
    });

    it('channel 缺失或非法：400', async () => {
      t = await createSystemTestApp();
      expect((await t.http.get('/api/system/update/check')).status).toBe(400);
      expect(
        (await t.http.get('/api/system/update/check?channel=nightly')).status,
      ).toBe(400);
    });
  });
});
