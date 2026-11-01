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

// 用 'close'（而不是 'exit'）保证管道里的输出都已转写完再退出。
child.once('close', (code, signal) => {
  const exitCode = typeof code === 'number' ? code : 1;
  process.stdout.write(
    `[${stamp()}] run-detached 子进程退出：退出码 ${exitCode}${signal ? `（信号 ${signal}）` : ''}\n`,
  );
  process.exitCode = exitCode;
});
