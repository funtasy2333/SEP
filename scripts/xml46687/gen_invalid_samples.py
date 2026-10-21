"""由同一个基底文档 + 单点改动生成 schemas/gbt46687.2/samples/invalid/ 下的负例。

用法（仓库根目录）：
    python3 -I scripts/xml46687/gen_invalid_samples.py            # 重新生成到默认目录
    python3 -I scripts/xml46687/gen_invalid_samples.py --out DIR  # 生成到别处

负例文件是提交进仓库的正式样例；本脚本只用于在 schema 变动后重新生成，并让测试
（test_validate.py 的 TestGeneratedSamplesUpToDate）确认仓库里的负例没有偏离生成结果。
每个负例的第二行注释写明违反项；除 gbt37967-root、sep-legacy-namespace、non-utf8-encoding 三个独立文档外，
其余都是基底文档 BASE 的单点改动，替换目标必须在 BASE 中恰好出现一次，否则报错。
"""
import argparse
import os
import sys
from pathlib import Path

_OUT = None
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "schemas" / "gbt46687.2" / "samples" / "invalid"

BASE = '''<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns:xlink="http://www.w3.org/1999/xlink"
          xmlns:mml="http://www.w3.org/1998/Math/MathML"
          xmlns:tbx="urn:iso:std:iso:30042:ed-1">
  <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml"
                   terminology-model="tbx" math-representation="mathml" tagset-family="sts"/>
  <front>
    <std-meta>
      <title-wrap xml:lang="zh">
        <full>负例基底文档</full>
      </title-wrap>
      <std-org-group>
        <std-org std-org-role="lead">
          <std-org-name>国家标准化管理委员会</std-org-name>
        </std-org>
      </std-org-group>
      <content-language>zh</content-language>
      <release-date>2026-04-30</release-date>
      <implementation-date>2026-11-01</implementation-date>
    </std-meta>
    <sec id="sec_foreword" sec-type="foreword">
      <title>前言</title>
      <p>前言内容。</p>
    </sec>
  </front>
  <body>
    <sec id="sec_1" sec-type="scope">
      <label>1</label>
      <title>范围</title>
      <p>范围内容，见<xref ref-type="table" rid="tab_1">表1</xref>、<xref ref-type="fig" rid="fig_1">图1</xref>、<xref ref-type="disp-formula" rid="formula_1">(1)</xref>，
      网站<ext-link ext-link-type="uri" xlink:href="https://example.org/">示例</ext-link>。</p>
    </sec>
    <sec id="sec_3" sec-type="terms">
      <label>3</label>
      <title>术语和定义</title>
      <term-sec id="sec_3.1">
        <label>3.1</label>
        <tbx:termEntry id="term_3.1">
          <tbx:langSet xml:lang="zh">
            <tbx:definition>术语的定义。</tbx:definition>
            <tbx:tig>
              <tbx:term>术语</tbx:term>
              <tbx:partOfSpeech value="noun"/>
              <tbx:normativeAuthorization value="preferredTerm"/>
            </tbx:tig>
          </tbx:langSet>
        </tbx:termEntry>
      </term-sec>
    </sec>
    <sec id="sec_5">
      <label>5</label>
      <title>技术要求</title>
      <table-wrap id="tab_1">
        <label>表1</label>
        <caption>
          <title>示例表</title>
        </caption>
        <table>
          <thead>
            <tr>
              <th>列</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>单元格</td>
            </tr>
          </tbody>
        </table>
      </table-wrap>
      <fig id="fig_1">
        <label>图1</label>
        <caption>
          <title>示例图</title>
        </caption>
        <graphic content-type="image" xlink:href="fig_1"/>
      </fig>
      <disp-formula id="formula_1">
        <label>(1)</label>
        <mml:math display="block" id="mml_m1">
          <mml:mi>x</mml:mi>
        </mml:math>
      </disp-formula>
      <sec id="sec_5.1">
        <label>5.1</label>
        <title>列项</title>
        <list list-type="dash">
          <list-item>
            <p>项一。</p>
          </list-item>
        </list>
        <list list-type="arabic">
          <list-item>
            <label>1)</label>
            <p>项二。</p>
          </list-item>
        </list>
      </sec>
      <sec id="sec_5.2" sec-type="numbered-paragraph">
        <label>5.2</label>
        <p>无标题条。</p>
      </sec>
    </sec>
  </body>
  <back>
    <app-group>
      <app id="sec_A" content-type="informative">
        <label>附录 A</label>
        <annex-type>（资料性）</annex-type>
        <title>附录</title>
        <p>附录内容。</p>
      </app>
    </app-group>
    <ref-list content-type="bibl" id="sec_bibl">
      <title>参考文献</title>
      <ref id="biblref_1">
        <label>[1]</label>
        <mixed-citation>文献条目。</mixed-citation>
      </ref>
    </ref-list>
  </back>
</standard>
'''

def mutate(text, pairs):
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            raise SystemExit("替换目标出现 %d 次（应为 1）：%r" % (n, old))
        text = text.replace(old, new)
    return text

def write(name, note, text, encoding='utf-8', ascii_only=False, standalone=False):
    # 在 XML 声明之后插入一行说明注释
    head, rest = text.split('?>\n', 1)
    if ascii_only:
        body = head + '?>\n<!-- negative sample: ' + note + ' -->\n' + rest
    elif standalone:
        body = head + '?>\n<!-- 负例：' + note + ' -->\n' + rest
    else:
        body = head + '?>\n<!-- 负例：' + note + ' 除此之外与基底文档一致。 -->\n' + rest
    with open(os.path.join(_OUT, name), 'w', encoding=encoding, newline='\n') as f:
        f.write(body)

CASES = []
def case(name, note, pairs): CASES.append((name, note, pairs))

# ---- 矩阵 import: reject ----
case('tex-math.xml', '公式中出现 tex-math（M-7.4-14，C-T-20：原文全文没有 tex-math，公式只用 mml:math）。',
     [('</mml:math>\n      </disp-formula>', '</mml:math>\n        <tex-math>x</tex-math>\n      </disp-formula>')])
case('alternatives.xml', '公式用 alternatives 包裹（M-7.4-15，C-T-20）。',
     [('        <mml:math display="block" id="mml_m1">\n          <mml:mi>x</mml:mi>\n        </mml:math>',
       '        <alternatives>\n          <mml:math display="block" id="mml_m1">\n            <mml:mi>x</mml:mi>\n          </mml:math>\n        </alternatives>')])
case('nested-table.xml', '单元格内嵌套 table-wrap（6.1 不使用嵌套表，M-6.1-06，C-T-13）。',
     [('<td>单元格</td>', '''<td>
                <table-wrap id="tab_2">
                  <label>表2</label>
                  <caption>
                    <title>嵌套表</title>
                  </caption>
                  <table>
                    <tbody>
                      <tr>
                        <td>内层</td>
                      </tr>
                    </tbody>
                  </table>
                </table-wrap>
              </td>''')])
case('tfoot.xml', '表内出现 tfoot（M-C.1-03，C-T-02：表注放 table-wrap-foot）。',
     [('          </tbody>\n        </table>', '          </tbody>\n          <tfoot>\n            <tr>\n              <td>注</td>\n            </tr>\n          </tfoot>\n        </table>')])
case('issue-agencies.xml', 'std-meta 内出现 issue-agencies（M-4.3.2-12，C-S-15）。',
     [('      <content-language>zh</content-language>', '      <issue-agencies>国家标准化管理委员会</issue-agencies>\n      <content-language>zh</content-language>')])
case('mathml-unprefixed.xml', 'mml:math 内的 MathML 元素缺少 mml: 前缀（7.4 示例 <mtext> 笔误，M-7.4-12）。',
     [('<mml:mi>x</mml:mi>', '<mtext>x</mtext>')])
case('std-in-tbx-source.xml', 'tbx:source 内加了 std（9.2.8，M-9.2.8-02）。',
     [('            <tbx:definition>术语的定义。</tbx:definition>',
       '            <tbx:definition>术语的定义。</tbx:definition>\n            <tbx:source><std><std-ref>GB/T 1.1</std-ref></std></tbx:source>')])
case('admn-sts-value.xml', '采用级别取值 preferredTerm-admn-sts（全文无 -admn-sts 取值，M-9.2.3-06，C-T-39）。',
     [('<tbx:normativeAuthorization value="preferredTerm"/>', '<tbx:normativeAuthorization value="preferredTerm-admn-sts"/>')])

# ---- V-1 ----
case('dup-id.xml', '两个元素使用同一 id（V-1）。',
     [('<sec id="sec_5.2" sec-type="numbered-paragraph">', '<sec id="sec_5.1" sec-type="numbered-paragraph">')])
case('dangling-rid.xml', 'xref 的 rid 指向不存在的 id（V-1）。',
     [('<xref ref-type="table" rid="tab_1">', '<xref ref-type="table" rid="tab_99">')])
# ---- V-2 ----
case('front-scope-sec.xml', 'front 内的 sec 使用了 sec-type="scope"（V-2：front 只能是 foreword/intro）。',
     [('<sec id="sec_foreword" sec-type="foreword">', '<sec id="sec_foreword" sec-type="scope">')])
case('numbered-paragraph-with-title.xml', 'sec-type="numbered-paragraph" 的无标题条却带 title（V-2，4.4.2.5）。',
     [('        <label>5.2</label>\n        <p>无标题条。</p>', '        <label>5.2</label>\n        <title>不应有标题</title>\n        <p>无标题条。</p>')])
case('chapter-sec-type-intro.xml', 'body 顶层的章使用了 sec-type="intro"（V-2：intro 只用于 front）。',
     [('<sec id="sec_5">', '<sec id="sec_5" sec-type="intro">')])
# ---- V-3 ----
case('bad-app-content-type.xml', 'app/@content-type 取值 annex（V-3：只接受 informative/normative）。',
     [('<app id="sec_A" content-type="informative">', '<app id="sec_A" content-type="annex">')])
case('bad-ref-list-content-type.xml', 'ref-list/@content-type 取值 references（V-3：只接受 norm-refs/bibl）。',
     [('<ref-list content-type="bibl" id="sec_bibl">', '<ref-list content-type="references" id="sec_bibl">')])
# ---- V-4 ----
case('impl-date-in-release-date.xml', '实施日期同时写成 release-date[@date-type="implemented"] 与 implementation-date（V-4：两种写法不得重复表达同一日期）。',
     [('      <release-date>2026-04-30</release-date>\n      <implementation-date>2026-11-01</implementation-date>',
       '      <release-date>2026-04-30</release-date>\n      <release-date date-type="implemented">2026-11-01</release-date>\n      <implementation-date>2026-11-01</implementation-date>')])
case('dup-release-date.xml', '把实施日期放进第二个 release-date（旧 SEP 的错误映射，V-4：发布日期重复表达）。',
     [('      <release-date>2026-04-30</release-date>\n      <implementation-date>2026-11-01</implementation-date>',
       '      <release-date>2026-04-30</release-date>\n      <release-date>2026-11-01</release-date>')])
case('bad-date-format.xml', 'release-date 写成 2026/04/30（V-4：必须 YYYY-MM-DD）。',
     [('<release-date>2026-04-30</release-date>', '<release-date>2026/04/30</release-date>')])
case('invalid-calendar-date.xml', 'implementation-date 为不存在的日期 2026-02-30（V-4）。',
     [('<implementation-date>2026-11-01</implementation-date>', '<implementation-date>2026-02-30</implementation-date>')])
# ---- V-5 ----
case('bad-list-type.xml', 'list/@list-type 取值 simple（V-5：只接受 alpha-lower/arabic/roman-lower/dash/bullet）。',
     [('<list list-type="dash">', '<list list-type="simple">')])
case('unordered-list-label.xml', '无序列项（dash）的 list-item 带了 label（V-5）。',
     [('          <list-item>\n            <p>项一。</p>', '          <list-item>\n            <label>—</label>\n            <p>项一。</p>')])
# ---- V-6 ----
case('bad-processing-meta.xml', 'processing-meta/@table-model 取值 html5（V-6：固定为 xhtml）。',
     [('table-model="xhtml"', 'table-model="html5"')])
case('title-wrap-no-lang.xml', 'title-wrap 缺少 xml:lang（V-6）。',
     [('<title-wrap xml:lang="zh">', '<title-wrap>')])
# ---- V-7 ----
case('ext-id.xml', 'id 以 ext_ 开头（V-7：Resolver 占位 id 不得进入 XML）。',
     [('<p>前言内容。</p>', '<p id="ext_9f3a1c">前言内容。</p>')])
case('formula-id.xml', '公式 id 写成 Formula1（V-7：应为 formula_1；示例瑕疵形式）。',
     [('<disp-formula id="formula_1">', '<disp-formula id="Formula1">'), ('rid="formula_1"', 'rid="Formula1"')])
case('uuid-id.xml', '图的 id 为 id-<uuid> 形式（V-7：转换工具生成物）。',
     [('<fig id="fig_1">', '<fig id="id-2a2aa2f4-554c-4359-c583-24cfce9ff7ab">'),
      ('rid="fig_1"', 'rid="id-2a2aa2f4-554c-4359-c583-24cfce9ff7ab"')])
case('p-number-id.xml', '段落 id 为 p-125 形式（V-7：p 不带 id）。',
     [('<p>附录内容。</p>', '<p id="p-125">附录内容。</p>')])
# ---- V-8 ~ V-11 ----
case('fn-xref-to-table-footnote.xml', 'xref[ref-type=fn] 指向 table-wrap-foot 内的表脚注（V-8：表脚注只能用 ref-type=table-fn 引用，C-T-06、表 6-A）。',
     [('        </table>\n      </table-wrap>', '        </table>\n        <table-wrap-foot>\n          <fn id="table-fn_1.1">\n            <label>a</label>\n            <p>表脚注。</p>\n          </fn>\n        </table-wrap-foot>\n      </table-wrap>'),
      ('<p>前言内容。</p>', '<p>前言内容<xref ref-type="fn" rid="table-fn_1.1">a</xref>。</p>')])
case('table-fn-xref-to-body-fn.xml', 'xref[ref-type=table-fn] 指向正文脚注（V-8：table-fn 只能指向同一 table-wrap 的 table-wrap-foot 内的表脚注，C-T-06）。',
     [('<p>前言内容。</p>', '<p>前言内容<xref ref-type="table-fn" rid="fn_1">1)</xref><fn id="fn_1"><label>1)</label><p>正文脚注。</p></fn>。</p>')])
case('wrong-xref-type.xml', 'xref 的 ref-type="fig" 却指向表（V-8）。',
     [('<xref ref-type="table" rid="tab_1">', '<xref ref-type="fig" rid="tab_1">')])
case('term-two-definitions.xml', '同一术语条目的两个 langSet 各有一个定义（V-9：有且仅有一个）。',
     [('          </tbx:langSet>\n        </tbx:termEntry>',
       '          </tbx:langSet>\n          <tbx:langSet xml:lang="en">\n            <tbx:definition>Second definition.</tbx:definition>\n            <tbx:tig>\n              <tbx:term>term</tbx:term>\n            </tbx:tig>\n          </tbx:langSet>\n        </tbx:termEntry>')])
case('mathml-onclick.xml', 'mml:math 带事件属性 onclick（V-10：MathML 不含脚本/事件属性）。',
     [('<mml:math display="block" id="mml_m1">', '<mml:math display="block" id="mml_m1" onclick="alert(1)">')])
case('js-ext-link.xml', 'ext-link 使用 javascript: 协议（V-11）。',
     [('xlink:href="https://example.org/"', 'xlink:href="javascript:alert(1)"')])
case('ext-link-tab-in-scheme.xml', 'ext-link 的协议被 tab 打断：java&#x9;script:（V-11：浏览器会先删掉 tab 再识别协议，所以 URL 里含任何控制字符都拒绝）。',
     [('xlink:href="https://example.org/"', 'xlink:href="java&#x9;script:alert(1)"')])
case('ext-link-newline-in-url.xml', 'ext-link 的 URL 里含换行（&#x0A;，V-11：URL 里不得有控制字符）。',
     [('xlink:href="https://example.org/"', 'xlink:href="https://example.org/&#x0A;x"')])
case('mathml-href-control-char.xml', 'mml:math 的 href 里含 tab（V-10：与 ext-link 同一套 URL 检查）。',
     [('<mml:math display="block" id="mml_m1">', '<mml:math display="block" id="mml_m1" href="java&#x9;script:alert(1)">')])
case('mathml-id-missing.xml', 'mml:math 缺 id（矩阵 M-7.4-02、M-7.1-05：export required 的 mml_m<k>，C-T-18）。结构层 id 可选：import 档通过并告警 V-14 MML-ID，export 档为错误（仅 export 档的负例）。',
     [('<mml:math display="block" id="mml_m1">', '<mml:math display="block">')])
case('mathml-display-inline-in-disp-formula.xml', 'disp-formula 内的 mml:math 取 display="inline"（行间公式应为 block，C-T-19、M-7.4-03）。import 档通过并告警 V-15 MML-DISPLAY，export 档为错误（仅 export 档的负例）。',
     [('<mml:math display="block" id="mml_m1">', '<mml:math display="inline" id="mml_m1">')])
# ---- 矩阵 export required 的部件（V-17/V-9/V-18）：结构层放宽，导出严格、导入宽容 ----
case('sec-without-label.xml', '条缺 label（章条编号，矩阵 M-4.4.2.1-02 shall）。结构层只要 label 或 title 之一：import 档通过并告警 V-17，export 档为错误（仅 export 档的负例）。',
     [('      <sec id="sec_5.1">\n        <label>5.1</label>\n', '      <sec id="sec_5.1">\n')])
case('app-without-annex-type.xml', 'app 缺 annex-type（矩阵 M-4.5.2-04 shall）。import 档通过并告警 V-17，export 档为错误（仅 export 档的负例）。',
     [('        <annex-type>（资料性）</annex-type>\n', '')])
case('ext-link-without-type.xml', 'ext-link 缺 ext-link-type="uri"（矩阵 M-10.1.9-01 shall；原文 10.1.9 示例就缺该属性，所以 import 档不报告）。export 档为错误（仅 export 档的负例）。',
     [('<ext-link ext-link-type="uri" xlink:href="https://example.org/">', '<ext-link xlink:href="https://example.org/">')])
case('table-wrap-without-label.xml', 'table-wrap 缺 label（表编号，矩阵 M-6.2.1-03 shall）。import 档通过并告警 V-17，export 档为错误（仅 export 档的负例）。',
     [('      <table-wrap id="tab_1">\n        <label>表1</label>\n', '      <table-wrap id="tab_1">\n')])
case('term-entry-without-definition.xml', '术语条目没有 tbx:definition（矩阵 M-9.2.2-01 shall：必须有且仅有一个定义）。import 档通过并告警 W-TERM-NODEF，export 档为错误 V-9（仅 export 档的负例）。',
     [('            <tbx:definition>术语的定义。</tbx:definition>\n', '')])
case('p-with-id.xml', 'p 带 id（附录 E：p 中无任何 id；矩阵 M-E-25）。import 档通过并告警 V-18，export 档为错误（仅 export 档的负例）。',
     [('<p>附录内容。</p>', '<p id="para_1">附录内容。</p>')])
case('encoding-declared-after-400-bytes.xml', 'XML 声明里 version 与 encoding 之间塞了 450 个空格，encoding="ISO-8859-1" 排在第 400 字节之后（SYN-2：声明要看完整，不能只看开头 400 字节）。',
     [('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"' + ' ' * 450 + 'encoding="ISO-8859-1"?>')])
# ---- 仅结构（RNG）----
case('mixed-cell-content.xml', '单元格内 p 与文本混排（C-T-11：仅行内，或仅 p/list）。',
     [('<td>单元格</td>', '<td><p>段落</p>散落文本</td>')])
case('tbx-langset-no-lang.xml', 'tbx:langSet 缺少 xml:lang（C-T-43）。',
     [('<tbx:langSet xml:lang="zh">', '<tbx:langSet>')])
case('wrong-root.xml', '根元素不是 standard（C-S-01）。',
     [('<standard xmlns:xlink', '<document xmlns:xlink'), ('</standard>', '</document>')])

case('tbx-term-entry-alias.xml', 'tbx:termEntry 写成 tbx:term-entry（M-9.2.1-09：只在 9.2.1 引导句出现，疑为原文笔误，2026-10-21 起 REJECT）。',
     [('<tbx:termEntry id="term_3.1">', '<tbx:term-entry id="term_3.1">'), ('</tbx:termEntry>', '</tbx:term-entry>')])
case('tbx-definition-alias.xml', 'tbx:definition 写成 tbx:Definition（M-9.2.1-08：只在 9.2.1 说明文字出现，疑为原文笔误，2026-10-21 起 REJECT）。',
     [('<tbx:definition>术语的定义。</tbx:definition>', '<tbx:Definition>术语的定义。</tbx:Definition>')])
case('tbx-normative-authorization-alias.xml', 'tbx:normativeAuthorization 写成 tbx:normative-Authorization（M-C.1-06：附录 C 断行写法，疑为原文笔误，2026-10-21 起 REJECT）。',
     [('<tbx:normativeAuthorization value="preferredTerm"/>', '<tbx:normative-Authorization value="preferredTerm"/>')])
case('tbx-grammatical-number-alias.xml', 'tbx:grammaticalNumber 写成 tbx:grammatical-Number（M-C.1-07：附录 C 断行写法，疑为原文笔误，2026-10-21 起 REJECT）。',
     [('              <tbx:partOfSpeech value="noun"/>\n', '              <tbx:partOfSpeech value="noun"/>\n              <tbx:grammatical-Number value="singular"/>\n')])
case('std-meta-wrong-order.xml', 'std-meta 子元素次序不是导出次序（release-date 排在 content-language 之前）。结构层不限次序：import 档通过并告警 V-12 STD-META-ORDER，export 档为错误（仅 export 档的负例）。',
     [('      <content-language>zh</content-language>\n      <release-date>2026-04-30</release-date>', '      <release-date>2026-04-30</release-date>\n      <content-language>zh</content-language>')])
# 必备 id（V-13 REQUIRED-ID）：结构层 id 一律可选，所以 import 档只告警，只有 export 档失败（仅 export 档的负例）
case('missing-term-entry-id.xml', 'tbx:termEntry 缺 id（9.2.1 印刷页 35，shall）。结构层 id 可选：import 档通过并告警 V-13 REQUIRED-ID，export 档为错误（仅 export 档的负例）。',
     [('<tbx:termEntry id="term_3.1">', '<tbx:termEntry>')])
case('missing-app-id.xml', 'app 缺 id（附录 E 印刷页 67，M-E-04）。import 档通过并告警 V-13，export 档为错误（仅 export 档的负例）。',
     [('<app id="sec_A" content-type="informative">', '<app content-type="informative">')])
case('missing-ref-id.xml', '参考文献的 ref 缺 id（4.5.3.1 印刷页 12，shall）。import 档通过并告警 V-13，export 档为错误（仅 export 档的负例）。',
     [('<ref id="biblref_1">', '<ref>')])
# xref[ref-type=custom]：缺 custom-type 导入告警、导出错误；目标不是术语条目/注/示例，或与 custom-type 不一致，两档都是错误（V-8）
case('custom-xref-no-type.xml', 'xref[ref-type=custom] 缺 custom-type（10.1.1：term-entry、note、example 三选一）。import 档通过并告警 V-8 CUSTOM-TYPE（导入器按 rid 目标推断），export 档为错误（仅 export 档的负例）。',
     [('<p>前言内容。</p>', '<p>前言<xref ref-type="custom" rid="term_3.1">术语</xref>内容。</p>')])
case('custom-xref-wrong-target.xml', 'xref[ref-type=custom custom-type=note] 指向术语条目（custom-type 与目标不一致，V-8，C-T-50）。',
     [('<p>前言内容。</p>', '<p>前言<xref ref-type="custom" custom-type="note" rid="term_3.1">术语</xref>内容。</p>')])
case('custom-xref-to-section.xml', 'xref[ref-type=custom] 没有 custom-type，且指向章（custom 的目标只能是术语条目、注或示例，V-8，C-T-48）。',
     [('<p>前言内容。</p>', '<p>前言<xref ref-type="custom" rid="sec_1">范围</xref>内容。</p>')])
# ---- 容器位置（V-2 term-sec、V-3 参考文献表）：结构层允许，语义规则拒绝 ----
case('bibl-ref-list-in-app.xml', '参考文献表（ref-list content-type=bibl）放在附录里（V-3：必须是 back 的直接子元素，4.5.3、C-S-27）。',
     [('<p>附录内容。</p>', '<p>附录内容。</p>\n        <ref-list content-type="bibl" id="sec_bibl_app">\n          <ref id="biblref_9">\n            <label>[9]</label>\n            <mixed-citation>附录里的文献条目。</mixed-citation>\n          </ref>\n        </ref-list>')])
case('term-sec-outside-terms.xml', 'term-sec 放在附录里，不在“术语和定义”章内（V-2：9.1、C-S-25、C-T-37）。',
     [('<p>附录内容。</p>', '<p>附录内容。</p>\n        <term-sec id="sec_A.1">\n          <label>A.1</label>\n          <tbx:termEntry id="term_A.1">\n            <tbx:langSet xml:lang="zh">\n              <tbx:definition>附录里的术语定义。</tbx:definition>\n              <tbx:tig>\n                <tbx:term>附录术语</tbx:term>\n              </tbx:tig>\n            </tbx:langSet>\n          </tbx:termEntry>\n        </term-sec>')])
case('sec-block-after-subsec.xml', '含子条的条在子条之后又放了段落（STS 1.2 的 sec 内容模型：块在前，子条在后，其后只能是注、示例、清单）。',
     [('        <p>无标题条。</p>\n      </sec>\n    </sec>\n  </body>', '        <p>无标题条。</p>\n      </sec>\n      <p>悬置段落。</p>\n    </sec>\n  </body>')])
case('bad-part-of-speech.xml', 'tbx:partOfSpeech 取值 pron（只收 noun/verb/adj/adv，STS 1.2 的枚举）。',
     [('<tbx:partOfSpeech value="noun"/>', '<tbx:partOfSpeech value="pron"/>')])
case('named-content-without-type.xml', 'named-content 缺必备属性 content-type（表 D.1 行 3，STS 1.2 同为必备）。',
     [('<p>前言内容。</p>', '<p>前言<named-content>x</named-content>内容。</p>')])
case('empty-table-wrap-foot.xml', '空的 table-wrap-foot（STS 1.2 要求至少一个子元素；没有表注时应省略整个元素）。',
     [('        </table>\n      </table-wrap>', '        </table>\n        <table-wrap-foot/>\n      </table-wrap>')])


case('caption-two-titles.xml', '表的 caption 内有第二个 title（英文表题，M-6.2.1-06，D-T-03：原文只有单个 title）。',
     [('<title>示例表</title>', '<title>示例表</title>\n          <title>Example table</title>')])
case('fig-footnote.xml', 'fig 内出现 fn（图脚注，M-8.6-02，C-T-32：原文未规定标记）。',
     [('        <graphic content-type="image" xlink:href="fig_1"/>', '        <graphic content-type="image" xlink:href="fig_1"/>\n        <fn id="fn_1">\n          <label>a</label>\n          <p>图脚注。</p>\n        </fn>')])
case('fig-footnote-in-caption.xml', 'fig 的 caption 内的段落里有 fn（图脚注，M-8.6-02，C-T-32：fn 在图内任何位置都算，不只是 fig 的直接子元素）。结构层允许，只有 REJECT 规则拒绝。',
     [('          <title>示例图</title>\n        </caption>', '          <title>示例图</title>\n          <p>单位说明<fn id="fn_1"><label>a</label><p>图脚注。</p></fn></p>\n        </caption>')])
case('nested-term-entry.xml', 'tbx:termEntry 内嵌套另一个 tbx:termEntry（M-9.1-03，C-T-47）。',
     [('            <tbx:definition>术语的定义。</tbx:definition>', '            <tbx:definition>术语的定义。</tbx:definition>\n            <tbx:termEntry id="term_3.2">\n              <tbx:langSet xml:lang="zh">\n                <tbx:tig>\n                  <tbx:term>子条目</tbx:term>\n                </tbx:tig>\n              </tbx:langSet>\n            </tbx:termEntry>')])
case('definition-target.xml', 'tbx:definition 带 target 属性（M-C.1-08：仅附录 C 列出，无解释）。',
     [('<tbx:definition>术语的定义。</tbx:definition>', '<tbx:definition target="term_3.1">术语的定义。</tbx:definition>')])
case('dangling-entailed-term.xml', 'tbx:entailedTerm 的 target 指向不存在的术语条目（V-1）。',
     [('<tbx:definition>术语的定义。</tbx:definition>', '<tbx:definition>引用<tbx:entailedTerm target="term_9.9">另一术语</tbx:entailedTerm>的定义。</tbx:definition>')])
case('unknown-element.xml', '段落内出现 schema 未定义的元素 blink（RELAX NG）。',
     [('<p>项一。</p>', '<p>项一<blink>闪</blink>。</p>')])


ASCII_MIN = '''<?xml version="1.0" encoding="GB2312"?>
<standard>
  <front>
    <std-meta>
      <title-wrap xml:lang="zh">
        <full>Minimal</full>
      </title-wrap>
    </std-meta>
  </front>
  <body>
    <sec id="sec_1" sec-type="scope">
      <label>1</label>
      <title>Scope</title>
      <p>Text.</p>
    </sec>
  </body>
</standard>
'''

G37967 = '''<?xml version="1.0" encoding="UTF-8"?>
<standard>
  <content>
    <basic_info>
      <cn>棉蚜测报技术规范</cn>
      <en lang="en">Rules for monitoring and forecast of the cotton aphid</en>
      <ics>65.020.01</ics>
      <gbn>GB/T 99999</gbn>
      <isd>2019-05-10</isd>
      <efd>2019-12-01</efd>
    </basic_info>
    <auxiliary_info>
      <preface>前言内容。</preface>
      <scope>本标准规定了调查方法。</scope>
      <normativereference>
        <n_docum>GB/T 1.1</n_docum>
      </normativereference>
    </auxiliary_info>
  </content>
</standard>
'''

SEP_LEGACY = '''<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns="urn:csbts:std:xml:1.0">
  <front>
    <std-meta>
      <std-ref>GB/T 99999—2026</std-ref>
      <title-wrap lang="zh">
        <main>旧格式示例</main>
      </title-wrap>
      <pub-date>2026-04-30</pub-date>
      <release-date>2026-11-01</release-date>
      <std-type>national</std-type>
    </std-meta>
  </front>
  <body>
    <foreword>
      <p>前言内容。</p>
    </foreword>
    <sec id="sec_1">
      <title>范围</title>
      <p>内容。</p>
    </sec>
  </body>
</standard>
'''


def generate(out_dir):
    """生成全部负例到 out_dir，返回个数。"""
    global _OUT
    _OUT = str(out_dir)
    os.makedirs(_OUT, exist_ok=True)
    for name, note, pairs in CASES:
        write(name, note, mutate(BASE, pairs))
    # ---- 语法 ----
    write('not-wellformed.xml', 'XML 不是格式良好的（SYN-1：p 元素未闭合）。',
          mutate(BASE, [('<p>前言内容。</p>', '<p>前言内容。')]))
    write('doctype-internal-subset.xml', 'DOCTYPE 含内部子集和实体声明（SYN-3：不展开实体、不加载 DTD）。',
          mutate(BASE, [('?>\n<standard xmlns:xlink', '?>\n<!DOCTYPE standard [\n  <!ENTITY note "实体文本">\n]>\n<standard xmlns:xlink')]))
    write('non-utf8-encoding.xml', 'XML declaration says encoding GB2312 (SYN-2: only UTF-8 is accepted; GB2312 is a GB/T 37967 legacy feature).',
          ASCII_MIN, ascii_only=True)
    # ---- 旧格式 ----
    write('gbt37967-root.xml', '采用 GB/T 37967 的顶层结构 standard/content/basic_info（LEGACY：旧格式，本版本不再支持）。',
          G37967, standalone=True)
    write('sep-legacy-namespace.xml', '默认命名空间 urn:csbts:std:xml:1.0 的 SEP 早期自定义格式（LEGACY：旧格式，本版本不再支持）。',
          SEP_LEGACY, standalone=True)
    return len(CASES) + 5


def main(argv=None):
    ap = argparse.ArgumentParser(description='生成 GB/T 46687.2 schema 的负例样例')
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    args = ap.parse_args(argv)
    n = generate(args.out)
    print('生成 %d 个负例 -> %s' % (n, args.out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
