import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
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
                    self.assertIn('scripts/apply-update.cjs', names)
                    self.assertIn('ses-build.json', names)
                    self.assertIn('使用说明.md', names)
                    info = json.loads(z.read(f'SES-{module.VERSION}-{platform}/ses-build.json').decode('utf-8'))
                    self.assertEqual(set(info), {'version', 'channel', 'commit', 'builtAt'})
                    self.assertEqual((info['version'], info['channel']), (module.VERSION, 'stable'))
                    self.assertTrue(info['commit'] is None or len(info['commit']) == 40)
                    guide = z.read(f'SES-{module.VERSION}-{platform}/使用说明.md').decode('utf-8')
                    for text in ('设置 → 升级 / 退出', '关闭网页不会退出 SES', '稳定版', '每次提交', 'output/upgrade-backups/', '不支持降级'):
                        self.assertIn(text, guide)
                    if platform == 'macos':
                        self.assertIn('启动SES.command', names)
                        self.assertNotIn('启动SES.cmd', names)
                        self.assertIn('scripts/ses-upgrade.sh', names)
                        self.assertNotIn('scripts/ses-upgrade.ps1', names)
                        upgrade = next(i for i in z.infolist() if i.filename.endswith('scripts/ses-upgrade.sh'))
                        self.assertEqual((upgrade.external_attr >> 16) & 0o777, 0o755)
                        command = next(i for i in z.infolist() if i.filename.endswith('启动SES.command'))
                        self.assertEqual((command.external_attr >> 16) & 0o777, 0o755)
                    else:
                        self.assertIn('启动SES.cmd', names)
                        self.assertNotIn('启动SES.command', names)
                        self.assertIn('scripts/ses-windows.ps1', names)
                        self.assertIn('scripts/ses-upgrade.ps1', names)
                        self.assertNotIn('scripts/ses-upgrade.sh', names)

    def test_version_override_and_commit(self):
        spec = importlib.util.spec_from_file_location('package_release', ROOT / 'scripts/package-release.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            archive = module.build_archive('macos', Path(temp), '9.9.9-preview', 'a' * 40)
            self.assertEqual(archive.name, 'SES-9.9.9-preview-macos.zip')
            with zipfile.ZipFile(archive) as z:
                info = json.loads(z.read('SES-9.9.9-preview-macos/ses-build.json').decode('utf-8'))
                self.assertEqual((info['version'], info['channel'], info['commit']), ('9.9.9-preview', 'stable', 'a' * 40))
                self.assertIn('SES 9.9.9 Preview', z.read('SES-9.9.9-preview-macos/使用说明.md').decode('utf-8'))
        # command line: --version overrides, --print-version reflects it; GITHUB_SHA wins over the checkout.
        script = str(ROOT / 'scripts/package-release.py')
        env = {**os.environ, 'GITHUB_SHA': 'b' * 40}
        printed = subprocess.run([sys.executable, script, '--version', '9.9.9-preview', '--print-version'], capture_output=True, text=True, check=True)
        self.assertEqual(printed.stdout.strip(), '9.9.9-preview')
        with tempfile.TemporaryDirectory() as temp:
            subprocess.run([sys.executable, script, '--version', '9.9.9-preview', '--output', temp], capture_output=True, text=True, check=True, env=env)
            self.assertEqual(sorted(p.name for p in Path(temp).iterdir()), ['SES-9.9.9-preview-macos.zip', 'SES-9.9.9-preview-windows.zip'])
            with zipfile.ZipFile(Path(temp) / 'SES-9.9.9-preview-windows.zip') as z:
                self.assertEqual(json.loads(z.read('SES-9.9.9-preview-windows/ses-build.json'))['commit'], 'b' * 40)

if __name__ == '__main__':
    unittest.main()
