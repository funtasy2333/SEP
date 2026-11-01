#!/usr/bin/env python3
"""Cross-platform driver for the upgrade end-to-end checks in .github/workflows/preview-release.yml.

It plays the part of the SES server: writes .ses-update/plan.json, copies the executor into
.ses-update/, takes the upgrade lock and runs the executor, then asserts on the result.
Not part of the release package.

  create-doc    --root R                       create a document through the REST API and remember it
  assert-doc    --root R                       the remembered document is still there
  upgrade       --root R --platform P --zip Z --target-version V --expect succeeded|rolled-back --installed V
  make-broken   --zip IN --out OUT             inject a build error into the package's server entry
  shutdown-api  --platform P                   POST /api/system/shutdown and wait for both ports to close
  assert-stopped                               nothing listens on 3000/5173
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

SERVER = 'http://127.0.0.1:3000'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class E2EError(Exception):
    pass


def log(message):
    print(f'[e2e {time.strftime("%H:%M:%S")}] {message}', flush=True)


def require(condition, message):
    if not condition:
        raise E2EError(message)


def request(url, method='GET', body=None, headers=None, timeout=15):
    data = None if body is None else json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json', **(headers or {})})
    with OPENER.open(req, timeout=timeout) as response:
        return response.status, response.read()


def client_base(platform):
    # The macOS launcher starts vite on "localhost"; Windows pins 127.0.0.1.
    return 'http://localhost:5173' if platform == 'macos' else 'http://127.0.0.1:5173'


def listening(port):
    for family, host in ((socket.AF_INET, '127.0.0.1'), (socket.AF_INET6, '::1')):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.settimeout(2)
                if sock.connect_ex((host, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def wait_ports_closed(timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not listening(3000) and not listening(5173):
            return True
        time.sleep(1)
    return False


def doc_file(root):
    return Path(root) / '.ses-run' / 'e2e-doc.json'


def create_doc(args):
    title = f'升级前的文档 {int(time.time())}'
    status, body = request(f'{SERVER}/api/documents', 'POST', {'title': title, 'meta': {'standardType': 'gb', 'titleCn': title}})
    require(status in (200, 201), f'create document failed: HTTP {status}')
    doc = json.loads(body)
    doc_file(args.root).parent.mkdir(parents=True, exist_ok=True)
    doc_file(args.root).write_text(json.dumps({'id': doc['id'], 'title': title}, ensure_ascii=False), encoding='utf-8')
    log(f'created document {doc["id"]}: {title}')


def assert_doc(args):
    remembered = json.loads(doc_file(args.root).read_text(encoding='utf-8'))
    status, body = request(f'{SERVER}/api/documents/{remembered["id"]}')
    require(status == 200, f'document {remembered["id"]} is gone: HTTP {status}')
    require(json.loads(body)['title'] == remembered['title'], 'document title changed')
    log(f'document {remembered["id"]} is intact')


def assert_service(platform):
    for url in (f'{SERVER}/api/documents', f'{client_base(platform)}/api/documents'):
        status, _ = request(url)
        require(status == 200, f'{url} returned HTTP {status}')
    log('backend and frontend are reachable')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def upgrade(args):
    root = Path(args.root).resolve()
    upd = root / '.ses-update'
    run = root / '.ses-run'
    upd.mkdir(exist_ok=True)
    run.mkdir(exist_ok=True)
    build = root / 'ses-build.json'
    current = read_json(build) if build.exists() else {}
    local_node = root / '.ses-tools' / 'node' / 'node.exe'
    node = str(local_node) if local_node.exists() else shutil.which('node')
    require(node, 'node not found')
    shutil.copy(args.zip, upd / 'download.zip')
    for name in ('apply-update.cjs', 'ses-upgrade.sh' if args.platform == 'macos' else 'ses-upgrade.ps1'):
        shutil.copy(root / 'scripts' / name, upd / name)
    plan = {
        'zip': str(upd / 'download.zip'), 'channel': 'stable', 'targetVersion': args.target_version, 'targetCommit': None,
        'fromVersion': current.get('version', 'unknown'), 'fromCommit': current.get('commit'), 'node': node,
        'platform': args.platform, 'requestedAt': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()),
    }
    (upd / 'plan.json').write_text(json.dumps(plan), encoding='utf-8')
    (upd / 'lock').mkdir()
    if args.platform == 'macos':
        command = ['/bin/bash', str(upd / 'ses-upgrade.sh'), str(root)]
        kwargs = {'start_new_session': args.detached}
    else:
        command = ['powershell.exe', '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(upd / 'ses-upgrade.ps1'), '-Root', str(root)]
        kwargs = {'creationflags': (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if args.detached else 0}
    log(f'running executor ({"detached" if args.detached else "attached"}): {" ".join(command)}')
    log_file = run / 'upgrade.log'
    with open(log_file, 'ab') as out:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=out, stderr=out, **kwargs)
        try:
            code = process.wait(timeout=args.timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            raise E2EError(f'executor did not finish within {args.timeout}s')
    print('---- upgrade.log ----')
    print(log_file.read_bytes().decode('utf-8', errors='replace'))
    print('---------------------')
    status = read_json(run / 'upgrade-status.json')
    log(f'executor exit code {code}; status: {json.dumps(status, ensure_ascii=False)}')
    require(status['state'] == args.expect, f'expected state {args.expect}, got {status["state"]}')
    require(status['step'] == 'done', f'expected step done, got {status["step"]}')
    if args.expect == 'succeeded':
        require(code == 0, f'executor exit code {code}')
    else:
        require(code != 0 and status.get('message'), 'a rolled-back upgrade must exit non-zero with a message')
    require(read_json(build)['version'] == args.installed, f'ses-build.json version is {read_json(build)["version"]}, expected {args.installed}')
    require(not (upd / 'lock').exists(), 'upgrade lock was not released')
    backups = list((root / 'output' / 'upgrade-backups').glob('ses-before-upgrade-*/ses.db'))
    require(backups, 'no pre-upgrade database backup was kept')
    assert_service(args.platform)
    assert_doc(args)
    log(f'upgrade scenario "{args.expect}" passed')


def make_broken(args):
    broken = False
    with zipfile.ZipFile(args.zip) as source, zipfile.ZipFile(args.out, 'w', zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename.endswith('/packages/server/src/main.ts'):
                data += b'\nconst broken: = ;;; {{{ this is a deliberate syntax error\n'
                broken = True
            target.writestr(info, data)
    require(broken, 'packages/server/src/main.ts not found in the package')
    log(f'wrote {args.out}')


def shutdown_api(args):
    require(listening(3000) and listening(5173), 'services are not running')
    try:
        status, _ = request(f'{SERVER}/api/system/shutdown', 'POST', {}, {'Origin': 'http://localhost:5173'})
        require(200 <= status < 300, f'shutdown returned HTTP {status}')
    except urllib.error.HTTPError as error:
        raise E2EError(f'shutdown returned HTTP {error.code}') from error
    except (urllib.error.URLError, ConnectionError, TimeoutError):
        log('connection closed while shutting down (the server may exit before replying)')
    require(wait_ports_closed(90), 'ports 3000/5173 are still listening after /api/system/shutdown')
    log('shutdown via API released both ports')


def assert_stopped(_args):
    require(wait_ports_closed(30), 'SES listeners remain')
    log('no listeners on 3000/5173')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    for name, function in (('create-doc', create_doc), ('assert-doc', assert_doc)):
        p = sub.add_parser(name)
        p.add_argument('--root', required=True)
        p.set_defaults(function=function)
    p = sub.add_parser('upgrade')
    p.add_argument('--root', required=True)
    p.add_argument('--platform', choices=('macos', 'windows'), required=True)
    p.add_argument('--zip', required=True)
    p.add_argument('--target-version', required=True)
    p.add_argument('--installed', required=True, help='version ses-build.json must show afterwards')
    p.add_argument('--expect', choices=('succeeded', 'rolled-back'), required=True)
    p.add_argument('--no-detached', dest='detached', action='store_false')
    p.add_argument('--timeout', type=int, default=1500)
    p.set_defaults(function=upgrade)
    p = sub.add_parser('make-broken')
    p.add_argument('--zip', required=True)
    p.add_argument('--out', required=True)
    p.set_defaults(function=make_broken)
    p = sub.add_parser('shutdown-api')
    p.add_argument('--platform', choices=('macos', 'windows'), required=True)
    p.set_defaults(function=shutdown_api)
    p = sub.add_parser('assert-stopped')
    p.set_defaults(function=assert_stopped)
    args = parser.parse_args()
    try:
        args.function(args)
    except E2EError as error:
        print(f'E2E FAILED: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
