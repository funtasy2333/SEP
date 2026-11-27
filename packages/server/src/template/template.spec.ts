import { get as httpGet, type ClientRequest, type IncomingMessage } from 'node:http';
import { createTestApp, type TestApp } from '../test-support/test-app';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function openSseStream(
  baseUrl: string,
  path: string,
): Promise<{
  req: ClientRequest;
  res: IncomingMessage;
  events: Array<{ event: string; data: string }>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = httpGet(`${baseUrl}${path}`, (res) => {
      const events: Array<{ event: string; data: string }> = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let idx = buffer.indexOf('\n\n');
        while (idx >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let eventName = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }
          if (data) events.push({ event: eventName, data });
          idx = buffer.indexOf('\n\n');
        }
      });
      resolve({
        req,
        res,
        events,
        close: () => {
          res.destroy();
          req.destroy();
        },
      });
    });
    req.on('error', reject);
  });
}

describe('TemplateModule API & single-step revert', () => {
  let t: TestApp;
  const openStreams: Array<() => void> = [];

  beforeEach(async () => {
    t = await createTestApp({ heartbeatMs: 40 });
  });

  afterEach(async () => {
    for (const close of openStreams.splice(0)) close();
    await t.app.close();
  });

  it('lists 6 builtin readonly templates and prevents mutating or deleting them', async () => {
    const res = await t.http.get('/api/templates').expect(200);
    const list = res.body as Array<{ id: string | number; readonly: boolean; baseType: string }>;
    expect(list.filter((item) => item.readonly)).toHaveLength(6);

    await t.http.put('/api/templates/builtin:group').send({ baseRevision: 0, name: '篡改' }).expect(400);
    await t.http.delete('/api/templates/builtin:group').expect(400);
    await t.http.post('/api/templates/builtin:group/revert').send({ baseRevision: 0 }).expect(400);
  });

  it('preserves the previous content through a metadata save that includes the unchanged body', async () => {
    const created = await t.http
      .post('/api/templates')
      .send({ name: '模板', baseType: 'group' })
      .expect(201);
    const bodyA = created.body.content;
    const bodyB = structuredClone(bodyA);
    bodyB.content.push({
      type: 'chapter',
      attrs: { number: '4', nodeId: 'ch-extra' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '新章' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'p-extra' }, content: [{ type: 'text', text: '正文' }] },
      ],
    });
    const changed = await t.http
      .put(`/api/templates/${created.body.id}`)
      .send({ baseRevision: 0, content: bodyB })
      .expect(200);
    const metadata = await t.http
      .put(`/api/templates/${created.body.id}`)
      .send({ baseRevision: 1, name: '更名', content: changed.body.content })
      .expect(200);
    expect(metadata.body.hasPreviousContent).toBe(true);
    const reverted = await t.http
      .post(`/api/templates/${created.body.id}/revert`)
      .send({ baseRevision: 2 })
      .expect(200);
    expect(reverted.body.name).toBe('更名');
    expect(reverted.body.content).toEqual(bodyA);
  });

  it('preserves the previous content after an operation that leaves the body unchanged', async () => {
    const created = await t.http.post('/api/templates').send({ name: '模板', baseType: 'group' }).expect(201);
    const bodyA = created.body.content;
    const bodyB = structuredClone(bodyA);
    bodyB.content.push({
      type: 'chapter', attrs: { number: '4', nodeId: 'ch-extra' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '新章' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'p-extra' }, content: [{ type: 'text', text: '正文' }] },
      ],
    });
    const changed = await t.http.put(`/api/templates/${created.body.id}`)
      .send({ baseRevision: 0, content: bodyB }).expect(200);
    const op = await t.http.post(`/api/templates/${created.body.id}/operations`)
      .send({ baseRevision: 1, operations: [{ op: 'move', nodeId: 'p-extra', parent: 'ch-extra', position: 'end' }] }).expect(200);
    expect(op.body.template.content).toEqual(changed.body.content);
    const reverted = await t.http.post(`/api/templates/${created.body.id}/revert`)
      .send({ baseRevision: 2 }).expect(200);
    expect(reverted.body.content).toEqual(bodyA);
  });

  it('supports create, from-document, PUT & operations writing previousContent, and /revert restoring content', async () => {
    const sse = await openSseStream(t.url, '/api/templates/events');
    openStreams.push(sse.close);

    const createdRes = await t.http
      .post('/api/templates')
      .send({
        name: '协会团体模板',
        description: '测试模板',
        baseType: 'group',
        defaultMeta: { stdPrefix: 'T/TEST', issuer: '测试协会' },
        coverLayout: {
          logo: { dataUrl: PNG_DATA_URL, position: 'replace_mark', widthMm: 30, heightMm: 15 },
          backCover: { enabled: true, copyrightNotice: '© 2026 测试协会' },
        },
      })
      .expect(201);
    const created = createdRes.body as {
      id: number;
      revision: number;
      hasPreviousContent: boolean;
      content: { content: Array<{ type: string; attrs?: { nodeId?: string }; content?: unknown[] }> };
    };
    expect(created.revision).toBe(0);
    expect(created.hasPreviousContent).toBe(false);

    // PUT updating content stores previousContent
    const updatedContent = structuredClone(created.content);
    updatedContent.content.push({
      type: 'chapter',
      attrs: { number: '4', nodeId: 'ch-extra' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '附加章' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'p-extra' }, content: [{ type: 'text', text: '内容。' }] },
      ],
    });
    const putRes = await t.http
      .put(`/api/templates/${created.id}`)
      .send({ baseRevision: 0, content: updatedContent })
      .expect(200);
    expect(putRes.body.revision).toBe(1);
    expect(putRes.body.hasPreviousContent).toBe(true);

    // POST /operations also updates previousContent
    const opRes = await t.http
      .post(`/api/templates/${created.id}/operations`)
      .send({
        baseRevision: 1,
        operations: [
          {
            op: 'insert',
            parent: 'foreword',
            position: 'end',
            content: [{ kind: 'paragraph', content: '由{{proposer}}提出。' }],
          },
        ],
      })
      .expect(200);
    expect(opRes.body.revision).toBe(2);
    expect(opRes.body.template.hasPreviousContent).toBe(true);

    // Revert restores content before operations (revision 1 state) and increments revision
    const revertRes = await t.http
      .post(`/api/templates/${created.id}/revert`)
      .send({ baseRevision: 2 })
      .expect(200);
    expect(revertRes.body.revision).toBe(3);
    expect(revertRes.body.hasPreviousContent).toBe(false);
    expect(JSON.stringify(revertRes.body.content)).not.toContain('{{proposer}}');
    expect(JSON.stringify(revertRes.body.content)).toContain('附加章');

    // Second revert without previousContent fails with 409
    await t.http
      .post(`/api/templates/${created.id}/revert`)
      .send({ baseRevision: 3 })
      .expect(409);

    // Create from document
    const doc = await t.documents.create({
      title: '源标准',
      meta: {
        standardType: 'enterprise',
        standardNo: 'Q/ACME 001—2026',
        titleCn: '源标准',
        issuer: 'ACME',
        coverLayout: {
          logo: { dataUrl: PNG_DATA_URL, position: 'top_left', widthMm: 28, heightMm: 14 },
        },
      },
      stage: 'working_draft',
      content: created.content,
    });
    const fromDocRes = await t.http
      .post(`/api/templates/from-document/${doc.id}`)
      .send({ name: '从文档抽取的模板' })
      .expect(201);
    expect(fromDocRes.body.baseType).toBe('enterprise');
    expect(fromDocRes.body.defaultMeta.stdPrefix).toBe('Q/ACME');
    expect(fromDocRes.body.coverLayout.logo.position).toBe('top_left');

    // SSE events were delivered
    await new Promise((r) => setTimeout(r, 30));
    expect(sse.events.length).toBeGreaterThanOrEqual(4);
    expect(sse.events.every((e) => e.event === 'template-changed')).toBe(true);
  });

  it('rejects national replace_mark on create and update, generates DOCX preview, and returns 503 on PDF preview when disabled', async () => {
    await t.http
      .post('/api/templates')
      .send({
        name: '非法国标模板',
        baseType: 'national',
        coverLayout: {
          logo: { dataUrl: PNG_DATA_URL, position: 'replace_mark', widthMm: 30, heightMm: 15 },
        },
      })
      .expect(400);

    const groupTpl = await t.http
      .post('/api/templates')
      .send({
        name: '团体模板',
        baseType: 'group',
        coverLayout: {
          logo: { dataUrl: PNG_DATA_URL, position: 'replace_mark', widthMm: 30, heightMm: 15 },
        },
      })
      .expect(201);

    await t.http
      .put(`/api/templates/${groupTpl.body.id}`)
      .send({ baseRevision: 0, baseType: 'national' })
      .expect(400);

    const docxRes = await t.http
      .post(`/api/templates/${groupTpl.body.id}/preview/docx`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((docxRes.body as Buffer).subarray(0, 2).toString('utf8')).toBe('PK');

    const pdfRes = await t.http
      .post(`/api/templates/${groupTpl.body.id}/preview/pdf`)
      .expect(503);
    expect(pdfRes.body.code).toBe('pdf-export-disabled');
  });
});
