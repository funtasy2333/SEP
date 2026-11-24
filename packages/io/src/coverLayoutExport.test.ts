import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { CoverLayoutConfig, DocumentMeta, PMJsonNode } from '@ses/shared';
import { buildDocx } from './docx';
import { buildPdfExportRequest } from './pdfExport';
import { exportSemanticHtml, exportSemanticJson } from './semanticExport';
import { buildXml46687Package } from './xml46687Package';

const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP///8AA/9oADAMBAAIRAxEAPwD/';

const COVER_LAYOUT: CoverLayoutConfig = {
  logo: {
    dataUrl: JPEG_DATA_URL,
    position: 'replace_mark',
    widthMm: 35,
    heightMm: 18,
    alt: '团体标志',
  },
  notice: {
    text: '内部受控版本',
    position: 'above_dates',
  },
  backCover: {
    enabled: true,
    copyrightNotice: '© 2026 测试学会',
    contactInfo: '联系邮箱：std@example.org',
  },
};

const DOC_META: DocumentMeta = {
  standardType: 'group',
  standardNo: 'T/TEST 001—2026',
  titleCn: '跨格式版式测试标准',
  issuer: '测试学会',
  coverLayout: COVER_LAYOUT,
};

const SAMPLE_PM_DOC: PMJsonNode = {
  type: 'doc',
  content: [
    {
      type: 'coverPage',
      attrs: { standardType: 'group', standardNo: 'T/TEST 001—2026', titleCn: '跨格式版式测试标准' },
      content: [{ type: 'paragraph' }],
    },
    {
      type: 'foreword',
      content: [{ type: 'paragraph', attrs: { nodeId: 'fw1' }, content: [{ type: 'text', text: '前言内容。' }] }],
    },
    {
      type: 'chapter',
      attrs: { nodeId: 'ch1', secType: 'scope', number: '1' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: '本文件规定了测试要求。' }] },
      ],
    },
  ],
};

describe('IO coverLayout cross-format integration', () => {
  it('passes coverLayout through buildDocx and registers backCover & jpeg media', async () => {
    const result = await buildDocx({
      pmDoc: SAMPLE_PM_DOC,
      documentMeta: DOC_META,
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    const zip = await JSZip.loadAsync(result.bytes);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('内部受控版本');
    expect(docXml).toContain('© 2026 测试学会');
    expect(Object.keys(zip.files).some((k) => k.startsWith('word/media/') && k.endsWith('.jpg'))).toBe(true);
    expect(zip.file('word/header3.xml')).toBeTruthy();
    expect(zip.file('word/footer3.xml')).toBeTruthy();
  });

  it('passes coverLayout through buildPdfExportRequest', () => {
    const req = buildPdfExportRequest(
      SAMPLE_PM_DOC,
      { standardType: 'group', title: '跨格式版式测试标准', stdCode: 'T/TEST 001—2026', issuer: '测试学会' },
      { stage: 'working_draft', coverLayout: COVER_LAYOUT },
    );
    expect(req.html).toContain('内部受控版本');
    expect(req.html).toContain('SESBACKCOVERANCHOR');
    expect(req.html).toContain('© 2026 测试学会');
  });

  it('emits non-blocking cover-layout-print-only warning on buildXml46687Package with xml != null and 0 errors', async () => {
    const result = await buildXml46687Package({
      pmDoc: SAMPLE_PM_DOC,
      documentMeta: DOC_META,
    });
    expect(result.xml).not.toBeNull();
    expect(result.problems.filter((p) => p.severity === 'error')).toHaveLength(0);
    const warn = result.problems.find((p) => p.code === 'cover-layout-print-only');
    expect(warn).toMatchObject({
      code: 'cover-layout-print-only',
      severity: 'warning',
      path: 'meta.coverLayout',
    });
  });

  it('keeps semantic HTML and JSON exports clean without coverLayout interference', () => {
    const html = exportSemanticHtml(SAMPLE_PM_DOC);
    expect(html).not.toContain('SESBACKCOVERANCHOR');
    const json = exportSemanticJson(SAMPLE_PM_DOC);
    expect(json.type).toBe('doc');
    expect(JSON.stringify(json)).not.toContain('内部受控版本');
  });
});
