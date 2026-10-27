"""Run actual PowerShell network fallback against a local HTTP server."""
import hashlib
import http.server
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
PWSH = os.environ.get('SES_PWSH') or shutil.which('pwsh') or 'pwsh'


class Downloads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                cls.requests.append(self.path)
                self.send_response(200 if self.path == '/ok' else 503)
                self.end_headers()
                self.wfile.write(b'SES download' if self.path == '/ok' else b'unavailable')
            def log_message(self, *args):
                pass
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def run_ps(self, command):
        script = str(ROOT / 'scripts/ses-windows.ps1').replace("'", "''")
        return subprocess.run([PWSH, '-NoProfile', '-NonInteractive', '-Command',
            f"$ErrorActionPreference='Stop'; . '{script}'; {command}"],
            capture_output=True, text=True, timeout=30)

    def test_official_success_never_contacts_mirror(self):
        self.requests.clear()
        with tempfile.TemporaryDirectory(prefix='SES 中文 ') as temp:
            target = Path(temp) / 'node.zip'
            result = self.run_ps(f"Invoke-SesDownload '{self.base}/ok' '{self.base}/mirror' '{target}'")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(target.read_bytes(), b'SES download')
            self.assertEqual(self.requests, ['/ok'])

    def test_unavailable_official_falls_back_to_mirror(self):
        self.requests.clear()
        with tempfile.TemporaryDirectory(prefix='SES 中文 ') as temp:
            target = Path(temp) / 'node.zip'
            result = self.run_ps(f"Invoke-SesDownload '{self.base}/fail' '{self.base}/ok' '{target}'")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(target.read_bytes(), b'SES download')
            self.assertEqual(self.requests, ['/fail', '/ok'])

    def test_both_unavailable_fail_without_partial_file(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / 'node.zip'
            result = self.run_ps(f"Invoke-SesDownload '{self.base}/fail' '{self.base}/fail2' '{target}'")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(target.exists())
            self.assertFalse(Path(str(target) + '.partial').exists())

    def test_checksum_rejects_corrupt_download(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / 'node.zip'
            target.write_bytes(b'SES download')
            good = hashlib.sha256(target.read_bytes()).hexdigest()
            result = self.run_ps(f"Assert-SesHash '{target}' '{good}'; Assert-SesHash '{target}' '{'0' * 64}'")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('SHA256', result.stderr)

    def test_process_ownership_uses_literal_paths_and_rejects_pid_reuse(self):
        result = self.run_ps(r"""
            $stamp = [datetime]::UtcNow
            $entry = 'C:\SES [preview] 中文\packages\server\dist\main.js'
            $state = [pscustomobject]@{pid=123; created=$stamp.Ticks.ToString(); executable='C:\node.exe'; script=$entry}
            $script:ProcessDetails = [pscustomobject]@{CreationDate=$stamp; ExecutablePath='C:\node.exe'; CommandLine=('node.exe "' + $entry + '"')}
            function Get-CimInstance { return $script:ProcessDetails }
            if (!(Test-SesOwned $state)) { throw 'Literal bracket path rejected' }
            $script:ProcessDetails.CreationDate = $stamp.AddSeconds(1)
            if (Test-SesOwned $state) { throw 'Reused PID accepted' }
        """)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_dependency_key_changes_with_node_abi(self):
        result = self.run_ps(r"""
            $script:SesNode = 'Fake-SesNode'
            $script:NodeAbi = '127'
            function Fake-SesNode { param([string]$p); if ($p -eq 'process.versions.modules') { return $script:NodeAbi }; return 'x64' }
            $before = Get-SesDependencyKey 'lockhash'
            $script:NodeAbi = '137'
            if ($before -eq (Get-SesDependencyKey 'lockhash')) { throw 'Node ABI missing from dependency key' }
        """)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unsupported_installed_node_selects_portable_runtime(self):
        result = self.run_ps("""
            foreach ($version in @('v21.7.3', 'v22.0.0', 'v22.11.0', 'v26.0.0')) {
                if (Test-SesNodeVersion $version) { throw "Unsupported Node accepted: $version" }
            }
            foreach ($version in @('v20.19.0', 'v22.12.0', 'v22.22.0', 'v24.0.0')) {
                if (!(Test-SesNodeVersion $version)) { throw "Supported Node rejected: $version" }
            }
        """)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_version_floor(self):
        result = self.run_ps("if ((Test-SesVersion 'v20.18.9' '20.19.0') -or !(Test-SesVersion 'v20.19.0' '20.19.0') -or (Test-SesVersion 'invalid' '20.19.0')) { throw 'version floor' }")
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
