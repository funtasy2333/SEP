import { describe, expect, it } from 'vitest';
import type { IRDoc, IRDocMeta } from '../../ir/types';
import type { CoverLayoutConfig } from '../../types/template';
import { renderDocxTraced } from './render';
import { assertWellFormed } from './__tests__/helpers/checks';
import { findChild, parseXml, type XmlElement } from './__tests__/helpers/xmlTree';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP///8AA/9oADAMBAAIRAxEAPwD/';

const BASE_META: IRDocMeta = {
  title: '封面版式扩展测试标准',
  stdCode: 'T/SES 001—2026',
  standardType: 'group',
  issuer: '测试学会',
  publishDate: '2026-06-01',
  implementDate: '2026-12-01',
};

function makeDoc(meta: IRDocMeta = BASE_META): IRDoc {
  return {
    schemaVersion: 1,
    meta,
    front: { foreword: [], introduction: [] },
    body: [
      {
        kind: 'chapter',
        id: 'c1',
        secType: 'scope',
        title: [{ text: '范围' }],
        children: [{ kind: 'paragraph', id: 'p1', content: [{ text: '正文内容。' }] }],
      },
    ],
    appendices: [],
    bibliography: [],
  };
}

function descendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of el.children) {
    if (child.kind !== 'element') continue;
    if (child.name === name) out.push(child);
    out.push(...descendants(child, name));
  }
  return out;
}

describe('DOCX coverLayout & backCover rendering', () => {
  it('supports PNG and JPEG dynamic extensions across all 3 logo positions and cover notices', () => {
    for (const [position, dataUrl, expectedExt] of [
      ['replace_mark', JPEG_DATA_URL, '.jpg'],
      ['top_left', PNG_DATA_URL, '.png'],
      ['center', JPEG_DATA_URL, '.jpg'],
    ] as const) {
      const coverLayout: CoverLayoutConfig = {
        logo: { dataUrl, position, widthMm: 30, heightMm: 15, alt: '机构徽标' },
        notice: { text: '仅供内部参考', position: position === 'center' ? 'below_issuer' : 'above_dates' },
      };
      const { pkg } = renderDocxTraced(makeDoc(), {}, {
        images: {},
        formulaOmml: {},
        stage: 'working_draft',
        createdAt: '2026-10-01T00:00:00.000Z',
        coverLayout,
      });

      assertWellFormed(pkg);
      const binaryPaths = Object.keys(pkg.binaries);
      expect(binaryPaths.some((p) => p.endsWith(expectedExt))).toBe(true);
      expect(pkg.parts['word/document.xml']).toContain('仅供内部参考');
      if (position === 'replace_mark') {
        expect(pkg.parts['word/document.xml']).not.toContain('团体标准 T 标志');
      } else {
        expect(pkg.parts['word/document.xml']).toContain('团体标准 T 标志');
      }
    }
  });

  it('ignores replace_mark defensively on gb/guide documents', () => {
    const { pkg } = renderDocxTraced(
      makeDoc({ ...BASE_META, standardType: 'gb', stdCode: 'GB/T 1—2026' }),
      {},
      {
        images: {},
        formulaOmml: {},
        stage: 'working_draft',
        createdAt: '2026-10-01T00:00:00.000Z',
        coverLayout: {
          logo: { dataUrl: JPEG_DATA_URL, position: 'replace_mark', widthMm: 30, heightMm: 15 },
        },
      },
    );
    assertWellFormed(pkg);
    expect(pkg.parts['word/document.xml']).toContain('GB 标志');
  });

  it('places backCover after cover and before TOC with explicit empty header/footer bindings and no pgNumType', () => {
    const { pkg } = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: {
        backCover: {
          enabled: true,
          copyrightNotice: '版权所有 © 2026',
          publisherInfo: '某出版社出版发行',
          contactInfo: '电话：010-00000000',
        },
      },
    });

    assertWellFormed(pkg);
    expect(pkg.parts['word/header3.xml']).toBeDefined();
    expect(pkg.parts['word/footer3.xml']).toBeDefined();
    expect(pkg.parts['word/header3.xml']).not.toContain('STYLEREF');
    expect(pkg.parts['word/footer3.xml']).not.toContain('PAGE');

    const docXml = pkg.parts['word/document.xml']!;
    expect(docXml.indexOf('SesCoverTitle')).toBeLessThan(docXml.indexOf('SesBackCoverCopyright'));
    expect(docXml.indexOf('SesBackCoverCopyright')).toBeLessThan(docXml.indexOf('SesTocTitle'));
    expect(docXml.indexOf('SesBackCoverCopyright')).toBeLessThan(docXml.indexOf('SesEndMark'));
    expect(docXml).toContain('版权所有 © 2026');

    const docTree = parseXml(docXml);
    const bodyEl = findChild(docTree, 'w:body')!;
    const sects = descendants(bodyEl, 'w:sectPr');
    expect(sects.length).toBeGreaterThanOrEqual(4);
    const backCoverSect = sects[1]!;
    const tocSect = sects[2]!;

    expect(findChild(backCoverSect, 'w:pgNumType')).toBeUndefined();
    const hdrRefs = descendants(backCoverSect, 'w:headerReference');
    const ftrRefs = descendants(backCoverSect, 'w:footerReference');
    expect(hdrRefs.map((r) => r.attrs['w:type'])).toEqual(['default', 'even']);
    expect(ftrRefs.map((r) => r.attrs['w:type'])).toEqual(['default', 'even']);

    const relsTree = parseXml(pkg.parts['word/_rels/document.xml.rels']!);
    const relMap = new Map(
      descendants(relsTree, 'Relationship').map((r) => [r.attrs.Id, r.attrs.Target]),
    );
    expect(hdrRefs.every((r) => relMap.get(r.attrs['r:id']) === 'header3.xml')).toBe(true);
    expect(ftrRefs.every((r) => relMap.get(r.attrs['r:id']) === 'footer3.xml')).toBe(true);

    const tocType = findChild(tocSect, 'w:type');
    const tocPgNum = findChild(tocSect, 'w:pgNumType');
    expect(tocType?.attrs['w:val']).toBe('oddPage');
    expect(tocPgNum?.attrs['w:fmt']).toBe('upperRoman');
    expect(tocPgNum?.attrs['w:start']).toBe('1');
  });

  it('defaults cover logo to behind_text floating anchor and supports inline + offsets', () => {
    const behindRes = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: {
        logo: { dataUrl: PNG_DATA_URL, position: 'top_left', widthMm: 30, heightMm: 14, offsetXMm: 2, offsetYMm: -1 },
      },
    });
    assertWellFormed(behindRes.pkg);
    const behindDocXml = behindRes.pkg.parts['word/document.xml']!;
    expect(behindDocXml).toContain('<wp:anchor');
    expect(behindDocXml).toContain('behindDoc="1"');
    expect(behindDocXml).toContain('<wp:wrapNone/>');
    expect(behindDocXml).toContain('noChangeAspect="0"');

    const inlineRes = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: {
        logo: { dataUrl: PNG_DATA_URL, position: 'top_left', wrap: 'inline', widthMm: 30, heightMm: 14 },
      },
    });
    assertWellFormed(inlineRes.pkg);
    const inlineDocXml = inlineRes.pkg.parts['word/document.xml']!;
    expect(inlineDocXml).toContain('<wp:inline');
    expect(inlineDocXml).toContain('noChangeAspect="0"');
    expect(inlineDocXml).not.toContain('behindDoc="1"');
  });

  it('supports independent topRightMark hidden and custom text modes (while respecting gb/guide guard)', () => {
    const hiddenRes = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: { topRightMark: { mode: 'hidden' } },
    });
    assertWellFormed(hiddenRes.pkg);
    expect(hiddenRes.pkg.parts['word/document.xml']).not.toContain('团体标准 T 标志');

    const textRes = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: { topRightMark: { mode: 'text', text: 'T/ZSM', fontSizePt: 24 } },
    });
    assertWellFormed(textRes.pkg);
    expect(textRes.pkg.parts['word/document.xml']).toContain('T/ZSM');
    expect(textRes.pkg.parts['word/document.xml']).not.toContain('团体标准 T 标志');

    const gbRes = renderDocxTraced(
      makeDoc({ ...BASE_META, standardType: 'gb', stdCode: 'GB/T 1—2026' }),
      {},
      {
        images: {},
        formulaOmml: {},
        stage: 'working_draft',
        createdAt: '2026-10-01T00:00:00.000Z',
        coverLayout: { topRightMark: { mode: 'hidden' } },
      },
    );
    assertWellFormed(gbRes.pkg);
    expect(gbRes.pkg.parts['word/document.xml']).toContain('GB 标志');
  });

  it('renders custom backCover blocks, boxed border, and verticalAlign bottom between cover and TOC', () => {
    const { pkg } = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: {
        logo: { dataUrl: PNG_DATA_URL, position: 'top_left', widthMm: 24, heightMm: 12 },
        backCover: {
          enabled: true,
          verticalAlign: 'bottom',
          boxed: true,
          blocks: [
            { id: 'b1', type: 'image', dataUrl: PNG_DATA_URL, widthMm: 12, heightMm: 12, align: 'center' },
            { id: 'b2', type: 'heading', text: '版权保护文件', align: 'center', fontSizePt: 14, bold: true },
            { id: 'b3', type: 'divider' },
            { id: 'b4', type: 'paragraph', text: '任何单位不得擅自复制。', align: 'left', fontSizePt: 10.5, indent: true },
          ],
        },
      },
    });
    assertWellFormed(pkg);
    const docXml = pkg.parts['word/document.xml']!;
    expect(docXml).toContain('版权保护文件');
    expect(docXml).toContain('任何单位不得擅自复制。');
    expect(docXml).toContain('<w:tblBorders>');
    expect(docXml.indexOf('SesCoverTitle')).toBeLessThan(docXml.indexOf('版权保护文件'));
    expect(docXml.indexOf('版权保护文件')).toBeLessThan(docXml.indexOf('SesTocTitle'));
    expect(docXml.indexOf('版权保护文件')).toBeLessThan(docXml.indexOf('SesEndMark'));

    const docTree = parseXml(docXml);
    const bodyEl = findChild(docTree, 'w:body')!;
    const sects = descendants(bodyEl, 'w:sectPr');
    expect(sects.length).toBeGreaterThanOrEqual(4);
    const backCoverSect = sects[1]!;
    const vAlign = findChild(backCoverSect, 'w:vAlign');
    expect(vAlign?.attrs['w:val']).toBe('bottom');
  });

  it('injects text and image body watermarks per frequency (every vs alternate) and keeps backCover header3 clean', () => {
    const textEvery = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: {
        backCover: { enabled: true, copyrightNotice: '版权声明' },
        watermark: { enabled: true, kind: 'text', text: '内部审阅', frequency: 'every' },
      },
    });
    assertWellFormed(textEvery.pkg);
    expect(textEvery.pkg.parts['word/header1.xml']).toContain('内部审阅');
    expect(textEvery.pkg.parts['word/header2.xml']).toContain('内部审阅');
    expect(textEvery.pkg.parts['word/header3.xml']).not.toContain('内部审阅');

    const textAlt = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: {
        watermark: { enabled: true, kind: 'text', text: '隔页水印', frequency: 'alternate' },
      },
    });
    assertWellFormed(textAlt.pkg);
    expect(textAlt.pkg.parts['word/header1.xml']).toContain('隔页水印');
    expect(textAlt.pkg.parts['word/header2.xml']).not.toContain('隔页水印');

    const imgEvery = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: {
        watermark: { enabled: true, kind: 'image', dataUrl: PNG_DATA_URL, frequency: 'every', widthMm: 60, heightMm: 60 },
      },
    });
    assertWellFormed(imgEvery.pkg);
    expect(imgEvery.pkg.binaries['word/media/watermark.png']).toBeDefined();
    expect(imgEvery.pkg.parts['word/_rels/header1.xml.rels']).toContain('watermark.png');
    expect(imgEvery.pkg.parts['word/_rels/header2.xml.rels']).toContain('watermark.png');
    expect(imgEvery.pkg.parts['word/header1.xml']).toContain('behindDoc="1"');
    expect(imgEvery.pkg.parts['word/header2.xml']).toContain('behindDoc="1"');

    const imgAlt = renderDocxTraced(makeDoc(), {}, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-10-01T00:00:00.000Z',
      coverLayout: {
        watermark: { enabled: true, kind: 'image', dataUrl: PNG_DATA_URL, frequency: 'alternate', widthMm: 60, heightMm: 60 },
      },
    });
    assertWellFormed(imgAlt.pkg);
    expect(imgAlt.pkg.parts['word/_rels/header1.xml.rels']).toContain('watermark.png');
    expect(imgAlt.pkg.parts['word/_rels/header2.xml.rels']).toBeUndefined();
    expect(imgAlt.pkg.parts['word/header2.xml']).not.toContain('behindDoc="1"');
  });
});
