import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { configureApp } from '../app-setup';
import {
  DESKTOP_SCRIPT_RUNNER,
  type DesktopScriptRequest,
  type DesktopScriptRunner,
} from '../system/desktop-integrator';
import { PROCESS_SPAWNER, type SpawnRequest } from '../system/process-spawner';
import {
  createSystemConfig,
  SYSTEM_CONFIG,
  type SystemConfig,
} from '../system/system.config';
import { SystemModule } from '../system/system.module';
import { FakeGithub } from './fake-github';

export interface SystemTestAppOptions {
  launcher?: 'macos' | 'windows' | null;
  platform?: NodeJS.Platform;
  /** 在根目录创建 .git 目录（模拟源码目录）。 */
  git?: boolean;
  /** 不创建的脚本文件名（相对 scripts/）。 */
  omitScripts?: string[];
  /** ses-build.json 内容；undefined 表示不创建。 */
  build?: Record<string, unknown> | string;
  config?: Partial<SystemConfig>;
  /** 拉起进程的假实现；默认只记录。 */
  spawner?: (req: SpawnRequest) => Promise<void>;
  /** 桌面集成脚本的假实现；默认维护内存态。 */
  desktopRunner?: DesktopScriptRunner;
}

export const SCRIPT_FILES = [
  'apply-update.cjs',
  'ses-upgrade.sh',
  'ses-upgrade.ps1',
  'ses-local.sh',
  'ses-windows.ps1',
  'ses-desktop.sh',
  'ses-desktop.ps1',
  'run-detached.cjs',
];

function createDefaultDesktopRunner(root: string): DesktopScriptRunner {
  const state = {
    desktopShortcut: false,
    startMenuShortcut: false,
    autoStart: false,
  };
  return (req) => {
    const action = req.args.find((arg) =>
      ['status', 'create-shortcuts', 'set-autostart'].includes(arg),
    );
    if (action === 'status') {
      return Promise.resolve({ stdout: JSON.stringify(state), stderr: '' });
    }
    if (action === 'create-shortcuts') {
      state.desktopShortcut = true;
      state.startMenuShortcut = true;
      return Promise.resolve({
        stdout: JSON.stringify({
          desktopShortcut: true,
          startMenuShortcut: true,
          desktopPath: join(root, 'Desktop', 'SES'),
          startMenuPath: join(root, 'StartMenu', 'SES'),
        }),
        stderr: '',
      });
    }
    if (action === 'set-autostart') {
      const idx = req.args.indexOf('set-autostart');
      state.autoStart = req.args[idx + 1] === 'true';
      return Promise.resolve({
        stdout: JSON.stringify({ autoStart: state.autoStart }),
        stderr: '',
      });
    }
    return Promise.reject(
      new Error(`Unexpected desktop action: ${req.args.join(' ')}`),
    );
  };
}

/** 起一个只含系统模块的应用：临时根目录（SES_ROOT）、假 GitHub、记录型 spawner。 */
export async function createSystemTestApp(options: SystemTestAppOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ses-system-'));
  mkdirSync(join(root, 'scripts'));
  for (const name of SCRIPT_FILES) {
    if (options.omitScripts?.includes(name)) continue;
    writeFileSync(join(root, 'scripts', name), `# ${name}\n`);
  }
  if (options.git) mkdirSync(join(root, '.git'));
  if (options.build !== undefined) {
    writeFileSync(
      join(root, 'ses-build.json'),
      typeof options.build === 'string'
        ? options.build
        : JSON.stringify(options.build),
    );
  }

  const github = new FakeGithub();
  await github.start();
  const spawns: SpawnRequest[] = [];
  const desktopCalls: DesktopScriptRequest[] = [];
  const defaultDesktopRunner = createDefaultDesktopRunner(root);

  const config: SystemConfig = {
    ...createSystemConfig({ SES_ROOT: root }),
    launcher: options.launcher === undefined ? 'macos' : options.launcher,
    platform: options.platform ?? 'darwin',
    githubApiBase: github.url,
    codeloadBase: github.url,
    apiTimeoutMs: 2000,
    stallTimeoutMs: 400,
    shutdownDelayMs: 20,
    ...options.config,
  };

  const moduleRef = await Test.createTestingModule({ imports: [SystemModule] })
    .overrideProvider(SYSTEM_CONFIG)
    .useValue(config)
    .overrideProvider(PROCESS_SPAWNER)
    .useValue((req: SpawnRequest) => {
      spawns.push(req);
      return options.spawner ? options.spawner(req) : Promise.resolve();
    })
    .overrideProvider(DESKTOP_SCRIPT_RUNNER)
    .useValue((req: DesktopScriptRequest) => {
      desktopCalls.push(req);
      return options.desktopRunner
        ? options.desktopRunner(req)
        : defaultDesktopRunner(req);
    })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  return {
    app,
    http: request(app.getHttpServer()),
    root,
    github,
    spawns,
    desktopCalls,
    config,
    async close() {
      await app.close();
      await github.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export type SystemTestApp = Awaited<ReturnType<typeof createSystemTestApp>>;
