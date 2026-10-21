#!/usr/bin/env python3
"""支持矩阵 → RELAX NG schema 覆盖检查（项目实现约定，非官方）。

对 docs/wp8.1/matrix-S.json、matrix-T.json 中 “export 为 required/optional，或 import 为 required/accept，
或 import 为 reject 且 rejectKind 为 implementation（格式本身接受，只是导入器暂拒）” 的行，
检查 schemas/gbt46687.2 下的 RELAX NG 是否定义了对应的元素与属性（及枚举取值）；
rejectKind 为 format（格式层面不收）的行，其元素若不在任何需要覆盖的行里出现，则必须不在 schema 中。

    python3 -I scripts/xml46687/matrix_coverage.py [--json]

方法说明（尽力而为，不是形式化证明）：
  - 元素名从矩阵 element 字段解析：去掉全角/半角括号注释，按 “,、，” 切分，取形如 name、tbx:name、mml:name、
    name@attr 的片段；含中文、空格或不是名字的片段视为“非元素的说明性条目”，记入 pseudo。
  - 属性取行内 attributes[].name，宿主取行内元素片段（或 path 末段）；该行没有任何宿主时，只要求该属性在 schema 某处出现。
  - 属性取值：仅当 schema 中该属性是纯枚举（无开放的 data 类型）时才逐值核对。
  - 属性宿主为“该行任一元素片段”即算覆盖（同一行列出多个元素时无法唯一确定宿主）。
本文件只依赖标准库与 lxml。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = ROOT / "schemas" / "gbt46687.2"
MATRICES = [ROOT / "docs" / "wp8.1" / "matrix-S.json", ROOT / "docs" / "wp8.1" / "matrix-T.json"]

RNG = "http://relaxng.org/ns/structure/1.0"
NS = {"tbx": "urn:iso:std:iso:30042:ed-1", "mml": "http://www.w3.org/1998/Math/MathML",
      "xlink": "http://www.w3.org/1999/xlink", "xml": "http://www.w3.org/XML/1998/namespace"}


def _r(tag):
    return "{%s}%s" % (RNG, tag)


# --------------------------------------------------------------------------------------------
# 解析 schema
# --------------------------------------------------------------------------------------------

class SchemaIndex:
    def __init__(self, schema_dir: Path):
        self.defines: dict[str, etree._Element] = {}
        self.elements: dict[str, list[etree._Element]] = {}   # 展开名 → element 模式节点
        self.wildcard_ns: set[str] = set()                    # element 的 nsName
        for f in sorted(schema_dir.glob("*.rng")):
            tree = etree.parse(str(f))
            for d in tree.getroot().iter(_r("define")):
                self.defines[d.get("name")] = d
        for d in self.defines.values():
            for el in d.iter(_r("element")):
                self._register(el)

    @staticmethod
    def _inherited_ns(node) -> str:
        n = node
        while n is not None:
            if n.get("ns") is not None:
                return n.get("ns")
            n = n.getparent()
        return ""

    def _register(self, el):
        if el.get("name") is not None:
            ns = self._inherited_ns(el)
            self.elements.setdefault(self._expand(el.get("name"), ns), []).append(el)
            return
        nameclass = el[0]
        for n in nameclass.iter(_r("name")):
            ns = n.get("ns") if n.get("ns") is not None else self._inherited_ns(n)
            self.elements.setdefault(self._expand(n.text.strip(), ns), []).append(el)
        for n in nameclass.iter(_r("nsName")):
            self.wildcard_ns.add(n.get("ns"))

    @staticmethod
    def _expand(local: str, ns: str) -> str:
        return "{%s}%s" % (ns, local) if ns else local

    def has_element(self, name: str) -> bool:
        if name in self.elements:
            return True
        m = re.match(r"^\{(.*)\}.*$", name)
        return bool(m and m.group(1) in self.wildcard_ns)

    # ---- 属性 ----
    def attributes_of(self, el) -> dict[str, dict]:
        """返回 el 内容里（不穿过嵌套 element）出现的属性：展开名 → {values:set, open:bool}。"""
        out: dict[str, dict] = {}
        self._walk(el, out, set(), top=True)
        return out

    def _walk(self, node, out, seen, top=False):
        for ch in node:
            if not isinstance(ch.tag, str):
                continue
            tag = etree.QName(ch).localname
            if tag == "element":
                continue
            if tag == "ref":
                name = ch.get("name")
                if name in seen or name not in self.defines:
                    continue
                self._walk(self.defines[name], out, seen | {name})
                continue
            if tag == "attribute":
                self._attribute(ch, out)
                continue
            if tag in ("name", "anyName", "nsName", "choice", "optional", "zeroOrMore", "oneOrMore", "group", "interleave",
                       "mixed", "except", "list", "define", "param", "value", "data", "text", "empty", "notAllowed"):
                if tag == "name" and top:
                    continue  # 元素的名字类，不是内容
                self._walk(ch, out, seen)

    def _attribute(self, att, out):
        key = None
        if att.get("name") is not None:
            ns = att.get("ns") or ""
            key = self._expand(att.get("name"), ns)
        else:
            nc = att[0]
            if etree.QName(nc).localname == "anyName":
                key = "*"
            elif etree.QName(nc).localname == "name":
                ns = nc.get("ns") if nc.get("ns") is not None else self._inherited_ns(nc)
                key = self._expand(nc.text.strip(), ns)
        if key is None:
            return
        slot = out.setdefault(key, {"values": set(), "open": False})
        # 取值：本属性内的 value；data / 其他类型视为开放（引用到的 define 也要展开）
        self._values(att, slot, set())

    def _values(self, node, slot, seen):
        for ch in node:
            if not isinstance(ch.tag, str):
                continue
            tag = etree.QName(ch).localname
            if tag in ("name", "anyName", "nsName"):
                continue
            if tag == "value":
                slot["values"].add((ch.text or "").strip())
            elif tag in ("data", "text"):
                slot["open"] = True
            elif tag == "ref":
                name = ch.get("name")
                if name in self.defines and name not in seen:
                    self._values(self.defines[name], slot, seen | {name})
            else:
                self._values(ch, slot, seen)

    def element_attrs(self, name: str) -> dict[str, dict]:
        merged: dict[str, dict] = {}
        for el in self.elements.get(name, []):
            for k, v in self.attributes_of(el).items():
                slot = merged.setdefault(k, {"values": set(), "open": False})
                slot["values"] |= v["values"]
                slot["open"] = slot["open"] or v["open"]
        return merged

    def all_attrs(self) -> dict[str, dict]:
        merged: dict[str, dict] = {}
        for name in self.elements:
            for k, v in self.element_attrs(name).items():
                slot = merged.setdefault(k, {"values": set(), "open": False})
                slot["values"] |= v["values"]
                slot["open"] = slot["open"] or v["open"]
        return merged


# --------------------------------------------------------------------------------------------
# 解析矩阵
# --------------------------------------------------------------------------------------------

_PAREN_RE = re.compile(r"（[^）]*）|\([^)]*\)")
_QNAME_RE = re.compile(r"^(?:(tbx|mml|xml|xlink):)?([A-Za-z][A-Za-z0-9_.-]*)$")


def _norm_element(prefix: str | None, local: str) -> str:
    return "{%s}%s" % (NS[prefix], local) if prefix else local


def parse_element_field(field: str):
    """→ (elements, attrs_hint, pseudo)。elements 为展开名列表；attrs_hint 为 (element, attr) 对；pseudo 为说明性条目。"""
    s = field.strip()
    if s.startswith("<") and s.endswith(">"):
        s = s[1:-1]
    s = _PAREN_RE.sub("", s)
    elements, hints, pseudo = [], [], []
    for piece in re.split(r"[,，、]", s):
        piece = piece.strip()
        if not piece:
            continue
        if "=" in piece:
            pseudo.append(piece)
            continue
        elem, _, attr = piece.partition("@")
        elem = elem.strip()
        if not elem:
            if attr:
                hints.append((None, attr))
            continue
        m = _QNAME_RE.match(elem)
        if not m:
            pseudo.append(piece)
            continue
        prefix, loc = m.group(1), m.group(2)
        if prefix in ("xml", "xlink"):
            hints.append((None, "%s:%s" % (prefix, loc)))
            continue
        name = _norm_element(prefix, loc)
        elements.append(name)
        if attr:
            hints.append((name, attr))
    return elements, hints, pseudo


def path_owner(path: str) -> str | None:
    """path 末段的元素名（尽力而为）。"""
    last = re.split(r"/+", path.strip())[-1]
    last = re.sub(r"\[.*?\]", "", last).strip()
    if last.startswith("@") or not last:
        parts = [p for p in re.split(r"/+", path.strip()) if p]
        if len(parts) >= 2:
            last = re.sub(r"\[.*?\]", "", parts[-2]).strip()
    m = _QNAME_RE.match(last)
    if m and m.group(1) not in ("xml", "xlink"):
        return _norm_element(m.group(1), m.group(2))
    return None


def attr_key(name: str) -> str | None:
    if name.startswith("xmlns"):
        return None  # 命名空间声明不是属性
    if ":" in name:
        prefix, loc = name.split(":", 1)
        if prefix in NS:
            return "{%s}%s" % (NS[prefix], loc)
    return name


PLACEHOLDER_VALUE_RE = re.compile(r"[<（）一-鿿]|^id-|^\d|^#|^\(|%$|px$|^mml_|^sec_|^fig_|^asset/|^/graphics|^abb-|^list-|^lis-|^term_|^te_|^nte_|^con-")

# 不是 XML 元素/属性、而是序言、编码、版式等的矩阵条目：schema 不表达，由 validate.py 或导入器处理。
PSEUDO_ELEMENTS = {
    "xml-declaration": "XML 声明（prolog）：由 validate.py SYN-2 检查编码",
    "DOCTYPE": "DOCTYPE 声明（prolog）：由 validate.py SYN-3 检查，schema 不表达",
}
IGNORED_ATTRS = {
    ("xml-declaration", "version"), ("xml-declaration", "encoding"), ("DOCTYPE", "SYSTEM"),
}


def load_rows():
    rows = []
    for f in MATRICES:
        rows.extend(json.loads(f.read_text(encoding="utf-8")))
    return rows


def considered(row) -> bool:
    """需要 schema 覆盖的行：export 为 required/optional，或 import 为 required/accept，
    或 import 为 reject 但 rejectKind=implementation（格式本身接受，只是导入器暂拒）。"""
    return (row["export"] in ("required", "optional") or row["import"] in ("required", "accept")
            or (row["import"] == "reject" and row.get("rejectKind") == "implementation"))


def check(schema_dir: Path = SCHEMA_DIR) -> dict:
    idx = SchemaIndex(schema_dir)
    rows = load_rows()

    # rejectKind 必须覆盖全部 import: reject 的行，且只出现在这些行上
    kind_problems = [r["id"] for r in rows if (r["import"] == "reject") != ("rejectKind" in r)]
    kind_problems += [r["id"] for r in rows if r.get("rejectKind") not in (None, "format", "implementation")]

    format_rows = [r for r in rows if r["import"] == "reject" and r.get("rejectKind") == "format"]
    impl_rows = [r for r in rows if r["import"] == "reject" and r.get("rejectKind") == "implementation"]

    need_elems: dict[str, list[str]] = {}
    need_attrs: dict[tuple, list[str]] = {}
    pseudo: list[dict] = []
    n_considered = 0

    for r in rows:
        if not considered(r):
            continue
        n_considered += 1
        els, hints, ps = parse_element_field(r["element"])
        for p in ps:
            pseudo.append({"row": r["id"], "item": p})
        owner_candidates = [e for e in els if e not in PSEUDO_ELEMENTS]
        if not owner_candidates:
            o = path_owner(r["path"])
            if o and o not in PSEUDO_ELEMENTS:
                owner_candidates = [o]
        for e in els:
            if e in PSEUDO_ELEMENTS:
                pseudo.append({"row": r["id"], "item": e, "reason": PSEUDO_ELEMENTS[e]})
                continue
            need_elems.setdefault(e, []).append(r["id"])
        for a in r["attributes"]:
            k = attr_key(a["name"])
            if k is None:
                continue
            if any((o, a["name"]) in IGNORED_ATTRS for o in els + [None]):
                continue
            hosts = tuple(sorted(owner_candidates)) or ("*",)
            need_attrs.setdefault((hosts, k), []).append((r["id"], a.get("values", [])))
        for host, a in hints:
            k = attr_key(a)
            if k is None:
                continue
            hosts = (host,) if host else (tuple(sorted(owner_candidates)) or ("*",))
            need_attrs.setdefault((hosts, k), []).append((r["id"], []))

    # format 类 reject：只出现在 reject 行、而不在任何需要覆盖的行里的元素 = 整体不收（不得出现在 schema 中）；
    # 同时出现在需要覆盖的行里的（嵌套表里的 table、tbx:source 里的 std 等）是“语境拒绝”，由内容模型/REJECT 规则体现。
    format_tokens: dict[str, list[str]] = {}
    for r in format_rows:
        els, _, _ = parse_element_field(r["element"])
        for e in els:
            format_tokens.setdefault(e, []).append(r["id"])
    reject_elems = {e: ids for e, ids in format_tokens.items() if e not in need_elems}
    context_format_rows = sorted({i for e, ids in format_tokens.items() if e in need_elems for i in ids}
                                 - {i for e, ids in reject_elems.items() for i in ids})

    uncovered_elems = {e: ids for e, ids in need_elems.items() if not idx.has_element(e)}
    reject_in_schema = {e: ids for e, ids in reject_elems.items() if e in idx.elements}

    all_attrs = idx.all_attrs()
    uncovered_attrs = []
    uncovered_values = []
    for (hosts, k), entries in need_attrs.items():
        ids = sorted({i for i, _ in entries})
        if hosts == ("*",):
            slot = all_attrs.get(k)
            attr_ok = slot is not None or "*" in all_attrs
        else:
            slots = [idx.element_attrs(h).get(k) or idx.element_attrs(h).get("*") for h in hosts if idx.has_element(h)]
            slot_list = [s for s in slots if s is not None]
            attr_ok = bool(slot_list)
            slot = None
            if slot_list:
                slot = {"values": set().union(*[s["values"] for s in slot_list]), "open": any(s["open"] for s in slot_list)}
        if not attr_ok:
            uncovered_attrs.append({"hosts": list(hosts), "attribute": k, "rows": ids})
            continue
        if slot and not slot["open"] and slot["values"]:
            for _, vals in entries:
                for v in vals:
                    if PLACEHOLDER_VALUE_RE.search(v):
                        continue
                    if v not in slot["values"]:
                        uncovered_values.append({"hosts": list(hosts), "attribute": k, "value": v, "rows": ids})

    seen = set()
    uv = []
    for u in uncovered_values:
        key = (tuple(u["hosts"]), u["attribute"], u["value"])
        if key not in seen:
            seen.add(key)
            uv.append(u)
    return {
        "rows_total": len(rows),
        "rows_considered": n_considered,
        "elements_expected": len(need_elems),
        "elements_covered": len(need_elems) - len(uncovered_elems),
        "elements_uncovered": uncovered_elems,
        "attributes_expected": len(need_attrs),
        "attributes_covered": len(need_attrs) - len(uncovered_attrs),
        "attributes_uncovered": uncovered_attrs,
        "attribute_values_uncovered": uv,
        "reject_elements_in_schema": reject_in_schema,
        "reject_elements": sorted(reject_elems),
        "reject_rows_format": sorted(r["id"] for r in format_rows),
        "reject_rows_implementation": sorted(r["id"] for r in impl_rows),
        "context_reject_rows": context_format_rows,
        "reject_kind_problems": sorted(set(kind_problems)),
        "pseudo_items": pseudo,
        "schema_elements": len(idx.elements),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="支持矩阵 → RELAX NG schema 覆盖检查")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover
        pass
    res = check()
    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print("矩阵共 %d 行，需要 schema 覆盖的 %d 行（export 为 required/optional，或 import 为 required/accept，"
              "或 import 为 reject 但 rejectKind=implementation）" % (res["rows_total"], res["rows_considered"]))
        print("元素：需要覆盖 %d 个，schema 已定义 %d 个；schema 共定义 %d 个元素名" % (res["elements_expected"], res["elements_covered"], res["schema_elements"]))
        for e, ids in sorted(res["elements_uncovered"].items()):
            print("  未覆盖元素 %s（矩阵行 %s）" % (e, ", ".join(ids)))
        print("属性：需要覆盖 %d 个（宿主,属性）组合，已覆盖 %d 个" % (res["attributes_expected"], res["attributes_covered"]))
        for u in res["attributes_uncovered"]:
            print("  未覆盖属性 %s@%s（矩阵行 %s）" % ("/".join(u["hosts"]), u["attribute"], ", ".join(u["rows"])))
        for u in res["attribute_values_uncovered"]:
            print("  未覆盖取值 %s@%s=%r（矩阵行 %s）" % ("/".join(u["hosts"]), u["attribute"], u["value"], ", ".join(u["rows"])))
        print("import: reject 共 %d 行：rejectKind=format %d 行，implementation %d 行"
              % (len(res["reject_rows_format"]) + len(res["reject_rows_implementation"]),
                 len(res["reject_rows_format"]), len(res["reject_rows_implementation"])))
        print("  format 类中整体不收的元素 %d 个：%s" % (len(res["reject_elements"]), "、".join(res["reject_elements"])))
        print("  其中混入 schema 的：%s" % (", ".join(res["reject_elements_in_schema"]) or "无"))
        print("  format 类中的语境拒绝行（元素本身接受，只在特定位置/取值/个数上拒绝）%d 行：%s"
              % (len(res["context_reject_rows"]), ", ".join(res["context_reject_rows"])))
        print("  implementation 类（格式接受，导入暂拒，已要求 schema 覆盖）：%s" % ", ".join(res["reject_rows_implementation"]))
        if res["reject_kind_problems"]:
            print("  rejectKind 字段有问题的行：%s" % ", ".join(res["reject_kind_problems"]))
        print("非元素的说明性条目（schema 不表达）%d 个" % len(res["pseudo_items"]))
    bad = (res["elements_uncovered"] or res["attributes_uncovered"] or res["attribute_values_uncovered"]
           or res["reject_elements_in_schema"] or res["reject_kind_problems"])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
