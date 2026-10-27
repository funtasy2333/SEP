import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]

class Packages(unittest.TestCase):
    def test_runtime_archives(self):
        spec = importlib.util.spec_from_file_location('package_release', ROOT / 'scripts/package-release.py')
        self.assertTrue(Path(spec.origin).exists(), 'release packager is missing')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            for platform in ('windows', 'macos'):
                archive = module.build_archive(platform, Path(temp))
                with zipfile.ZipFile(archive) as z:
                    names = [n.split('/', 1)[1] for n in z.namelist()]
                    self.assertIn('packages/server/resources/authoring-reference.md', names)
                    self.assertIn('packages/client/src/main.ts', names)
                    self.assertIn('pnpm-lock.yaml', names)
                    self.assertFalse(any(n.startswith(('docs/', 'spike/', '.git/', 'output/')) for n in names))
                    self.assertFalse(any('node_modules/' in n or n.endswith(('.db', '.spec.ts', '.test.ts')) for n in names))
                    self.assertFalse(any('/__tests__/' in n or '/__fixtures__/' in n for n in names))
                    if platform == 'macos':
                        self.assertIn('启动SES.command', names)
                        self.assertNotIn('启动SES.cmd', names)
                        command = next(i for i in z.infolist() if i.filename.endswith('启动SES.command'))
                        self.assertEqual((command.external_attr >> 16) & 0o777, 0o755)
                    else:
                        self.assertIn('启动SES.cmd', names)
                        self.assertNotIn('启动SES.command', names)
                        self.assertIn('scripts/ses-windows.ps1', names)

if __name__ == '__main__':
    unittest.main()
