import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { PROCESS_SPAWNER, type ProcessSpawner } from './process-spawner';
import {
  acquireUpgradeLock,
  readUpgradeStatus,
  releaseUpgradeLock,
  startLockExists,
  systemPaths,
} from './system-files';
import {
  launcherMatchesPlatform,
  SYSTEM_CONFIG,
  type SystemConfig,
} from './system.config';
import type {
  DownloadStatus,
  Launcher,
  SystemInfo,
  UpdateChannel,
  UpdateCheck,
  UpgradePlan,
} from './system.types';
import { DownloadError, UpdateDownloader } from './update-downloader';
import { UpdateChecker, type CheckOutcome } from './update-checker';

const IDLE_STATUS: DownloadStatus = {
  phase: 'idle',
  receivedBytes: 0,
  totalBytes: null,
  error: null,
  startedAt: null,
};

/** 升级执行器与脚本文件名（与脚本开发者约定）。 */
function upgradeScripts(launcher: Launcher) {
  return [
    'apply-update.cjs',
    launcher === 'macos' ? 'ses-upgrade.sh' : 'ses-upgrade.ps1',
  ];
}

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);
  private download: DownloadStatus = { ...IDLE_STATUS };
  /** 本进程内是否有升级流程（检查 → 下载 → 交接）在进行。 */
  private upgradeInFlight = false;
  private shutdownRequested = false;

  constructor(
    @Inject(SYSTEM_CONFIG) private readonly config: SystemConfig,
    @Inject(PROCESS_SPAWNER) private readonly spawner: ProcessSpawner,
    private readonly checker: UpdateChecker,
    private readonly downloader: UpdateDownloader,
  ) {}

  info(): SystemInfo {
    const build = this.checker.currentBuild();
    const shutdownBlockedReason = this.shutdownBlockedReason();
    const upgradeBlockedReason = this.upgradeBlockedReason();
    return {
      version: build.version,
      channel: build.channel,
      commit: build.commit,
      launcher: this.config.launcher,
      canShutdown: shutdownBlockedReason === null,
      shutdownBlockedReason,
      canUpgrade: upgradeBlockedReason === null,
      upgradeBlockedReason,
      upgrade: {
        download: this.downloadStatus(),
        last: readUpgradeStatus(this.config.root),
      },
    };
  }

  downloadStatus(): DownloadStatus {
    return { ...this.download };
  }

  check(channel: UpdateChannel): Promise<UpdateCheck> {
    return this.checker.evaluate(channel).then((outcome) => outcome.check);
  }

  shutdownBlockedReason(): string | null {
    const { launcher } = this.config;
    if (!launcher) return '开发模式下请在终端停止 SES';
    const script = this.shutdownScript(launcher);
    if (!existsSync(script)) return `找不到退出脚本：${script}`;
    return null;
  }

  upgradeBlockedReason(): string | null {
    const { launcher, root, platform } = this.config;
    if (!launcher) return '开发模式下不支持应用内升级，请使用 git pull 更新';
    if (existsSync(systemPaths(root).gitDir)) {
      return '源码目录请使用 git pull 更新';
    }
    const missing = upgradeScripts(launcher).filter(
      (name) => !existsSync(join(systemPaths(root).scriptsDir, name)),
    );
    if (missing.length > 0) {
      return `缺少升级脚本：${missing.map((n) => `scripts/${n}`).join('、')}，请先手动更新到包含升级功能的版本`;
    }
    if (!launcherMatchesPlatform(launcher, platform)) {
      return `启动方式（${launcher}）与当前操作系统（${platform}）不一致，无法升级`;
    }
    return null;
  }

  /**
   * 开始升级：抢锁 → 重新检查并核对 commit → 后台下载、校验、交接给执行器。
   * 这里只负责同步阶段（可能抛 409），下载在后台进行，进度见 {@link downloadStatus}。
   */
  async startUpdate(channel: UpdateChannel, commit: string): Promise<void> {
    const blocked = this.upgradeBlockedReason();
    if (blocked) throw new ConflictException(blocked);
    if (this.upgradeInFlight) throw new ConflictException('已有升级在进行');
    if (startLockExists(this.config.root)) {
      throw new ConflictException('SES 正在启动，请稍后再试');
    }
    this.upgradeInFlight = true;
    let lockHeld = false;
    let outcome: CheckOutcome;
    try {
      const lock = acquireUpgradeLock(
        this.config.root,
        this.config.now(),
        this.config.staleLockMs,
      );
      if (!lock.acquired) throw new ConflictException('已有升级在进行');
      lockHeld = true;
      outcome = await this.checker.evaluate(channel);
      const { check, target } = outcome;
      if (!check.available || !target || !check.latest) {
        throw new ConflictException(check.reason ?? '当前没有可用的更新');
      }
      if (check.latest.commit.toLowerCase() !== commit.toLowerCase()) {
        throw new ConflictException('最新版本已变化，请重新检查更新');
      }
    } catch (error) {
      if (lockHeld) releaseUpgradeLock(this.config.root);
      this.upgradeInFlight = false;
      throw error;
    }
    this.download = {
      ...IDLE_STATUS,
      phase: 'downloading',
      startedAt: new Date(this.config.now()).toISOString(),
    };
    void this.runUpgrade(outcome);
  }

  private async runUpgrade(outcome: CheckOutcome): Promise<void> {
    const paths = systemPaths(this.config.root);
    try {
      rmSync(paths.plan, { force: true });
      rmSync(paths.zip, { force: true });
      await this.downloader.download(outcome.target!, paths.partialZip, {
        onProgress: (receivedBytes, totalBytes) => {
          this.download = { ...this.download, receivedBytes, totalBytes };
        },
        onVerifying: () => {
          this.download = { ...this.download, phase: 'verifying' };
        },
      });
      renameSync(paths.partialZip, paths.zip);
      this.download = { ...this.download, phase: 'handing-off' };
      await this.handOff(outcome.check);
      this.download = { ...this.download, phase: 'handed-off' };
    } catch (error) {
      const message =
        error instanceof DownloadError || error instanceof Error
          ? error.message
          : String(error);
      this.logger.error(`升级失败：${message}`);
      rmSync(paths.partialZip, { force: true });
      rmSync(paths.zip, { force: true });
      rmSync(paths.plan, { force: true });
      releaseUpgradeLock(this.config.root);
      this.download = { ...this.download, phase: 'error', error: message };
    } finally {
      this.upgradeInFlight = false;
    }
  }

  /** 写交接文件、复制脚本到 .ses-update/ 并以分离进程拉起升级脚本；之后的锁由执行器负责释放。 */
  private async handOff(check: UpdateCheck): Promise<void> {
    const { root, launcher } = this.config;
    if (!launcher || !check.latest)
      throw new Error('无法交接升级：缺少启动方式');
    const paths = systemPaths(root);
    const build = this.checker.currentBuild();
    const plan: UpgradePlan = {
      zip: paths.zip,
      channel: check.channel,
      targetVersion: check.latest.version,
      targetCommit: check.latest.commit,
      fromVersion: build.version,
      fromCommit: build.commit,
      node: this.config.nodePath,
      platform: launcher,
      requestedAt: new Date(this.config.now()).toISOString(),
    };
    const planTmp = `${paths.plan}.tmp`;
    writeFileSync(planTmp, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    renameSync(planTmp, paths.plan);

    for (const name of upgradeScripts(launcher)) {
      copyFileSync(join(paths.scriptsDir, name), join(paths.updateDir, name));
    }
    mkdirSync(paths.runDir, { recursive: true });
    const script = join(
      paths.updateDir,
      launcher === 'macos' ? 'ses-upgrade.sh' : 'ses-upgrade.ps1',
    );
    await this.spawner(
      launcher === 'macos'
        ? {
            command: '/bin/bash',
            args: [script, root],
            cwd: root,
            logFile: paths.upgradeLog,
          }
        : {
            command: 'powershell.exe',
            args: [
              '-NoLogo',
              '-NoProfile',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              script,
              '-Root',
              root,
            ],
            cwd: root,
            logFile: paths.upgradeLog,
          },
    );
  }

  private shutdownScript(launcher: Launcher): string {
    return join(
      systemPaths(this.config.root).scriptsDir,
      launcher === 'macos' ? 'ses-local.sh' : 'ses-windows.ps1',
    );
  }

  /** 校验可以退出，不能则 409。 */
  assertCanShutdown(): void {
    const reason = this.shutdownBlockedReason();
    if (reason) throw new ConflictException(reason);
  }

  /**
   * 拉起退出脚本（脚本会停掉本服务端自己）。调用方在响应发出后调用；延迟一小段时间保证响应完整送达。
   * 重复调用只会拉起一次。
   */
  async runShutdown(): Promise<void> {
    const { launcher, root } = this.config;
    if (!launcher || this.shutdownRequested) return;
    this.shutdownRequested = true;
    await new Promise((resolve) =>
      setTimeout(resolve, this.config.shutdownDelayMs),
    );
    const script = this.shutdownScript(launcher);
    const logFile = systemPaths(root).shutdownLog;
    try {
      await this.spawner(
        launcher === 'macos'
          ? { command: '/bin/bash', args: [script, 'stop'], cwd: root, logFile }
          : {
              command: 'powershell.exe',
              args: [
                '-NoLogo',
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                script,
                'stop',
              ],
              cwd: root,
              logFile,
            },
      );
    } catch (error) {
      // 拉起失败时允许用户再次点击退出
      this.shutdownRequested = false;
      this.logger.error(
        `拉起退出脚本失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
