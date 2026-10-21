#!/usr/bin/env python3
"""NISO STS 1.2（Interchange，MathML 3）官方 DTD 兼容性检查（项目实现约定，非官方）。

    python3 -I scripts/xml46687/sts_compat.py [--json] [--list-whitelist] [--dtd PATH] file.xml [...]

用法背景：项目自写 schema（schemas/gbt46687.2）是验收基准，官方 STS 1.2 DTD 只作辅助的、独立的兼容性证据
（docs/wp8.1/README.md 3A）。本工具用 `xmllint --noout --nonet --dtdvalid <DTD>` 校验文件，把报错分成两类：

  * 已知偏差：属于下面 WHITELIST 里登记的情形。每条都写明依据（46687.2 原文条款与印刷页，或 DTD 中的事实）和类别：
      国标特有扩展   原文标注“中国标准特有”或 4.3.2/表 C.1 列出、而 STS 1.2 DTD 没有声明的元素
      原文与STS冲突  46687.2 原文明确的写法与 STS 1.2 内容模型冲突，以原文为准
      待决扩展       原文没有规定、尚待决定的写法（如 D-T-10 正文脚注位置）
  * 未解释偏差：其余全部报错。任何未解释偏差都意味着样例或 schema 有问题（或白名单漏登记）。

实现方式：xmllint 的 DTD 报错无法区分“被白名单解释”与“未解释”，因此先对文档的副本按白名单做规范化
（删除国标扩展元素、把异写改成 STS 写法、调整位置等，见各条的 transform），再校验副本：
副本上仍存在的报错 = 未解释偏差；原文档上有、副本上消失的报错 = 已知偏差，并列出触发它的白名单条目。
副本上的行号会映射回原文档的行号。

退出码：0 = 没有未解释偏差；1 = 有未解释偏差、或文件不是格式良好的 XML、或找不到 xmllint/DTD。
只依赖 Python 3 标准库与 lxml；不联网；解析时禁止实体展开与 DTD 加载。
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DTD = ROOT / "schemas" / "niso-sts-1.2" / "interchange-mathml3-dtd" / "NISO-STS-interchange-1-mathml3.dtd"

NS_TBX = "urn:iso:std:iso:30042:ed-1"

EXT = "国标特有扩展"
CONFLICT = "原文与STS冲突"
PENDING = "待决扩展"


def _local(el) -> str:
    return etree.QName(el).localname


def _ns(el):
    return etree.QName(el).namespace


def _is_el(n) -> bool:
    return isinstance(n.tag, str)


def _lines(*els):
    """元素及其父元素的原文档行号（在改动之前取），用来把报错归因到白名单条目。"""
    out = []
    for el in els:
        for n in (el, el.getparent() if el is not None else None):
            if n is not None and n.sourceline:
                out.append(n.sourceline)
    return out


# --------------------------------------------------------------------------------------------
# 白名单：每条 = (编号, 类别, 说明, 依据, transform)
# transform(root) 在副本上就地规范化，返回被改动位置的原文档行号列表的列表（每处改动一项）（用来把报错归因到条目）
# --------------------------------------------------------------------------------------------

def _t_remove_ext(names):
    def run(root):
        hit = []
        for el in list(root.iter()):
            if _is_el(el) and _ns(el) is None and _local(el) in names:
                parent = el.getparent()
                hit.append(_lines(el))
                # 删除元素但保留其尾部文本
                tail = el.tail
                prev = el.getprevious()
                if tail:
                    if prev is not None:
                        prev.tail = (prev.tail or "") + tail
                    else:
                        parent.text = (parent.text or "") + tail
                parent.remove(el)
        return hit
    return run


def _t_rename_authentication(root):
    hit = []
    for el in root.iter():
        if _is_el(el) and _ns(el) == NS_TBX and _local(el) == "normativeAuthentication":
            hit.append(_lines(el))
            el.tag = "{%s}normativeAuthorization" % NS_TBX
    return hit


def _t_valign_center(root):
    hit = []
    for el in root.iter():
        if _is_el(el) and el.get("valign") == "center":
            hit.append(_lines(el))
            el.set("valign", "middle")
    return hit


def _t_extra_std_org_names(root):
    hit = []
    for el in root.iter():
        if _is_el(el) and _ns(el) is None and _local(el) == "std-org":
            names = [c for c in el if _is_el(c) and _local(c) == "std-org-name"]
            for extra in names[1:]:
                hit.append(_lines(extra))
                el.remove(extra)
    return hit


def _unwrap(el):
    """用 el 的内容（文本与子元素）替换 el 本身，保留尾部文本。"""
    parent = el.getparent()
    idx = parent.index(el)
    prev = parent[idx - 1] if idx > 0 else None
    text, tail, children = el.text or "", el.tail or "", list(el)
    parent.remove(el)
    if text:
        if prev is not None:
            prev.tail = (prev.tail or "") + text
        else:
            parent.text = (parent.text or "") + text
    last = prev
    for i, ch in enumerate(children):
        parent.insert(idx + i, ch)
        last = ch
    if tail:
        if last is not None:
            last.tail = (last.tail or "") + tail
        else:
            parent.text = (parent.text or "") + tail


def _t_xref_label(root):
    hit = []
    for el in list(root.iter()):
        if _is_el(el) and _ns(el) is None and _local(el) == "label":
            parent = el.getparent()
            if parent is not None and _is_el(parent) and _local(parent) == "xref":
                hit.append(_lines(el))
                _unwrap(el)
    return hit


_LANGSET_DESCRIPTIVE = {"crossReference", "definition", "example", "externalCrossReference", "note", "see",
                        "source", "subjectField", "xGraphic", "xMathML", "xSource"}


def _t_langset_order(root):
    hit = []
    for el in root.iter():
        if _is_el(el) and _ns(el) == NS_TBX and _local(el) == "langSet":
            kids = [c for c in el if _is_el(c)]
            tigs = [c for c in kids if _ns(c) == NS_TBX and _local(c) == "tig"]
            desc = [c for c in kids if _ns(c) == NS_TBX and _local(c) in _LANGSET_DESCRIPTIVE]
            if not tigs or not desc:
                continue
            first_tig = el.index(tigs[0])
            late = [d for d in desc if el.index(d) > first_tig]
            if not late:
                continue
            for d in late:
                hit.append(_lines(d))
                el.remove(d)
            for d in late:
                el.insert(el.index(tigs[0]), d)
    return hit


def _t_table_wrap_graphic(root):
    hit = []
    for el in root.iter():
        if _is_el(el) and _ns(el) is None and _local(el) == "table-wrap":
            kids = [c for c in el if _is_el(c)]
            foot = [c for c in kids if _local(c) == "table-wrap-foot"]
            if not foot:
                continue
            fidx = el.index(foot[0])
            late = [c for c in kids if _local(c) == "graphic" and el.index(c) > fidx]
            if not late:
                continue
            for g in late:
                hit.append(_lines(g))
                el.remove(g)
            for g in late:
                el.insert(el.index(foot[0]), g)
    return hit


# std-meta 子元素次序（STS 1.2 DTD 的有序内容模型；只含 DTD 声明的、本 schema 使用的元素；
# 国标扩展元素已由前面的 EXT 条目删除）
_STD_META_DTD_ORDER = ("title-wrap", "proj-id", "release-version", "std-ident", ("std-org", "std-org-group"),
                       "content-language", "std-ref", "doc-ref", "release-date", "comm-ref", "secretariat", "ics",
                       "page-count", "std-xref", "permissions", "custom-meta-group")
_STD_META_RANK = {}
for _i, _g in enumerate(_STD_META_DTD_ORDER):
    for _n in ((_g,) if isinstance(_g, str) else _g):
        _STD_META_RANK[_n] = _i


def _t_std_meta_order(root):
    hit = []
    for el in root.iter():
        if _is_el(el) and _ns(el) is None and _local(el) == "std-meta":
            kids = [c for c in el if _is_el(c) and _ns(c) is None and _local(c) in _STD_META_RANK]
            ordered = sorted(kids, key=lambda c: _STD_META_RANK[_local(c)])
            if ordered == kids:
                continue
            positions = [el.index(c) for c in kids]
            moved = [c for c, o in zip(kids, ordered) if c is not o]
            hit.append(_lines(*moved))
            for c in kids:
                el.remove(c)
            for pos, c in zip(positions, ordered):
                el.insert(pos, c)
    return hit


_BLOCK_FN_PARENTS = {"sec", "app"}


def _t_block_fn(root):
    hit = []
    for el in list(root.iter()):
        if _is_el(el) and _ns(el) is None and _local(el) == "fn":
            parent = el.getparent()
            if parent is not None and _is_el(parent) and _ns(parent) is None and _local(parent) in _BLOCK_FN_PARENTS:
                hit.append(_lines(el))
                wrapper = etree.Element("p")
                wrapper.tail = el.tail
                el.tail = None
                parent.replace(el, wrapper)
                wrapper.append(el)
    return hit


WHITELIST = [
    {
        "id": "EXT-ccs", "category": EXT, "what": "元素 ccs（中国标准文献分类号）",
        "basis": "46687.2 表 C.1 行 10 备注“中国标准特有”（印刷页 56）；4.3.2（印刷页 5）列入 std-meta；STS 1.2 DTD 未声明 ccs",
        "transform": _t_remove_ext({"ccs"}),
    },
    {
        "id": "EXT-implementation-date", "category": EXT, "what": "元素 implementation-date（实施日期）",
        "basis": "46687.2 表 C.1 行 40 备注“中国标准特有”（印刷页 58）；4.3.2（印刷页 6）；STS 1.2 DTD 未声明",
        "transform": _t_remove_ext({"implementation-date"}),
    },
    {
        "id": "EXT-equivalence", "category": EXT, "what": "元素 equivalence（一致性程度）",
        "basis": "46687.2 表 C.1 行 32 备注“中国标准特有”（印刷页 58）；4.3.2（印刷页 6）；STS 1.2 DTD 未声明",
        "transform": _t_remove_ext({"equivalence"}),
    },
    {
        "id": "EXT-std-type", "category": EXT, "what": "元素 std-type（标准类型）",
        "basis": "46687.2 4.3.2（印刷页 5）列入 std-meta，表 C.1 行 82（印刷页 61）；表中未标“中国标准特有”，"
                 "但经核实 STS 1.2 DTD 未声明 std-type（DTD 的 std-meta 只有 std-meta-type 属性）",
        "transform": _t_remove_ext({"std-type"}),
    },
    {
        "id": "EXT-std-supersedes", "category": EXT, "what": "元素 std-supersedes（替代情况）",
        "basis": "46687.2 4.3.2（印刷页 6）列入 std-meta，表 C.1 行 81（印刷页 61）；表中未标“中国标准特有”，"
                 "但经核实 STS 1.2 DTD 未声明 std-supersedes（相近语义用 std-xref）",
        "transform": _t_remove_ext({"std-supersedes"}),
    },
    {
        "id": "ALIAS-normativeAuthentication", "category": CONFLICT,
        "what": "元素 tbx:normativeAuthentication（采用级别的异写名）",
        "basis": "46687.2 9.2.3 印刷页 37 三处说明文字写作 normativeAuthentication（主导人对照原图确认）；"
                 "STS 1.2 DTD 只有 tbx:normativeAuthorization；仅导入接受，导出一律写 normativeAuthorization",
        "transform": _t_rename_authentication,
    },
    {
        "id": "CONFLICT-valign-center", "category": CONFLICT, "what": "属性 valign=\"center\"",
        "basis": "46687.2 6.4 示例（印刷页 25）写 valign=\"center\"，不在 6.3.2 取值内；STS 1.2 枚举为 top/middle/bottom/baseline；"
                 "仅导入接受（C-T-08），导入当作 middle",
        "transform": _t_valign_center,
    },
    {
        "id": "CONFLICT-std-org-multi-name", "category": CONFLICT, "what": "一个 std-org 内有多个 std-org-name",
        "basis": "46687.2 4.1 示例（印刷页 3）在一个 std-org 内写了两个 std-org-name，C-S-15 导入约定接受；"
                 "STS 1.2：std-org 至多一个 std-org-name（std-org-name?, std-org-abbrev*, std-org-loc*）",
        "transform": _t_extra_std_org_names,
    },
    {
        "id": "CONFLICT-xref-label", "category": CONFLICT, "what": "xref 内含 label",
        "basis": "46687.2 10.1.8 示例（印刷页 48）<xref><label><sup>1)</sup></label></xref>；STS 1.2 的 xref 内容只有文本与格式，不含 label",
        "transform": _t_xref_label,
    },
    {
        "id": "CONFLICT-langSet-order", "category": CONFLICT, "what": "tbx:langSet 内描述性元素（如 tbx:note）位于 tbx:tig 之后",
        "basis": "46687.2 9.2.3 示例 2（印刷页 37）：subjectField、definition、tig、tig、note；STS 1.2：描述性元素必须全部在 tig 之前"
                 "（(crossReference|definition|example|…|subjectField|…)*, tig+）",
        "transform": _t_langset_order,
    },
    {
        "id": "CONFLICT-table-wrap-graphic-after-foot", "category": CONFLICT, "what": "table-wrap 内 graphic 位于 table-wrap-foot 之后",
        "basis": "46687.2 6.2.3 示例（印刷页 21）把 graphic 写在 table-wrap-foot 之后；STS 1.2 的 table-wrap 要求 graphic 等块在 table-wrap-foot 之前",
        "transform": _t_table_wrap_graphic,
    },
    {
        "id": "CONFLICT-std-meta-order", "category": CONFLICT, "what": "std-meta 子元素次序不同于 STS 1.2 的有序内容模型（如 ics 在 title-wrap 之前）",
        "basis": "46687.2 4.1 示例（印刷页 2～3）把 ics、ccs 写在 title-wrap 之前；原文条文没有规定 std-meta 子元素次序（C-S-11），"
                 "附录 G（印刷页 71）又是另一种次序；STS 1.2 的 std-meta 内容模型有固定次序（title-wrap*, proj-id?, …, ics, …）；"
                 "导入接受任意次序（validate.py V-12 STD-META-ORDER 告警），导出须按 STS 1.2 次序",
        "transform": _t_std_meta_order,
    },
    {
        "id": "PENDING-block-fn", "category": PENDING, "what": "sec/app 直接子元素 fn（块级正文脚注）",
        "basis": "46687.2 没有规定正文 fn 的定义位置（10.1.8，待决 D-T-10，由 WP8.M 决定）；schema 暂时同时收行内与块级；"
                 "STS 1.2 的 sec/app 内容不含 fn（fn 只能在 p 等行内位置）",
        "transform": _t_block_fn,
    },
]


# --------------------------------------------------------------------------------------------
# xmllint --dtdvalid
# --------------------------------------------------------------------------------------------

_ERR_RE = re.compile(r"^(?P<file>.*?):(?P<line>\d+): element (?P<el>[^:]+): validity error : (?P<msg>.*)$")


def _secure_parse(path: Path):
    parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True, huge_tree=False)
    return etree.parse(str(path), parser)


def _normalize_msg(msg: str) -> str:
    """去掉与实例内容有关的 'got (...)' 部分，便于比较同一违反在转换前后是否仍存在。"""
    return re.sub(r", got \(.*\)\s*$", "", msg.strip())


def _dtd_validate(root, dtd: Path, xmllint: str):
    """序列化 root 的当前状态并用 xmllint 校验。返回 (issues, line_map)；issues 的行号已映射回原文档行号。"""
    P = [e for e in root.iter() if _is_el(e)]
    orig_lines = []
    for e in P:
        ln = e.sourceline
        if ln is None:
            anc = e.getparent()
            while anc is not None and anc.sourceline is None:
                anc = anc.getparent()
            ln = anc.sourceline if anc is not None else None
        orig_lines.append(ln)
    data = etree.tostring(root, encoding="UTF-8", xml_declaration=True)
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "doc.xml"
        p.write_bytes(data)
        proc = subprocess.run([xmllint, "--noout", "--nonet", "--nocatalogs", "--dtdvalid", str(dtd), str(p)],
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
        reparsed = etree.parse(str(p), etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True))
    Q = [e for e in reparsed.getroot().iter() if _is_el(e)]
    by_line: dict[int, list[int]] = {}
    for i, e in enumerate(Q):
        by_line.setdefault(e.sourceline, []).append(i)
    issues = []
    for line in proc.stderr.splitlines():
        m = _ERR_RE.match(line.rstrip())
        if not m:
            continue
        tline = int(m.group("line"))
        name = m.group("el")
        idx = None
        for i in by_line.get(tline, []):
            if _local(Q[i]) == name:
                idx = i
                break
        if idx is None and by_line.get(tline):
            idx = by_line[tline][0]
        oline = orig_lines[idx] if idx is not None and idx < len(orig_lines) else tline
        issues.append({"line": oline, "element": name, "message": m.group("msg"),
                       "key": (name, oline, _normalize_msg(m.group("msg")))})
    return issues, proc.returncode


def check_file(path, dtd: Path = DEFAULT_DTD, xmllint: str | None = None) -> dict:
    path = Path(path)
    result = {"file": str(path), "known": [], "unexplained": [], "applied": [], "wellformed": True, "note": None}
    xmllint = xmllint or shutil.which("xmllint")
    if not xmllint:
        result.update(wellformed=False, note="找不到 xmllint")
        return result
    if not dtd.is_file():
        result.update(wellformed=False, note="找不到 DTD：%s" % dtd)
        return result
    try:
        tree = _secure_parse(path)
    except (etree.XMLSyntaxError, OSError) as exc:
        result.update(wellformed=False, note="不是格式良好的 XML：%s" % exc)
        return result

    # 1. 原文档（序列化副本，无 DOCTYPE）上的全部报错
    raw, _ = _dtd_validate(tree.getroot(), dtd, xmllint)

    # 2. 按白名单规范化后的副本
    import copy
    work = copy.deepcopy(tree.getroot())
    # deepcopy 保留 sourceline（lxml 存在节点上）
    affected_lines: dict[str, set] = {}
    for entry in WHITELIST:
        touched = entry["transform"](work)
        if touched:
            lines = {ln for group in touched for ln in group}
            affected_lines[entry["id"]] = lines
            result["applied"].append({"id": entry["id"], "category": entry["category"], "what": entry["what"],
                                      "basis": entry["basis"], "count": len(touched),
                                      "lines": sorted(lines)})
    remain, _ = _dtd_validate(work, dtd, xmllint)
    remain_keys = {r["key"] for r in remain}

    for r in raw:
        if r["key"] in remain_keys:
            continue
        causes = [eid for eid, lines in affected_lines.items() if r["line"] in lines]
        if not causes:
            causes = sorted(affected_lines)
        result["known"].append({"line": r["line"], "element": r["element"], "message": r["message"], "whitelist": causes})
    for r in remain:
        result["unexplained"].append({"line": r["line"], "element": r["element"], "message": r["message"]})
    return result


# --------------------------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------------------------

def format_human(res: dict) -> str:
    out = ["=== %s" % res["file"]]
    if not res["wellformed"]:
        out.append("无法检查：%s" % res["note"])
        return "\n".join(out)
    out.append("已知偏差 %d 个（%d 条白名单生效），未解释偏差 %d 个" % (len(res["known"]), len(res["applied"]), len(res["unexplained"])))
    for a in res["applied"]:
        out.append("  白名单 %s [%s] %s ×%d" % (a["id"], a["category"], a["what"], a["count"]))
        out.append("      依据：%s" % a["basis"])
    for k in res["known"]:
        out.append("  已知 行 %s <%s>：%s（%s）" % (k["line"], k["element"], k["message"][:160], "、".join(k["whitelist"])))
    for u in res["unexplained"]:
        out.append("  未解释 行 %s <%s>：%s" % (u["line"], u["element"], u["message"][:300]))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="NISO STS 1.2 官方 DTD 兼容性检查（已知国标扩展白名单 + 未解释偏差）")
    ap.add_argument("files", nargs="*", metavar="file.xml")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--dtd", default=str(DEFAULT_DTD), help="STS 1.2 主 DTD（默认 schemas/niso-sts-1.2/…/NISO-STS-interchange-1-mathml3.dtd）")
    ap.add_argument("--list-whitelist", action="store_true", help="只列出白名单（含依据）")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover
        pass
    if args.list_whitelist:
        rows = [{k: v for k, v in e.items() if k != "transform"} for e in WHITELIST]
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
        else:
            for e in rows:
                print("%s [%s] %s\n    依据：%s" % (e["id"], e["category"], e["what"], e["basis"]))
        return 0
    if not args.files:
        ap.error("需要至少一个文件（或 --list-whitelist）")
    results = [check_file(f, Path(args.dtd)) for f in args.files]
    bad = any((not r["wellformed"]) or r["unexplained"] for r in results)
    if args.json:
        print(json.dumps({"tool": "sts_compat.py", "dtd": str(args.dtd), "ok": not bad, "results": results},
                         ensure_ascii=False, indent=2))
    else:
        for r in results:
            print(format_human(r))
        if len(results) > 1:
            print("\n共 %d 个文件，%d 个无未解释偏差" % (len(results), sum(1 for r in results if r["wellformed"] and not r["unexplained"])))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
