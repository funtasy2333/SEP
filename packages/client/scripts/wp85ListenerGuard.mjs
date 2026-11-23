import { existsSync } from 'node:fs'
import { createServer, isIP } from 'node:net'

const MAX_CAPTURED_LOG_CHARS = 8192

export function formatExpectedReadyLine(host, port) {
  const formattedHost = isIP(host) === 6 ? `[${host}]` : host
  return `SES Server running on http://${formattedHost}:${port}`
}

function appendCapturedLog(current, chunk) {
  const next = current + chunk
  if (next.length <= MAX_CAPTURED_LOG_CHARS) return next
  return next.slice(next.length - MAX_CAPTURED_LOG_CHARS)
}

function isChildAlive(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null && !child.killed
}

function formatChildDiagnostics(child, capturedStdout, capturedStderr) {
  const parts = []
  const stdoutText = capturedStdout.trim()
  const stderrText = capturedStderr.trim()
  if (stdoutText) parts.push(`stdout:\n${stdoutText}`)
  if (stderrText) parts.push(`stderr:\n${stderrText}`)
  if (parts.length === 0 && typeof child?.getLogs === 'function') {
    const fallback = String(child.getLogs() || '').trim()
    if (fallback) parts.push(`logs:\n${fallback.slice(-MAX_CAPTURED_LOG_CHARS)}`)
  }
  return parts.length > 0 ? parts.join('\n') : '(无输出日志)'
}

/**
 * 在启动隔离服务前校验指定 host:port 当前未被占用：
 * 使用 node:net 尝试独占绑定（exclusive: true），若端口已被占用立即抛错拒绝，
 * 绑定成功后立即关闭释放端口再返回。
 */
export async function assertPortAvailable(host, port) {
  if (typeof host !== 'string' || host.trim() === '') {
    throw new Error('端口可用性校验缺少有效的 host 参数')
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`端口可用性校验收到非法端口号：${port}`)
  }

  return new Promise((resolve, reject) => {
    const probeServer = createServer()
    let settled = false

    const finishError = (err) => {
      if (settled) return
      settled = true
      probeServer.removeAllListeners()
      const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
      const detail = code ? `${code}: ${err.message}` : String(err?.message || err)
      reject(new Error(`端口已被占用或不可绑定：${host}:${port}（${detail}）`))
    }

    probeServer.once('error', finishError)
    probeServer.once('listening', () => {
      probeServer.close((closeErr) => {
        if (settled) return
        settled = true
        probeServer.removeAllListeners()
        if (closeErr) {
          reject(new Error(`端口可用性探测关闭失败：${host}:${port}（${closeErr.message}）`))
          return
        }
        resolve({ host, port })
      })
    })

    try {
      probeServer.listen({ host, port, exclusive: true })
    } catch (err) {
      finishError(err)
    }
  })
}

/**
 * 等待由当前脚本派生的隔离后端子进程真实绑定端口并就绪：
 * 1. 仅信任该子进程自身 stdout 输出的精确 readyLine；若子进程在输出前退出或出错，立即拒绝
 *    （即使同一端口上存在另一个返回 [] 的无关服务，也绝不会误连）；
 * 2. 收到 readyLine 后验证子进程仍存活，再执行 healthUrl HTTP 探测（循环与请求期间持续监控子进程存活）；
 * 3. 若提供 expectedDbPath，额外校验独立 SQLite 文件已在预期隔离目录下初始化，再放行写入请求。
 */
export async function waitForChildServerReady(child, options = {}) {
  const {
    host = '127.0.0.1',
    port,
    healthUrl,
    expectedDbPath,
    timeoutMs = 20000,
    readyLine = formatExpectedReadyLine(host, port),
  } = options

  if (!child || typeof child.on !== 'function') {
    throw new Error('waitForChildServerReady 缺少有效的子进程对象')
  }
  if (typeof healthUrl !== 'string' || healthUrl.trim() === '') {
    throw new Error('waitForChildServerReady 缺少有效的 healthUrl 参数')
  }
  if (typeof readyLine !== 'string' || readyLine.trim() === '') {
    throw new Error('waitForChildServerReady 缺少有效的 readyLine 参数')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`waitForChildServerReady 收到非法 timeoutMs：${timeoutMs}`)
  }

  let capturedStdout = ''
  let capturedStderr = ''
  let exitReason = null
  let childError = null

  if (!isChildAlive(child)) {
    throw new Error(
      `隔离后端子进程在等待就绪前已退出（exitCode=${child.exitCode}, signalCode=${child.signalCode}, killed=${child.killed}），拒绝连接 ${healthUrl}\n${formatChildDiagnostics(child, capturedStdout, capturedStderr)}`,
    )
  }

  if (!child.stdout) {
    throw new Error(`隔离后端子进程缺少 stdout 流，无法校验监听就绪日志（${readyLine}）`)
  }

  const deadline = Date.now() + timeoutMs
  let activeFetchController = null
  let wakeSleep = null
  let readyCallback = null
  let pendingStdoutLine = ''

  const onStdoutData = (chunk) => {
    const text = chunk.toString('utf8')
    capturedStdout = appendCapturedLog(capturedStdout, text)
    if (!readyCallback) return
    pendingStdoutLine += text
    const lines = pendingStdoutLine.split(/\r?\n/)
    pendingStdoutLine = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === readyLine) {
        const cb = readyCallback
        readyCallback = null
        cb()
        return
      }
    }
  }

  const onStderrData = (chunk) => {
    capturedStderr = appendCapturedLog(capturedStderr, chunk.toString('utf8'))
  }

  const onExitCapture = (code, signal) => {
    exitReason = `exitCode=${code}, signal=${signal}`
    if (activeFetchController) activeFetchController.abort()
    if (wakeSleep) wakeSleep()
  }

  const onErrorCapture = (err) => {
    childError = err
    if (activeFetchController) activeFetchController.abort()
    if (wakeSleep) wakeSleep()
  }

  child.stdout.on('data', onStdoutData)
  if (child.stderr) {
    child.stderr.on('data', onStderrData)
  }
  child.on('exit', onExitCapture)
  child.on('error', onErrorCapture)

  try {
    // 阶段 1：等待此子进程自身 stdout 输出精确的 readyLine
    await new Promise((resolveReady, rejectReady) => {
      let settled = false

      const cleanupPhase1 = () => {
        clearTimeout(timer)
        readyCallback = null
        child.off('exit', onExitPhase1)
        child.off('error', onErrorPhase1)
      }

      const fail = (message) => {
        if (settled) return
        settled = true
        cleanupPhase1()
        rejectReady(new Error(`${message}\n${formatChildDiagnostics(child, capturedStdout, capturedStderr)}`))
      }

      const succeed = () => {
        if (settled) return
        settled = true
        cleanupPhase1()
        resolveReady()
      }

      const onExitPhase1 = (code, signal) => {
        fail(`隔离后端子进程在输出就绪日志 "${readyLine}" 前已退出（exitCode=${code}, signal=${signal}），拒绝连接 ${healthUrl}`)
      }

      const onErrorPhase1 = (err) => {
        fail(`隔离后端子进程启动出错（${err?.message || err}），拒绝连接 ${healthUrl}`)
      }

      readyCallback = succeed

      const remainingMs = Math.max(1, deadline - Date.now())
      const timer = setTimeout(() => {
        fail(`等待隔离后端子进程输出就绪日志 "${readyLine}" 超时（${timeoutMs}ms）`)
      }, remainingMs)

      child.once('exit', onExitPhase1)
      child.once('error', onErrorPhase1)

      if (childError) {
        onErrorPhase1(childError)
      } else if (exitReason || !isChildAlive(child)) {
        onExitPhase1(child.exitCode, child.signalCode)
      }
    })

    // 阶段 2：再次确认子进程存活，执行 HTTP 健康检查与独立 SQLite 文件校验
    const assertStillAlive = () => {
      if (childError) {
        throw new Error(
          `隔离后端子进程运行出错（${childError?.message || childError}），中止健康检查 ${healthUrl}\n${formatChildDiagnostics(child, capturedStdout, capturedStderr)}`,
        )
      }
      if (exitReason || !isChildAlive(child)) {
        throw new Error(
          `隔离后端子进程在就绪健康检查期间已退出（${exitReason || `exitCode=${child.exitCode}, signalCode=${child.signalCode}, killed=${child.killed}`}），拒绝连接 ${healthUrl}\n${formatChildDiagnostics(child, capturedStdout, capturedStderr)}`,
        )
      }
    }

    assertStillAlive()

    let lastProbeError = null
    let lastHttpStatus = null
    let missingDbObserved = false

    while (Date.now() < deadline) {
      assertStillAlive()
      const remainingMs = Math.max(1, deadline - Date.now())
      const controller = new AbortController()
      activeFetchController = controller
      const fetchTimeout = setTimeout(() => controller.abort(), Math.min(remainingMs, 5000))

      try {
        const res = await fetch(healthUrl, { signal: controller.signal })
        clearTimeout(fetchTimeout)
        activeFetchController = null
        const status = res.status
        const ok = res.ok
        await res.body?.cancel().catch(() => {})
        assertStillAlive()

        lastHttpStatus = status
        if (ok || status < 500) {
          if (expectedDbPath && !existsSync(expectedDbPath)) {
            missingDbObserved = true
          } else {
            return {
              readyLine,
              status,
              dbPath: expectedDbPath ?? null,
            }
          }
        }
      } catch (err) {
        clearTimeout(fetchTimeout)
        activeFetchController = null
        assertStillAlive()
        lastProbeError = err
      }

      const sleepMs = Math.min(200, Math.max(0, deadline - Date.now()))
      if (sleepMs <= 0) break
      await new Promise((resolveSleep) => {
        const sleepTimer = setTimeout(() => {
          wakeSleep = null
          resolveSleep()
        }, sleepMs)
        wakeSleep = () => {
          clearTimeout(sleepTimer)
          wakeSleep = null
          resolveSleep()
        }
      })
    }

    assertStillAlive()

    if (missingDbObserved && expectedDbPath && !existsSync(expectedDbPath)) {
      throw new Error(
        `隔离后端子进程已响应 ${healthUrl}（HTTP ${lastHttpStatus}），但预期独立 SQLite 文件不存在：${expectedDbPath}\n${formatChildDiagnostics(child, capturedStdout, capturedStderr)}`,
      )
    }

    const detail = lastProbeError
      ? `最后错误：${lastProbeError?.message || lastProbeError}`
      : lastHttpStatus !== null
        ? `最后状态码：HTTP ${lastHttpStatus}`
        : '未获得有效 HTTP 响应'
    throw new Error(
      `等待隔离后端健康检查就绪超时（${timeoutMs}ms，${healthUrl}，${detail}）\n${formatChildDiagnostics(child, capturedStdout, capturedStderr)}`,
    )
  } finally {
    readyCallback = null
    activeFetchController = null
    wakeSleep = null
    child.stdout.off('data', onStdoutData)
    if (child.stderr) {
      child.stderr.off('data', onStderrData)
    }
    child.off('exit', onExitCapture)
    child.off('error', onErrorCapture)
  }
}

/**
 * 安全停止子进程：
 * - 若子进程为空、已按退出码或信号退出、或尚未分配 pid，立即返回；
 * - 发送 SIGTERM 并在 sigkillAfterMs 后自动升级为 SIGKILL（每次 kill 前复查状态并捕获并发退出错误）；
 * - 同时监听 exit / error 事件并设置 hardTimeoutMs 有界兜底超时，杜绝 finally 阶段永久挂起；
 * - 在 finally 中彻底清理监听器与定时器。
 */
export async function stopChildProcess(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return
  }

  const {
    sigkillAfterMs = 5000,
    hardTimeoutMs = Math.max(10000, sigkillAfterMs + 5000),
  } = options ?? {}

  const effectiveSigkillAfterMs =
    Number.isFinite(sigkillAfterMs) && sigkillAfterMs >= 0 ? sigkillAfterMs : 5000
  const effectiveHardTimeoutMs =
    Number.isFinite(hardTimeoutMs) && hardTimeoutMs > 0
      ? hardTimeoutMs
      : Math.max(10000, effectiveSigkillAfterMs + 5000)

  const isTerminated = () => child.exitCode !== null || child.signalCode !== null

  let sigkillTimer = null
  let hardTimer = null
  let onDone = null

  try {
    await new Promise((resolve) => {
      let settled = false
      onDone = () => {
        if (settled) return
        settled = true
        resolve()
      }

      child.once('exit', onDone)
      child.once('error', onDone)

      if (isTerminated()) {
        onDone()
        return
      }

      try {
        if (!isTerminated()) {
          child.kill('SIGTERM')
        }
      } catch {
        if (isTerminated()) {
          onDone()
          return
        }
      }

      if (isTerminated()) {
        onDone()
        return
      }

      sigkillTimer = setTimeout(() => {
        if (isTerminated()) {
          onDone()
          return
        }
        try {
          if (!isTerminated()) {
            child.kill('SIGKILL')
          }
        } catch {
          if (isTerminated()) {
            onDone()
          }
        }
      }, effectiveSigkillAfterMs)

      hardTimer = setTimeout(() => {
        onDone()
      }, effectiveHardTimeoutMs)
    })
  } finally {
    if (sigkillTimer !== null) clearTimeout(sigkillTimer)
    if (hardTimer !== null) clearTimeout(hardTimer)
    if (onDone) {
      child.off('exit', onDone)
      child.off('error', onDone)
    }
  }
}
