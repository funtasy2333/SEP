import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import type { IRInline, IRMark } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { EMPTY_OPTIONS, labelsOf } from './xml46687Kit'
import { urlProblem } from '../xml46687Parts/inline'
import { codesOf, find, makeDoc, chapter, para, renderRuns, run } from './xml46687Kit'
import { targetsDoc } from './xml46687TargetsFixture'

/**
 * 行内内容（WP8.2 设计 §2.3、§2.11）：run 模型、mark 嵌套序与合并、容器内容模型、xref/fn/ext-link。
 * 用 `renderRuns` 直接渲染行内数组；目标（表、图、公式、术语、文献……）只需存在于 `targetsDoc()` 里。
 */

const doc = targetsDoc()
const plain = makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')])

const cross = (targetId: string, targetKind?: Extract<IRMark, { type: 'crossRef' }>['targetKind']): IRMark =>
  ({ type: 'crossRef', targetId, ...(targetKind ? { targetKind } : {}) })

describe('格式 mark：写成同名元素（设计 §2.3.2）', () => {
  it.each([
    ['[M-5.1-01] bold', 'bold'],
    ['[M-5.1-02] italic', 'italic'],
    ['[M-5.1-03] underline', 'underline'],
    ['[M-5.1-04] strike', 'strike'],
    ['[M-5.1-06] sup', 'sup'],
    ['[M-5.1-07] sub', 'sub'],
  ] as const)('%s：写成同名元素，其余文本留在外面', (_title, type) => {
    const { xml, problems } = renderRuns(plain, [run('前'), run('文', { type }), run('后')])
    expect(xml).toBe(`前<${type}>文</${type}>后`)
    expect(problems).toEqual([])
  })

  it('[M-5.1-01] 嵌套次序固定（外→内：bold、italic、underline、strike、sup、sub），与 marks 数组里的次序无关', () => {
    const marks: IRMark[] = [{ type: 'sub' }, { type: 'sup' }, { type: 'strike' }, { type: 'underline' }, { type: 'italic' }, { type: 'bold' }]
    expect(renderRuns(plain, [run('x', ...marks)]).xml)
      .toBe('<bold><italic><underline><strike><sup><sub>x</sub></sup></strike></underline></italic></bold>')
    expect(renderRuns(plain, [run('x', ...[...marks].reverse())]).xml)
      .toBe('<bold><italic><underline><strike><sup><sub>x</sub></sup></strike></underline></italic></bold>')
  })

  it('[M-5.1-01] 合并：相邻 run 按最长公共前缀共享外层元素（纯函数，两次结果逐字相同）', () => {
    const runs = [run('a', { type: 'bold' }), run('b', { type: 'bold' }, { type: 'italic' }), run('c', { type: 'bold' }), run('d')]
    const first = renderRuns(plain, runs).xml
    expect(first).toBe('<bold>a<italic>b</italic>c</bold>d')
    expect(renderRuns(plain, runs).xml).toBe(first)
    // 同一 mark 的相邻 run 合并成一个元素
    expect(renderRuns(plain, [run('甲', { type: 'italic' }), run('乙', { type: 'italic' })]).xml).toBe('<italic>甲乙</italic>')
  })

  it('空文本的 run 不产生空元素；文本相邻合并', () => {
    expect(renderRuns(plain, [run('', { type: 'bold' }), run('甲'), run('乙')]).xml).toBe('甲乙')
  })

  it('[M-5.4-01] 文本只转义 & < >，不使用命名实体；中文与引号直接输出', () => {
    expect(renderRuns(plain, [run('a & b < c > d “引号”')]).xml).toBe('a &amp; b &lt; c &gt; d “引号”')
  })
})

describe('变量符号与行内代码', () => {
  const variable: IRMark = { type: 'variable' }

  it('[M-5.5-01] variable 写成 named-content[@content-type="variable"]', () => {
    const { xml, problems } = renderRuns(plain, [run('设'), run('x', variable), run('。')])
    expect(xml).toBe('设<named-content content-type="variable">x</named-content>。')
    expect(problems).toEqual([])
  })

  it('[M-5.5-02] 同一变量的数字上标/下标合并到 named-content 内部（x²）；不带 variable 的 sup 留在外部', () => {
    expect(renderRuns(plain, [run('x', variable), run('2', variable, { type: 'sup' })]).xml)
      .toBe('<named-content content-type="variable">x<sup>2</sup></named-content>')
    expect(renderRuns(plain, [run('x', variable), run('y', variable, { type: 'sub' })]).xml)
      .toBe('<named-content content-type="variable">x<sub>y</sub></named-content>')
    expect(renderRuns(plain, [run('x', variable), run('2', { type: 'sup' })]).xml)
      .toBe('<named-content content-type="variable">x</named-content><sup>2</sup>')
  })

  it('[M-5.5-02] variable 的 kind/name 没有对应属性：warning variable-attr-not-expressed，仍写出 named-content', () => {
    const { xml, problems } = renderRuns(plain, [run('x', { type: 'variable', kind: 'quantity', name: 'x' })])
    expect(xml).toBe('<named-content content-type="variable">x</named-content>')
    expect(find(problems, 'variable-attr-not-expressed')).toHaveLength(1)
    expect(find(problems, 'variable-attr-not-expressed')[0]).toMatchObject({ severity: 'warning', nodeId: 'test-owner', path: 'doc.test.content[0]' })
  })

  it('[M-5.10-02] code 写成 inline-code，保留换行与空白；格式 mark 在外层', () => {
    expect(renderRuns(plain, [run('a<b', { type: 'code' })]).xml).toBe('<inline-code>a&lt;b</inline-code>')
    expect(renderRuns(plain, [run('a\n  b', { type: 'code' })]).xml).toBe('<inline-code>a\n  b</inline-code>')
    expect(renderRuns(plain, [run('x', { type: 'code' }, { type: 'bold' })]).xml).toBe('<bold><inline-code>x</inline-code></bold>')
  })
})

describe('外部链接 ext-link（M-10.1.9）', () => {
  const link = (href: string, extra: Record<string, unknown> = {}): IRMark => ({ type: 'externalLink', href, ...extra }) as IRMark

  it('[M-10.1.9-01] 写成 ext-link[@ext-link-type="uri"][@xlink:href]，格式 mark 在内层', () => {
    expect(renderRuns(plain, [run('网站', link('https://example.org/a?b=1&c=2'))]).xml)
      .toBe('<ext-link ext-link-type="uri" xlink:href="https://example.org/a?b=1&amp;c=2">网站</ext-link>')
    expect(renderRuns(plain, [run('粗', link('https://example.org/'), { type: 'bold' })]).xml)
      .toBe('<ext-link ext-link-type="uri" xlink:href="https://example.org/"><bold>粗</bold></ext-link>')
  })

  it('[M-10.1.9-02] 协议白名单 http/https/mailto/ftp（不分大小写）；相对地址不限', () => {
    for (const href of ['http://a.test/', 'HTTPS://a.test/', 'mailto:a@b.test', 'ftp://a.test/x', 'docs/readme.html', '#anchor']) {
      const { problems } = renderRuns(plain, [run('链', link(href))])
      expect(codesOf(problems), href).toEqual([])
    }
  })

  it('[M-10.1.9-02] 其他协议、空地址、含控制字符的地址：error xml-link-protocol，该 run 按无链接输出', () => {
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '', '   ', 'java\tscript:alert(1)', 'https://a.test/\nx']) {
      const { xml, problems } = renderRuns(plain, [run('链', link(href))])
      expect(codesOf(problems, 'error'), JSON.stringify(href)).toEqual(['xml-link-protocol'])
      expect(xml).toBe('链')
    }
    expect(urlProblem('javascript:x')).toContain('javascript')
    expect(urlProblem('https://ok.test/')).toBeUndefined()
  })

  it('[M-10.1.9-01] title/target/rel 没有对应属性：每个非空的给 warning link-attr-not-expressed', () => {
    const { xml, problems } = renderRuns(plain, [run('链', link('https://example.org/', { title: '提示', target: '_blank', rel: 'noopener' }))])
    expect(xml).toBe('<ext-link ext-link-type="uri" xlink:href="https://example.org/">链</ext-link>')
    expect(find(problems, 'link-attr-not-expressed')).toHaveLength(3)
  })
})

describe('交叉引用 xref：按目标的真实种类决定 ref-type（设计 §2.11）', () => {
  const x = (targetId: string, text: string, kind?: Parameters<typeof cross>[1]) => renderRuns(doc, [run(text, cross(targetId, kind))])

  it.each([
    ['[M-10.1.1-01] [M-10.1.2-01] 条', 'cl-1', 'clause', '<xref ref-type="sec" rid="sec_4.1">4.1</xref>'],
    ['[M-10.1.1-01] [M-10.1.1-02] 章', 'ch-body', 'chapter', '<xref ref-type="sec" rid="sec_4">第4章</xref>'],
    ['[M-9.2.7-02] 附录', 'app-a', 'appendix', '<xref ref-type="app" rid="sec_A">附录A</xref>'],
    ['[M-10.1.2-02] 表', 'tab-1', 'table', '<xref ref-type="table" rid="tab_1">表1</xref>'],
    ['[M-10.1.2-03] 图', 'fig-1', 'figure', '<xref ref-type="fig" rid="fig_1">图1</xref>'],
    ['[M-10.1.2-04] 有编号的公式', 'f-num', 'formula', '<xref ref-type="disp-formula" rid="formula_1">公式(1)</xref>'],
    ['[M-10.1.3-01] 正文中的注', 'note-1', 'note', '<xref ref-type="custom" custom-type="note" rid="note_1">注</xref>'],
    ['[M-10.1.3-01] 术语条目中的注（nte_<术语号>-<k>）', 'term-note', 'note', '<xref ref-type="custom" custom-type="note" rid="nte_3.1-1">注</xref>'],
    ['[M-10.1.3-02] 示例', 'ex-1', 'example', '<xref ref-type="custom" custom-type="example" rid="example_2">示例</xref>'],
    ['[M-10.1.5-01] 被引用的有序列项（li_<k>）', 'li-a2', 'listItem', '<xref ref-type="list" rid="li_1">4.1 b）</xref>'],
    ['[M-10.1.1-04] 缩略语项', 'abb-1', 'abbreviation', '<xref ref-type="abbreviation" rid="abb_1">ADC</xref>'],
  ] as const)('%s', (_title, targetId, targetKind, expected) => {
    const { xml, problems } = x(targetId, '作者原文', targetKind)
    expect(xml).toBe(expected)
    expect(problems).toEqual([])
  })

  it('[M-10.1.1-02] rid 恒为单个标识符；内容是 Resolver 的 refText，作者原文不入内容', () => {
    const { xml } = x('cl-1', '见第四章')
    expect(xml).toBe('<xref ref-type="sec" rid="sec_4.1">4.1</xref>')
    expect(xml).not.toContain('见第四章')
  })

  it('[M-9.2.6-02] [M-9.2.6-03] 术语条目：在 p 里写成 xref[@ref-type="custom"][@custom-type="term-entry"]，内容取 run 自己的文本', () => {
    expect(x('term-1', '术语一', 'term').xml).toBe('<xref ref-type="custom" custom-type="term-entry" rid="term_3.1">术语一</xref>')
    expect(renderRuns(doc, [run('术语一', { type: 'termRef', targetId: 'term-1' })]).xml)
      .toBe('<xref ref-type="custom" custom-type="term-entry" rid="term_3.1">术语一</xref>')
  })

  it('[M-9.2.6-01] 术语条目：在 tbx 行内容器（定义/示例/注）里写成 tbx:entailedTerm[@target]', () => {
    const { xml } = renderRuns(doc, [run('见'), run('术语一', { type: 'termRef', targetId: 'term-1' }), run('。')], 'tbx')
    expect(xml).toBe('见<tbx:entailedTerm target="term_3.1">术语一</tbx:entailedTerm>。')
    // 内部可含格式（cm.inline），链接类 mark 在外层
    expect(renderRuns(doc, [run('术语一', { type: 'termRef', targetId: 'term-1' }, { type: 'bold' })], 'tbx').xml)
      .toBe('<tbx:entailedTerm target="term_3.1"><bold>术语一</bold></tbx:entailedTerm>')
  })

  it('[M-10.1.6-01] bibRef 写成 xref[@ref-type="bibr"]，内容取 run 自己的文本（D-X-10），不是 refText', () => {
    expect(renderRuns(doc, [run('GB/T 1—2020[1]', { type: 'bibRef', targetId: 'bib-1' })]).xml)
      .toBe('<xref ref-type="bibr" rid="biblref_1">GB/T 1—2020[1]</xref>')
    // 相邻同目标的 bibRef 的文本拼接（作者文本是内容）
    expect(renderRuns(doc, [run('[', { type: 'bibRef', targetId: 'bib-1' }), run('1]', { type: 'bibRef', targetId: 'bib-1' })]).xml)
      .toBe('<xref ref-type="bibr" rid="biblref_1">[1]</xref>')
  })

  it('索引整体（IRIndex）：ref-type="sec"，rid 是常量 sec_index（引用常量 id 的唯一情形），内容取 run 文本', () => {
    expect(x('index-1', '索引', 'index').xml).toBe('<xref ref-type="sec" rid="sec_index">索引</xref>')
  })

  it('引用文本里的格式 mark 在 xref 内层（rank：链接在外）', () => {
    expect(renderRuns(doc, [run('x', cross('cl-1', 'clause'), { type: 'bold' })]).xml)
      .toBe('<xref ref-type="sec" rid="sec_4.1"><bold>4.1</bold></xref>')
  })

  it('相邻且同目标的 crossRef run 只写一次 refText；目标不同则各写各的；中间有其他文本则分开', () => {
    expect(renderRuns(doc, [run('见', cross('cl-1')), run('四点一', cross('cl-1'))]).xml)
      .toBe('<xref ref-type="sec" rid="sec_4.1">4.1</xref>')
    expect(renderRuns(doc, [run('a', cross('cl-1')), run('b', cross('app-a'))]).xml)
      .toBe('<xref ref-type="sec" rid="sec_4.1">4.1</xref><xref ref-type="app" rid="sec_A">附录A</xref>')
    expect(renderRuns(doc, [run('a', cross('cl-1')), run('和'), run('b', cross('cl-1'))]).xml)
      .toBe('<xref ref-type="sec" rid="sec_4.1">4.1</xref>和<xref ref-type="sec" rid="sec_4.1">4.1</xref>')
  })

  it('crossRef 的换行不影响引用文本（文本由 Resolver 产生）', () => {
    expect(renderRuns(doc, [run('a\nb', cross('cl-1'))]).xml).toBe('<xref ref-type="sec" rid="sec_4.1">4.1</xref>')
  })

  describe('error：没有 id 方案或种类不符的目标（D-X-06，R-9）', () => {
    it.each([
      ['段落', 'body-p', 'paragraph'],
      ['代码块', 'code-1', undefined],
      ['警告', 'warn-1', undefined],
      ['摘录', 'quote-1', undefined],
      ['规范性引用条目', 'nr-1', undefined],
      ['无编号公式', 'f-un', 'formula'],
      ['术语条目中的示例（tbx:example 无 id）', 'term-ex', 'example'],
      ['无序列项', 'li-d1', 'listItem'],
    ] as const)('%s → xml-xref-target-unsupported', (_title, targetId, targetKind) => {
      const { xml, problems } = renderRuns(doc, [run('文', cross(targetId, targetKind))])
      expect(codesOf(problems, 'error')).toEqual(['xml-xref-target-unsupported'])
      expect(problems[0]).toMatchObject({ nodeId: 'test-owner', path: 'doc.test.content[0]' })
      expect(xml).toBe('文')
    })

    it('声明的 targetKind 与目标真实种类不一致 → xml-xref-target-unsupported', () => {
      const { problems } = renderRuns(doc, [run('文', cross('tab-1', 'figure'))])
      expect(codesOf(problems, 'error')).toEqual(['xml-xref-target-unsupported'])
      expect(problems[0]!.message).toContain('figure')
    })

    it('bibRef 的目标不是参考文献、termRef 的目标不是术语 → xml-xref-target-unsupported', () => {
      expect(codesOf(renderRuns(doc, [run('文', { type: 'bibRef', targetId: 'tab-1' })]).problems, 'error')).toEqual(['xml-xref-target-unsupported'])
      expect(codesOf(renderRuns(doc, [run('文', { type: 'termRef', targetId: 'cl-1' })]).problems, 'error')).toEqual(['xml-xref-target-unsupported'])
    })

    it('目标不存在 → xml-xref-target-missing', () => {
      const { problems } = renderRuns(doc, [run('文', cross('no-such-id'))])
      expect(codesOf(problems, 'error')).toEqual(['xml-xref-target-missing'])
    })

    it('labels 缺目标的标签（传入的 labels 与 IR 不一致）→ xml-xref-target-missing，不静默通过', () => {
      const labels = { ...resolve(doc).labels }
      delete labels['tab-1']
      const { problems, xml } = renderRuns(doc, [run('文', cross('tab-1', 'table'))], 'p', undefined, labels)
      expect(codesOf(problems, 'error')).toEqual(['xml-xref-target-missing'])
      expect(xml).toBe('文')
    })
  })

  describe('error：不可表达的 mark 组合 xml-mark-combination（设计 §2.3.2）', () => {
    it('同一 run 上两个链接类 mark（含 externalLink + crossRef）', () => {
      const { problems } = renderRuns(doc, [run('文', cross('cl-1'), { type: 'externalLink', href: 'https://example.org/' })])
      expect(codesOf(problems, 'error')).toEqual(['xml-mark-combination'])
      expect(problems[0]).toMatchObject({ nodeId: 'test-owner', path: 'doc.test.content[0]' })
    })

    it('stdRef 与链接、变量、代码、mixedCitation 任一共现', () => {
      for (const other of [cross('cl-1'), { type: 'externalLink', href: 'https://example.org/' }, { type: 'variable' }, { type: 'code' }, { type: 'mixedCitation' }] as IRMark[]) {
        const { problems } = renderRuns(doc, [run('GB/T 1', { type: 'stdRef' }, other)])
        expect(codesOf(problems, 'error'), JSON.stringify(other)).toEqual(['xml-mark-combination'])
      }
    })
  })
})

describe('正文标准引用与非标准化文件引用', () => {
  it('[M-10.2-01] [M-10.2-02] stdRef 写成 std/std-ref；格式 mark 在 std 外层', () => {
    expect(renderRuns(plain, [run('GB/T 1.1—2020', { type: 'stdRef' })]).xml).toBe('<std><std-ref>GB/T 1.1—2020</std-ref></std>')
    expect(renderRuns(plain, [run('GB/T 1', { type: 'stdRef' }, { type: 'bold' })]).xml).toBe('<bold><std><std-ref>GB/T 1</std-ref></std></bold>')
    expect(renderRuns(plain, [run('GB/T 1', { type: 'stdRef' }), run('.1', { type: 'stdRef' })]).xml).toBe('<std><std-ref>GB/T 1.1</std-ref></std>')
  })

  it('[M-10.1.7-01] mixedCitation 写成 mixed-citation，可含格式；换行用 break', () => {
    expect(renderRuns(plain, [run('Example Corp.', { type: 'mixedCitation' })]).xml).toBe('<mixed-citation>Example Corp.</mixed-citation>')
    expect(renderRuns(plain, [run('Example', { type: 'mixedCitation' }, { type: 'bold' })]).xml).toBe('<mixed-citation><bold>Example</bold></mixed-citation>')
    expect(renderRuns(plain, [run('甲\n乙', { type: 'mixedCitation' })]).xml).toBe('<mixed-citation>甲<break/>乙</mixed-citation>')
    expect(renderRuns(plain, [run('甲\n乙', { type: 'mixedCitation' }, { type: 'bold' })]).xml)
      .toBe('<mixed-citation><bold>甲</bold><break/><bold>乙</bold></mixed-citation>')
  })

  it('[M-10.1.7-01] mixed-citation 内可含 xref（mixed-citation 在外层）', () => {
    expect(renderRuns(doc, [run('x', { type: 'mixedCitation' }, cross('cl-1'))]).xml)
      .toBe('<mixed-citation><xref ref-type="sec" rid="sec_4.1">4.1</xref></mixed-citation>')
  })
})

describe('脚注与表脚注上标', () => {
  const footnoteRun = (id = 'fn-test', text = '脚注内容'): IRInline => ({ text: '正文', footnote: { id, content: [{ text }] } })
  const docWithFootnote = () => makeDoc([chapter('ch1', '范围', [para('p1', footnoteRun())], 'scope')])

  it('[M-10.1.1-03] [M-10.1.8-01] 正文脚注：xref[@ref-type="fn"] 紧随 fn（label/sup + p），同一个 p 内；xref 内容是 refText', () => {
    const docOne = docWithFootnote()
    const { xml, problems } = renderRuns(docOne, [{ text: '正文', footnote: { id: 'fn-test', content: [{ text: '脚注内容' }] } }])
    // 脚注的 id 来自 Resolver（fn_1）
    expect(xml).toBe('正文<xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><label><sup>1)</sup></label><p>脚注内容</p></fn>')
    expect(problems).toEqual([])
  })

  it('[M-10.1.8-01] 脚注原子不被正文的 marks 包裹，正文 marks 在原子之前结束', () => {
    const docOne = docWithFootnote()
    const { xml } = renderRuns(docOne, [{ text: '粗', marks: [{ type: 'bold' }], footnote: { id: 'fn-test', content: [{ text: '内容' }] } }, run('后', { type: 'bold' })])
    expect(xml).toBe('<bold>粗</bold><xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><label><sup>1)</sup></label><p>内容</p></fn><bold>后</bold>')
  })

  it('[M-10.1.8-01] 脚注不在 p 内（标题等 inline 容器）→ error xml-footnote-position', () => {
    const docOne = docWithFootnote()
    const { problems, xml } = renderRuns(docOne, [{ text: '标题', footnote: { id: 'fn-test', content: [{ text: '内容' }] } }], 'inline')
    expect(codesOf(problems, 'error')).toEqual(['xml-footnote-position'])
    expect(xml).toBe('标题')
    expect(problems[0]).toMatchObject({ nodeId: 'fn-test', path: 'doc.test.content[0].footnote' })
  })

  it('[M-10.1.8-01] 脚注在 citation 容器（mixed-citation 内）里允许：xref[fn] 紧随 fn，写在容器最外层（schema 的 cm.citation 含 fn；主导决定 2026-10-27）', () => {
    const docOne = docWithFootnote()
    const { xml, problems } = renderRuns(docOne, [{ text: '《计量法》', footnote: { id: 'fn-test', content: [{ text: '脚注内容' }] } }, run('后文')], 'citation')
    expect(xml).toBe('《计量法》<xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><label><sup>1)</sup></label><p>脚注内容</p></fn>后文')
    expect(problems).toEqual([])
  })

  it('[M-10.1.8-01] 脚注不被 stdRef 包装器包住：stdRef 文本上的脚注落在 std 元素之后；term/phrase/label/text/subsup/tbx 容器仍不允许脚注', () => {
    const docOne = docWithFootnote()
    const withStd: IRInline[] = [{ text: 'GB/T 1', marks: [{ type: 'stdRef' }], footnote: { id: 'fn-test', content: [{ text: '内容' }] } }]
    expect(renderRuns(docOne, withStd, 'p').xml)
      .toBe('<std><std-ref>GB/T 1</std-ref></std><xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><label><sup>1)</sup></label><p>内容</p></fn>')
    expect(renderRuns(docOne, withStd, 'citation').xml)
      .toBe('<std><std-ref>GB/T 1</std-ref></std><xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><label><sup>1)</sup></label><p>内容</p></fn>')
    for (const container of ['term', 'phrase', 'label', 'text', 'subsup', 'tbx', 'inline'] as const) {
      const { problems } = renderRuns(docOne, [{ text: '文', footnote: { id: 'fn-test', content: [{ text: '内容' }] } }], container)
      expect(codesOf(problems, 'error'), container).toEqual(['xml-footnote-position'])
    }
  })

  it('[M-6.2.3-10] [M-6.2.3-11] 表脚注上标：xref[@ref-type="table-fn"]，内容是字母 refText（不套 sup），多个依次排列', () => {
    const cell = doc.body[3]!.children[1]
    if (cell.kind !== 'table') throw new Error('fixture')
    const content = (cell.rows[0]!.cells[0]!.content[0] as { content: IRInline[] }).content
    const { xml, problems } = renderRuns(doc, content)
    expect(xml).toBe('值<xref ref-type="table-fn" rid="table-fn_1.1">a</xref><xref ref-type="table-fn" rid="table-fn_1.2">b</xref>')
    expect(problems).toEqual([])
  })
})

describe('容器内容模型（设计 §2.3.3）', () => {
  it('纯文本容器（text、subsup）：不允许的 mark 丢弃文字保留，warning mark-dropped-in-text-only', () => {
    const { xml, problems } = renderRuns(plain, [run('粗体', { type: 'bold' }), run('2', { type: 'sup' })], 'subsup')
    expect(xml).toBe('粗体<sup>2</sup>')
    expect(codesOf(problems)).toEqual(['mark-dropped-in-text-only'])
    expect(problems[0]).toMatchObject({ severity: 'warning', path: 'doc.test.content[0]' })
    const text = renderRuns(plain, [run('粗体', { type: 'bold' }), run('2', { type: 'sup' })], 'text')
    expect(text.xml).toBe('粗体2')
    expect(codesOf(text.problems)).toEqual(['mark-dropped-in-text-only', 'mark-dropped-in-text-only'])
  })

  it('纯文本容器里丢弃的 crossRef 保留 Resolver 的引用文本；丢弃的引用目标不会因此被登记为已引用', () => {
    const { xml, ctx } = renderRuns(doc, [run('见', cross('note-1', 'note'))], 'text')
    expect(xml).toBe('注')
    // 没有写出 xref，所以 note-1 不应被登记（P3 不会给它补 id）
    expect(codesOf(ctx.problems)).toEqual(['mark-dropped-in-text-only'])
  })

  it('纯文本容器里的行内公式、行内图 → error formula-in-text-only（文字会丢失）', () => {
    const formula = renderRuns(plain, [{ text: '', formula: { id: 'f-inline', latex: 'x' } }], 'text')
    expect(codesOf(formula.problems, 'error')).toEqual(['formula-in-text-only'])
    const image = renderRuns(plain, [{ text: '', image: { src: 'x.png' } }], 'subsup')
    expect(codesOf(image.problems, 'error')).toEqual(['formula-in-text-only'])
    expect(formula.problems[0]).toMatchObject({ path: 'doc.test.content[0].formula', nodeId: 'f-inline' })
  })

  it('其他容器（phrase、label、term、citation）里不允许的 mark → error xml-mark-combination', () => {
    expect(codesOf(renderRuns(doc, [run('x', cross('cl-1'))], 'phrase').problems, 'error')).toEqual(['xml-mark-combination'])
    expect(codesOf(renderRuns(plain, [run('x', { type: 'externalLink', href: 'https://example.org/' })], 'label').problems, 'error')).toEqual(['xml-mark-combination'])
    expect(codesOf(renderRuns(plain, [run('GB/T 1', { type: 'stdRef' })], 'term').problems, 'error')).toEqual(['xml-mark-combination'])
    expect(codesOf(renderRuns(plain, [run('x', { type: 'mixedCitation' })], 'citation').problems, 'error')).toEqual(['xml-mark-combination'])
  })

  it('允许的容器里写出对应元素：term 收 ext-link/xref，label 收 xref，citation 收 std', () => {
    expect(renderRuns(doc, [run('x', cross('cl-1'))], 'term').xml).toBe('<xref ref-type="sec" rid="sec_4.1">4.1</xref>')
    expect(renderRuns(doc, [run('x', cross('cl-1'))], 'label').xml).toBe('<xref ref-type="sec" rid="sec_4.1">4.1</xref>')
    expect(renderRuns(plain, [run('GB/T 1', { type: 'stdRef' })], 'citation').xml).toBe('<std><std-ref>GB/T 1</std-ref></std>')
    expect(renderRuns(plain, [run('粗', { type: 'bold' }), run('2', { type: 'sup' })], 'phrase').xml).toBe('<bold>粗</bold><sup>2</sup>')
  })
})

describe('换行（设计 §2.3.4）', () => {
  it('inline/p 容器：\\n 写成 break；格式元素内部不含 break，所以先收起（<bold>a</bold><break/><bold>b</bold>）', () => {
    expect(renderRuns(plain, [run('甲\n乙')]).xml).toBe('甲<break/>乙')
    expect(renderRuns(plain, [run('甲\n乙', { type: 'bold' })]).xml).toBe('<bold>甲</bold><break/><bold>乙</bold>')
    expect(renderRuns(plain, [run('\n')]).xml).toBe('<break/>')
    expect(renderRuns(plain, [run('甲\n'), run('乙')]).xml).toBe('甲<break/>乙')
  })

  it('链接元素内部同样不含 break', () => {
    expect(renderRuns(plain, [run('甲\n乙', { type: 'externalLink', href: 'https://example.org/' })]).xml)
      .toBe('<ext-link ext-link-type="uri" xlink:href="https://example.org/">甲</ext-link><break/><ext-link ext-link-type="uri" xlink:href="https://example.org/">乙</ext-link>')
  })

  it('不允许 break 的容器（term、phrase、label、subsup、text）：换行改为空格，warning newline-flattened', () => {
    for (const container of ['term', 'phrase', 'label', 'subsup', 'text'] as const) {
      const { xml, problems } = renderRuns(plain, [run('甲\n乙')], container)
      expect(xml, container).toBe('甲 乙')
      expect(codesOf(problems), container).toEqual(['newline-flattened'])
    }
  })

  it('[M-5.10-01] code mark 里的换行原样保留（不 flatten、不报问题）', () => {
    const { xml, problems } = renderRuns(plain, [run('a\nb', { type: 'code' })], 'term')
    expect(xml).toBe('<inline-code>a\nb</inline-code>')
    expect(problems).toEqual([])
  })
})

describe('tbx 容器', () => {
  it('tbx 容器是 inline 加 tbx:entailedTerm，其余 mark 照常写出', () => {
    expect(renderRuns(doc, [run('粗', { type: 'bold' }), run('2', { type: 'sup' })], 'tbx').xml).toBe('<bold>粗</bold><sup>2</sup>')
  })
})


it('[M-10.1.8-04] 两个共享脚注引用在定义之前，原位保留显示文本与唯一正文', () => {
  const content: IRInline[] = [{text:'首'}, {text:'',footnoteRef:{targetId:'shared',refText:'甲'}}, {text:'再次'}, {text:'',footnoteRef:{targetId:'shared',refText:'乙'}}, {text:'后'}, {text:'',footnoteDefinition:{id:'shared',content:[{text:'共享正文'}]}}]
  const source = makeDoc([chapter('c','范围',[para('p',...content)],'scope')])
  const result = exportXml46687(source,labelsOf(source),EMPTY_OPTIONS)
  expect(result.problems.filter(p=>p.severity === 'error')).toEqual([])
  const xml = result.xml!.replace(/>\s+</g,'><')
  expect(xml).toContain('首<xref ref-type="fn" rid="fn_1">甲</xref>再次<xref ref-type="fn" rid="fn_1">乙</xref>后<fn id="fn_1"><label><sup>1)</sup></label><p>共享正文</p></fn>')
  expect(xml.match(/<fn id="fn_1">/g)).toHaveLength(1)
})

it('[M-10.1.8-04] 悬空共享脚注不能导出', () => {
  const source = makeDoc([chapter('c','范围',[para('p',{text:'',footnoteRef:{targetId:'missing',refText:'1)'}})],'scope')])
  const result = exportXml46687(source,labelsOf(source),EMPTY_OPTIONS)
  expect(result.xml).toBeNull()
  expect(result.problems.some(p=>p.severity === 'error')).toBe(true)
})
