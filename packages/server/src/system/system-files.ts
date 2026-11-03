import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import type {
  BuildInfo,
  UpdateChannel,
  UpgradeState,
  UpgradeStatusFile,
} from './system.types';

/** SES 根目录下与升级、退出相关的固定路径。 */
export function systemPaths(root: string) {
  const updateDir = join(root, '.ses-update');
  const runDir = join(root, '.ses-run');
  return {
    buildJson: join(root, 'ses-build.json'),
    gitDir: join(root, '.git'),
    updateDir,
    lockDir: join(updateDir, 'lock'),
    plan: join(updateDir, 'plan.json'),
    zip: join(updateDir, 'download.zip'),
    partialZip: join(updateDir, 'download.zip.partial'),
    runDir,
    startLock: join(runDir, 'start.lock'),
    upgradeStatus: join(runDir, 'upgrade-status.json'),
    upgradeLog: join(runDir, 'upgrade.log'),
    shutdownLog: join(runDir, 'shutdown.log'),
    scriptsDir: join(root, 'scripts'),
  };
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null; // 缺失或损坏都按读不到处理
  }
}

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

/** 读取根目录 ses-build.json；读不到或字段不合法时逐字段回退（version 回退到服务端版本，其余为 null）。 */
export function readBuildInfo(
  root: string,
  fallbackVersion: string,
): BuildInfo {
  const json = readJsonObject(systemPaths(root).buildJson);
  const version =
    typeof json?.version === 'string' && json.version.trim() !== ''
      ? json.version.trim()
      : fallbackVersion;
  const channel: UpdateChannel | null =
    json?.channel === 'stable' || json?.channel === 'commit'
      ? json.channel
      : null;
  const commit =
    typeof json?.commit === 'string' && COMMIT_PATTERN.test(json.commit.trim())
      ? json.commit.trim().toLowerCase()
      : null;
  return { version, channel, commit };
}

const UPGRADE_STATES: readonly UpgradeState[] = [
  'running',
  'succeeded',
  'rolled-back',
  'failed',
];

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** 读取升级执行器状态文件；缺失、损坏或 state 非法时返回 null。 */
export function readUpgradeStatus(root: string): UpgradeStatusFile | null {
  const json = readJsonObject(systemPaths(root).upgradeStatus);
  if (!json) return null;
  const state = UPGRADE_STATES.find((s) => s === json.state);
  if (!state) return null;
  return {
    state,
    step: stringOrNull(json.step),
    from: stringOrNull(json.from),
    to: stringOrNull(json.to),
    message: stringOrNull(json.message),
    log: stringOrNull(json.log),
    updatedAt: stringOrNull(json.updatedAt),
  };
}

/** 升级锁目录是否已被占用且未过期。 */
function isLockStale(root: string, now: number, staleMs: number): boolean {
  const paths = systemPaths(root);
  const status = readUpgradeStatus(root);
  // 执行器在跑：看它最后一次更新状态的时间；其余情况（无状态文件、旧状态、时间读不到）看锁目录自身的修改时间
  const updated =
    status?.state === 'running' && status.updatedAt
      ? Date.parse(status.updatedAt)
      : NaN;
  if (Number.isFinite(updated)) return now - updated > staleMs;
  try {
    return now - statSync(paths.lockDir).mtimeMs > staleMs;
  } catch {
    return true; // 锁目录已消失
  }
}

export type LockResult = { acquired: true } | { acquired: false };

/** 抢升级锁（mkdir 原子创建）。已被占用时，陈旧锁会被清理后重试一次。 */
export function acquireUpgradeLock(
  root: string,
  now: number,
  staleMs: number,
): LockResult {
  const paths = systemPaths(root);
  mkdirSync(paths.updateDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(paths.lockDir);
      return { acquired: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt === 1 || !isLockStale(root, now, staleMs)) break;
      rmSync(paths.lockDir, { recursive: true, force: true });
    }
  }
  return { acquired: false };
}

export function releaseUpgradeLock(root: string): void {
  rmSync(systemPaths(root).lockDir, { recursive: true, force: true });
}

export function startLockExists(root: string): boolean {
  return existsSync(systemPaths(root).startLock);
}
