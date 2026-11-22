import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertPortAvailable,
  formatExpectedReadyLine,
  waitForChildServerReady,
} from './wp85ListenerGuard.mjs'

const LOOPBACK_HOST = '127.0.0.1'

async function startMockEmptyDocsServer(): Promise<{
  server: Server
  port: number
  requests: Array<{ method: string; url: string }>
}> {
  const requests: Array<{ method: string; url: string }> = []
  const server = createServer((req, res) => {
    requests.push({ method: req.method || 'GET', url: req.url || '/' })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('[]')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const addr = server.address() as AddressInfo
  return { server, port: addr.port, requests }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

async function allocateFreePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, LOOPBACK_HOST, () => {
      probe.off('error', reject)
      resolve()
    })
  })
  const port = (probe.address() as AddressInfo).port
  await closeServer(probe)
  return port
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }, 3000)
  await exited
  clearTimeout(timer)
}

describe('wp85ListenerGuard', () => {
  const trackedServers: Server[] = []
  const trackedChildren: ChildProcess[] = []
  const trackedDirs: string[] = []

  afterEach(async () => {
    while (trackedChildren.length > 0) {
      const child = trackedChildren.pop()
      if (child) await stopChild(child)
    }
    while (trackedServers.length > 0) {
      const server = trackedServers.pop()
      if (server) await closeServer(server)
    }
    while (trackedDirs.length > 0) {
      const dir = trackedDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('场景 1：端口已被占用时 assertPortAvailable 立即报错拒绝，释放后校验通过', async () => {
    const { server, port } = await startMockEmptyDocsServer()
    trackedServers.push(server)

    await expect(assertPortAvailable(LOOPBACK_HOST, port)).rejects.toThrow(/端口已被占用|EADDRINUSE/)

    await closeServer(server)
    await expect(assertPortAvailable(LOOPBACK_HOST, port)).resolves.toEqual({
      host: LOOPBACK_HOST,
      port,
    })
  })

  it('场景 2：端口上存在返回 [] 的无关服务且子进程绑定冲突退出时，waitForChildServerReady 明确拒绝且不误连', async () => {
    const { server, port, requests } = await startMockEmptyDocsServer()
    trackedServers.push(server)

    // 模拟真实 SES 后端在端口冲突时无法 listen 并以非零退出码退出（绝不会打印 ready line）
    const conflictChildScript = `
      import { createServer } from 'node:http';
      const srv = createServer((_req, res) => { res.end('[]'); });
      srv.on('error', (err) => {
        console.error('Failed to bind:', err.code || err.message);
        process.exit(1);
      });
      srv.listen(${port}, '${LOOPBACK_HOST}', () => {
        console.log('${formatExpectedReadyLine(LOOPBACK_HOST, port)}');
      });
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', conflictChildScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    trackedChildren.push(child)

    await expect(
      waitForChildServerReady(child, {
        host: LOOPBACK_HOST,
        port,
        healthUrl: `http://${LOOPBACK_HOST}:${port}/api/documents`,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/在输出就绪日志 .* 前已退出.*exitCode=1/)

    // 确认在子进程未打印就绪日志前从未向无关服务发起任何 HTTP 请求
    expect(requests).toEqual([])
  })

  it('场景 3：子进程中途静默退出（未输出 ready line）时 waitForChildServerReady 立即拒绝', async () => {
    const port = await allocateFreePort()
    const silentExitScript = `
      console.log('booting isolated server...');
      setTimeout(() => {
        console.error('unexpected crash before listen');
        process.exit(2);
      }, 30);
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', silentExitScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    trackedChildren.push(child)

    await expect(
      waitForChildServerReady(child, {
        host: LOOPBACK_HOST,
        port,
        healthUrl: `http://${LOOPBACK_HOST}:${port}/api/documents`,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/在输出就绪日志 .* 前已退出.*exitCode=2[\s\S]*unexpected crash before listen/)
  })

  it('场景 4：空端口经 assertPortAvailable 放行后，子进程真实绑定端口、初始化隔离 DB 并输出就绪日志时校验通过', async () => {
    const port = await allocateFreePort()
    await expect(assertPortAvailable(LOOPBACK_HOST, port)).resolves.toEqual({
      host: LOOPBACK_HOST,
      port,
    })

    const runDir = mkdtempSync(join(tmpdir(), 'wp85-listener-guard-'))
    trackedDirs.push(runDir)
    const dbDir = join(runDir, 'data')
    const dbPath = join(dbDir, 'ses.db')

    const realChildScript = `
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { createServer } from 'node:http';
      mkdirSync(process.env.TEST_DB_DIR, { recursive: true });
      writeFileSync(process.env.TEST_DB_PATH, 'isolated-sqlite-header', 'utf8');
      const srv = createServer((req, res) => {
        if (req.url === '/api/documents') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
          return;
        }
        res.writeHead(404);
        res.end();
      });
      srv.listen(Number(process.env.TEST_PORT), '${LOOPBACK_HOST}', () => {
        console.log('SES Server running on http://${LOOPBACK_HOST}:' + process.env.TEST_PORT);
      });
      process.on('SIGTERM', () => srv.close(() => process.exit(0)));
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', realChildScript], {
      env: {
        ...process.env,
        TEST_DB_DIR: dbDir,
        TEST_DB_PATH: dbPath,
        TEST_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    trackedChildren.push(child)

    const result = await waitForChildServerReady(child, {
      host: LOOPBACK_HOST,
      port,
      healthUrl: `http://${LOOPBACK_HOST}:${port}/api/documents`,
      expectedDbPath: dbPath,
      timeoutMs: 10000,
    })

    expect(result).toEqual({
      readyLine: `SES Server running on http://${LOOPBACK_HOST}:${port}`,
      status: 200,
      dbPath,
    })
    expect(child.exitCode).toBeNull()
  })
})
