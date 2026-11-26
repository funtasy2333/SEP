import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { join } from 'path';
import {
  defaultDesktopScriptRunner,
  DesktopIntegrator,
  type DesktopScriptRequest,
} from './desktop-integrator';
import { createSystemConfig } from './system.config';
import {
  createSystemTestApp,
  type SystemTestApp,
} from '../test-support/system-test-app';
import type {
  DesktopAutoStartResult,
  DesktopShortcutResult,
  DesktopStatus,
} from './system.types';

describe('Desktop endpoints (/api/system/desktop*)', () => {
  let t: SystemTestApp;
  afterEach(async () => t?.close());

  it('macOS: status -> create-shortcuts -> set-autostart true/false round-trip', async () => {
    t = await createSystemTestApp({ launcher: 'macos', platform: 'darwin' });

    const initial = await t.http.get('/api/system/desktop');
    expect(initial.status).toBe(200);
    expect(initial.body as DesktopStatus).toEqual({
      supported: true,
      unsupportedReason: null,
      platform: 'macos',
      desktopShortcut: false,
      startMenuShortcut: false,
      autoStart: false,
    });

    const created = await t.http.post('/api/system/desktop/shortcuts').send({});
    expect(created.status).toBe(200);
    expect(created.body as DesktopShortcutResult).toEqual({
      desktopShortcut: true,
      startMenuShortcut: true,
      desktopPath: join(t.root, 'Desktop', 'SES'),
      startMenuPath: join(t.root, 'StartMenu', 'SES'),
    });

    const enabled = await t.http
      .post('/api/system/desktop/autostart')
      .send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body as DesktopAutoStartResult).toEqual({ autoStart: true });

    const after = await t.http.get('/api/system/desktop');
    expect(after.status).toBe(200);
    expect(after.body as DesktopStatus).toEqual({
      supported: true,
      unsupportedReason: null,
      platform: 'macos',
      desktopShortcut: true,
      startMenuShortcut: true,
      autoStart: true,
    });

    const disabled = await t.http
      .post('/api/system/desktop/autostart')
      .send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body as DesktopAutoStartResult).toEqual({
      autoStart: false,
    });
  });

  it('Windows: invokes powershell.exe with ses-desktop.ps1', async () => {
    t = await createSystemTestApp({ launcher: 'windows', platform: 'win32' });
    const res = await t.http.get('/api/system/desktop');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ supported: true, platform: 'windows' });
    expect(t.desktopCalls[0]).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(t.root, 'scripts', 'ses-desktop.ps1'),
        'status',
      ],
      cwd: t.root,
    });
  });

  it('开发模式（无 launcher）：status 返回 supported=false 且不触发脚本，写端点返回 409', async () => {
    t = await createSystemTestApp({ launcher: null });

    const status = await t.http.get('/api/system/desktop');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      supported: false,
      platform: null,
      desktopShortcut: false,
      startMenuShortcut: false,
      autoStart: false,
    });
    expect((status.body as DesktopStatus).unsupportedReason).toBeTruthy();
    expect(t.desktopCalls).toHaveLength(0);

    const sc = await t.http.post('/api/system/desktop/shortcuts').send({});
    expect(sc.status).toBe(409);

    const auto = await t.http
      .post('/api/system/desktop/autostart')
      .send({ enabled: true });
    expect(auto.status).toBe(409);
  });

  it('平台不匹配：status 返回 supported=false，写端点返回 409', async () => {
    t = await createSystemTestApp({ launcher: 'windows', platform: 'darwin' });

    const status = await t.http.get('/api/system/desktop');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      supported: false,
      platform: 'windows',
    });
    expect((status.body as DesktopStatus).unsupportedReason).toContain(
      'windows',
    );
    expect(t.desktopCalls).toHaveLength(0);

    expect(
      (await t.http.post('/api/system/desktop/shortcuts').send({})).status,
    ).toBe(409);
    expect(
      (
        await t.http
          .post('/api/system/desktop/autostart')
          .send({ enabled: true })
      ).status,
    ).toBe(409);
  });

  it('缺少对应桌面脚本：status 返回 supported=false，写端点返回 409', async () => {
    t = await createSystemTestApp({
      launcher: 'macos',
      platform: 'darwin',
      omitScripts: ['ses-desktop.sh'],
    });

    const status = await t.http.get('/api/system/desktop');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ supported: false });
    expect((status.body as DesktopStatus).unsupportedReason).toContain(
      'ses-desktop.sh',
    );
    expect(t.desktopCalls).toHaveLength(0);

    expect(
      (await t.http.post('/api/system/desktop/shortcuts').send({})).status,
    ).toBe(409);
  });

  it('POST /api/system/desktop/autostart 校验 enabled 必须是布尔值', async () => {
    t = await createSystemTestApp();
    for (const badBody of [
      {},
      { enabled: 'true' },
      { enabled: 1 },
      { enabled: null },
    ]) {
      const res = await t.http
        .post('/api/system/desktop/autostart')
        .send(badBody);
      expect(res.status).toBe(400);
    }
    expect(t.desktopCalls).toHaveLength(0);
  });

  it('LocalWriteGuard 拦截跨站写请求与非 JSON 请求', async () => {
    t = await createSystemTestApp();
    for (const path of [
      '/api/system/desktop/shortcuts',
      '/api/system/desktop/autostart',
    ]) {
      expect(
        (
          await t.http
            .post(path)
            .set('Origin', 'https://evil.example')
            .send({ enabled: true })
        ).status,
      ).toBe(403);
      expect(
        (
          await t.http
            .post(path)
            .set('Content-Type', 'text/plain')
            .send('enabled=true')
        ).status,
      ).toBe(415);
    }
    expect(t.desktopCalls).toHaveLength(0);
  });

  it('脚本执行失败或输出非法 JSON：返回 500', async () => {
    t = await createSystemTestApp({
      desktopRunner: () => Promise.reject(new Error('permission denied')),
    });
    expect((await t.http.get('/api/system/desktop')).status).toBe(500);
    expect(
      (await t.http.post('/api/system/desktop/shortcuts').send({})).status,
    ).toBe(500);
    await t.close();

    t = await createSystemTestApp({
      desktopRunner: () => Promise.resolve({ stdout: 'not-json', stderr: '' }),
    });
    expect((await t.http.get('/api/system/desktop')).status).toBe(500);
  });
});

describe('DesktopIntegrator unit tests (BOM & runner edge cases)', () => {
  it('strips UTF-8 BOM from script stdout and resolves fields', async () => {
    const t = await createSystemTestApp();
    try {
      const calls: DesktopScriptRequest[] = [];
      const integrator = new DesktopIntegrator(
        {
          ...createSystemConfig({ SES_ROOT: t.root }),
          launcher: 'windows',
          platform: 'win32',
        },
        (req) => {
          calls.push(req);
          if (req.args.includes('status')) {
            return Promise.resolve({
              stdout:
                '\uFEFF{"desktopShortcut":true,"startMenuShortcut":false,"autoStart":true}\r\n',
              stderr: '',
            });
          }
          return Promise.resolve({ stdout: '\uFEFF[]', stderr: '' });
        },
      );

      expect(await integrator.status()).toEqual({
        supported: true,
        unsupportedReason: null,
        platform: 'windows',
        desktopShortcut: true,
        startMenuShortcut: false,
        autoStart: true,
      });

      await expect(integrator.createShortcuts()).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(calls).toHaveLength(2);
    } finally {
      await t.close();
    }
  });

  it('throws ConflictException when unsupported on direct service calls', async () => {
    const t = await createSystemTestApp({ launcher: null });
    try {
      const integrator = new DesktopIntegrator(
        t.config,
        defaultDesktopScriptRunner,
      );
      await expect(integrator.createShortcuts()).rejects.toThrow(
        ConflictException,
      );
      await expect(integrator.setAutoStart(true)).rejects.toThrow(
        ConflictException,
      );
    } finally {
      await t.close();
    }
  });

  it('defaultDesktopScriptRunner executes real command and clears PSModulePath on powershell calls', async () => {
    const res = await defaultDesktopScriptRunner({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(JSON.stringify({ ok: true }))'],
      cwd: process.cwd(),
    });
    expect(JSON.parse(res.stdout)).toEqual({ ok: true });
  });
});
