"""ses-upgrade.ps1 / ses-windows.ps1 launcher checks.

Static checks run anywhere. The PowerShell runtime checks need Windows PowerShell 5.1 or pwsh
(CI runs them on windows-latest with SES_PWSH=powershell.exe); they are skipped when neither exists.
"""
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PWSH = os.environ.get('SES_PWSH') or shutil.which('pwsh') or shutil.which('powershell')
NODE = shutil.which('node') or 'node'
UPGRADE = ROOT / 'scripts/ses-upgrade.ps1'
LAUNCHER = ROOT / 'scripts/ses-windows.ps1'


class Static(unittest.TestCase):
    def test_upgrade_script_is_ascii_so_powershell_51_reads_it_correctly(self):
        for script in (UPGRADE, LAUNCHER):
            raw = script.read_bytes()
            self.assertFalse(raw.startswith(b'\xef\xbb\xbf'), script.name)
            raw.decode('ascii')

    def test_upgrade_script_follows_the_executor_contract(self):
        text = UPGRADE.read_text(encoding='ascii')
        for needle in ('[Parameter(Mandatory = $true)][string]$Root', 'plan.json', 'apply-update.cjs', "'backup-db'", "'apply'",
                       "'rollback'", "'restore-db'", "'finalize'", 'ExtractToDirectory', 'Select-SesApplier', 'apply-update.next.cjs', '--check', "'stopping'", "'backing-up'", "'extracting'",
                       "'applying'", "'starting'", "'rolling-back'", "'rolled-back'", "'succeeded'", "'failed'",
                       'SES_NO_OPEN', 'SES_NO_PAUSE', 'SES_UPGRADE_STOP_CMD', 'SES_UPGRADE_START_CMD', "'lock'", 'ses-windows.ps1'):
            self.assertIn(needle, text)
        # The lock must be released in a finally block no matter how the upgrade ends.
        self.assertRegex(text, r"finally\s*\{[^}]*'lock'")

    def test_install_root_with_brackets_is_never_treated_as_a_wildcard(self):
        """Roots such as 'SES [preview] 中文' must be handled literally (Expand-Archive and -Path do not)."""
        text = UPGRADE.read_text(encoding='ascii')
        code = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))
        self.assertNotIn('Expand-Archive', code)
        self.assertNotIn('New-Item', code)
        for match in re.finditer(r'(?<![A-Za-z])-Path\b', code):
            self.fail(f'-Path used instead of -LiteralPath: {code[match.start():match.start() + 60]!r}')
        # apply/rollback prefer the apply-update.cjs from the package; the other commands use the installed copy.
        self.assertIn("Invoke-SesApplier @('apply'", text)
        self.assertIn("Invoke-SesApplier @('rollback'", text)
        self.assertIn("Invoke-SesApply @('backup-db'", text)

    def test_launcher_marks_the_server_as_started_by_the_windows_launcher(self):
        text = LAUNCHER.read_text(encoding='ascii')
        self.assertIn("$env:SES_LAUNCHER = 'windows'", text)
        # Saved and restored around the server start, like PORT.
        self.assertIn('$savedLauncher = $env:SES_LAUNCHER', text)
        self.assertIn('$env:SES_LAUNCHER = $savedLauncher', text)
        # The client (vite) must not be started with the flag.
        self.assertEqual(text.count("SES_LAUNCHER"), 3)

    def test_macos_launcher_marks_the_server(self):
        text = (ROOT / 'scripts/ses-local.sh').read_text(encoding='utf-8')
        self.assertRegex(text, r'exec env PORT=3000 SES_LISTEN_HOST=127\.0\.0\.1 SES_LAUNCHER=macos "\$2" dist/main\.js')
        self.assertEqual(text.count('SES_LAUNCHER'), 1)


@unittest.skipUnless(PWSH, 'PowerShell is not available')
class Runtime(unittest.TestCase):
    def powershell(self, *args, env=None, timeout=180):
        return subprocess.run([PWSH, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', *args],
                              capture_output=True, text=True, timeout=timeout, env={**os.environ, **(env or {})})

    def test_scripts_parse(self):
        for script in (UPGRADE, LAUNCHER):
            path = str(script).replace("'", "''")
            result = self.powershell('-Command', f"$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('{path}',[ref]$t,[ref]$e); if($e.Count){{$e|Out-String|Write-Error; exit 1}}")
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def install(self, base):
        root = Path(base) / 'SES [upgrade] 中文'
        for name, text in {
            'packages/server/src/main.ts': 'old', 'packages/server/src/stale.ts': 'stale', 'scripts/ses-windows.ps1': '# old launcher',
            '.env': 'SECRET=1', 'packages/server/data/ses.db': 'the user documents',
            'ses-build.json': json.dumps({'version': '0.1.1-preview', 'channel': 'stable', 'commit': None, 'builtAt': 'x'}),
        }.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text(text, encoding='utf-8')
        upd = root / '.ses-update'
        (upd / 'lock').mkdir(parents=True)
        shutil.copy(ROOT / 'scripts/apply-update.cjs', upd)
        shutil.copy(UPGRADE, upd)
        with zipfile.ZipFile(upd / 'download.zip', 'w') as z:
            top = 'SES-9.9.9-preview-windows/'
            z.writestr(top + 'ses-build.json', json.dumps({'version': '9.9.9-preview', 'channel': 'stable', 'commit': None, 'builtAt': 'x'}))
            z.writestr(top + 'scripts/ses-windows.ps1', '# new launcher')
            z.writestr(top + 'packages/server/src/main.ts', 'new')
        (upd / 'plan.json').write_text(json.dumps({
            'zip': str(upd / 'download.zip'), 'channel': 'stable', 'targetVersion': '9.9.9-preview', 'targetCommit': None,
            'fromVersion': '0.1.1-preview', 'fromCommit': None, 'node': NODE, 'platform': 'windows', 'requestedAt': '2026-11-01T00:00:00.000Z',
        }), encoding='utf-8')
        return root

    def run_upgrade(self, root, start_command):
        stop = "Add-Content -LiteralPath (Join-Path $env:SES_UPGRADE_ROOT 'calls.log') 'stop'"
        return self.powershell('-File', str(root / '.ses-update/ses-upgrade.ps1'), '-Root', str(root),
                               env={'SES_UPGRADE_STOP_CMD': stop, 'SES_UPGRADE_START_CMD': start_command})

    def status(self, root):
        return json.loads((root / '.ses-run/upgrade-status.json').read_text(encoding='utf-8-sig'))

    def test_successful_upgrade(self):
        with tempfile.TemporaryDirectory() as base:
            root = self.install(base)
            start = "Add-Content -LiteralPath (Join-Path $env:SES_UPGRADE_ROOT 'calls.log') 'start'"
            result = self.run_upgrade(root, start)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            status = self.status(root)
            self.assertEqual((status['state'], status['step']), ('succeeded', 'done'))
            self.assertEqual(json.loads((root / 'ses-build.json').read_text(encoding='utf-8'))['version'], '9.9.9-preview')
            self.assertEqual((root / 'packages/server/src/main.ts').read_text(encoding='utf-8'), 'new')
            self.assertFalse((root / 'packages/server/src/stale.ts').exists())
            self.assertEqual((root / 'packages/server/data/ses.db').read_text(encoding='utf-8'), 'the user documents')
            self.assertFalse((root / '.ses-update/lock').exists())

    def test_failed_start_rolls_back_and_restarts_the_old_version(self):
        with tempfile.TemporaryDirectory() as base:
            root = self.install(base)
            start = ("$main = Join-Path $env:SES_UPGRADE_ROOT 'packages/server/src/main.ts'; "
                     "if ((Get-Content -LiteralPath $main -Raw) -eq 'new') { "
                     "Set-Content -LiteralPath (Join-Path $env:SES_UPGRADE_ROOT 'packages/server/data/ses.db') 'corrupted'; exit 1 } "
                     "else { Add-Content -LiteralPath (Join-Path $env:SES_UPGRADE_ROOT 'calls.log') 'start-old' }")
            result = self.run_upgrade(root, start)
            self.assertNotEqual(result.returncode, 0)
            status = self.status(root)
            self.assertEqual((status['state'], status['step']), ('rolled-back', 'done'))
            self.assertEqual(json.loads((root / 'ses-build.json').read_text(encoding='utf-8'))['version'], '0.1.1-preview')
            self.assertEqual((root / 'packages/server/src/main.ts').read_text(encoding='utf-8'), 'old')
            self.assertTrue((root / 'packages/server/src/stale.ts').exists())
            self.assertEqual((root / 'packages/server/data/ses.db').read_text(encoding='utf-8'), 'the user documents')
            self.assertIn('start-old', (root / 'calls.log').read_text(encoding='utf-8'))
            self.assertFalse((root / '.ses-update/lock').exists())


if __name__ == '__main__':
    unittest.main()
