import { BadRequestException } from '@nestjs/common';
import {
  attachmentDisposition,
  buildWarningHeaders,
  parseCreatedAt,
  WARNING_COUNT_HEADER,
  WARNINGS_HEADER,
  WARNINGS_TRUNCATED_HEADER,
  type ExportWarning,
} from './export-http';

describe('parseCreatedAt', () => {
  it('缺省返回 undefined，合法值原样透传', () => {
    expect(parseCreatedAt(undefined)).toBeUndefined();
    for (const value of [
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00.123Z',
      '2026-12-31T23:59:59+08:00',
      '2026-06-01T08:30:00.5-05:30',
      '2028-02-29T00:00:00Z', // 闰日
      '2026-01-01T00:00:00+14:00',
    ]) {
      expect(parseCreatedAt(value)).toBe(value);
    }
  });

  it('格式或取值非法一律 400', () => {
    for (const value of [
      '',
      'yesterday',
      '2026-01-01', // 缺时间
      '2026-01-01T00:00:00', // 缺时区
      '2026-01-01 00:00:00Z',
      '2026-01-01T00:00Z', // 缺秒
      '2026-13-01T00:00:00Z',
      '2026-00-10T00:00:00Z',
      '2026-02-30T00:00:00Z', // Date.parse 会宽松接受
      '2027-02-29T00:00:00Z', // 非闰年
      '2026-04-31T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:60Z',
      '2026-01-01T00:00:00+14:30',
      '2026-01-01T00:00:00+15:00',
      '2026-01-01T00:00:00+08:60',
      '0000-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z<x>',
      ['2026-01-01T00:00:00Z'],
      { a: '2026-01-01T00:00:00Z' },
      20260101,
      null,
    ]) {
      expect(() => parseCreatedAt(value)).toThrow(BadRequestException);
    }
  });
});

describe('buildWarningHeaders', () => {
  const warning = (
    index: number,
    message = `告警 ${index}`,
  ): ExportWarning => ({
    code: 'image-resource-failed',
    nodeId: `fig-${index}`,
    message,
  });

  it('无告警只返回条数 0', () => {
    expect(buildWarningHeaders([])).toEqual({ [WARNING_COUNT_HEADER]: '0' });
  });

  it('少量告警：整体 encodeURIComponent(JSON)，可无损还原，不标截断', () => {
    const warnings: ExportWarning[] = [
      warning(1, '含中文、引号"与换行\n的消息'),
      { code: 'formula-missing-omml', message: '没有 nodeId' },
    ];
    const headers = buildWarningHeaders(warnings);
    expect(headers[WARNING_COUNT_HEADER]).toBe('2');
    expect(headers[WARNINGS_TRUNCATED_HEADER]).toBeUndefined();
    // 响应头值必须是纯 ASCII，且不含需要转义的控制字符。
    expect(headers[WARNINGS_HEADER]).toMatch(/^[\x21-\x7e]+$/);
    expect(JSON.parse(decodeURIComponent(headers[WARNINGS_HEADER]))).toEqual(
      warnings,
    );
  });

  it('超长：按条整条截断、标明 Truncated，Count 仍是全量', () => {
    const warnings = Array.from({ length: 300 }, (_, i) => warning(i));
    const headers = buildWarningHeaders(warnings);
    expect(headers[WARNING_COUNT_HEADER]).toBe('300');
    expect(headers[WARNINGS_TRUNCATED_HEADER]).toBe('true');
    expect(headers[WARNINGS_HEADER].length).toBeLessThanOrEqual(4096);
    const kept = JSON.parse(
      decodeURIComponent(headers[WARNINGS_HEADER]),
    ) as ExportWarning[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(300);
    // 保留的是原顺序的前缀，每条完整。
    expect(kept).toEqual(warnings.slice(0, kept.length));
  });

  it('单条消息过长（如公式源码）先截到 200 字符，仍能放进头里', () => {
    const long = '𠮷'.repeat(5000); // 代码点在 BMP 之外，截断不能劈开代理对
    const headers = buildWarningHeaders([warning(1, long), warning(2)]);
    expect(headers[WARNING_COUNT_HEADER]).toBe('2');
    expect(headers[WARNINGS_TRUNCATED_HEADER]).toBeUndefined();
    const kept = JSON.parse(
      decodeURIComponent(headers[WARNINGS_HEADER]),
    ) as ExportWarning[];
    expect(kept).toHaveLength(2);
    expect(kept[0].message).toBe(`${'𠮷'.repeat(200)}…`);
  });
});

describe('attachmentDisposition', () => {
  it('中文标题按 filename* 百分号编码', () => {
    expect(attachmentDisposition('标准文件.docx')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('标准文件.docx')}`,
    );
  });

  it("额外转义 !'()*，`'` 不会混进 filename* 的分隔符", () => {
    const header = attachmentDisposition("A(1)'s *draft*!.docx");
    expect(header).toBe(
      "attachment; filename*=UTF-8''A%281%29%27s%20%2Adraft%2A%21.docx",
    );
    expect(header.split("'")).toHaveLength(3); // 只有两个分隔符
  });

  it('换行、路径分隔符、分号不会原样进入响应头', () => {
    const header = attachmentDisposition('a\r\nb/c\\d;e.docx');
    expect(header).toMatch(/^attachment; filename\*=UTF-8''[A-Za-z0-9%._-]+$/);
  });
});
