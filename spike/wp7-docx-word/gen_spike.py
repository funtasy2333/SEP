# WP7.0 spike：不依赖任何模板，从零拼一份 DOCX，验证编号/分节/书眉/页码/目次/公式/终结线机制。
import json, os, sys, zipfile
from xml.sax.saxutils import escape

OUT = sys.argv[1]
OMML = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'omml.json')))  # 由 omml2.js 生成
TOC_DIRTY = '--dirty' in sys.argv
LINK = '--link' in sys.argv

def tw(mm): return round(mm * 1440 / 25.4)          # 毫米 → twips
CH = 210                                              # 一个五号汉字宽（twips）
PAGE_W, PAGE_H = 11906, 16838
M_TOP, M_BOT, M_IN, M_OUT, M_HDR, M_FTR = tw(34), tw(25), tw(25), tw(20), tw(25), tw(20)
BODY_W = PAGE_W - M_IN - M_OUT                        # 版心宽 165mm

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' \
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' \
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'

SONG = '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
HEI = '<w:rFonts w:ascii="黑体" w:eastAsia="黑体" w:hAnsi="黑体" w:cs="黑体"/>'
def sz(half): return f'<w:sz w:val="{half}"/><w:szCs w:val="{half}"/>'

# ---------------- numbering ----------------
def lvl(ilvl, fmt, text, *, start=1, restart=None, pstyle=None, suff='nothing', ind='<w:ind w:left="0" w:firstLine="0"/>', rpr=''):
    return (f'<w:lvl w:ilvl="{ilvl}"><w:start w:val="{start}"/><w:numFmt w:val="{fmt}"/>'
            + (f'<w:lvlRestart w:val="{restart}"/>' if restart is not None else '')
            + (f'<w:pStyle w:val="{pstyle}"/>' if (pstyle and LINK) else '')
            + f'<w:suff w:val="{suff}"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/>'
            + f'<w:pPr>{ind}</w:pPr>' + (f'<w:rPr>{rpr}</w:rPr>' if rpr else '') + '</w:lvl>')

SP = '　'
chap_lvls = [lvl(0, 'decimal', '%1' + SP, pstyle='SesChapter')]
for i in range(1, 6):
    chap_lvls.append(lvl(i, 'decimal', '.'.join(f'%{k}' for k in range(1, i + 2)) + SP, pstyle=f'SesClause{i}'))
app_lvls = [lvl(0, 'upperLetter', '附录%1', pstyle='SesAppendix')]
for i in range(1, 6):
    app_lvls.append(lvl(i, 'decimal', '.'.join(f'%{k}' for k in range(1, i + 2)) + SP, pstyle=f'SesAppClause{i}'))
# v2：附录图/表改为每个附录一个编号实例（见 new_group 的 lvl 覆盖）
ABS = {
    1: ('multilevel', chap_lvls),
    2: ('multilevel', app_lvls),
    3: ('singleLevel', [lvl(0, 'decimal', '图%1' + SP, pstyle='SesFigCap')]),
    4: ('singleLevel', [lvl(0, 'decimal', '表%1' + SP, pstyle='SesTblCap')]),
    5: ('singleLevel', [lvl(0, 'none', '注：', ind=f'<w:ind w:left="{4*CH}" w:hanging="{2*CH}"/>', rpr=HEI)]),
    6: ('singleLevel', [lvl(0, 'decimal', '注%1：', ind=f'<w:ind w:left="{round(4.5*CH)}" w:hanging="{round(2.5*CH)}"/>', rpr=HEI)]),
    7: ('singleLevel', [lvl(0, 'none', '示例：', ind=f'<w:ind w:left="0" w:firstLine="{2*CH}"/>', rpr=HEI)]),
    8: ('singleLevel', [lvl(0, 'decimal', '示例%1：', ind=f'<w:ind w:left="0" w:firstLine="{2*CH}"/>', rpr=HEI)]),
    9: ('multilevel', [lvl(0, 'bullet', '——', suff='nothing', ind=f'<w:ind w:left="{4*CH}" w:hanging="{2*CH}"/>'),
                       lvl(1, 'bullet', '·', suff='tab', ind=f'<w:ind w:left="{6*CH}" w:hanging="{2*CH}"/>')]),
    10: ('multilevel', [lvl(0, 'lowerLetter', '%1)', suff='tab', ind=f'<w:ind w:left="{4*CH}" w:hanging="{2*CH}"/>'),
                        lvl(1, 'decimal', '%2)', suff='tab', ind=f'<w:ind w:left="{6*CH}" w:hanging="{2*CH}"/>')]),
    11: ('singleLevel', [lvl(0, 'decimal', '[%1]' + SP, ind=f'<w:ind w:left="0" w:firstLine="{2*CH}"/>')]),
    12: ('singleLevel', [lvl(0, 'decimal', '图%1' + SP)]),
    13: ('singleLevel', [lvl(0, 'decimal', '表%1' + SP)]),
}
NUMS = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 7: 7, 11: 11, 9: 9,
        16: 1, 17: 1, 18: 2}   # v3：无标题条(16)、术语编号(17)、附录无标题条(18) 各用独立实例，共享同一 abstractNum 的计数   # 固定实例 numId → abstractNumId
dyn = {}                                                    # 按组新建的实例：numId → abstractNumId（startOverride=1）
_next = [100]
def new_group(abs_id, lvl_xml=''):
    nid = _next[0]; _next[0] += 1; dyn[nid] = (abs_id, lvl_xml); return nid

def numbering_xml():
    parts = [f'<w:numbering {W}>']
    for aid, (mtype, lvls) in ABS.items():
        parts.append(f'<w:abstractNum w:abstractNumId="{aid}"><w:multiLevelType w:val="{mtype}"/>' + ''.join(lvls) + '</w:abstractNum>')
    for nid, aid in NUMS.items():
        parts.append(f'<w:num w:numId="{nid}"><w:abstractNumId w:val="{aid}"/></w:num>')
    for nid, (aid, lvl_xml) in dyn.items():
        parts.append(f'<w:num w:numId="{nid}"><w:abstractNumId w:val="{aid}"/>'
                     f'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>{lvl_xml}</w:lvlOverride></w:num>')
    parts.append('</w:numbering>')
    return ''.join(parts)

# ---------------- styles ----------------
def pstyle(sid, name, *, based='SesNormal', ppr='', rpr='', next_=None, outline=None):
    o = f'<w:outlineLvl w:val="{outline}"/>' if outline is not None else ''
    return (f'<w:style w:type="paragraph" w:customStyle="1" w:styleId="{sid}"><w:name w:val="{name}"/>'
            + (f'<w:basedOn w:val="{based}"/>' if based else '') + (f'<w:next w:val="{next_}"/>' if next_ else '')
            + '<w:qFormat/>' + f'<w:pPr>{ppr}{o}</w:pPr>' + (f'<w:rPr>{rpr}</w:rPr>' if rpr else '') + '</w:style>')

def numpr(num, ilvl=0): return f'<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num}"/></w:numPr>'
HALF = '<w:spacing w:beforeLines="50" w:before="156" w:afterLines="50" w:after="156"/>'
TOC_TABS = f'<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{BODY_W}"/></w:tabs>'
STYLES = [
    pstyle('SesNormal', 'SES_正文基础', based=None, ppr='<w:widowControl/><w:autoSpaceDE/><w:autoSpaceDN/><w:jc w:val="both"/>', rpr=SONG + sz(21)),
    pstyle('SesPara', 'SES_段', ppr=f'<w:ind w:firstLine="{2*CH}"/>'),
    pstyle('SesCoverStdNo', 'SES_封面文件编号', rpr=HEI + sz(28)),
    pstyle('SesTocTitle', 'SES_目次标题', ppr='<w:pageBreakBefore/><w:snapToGrid w:val="0"/><w:spacing w:before="500" w:after="600" w:line="400" w:lineRule="exact"/><w:jc w:val="center"/>', rpr=HEI + sz(32)),
    pstyle('SesFrontTitle', 'SES_前言引言标题', ppr='<w:snapToGrid w:val="0"/><w:spacing w:before="500" w:after="600" w:line="400" w:lineRule="exact"/><w:jc w:val="center"/>', rpr=HEI + sz(32), next_='SesPara', outline=0),
    pstyle('SesBodyTitle', 'SES_正文首页名称', ppr='<w:snapToGrid w:val="0"/><w:spacing w:before="500" w:after="600" w:line="400" w:lineRule="exact"/><w:jc w:val="center"/>', rpr=HEI + sz(32)),
    pstyle('SesChapter', 'SES_章标题', ppr='<w:keepNext/>' + numpr(1, 0) + '<w:spacing w:beforeLines="100" w:before="312" w:afterLines="100" w:after="312"/><w:ind w:left="0" w:firstLine="0"/>', rpr=HEI, next_='SesPara', outline=0),
]
for i in range(1, 6):
    STYLES.append(pstyle(f'SesClause{i}', f'SES_{i}级条标题', ppr='<w:keepNext/>' + numpr(1, i) + HALF + '<w:ind w:left="0" w:firstLine="0"/>', rpr=HEI, next_='SesPara', outline=i))
    STYLES.append(pstyle(f'SesNoTitle{i}', f'SES_{i}级无标题条', ppr='<w:ind w:left="0" w:firstLine="0"/>'))
    STYLES.append(pstyle(f'SesAppClause{i}', f'SES_附录{i}级条标题', ppr='<w:keepNext/>' + numpr(2, i) + HALF + '<w:ind w:left="0" w:firstLine="0"/>', rpr=HEI, next_='SesPara', outline=i))
    STYLES.append(pstyle(f'SesAppNoTitle{i}', f'SES_附录{i}级无标题条', ppr='<w:ind w:left="0" w:firstLine="0"/>'))
STYLES += [
    pstyle('SesTermNum', 'SES_术语条目编号', ppr='<w:keepNext/>' + '<w:ind w:left="0" w:firstLine="0"/>', rpr=HEI),
    pstyle('SesTermHead', 'SES_术语', ppr='<w:keepNext/><w:ind w:left="0" w:firstLine="0"/>', rpr=HEI),
    pstyle('SesAppendix', 'SES_附录标识', ppr='<w:keepNext/>' + numpr(2, 0) + '<w:spacing w:before="520" w:after="283"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/>', rpr=HEI, next_='SesPara', outline=0),
    pstyle('SesFigCap', 'SES_图题', ppr=numpr(3, 0) + HALF + '<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/>', rpr=HEI),
    pstyle('SesTblCap', 'SES_表题', ppr='<w:keepNext/>' + numpr(4, 0) + HALF + '<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/>', rpr=HEI),
    pstyle('SesAppFigCap', 'SES_附录图题', ppr=HALF + '<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/>', rpr=HEI),
    pstyle('SesAppTblCap', 'SES_附录表题', ppr='<w:keepNext/>' + HALF + '<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/>', rpr=HEI),
    pstyle('SesNote', 'SES_注', ppr=numpr(5, 0), rpr=sz(18)),
    pstyle('SesNoteN', 'SES_注X', ppr='', rpr=sz(18)),
    pstyle('SesExLabel', 'SES_示例标识', ppr='<w:keepNext/>' + numpr(7, 0), rpr=sz(18)),
    pstyle('SesExText', 'SES_示例内容', ppr=f'<w:ind w:firstLine="{2*CH}"/>', rpr=sz(18)),
    pstyle('SesListDash', 'SES_破折号列项', ppr=numpr(9, 0)),
    pstyle('SesListAlpha', 'SES_字母编号列项', ppr=''),
    pstyle('SesBibTitle', 'SES_参考文献标题', ppr='<w:keepNext/><w:spacing w:before="520" w:after="283"/><w:jc w:val="center"/>', rpr=HEI, outline=0),
    pstyle('SesBibEntry', 'SES_参考文献条目', ppr=numpr(11, 0)),
    pstyle('SesFormula', 'SES_公式', ppr=f'<w:tabs><w:tab w:val="center" w:pos="{BODY_W//2}"/><w:tab w:val="right" w:leader="dot" w:pos="{BODY_W}"/></w:tabs><w:spacing w:beforeLines="50" w:before="156" w:afterLines="50" w:after="156"/><w:ind w:left="0" w:firstLine="0"/>'),
    pstyle('SesTableText', 'SES_表格文字', ppr='<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/>', rpr=sz(18)),
    pstyle('SesEndMark', 'SES_终结线', ppr=f'<w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:before="312"/><w:ind w:left="{(BODY_W - round(BODY_W/4))//2}" w:right="{(BODY_W - round(BODY_W/4))//2}"/>', rpr=sz(8)),
    pstyle('SesHeader', 'SES_书眉', ppr='', rpr=HEI + sz(21)),
    pstyle('SesFooter', 'SES_页码', ppr='', rpr=SONG + sz(18)),
    pstyle('TOC1', 'toc 1', ppr=TOC_TABS + '<w:spacing w:beforeLines="25" w:before="78" w:afterLines="25" w:after="78"/><w:ind w:left="0" w:firstLine="0"/>'),
    pstyle('TOC2', 'toc 2', ppr=TOC_TABS + f'<w:ind w:left="{CH}" w:firstLine="0"/>'),
]

def styles_xml():
    return (f'<w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr>{SONG}<w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>'
            '<w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>' + ''.join(STYLES) + '</w:styles>')

# ---------------- 文档内容 ----------------
body = []
def run(t, rpr=''): return f'<w:r>{"<w:rPr>"+rpr+"</w:rPr>" if rpr else ""}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>'
def P(style, text='', runs=None, ppr_extra=''):
    body.append(f'<w:p><w:pPr><w:pStyle w:val="{style}"/>{ppr_extra}</w:pPr>{runs if runs is not None else (run(text) if text else "")}</w:p>')
DIRTY_ATTR = ' w:dirty="true"' if TOC_DIRTY else ''
def fld(instr, cached): return (f'<w:r><w:fldChar w:fldCharType="begin"{DIRTY_ATTR}/></w:r>'
                                f'<w:r><w:instrText xml:space="preserve"> {escape(instr)} </w:instrText></w:r>'
                                f'<w:r><w:fldChar w:fldCharType="separate"/></w:r>{cached}<w:r><w:fldChar w:fldCharType="end"/></w:r>')
def sect(kind, *, pgfmt=None, hdr=True, restart=True):
    refs = ('<w:headerReference w:type="default" r:id="rIdHo"/><w:headerReference w:type="even" r:id="rIdHe"/>'
            '<w:footerReference w:type="default" r:id="rIdFo"/><w:footerReference w:type="even" r:id="rIdFe"/>') if hdr else ''
    pg = (f'<w:pgNumType w:fmt="{pgfmt}" w:start="1"/>' if restart else f'<w:pgNumType w:fmt="{pgfmt}"/>') if pgfmt else ''
    return (f'<w:sectPr>{refs}<w:type w:val="{kind}"/><w:pgSz w:w="{PAGE_W}" w:h="{PAGE_H}"/>'
            f'<w:pgMar w:top="{M_TOP}" w:right="{M_OUT}" w:bottom="{M_BOT}" w:left="{M_IN}" w:header="{M_HDR}" w:footer="{M_FTR}" w:gutter="0"/>'
            f'{pg}<w:cols w:space="425"/><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>')
def end_section(xml):
    body.append(f'<w:p><w:pPr>{xml}</w:pPr></w:p>')
# 关键：sectPr 写在「一节的末尾」，描述的是它所结束的那一节（含该节如何起页、页码是否重起）。
_cur = [None]
def start_section(kind, pgfmt=None, restart=True, hdr=True):
    if _cur[0] is not None: end_section(sect(**_cur[0]))
    _cur[0] = dict(kind=kind, pgfmt=pgfmt, restart=restart, hdr=hdr)
def pagebreak(fmt='decimal'):
    # v9：另起一面的要素各起一节（nextPage），页码格式沿用、不重新起编
    start_section('nextPage', pgfmt=fmt, restart=False)
def numbered(style, num, text, ilvl=0):
    P(style, runs=run(text), ppr_extra=numpr(num, ilvl))

# 封面节（spike 只放标准号段落，供书眉 STYLEREF 取值）
start_section('nextPage', hdr=False)
P('SesNormal', '【封面：spike 省略，下一段是封面文件编号】')
P('SesCoverStdNo', 'GB/T 12345—2026')
# 前置节：目次、前言（罗马页码）
start_section('oddPage', pgfmt='upperRoman', restart=True)
P('SesTocTitle', '目' + SP + SP + '次')
toc_cached = run('（目次域尚未更新：请在 Word 中更新域）')
body.append(f'<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>{fld("TOC " + chr(92) + "o " + chr(34) + "1-2" + chr(34) + " " + chr(92) + "h " + chr(92) + "z " + chr(92) + "u", toc_cached)}</w:p>')
pagebreak('upperRoman'); P('SesFrontTitle', '前' + SP + SP + '言')
P('SesPara', '本文件按照 GB/T 1.1—2020《标准化工作导则 第1部分：标准化文件的结构和起草规则》的规定起草。')
P('SesPara', '（前言正文，用于占满一定篇幅，便于观察罗马页码。）')
# 正文节（阿拉伯页码从 1 起）
start_section('oddPage', pgfmt='decimal', restart=True)
P('SesBodyTitle', '信息技术' + SP + '标准编写系统' + SP + '技术要求')
P('SesChapter', '范围'); P('SesPara', '本文件规定了标准编写系统的技术要求。')
P('SesChapter', '规范性引用文件'); P('SesPara', '本文件没有规范性引用文件。')
P('SesChapter', '术语和定义'); P('SesPara', '下列术语和定义适用于本文件。')
numbered('SesTermNum', 1, '', 1); P('SesTermHead', runs=run('标准编写系统') + run(SP + 'standard authoring system'))
P('SesPara', '用于编写标准化文件的计算机软件系统。')
numbered('SesTermNum', 1, '', 1); P('SesTermHead', runs=run('中间表示') + run(SP + 'intermediate representation'))
P('SesPara', '独立于输出格式的文档语义结构。')
P('SesChapter', '技术要求')
P('SesClause1', '总体要求'); P('SesPara', '有标题条 4.1 的条文。')
numbered('SesNoTitle1', 1, '无标题条应接续编号为 4.2。', 1)
P('SesClause1', '导出要求'); P('SesPara', '有标题条应编号为 4.3。')
P('SesClause2', '格式'); P('SesPara', '二级有标题条 4.3.1。')
numbered('SesNoTitle2', 1, '二级无标题条应编号为 4.3.2。', 2)
g = new_group(10)
for t in ['字母列项甲；', '字母列项乙；', '字母列项丙。']: numbered('SesListAlpha', g, t)
for t in ['破折号列项一；', '破折号列项二。']: P('SesListDash', t)
g = new_group(10)
for t in ['第二个字母列表应从 a) 重新开始；', '第二项。']: numbered('SesListAlpha', g, t)
P('SesNote', '单条注，标识应为「注：」，回行应与注内容左对齐，这里多写一些文字用来观察回行的对齐位置是否正确。')
g = new_group(6)
numbered('SesNoteN', g, '多条注的第一条，标识应为「注1：」。')
numbered('SesNoteN', g, '多条注的第二条，标识应为「注2：」，这里多写一些文字用来观察回行的对齐位置是否正确。')
P('SesExLabel'); P('SesExText', '示例内容另起一行，空两个汉字起排，回行顶格。这里多写一些文字用来观察回行位置。')
P('SesFigCap', '正文图应为图1')
P('SesTblCap', '正文表应为表1')
body.append('<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/><w:tblBorders>'
            + ''.join(f'<w:{e} w:val="single" w:sz="{12 if e in ("top","left","bottom","right") else 4}" w:space="0" w:color="000000"/>' for e in ('top','left','bottom','right','insideH','insideV'))
            + '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4677"/><w:gridCol w:w="4677"/></w:tblGrid>'
            + '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + ''.join(f'<w:tc><w:tcPr><w:tcW w:w="4677" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="SesTableText"/></w:pPr>{run(h)}</w:p></w:tc>' for h in ('项目','要求')) + '</w:tr>'
            + '<w:tr>' + ''.join(f'<w:tc><w:tcPr><w:tcW w:w="4677" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="SesTableText"/></w:pPr>{run(h)}</w:p></w:tc>' for h in ('字号','五号')) + '</w:tr></w:tbl>')
P('SesFormula', runs='<w:r><w:tab/></w:r>' + OMML['F1'] + '<w:r><w:tab/></w:r>' + run('(1)'))
P('SesPara', '式中 m₁、m₂ 为质量。下式验证 < 与 & 的转义：')
P('SesFormula', runs='<w:r><w:tab/></w:r>' + OMML['F3'] + '<w:r><w:tab/></w:r>' + run('(2)'))
P('SesChapter', '试验方法')
numbered('SesNoTitle1', 1, '新章的首个无标题条应编号为 5.1。', 1)
P('SesFigCap', '正文图应接续为图2')
P('SesFormula', runs='<w:r><w:tab/></w:r>' + OMML['F2'] + '<w:r><w:tab/></w:r>' + run('(3)'))
P('SesFormula', runs='<w:r><w:tab/></w:r>' + OMML['F5'] + '<w:r><w:tab/></w:r>' + run('(4)'))
# 对照：同一段落内用 oMathPara（显示公式）+ 制表位点线 + 编号
P('SesPara', '对照组：下面两式用 oMathPara（显示样式）与制表位组合：')
P('SesFormula', runs='<w:r><w:tab/></w:r><m:oMathPara>' + OMML['F1'] + '</m:oMathPara><w:r><w:tab/></w:r>' + run('(5)'))
P('SesFormula', runs='<w:r><w:tab/></w:r><m:oMathPara>' + OMML['F2'] + '</m:oMathPara><w:r><w:tab/></w:r>' + run('(6)'))
# 附录
pagebreak(); P('SesAppendix', runs='<w:r><w:br/></w:r>' + run('（规范性）') + '<w:r><w:br/></w:r>' + run('编号规则验证'))
figA = new_group(12, lvl(0, 'decimal', '图A.%1' + SP)); tblA = new_group(13, lvl(0, 'decimal', '表A.%1' + SP))
P('SesAppClause1', '附录条应编号为 A.1'); P('SesPara', '附录条文。')
numbered('SesAppFigCap', figA, '附录图应为图A.1')
P('SesAppClause2', '附录二级条应为 A.1.1')
numbered('SesAppNoTitle1', 2, '附录无标题条应为 A.2，且其后的附录图不应被条重置。', 1)
numbered('SesAppFigCap', figA, '附录图应接续为图A.2')
numbered('SesAppTblCap', tblA, '附录表应为表A.1')
P('SesFormula', runs='<w:r><w:tab/></w:r>' + OMML['F4'] + '<w:r><w:tab/></w:r>' + run('(A.1)'))
pagebreak(); P('SesAppendix', runs='<w:r><w:br/></w:r>' + run('（资料性）') + '<w:r><w:br/></w:r>' + run('第二个附录'))
figB = new_group(12, lvl(0, 'decimal', '图B.%1' + SP)); tblB = new_group(13, lvl(0, 'decimal', '表B.%1' + SP))
P('SesAppClause1', '附录 B 的首条应为 B.1')
numbered('SesAppFigCap', figB, '附录 B 的图应重置为图B.1')
numbered('SesAppTblCap', tblB, '附录 B 的表应重置为表B.1')
pagebreak(); P('SesBibTitle', '参' + SP + '考' + SP + '文' + SP + '献')
P('SesBibEntry', 'GB/T 1.1—2020' + SP + '标准化工作导则' + SP + '第1部分：标准化文件的结构和起草规则')
P('SesBibEntry', 'GB/T 20000.1—2014' + SP + '标准化工作指南' + SP + '第1部分：标准化和相关活动的通用术语')
P('SesEndMark')
final_sect = sect(**_cur[0])

document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>' + ''.join(body) + final_sect + '</w:body></w:document>'

def hdr(tag, align, instr):
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:{tag} {W}><w:p><w:pPr><w:pStyle w:val="{"SesHeader" if tag=="hdr" else "SesFooter"}"/>{align}</w:pPr>'
            + fld(instr, run('GB/T 12345—2026' if 'STYLEREF' in instr else '1')) + f'</w:p></w:{tag}>')
STYLEREF = 'STYLEREF "SES_封面文件编号" \\* MERGEFORMAT'
headers = {
    'word/header_odd.xml': hdr('hdr', '<w:jc w:val="right"/>', STYLEREF),
    'word/header_even.xml': hdr('hdr', '<w:jc w:val="left"/>', STYLEREF),
    'word/footer_odd.xml': hdr('ftr', f'<w:ind w:right="{tw(4)}"/><w:jc w:val="right"/>', 'PAGE'),
    'word/footer_even.xml': hdr('ftr', f'<w:ind w:left="{tw(4)}"/><w:jc w:val="left"/>', 'PAGE'),
}
settings = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings {W}><w:mirrorMargins/>'
            f'<w:defaultTabStop w:val="{2*CH}"/><w:evenAndOddHeaders/><w:characterSpacingControl w:val="compressPunctuation"/>'
            '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
            '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/><m:smallFrac m:val="0"/><m:naryLim m:val="undOvr"/><m:intLim m:val="subSup"/></m:mathPr>'
            '</w:settings>')
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rIdStyles" Type="{REL}styles" Target="styles.xml"/>'
            f'<Relationship Id="rIdNum" Type="{REL}numbering" Target="numbering.xml"/>'
            f'<Relationship Id="rIdSet" Type="{REL}settings" Target="settings.xml"/>'
            f'<Relationship Id="rIdHo" Type="{REL}header" Target="header_odd.xml"/>'
            f'<Relationship Id="rIdHe" Type="{REL}header" Target="header_even.xml"/>'
            f'<Relationship Id="rIdFo" Type="{REL}footer" Target="footer_odd.xml"/>'
            f'<Relationship Id="rIdFe" Type="{REL}footer" Target="footer_even.xml"/></Relationships>')
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                 f'<Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/>'
                 f'<Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/>'
                 f'<Override PartName="/word/numbering.xml" ContentType="{CT}numbering+xml"/>'
                 f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/>'
                 + ''.join(f'<Override PartName="/{p}" ContentType="{CT}{"header" if "header" in p else "footer"}+xml"/>' for p in headers)
                 + '</Types>')
root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             f'<Relationship Id="rId1" Type="{REL}officeDocument" Target="word/document.xml"/></Relationships>')
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types); z.writestr('_rels/.rels', root_rels)
    z.writestr('word/document.xml', document); z.writestr('word/_rels/document.xml.rels', doc_rels)
    z.writestr('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + styles_xml())
    z.writestr('word/numbering.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + numbering_xml())
    z.writestr('word/settings.xml', settings)
    for p, x in headers.items(): z.writestr(p, x)
print('written', OUT)
