import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { configureApp } from '../app-setup';
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
}

export const SCRIPT_FILES = [
  'apply-update.cjs',
  'ses-upgrade.sh',
  'ses-upgrade.ps1',
  'ses-local.sh',
  'ses-windows.ps1',
];

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
    config,
    async close() {
      await app.close();
      await github.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export type SystemTestApp = Awaited<ReturnType<typeof createSystemTestApp>>;
