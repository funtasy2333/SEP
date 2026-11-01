import { resolve } from 'path';
import { SES_SERVER_VERSION } from '../common/app-version';
import type { Launcher } from './system.types';

/** 注入令牌：整个系统模块的运行参数，测试里整体替换。 */
export const SYSTEM_CONFIG = Symbol('SYSTEM_CONFIG');

export const GITHUB_REPO = 'funtasy2333/SEP';

export interface SystemConfig {
  /** SES 根目录（含 packages/、scripts/、ses-build.json）。 */
  root: string;
  /** 启动脚本设置的托管方式；null = 开发模式。 */
  launcher: Launcher | null;
  /** 当前系统平台（process.platform），与 launcher 对照。 */
  platform: NodeJS.Platform;
  /** 服务端版本（ses-build.json 缺失时的回退）。 */
  serverVersion: string;
  /** 升级交接文件里记录的 node 可执行文件。 */
  nodePath: string;
  githubApiBase: string;
  /** codeload 基址，commit 通道的下载地址 `<base>/<repo>/zip/<sha>`。 */
  codeloadBase: string;
  /** GitHub API 请求超时（毫秒）。 */
  apiTimeoutMs: number;
  /** 下载时单次读取停滞多久视为失败（毫秒）。 */
  stallTimeoutMs: number;
  /** 响应发出后延迟多久再拉起退出脚本（毫秒）。 */
  shutdownDelayMs: number;
  /** 陈旧升级锁的判定时长（毫秒）。 */
  staleLockMs: number;
  fetch: typeof fetch;
  now: () => number;
}

export function parseLauncher(value: string | undefined): Launcher | null {
  const v = value?.trim().toLowerCase();
  return v === 'macos' || v === 'windows' ? v : null;
}

/** 从环境变量构造运行参数：SES_ROOT 覆盖根目录，SES_GITHUB_API / SES_CODELOAD_BASE 覆盖 GitHub 基址（测试用）。 */
export function createSystemConfig(
  env: NodeJS.ProcessEnv = process.env,
): SystemConfig {
  const override = (name: string, fallback: string) =>
    env[name]?.trim().replace(/\/+$/, '') || fallback;
  return {
    root: env.SES_ROOT?.trim()
      ? resolve(env.SES_ROOT.trim())
      : resolve(process.cwd(), '../..'),
    launcher: parseLauncher(env.SES_LAUNCHER),
    platform: process.platform,
    serverVersion: SES_SERVER_VERSION,
    nodePath: process.execPath,
    githubApiBase: override('SES_GITHUB_API', 'https://api.github.com'),
    codeloadBase: override('SES_CODELOAD_BASE', 'https://codeload.github.com'),
    apiTimeoutMs: 15_000,
    stallTimeoutMs: 60_000,
    shutdownDelayMs: 300,
    staleLockMs: 60 * 60 * 1000,
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      globalThis.fetch(input, init),
    now: () => Date.now(),
  };
}

/** launcher 与当前操作系统是否一致（macos ↔ darwin，windows ↔ win32）。 */
export function launcherMatchesPlatform(
  launcher: Launcher,
  platform: NodeJS.Platform,
): boolean {
  return launcher === 'macos' ? platform === 'darwin' : platform === 'win32';
}
