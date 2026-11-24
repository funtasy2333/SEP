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

  it('places backCover after SesEndMark with explicit empty header/footer bindings and no pgNumType', () => {
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
    expect(docXml.indexOf('SesEndMark')).toBeLessThan(docXml.indexOf('SesBackCoverCopyright'));
    expect(docXml).toContain('版权所有 © 2026');

    const docTree = parseXml(docXml);
    const bodyEl = findChild(docTree, 'w:body')!;
    const finalSect = bodyEl.children[bodyEl.children.length - 1];
    expect(finalSect?.kind === 'element' && finalSect.name === 'w:sectPr').toBe(true);
    if (finalSect?.kind === 'element') {
      expect(findChild(finalSect, 'w:pgNumType')).toBeUndefined();
      const hdrRefs = descendants(finalSect, 'w:headerReference');
      const ftrRefs = descendants(finalSect, 'w:footerReference');
      expect(hdrRefs.map((r) => r.attrs['w:type'])).toEqual(['default', 'even']);
      expect(ftrRefs.map((r) => r.attrs['w:type'])).toEqual(['default', 'even']);

      const relsTree = parseXml(pkg.parts['word/_rels/document.xml.rels']!);
      const relMap = new Map(
        descendants(relsTree, 'Relationship').map((r) => [r.attrs.Id, r.attrs.Target]),
      );
      expect(hdrRefs.every((r) => relMap.get(r.attrs['r:id']) === 'header3.xml')).toBe(true);
      expect(ftrRefs.every((r) => relMap.get(r.attrs['r:id']) === 'footer3.xml')).toBe(true);
    }
  });
});
