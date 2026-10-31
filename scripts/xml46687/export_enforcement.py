#!/usr/bin/env python3
"""支持矩阵 export 为 required 的行：导出档由谁强制？（项目实现约定，非官方）

PR#55 审查多次发现同一类缺口：矩阵写了 export required、obligation 为 shall/should，校验器的 export 档却没人强制
（必备 id、mml:math 的 id/display、custom-type……）。本模块把这类核对做成系统性的检查：

  * 对矩阵里 export 为 required 的每一行，以及其 attributes 中 obligation 为 shall/should 且带固定取值的每个属性，
    在 ENTRIES 里登记“谁在 export 档强制它”：
      探针（probe）  某个样例做一处改动后，必须真的被 schema（RELAX NG）或 validate.py 的某条规则拒绝；
      NA:原因        不适用，并说明理由（取决于 IR 内容、原文只有示例、元数据必填留 WP8.2 ……）
  * 每个探针都会真的运行：基准样例在 export 档必须无错误，改动后必须出现预期的失败（schema 拒绝，或指定规则报错），
    同时核对 import 档的行为（告警 / 不报告 / 同样是错误）——即“导出严格、导入宽容”的模式确实成立。
  * 矩阵里出现了没有登记的 export required 行（或属性），或探针没有得到预期结果，matrix_coverage.py 失败。

数据与运行逻辑都在这里；matrix_coverage.py 的“导出档强制核对”一节调用 audit()，README 里的表由 render_markdown() 生成。
"""

from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
from pathlib import Path

from lxml import etree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SAMPLES = ROOT / "schemas" / "gbt46687.2" / "samples" / "valid"
NSMAP = {"tbx": "urn:iso:std:iso:30042:ed-1", "mml": "http://www.w3.org/1998/Math/MathML",
         "xlink": "http://www.w3.org/1999/xlink", "xml": "http://www.w3.org/XML/1998/namespace"}

# --------------------------------------------------------------------------------------------
# 探针：id -> (样例, 改动, 预期, import 档行为, 说明)
#   改动  ("remove", xpath) 删第一个匹配元素；("remove_all", xpath)；("remove_attr", xpath, 属性)；("remove_id", xpath)：
#         删去第一个匹配元素的 id，并把引用它的 xref / tbx:entailedTerm 换成纯文本（否则 V-1 会先报悬空，盖住要检查的 V-13）；
#         ("prepend_text", xpath, 文本) 在第一个匹配元素开头加散落文本；("unwrap", xpath) 去掉第一个匹配元素的标签、保留内容；
#         ("rename_root", 新名)；
#         ("set_attr", xpath, 属性, 值)；("replace", 旧文本, 新文本)（样例原文，必须恰好出现一次）
#   预期  ("schema",)：RELAX NG（lxml 与 xmllint）拒绝；("rule", 规则号)：export 档出现该规则的错误
#   import 档（仅规则探针）  "warn"：文档通过且该规则（或 import 告警名）作为告警出现；"silent"：不报告；"error"：import 档也是错误
# --------------------------------------------------------------------------------------------

def _p(sample, op, expect, desc, imp="warn", imp_rule=None):
    return {"sample": sample, "op": op, "expect": expect, "desc": desc, "imp": imp, "imp_rule": imp_rule}


S01, S03, S04, S05, S06 = ("01-minimal.xml", "03-structure.xml", "04-tables.xml", "05-formulas-figures.xml", "06-terms-references.xml")
SCHEMA = ("schema",)


def R(rule):
    return ("rule", rule)


PROBES = {
    # ---- 结构层（RELAX NG）必选 ----
    "S-root": _p(S01, ("rename_root", "article"), SCHEMA, "根元素必须是 standard"),
    "S-sec-text": _p(S03, ("prepend_text", "//body/sec[1]", "散落文本"), SCHEMA, "正文文本必须放在 p 里，不能直接放在 sec 下"),
    "S-app-group": _p(S03, ("unwrap", "//app-group"), SCHEMA, "app 必须放在 app-group 里"),
    "S-front": _p(S01, ("remove", "//front"), SCHEMA, "standard 必须有 front"),
    "S-body": _p(S01, ("remove", "//body"), SCHEMA, "standard 必须有 body（至少一个章）"),
    "S-std-meta": _p(S01, ("remove", "//std-meta"), SCHEMA, "front 必须有 std-meta"),
    "S-title-wrap": _p(S01, ("remove", "//title-wrap"), SCHEMA, "std-meta 至少有一个 title-wrap"),
    "S-title-wrap-lang": _p(S01, ("remove_attr", "//title-wrap", "{xml}lang"), SCHEMA, "title-wrap 必须有 xml:lang"),
    "S-foreword-title": _p(S03, ("remove", "//front/sec[@sec-type='foreword']/title"), SCHEMA, "前言 sec 必须有 title"),
    "S-front-sec-type": _p(S03, ("remove_attr", "//front/sec", "sec-type"), SCHEMA, "front 内的 sec 必须带 sec-type=foreword/intro"),
    "S-chapter-title": _p(S03, ("remove", "//body/sec/title"), SCHEMA, "章（body 顶层 sec）必须有 title"),
    "S-app-content-type": _p(S03, ("remove_attr", "//app", "content-type"), SCHEMA, "app 必须有 content-type"),
    "S-app-title": _p(S03, ("remove", "//app/title"), SCHEMA, "app 必须有 title"),
    "S-reflist-content-type": _p(S03, ("remove_attr", "//back/ref-list", "content-type"), SCHEMA, "ref-list 必须有 content-type"),
    "S-ref-body": _p(S03, ("remove_all", "//back/ref-list/ref/*[self::mixed-citation or self::std]"), SCHEMA, "ref 必须含 std 或 mixed-citation"),
    "S-named-content-type": _p(S03, ("remove_attr", "//named-content", "content-type"), SCHEMA, "named-content 必须有 content-type"),
    "S-list-type": _p(S03, ("remove_attr", "//list", "list-type"), SCHEMA, "list 必须有 list-type"),
    "S-list-type-value": _p(S03, ("set_attr", "//list", "list-type", "simple"), SCHEMA, "list-type 只收 alpha-lower/arabic/roman-lower/dash/bullet"),
    "S-list-item": _p(S03, ("remove_all", "//list/list-item"), SCHEMA, "list 必须有 list-item"),
    "S-list-item-p": _p(S03, ("remove_all", "//list-item/p"), SCHEMA, "list-item 必须有内容"),
    "S-quote-p": _p(S03, ("remove_all", "//disp-quote/p"), SCHEMA, "摘录必须有 p"),
    "S-extlink-href": _p(S03, ("remove_attr", "//ext-link", "{xlink}href"), SCHEMA, "ext-link 必须有 xlink:href"),
    "S-table": _p(S04, ("remove", "//table-wrap/table"), SCHEMA, "table-wrap 必须有 table"),
    "S-tbody": _p(S04, ("remove_all", "//table/tbody"), SCHEMA, "table 必须有 tbody"),
    "S-tr": _p(S04, ("remove_all", "//tbody/tr"), SCHEMA, "tbody 必须有 tr"),
    "S-td": _p(S04, ("remove_all", "//tbody/tr/td"), SCHEMA, "tr 必须有单元格"),
    "S-colspan": _p(S04, ("set_attr", "//td[@colspan]", "colspan", "0"), SCHEMA, "colspan 必须是正整数"),
    "S-rowspan": _p(S04, ("set_attr", "//*[@rowspan]", "rowspan", "0"), SCHEMA, "rowspan 必须是正整数"),
    "S-orientation": _p(S04, ("set_attr", "//table-wrap[@orientation]", "orientation", "diagonal"), SCHEMA, "table-wrap/@orientation 只收 portrait/landscape"),
    "S-dimension": _p(S04, ("set_attr", "//table-wrap-foot/p[@content-type]", "content-type", "other"), SCHEMA, "p/@content-type 只收 dimension"),
    "S-fn-p": _p(S04, ("remove_all", "//table-wrap-foot/fn/p"), SCHEMA, "fn 必须有 p"),
    "S-xref-ref-type": _p(S04, ("remove_attr", "//xref", "ref-type"), SCHEMA, "xref 必须有 ref-type"),
    "S-xref-ref-type-value": _p(S04, ("set_attr", "//xref", "ref-type", "paragraph"), SCHEMA, "ref-type 只收 13 个取值"),
    "S-xref-rid": _p(S04, ("remove_attr", "//xref", "rid"), SCHEMA, "xref 必须有 rid"),
    "S-fig-caption": _p(S05, ("remove_all", "//fig/caption"), SCHEMA, "fig 必须有 caption"),
    "S-fig-title": _p(S05, ("remove_all", "//fig/caption/title"), SCHEMA, "caption 必须有 title"),
    "S-graphic-href": _p(S05, ("remove_attr", "//graphic", "{xlink}href"), SCHEMA, "graphic 必须有 xlink:href"),
    "S-fig-dimension": _p(S05, ("set_attr", "//fig/caption/p[@content-type]", "content-type", "other"), SCHEMA, "图中单位说明 p/@content-type 只收 dimension"),
    "S-fig-orientation": _p(S05, ("set_attr", "//fig[@orientation]", "orientation", "diagonal"), SCHEMA, "fig/@orientation 只收 portrait/landscape"),
    "S-formula-math": _p(S05, ("remove_all", "//disp-formula/mml:math"), SCHEMA, "disp-formula 必须有 mml:math"),
    "S-inline-formula-no-id": _p(S05, ("set_attr", "//inline-formula", "id", "x1"), SCHEMA, "inline-formula 不带 id（附录 E）"),
    "S-def-term": _p(S05, ("remove_all", "//def-item/term"), SCHEMA, "def-item 必须有 term"),
    "S-def-def": _p(S05, ("remove_all", "//def-item/def"), SCHEMA, "def-item 必须有 def"),
    "S-def-p": _p(S05, ("remove_all", "//def-item/def/p"), SCHEMA, "def 必须有 p"),
    "S-termsec-termentry": _p(S06, ("remove_all", "//term-sec/tbx:termEntry"), SCHEMA, "term-sec 必须有 tbx:termEntry"),
    "S-langset": _p(S06, ("remove_all", "//tbx:langSet"), SCHEMA, "tbx:termEntry 必须有 tbx:langSet"),
    "S-langset-lang": _p(S06, ("remove_attr", "//tbx:langSet", "{xml}lang"), SCHEMA, "tbx:langSet 必须有 xml:lang"),
    "S-tig": _p(S06, ("remove_all", "//tbx:tig"), SCHEMA, "tbx:langSet 必须有 tbx:tig"),
    "S-term": _p(S06, ("remove_all", "//tbx:term"), SCHEMA, "tbx:tig 必须有 tbx:term"),
    "S-entailed-target": _p(S06, ("remove_attr", "//tbx:entailedTerm", "target"), SCHEMA, "tbx:entailedTerm 必须有 target"),
    # ---- validate.py 规则（export 档报错） ----
    "R-decl": _p(S01, ("replace", '<?xml version="1.0" encoding="UTF-8"?>\n', ""), R("V-16"), "XML 声明", "silent"),
    "R-ns-xlink": _p(S01, ("replace", ' xmlns:xlink="http://www.w3.org/1999/xlink"', ""), R("V-16"), "根上声明 xlink", "silent"),
    "R-ns-mml": _p(S01, ("replace", ' xmlns:mml="http://www.w3.org/1998/Math/MathML"', ""), R("V-16"), "根上声明 mml", "silent"),
    "R-ns-tbx": _p(S01, ("replace", ' xmlns:tbx="urn:iso:std:iso:30042:ed-1"', ""), R("V-16"), "根上声明 tbx", "silent"),
    "R-pm": _p(S01, ("remove", "//processing-meta"), R("V-16"), "processing-meta", "silent"),
    "R-pm-values": _p(S01, ("set_attr", "//processing-meta", "mathml-version", "1.0"), R("V-6"), "processing-meta 六个属性取固定值", "error"),
    "R-encoding": _p(S01, ("replace", 'encoding="UTF-8"', 'encoding="ISO-8859-1"'), R("SYN-2"), "编码只收 UTF-8", "error"),
    "R-dup-id": _p(S03, ("set_attr", "(//body/sec)[2]", "id", "sec_1"), R("V-1"), "id 唯一", "error"),
    "R-id-sec": _p(S03, ("remove_id", "(//body/sec[label])[1]"), R("V-13"), "有编号的章条必须有 id"),
    "R-id-sec-front": _p(S03, ("remove_id", "//front/sec[@sec-type='foreword']"), R("V-13"), "前言/引言必须有 id"),
    "R-id-app": _p(S03, ("remove_id", "(//app)[1]"), R("V-13"), "app 必须有 id", "error"),
    "R-id-reflist": _p(S03, ("remove_id", "//back/ref-list"), R("V-13"), "bibl 参考文献表必须有 id"),
    "R-id-index": _p(S03, ("remove_id", "//index"), R("V-13"), "index 必须有 id"),
    "R-id-ref": _p(S03, ("remove_id", "(//back/ref-list/ref)[1]"), R("V-13"), "bibl 的 ref 必须有 id", "error"),
    "R-id-table": _p(S04, ("remove_id", "(//table-wrap[label])[1]"), R("V-13"), "带编号的表必须有 id"),
    "R-id-fn-table": _p(S04, ("remove_id", "(//table-wrap-foot/fn)[1]"), R("V-13"), "表脚注必须有 id"),
    "R-id-fig": _p(S05, ("remove_id", "(//fig)[1]"), R("V-13"), "fig 必须有 id"),
    "R-id-formula": _p(S05, ("remove_id", "(//disp-formula[label])[1]"), R("V-13"), "带编号的行间公式必须有 id"),
    "R-id-termsec": _p(S06, ("remove_id", "(//term-sec)[1]"), R("V-13"), "term-sec 必须有 id"),
    "R-id-termentry": _p(S06, ("remove_id", "(//tbx:termEntry)[1]"), R("V-13"), "tbx:termEntry 必须有 id", "error"),
    "R-id-fn-body": _p(S06, ("remove_id", "(//p/fn)[1]"), R("V-13"), "正文脚注必须有 id"),
    "R-p-id": _p(S03, ("set_attr", "(//body//p)[1]", "id", "para_1"), R("V-18"), "p 不带 id", "error"),
    "R-note-body": _p(S03, ("remove_all", "(//non-normative-note[p])[1]/p"), R("V-17"), "注/示例必须有正文（p 或列项）"),
    "R-std-ref": _p(S03, ("remove_all", "(//ref/std)[1]/std-ref"), R("V-17"), "std 必须含 std-ref"),
    "R-std-title": _p(S03, ("remove_all", "(//ref/std)[1]/title"), R("V-17"), "参考文献条目里的 std 必须含 title"),
    "R-label-sec": _p(S03, ("remove", "//body/sec[label][1]/label"), R("V-17"), "章条的 label", "error"),
    "R-label-app": _p(S03, ("remove", "//app[1]/label"), R("V-17"), "app 的 label"),
    "R-label-termsec": _p(S06, ("remove", "//term-sec[1]/label"), R("V-17"), "term-sec 的 label"),
    "R-label-ref": _p(S03, ("remove", "//back/ref-list/ref[1]/label"), R("V-17"), "bibl 的 ref 的 label"),
    "R-label-list": _p(S03, ("remove_all", "//list[@list-type='arabic']/list-item/label"), R("V-17"), "有序列项的 label", "warn", "W-LIST-LABEL"),
    "R-label-table": _p(S04, ("remove", "//table-wrap[1]/label"), R("V-17"), "表的 label", "error"),
    "R-label-fig": _p(S05, ("remove", "//fig[1]/label"), R("V-17"), "图的 label"),
    "R-label-fn-table": _p(S04, ("remove", "//table-wrap-foot/fn[1]/label"), R("V-17"), "表脚注的 label"),
    "R-annex-type": _p(S03, ("remove", "//app[1]/annex-type"), R("V-17"), "app 的 annex-type", "error"),
    "R-bibl-title": _p(S03, ("remove", "//back/ref-list/title"), R("V-17"), "bibl 参考文献表的 title"),
    "R-table-title": _p(S04, ("remove", "//table-wrap[1]/caption"), R("V-17"), "表题 caption/title"),
    "R-fig-graphic": _p(S05, ("remove_all", "(//fig[graphic and p])[1]/graphic"), R("V-17"), "fig 的 graphic"),
    "R-list-content": _p(S05, ("remove_attr", "//disp-formula/legend/def-list", "list-content"), R("V-17"), "公式“式中”列表的 list-content"),
    "R-extlink-type": _p(S03, ("remove_attr", "//ext-link", "ext-link-type"), R("V-17"), "ext-link-type=uri", "error"),
    "R-named-content": _p(S03, ("set_attr", "//named-content", "content-type", "other"), R("V-17"), "named-content 只能是 variable", "warn", "W-NAMED-CONTENT"),
    "R-numbered-paragraph": _p(S03, ("remove_attr", "//sec[@sec-type='numbered-paragraph']", "sec-type"), R("V-17"), "无标题条须 numbered-paragraph", "silent"),
    "R-definition": _p(S06, ("remove_all", "//tbx:definition"), R("V-9"), "术语条目的定义", "error"),
    "R-mml-id": _p(S05, ("remove_attr", "(//mml:math)[1]", "id"), R("V-14"), "mml:math 的 id=mml_m<k>", "error"),
    "R-mml-display-block": _p(S05, ("remove_attr", "//disp-formula/mml:math", "display"), R("V-15"), "行间 mml:math 的 display=block", "silent"),
    "R-mml-display-inline": _p(S05, ("set_attr", "//inline-formula/mml:math", "display", "block"), R("V-15"), "行内 mml:math 不带 display", "error"),
    "R-custom-type": _p(S06, ("remove_attr", "//xref[@custom-type]", "custom-type"), R("V-8"), "custom 型 xref 的 custom-type", "error"),
    "R-dangling-rid": _p(S06, ("set_attr", "//xref[@ref-type='fn']", "rid", "nowhere"), R("V-1"), "rid 必须能解析到目标", "error"),
    "R-xref-target": _p(S06, ("set_attr", "//xref[@ref-type='sec']", "ref-type", "fig"), R("V-8"), "xref 的 ref-type 与目标一致", "error"),
    "R-xref-table-fn": _p(S04, ("set_attr", "//xref[@ref-type='table-fn']", "ref-type", "fn"), R("V-8"), "表脚注只能用 table-fn 引用", "error"),
    "R-entailed-target": _p(S06, ("set_attr", "//tbx:entailedTerm", "target", "sec_1"), R("V-8"), "entailedTerm 指向术语条目", "error"),
    "R-normrefs-pos": _p(S03, ("remove_attr", "//sec[@sec-type='norm-refs']", "sec-type"), R("V-3"), "norm-refs 清单须在 norm-refs 章内", "error"),
    "R-bibl-pos": _p(S03, ("set_attr", "//sec[@sec-type='norm-refs']/ref-list", "content-type", "bibl"), R("V-3"), "bibl 参考文献表须在 back 直下", "error"),
    "R-term-pos": _p(S06, ("remove_attr", "//sec[@sec-type='terms']", "sec-type"), R("V-2"), "term-sec 须在术语章内", "error"),
    "R-extlink-scheme": _p(S03, ("set_attr", "//ext-link", "{xlink}href", "javascript:alert(1)"), R("V-11"), "URL 协议白名单", "error"),
    "R-fn-unreferenced": _p(S06, ("remove_all", "//xref[@ref-type='fn']"), R("W-FN-UNREFERENCED"), "脚注须被引用", "warn", "W-FN-UNREFERENCED"),
}

# --------------------------------------------------------------------------------------------
# 不适用的理由
# --------------------------------------------------------------------------------------------

NA = {
    "content": "取决于 IR 内容：只有文档含这种内容时才输出该元素，格式层面没有“每份文档都必须出现”的要求；渲染器按 IR 映射保证",
    "role": "章的角色（scope / norm-refs / terms）由内容决定，格式不规定哪一章必须带哪个 sec-type；含 norm-refs 清单或术语条的章是否带对应 sec-type 由 V-3、V-2 约束，sec-type 取值开放（表 D.1 行 13）",
    "example": "原文只在示例中出现（obligation=example-only），没有“应/宜”约束；写法由约定固定，格式不另行强制",
    "id-form": "id 的取值样式（sec_<n>、fig_1 …）交 Resolver；格式只检查合法 XML ID 与唯一（V-1，C-S-37：id 不透明），id 是否必须出现由 V-13 强制",
    "meta-deferred": "SES 必填元数据（std-org-group、content-language、release-date、implementation-date、title-wrap/full 等）：主导人 2026-10-21 决定更严的导出档留 WP8.2，由渲染器侧强制（README 第 3 节第 11 点）",
    "table-f": "表 F.1 是与 GB/T 37967 的元素对照行，只表示对应关系；要求由对应的正文行承担",
    "numbered": "label 的有无取决于该结构是否编号（公式的 numbered 标志、连续注/示例才编号，C-S-31），不是每个实例都必须有",
    "id-if-referenced": "只有被引用的注/示例/列项才写 id（C-T-50、C-T-52）；是否被引用取决于文档内容，引用目标的 id 缺失由 V-1 报悬空",
    "text-layout": "文字版面（空格、制表符）不是 XML 结构，无法在文档层面检查；由渲染器保证",
    "pm-custom": "processing-meta 内的 custom-meta 只做记录，不属于标准内容（C-S-04）；meta-value 的年份待用户确认（D-S-02）",
    "xml-lang-values": "xml:lang 必须出现（schema），具体语言代码由内容决定（zh、en 只是示例）",
    "warning-note": "是否是“警告”注取决于 IR 内容；schema 不限制 non-normative-note 的 content-type 取值",
    "grouping-sec": "术语分组条是普通 sec，是否分组取决于内容；位置约束见 V-2（term-sec 须在术语章内）",
}

# --------------------------------------------------------------------------------------------
# 登记：矩阵行 id（或 “行 id#属性名”）-> 探针 id 与 “NA:原因” 的列表
# --------------------------------------------------------------------------------------------

ENTRIES: dict[str, list[str]] = {}


def _reg(ids, *parts):
    for i in ids.split():
        ENTRIES.setdefault(i, [])
        for part in parts:
            if part not in ENTRIES[i]:
                ENTRIES[i].append(part)


# 骨架与元数据
_reg("M-4.1-01", "R-decl", "R-encoding")
_reg("M-4.1-03", "R-ns-xlink", "R-ns-mml")
_reg("M-4.1-T01", "R-ns-mml")
_reg("M-4.1-T02", "R-ns-tbx")
_reg("M-4.1-04", "S-front")
_reg("M-4.1-05", "S-body")
_reg("M-4.1-07 M-4.3.2-01", "S-std-meta")
_reg("M-4.3.2-30", "R-pm")
_reg("M-4.3.2-T01 M-4.3.2-T02", "R-pm", "R-pm-values")
_reg("M-4.3.2-31", "NA:pm-custom")
_reg("M-4.3.2-04 M-4.3.2-32", "S-title-wrap", "S-title-wrap-lang")
_reg("M-4.3.2-06 M-4.3.2-07 M-4.3.2-10 M-4.3.2-11 M-4.3.2-21", "NA:meta-deferred")
_reg("M-F-04 M-F-05 M-F-17 M-F-19 M-F-21 M-F-24", "NA:table-f")
# 章条与附录
_reg("M-4.2-01", "S-front-sec-type", "R-id-sec-front")
_reg("M-4.2-02 M-4.3.4-01", "S-front-sec-type", "R-id-sec-front")
_reg("M-4.2-03", "NA:role")
_reg("M-4.2-04", "R-normrefs-pos", "NA:role")
_reg("M-4.2-05", "R-term-pos", "NA:role")
_reg("M-4.2-07", "S-app-content-type")
_reg("M-4.2-09", "S-reflist-content-type")
_reg("M-4.3.3-01", "S-foreword-title", "NA:content")
_reg("M-4.4.2.1-01", "S-body", "R-id-sec")
_reg("M-4.4.2.1-02", "R-label-sec")
_reg("M-4.4.2.1-03", "S-chapter-title", "S-app-title")
_reg("M-4.4.2.1-04", "S-sec-text", "NA:content")
_reg("M-4.4.2.2-01", "R-id-sec", "NA:role")
_reg("M-4.4.2.3-01", "R-normrefs-pos", "R-id-sec", "NA:role")
_reg("M-4.4.2.3-02 M-4.4.2.3.2-01", "R-normrefs-pos", "S-reflist-content-type")
_reg("M-4.4.2.3-03", "S-ref-body", "R-std-ref", "R-std-title")
_reg("M-4.4.2.3-04", "S-ref-body", "NA:content")
_reg("M-4.4.2.4-01", "R-term-pos", "R-id-sec", "NA:role")
_reg("M-4.4.2.5-01", "R-numbered-paragraph", "R-label-sec")
_reg("M-4.5.2-01", "S-app-group", "NA:content")
_reg("M-4.5.2-02", "S-app-content-type", "R-id-app")
_reg("M-4.5.2-03", "R-label-app")
_reg("M-4.5.2-04", "R-annex-type")
_reg("M-4.5.2-05", "S-app-title")
_reg("M-4.5.2-06", "R-label-sec", "R-id-sec")
_reg("M-4.5.3-01 M-10.1.6-02", "S-reflist-content-type", "R-id-reflist", "R-bibl-pos")
_reg("M-4.5.3-02", "R-bibl-title")
_reg("M-4.5.3-03 M-4.5.3.1-01", "R-id-ref")
_reg("M-4.5.3-04 M-4.5.3.1-02", "R-label-ref")
_reg("M-4.5.3-05 M-4.5.3.1-03", "S-ref-body", "R-std-ref", "R-std-title")
_reg("M-4.5.3.1-04", "R-std-ref")
_reg("M-4.5.3.1-05", "R-std-title")
_reg("M-4.5.3-06 M-4.5.3.1-06", "S-ref-body", "NA:example")
_reg("M-4.5.3.3-02", "NA:content")
# 正文文本
_reg("M-5.1-01 M-5.1-02 M-5.1-03 M-5.1-04 M-5.1-06 M-5.1-07 M-5.5-02", "NA:content")
_reg("M-5.1-08", "NA:text-layout")
_reg("M-5.2-01", "R-label-sec", "R-label-list", "R-label-fig", "NA:numbered")
_reg("M-5.2-02", "S-chapter-title", "S-app-title", "R-table-title", "S-fig-title")
_reg("M-5.4-01", "R-encoding")
_reg("M-5.5-01", "S-named-content-type", "R-named-content")
_reg("M-5.6-01 M-5.6-02 M-5.6-03 M-5.6-06", "NA:content", "R-note-body")
_reg("M-5.6-05", "R-note-body")
_reg("M-5.6-04", "NA:numbered")
_reg("M-5.7-01 M-5.7-02 M-5.7-03 M-5.7-04 M-5.7-05 M-5.7-06 M-D-03", "S-list-type", "S-list-type-value")
_reg("M-5.7-08", "S-list-item")
_reg("M-5.7-09", "R-label-list")
_reg("M-5.7-10", "S-list-item-p")
_reg("M-5.7-11", "NA:content")
_reg("M-5.9-01 M-5.10-01 M-5.10-02", "NA:content")
_reg("M-5.9-02", "S-quote-p")
# id 与表 F/D
_reg("M-E-01", "R-id-sec")
_reg("M-E-02", "R-id-sec-front")
_reg("M-E-03", "R-id-reflist", "R-id-index")
_reg("M-E-04", "R-id-app", "R-id-sec")
_reg("M-E-05", "R-id-ref")
_reg("M-E-07", "R-id-termsec")
_reg("M-E-08", "R-id-termentry")
_reg("M-E-10", "R-id-table")
_reg("M-E-12", "R-id-fig")
_reg("M-E-13", "R-id-formula")
_reg("M-E-14", "S-inline-formula-no-id")
_reg("M-E-15 M-E-16", "R-id-fn-body")
_reg("M-E-18", "R-id-fn-table")
_reg("M-E-19 M-E-20 M-E-22 M-E-23 M-E-24", "NA:id-if-referenced")
_reg("M-E-25", "R-p-id")
_reg("M-F-01", "S-root")
_reg("M-F-06 M-F-07 M-F-08 M-F-09 M-F-10 M-F-11 M-F-12 M-F-13 M-F-14 M-F-15 M-F-16 M-F-22", "NA:table-f")
_reg("M-D-01 M-D.1-01", "R-dup-id", "R-id-sec", "R-id-fig")
_reg("M-D-02", "S-reflist-content-type")
_reg("M-D-04", "NA:role")
# 表
_reg("M-6.2.1-01 M-6.2.1-02", "R-id-table", "NA:content")
_reg("M-6.6-01", "S-orientation")
_reg("M-6.2.1-03", "R-label-table")
_reg("M-6.2.1-05", "R-table-title")
_reg("M-6.1-01", "S-table")
_reg("M-6.2.2-01 M-6.2.4-01 M-6.2.4-02 M-6.5-02 M-6.2.3-03 M-6.2.3-04", "NA:content")
_reg("M-6.2.3-05", "NA:numbered")
_reg("M-6.2.5-01", "S-tbody")
_reg("M-6.2.2-02", "S-tr")
_reg("M-6.4-01", "S-td", "S-colspan", "S-rowspan")
_reg("M-6.4-02", "S-colspan")
_reg("M-6.4-03", "S-rowspan")
_reg("M-6.2.5-02", "S-dimension")
_reg("M-6.2.3-06", "R-note-body")
_reg("M-6.2.3-07", "R-id-fn-table")
_reg("M-6.2.3-08", "R-label-fn-table")
_reg("M-6.2.3-09", "S-fn-p")
_reg("M-6.2.3-10 M-6.2.3-11", "S-xref-ref-type", "S-xref-rid", "R-dangling-rid", "R-xref-table-fn")
# 公式
_reg("M-7.1-01 M-7.1-02", "R-id-formula", "S-formula-math")
_reg("M-7.1-03 M-7.2-02", "NA:numbered")
_reg("M-7.4-01 M-7.4-02", "R-mml-id", "S-formula-math")
_reg("M-7.4-03", "R-mml-display-block")
_reg("M-7.1-04", "NA:content")
_reg("M-7.1-05", "R-mml-id", "R-mml-display-inline")
_reg("M-7.3-02", "NA:content")
_reg("M-7.3-03", "R-list-content")
_reg("M-7.3-04", "NA:content")
_reg("M-7.3-05", "S-def-term")
_reg("M-7.3-06", "S-def-def")
_reg("M-7.3-07", "S-def-p")
# 图
_reg("M-8.2-01 M-8.2-02", "R-id-fig")
_reg("M-8.2-03", "S-fig-orientation")
_reg("M-8.2-04", "R-label-fig")
_reg("M-8.2-05", "S-fig-caption")
_reg("M-8.2-06", "S-fig-title")
_reg("M-8.2-08", "R-fig-graphic", "S-graphic-href")
_reg("M-8.2-09", "S-graphic-href")
_reg("M-8.2-10", "NA:example")
_reg("M-8.2-11", "NA:content")
_reg("M-8.6-01", "S-fig-dimension")
# 术语
_reg("M-9.1-01", "R-term-pos", "R-id-sec", "NA:role")
_reg("M-9.1-02", "NA:grouping-sec")
_reg("M-9.2.1-01 M-9.2.1-02", "R-id-termsec", "S-termsec-termentry")
_reg("M-9.2.1-03", "R-label-termsec")
_reg("M-9.2.1-04 M-9.2.1-05", "R-id-termentry")
_reg("M-9.2.1-06 M-9.2.1-07", "S-langset", "S-langset-lang")
_reg("M-9.2.3-01", "S-tig")
_reg("M-9.2.3-02", "S-term")
_reg("M-9.2.2-01", "R-definition")
_reg("M-9.2.8-01 M-9.2.7-01", "NA:content")
_reg("M-9.2.6-01", "S-entailed-target", "R-entailed-target")
_reg("M-9.2.6-02 M-9.2.6-03 M-10.1.3-01 M-10.1.3-02", "S-xref-ref-type", "S-xref-rid", "R-dangling-rid", "R-custom-type", "R-xref-target")
# 引用
_reg("M-10.1.1-01 M-10.1.1-02 M-10.1.2-01 M-9.2.7-02 M-10.1.2-02 M-10.1.2-03 M-10.1.2-04 M-10.1.6-01 M-10.1.1-04 M-10.1.5-01",
     "S-xref-ref-type", "S-xref-ref-type-value", "S-xref-rid", "R-dangling-rid", "R-xref-target")
_reg("M-10.1.1-03", "S-xref-ref-type", "S-xref-rid", "R-dangling-rid", "R-xref-target", "R-fn-unreferenced")
_reg("M-10.1.8-01", "R-id-fn-body", "R-fn-unreferenced")
_reg("M-10.1.8-02", "NA:content")
_reg("M-10.2-01 M-10.2-02", "R-std-ref", "NA:content")
_reg("M-10.1.7-01", "NA:content")
_reg("M-10.1.9-01", "S-extlink-href", "R-extlink-type", "R-extlink-scheme")
_reg("M-10.1.9-02", "S-extlink-href", "R-extlink-scheme")
_reg("M-6.2.3-12 M-6.2.3-13 M-7.3-09 M-9.2.6-04", "NA:content")

# 带固定取值的 shall/should 属性（“行 id#属性”）。未在此登记的由 _ATTR_DEFAULT 按属性名补，仍然找不到就失败。
ATTR_ENTRIES: dict[str, list[str]] = {}


def _areg(keys, *parts):
    for k in keys.split():
        ATTR_ENTRIES.setdefault(k, [])
        for part in parts:
            if part not in ATTR_ENTRIES[k]:
                ATTR_ENTRIES[k].append(part)


_areg("M-4.2-02#id M-4.3.4-01#id", "R-id-sec-front", "NA:id-form")
_areg("M-4.4.2.2-01#id M-4.4.2.4-01#id", "R-id-sec", "NA:id-form")
_areg("M-4.4.2.3-01#sec-type M-4.4.2.4-01#sec-type M-9.1-01#sec-type", "R-normrefs-pos", "R-term-pos", "NA:role")
_areg("M-4.4.2.3-02#content-type M-4.4.2.3.2-01#content-type", "S-reflist-content-type", "R-normrefs-pos")
_areg("M-4.4.2.5-01#sec-type", "R-numbered-paragraph")
_areg("M-4.5.2-02#content-type", "S-app-content-type")
_areg("M-4.5.3-01#content-type M-10.1.6-02#content-type", "S-reflist-content-type", "R-bibl-pos")
_areg("M-4.5.3-03#id M-4.5.3.1-01#id", "R-id-ref", "NA:id-form")
_areg("M-5.5-01#content-type", "S-named-content-type", "R-named-content")
_areg("M-5.6-03#content-type", "NA:warning-note")
_areg("M-5.7-01#list-type M-5.7-02#list-type M-5.7-03#list-type M-5.7-04#list-type M-5.7-05#list-type M-5.7-06#list-type",
      "S-list-type", "S-list-type-value")
_areg("M-6.6-01#orientation", "S-orientation")
_areg("M-6.4-02#colspan", "S-colspan")
_areg("M-6.4-03#rowspan", "S-rowspan")
_areg("M-6.2.5-02#content-type M-8.6-01#content-type", "S-dimension", "S-fig-dimension")
_areg("M-6.2.3-10#ref-type M-6.2.3-11#ref-type", "S-xref-ref-type", "S-xref-ref-type-value", "R-xref-table-fn")
_areg("M-7.4-02#id M-7.1-05#id", "R-mml-id")
_areg("M-7.3-03#list-content", "R-list-content")
_areg("M-8.2-08#xlink:href M-8.2-09#xlink:href", "S-graphic-href")
_areg("M-9.2.1-01#id M-9.2.1-02#id", "R-id-termsec", "NA:id-form")
_areg("M-9.2.1-04#id M-9.2.1-05#id", "R-id-termentry", "NA:id-form")
_areg("M-9.2.1-06#xml:lang M-9.2.1-07#xml:lang", "S-langset-lang", "NA:xml-lang-values")
_areg("M-9.2.6-01#target", "S-entailed-target", "R-entailed-target")
_areg("M-9.2.6-02#ref-type M-9.2.6-02#custom-type M-9.2.6-02#rid M-10.1.3-01#ref-type M-10.1.3-01#custom-type M-10.1.3-02#ref-type "
      "M-10.1.3-02#custom-type M-9.2.6-03#ref-type M-9.2.6-03#custom-type",
      "S-xref-ref-type", "S-xref-rid", "R-dangling-rid", "R-custom-type", "R-xref-target")
_areg("M-10.1.2-01#ref-type M-9.2.7-02#ref-type M-10.1.2-02#ref-type M-10.1.2-03#ref-type M-10.1.2-04#ref-type M-10.1.6-01#ref-type M-10.1.1-03#ref-type "
      "M-10.1.1-04#ref-type M-10.1.5-01#ref-type",
      "S-xref-ref-type", "S-xref-ref-type-value", "R-xref-target")
_areg("M-4.5.3.1-01#id", "R-id-ref", "NA:id-form")
_areg("M-10.1.9-01#ext-link-type", "R-extlink-type")


# --------------------------------------------------------------------------------------------
# 矩阵单元
# --------------------------------------------------------------------------------------------

def units(rows):
    """需要登记的单元：export 为 required 的每一行，及其 shall/should 且带固定取值的每个属性。"""
    out = []
    for r in rows:
        if r["export"] != "required":
            continue
        out.append(r["id"])
        for a in r.get("attributes", []):
            if a["obligation"] in ("shall", "should") and a.get("values"):
                out.append("%s#%s" % (r["id"], a["name"]))
    return out


def parts_of(unit):
    if "#" in unit:
        return ATTR_ENTRIES.get(unit)
    return ENTRIES.get(unit)


def classify(part):
    if part.startswith("NA:"):
        return "na", part[3:]
    if part.startswith("S-"):
        return "schema", part
    return "rule", part


# --------------------------------------------------------------------------------------------
# 运行探针
# --------------------------------------------------------------------------------------------

def _load_validate():
    spec = importlib.util.spec_from_file_location("ses_validate_for_audit", HERE / "validate.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ses_validate_for_audit"] = mod
    spec.loader.exec_module(mod)
    return mod


def _expand(name):
    m = re.fullmatch(r"\{(\w+)\}(.+)", name)
    return "{%s}%s" % (NSMAP[m.group(1)], m.group(2)) if m else name


def apply_op(text: str, op) -> str:
    if op[0] == "rename_root":
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        root = etree.fromstring(text.encode("utf-8"), parser)
        root.tag = op[1]
        return etree.tostring(root, encoding="UTF-8", xml_declaration=True).decode("utf-8")
    if op[0] == "replace":
        if text.count(op[1]) != 1:
            raise ValueError("替换目标出现 %d 次（应为 1）：%r" % (text.count(op[1]), op[1]))
        return text.replace(op[1], op[2])
    parser = etree.XMLParser(remove_blank_text=False, resolve_entities=False, no_network=True)
    root = etree.fromstring(text.encode("utf-8"), parser)
    nodes = root.xpath(op[1], namespaces=NSMAP)
    if not nodes:
        raise ValueError("xpath 没有匹配：%s" % op[1])
    if op[0] == "remove":
        nodes = nodes[:1]
    if op[0] in ("remove", "remove_all"):
        for n in nodes:
            parent = n.getparent()
            if n.tail and n.tail.strip() == "":
                n.tail = None
            parent.remove(n)
    elif op[0] == "remove_attr":
        name = _expand(op[2])
        for n in nodes[:1]:
            if name not in n.attrib:
                raise ValueError("没有属性 %s：%s" % (op[2], op[1]))
            del n.attrib[name]
    elif op[0] == "remove_id":
        target = nodes[0]
        tid = target.get("id")
        if tid is None:
            raise ValueError("目标没有 id：%s" % op[1])
        for ref in root.xpath("//xref[@rid='%s'] | //tbx:entailedTerm[@target='%s']" % (tid, tid), namespaces=NSMAP):
            text = "".join(ref.itertext())
            parent = ref.getparent()
            prev = ref.getprevious()
            tail = (text or "") + (ref.tail or "")
            if prev is not None:
                prev.tail = (prev.tail or "") + tail
            else:
                parent.text = (parent.text or "") + tail
            parent.remove(ref)
        del target.attrib["id"]
    elif op[0] == "set_attr":
        for n in nodes[:1]:
            n.set(_expand(op[2]), op[3])
    elif op[0] == "prepend_text":
        nodes[0].text = op[2] + (nodes[0].text or "")
    elif op[0] == "unwrap":
        n = nodes[0]
        parent = n.getparent()
        idx = parent.index(n)
        kids = list(n)
        for k in reversed(kids):
            parent.insert(idx, k)
        parent.remove(n)
    else:
        raise ValueError(op)
    return etree.tostring(root, encoding="UTF-8", xml_declaration=True).decode("utf-8")


def run_probe(pid, validators, cache):
    """返回 (是否通过, 说明)。validators = {"import": Validator, "export": Validator}。"""
    pr = PROBES[pid]
    base_text = (SAMPLES / pr["sample"]).read_text(encoding="utf-8")
    if pr["sample"] not in cache:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "base.xml"
            p.write_text(base_text, encoding="utf-8")
            cache[pr["sample"]] = validators["export"].validate_file(p)
    base = cache[pr["sample"]]
    if base.errors or not base.consistent:
        return False, "基准样例 %s 在 export 档不是干净的：%s" % (pr["sample"], [e["rule"] for e in base.errors])
    try:
        mutated = apply_op(base_text, pr["op"])
    except ValueError as exc:
        return False, "探针改动失败：%s" % exc
    reports = {}
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "mutated.xml"
        p.write_text(mutated, encoding="utf-8")
        for prof in ("export", "import"):
            reports[prof] = validators[prof].validate_file(p)
    exp, imp = reports["export"], reports["import"]
    kind = pr["expect"][0]
    if kind == "schema":
        for prof, rep in (("export", exp), ("import", imp)):
            if rep.engines["lxml"]["valid"] is not False or rep.engines["xmllint"]["valid"] is not False:
                return False, "%s 档：schema 没有拒绝（lxml=%s，xmllint=%s）" % (prof, rep.engines["lxml"]["valid"], rep.engines["xmllint"]["valid"])
        return True, ""
    rule = pr["expect"][1]
    if rule.startswith("W-"):  # 告警规则（如 W-FN-UNREFERENCED）：两档都报告警
        if not any(w["rule"] == rule for w in exp.warnings) or not any(w["rule"] == rule for w in imp.warnings):
            return False, "告警 %s 没有出现" % rule
        return True, ""
    if not any(e["rule"] == rule for e in exp.errors):
        return False, "export 档没有 %s 错误（错误规则：%s）" % (rule, sorted({e["rule"] for e in exp.errors}))
    mode = pr["imp"]
    imp_rule = pr["imp_rule"] or rule
    if mode == "warn":
        if not imp.valid or not any(w["rule"] == imp_rule for w in imp.warnings):
            return False, "import 档应通过并告警 %s（valid=%s，告警=%s，错误=%s）" % (
                imp_rule, imp.valid, sorted({w["rule"] for w in imp.warnings}), sorted({e["rule"] for e in imp.errors}))
    elif mode == "silent":
        if any(i["rule"] in (rule, imp_rule) for i in imp.errors + imp.warnings):
            return False, "import 档不应报告 %s" % rule
        if not imp.valid:
            return False, "import 档应通过（错误：%s）" % sorted({e["rule"] for e in imp.errors})
    elif mode == "error":
        if not any(e["rule"] == rule for e in imp.errors):
            return False, "import 档也应是错误 %s" % rule
    return True, ""


def load_rows():
    import json
    rows = []
    for f in ("matrix-S.json", "matrix-T.json"):
        rows += json.loads((ROOT / "docs" / "wp8.1" / f).read_text(encoding="utf-8"))
    return rows


def registration_problems(rows):
    """只核对登记（不运行探针）：返回 (问题列表, 各类强制者的单元计数, 被引用的探针集合)。"""
    problems = []
    all_units = units(rows)
    known = set(all_units)
    tally = {"schema": 0, "rule": 0, "na": 0}
    used = set()
    used_na = set()
    for u in all_units:
        parts = parts_of(u)
        if not parts:
            problems.append("无人强制且未注明理由：%s（export required 的行/属性；请登记探针或 NA 理由）" % u)
            continue
        kinds = set()
        for part in parts:
            kind, name = classify(part)
            kinds.add(kind)
            if kind == "na":
                used_na.add(name)
                if name not in NA:
                    problems.append("%s：未知的不适用理由 %r" % (u, name))
            else:
                used.add(part)
                if part not in PROBES:
                    problems.append("%s：未知的探针 %r" % (u, part))
        for k in kinds:
            tally[k] += 1
    for key in list(ENTRIES) + list(ATTR_ENTRIES):
        if key not in known:
            problems.append("登记了矩阵里没有（或不是 export required 的）单元：%s" % key)
    for pid in sorted(set(PROBES) - used):
        problems.append("探针 %s 没有被任何矩阵行引用" % pid)
    for name in sorted(set(NA) - used_na):
        problems.append("不适用理由 %s 没有被任何矩阵行引用" % name)
    return problems, tally, used


def make_validators():
    val = _load_validate()
    schema = ROOT / "schemas" / "gbt46687.2" / "ses-gbt46687-2.rng"
    return {"export": val.Validator(schema, profile="export"), "import": val.Validator(schema, profile="import")}


def audit(rows=None):
    """返回 {problems, probe_results, units, tally}。problems 为空表示通过。"""
    rows = rows if rows is not None else load_rows()
    problems, tally, used = registration_problems(rows)
    validators = make_validators()
    results = {}
    cache: dict = {}
    for pid in sorted(used & set(PROBES)):
        ok, msg = run_probe(pid, validators, cache)
        results[pid] = (ok, msg)
        if not ok:
            problems.append("探针 %s（%s）未得到预期结果：%s" % (pid, PROBES[pid]["desc"], msg))
    return {"problems": problems, "probe_results": results, "units": units(rows), "tally": tally}


# --------------------------------------------------------------------------------------------
# README 表
# --------------------------------------------------------------------------------------------

def _enforcer_label(part):
    kind, name = classify(part)
    if kind == "na":
        return "不适用：" + NA[name]
    pr = PROBES[part]
    if kind == "schema":
        return "schema：" + pr["desc"]
    rule = pr["expect"][1]
    imp = {"warn": "import 告警", "silent": "import 不报告", "error": "import 同为错误"}[pr["imp"]]
    return "%s（%s）：%s" % (rule, imp, pr["desc"])


def render_markdown(rows=None):
    """按“强制者”分组的表：每个强制者对应哪些矩阵行/属性。"""
    rows = rows if rows is not None else load_rows()
    groups: dict[str, list[str]] = {}
    for u in units(rows):
        for part in parts_of(u) or []:
            groups.setdefault(part, []).append(u)

    def order(part):
        kind, _ = classify(part)
        return ({"schema": 0, "rule": 1, "na": 2}[kind], part)

    lines = ["| 强制者 | 矩阵行（`行#属性` 为带固定取值的属性） |", "|---|---|"]
    for part in sorted(groups, key=order):
        ids = groups[part]
        lines.append("| %s | %s |" % (_enforcer_label(part), "、".join(ids)))
    return "\n".join(lines)


if __name__ == "__main__":  # pragma: no cover
    res = audit()
    for p in res["problems"]:
        print("问题：" + p)
    print("单元 %d 个；探针 %d 个，通过 %d 个" % (len(res["units"]), len(res["probe_results"]), sum(1 for ok, _ in res["probe_results"].values() if ok)))
    sys.exit(1 if res["problems"] else 0)
