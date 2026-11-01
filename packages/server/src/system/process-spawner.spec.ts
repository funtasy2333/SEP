import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnDetachedProcess } from './process-spawner';

describe('spawnDetachedProcess', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ses-spawn-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('拉起进程，stdout 追加写入日志文件（日志目录不存在时自动创建）', async () => {
    const logFile = join(dir, 'run', 'out.log');
    await spawnDetachedProcess({
      command: process.execPath,
      args: ['-e', 'console.log("hello"); console.error("oops")'],
      cwd: dir,
      logFile,
    });
    const deadline = Date.now() + 5000;
    while (
      !(existsSync(logFile) && /oops/.test(readFileSync(logFile, 'utf8')))
    ) {
      if (Date.now() > deadline) throw new Error('日志等待超时');
      await new Promise((r) => setTimeout(r, 20));
    }
    const log = readFileSync(logFile, 'utf8');
    expect(log).toContain('hello');
    expect(log).toContain('oops');
  });

  it('命令不存在：reject', async () => {
    await expect(
      spawnDetachedProcess({
        command: join(dir, 'no-such-command'),
        args: [],
        cwd: dir,
        logFile: join(dir, 'out.log'),
      }),
    ).rejects.toThrow();
  });
});
