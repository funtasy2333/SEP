import {
  BODY_START_SENTINEL,
  computeTocPageNumbers,
  findBodyStartPage,
  injectTocPageNumbers,
  toUpperRoman,
  type TocTarget,
} from './toc';

describe('toUpperRoman', () => {
  it('转换常见页码', () => {
    expect(toUpperRoman(1)).toBe('I');
    expect(toUpperRoman(2)).toBe('II');
    expect(toUpperRoman(3)).toBe('III');
    expect(toUpperRoman(4)).toBe('IV');
    expect(toUpperRoman(9)).toBe('IX');
    expect(toUpperRoman(14)).toBe('XIV');
    expect(toUpperRoman(40)).toBe('XL');
  });
  it('非正数返回空串', () => {
    expect(toUpperRoman(0)).toBe('');
    expect(toUpperRoman(-1)).toBe('');
    expect(toUpperRoman(NaN)).toBe('');
  });
});

describe('findBodyStartPage', () => {
  it('按文件名称（去空白）定位正文起始页', () => {
    const pages = ['目次 前言 引言', '前言内容', '引言内容', '某标准 名称 1 范围'];
    // normalize 后匹配 "某标准名称"
    expect(findBodyStartPage(pages.map((p) => p.replace(/\s+/g, '')), '某标准 名称')).toBe(3);
  });
  it('docTitle 为空且无哨兵返回 -1', () => {
    expect(findBodyStartPage(['a', 'b'], '')).toBe(-1);
  });

  it('哨兵存在时优先用哨兵定位——标题在前言复现也不误锚', () => {
    // 前言（page1）正文里复现了文件名称"某标准名称"，旧逻辑会误锚到 page1；
    // 渲染器在正文首页（page3）注入哨兵，应据哨兵锚到 page3。
    const pages = [
      '目次前言引言',
      '前言本文件代替某标准名称旧版', // 标题在前言复现（旧逻辑的陷阱）
      '引言内容',
      `${BODY_START_SENTINEL}某标准名称1范围`, // 正文首页：哨兵 + 文件名称
    ];
    expect(findBodyStartPage(pages, '某标准名称')).toBe(3);
  });

  it('哨兵缺失时回退按文件名称定位首个命中', () => {
    const pages = ['目次', '某标准名称1范围'];
    expect(findBodyStartPage(pages, '某标准名称')).toBe(1);
  });
});

describe('computeTocPageNumbers', () => {
  // 物理页：0=目次, 1=前言, 2=引言, 3=正文首页(范围), 4=术语, 5=附录A
  const pages = [
    '目次 前言 引言 1 范围 2 术语和定义 附录A',
    '前言 本文件按照……',
    '引言 本文件的发布……',
    '示例标准名称 1 范围 本文件规定了……',
    '2 术语和定义 2.1 标准 文件',
    '附录A （规范性） 通用要求 A.1 概述',
  ];
  const docTitle = '示例标准名称';

  it('正文目标用阿拉伯页码（分区相对，从 1 起），排除目次误命中', () => {
    const toc: TocTarget[] = [
      { target: 'sec_1', text: '1　范围', division: 'body' },
      { target: 'sec_2', text: '2　术语和定义', division: 'body' },
      { target: 'app_a', text: '附录A　（规范性）通用要求', division: 'body' },
    ];
    const m = computeTocPageNumbers(pages, toc, docTitle);
    // bodyStart=3 → 范围 在 page3 → 3-3+1=1；术语 page4 → 2；附录 page5 → 3
    expect(m.get('sec_1')).toBe('1');
    expect(m.get('sec_2')).toBe('2');
    expect(m.get('app_a')).toBe('3');
  });

  it('前置目标用大写罗马页码，取正文前范围内最后一次命中', () => {
    const toc: TocTarget[] = [
      { target: 'front_foreword', text: '前言', division: 'front' },
      { target: 'front_intro', text: '引言', division: 'front' },
    ];
    const m = computeTocPageNumbers(pages, toc, docTitle);
    // 前言真实页=1 → 物理第2页 → II；引言真实页=2 → 物理第3页 → III
    expect(m.get('front_foreword')).toBe('II');
    expect(m.get('front_intro')).toBe('III');
  });

  it('未命中的目标不入表', () => {
    const toc: TocTarget[] = [{ target: 'x', text: '不存在的标题', division: 'body' }];
    const m = computeTocPageNumbers(pages, toc, docTitle);
    expect(m.has('x')).toBe(false);
  });

  it('编号与标题被 pdftotext 分列时回退到仅标题匹配', () => {
    // 章「4 技术要求」紧跟子条「4.1 总体要求」，pdftotext 阅读序把编号/标题分列：
    const grouped = [
      '目次 4 技术要求 4.1 总体要求',
      '示例标准名称 1 范围',
      '4 4.1 技术要求 总体要求 应满足……', // 编号一列、标题一列
    ];
    const toc: TocTarget[] = [
      { target: 'sec_4', text: '4　技术要求', division: 'body' },
      { target: 'sec_4.1', text: '4.1　总体要求', division: 'body' },
    ];
    const m = computeTocPageNumbers(grouped, toc, '示例标准名称');
    // bodyStart=1 → 标题在 page2 → 2-1+1=2
    expect(m.get('sec_4')).toBe('2');
    expect(m.get('sec_4.1')).toBe('2');
  });

  it('docTitle 未找到时正文页码降级为物理页序', () => {
    const toc: TocTarget[] = [{ target: 'sec_1', text: '1　范围', division: 'body' }];
    const m = computeTocPageNumbers(pages, toc, '不存在标题');
    // bodyStart=-1 → 范围首次出现在 page0(目次)，降级 0+1=1
    expect(m.get('sec_1')).toBe('1');
  });

  it('哨兵锚点使正文页码不受文件名称在前言复现的影响', () => {
    // page1（前言）复现了文件名称"示例标准名称"，旧逻辑会误把 bodyStart 锚到 page1；
    // 渲染器在正文首页（page3）注入哨兵，应据哨兵锚到 page3，使范围=1、术语=2。
    const adv = [
      '目次 1 范围 2 术语和定义',
      '前言 本文件代替示例标准名称 2019', // 标题在前言复现（旧逻辑陷阱）
      '引言 引言内容',
      `${BODY_START_SENTINEL} 示例标准名称 1 范围 本文件规定了`,
      '2 术语和定义 2.1 标准',
    ];
    const toc: TocTarget[] = [
      { target: 'sec_1', text: '1　范围', division: 'body' },
      { target: 'sec_2', text: '2　术语和定义', division: 'body' },
    ];
    const m = computeTocPageNumbers(adv, toc, '示例标准名称');
    expect(m.get('sec_1')).toBe('1');
    expect(m.get('sec_2')).toBe('2');
  });
});

describe('injectTocPageNumbers', () => {
  it('把页码写入对应 data-target 的占位元素', () => {
    const html =
      '<span class="ses-toc-page" data-target="sec_1">　</span>' +
      '<span class="ses-toc-page" data-target="front_foreword">　</span>';
    const numbers = new Map([
      ['sec_1', '1'],
      ['front_foreword', 'II'],
    ]);
    const out = injectTocPageNumbers(html, numbers);
    expect(out).toContain('<span class="ses-toc-page" data-target="sec_1">1</span>');
    expect(out).toContain('<span class="ses-toc-page" data-target="front_foreword">II</span>');
  });

  it('未提供页码的占位保持原样', () => {
    const html = '<span class="ses-toc-page" data-target="x">　</span>';
    const out = injectTocPageNumbers(html, new Map());
    expect(out).toBe(html);
  });

  it('转义注入文本中的 HTML 特殊字符', () => {
    const html = '<span class="ses-toc-page" data-target="x">　</span>';
    const out = injectTocPageNumbers(html, new Map([['x', '<b>']]));
    expect(out).toContain('>&lt;b&gt;</span>');
  });
});
