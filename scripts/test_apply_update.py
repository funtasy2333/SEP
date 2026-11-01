"""Tests for scripts/apply-update.cjs (the upgrade executor's file logic)."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APPLY = ROOT / 'scripts/apply-update.cjs'
NODE = os.environ.get('SES_NODE') or shutil.which('node') or 'node'
SHA = 'f' * 40
WINDOWS = os.name == 'nt'

spec = importlib.util.spec_from_file_location('package_release', ROOT / 'scripts/package-release.py')
package_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package_release)


def run_apply(*args, check=True, env=None):
    result = subprocess.run([NODE, str(APPLY), *map(str, args)], capture_output=True, text=True, encoding='utf-8', timeout=120,
                            env={**os.environ, **(env or {})})
    if check and result.returncode != 0:
        raise AssertionError(f'apply-update {args[0]} failed ({result.returncode}): {result.stderr}{result.stdout}')
    return result


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def snapshot(root, skip=('.ses-update',)):
    """Every file (bytes digest) and directory below root, ignoring the executor's own work area."""
    files, dirs = {}, set()
    for current, names, filenames in os.walk(root):
        relative = Path(current).relative_to(root)
        if relative.parts and relative.parts[0] in skip:
            names[:] = []
            continue
        names[:] = [n for n in names if not (not relative.parts and n in skip)]
        for name in names:
            dirs.add((relative / name).as_posix())
        for name in filenames:
            files[(relative / name).as_posix()] = digest(Path(current) / name)
    return files, dirs


def write(path, content=b'x'):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content if isinstance(content, bytes) else content.encode('utf-8'))
    return path


def write_plan(root, platform='macos', **extra):
    plan = {
        'zip': str(root / '.ses-update/download.zip'), 'channel': 'commit', 'targetVersion': None, 'targetCommit': SHA,
        'fromVersion': '0.1.1-preview', 'fromCommit': 'abc1234' + '0' * 33, 'node': NODE, 'platform': platform,
        'requestedAt': '2026-11-01T00:00:00.000Z',
    }
    plan.update(extra)
    path = root / '.ses-update/plan.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(plan), encoding='utf-8')
    return path


def fake_install(base, with_build_info=False):
    """An installed SES directory with every kind of content an upgrade must preserve or replace."""
    root = Path(base) / 'SES 中文 [install]'
    write(root / 'package.json', '{"name":"ses","version":"0.1.1"}')
    write(root / 'pnpm-lock.yaml', 'old lock')
    write(root / 'scripts/ses-local.sh', '#!/bin/bash\necho old\n')
    write(root / 'scripts/removed-in-new.sh', 'stays (only listed dirs are replaced wholesale)')
    write(root / '启动SES.command', 'old command')
    write(root / 'packages/server/package.json', '{"name":"@ses/server"}')
    write(root / 'packages/server/src/main.ts', 'old main')
    write(root / 'packages/server/src/stale-residual.ts', 'this file must disappear')
    write(root / 'packages/client/src/old-dir/legacy.ts', 'legacy')
    write(root / 'packages/client/public/old-asset.txt', 'old asset')
    write(root / 'packages/server/data/ses.db', b'SQLite format 3\0' + os.urandom(64))
    write(root / 'packages/server/data/ses.db-wal', os.urandom(32))
    write(root / 'packages/server/node_modules/x/index.js', 'server dep')
    write(root / 'packages/client/node_modules/.bin/vite', 'bin')
    write(root / 'node_modules/y/z.js', 'root dep')
    write(root / '.ses-tools/node/node.exe', 'portable node')
    write(root / '.ses-run/server.log', 'log')
    write(root / '.ses-run/dependencies.sha256', 'hash')
    write(root / 'output/startup-backups/a.db', 'backup')
    write(root / '.env', 'SECRET=1')
    if with_build_info:
        write(root / 'ses-build.json', json.dumps({'version': '0.1.1-preview', 'channel': 'stable', 'commit': None, 'builtAt': '2026-10-01T00:00:00.000Z'}))
    return root


PROTECTED_FILES = [
    'packages/server/data/ses.db', 'packages/server/data/ses.db-wal', 'packages/server/node_modules/x/index.js',
    'packages/client/node_modules/.bin/vite', 'node_modules/y/z.js', '.ses-tools/node/node.exe', '.ses-run/server.log',
    '.ses-run/dependencies.sha256', 'output/startup-backups/a.db', '.env',
]


def copy_repo(destination):
    skip_top = {'node_modules', '.git', 'release', 'output', 'dist', 'tmp-e2e', '__pycache__'}

    def ignore(directory, names):
        ignored = [n for n in names if n in {'node_modules', '__pycache__', 'dist', '.git'} or n.startswith('.ses-')]
        if Path(directory) == ROOT:
            ignored += [n for n in names if n in skip_top]
        return ignored

    shutil.copytree(ROOT, destination, ignore=ignore)
    return destination


class ArchiveStaging(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.staging = Path(cls.temp.name) / 'staging'
        cls.staging.mkdir()
        copy_repo(cls.staging / f'SEP-{SHA}')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_list_matches_package_release_for_both_platforms(self):
        for platform in ('macos', 'windows'):
            with self.subTest(platform=platform):
                listed = json.loads(run_apply('list', '--staging', self.staging, '--platform', platform).stdout)
                expected = set(package_release.runtime_files(platform)) | {'ses-build.json'}
                self.assertEqual(set(listed), expected)
                self.assertEqual(len(listed), len(set(listed)))

    def test_upgrade_scripts_are_part_of_the_runtime(self):
        macos = set(package_release.runtime_files('macos'))
        windows = set(package_release.runtime_files('windows'))
        self.assertIn('scripts/apply-update.cjs', macos & windows)
        self.assertIn('scripts/ses-upgrade.sh', macos)
        self.assertNotIn('scripts/ses-upgrade.ps1', macos)
        self.assertIn('scripts/ses-upgrade.ps1', windows)
        self.assertNotIn('scripts/ses-upgrade.sh', windows)

    def test_archive_apply_installs_exactly_the_runtime_set(self):
        for platform in ('macos', 'windows'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as base:
                root = fake_install(base)
                before_protected = {p: digest(root / p) for p in PROTECTED_FILES}
                plan = write_plan(root, platform)
                run_apply('apply', '--root', root, '--staging', self.staging, '--plan', plan)
                # 受保护内容保持不变
                for name, value in before_protected.items():
                    self.assertEqual(digest(root / name), value, name)
                # 残留文件被移除，整目录替换
                self.assertFalse((root / 'packages/server/src/stale-residual.ts').exists())
                self.assertFalse((root / 'packages/client/src/old-dir').exists())
                self.assertFalse((root / 'packages/client/public/old-asset.txt').exists())
                # 非整目录替换的文件不会被删除
                self.assertTrue((root / 'scripts/removed-in-new.sh').exists())
                # 内容与归档一致
                for rel, source in package_release.runtime_files(platform).items():
                    self.assertEqual(digest(root / rel), digest(source), rel)
                self.assertEqual(digest(root / 'packages/server/resources/authoring-reference.md'), digest(ROOT / 'docs/wp9-authoring-reference.md'))
                # ses-build.json
                info = json.loads((root / 'ses-build.json').read_text(encoding='utf-8'))
                version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
                self.assertEqual({k: info[k] for k in ('version', 'channel', 'commit')}, {'version': version, 'channel': 'commit', 'commit': SHA})
                self.assertRegex(info['builtAt'], r'^\d{4}-\d\d-\d\dT')
                if not WINDOWS and platform == 'macos':
                    for entry in ('scripts/ses-local.sh', 'scripts/ses-upgrade.sh', '启动SES.command', '退出SES.command'):
                        self.assertEqual(os.stat(root / entry).st_mode & 0o777, 0o755, entry)
                self.assertTrue((root / '.ses-update/rollback/manifest.json').exists())

    def test_rollback_restores_byte_for_byte(self):
        for with_build_info in (False, True):
            with self.subTest(with_build_info=with_build_info), tempfile.TemporaryDirectory() as base:
                root = fake_install(base, with_build_info)
                before = snapshot(root)
                plan = write_plan(root, 'macos')
                run_apply('apply', '--root', root, '--staging', self.staging, '--plan', plan)
                self.assertNotEqual(snapshot(root), before)
                run_apply('rollback', '--root', root)
                self.assertEqual(snapshot(root), before)
                # 回滚可以重复执行
                run_apply('rollback', '--root', root)
                self.assertEqual(snapshot(root), before)

    def test_rollback_after_partial_apply(self):
        """apply 中途失败（用测试钩子在写入若干文件后抛错）后，rollback 仍能完整还原。"""
        for with_build_info in (False, True):
            with self.subTest(with_build_info=with_build_info), tempfile.TemporaryDirectory() as base:
                root = fake_install(base, with_build_info)
                before = snapshot(root)
                plan = write_plan(root, 'macos')
                result = run_apply('apply', '--root', root, '--staging', self.staging, '--plan', plan,
                                   check=False, env={'SES_APPLY_TEST_FAIL_AFTER': '40'})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('测试注入', result.stderr)
                self.assertNotEqual(snapshot(root), before)  # 确实改动了一部分
                run_apply('rollback', '--root', root)
                self.assertEqual(snapshot(root), before)

    def test_target_that_is_a_directory_is_rejected_before_any_change(self):
        with tempfile.TemporaryDirectory() as base:
            root = fake_install(base)
            (root / 'packages/client/tsconfig.json').mkdir()
            before = snapshot(root)
            result = run_apply('apply', '--root', root, '--staging', self.staging, '--plan', write_plan(root, 'macos'), check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('packages/client/tsconfig.json', result.stderr)
            self.assertEqual(snapshot(root), before)


class ReleaseStaging(unittest.TestCase):
    def build(self, base, platform, version='9.9.9-preview'):
        archive = package_release.build_archive(platform, Path(base) / 'zip', version, SHA)
        staging = Path(base) / f'staging-{platform}'
        with zipfile.ZipFile(archive) as z:
            z.extractall(staging)
            names = [n.split('/', 1)[1] for n in z.namelist() if not n.endswith('/')]
        return staging, names

    def test_list_and_apply_release_package(self):
        for platform in ('macos', 'windows'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as base:
                staging, names = self.build(base, platform)
                listed = json.loads(run_apply('list', '--staging', staging, '--platform', platform).stdout)
                self.assertEqual(set(listed), set(names))
                self.assertIn('使用说明.md', listed)
                self.assertIn('ses-build.json', listed)
                root = fake_install(base)
                protected = {p: digest(root / p) for p in PROTECTED_FILES}
                plan = write_plan(root, platform, channel='stable', targetVersion='9.9.9-preview', targetCommit=None)
                run_apply('apply', '--root', root, '--staging', staging, '--plan', plan)
                info = json.loads((root / 'ses-build.json').read_text(encoding='utf-8'))
                self.assertEqual((info['version'], info['channel'], info['commit']), ('9.9.9-preview', 'stable', SHA))
                self.assertTrue((root / '使用说明.md').exists())
                self.assertIn('9.9.9', (root / '使用说明.md').read_text(encoding='utf-8'))
                self.assertFalse((root / 'packages/server/src/stale-residual.ts').exists())
                self.assertEqual({p: digest(root / p) for p in PROTECTED_FILES}, protected)

    def test_platform_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            staging, _ = self.build(base, 'macos')
            result = run_apply('list', '--staging', staging, '--platform', 'windows', check=False)
            self.assertNotEqual(result.returncode, 0)

    def test_unrecognised_or_ambiguous_staging_is_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            empty = Path(base) / 'empty'
            write(empty / 'top/readme.txt', 'nothing useful')
            self.assertNotEqual(run_apply('list', '--staging', empty, '--platform', 'macos', check=False).returncode, 0)
            two = Path(base) / 'two'
            (two / 'a').mkdir(parents=True)
            (two / 'b').mkdir()
            self.assertNotEqual(run_apply('list', '--staging', two, '--platform', 'macos', check=False).returncode, 0)


class PathSafety(unittest.TestCase):
    def release_with(self, base, extra_files):
        """A minimal valid macOS release package plus extra (possibly hostile) files."""
        top = Path(base) / 'staging/SES-9.9.9-preview-macos'
        write(top / 'ses-build.json', json.dumps({'version': '9.9.9-preview', 'channel': 'stable', 'commit': None, 'builtAt': 'x'}))
        write(top / 'scripts/ses-local.sh', '#!/bin/bash\n')
        for name in extra_files:
            write(top / name, 'hostile')
        return top.parent

    def assert_rejected(self, base, extra_files, expect_in_message=None):
        root = fake_install(Path(base) / 'inst')
        staging = self.release_with(base, extra_files)
        before = snapshot(root)
        result = run_apply('apply', '--root', root, '--staging', staging, '--plan', write_plan(root), check=False)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        if expect_in_message:
            self.assertIn(expect_in_message, result.stderr)
        self.assertEqual(snapshot(root), before)
        return root

    def test_protected_directories_are_never_touched(self):
        for name in ('node_modules/pkg/index.js', 'packages/server/node_modules/pkg/index.js', 'packages/server/data/ses.db',
                     'packages/server/data/new.txt', 'output/upgrade-backups/x.txt', '.ses-tools/node/node.exe',
                     '.ses-run/upgrade.log', '.ses-update/plan.json', '.env', '.env.local'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as base:
                self.assert_rejected(base, [name], '受保护')

    @unittest.skipIf(WINDOWS, 'backslash is a path separator on Windows; the extractor cannot create such a name')
    def test_path_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            self.assert_rejected(base, ['..\\..\\evil.txt'], '不合法')
            self.assertFalse((Path(base) / 'evil.txt').exists())
            self.assertFalse((Path(base) / 'inst/evil.txt').exists())

    @unittest.skipIf(WINDOWS, 'symlinks need privileges on Windows')
    def test_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            staging = self.release_with(base, [])
            outside = Path(base) / 'outside'
            outside.mkdir()
            (staging / 'SES-9.9.9-preview-macos/link').symlink_to(outside)
            root = fake_install(Path(base) / 'inst')
            result = run_apply('apply', '--root', root, '--staging', staging, '--plan', write_plan(root), check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('符号链接', result.stderr)

    @unittest.skipIf(WINDOWS, 'symlinks need privileges on Windows')
    def test_installed_directory_symlinked_outside_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            outside = Path(base) / 'outside'
            write(outside / 'main.ts', 'must survive')
            root = fake_install(Path(base) / 'inst')
            shutil.rmtree(root / 'packages/server/src')
            (root / 'packages/server/src').symlink_to(outside)
            staging = self.release_with(base, ['packages/server/src/main.ts'])
            result = run_apply('apply', '--root', root, '--staging', staging, '--plan', write_plan(root), check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((outside / 'main.ts').read_text(), 'must survive')


class Database(unittest.TestCase):
    def test_backup_and_restore_with_wal(self):
        with tempfile.TemporaryDirectory() as base:
            root = fake_install(base)
            data = root / 'packages/server/data'
            original = {n: (data / n).read_bytes() for n in ('ses.db', 'ses.db-wal')}
            run_apply('backup-db', '--root', root)
            backup = root / '.ses-update/db-backup'
            self.assertEqual((backup / 'ses.db').read_bytes(), original['ses.db'])
            self.assertEqual((backup / 'ses.db-wal').read_bytes(), original['ses.db-wal'])
            self.assertFalse((backup / 'ses.db-shm').exists())
            (data / 'ses.db').write_bytes(b'new version scribbled here')
            (data / 'ses.db-wal').write_bytes(b'changed')
            (data / 'ses.db-shm').write_bytes(b'created by the new version')
            run_apply('restore-db', '--root', root)
            self.assertEqual((data / 'ses.db').read_bytes(), original['ses.db'])
            self.assertEqual((data / 'ses.db-wal').read_bytes(), original['ses.db-wal'])
            self.assertFalse((data / 'ses.db-shm').exists())

    def test_restore_removes_sidecars_that_did_not_exist(self):
        with tempfile.TemporaryDirectory() as base:
            root = fake_install(base)
            data = root / 'packages/server/data'
            (data / 'ses.db-wal').unlink()
            original = (data / 'ses.db').read_bytes()
            run_apply('backup-db', '--root', root)
            (data / 'ses.db').write_bytes(b'changed')
            (data / 'ses.db-wal').write_bytes(b'new wal')
            (data / 'ses.db-shm').write_bytes(b'new shm')
            run_apply('restore-db', '--root', root)
            self.assertEqual((data / 'ses.db').read_bytes(), original)
            self.assertFalse((data / 'ses.db-wal').exists())
            self.assertFalse((data / 'ses.db-shm').exists())

    def test_restore_without_backup_fails_and_changes_nothing(self):
        with tempfile.TemporaryDirectory() as base:
            root = fake_install(base)
            before = snapshot(root)
            self.assertNotEqual(run_apply('restore-db', '--root', root, check=False).returncode, 0)
            self.assertEqual(snapshot(root), before)

    def test_backup_without_database_is_a_noop_and_restore_removes_new_database(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base) / 'fresh'
            (root / 'packages/server').mkdir(parents=True)
            run_apply('backup-db', '--root', root)
            data = root / 'packages/server/data'
            write(data / 'ses.db', 'created later')
            run_apply('restore-db', '--root', root)
            self.assertFalse((data / 'ses.db').exists())

    def test_finalize_moves_backup_and_cleans_work_area(self):
        with tempfile.TemporaryDirectory() as base:
            root = fake_install(base)
            original = (root / 'packages/server/data/ses.db').read_bytes()
            run_apply('backup-db', '--root', root)
            upd = root / '.ses-update'
            write(upd / 'staging/top/file', 'x')
            write(upd / 'rollback/manifest.json', '{}')
            write(upd / 'download.zip', 'zip')
            write(upd / 'lock/keep', 'the shell removes the lock, not finalize')
            run_apply('finalize', '--root', root)
            for name in ('staging', 'rollback', 'download.zip', 'db-backup'):
                self.assertFalse((upd / name).exists(), name)
            backups = list((root / 'output/upgrade-backups').glob('ses-before-upgrade-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual((backups[0] / 'ses.db').read_bytes(), original)
            self.assertTrue((root / 'output/startup-backups/a.db').exists())
            self.assertTrue((upd / 'lock').exists())
            self.assertEqual((root / 'packages/server/data/ses.db').read_bytes(), original)


class Status(unittest.TestCase):
    def read(self, root):
        return json.loads((root / '.ses-run/upgrade-status.json').read_text(encoding='utf-8'))

    def test_status_file_format(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            plan = write_plan(root, targetVersion='0.1.2-preview', targetCommit='def5678' + '0' * 33, fromCommit='abc1234' + '0' * 33)
            run_apply('status', '--root', root, '--state', 'running', '--step', 'stopping', '--plan', plan)
            status = self.read(root)
            self.assertEqual(set(status), {'state', 'step', 'from', 'to', 'message', 'log', 'updatedAt'})
            self.assertEqual(status['state'], 'running')
            self.assertEqual(status['step'], 'stopping')
            self.assertEqual(status['from'], '0.1.1-preview (abc1234)')
            self.assertEqual(status['to'], '0.1.2-preview (def5678)')
            self.assertIsNone(status['message'])
            self.assertEqual(status['log'], '.ses-run/upgrade.log')
            self.assertRegex(status['updatedAt'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$')

    def test_status_message_and_previous_versions_are_kept_without_plan(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            plan = write_plan(root, targetVersion='0.1.2-preview', targetCommit=None, fromCommit=None)
            run_apply('status', '--root', root, '--state', 'running', '--step', 'applying', '--plan', plan)
            self.assertEqual(self.read(root)['from'], '0.1.1-preview')
            self.assertEqual(self.read(root)['to'], '0.1.2-preview')
            run_apply('status', '--root', root, '--state', 'rolled-back', '--step', 'done', '--message', '新版本启动失败 "x"')
            status = self.read(root)
            self.assertEqual((status['state'], status['step']), ('rolled-back', 'done'))
            self.assertEqual(status['message'], '新版本启动失败 "x"')
            self.assertEqual(status['to'], '0.1.2-preview')

    def test_commit_channel_without_version_shows_short_sha(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            plan = write_plan(root, targetVersion=None, targetCommit='def5678' + '0' * 33)
            run_apply('status', '--root', root, '--state', 'running', '--step', 'stopping', '--plan', plan)
            self.assertEqual(self.read(root)['to'], 'def5678')

    def test_invalid_state_or_step_is_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            self.assertNotEqual(run_apply('status', '--root', root, '--state', 'bogus', '--step', 'done', check=False).returncode, 0)
            self.assertNotEqual(run_apply('status', '--root', root, '--state', 'running', '--step', 'bogus', check=False).returncode, 0)

    def test_plan_get(self):
        with tempfile.TemporaryDirectory() as base:
            root = Path(base)
            plan = write_plan(root, zip='/some/where/download.zip')
            self.assertEqual(run_apply('plan-get', '--plan', plan, '--key', 'zip').stdout.strip(), '/some/where/download.zip')


if __name__ == '__main__':
    unittest.main()
