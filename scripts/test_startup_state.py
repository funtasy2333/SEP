"""Tests for scripts/build-state.cjs and scripts/backup-db.cjs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILD_STATE = ROOT / 'scripts/build-state.cjs'
BACKUP_DB = ROOT / 'scripts/backup-db.cjs'
NODE = os.environ.get('SES_NODE') or shutil.which('node') or 'node'


def write(path, content=b'x'):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content if isinstance(content, bytes) else content.encode('utf-8'))
    return path


def run_node(script, *args, env=None):
    merged_env = dict(os.environ)
    if env:
        merged_env.update(env)
    return subprocess.run(
        [NODE, str(script), *map(str, args)],
        capture_output=True,
        text=True,
        encoding='utf-8',
        timeout=60,
        env=merged_env,
    )


def fake_repo(base):
    root = Path(base) / 'SES-test'
    write(root / 'package.json', '{"name":"ses"}')
    write(root / 'pnpm-lock.yaml', 'lockfileVersion: 9.0')
    write(root / 'tsconfig.base.json', '{}')
    for pkg in ('server', 'shared', 'io', 'client'):
        write(root / f'packages/{pkg}/package.json', f'{{"name":"@ses/{pkg}"}}')
        write(root / f'packages/{pkg}/tsconfig.json', '{}')
        write(root / f'packages/{pkg}/src/index.ts', f'export const {pkg} = 1;\n')
    write(root / 'packages/server/tsconfig.build.json', '{}')
    write(root / 'packages/server/nest-cli.json', '{}')
    write(root / 'packages/server/webpack.config.js', 'module.exports = (o) => o;\n')
    write(root / 'packages/server/resources/authoring-reference.md', '# ref\n')
    return root


def install_fake_better_sqlite3(root):
    # Test backup-db.cjs without requiring native better-sqlite3 in CI before pnpm install.
    write(
        root / 'packages/server/node_modules/better-sqlite3/package.json',
        '{"name":"better-sqlite3","main":"index.js"}\n',
    )
    write(
        root / 'packages/server/node_modules/better-sqlite3/index.js',
        """const fs = require('node:fs');
module.exports = class FakeDatabase {
  constructor(source) { this.source = source; }
  async backup(target) { fs.copyFileSync(this.source, target); }
  close() {}
};
""",
    )


class BuildStateTests(unittest.TestCase):
    def test_check_and_record_lifecycle(self):
        with tempfile.TemporaryDirectory() as base:
            root = fake_repo(base)

            # 1. No dist/main.js
            res = run_node(BUILD_STATE, 'check', '--root', root)
            self.assertEqual(res.returncode, 1)

            # 2. dist/main.js exists without .ses-build-state.json
            write(root / 'packages/server/dist/main.js', 'console.log("ok");\n')
            res = run_node(BUILD_STATE, 'check', '--root', root)
            self.assertEqual(res.returncode, 1)

            # 3. Record -> check passes
            rec = run_node(BUILD_STATE, 'record', '--root', root)
            self.assertEqual(rec.returncode, 0, rec.stderr)
            self.assertEqual(run_node(BUILD_STATE, 'check', '--root', root).returncode, 0)

            # 4. Spec/test files do not invalidate build state
            write(root / 'packages/server/src/app.spec.ts', 'it("x", () => {});\n')
            self.assertEqual(run_node(BUILD_STATE, 'check', '--root', root).returncode, 0)

            # 5. Any real build input change invalidates build state
            for rel, content in (
                ('packages/client/src/editor.ts', 'export const changed = true;\n'),
                ('packages/shared/src/index.ts', 'export const shared = 2;\n'),
                ('packages/io/src/index.ts', 'export const io = 2;\n'),
                ('packages/server/src/index.ts', 'export const server = 2;\n'),
                ('pnpm-lock.yaml', 'lockfileVersion: 9.0\n# updated\n'),
                ('packages/server/webpack.config.js', 'module.exports = (o) => ({ ...o });\n'),
                ('packages/server/resources/authoring-reference.md', '# ref v2\n'),
            ):
                with self.subTest(changed=rel):
                    write(root / rel, content)
                    self.assertEqual(run_node(BUILD_STATE, 'check', '--root', root).returncode, 1)
                    self.assertEqual(run_node(BUILD_STATE, 'record', '--root', root).returncode, 0)
                    self.assertEqual(run_node(BUILD_STATE, 'check', '--root', root).returncode, 0)

            # 6. Node version mismatch invalidates build state
            state_file = root / 'packages/server/dist/.ses-build-state.json'
            state = json.loads(state_file.read_text(encoding='utf-8'))
            state['node'] = 'v18.0.0'
            state_file.write_text(json.dumps(state), encoding='utf-8')
            self.assertEqual(run_node(BUILD_STATE, 'check', '--root', root).returncode, 1)
            self.assertEqual(run_node(BUILD_STATE, 'record', '--root', root).returncode, 0)

            # 7. Missing dist/main.js invalidates build state even if state file remains
            (root / 'packages/server/dist/main.js').unlink()
            self.assertEqual(run_node(BUILD_STATE, 'check', '--root', root).returncode, 1)


class BackupDbTests(unittest.TestCase):
    def startup_files(self, root):
        d = root / 'output/startup-backups'
        if not d.exists():
            return []
        return sorted(p.name for p in d.iterdir() if p.is_file() and p.name.startswith('ses-before-start-') and p.name.endswith('.db'))

    def test_skip_unchanged_and_rebackup_on_change(self):
        with tempfile.TemporaryDirectory() as base:
            root = fake_repo(base)
            install_fake_better_sqlite3(root)

            # No ses.db -> nothing created
            res = run_node(BACKUP_DB, '--root', root)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(self.startup_files(root), [])

            # First run with ses.db -> 1 backup
            db_path = write(root / 'packages/server/data/ses.db', b'db-v1')
            res = run_node(BACKUP_DB, '--root', root)
            self.assertEqual(res.returncode, 0, res.stderr)
            files_1 = self.startup_files(root)
            self.assertEqual(len(files_1), 1)
            self.assertEqual((root / 'output/startup-backups' / files_1[0]).read_bytes(), b'db-v1')

            # Second run without changes -> skipped
            res = run_node(BACKUP_DB, '--root', root)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn('跳过', res.stdout)
            self.assertEqual(self.startup_files(root), files_1)

            # Modify ses.db -> new backup
            time.sleep(0.02)
            write(db_path, b'db-v2-changed')
            res = run_node(BACKUP_DB, '--root', root)
            self.assertEqual(res.returncode, 0, res.stderr)
            files_2 = self.startup_files(root)
            self.assertEqual(len(files_2), 2)

            # Modify ses.db-wal only -> new backup
            time.sleep(0.02)
            wal_path = write(root / 'packages/server/data/ses.db-wal', b'wal-1')
            res = run_node(BACKUP_DB, '--root', root)
            self.assertEqual(res.returncode, 0, res.stderr)
            files_3 = self.startup_files(root)
            self.assertEqual(len(files_3), 3)

            # Unchanged with WAL -> skipped
            res = run_node(BACKUP_DB, '--root', root)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn('跳过', res.stdout)
            self.assertEqual(self.startup_files(root), files_3)

            # Delete latest backup file -> recreates backup even though db unchanged
            (root / 'output/startup-backups' / files_3[-1]).unlink()
            time.sleep(0.02)
            res = run_node(BACKUP_DB, '--root', root)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(len(self.startup_files(root)), 3)
            self.assertTrue(wal_path.exists())

    def test_prunes_startup_and_upgrade_backups(self):
        with tempfile.TemporaryDirectory() as base:
            root = fake_repo(base)
            install_fake_better_sqlite3(root)
            startup_dir = root / 'output/startup-backups'
            upgrade_dir = root / 'output/upgrade-backups'

            old_startups = [f'ses-before-start-2026-10-{i:02d}T00-00-00-000Z.db' for i in range(1, 13)]
            for name in old_startups:
                write(startup_dir / name, name)
            write(startup_dir / 'manual-keep.db', 'keep')

            old_upgrades = [f'ses-before-upgrade-2026-10-{i:02d}T00-00-00-000Z' for i in range(1, 8)]
            for name in old_upgrades:
                write(upgrade_dir / name / 'manifest.json', '{}')
                write(upgrade_dir / name / 'ses.db', name)
            write(upgrade_dir / 'ses-before-upgrade-manual-no-manifest/ses.db', 'keep')
            write(upgrade_dir / 'custom-dir/ses.db', 'keep')

            # Default keeps: 10 startup, 5 upgrade
            res = run_node(BACKUP_DB, '--root', root)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(self.startup_files(root), old_startups[2:])
            self.assertTrue((startup_dir / 'manual-keep.db').exists())

            kept_upgrades = sorted(
                p.name for p in upgrade_dir.iterdir()
                if p.is_dir() and p.name.startswith('ses-before-upgrade-') and (p / 'manifest.json').exists()
            )
            self.assertEqual(kept_upgrades, old_upgrades[2:])
            self.assertTrue((upgrade_dir / 'ses-before-upgrade-manual-no-manifest/ses.db').exists())
            self.assertTrue((upgrade_dir / 'custom-dir/ses.db').exists())

            # Invalid env values fall back safely and never wipe everything
            for bad in ('abc', '0', '-3'):
                res = run_node(BACKUP_DB, '--root', root, env={
                    'SES_STARTUP_BACKUP_KEEP': bad,
                    'SES_UPGRADE_BACKUP_KEEP': bad,
                })
                self.assertEqual(res.returncode, 0, res.stderr)
                self.assertEqual(len(self.startup_files(root)), 10)
                self.assertEqual(
                    len([p for p in upgrade_dir.iterdir() if p.is_dir() and p.name.startswith('ses-before-upgrade-') and (p / 'manifest.json').exists()]),
                    5,
                )

            # Custom valid env values tighten retention
            res = run_node(BACKUP_DB, '--root', root, env={
                'SES_STARTUP_BACKUP_KEEP': '3',
                'SES_UPGRADE_BACKUP_KEEP': '2',
            })
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertEqual(self.startup_files(root), old_startups[-3:])
            kept_upgrades = sorted(
                p.name for p in upgrade_dir.iterdir()
                if p.is_dir() and p.name.startswith('ses-before-upgrade-') and (p / 'manifest.json').exists()
            )
            self.assertEqual(kept_upgrades, old_upgrades[-2:])


if __name__ == '__main__':
    unittest.main()
