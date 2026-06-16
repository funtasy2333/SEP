import { prerenderFormulas } from './katex-prerender';

describe('prerenderFormulas', () => {
  it('用真实 KaTeX 替换占位并保留 ses-formula 包裹', () => {
    const html = '<div><span class="ses-formula" data-latex="a^2 + b^2 = c^2"></span></div>';
    const { html: out, failures } = prerenderFormulas(html);
    expect(failures).toBe(0);
    expect(out).toContain('class="ses-formula"');
    expect(out).toContain('katex'); // KaTeX 输出含 .katex 容器
    expect(out).not.toContain('data-latex');
  });

  it('反转义 data-latex 中的属性转义后再渲染', () => {
    // 渲染器以 escapeAttr 写入：< → &lt;，& → &amp;
    const html = '<span class="ses-formula" data-latex="a &lt; b &amp;&amp; c"></span>';
    const calls: string[] = [];
    const { html: out } = prerenderFormulas(html, (latex) => {
      calls.push(latex);
      return 'X';
    });
    expect(calls[0]).toBe('a < b && c');
    expect(out).toBe('<span class="ses-formula">X</span>');
  });

  it('渲染抛错时降级为原始 LaTeX 文本并计数', () => {
    const html = '<span class="ses-formula" data-latex="\\bad"></span>';
    const { html: out, failures } = prerenderFormulas(html, () => {
      throw new Error('boom');
    });
    expect(failures).toBe(1);
    expect(out).toBe('<span class="ses-formula">\\bad</span>');
  });

  it('无公式时原样返回', () => {
    const html = '<p>无公式</p>';
    expect(prerenderFormulas(html).html).toBe(html);
  });

  it('处理多个公式', () => {
    const html =
      '<span class="ses-formula" data-latex="x"></span>' +
      '<span class="ses-formula" data-latex="y"></span>';
    const { html: out } = prerenderFormulas(html, (l) => `[${l}]`);
    expect(out).toBe(
      '<span class="ses-formula">[x]</span><span class="ses-formula">[y]</span>',
    );
  });
});
