import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.5 真实国家标准原文全要素样稿：取材自《GB/T 1.1—2020 标准化工作导则 第1部分：标准化文件的结构和起草规则》
 * （对应仓库内 `rules/GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.pdf` 及同源 `.md`），
 * 按生产 ProseMirror Schema（`createEditorSchema()`）手工构造，用于 GB/T 46687.2—2026 XML 导出、
 * 外部校验（validate.py / sts_compat.py / jing_check.py）与完整往返（export → import → 冷重开 → re-export）验收。
 *
 * 条款映射总览（GB/T 1.1—2020 条款/页码 ↔ GB/T 46687.2—2026 条款）：
 * - 封面元数据（封面，第 I 页）↔ 4.3.2（title-wrap / std-ident / std-org-group / content-language / std-ref / release-date / implementation-date / comm-ref / ics / ccs / std-supersedes / permissions / custom-meta-group）
 * - 前言（前言，第 V 页）↔ 4.3.3（front/sec[@id="sec_foreword"][@sec-type="foreword"]，含 alpha-lower 与 dash 列项、std 引用与交叉引用）
 * - 引言（引言，第 VII 页，原文无子条）↔ 4.3.4（front/sec[@id="sec_intro"][@sec-type="intro"]）
 * - 第 1 章 范围（第 1 章，第 1 页）↔ 4.4.2.2（body/sec[@id="sec_1"][@sec-type="scope"]）
 * - 第 2 章 规范性引用文件（第 2 章，第 1 页）↔ 4.4.2.3（body/sec[@id="sec_2"][@sec-type="norm-refs"] > ref-list[@content-type="norm-refs"]，含 std 与带脚注 mixed-citation）
 * - 第 3 章 术语和定义（第 3 章，第 1–2 页）↔ 4.4.2.4、9.2（body/sec[@id="sec_3"][@sec-type="terms"]，分组 3.1/3.2/3.3，多语种 TBX，领域/定义/示例/注/来源/entailedTerm，不伪造未出现描述符）
 * - 第 4 章 文件名称和结构（取材自原文第 6 章，第 6–8 页）↔ 4.4.2、6.1–6.5（表 1 含跨行跨列表头、名义列宽、表注、表脚注、加粗外框与表头外框样式）
 * - 第 5 章 层次的编写（取材自原文第 7 章，第 9–11 页）↔ 5.1–5.7（无标题条、阿拉伯/字母/罗马/破折号/圆点列项、多块注、多块示例、警告、行内样式、变量、代码、外链、条文脚注、交叉引用）
 * - 第 6 章 要素的表述（取材自原文第 9 章 9.8–9.12，第 27–31 页）↔ 6.1、7.1–7.4、8.3（横页表格 orientation="landscape" 与表脚注；行间原生 MathML + KaTeX 公式、whereList、公式注、行内 MathML、行内图）
 * - 附录 A（资料性，取材自原文附录 A，第 37 页）↔ 4.5.2（app[@content-type="informative"]）
 * - 附录 B（规范性，取材自原文附录 B 及图 B.1，第 38–39 页）↔ 4.5.2、8.1–8.6（app[@content-type="normative"]，含子条 B.1–B.3 与图 B.1 图例/图注/图中示例）
 * - 附录 C（规范性，取材自原文附录 C 及表 C.1，第 42 页）↔ 4.5.2、6.1（app[@content-type="normative"]，含子条 C.1–C.2 与附录表 C.1）
 * - 参考文献（取材自原文参考文献，第 60 页）↔ 4.5.3（back/ref-list[@content-type="bibl"]，含 std 与带 uri 的 mixed-citation）
 * - 索引（取材自原文索引，第 61 页）↔ 4.5.4（back/index，指向正文真实目标）
 */

type PMMarks = NonNullable<PMJsonNode['marks']>

const pm = (
  type: string,
  attrs?: Record<string, unknown>,
  content?: PMJsonNode[],
  text?: string,
  marks?: PMMarks,
): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
  ...(text !== undefined ? { text } : {}),
  ...(marks ? { marks } : {}),
})

const txt = (text: string, marks?: PMMarks): PMJsonNode => pm('text', undefined, undefined, text, marks)
const para = (nodeId: string, ...content: PMJsonNode[]): PMJsonNode => pm('stdParagraph', { nodeId }, content)
const xref = (text: string, targetId: string, refType: string): PMJsonNode =>
  txt(text, [{ type: 'crossRef', attrs: { targetId, refType } }])
const stdRefTxt = (text: string): PMJsonNode => txt(text, [{ type: 'stdRef' }])

/** 真实有效的 120×60 PNG 图像（用于图 B.1 标记体系的组成，内联 data URL 来源）。 */
export const GBT11_FIG_B1_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAa0lEQVR42u3QQQ0AAAgEoOsfzwRmMIEtnA82EpDq4UAUiBaNaNGiLYgWjWjRoi2IFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLRrRokUjWjSiRYtGtGhEixaNaNGiES0a0b8s0ipI1zvfEP8AAAAASUVORK5CYII='

/** 真实有效的 1×1 PNG 图像（用于文档级 figureResource 及行内符号图 inline-graphic）。 */
export const GBT11_INLINE_ICON_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** GB/T 1.1—2020 9.9.3.1 示例 1（第 29 页）：v = l / t 的原生 MathML 3.0 表达。 */
export const GBT11_FORMULA_VELOCITY_MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><mi>v</mi><mo>=</mo><mfrac><mi>l</mi><mi>t</mi></mfrac></mrow></math>'

/** GB/T 1.1—2020 9.9.2 示例（第 29 页）：x^2 + y^2 < z^2 的行内原生 MathML 3.0 表达。 */
export const GBT11_INLINE_INEQUALITY_MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup><mo>&lt;</mo><msup><mi>z</mi><mn>2</mn></msup></mrow></math>'

/**
 * 表格外框及表头外框加粗样式（2px solid；内框沿用 1px solid 默认，对应 GB/T 46687.2 6.3.3.1 与 PR #96 口径）。
 */
const FRAME_TOP = { borderTop: 2, borderTopUnit: 'px', borderTopStyle: 'solid' }
const FRAME_BOTTOM = { borderBottom: 2, borderBottomUnit: 'px', borderBottomStyle: 'solid' }
const FRAME_LEFT = { borderLeft: 2, borderLeftUnit: 'px', borderLeftStyle: 'solid' }
const FRAME_RIGHT = { borderRight: 2, borderRightUnit: 'px', borderRightStyle: 'solid' }

const cell = (
  type: 'tableCell' | 'tableHeader',
  nodeId: string,
  content: PMJsonNode[],
  attrs: Record<string, unknown> = {},
): PMJsonNode => pm(type, { nodeId, colspan: 1, rowspan: 1, ...attrs }, content)

const textCell = (
  type: 'tableCell' | 'tableHeader',
  nodeId: string,
  text: string,
  attrs: Record<string, unknown> = {},
): PMJsonNode => cell(type, nodeId, [pm('paragraph', undefined, [txt(text)])], attrs)

/** 通用封面元数据块（GB/T 1.1—2020 封面第 I 页 ↔ GB/T 46687.2 4.3.2）。 */
function createGbt11MetadataNodes(): PMJsonNode[] {
  return [
    pm('metadataBlock', undefined, [
      // 中英文分段题名：main / compl / full（GB/T 1.1—2020 封面第 I 页；GB/T 46687.2 4.3.2.2）
      pm('titlePart', { nodeId: 'gbt11-tp-zh-main', lang: 'zh', role: 'main' }, [txt('标准化工作导则')]),
      pm('titlePart', { nodeId: 'gbt11-tp-zh-compl', lang: 'zh', role: 'compl' }, [txt('第1部分：标准化文件的结构和起草规则')]),
      pm('titlePart', { nodeId: 'gbt11-tp-zh-full', lang: 'zh', role: 'full' }, [txt('标准化工作导则 第1部分：标准化文件的结构和起草规则')]),
      pm('titlePart', { nodeId: 'gbt11-tp-en-main', lang: 'en', role: 'main' }, [txt('Directives for standardization')]),
      pm('titlePart', { nodeId: 'gbt11-tp-en-compl', lang: 'en', role: 'compl' }, [txt('Part 1: Rules for the structure and drafting of standardizing documents')]),
      pm('titlePart', { nodeId: 'gbt11-tp-en-full', lang: 'en', role: 'full' }, [txt('Directives for standardization—Part 1: Rules for the structure and drafting of standardizing documents')]),
      // std-ident 分段（GB/T 46687.2 4.3.2.3）+ dated/undated std-ref
      pm('standardIdentifier', { nodeId: 'gbt11-ident-struct' }, [
        pm('identifierPart', { nodeId: 'gbt11-ident-orig', kind: 'originator', position: 0 }, [txt('SAC')]),
        pm('identifierPart', { nodeId: 'gbt11-ident-type', kind: 'doc-type', position: 1 }, [txt('GB/T')]),
        pm('identifierPart', { nodeId: 'gbt11-ident-num', kind: 'doc-number', position: 2 }, [txt('1')]),
        pm('identifierPart', { nodeId: 'gbt11-ident-part', kind: 'part-number', position: 3 }, [txt('1')]),
        pm('identifierPart', { nodeId: 'gbt11-ident-ed', kind: 'edition', position: 4 }, [txt('5')]),
      ]),
      pm('standardIdentifier', { nodeId: 'gbt11-ident-dated', scheme: 'dated', value: 'GB/T 1.1—2020' }),
      pm('standardIdentifier', { nodeId: 'gbt11-ident-undated', scheme: 'undated', value: 'GB/T 1.1' }),
      // 内容语言（GB/T 46687.2 4.3.2.5）
      pm('language', { nodeId: 'gbt11-lang-zh', tag: 'zh' }),
      // 双发布机构：国家市场监督管理总局 + 国家标准化管理委员会（GB/T 1.1—2020 封面；GB/T 46687.2 4.3.2.4）
      pm('publisher', { nodeId: 'gbt11-pub-samr', role: 'lead', identifier: 'SAMR' }, [txt('国家市场监督管理总局')]),
      pm('publisher', { nodeId: 'gbt11-pub-sac', role: 'lead', identifier: 'SAC' }, [txt('国家标准化管理委员会')]),
      // 代替标准（GB/T 1.1—2020 封面：代替 GB/T 1.1—2009；GB/T 46687.2 4.3.2.11）
      pm('replacedStandard', { nodeId: 'gbt11-replaces-2009', reference: 'GB/T 1.1—2009', relation: 'replaces' }),
      // 版权声明（GB/T 46687.2 4.3.2.13）
      pm('copyright', { nodeId: 'gbt11-copyright', holder: '国家标准化管理委员会', year: '2020' }, [txt('版权专有 侵权必究')]),
    ]),
    pm('coverPage', {
      nodeId: 'gbt11-cover',
      standardNo: 'GB/T 1.1—2020',
      standardType: 'national',
      titleCn: '标准化工作导则 第1部分：标准化文件的结构和起草规则',
      titleEn: 'Directives for standardization—Part 1: Rules for the structure and drafting of standardizing documents',
      publishDate: '2020-03-31',
      implementDate: '2020-10-01',
      issuer: '国家市场监督管理总局',
      icsCode: '01.120',
      ccsCode: 'A 00',
      replaces: 'GB/T 1.1—2009',
      coverDesignation: '中华人民共和国国家标准',
      technicalCommittee: 'SAC/TC 286',
    }, [pm('paragraph', { nodeId: 'gbt11-cover-body' }, [txt('中华人民共和国国家标准 GB/T 1.1—2020')])]),
  ]
}

/**
 * 完整真实国家标准全要素样稿（GB/T 1.1—2020）。
 */
export function createGbt11RealStandardFixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    ...createGbt11MetadataNodes(),

    // ==================== 前言（GB/T 1.1—2020 第 V 页 ↔ GB/T 46687.2 4.3.3） ====================
    pm('foreword', undefined, [
      para('gbt11-fw-p1',
        txt('本文件按照'), stdRefTxt('GB/T 1.1—2020'), txt('《标准化工作导则 第1部分：标准化文件的结构和起草规则》的规定起草。'),
      ),
      para('gbt11-fw-p2',
        txt('本文件是'), stdRefTxt('GB/T 1'), txt('《标准化工作导则》的第1部分。'), stdRefTxt('GB/T 1'), txt('已经发布了以下部分：'),
      ),
      pm('stdList', { nodeId: 'gbt11-fw-parts', listType: 'dash', level: 1 }, [
        pm('stdListItem', { nodeId: 'gbt11-fw-parts-1' }, [txt('第1部分：标准化文件的结构和起草规则。')]),
      ]),
      para('gbt11-fw-p3',
        txt('本文件代替'), stdRefTxt('GB/T 1.1—2009'), txt('《标准化工作导则 第1部分：标准的结构和编写》，与'), stdRefTxt('GB/T 1.1—2009'), txt('相比，除结构调整和编辑性改动外，主要技术变化如下：'),
      ),
      pm('stdList', { nodeId: 'gbt11-fw-changes', listType: 'alpha', level: 1 }, [
        pm('stdListItem', { nodeId: 'gbt11-fw-ch-a' }, [
          txt('更改了要素的类别、构成以及表述形式（见'), xref('4.1', 'gbt11-cl-4-1', 'clause'), txt('，2009年版的5.1.3）；'),
        ]),
        pm('stdListItem', { nodeId: 'gbt11-fw-ch-b' }, [
          txt('更改了“列项”的具体形式及编写规则（见'), xref('5.1', 'gbt11-cl-5-1', 'clause'), txt('，2009年版的5.2.6）；'),
        ]),
        pm('stdListItem', { nodeId: 'gbt11-fw-ch-c' }, [
          txt('更改了条款类型以及条款表述使用的一些能愿动词（见'), xref('附录C', 'gbt11-app-c', 'appendix'), txt('，2009年版的7.1.2、附录F）；'),
        ]),
        pm('stdListItem', { nodeId: 'gbt11-fw-ch-d' }, [
          txt('更改了关于“图”和“表”的用法的规则（见'), xref('6.1', 'gbt11-cl-6-1', 'clause'), txt('，2009年版的7.3.1、7.4.1）。'),
        ]),
      ]),
      para('gbt11-fw-p4', txt('本文件由全国标准化原理与方法标准化技术委员会（SAC/TC 286）提出并归口。')),
      para('gbt11-fw-p5', txt('本文件及其所代替文件的历次版本发布情况为：')),
      pm('stdList', { nodeId: 'gbt11-fw-history', listType: 'dash', level: 1 }, [
        pm('stdListItem', { nodeId: 'gbt11-fw-hist-1' }, [txt('1981年首次发布为GB 1.1—1981，1987年第一次修订，1993年第二次修订；')]),
        pm('stdListItem', { nodeId: 'gbt11-fw-hist-2' }, [txt('2000年第三次修订，2009年第四次修订；')]),
        pm('stdListItem', { nodeId: 'gbt11-fw-hist-3' }, [txt('本次为第五次修订。')]),
      ]),
    ]),

    // ==================== 引言（GB/T 1.1—2020 第 VII 页，按原文无子条 ↔ GB/T 46687.2 4.3.4 sec_intro） ====================
    pm('introduction', undefined, [
      para('gbt11-intro-p1',
        txt('标准化是为了建立最佳秩序、促进共同效益而开展的制定并应用标准的活动。在该标准体系中，'), stdRefTxt('GB/T 1'), txt('《标准化工作导则》是指导我国标准化活动的基础性和通用性的标准，拟由三个部分构成。'),
      ),
      pm('stdList', { nodeId: 'gbt11-intro-list', listType: 'dash', level: 1 }, [
        pm('stdListItem', { nodeId: 'gbt11-intro-i1' }, [txt('第1部分：标准化文件的结构和起草规则。目的在于确立适用于起草各类标准化文件需要遵守的总体原则和相关规则。')]),
        pm('stdListItem', { nodeId: 'gbt11-intro-i2' }, [txt('第2部分：标准化文件的制定程序。目的在于为标准化文件的制定工作确立可操作、可追溯、可证实的程序。')]),
        pm('stdListItem', { nodeId: 'gbt11-intro-i3' }, [txt('第3部分：标准化技术组织。目的在于为使标准化技术组织能够被各相关方广泛参与而确立组织的层次结构、规定组织的管理和运行要求。')]),
      ]),
      para('gbt11-intro-p2',
        txt('本次对'), stdRefTxt('GB/T 1.1'), txt('的修订，重点考虑了起草标准化文件的总体原则和要求以及如何选择文件的规范性要素，进一步清晰地规定了文件要素的编写和表述。'),
      ),
    ]),

    // ==================== 第 1 章 范围（GB/T 1.1—2020 第 1 章，第 1 页 ↔ GB/T 46687.2 4.4.2.2） ====================
    pm('chapter', { nodeId: 'gbt11-ch-1', secType: 'scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('gbt11-ch1-p1', txt('本文件确立了标准化文件的结构及其起草的总体原则和要求，并规定了文件名称、层次、要素的编写和表述规则以及文件的编排格式。')),
      para('gbt11-ch1-p2', txt('本文件适用于国家、行业和地方标准化文件的起草，其他标准化文件的起草参照使用。')),
      pm('note', { nodeId: 'gbt11-ch1-note' }, [txt('在不引起混淆的情况下，本文件中的“标准化文件”简称为“文件”。')]),
    ]),

    // ==================== 第 2 章 规范性引用文件（GB/T 1.1—2020 第 2 章，第 1 页 ↔ GB/T 46687.2 4.4.2.3） ====================
    pm('chapter', { nodeId: 'gbt11-ch-2', secType: 'norm-refs' }, [
      pm('chapterTitle', undefined, [txt('规范性引用文件')]),
      para('gbt11-ch2-lead', txt('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。其中，注日期的引用文件，仅该日期对应的版本适用于本文件；不注日期的引用文件，其最新版本（包括所有的修改单）适用于本文件。')),
      pm('normRefList', { nodeId: 'gbt11-nrl' }, [
        pm('normRefStd', { nodeId: 'gbt11-nr-1' }, [
          pm('normRefStdRef', undefined, [txt('GB/T 321')]),
          pm('normRefStdTitle', undefined, [txt('优先数和优先数系')]),
        ]),
        pm('normRefStd', { nodeId: 'gbt11-nr-2' }, [
          pm('normRefStdRef', undefined, [txt('GB/T 3101')]),
          pm('normRefStdTitle', undefined, [txt('有关量、单位和符号的一般原则')]),
        ]),
        pm('normRefStd', { nodeId: 'gbt11-nr-3' }, [
          pm('normRefStdRef', undefined, [txt('GB/T 3102（所有部分）')]),
          pm('normRefStdTitle', undefined, [txt('量和单位')]),
        ]),
        pm('normRefStd', { nodeId: 'gbt11-nr-4' }, [
          pm('normRefStdRef', undefined, [txt('GB/T 7714')]),
          pm('normRefStdTitle', undefined, [txt('信息与文献 参考文献著录规则')]),
        ]),
        pm('normRefStd', { nodeId: 'gbt11-nr-5' }, [
          pm('normRefStdRef', undefined, [txt('GB/T 20000.1')]),
          pm('normRefStdTitle', undefined, [txt('标准化工作指南 第1部分：标准化和相关活动的通用术语')]),
        ]),
        pm('normRefStd', { nodeId: 'gbt11-nr-6' }, [
          pm('normRefStdRef', undefined, [txt('ISO 80000（所有部分）')]),
          pm('normRefStdTitle', undefined, [txt('量和单位（Quantities and units）')]),
        ]),
        pm('normRefMixed', { nodeId: 'gbt11-nr-7' }, [
          txt('ISO/IEC Directives, Part 2, 2018, Principles and rules for the structure and drafting of ISO and IEC documents'),
          pm('footnoteRef', { nodeId: 'gbt11-fn-nr', content: [txt('本文件参考该国际导则第8版起草，一致性程度为非等效。')] }),
        ]),
      ]),
    ]),

    // ==================== 第 3 章 术语和定义（GB/T 1.1—2020 第 3 章，第 1–2 页 ↔ GB/T 46687.2 4.4.2.4、9.2） ====================
    pm('chapter', { nodeId: 'gbt11-ch-3', secType: 'terms' }, [
      pm('chapterTitle', undefined, [txt('术语和定义')]),
      para('gbt11-ch3-lead', stdRefTxt('GB/T 20000.1'), txt('界定的以及下列术语和定义适用于本文件。')),

      // 3.1 文件
      pm('clause', { nodeId: 'gbt11-cl-3-1', level: 1 }, [
        pm('clauseTitle', undefined, [txt('文件')]),
        pm('termDef', { nodeId: 'gbt11-t-3-1-1', level: 1 }, [
          pm('termName', undefined, [txt('标准化文件')]),
          pm('termNameEn', undefined, [txt('standardizing document')]),
          pm('termSubjectField', undefined, [txt('标准化')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-1-1-def' }, [txt('通过标准化活动制定的文件。')]),
          pm('termSource', undefined, [txt('GB/T 20000.1—2014，5.2')]),
          // 多语种 TBX：附加法语语言集，不伪造原文未给出的词性/采用级别描述符
          pm('tbxLangSet', { nodeId: 'gbt11-t-3-1-1-fr', lang: 'fr' }, [
            pm('tbxTig', { nodeId: 'gbt11-t-3-1-1-fr-tig' }, [
              pm('tbxTermVariant', { nodeId: 'gbt11-t-3-1-1-fr-var' }, [
                pm('tbxTerm', undefined, [txt('document normatif')]),
              ]),
            ]),
          ]),
        ]),
        pm('termDef', { nodeId: 'gbt11-t-3-1-2', level: 1 }, [
          pm('termName', undefined, [txt('标准')]),
          pm('termNameEn', undefined, [txt('standard')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-1-2-def' }, [
            txt('通过标准化活动，按照规定的程序经协商一致制定，为各种活动或其结果提供规则、指南或特性，供共同使用和重复使用的文件。'),
          ]),
          pm('termSource', undefined, [txt('GB/T 20000.1—2014，5.3')]),
        ]),
        pm('termDef', { nodeId: 'gbt11-t-3-1-3', level: 1 }, [
          pm('termName', undefined, [txt('基础标准')]),
          pm('termNameEn', undefined, [txt('basic standard')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-1-3-def' }, [
            txt('以相互理解为编制目的形成的具有广泛适用范围的'),
            txt('标准（3.1.2）', [{ type: 'termRef', attrs: { targetId: 'gbt11-t-3-1-2' } }]),
            txt('。'),
          ]),
          pm('example', { nodeId: 'gbt11-t-3-1-3-ex' }, [txt('GB/T 1.1—2020 属于指导文件起草的基础标准。')]),
          pm('note', { nodeId: 'gbt11-t-3-1-3-note' }, [txt('通常包括术语标准、符号标准、分类标准、试验标准等。')]),
        ]),
        pm('termDef', { nodeId: 'gbt11-t-3-1-4', level: 1 }, [
          pm('termName', undefined, [txt('通用标准')]),
          pm('termNameEn', undefined, [txt('general standard')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-1-4-def' }, [
            txt('包含某个或多个特定领域普遍适用的'),
            txt('条款（3.3.1）', [{ type: 'termRef', attrs: { targetId: 'gbt11-t-3-3-1' } }]),
            txt('的'),
            txt('标准（3.1.2）', [{ type: 'termRef', attrs: { targetId: 'gbt11-t-3-1-2' } }]),
            txt('。'),
          ]),
          pm('note', { nodeId: 'gbt11-t-3-1-4-note' }, [txt('通用标准在其名称中常包含词语“通用”，例如通用规范、通用技术要求等。')]),
        ]),
      ]),

      // 3.2 文件的结构
      pm('clause', { nodeId: 'gbt11-cl-3-2', level: 1 }, [
        pm('clauseTitle', undefined, [txt('文件的结构')]),
        pm('termDef', { nodeId: 'gbt11-t-3-2-1', level: 1 }, [
          pm('termName', undefined, [txt('结构')]),
          pm('termNameEn', undefined, [txt('structure')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-2-1-def' }, [txt('文件中层次、要素以及附录、图和表的位置和排列顺序。')]),
        ]),
        pm('termDef', { nodeId: 'gbt11-t-3-2-2', level: 1 }, [
          pm('termName', undefined, [txt('规范性要素')]),
          pm('termNameEn', undefined, [txt('normative element')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-2-2-def' }, [
            txt('界定文件范围或设定'),
            txt('条款（3.3.1）', [{ type: 'termRef', attrs: { targetId: 'gbt11-t-3-3-1' } }]),
            txt('的要素。'),
          ]),
        ]),
      ]),

      // 3.3 文件的表述
      pm('clause', { nodeId: 'gbt11-cl-3-3', level: 1 }, [
        pm('clauseTitle', undefined, [txt('文件的表述')]),
        pm('termDef', { nodeId: 'gbt11-t-3-3-1', level: 1 }, [
          pm('termName', undefined, [txt('条款')]),
          pm('termNameEn', undefined, [txt('provision')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-3-1-def' }, [txt('在文件中表达应用该文件需要遵守、符合、理解或作出选择的表述。')]),
        ]),
        pm('termDef', { nodeId: 'gbt11-t-3-3-2', level: 1 }, [
          pm('termName', undefined, [txt('要求')]),
          pm('termNameEn', undefined, [txt('requirement')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-3-2-def' }, [
            txt('表达声明符合该文件需要满足的客观可证实的准则，并且不允许存在偏差的'),
            txt('条款（3.3.1）', [{ type: 'termRef', attrs: { targetId: 'gbt11-t-3-3-1' } }]),
            txt('。'),
          ]),
        ]),
        pm('termDef', { nodeId: 'gbt11-t-3-3-3', level: 1 }, [
          pm('termName', undefined, [txt('指示')]),
          pm('termNameEn', undefined, [txt('instruction')]),
          pm('termDefinition', { nodeId: 'gbt11-t-3-3-3-def' }, [
            txt('表达需要履行的行动的'),
            txt('条款（3.3.1）', [{ type: 'termRef', attrs: { targetId: 'gbt11-t-3-3-1' } }]),
            txt('。'),
          ]),
          pm('termSource', undefined, [txt('GB/T 20000.1—2014，9.3，有修改')]),
        ]),
      ]),
    ]),

    // ==================== 第 4 章 文件名称和结构（取材自原文第 6 章，第 6–8 页 ↔ GB/T 46687.2 6.1–6.5） ====================
    pm('chapter', { nodeId: 'gbt11-ch-4', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('文件名称和结构')]),
      pm('clause', { nodeId: 'gbt11-cl-4-1', level: 1 }, [
        pm('clauseTitle', undefined, [txt('要素的构成和表述')]),
        para('gbt11-cl41-p1',
          txt('要素的内容由'), txt('条款', [{ type: 'crossRef', attrs: { targetId: 'gbt11-t-3-3-1', refType: 'term' } }]),
          txt('和/或附加信息构成。'), xref('表1', 'gbt11-tbl-1', 'table'),
          txt('中界定了文件中要素的类别及其构成，给出了要素允许的表述形式；另可参考'),
          txt('[1]', [{ type: 'bibRef', attrs: { targetId: 'gbt11-bib-1' } }]), txt('与'),
          txt('[4]', [{ type: 'bibRef', attrs: { targetId: 'gbt11-bib-4' } }]), txt('。'),
        ),
        // 表 1（取材自 GB/T 1.1—2020 表 3，第 8 页）：跨行/跨列两行表头、名义列宽、表单位、表注、表脚注及引用、表/表头加粗外框
        pm('stdTable', {
          nodeId: 'gbt11-tbl-1',
          headerRowCount: 2,
          unit: '类别口径：按 GB/T 1.1—2020 第6章',
          columns: [
            { width: 20, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
            { width: 15, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
            { width: 15, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
            { width: 20, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
            { width: 30, widthUnit: '%', textAlign: 'left', verticalAlign: 'middle' },
          ],
        }, [
          pm('tableCaption', undefined, [txt('文件中各要素的类别、构成及表述形式')]),
          pm('table', undefined, [
            pm('tableRow', { nodeId: 'gbt11-tbl1-r0' }, [
              textCell('tableHeader', 'gbt11-tbl1-h00', '要素', { rowspan: 2, ...FRAME_TOP, ...FRAME_LEFT, ...FRAME_BOTTOM }),
              textCell('tableHeader', 'gbt11-tbl1-h01', '要素的类别', { colspan: 2, ...FRAME_TOP }),
              textCell('tableHeader', 'gbt11-tbl1-h02', '要素的构成', { rowspan: 2, ...FRAME_TOP, ...FRAME_BOTTOM }),
              textCell('tableHeader', 'gbt11-tbl1-h03', '要素所允许的表述形式', { rowspan: 2, ...FRAME_TOP, ...FRAME_RIGHT, ...FRAME_BOTTOM }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tbl1-r1' }, [
              textCell('tableHeader', 'gbt11-tbl1-h10', '必备或可选', { ...FRAME_BOTTOM }),
              textCell('tableHeader', 'gbt11-tbl1-h11', '规范性或资料性', { ...FRAME_BOTTOM }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tbl1-r2' }, [
              textCell('tableCell', 'gbt11-tbl1-c20', '封面', { ...FRAME_LEFT }),
              textCell('tableCell', 'gbt11-tbl1-c21', '必备'),
              textCell('tableCell', 'gbt11-tbl1-c22', '资料性', { rowspan: 2 }),
              textCell('tableCell', 'gbt11-tbl1-c23', '附加信息', { rowspan: 2 }),
              textCell('tableCell', 'gbt11-tbl1-c24', '标明文件信息', { ...FRAME_RIGHT }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tbl1-r3' }, [
              textCell('tableCell', 'gbt11-tbl1-c30', '前言', { ...FRAME_LEFT }),
              textCell('tableCell', 'gbt11-tbl1-c31', '必备'),
              textCell('tableCell', 'gbt11-tbl1-c34', '条文、注、脚注、指明附录', { ...FRAME_RIGHT }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tbl1-r4' }, [
              cell('tableCell', 'gbt11-tbl1-c40', [
                pm('paragraph', undefined, [
                  txt('规范性引用文件'),
                  pm('tableFootnoteRef', { nodeId: 'gbt11-tbl1-fnref-a1', targetId: 'gbt11-tbl1-fn-a' }),
                ]),
              ], { ...FRAME_LEFT }),
              textCell('tableCell', 'gbt11-tbl1-c41', '必备/可选'),
              textCell('tableCell', 'gbt11-tbl1-c42', '资料性'),
              textCell('tableCell', 'gbt11-tbl1-c43', '附加信息'),
              textCell('tableCell', 'gbt11-tbl1-c44', '清单、注、脚注', { ...FRAME_RIGHT }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tbl1-r5' }, [
              cell('tableCell', 'gbt11-tbl1-c50', [
                pm('paragraph', undefined, [
                  txt('术语和定义'),
                  pm('tableFootnoteRef', { nodeId: 'gbt11-tbl1-fnref-a2', targetId: 'gbt11-tbl1-fn-a' }),
                ]),
              ], { ...FRAME_LEFT, ...FRAME_BOTTOM }),
              textCell('tableCell', 'gbt11-tbl1-c51', '必备/可选', { ...FRAME_BOTTOM }),
              textCell('tableCell', 'gbt11-tbl1-c52', '规范性', { ...FRAME_BOTTOM }),
              textCell('tableCell', 'gbt11-tbl1-c53', '条款、附加信息', { ...FRAME_BOTTOM }),
              textCell('tableCell', 'gbt11-tbl1-c54', '条文、图、数学公式、示例、注、引用、提示', { ...FRAME_RIGHT, ...FRAME_BOTTOM }),
            ]),
          ]),
          pm('tableNoteRow', undefined, [
            pm('note', { nodeId: 'gbt11-tbl1-note' }, [txt('本表节选自 GB/T 1.1—2020 表3，用于验证复合表头、列宽、外框与表脚注。')]),
          ]),
          pm('tableFootnoteRow', undefined, [
            pm('tableFootnoteEntry', { nodeId: 'gbt11-tbl1-fn-a' }, [txt('章编号和标题的设置是必备的，要素内容的有无根据具体情况进行选择。')]),
          ]),
        ]),
      ]),
    ]),

    // ==================== 第 5 章 层次的编写（取材自原文第 7 章，第 9–11 页 ↔ GB/T 46687.2 5.1–5.7） ====================
    pm('chapter', { nodeId: 'gbt11-ch-5', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('层次的编写')]),
      pm('clause', { nodeId: 'gbt11-cl-5-1', level: 1 }, [
        pm('clauseTitle', undefined, [txt('列项与条文表述')]),
        // 无标题条 5.1.1（取材自 GB/T 1.1—2020 7.5.1，第 11 页）
        pm('clause', { nodeId: 'gbt11-cl-5-1-1', level: 2, hasTitle: false }, [
          pm('clauseTitle'),
          para('gbt11-cl511-p1',
            txt('列项是段中的子层次，用于强调细分的并列各项中的内容（见'),
            xref('注1', 'gbt11-cl511-note1', 'note'), txt('、'),
            xref('示例1', 'gbt11-cl511-ex1', 'example'), txt('与列项'),
            xref('5.1.1 b）', 'gbt11-cl511-alpha-b', 'listItem'),
            txt('）。具体形式有以下两种：'),
          ),
          // 字母列项（alpha-lower）+ 嵌套阿拉伯数字列项（arabic）
          pm('stdList', { nodeId: 'gbt11-cl511-alpha', listType: 'alpha', level: 1 }, [
            pm('stdListItem', { nodeId: 'gbt11-cl511-alpha-a' }, [
              txt('后跟句号的完整句子引出后跟句号的各项；'),
            ]),
            pm('stdListItem', { nodeId: 'gbt11-cl511-alpha-b' }, [
              txt('后跟冒号的文字引出后跟分号或逗号的各项。'),
            ]),
          ]),
          para('gbt11-cl511-p2', txt('在需要区分操作顺序时，可采用阿拉伯数字列项与小写罗马数字列项：')),
          pm('stdList', { nodeId: 'gbt11-cl511-arabic', listType: 'number', level: 2 }, [
            pm('stdListItem', { nodeId: 'gbt11-cl511-ar-1' }, [txt('左向（含左上、左下），图形符号应位于右侧；')]),
            pm('stdListItem', { nodeId: 'gbt11-cl511-ar-2' }, [txt('右向（含右上、右下），图形符号应位于左侧。')]),
          ]),
          pm('stdList', { nodeId: 'gbt11-cl511-roman', listType: 'roman', level: 1 }, [
            pm('stdListItem', { nodeId: 'gbt11-cl511-rm-1' }, [txt('检查条款类型与能愿动词一致性；')]),
            pm('stdListItem', { nodeId: 'gbt11-cl511-rm-2' }, [txt('核对引用文件与参考文献著录规则。')]),
          ]),
          // 行内富文本全覆盖：粗体、斜体、下划线、删除线、上下标、变量、行内代码、外链、mixed-citation、条文脚注
          para('gbt11-cl511-p3',
            txt('条文强调可使用'), txt('黑体字', [{ type: 'bold' }]), txt('、'),
            txt('斜体', [{ type: 'italic' }]), txt('、'),
            txt('下划线', [{ type: 'underline' }]), txt('、'),
            txt('删除线', [{ type: 'strike' }]), txt('，上标如 10'),
            txt('3', [{ type: 'superscript' }]), txt('、下标如 D'),
            txt('1', [{ type: 'subscript' }]), txt('，变量如 '),
            txt('v', [{ type: 'variable' }]), txt('，机读代码如 '),
            txt('GB/T 00001', [{ type: 'code' }]), txt('。相关法律参考'),
            txt('《中华人民共和国标准化法》', [{ type: 'mixedCitation' }]), txt('，详情参见'),
            txt('全国标准信息公共服务平台', [{ type: 'externalLink', attrs: { href: 'https://std.samr.gov.cn/' } }]),
            pm('footnoteRef', { nodeId: 'gbt11-fn-body-1', content: [txt('条文脚注编号从前言开始全文连续，见 GB/T 1.1—2020 9.12.1。')] }),
            txt('。'),
          ),
          // 代码块（GB/T 1.1—2020 B.6.2.1 机读记录示例）
          pm('codeBlock', { nodeId: 'gbt11-code-1' }, [txt('GB/T 1 -> GB/T 00001')]),
          // 多块注（noteBlock）+ 单段注
          pm('noteBlock', { nodeId: 'gbt11-cl511-note1' }, [
            para('gbt11-cl511-note1-p1', txt('注属于附加信息，它只给出有助于理解或使用文件内容的说明（GB/T 1.1—2020 9.11.1）。')),
            pm('stdList', { nodeId: 'gbt11-cl511-note1-l', listType: 'dot', level: 2 }, [
              pm('stdListItem', { nodeId: 'gbt11-cl511-note1-i1' }, [txt('条文中的注不应包含要求型条款；')]),
              pm('stdListItem', { nodeId: 'gbt11-cl511-note1-i2' }, [txt('多个注应从“注1：”开始顺序编号。')]),
            ]),
          ]),
          // 多块示例（exampleBlock）
          pm('exampleBlock', { nodeId: 'gbt11-cl511-ex1' }, [
            para('gbt11-cl511-ex1-p1', txt('下列仪器不需要开关（取材自 GB/T 1.1—2020 7.5.1 示例2）：')),
            pm('stdList', { nodeId: 'gbt11-cl511-ex1-l', listType: 'dash', level: 1 }, [
              pm('stdListItem', { nodeId: 'gbt11-cl511-ex1-i1' }, [txt('正常操作条件下，功耗不超过10 W的仪器；')]),
              pm('stdListItem', { nodeId: 'gbt11-cl511-ex1-i2' }, [txt('连续运转的仪器。')]),
            ]),
          ]),
          // 警告块（warning）
          pm('warning', { nodeId: 'gbt11-cl511-warn' }, [
            para('gbt11-cl511-warn-p', txt('警告——文件中不应将要求型条款写入资料性要素或条文中的注内。')),
          ]),
        ]),
        // 无标题条 5.1.2（取材自 GB/T 1.1—2020 7.5.2，第 11 页）
        pm('clause', { nodeId: 'gbt11-cl-5-1-2', level: 2, hasTitle: false }, [
          pm('clauseTitle'),
          para('gbt11-cl512-p1', txt('列项可以进一步细分为分项，这种细分不宜超过两个层次。层次编号示例参见'), xref('附录A', 'gbt11-app-a', 'appendix'), txt('。')),
        ]),
      ]),
    ]),

    // ==================== 第 6 章 要素的表述（取材自原文第 9 章 9.8–9.9，第 27–30 页 ↔ GB/T 46687.2 6.1、7.1–7.4、8.3） ====================
    pm('chapter', { nodeId: 'gbt11-ch-6', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('要素的表述')]),

      // 6.1 表（含横页表格 orientation="landscape"、表单位、表注、表脚注与引用）
      pm('clause', { nodeId: 'gbt11-cl-6-1', level: 1 }, [
        pm('clauseTitle', undefined, [txt('表')]),
        para('gbt11-cl61-p1',
          txt('表的编排见'), xref('表2', 'gbt11-tbl-2', 'table'),
          txt('（取材自 GB/T 1.1—2020 9.8.5 示例），行内图形符号'),
          pm('inlineImage', { src: GBT11_INLINE_ICON_PNG, resourceId: 'gbt11-res-inline', alt: '标志图标', size: 'S' }),
          txt('与无尺寸行内图'),
          pm('inlineImage', { src: GBT11_INLINE_ICON_PNG, resourceId: null, alt: '', size: null }),
          txt('可嵌入条文。'),
        ),
        // 表 2：横页表格 orientation="landscape"（PR #95 专项要素）
        pm('stdTable', {
          nodeId: 'gbt11-tbl-2',
          orientation: 'landscape',
          headerRowCount: 1,
          unit: '单位为毫米',
          columns: [
            { width: 25, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
            { width: 25, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
            { width: 25, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
            { width: 25, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
          ],
        }, [
          pm('tableCaption', undefined, [txt('表的编排示例（横页宽表）')]),
          pm('table', undefined, [
            pm('tableRow', { nodeId: 'gbt11-tbl2-r0' }, [
              textCell('tableHeader', 'gbt11-tbl2-h0', '类型', { ...FRAME_TOP, ...FRAME_LEFT, ...FRAME_BOTTOM }),
              textCell('tableHeader', 'gbt11-tbl2-h1', '长度', { ...FRAME_TOP, ...FRAME_BOTTOM }),
              cell('tableHeader', 'gbt11-tbl2-h2', [
                pm('paragraph', undefined, [
                  txt('内圆直径'),
                  pm('tableFootnoteRef', { nodeId: 'gbt11-tbl2-fnref-a', targetId: 'gbt11-tbl2-fn-a' }),
                ]),
              ], { ...FRAME_TOP, ...FRAME_BOTTOM }),
              textCell('tableHeader', 'gbt11-tbl2-h3', '外圆直径', { ...FRAME_TOP, ...FRAME_RIGHT, ...FRAME_BOTTOM }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tbl2-r1' }, [
              textCell('tableCell', 'gbt11-tbl2-c10', 'A', { ...FRAME_LEFT }),
              textCell('tableCell', 'gbt11-tbl2-c11', '230'),
              textCell('tableCell', 'gbt11-tbl2-c12', '100'),
              textCell('tableCell', 'gbt11-tbl2-c13', '125', { ...FRAME_RIGHT }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tbl2-r2' }, [
              textCell('tableCell', 'gbt11-tbl2-c20', 'B', { ...FRAME_LEFT, ...FRAME_BOTTOM }),
              textCell('tableCell', 'gbt11-tbl2-c21', '260', { ...FRAME_BOTTOM }),
              textCell('tableCell', 'gbt11-tbl2-c22', '120', { ...FRAME_BOTTOM }),
              textCell('tableCell', 'gbt11-tbl2-c23', '150', { ...FRAME_RIGHT, ...FRAME_BOTTOM }),
            ]),
          ]),
          pm('tableNoteRow', undefined, [
            pm('note', { nodeId: 'gbt11-tbl2-n1' }, [txt('表中的注应置于表内下方，表脚注之上。')]),
            pm('note', { nodeId: 'gbt11-tbl2-n2' }, [txt('表脚注除给出附加信息之外，还可包含要求型条款。')]),
          ]),
          pm('tableFootnoteRow', undefined, [
            pm('tableFootnoteEntry', { nodeId: 'gbt11-tbl2-fn-a' }, [txt('内圆直径应按标准试验温度下测得的算术平均值计。')]),
          ]),
        ]),
      ]),

      // 6.2 数学公式（取材自 GB/T 1.1—2020 9.9，第 29–30 页；PR #94 专项要素）
      pm('clause', { nodeId: 'gbt11-cl-6-2', level: 1 }, [
        pm('clauseTitle', undefined, [txt('数学公式')]),
        para('gbt11-cl62-p1',
          txt('数学公式通常使用量关系式表示，见'), xref('公式(1)', 'gbt11-f-1', 'formula'),
          txt('与'), xref('公式(2)', 'gbt11-f-2', 'formula'),
          txt('；条文中的行内不等式如'),
          pm('formulaInline', { nodeId: 'gbt11-if-1', latex: 'x^2 + y^2 < z^2', mathml: GBT11_INLINE_INEQUALITY_MATHML }),
          txt('，带单层下标的符号如'),
          pm('formulaInline', { nodeId: 'gbt11-if-2', latex: 'D_{1,\\max}' }),
          txt('。'),
        ),
        // 公式 (1)：原生 MathML + LaTeX + 编号 + 公式注 + whereList（GB/T 1.1—2020 9.9.3.1 示例 1，第 29 页）
        pm('formula', {
          nodeId: 'gbt11-f-1',
          numbered: true,
          latex: 'v = \\frac{l}{t}',
          mathml: GBT11_FORMULA_VELOCITY_MATHML,
        }, [
          pm('formulaContent', undefined, [txt('v = \\frac{l}{t}')]),
          pm('formulaNote', { nodeId: 'gbt11-f-1-note' }, [txt('式(1)为量关系式，不应与数值关系式在同一文件中共用相同符号。')]),
          pm('whereList', undefined, [
            pm('whereItem', { nodeId: 'gbt11-f-1-w1' }, [
              pm('whereTerm', undefined, [txt('v', [{ type: 'variable' }])]),
              pm('whereDefinition', undefined, [txt('匀速运动质点的速度；')]),
            ]),
            pm('whereItem', { nodeId: 'gbt11-f-1-w2' }, [
              pm('whereTerm', undefined, [txt('l', [{ type: 'variable' }])]),
              pm('whereDefinition', undefined, [txt('运行距离；')]),
            ]),
            pm('whereItem', { nodeId: 'gbt11-f-1-w3' }, [
              pm('whereTerm', undefined, [txt('t', [{ type: 'variable' }])]),
              pm('whereDefinition', undefined, [txt('时间间隔。')]),
            ]),
          ]),
        ]),
        // 公式 (2)：仅 LaTeX，由 KaTeX 转换为 MathML 3.0，验证导入后二次导出逐字节一致（GB/T 1.1—2020 9.9.3.1 示例 5，第 30 页）
        pm('formula', {
          nodeId: 'gbt11-f-2',
          numbered: true,
          latex: 't_i = \\sqrt{\\frac{S_{ME,i}}{S_{MR,i}}}',
        }, [
          pm('formulaContent', undefined, [txt('t_i = \\sqrt{\\frac{S_{ME,i}}{S_{MR,i}}}')]),
          pm('whereList', undefined, [
            pm('whereItem', { nodeId: 'gbt11-f-2-w1' }, [
              pm('whereTerm', undefined, [txt('t'), txt('i', [{ type: 'subscript' }])]),
              pm('whereDefinition', undefined, [txt('系统 i 的统计量；')]),
            ]),
            pm('whereItem', { nodeId: 'gbt11-f-2-w2' }, [
              pm('whereTerm', undefined, [txt('S'), txt('ME,i', [{ type: 'subscript' }])]),
              pm('whereDefinition', undefined, [txt('系统 i 的残差均方；')]),
            ]),
            pm('whereItem', { nodeId: 'gbt11-f-2-w3' }, [
              pm('whereTerm', undefined, [txt('S'), txt('MR,i', [{ type: 'subscript' }])]),
              pm('whereDefinition', undefined, [txt('系统 i 由于回归产生的均方。')]),
            ]),
          ]),
        ]),
      ]),
    ]),

    // ==================== 附录 A（资料性，取材自 GB/T 1.1—2020 附录 A，第 37 页 ↔ GB/T 46687.2 4.5.2） ====================
    pm('appendix', { nodeId: 'gbt11-app-a', normative: false }, [
      pm('appendixLabel', undefined, [txt('（资料性）')]),
      pm('appendixTitle', undefined, [txt('层次编号示例')]),
      para('gbt11-appa-p1', txt('下面给出了标准化文件章、条及无标题条的层次编号示例。')),
      pm('example', { nodeId: 'gbt11-appa-ex' }, [txt('第5章下分5.1、5.2，5.1下分5.1.1、5.1.2，无标题条直接以编号起始。')]),
    ]),

    // ==================== 附录 B（规范性，取材自 GB/T 1.1—2020 附录 B 与图 B.1，第 38–39 页 ↔ GB/T 46687.2 4.5.2、8.1–8.5） ====================
    pm('appendix', { nodeId: 'gbt11-app-b', normative: true }, [
      pm('appendixLabel', undefined, [txt('（规范性）')]),
      pm('appendixTitle', undefined, [txt('标准化项目标记')]),
      pm('clause', { nodeId: 'gbt11-cl-b-1', level: 1 }, [
        pm('clauseTitle', undefined, [txt('概述')]),
        para('gbt11-clb1-p1', txt('标准化项目既指有形的项目（例如材料或成品），也指无形的项目（例如过程或体系、试验方法、符号集）。标记不能代替文件的全部内容，要全面了解文件内容，需要阅读有关文件。')),
      ]),
      pm('clause', { nodeId: 'gbt11-cl-b-2', level: 1 }, [
        pm('clauseTitle', undefined, [txt('标记体系')]),
        para('gbt11-clb2-p1',
          txt('每个标记由“描述段”和“识别段”组成。该体系由'), xref('图B.1', 'gbt11-fig-b1', 'figure'),
          txt('表示并在以下作进一步解释。'),
        ),
        // 图 B.1：真实 PNG 字节 + 图题 + 图例(legend/def-list[figure]) + 图注 + 图中示例
        pm('figure', { nodeId: 'gbt11-fig-b1', orientation: 'portrait' }, [
          pm('figureImage', { src: GBT11_FIG_B1_PNG, alt: '' }),
          pm('figureCaption', undefined, [txt('标记体系的组成')]),
          pm('figureLegend', { nodeId: 'gbt11-fig-b1-legend' }, [
            pm('figureLegendTitle', undefined, [txt('标引序号说明：')]),
            pm('whereItem', { nodeId: 'gbt11-fig-b1-lg1' }, [
              pm('whereTerm', undefined, [txt('1')]),
              pm('whereDefinition', undefined, [txt('描述段（可选，宜取自 ICS 主题词）；')]),
            ]),
            pm('whereItem', { nodeId: 'gbt11-fig-b1-lg2' }, [
              pm('whereTerm', undefined, [txt('2')]),
              pm('whereDefinition', undefined, [txt('识别段——标准代号和顺序号段；')]),
            ]),
            pm('whereItem', { nodeId: 'gbt11-fig-b1-lg3' }, [
              pm('whereTerm', undefined, [txt('3')]),
              pm('whereDefinition', undefined, [txt('识别段——特性段（与前段间用短横线连接）。')]),
            ]),
          ]),
          pm('note', { nodeId: 'gbt11-fig-b1-note' }, [txt('对于每个特性只赋予一个数值的文件，可省略标记中的特性段。')]),
          pm('example', { nodeId: 'gbt11-fig-b1-ex' }, [txt('温度计 GB/T XXXX-EC-0,2-58-82。')]),
        ]),
      ]),
    ]),

    // ==================== 附录 C（规范性，取材自 GB/T 1.1—2020 附录 C 与表 C.1，第 42 页 ↔ GB/T 46687.2 4.5.2、6.1） ====================
    pm('appendix', { nodeId: 'gbt11-app-c', normative: true }, [
      pm('appendixLabel', undefined, [txt('（规范性）')]),
      pm('appendixTitle', undefined, [txt('条款类型的表述使用的能愿动词或句子语气类型')]),
      pm('clause', { nodeId: 'gbt11-cl-c-1', level: 1 }, [
        pm('clauseTitle', undefined, [txt('要求')]),
        para('gbt11-clc1-p1', txt('表示需要满足的要求应使用'), xref('表C.1', 'gbt11-tbl-c1', 'table'), txt('所示的能愿动词。')),
        pm('stdTable', {
          nodeId: 'gbt11-tbl-c1',
          headerRowCount: 1,
          columns: [
            { width: 35, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
            { width: 65, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
          ],
        }, [
          pm('tableCaption', undefined, [txt('要求')]),
          pm('table', undefined, [
            pm('tableRow', { nodeId: 'gbt11-tblc1-r0' }, [
              textCell('tableHeader', 'gbt11-tblc1-h0', '能愿动词', { ...FRAME_TOP, ...FRAME_LEFT, ...FRAME_BOTTOM }),
              textCell('tableHeader', 'gbt11-tblc1-h1', '在特殊情况下使用的等效表述', { ...FRAME_TOP, ...FRAME_RIGHT, ...FRAME_BOTTOM }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tblc1-r1' }, [
              textCell('tableCell', 'gbt11-tblc1-c10', '应', { ...FRAME_LEFT }),
              textCell('tableCell', 'gbt11-tblc1-c11', '应该、只准许', { ...FRAME_RIGHT }),
            ]),
            pm('tableRow', { nodeId: 'gbt11-tblc1-r2' }, [
              textCell('tableCell', 'gbt11-tblc1-c20', '不应', { ...FRAME_LEFT, ...FRAME_BOTTOM }),
              textCell('tableCell', 'gbt11-tblc1-c21', '不应该、不准许', { ...FRAME_RIGHT, ...FRAME_BOTTOM }),
            ]),
          ]),
          pm('tableNoteRow', undefined, [
            pm('note', { nodeId: 'gbt11-tblc1-note' }, [txt('不使用“必须”作为“应”的替代词，以避免将文件的要求与外部约束相混淆。')]),
          ]),
        ]),
      ]),
    ]),

    // ==================== 参考文献（取材自 GB/T 1.1—2020 参考文献，第 60 页 ↔ GB/T 46687.2 4.5.3） ====================
    pm('bibliography', { nodeId: 'gbt11-bibl' }, [
      pm('bibliographyTitle', undefined, [txt('参考文献')]),
      pm('bibEntry', { nodeId: 'gbt11-bib-1', entryType: 'standard' }, [
        txt('GB/T 1182 产品几何技术规范（GPS） 几何公差 形状、方向、位置和跳动公差标注'),
        pm('bibStructured', undefined, [
          pm('bibField', { nodeId: 'gbt11-bib-1-ref', name: 'std-ref' }, [txt('GB/T 1182')]),
          pm('bibField', { nodeId: 'gbt11-bib-1-title', name: 'title' }, [txt('产品几何技术规范（GPS） 几何公差 形状、方向、位置和跳动公差标注')]),
        ]),
      ]),
      pm('bibEntry', { nodeId: 'gbt11-bib-2', entryType: 'standard' }, [
        txt('GB 3100 国际单位制及其应用'),
        pm('bibStructured', undefined, [
          pm('bibField', { nodeId: 'gbt11-bib-2-ref', name: 'std-ref' }, [txt('GB 3100')]),
          pm('bibField', { nodeId: 'gbt11-bib-2-title', name: 'title' }, [txt('国际单位制及其应用')]),
        ]),
      ]),
      pm('bibEntry', { nodeId: 'gbt11-bib-3', entryType: 'standard' }, [
        txt('GB/T 20003.1 标准制定的特殊程序 第1部分：涉及专利的标准'),
        pm('bibStructured', undefined, [
          pm('bibField', { nodeId: 'gbt11-bib-3-ref', name: 'std-ref' }, [txt('GB/T 20003.1')]),
          pm('bibField', { nodeId: 'gbt11-bib-3-title', name: 'title' }, [txt('标准制定的特殊程序 第1部分：涉及专利的标准')]),
        ]),
      ]),
      pm('bibEntry', { nodeId: 'gbt11-bib-4', entryType: 'other' }, [
        txt('ISO/IEC Directives, Part 2, 2018, Principles and rules for the structure and drafting of ISO and IEC documents'),
        pm('bibStructured', undefined, [
          pm('bibExternalLink', { href: 'https://www.iso.org/directives-and-policies.html' }),
        ]),
      ]),
    ]),

    // ==================== 索引（取材自 GB/T 1.1—2020 索引，第 61 页 ↔ GB/T 46687.2 4.5.4） ====================
    pm('indexBlock', { nodeId: 'gbt11-index', title: '索引' }, [
      pm('indexGroup', { nodeId: 'gbt11-idx-b', label: 'B' }, [
        pm('indexEntry', { nodeId: 'gbt11-idx-b1' }, [
          pm('indexTerm', undefined, [txt('标准')]),
          pm('indexTarget', { targetId: 'gbt11-t-3-1-2' }),
        ]),
        pm('indexEntry', { nodeId: 'gbt11-idx-b2' }, [
          pm('indexTerm', undefined, [txt('标准化项目标记')]),
          pm('indexTarget', { targetId: 'gbt11-app-b' }),
        ]),
      ]),
      pm('indexGroup', { nodeId: 'gbt11-idx-t', label: 'T' }, [
        pm('indexEntry', { nodeId: 'gbt11-idx-t1' }, [
          pm('indexTerm', undefined, [txt('条款')]),
          pm('indexTarget', { targetId: 'gbt11-t-3-3-1' }),
          pm('indexTarget', { targetId: 'gbt11-app-c' }),
        ]),
        pm('indexEntry', { nodeId: 'gbt11-idx-t2' }, [
          pm('indexTerm', undefined, [txt('数学公式')]),
          pm('indexTarget', { targetId: 'gbt11-cl-6-2' }),
        ]),
      ]),
    ]),

    // ==================== 文档级图资源 ====================
    pm('figureResource', {
      nodeId: 'gbt11-res-inline',
      mediaType: 'image/png',
      name: 'gbt11-inline-icon.png',
      encoding: 'dataUrl',
      data: GBT11_INLINE_ICON_PNG,
    }),
  ])
}

/**
 * 专项往返回归样稿 A：含引言条（sec_0 / 0.1 / 0.1.1 / 无题条 0.2），
 * 验证 GB/T 46687.2 4.3.4 引言条的导出、校验与逐字节往返一致性。
 */
export function createIntroClausesSpecialDoc(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    ...createGbt11MetadataNodes(),
    pm('foreword', undefined, [
      para('ic-fw-p1', txt('本文件按照'), stdRefTxt('GB/T 1.1—2020'), txt('的规定起草。')),
    ]),
    pm('introduction', undefined, [
      pm('clause', { nodeId: 'ic-c1', level: 1 }, [
        pm('clauseTitle', undefined, [txt('修订背景')]),
        pm('clause', { nodeId: 'ic-c1-1', level: 2 }, [
          pm('clauseTitle', undefined, [txt('体系演进')]),
          para('ic-c1-1-p', txt('自2014年起陆续充实完善基础性国家标准体系。')),
          pm('note', { nodeId: 'ic-c1-1-note' }, [txt('本条为引言中的子条示例。')]),
        ]),
      ]),
      pm('clause', { nodeId: 'ic-c2', level: 1, hasTitle: false }, [
        pm('clauseTitle'),
        para('ic-c2-p', txt('引言无标题条，引用'), xref('0.1', 'ic-c1', 'clause'), txt('。')),
      ]),
    ]),
    pm('chapter', { nodeId: 'ic-ch1', secType: 'scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('ic-ch1-p1', txt('本文件规定引言条的交叉引用，见引言'), xref('0.1', 'ic-c1', 'clause'), txt('与'), xref('0.1.1', 'ic-c1-1', 'clause'), txt('。')),
    ]),
  ])
}

/**
 * 专项往返回归样稿 B：集中验证 PR #94（行间公式 MathML 弹窗节点）、PR #95（横页表格 + 表脚注）、
 * PR #96（表/表头外框加粗边框样式与 headerRowCount）的双向 XML 往返与非 XML 导出。
 */
export function createPr94To96RegressionDoc(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    ...createGbt11MetadataNodes(),
    pm('foreword', undefined, [
      para('pr-fw-p', txt('本文件用于回归验证行间公式、横页表格与表头加粗外框。')),
    ]),
    pm('chapter', { nodeId: 'pr-ch1', secType: 'scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('pr-ch1-p',
        txt('本文件覆盖'), xref('表1', 'pr-tbl-landscape', 'table'),
        txt('与'), xref('公式(1)', 'pr-formula-mathml', 'formula'), txt('。'),
      ),
    ]),
    pm('chapter', { nodeId: 'pr-ch2', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('技术回归项')]),
      // PR #94：原生 MathML 行间公式 + 公式注 + whereList
      pm('formula', {
        nodeId: 'pr-formula-mathml',
        numbered: true,
        latex: 'v = \\frac{l}{t}',
        mathml: GBT11_FORMULA_VELOCITY_MATHML,
      }, [
        pm('formulaContent', undefined, [txt('v = \\frac{l}{t}')]),
        pm('formulaNote', { nodeId: 'pr-formula-note' }, [txt('原生 MathML 为权威表达。')]),
        pm('whereList', undefined, [
          pm('whereItem', { nodeId: 'pr-w1' }, [
            pm('whereTerm', undefined, [txt('v', [{ type: 'variable' }])]),
            pm('whereDefinition', undefined, [txt('速度。')]),
          ]),
        ]),
      ]),
      // PR #95 + PR #96：横页表格 orientation="landscape" + 2 行复合表头 + 加粗外框 + 表脚注
      pm('stdTable', {
        nodeId: 'pr-tbl-landscape',
        orientation: 'landscape',
        headerRowCount: 2,
        unit: '单位为毫米',
        columns: [
          { width: 30, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
          { width: 35, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
          { width: 35, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
        ],
      }, [
        pm('tableCaption', undefined, [txt('横页表格与表头加粗外框回归表')]),
        pm('table', undefined, [
          pm('tableRow', { nodeId: 'pr-tbl-r0' }, [
            textCell('tableHeader', 'pr-tbl-h00', '代号', { rowspan: 2, ...FRAME_TOP, ...FRAME_LEFT, ...FRAME_BOTTOM }),
            textCell('tableHeader', 'pr-tbl-h01', '尺寸参数', { colspan: 2, ...FRAME_TOP, ...FRAME_RIGHT }),
          ]),
          pm('tableRow', { nodeId: 'pr-tbl-r1' }, [
            cell('tableHeader', 'pr-tbl-h10', [
              pm('paragraph', undefined, [
                txt('内径'),
                pm('tableFootnoteRef', { nodeId: 'pr-tbl-fnref-a', targetId: 'pr-tbl-fn-a' }),
              ]),
            ], { ...FRAME_BOTTOM }),
            textCell('tableHeader', 'pr-tbl-h11', '外径', { ...FRAME_RIGHT, ...FRAME_BOTTOM }),
          ]),
          pm('tableRow', { nodeId: 'pr-tbl-r2' }, [
            textCell('tableCell', 'pr-tbl-c20', 'A1', { ...FRAME_LEFT, ...FRAME_BOTTOM }),
            textCell('tableCell', 'pr-tbl-c21', '100', { ...FRAME_BOTTOM }),
            textCell('tableCell', 'pr-tbl-c22', '125', { ...FRAME_RIGHT, ...FRAME_BOTTOM }),
          ]),
        ]),
        pm('tableNoteRow', undefined, [
          pm('note', { nodeId: 'pr-tbl-note' }, [txt('横页表在弹窗和导出链中均保留表脚注与外框设置。')]),
        ]),
        pm('tableFootnoteRow', undefined, [
          pm('tableFootnoteEntry', { nodeId: 'pr-tbl-fn-a' }, [txt('内径应在20 ℃条件下测量。')]),
        ]),
      ]),
    ]),
  ])
}

/**
 * 常规可排版子集文档（取材自 GB/T 1.1—2020）：
 * 仅使用 HTML / DOCX / 语义 JSON / 文件设置均放行的常规可排版要素，
 * 用于非 XML 回归验证（确保 XML 接入与 PR #93～#96 未破坏常规排版与出件链路）。
 */
export function createGbt11RenderableSubsetDoc(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('coverPage', {
      nodeId: 'sub-cover',
      standardNo: 'GB/T 1.1—2020',
      standardType: 'national',
      titleCn: '标准化工作导则 第1部分：标准化文件的结构和起草规则',
      titleEn: 'Directives for standardization—Part 1: Rules for the structure and drafting of standardizing documents',
      publishDate: '2020-03-31',
      implementDate: '2020-10-01',
      issuer: '国家市场监督管理总局',
      icsCode: '01.120',
      ccsCode: 'A 00',
      replaces: 'GB/T 1.1—2009',
      coverDesignation: '中华人民共和国国家标准',
      technicalCommittee: 'SAC/TC 286',
    }, [pm('paragraph', { nodeId: 'sub-cover-p' }, [txt('中华人民共和国国家标准 GB/T 1.1—2020')])]),
    pm('foreword', undefined, [
      para('sub-fw-p', txt('本文件按照GB/T 1.1—2020的规定起草。')),
    ]),
    pm('introduction', undefined, [
      para('sub-intro-p', txt('标准化是为了建立最佳秩序、促进共同效益而开展的制定并应用标准的活动。')),
    ]),
    pm('chapter', { nodeId: 'sub-ch1', secType: 'scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('sub-ch1-p', txt('本文件确立了标准化文件的结构及其起草的总体原则和要求，见'), xref('表1', 'sub-tbl-1', 'table'), txt('与'), xref('公式(1)', 'sub-f-1', 'formula'), txt('。')),
    ]),
    pm('chapter', { nodeId: 'sub-ch2', secType: 'norm-refs' }, [
      pm('chapterTitle', undefined, [txt('规范性引用文件')]),
      para('sub-ch2-lead', txt('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。')),
      pm('normRefList', { nodeId: 'sub-nrl' }, [
        pm('normRefStd', { nodeId: 'sub-nr-1' }, [
          pm('normRefStdRef', undefined, [txt('GB/T 321')]),
          pm('normRefStdTitle', undefined, [txt('优先数和优先数系')]),
        ]),
      ]),
    ]),
    pm('chapter', { nodeId: 'sub-ch3', secType: 'terms' }, [
      pm('chapterTitle', undefined, [txt('术语和定义')]),
      para('sub-ch3-lead', txt('下列术语和定义适用于本文件。')),
      pm('termDef', { nodeId: 'sub-t1', level: 1 }, [
        pm('termName', undefined, [txt('标准化文件')]),
        pm('termNameEn', undefined, [txt('standardizing document')]),
        pm('termDefinition', { nodeId: 'sub-t1-def' }, [txt('通过标准化活动制定的文件。')]),
        pm('termSource', undefined, [txt('GB/T 20000.1—2014，5.2')]),
      ]),
    ]),
    pm('chapter', { nodeId: 'sub-ch4', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('要素的表述')]),
      pm('formula', {
        nodeId: 'sub-f-1',
        numbered: true,
        latex: 'v = \\frac{l}{t}',
      }, [
        pm('formulaContent', undefined, [txt('v = \\frac{l}{t}')]),
        pm('whereList', undefined, [
          pm('whereItem', { nodeId: 'sub-w1' }, [
            pm('whereTerm', undefined, [txt('v')]),
            pm('whereDefinition', undefined, [txt('匀速运动质点的速度。')]),
          ]),
        ]),
      ]),
      pm('stdTable', {
        nodeId: 'sub-tbl-1',
        orientation: 'landscape',
        headerRowCount: 2,
      }, [
        pm('tableCaption', undefined, [txt('要素类别汇总表')]),
        pm('table', undefined, [
          pm('tableRow', { nodeId: 'sub-tbl-r0' }, [
            textCell('tableHeader', 'sub-tbl-h00', '要素', { rowspan: 2 }),
            textCell('tableHeader', 'sub-tbl-h01', '类别', { colspan: 2 }),
          ]),
          pm('tableRow', { nodeId: 'sub-tbl-r1' }, [
            textCell('tableHeader', 'sub-tbl-h10', '必备/可选'),
            textCell('tableHeader', 'sub-tbl-h11', '规范/资料'),
          ]),
          pm('tableRow', { nodeId: 'sub-tbl-r2' }, [
            cell('tableCell', 'sub-tbl-c20', [
              pm('paragraph', undefined, [
                txt('范围'),
                pm('tableFootnoteRef', { nodeId: 'sub-tbl-fnref-a', targetId: 'sub-tbl-fn-a' }),
              ]),
            ]),
            textCell('tableCell', 'sub-tbl-c21', '必备'),
            textCell('tableCell', 'sub-tbl-c22', '规范性'),
          ]),
        ]),
        pm('tableNoteRow', undefined, [
          pm('note', { nodeId: 'sub-tbl-note' }, [txt('本表用于常规排版与出件回归。')]),
        ]),
        pm('tableFootnoteRow', undefined, [
          pm('tableFootnoteEntry', { nodeId: 'sub-tbl-fn-a' }, [txt('范围的章编号固定为1。')]),
        ]),
      ]),
      pm('figure', { nodeId: 'sub-fig-1', orientation: 'portrait' }, [
        pm('figureImage', { src: GBT11_FIG_B1_PNG, alt: '' }),
        pm('figureCaption', undefined, [txt('标记体系示意图')]),
      ]),
    ]),
    pm('bibliography', { nodeId: 'sub-bibl' }, [
      pm('bibliographyTitle', undefined, [txt('参考文献')]),
      pm('bibEntry', { nodeId: 'sub-bib-1' }, [txt('GB/T 1182 产品几何技术规范（GPS） 几何公差')]),
    ]),
  ])
}
