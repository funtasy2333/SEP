"""Verify detached services in literal paths, including brackets and non-ASCII."""
from pathlib import Path
import json
import os
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Spawn(unittest.TestCase):
    def test_detached_child_survives_launcher_and_writes_logs(self):
        with tempfile.TemporaryDirectory(prefix='SES [preview] 中文 ') as temp:
            root = Path(temp)
            child = root / 'service.cjs'
            child.write_text("console.log(JSON.stringify({cwd:process.cwd()})); console.error('service stderr'); setTimeout(()=>console.log('still alive'),200); setInterval(()=>{},1000);", encoding='utf-8')
            result = subprocess.run(['node', str(ROOT / 'scripts/start-service.cjs'),
                str(root), str(root/'out.log'), str(root/'error.log'), str(child)],
                capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            pid = int(result.stdout.strip())
            try:
                for _ in range(50):
                    if (root/'out.log').exists() and 'still alive' in (root/'out.log').read_text(encoding='utf-8'):
                        break
                    time.sleep(.1)
                self.assertEqual(Path(json.loads((root/'out.log').read_text(encoding='utf-8').splitlines()[0])['cwd']), root)
                self.assertIn('service stderr', (root/'error.log').read_text(encoding='utf-8'))
                self.assertIn('still alive', (root/'out.log').read_text(encoding='utf-8'))
            finally:
                os.kill(pid, signal.SIGTERM)
                time.sleep(.2)


class RunDetached(unittest.TestCase):
    def test_relays_child_output_and_exit_code_to_log_when_launched_detached(self):
        # 与服务端 spawnDetachedProcess 相同的拉起参数：detached、windowsHide、stdio 指向日志文件。
        with tempfile.TemporaryDirectory(prefix='SES [preview] 中文 ') as temp:
            root = Path(temp)
            log = root / 'run' / 'detached.log'
            log.parent.mkdir()
            if os.name == 'nt':
                command = ['powershell.exe', '-NoLogo', '-NoProfile', '-Command',
                           "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output 'child out 中文'; "
                           "[Console]::Error.WriteLine('child err'); exit 7"]
            else:
                command = ['node', '-e',
                           "console.log('child out 中文'); console.error('child err'); process.exit(7)"]
            launcher = root / 'launch.cjs'
            launcher.write_text(
                "const fs=require('node:fs');const {spawn}=require('node:child_process');"
                "const [log,relay,...cmd]=process.argv.slice(2);const fd=fs.openSync(log,'a');"
                "const child=spawn(process.execPath,[relay,...cmd],{cwd:process.cwd(),detached:true,windowsHide:true,stdio:['ignore',fd,fd]});"
                "child.once('error',e=>{console.error(e);process.exitCode=1});"
                "child.once('spawn',()=>{console.log(child.pid);child.unref();fs.closeSync(fd)});",
                encoding='utf-8')
            result = subprocess.run(['node', str(launcher), str(log), str(ROOT / 'scripts/run-detached.cjs'), *command],
                                    capture_output=True, text=True, timeout=10, cwd=root)
            self.assertEqual(result.returncode, 0, result.stderr)
            deadline = time.time() + 30
            text = ''
            while time.time() < deadline:
                text = log.read_text(encoding='utf-8', errors='replace') if log.exists() else ''
                if '退出码 7' in text:
                    break
                time.sleep(.1)
            self.assertIn('run-detached 启动：', text)
            self.assertIn('child out 中文', text)
            self.assertIn('child err', text)
            self.assertIn('子进程退出：退出码 7', text)

    def test_exits_when_child_exits_even_if_a_long_running_grandchild_holds_the_pipes(self):
        # 子命令拉起一个继承 stdout/stderr 的长期运行孙进程后立即退出：管道永远不会 EOF，
        # run-detached 不能再等 'close'，必须在子进程退出后几秒内结束。
        with tempfile.TemporaryDirectory(prefix='SES [preview] 中文 ') as temp:
            root = Path(temp)
            pid_file = root / 'grandchild.pid'
            script = root / 'parent.cjs'
            script.write_text(
                "const fs=require('node:fs');const {spawn}=require('node:child_process');"
                "const g=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{detached:true,stdio:'inherit',windowsHide:true});"
                "fs.writeFileSync(process.argv[2],String(g.pid));g.unref();console.log('parent done');",
                encoding='utf-8')
            started = time.time()
            try:
                result = subprocess.run(['node', str(ROOT / 'scripts/run-detached.cjs'), 'node', str(script), str(pid_file)],
                                        capture_output=True, text=True, timeout=10, cwd=root)
            except subprocess.TimeoutExpired as error:
                self.fail(f'run-detached hung on the inherited pipes: {error}')
            finally:
                if pid_file.exists():
                    try:
                        os.kill(int(pid_file.read_text()), signal.SIGTERM)
                    except OSError:
                        pass
            self.assertLess(time.time() - started, 10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('parent done', result.stdout)
            self.assertIn('子进程退出：退出码 0', result.stdout)

    def test_reports_spawn_failure_and_exits_nonzero(self):
        result = subprocess.run(['node', str(ROOT / 'scripts/run-detached.cjs'), 'ses-no-such-command-xyz'],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('启动失败', result.stderr)


if __name__ == '__main__':
    unittest.main()
