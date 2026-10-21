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
    "nested-term-entry.xml": ("REJECT", {"REJECT", "RNG"}, "termEntry"),
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
    "ext-id.xml": ("V-7", {"V-7"}, "ext_"),
    "formula-id.xml": ("V-7", {"V-7"}, "Formula"),
    "uuid-id.xml": ("V-7", {"V-7"}, "uuid"),
    "p-number-id.xml": ("V-7", {"V-7"}, "p-"),
    # V-8～V-11
    "wrong-xref-type.xml": ("V-8", {"V-8"}, "ref-type=fig"),
    "term-two-definitions.xml": ("V-9", {"V-9"}, "有且仅有一个"),
    "mathml-onclick.xml": ("V-10", {"V-10"}, "onclick"),
    "js-ext-link.xml": ("V-11", {"V-11"}, "javascript"),
    # 仅 RELAX NG
    "mixed-cell-content.xml": ("RNG", {"RNG"}, "td"),
    "tbx-langset-no-lang.xml": ("RNG", {"RNG"}, "langSet"),
    "unknown-element.xml": ("RNG", {"RNG"}, "blink"),
    # 2026-10-21：术语异写元素名只保留 tbx:normativeAuthentication，其余四个疑为原文笔误，REJECT
    "tbx-term-entry-alias.xml": ("REJECT", {"REJECT", "RNG"}, "笔误"),
    "tbx-definition-alias.xml": ("REJECT", {"REJECT", "RNG"}, "Definition"),
    "tbx-normative-authorization-alias.xml": ("REJECT", {"REJECT", "RNG"}, "normative-Authorization"),
    "tbx-grammatical-number-alias.xml": ("REJECT", {"REJECT", "RNG"}, "grammatical-Number"),
    # 按 NISO STS 1.2 收紧后（2026-10-21）
    "std-meta-wrong-order.xml": ("RNG", {"RNG"}, "content-language"),
    "sec-block-after-subsec.xml": ("RNG", {"RNG"}, "sec"),
    "bad-part-of-speech.xml": ("RNG", {"RNG"}, "partOfSpeech"),
    "named-content-without-type.xml": ("RNG", {"RNG"}, "front"),
    "empty-table-wrap-foot.xml": ("RNG", {"RNG"}, "table-wrap-foot"),
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
    "alternatives", "col-group", "fn-group", "issue-agencies", "mtext", "std-doc-meta", "target", "term-display",
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
        self.assertEqual(files - set(EXPECTED_INVALID), set(), "有负例没有写预期")
        self.assertEqual(set(EXPECTED_INVALID) - files, set(), "预期里的负例文件不存在")

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
        self.assertEqual({w["rule"] for w in rep.warnings}, {"IMPORT-ONLY"})

    def test_export_profile_rejects_every_import_only_form(self):
        rep = VALIDATOR_EXPORT.validate_file(self.path)
        self.assertFalse(rep.valid)
        self.assertEqual(_rules(rep), {"IMPORT-ONLY"})
        text = _messages(rep)
        for token in ("norm_refs", "inform_annex", "bibr", "date-type",
                      "normativeAuthentication", "monospace", "other", "chem", "position", "center"):
            self.assertIn(token, text)


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


def _doc(meta=_META, body=_BODY, pm="", front_secs="", back=""):
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
            "std-meta 子元素顺序不符 STS 1.2（content-language 在 std-org-group 之前）": _doc(meta=_META + '<content-language>zh</content-language><std-org-group><std-org/></std-org-group>'),
            "std-xref 空元素": _doc(meta=_META + '<std-xref type="revises"/>'),
            "ics 在 comm-ref 之前": _doc(meta=_META + '<ics>1.2</ics><comm-ref>c</comm-ref>'),
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
            "未知 sec-type 取值（表 D.1 行 13）": _doc(body='<sec id="sec_1"><title>t</title><sec id="sec_1_1" sec-type="custom-role"><title>u</title></sec></sec>'),
            "std-meta 里没有 std-org-group 等 SES 必填项": _doc(),
            "单元格为空": _doc(body='<sec id="sec_1"><title>t</title><table-wrap><table><tbody><tr><td/></tr></tbody></table></table-wrap></sec>'),
            "表没有 caption（附录 E 的无标题表）": _doc(body='<sec id="sec_1"><title>t</title><table-wrap id="tab_r"><table><tbody><tr><td>a</td></tr></tbody></table></table-wrap></sec>'),
            "mml:math 内任意 MathML 元素与属性": _doc(body='<sec id="sec_1"><title>t</title><p><inline-formula><mml:math class="c" altimg="x.png"><mml:semantics><mml:mrow><mml:mi mathvariant="bold">x</mml:mi></mml:mrow><mml:annotation encoding="x">y</mml:annotation></mml:semantics></mml:math></inline-formula></p></sec>'),
            "xref 的 rid 含多个标识符": _doc(body='<sec id="sec_1"><title>t</title><p><xref ref-type="sec" rid="a b">x</xref></p></sec>'),
            "fn 作为行内元素与块": _doc(body='<sec id="sec_1"><title>t</title><p>x<fn id="f1"><label>1)</label><p>y</p></fn></p><fn id="f2"><p>z</p></fn></sec>'),
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
        sec = '<sec id="sec_1"><title>t</title>%s</sec>'
        cases = [
            ("W-NAMED-CONTENT", _doc(body=sec % '<p><named-content content-type="foo">x</named-content></p>')),
            ("W-GRAPHIC-TYPE", _doc(body=sec % '<fig><caption><title>c</title></caption><graphic xlink:href="a" content-type="photo"/></fig>')),
            ("W-EXTLINK-TYPE", _doc(body=sec % '<p><ext-link ext-link-type="doi" xlink:href="https://example.org/">x</ext-link></p>')),
            ("W-SECTYPE", _doc(body=sec % '<sec id="sec_1_1" sec-type="custom-role"><title>u</title></sec>')),
            ("W-SIZE-T", _doc(body=sec % '<p><inline-graphic xlink:href="a" specific-use="size:T"/></p>')),
            ("W-LIST-LABEL", _doc(body=sec % '<list list-type="arabic"><list-item><p>x</p></list-item></list>')),
            ("W-RID-MULTI", _doc(body=sec % '<p><xref ref-type="sec" rid="sec_1 sec_1">x</xref></p>')),
            ("W-FN-MULTIREF", _doc(body=sec % '<p><xref ref-type="fn" rid="fn_1">1</xref><xref ref-type="fn" rid="fn_1">1</xref></p><fn id="fn_1"><p>x</p></fn>')),
            ("W-ANNEX-TYPE", _doc(back='<back><app-group><app content-type="normative" id="sec_A"><annex-type>（资料性）</annex-type><title>t</title></app></app-group></back>')),
            ("W-DATE-ORDER", _doc(meta=_META + "<release-date>2026-11-01</release-date><implementation-date>2026-04-30</implementation-date>")),
            ("W-MML-ID", _doc(body=sec % '<p><inline-formula><mml:math id="m1"><mml:mi>a</mml:mi></mml:math></inline-formula></p>')),
        ]
        for rule, text in cases:
            with self.subTest(rule=rule):
                self._check(text, rule)


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
            self.assertIn(e["category"], (sts.EXT, sts.CONFLICT, sts.PENDING), e["id"])
            self.assertTrue(e["basis"].strip(), e["id"])
            self.assertTrue("印刷页" in e["basis"] or "D-T-10" in e["basis"], "%s 的依据要写明原文页码" % e["id"])

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
        # ccs 是已知扩展，但 std-ident 在 title-wrap 之前违反 STS 1.2 的顺序，且原文没有这样写
        res = self._check_text(_doc(meta="<std-ident/>" + _META + "<ccs>L 72</ccs>"))
        self.assertTrue(res["known"])
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
        self.assertEqual(len(self.res["reject_rows_format"]) + len(self.res["reject_rows_implementation"]), 30)
        self.assertEqual(set(self.res["reject_rows_implementation"]), set(IMPLEMENTATION_REJECT_ROWS))

    def test_validate_py_knows_every_wholesale_rejected_element(self):
        known = {k for k in validate.REJECT_ELEMENTS}
        known |= validate._UNPREFIXED_MATHML
        for e in self.res["reject_elements"]:
            plain = e.split("}")[-1] if e.startswith("{") else e
            self.assertTrue(e in known or plain in known, "validate.py 的 REJECT 规则缺少 %s" % e)

    def test_format_context_reject_rows_are_all_accounted_for(self):
        self.assertEqual(set(self.res["context_reject_rows"]), set(CONTEXT_REJECT_SAMPLES))

    def test_implementation_reject_rows_are_accepted_by_schema_and_warn(self):
        for row, (rule, sample) in IMPLEMENTATION_REJECT_ROWS.items():
            rep = VALIDATOR_IMPORT.validate_file(VALID_DIR / sample)
            self.assertTrue(rep.valid, (row, validate.format_human(rep)))
            self.assertIn(rule, {w["rule"] for w in rep.warnings}, row)

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
            self.assertTrue(rep.valid, validate.format_human(rep))
            self.assertIn("SYN-3", {w["rule"] for w in rep.warnings})
            rep_export = VALIDATOR_EXPORT.validate_file(doc)
            self.assertFalse(rep_export.valid)


if __name__ == "__main__":
    unittest.main()
