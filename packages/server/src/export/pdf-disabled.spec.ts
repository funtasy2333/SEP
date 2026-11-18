import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConvertService } from '../convert/convert.service';
import { ConvertController } from '../convert/convert.controller';
import { DocumentService } from '../document/document.service';
import { McpToolsService } from '../mcp/mcp-tools.service';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

/** Check the real default policy, independently of the dormant PDF pipeline tests. */
describe('PDF 对外出口暂时关闭', () => {
  let app: INestApplication;
  let convert: ConvertService;
  let exporter: ExportService;
  const documents = { findOne: jest.fn().mockRejectedValue(new NotFoundException()) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ConvertController, ExportController],
      providers: [ConvertService, ExportService, { provide: DocumentService, useValue: documents }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    convert = app.get(ConvertService);
    exporter = app.get(ExportService);
    // Even installed/ready tooling must not reopen a paused product feature.
    Object.assign(convert, { htmlPdfReady: true });
  });
  afterAll(async () => { await app.close(); });

  it('能力接口不再公布 PDF 可用', async () => {
    const res = await request(app.getHttpServer()).get('/api/convert/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.htmlToPdf).toBe(false);
  });

  it('直接 REST 导出返回明确的 503，不读取文稿或启动 PDF 管线', async () => {
    const res = await request(app.getHttpServer()).get('/api/documents/1/export/pdf');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('pdf-export-disabled');
    expect(res.body.message).toContain('暂时关闭');
    expect(documents.findOne).not.toHaveBeenCalled();
  });

  it('MCP 使用同一出口并返回暂时关闭的说明', async () => {
    const mcp = new McpToolsService(documents as unknown as DocumentService, {} as never, exporter);
    const result = await mcp.call('export_document', { documentId: 1, format: 'pdf' }, { clientName: undefined, host: 'localhost' });
    expect(result.isError).toBe(true);
    const text = result.content.find(item => item.type === 'text');
    const body = JSON.parse(text && text.type === 'text' ? text.text : '{}');
    expect(body.status).toBe(503);
    expect(body.message).toContain('暂时关闭');
  });
});
