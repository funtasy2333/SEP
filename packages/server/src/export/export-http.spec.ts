import { BadRequestException } from '@nestjs/common';
import {
  attachmentDisposition,
  buildWarningHeaders,
  CONTENT_DISPOSITION_MAX_LENGTH,
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

  it('不成对的 UTF-16 代理项替换为 U+FFFD，不抛 URIError', () => {
    const replacement = encodeURIComponent('�');
    expect(attachmentDisposition('\ud800标准.docx')).toBe(
      `attachment; filename*=UTF-8''${replacement}${encodeURIComponent('标准.docx')}`,
    );
    expect(attachmentDisposition('a\udc00.docx')).toBe(
      `attachment; filename*=UTF-8''a${replacement}.docx`,
    );
    // 成对的代理项（如 emoji）保持原样
    expect(attachmentDisposition('😀.docx')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('😀.docx')}`,
    );
    // 截短路径同样不抛
    expect(() =>
      attachmentDisposition(`${'\ud800'.repeat(500)}.docx`),
    ).not.toThrow();
  });

  describe('长度上界', () => {
    const PREFIX = "attachment; filename*=UTF-8''";
    const MAX = CONTENT_DISPOSITION_MAX_LENGTH;
    const EXTENSION = '.docx';
    const MARK = '…';
    /** 文件名部分（前缀之后）的编码长度预算。 */
    const NAME_BUDGET = MAX - PREFIX.length;
    /** 截短时主体可用的编码长度：再扣掉扩展名与省略号（%E2%80%A6，9 个字符）。 */
    const STEM_BUDGET = NAME_BUDGET - EXTENSION.length - 9;
    /** 头值只含 ASCII 的 unreserved 字符与完整的 %XX（截断不会留下半截编码）。 */
    const WELL_FORMED_HEADER =
      /^attachment; filename\*=UTF-8''(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/;
    const CJK = '标准机器语言表达国家市场监督管理总局归口单位提出';

    const nameOf = (header: string): string =>
      decodeURIComponent(header.slice(PREFIX.length));
    /** 解码结果必须是合法 Unicode：没有被劈开的代理对，也没有替换字符。 */
    const expectIntactText = (text: string): void => {
      expect(text).not.toContain('�');
      expect(() => encodeURIComponent(text)).not.toThrow(); // 孤立代理项会抛 URIError
    };

    it('不超过上限的标题与原样编码逐字节相同，不加省略号', () => {
      const filename = `${CJK.repeat(4)}.docx`; // 100 个汉字，约 0.9 KiB
      const header = attachmentDisposition(filename);
      expect(header).toBe(`${PREFIX}${encodeURIComponent(filename)}`);
      expect(header.length).toBeLessThanOrEqual(MAX);
      expect(nameOf(header)).toBe(filename);
    });

    it('2000 字的中文标题：头值不超过上限、以 .docx 结尾，保留的是标题的前缀', () => {
      const title = Array.from(
        { length: 2000 },
        (_, i) => CJK[i % CJK.length],
      ).join('');
      const header = attachmentDisposition(`${title}.docx`);
      expect(header.length).toBeLessThanOrEqual(MAX);
      expect(header).toMatch(WELL_FORMED_HEADER);
      expect(header.endsWith(encodeURIComponent(`${MARK}${EXTENSION}`))).toBe(
        true,
      );

      const kept = Math.floor(STEM_BUDGET / 9); // 每个汉字编码后 9 个字符
      expect(nameOf(header)).toBe(`${title.slice(0, kept)}${MARK}${EXTENSION}`);
    });

    it('恰好等于上限：原样返回；超出 1 个字符：截短后仍不超过上限', () => {
      const exact = `${'a'.repeat(NAME_BUDGET - EXTENSION.length)}${EXTENSION}`;
      const atLimit = attachmentDisposition(exact);
      expect(atLimit).toBe(`${PREFIX}${exact}`);
      expect(atLimit.length).toBe(MAX);

      const over = attachmentDisposition(`a${exact}`);
      expect(over.length).toBeLessThanOrEqual(MAX);
      expect(nameOf(over)).toBe(
        `${'a'.repeat(STEM_BUDGET)}${MARK}${EXTENSION}`,
      );
    });

    it('截断边界落在 emoji（代理对）上：整个 emoji 要么保留要么舍去，不出现半个字符', () => {
      // 😀 = U+1F600，UTF-8 四字节，编码后 12 个字符。
      const emoji = '😀';
      const build = (prefixLength: number) =>
        `${'a'.repeat(prefixLength)}${emoji.repeat(5)}${EXTENSION}`;

      // 前面的 a 让预算恰好剩 11 个字符：放不下一个 emoji，舍去。
      const dropped = attachmentDisposition(build(STEM_BUDGET - 11));
      expect(nameOf(dropped)).toBe(
        `${'a'.repeat(STEM_BUDGET - 11)}${MARK}${EXTENSION}`,
      );
      // 剩 12 个字符：恰好放下一个 emoji。
      const fitted = attachmentDisposition(build(STEM_BUDGET - 12));
      expect(nameOf(fitted)).toBe(
        `${'a'.repeat(STEM_BUDGET - 12)}${emoji}${MARK}${EXTENSION}`,
      );

      // 扫过边界前后的每一种余量（含 emoji 完整保留与恰好超出的情形）。
      for (let remaining = 0; remaining <= 25; remaining += 1) {
        const header = attachmentDisposition(build(STEM_BUDGET - remaining));
        expect(header.length).toBeLessThanOrEqual(MAX);
        expect(header).toMatch(WELL_FORMED_HEADER);
        const decoded = nameOf(header);
        expectIntactText(decoded);
        expect(decoded).toMatch(/^a+(?:😀)*….docx$/u);
        const keptEmoji = Array.from(decoded).filter((c) => c === emoji);
        expect(keptEmoji).toHaveLength(Math.floor(remaining / 12));
      }
    });

    it("含 !'()* 的标题：每个字符编码后占 3 个字符，按编码后的长度计算", () => {
      const special = "!'()*";
      const stem = special.repeat(300); // 编码后 4500 个字符
      const header = attachmentDisposition(`${stem}${EXTENSION}`);
      expect(header.length).toBeLessThanOrEqual(MAX);
      expect(header).toMatch(WELL_FORMED_HEADER);
      expect(header.split("'")).toHaveLength(3); // 只有两个分隔符
      expect(nameOf(header)).toBe(
        `${stem.slice(0, Math.floor(STEM_BUDGET / 3))}${MARK}${EXTENSION}`,
      );

      // 恰好等于上限：n 个 `*`（各 3 个字符）加若干普通字符，凑满预算则原样返回。
      const available = NAME_BUDGET - EXTENSION.length;
      const stars = Math.floor(available / 3);
      const exact = `${'*'.repeat(stars)}${'a'.repeat(available - stars * 3)}${EXTENSION}`;
      const atLimit = attachmentDisposition(exact);
      expect(atLimit.length).toBe(MAX);
      expect(nameOf(atLimit)).toBe(exact);
      // 主体末尾再多一个普通字符就必须截短，且仍不超过上限。
      const over = attachmentDisposition(
        `${exact.slice(0, -EXTENSION.length)}a${EXTENSION}`,
      );
      expect(over.length).toBeLessThanOrEqual(MAX);
      expect(over).toMatch(WELL_FORMED_HEADER);
      expect(nameOf(over)).toBe(
        `${'*'.repeat(Math.floor(STEM_BUDGET / 3))}${MARK}${EXTENSION}`,
      );
    });

    it('没有扩展名的超长文件名同样截短（省略号在末尾）', () => {
      const header = attachmentDisposition('长'.repeat(500));
      expect(header.length).toBeLessThanOrEqual(MAX);
      expect(header).toMatch(WELL_FORMED_HEADER);
      expect(nameOf(header)).toBe(
        `${'长'.repeat(Math.floor((NAME_BUDGET - 9) / 9))}${MARK}`,
      );
    });
  });
});
