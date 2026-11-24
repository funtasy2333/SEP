import { createTestApp, type TestApp } from '../test-support/test-app';
import {
  SES_TEMPLATE_FORMAT,
  SES_TEMPLATE_FORMAT_VERSION,
  SES_TEMPLATE_MIME,
} from './template-package-format';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('.sestpl template export & import', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.app.close();
  });

  it('exports .sestpl losslessly, detects UUID conflict on preview, updates existing, and imports as new', async () => {
    const created = await t.http
      .post('/api/templates')
      .send({
        name: '原组织模板',
        description: '完整版式',
        baseType: 'group',
        defaultMeta: { stdPrefix: 'T/ORG', issuer: '某协会' },
        coverLayout: {
          logo: { dataUrl: PNG_DATA_URL, position: 'replace_mark', widthMm: 35, heightMm: 18 },
          notice: { text: '版本声明', position: 'above_dates' },
          backCover: { enabled: true, copyrightNotice: '© 2026' },
        },
      })
      .expect(201);

    const exported = await t.http
      .get(`/api/templates/${created.body.id}/export`)
      .expect(200);
    expect(exported.headers['content-type']).toContain(SES_TEMPLATE_MIME);
    const pkg = JSON.parse(exported.text) as Record<string, any>;
    expect(pkg.format).toBe(SES_TEMPLATE_FORMAT);
    expect(pkg.formatVersion).toBe(SES_TEMPLATE_FORMAT_VERSION);
    expect(pkg.template.uid).toBe(created.body.uid);
    expect(pkg.template.coverLayout).toEqual(created.body.coverLayout);

    // Modify incoming package and preview conflict
    pkg.template.name = '包内新版模板';
    pkg.template.description = '更新描述';
    const previewRes = await t.http
      .post('/api/templates/import?mode=preview')
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(JSON.stringify(pkg))
      .expect(200);
    expect(previewRes.body.status).toBe('match');
    expect(previewRes.body.existing.id).toBe(created.body.id);
    expect(previewRes.body.incoming.name).toBe('包内新版模板');

    // Mode = update
    const updatedRes = await t.http
      .post(`/api/templates/import?mode=update&targetId=${created.body.id}&baseRevision=0`)
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(JSON.stringify(pkg))
      .expect(200);
    expect(updatedRes.body.id).toBe(created.body.id);
    expect(updatedRes.body.revision).toBe(1);
    expect(updatedRes.body.name).toBe('包内新版模板');
    expect(updatedRes.body.hasPreviousContent).toBe(true);

    // Mode = new creates separate copy with new uid
    const copyRes = await t.http
      .post('/api/templates/import?mode=new')
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(JSON.stringify(pkg))
      .expect(200);
    expect(copyRes.body.id).not.toBe(created.body.id);
    expect(copyRes.body.uid).not.toBe(created.body.uid);
    expect(copyRes.body.name).toBe('包内新版模板（导入副本）');
    expect(copyRes.body.source).toBe('import');

    // Fresh UID imports cleanly as 'new'
    pkg.template.uid = '33333333-3333-4333-8333-333333333333';
    pkg.template.name = '全新模板';
    const freshPreview = await t.http
      .post('/api/templates/import?mode=preview')
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(JSON.stringify(pkg))
      .expect(200);
    expect(freshPreview.body.status).toBe('new');
    const freshImport = await t.http
      .post('/api/templates/import?mode=new')
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(JSON.stringify(pkg))
      .expect(200);
    expect(freshImport.body.uid).toBe('33333333-3333-4333-8333-333333333333');
    expect(freshImport.body.name).toBe('全新模板');
  });

  it('rejects SVG logo, external HTTP URL, national replace_mark, and invalid schema', async () => {
    const base = {
      format: SES_TEMPLATE_FORMAT,
      formatVersion: SES_TEMPLATE_FORMAT_VERSION,
      exportedAt: '2026-10-01T00:00:00.000Z',
      generator: { name: 'SES', version: '0.2.2' },
      template: {
        uid: '44444444-4444-4444-8444-444444444444',
        name: '校验测试模板',
        description: '',
        baseType: 'group',
        defaultStage: 'working_draft',
        defaultMeta: {},
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '内容' }] }],
        },
      },
    };

    // SVG rejected (400)
    await t.http
      .post('/api/templates/import?mode=new')
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(
        JSON.stringify({
          ...base,
          template: {
            ...base.template,
            coverLayout: {
              logo: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', position: 'top_left', widthMm: 20, heightMm: 20 },
            },
          },
        }),
      )
      .expect(400);

    // External URL rejected (400)
    await t.http
      .post('/api/templates/import?mode=new')
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(
        JSON.stringify({
          ...base,
          template: {
            ...base.template,
            coverLayout: {
              logo: { dataUrl: 'https://evil.example/logo.png', position: 'top_left', widthMm: 20, heightMm: 20 },
            },
          },
        }),
      )
      .expect(400);

    // National replace_mark rejected (400)
    await t.http
      .post('/api/templates/import?mode=new')
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(
        JSON.stringify({
          ...base,
          template: {
            ...base.template,
            baseType: 'national',
            coverLayout: {
              logo: { dataUrl: PNG_DATA_URL, position: 'replace_mark', widthMm: 20, heightMm: 20 },
            },
          },
        }),
      )
      .expect(400);

    // Invalid schema rejected (422)
    await t.http
      .post('/api/templates/import?mode=new')
      .set('Content-Type', SES_TEMPLATE_MIME)
      .send(
        JSON.stringify({
          ...base,
          template: {
            ...base.template,
            content: { type: 'unknownRoot' },
          },
        }),
      )
      .expect(422);
  });
});
