import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import {
  launcherMatchesPlatform,
  SYSTEM_CONFIG,
  type SystemConfig,
} from './system.config';
import type {
  DesktopAutoStartResult,
  DesktopShortcutResult,
  DesktopStatus,
  Launcher,
} from './system.types';

const execFileAsync = promisify(execFile);

export const DESKTOP_SCRIPT_RUNNER = Symbol('DESKTOP_SCRIPT_RUNNER');

export interface DesktopScriptRequest {
  command: string;
  args: string[];
  cwd: string;
}

export type DesktopScriptRunner = (
  request: DesktopScriptRequest,
) => Promise<{ stdout: string; stderr: string }>;

const DESKTOP_SCRIPT_TIMEOUT_MS = 15_000;

export const defaultDesktopScriptRunner: DesktopScriptRunner = async (
  request,
) => {
  const env = { ...process.env };
  // A PSModulePath inherited from PowerShell 7 breaks built-in cmdlets in Windows PowerShell 5.1.
  if (request.command.toLowerCase().includes('powershell')) {
    delete env.PSModulePath;
  }
  const { stdout, stderr } = await execFileAsync(
    request.command,
    request.args,
    {
      cwd: request.cwd,
      timeout: DESKTOP_SCRIPT_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
      env,
    },
  );
  return { stdout, stderr };
};

@Injectable()
export class DesktopIntegrator {
  private readonly logger = new Logger(DesktopIntegrator.name);

  constructor(
    @Inject(SYSTEM_CONFIG) private readonly config: SystemConfig,
    @Inject(DESKTOP_SCRIPT_RUNNER)
    private readonly runner: DesktopScriptRunner,
  ) {}

  unsupportedReason(): string | null {
    const { launcher, platform } = this.config;
    if (!launcher) {
      return '仅在使用启动脚本运行 SES 时支持桌面快捷方式与开机自启';
    }
    if (!launcherMatchesPlatform(launcher, platform)) {
      return `启动方式（${launcher}）与当前操作系统（${platform}）不一致，无法管理桌面集成`;
    }
    const script = this.scriptPath(launcher);
    if (!existsSync(script)) {
      return `缺少桌面集成脚本：${join('scripts', launcher === 'windows' ? 'ses-desktop.ps1' : 'ses-desktop.sh')}`;
    }
    return null;
  }

  async status(): Promise<DesktopStatus> {
    const reason = this.unsupportedReason();
    if (reason) {
      return {
        supported: false,
        unsupportedReason: reason,
        platform: this.config.launcher,
        desktopShortcut: false,
        startMenuShortcut: false,
        autoStart: false,
      };
    }
    const launcher = this.config.launcher!;
    const raw = await this.invoke(launcher, ['status']);
    return {
      supported: true,
      unsupportedReason: null,
      platform: launcher,
      desktopShortcut: Boolean(raw.desktopShortcut),
      startMenuShortcut: Boolean(raw.startMenuShortcut),
      autoStart: Boolean(raw.autoStart),
    };
  }

  async createShortcuts(): Promise<DesktopShortcutResult> {
    const launcher = this.assertSupported();
    const raw = await this.invoke(launcher, ['create-shortcuts']);
    return {
      desktopShortcut: Boolean(raw.desktopShortcut),
      startMenuShortcut: Boolean(raw.startMenuShortcut),
      desktopPath: typeof raw.desktopPath === 'string' ? raw.desktopPath : null,
      startMenuPath:
        typeof raw.startMenuPath === 'string' ? raw.startMenuPath : null,
    };
  }

  async setAutoStart(enabled: boolean): Promise<DesktopAutoStartResult> {
    const launcher = this.assertSupported();
    const raw = await this.invoke(launcher, [
      'set-autostart',
      enabled ? 'true' : 'false',
    ]);
    return {
      autoStart: Boolean(raw.autoStart),
    };
  }

  private assertSupported(): Launcher {
    const reason = this.unsupportedReason();
    if (reason) throw new ConflictException(reason);
    return this.config.launcher!;
  }

  private scriptPath(launcher: Launcher): string {
    return join(
      this.config.root,
      'scripts',
      launcher === 'windows' ? 'ses-desktop.ps1' : 'ses-desktop.sh',
    );
  }

  private async invoke(
    launcher: Launcher,
    actionArgs: string[],
  ): Promise<Record<string, unknown>> {
    const script = this.scriptPath(launcher);
    const req: DesktopScriptRequest =
      launcher === 'windows'
        ? {
            command: 'powershell.exe',
            args: [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              script,
              ...actionArgs,
            ],
            cwd: this.config.root,
          }
        : {
            command: '/bin/bash',
            args: [script, ...actionArgs],
            cwd: this.config.root,
          };

    let stdout: string;
    try {
      const result = await this.runner(req);
      stdout = result.stdout;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `桌面集成脚本执行失败 (${actionArgs.join(' ')}): ${detail}`,
      );
      throw new InternalServerErrorException(
        '桌面集成操作失败，请检查系统权限或稍后重试',
      );
    }

    const cleaned = stdout.replace(/^\uFEFF/, '').trim();
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('output is not a JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `桌面集成脚本返回非法 JSON (${actionArgs.join(' ')}): ${detail}; stdout=${cleaned}`,
      );
      throw new InternalServerErrorException(
        '桌面集成脚本返回格式异常，请稍后重试',
      );
    }
  }
}
