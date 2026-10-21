#!/usr/bin/env python3
"""GB/T 46687.2—2026 标准 XML 校验工具（SES 项目实现约定，非官方）。

版本 0.1.0。依据 docs/wp8.1（约定 C-S-*、C-T-*，校验规则 V-1～V-7）与 schemas/gbt46687.2 下的
项目自写 RELAX NG schema。运行方式：

    python3 -I scripts/xml46687/validate.py [--json] [--profile import|export] <file.xml> [...]

校验层次（对应 docs/wp8.1/conventions-S.md 第 3.5 节）：
  1. 语法    格式良好；禁止 DTD 加载、外部实体与网络访问；UTF-8；DOCTYPE 不得带内部子集（SYN-1～SYN-3）
  2. 旧格式  GB/T 37967 与 SEP 早期自定义格式的判别特征（LEGACY），命中即拒绝，不尝试转换
  3. 结构    项目自写 schema：lxml（RELAX NG）与 xmllint 两个实现同时校验，结果不一致即报告（RNG / CONSISTENCY）
  4. 拒绝项  支持矩阵中 import 为 reject 的元素（tex-math、嵌套表、tfoot 等），给出矩阵行与约定编号（REJECT）
  5. 语义    V-1 id/rid；V-2 sec-type 与位置；V-3 app/ref-list 的 content-type；V-4 日期；V-5 列项；
             V-6 processing-meta 与 title-wrap；V-7 遗留 id 形式；
             附加：V-8 xref 的 ref-type 与目标一致；V-9 术语条目定义个数；V-10 MathML 安全；V-11 外链协议；
             V-12 std-meta 子元素次序（STD-META-ORDER：导出为错误，导入为告警；结构层不限次序）；
             V-13 必备 id（REQUIRED-ID：导出为错误，导入为告警；结构层 id 一律可选）

说明：lxml 与 xmllint 都基于 libxml2 的 RELAX NG 实现（版本不同、构建独立），不是两个互相独立的算法；
它们能发现构建/版本差异，但不能替代 jing 之类独立实现（本机没有）。

退出码：0 = 全部文件通过；1 = 有文件未通过（含两个实现结论不一致）。
本文件只依赖 Python 3 标准库与 lxml，不联网。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

try:
    from lxml import etree
except ImportError:  # pragma: no cover - 环境问题
    sys.stderr.write("缺少 lxml，无法运行（本工具不安装依赖）。\n")
    raise SystemExit(1)

VERSION = "0.1.0"

NS_XLINK = "http://www.w3.org/1999/xlink"
NS_MML = "http://www.w3.org/1998/Math/MathML"
NS_TBX = "urn:iso:std:iso:30042:ed-1"
NS_XML = "http://www.w3.org/XML/1998/namespace"
NS_SEP_LEGACY = "urn:csbts:std:xml:1.0"

DEFAULT_SCHEMA = Path(__file__).resolve().parents[2] / "schemas" / "gbt46687.2" / "ses-gbt46687-2.rng"

ERROR = "error"
WARNING = "warning"


# --------------------------------------------------------------------------------------------
# 基本工具
# --------------------------------------------------------------------------------------------

def _clark(ns: str | None, local: str) -> str:
    return "{%s}%s" % (ns, local) if ns else local


# XML 1.0（第五版）Name 产生式；id 取 NCName（无冒号），与 xml:id 一致。
_NAME_START = (
    "A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D"
    "\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\U00010000-\U000EFFFF"
)
_NAME_CHAR = _NAME_START + "\\-.0-9\u00B7\u0300-\u036F\u203F-\u2040"
NCNAME_RE = re.compile("^[%s][%s]*$" % (_NAME_START, _NAME_CHAR))


def is_element(node) -> bool:
    return isinstance(node.tag, str)


def local(el) -> str:
    return etree.QName(el).localname


def nsuri(el) -> str | None:
    return etree.QName(el).namespace


def label(el) -> str:
    """元素的可读名：STS 元素原名，tbx/mml 元素带前缀。"""
    ns = nsuri(el)
    if ns == NS_TBX:
        return "tbx:" + local(el)
    if ns == NS_MML:
        return "mml:" + local(el)
    if ns:
        return "{%s}%s" % (ns, local(el))
    return local(el)


def text_of(el) -> str:
    return "".join(el.itertext()).strip()


class Report:
    """单个文件的校验结果。"""

    def __init__(self, path: str, profile: str):
        self.path = path
        self.profile = profile
        self.errors: list[dict] = []
        self.warnings: list[dict] = []
        self.engines: dict = {}
        self.consistent = True

    def add(self, severity: str, rule: str, message: str, el=None, line: int | None = None, path: str | None = None):
        item = {"rule": rule, "message": message}
        if el is not None:
            if line is None:
                line = el.sourceline
            if path is None:
                try:
                    path = el.getroottree().getpath(el)
                except Exception:  # pragma: no cover
                    path = None
        if line:
            item["line"] = line
        if path:
            item["path"] = path
        (self.errors if severity == ERROR else self.warnings).append(item)

    def error(self, rule, message, el=None, line=None, path=None):
        self.add(ERROR, rule, message, el, line, path)

    def warn(self, rule, message, el=None, line=None, path=None):
        self.add(WARNING, rule, message, el, line, path)

    @property
    def valid(self) -> bool:
        return not self.errors and self.consistent

    def to_dict(self) -> dict:
        return {
            "file": self.path,
            "profile": self.profile,
            "valid": self.valid,
            "errors": self.errors,
            "warnings": self.warnings,
            "engines": self.engines,
            "engines_consistent": self.consistent,
        }


# --------------------------------------------------------------------------------------------
# 1. 语法层：UTF-8、DOCTYPE、格式良好（安全解析）
# --------------------------------------------------------------------------------------------

def secure_parser() -> "etree.XMLParser":
    """禁止加载 DTD、展开实体、联网。huge_tree 保持默认 False，以抵御实体膨胀类输入。"""
    return etree.XMLParser(
        resolve_entities=False,
        load_dtd=False,
        no_network=True,
        dtd_validation=False,
        attribute_defaults=False,
        remove_comments=False,
        huge_tree=False,
    )


_XMLDECL_RE = re.compile(rb"^\s*<\?xml\s+[^>]*?encoding\s*=\s*[\"']([^\"']+)[\"']", re.S)
_DOCTYPE_RE = re.compile(rb"<!DOCTYPE\b", re.I)
_DOCTYPE_INTERNAL_RE = re.compile(rb"<!DOCTYPE\b[^>\[]*\[", re.I | re.S)
_ENTITY_DECL_RE = re.compile(rb"<!ENTITY\b", re.I)


def check_syntax_raw(raw: bytes, rep: Report, profile: str) -> None:
    """XML 声明编码与 DOCTYPE 检查（在解析前按字节检查，避免依赖解析器行为）。"""
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        rep.error("SYN-2", "文件是 UTF-16 编码；GB/T 46687.2 示例只用 UTF-8（C-S-02），本版本只接受 UTF-8")
    m = _XMLDECL_RE.match(raw[:400].lstrip(b"\xef\xbb\xbf"))
    if m:
        enc = m.group(1).decode("ascii", "replace")
        if enc.replace("_", "-").lower() not in ("utf-8", "utf8"):
            rep.error("SYN-2", "XML 声明的编码为 %r，只接受 UTF-8（C-S-02；GB2312 是 GB/T 37967 旧格式特征）" % enc)
    if _DOCTYPE_RE.search(raw):
        if _DOCTYPE_INTERNAL_RE.search(raw) or _ENTITY_DECL_RE.search(raw):
            rep.error("SYN-3", "DOCTYPE 含内部子集或实体声明，拒绝（C-S-02、C-S-34：不展开实体、不加载 DTD）")
        elif profile == "export":
            rep.error("SYN-3", "导出文件不得写 DOCTYPE（D-S-03、C-S-02）")
        else:
            rep.warn("SYN-3", "存在 DOCTYPE 声明：只记录，不读取外部子集；本格式导出不写 DOCTYPE（C-S-02）")


def parse_secure(raw: bytes, rep: Report):
    """格式良好性检查。返回 ElementTree 或 None。"""
    try:
        tree = etree.ElementTree(etree.fromstring(raw, secure_parser()))
    except etree.XMLSyntaxError as exc:
        seen = set()
        for entry in list(exc.error_log) or [exc]:
            msg = getattr(entry, "message", str(entry))
            line = getattr(entry, "line", None)
            key = (msg, line)
            if key in seen:
                continue
            seen.add(key)
            rep.error("SYN-1", "XML 格式错误：%s" % msg, line=line)
        return None
    except Exception as exc:  # pragma: no cover
        rep.error("SYN-1", "无法解析：%s" % exc)
        return None
    # 解析器不展开实体；若树里仍有实体引用节点，说明文档依赖 DTD 中的实体，一律拒绝。
    for node in tree.getroot().iter(etree.Entity):
        rep.error("SYN-3", "使用了实体引用 &%s;（只接受 XML 预定义实体与数字字符引用，C-S-34）" % node.name,
                  line=node.sourceline)
    return tree


# --------------------------------------------------------------------------------------------
# 2. 旧格式判别（conventions-S 第 6 节）
# --------------------------------------------------------------------------------------------

_LEGACY_37967_NAMES = {
    "basic_info", "auxiliary_info", "catalogue", "clg_item", "clg_id", "clg_name", "normativereference",
    "n_docum", "append", "apd_item", "apd_id", "apd_body", "t_item", "t_id", "t_cn", "t_en", "t_def",
    "t_note", "t_exp", "technology", "tech_item", "tech_itid", "tech_itname", "tech_paragraph",
    "tech_paraid", "tech_paraname", "tech_part", "tech_ptid", "tech_ptname", "tech_ptbody",
    "ep_name", "fb_source", "fb_info", "gbn", "isd", "efd", "ref_item",
}
_LEGACY_37967_ROOT_CHILDREN = {"content", "edit", "execute"}
_LEGACY_SEP_ELEMENTS = {"pub-date", "term-note", "term-example", "preferred", "admitted", "term-name"}
_LEGACY_ID_RES = [
    (re.compile(r"^app_[A-Z]$"), "旧 SEP 附录 id 形式 app_<字母>"),
    (re.compile(r"^bib_\d+$"), "旧 SEP 参考文献 id 形式 bib_<n>（新格式为 biblref_<n>）"),
    (re.compile(r"^tabfn_"), "旧 SEP 表脚注 id 形式 tabfn_…（新格式为 table-fn_<表号>.<k>）"),
]


def detect_legacy(tree, rep: Report) -> None:
    """旧格式判别特征（C-S §6）。命中即报 LEGACY，并给出特征与位置；不尝试转换。"""
    root = tree.getroot()
    hits_37967: list[tuple[str, int | None]] = []
    hits_sep: list[tuple[str, int | None]] = []

    root_ns = nsuri(root)
    if root_ns == NS_SEP_LEGACY:
        hits_sep.append(("根元素带默认命名空间 %s（新格式的 STS 元素无命名空间）" % NS_SEP_LEGACY, root.sourceline))
    elif root_ns:
        rep.error("ROOT", "根元素 <%s> 带命名空间 %s；新格式根元素是无命名空间的 standard（C-S-01、C-S-03）"
                  % (local(root), root_ns), el=root)
    elif local(root) != "standard":
        if local(root) in _LEGACY_37967_NAMES:
            hits_37967.append(("根元素为 <%s>（GB/T 37967 的元素风格）" % local(root), root.sourceline))
        else:
            rep.error("ROOT", "根元素应为 standard，实际为 <%s>（C-S-01）" % local(root), el=root)

    for el in tree.getroot().iter():
        if not is_element(el):
            continue
        for uri in el.nsmap.values():
            if uri and "xmlgb.org" in uri:
                hits_37967.append(("命名空间 %s（GB/T 37967 表 1）" % uri, el.sourceline))
                break
    for ch in root:
        if is_element(ch) and local(ch) in _LEGACY_37967_ROOT_CHILDREN:
            hits_37967.append(("根元素之下的一级元素 <%s>（37967 为 content/edit/execute）" % local(ch), ch.sourceline))
    for el in root.iter():
        if not is_element(el) or nsuri(el) is not None:
            continue
        name = local(el)
        parent = el.getparent()
        pname = local(parent) if parent is not None and is_element(parent) else None
        if name in _LEGACY_37967_NAMES:
            hits_37967.append(("元素 <%s>（GB/T 37967 的元素名）" % name, el.sourceline))
        if name in ("foreword", "intro") and pname in ("body", "front", "standard"):
            hits_sep.append(("元素 <%s> 作为 %s 的子元素（新格式是带 sec-type 的 sec）" % (name, pname), el.sourceline))
        if name in _LEGACY_SEP_ELEMENTS:
            hits_sep.append(("元素 <%s>（SEP 早期格式）" % name, el.sourceline))
        if name == "std-type" and re.fullmatch(r"[a-z]+", text_of(el) or ""):
            hits_sep.append(("<std-type>%s</std-type>（SEP 早期格式的英文枚举值）" % text_of(el), el.sourceline))
        if name == "fn" and el.get("fn-type") is not None:
            hits_sep.append(("fn/@fn-type（SEP 早期格式的表脚注标记）", el.sourceline))
        if name in ("title-wrap", "caption") and el.get("lang") is not None:
            hits_sep.append(("%s/@lang（无 xml: 前缀，SEP 早期格式）" % name, el.sourceline))
        if name == "sec" and el.get("content-type") == "untitled":
            hits_sep.append(("sec/@content-type=\"untitled\"（SEP 早期格式的无标题条）", el.sourceline))
        if name == "custom-meta-group" and el.get("content-type") == "ses-cover":
            hits_sep.append(("custom-meta-group/@content-type=\"ses-cover\"（SEP 早期格式）", el.sourceline))
        eid = el.get("id")
        if eid:
            for rx, why in _LEGACY_ID_RES:
                if rx.search(eid):
                    hits_sep.append(("%s：%s" % (why, eid), el.sourceline))
    for kind, hits in (("GB/T 37967—2019", hits_37967), ("SEP 早期自定义格式", hits_sep)):
        if not hits:
            continue
        uniq: list[tuple[str, int | None]] = []
        for h in hits:
            if h not in uniq:
                uniq.append(h)
        shown = "；".join("%s（行 %s）" % (m, ln) for m, ln in uniq[:5])
        more = "" if len(uniq) <= 5 else "；另有 %d 处" % (len(uniq) - 5)
        rep.error("LEGACY", "旧格式 XML（%s），本版本不再支持，不尝试转换：命中特征：%s%s" % (kind, shown, more),
                  line=uniq[0][1])


# --------------------------------------------------------------------------------------------
# 3. 结构层：RELAX NG（lxml）与 xmllint 两个实现
# --------------------------------------------------------------------------------------------

def load_relaxng(schema_path: Path):
    parser = etree.XMLParser(no_network=True, load_dtd=False, resolve_entities=False)
    return etree.RelaxNG(etree.parse(str(schema_path), parser))


def run_lxml_relaxng(rng, tree) -> tuple[bool, list[dict]]:
    ok = rng.validate(tree)
    msgs: list[dict] = []
    seen = set()
    for entry in rng.error_log:
        key = (entry.line, entry.message)
        if key in seen:
            continue
        seen.add(key)
        item = {"message": entry.message}
        if entry.line:
            item["line"] = entry.line
        msgs.append(item)
    return ok, msgs


def xmllint_version(exe: str) -> str:
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=20)
        text = (out.stderr or out.stdout).strip().splitlines()
        return text[0] if text else "unknown"
    except Exception:  # pragma: no cover
        return "unknown"


def run_xmllint(exe: str, schema_path: Path, file_path: str) -> tuple[bool, list[dict]]:
    """xmllint --noout --nonet --nocatalogs --relaxng <schema> <file>；退出码 0 即通过。"""
    cmd = [exe, "--noout", "--nonet", "--nocatalogs", "--relaxng", str(schema_path), file_path]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
    ok = proc.returncode == 0
    msgs: list[dict] = []
    for line in proc.stderr.splitlines():
        line = line.rstrip()
        if not line or line.endswith("validates") or line.endswith("fails to validate"):
            continue
        if line.startswith(" ") or line.startswith("^"):  # xmllint 的上下文回显行
            continue
        item = {"message": line}
        m = re.match(r"^.*?:(\d+): ", line)
        if m:
            item["line"] = int(m.group(1))
        msgs.append(item)
    if not ok and not msgs:
        msgs.append({"message": "xmllint 退出码 %d" % proc.returncode})
    return ok, msgs


# --------------------------------------------------------------------------------------------
# 4. 拒绝项（支持矩阵 import: reject）
# --------------------------------------------------------------------------------------------

# 元素（Clark 名）→ (矩阵行, 约定编号, 原因)
REJECT_ELEMENTS = {
    "issue-agencies": ("M-4.3.2-12", "C-S-15", "4.3.2 列出但定义缺失，与 std-org-group 语义重复"),
    "std-doc-meta": ("M-C-04", "C-S-20", "附录 B：功能与 std-meta 重叠，仅保留 std-meta"),
    "col-group": ("M-5.8-02", "C-S-36", "5.8 示例的排印错误（表 C.1 为 colgroup，附录 D 为 width），不收"),
    "tfoot": ("M-C.1-03", "C-T-02", "6.2.2 要求表注放 table-wrap-foot，tfoot 无内容模型"),
    "tex-math": ("M-7.4-14", "C-T-20", "原文全文没有 tex-math；公式只用 mml:math"),
    "alternatives": ("M-7.4-15", "C-T-20", "原文全文没有 alternatives；公式只用 mml:math"),
    "fn-group": ("M-10.1.8-05", "C-T-55", "原文没有 fn-group"),
    "target": ("M-D.1-04", "D 行 5/17", "target 元素不在 SES 支持范围内"),
    "term-display": ("M-B.1-01", "C-T-37", "term-display 不在 SES 支持范围内"),
    _clark(NS_TBX, "see"): ("M-C.1-09", "C-T-46", "正文以 xref 引用，tbx:see 不使用（D-T-08）"),
    # 主导人 2026-10-21 决定：下列四个异写元素名只在说明文字或附录 C 断行处出现，示例代码从未使用，疑为原文笔误，
    # 导入时 REJECT（只保留 tbx:normativeAuthentication，印刷页 37 三处真实出现）。
    _clark(NS_TBX, "term-entry"): ("M-9.2.1-09", "C-T-38", "疑为原文笔误：9.2.1 说明文字写作 tbx:term-entry，示例代码一律为 tbx:termEntry"),
    _clark(NS_TBX, "Definition"): ("M-9.2.1-08", "C-T-38", "疑为原文笔误：9.2.1 说明文字写作 tbx:Definition，示例代码一律为 tbx:definition"),
    _clark(NS_TBX, "normative-Authorization"): ("M-C.1-06", "C-T-39", "疑为原文笔误：附录 C 断行处的写法，正式名为 tbx:normativeAuthorization"),
    _clark(NS_TBX, "grammatical-Number"): ("M-C.1-07", "C-T-38", "疑为原文笔误：附录 C 断行处的写法，正式名为 tbx:grammaticalNumber"),
}
# rejectKind=implementation 的矩阵行：格式本身接受（schema 收入），只是导入器暂时无法保存，因此只告警，不算格式错误
IMPL_REJECT_ELEMENTS = {
    "array": ("M-5.8-01、M-C.1-04", "C-S-36", "5.8 无框对齐文本：IR/PM 的表总有编号与题名，暂无法保存，导入器会拒绝"),
    "disp-formula-group": ("M-C.1-05", "C-T-17", "IR 无公式组，暂无法保存，导入器会拒绝"),
}
# 无前缀的 MathML 元素名（7.4 示例 <mtext> 笔误，M-7.4-12）
_UNPREFIXED_MATHML = {
    "math", "mtext", "mi", "mn", "mo", "mrow", "mfrac", "msub", "msup", "mspace", "msubsup", "msqrt", "mroot",
    "mstyle", "mtable", "mtr", "mtd", "munder", "mover", "munderover", "mfenced", "semantics", "annotation",
}


def check_rejects(tree, rep: Report) -> None:
    root = tree.getroot()
    for el in root.iter():
        if not is_element(el):
            continue
        key = _clark(nsuri(el), local(el))
        name = label(el)
        parent = el.getparent()
        pkey = _clark(nsuri(parent), local(parent)) if parent is not None and is_element(parent) else None
        if nsuri(el) is None and local(el) in IMPL_REJECT_ELEMENTS:
            mid, conv, why = IMPL_REJECT_ELEMENTS[local(el)]
            rep.warn("W-IMPL-REJECT", "<%s> 格式上合法，但导入暂拒（%s，%s，rejectKind=implementation）：%s" % (name, mid, conv, why), el=el)
        if key == "sec" and parent is not None and local(parent) == "sec" and nsuri(parent) is None \
                and parent.get("sec-type") == "intro" and parent.getparent() is not None and local(parent.getparent()) == "front":
            rep.warn("W-IMPL-REJECT", "引言中的条：格式上合法（4.3.4），但导入暂拒（M-4.3.4-02/03，rejectKind=implementation，IR 缺口）", el=el)
        if key in REJECT_ELEMENTS:
            mid, conv, why = REJECT_ELEMENTS[key]
            rep.error("REJECT", "<%s> 在支持矩阵中为 import: reject（rejectKind=format；%s，%s）：%s" % (name, mid, conv, why), el=el)
        elif nsuri(el) is None and local(el) in _UNPREFIXED_MATHML:
            rep.error("REJECT", "无前缀的 MathML 元素 <%s>（M-7.4-12，C-T-19：MathML 元素必须带 mml: 前缀并绑定到 %s）"
                      % (name, NS_MML), el=el)
        if key in ("table", "table-wrap") and any(
            is_element(a) and local(a) in ("td", "th") and nsuri(a) is None for a in el.iterancestors()
        ):
            rep.error("REJECT", "单元格内出现 <%s>：6.1 规定不使用嵌套表（M-6.1-06，C-T-13）" % name, el=el)
        if key == "std" and pkey == _clark(NS_TBX, "source"):
            rep.error("REJECT", "tbx:source 内的标准不加 std（9.2.8，M-9.2.8-02）", el=el)
        if key == "fn" and pkey == "fig":
            rep.error("REJECT", "fig 内的 fn（图脚注）原文没有规定标记（M-8.6-02，C-T-32）", el=el)
        if key == _clark(NS_TBX, "termEntry") and any(
            is_element(a) and _clark(nsuri(a), local(a)) == _clark(NS_TBX, "termEntry")
            for a in el.iterancestors()
        ):
            rep.error("REJECT", "嵌套的 tbx:termEntry（M-9.1-03，C-T-47：术语分组用嵌套 sec，不用嵌套条目）", el=el)
        if key == _clark(NS_TBX, "definition") and el.get("target") is not None:
            rep.error("REJECT", "tbx:definition/@target 仅附录 C 列出，无解释（M-C.1-08，C-T-46）", el=el)
        if key in (_clark(NS_TBX, "normativeAuthorization"), _clark(NS_TBX, "normativeAuthentication")):
            v = el.get("value") or ""
            if v.endswith("-admn-sts"):
                rep.error("REJECT", "采用级别取值 %r：全文没有 *-admn-sts 取值，仅 preferredTerm/admittedTerm/deprecatedTerm"
                          "（M-9.2.3-06，C-T-39）" % v, el=el)
        if key == "caption":
            titles = [c for c in el if is_element(c) and local(c) == "title" and nsuri(c) is None]
            if len(titles) > 1:
                rep.error("REJECT", "caption 内有 %d 个 title：表题/图题英文版原文无规定（M-6.2.1-06、M-8.2-07，D-T-03）"
                          % len(titles), el=el)


# --------------------------------------------------------------------------------------------
# 5. 语义层
# --------------------------------------------------------------------------------------------

DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

SEC_TYPE_FRONT = {"foreword", "intro"}
SEC_TYPE_CHAPTER = {"scope", "norm-refs", "terms"}
SEC_TYPE_CHAPTER_IMPORT_ONLY = {"norm_refs"}
SEC_TYPE_RESERVED = SEC_TYPE_FRONT | SEC_TYPE_CHAPTER | SEC_TYPE_CHAPTER_IMPORT_ONLY | {"numbered-paragraph"}

LIST_TYPES = {"alpha-lower", "arabic", "roman-lower", "dash", "bullet"}
LIST_TYPES_UNORDERED = {"dash", "bullet"}

PROCESSING_META = {
    "base-tagset": "interchange",
    "mathml-version": "3.0",
    "table-model": "xhtml",
    "terminology-model": "tbx",
    "math-representation": "mathml",
    "tagset-family": "sts",
}

_LEGACY_ID_V7 = [
    (re.compile(r"^ext_"), "以 ext_ 开头（Resolver 的内部占位 id，不得进入 XML，R-5）"),
    (re.compile(r"^Formula"), "Formula… 形式（原文示例瑕疵，应为 formula_<编号>，X-21）"),
    (re.compile(r"^id-[0-9A-Fa-f]+(?:-[0-9A-Fa-f]+)+$"), "id-<uuid> 形式（转换工具生成物，2.3 节）"),
    (re.compile(r"^p-\d+$"), "p-<数字> 形式（段落不带 id，E.1、X-18）"),
]

# xref/@ref-type → 允许的目标元素（Clark 名）。None 表示不限。
_XREF_TARGETS = {
    # sec_bibl、sec_index 是参考文献清单与索引的固定 id（附录 E），引用它们按“章”处理
    "sec": {"sec", "term-sec", "ref-list", "index"},
    "app": {"app"},
    "fig": {"fig", "fig-group"},
    "table": {"table-wrap"},
    "disp-formula": {"disp-formula"},
    "bibr": {"ref", "mixed-citation"},
    "fn": {"fn"},
    "table-fn": {"fn"},
    "list": {"list-item", "list"},
    "abbreviation": {"def-item"},
    "other": None,
    "chem": None,
}
_CUSTOM_TARGETS = {
    "term-entry": {_clark(NS_TBX, "termEntry")},
    "note": {"non-normative-note", _clark(NS_TBX, "note")},
    "example": {"non-normative-example", _clark(NS_TBX, "example")},
}

_ALLOWED_LINK_SCHEMES = {"http", "https", "mailto", "ftp"}
_SCHEME_RE = re.compile(r"^([A-Za-z][A-Za-z0-9+.\-]*):")

IMPORT_ONLY_RULE = "IMPORT-ONLY"


def _import_only(rep: Report, msg: str, el) -> None:
    """仅导入接受的异写：默认（import）告警，profile=export 时视为错误。"""
    if rep.profile == "export":
        rep.error(IMPORT_ONLY_RULE, msg + "（导出不得使用）", el=el)
    else:
        rep.warn(IMPORT_ONLY_RULE, msg + "（仅导入接受，导出须规范化）", el=el)


# V-12 STD-META-ORDER：std-meta 子元素的“导出次序”= 官方 STS 1.2 DTD 的次序；国标特有元素按
# schemas/gbt46687.2/metadata.rng 文件头的约定插入（std-type 最前；ccs 紧随 ics；implementation-date 紧随 release-date；
# equivalence 紧随 implementation-date；std-supersedes 在 std-xref 之前）。原文没有规定次序，4.1 示例自己把 ics、ccs 写在
# title-wrap 之前，所以结构层（RELAX NG）不限次序，导入只告警，导出才算错误。
STD_META_EXPORT_ORDER = (
    ("std-type",), ("title-wrap",), ("proj-id",), ("release-version",), ("std-ident",), ("std-org", "std-org-group"),
    ("content-language",), ("std-ref",), ("doc-ref",), ("release-date",), ("implementation-date",), ("equivalence",),
    ("comm-ref",), ("secretariat",), ("ics",), ("ccs",), ("page-count",), ("std-supersedes",), ("std-xref",),
    ("permissions",), ("custom-meta-group",),
)
STD_META_RANK = {name: i for i, group in enumerate(STD_META_EXPORT_ORDER) for name in group}
STD_META_ORDER_RULE = "V-12"


def check_std_meta_order(el, rep: Report) -> None:
    kids = [c for c in el if is_element(c) and nsuri(c) is None and local(c) in STD_META_RANK]
    seen_max = -1
    seen_el = None
    first_bad = None
    for c in kids:
        r = STD_META_RANK[local(c)]
        if r < seen_max and first_bad is None:
            first_bad = (c, seen_el)
        if r >= seen_max:
            seen_max, seen_el = r, c
    if first_bad is None:
        return
    bad, after = first_bad
    actual = ", ".join(local(c) for c in kids)
    expected = ", ".join(local(c) for c in sorted(kids, key=lambda c: STD_META_RANK[local(c)]))
    msg = ("STD-META-ORDER：std-meta 的子元素次序不是导出次序：<%s>（行 %s）出现在 <%s>（行 %s）之后。实际次序：%s；导出次序：%s"
           % (local(bad), bad.sourceline, local(after), after.sourceline, actual, expected))
    if rep.profile == "export":
        rep.error(STD_META_ORDER_RULE, msg + "（导出须按 STS 1.2 次序，C-S-11）", el=el)
    else:
        rep.warn(STD_META_ORDER_RULE, msg + "（原文条文没有规定次序，4.1 示例自己就把 ics、ccs 写在 title-wrap 之前，导入接受；导出须规范化，C-S-11）", el=el)


# V-13 REQUIRED-ID：矩阵与附录 E 要求导出必须写 id 的元素。RELAX NG 里 id 一律可选（第三方文件缺 id 仍应可导入，
# 导入器自生成内部 nodeId；被引用的目标缺 id 由 V-1 的 rid 可解析性检查捕获），所以必备性放在这里：
# export 档为错误，import 档为告警。依据逐项来自 docs/wp8.1/matrix-*.json 的 id 属性行（obligation=shall）与附录 E（印刷页 67，M-E-*）。
REQUIRED_ID_RULE = "V-13"


def _kids(el, name):
    return [c for c in el if is_element(c) and nsuri(c) is None and local(c) == name]


def _has_text_label(el) -> bool:
    return any(text_of(c) for c in _kids(el, "label"))


def _in_bibl_ref_list(el) -> bool:
    parent = el.getparent()
    return parent is not None and is_element(parent) and nsuri(parent) is None and local(parent) == "ref-list" \
        and parent.get("content-type") == "bibl"


def _in_table_wrap_foot(el) -> bool:
    parent = el.getparent()
    return parent is not None and is_element(parent) and nsuri(parent) is None and local(parent) == "table-wrap-foot"


def _fn_has_body(el) -> bool:
    return bool(_kids(el, "p")) or any(c.tail and c.tail.strip() for c in el) or bool((el.text or "").strip())


# (命名空间, 本地名, 适用条件, 依据)；条件为 None 表示一律适用
REQUIRED_ID_ELEMENTS = [
    (None, "term-sec", None,
     "每个 term-sec 必须有 id（9.2.1 印刷页 35“ID 同时用于 term-sec 和 tbx:termEntry”，矩阵 M-9.2.1-01/02 obligation=shall；附录 E M-E-07）"),
    (NS_TBX, "termEntry", None,
     "每个 tbx:termEntry 必须有 id（9.2.1 印刷页 35，矩阵 M-9.2.1-04/05 obligation=shall；附录 E M-E-08）；"
     "原文印刷页 38、39 的示例省略了 id，所以导入只告警"),
    (None, "sec", lambda e: _has_text_label(e) or e.get("sec-type") in ("foreword", "intro"),
     "有编号的章条（带 label）、前言、引言的 sec 导出必须写 id（附录 E 印刷页 67，M-E-01/02/04，C-S-37）"),
    (None, "app", None, "app 导出必须写 id（附录 E 印刷页 67，M-E-04；M-4.5.2-02）"),
    (None, "ref-list", lambda e: e.get("content-type") == "bibl",
     "参考文献表 ref-list 导出必须写 id（附录 E 印刷页 67，M-E-03；M-4.5.3-01，示例 sec_bibl）"),
    (None, "index", None, "index 导出必须写 id（附录 E 印刷页 67，M-E-03，示例 sec_index）"),
    (None, "ref", lambda e: _in_bibl_ref_list(e) or _has_text_label(e),
     "参考文献的 ref（或带 label 的 ref）必须有 id（4.5.3.1 印刷页 12“@id=biblref_[label 的值]”，矩阵 M-4.5.3.1-01 obligation=shall；"
     "附录 E M-E-05；无 label 的规范性引用条目 id 可选，M-E-06）"),
    (None, "table-wrap", _has_text_label,
     "带编号（label）的表必须有 id（附录 E 印刷页 67，M-E-10；无 label 的表 M-E-11 不适用）"),
    (None, "fig", None, "fig 导出必须写 id（附录 E 印刷页 67，M-E-12；M-8.2-01）"),
    (None, "disp-formula", _has_text_label,
     "带编号（label）的行间公式必须有 id（附录 E 印刷页 67，M-E-13；无编号公式不写 id，X-21）"),
    (None, "fn", lambda e: _in_table_wrap_foot(e),
     "表脚注 fn 必须有 id（6.2.3 印刷页 21，矩阵 M-6.2.3-07 obligation=shall；附录 E M-E-18）"),
    (None, "fn", lambda e: not _in_table_wrap_foot(e) and _fn_has_body(e),
     "正文脚注 fn 必须有 id（10.1.8 印刷页 48，矩阵 M-10.1.8-01；附录 E M-E-15/16；无正文的 fn 的 id 可选，M-E-17）"),
]


def check_required_ids(elems, rep: Report) -> None:
    for el in elems:
        ns = nsuri(el)
        name = local(el)
        if el.get("id") is not None or el.get(_clark(NS_XML, "id")) is not None:
            continue
        for rns, rname, cond, why in REQUIRED_ID_ELEMENTS:
            if rns != ns or rname != name:
                continue
            if cond is not None and not cond(el):
                continue
            msg = "REQUIRED-ID：<%s> 缺少 id。%s" % (label(el), why)
            if rep.profile == "export":
                rep.error(REQUIRED_ID_RULE, msg + "（导出必须写 id）", el=el)
            else:
                rep.warn(REQUIRED_ID_RULE, msg + "（导入接受：第三方文件缺 id 仍可导入，导入器自生成内部 nodeId；被引用时由 V-1 报悬空）", el=el)
            break


def semantic_checks(tree, rep: Report) -> None:
    root = tree.getroot()
    elems = [e for e in root.iter() if is_element(e)]
    id_map: dict[str, object] = {}

    # ---------------- V-1 id 唯一与合法；rid / target 可解析 ----------------
    for el in elems:
        for attr in ("id", _clark(NS_XML, "id")):
            val = el.get(attr)
            if val is None:
                continue
            shown = "xml:id" if attr != "id" else "id"
            if not NCNAME_RE.match(val):
                rep.error("V-1", "%s=%r 不是合法的 XML ID（Name/NCName 产生式）" % (shown, val), el=el)
            if val in id_map:
                first = id_map[val]
                rep.error("V-1", "重复的 %s=%r（<%s>，首次出现在行 %s 的 <%s>）"
                          % (shown, val, label(el), first.sourceline, label(first)), el=el)
            else:
                id_map[val] = el

    xrefs = [e for e in elems if nsuri(e) is None and local(e) == "xref"]
    entailed = [e for e in elems if nsuri(e) == NS_TBX and local(e) == "entailedTerm"]
    fn_refs: dict[str, int] = {}
    for el in xrefs:
        rid = el.get("rid")
        if rid is None:
            continue
        tokens = rid.split()
        if len(tokens) > 1:
            rep.warn("W-RID-MULTI", "xref/@rid 含多个标识符 %r：IR 一次只能引用一个目标，导入时会拒绝（G-T-15）" % rid, el=el)
        for t in tokens:
            if t not in id_map:
                rep.error("V-1", "xref 的 rid=%r 无法解析：文档中没有该 id（悬空引用）" % t, el=el)
        if el.get("ref-type") == "fn" and tokens:
            fn_refs[tokens[0]] = fn_refs.get(tokens[0], 0) + 1
    for el in entailed:
        t = el.get("target")
        if t is not None and t not in id_map:
            rep.error("V-1", "tbx:entailedTerm 的 target=%r 无法解析：文档中没有该 id（悬空引用）" % t, el=el)
    for fid, cnt in fn_refs.items():
        if cnt > 1:
            rep.warn("W-FN-MULTIREF", "脚注 %r 被 %d 处 xref 引用：IR 是原位脚注，导入时会拒绝（M-10.1.8-04，G-T-19）" % (fid, cnt))

    # ---------------- V-2 sec-type 与位置 ----------------
    for el in elems:
        if nsuri(el) is not None or local(el) != "sec":
            continue
        st = el.get("sec-type")
        parent = el.getparent()
        pname = local(parent) if parent is not None and is_element(parent) and nsuri(parent) is None else None
        if pname == "front":
            if st not in SEC_TYPE_FRONT:
                rep.error("V-2", "front 内的 sec 只能是 sec-type=foreword 或 intro，实际为 %r" % st, el=el)
        elif pname == "body":
            if st in SEC_TYPE_FRONT or st == "numbered-paragraph":
                rep.error("V-2", "body 顶层的章不能使用 sec-type=%r（章只用 scope/norm-refs/terms 或不写）" % st, el=el)
            elif st in SEC_TYPE_CHAPTER_IMPORT_ONLY:
                _import_only(rep, "sec-type=%r 是 norm-refs 的下划线异写（4.4.2.3.2 示例）" % st, el)
            elif st is not None and st not in SEC_TYPE_CHAPTER:
                rep.warn("W-SECTYPE", "sec-type=%r 不是已知章角色，导入时按 general 处理（C-S-06、表 D.1 行 13）" % st, el=el)
        else:
            if st in SEC_TYPE_RESERVED - {"numbered-paragraph"}:
                rep.error("V-2", "sec-type=%r 只在对应位置识别（front 内 foreword/intro；body 顶层 scope/norm-refs/terms），"
                          "此处位于 %s 之内" % (st, pname), el=el)
            elif st is not None and st != "numbered-paragraph":
                rep.warn("W-SECTYPE", "sec-type=%r 不是已知取值，导入时按 general 处理（C-S-06）" % st, el=el)
        has_title = any(is_element(c) and local(c) == "title" and nsuri(c) is None for c in el)
        if st == "numbered-paragraph" and has_title:
            rep.error("V-2", "sec-type=numbered-paragraph 的无标题条不得含 title（4.4.2.5、C-S-08）", el=el)
        if pname in ("body",) and not has_title:
            rep.error("V-2", "章（body 顶层 sec）必须有 title；无标题只适用于条（4.4.2.5）", el=el)

    # ---------------- V-3 app / ref-list 的 content-type ----------------
    for el in elems:
        if nsuri(el) is not None:
            continue
        name = local(el)
        if name == "app":
            ct = el.get("content-type")
            if ct in ("informative", "normative"):
                at = el.find("annex-type")
                if at is not None:
                    txt = text_of(at)
                    if ct == "informative" and "规范性" in txt and "资料性" not in txt:
                        rep.warn("W-ANNEX-TYPE", "annex-type=%r 与 content-type=informative 矛盾，以 content-type 为准" % txt, el=at)
                    if ct == "normative" and "资料性" in txt:
                        rep.warn("W-ANNEX-TYPE", "annex-type=%r 与 content-type=normative 矛盾，以 content-type 为准" % txt, el=at)
            elif ct in ("inform-annex", "inform_annex"):
                _import_only(rep, "app/@content-type=%r（4.1 骨架/4.5.2.2 示例的异写，规范化为 informative）" % ct, el)
            else:
                rep.error("V-3", "app/@content-type=%r：只接受 informative 或 normative（4.2、表 1）" % ct, el=el)
        elif name == "ref-list":
            ct = el.get("content-type")
            if ct in ("norm-refs", "bibl"):
                pass
            elif ct in ("norm_refs", "bibr"):
                _import_only(rep, "ref-list/@content-type=%r 的异写（4.4.2.3.2 / 10.1.6 示例）" % ct, el)
            else:
                rep.error("V-3", "ref-list/@content-type=%r：只接受 norm-refs 或 bibl（4.4.2.3、4.5.3）" % ct, el=el)
            if ct in ("norm-refs", "norm_refs"):
                parent = el.getparent()
                ptype = parent.get("sec-type") if parent is not None and is_element(parent) else None
                if ptype not in ("norm-refs", "norm_refs"):
                    rep.error("V-3", "content-type=norm-refs 的 ref-list 必须位于 sec-type=norm-refs 的章内（4.4.2.3.1）", el=el)

    # ---------------- V-4 日期 ----------------
    release = [e for e in elems if nsuri(e) is None and local(e) == "release-date"]
    implem = [e for e in elems if nsuri(e) is None and local(e) == "implementation-date"]

    def parse_date(el):
        txt = text_of(el)
        m = DATE_RE.match(txt)
        if not m:
            rep.error("V-4", "<%s> 的内容 %r 不是 YYYY-MM-DD" % (local(el), txt), el=el)
            return None
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            rep.error("V-4", "<%s> 的内容 %r 不是有效日期" % (local(el), txt), el=el)
            return None

    rel_dates = {id(e): parse_date(e) for e in release}
    imp_dates = {id(e): parse_date(e) for e in implem}
    typed = {"": [], "published": [], "implemented": []}
    for el in release:
        dt = el.get("date-type")
        if dt is None:
            typed[""].append(el)
        elif dt in ("published", "implemented"):
            typed[dt].append(el)
            _import_only(rep, "release-date/@date-type=%r（4.1 示例写法，D-S-01）" % dt, el)
        else:
            rep.error("V-4", "release-date/@date-type=%r：只接受 published 或 implemented" % dt, el=el)
    pub = typed[""] + typed["published"]
    if len(pub) > 1:
        rep.error("V-4", "发布日期重复表达：共 %d 个 release-date 表示发布日期（不带 date-type 与 date-type=published 视为同一语义）；"
                  "若其中一个是实施日期，应改写为 implementation-date，不得放进 release-date" % len(pub), el=pub[1])
    if len(typed["implemented"]) > 1:
        rep.error("V-4", "实施日期重复表达：共 %d 个 release-date[@date-type=implemented]" % len(typed["implemented"]),
                  el=typed["implemented"][1])
    if len(implem) > 1:
        rep.error("V-4", "implementation-date 出现 %d 次" % len(implem), el=implem[1])
    if typed["implemented"] and implem:
        a = rel_dates.get(id(typed["implemented"][0]))
        b = imp_dates.get(id(implem[0]))
        how = "两处日期一致" if a and b and a == b else "两处日期不一致"
        rep.error("V-4", "实施日期重复表达：同时使用 release-date[@date-type=implemented] 与 implementation-date（%s）；"
                  "同一份文件里两种写法不得重复表达同一日期（D-S-01）" % how, el=implem[0])
    if pub and implem:
        a = rel_dates.get(id(pub[0]))
        b = imp_dates.get(id(implem[0]))
        if a and b and a > b:
            rep.warn("W-DATE-ORDER", "发布日期 %s 晚于实施日期 %s（疑似把实施日期写进了 release-date）" % (a, b), el=pub[0])

    # ---------------- V-5 列项 ----------------
    for el in elems:
        if nsuri(el) is not None or local(el) != "list":
            continue
        lt = el.get("list-type")
        if lt not in LIST_TYPES:
            rep.error("V-5", "list/@list-type=%r：只接受 %s（5.7；simple/symbol 不接受，C-S-32）"
                      % (lt, "、".join(sorted(LIST_TYPES))), el=el)
            continue
        items = [c for c in el if is_element(c) and local(c) == "list-item"]
        for it in items:
            has_label = any(is_element(c) and local(c) == "label" for c in it)
            if lt in LIST_TYPES_UNORDERED and has_label:
                rep.error("V-5", "无序列项（list-type=%s）的 list-item 不应带 label（5.7.2、C-S-32）" % lt, el=it)
            if lt not in LIST_TYPES_UNORDERED and not has_label:
                rep.warn("W-LIST-LABEL", "有序列项（list-type=%s）的 list-item 缺少 label（序号在 label 中体现，5.7.1）" % lt, el=it)

    # ---------------- V-6 processing-meta 与 title-wrap ----------------
    for el in elems:
        if nsuri(el) is not None:
            continue
        if local(el) == "processing-meta":
            for attr, expected in PROCESSING_META.items():
                v = el.get(attr)
                if v != expected:
                    rep.error("V-6", "processing-meta/@%s=%r，应为 %r（C-S-04、D-S-03）" % (attr, v, expected), el=el)
            parent = el.getparent()
            if parent is not None and parent.index(el) != 0:
                rep.warn("W-PM-POSITION", "processing-meta 不是 standard 的第一个子元素（项目约定：第一个）", el=el)
        elif local(el) == "title-wrap":
            if el.get(_clark(NS_XML, "lang")) is None:
                rep.error("V-6", "title-wrap 缺少 xml:lang（C-S-13）", el=el)

    # ---------------- V-12 std-meta 子元素次序（导出严格、导入告警） ----------------
    for el in elems:
        if nsuri(el) is None and local(el) == "std-meta":
            check_std_meta_order(el, rep)

    # ---------------- V-13 必备 id（导出严格、导入告警） ----------------
    check_required_ids(elems, rep)

    # ---------------- V-7 遗留 id 形式 ----------------
    for el in elems:
        for attr in ("id", _clark(NS_XML, "id")):
            val = el.get(attr)
            if not val:
                continue
            for rx, why in _LEGACY_ID_V7:
                if rx.search(val):
                    rep.error("V-7", "id=%r %s" % (val, why), el=el)
                    break

    # ---------------- V-8 xref 与目标类型一致 ----------------
    for el in xrefs:
        rid = el.get("rid")
        rt = el.get("ref-type")
        if not rid or rt is None:
            continue
        for t in rid.split():
            target = id_map.get(t)
            if target is None:
                continue  # 悬空引用已由 V-1 报告
            tkey = _clark(nsuri(target), local(target))
            if rt == "custom":
                ct = el.get("custom-type")
                allowed = _CUSTOM_TARGETS.get(ct)
                if allowed is not None and tkey not in allowed:
                    rep.error("V-8", "xref[ref-type=custom custom-type=%s] 指向 <%s>（%r），应指向 %s（C-T-48、C-T-50）"
                              % (ct, label(target), t, "、".join(sorted(allowed))), el=el)
                continue
            allowed = _XREF_TARGETS.get(rt)
            if allowed is not None and tkey not in allowed:
                rep.error("V-8", "xref[ref-type=%s] 指向 <%s>（%r），应指向 %s（C-T-48）"
                          % (rt, label(target), t, "、".join(sorted(allowed))), el=el)
            elif rt == "table-fn":
                wrap = target.getparent().getparent() if target.getparent() is not None else None
                if wrap is None or local(wrap) != "table-wrap" or wrap not in list(el.iterancestors()):
                    rep.error("V-8", "xref[ref-type=table-fn] 必须指向同一 table-wrap 的表脚注（C-T-06）：%r" % t, el=el)
    for el in entailed:
        t = el.get("target")
        target = id_map.get(t) if t else None
        if target is not None and _clark(nsuri(target), local(target)) not in _CUSTOM_TARGETS["term-entry"]:
            rep.error("V-8", "tbx:entailedTerm 的 target=%r 指向 <%s>，应指向 tbx:termEntry（C-T-45）" % (t, label(target)), el=el)

    # ---------------- V-9 术语条目 ----------------
    for el in elems:
        if nsuri(el) != NS_TBX or local(el) != "termEntry":
            continue
        defs = [d for d in el.iter() if is_element(d) and nsuri(d) == NS_TBX and local(d) == "definition"]
        if len(defs) > 1:
            rep.error("V-9", "术语条目含 %d 个 tbx:definition：“每个术语条目必须有且仅有一个定义”（附录 C 行 92）" % len(defs), el=el)
        elif not defs:
            rep.warn("W-TERM-NODEF", "术语条目没有 tbx:definition（附录 C 行 92 要求有且仅有一个）", el=el)
    for el in elems:
        if nsuri(el) == NS_TBX and local(el) == "normativeAuthentication":
            _import_only(rep, "元素 <tbx:normativeAuthentication> 是 9.2.3 印刷页 37 说明文字中的异写（正式名 tbx:normativeAuthorization，D-T-06）", el)

    # ---------------- V-10 MathML 安全 ----------------
    for el in elems:
        if nsuri(el) != NS_MML:
            continue
        for aname, aval in el.attrib.items():
            plain = etree.QName(aname).localname.lower()
            if plain.startswith("on"):
                rep.error("V-10", "MathML 元素 <%s> 带事件属性 %s（C-T-19：不含脚本/事件属性）" % (label(el), aname), el=el)
            m = _SCHEME_RE.match(aval.strip())
            if plain in ("href", "altimg", "src") and m and m.group(1).lower() not in _ALLOWED_LINK_SCHEMES:
                rep.error("V-10", "MathML 元素 <%s> 的 %s 使用了不允许的协议 %r" % (label(el), aname, m.group(1)), el=el)
        if local(el) == "math" and el.get("id") and not re.fullmatch(r"mml_m\d+", el.get("id")):
            rep.warn("W-MML-ID", "mml:math/@id=%r 不符合 mml_m<k> 形式（7.4、X-22；导出时由渲染器重写）" % el.get("id"), el=el)

    # ---------------- V-11 外链协议 ----------------
    for el in elems:
        if nsuri(el) is None and local(el) == "ext-link":
            href = el.get(_clark(NS_XLINK, "href"))
            if href:
                m = _SCHEME_RE.match(href.strip())
                if m and m.group(1).lower() not in _ALLOWED_LINK_SCHEMES:
                    rep.error("V-11", "ext-link 的 xlink:href 使用了不允许的协议 %r（只接受 %s，C-T-56）"
                              % (m.group(1), "、".join(sorted(_ALLOWED_LINK_SCHEMES))), el=el)
            ltype = el.get("ext-link-type")
            if ltype not in (None, "uri"):
                rep.warn("W-EXTLINK-TYPE", "ext-link/@ext-link-type=%r：10.1.9 要求 uri，其他取值导入时告警（C-T-56）" % ltype, el=el)

    # ---------------- 其余仅导入接受的写法与取值告警 ----------------
    for el in elems:
        if nsuri(el) is None:
            name = local(el)
            if name == "monospace":
                _import_only(rep, "<monospace>（导出用 inline-code，D-S-07）", el)
            elif name == "xref" and el.get("ref-type") in ("chem", "other"):
                _import_only(rep, "xref/@ref-type=%r（附录 D / 10.1.4 示例的写法，无类型语义，C-T-48）" % el.get("ref-type"), el)
            elif name == "named-content" and el.get("content-type") not in (None, "variable"):
                rep.warn("W-NAMED-CONTENT", "named-content/@content-type=%r：只有 variable 有定义，导入时去掉标记（C-S-30）" % el.get("content-type"), el=el)
            elif name == "table-wrap" and el.get("position") is not None:
                _import_only(rep, "table-wrap/@position（附录 C 列出，正文无说明）", el)
            elif name == "std-ref" and any(is_element(c) and local(c) == "edition" for c in el):
                _import_only(rep, "std-ref 内含 edition（表 C.1 行 118 备注）", el)
            elif name == "graphic":
                ct = el.get("content-type")
                if ct not in (None, "image", "disp_table", "disp-formula"):
                    rep.warn("W-GRAPHIC-TYPE", "graphic/@content-type=%r：已知取值 image/disp_table/disp-formula，其他值导入时忽略（C-T-28）" % ct, el=el)
            elif name == "inline-graphic" and el.get("specific-use") == "size:T":
                rep.warn("W-SIZE-T", "inline-graphic 不应使用 size:T（8.3 表 2：缩略图仅用于 graphic，C-T-28）", el=el)
            if name in ("td", "th", "tr", "col", "colgroup", "thead", "tbody") and el.get("valign") == "center":
                _import_only(rep, "valign=\"center\"（6.4 示例，不在 6.3.2 取值内）", el)


# --------------------------------------------------------------------------------------------
# 总控
# --------------------------------------------------------------------------------------------

class Validator:
    def __init__(self, schema_path: Path = DEFAULT_SCHEMA, profile: str = "import", use_xmllint: bool = True,
                 xmllint_exe: str | None = None):
        if profile not in ("import", "export"):
            raise ValueError("profile 只能是 import 或 export")
        self.schema_path = Path(schema_path)
        self.profile = profile
        self.use_xmllint = use_xmllint
        self.xmllint_exe = xmllint_exe or shutil.which("xmllint")
        self._rng = None
        self._xmllint_version = None

    @property
    def rng(self):
        if self._rng is None:
            self._rng = load_relaxng(self.schema_path)
        return self._rng

    def validate_file(self, path) -> Report:
        path = str(path)
        rep = Report(path, self.profile)
        try:
            raw = Path(path).read_bytes()
        except OSError as exc:
            rep.error("IO", "无法读取文件：%s" % exc)
            rep.consistent = True
            return rep

        check_syntax_raw(raw, rep, self.profile)
        tree = parse_secure(raw, rep)

        # 结构：两个实现
        lx_ok, lx_msgs = (False, [])
        if tree is not None:
            lx_ok, lx_msgs = run_lxml_relaxng(self.rng, tree)
        else:
            lx_msgs = [{"message": "文件不是格式良好的 XML，未进入 RELAX NG 校验"}]
        rep.engines["lxml"] = {
            "implementation": "lxml %s / libxml2 %s" % (".".join(map(str, etree.LXML_VERSION)),
                                                          ".".join(map(str, etree.LIBXML_VERSION))),
            "valid": lx_ok,
            "messages": lx_msgs,
        }
        if self.use_xmllint:
            if not self.xmllint_exe:
                rep.engines["xmllint"] = {"implementation": None, "valid": None,
                                          "messages": [{"message": "找不到 xmllint；可用 --no-xmllint 显式跳过"}]}
                rep.error("ENGINE", "找不到 xmllint，无法做第二实现交叉核对（--no-xmllint 可显式跳过）")
            else:
                if self._xmllint_version is None:
                    self._xmllint_version = xmllint_version(self.xmllint_exe)
                xl_ok, xl_msgs = run_xmllint(self.xmllint_exe, self.schema_path, path)
                rep.engines["xmllint"] = {"implementation": self._xmllint_version, "valid": xl_ok, "messages": xl_msgs}
                if xl_ok != lx_ok:
                    rep.consistent = False
                    rep.error("CONSISTENCY",
                              "两个实现结论不一致：lxml=%s，xmllint=%s（schema 或实现版本问题，必须查明）"
                              % ("通过" if lx_ok else "不通过", "通过" if xl_ok else "不通过"))
        if tree is not None and not lx_ok:
            at_line: dict[int, object] = {}
            for e in tree.getroot().iter():
                if is_element(e) and e.sourceline:
                    at_line.setdefault(e.sourceline, e)
            for m in lx_msgs:
                where = at_line.get(m.get("line"))
                suffix = "（出错位置：行 %s 的 <%s>）" % (m.get("line"), label(where)) if where is not None else ""
                rep.error("RNG", "RELAX NG（lxml）：%s%s" % (m["message"], suffix), line=m.get("line"))
        if self.use_xmllint and tree is None and rep.engines.get("xmllint", {}).get("valid") is False:
            pass  # 格式错误已由 SYN-1 报告

        if tree is not None:
            detect_legacy(tree, rep)
            check_rejects(tree, rep)
            semantic_checks(tree, rep)
        return rep


# --------------------------------------------------------------------------------------------
# 命令行
# --------------------------------------------------------------------------------------------

def format_human(rep: Report) -> str:
    out = ["=== %s" % rep.path, "结果：%s（profile=%s）" % ("通过" if rep.valid else "不通过", rep.profile)]
    for name, eng in rep.engines.items():
        v = eng.get("valid")
        out.append("引擎 %s：%s（%s）" % (name, {True: "通过", False: "不通过", None: "未运行"}[v], eng.get("implementation")))
    if len(rep.engines) > 1:
        out.append("两个实现结论：%s" % ("一致" if rep.consistent else "不一致"))
    if rep.errors:
        out.append("错误 %d 个：" % len(rep.errors))
        for e in rep.errors:
            where = " 行 %s" % e["line"] if "line" in e else ""
            path = " %s" % e["path"] if "path" in e else ""
            out.append("  [%s]%s%s：%s" % (e["rule"], where, path, e["message"]))
    if rep.warnings:
        out.append("警告 %d 个：" % len(rep.warnings))
        for e in rep.warnings:
            where = " 行 %s" % e["line"] if "line" in e else ""
            out.append("  [%s]%s：%s" % (e["rule"], where, e["message"]))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="validate.py",
        description="GB/T 46687.2—2026 标准 XML 校验（语法 + 项目自写 RELAX NG + 语义规则；项目实现约定，非官方）。",
    )
    ap.add_argument("files", nargs="+", metavar="file.xml")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON（字段 results[].errors/warnings/engines）")
    ap.add_argument("--profile", choices=("import", "export"), default="import",
                    help="import（默认）：仅导入接受的异写只告警；export：视为错误，并拒绝 DOCTYPE")
    ap.add_argument("--schema", default=str(DEFAULT_SCHEMA), help="RELAX NG 主文件（默认 schemas/gbt46687.2/ses-gbt46687-2.rng）")
    ap.add_argument("--no-xmllint", action="store_true", help="跳过 xmllint 第二实现（不推荐）")
    ap.add_argument("--version", action="version", version="validate.py " + VERSION)
    args = ap.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # pragma: no cover
            pass

    v = Validator(Path(args.schema), profile=args.profile, use_xmllint=not args.no_xmllint)
    try:
        v.rng  # 先编译 schema：schema 本身有问题时直接报错退出，而不是逐个文件报同样的错
    except (etree.LxmlError, OSError) as exc:
        sys.stderr.write("无法加载 RELAX NG schema %s：%s\n" % (args.schema, exc))
        return 1
    reports = [v.validate_file(f) for f in args.files]
    ok = all(r.valid for r in reports)
    if args.json:
        payload = {"tool": "validate.py", "version": VERSION, "schema": str(Path(args.schema)),
                   "profile": args.profile, "valid": ok, "results": [r.to_dict() for r in reports]}
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    else:
        for r in reports:
            sys.stdout.write(format_human(r) + "\n")
        if len(reports) > 1:
            sys.stdout.write("\n共 %d 个文件，%d 个通过，%d 个未通过\n"
                             % (len(reports), sum(r.valid for r in reports), sum(not r.valid for r in reports)))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
