import { describe, expect, it } from 'vitest';
import {
  COVER_LOGO_MAX_BYTES,
  downgradeCoverLayoutForStandardType,
  hasActiveCoverLayout,
  parseCoverLogoDataUrl,
  validateCoverLayout,
} from './coverLayoutValidation';

// 1x1 transparent PNG
const VALID_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP///8AA/9oADAMBAAIRAxEAPwD/';

describe('coverLayoutValidation', () => {
  it('accepts valid PNG and JPEG inline data URLs and rejects invalid formats', () => {
    expect(parseCoverLogoDataUrl(VALID_PNG)).toMatchObject({ mime: 'image/png', ext: 'png' });
    expect(parseCoverLogoDataUrl(VALID_JPEG)).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });

    const okPng = validateCoverLayout(
      { logo: { dataUrl: VALID_PNG, position: 'top_left', widthMm: 30, heightMm: 15 } },
      'national',
    );
    expect(okPng.valid).toBe(true);

    const okJpeg = validateCoverLayout(
      { logo: { dataUrl: VALID_JPEG, position: 'replace_mark', widthMm: 40, heightMm: 20 } },
      'group',
    );
    expect(okJpeg.valid).toBe(true);

    for (const badUrl of [
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      'https://example.com/logo.png',
      'http://127.0.0.1/logo.png',
      '/etc/passwd',
      'file:///tmp/logo.png',
      'data:image/png;base64,not_valid_b64!',
    ]) {
      const res = validateCoverLayout(
        { logo: { dataUrl: badUrl, position: 'top_left', widthMm: 30, heightMm: 15 } },
        'group',
      );
      expect(res.valid, `expected rejection for ${badUrl}`).toBe(false);
    }
  });

  it('rejects logos exceeding 2 MB after base64 decoding', () => {
    // 2 MB + 3 bytes encoded -> > 2 MB decoded
    const oversizedBytes = COVER_LOGO_MAX_BYTES + 3;
    const base64 = 'A'.repeat(Math.ceil((oversizedBytes * 4) / 3 / 4) * 4);
    const res = validateCoverLayout(
      { logo: { dataUrl: `data:image/png;base64,${base64}`, position: 'center', widthMm: 30, heightMm: 15 } },
      'enterprise',
    );
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.errors.some((e) => e.code === 'logo-too-large')).toBe(true);
    }
  });

  it('rejects invalid mm dimensions and oversized notice/backCover strings', () => {
    expect(
      validateCoverLayout(
        { logo: { dataUrl: VALID_PNG, position: 'top_left', widthMm: 2, heightMm: 20 } },
        'group',
      ).valid,
    ).toBe(false);
    expect(
      validateCoverLayout(
        { logo: { dataUrl: VALID_PNG, position: 'top_left', widthMm: 180, heightMm: 20 } },
        'group',
      ).valid,
    ).toBe(false);
    expect(
      validateCoverLayout(
        { logo: { dataUrl: VALID_PNG, position: 'top_left', widthMm: 30, heightMm: 90 } },
        'group',
      ).valid,
    ).toBe(false);
    expect(
      validateCoverLayout(
        { notice: { text: 'a'.repeat(501), position: 'above_dates' } },
        'group',
      ).valid,
    ).toBe(false);
    expect(
      validateCoverLayout(
        { backCover: { enabled: true, copyrightNotice: 'c'.repeat(2001) } },
        'group',
      ).valid,
    ).toBe(false);
  });

  it('forbids replace_mark on national and guidance standards and auto-downgrades safely', () => {
    for (const st of ['national', 'guidance', 'gb', 'guide']) {
      const res = validateCoverLayout(
        { logo: { dataUrl: VALID_PNG, position: 'replace_mark', widthMm: 35, heightMm: 20 } },
        st,
      );
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.errors[0]?.code).toBe('replace-mark-forbidden');
      }

      const downgraded = downgradeCoverLayoutForStandardType(
        { logo: { dataUrl: VALID_PNG, position: 'replace_mark', widthMm: 35, heightMm: 20 } },
        st,
      );
      expect(downgraded.downgraded).toBe(true);
      expect(downgraded.coverLayout?.logo?.position).toBe('top_left');
    }

    const groupNoop = downgradeCoverLayoutForStandardType(
      { logo: { dataUrl: VALID_PNG, position: 'replace_mark', widthMm: 35, heightMm: 20 } },
      'group',
    );
    expect(groupNoop.downgraded).toBe(false);
    expect(groupNoop.coverLayout?.logo?.position).toBe('replace_mark');
  });

  it('detects active coverLayout correctly', () => {
    expect(hasActiveCoverLayout(undefined)).toBe(false);
    expect(hasActiveCoverLayout({ backCover: { enabled: false, note: 'hidden' } })).toBe(false);
    expect(hasActiveCoverLayout({ notice: { text: '   ', position: 'above_dates' } })).toBe(false);
    expect(hasActiveCoverLayout({ notice: { text: '本标准仅限内部使用', position: 'above_dates' } })).toBe(true);
    expect(hasActiveCoverLayout({ backCover: { enabled: true } })).toBe(true);
    expect(
      hasActiveCoverLayout({ logo: { dataUrl: VALID_PNG, position: 'center', widthMm: 30, heightMm: 15 } }),
    ).toBe(true);
    expect(hasActiveCoverLayout({ topRightMark: { mode: 'hidden' } })).toBe(true);
    expect(
      hasActiveCoverLayout({ watermark: { enabled: true, kind: 'text', frequency: 'every', text: '草案' } }),
    ).toBe(true);
  });

  it('validates logo wrap/offsets, topRightMark restrictions, backCover blocks, and watermark rules', () => {
    const okFull = validateCoverLayout(
      {
        logo: {
          dataUrl: VALID_PNG,
          position: 'top_left',
          wrap: 'behind_text',
          widthMm: 30,
          heightMm: 18,
          offsetXMm: 5,
          offsetYMm: -2,
        },
        topRightMark: { mode: 'text', text: 'T/ZSM 试行', fontSizePt: 32 },
        backCover: {
          enabled: true,
          verticalAlign: 'bottom',
          boxed: true,
          blocks: [
            { id: 'b1', type: 'image', dataUrl: VALID_PNG, widthMm: 14, heightMm: 14, align: 'center' },
            { id: 'b2', type: 'heading', text: '版权保护文件', align: 'center', fontSizePt: 14, bold: true },
            { id: 'b3', type: 'divider' },
            { id: 'b4', type: 'paragraph', text: '地址：杭州市\n网址：https://example.org', align: 'left', indent: false },
          ],
        },
        watermark: {
          enabled: true,
          kind: 'text',
          frequency: 'alternate',
          text: '内部草案',
          fontSizePt: 48,
          color: '#666666',
          rotationDeg: -45,
          opacity: 0.25,
        },
      },
      'group',
    );
    expect(okFull.valid).toBe(true);

    // National standard forbids topRightMark hidden/text
    expect(validateCoverLayout({ topRightMark: { mode: 'hidden' } }, 'national').valid).toBe(false);
    expect(validateCoverLayout({ topRightMark: { mode: 'text', text: '自定义' } }, 'guidance').valid).toBe(false);
    const downgraded = downgradeCoverLayoutForStandardType(
      {
        logo: { dataUrl: VALID_PNG, position: 'replace_mark', widthMm: 30, heightMm: 15 },
        topRightMark: { mode: 'hidden' },
      },
      'national',
    );
    expect(downgraded.downgraded).toBe(true);
    expect(downgraded.coverLayout?.logo?.position).toBe('top_left');
    expect(downgraded.coverLayout?.topRightMark).toBeUndefined();

    // Watermark invalid color / empty text
    expect(
      validateCoverLayout(
        { watermark: { enabled: true, kind: 'text', frequency: 'every', text: '   ', color: '#888888' } },
        'group',
      ).valid,
    ).toBe(false);
    expect(
      validateCoverLayout(
        { watermark: { enabled: true, kind: 'text', frequency: 'every', text: '内部', color: 'red' } },
        'group',
      ).valid,
    ).toBe(false);

    // Expanded watermark opacity bounds [0.01, 1]
    expect(
      validateCoverLayout(
        { watermark: { enabled: true, kind: 'text', frequency: 'every', text: '极淡', opacity: 0.01 } },
        'group',
      ).valid,
    ).toBe(true);
    expect(
      validateCoverLayout(
        { watermark: { enabled: true, kind: 'text', frequency: 'every', text: '不透明', opacity: 1 } },
        'group',
      ).valid,
    ).toBe(true);
    expect(
      validateCoverLayout(
        { watermark: { enabled: true, kind: 'text', frequency: 'every', text: '越界下限', opacity: 0 } },
        'group',
      ).valid,
    ).toBe(false);
    expect(
      validateCoverLayout(
        { watermark: { enabled: true, kind: 'text', frequency: 'every', text: '越界上限', opacity: 1.05 } },
        'group',
      ).valid,
    ).toBe(false);
  });
});
