// 中转启动器：node run-detached.cjs <command> [args...]
//
// 为什么需要它：服务端在 Windows 上要拉起 PowerShell 执行升级脚本 / 退出脚本，而这些脚本会结束服务端自己，
// 所以必须以分离进程拉起。但 libuv 对 detached 子进程使用 DETACHED_PROCESS（没有控制台），
// PowerShell 5.1 在“无控制台 + 文件句柄重定向”下不能可靠运行（会静默不执行、日志为空）。
// “分离启动 node 进程”则已验证可靠（scripts/start-service.cjs 就是这样启动服务端的）。
//
// 因此服务端分离拉起本脚本（stdout/stderr 指向日志文件），本脚本再以“非分离”方式拉起真正的命令：
// 命令是本脚本的普通子进程，会在本脚本存活期间运行；服务端被停掉不影响本脚本。
// 本脚本把子进程的 stdout / stderr 原样转写到自己的 stdout / stderr（即日志文件），
// 并以子进程的退出码退出。仅使用 Node 内置模块。
//
// 为什么不能等 'close'：'close' 要等子进程的 stdio 管道全部关闭才触发。而被拉起的命令（例如升级脚本里的
// 启动脚本）会再拉起长期运行的服务端 / 前端进程，这些孙进程继承了管道的写端句柄，管道永远不会 EOF，
// 'close' 也就永远不触发，本脚本会无限挂起。所以改为在 'exit'（子进程自身退出）时结束：
// 再给管道最多 2 秒把剩余输出转写完，然后主动销毁管道并退出。
const { spawn } = require('node:child_process');

const [command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write('用法：node run-detached.cjs <command> [args...]\n');
  process.exit(2);
}

const stamp = () => new Date().toISOString();
process.stdout.write(`[${stamp()}] run-detached 启动：${[command, ...args].join(' ')}\n`);

const child = spawn(command, args, {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

child.once('error', (error) => {
  process.stderr.write(`[${stamp()}] run-detached 启动失败：${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});

// 以 'exit'（子进程自身退出）为准，不能无限等待 'close'：孙进程会继承管道，导致 'close' 永不触发。
// 'exit' 后最多再等 2 秒让管道里的输出转写完；期间 'close' 触发则立即结束。
let finished = false;
function finish(code, signal) {
  if (finished) return;
  finished = true;
  const exitCode = typeof code === 'number' ? code : 1;
  process.stdout.write(
    `[${stamp()}] run-detached 子进程退出：退出码 ${exitCode}${signal ? `（信号 ${signal}）` : ''}\n`,
  );
  child.stdout.destroy();
  child.stderr.destroy();
  process.exit(exitCode);
}

let exitInfo = null;
child.once('exit', (code, signal) => {
  exitInfo = { code, signal };
  setTimeout(() => finish(code, signal), 2000);
});
child.once('close', (code, signal) => {
  finish(exitInfo ? exitInfo.code : code, exitInfo ? exitInfo.signal : signal);
});
