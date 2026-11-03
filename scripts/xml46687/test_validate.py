"""validate.py / matrix_coverage.py 与 schemas/gbt46687.2 的回归测试（unittest，只依赖标准库与 lxml）。

运行方式（任选其一，均在仓库根目录）：

    python3 -I scripts/xml46687/test_validate.py -v
    python3 -m unittest scripts/xml46687/test_validate.py -v
    python3 -I -m unittest discover -s scripts/xml46687 -p "test_*.py" -v

注意：`python3 -I -m unittest scripts/xml46687/test_validate.py` 在隔离模式（-I）下会失败——-I 不把当前目录放进
sys.path，unittest 把路径转换成模块名 scripts.xml46687.test_validate 后找不到 scripts 包。这是 Python 的行为，
不是测试本身的问题；上面三种写法都不依赖当前目录在 sys.path 中。

断言：
  - 所有正例通过，且 lxml 与 xmllint 结论一致（import 与 export 两档；07 号异写汇总只在 import 档通过）；
  - 每个负例失败，失败原因含预期规则编号与关键字，且只出现预期范围内的规则（保证“一个负例只违反一条规则”）；
  - 对全部样例，lxml 与 xmllint 的 RELAX NG 结论一致；
  - 支持矩阵中 export/import 要求覆盖的元素与属性都在 schema 中，import: reject 的元素不在 schema 中；
  - 命令行退出码与 --json 输出；外部实体不会被读取。
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SCHEMA_DIR = ROOT / "schemas" / "gbt46687.2"
SCHEMA = SCHEMA_DIR / "ses-gbt46687-2.rng"
VALID_DIR = SCHEMA_DIR / "samples" / "valid"
INVALID_DIR = SCHEMA_DIR / "samples" / "invalid"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


validate = _load("ses_validate", HERE / "validate.py")
sts = _load("ses_sts_compat", HERE / "sts_compat.py")
coverage = _load("ses_matrix_coverage", HERE / "matrix_coverage.py")

VALIDATOR_IMPORT = None
VALIDATOR_EXPORT = None


def setUpModule():
    global VALIDATOR_IMPORT, VALIDATOR_EXPORT
    VALIDATOR_IMPORT = validate.Validator(SCHEMA, profile="import")
    VALIDATOR_EXPORT = validate.Validator(SCHEMA, profile="export")


# 负例：文件名 → (必须出现的规则, 允许出现的规则集合, 必须出现在某条错误信息里的关键字)
# “允许出现”的集合保证每个负例只违反预期的那一条规则（RNG 与对应的语义规则常常同时报同一缺陷，属同一违反）。
EXPECTED_INVALID = {
    # 语法
    "not-wellformed.xml": ("SYN-1", {"SYN-1"}, "格式错误"),
    "non-utf8-encoding.xml": ("SYN-2", {"SYN-2"}, "GB2312"),
    "doctype-internal-subset.xml": ("SYN-3", {"SYN-3"}, "内部子集"),
    # 旧格式
    "gbt37967-root.xml": ("LEGACY", {"LEGACY", "RNG"}, "37967"),
    "sep-legacy-namespace.xml": ("LEGACY", {"LEGACY", "RNG"}, "urn:csbts:std:xml:1.0"),
    "wrong-root.xml": ("ROOT", {"ROOT", "RNG"}, "standard"),
    # 支持矩阵 import: reject
    "tex-math.xml": ("REJECT", {"REJECT", "RNG"}, "tex-math"),
    "alternatives.xml": ("REJECT", {"REJECT", "RNG"}, "alternatives"),
    "nested-table.xml": ("REJECT", {"REJECT", "RNG"}, "嵌套表"),
    "tfoot.xml": ("REJECT", {"REJECT", "RNG"}, "tfoot"),
    "issue-agencies.xml": ("REJECT", {"REJECT", "RNG"}, "issue-agencies"),
    "mathml-unprefixed.xml": ("REJECT", {"REJECT", "RNG"}, "mtext"),
    "std-in-tbx-source.xml": ("REJECT", {"REJECT", "RNG"}, "tbx:source"),
    "admn-sts-value.xml": ("REJECT", {"REJECT", "RNG"}, "admn-sts"),
    "caption-two-titles.xml": ("REJECT", {"REJECT", "RNG"}, "title"),
    "fig-footnote.xml": ("REJECT", {"REJECT", "RNG"}, "fn"),
    # 结构层允许（fn 在 caption 的段落里），只有上下文拒绝规则（按祖先判断）能拒绝
    "fig-footnote-in-caption.xml": ("REJECT", {"REJECT"}, "图内"),
    # D-M-01（WP8.M 设计评审，方案 A）：正文 fn 是行内元素，sec/app 的直接子元素 fn（块级）不收
    "block-level-fn.xml": ("REJECT", {"REJECT", "RNG"}, "块级正文脚注"),
    "nested-term-entry.xml": ("REJECT", {"REJECT", "RNG", "V-9"}, "termEntry"),
    "definition-target.xml": ("REJECT", {"REJECT", "RNG"}, "target"),
    # V-1
    "dup-id.xml": ("V-1", {"V-1"}, "sec_5.1"),
    "dangling-rid.xml": ("V-1", {"V-1"}, "tab_99"),
    "dangling-entailed-term.xml": ("V-1", {"V-1"}, "term_9.9"),
    # V-2
    "front-scope-sec.xml": ("V-2", {"V-2", "RNG"}, "foreword"),
    "numbered-paragraph-with-title.xml": ("V-2", {"V-2"}, "numbered-paragraph"),
    "chapter-sec-type-intro.xml": ("V-2", {"V-2", "RNG"}, "intro"),
    # V-3
    "bad-app-content-type.xml": ("V-3", {"V-3", "RNG"}, "annex"),
    "bad-ref-list-content-type.xml": ("V-3", {"V-3", "RNG"}, "references"),
    # V-4
    "impl-date-in-release-date.xml": ("V-4", {"V-4"}, "实施日期重复表达"),
    "dup-release-date.xml": ("V-4", {"V-4"}, "发布日期重复表达"),
    "bad-date-format.xml": ("V-4", {"V-4", "RNG"}, "2026/04/30"),
    "invalid-calendar-date.xml": ("V-4", {"V-4", "RNG"}, "2026-02-30"),
    # V-5
    "bad-list-type.xml": ("V-5", {"V-5", "RNG"}, "simple"),
    "unordered-list-label.xml": ("V-5", {"V-5"}, "label"),
    # V-6
    "bad-processing-meta.xml": ("V-6", {"V-6", "RNG"}, "table-model"),
    "title-wrap-no-lang.xml": ("V-6", {"V-6", "RNG"}, "xml:lang"),
    # V-7
    "ext-id.xml": ("V-18", {"V-18"}, "<p> 不应带 id"),
    "p-number-id.xml": ("V-18", {"V-18"}, "<p> 不应带 id"),
    # V-8～V-11
    "wrong-xref-type.xml": ("V-8", {"V-8"}, "ref-type=fig"),
    "term-two-definitions.xml": ("V-9", {"V-9"}, "有且仅有一个"),
    "mathml-onclick.xml": ("V-10", {"V-10"}, "onclick"),
    "js-ext-link.xml": ("V-11", {"V-11"}, "javascript"),
    "encoding-declared-after-400-bytes.xml": ("SYN-2", {"SYN-2"}, "ISO-8859-1"),
    "ext-link-tab-in-scheme.xml": ("V-11", {"V-11"}, "控制字符"),
    "ext-link-newline-in-url.xml": ("V-11", {"V-11"}, "控制字符"),
    "mathml-href-control-char.xml": ("V-10", {"V-10"}, "控制字符"),
    # 仅 RELAX NG
    "mixed-cell-content.xml": ("RNG", {"RNG"}, "td"),
    "tbx-langset-no-lang.xml": ("RNG", {"RNG"}, "langSet"),
    "unknown-element.xml": ("RNG", {"RNG"}, "blink"),
    # 2026-10-21：术语异写元素名只保留 tbx:normativeAuthentication，其余四个疑为原文笔误，REJECT
    "tbx-term-entry-alias.xml": ("REJECT", {"REJECT", "RNG"}, "笔误"),
    "tbx-definition-alias.xml": ("REJECT", {"REJECT", "RNG", "V-9"}, "Definition"),
    "tbx-normative-authorization-alias.xml": ("REJECT", {"REJECT", "RNG"}, "normative-Authorization"),
    "tbx-grammatical-number-alias.xml": ("REJECT", {"REJECT", "RNG"}, "grammatical-Number"),
    # 按 NISO STS 1.2 收紧后（2026-10-21）
    "sec-block-after-subsec.xml": ("RNG", {"RNG"}, "sec"),
    # 容器位置：结构层允许，语义规则拒绝
    "fn-xref-to-table-footnote.xml": ("V-8", {"V-8"}, "table-fn"),
    "table-fn-xref-to-body-fn.xml": ("V-8", {"V-8"}, "表脚注 fn"),
    "bibl-ref-list-in-app.xml": ("V-3", {"V-3"}, "back 的直接子元素"),
    "term-sec-outside-terms.xml": ("V-2", {"V-2"}, "术语和定义"),
    "custom-xref-wrong-target.xml": ("V-8", {"V-8"}, "custom-type=note"),
    "custom-xref-to-section.xml": ("V-8", {"V-8"}, "term-sec"),
    "bad-part-of-speech.xml": ("RNG", {"RNG"}, "partOfSpeech"),
    "named-content-without-type.xml": ("RNG", {"RNG"}, "front"),
    "empty-table-wrap-foot.xml": ("RNG", {"RNG"}, "table-wrap-foot"),
}

# 仅 export 档失败的“负例”：结构层（RELAX NG）不限次序，import 档通过并告警，export 档为错误。
# 文件名 → (规则, 关键字)
EXPORT_ONLY_INVALID = {
    "std-meta-wrong-order.xml": ("V-12", "content-language"),
    # V-13 REQUIRED-ID：结构层 id 可选，缺 id 导入告警、导出错误
    "missing-term-entry-id.xml": ("V-13", "tbx:termEntry"),
    "missing-app-id.xml": ("V-13", "app"),
    "missing-ref-id.xml": ("V-13", "ref"),
    # xref[ref-type=custom] 缺 custom-type：导入告警（导入器按目标推断）、导出错误
    "custom-xref-no-type.xml": ("V-8", "custom-type"),
    # mml:math 的 id 与 display（矩阵 M-7.4-02、M-7.1-05、M-7.4-03）：导入告警、导出错误
    "mathml-id-missing.xml": ("V-14", "缺少 id"),
    "mathml-display-inline-in-disp-formula.xml": ("V-15", "display"),
    # 矩阵 export required 的部件（V-17 等）：结构层放宽为可选，导入告警（或不报告）、导出错误
    "sec-without-label.xml": ("V-17", "label"),
    "app-without-annex-type.xml": ("V-17", "annex-type"),
    "ext-link-without-type.xml": ("V-17", "ext-link-type", ""),
    "table-wrap-without-label.xml": ("V-17", "label"),
    "term-entry-without-definition.xml": ("V-9", "tbx:definition", "W-TERM-NODEF"),
    "p-with-id.xml": ("V-18", "NO-ID"),
}

# 语法合法且引用可解析的 opaque ID 样例：仅 export 档拒绝非规范字面形式。
EXPORT_ONLY_OPAQUE_IDS = {
    "formula-id.xml": "Formula",
    "uuid-id.xml": "uuid",
}

# 矩阵中 import: reject 的行（rejectKind 见 docs/wp8.1/matrix-*.json）：
# format 类中的“语境拒绝”行（元素本身接受，只在特定位置/取值/个数上拒绝）→ 对应的负例
CONTEXT_REJECT_SAMPLES = {
    "M-6.1-06": "nested-table.xml",
    "M-6.2.1-06": "caption-two-titles.xml",
    "M-8.2-07": "caption-two-titles.xml",     # 图题与表题共用 caption 定义
    "M-8.6-02": "fig-footnote.xml",
    "M-9.1-03": "nested-term-entry.xml",
    "M-9.2.3-06": "admn-sts-value.xml",
    "M-9.2.8-02": "std-in-tbx-source.xml",
    "M-C.1-08": "definition-target.xml",
}
# implementation 类（格式本身接受，导入暂拒）→ 产生的告警规则与对应正例
IMPLEMENTATION_REJECT_ROWS = {
    "M-4.3.4-02": ("W-IMPL-REJECT", "09-import-pending.xml"),
    "M-4.3.4-03": ("W-IMPL-REJECT", "09-import-pending.xml"),
    "M-5.8-01": ("W-IMPL-REJECT", "09-import-pending.xml"),
    "M-C.1-04": ("W-IMPL-REJECT", "09-import-pending.xml"),
    "M-C.1-05": ("W-IMPL-REJECT", "09-import-pending.xml"),
    "M-10.1.8-04": ("W-FN-MULTIREF", "09-import-pending.xml"),
}
# format 类中整体不收的元素（不得出现在 schema 中）；该集合固定在这里，防止矩阵自相矛盾时悄悄改变
WHOLESALE_FORMAT_REJECTS = {
    "DOCTYPE", "alternatives", "col-group", "fn-group", "issue-agencies", "mtext", "std-doc-meta", "target", "term-display",
    "tex-math", "tfoot",
    "{urn:iso:std:iso:30042:ed-1}see", "{urn:iso:std:iso:30042:ed-1}term-entry",
    "{urn:iso:std:iso:30042:ed-1}Definition", "{urn:iso:std:iso:30042:ed-1}normative-Authorization",
    "{urn:iso:std:iso:30042:ed-1}grammatical-Number",
}


def _slug(path: Path) -> str:
    return path.stem.replace("-", "_")


def _rules(rep):
    return {e["rule"] for e in rep.errors}


def _messages(rep):
    return "\n".join(e["message"] for e in rep.errors)


class TestSampleInventory(unittest.TestCase):
    def test_enough_samples(self):
        self.assertGreaterEqual(len(list(VALID_DIR.glob("*.xml"))), 6)
        self.assertGreaterEqual(len(list(INVALID_DIR.glob("*.xml"))), 15)

    def test_every_invalid_sample_has_an_expectation_and_vice_versa(self):
        files = {p.name for p in INVALID_DIR.glob("*.xml")}
        expected = set(EXPECTED_INVALID) | set(EXPORT_ONLY_INVALID) | set(EXPORT_ONLY_OPAQUE_IDS)
        self.assertEqual(set(EXPECTED_INVALID) & set(EXPORT_ONLY_INVALID), set(), "同一负例不能有两种预期")
        self.assertEqual(set(EXPECTED_INVALID) & set(EXPORT_ONLY_OPAQUE_IDS), set(), "opaque ID 正例不能列为导入负例")
        self.assertEqual(len(EXPECTED_INVALID) + len(EXPORT_ONLY_INVALID), 76)
        self.assertEqual(set(EXPORT_ONLY_OPAQUE_IDS), {"formula-id.xml", "uuid-id.xml"})
        self.assertEqual(files - expected, set(), "有负例没有写预期")
        self.assertEqual(expected - files, set(), "预期里的负例文件不存在")

    def test_required_negative_samples_from_the_brief_exist(self):
        for name in ("tex-math.xml", "nested-table.xml", "dup-id.xml", "dangling-rid.xml",
                     "impl-date-in-release-date.xml", "bad-app-content-type.xml", "ext-id.xml",
                     "gbt37967-root.xml", "sep-legacy-namespace.xml"):
            self.assertTrue((INVALID_DIR / name).is_file(), name)

    def test_context_rejects_have_negative_samples(self):
        for row, sample in CONTEXT_REJECT_SAMPLES.items():
            if sample is not None:
                self.assertIn(sample, EXPECTED_INVALID, row)


class TestValidSamples(unittest.TestCase):
    """正例：默认（import）档位全部通过，两个实现一致。"""


def _make_valid_test(path: Path):
    def test(self):
        rep = VALIDATOR_IMPORT.validate_file(path)
        self.assertEqual(rep.errors, [], "%s 应通过：\n%s" % (path.name, validate.format_human(rep)))
        self.assertTrue(rep.consistent)
        self.assertIs(rep.engines["lxml"]["valid"], True)
        self.assertIs(rep.engines["xmllint"]["valid"], True)
        self.assertTrue(rep.valid)
    return test


def _make_valid_export_test(path: Path):
    def test(self):
        rep = VALIDATOR_EXPORT.validate_file(path)
        self.assertEqual(rep.errors, [], "%s 应通过 export 档：\n%s" % (path.name, validate.format_human(rep)))
        self.assertEqual(rep.warnings, [], "%s 不应有告警" % path.name)
    return test


# 07 汇总“仅导入接受”的异写（export 档不通过）；09 汇总“导入暂拒”的写法（告警 W-IMPL-REJECT 等，不是 export 干净样例）
EXPORT_CLEAN_PREFIXES = ("01-", "02-", "03-", "04-", "05-", "06-", "08-")

for _p in sorted(VALID_DIR.glob("*.xml")):
    setattr(TestValidSamples, "test_import_" + _slug(_p), _make_valid_test(_p))
    if _p.name.startswith(EXPORT_CLEAN_PREFIXES):
        setattr(TestValidSamples, "test_export_" + _slug(_p), _make_valid_export_test(_p))


class TestImportVariantsSample(unittest.TestCase):
    """07 号样例汇总“仅导入接受”的异写：import 档通过并告警，export 档拒绝。"""

    path = VALID_DIR / "07-import-variants.xml"

    def test_import_profile_passes_with_import_only_warnings(self):
        rep = VALIDATOR_IMPORT.validate_file(self.path)
        self.assertTrue(rep.valid, validate.format_human(rep))
        self.assertTrue(rep.warnings)
        # IMPORT-ONLY：异写；V-12：std-meta 子元素次序同原文 4.1 示例（ics、ccs 在 title-wrap 之前）
        self.assertEqual({w["rule"] for w in rep.warnings}, {"IMPORT-ONLY", "V-12"})

    def test_export_profile_rejects_every_import_only_form(self):
        rep = VALIDATOR_EXPORT.validate_file(self.path)
        self.assertFalse(rep.valid)
        # V-17：4.4.2.1 写法的无标题条（不带 sec-type）导入接受，导出必须写 numbered-paragraph
        self.assertEqual(_rules(rep), {"IMPORT-ONLY", "V-12", "V-17"})
        text = _messages(rep)
        for token in ("norm_refs", "inform_annex", "bibr", "date-type",
                      "normativeAuthentication", "monospace", "other", "chem", "position", "center",
                      "STD-META-ORDER", "numbered-paragraph"):
            self.assertIn(token, text)

    def test_std_meta_in_4_1_example_order_is_accepted_with_a_warning(self):
        # 4.1 示例的次序（ics、ccs、title-wrap…）：导入接受，只告警；导出为错误
        rep = VALIDATOR_IMPORT.validate_file(self.path)
        order = [w for w in rep.warnings if w["rule"] == "V-12"]
        self.assertEqual(len(order), 1, validate.format_human(rep))
        self.assertIn("ics, ccs, title-wrap", order[0]["message"])
        self.assertIs(rep.engines["lxml"]["valid"], True)
        self.assertIs(rep.engines["xmllint"]["valid"], True)


class TestInvalidSamples(unittest.TestCase):
    """负例：失败原因含预期规则与关键字，且不出现预期之外的规则。"""


def _make_invalid_test(name: str, spec):
    required, allowed, keyword = spec

    def test(self):
        path = INVALID_DIR / name
        rep = VALIDATOR_IMPORT.validate_file(path)
        report = validate.format_human(rep)
        self.assertFalse(rep.valid, "%s 应不通过" % name)
        rules = _rules(rep)
        self.assertIn(required, rules, "%s 缺少预期规则 %s：\n%s" % (name, required, report))
        self.assertLessEqual(rules, allowed, "%s 出现了预期之外的规则 %s：\n%s" % (name, rules - allowed, report))
        self.assertIn(keyword, _messages(rep), "%s 的错误信息里没有关键字 %r：\n%s" % (name, keyword, report))
        # 两个实现的结论必须一致（失败样例两边都应判为不通过，或两边都通过而由语义规则拦下）
        self.assertTrue(rep.consistent, "%s：lxml 与 xmllint 结论不一致：\n%s" % (name, report))
    return test


for _name, _spec in EXPECTED_INVALID.items():
    setattr(TestInvalidSamples, "test_" + _slug(Path(_name)), _make_invalid_test(_name, _spec))


def _make_export_only_test(name: str, spec):
    # spec = (规则, 关键字[, import 档的告警规则])：第三项缺省等于规则；"" 表示 import 档不报告（原文示例就是那种写法）
    rule, keyword = spec[0], spec[1]
    import_rule = spec[2] if len(spec) > 2 else rule

    def test(self):
        path = INVALID_DIR / name
        # export 档：失败，且只违反这一条规则
        rep = VALIDATOR_EXPORT.validate_file(path)
        report = validate.format_human(rep)
        self.assertFalse(rep.valid, "%s 应在 export 档失败" % name)
        self.assertEqual(_rules(rep), {rule}, report)
        self.assertIn(keyword, _messages(rep), report)
        self.assertTrue(rep.consistent, report)
        # import 档按严格项目约定拒绝，仍须命中同一语义规则
        rep = VALIDATOR_IMPORT.validate_file(path)
        report = validate.format_human(rep)
        self.assertFalse(rep.valid, report)
        self.assertIn(rule, _rules(rep), report)
        self.assertIn(keyword, _messages(rep), report)
        self.assertIs(rep.engines["lxml"]["valid"], True)
        self.assertIs(rep.engines["xmllint"]["valid"], True)
    return test


for _name, _spec in EXPORT_ONLY_INVALID.items():
    setattr(TestInvalidSamples, "test_export_only_" + _slug(Path(_name)), _make_export_only_test(_name, _spec))


class TestOpaqueIdImportPolicy(unittest.TestCase):
    """ID 字面样式仅约束 export；import 依据 NCName、全局唯一性和实际引用解析。"""

    def _source(self, name, replacements):
        source = (VALID_DIR / name).read_text(encoding="utf-8")
        for old, new in replacements:
            self.assertEqual(source.count(old), 1, "替换点必须唯一：%s" % old)
            source = source.replace(old, new, 1)
        return source

    def _validate_text(self, source, validator):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(source, encoding="utf-8")
            return validator.validate_file(path)

    def test_uuid_and_formula_samples_are_import_positive_and_export_negative(self):
        for name, keyword in EXPORT_ONLY_OPAQUE_IDS.items():
            with self.subTest(sample=name):
                imported = VALIDATOR_IMPORT.validate_file(INVALID_DIR / name)
                self.assertTrue(imported.valid, validate.format_human(imported))
                self.assertEqual(imported.errors, [])
                self.assertTrue(imported.consistent)
                self.assertIs(imported.engines["lxml"]["valid"], True)
                self.assertIs(imported.engines["xmllint"]["valid"], True)

                exported = VALIDATOR_EXPORT.validate_file(INVALID_DIR / name)
                self.assertFalse(exported.valid, validate.format_human(exported))
                self.assertEqual(_rules(exported), {"V-7"}, validate.format_human(exported))
                self.assertIn(keyword, _messages(exported))
                self.assertTrue(exported.consistent)

    def test_legacy_spelling_variants_on_referenced_entities_are_import_positive(self):
        cases = [
            ("03-structure.xml", [("<app id=\"sec_A\"", "<app id=\"app_A\""), ("rid=\"sec_A\"", "rid=\"app_A\"")], "LEGACY", "app_A"),
            ("03-structure.xml", [("<ref id=\"biblref_1\"", "<ref id=\"bib_1\""), ("rid=\"biblref_1\"", "rid=\"bib_1\"")], "LEGACY", "bib_1"),
            ("04-tables.xml", [("<fn id=\"table-fn_1.1\"", "<fn id=\"tabfn_1_a\""), ("rid=\"table-fn_1.1\"", "rid=\"tabfn_1_a\"")], "LEGACY", "tabfn_1_a"),
            ("05-formulas-figures.xml", [("<fig id=\"fig_1\">", "<fig id=\"ext_figure\">"), ("rid=\"fig_1\"", "rid=\"ext_figure\"")], "V-7", "ext_figure"),
        ]
        for name, replacements, export_rule, opaque_id in cases:
            with self.subTest(sample=name, id=opaque_id):
                source = self._source(name, replacements)
                imported = self._validate_text(source, VALIDATOR_IMPORT)
                self.assertTrue(imported.valid, validate.format_human(imported))
                self.assertEqual(imported.errors, [])
                self.assertTrue(imported.consistent)
                self.assertIs(imported.engines["lxml"]["valid"], True)
                self.assertIs(imported.engines["xmllint"]["valid"], True)

                exported = self._validate_text(source, VALIDATOR_EXPORT)
                self.assertFalse(exported.valid, validate.format_human(exported))
                self.assertEqual(_rules(exported), {export_rule}, validate.format_human(exported))
                self.assertIn(opaque_id, _messages(exported))
                self.assertTrue(exported.consistent)

    def test_import_still_rejects_illegal_ncname_duplicate_id_and_dangling_rid(self):
        base = (VALID_DIR / "03-structure.xml").read_text(encoding="utf-8")
        cases = [
            ("非法 NCName", base.replace('id="sec_A"', 'id="1bad"').replace('rid="sec_A"', 'rid="1bad"'), "不是合法的 XML ID"),
            ("重复 ID", base.replace('id="sec_5.2"', 'id="sec_5.1"').replace('rid="sec_5.2"', 'rid="sec_5.1"'), "重复的 id"),
            ("悬空 rid", base.replace('rid="sec_5.2"', 'rid="not-there"'), "无法解析"),
        ]
        for why, source, message in cases:
            with self.subTest(why=why):
                imported = self._validate_text(source, VALIDATOR_IMPORT)
                self.assertFalse(imported.valid, validate.format_human(imported))
                self.assertIn("V-1", _rules(imported), validate.format_human(imported))
                self.assertIn(message, _messages(imported), validate.format_human(imported))
                self.assertTrue(imported.consistent)


class TestGeneratedSamplesUpToDate(unittest.TestCase):
    """samples/invalid 下的负例由 gen_invalid_samples.py 生成；仓库里的文件不得偏离生成结果。"""

    def test_committed_negative_samples_match_generator(self):
        gen = _load("ses_gen_invalid_samples", HERE / "gen_invalid_samples.py")
        with tempfile.TemporaryDirectory() as tmp:
            n = gen.generate(tmp)
            generated = {p.name: p.read_bytes() for p in Path(tmp).glob("*.xml")}
        committed = {p.name: p.read_bytes() for p in INVALID_DIR.glob("*.xml")}
        self.assertEqual(n, len(generated))
        self.assertEqual(set(generated), set(committed))
        for name in sorted(generated):
            self.assertEqual(generated[name], committed[name], "%s 与生成结果不一致，请重新运行 gen_invalid_samples.py" % name)


class TestEngineConsistency(unittest.TestCase):
    def test_lxml_and_xmllint_agree_on_every_sample(self):
        xmllint = shutil.which("xmllint")
        self.assertIsNotNone(xmllint, "本机应有 xmllint")
        for path in sorted(VALID_DIR.glob("*.xml")) + sorted(INVALID_DIR.glob("*.xml")):
            with self.subTest(sample=path.name):
                rep = VALIDATOR_IMPORT.validate_file(path)
                self.assertTrue(rep.consistent)
                self.assertEqual(rep.engines["lxml"]["valid"], rep.engines["xmllint"]["valid"])
                # 独立再调一次 xmllint（与任务书给出的命令一致），确认与 validate.py 内部调用结论相同
                proc = subprocess.run([xmllint, "--noout", "--nonet", "--relaxng", str(SCHEMA), str(path)],
                                      capture_output=True, text=True)
                self.assertEqual(proc.returncode == 0, rep.engines["xmllint"]["valid"])

    def test_xmllint_accepts_all_valid_samples(self):
        xmllint = shutil.which("xmllint")
        files = [str(p) for p in sorted(VALID_DIR.glob("*.xml"))]
        proc = subprocess.run([xmllint, "--noout", "--nonet", "--relaxng", str(SCHEMA)] + files,
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stderr.count("validates"), len(files))


_SKELETON = """<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML"
          xmlns:tbx="urn:iso:std:iso:30042:ed-1">
{pm}  <front>
    <std-meta>
{meta}
    </std-meta>
{front_secs}  </front>
  <body>
{body}
  </body>
{back}</standard>
"""

_META = '<title-wrap xml:lang="zh"><full>t</full></title-wrap>'
_BODY = '<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p>x</p></sec>'


_PM = ('  <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml" terminology-model="tbx" '
       'math-representation="mathml" tagset-family="sts"/>\n')


def _doc(meta=_META, body=_BODY, pm=_PM, front_secs="", back=""):
    return _SKELETON.format(pm=pm, meta=meta, body=body, front_secs=front_secs, back=back)


class TestSchemaConstraints(unittest.TestCase):
    """用小文档直接检查 RELAX NG 的内容模型：该拒绝的两个实现都拒绝，该宽松接受的两个实现都接受。"""

    def _engines(self, text: str):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "case.xml"
            p.write_text(text, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(p)
        self.assertTrue(rep.consistent, validate.format_human(rep))
        return rep.engines["lxml"]["valid"], rep.engines["xmllint"]["valid"]

    def assertRejected(self, text, why):
        self.assertEqual(self._engines(text), (False, False), why)

    def assertAccepted(self, text, why):
        self.assertEqual(self._engines(text), (True, True), why)

    def test_rejections(self):
        cases = {
            "std-meta 缺 title-wrap": _doc(meta="<ics>1.2</ics>"),
            "std-ident 出现两次": _doc(meta=_META + "<std-ident/><std-ident/>"),
            "title-wrap 内 main 在 intro 之前": _doc(meta='<title-wrap xml:lang="zh"><main>m</main><intro>i</intro></title-wrap>'),
            "title-wrap 含未知子元素": _doc(meta='<title-wrap xml:lang="zh"><full>t</full><foo/></title-wrap>'),
            "body 为空": _doc(body=""),
            "章没有 title": _doc(body='<sec id="sec_1"><label>1</label><p>x</p></sec>'),
            "sec 内散落文本": _doc(body='<sec id="sec_1"><title>t</title>散落文本</sec>'),
            "list 没有 list-item": _doc(body='<sec id="sec_1"><title>t</title><list list-type="dash"/></sec>'),
            "xref 的 rid 为空": _doc(body='<sec id="sec_1"><title>t</title><p><xref ref-type="sec" rid="">x</xref></p></sec>'),
            "xref 缺 ref-type": _doc(body='<sec id="sec_1"><title>t</title><p><xref rid="sec_1">x</xref></p></sec>'),
            "xref 带 custom-type 却不是 custom": _doc(body='<sec id="sec_1"><title>t</title><p><xref ref-type="sec" custom-type="note" rid="sec_1">x</xref></p></sec>'),
            "fig 缺 graphic": _doc(body='<sec id="sec_1"><title>t</title><fig><caption><title>c</title></caption></fig></sec>'),
            "fig 缺 caption": _doc(body='<sec id="sec_1"><title>t</title><fig><graphic xlink:href="a"/></fig></sec>'),
            "disp-formula 含两个 mml:math": _doc(body='<sec id="sec_1"><title>t</title><disp-formula><mml:math><mml:mi>a</mml:mi></mml:math><mml:math><mml:mi>b</mml:mi></mml:math></disp-formula></sec>'),
            "mml:math 内出现非 MathML 命名空间元素": _doc(body='<sec id="sec_1"><title>t</title><p><inline-formula><mml:math><foo/></mml:math></inline-formula></p></sec>'),
            "inline-formula 含两个 mml:math": _doc(body='<sec id="sec_1"><title>t</title><p><inline-formula><mml:math/><mml:math/></inline-formula></p></sec>'),
            "std-meta 乱序时 std-ident 仍不能出现两次": _doc(meta='<std-ident/>' + _META + '<std-ident/>'),
            "std-meta 乱序时 proj-id 仍不能出现两次": _doc(meta='<proj-id>a</proj-id>' + _META + '<proj-id>b</proj-id>'),
            "std-meta 乱序时仍需 title-wrap": _doc(meta='<ccs>L 72</ccs><ics>1.2</ics>'),
            "std-meta 乱序时 page-count 仍不能出现两次": _doc(meta='<page-count count="1"/>' + _META + '<page-count count="2"/>'),
            "std-xref 空元素": _doc(meta=_META + '<std-xref type="revises"/>'),
            "tig 内 normativeAuthorization 在 partOfSpeech 之前": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term><tbx:normativeAuthorization value="preferredTerm"/><tbx:partOfSpeech value="noun"/></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec>'),
            "tbx:partOfSpeech 取值不在 noun/verb/adj/adv 内": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term><tbx:partOfSpeech value="pron"/></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec>'),
            "tbx:grammaticalNumber 取值不在 singular/plural 内": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term><tbx:grammaticalNumber value="dual"/></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec>'),
            "named-content 缺 content-type": _doc(body='<sec id="sec_1"><title>t</title><p><named-content>x</named-content></p></sec>'),
            "含子条的条在子条之后再放段落": _doc(body='<sec id="sec_1"><title>t</title><sec id="sec_1_1"><label>1.1</label><p>y</p></sec><p>悬置</p></sec>'),
            "sec 既无 label 也无 title": _doc(body='<sec id="sec_1"><title>t</title><sec id="sec_1_1"><p>y</p></sec></sec>'),
            "fig 内 caption 在 label 之前": _doc(body='<sec id="sec_1"><title>t</title><fig><caption><title>c</title></caption><label>图1</label><graphic xlink:href="a"/></fig></sec>'),
            "fig-group 内 legend 在分图之后": _doc(body='<sec id="sec_1"><title>t</title><fig-group><fig><caption><title>c</title></caption><graphic xlink:href="a"/></fig><legend><title>l</title></legend></fig-group></sec>'),
            "空的 table-wrap-foot": _doc(body='<sec id="sec_1"><title>t</title><table-wrap><table><tbody><tr><td>a</td></tr></tbody></table><table-wrap-foot/></table-wrap></sec>'),
            "table-wrap/@position 不在枚举内": _doc(body='<sec id="sec_1"><title>t</title><table-wrap position="top"><table><tbody><tr><td>a</td></tr></tbody></table></table-wrap></sec>'),
            "disp-quote 内 permissions 在 p 之前": _doc(body='<sec id="sec_1"><title>t</title><disp-quote><permissions/><p>x</p></disp-quote></sec>'),
            "index 为空": _doc(back='<back><index/></back>'),
            "bold 内含 break": _doc(body='<sec id="sec_1"><title>t</title><p><bold>a<break/>b</bold></p></sec>'),
            "sec 的直接子元素 fn（块级正文脚注，D-M-01 方案 A：正文 fn 只能是行内元素）": _doc(body='<sec id="sec_1"><title>t</title><fn id="f1"><p>z</p></fn></sec>'),
            "app 的直接子元素 fn（块级正文脚注，D-M-01）": _doc(back='<back><app-group><app id="a1" content-type="informative"><title>附录</title><fn id="f1"><p>z</p></fn></app></app-group></back>'),
            "xref 内含 xref": _doc(body='<sec id="sec_1"><title>t</title><p><xref ref-type="sec" rid="sec_1"><xref ref-type="sec" rid="sec_1">x</xref></xref></p></sec>'),
            "originator 内含 bold": _doc(meta=_META + '<std-ident><originator><bold>x</bold></originator></std-ident>'),
            "只有 thead 的表": _doc(body='<sec id="sec_1"><title>t</title><table-wrap><caption><title>c</title></caption><table><thead><tr><th>a</th></tr></thead></table></table-wrap></sec>'),
            "td 内 p 与文本混排": _doc(body='<sec id="sec_1"><title>t</title><table-wrap><table><tbody><tr><td><p>a</p>b</td></tr></tbody></table></table-wrap></sec>'),
            "td/@colspan 为 0": _doc(body='<sec id="sec_1"><title>t</title><table-wrap><table><tbody><tr><td colspan="0">a</td></tr></tbody></table></table-wrap></sec>'),
            "tig 缺 tbx:term": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:tig/></tbx:langSet></tbx:termEntry></term-sec></sec>'),
            "tig 内两个采用级别": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term><tbx:normativeAuthorization value="preferredTerm"/><tbx:normativeAuthorization value="admittedTerm"/></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec>'),
            "langSet 内两个 definition": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:definition>a</tbx:definition><tbx:definition>b</tbx:definition><tbx:tig><tbx:term>a</tbx:term></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec>'),
            "termEntry 缺 langSet": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry/></term-sec></sec>'),
            "tbx:termType 取值未定义": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term><tbx:termType value="acronym"/></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec>'),
            "app 缺 title": _doc(back='<back><app-group><app content-type="informative"><p>x</p></app></app-group></back>'),
            "back 内 index 在 ref-list 之前": _doc(back='<back><index/><ref-list content-type="bibl"><ref><mixed-citation>x</mixed-citation></ref></ref-list></back>'),
            "ref 含两个 mixed-citation": _doc(back='<back><ref-list content-type="bibl"><ref><mixed-citation>x</mixed-citation><mixed-citation>y</mixed-citation></ref></ref-list></back>'),
            "processing-meta 缺属性": _doc(pm='  <processing-meta base-tagset="interchange"/>\n'),
            "索引放在章里": _doc(body='<sec id="sec_1"><title>t</title><index id="i1"><index-div><index-entry id="e1"><term>t</term></index-entry></index-div></index></sec>'),
            "附录组放在 body 里": _doc(body='<sec id="sec_1"><title>t</title></sec><app-group><app id="a1" content-type="informative"><title>附录</title></app></app-group>'),
            "app 直接放在 back 里（缺 app-group）": _doc(back='<back><app id="a1" content-type="informative"><title>附录</title></app></back>'),
            "back 里 app-group 在 ref-list 之后": _doc(back='<back><ref-list content-type="bibl" id="r"><ref id="r1"><mixed-citation>x</mixed-citation></ref></ref-list>'
                                                        '<app-group><app id="a1" content-type="informative"><title>附录</title></app></app-group></back>'),
            "processing-meta 放在 front 之后": _doc().replace("</front>", "</front>\n  <processing-meta base-tagset=\"interchange\" mathml-version=\"3.0\" table-model=\"xhtml\" "
                                                    "terminology-model=\"tbx\" math-representation=\"mathml\" tagset-family=\"sts\"/>", 1),
            "sec-type=foreword 的 sec 放在 body 里": _doc(body='<sec id="sec_f" sec-type="foreword"><title>前言</title></sec>'),
            "sec-type=terms 的条放在章里面": _doc(body='<sec id="sec_1"><title>t</title><sec id="sec_1_1" sec-type="terms"><label>1.1</label><title>u</title></sec></sec>'),
            "tbx:termEntry 直接放在 sec 里（没有 term-sec）": _doc(body='<sec id="sec_3" sec-type="terms"><title>t</title><tbx:termEntry id="te"><tbx:langSet xml:lang="zh"/></tbx:termEntry></sec>'),
            "ref 直接放在 sec 里": _doc(body='<sec id="sec_1"><title>t</title><ref id="r1"><mixed-citation>x</mixed-citation></ref></sec>'),
            "引言排在前言之前": _doc(front_secs='<sec sec-type="intro"><title>引言</title></sec><sec sec-type="foreword"><title>前言</title></sec>'),
            "tex-math 不被接受": _doc(body='<sec id="sec_1"><title>t</title><disp-formula><mml:math/><tex-math>x</tex-math></disp-formula></sec>'),
            "tbx 前缀绑定到别的命名空间": _doc(
                body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"/></tbx:termEntry></term-sec></sec>'
            ).replace('xmlns:tbx="urn:iso:std:iso:30042:ed-1"', 'xmlns:tbx="urn:example:other"'),
        }
        for why, text in cases.items():
            with self.subTest(why=why):
                self.assertRejected(text, why)

    def test_lenient_forms_are_accepted(self):
        cases = {
            "std-meta 按 STS 1.2 顺序（含国标扩展元素的约定位置）": _doc(
                meta='<std-type>t</std-type>' + _META + '<std-ident/><std-org-group><std-org/></std-org-group><content-language>zh</content-language>'
                     '<release-date>2026-04-30</release-date><implementation-date>2026-11-01</implementation-date><equivalence>MOD</equivalence>'
                     '<comm-ref>c</comm-ref><ics>1.2</ics><ccs>L 72</ccs><std-supersedes>x</std-supersedes>'
                     '<std-xref type="revises"><std-ref>GB/T 1</std-ref></std-xref><permissions/><custom-meta-group><custom-meta><meta-name>n</meta-name><meta-value>v</meta-value></custom-meta></custom-meta-group>'),
            "std-meta 次序不限：4.1 示例的 ics、ccs 在 title-wrap 之前（导入宽容，次序由 V-12 告警）": _doc(
                meta='<ics>33.040.40</ics><ccs>M 32</ccs>' + _META),
            "std-meta 次序不限：content-language 在 std-org-group 之前": _doc(meta=_META + '<content-language>zh</content-language><std-org-group><std-org/></std-org-group>'),
            "std-meta 次序不限：ics 在 comm-ref 之前": _doc(meta=_META + '<ics>1.2</ics><comm-ref>c</comm-ref>'),
            "未知 sec-type 取值（表 D.1 行 13）": _doc(body='<sec id="sec_1"><title>t</title><sec id="sec_1_1" sec-type="custom-role"><label>1.1</label><title>u</title></sec></sec>'),
            "std-meta 里没有 std-org-group 等 SES 必填项": _doc(),
            "单元格为空": _doc(body='<sec id="sec_1"><title>t</title><table-wrap><table><tbody><tr><td/></tr></tbody></table></table-wrap></sec>'),
            "表没有 caption（附录 E 的无标题表）": _doc(body='<sec id="sec_1"><title>t</title><table-wrap id="tab_r"><table><tbody><tr><td>a</td></tr></tbody></table></table-wrap></sec>'),
            "mml:math 内任意 MathML 元素与属性": _doc(body='<sec id="sec_1"><title>t</title><p><inline-formula><mml:math class="c" altimg="x.png"><mml:semantics><mml:mrow><mml:mi mathvariant="bold">x</mml:mi></mml:mrow><mml:annotation encoding="x">y</mml:annotation></mml:semantics></mml:math></inline-formula></p></sec>'),
            "xref 的 rid 含多个标识符": _doc(body='<sec id="sec_1"><title>t</title><p><xref ref-type="sec" rid="a b">x</xref></p></sec>'),
            "fn 作为行内元素，紧随其 xref（D-M-01 方案 A）": _doc(body='<sec id="sec_1"><title>t</title><p>x<xref ref-type="fn" rid="f1">1)</xref><fn id="f1"><label>1)</label><p>y</p></fn></p></sec>'),
            "std 与 mixed-citation 出现在正文": _doc(body='<sec id="sec_1"><title>t</title><p><std><std-ref>GB/T 1</std-ref></std><mixed-citation>m</mixed-citation></p></sec>'),
            "无前缀公式替代图作为兄弟元素": _doc(body='<sec id="sec_1"><title>t</title><disp-formula><mml:math/></disp-formula><graphic content-type="disp-formula" xlink:href="formula_40_5"/></sec>'),
            "std-xref 内嵌 std-ref": _doc(meta=_META + '<std-xref type="revises"><std-ref>GB/T 1</std-ref></std-xref>'),
            "一个 std-org 内多个 std-org-name（4.1 示例，偏差表）": _doc(meta=_META + '<std-org-group><std-org><std-org-name>甲</std-org-name><std-org-name>乙</std-org-name><std-org-abbrev>GB</std-org-abbrev></std-org></std-org-group>'),
            "tbx:langSet 内 note 在 tig 之后（9.2.3 示例 2，偏差表）": _doc(body='<sec id="sec_1"><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:definition>d</tbx:definition><tbx:tig><tbx:term>a</tbx:term></tbx:tig><tbx:note>n</tbx:note></tbx:langSet></tbx:termEntry></term-sec></sec>'),
            "table-wrap 内 graphic 在 table-wrap-foot 之后（6.2.3 示例，偏差表）": _doc(body='<sec id="sec_1"><title>t</title><table-wrap><table><tbody><tr><td>a</td></tr></tbody></table><table-wrap-foot><p>n</p></table-wrap-foot><graphic content-type="disp_table" xlink:href="t"/></table-wrap></sec>'),
            "xref 内的 label（10.1.8 示例，偏差表）": _doc(body='<sec id="sec_1"><title>t</title><p><xref ref-type="fn" rid="f1"><label><sup>1)</sup></label></xref><fn id="f1"><p>x</p></fn></p></sec>'),
            "含子条的条：块在前，子条在后，其后再放注与清单": _doc(body='<sec id="sec_1"><title>t</title><p>x</p><sec id="sec_1_1"><label>1.1</label><p>y</p></sec><non-normative-note><p>n</p></non-normative-note></sec>'),
            "fig：label caption legend 之后的 graphic 与 p 任意排列": _doc(body='<sec id="sec_1"><title>t</title><fig><label>图1</label><caption><title>c</title></caption><legend><title>l</title></legend><p>p</p><graphic xlink:href="a"/><non-normative-note><p>n</p></non-normative-note></fig></sec>'),
        }
        for why, text in cases.items():
            with self.subTest(why=why):
                self.assertAccepted(text, why)


# std-meta 的全部子元素，按“导出次序”（STS 1.2 DTD 次序 + 国标扩展的约定位置，见 metadata.rng 文件头）排列
_META_PARTS = [
    ("std-type", "<std-type>推荐性国家标准</std-type>"),
    ("title-wrap", _META),
    ("proj-id", "<proj-id>p</proj-id>"),
    ("release-version", "<release-version>1</release-version>"),
    ("std-ident", "<std-ident/>"),
    ("std-org-group", "<std-org-group><std-org/></std-org-group>"),
    ("content-language", "<content-language>zh</content-language>"),
    ("std-ref", "<std-ref>GB/T 1</std-ref>"),
    ("doc-ref", "<doc-ref>d</doc-ref>"),
    ("release-date", "<release-date>2026-04-30</release-date>"),
    ("implementation-date", "<implementation-date>2026-11-01</implementation-date>"),
    ("equivalence", "<equivalence>MOD</equivalence>"),
    ("comm-ref", "<comm-ref>c</comm-ref>"),
    ("secretariat", "<secretariat>s</secretariat>"),
    ("ics", "<ics>1.2</ics>"),
    ("ccs", "<ccs>L 72</ccs>"),
    ("page-count", '<page-count count="3"/>'),
    ("std-supersedes", "<std-supersedes>x</std-supersedes>"),
    ("std-xref", '<std-xref type="revises"><std-ref>GB/T 1</std-ref></std-xref>'),
    ("permissions", "<permissions/>"),
    ("custom-meta-group", "<custom-meta-group><custom-meta><meta-name>n</meta-name><meta-value>v</meta-value></custom-meta></custom-meta-group>"),
]


class TestStdMetaOrder(unittest.TestCase):
    """V-12 STD-META-ORDER：RELAX NG 不限 std-meta 子元素次序；次序在 export 档是错误，在 import 档是告警。"""

    def _run(self, validator, parts):
        text = _doc(meta="".join(x for _, x in parts))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(text, encoding="utf-8")
            rep = validator.validate_file(path)
        self.assertTrue(rep.consistent, validate.format_human(rep))
        return rep

    @staticmethod
    def _order_findings(items):
        return [i for i in items if i["rule"] == "V-12"]

    def test_export_order_is_clean_in_both_profiles(self):
        for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
            rep = self._run(validator, _META_PARTS)
            self.assertEqual(rep.errors, [], validate.format_human(rep))
            self.assertEqual(self._order_findings(rep.warnings), [])

    def test_4_1_example_order_import_warns_export_errors(self):
        # 原文 4.1 示例：ics、ccs 在 title-wrap 之前，其后 release-date
        parts = [(n, dict(_META_PARTS)[n]) for n in ("ics", "ccs", "title-wrap", "release-date")]
        rep = self._run(VALIDATOR_IMPORT, parts)
        self.assertEqual(rep.errors, [], validate.format_human(rep))
        self.assertTrue(rep.valid)
        found = self._order_findings(rep.warnings)
        self.assertEqual(len(found), 1, validate.format_human(rep))
        self.assertIn("STD-META-ORDER", found[0]["message"])
        self.assertIn("实际次序：ics, ccs, title-wrap, release-date", found[0]["message"])
        self.assertIn("导出次序：title-wrap, release-date, ics, ccs", found[0]["message"])
        self.assertIn("行", found[0]["message"])
        rep = self._run(VALIDATOR_EXPORT, parts)
        self.assertFalse(rep.valid)
        self.assertEqual(len(self._order_findings(rep.errors)), 1)
        self.assertEqual({e["rule"] for e in rep.errors}, {"V-12"})

    def test_every_adjacent_swap_is_detected(self):
        for i in range(len(_META_PARTS) - 1):
            parts = list(_META_PARTS)
            parts[i], parts[i + 1] = parts[i + 1], parts[i]
            name = "%s/%s" % (parts[i][0], parts[i + 1][0])
            with self.subTest(swap=name):
                rep = self._run(VALIDATOR_IMPORT, parts)
                self.assertEqual(len(self._order_findings(rep.errors)), 1, validate.format_human(rep))
                rep = self._run(VALIDATOR_EXPORT, parts)
                self.assertEqual({e["rule"] for e in rep.errors}, {"V-12"}, validate.format_human(rep))

    def test_random_permutations_are_schema_valid_and_flagged_iff_out_of_order(self):
        import random
        rank = {n: i for i, (n, _) in enumerate(_META_PARTS)}
        rank["std-org"] = rank["std-org-group"]
        rnd = random.Random(46687)
        for _ in range(40):
            parts = list(_META_PARTS)
            rnd.shuffle(parts)
            in_order = [rank[n] for n, _ in parts] == sorted(rank[n] for n, _ in parts)
            with self.subTest(order=[n for n, _ in parts]):
                rep = self._run(VALIDATOR_IMPORT, parts)
                self.assertIs(rep.engines["lxml"]["valid"], True)
                self.assertIs(rep.engines["xmllint"]["valid"], True)
                self.assertEqual(len(self._order_findings(rep.errors)), 0 if in_order else 1)

    def test_repeatable_children_keep_their_position_class(self):
        # 同类重复元素（release-date、ics）相邻出现、整体次序正确 -> 不告警
        parts = [(n, x) for n, x in _META_PARTS if n in ("title-wrap", "release-date", "ics")]
        parts = [parts[0], parts[1], parts[1], parts[2], parts[2]]
        rep = self._run(VALIDATOR_EXPORT, parts)
        self.assertEqual(self._order_findings(rep.errors), [])

    def test_schema_still_enforces_cardinality_when_order_is_free(self):
        for meta in ('<std-ident/>' + _META + '<std-ident/>', '<proj-id>a</proj-id>' + _META + '<proj-id>b</proj-id>',
                     '<ccs>L 72</ccs><ics>1.2</ics>'):
            with self.subTest(meta=meta):
                rep = VALIDATOR_IMPORT.validate_file(self._write(_doc(meta=meta)))
                self.assertFalse(rep.valid)
                self.assertIn("RNG", {e["rule"] for e in rep.errors})

    def _write(self, text):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        path = Path(tmp) / "case.xml"
        path.write_text(text, encoding="utf-8")
        return path


# V-13 REQUIRED-ID：(名称, 带 {ID} 占位符的片段)；片段放在 <standard> 内的 body/back，占位符处填 ` id="x"` 或空
_REQUIRED_ID_CASES = [
    ("term-sec", '<body><sec id="s3" sec-type="terms"><label>3</label><title>术语</title><term-sec{ID}><label>3.1</label>'
                 '<tbx:termEntry id="te1"><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec></body>'),
    ("tbx:termEntry", '<body><sec id="s3" sec-type="terms"><label>3</label><title>术语</title><term-sec id="ts1"><label>3.1</label>'
                      '<tbx:termEntry{ID}><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec></body>'),
    ("sec", '<body><sec{ID} sec-type="scope"><label>1</label><title>范围</title><p>x</p></sec></body>'),
    ("sec", '<front><sec{ID} sec-type="foreword"><title>前言</title><p>x</p></sec></front><body><sec id="s1"><label>1</label><title>t</title></sec></body>'),
    ("sec", '<front><sec{ID} sec-type="intro"><title>引言</title><p>x</p></sec></front><body><sec id="s1"><label>1</label><title>t</title></sec></body>'),
    ("app", '<body><sec id="s1"><label>1</label><title>t</title></sec></body><back><app-group><app{ID} content-type="informative"><title>附录</title><p>x</p></app></app-group></back>'),
    ("ref-list", '<body><sec id="s1"><label>1</label><title>t</title></sec></body><back><ref-list{ID} content-type="bibl"><ref id="r1"><mixed-citation>x</mixed-citation></ref></ref-list></back>'),
    ("index", '<body><sec id="s1"><label>1</label><title>t</title></sec></body><back><index{ID}><index-div><index-title-group><title>A</title></index-title-group>'
              '<index-entry id="ie1"><term>t</term></index-entry></index-div></index></back>'),
    ("ref", '<body><sec id="s1"><label>1</label><title>t</title></sec></body><back><ref-list id="rl" content-type="bibl"><ref{ID}><mixed-citation>x</mixed-citation></ref></ref-list></back>'),
    ("ref", '<body><sec id="s2" sec-type="norm-refs"><label>2</label><title>引用</title><ref-list content-type="norm-refs"><ref{ID}><label>[1]</label><std><std-ref>GB/T 1</std-ref></std></ref></ref-list></sec></body>'),
    ("table-wrap", '<body><sec id="s1"><label>1</label><title>t</title><table-wrap{ID}><label>表1</label><caption><title>c</title></caption><table><tbody><tr><td>a</td></tr></tbody></table></table-wrap></sec></body>'),
    ("fig", '<body><sec id="s1"><label>1</label><title>t</title><fig{ID}><caption><title>c</title></caption><graphic xlink:href="a"/></fig></sec></body>'),
    ("disp-formula", '<body><sec id="s1"><label>1</label><title>t</title><disp-formula{ID}><label>(1)</label><mml:math/></disp-formula></sec></body>'),
    ("fn", '<body><sec id="s1"><label>1</label><title>t</title><table-wrap id="t1"><label>表1</label><caption><title>c</title></caption><table><tbody><tr><td>a</td></tr></tbody></table>'
           '<table-wrap-foot><fn{ID}><label>a</label><p>n</p></fn></table-wrap-foot></table-wrap></sec></body>'),
    ("fn", '<body><sec id="s1"><label>1</label><title>t</title><p>x<fn{ID}><label>1)</label><p>y</p></fn></p></sec></body>'),
]

# 不要求 id 的情形（矩阵里 id 可选或不适用）
_NOT_REQUIRED_ID_CASES = [
    ("无 label 的 sec", '<body><sec id="s1"><label>1</label><title>t</title><sec><title>u</title><p>y</p></sec></sec></body>'),
    ("无 label 的 table-wrap（M-E-11）", '<body><sec id="s1"><label>1</label><title>t</title><table-wrap><table><tbody><tr><td>a</td></tr></tbody></table></table-wrap></sec></body>'),
    ("无 label 的 disp-formula（X-21）", '<body><sec id="s1"><label>1</label><title>t</title><disp-formula><mml:math/></disp-formula></sec></body>'),
    ("规范性引用中无 label 的 ref 与 norm-refs 清单（M-E-06）",
     '<body><sec id="s2" sec-type="norm-refs"><label>2</label><title>引用</title><ref-list content-type="norm-refs"><ref><std><std-ref>GB/T 1</std-ref></std></ref></ref-list></sec></body>'),
    ("无正文的 fn（M-E-17）", '<body><sec id="s1"><label>1</label><title>t</title><p>x<fn/></p></sec></body>'),
    ("行内公式、段落、列项、术语注等一律不要求", '<body><sec id="s1"><label>1</label><title>t</title><p>x</p><list list-type="dash"><list-item><p>y</p></list-item></list></sec></body>'),
]


class TestRequiredId(unittest.TestCase):
    """V-13 REQUIRED-ID：结构层 id 一律可选；矩阵（obligation=shall）与附录 E 要求导出必写 id 的元素缺 id 时，export 档错误、import 档告警。"""

    NS = ('xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML" '
          'xmlns:tbx="urn:iso:std:iso:30042:ed-1"')

    def _findings(self, fragment, profile):
        text = "<standard %s>%s</standard>" % (self.NS, fragment)
        tree = validate.etree.ElementTree(validate.etree.fromstring(text.encode("utf-8"), validate.secure_parser()))
        rep = validate.Report("case.xml", profile)
        validate.check_required_ids([e for e in tree.getroot().iter() if validate.is_element(e)], rep)
        return rep

    def test_missing_id_is_a_warning_on_import_and_an_error_on_export(self):
        for name, tpl in _REQUIRED_ID_CASES:
            with self.subTest(element=name, fragment=tpl[:60]):
                has = self._findings(tpl.replace("{ID}", ' id="x1"'), "export")
                self.assertEqual((has.errors, has.warnings), ([], []), "有 id 时不应报告")
                self.assertEqual(self._findings(tpl.replace("{ID}", ' xml:id="x1"'), "export").errors, [], "xml:id 也算 id")
                missing = tpl.replace("{ID}", "")
                imp = self._findings(missing, "import")
                strict = name in ("tbx:termEntry", "app") or (name == "ref" and 'content-type="bibl"' in tpl)
                found = imp.errors if strict else imp.warnings
                self.assertEqual([w["rule"] for w in found], ["V-13"])
                self.assertIn("REQUIRED-ID", found[0]["message"])
                self.assertIn("<%s>" % name, found[0]["message"])
                exp = self._findings(missing, "export")
                self.assertEqual(exp.warnings, [])
                self.assertEqual([e["rule"] for e in exp.errors], ["V-13"])
                self.assertIn("导出必须写 id", exp.errors[0]["message"])

    def test_every_finding_cites_the_matrix_or_appendix_e(self):
        for name, tpl in _REQUIRED_ID_CASES:
            msg = self._findings(tpl.replace("{ID}", ""), "export").errors[0]["message"]
            self.assertRegex(msg, r"M-[0-9A-Z.]+-\d+", "%s 的信息要写明矩阵行" % name)
            self.assertIn("印刷页", msg, name)

    def test_ids_not_required_for_these_forms(self):
        for why, frag in _NOT_REQUIRED_ID_CASES:
            with self.subTest(why=why):
                for profile in ("import", "export"):
                    rep = self._findings(frag, profile)
                    self.assertEqual((rep.errors, rep.warnings), ([], []), why)

    def test_term_entry_and_term_sec_are_reported_separately(self):
        frag = ('<body><sec id="s3" sec-type="terms"><label>3</label><title>术语</title><term-sec><label>3.1</label>'
                '<tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec></body>')
        rep = self._findings(frag, "export")
        self.assertEqual(sorted(e["message"].split("：")[1].split(" ")[0] for e in rep.errors), ["<tbx:termEntry>", "<term-sec>"])

    def test_schema_keeps_id_optional(self):
        # 结构层不要求 id：缺 id 的文档两个 RELAX NG 实现都接受，import 档整体通过
        for name in ("missing-term-entry-id.xml", "missing-app-id.xml", "missing-ref-id.xml"):
            rep = VALIDATOR_IMPORT.validate_file(INVALID_DIR / name)
            self.assertFalse(rep.valid, validate.format_human(rep))
            self.assertIn("V-13", _rules(rep))
            self.assertIs(rep.engines["lxml"]["valid"], True)
            self.assertIs(rep.engines["xmllint"]["valid"], True)

    def test_export_clean_samples_have_every_required_id(self):
        for path in sorted(VALID_DIR.glob("*.xml")):
            if path.name.startswith(EXPORT_CLEAN_PREFIXES):
                for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
                    rep = validator.validate_file(path)
                    self.assertEqual([i for i in rep.errors + rep.warnings if i["rule"] == "V-13"], [], path.name)

    def test_dangling_reference_to_missing_id_is_still_a_v1_error(self):
        # 缺 id 的目标被 xref 引用时：V-13 只告警，悬空引用由 V-1 报错（import 档也是错误）
        text = _doc(body='<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p>见<xref ref-type="fig" rid="fig_1">图1</xref></p>'
                         '<fig><caption><title>c</title></caption><graphic xlink:href="a"/></fig></sec>')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(text, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(path)
        self.assertFalse(rep.valid)
        self.assertEqual({e["rule"] for e in rep.errors}, {"V-1"})
        self.assertEqual([w["rule"] for w in rep.warnings if w["rule"] == "V-13"], ["V-13"])


class TestCustomXref(unittest.TestCase):
    """xref[ref-type=custom]：目标一律检查（术语条目、注、示例之一，有 custom-type 时须一致）；缺 custom-type 导出错误、导入告警。"""

    @staticmethod
    def _doc_with(xref: str):
        body = (
            '<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p>见%s。</p>'
            '<non-normative-note id="note_1"><label>注</label><p>n</p></non-normative-note>'
            '<non-normative-example id="ex_1"><label>示例</label><p>e</p></non-normative-example></sec>'
            '<sec id="sec_3" sec-type="terms"><label>3</label><title>术语</title>'
            '<term-sec id="sec_3.1"><label>3.1</label><tbx:termEntry id="term_3.1"><tbx:langSet xml:lang="zh">'
            '<tbx:definition>d</tbx:definition><tbx:tig><tbx:term>a</tbx:term></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec>'
        ) % xref
        return _doc(body=body)

    def _run(self, xref, validator):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(self._doc_with(xref), encoding="utf-8")
            return validator.validate_file(path)

    @staticmethod
    def _x(rid, ct=None):
        return '<xref ref-type="custom"%s rid="%s">x</xref>' % (' custom-type="%s"' % ct if ct else "", rid)

    def test_matching_custom_type_and_target_is_clean(self):
        cases = [("term-entry", "term_3.1"), ("term-entry", "sec_3.1"), ("note", "note_1"), ("example", "ex_1")]
        for ct, rid in cases:
            for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
                with self.subTest(custom_type=ct, rid=rid, profile=validator.profile):
                    rep = self._run(self._x(rid, ct), validator)
                    self.assertEqual(rep.errors, [], validate.format_human(rep))
                    self.assertEqual([w for w in rep.warnings if w["rule"] == "V-8"], [])
                    self.assertTrue(rep.consistent)

    def test_missing_custom_type_warns_on_import_with_inferred_type(self):
        for rid, inferred in (("term_3.1", "term-entry"), ("sec_3.1", "term-entry"), ("note_1", "note"), ("ex_1", "example")):
            with self.subTest(rid=rid):
                rep = self._run(self._x(rid), VALIDATOR_IMPORT)
                self.assertFalse(rep.valid, validate.format_human(rep))
                found = [w for w in rep.errors if w["rule"] == "V-8"]
                self.assertEqual(len(found), 1, validate.format_human(rep))
                self.assertIn("CUSTOM-TYPE", found[0]["message"])
                self.assertIn("项目严格", found[0]["message"])
                self.assertIs(rep.engines["lxml"]["valid"], True)
                self.assertIs(rep.engines["xmllint"]["valid"], True)

    def test_missing_custom_type_is_an_error_on_export(self):
        for rid in ("term_3.1", "note_1", "ex_1"):
            with self.subTest(rid=rid):
                rep = self._run(self._x(rid), VALIDATOR_EXPORT)
                self.assertFalse(rep.valid)
                self.assertEqual({e["rule"] for e in rep.errors}, {"V-8"}, validate.format_human(rep))
                self.assertIn("导出必须写 custom-type", _messages(rep))

    def test_wrong_targets_are_errors_in_both_profiles(self):
        cases = {
            "缺 custom-type 且指向章": self._x("sec_1"),
            "缺 custom-type 且指向术语章": self._x("sec_3"),
            "custom-type=note 指向术语条目": self._x("term_3.1", "note"),
            "custom-type=term-entry 指向注": self._x("note_1", "term-entry"),
            "custom-type=example 指向注": self._x("note_1", "example"),
            "custom-type=note 指向示例": self._x("ex_1", "note"),
        }
        for why, xref in cases.items():
            for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
                with self.subTest(why=why, profile=validator.profile):
                    rep = self._run(xref, validator)
                    self.assertFalse(rep.valid, why)
                    self.assertEqual({e["rule"] for e in rep.errors}, {"V-8"}, validate.format_human(rep))
                    self.assertNotIn("推断", _messages(rep), "目标不对时不推断类型")

    def test_unresolved_rid_and_missing_type_are_both_errors(self):
        rep = self._run(self._x("nowhere"), VALIDATOR_IMPORT)
        self.assertEqual({e["rule"] for e in rep.errors}, {"V-1", "V-8"})

    def test_schema_keeps_custom_type_optional(self):
        # 结构层不要求 custom-type（10.1.1“可选”）；缺失由 V-8 按档位处理
        rep = self._run(self._x("term_3.1"), VALIDATOR_IMPORT)
        self.assertIs(rep.engines["lxml"]["valid"], True)
        self.assertIs(rep.engines["xmllint"]["valid"], True)
        # 取值仍受枚举限制
        rep = self._run(self._x("term_3.1", "glossary"), VALIDATOR_IMPORT)
        self.assertIs(rep.engines["lxml"]["valid"], False)
        self.assertIs(rep.engines["xmllint"]["valid"], False)


class TestContextRejectsUseAncestors(unittest.TestCase):
    """“X 内不得有 Y”的上下文拒绝按任意祖先判断，不只看直接父元素（PR#55 审查：fn 藏进 caption/p 就能绕过）。"""

    NS = ('xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML" '
          'xmlns:tbx="urn:iso:std:iso:30042:ed-1"')

    def _rejects(self, fragment):
        text = "<standard %s>%s</standard>" % (self.NS, fragment)
        tree = validate.etree.ElementTree(validate.etree.fromstring(text.encode("utf-8"), validate.secure_parser()))
        rep = validate.Report("case.xml", "import")
        validate.check_rejects(tree, rep)
        return rep

    FN = '<fn id="f1"><p>n</p></fn>'

    def test_fn_anywhere_inside_a_figure_is_rejected(self):
        fn = self.FN
        cases = {
            "fig 的直接子元素": '<fig><caption><title>c</title></caption>%s</fig>' % fn,
            "caption 的段落里": '<fig><caption><title>c</title><p>u%s</p></caption></fig>' % fn,
            "fig 的说明段里": '<fig><caption><title>c</title></caption><p>x%s</p></fig>' % fn,
            "图注里": '<fig><caption><title>c</title></caption><non-normative-note><p>x%s</p></non-normative-note></fig>' % fn,
            "图例的定义列表里": '<fig><caption><title>c</title></caption><legend><def-list><def-item><term>a</term><def><p>x%s</p></def></def-item></def-list></legend></fig>' % fn,
            "组合图（fig-group）的图题里": '<fig-group><caption><title>c</title><p>x%s</p></caption><fig><caption><title>d</title></caption></fig></fig-group>' % fn,
            "分图里": '<fig-group><caption><title>c</title></caption><fig><caption><title>d</title><p>x%s</p></caption></fig></fig-group>' % fn,
        }
        for why, frag in cases.items():
            with self.subTest(why=why):
                rep = self._rejects('<body><sec><title>t</title>%s</sec></body>' % frag)
                found = [e for e in rep.errors if e["rule"] == "REJECT" and "图脚注" in e["message"]]
                self.assertEqual(len(found), 1, why)

    def test_fn_outside_figures_is_not_rejected(self):
        fn = self.FN
        cases = {
            "正文段落": '<p>x%s</p>' % fn,
            "表脚注": '<table-wrap><table><tbody><tr><td>a</td></tr></tbody></table><table-wrap-foot>%s</table-wrap-foot></table-wrap>' % fn,
            "图后面的段落": '<fig><caption><title>c</title></caption></fig><p>x%s</p>' % fn,
        }
        for why, frag in cases.items():
            with self.subTest(why=why):
                rep = self._rejects('<body><sec><title>t</title>%s</sec></body>' % frag)
                self.assertEqual(rep.errors, [], why)

    def test_std_anywhere_inside_tbx_source_is_rejected(self):
        for why, inner in (("直接子元素", "<std><std-ref>GB/T 1</std-ref></std>"),
                           ("嵌在 bold 里", "<bold><std><std-ref>GB/T 1</std-ref></std></bold>")):
            with self.subTest(why=why):
                rep = self._rejects('<body><sec><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh">'
                                    '<tbx:source>[来源：%s]</tbx:source></tbx:langSet></tbx:termEntry></term-sec></sec></body>' % inner)
                self.assertEqual([e["rule"] for e in rep.errors], ["REJECT"], why)
                self.assertIn("tbx:source", rep.errors[0]["message"])

    def test_std_outside_tbx_source_is_not_rejected(self):
        rep = self._rejects('<body><sec><title>t</title><p><std><std-ref>GB/T 1</std-ref></std></p></sec></body>')
        self.assertEqual(rep.errors, [])

    def test_nested_table_and_term_entry_at_any_depth(self):
        rep = self._rejects('<body><sec><title>t</title><table-wrap><table><tbody><tr><td><p>x</p><list list-type="dash"><list-item><p>'
                            '<table-wrap><table><tbody><tr><td>a</td></tr></tbody></table></table-wrap></p></list-item></list></td></tr></tbody></table></table-wrap></sec></body>')
        self.assertIn("嵌套表", _messages(rep))
        rep = self._rejects('<body><sec><title>t</title><term-sec><tbx:termEntry><tbx:langSet xml:lang="zh"><tbx:definition>d'
                            '<tbx:termEntry/></tbx:definition></tbx:langSet></tbx:termEntry></term-sec></sec></body>')
        self.assertIn("嵌套的 tbx:termEntry", _messages(rep))

    def test_sections_inside_the_introduction_warn_at_every_depth(self):
        frag = ('<front><sec sec-type="intro"><title>引言</title><sec><label>0.1</label><title>a</title>'
                '<sec><label>0.1.1</label><title>b</title><sec><label>0.1.1.1</label><title>c</title></sec></sec></sec></sec></front>'
                '<body><sec sec-type="scope"><label>1</label><title>范围</title><sec><label>1.1</label><title>d</title></sec></sec></body>')
        rep = self._rejects(frag)
        warned = [w for w in rep.warnings if w["rule"] == "W-IMPL-REJECT" and "引言中的条" in w["message"]]
        self.assertEqual(warned, [])  # 三层引言条均为已支持结构
        self.assertEqual(rep.errors, [])


_FAKE_VALIDITY = ("x.xml:1: element standard: validity error : No declaration for element standard\n"
                  "Document x.xml does not validate against y.dtd\n")


def _fake_xmllint(dir_path: Path, body: str, name="xmllint") -> str:
    """写一个假的 xmllint 脚本（sh），返回路径。"""
    path = Path(dir_path) / name
    path.write_text("#!/bin/sh\n" + body, encoding="utf-8")
    path.chmod(0o755)
    return str(path)


@unittest.skipUnless(sys.platform != "win32", "用 sh 脚本模拟 xmllint")
class TestEngineFailuresPropagate(unittest.TestCase):
    """引擎失败（DTD 坏/不存在、xmllint 不可执行或输出无法解析）必须报错并使退出码非 0，不得当成“0 个偏差”。"""

    SAMPLE = VALID_DIR / "01-minimal.xml"

    def _assert_engine_failure(self, res, where=None):
        self.assertTrue(res["engine_error"], sts.format_human(res))
        self.assertTrue(res["unexplained"])
        self.assertEqual({u["element"] for u in res["unexplained"]}, {"ENGINE"})
        self.assertEqual(res["known"], [])
        self.assertTrue(res["wellformed"])
        if where:
            self.assertIn(where, "".join(u["message"] for u in res["unexplained"]))

    def test_classifier_table(self):
        c = sts._classify_xmllint_output
        self.assertEqual(c(0, ""), ([], None))
        self.assertEqual(c(0, "x.xml validates\n"), ([], None))
        ok_errs, problem = c(3, _FAKE_VALIDITY)
        self.assertIsNone(problem)
        self.assertEqual(len(ok_errs), 1)
        bad = {
            "退出码 0 却有输出": c(0, "warning: failed to load external entity\n"),
            "退出码 0 却有 validity error": c(0, _FAKE_VALIDITY),
            "退出码 3 但没有可解析的行": c(3, ""),
            "退出码 3 但只有看不懂的行": c(3, "something odd\n"),
            "退出码 3 夹杂 I/O 错误": c(3, "I/O error : Is a directory\n" + _FAKE_VALIDITY),
            "DTD 解析失败（退出码 2）": c(2, "broken.dtd:2: parser error : x\nCould not parse DTD broken.dtd\n"),
            "找不到 DTD（退出码 2）": c(2, 'warning: failed to load external entity "missing.dtd"\nCould not parse DTD missing.dtd\n'),
            "退出码 1": c(1, ""),
            "被信号杀死": c(-11, ""),
        }
        for why, (errs, problem) in bad.items():
            with self.subTest(why=why):
                self.assertEqual(errs, [])
                self.assertTrue(problem, why)

    def test_broken_dtd_is_an_engine_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            dtd = Path(tmp) / "broken.dtd"
            dtd.write_text("<!ELEMENT standard (front\n<!ELEMENT front EMPTY>\n", encoding="utf-8")
            res = sts.check_file(self.SAMPLE, dtd=dtd)
            self._assert_engine_failure(res, "原文档")
            self.assertIn("归一化副本", "".join(u["message"] for u in res["unexplained"]))  # 两遍都失败，分别报告

    def test_missing_dtd_and_directory_dtd_are_engine_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._assert_engine_failure(sts.check_file(self.SAMPLE, dtd=Path(tmp) / "nope.dtd"), "找不到 DTD")
            self._assert_engine_failure(sts.check_file(self.SAMPLE, dtd=Path(tmp)), "找不到 DTD")

    def test_unusable_xmllint_is_an_engine_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._assert_engine_failure(sts.check_file(self.SAMPLE, xmllint=str(Path(tmp) / "no-such-xmllint")), "无法运行 xmllint")
            plain = Path(tmp) / "not-executable"
            plain.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            plain.chmod(0o644)
            self._assert_engine_failure(sts.check_file(self.SAMPLE, xmllint=str(plain)), "无法运行 xmllint")

    def test_xmllint_not_on_path_is_an_engine_failure(self):
        from unittest import mock
        with mock.patch.object(sts.shutil, "which", return_value=None):
            self._assert_engine_failure(sts.check_file(self.SAMPLE), "找不到 xmllint")

    def test_garbled_or_crashing_xmllint_is_an_engine_failure(self):
        scripts = {
            "退出码 3 但没有任何诊断": "exit 3\n",
            "退出码 2": "echo 'Could not parse DTD' >&2\nexit 2\n",
            "退出码 0 却输出看不懂的东西": "echo 'garbage' >&2\nexit 0\n",
            "崩溃": "kill -SEGV $$\n",
        }
        with tempfile.TemporaryDirectory() as tmp:
            for why, body in scripts.items():
                with self.subTest(why=why):
                    self._assert_engine_failure(sts.check_file(self.SAMPLE, xmllint=_fake_xmllint(tmp, body)))

    def test_failure_in_only_the_normalized_pass_is_reported(self):
        # 08 号样例用到白名单，归一化副本才会被校验一遍；第一遍“正常”、第二遍失败时整个结论仍然作废
        sample = VALID_DIR / "08-original-forms-vs-sts.xml"
        with tempfile.TemporaryDirectory() as tmp:
            mark = Path(tmp) / "mark"
            body = ('if [ -e "%s" ]; then echo oops >&2; exit 2; fi\ntouch "%s"\ncat >&2 <<\'EOF\'\n%sEOF\nexit 3\n'
                    % (mark, mark, _FAKE_VALIDITY))
            res = sts.check_file(sample, xmllint=_fake_xmllint(tmp, body))
            self._assert_engine_failure(res, "归一化副本")
            self.assertNotIn("原文档", "".join(u["message"] for u in res["unexplained"]))

    def test_silent_success_is_still_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = sts.check_file(self.SAMPLE, xmllint=_fake_xmllint(tmp, "exit 0\n"))
        self.assertFalse(res["engine_error"])
        self.assertEqual((res["known"], res["unexplained"]), ([], []))

    def test_cli_exits_nonzero_on_engine_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            for dtd in (Path(tmp) / "nope.dtd", Path(tmp) / "broken.dtd"):
                if dtd.name == "broken.dtd":
                    dtd.write_text("<!ELEMENT a (b\n", encoding="utf-8")
                proc = subprocess.run([sys.executable, "-I", str(HERE / "sts_compat.py"), "--dtd", str(dtd), str(self.SAMPLE)],
                                      capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
                self.assertIn("ENGINE", proc.stdout)
                proc = subprocess.run([sys.executable, "-I", str(HERE / "sts_compat.py"), "--json", "--dtd", str(dtd), str(self.SAMPLE)],
                                      capture_output=True, text=True, encoding="utf-8")
                data = json.loads(proc.stdout)
                self.assertEqual(proc.returncode, 1)
                self.assertFalse(data["ok"])
                self.assertEqual(data["results"][0]["unexplained"][0]["element"], "ENGINE")

    def test_malformed_input_is_still_reported_as_such(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.xml"
            bad.write_text("<standard>", encoding="utf-8")
            res = sts.check_file(bad, dtd=Path(tmp) / "nope.dtd")
            self.assertFalse(res["wellformed"])


@unittest.skipUnless(sys.platform != "win32", "用 sh 脚本模拟 xmllint")
class TestValidateEngineFailuresPropagate(unittest.TestCase):
    """validate.py 的两个 RELAX NG 实现：任何一个失败都不能让文件“通过”。"""

    SAMPLE = VALID_DIR / "01-minimal.xml"

    def test_xmllint_that_cannot_run_is_an_engine_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            plain = Path(tmp) / "not-executable"
            plain.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            plain.chmod(0o644)
            for exe in (str(Path(tmp) / "no-such-xmllint"), str(plain)):
                with self.subTest(exe=Path(exe).name):
                    rep = validate.Validator(SCHEMA, xmllint_exe=exe).validate_file(self.SAMPLE)
                    self.assertFalse(rep.valid)
                    self.assertIn("ENGINE", _rules(rep))
                    self.assertIsNone(rep.engines["xmllint"]["valid"])

    def test_xmllint_that_fails_on_a_valid_file_is_a_consistency_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            for why, body in (("退出码 2", "echo 'Relax-NG parser error' >&2\nexit 2\n"), ("崩溃", "kill -SEGV $$\n"),
                              ("退出码 1 无输出", "exit 1\n")):
                with self.subTest(why=why):
                    rep = validate.Validator(SCHEMA, xmllint_exe=_fake_xmllint(tmp, body)).validate_file(self.SAMPLE)
                    self.assertFalse(rep.valid)
                    self.assertIn("CONSISTENCY", _rules(rep))
                    self.assertFalse(rep.consistent)

    def test_broken_lxml_engine_is_an_engine_error(self):
        from unittest import mock
        with mock.patch.object(validate, "run_lxml_relaxng", side_effect=validate.etree.LxmlError("boom")):
            rep = VALIDATOR_IMPORT.validate_file(self.SAMPLE)
        self.assertFalse(rep.valid)
        self.assertIn("ENGINE", _rules(rep))

    def test_cli_exits_nonzero_for_unusable_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            broken = Path(tmp) / "broken.rng"
            broken.write_text("<grammar xmlns='http://relaxng.org/ns/structure/1.0'><start><ref name='nope'/></start></grammar>", encoding="utf-8")
            for schema in (broken, Path(tmp) / "missing.rng"):
                proc = subprocess.run([sys.executable, "-I", str(HERE / "validate.py"), "--schema", str(schema), str(self.SAMPLE)],
                                      capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
                self.assertIn("无法加载 RELAX NG schema", proc.stderr)

    def test_cli_exits_nonzero_when_the_file_is_unreadable(self):
        proc = subprocess.run([sys.executable, "-I", str(HERE / "validate.py"), "/no/such/file.xml"],
                              capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(proc.returncode, 1)


class TestContainerPositions(unittest.TestCase):
    """有位置约束的容器：能由结构层表达的由 RELAX NG 拒绝（见 TestSchemaConstraints），结构层表达不了的由语义规则拒绝。"""

    TE = ('<tbx:termEntry id="te%d"><tbx:langSet xml:lang="zh"><tbx:definition>d</tbx:definition>'
          '<tbx:tig><tbx:term>a</tbx:term></tbx:tig></tbx:langSet></tbx:termEntry>')
    REFS = '<ref-list content-type="%s" id="rl%d"><ref id="r%d"><mixed-citation>x</mixed-citation></ref></ref-list>'

    def _run(self, text, validator=None):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(text, encoding="utf-8")
            return (validator or VALIDATOR_IMPORT).validate_file(path)

    def _term_sec(self, n):
        return '<term-sec id="ts%d"><label>3.%d</label>%s</term-sec>' % (n, n, self.TE % n)

    def test_bibl_ref_list_must_be_a_direct_child_of_back(self):
        sec = '<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p>x</p>%s</sec>'
        nested = '<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><sec id="sec_1_1"><label>1.1</label><title>t</title>%s</sec></sec>'
        cases = {
            "放在章里": dict(body=sec % (self.REFS % ("bibl", 1, 1))),
            "放在条里": dict(body=nested % (self.REFS % ("bibl", 1, 1))),
            "放在附录里": dict(back='<back><app-group><app id="sec_A" content-type="informative"><title>附录</title>%s</app></app-group></back>' % (self.REFS % ("bibl", 1, 1))),
            "别名 bibr 放在章里": dict(body=sec % (self.REFS % ("bibr", 1, 1))),
        }
        for why, kw in cases.items():
            for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
                with self.subTest(why=why, profile=validator.profile):
                    rep = self._run(_doc(**kw), validator)
                    self.assertFalse(rep.valid, why)
                    self.assertIn("V-3", _rules(rep))
                    self.assertIn("back 的直接子元素", _messages(rep))
                    self.assertIs(rep.engines["lxml"]["valid"], True, "结构层允许，由语义规则拒绝")

    def test_bibl_ref_list_in_back_is_accepted(self):
        rep = self._run(_doc(back="<back>%s</back>" % (self.REFS % ("bibl", 1, 1))))
        self.assertEqual(rep.errors, [], validate.format_human(rep))
        rep = self._run(_doc(back="<back>%s</back>" % (self.REFS % ("bibr", 1, 1))))  # 别名：导入接受（告警）
        self.assertEqual(rep.errors, [], validate.format_human(rep))
        self.assertIn("IMPORT-ONLY", {w["rule"] for w in rep.warnings})

    def test_norm_refs_list_must_be_a_direct_child_of_the_norm_refs_chapter(self):
        ok = '<sec id="sec_2" sec-type="norm-refs"><label>2</label><title>规范性引用文件</title><p>引导语。</p>%s</sec>' % (self.REFS % ("norm-refs", 1, 1))
        self.assertEqual(self._run(_doc(body=ok)).errors, [])
        nested = ('<sec id="sec_2" sec-type="norm-refs"><label>2</label><title>规范性引用文件</title><sec id="sec_2_1"><label>2.1</label><title>t</title>%s</sec></sec>'
                  % (self.REFS % ("norm-refs", 1, 1)))
        in_back = "<back>%s</back>" % (self.REFS % ("norm-refs", 1, 1))
        in_scope = '<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title>%s</sec>' % (self.REFS % ("norm-refs", 1, 1))
        for why, kw in {"嵌在子条里": dict(body=nested), "放在 back 里": dict(back=in_back), "放在范围章里": dict(body=in_scope)}.items():
            with self.subTest(why=why):
                rep = self._run(_doc(**kw))
                self.assertIn("V-3", _rules(rep), why)
                self.assertIn("norm-refs", _messages(rep))

    def test_term_sec_belongs_in_the_terms_chapter(self):
        terms = lambda inner: '<sec id="sec_3" sec-type="terms"><label>3</label><title>术语和定义</title>%s</sec>' % inner
        ok = {
            "术语章的直接子元素": dict(body=terms(self._term_sec(1))),
            "术语章的分组条里": dict(body=terms('<sec id="sec_3_1"><label>3.1</label><title>分组</title>%s</sec>' % self._term_sec(2))),
            "两层分组条里": dict(body=terms('<sec id="g1"><label>3.1</label><title>a</title><sec id="g2"><label>3.1.1</label><title>b</title>%s</sec></sec>' % self._term_sec(3))),
        }
        for why, kw in ok.items():
            with self.subTest(why=why):
                rep = self._run(_doc(**kw))
                self.assertEqual([e for e in rep.errors if e["rule"] == "V-2"], [], why)
        scope = '<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title>%s</sec>'
        bad = {
            "范围章里": dict(body=scope % self._term_sec(1)),
            "附录里": dict(back='<back><app-group><app id="sec_A" content-type="informative"><title>附录</title>%s</app></app-group></back>' % self._term_sec(1)),
            "前言里": dict(front_secs='<sec id="sec_foreword" sec-type="foreword"><title>前言</title>%s</sec>' % self._term_sec(1)),
            "不带 sec-type 的章里": dict(body='<sec id="sec_4"><label>4</label><title>其他</title>%s</sec>' % self._term_sec(1)),
        }
        for why, kw in bad.items():
            with self.subTest(why=why):
                rep = self._run(_doc(**kw))
                self.assertFalse(rep.valid, why)
                self.assertIn("V-2", _rules(rep))
                self.assertIn("术语和定义", _messages(rep))
                self.assertIs(rep.engines["lxml"]["valid"], True, "结构层允许，由语义规则拒绝")


class TestXrefTargets(unittest.TestCase):
    """xref[ref-type] 的目标集合（conventions-T 表 6-A）：逐类型检查，且各类型的目标互斥。"""

    NS = ('xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML" '
          'xmlns:tbx="urn:iso:std:iso:30042:ed-1"')

    def _tree(self, fragment):
        text = "<standard %s>%s</standard>" % (self.NS, fragment)
        return validate.etree.ElementTree(validate.etree.fromstring(text.encode("utf-8"), validate.secure_parser()))

    # 一个文档里放齐各类目标；xref 放在 td 里（与表 1 在同一 table-wrap）
    DOC = (
        '<body><sec id="s1" sec-type="scope"><title>范围</title>'
        '<p id="para">x</p>'
        '<non-normative-note id="note1"><p>n</p></non-normative-note>'
        '<table-wrap id="t1"><label>表1</label><table><tbody><tr><td><xref id="x_in_t1" ref-type="table-fn" rid="tfn1">a</xref></td></tr></tbody></table>'
        '<table-wrap-foot><fn id="tfn1"><label>a</label><p>表脚注。</p></fn><p>x<fn id="tfn_nested"><p>嵌在段落里的表脚注。</p></fn></p></table-wrap-foot></table-wrap>'
        '<table-wrap id="t2"><label>表2</label><table><tbody><tr><td>b</td></tr></tbody></table>'
        '<table-wrap-foot><fn id="tfn2"><label>a</label><p>另一张表的脚注。</p></fn></table-wrap-foot></table-wrap>'
        '<p>正文<fn id="bfn"><label>1)</label><p>正文脚注。</p></fn></p>'
        '<fig id="f1"><caption><title>c</title></caption><graphic xlink:href="a"/></fig>'
        '<fig-group id="fg1"><caption><title>c</title></caption><fig id="f2"><caption><title>d</title></caption><graphic xlink:href="a"/></fig></fig-group>'
        '<disp-formula id="df1"><label>(1)</label><mml:math/></disp-formula>'
        '<list list-type="dash" id="l1"><list-item id="li1"><p>y</p></list-item></list>'
        '<def-list list-content="abbreviation"><def-item id="abb1"><term>A</term><def><p>a</p></def></def-item></def-list>'
        '<def-list><def-item id="legend1"><term>x</term><def><p>式中</p></def></def-item></def-list>'
        '<sec id="s_sub"><label>1.1</label><title>子条</title></sec></sec></body>'
        '<back><app-group><app id="a1" content-type="informative"><title>附录</title></app></app-group>'
        '<ref-list content-type="bibl" id="rl"><ref id="r1"><label>[1]</label><mixed-citation id="mc1">x</mixed-citation></ref></ref-list>'
        '<index id="ix"><index-div><index-entry id="ie"><term>t</term></index-entry></index-div></index></back>'
    )
    # 目标 id → 唯一应接受它的 ref-type
    EXPECTED = {
        "s1": "sec", "s_sub": "sec", "rl": "sec", "ix": "sec",
        "a1": "app",
        "f1": "fig", "fg1": "fig",
        "t1": "table", "t2": "table",
        "df1": "disp-formula",
        "r1": "bibr",
        "bfn": "fn",
        "tfn1": "table-fn", "tfn_nested": "table-fn",   # xref 在表 1 的单元格里，同表
        "li1": "list", "l1": "list",
        "abb1": "abbreviation",
    }
    NOT_TARGETS = ("para", "mc1", "legend1", "tfn2", "note1", "ie")   # tfn2 是另一张表的脚注；mc1 是 mixed-citation

    def _accepting(self, tid, tree, xref):
        target = tree.getroot().xpath('//*[@id="%s"]' % tid)[0]
        return {rt for rt, (rule, _) in validate.XREF_TARGET_RULES.items() if rt not in ("other", "chem") and rule(xref, target)}

    def test_every_target_is_accepted_by_exactly_one_ref_type(self):
        tree = self._tree(self.DOC)
        xref = tree.getroot().xpath('//*[@id="x_in_t1"]')[0]
        for tid, expected in self.EXPECTED.items():
            with self.subTest(target=tid):
                self.assertEqual(self._accepting(tid, tree, xref), {expected})
        for tid in self.NOT_TARGETS:
            with self.subTest(not_a_target=tid):
                self.assertEqual(self._accepting(tid, tree, xref), set())

    def test_other_accepts_exactly_the_classifiable_targets(self):
        tree = self._tree(self.DOC)
        xref = tree.getroot().xpath('//*[@id="x_in_t1"]')[0]
        other = validate.XREF_TARGET_RULES["other"][0]
        for tid in self.EXPECTED:
            self.assertTrue(other(xref, tree.getroot().xpath('//*[@id="%s"]' % tid)[0]), tid)
        for tid in ("para", "mc1", "legend1"):
            self.assertFalse(other(xref, tree.getroot().xpath('//*[@id="%s"]' % tid)[0]), tid)
        self.assertNotIn("chem", validate.XREF_TARGET_RULES)  # chem 无类型语义，不限定目标

    def test_table_fn_must_stay_inside_its_own_table(self):
        tree = self._tree(self.DOC)
        xref = tree.getroot().xpath('//*[@id="x_in_t1"]')[0]
        rule = validate.XREF_TARGET_RULES["table-fn"][0]
        self.assertTrue(rule(xref, tree.getroot().xpath('//*[@id="tfn1"]')[0]))
        self.assertFalse(rule(xref, tree.getroot().xpath('//*[@id="tfn2"]')[0]))  # 另一张表
        self.assertFalse(rule(xref, tree.getroot().xpath('//*[@id="bfn"]')[0]))   # 正文脚注

    def _run(self, xref_html, validator=None):
        body = ('<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p>见%s。</p>'
                '<table-wrap id="tab_1"><label>表1</label><table><tbody><tr><td>c</td></tr></tbody></table>'
                '<table-wrap-foot><fn id="table-fn_1.1"><label>a</label><p>表脚注。</p></fn></table-wrap-foot></table-wrap>'
                '<p>正文脚注<fn id="fn_1"><label>1)</label><p>y</p></fn></p>'
                '<def-list list-content="abbreviation"><def-item id="abb-a"><term>A</term><def><p>a</p></def></def-item></def-list>'
                '<def-list><def-item id="legend-a"><term>x</term><def><p>式中</p></def></def-item></def-list></sec>') % xref_html
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(_doc(body=body, back='<back><ref-list content-type="bibl" id="rl"><ref id="r1"><label>[1]</label>'
                                                  '<mixed-citation id="mc1">x</mixed-citation></ref></ref-list></back>'), encoding="utf-8")
            return (validator or VALIDATOR_IMPORT).validate_file(path)

    def test_end_to_end_errors(self):
        bad = {
            "fn 指向表脚注": ('<xref ref-type="fn" rid="table-fn_1.1">a</xref>', "table-fn"),
            "table-fn 指向正文脚注": ('<xref ref-type="table-fn" rid="fn_1">1)</xref>', "表脚注"),
            "table-fn 在表外引用表脚注": ('<xref ref-type="table-fn" rid="table-fn_1.1">a</xref>', "同一 table-wrap"),
            "abbreviation 指向图例里的 def-item": ('<xref ref-type="abbreviation" rid="legend-a">x</xref>', "缩略语"),
            "bibr 指向 mixed-citation": ('<xref ref-type="bibr" rid="mc1">[1]</xref>', "参考文献条目 ref"),
            "other 指向无法归类的 mixed-citation": ('<xref ref-type="other" rid="mc1">x</xref>', "归类"),
        }
        for why, (xref, keyword) in bad.items():
            for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
                with self.subTest(why=why, profile=validator.profile):
                    rep = self._run(xref, validator)
                    v8 = [e for e in rep.errors if e["rule"] == "V-8"]
                    self.assertTrue(v8, validate.format_human(rep))
                    self.assertIn(keyword, v8[0]["message"])

    def test_end_to_end_accepted(self):
        ok = [
            '<xref ref-type="fn" rid="fn_1">1)</xref>',
            '<xref ref-type="abbreviation" rid="abb-a">A</xref>',
            '<xref ref-type="bibr" rid="r1">[1]</xref>',
            '<xref ref-type="chem" rid="legend-a">x</xref>',          # 无类型语义，不限定
            '<xref ref-type="other" rid="abb-a">A</xref>',            # 导入别名：目标可归类为缩略语
        ]
        for xref in ok:
            with self.subTest(xref=xref):
                rep = self._run(xref)
                self.assertEqual([e for e in rep.errors if e["rule"] == "V-8"], [], validate.format_human(rep))

    def test_table_footnote_in_a_paragraph_is_still_referenced_by_table_fn(self):
        # 旧实现假定表脚注一定是 table-wrap-foot 的直接子元素，嵌在 p 里的会被误判
        body = ('<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><table-wrap id="tab_1"><label>表1</label>'
                '<table><tbody><tr><td>c<xref ref-type="table-fn" rid="table-fn_1.1">a</xref></td></tr></tbody></table>'
                '<table-wrap-foot><p>说明<fn id="table-fn_1.1"><label>a</label><p>嵌在段落里的表脚注。</p></fn></p></table-wrap-foot></table-wrap></sec>')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(_doc(body=body), encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(path)
        self.assertEqual([e for e in rep.errors if e["rule"] == "V-8"], [], validate.format_human(rep))


class TestFootnotePairing(unittest.TestCase):
    """脚注的配对检查是双向的：xref 引用了不存在的脚注（V-1/V-8），或脚注没有被引用（W-FN-UNREFERENCED，C-T-55）。"""

    TABLE = ('<table-wrap id="tab_1"><label>表1</label><table><tbody><tr><td>c%s</td></tr></tbody></table>'
             '<table-wrap-foot>%s</table-wrap-foot></table-wrap>')

    def _run(self, inner, validator=None):
        body = '<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title>%s</sec>' % inner
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(_doc(body=body), encoding="utf-8")
            return (validator or VALIDATOR_IMPORT).validate_file(path)

    @staticmethod
    def _unref(rep):
        return [w for w in rep.warnings if w["rule"] == "W-FN-UNREFERENCED"]

    def test_unreferenced_body_footnote_warns(self):
        for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
            with self.subTest(profile=validator.profile):
                rep = self._run('<p>正文<fn id="fn_1"><label>1)</label><p>y</p></fn></p>', validator)
                found = self._unref(rep)
                self.assertEqual(len(found), 1, validate.format_human(rep))
                self.assertIn("正文脚注", found[0]["message"])
                self.assertIn("fn_1", found[0]["message"])
                self.assertEqual(rep.errors, [], "只是告警")

    def test_footnote_without_id_is_reported_by_position(self):
        rep = self._run('<p>正文<fn><label>1)</label><p>y</p></fn></p>')
        found = self._unref(rep)
        self.assertEqual(len(found), 1)
        self.assertIn("没有 id", found[0]["message"])
        self.assertTrue(found[0].get("line"))
        self.assertIn("/fn", found[0].get("path", ""))

    def test_block_level_footnote_is_rejected(self):
        # D-M-01（方案 A）：正文 fn 是行内元素；sec/app 的直接子元素 fn 在两个档位都是错误（RNG 与 REJECT 同时说明原因）
        for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
            with self.subTest(profile=validator.profile):
                rep = self._run('<p>x<xref ref-type="fn" rid="fn_9">1)</xref></p><fn id="fn_9"><p>块级脚注。</p></fn>', validator)
                self.assertFalse(rep.valid, validate.format_human(rep))
                self.assertIn("REJECT", _rules(rep))
                self.assertIn("块级正文脚注", _messages(rep))
                # 行内写法（紧随 xref 放在 p 内）是通过的
                ok = self._run('<p>x<xref ref-type="fn" rid="fn_9">1)</xref><fn id="fn_9"><p>行内脚注。</p></fn></p>', validator)
                self.assertEqual(ok.errors, [], validate.format_human(ok))

    def test_referenced_body_footnote_is_quiet(self):
        rep = self._run('<p>正文<xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><label>1)</label><p>y</p></fn></p>')
        self.assertEqual(self._unref(rep), [])

    def test_each_footnote_is_matched_separately(self):
        rep = self._run('<p>a<xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><p>y</p></fn><fn id="fn_2"><p>z</p></fn><fn id="fn_3"><p>w</p></fn></p>')
        self.assertEqual(sorted(w["message"].split("id=")[1].split(" ")[0] for w in self._unref(rep)), ["'fn_2'", "'fn_3'"])

    def test_unreferenced_table_footnote_warns(self):
        foot = '<fn id="table-fn_1.1"><label>a</label><p>表脚注。</p></fn>'
        rep = self._run(self.TABLE % ("", foot))
        found = self._unref(rep)
        self.assertEqual(len(found), 1, validate.format_human(rep))
        self.assertIn("表脚注", found[0]["message"])
        self.assertIn("table-fn", found[0]["message"])

    def test_table_footnote_nested_in_a_paragraph_is_a_table_footnote(self):
        rep = self._run(self.TABLE % ("", '<p>说明<fn id="table-fn_1.1"><p>嵌在段落里。</p></fn></p>'))
        found = self._unref(rep)
        self.assertEqual(len(found), 1)
        self.assertIn("表脚注", found[0]["message"])

    def test_table_footnote_referenced_from_cells_is_quiet_even_when_referenced_twice(self):
        ref = '<xref ref-type="table-fn" rid="table-fn_1.1">a</xref>'
        rep = self._run(self.TABLE % (ref + ref, '<fn id="table-fn_1.1"><label>a</label><p>表脚注。</p></fn>'))
        self.assertEqual(self._unref(rep), [])
        self.assertNotIn("W-FN-MULTIREF", {w["rule"] for w in rep.warnings})

    def test_footnote_referenced_with_the_wrong_ref_type_is_a_v8_error_not_an_unreferenced_warning(self):
        rep = self._run('<p>x<xref ref-type="table-fn" rid="fn_1">1)</xref><fn id="fn_1"><p>y</p></fn></p>')
        self.assertIn("V-8", _rules(rep))
        self.assertEqual(self._unref(rep), [])

    def test_the_other_direction_dangling_references_are_errors(self):
        rep = self._run('<p>x<xref ref-type="fn" rid="fn_404">1)</xref></p>')
        self.assertIn("V-1", _rules(rep))
        self.assertIn("悬空", _messages(rep))
        rep = self._run('<p>x<tbx:entailedTerm xmlns:tbx="urn:iso:std:iso:30042:ed-1" target="term_404">t</tbx:entailedTerm></p>')
        self.assertIn("V-1", _rules(rep))

    def test_no_sample_has_an_unreferenced_footnote(self):
        for path in sorted(VALID_DIR.glob("*.xml")):
            with self.subTest(sample=path.name):
                rep = VALIDATOR_IMPORT.validate_file(path)
                self.assertEqual(self._unref(rep), [])


class TestUrlValues(unittest.TestCase):
    """所有 URL/URI 取值统一走 url_value_problem：含控制字符（tab、换行、回车）一律拒绝；协议不分大小写，只接受 http/https/mailto/ftp。"""

    BAD = {
        "tab 打断协议": "java&#x9;script:alert(1)",
        "换行打断协议": "java&#x0A;script:alert(1)",
        "回车打断协议": "java&#x0D;script:alert(1)",
        "前导 tab": "&#x9;javascript:alert(1)",
        "尾随换行": "https://example.org/&#x0A;",
        "冒号前换行": "javascript&#x0A;:alert(1)",
        "前导空格": " javascript:alert(1)",
        "混合大小写": "JaVaScRiPt:alert(1)",
        "全大写": "JAVASCRIPT:alert(1)",
        "data": "data:text/html;base64,AAAA",
        "vbscript": "vbscript:msgbox(1)",
        "file": "file:///etc/passwd",
        "带控制字符的合法协议": "https://exa&#x9;mple.org/",
    }
    GOOD = {
        "https": "https://example.org/a?b=c#d",
        "大写 HTTP": "HTTP://EXAMPLE.ORG/",
        "mailto": "mailto:a@example.org",
        "ftp": "ftp://example.org/x",
        "相对路径": "../a/b.png",
        "资源名": "fig_1",
        "锚点": "#anchor",
        "协议相对": "//cdn.example.org/x",
        "前导空格的 https": " https://example.org/",
    }
    NS = ('xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML" '
          'xmlns:tbx="urn:iso:std:iso:30042:ed-1"')

    # 带 URL 的位置：(名称, 带 {V} 的片段, 应报的规则)
    POINTS = [
        ("ext-link/xlink:href", '<p><ext-link ext-link-type="uri" xlink:href="{V}">x</ext-link></p>', "V-11"),
        ("graphic/xlink:href", '<fig id="f"><caption><title>c</title></caption><graphic xlink:href="{V}"/></fig>', "V-11"),
        ("inline-graphic/xlink:href", '<p><inline-graphic xlink:href="{V}"/></p>', "V-11"),
        ("uri 的文本", '<p><uri xlink:type="simple">{V}</uri></p>', "V-11"),
        ("mml:math/href", '<p><inline-formula><mml:math id="m1" href="{V}"><mml:mi>x</mml:mi></mml:math></inline-formula></p>', "V-10"),
        ("mml:mi/xlink:href", '<p><inline-formula><mml:math id="m1"><mml:mi xlink:href="{V}">x</mml:mi></mml:math></inline-formula></p>', "V-10"),
        ("mml:math/altimg", '<p><inline-formula><mml:math id="m1" altimg="{V}"><mml:mi>x</mml:mi></mml:math></inline-formula></p>', "V-10"),
        ("mml:mi/src", '<p><inline-formula><mml:math id="m1"><mml:mi src="{V}">x</mml:mi></mml:math></inline-formula></p>', "V-10"),
    ]

    def _semantic(self, fragment):
        text = "<standard %s><body><sec id=\"s\"><label>1</label><title>t</title>%s</sec></body></standard>" % (self.NS, fragment)
        tree = validate.etree.ElementTree(validate.etree.fromstring(text.encode("utf-8"), validate.secure_parser()))
        rep = validate.Report("case.xml", "import")
        validate.semantic_checks(tree, rep)
        return rep

    def test_value_checker_table(self):
        for why, v in self.BAD.items():
            value = validate.etree.fromstring(("<a v=\"%s\"/>" % v).encode()).get("v")
            with self.subTest(bad=why):
                self.assertTrue(validate.url_value_problem(value), repr(value))
        for why, v in self.GOOD.items():
            value = validate.etree.fromstring(("<a v=\"%s\"/>" % v).encode()).get("v")
            with self.subTest(good=why):
                self.assertIsNone(validate.url_value_problem(value), repr(value))

    def test_every_url_bearing_position_uses_the_same_check(self):
        for point, tpl, rule in self.POINTS:
            for why, v in self.BAD.items():
                if point.startswith("uri") and why == "尾随换行":
                    continue  # 元素文本首尾的空白是排版缩进，不属于 URL
                with self.subTest(point=point, bad=why):
                    rep = self._semantic(tpl.replace("{V}", v))
                    self.assertIn(rule, {e["rule"] for e in rep.errors}, "%s: %s" % (point, why))
            for why, v in self.GOOD.items():
                with self.subTest(point=point, good=why):
                    rep = self._semantic(tpl.replace("{V}", v))
                    self.assertEqual([e for e in rep.errors if e["rule"] in ("V-10", "V-11")], [], "%s: %s" % (point, why))

    def test_control_characters_are_named_in_the_message(self):
        rep = self._semantic('<p><ext-link ext-link-type="uri" xlink:href="java&#x9;script:alert(1)">x</ext-link></p>')
        self.assertIn("U+0009", "\n".join(e["message"] for e in rep.errors if e["rule"] == "V-11"))
        rep = self._semantic('<p><ext-link ext-link-type="uri" xlink:href="a&#x0A;b">x</ext-link></p>')
        self.assertIn("U+000A", "\n".join(e["message"] for e in rep.errors if e["rule"] == "V-11"))

    def test_end_to_end_through_the_full_validator(self):
        for v in ("java&#x9;script:alert(1)", "java&#x0A;script:alert(1)", "&#x0D;javascript:alert(1)", " javascript:alert(1)", "JaVaScRiPt:alert(1)"):
            text = _doc(body='<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p><ext-link ext-link-type="uri" xlink:href="%s">x</ext-link></p></sec>' % v)
            for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
                with self.subTest(value=v, profile=validator.profile):
                    with tempfile.TemporaryDirectory() as tmp:
                        path = Path(tmp) / "case.xml"
                        path.write_text(text, encoding="utf-8")
                        rep = validator.validate_file(path)
                    self.assertFalse(rep.valid)
                    self.assertIn("V-11", _rules(rep))
                    self.assertTrue(rep.consistent)


class TestEncodingDetection(unittest.TestCase):
    """SYN-2：非 UTF-8 一律拒绝。声明里的 encoding 不论出现在多靠后的位置都能看到，解析器采用的编码兜底，BOM 单独检查。"""

    @staticmethod
    def _std():
        return _doc().split("?>", 1)[1].lstrip("\n")

    def _run(self, raw: bytes, validator=None):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_bytes(raw)
            return (validator or VALIDATOR_IMPORT).validate_file(path)

    @staticmethod
    def _syn2(rep):
        return [e for e in rep.errors if e["rule"] == "SYN-2"]

    def _with_decl(self, decl: str, encoding="utf-8") -> bytes:
        return (decl + "\n" + self._std()).encode(encoding)

    def test_encoding_pushed_far_into_the_declaration_is_still_seen(self):
        # 旧实现只看前 400 字节：401 个空格之后再写 encoding 就检查不到
        for pad in (0, 100, 399, 400, 401, 1000, 5000):
            decl = '<?xml version="1.0"%sencoding="ISO-8859-1"?>' % (" " * pad if pad else " ")
            with self.subTest(pad=pad):
                rep = self._run(self._with_decl(decl))
                found = self._syn2(rep)
                self.assertEqual(len(found), 1, validate.format_human(rep))
                self.assertIn("ISO-8859-1", found[0]["message"])
                self.assertFalse(rep.valid)

    def test_variants_of_the_declaration(self):
        cases = {
            "单引号": "<?xml version='1.0' encoding='GB2312'?>",
            "encoding 在 standalone 之后": '<?xml version="1.0" standalone="yes" encoding="ISO-8859-1"?>',
            "等号两侧有换行": '<?xml version="1.0" encoding\n=\n"ISO-8859-1"?>',
            "制表符分隔": '<?xml\tversion="1.0"\tencoding="GB18030"?>',
            "US-ASCII 也不接受": '<?xml version="1.0" encoding="US-ASCII"?>',
        }
        for why, decl in cases.items():
            with self.subTest(why=why):
                rep = self._run(self._with_decl(decl))
                self.assertEqual(len(self._syn2(rep)), 1, validate.format_human(rep))

    def test_utf8_spellings_are_accepted(self):
        for enc in ("UTF-8", "utf-8", "utf8", "UTF8", "Utf-8"):
            for pad in (1, 500):
                with self.subTest(encoding=enc, pad=pad):
                    rep = self._run(self._with_decl('<?xml version="1.0"%sencoding="%s"?>' % (" " * pad, enc)))
                    self.assertEqual(self._syn2(rep), [], validate.format_human(rep))
                    self.assertTrue(rep.valid, validate.format_human(rep))

    def test_no_declaration_means_utf8(self):
        rep = self._run(self._std().encode("utf-8"))
        self.assertEqual(self._syn2(rep), [])
        self.assertTrue(rep.valid, validate.format_human(rep))

    def test_utf8_bom_is_fine_other_boms_are_not(self):
        rep = self._run(b"\xef\xbb\xbf" + self._with_decl('<?xml version="1.0" encoding="UTF-8"?>'))
        self.assertEqual(self._syn2(rep), [])
        self.assertTrue(rep.valid, validate.format_human(rep))
        text = self._std()
        for name, raw in (("UTF-16 带 BOM、无声明", text.encode("utf-16")),
                          ("UTF-16BE 带 BOM", b"\xfe\xff" + text.encode("utf-16-be")),
                          ("UTF-32 带 BOM", text.encode("utf-32")),
                          ("UTF-32BE 带 BOM", b"\x00\x00\xfe\xff" + text.encode("utf-32-be"))):
            with self.subTest(name=name):
                rep = self._run(raw)
                self.assertTrue(self._syn2(rep), validate.format_human(rep))
                self.assertFalse(rep.valid)

    def test_parser_reported_encoding_is_the_fallback(self):
        # 不经过 check_syntax_raw，直接走解析：解析器认出非 UTF-8 编码就报 SYN-2
        raw = self._with_decl('<?xml version="1.0" encoding="ISO-8859-1"?>')
        rep = validate.Report("case.xml", "import")
        tree = validate.parse_secure(raw, rep)
        self.assertIsNotNone(tree)
        self.assertEqual(len(self._syn2(rep)), 1)
        self.assertIn("解析器报告", self._syn2(rep)[0]["message"])

    def test_a_non_utf8_declaration_is_reported_exactly_once(self):
        rep = self._run(self._with_decl('<?xml version="1.0" encoding="ISO-8859-1"?>'))
        self.assertEqual(len(self._syn2(rep)), 1)

    def test_declared_utf8_but_invalid_bytes_is_a_syntax_error(self):
        raw = self._with_decl('<?xml version="1.0" encoding="UTF-8"?>').replace("范围".encode("utf-8"), "范围".encode("gb2312"))
        rep = self._run(raw)
        self.assertIn("SYN-1", _rules(rep))
        self.assertFalse(rep.valid)

    def test_gb2312_declaration_with_gb2312_bytes(self):
        raw = self._with_decl('<?xml version="1.0" encoding="GB2312"?>', encoding="gb2312")
        rep = self._run(raw)
        self.assertEqual(len(self._syn2(rep)), 1, validate.format_human(rep))
        self.assertIn("GB2312", self._syn2(rep)[0]["message"])

    def test_both_profiles(self):
        raw = self._with_decl('<?xml version="1.0"' + " " * 450 + 'encoding="ISO-8859-1"?>')
        for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
            self.assertTrue(self._syn2(self._run(raw, validator)), validator.profile)


class TestMathmlIdAndDisplay(unittest.TestCase):
    """V-14 MML-ID / V-15 MML-DISPLAY：矩阵 export required（M-7.4-02、M-7.1-05、M-7.4-03），导出错误、导入告警。"""

    NS = ('xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML" '
          'xmlns:tbx="urn:iso:std:iso:30042:ed-1"')

    def _check(self, fragment, profile):
        text = "<standard %s><body><sec id=\"s\"><title>t</title>%s</sec></body></standard>" % (self.NS, fragment)
        tree = validate.etree.ElementTree(validate.etree.fromstring(text.encode("utf-8"), validate.secure_parser()))
        rep = validate.Report("case.xml", profile)
        validate.check_mml_math([e for e in tree.getroot().iter() if validate.is_element(e)], rep)
        return rep

    @staticmethod
    def _inline(attrs=""):
        return '<p><inline-formula><mml:math%s><mml:mi>x</mml:mi></mml:math></inline-formula></p>' % attrs

    @staticmethod
    def _disp(attrs=""):
        return '<disp-formula id="f"><label>(1)</label><mml:math%s><mml:mi>x</mml:mi></mml:math></disp-formula>' % attrs

    def _both(self, fragment):
        return self._check(fragment, "import"), self._check(fragment, "export")

    def test_correct_ids_and_display_are_clean(self):
        frag = self._inline(' id="mml_m1"') + self._disp(' display="block" id="mml_m2"') + self._inline(' id="mml_m3"') \
            + '<disp-formula-group><disp-formula id="g1"><mml:math display="block" id="mml_m4"><mml:mi>y</mml:mi></mml:math></disp-formula></disp-formula-group>'
        for rep in self._both(frag):
            self.assertEqual((rep.errors, rep.warnings), ([], []))

    def test_missing_or_malformed_id_is_an_error_on_export_and_a_warning_on_import(self):
        cases = {
            "缺 id": self._inline(),
            "示例的 m1 写法": self._inline(' id="m1"'),
            "前缀 mml_m 后不是数字": self._inline(' id="mml_mx"'),
            "mml_m0（不是正整数）": self._inline(' id="mml_m0"'),
            "前导零 mml_m01": self._inline(' id="mml_m01"'),
            "大小写不对 MML_M1": self._inline(' id="MML_M1"'),
        }
        for why, frag in cases.items():
            with self.subTest(why=why):
                imp, exp = self._both(frag)
                findings = imp.errors if why == "缺 id" else imp.warnings
                self.assertEqual([w["rule"] for w in findings], ["V-14"])
                self.assertIn("项目严格" if why == "缺 id" else "导入接受", findings[0]["message"])
                self.assertEqual(exp.warnings, [])
                self.assertEqual([e["rule"] for e in exp.errors], ["V-14"])
                self.assertIn("导出必须写 id", exp.errors[0]["message"])
                self.assertRegex(exp.errors[0]["message"], r"M-7\.4-02")

    def test_k_must_equal_the_occurrence_number_counting_inline_and_display_together(self):
        frag = self._inline(' id="mml_m1"') + self._disp(' display="block" id="mml_m1"')  # 第二个应为 mml_m2
        imp, exp = self._both(frag)
        self.assertEqual([e["rule"] for e in exp.errors], ["V-14"])
        self.assertIn("出现序号 2", exp.errors[0]["message"])
        self.assertEqual([w["rule"] for w in imp.warnings], ["V-14"])
        # 行间与行内合并计数：先行间后行内
        imp, exp = self._both(self._disp(' display="block" id="mml_m1"') + self._inline(' id="mml_m2"'))
        self.assertEqual((exp.errors, exp.warnings, imp.warnings), ([], [], []))

    def test_nested_mathml_math_is_not_counted(self):
        frag = ('<p><inline-formula><mml:math id="mml_m1"><mml:semantics><mml:mi>x</mml:mi>'
                '<mml:annotation-xml encoding="MathML-Content"><mml:math><mml:mi>x</mml:mi></mml:math></mml:annotation-xml></mml:semantics></mml:math></inline-formula></p>')
        for rep in self._both(frag):
            self.assertEqual((rep.errors, rep.warnings), ([], []))

    def test_display_follows_the_enclosing_formula_element(self):
        # 行间公式：export 必须 display="block"；缺省在导入时不告警（原文 7.1、7.3 的示例没有 display），反向值告警
        imp, exp = self._both(self._disp(' id="mml_m1"'))
        self.assertEqual((imp.errors, imp.warnings), ([], []))
        self.assertEqual([e["rule"] for e in exp.errors], ["V-15"])
        self.assertIn("缺少 display", exp.errors[0]["message"])
        imp, exp = self._both(self._disp(' display="inline" id="mml_m1"'))
        self.assertEqual([w["rule"] for w in imp.errors], ["V-15"])
        self.assertEqual([e["rule"] for e in exp.errors], ["V-15"])
        # 行内公式：export 不得带 display（block 或 inline 都不行）；导入告警
        for value in ("block", "inline"):
            imp, exp = self._both(self._inline(' display="%s" id="mml_m1"' % value))
            self.assertEqual([w["rule"] for w in imp.errors], ["V-15"], value)
            self.assertEqual([e["rule"] for e in exp.errors], ["V-15"], value)
            self.assertIn("inline-formula", exp.errors[0]["message"])

    def test_the_schema_still_accepts_both_values_in_both_contexts(self):
        # 这是语义规则而不是拆分 schema：导入必须接受第三方的反向值，所以结构层两个上下文都允许 block/inline
        for frag in (self._disp(' display="inline" id="mml_m1"'), self._inline(' display="block" id="mml_m1"'), self._inline(), self._disp()):
            text = _doc(body='<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title>%s</sec>' % frag)
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "case.xml"
                path.write_text(text, encoding="utf-8")
                rep = VALIDATOR_IMPORT.validate_file(path)
            self.assertFalse(rep.valid, validate.format_human(rep))
            self.assertTrue({"V-14", "V-15"} & _rules(rep))
            self.assertIs(rep.engines["lxml"]["valid"], True)
            self.assertIs(rep.engines["xmllint"]["valid"], True)

    def test_every_math_in_export_clean_samples_is_compliant(self):
        for path in sorted(VALID_DIR.glob("*.xml")):
            if path.name.startswith(EXPORT_CLEAN_PREFIXES):
                rep = VALIDATOR_EXPORT.validate_file(path)
                self.assertEqual([i for i in rep.errors + rep.warnings if i["rule"] in ("V-14", "V-15")], [], path.name)


class TestExportStrictRules(unittest.TestCase):
    """矩阵 export required 的部件：结构层放宽，导出档强制（V-16 外形、V-17 部件、V-18 p 不带 id），导入档宽容。"""

    NS = ('xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML" '
          'xmlns:tbx="urn:iso:std:iso:30042:ed-1"')

    def _parts(self, fragment, profile):
        text = "<standard %s><body><sec id=\"s\"><label>1</label><title>t</title>%s</sec></body></standard>" % (self.NS, fragment)
        tree = validate.etree.ElementTree(validate.etree.fromstring(text.encode("utf-8"), validate.secure_parser()))
        rep = validate.Report("case.xml", profile)
        validate.check_required_parts([e for e in tree.getroot().iter() if validate.is_element(e)], rep)
        return rep

    def _both(self, fragment):
        return self._parts(fragment, "import"), self._parts(fragment, "export")

    def _assert_strict(self, fragment, keyword, import_rule="V-17"):
        imp, exp = self._both(fragment)
        self.assertEqual(imp.errors, [], fragment)
        self.assertEqual([w["rule"] for w in imp.warnings], [import_rule] if import_rule else [], fragment)
        self.assertEqual(exp.warnings, [], fragment)
        self.assertEqual(len(exp.errors), 1, fragment)
        self.assertTrue(exp.errors[0]["rule"] in ("V-17", "V-18"), fragment)
        self.assertIn(keyword, exp.errors[0]["message"])
        self.assertRegex(exp.errors[0]["message"], r"M-[0-9A-Z.]+-\d+", "信息要写明矩阵行")

    def _assert_clean(self, fragment):
        for rep in self._both(fragment):
            self.assertEqual((rep.errors, rep.warnings), ([], []), fragment)

    TABLE = '<table-wrap id="t1">%s<caption>%s</caption><table><tbody><tr><td>c</td></tr></tbody></table>%s</table-wrap>'

    def test_labels_and_titles_are_required_on_export(self):
        cases = [
            ("条缺 label", '<sec id="s2"><title>u</title></sec>', "label"),
            ("无标题条缺 label", '<sec id="s2" sec-type="numbered-paragraph"><p>x</p></sec>', "label"),
            ("术语条缺 label", '<term-sec id="ts"><tbx:termEntry id="te"/></term-sec>', "label"),
            ("参考文献缺 label", '<ref-list id="rl" content-type="bibl"><title>参考文献</title><ref id="r"><mixed-citation>x</mixed-citation></ref></ref-list>', "label"),
            ("表缺 label", self.TABLE % ("", "<title>c</title>", ""), "label"),
            ("表缺题", self.TABLE % ("<label>表1</label>", "", ""), "caption/title"),
            ("图缺 label", '<fig id="f"><caption><title>c</title></caption><graphic xlink:href="a"/></fig>', "label"),
            ("图缺 graphic", '<fig id="f"><label>图1</label><caption><title>c</title></caption><p>x</p></fig>', "graphic"),
            ("表脚注缺 label", self.TABLE % ("<label>表1</label>", "<title>c</title>", '<table-wrap-foot><fn id="tf"><p>x</p></fn></table-wrap-foot>'), "label"),
            ("参考文献表缺 title", '<ref-list id="rl" content-type="bibl"><ref id="r"><label>[1]</label><mixed-citation>x</mixed-citation></ref></ref-list>', "title"),
            ("公式说明列表缺 list-content", '<disp-formula id="f"><label>(1)</label><mml:math/><legend><def-list><def-item><term>x</term><def><p>y</p></def></def-item></def-list></legend></disp-formula>', "list-content"),
        ]
        for why, frag, keyword in cases:
            with self.subTest(why=why):
                imp, exp = self._both(frag)
                findings = imp.errors if why in ("条缺 label", "无标题条缺 label", "表缺 label") else imp.warnings
                self.assertTrue([w for w in findings if w["rule"] == "V-17"], why)
                found = [e for e in exp.errors if e["rule"] == "V-17"]
                self.assertTrue(found, why)
                self.assertTrue(any(keyword in e["message"] for e in found), why)
                for e in found:
                    self.assertRegex(e["message"], r"M-[0-9A-Z.]+-\d+")

    def test_complete_parts_are_clean(self):
        self._assert_clean('<sec id="s2"><label>1.1</label><title>u</title></sec>')
        self._assert_clean('<sec id="s2" sec-type="numbered-paragraph"><label>1.2</label><p>x</p></sec>')
        self._assert_clean(self.TABLE % ("<label>表1</label>", "<title>c</title>", '<table-wrap-foot><fn id="tf"><label>a</label><p>x</p></fn></table-wrap-foot>'))
        self._assert_clean('<fig id="f"><label>图1</label><caption><title>c</title></caption><graphic xlink:href="a"/></fig>')
        self._assert_clean('<ref-list id="rl" content-type="bibl"><title>参考文献</title><ref id="r"><label>[1]</label><mixed-citation>x</mixed-citation></ref></ref-list>')
        self._assert_clean('<disp-formula id="f"><label>(1)</label><mml:math/><legend><def-list list-content="formula"><def-item><term>x</term><def><p>y</p></def></def-item></def-list></legend></disp-formula>')

    def test_app_needs_label_and_annex_type(self):
        full = '<app-group><app id="a" content-type="informative"><label>附录 A</label><annex-type>（资料性）</annex-type><title>t</title></app></app-group>'
        self._assert_clean(full)
        for why, frag, keyword in (("缺 label", full.replace("<label>附录 A</label>", ""), "label"),
                                    ("缺 annex-type", full.replace("<annex-type>（资料性）</annex-type>", ""), "annex-type")):
            with self.subTest(why=why):
                imp, exp = self._both(frag)
                findings = imp.errors if why == "缺 annex-type" else imp.warnings
                self.assertEqual([w["rule"] for w in findings], ["V-17"])
                self.assertIn(keyword, exp.errors[0]["message"])

    def test_untitled_sec_must_carry_numbered_paragraph_on_export_only(self):
        frag = '<sec id="s2"><label>1.1</label><p>无标题条</p></sec>'  # 4.4.2.1 的写法
        imp, exp = self._both(frag)
        self.assertEqual((imp.errors, imp.warnings), ([], []), "导入接受 4.4.2.1 的写法")
        self.assertEqual([e["rule"] for e in exp.errors], ["V-17"])
        self.assertIn("numbered-paragraph", exp.errors[0]["message"])

    def test_ordered_list_items_need_labels(self):
        for lt in ("arabic", "alpha-lower", "roman-lower"):
            frag = '<list list-type="%s"><list-item><p>x</p></list-item></list>' % lt
            imp, exp = self._both(frag)
            self.assertEqual([w["rule"] for w in imp.warnings], ["W-LIST-LABEL"], lt)
            self.assertEqual([e["rule"] for e in exp.errors], ["V-17"], lt)
            self.assertIn("M-5.7-09", exp.errors[0]["message"])
        self._assert_clean('<list list-type="arabic"><list-item><label>1)</label><p>x</p></list-item></list>')
        self._assert_clean('<list list-type="dash"><list-item><p>x</p></list-item></list>')

    def test_ext_link_type_and_named_content_values(self):
        ok = '<p><ext-link ext-link-type="uri" xlink:href="https://example.org/">x</ext-link></p>'
        self._assert_clean(ok)
        # 缺 ext-link-type：原文 10.1.9 示例就缺，导入不报告；导出必须写
        imp, exp = self._both(ok.replace(' ext-link-type="uri"', ""))
        self.assertEqual([e["rule"] for e in imp.errors], ["V-17"])
        self.assertEqual([e["rule"] for e in exp.errors], ["V-17"])
        # 取值不是 uri：导入告警 W-EXTLINK-TYPE，导出错误
        imp, exp = self._both(ok.replace('"uri"', '"doi"'))
        self.assertEqual([e["rule"] for e in imp.errors], ["V-17"])
        self.assertEqual([e["rule"] for e in exp.errors], ["V-17"])
        nc = '<p><named-content content-type="%s">x</named-content></p>'
        self._assert_clean(nc % "variable")
        imp, exp = self._both(nc % "foo")
        self.assertEqual([w["rule"] for w in imp.warnings], ["W-NAMED-CONTENT"])
        self.assertEqual([e["rule"] for e in exp.errors], ["V-17"])
        self.assertIn("M-5.5-01", exp.errors[0]["message"])

    def test_notes_and_examples_need_a_body(self):
        for tag in ("non-normative-note", "non-normative-example"):
            with self.subTest(tag=tag):
                imp, exp = self._both("<%s><label>注：</label></%s>" % (tag, tag))
                self.assertEqual([w["rule"] for w in imp.warnings], ["V-17"])
                self.assertEqual([e["rule"] for e in exp.errors], ["V-17"])
                self.assertIn("M-6.2.3-06", exp.errors[0]["message"])
                self._assert_clean("<%s><label>注：</label><p>x</p></%s>" % (tag, tag))
                self._assert_clean("<%s><p>x</p></%s>" % (tag, tag))

    def test_std_needs_std_ref_and_inside_a_ref_also_a_title(self):
        full = '<ref-list id="rl" content-type="norm-refs"><ref><std><std-ref>GB/T 1</std-ref>, <title>导则</title></std></ref></ref-list>'
        self._assert_clean(full)
        # 正文里提到标准：只要求 std-ref
        self._assert_clean("<p><std><std-ref>GB/T 1</std-ref></std></p>")
        for why, frag, keyword in (
                ("ref 里的 std 缺 title", full.replace(", <title>导则</title>", ""), "title"),
                ("ref 里的 std 缺 std-ref", full.replace("<std-ref>GB/T 1</std-ref>", ""), "std-ref"),
                ("正文里的 std 缺 std-ref", "<p><std>GB/T 1</std></p>", "std-ref")):
            with self.subTest(why=why):
                imp, exp = self._both(frag)
                self.assertEqual(imp.errors, [])
                self.assertTrue([w for w in imp.warnings if w["rule"] == "V-17"], why)
                self.assertTrue([e for e in exp.errors if e["rule"] == "V-17" and keyword in e["message"]], why)

    def test_p_must_not_carry_id(self):
        imp, exp = self._both('<p id="para_1">x</p>')
        self.assertEqual([e["rule"] for e in imp.errors], ["V-18"])
        self.assertEqual([e["rule"] for e in exp.errors], ["V-18"])
        self.assertIn("M-E-25", exp.errors[0]["message"])
        self._assert_clean("<p>x</p>")

    def test_front_sections_do_not_need_labels(self):
        text = ('<standard %s><front><sec sec-type="foreword"><title>前言</title><p>x</p></sec></front></standard>' % self.NS)
        tree = validate.etree.ElementTree(validate.etree.fromstring(text.encode("utf-8"), validate.secure_parser()))
        rep = validate.Report("case.xml", "export")
        validate.check_required_parts([e for e in tree.getroot().iter() if validate.is_element(e)], rep)
        self.assertEqual((rep.errors, rep.warnings), ([], []))

    def test_term_entry_needs_a_definition_on_export(self):
        frag = ('<sec id="s3" sec-type="terms"><label>3</label><title>术语</title><term-sec id="ts"><label>3.1</label>'
                '<tbx:termEntry id="te"><tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>a</tbx:term></tbx:tig></tbx:langSet></tbx:termEntry></term-sec></sec>')
        for validator, key in ((VALIDATOR_IMPORT, "warn"), (VALIDATOR_EXPORT, "error")):
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "case.xml"
                path.write_text(_doc(body=frag), encoding="utf-8")
                rep = validator.validate_file(path)
            if key == "warn":
                self.assertFalse(rep.valid, validate.format_human(rep))
                self.assertIn("V-9", _rules(rep))
            else:
                self.assertFalse(rep.valid)
                self.assertIn("V-9", _rules(rep))
                self.assertIn("M-9.2.2-01", _messages(rep))


class TestExportForm(unittest.TestCase):
    """V-16 EXPORT-FORM（仅导出档）：XML 声明、根上的命名空间声明、processing-meta。"""

    def _run(self, text, validator):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(text, encoding="utf-8")
            return validator.validate_file(path)

    @staticmethod
    def _v16(rep):
        return [e for e in rep.errors if e["rule"] == "V-16"]

    def test_complete_form_is_clean(self):
        rep = self._run(_doc(), VALIDATOR_EXPORT)
        self.assertEqual(self._v16(rep), [], validate.format_human(rep))

    def test_xml_declaration_is_required_on_export_only(self):
        text = _doc().split("?>", 1)[1].lstrip("\n")
        rep = self._run(text, VALIDATOR_EXPORT)
        self.assertEqual(len(self._v16(rep)), 1)
        self.assertIn("M-4.1-01", self._v16(rep)[0]["message"])
        rep = self._run(text, VALIDATOR_IMPORT)
        self.assertTrue(rep.valid, validate.format_human(rep))
        self.assertEqual([i for i in rep.errors + rep.warnings if i["rule"] == "V-16"], [])

    def test_declaration_must_say_version_1_0_and_utf8(self):
        body = _doc().split("?>", 1)[1]
        for why, decl in (("没有 encoding", '<?xml version="1.0"?>'), ("version 2.0", '<?xml version="2.0" encoding="UTF-8"?>')):
            with self.subTest(why=why):
                rep = self._run(decl + body, VALIDATOR_EXPORT)
                self.assertEqual(len(self._v16(rep)), 1, validate.format_human(rep))
        for ok in ('<?xml version="1.0" encoding="utf-8"?>', "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"):
            self.assertEqual(self._v16(self._run(ok + body, VALIDATOR_EXPORT)), [], ok)

    def test_root_must_declare_the_three_namespaces_on_export(self):
        for prefix in ("xlink", "mml", "tbx"):
            with self.subTest(prefix=prefix):
                text = _doc()
                uri = {"xlink": "http://www.w3.org/1999/xlink", "mml": "http://www.w3.org/1998/Math/MathML",
                       "tbx": "urn:iso:std:iso:30042:ed-1"}[prefix]
                text = text.replace('xmlns:%s="%s"' % (prefix, uri), "")
                rep = self._run(text, VALIDATOR_EXPORT)
                found = self._v16(rep)
                self.assertEqual(len(found), 1, validate.format_human(rep))
                self.assertIn("xmlns:" + prefix, found[0]["message"])
                imp = self._run(text, VALIDATOR_IMPORT)
                self.assertEqual([i for i in imp.errors + imp.warnings if i["rule"] == "V-16"], [])

    def test_processing_meta_is_required_on_export_only(self):
        rep = self._run(_doc(pm=""), VALIDATOR_EXPORT)
        found = self._v16(rep)
        self.assertEqual(len(found), 1, validate.format_human(rep))
        self.assertIn("M-4.3.2-30", found[0]["message"])
        rep = self._run(_doc(pm=""), VALIDATOR_IMPORT)
        self.assertTrue(rep.valid, validate.format_human(rep))


class TestWarnings(unittest.TestCase):
    """约定表写“告警后保留/忽略”的情形：文档通过，但给出对应告警（不阻断）。"""

    def _check(self, text: str, expected_warning: str):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "case.xml"
            p.write_text(text, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(p)
        self.assertEqual(rep.errors, [], validate.format_human(rep))
        self.assertIn(expected_warning, {w["rule"] for w in rep.warnings}, validate.format_human(rep))

    def test_warning_cases(self):
        sec = '<sec id="sec_1"><label>1</label><title>t</title>%s</sec>'
        cases = [
            ("W-NAMED-CONTENT", _doc(body=sec % '<p><named-content content-type="foo">x</named-content></p>')),
            ("W-GRAPHIC-TYPE", _doc(body=sec % '<fig><caption><title>c</title></caption><graphic xlink:href="a" content-type="photo"/></fig>')),
            ("W-SECTYPE", _doc(body=sec % '<sec id="sec_1_1" sec-type="custom-role"><label>1.1</label><title>u</title></sec>')),
            ("W-SIZE-T", _doc(body=sec % '<p><inline-graphic xlink:href="a" specific-use="size:T"/></p>')),
            ("W-LIST-LABEL", _doc(body=sec % '<list list-type="arabic"><list-item><p>x</p></list-item></list>')),
            ("W-ANNEX-TYPE", _doc(back='<back><app-group><app content-type="normative" id="sec_A"><annex-type>（资料性）</annex-type><title>t</title></app></app-group></back>')),
            ("W-DATE-ORDER", _doc(meta=_META + "<release-date>2026-11-01</release-date><implementation-date>2026-04-30</implementation-date>")),
            ("V-14", _doc(body=sec % '<p><inline-formula><mml:math id="m1"><mml:mi>a</mml:mi></mml:math></inline-formula></p>')),
        ]
        for rule, text in cases:
            with self.subTest(rule=rule):
                self._check(text, rule)
        multi = _doc(body=sec % '<p><xref ref-type="sec" rid="sec_1 sec_1">x</xref></p>')
        shared = _doc(body=sec % '<p><xref ref-type="fn" rid="fn_1">1</xref><fn id="fn_1"><p>x</p></fn><xref ref-type="fn" rid="fn_1">1</xref></p>')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(multi, encoding="utf-8")
            self.assertIn("W-RID-MULTI", _rules(VALIDATOR_IMPORT.validate_file(path)))
            path.write_text(shared, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(path)
            self.assertTrue(rep.valid, validate.format_human(rep))
            self.assertNotIn("W-FN-MULTIREF", {w["rule"] for w in rep.warnings})


class TestStsCompat(unittest.TestCase):
    """官方 NISO STS 1.2 DTD 兼容性检查（sts_compat.py）：正例没有未解释偏差，白名单逐条有依据并被样例覆盖。"""

    @classmethod
    def setUpClass(cls):
        cls.dtd = sts.DEFAULT_DTD
        cls.results = {p.name: sts.check_file(p) for p in sorted(VALID_DIR.glob("*.xml"))}

    def test_dtd_is_in_the_repo(self):
        self.assertTrue(self.dtd.is_file(), self.dtd)

    def test_valid_samples_have_no_unexplained_deviations(self):
        for name, res in self.results.items():
            with self.subTest(sample=name):
                self.assertTrue(res["wellformed"], res["note"])
                self.assertEqual(res["unexplained"], [], sts.format_human(res))

    def test_clean_samples_have_no_deviation_at_all(self):
        for name in ("01-minimal.xml", "03-structure.xml", "04-tables.xml", "05-formulas-figures.xml",
                     "06-terms-references.xml", "09-import-pending.xml"):
            self.assertEqual(self.results[name]["known"], [], name)
            self.assertEqual(self.results[name]["applied"], [], name)

    def test_every_whitelist_entry_is_exercised_and_documented(self):
        applied = {a["id"] for res in self.results.values() for a in res["applied"]}
        self.assertEqual(applied, {e["id"] for e in sts.WHITELIST})
        for e in sts.WHITELIST:
            self.assertIn(e["category"], (sts.EXT, sts.CONFLICT), e["id"])
            self.assertTrue(e["basis"].strip(), e["id"])
            self.assertIn("印刷页", e["basis"], "%s 的依据要写明原文页码" % e["id"])

    def test_no_pending_deviation_is_left(self):
        # D-M-01（WP8.M 设计评审，方案 A）已定案：正文 fn 是行内元素，块级 fn 不再作为“待决扩展”登记
        self.assertFalse(hasattr(sts, "PENDING"))
        self.assertNotIn("PENDING-block-fn", {e["id"] for e in sts.WHITELIST})
        self.assertFalse(any(e["category"] == "待决扩展" for e in sts.WHITELIST))

    def test_china_specific_extensions_cite_table_c1(self):
        by_id = {e["id"]: e for e in sts.WHITELIST}
        for eid in ("EXT-ccs", "EXT-implementation-date", "EXT-equivalence"):
            self.assertIn("中国标准特有", by_id[eid]["basis"], eid)
            self.assertIn("表 C.1", by_id[eid]["basis"], eid)

    def test_known_deviations_are_attributed_to_whitelist_entries(self):
        res = self.results["08-original-forms-vs-sts.xml"]
        self.assertGreaterEqual(len(res["known"]), 10)
        for k in res["known"]:
            self.assertTrue(k["whitelist"], k)

    def _check_text(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "case.xml"
            p.write_text(text, encoding="utf-8")
            return sts.check_file(p)

    def test_dtd_violation_that_is_not_a_known_extension_is_unexplained(self):
        # bold 内含 break：STS 1.2 不允许，原文也没有这样写（本 schema 同样拒绝，这里只验证 sts_compat 的分类）
        res = self._check_text(_doc(body='<sec id="sec_1"><title>t</title><p><bold>a<break/>b</bold></p></sec>'))
        self.assertTrue(res["unexplained"])
        self.assertIn("bold", {u["element"] for u in res["unexplained"]})

    def test_known_extension_alone_is_not_unexplained(self):
        res = self._check_text(_doc(meta=_META + "<ccs>L 72</ccs>"))
        self.assertEqual(res["unexplained"], [])
        self.assertTrue(res["known"])
        self.assertEqual({w for k in res["known"] for w in k["whitelist"]}, {"EXT-ccs"})

    def test_real_error_next_to_a_known_extension_is_still_unexplained(self):
        # ccs 是已知扩展，但 std-ident 出现两次违反 STS 1.2（std-ident?），且原文没有这样写
        res = self._check_text(_doc(meta=_META + "<std-ident/><std-ident/><ccs>L 72</ccs>"))
        self.assertTrue(res["known"])
        self.assertIn("std-meta", {u["element"] for u in res["unexplained"]})

    def test_std_meta_order_alone_is_a_known_conflict(self):
        # 4.1 示例的次序：ics、ccs 在 title-wrap 之前；ccs 是扩展，ics 的位置属于“原文示例与 STS 冲突”
        res = self._check_text(_doc(meta="<ics>33.040.40</ics><ccs>M 32</ccs>" + _META))
        self.assertEqual(res["unexplained"], [])
        self.assertEqual({w for k in res["known"] for w in k["whitelist"]}, {"EXT-ccs", "CONFLICT-std-meta-order"})
        by_id = {e["id"]: e for e in sts.WHITELIST}
        self.assertEqual(by_id["CONFLICT-std-meta-order"]["category"], sts.CONFLICT)
        self.assertIn("4.1", by_id["CONFLICT-std-meta-order"]["basis"])

    def test_std_meta_order_whitelist_does_not_hide_other_dtd_errors(self):
        # 次序不同 + 同时有 DTD 不允许的重复元素：重排后重复仍然报错
        res = self._check_text(_doc(meta="<ics>1.2</ics>" + _META + "<proj-id>a</proj-id><proj-id>b</proj-id>"))
        self.assertIn("std-meta", {u["element"] for u in res["unexplained"]})

    def test_unwrapped_deviations_report_original_line_numbers(self):
        res = self.results["08-original-forms-vs-sts.xml"]
        text = (VALID_DIR / "08-original-forms-vs-sts.xml").read_text(encoding="utf-8").splitlines()
        for k in res["known"]:
            if k["element"] == "ccs":
                self.assertIn("<ccs>", text[k["line"] - 1])

    def test_not_wellformed_is_reported(self):
        res = self._check_text("<standard>")
        self.assertFalse(res["wellformed"])

    def _run(self, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / "sts_compat.py")] + list(args),
                              capture_output=True, text=True, encoding="utf-8")

    def test_cli_exit_codes_and_json(self):
        ok = self._run("--json", str(VALID_DIR / "08-original-forms-vs-sts.xml"))
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        data = json.loads(ok.stdout)
        self.assertTrue(data["ok"])
        self.assertEqual(data["results"][0]["unexplained"], [])
        self.assertTrue(data["results"][0]["known"])
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.xml"
            bad.write_text(_doc(body='<sec id="sec_1"><title>t</title><p><bold>a<break/>b</bold></p></sec>'), encoding="utf-8")
            proc = self._run(str(bad))
            self.assertEqual(proc.returncode, 1)
            self.assertIn("未解释", proc.stdout)
            proc = self._run("--json", str(bad))
            self.assertFalse(json.loads(proc.stdout)["ok"])

    def test_list_whitelist(self):
        proc = self._run("--list-whitelist")
        self.assertEqual(proc.returncode, 0)
        for e in sts.WHITELIST:
            self.assertIn(e["id"], proc.stdout)


class TestSchemaCoverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.res = coverage.check(SCHEMA_DIR)

    def test_all_required_elements_are_defined(self):
        self.assertEqual(self.res["elements_uncovered"], {})
        self.assertEqual(self.res["elements_covered"], self.res["elements_expected"])

    def test_all_required_attributes_are_defined(self):
        self.assertEqual(self.res["attributes_uncovered"], [])
        self.assertEqual(self.res["attribute_values_uncovered"], [])

    def test_rejected_elements_are_not_in_schema(self):
        self.assertEqual(self.res["reject_elements_in_schema"], {})
        self.assertEqual(set(self.res["reject_elements"]), WHOLESALE_FORMAT_REJECTS)

    def test_reject_kind_is_filled_in_for_every_reject_row(self):
        self.assertEqual(self.res["reject_kind_problems"], [])
        self.assertEqual(len(self.res["reject_rows_format"]), 25)
        self.assertEqual(self.res["reject_rows_implementation"], [])

    def test_validate_py_knows_every_wholesale_rejected_element(self):
        known = {k for k in validate.REJECT_ELEMENTS}
        known |= validate._UNPREFIXED_MATHML
        for e in self.res["reject_elements"]:
            plain = e.split("}")[-1] if e.startswith("{") else e
            self.assertTrue(e in known or plain in known or e == "DOCTYPE", "validate.py 的 REJECT 规则缺少 %s" % e)

    def test_format_context_reject_rows_are_all_accounted_for(self):
        self.assertEqual(set(self.res["context_reject_rows"]), set(CONTEXT_REJECT_SAMPLES))

    def test_implementation_reject_rows_are_accepted_by_schema_and_warn(self):
        for row, (rule, sample) in IMPLEMENTATION_REJECT_ROWS.items():
            rep = VALIDATOR_IMPORT.validate_file(VALID_DIR / sample)
            self.assertTrue(rep.valid, (row, validate.format_human(rep)))
            self.assertNotIn(rule, {w["rule"] for w in rep.warnings}, row)

    def test_matrix_has_no_known_contradictions_any_more(self):
        rows = {}
        for f in coverage.MATRICES:
            for r in json.loads(Path(f).read_text(encoding="utf-8")):
                rows[r["id"]] = r
        self.assertEqual(len(rows), 391)
        for forbidden in ("issue-agencies", "col-group"):
            self.assertNotIn(forbidden, rows["M-C-05"]["element"])
        self.assertNotIn("std-doc-meta", rows["M-F-17"]["element"])
        self.assertEqual(rows["M-F-23"]["element"].split("（")[0], "permissions")
        self.assertEqual(rows["M-F-25"]["element"].split("（")[0], "std-ident")
        self.assertEqual((rows["M-6.2.1-04"]["export"], rows["M-6.2.1-04"]["import"]), ("optional", "accept"))
        self.assertEqual(rows["M-D-02"]["element"], "ref-list")
        self.assertEqual(rows["M-D-02"]["attributes"][0]["values"], ["bibl"])
        for rid in ("M-9.2.1-08", "M-9.2.1-09", "M-C.1-06", "M-C.1-07"):
            self.assertEqual((rows[rid]["import"], rows[rid]["rejectKind"]), ("reject", "format"), rid)
        self.assertEqual(rows["M-9.2.3-07"]["import"], "accept")   # 只保留 tbx:normativeAuthentication


class TestExportEnforcementAudit(unittest.TestCase):
    """矩阵 export required 的每一行都登记了“谁在 export 档强制它”，登记的强制者用探针真实验证。"""

    @classmethod
    def setUpClass(cls):
        cls.ee = _load("ses_export_enforcement_test", HERE / "export_enforcement.py")
        cls.rows = cls.ee.load_rows()
        cls.result = cls.ee.audit(cls.rows)

    def test_audit_passes(self):
        self.assertEqual(self.result["problems"], [])

    def test_unit_counts_match_the_matrix(self):
        req = [r for r in self.rows if r["export"] == "required"]
        attr_units = [(r["id"], a["name"]) for r in req for a in r.get("attributes", [])
                      if a["obligation"] in ("shall", "should") and a.get("values")]
        self.assertEqual(len(req), 228)
        self.assertEqual(len(attr_units), 61)
        self.assertEqual(len(self.result["units"]), len(req) + len(attr_units))

    def test_every_probe_really_ran_and_passed(self):
        self.assertGreaterEqual(len(self.result["probe_results"]), 100)
        self.assertTrue(all(ok for ok, _ in self.result["probe_results"].values()))

    def test_an_unregistered_export_required_row_fails_the_audit(self):
        from unittest import mock
        victim = "M-4.1-04"
        with mock.patch.dict(self.ee.ENTRIES):
            del self.ee.ENTRIES[victim]
            problems, _, _ = self.ee.registration_problems(self.rows)
        self.assertTrue(any("无人强制且未注明理由" in p and victim in p for p in problems), problems)

    def test_an_unregistered_attribute_unit_fails_the_audit(self):
        from unittest import mock
        victim = "M-5.7-01#list-type"
        with mock.patch.dict(self.ee.ATTR_ENTRIES):
            del self.ee.ATTR_ENTRIES[victim]
            problems, _, _ = self.ee.registration_problems(self.rows)
        self.assertTrue(any("无人强制且未注明理由" in p and victim in p for p in problems), problems)

    def test_a_new_export_required_row_in_the_matrix_must_be_registered(self):
        import copy
        rows = copy.deepcopy(self.rows)
        new = copy.deepcopy(next(r for r in rows if r["export"] == "required"))
        new["id"] = "M-ZZ-99"
        new["attributes"] = [{"name": "foo", "values": ["a", "b"], "obligation": "shall"}]
        rows.append(new)
        problems, _, _ = self.ee.registration_problems(rows)
        self.assertTrue(any("M-ZZ-99" in p for p in problems), problems)
        self.assertTrue(any("M-ZZ-99#foo" in p for p in problems), problems)

    def test_unknown_probe_or_na_reason_and_stale_entries_are_reported(self):
        from unittest import mock
        with mock.patch.dict(self.ee.ENTRIES):
            self.ee.ENTRIES["M-4.1-04"] = ["S-no-such-probe", "NA:no-such-reason"]
            self.ee.ENTRIES["M-NOT-IN-MATRIX"] = ["NA:content"]
            problems, _, _ = self.ee.registration_problems(self.rows)
        self.assertTrue(any("未知的探针" in p for p in problems))
        self.assertTrue(any("未知的不适用理由" in p for p in problems))
        self.assertTrue(any("M-NOT-IN-MATRIX" in p for p in problems))

    def test_a_probe_that_does_not_get_the_expected_failure_is_reported(self):
        from unittest import mock
        validators = self.ee.make_validators()
        # 把“删除 front”的预期改成要求规则 V-13：实际是 schema 拒绝，探针必须报告不符
        bad = dict(self.ee.PROBES["S-front"], expect=("rule", "V-13"))
        with mock.patch.dict(self.ee.PROBES, {"S-front": bad}):
            ok, msg = self.ee.run_probe("S-front", validators, {})
        self.assertFalse(ok)
        self.assertIn("V-13", msg)
        # 一个没有任何效果的改动（改回同一个取值）不应被当成“schema 拒绝”
        noop = dict(self.ee.PROBES["S-list-type-value"], op=("set_attr", "//list", "list-type", "arabic"))
        with mock.patch.dict(self.ee.PROBES, {"S-list-type-value": noop}):
            ok, msg = self.ee.run_probe("S-list-type-value", validators, {})
        self.assertFalse(ok)

    def test_import_behaviour_is_checked_too(self):
        from unittest import mock
        validators = self.ee.make_validators()
        # R-extlink-type 在 import 档不报告；若把预期改成 warn，探针必须失败
        wrong = dict(self.ee.PROBES["R-extlink-type"], imp="warn")
        with mock.patch.dict(self.ee.PROBES, {"R-extlink-type": wrong}):
            ok, msg = self.ee.run_probe("R-extlink-type", validators, {})
        self.assertFalse(ok)
        self.assertIn("import", msg)

    def test_every_rule_named_by_a_probe_exists_in_validate_py(self):
        source = (HERE / "validate.py").read_text(encoding="utf-8")
        for pid, pr in self.ee.PROBES.items():
            if pr["expect"][0] == "rule":
                self.assertIn('"%s"' % pr["expect"][1], source, "%s 引用的规则 %s 在 validate.py 里找不到" % (pid, pr["expect"][1]))

    def test_na_reasons_are_substantive(self):
        for key, text in self.ee.NA.items():
            self.assertGreater(len(text), 15, key)

    def test_readme_table_is_in_sync_with_the_generator(self):
        ok, why = coverage.readme_table_in_sync(self.ee.render_markdown(self.rows))
        self.assertTrue(ok, why)

    def test_matrix_coverage_cli_runs_the_audit_and_exits_zero(self):
        proc = subprocess.run([sys.executable, "-I", str(HERE / "matrix_coverage.py"), "--check-readme"],
                              capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("导出档强制核对", proc.stdout)

    def test_gaps_found_by_the_audit_are_enforced_by_new_rules(self):
        # 首次核对补上的规则都被探针引用（不是只在文档里声明）
        used = {pr["expect"][1] for pr in self.ee.PROBES.values() if pr["expect"][0] == "rule"}
        for rule in ("V-9", "V-13", "V-14", "V-15", "V-16", "V-17", "V-18"):
            self.assertIn(rule, used)


class TestWp83StrictImport(unittest.TestCase):
    def test_all_thirteen_historical_invalids_are_rejected_by_their_rule(self):
        for name, (rule, *_) in EXPORT_ONLY_INVALID.items():
            with self.subTest(name=name):
                rep = VALIDATOR_IMPORT.validate_file(INVALID_DIR / name)
                self.assertFalse(rep.valid, validate.format_human(rep))
                self.assertIn(rule, {e["rule"] for e in rep.errors})

    def test_definition_outside_langset_does_not_satisfy_term_entry(self):
        text = ('<standard xmlns:tbx="urn:iso:std:iso:30042:ed-1"><body>'
                '<sec id="s" sec-type="terms"><label>3</label><title>t</title><term-sec>'
                '<tbx:termEntry id="t"><tbx:definition>outside</tbx:definition>'
                '<tbx:langSet xml:lang="zh"><tbx:tig><tbx:term>x</tbx:term></tbx:tig></tbx:langSet>'
                '</tbx:termEntry></term-sec></sec></body></standard>')
        tree = validate.etree.ElementTree(validate.etree.fromstring(text.encode(), validate.secure_parser()))
        rep = validate.Report("case.xml", "import")
        validate.semantic_checks(tree, rep)
        self.assertIn("V-9", _rules(rep))

    def test_custom_xref_missing_type_is_reported_even_with_dangling_target(self):
        rep = TestCustomXref()._run(TestCustomXref._x("nowhere"), VALIDATOR_IMPORT)
        self.assertIn("V-8", {e["rule"] for e in rep.errors})

    def test_all_valid_samples_have_no_obsolete_implementation_warning(self):
        for path in sorted(VALID_DIR.glob("*.xml")):
            with self.subTest(name=path.name):
                rep = VALIDATOR_IMPORT.validate_file(path)
                self.assertTrue(rep.valid, validate.format_human(rep))
                self.assertFalse({"W-IMPL-REJECT", "W-FN-MULTIREF"} & {w["rule"] for w in rep.warnings})

    def test_mathml_prefix_is_selected_by_namespace_uri(self):
        text = (VALID_DIR / "05-formulas-figures.xml").read_text(encoding="utf-8")
        text = text.replace('xmlns:mml=', 'xmlns:maths=').replace('mml:', 'maths:')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(text, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(path)
        self.assertTrue(rep.valid, validate.format_human(rep))
        self.assertTrue(rep.consistent)

    def test_default_mathml_namespace_is_accepted(self):
        text = _doc(body='<sec id="s"><label>1</label><title>t</title><disp-formula><math xmlns="http://www.w3.org/1998/Math/MathML" id="arbitrary"><mi>x</mi></math></disp-formula></sec>')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(text, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(path)
        self.assertTrue(rep.valid, validate.format_human(rep))
        self.assertTrue(rep.consistent)

    def test_external_doctype_is_rejected_on_import(self):
        text = _doc().replace("?>", '?>\n<!DOCTYPE standard SYSTEM "http://127.0.0.1:9/x.dtd">', 1)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_text(text, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(path)
        self.assertIn("SYN-3", {e["rule"] for e in rep.errors})


class TestImportMathmlVersion(unittest.TestCase):
    """C-S-04：仅导入 2.0 可用 warning 接收；两个引擎仍核对其他结构。"""

    def _validate(self, source, validator):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "version.xml"
            path.write_text(source, encoding="utf-8")
            original = path.read_bytes()
            report = validator.validate_file(path)
            self.assertEqual(path.read_bytes(), original, "校验不得修改输入")
        return report

    def test_version_2_is_only_accepted_on_import_with_located_warning(self):
        source = (VALID_DIR / "01-minimal.xml").read_text(encoding="utf-8")
        source = source.replace('mathml-version="3.0"', 'mathml-version="2.0"')
        imp = self._validate(source, VALIDATOR_IMPORT)
        self.assertTrue(imp.valid, validate.format_human(imp))
        self.assertTrue(imp.consistent)
        self.assertIs(imp.engines["lxml"]["valid"], True)
        self.assertIs(imp.engines["xmllint"]["valid"], True)
        warning = [w for w in imp.warnings if w["rule"] == "V-6"]
        self.assertEqual(len(warning), 1, validate.format_human(imp))
        self.assertIn("2.0", warning[0]["message"])
        self.assertEqual(warning[0]["line"], 6)
        self.assertEqual(warning[0]["path"], "/standard/processing-meta")
        exp = self._validate(source, VALIDATOR_EXPORT)
        self.assertFalse(exp.valid, validate.format_human(exp))
        self.assertIn("V-6", _rules(exp))
        self.assertIs(exp.engines["lxml"]["valid"], False)
        self.assertIs(exp.engines["xmllint"]["valid"], False)

    def test_character_reference_in_version_is_accepted_without_changing_source(self):
        source = (VALID_DIR / "01-minimal.xml").read_text(encoding="utf-8").replace('mathml-version="3.0"', 'mathml-version="2&#x2e;0"')
        rep = self._validate(source, VALIDATOR_IMPORT)
        self.assertTrue(rep.valid, validate.format_human(rep))
        self.assertTrue(rep.consistent)
        self.assertTrue(any(w["rule"] == "V-6" and w.get("line") == 6 for w in rep.warnings))

    def test_external_doctype_is_still_rejected(self):
        source = (VALID_DIR / "01-minimal.xml").read_text(encoding="utf-8").replace('mathml-version="3.0"', 'mathml-version="2.0"')
        source = source.replace('?>', '?>\n<!DOCTYPE standard SYSTEM "http://127.0.0.1:9/forbidden.dtd">', 1)
        rep = self._validate(source, VALIDATOR_IMPORT)
        self.assertFalse(rep.valid, validate.format_human(rep))
        self.assertIn("SYN-3", _rules(rep))

    def test_explicit_custom_schema_is_not_rewritten(self):
        source = (VALID_DIR / "01-minimal.xml").read_text(encoding="utf-8").replace('mathml-version="3.0"', 'mathml-version="2.0"')
        with tempfile.TemporaryDirectory() as tmp:
            schema_dir = Path(tmp) / "schema"
            schema_dir.mkdir()
            for path in SCHEMA_DIR.glob("*.rng"):
                shutil.copyfile(path, schema_dir / path.name)
            custom = validate.Validator(schema_dir / SCHEMA.name, profile="import")
            rep = self._validate(source, custom)
            self.assertFalse(rep.valid, validate.format_human(rep))
            self.assertIs(rep.engines["lxml"]["valid"], False)
            self.assertIs(rep.engines["xmllint"]["valid"], False)
            self.assertTrue(rep.consistent)

    def test_overlay_failure_is_an_engine_error(self):
        from unittest import mock
        source = (VALID_DIR / "01-minimal.xml").read_text(encoding="utf-8").replace('mathml-version="3.0"', 'mathml-version="2.0"')
        with mock.patch.object(validate, "make_import_mathml2_schema", side_effect=OSError("fixture failure")):
            rep = self._validate(source, VALIDATOR_IMPORT)
        self.assertFalse(rep.valid)
        self.assertIn("ENGINE", _rules(rep))

    def test_other_version_is_rejected_in_both_profiles(self):
        source = (VALID_DIR / "01-minimal.xml").read_text(encoding="utf-8").replace('mathml-version="3.0"', 'mathml-version="2.1"')
        for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
            rep = self._validate(source, validator)
            self.assertFalse(rep.valid, validate.format_human(rep))
            self.assertIn("V-6", _rules(rep))
            self.assertIs(rep.engines["lxml"]["valid"], False)
            self.assertIs(rep.engines["xmllint"]["valid"], False)

    def test_other_invalid_attributes_are_not_normalized_away(self):
        source = (VALID_DIR / "01-minimal.xml").read_text(encoding="utf-8").replace('mathml-version="3.0"', 'mathml-version="2.0"').replace('table-model="xhtml"', 'table-model="wrong"')
        rep = self._validate(source, VALIDATOR_IMPORT)
        self.assertFalse(rep.valid, validate.format_human(rep))
        self.assertTrue(rep.consistent)
        self.assertIn("V-6", _rules(rep))
        self.assertIs(rep.engines["lxml"]["valid"], False)
        self.assertIs(rep.engines["xmllint"]["valid"], False)
        self.assertTrue(any(e.get("line") == 6 for e in rep.errors if e["rule"] == "RNG"), validate.format_human(rep))
        self.assertTrue(any(m.get("line") == 6 for m in rep.engines["xmllint"]["messages"]), validate.format_human(rep))


class TestHelpers(unittest.TestCase):
    def test_ncname(self):
        for ok in ("sec_5.1", "table-fn_1.1", "biblref_1", "mml_m3", "条款_1"):
            self.assertTrue(validate.NCNAME_RE.match(ok), ok)
        for bad in ("1abc", "a b", "a:b", "", "-x", "sec/5"):
            self.assertFalse(validate.NCNAME_RE.match(bad), bad)

    def test_legacy_id_patterns(self):
        hits = lambda v: any(rx.search(v) for rx, _ in validate._LEGACY_ID_V7)
        for bad in ("ext_1a2b", "Formula1", "Formula_1", "id-2a2aa2f4-554c-4359-c583-24cfce9ff7ab", "p-125"):
            self.assertTrue(hits(bad), bad)
        for ok in ("formula_1", "sec_5", "fig_1", "term_3.1.1", "mml_m1", "pre-p-1", "abb-adc"):
            self.assertFalse(hits(ok), ok)


class TestCommandLine(unittest.TestCase):
    def _run(self, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / "validate.py")] + list(args),
                              capture_output=True, text=True, encoding="utf-8")

    def test_exit_code_zero_and_human_output_for_valid_sample(self):
        proc = self._run(str(VALID_DIR / "01-minimal.xml"))
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("通过", proc.stdout)
        self.assertIn("一致", proc.stdout)

    def test_exit_code_one_for_invalid_sample(self):
        proc = self._run(str(INVALID_DIR / "dup-id.xml"))
        self.assertEqual(proc.returncode, 1)
        self.assertIn("[V-1]", proc.stdout)

    def test_json_output_shape(self):
        proc = self._run("--json", str(VALID_DIR / "01-minimal.xml"), str(INVALID_DIR / "tex-math.xml"))
        self.assertEqual(proc.returncode, 1)
        data = json.loads(proc.stdout)
        self.assertFalse(data["valid"])
        self.assertEqual(len(data["results"]), 2)
        ok, bad = data["results"]
        self.assertTrue(ok["valid"])
        self.assertFalse(bad["valid"])
        self.assertEqual(set(ok["engines"]), {"lxml", "xmllint"})
        self.assertTrue(ok["engines_consistent"])
        for key in ("file", "profile", "valid", "errors", "warnings", "engines"):
            self.assertIn(key, bad)
        self.assertTrue(all("rule" in e and "message" in e for e in bad["errors"]))

    def test_export_profile_flag(self):
        proc = self._run("--profile", "export", str(VALID_DIR / "07-import-variants.xml"))
        self.assertEqual(proc.returncode, 1)
        proc = self._run("--profile", "import", str(VALID_DIR / "07-import-variants.xml"))
        self.assertEqual(proc.returncode, 0)

    def test_missing_file_is_reported_not_crashed(self):
        proc = self._run(str(VALID_DIR / "no-such-file.xml"))
        self.assertEqual(proc.returncode, 1)
        self.assertIn("IO", proc.stdout)


class TestSecurity(unittest.TestCase):
    def test_external_entity_is_not_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            secret = Path(tmp) / "secret.txt"
            secret.write_text("TOP-SECRET-CONTENT-12345", encoding="utf-8")
            doc = Path(tmp) / "xxe.xml"
            doc.write_text(
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<!DOCTYPE standard [<!ENTITY xxe SYSTEM "file://%s">]>\n'
                "<standard><front><std-meta><title-wrap xml:lang=\"zh\"><full>&xxe;</full></title-wrap></std-meta></front>"
                "<body/></standard>\n" % secret, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(doc)
            self.assertFalse(rep.valid)
            blob = json.dumps(rep.to_dict(), ensure_ascii=False)
            self.assertNotIn("TOP-SECRET-CONTENT-12345", blob)
            self.assertIn("SYN-3", _rules(rep))

    def test_external_dtd_reference_is_not_loaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "dtd.xml"
            doc.write_text(
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<!DOCTYPE standard SYSTEM "http://127.0.0.1:9/NISO-STS-extended-1-mathml2.dtd">\n'
                "<standard><front><std-meta><title-wrap xml:lang=\"zh\"><full>t</full></title-wrap></std-meta></front>"
                '<body><sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p>x</p></sec></body></standard>\n',
                encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(doc)
            self.assertFalse(rep.valid, validate.format_human(rep))
            self.assertIn("SYN-3", {e["rule"] for e in rep.errors})
            rep_export = VALIDATOR_EXPORT.validate_file(doc)
            self.assertFalse(rep_export.valid)


class TestDoctypeDetection(unittest.TestCase):
    """SYN-3：DOCTYPE/实体声明按 XML 规则扫描序言判断，注释、CDATA、处理指令里的字样不算声明；真实声明仍被拒绝。"""

    DECL = '<?xml version="1.0" encoding="UTF-8"?>\n'

    @staticmethod
    def _std(extra_in_sec=""):
        body = '<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p>x</p>%s</sec>' % extra_in_sec
        return _doc(body=body).split("?>", 1)[1].lstrip("\n")

    def _run(self, prolog, validator, extra_in_sec="", encoding="utf-8", decl=None):
        text = (self.DECL if decl is None else decl) + prolog + self._std(extra_in_sec)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.xml"
            path.write_bytes(text.encode(encoding))
            return validator.validate_file(path)

    @staticmethod
    def _syn3(rep):
        return [i for i in rep.errors + rep.warnings if i["rule"] == "SYN-3"]

    def test_declarations_inside_comments_cdata_and_pis_are_not_reported(self):
        cases = {
            "序言注释里的 DOCTYPE 与 ENTITY": ('<!-- 不要写 <!DOCTYPE standard> 也不要 <!ENTITY x "y"> -->\n', ""),
            "序言处理指令里的 DOCTYPE": ('<?note <!DOCTYPE standard [ <!ENTITY x "y"> ]> ?>\n', ""),
            "正文注释里的 DOCTYPE 与 ENTITY": ("", '<!-- <!DOCTYPE standard [ <!ENTITY x "y"> ]> -->'),
            "正文 CDATA 里的 DOCTYPE 与 ENTITY": ("", '<p><![CDATA[<!DOCTYPE standard [<!ENTITY x "y">]>]]></p>'),
            "正文处理指令里的 DOCTYPE": ("", '<?note <!DOCTYPE standard> <!ENTITY x "y"> ?>'),
            "转义后的文本": ("", "<p>&lt;!DOCTYPE standard&gt; &lt;!ENTITY x 'y'&gt;</p>"),
            "大小写不同的注释内容": ('<!-- <!doctype standard> <!entity x "y"> -->\n', ""),
        }
        for why, (prolog, extra) in cases.items():
            for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
                with self.subTest(why=why, profile=validator.profile):
                    rep = self._run(prolog, validator, extra)
                    self.assertEqual(self._syn3(rep), [], validate.format_human(rep))
                    self.assertTrue(rep.consistent)
            rep = self._run(prolog, VALIDATOR_IMPORT, extra)
            self.assertTrue(rep.valid, why + "\n" + validate.format_human(rep))

    def test_real_internal_subset_is_rejected(self):
        cases = {
            "含实体声明": '<!DOCTYPE standard [<!ENTITY a "b">]>\n',
            "含元素声明": "<!DOCTYPE standard [<!ELEMENT standard ANY>]>\n",
            "空的内部子集": "<!DOCTYPE standard [ ]>\n",
            "前面有提到别的 DOCTYPE 的注释": '<!-- <!DOCTYPE other> -->\n<!DOCTYPE standard [ ]>\n',
            "内部子集里的注释含 ] 与 >": '<!DOCTYPE standard [ <!-- ] > --> <!ENTITY real "a]>b"> ]>\n',
            "外部子集加内部子集": '<!DOCTYPE standard SYSTEM "a.dtd" [<!ENTITY a "b">]>\n',
        }
        for why, prolog in cases.items():
            for validator in (VALIDATOR_IMPORT, VALIDATOR_EXPORT):
                with self.subTest(why=why, profile=validator.profile):
                    rep = self._run(prolog, validator)
                    errors = [e for e in rep.errors if e["rule"] == "SYN-3"]
                    self.assertTrue(errors, validate.format_human(rep))
                    self.assertIn("内部子集或实体声明", errors[0]["message"])
                    self.assertFalse(rep.valid)

    def test_entity_declaration_count_ignores_comments_and_literals(self):
        info = validate.scan_prolog_doctype(
            b'<!DOCTYPE s [ <!-- <!ENTITY fake "x"> ] --> <!ENTITY real "a]>b <!ENTITY inner 1>"> <!ENTITY two "2"> ]><s/>')
        self.assertEqual(info["entities"], 2)
        self.assertTrue(info["internal_subset"])

    def test_external_only_doctype_is_a_warning_on_import_and_an_error_on_export(self):
        cases = {
            "SYSTEM": '<!DOCTYPE standard SYSTEM "http://127.0.0.1:9/x.dtd">\n',
            "PUBLIC": '<!DOCTYPE standard PUBLIC "-//X//Y" "x.dtd">\n',
            "系统标识符里有方括号（旧的按字节搜索会误判为内部子集）": '<!DOCTYPE standard SYSTEM "a[b.dtd">\n',
            "前面有注释": '<!-- c -->\n<!DOCTYPE standard SYSTEM "x.dtd">\n',
        }
        for why, prolog in cases.items():
            with self.subTest(why=why):
                rep = self._run(prolog, VALIDATOR_IMPORT)
                self.assertFalse(rep.valid, validate.format_human(rep))
                self.assertEqual([i["rule"] for i in rep.errors if i["rule"] == "SYN-3"], ["SYN-3"])
                rep = self._run(prolog, VALIDATOR_EXPORT)
                self.assertFalse(rep.valid)
                self.assertEqual([e["rule"] for e in rep.errors], ["SYN-3"])
                self.assertIn("导出文件不得写 DOCTYPE", _messages(rep))

    def test_scanner_unit_cases(self):
        scan = validate.scan_prolog_doctype
        self.assertIsNone(scan(b"<standard/>"))
        self.assertIsNone(scan(b'<?xml version="1.0"?><!-- <!DOCTYPE a> --><standard/>'))
        self.assertIsNone(scan(b'<?xml version="1.0"?><standard><!-- <!DOCTYPE a> --></standard>'))
        self.assertIsNone(scan(b"<standard><![CDATA[<!DOCTYPE a>]]></standard>"))
        self.assertIsNone(scan(b"<!-- unclosed comment <!DOCTYPE a>"))
        self.assertIsNone(scan(b""))
        self.assertEqual(scan(b"\xef\xbb\xbf<!DOCTYPE a><a/>"), {"internal_subset": False, "entities": 0, "line": 1})
        self.assertEqual(scan(b"<?xml version='1.0'?>\n\n<!DOCTYPE a [ ]><a/>")["line"], 3)

    def test_doctype_in_a_utf16_file_is_still_reported(self):
        # 序言扫描只认 ASCII 兼容的编码；UTF-16 文件由解析器的 docinfo 兜底
        decl = '<?xml version="1.0" encoding="UTF-16"?>\n'
        text = decl + '<!DOCTYPE standard [<!ENTITY a "b">]>\n' + self._std()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "u16.xml"
            path.write_bytes(text.encode("utf-16"))
            rep = VALIDATOR_IMPORT.validate_file(path)
        self.assertFalse(rep.valid)
        self.assertIn("SYN-2", _rules(rep))
        self.assertTrue([e for e in rep.errors if e["rule"] == "SYN-3" and "实体声明" in e["message"]], validate.format_human(rep))

    def test_entities_are_still_never_expanded_or_loaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            secret = Path(tmp) / "secret.txt"
            secret.write_text("TOP-SECRET-CONTENT-67890", encoding="utf-8")
            # 注释里写着无害的 DOCTYPE，真实的 DOCTYPE 带外部实体：仍被拒绝，内容不外泄
            prolog = '<!-- <!DOCTYPE standard> -->\n<!DOCTYPE standard [<!ENTITY xxe SYSTEM "file://%s">]>\n' % secret
            text = self.DECL + prolog + self._std("<p>&xxe;</p>")
            doc = Path(tmp) / "xxe.xml"
            doc.write_text(text, encoding="utf-8")
            rep = VALIDATOR_IMPORT.validate_file(doc)
            self.assertFalse(rep.valid)
            self.assertNotIn("TOP-SECRET-CONTENT-67890", json.dumps(rep.to_dict(), ensure_ascii=False))
            self.assertIn("SYN-3", _rules(rep))


if __name__ == "__main__":
    unittest.main()
