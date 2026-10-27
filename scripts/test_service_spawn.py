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

if __name__ == '__main__':
    unittest.main()
