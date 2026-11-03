import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  acquireUpgradeLock,
  readBuildInfo,
  readUpgradeStatus,
  releaseUpgradeLock,
  systemPaths,
} from './system-files';

const HOUR = 60 * 60 * 1000;
const COMMIT = 'a'.repeat(40);

describe('系统文件读取与升级锁', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ses-files-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const writeBuild = (content: string) =>
    writeFileSync(join(root, 'ses-build.json'), content);
  const writeStatus = (content: unknown) => {
    mkdirSync(join(root, '.ses-run'), { recursive: true });
    writeFileSync(
      join(root, '.ses-run', 'upgrade-status.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  };

  describe('readBuildInfo', () => {
    it('读取完整的 ses-build.json', () => {
      writeBuild(
        JSON.stringify({
          version: '0.1.2-preview',
          channel: 'stable',
          commit: COMMIT,
          builtAt: '2026-01-01T00:00:00Z',
        }),
      );
      expect(readBuildInfo(root, '0.1.1')).toEqual({
        version: '0.1.2-preview',
        channel: 'stable',
        commit: COMMIT,
      });
    });

    it('文件缺失：version 回退到服务端版本，channel 与 commit 为 null', () => {
      expect(readBuildInfo(root, '0.1.1')).toEqual({
        version: '0.1.1',
        channel: null,
        commit: null,
      });
    });

    it.each(['{not json', '[]', '"x"', 'null', ''])(
      '损坏内容 %j 按读不到处理',
      (c) => {
        writeBuild(c);
        expect(readBuildInfo(root, '0.1.1')).toEqual({
          version: '0.1.1',
          channel: null,
          commit: null,
        });
      },
    );

    it('字段不合法时逐字段回退；commit 统一为小写', () => {
      writeBuild(
        JSON.stringify({ version: 5, channel: 'beta', commit: 'NOT-A-SHA' }),
      );
      expect(readBuildInfo(root, '0.1.1')).toEqual({
        version: '0.1.1',
        channel: null,
        commit: null,
      });
      writeBuild(
        JSON.stringify({
          version: '0.2.0',
          channel: 'commit',
          commit: 'ABCDEF1',
        }),
      );
      expect(readBuildInfo(root, '0.1.1')).toEqual({
        version: '0.2.0',
        channel: 'commit',
        commit: 'abcdef1',
      });
    });
  });

  describe('readUpgradeStatus', () => {
    it('读取执行器状态文件', () => {
      const status = {
        state: 'rolled-back',
        step: 'migrate',
        from: '0.1.1',
        to: '0.1.2-preview',
        message: '启动失败，已回滚',
        log: '/x/upgrade.log',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      writeStatus(status);
      expect(readUpgradeStatus(root)).toEqual(status);
    });

    it('缺失、损坏、state 非法都返回 null；缺字段补 null', () => {
      expect(readUpgradeStatus(root)).toBeNull();
      writeStatus('{oops');
      expect(readUpgradeStatus(root)).toBeNull();
      writeStatus({ state: 'weird' });
      expect(readUpgradeStatus(root)).toBeNull();
      writeStatus({ state: 'running', step: 3 });
      expect(readUpgradeStatus(root)).toEqual({
        state: 'running',
        step: null,
        from: null,
        to: null,
        message: null,
        log: null,
        updatedAt: null,
      });
    });
  });

  describe('升级锁', () => {
    const now = () => Date.now();
    const ageLock = (ms: number) => {
      const t = new Date(Date.now() - ms);
      utimesSync(systemPaths(root).lockDir, t, t);
    };

    it('首次获取成功，已存在且新鲜时失败', () => {
      expect(acquireUpgradeLock(root, now(), HOUR).acquired).toBe(true);
      expect(existsSync(systemPaths(root).lockDir)).toBe(true);
      expect(acquireUpgradeLock(root, now(), HOUR).acquired).toBe(false);
    });

    it('释放后可再次获取', () => {
      acquireUpgradeLock(root, now(), HOUR);
      releaseUpgradeLock(root);
      expect(acquireUpgradeLock(root, now(), HOUR).acquired).toBe(true);
    });

    it('无状态文件、锁目录超过 60 分钟：视为陈旧并清理', () => {
      acquireUpgradeLock(root, now(), HOUR);
      ageLock(61 * 60 * 1000);
      expect(acquireUpgradeLock(root, now(), HOUR).acquired).toBe(true);
    });

    it('无状态文件、锁目录不足 60 分钟：不清理', () => {
      acquireUpgradeLock(root, now(), HOUR);
      ageLock(59 * 60 * 1000);
      expect(acquireUpgradeLock(root, now(), HOUR).acquired).toBe(false);
    });

    it('状态为 running 且 updatedAt 超过 60 分钟：陈旧（即便锁目录是新的）', () => {
      acquireUpgradeLock(root, now(), HOUR);
      writeStatus({
        state: 'running',
        updatedAt: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
      });
      expect(acquireUpgradeLock(root, now(), HOUR).acquired).toBe(true);
    });

    it('状态为 running 且 updatedAt 新鲜：不清理（即便锁目录很旧）', () => {
      acquireUpgradeLock(root, now(), HOUR);
      ageLock(5 * HOUR);
      writeStatus({
        state: 'running',
        updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      });
      expect(acquireUpgradeLock(root, now(), HOUR).acquired).toBe(false);
    });

    it('状态已结束（succeeded）而锁目录很旧：按锁目录时间清理', () => {
      acquireUpgradeLock(root, now(), HOUR);
      ageLock(2 * HOUR);
      writeStatus({ state: 'succeeded', updatedAt: new Date().toISOString() });
      expect(acquireUpgradeLock(root, now(), HOUR).acquired).toBe(true);
    });
  });
});
