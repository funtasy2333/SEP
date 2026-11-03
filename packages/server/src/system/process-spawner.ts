import { spawn } from 'child_process';
import { closeSync, mkdirSync, openSync } from 'fs';
import { dirname } from 'path';

/** 注入令牌：拉起分离进程的函数，测试里替换成记录调用的假实现，不真正拉起进程。 */
export const PROCESS_SPAWNER = Symbol('PROCESS_SPAWNER');

export interface SpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  /** stdout / stderr 追加写入的日志文件。 */
  logFile: string;
}

/** 进程成功拉起时 resolve；命令不存在等启动失败时 reject。 */
export type ProcessSpawner = (request: SpawnRequest) => Promise<void>;

/**
 * 以分离进程（脱离服务端的进程组）拉起命令并 unref，输出追加到日志文件。
 * 升级与退出脚本都会结束服务端自身，所以不能是服务端的子进程。
 */
export const spawnDetachedProcess: ProcessSpawner = async (request) => {
  mkdirSync(dirname(request.logFile), { recursive: true });
  const fd = openSync(request.logFile, 'a');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    closeSync(fd);
  }
};
