"""Tests for desktop integration assets, launcher auto-close, and Windows ses-desktop.ps1."""
import io
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PWSH = os.environ.get('SES_PWSH') or shutil.which('pwsh') or shutil.which('powershell')
WINDOWS = os.name == 'nt'


class IconsAndLaunchers(unittest.TestCase):
    def test_ico_format_and_sizes(self):
        ico_path = ROOT / 'scripts/ses.ico'
        self.assertTrue(ico_path.is_file(), 'scripts/ses.ico is missing')
        data = ico_path.read_bytes()
        self.assertGreater(len(data), 1000)
        reserved, ico_type, count = struct.unpack('<HHH', data[:6])
        self.assertEqual((reserved, ico_type), (0, 1))
        sizes = set()
        for i in range(count):
            off = 6 + i * 16
            w, h, *_ = struct.unpack('<BBBBHHII', data[off:off + 16])
            sizes.add((w or 256, h or 256))
        for expected in (16, 32, 48, 64, 128, 256):
            self.assertIn((expected, expected), sizes)

    def test_icns_format_and_chunks(self):
        icns_path = ROOT / 'scripts/ses.icns'
        self.assertTrue(icns_path.is_file(), 'scripts/ses.icns is missing')
        data = icns_path.read_bytes()
        magic, declared_len = struct.unpack('>4sI', data[:8])
        self.assertEqual(magic, b'icns')
        self.assertEqual(declared_len, len(data))
        chunks = {}
        pos = 8
        while pos < len(data):
            ostype, clen = struct.unpack('>4sI', data[pos:pos + 8])
            payload = data[pos + 8:pos + clen]
            self.assertTrue(payload.startswith(b'\x89PNG\r\n\x1a\n'), ostype)
            chunks[ostype.decode('ascii')] = payload
            pos += clen
        self.assertEqual(pos, len(data))
        self.assertEqual(set(chunks), {'ic07', 'ic08', 'ic09'})

    def test_cmd_launchers_pause_only_on_failure_and_use_crlf(self):
        for name, action in (('启动SES.cmd', 'start'), ('退出SES.cmd', 'stop')):
            path = ROOT / name
            raw = path.read_bytes()
            self.assertIn(b'\r\n', raw, f'{name} must use CRLF')
            text = raw.decode('utf-8')
            self.assertIn(f'ses-windows.ps1" {action}', text)
            self.assertIn('if not "%SES_RESULT%"=="0" if not "%SES_NO_PAUSE%"=="1" pause', text)
            self.assertIn('exit /b %SES_RESULT%', text)

    def test_command_launchers_read_only_on_failure_and_are_executable(self):
        for name, action in (('启动SES.command', 'start'), ('退出SES.command', 'stop')):
            path = ROOT / name
            raw = path.read_bytes()
            self.assertNotIn(b'\r\n', raw, f'{name} must use LF')
            text = raw.decode('utf-8')
            self.assertIn(f'ses-local.sh" {action}', text)
            self.assertIn('if [ "$result" -ne 0 ] && [ -t 0 ] && [ "${SES_NO_PAUSE:-0}" != 1 ]; then', text)
            if not WINDOWS:
                mode = path.stat().st_mode
                self.assertTrue(mode & stat.S_IXUSR, f'{name} must be executable')

    def test_powershell_scripts_are_ascii_and_use_literal_path(self):
        desktop_ps1 = ROOT / 'scripts/ses-desktop.ps1'
        raw = desktop_ps1.read_bytes()
        self.assertFalse(raw.startswith(b'\xef\xbb\xbf'))
        text = raw.decode('ascii')
        self.assertIn('UTF8Encoding($false)', text)
        self.assertIn('-LiteralPath', text)
        self.assertIn('shortcuts-initialized.json', text)
        self.assertIn('SES_NO_SHORTCUT', text)

        win_ps1 = (ROOT / 'scripts/ses-windows.ps1').read_text(encoding='ascii')
        for flag in ('[switch]$NoOpen', '[switch]$NoShortcut', '[switch]$GuiError', 'ensure-first-shortcuts'):
            self.assertIn(flag, win_ps1)


@unittest.skipUnless(WINDOWS and PWSH, 'Windows PowerShell COM shortcut tests require Windows')
class WindowsDesktopRuntime(unittest.TestCase):
    def run_desktop(self, root: Path, *args: str, env: dict[str, str]):
        script = root / 'scripts/ses-desktop.ps1'
        child_env = {**os.environ}
        child_env.pop('SES_NO_SHORTCUT', None)
        child_env.update(env)
        if 'powershell' in Path(PWSH).name.lower():
            child_env.pop('PSModulePath', None)
        return subprocess.run(
            [PWSH, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script), *args],
            capture_output=True,
            text=True,
            encoding='utf-8',
            timeout=60,
            env=child_env,
        )

    def test_windows_shortcuts_and_autostart(self):
        with tempfile.TemporaryDirectory() as base:
            base_path = Path(base)
            root = base_path / 'SES [preview] 中文'
            desktop = base_path / 'Desktop'
            start_menu = base_path / 'StartMenu'
            startup = base_path / 'Startup'
            (root / 'scripts').mkdir(parents=True)
            desktop.mkdir()
            start_menu.mkdir()
            startup.mkdir()
            shutil.copy2(ROOT / 'scripts/ses-desktop.ps1', root / 'scripts/ses-desktop.ps1')
            shutil.copy2(ROOT / 'scripts/ses.ico', root / 'scripts/ses.ico')

            env = {
                'SES_DESKTOP_DIR': str(desktop),
                'SES_START_MENU_DIR': str(start_menu),
                'SES_STARTUP_DIR': str(startup),
            }

            res = self.run_desktop(root, 'status', env=env)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(
                json.loads(res.stdout),
                {'desktopShortcut': False, 'startMenuShortcut': False, 'autoStart': False},
            )

            res = self.run_desktop(root, 'create-shortcuts', env=env)
            self.assertEqual(res.returncode, 0, res.stderr)
            created = json.loads(res.stdout)
            self.assertTrue(created['desktopShortcut'])
            self.assertTrue(created['startMenuShortcut'])
            self.assertTrue((desktop / 'SES.lnk').is_file())
            self.assertTrue((start_menu / 'SES.lnk').is_file())
            self.assertTrue((root / '.ses-run/shortcuts-initialized.json').is_file())

            res = self.run_desktop(root, 'status', env=env)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(
                json.loads(res.stdout),
                {'desktopShortcut': True, 'startMenuShortcut': True, 'autoStart': False},
            )

            # Manual deletion + marker present -> ensure-first-shortcuts does not recreate
            (desktop / 'SES.lnk').unlink()
            (start_menu / 'SES.lnk').unlink()
            res = self.run_desktop(root, 'ensure-first-shortcuts', env=env)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertFalse((desktop / 'SES.lnk').exists())

            # Remove marker -> ensure-first-shortcuts obeys SES_NO_SHORTCUT=1 then creates when unset
            (root / '.ses-run/shortcuts-initialized.json').unlink()
            res = self.run_desktop(root, 'ensure-first-shortcuts', env={**env, 'SES_NO_SHORTCUT': '1'})
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertFalse((desktop / 'SES.lnk').exists())
            res = self.run_desktop(root, 'ensure-first-shortcuts', env=env)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertTrue((desktop / 'SES.lnk').is_file())

            # Auto-start enable / disable
            res = self.run_desktop(root, 'set-autostart', 'true', env=env)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(json.loads(res.stdout), {'autoStart': True})
            self.assertTrue((startup / 'SES.lnk').is_file())

            res = self.run_desktop(root, 'set-autostart', 'false', env=env)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(json.loads(res.stdout), {'autoStart': False})
            self.assertFalse((startup / 'SES.lnk').exists())


if __name__ == '__main__':
    unittest.main()
