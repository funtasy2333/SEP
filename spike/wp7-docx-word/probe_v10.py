# WP7.0 spike v10（2026-09-25，WP7.2 规格核对）：编号实例的计数语义、STYLEREF 缺值、字距、分节空段。
# 用法：python3 probe_v10.py <outdir>，再用 scripts/docx-check/word_pdf.py 逐个导出 PDF，
# 用 PyMuPDF 取文字核对。结论见 README.md「v10」各行与 docs/wp7-docx-delivery.md §4.3、§4.7。
import os, sys, zipfile
from xml.sax.saxutils import escape

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

W = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
     'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
SONG = '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
HEI = '<w:rFonts w:ascii="黑体" w:eastAsia="黑体" w:hAnsi="黑体" w:cs="黑体"/>'
SP = '　'
DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'


def sz(h): return f'<w:sz w:val="{h}"/><w:szCs w:val="{h}"/>'


def lvl(ilvl, fmt, text, *, suff='nothing', ind='<w:ind w:left="0" w:firstLine="0"/>', rpr=''):
    return (f'<w:lvl w:ilvl="{ilvl}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/>'
            f'<w:suff w:val="{suff}"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/>'
            f'<w:pPr>{ind}</w:pPr>' + (f'<w:rPr>{rpr}</w:rPr>' if rpr else '') + '</w:lvl>')


def abstract(aid, mtype, lvls):
    return f'<w:abstractNum w:abstractNumId="{aid}"><w:multiLevelType w:val="{mtype}"/>' + ''.join(lvls) + '</w:abstractNum>'


def num(nid, aid, overrides=()):
    """overrides：[(ilvl, start)]，每项写一个 lvlOverride/startOverride"""
    ov = ''.join(f'<w:lvlOverride w:ilvl="{i}"><w:startOverride w:val="{s}"/></w:lvlOverride>' for i, s in overrides)
    return f'<w:num w:numId="{nid}"><w:abstractNumId w:val="{aid}"/>{ov}</w:num>'


def numpr(nid, ilvl=0): return f'<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{nid}"/></w:numPr>'


def pstyle(sid, name, *, based='SesNormal', ppr='', rpr='', default=False):
    d = ' w:default="1"' if default else ''
    return (f'<w:style w:type="paragraph"{d} w:customStyle="1" w:styleId="{sid}"><w:name w:val="{name}"/>'
            + (f'<w:basedOn w:val="{based}"/>' if based else '') + '<w:qFormat/>'
            + f'<w:pPr>{ppr}</w:pPr>' + (f'<w:rPr>{rpr}</w:rPr>' if rpr else '') + '</w:style>')


def run(t, rpr=''):
    return f'<w:r>{"<w:rPr>" + rpr + "</w:rPr>" if rpr else ""}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>'


def P(style, runs='', extra=''):
    return f'<w:p><w:pPr><w:pStyle w:val="{style}"/>{extra}</w:pPr>{runs}</w:p>'


def fld(instr, cached):
    return (f'<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            f'<w:r><w:instrText xml:space="preserve"> {escape(instr)} </w:instrText></w:r>'
            f'<w:r><w:fldChar w:fldCharType="separate"/></w:r>{run(cached)}<w:r><w:fldChar w:fldCharType="end"/></w:r>')


def sect(refs=False, pg=''):
    r = ('<w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>' if refs else '')
    return (f'<w:sectPr>{r}<w:type w:val="nextPage"/><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1928" w:right="1134" w:bottom="1417" w:left="1417" w:header="1417" w:footer="1134" w:gutter="0"/>'
            f'{pg}<w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>')


BASE_STYLES = [
    pstyle('SesNormal', 'SES_正文基础', based=None, default=True, ppr='<w:widowControl/><w:jc w:val="both"/>', rpr=SONG + sz(21)),
    pstyle('SesPara', 'SES_段', ppr='<w:ind w:firstLine="420"/>'),
    pstyle('SesCoverStdNo', 'SES_封面文件编号', rpr=HEI + sz(28), ppr='<w:jc w:val="right"/>'),
    pstyle('SesHeader', 'SES_书眉', rpr=HEI + sz(21), ppr='<w:jc w:val="right"/>'),
]


def styles_xml(extra):
    return (DECL + f'<w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr>{SONG}<w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>'
            '<w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>' + ''.join(BASE_STYLES + extra) + '</w:styles>')


def write_docx(name, body, styles, numbering=None, header=None):
    doc = DECL + f'<w:document {W}><w:body>{body}</w:body></w:document>'
    rels = [f'<Relationship Id="rIdStyles" Type="{REL}styles" Target="styles.xml"/>',
            f'<Relationship Id="rIdSet" Type="{REL}settings" Target="settings.xml"/>']
    over = [f'<Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/>',
            f'<Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/>',
            f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/>']
    parts = {'word/document.xml': doc, 'word/styles.xml': styles,
             'word/settings.xml': DECL + f'<w:settings {W}><w:defaultTabStop w:val="420"/>'
             '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'}
    if numbering:
        parts['word/numbering.xml'] = numbering
        rels.append(f'<Relationship Id="rIdNum" Type="{REL}numbering" Target="numbering.xml"/>')
        over.append(f'<Override PartName="/word/numbering.xml" ContentType="{CT}numbering+xml"/>')
    if header:
        parts['word/header1.xml'], parts['word/footer1.xml'] = header
        rels.append(f'<Relationship Id="rIdH" Type="{REL}header" Target="header1.xml"/>')
        rels.append(f'<Relationship Id="rIdF" Type="{REL}footer" Target="footer1.xml"/>')
        over.append(f'<Override PartName="/word/header1.xml" ContentType="{CT}header+xml"/>')
        over.append(f'<Override PartName="/word/footer1.xml" ContentType="{CT}footer+xml"/>')
    parts['word/_rels/document.xml.rels'] = (DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                             + ''.join(rels) + '</Relationships>')
    ct = (DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>' + ''.join(over) + '</Types>')
    root = (DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{REL}officeDocument" Target="word/document.xml"/></Relationships>')
    path = os.path.join(OUT, name)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', root)
        for k, v in parts.items():
            z.writestr(k, v)
    print('written', path)


# ======================= numbering.docx：T1–T9 =======================
ABS = [
    abstract(1, 'multilevel', [lvl(0, 'decimal', '%1' + SP), lvl(1, 'decimal', '%1.%2' + SP), lvl(2, 'decimal', '%1.%2.%3' + SP)]),
    abstract(2, 'multilevel', [lvl(0, 'upperLetter', '附录%1', rpr=HEI + '<w:spacing w:val="210"/>'), lvl(1, 'decimal', '%1.%2' + SP)]),
    abstract(7, 'singleLevel', [lvl(0, 'none', '注：', ind='<w:ind w:left="780" w:hanging="360"/>', rpr=HEI)]),
    abstract(8, 'singleLevel', [lvl(0, 'decimal', '注%1：', ind='<w:ind w:left="870" w:hanging="450"/>', rpr=HEI)]),
    abstract(18, 'singleLevel', [lvl(0, 'decimal', '甲%1：', ind='<w:ind w:left="870" w:hanging="450"/>', rpr=HEI)]),
    abstract(11, 'multilevel', [lvl(0, 'bullet', '——', ind='<w:ind w:left="840" w:hanging="420"/>'),
                                lvl(1, 'bullet', '·', suff='tab', ind='<w:ind w:left="1260" w:hanging="420"/>')]),
    abstract(12, 'multilevel', [lvl(0, 'lowerLetter', '%1)', suff='tab', ind='<w:ind w:left="840" w:hanging="420"/>'),
                                lvl(1, 'decimal', '%2)', suff='tab', ind='<w:ind w:left="1260" w:hanging="420"/>')]),
    abstract(13, 'multilevel', [lvl(0, 'lowerLetter', '%1)', suff='tab', ind='<w:ind w:left="840" w:hanging="420"/>'),
                                lvl(1, 'decimal', '%2)', suff='tab', ind='<w:ind w:left="1260" w:hanging="420"/>')]),
]
NUMS = [
    num(1, 1), num(2, 2), num(7, 7), num(11, 11),
    num(101, 8, [(0, 1)]), num(102, 8, [(0, 1)]),        # T1：同一 abstractNum 两实例，均 startOverride，交错
    num(103, 18), num(104, 18),                          # T2：同一 abstractNum 两实例，都不写 override
    num(110, 12, [(0, 1)]),                              # T3：父列表与嵌套项共用实例
    num(111, 12, [(0, 1)]), num(112, 12, [(0, 1)]),      # T4：只在 L1 使用，override 只写 ilvl0
    num(113, 13, [(0, 1), (1, 1)]), num(114, 13, [(0, 1), (1, 1)]),  # T4b：override 写 ilvl0 与 ilvl1
    num(120, 12, [(0, 1)]), num(121, 12, [(0, 1)]),      # T5：两个列表实例交错
    num(122, 12, [(0, 1)]),                              # T8
]
NUMBERING = DECL + f'<w:numbering {W}>' + ''.join(ABS) + ''.join(NUMS) + '</w:numbering>'
N_STYLES = [
    pstyle('SesChapter', 'SES_章标题', ppr='<w:keepNext/>' + numpr(1, 0) + '<w:ind w:left="0" w:firstLine="0"/>', rpr=HEI),
    pstyle('SesClause1', 'SES_一级条标题', ppr='<w:keepNext/>' + numpr(1, 1) + '<w:ind w:left="0" w:firstLine="0"/>', rpr=HEI),
    pstyle('SesAppendix', 'SES_附录标识', ppr='<w:keepNext/>' + numpr(2, 0) + '<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/>', rpr=HEI),
    pstyle('SesNote', 'SES_注', ppr=numpr(7, 0), rpr=sz(18)),
    pstyle('SesNoteN', 'SES_注X', rpr=sz(18)),
    pstyle('SesTableNote', 'SES_表注', rpr=sz(18)),
    pstyle('SesListDash', 'SES_破折号列项', ppr=numpr(11, 0)),
    pstyle('SesListDot', 'SES_间隔号列项', ppr=numpr(11, 1)),
    pstyle('SesListItem', 'SES_编号列项'),
    pstyle('SesFrontTitle', 'SES_前言引言标题', ppr='<w:snapToGrid w:val="0"/><w:spacing w:before="500" w:after="600" w:line="400" w:lineRule="exact"/><w:jc w:val="center"/>', rpr=HEI + sz(32)),
]
b = []
b.append(P('SesFrontTitle', run('目', '<w:spacing w:val="640"/>') + run('次')))
b.append(P('SesFrontTitle', run('前' + SP + SP + '言')))
b.append(P('SesChapter', run('章一')))
b.append(P('SesNoteN', run('T1-X1'), numpr(101)))
b.append(P('SesNoteN', run('T1-Y1'), numpr(102)))
b.append(P('SesNoteN', run('T1-Y2'), numpr(102)))
b.append(P('SesNoteN', run('T1-X2'), numpr(101)))
b.append(P('SesNoteN', run('T1-Y3'), numpr(102)))
for n, t in [(103, 'T2-a'), (104, 'T2-b'), (103, 'T2-c')]:
    b.append(P('SesNoteN', run(t), numpr(n)))
for ilvl, t in [(0, 'T3 a'), (1, 'T3 a-1'), (1, 'T3 a-2'), (0, 'T3 b'), (1, 'T3 b-1')]:
    b.append(P('SesListItem', run(t), numpr(110, ilvl)))
for n, t in [(111, 'T4 111-一'), (111, 'T4 111-二'), (112, 'T4 112-一'), (112, 'T4 112-二')]:
    b.append(P('SesListItem', run(t), numpr(n, 1)))
for n, t in [(113, 'T4b 113-一'), (113, 'T4b 113-二'), (114, 'T4b 114-一'), (114, 'T4b 114-二')]:
    b.append(P('SesListItem', run(t), numpr(n, 1)))
for n, t in [(120, 'T5 120-一'), (120, 'T5 120-二'), (121, 'T5 121-一'), (120, 'T5 120-三'), (121, 'T5 121-二')]:
    b.append(P('SesListItem', run(t), numpr(n, 0)))
b.append(P('SesTableNote', run('T6 表注（段落级 numPr → 固定实例 7）'), numpr(7)))
b.append(P('SesNote', run('T6 对照：SesNote 自带编号')))
b.append(P('SesListDash', run('T7 破折号一')))
b.append(P('SesListDot', run('T7 间隔号一')))
b.append(P('SesListDash', run('T7 破折号二')))
b.append(P('SesListItem', run('T8 alpha 一'), numpr(122, 0)))
b.append(P('SesListDot', run('T8 dot 一')))
b.append(P('SesListItem', run('T8 alpha 二'), numpr(122, 0)))
b.append(P('SesClause1', run('条一')))
b.append(P('SesAppendix', '<w:r><w:br/></w:r>' + run('（规范性）') + '<w:r><w:br/></w:r>' + run('T9 附录标识字距 210')))
b.append(P('SesAppendix', '<w:r><w:br/></w:r>' + run('（资料性）') + '<w:r><w:br/></w:r>' + run('第二个附录')))
b.append(sect())
write_docx('numbering.docx', ''.join(b), styles_xml(N_STYLES), NUMBERING)

# ======================= resume.docx：续组新实例 startOverride=N =======================
R_NUMBERING = (DECL + f'<w:numbering {W}>'
               + abstract(8, 'singleLevel', [lvl(0, 'decimal', '注%1：', ind='<w:ind w:left="870" w:hanging="450"/>', rpr=HEI)])
               + num(201, 8, [(0, 1)]) + num(202, 8, [(0, 1)]) + num(203, 8, [(0, 2)]) + num(204, 8, [(0, 3)])
               + '</w:numbering>')
b = [P('SesNoteN', run(t), numpr(n)) for n, t in
     [(201, 'X1'), (202, 'Y1'), (202, 'Y2'), (203, 'X2（新实例 start=2）'), (204, 'Y3（新实例 start=3）')]]
b.append(sect())
write_docx('resume.docx', ''.join(b), styles_xml([pstyle('SesNoteN', 'SES_注X', rpr=sz(18))]), R_NUMBERING)

# ======================= styleref_*.docx：书眉 STYLEREF 的取值 =======================
HDR = (DECL + f'<w:hdr {W}>' + P('SesHeader', fld('STYLEREF "SES_封面文件编号" \\* MERGEFORMAT', 'CACHED-VALUE')) + '</w:hdr>',
       DECL + f'<w:ftr {W}>' + P('SesNormal', fld('PAGE', '9')) + '</w:ftr>')
for variant in ('text', 'empty', 'none'):
    b = []
    if variant == 'text':
        b.append(P('SesCoverStdNo', run('GB/T 99999—2026')))
    elif variant == 'empty':
        b.append(P('SesCoverStdNo'))
    b.append(P('SesNormal', run(f'封面（{variant}）')))
    b.append(f'<w:p><w:pPr>{sect()}</w:pPr></w:p>')
    b.append(P('SesPara', run('正文页：看书眉显示什么。')))
    b.append(sect(refs=True, pg='<w:pgNumType w:fmt="decimal" w:start="1"/>'))
    write_docx(f'styleref_{variant}.docx', ''.join(b), styles_xml([]), header=HDR)

# ======================= full{42,43,44}.docx：分节空段在版心排满时 =======================
for n in (42, 43, 44):
    b = [P('SesPara', run(f'第 {i + 1} 行')) for i in range(n)]
    b.append(f'<w:p><w:pPr>{sect()}</w:pPr></w:p>')   # 与 gen_spike.py 相同：无 pStyle 的分节空段
    b.append(P('SesPara', run('下一节首行')))
    b.append(sect())
    write_docx(f'full{n}.docx', ''.join(b), styles_xml([]))

# ======================= fmt.docx：字母、罗马编号的格式（过 26 之后） =======================
F_NUMBERING = (DECL + f'<w:numbering {W}>'
               + abstract(1, 'singleLevel', [lvl(0, 'upperLetter', '%1.')]) + abstract(2, 'singleLevel', [lvl(0, 'lowerLetter', '%1)')])
               + abstract(3, 'singleLevel', [lvl(0, 'lowerRoman', '%1)')]) + abstract(4, 'singleLevel', [lvl(0, 'upperRoman', '%1)')])
               + num(1, 1, [(0, 25)]) + num(2, 2, [(0, 25)]) + num(3, 3, [(0, 4)]) + num(4, 4, [(0, 14)])
               + '</w:numbering>')
b = [P('SesNormal', run(f'n{n}-{i}'), numpr(n)) for n, k in [(1, 5), (2, 5), (3, 6), (4, 1)] for i in range(k)]
b.append(sect())
write_docx('fmt.docx', ''.join(b), styles_xml([]), F_NUMBERING)
