import type { PMJsonNode } from '@ses/shared'

const pm = (
  type: string,
  attrs?: Record<string, unknown>,
  content?: PMJsonNode[],
  text?: string,
  marks?: NonNullable<PMJsonNode['marks']>,
): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
  ...(text !== undefined ? { text } : {}),
  ...(marks ? { marks } : {}),
})

const txt = (text: string, marks?: NonNullable<PMJsonNode['marks']>) => pm('text', undefined, undefined, text, marks)
const para = (nodeId: string, ...content: PMJsonNode[]) => pm('stdParagraph', { nodeId }, content)

const svgData = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4='

/** Full deterministic production-schema fixture for WP6 typed-field acceptance. */
export function createWp6Fixture(): PMJsonNode {
  return pm('doc', {
    extensionVersion: 1,
    // Deliberately stale fallback values prove that a present metadataBlock is authoritative.
    titleParts: [{ id: 'fallback-title', role: 'main', content: [{ type: 'text', text: 'must not reappear' }] }],
    identifiers: [],
    languages: [],
    publishers: [],
    adoptions: [],
    replacedStandards: [],
    copyrights: [],
  }, [
    pm('metadataBlock', undefined, [
      pm('titlePart', { nodeId: 'meta-title-zh', lang: 'zh-Hans', role: 'main' }, [txt('标准机器语言表达')]),
      pm('titlePart', { nodeId: 'meta-title-en', lang: 'en', role: 'main' }, [txt('Machine-readable representation of standards')]),
      pm('standardIdentifier', { nodeId: 'meta-identifier', scheme: 'GB/T', value: 'GB/T 46687.2—2026' }, [
        pm('identifierPart', { nodeId: 'meta-identifier-scheme', kind: 'scheme', position: 1 }, [txt('GB/T')]),
        pm('identifierPart', { nodeId: 'meta-identifier-number', kind: 'number', position: 2 }, [txt('46687.2')]),
        pm('identifierPart', { nodeId: 'meta-identifier-year', kind: 'year', position: 3 }, [txt('2026')]),
      ]),
      pm('language', { nodeId: 'meta-language-zh', tag: 'zh-Hans', usage: 'document' }),
      pm('language', { nodeId: 'meta-language-en', tag: 'en', usage: 'title' }),
      pm('publisher', { nodeId: 'meta-publisher', role: 'publisher', identifier: 'SAMR' }, [txt('国家市场监督管理总局')]),
      pm('adoption', { nodeId: 'meta-adoption', reference: 'ISO 1234:2024', degree: 'modified', language: 'en' }),
      pm('replacedStandard', { nodeId: 'meta-replaced', reference: 'GB/T 46687.1—2026', relation: 'revises' }),
      pm('copyright', { nodeId: 'meta-copyright', holder: '国家市场监督管理总局', year: '2026', language: 'zh-Hans' }, [txt('版权归发布机构所有')]),
    ]),
    pm('coverPage', {
      nodeId: 'cover-page',
      standardNo: 'GB/T 46687.2—2026',
      standardType: 'national',
      titleCn: '标准机器语言表达',
      titleEn: 'Machine-readable representation of standards',
      issuer: '国家市场监督管理总局',
      applicant: '全国标准化技术委员会',
      proposer: '标准化文件编制组',
      technicalCommittee: '全国标准化技术委员会',
    }, [pm('paragraph', { nodeId: 'cover-page-body' }, [txt('封面字段仍保持生产Schema兼容')])]),
    pm('foreword', { nodeId: 'foreword' }, [para('foreword-p', txt('本文件按照标准化文件编写规则起草。'))]),
    pm('chapter', { nodeId: 'chapter-main' }, [
      pm('chapterTitle', undefined, [txt('测试要素')]),
      pm('clause', { nodeId: 'clause-main', level: 1 }, [
        pm('clauseTitle', undefined, [txt('基本表达')]),
        para('paragraph-main',
          txt('文本含完整样式、变量、外链、文献引用和术语引用。'),
          txt('x', [
            { type: 'textStyle', attrs: { fontFamily: 'SimSun', fontSize: '12pt', color: '#112233', backgroundColor: '#eeeeee', letterSpacing: '0.1em', baseline: 'baseline', textTransform: 'none' } },
            { type: 'variable', attrs: { kind: 'symbol', name: 'x' } },
          ]),
          txt(' 官方链接', [{ type: 'externalLink', attrs: { href: 'https://example.org/spec', title: '规范来源', target: '_blank', rel: 'noopener' } }]),
          txt(' 文献', [{ type: 'bibRef', attrs: { targetId: 'bib-entry' } }]),
          txt(' 术语', [{ type: 'termRef', attrs: { targetId: 'term-main' } }]),
          txt(' 条款', [{ type: 'crossRef', attrs: { targetId: 'clause-main', refType: 'clause' } }]),
          pm('formulaInline', { nodeId: 'formula-inline', latex: 'x^2 + 1', mathml: '<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math>', source: 'mathml' }),
        ),
        pm('termDef', { nodeId: 'term-main', level: 1 }, [
          pm('termName', undefined, [txt('术语')]),
          pm('termNameEn', undefined, [txt('term')]),
          pm('termDefinition', { nodeId: 'term-definition-main' }, [txt('具有特定含义的表达。')]),
          pm('termSource', undefined, [txt('ISO vocabulary')]),
          pm('tbxLangSet', { nodeId: 'term-lang-zh', lang: 'zh-Hans' }, [
          pm('tbxTig', { nodeId: 'term-tig-zh' }, [
              pm('tbxTermVariant', { nodeId: 'term-variant-zh' }, [
                pm('tbxTerm', undefined, [txt('规范化文档')]),
                pm('tbxTermDescriptor', { nodeId: 'term-pos-zh', type: 'partOfSpeech' }, [txt('名词')]),
                pm('tbxTermDescriptor', { nodeId: 'term-domain-zh', type: 'subjectField' }, [txt('标准化')]),
              ]),
              pm('tbxTermVariant', { nodeId: 'term-variant-short' }, [
                pm('tbxTerm', undefined, [txt('规范文档')]),
                pm('tbxTermDescriptor', { nodeId: 'term-status-short', type: 'administrativeStatus' }, [txt('preferredTerm')]),
              ]),
            ]),
            pm('tbxTig', { nodeId: 'term-tig-zh-alt' }, [
              pm('tbxTermVariant', { nodeId: 'term-variant-zh-alt' }, [
                pm('tbxTerm', undefined, [txt('标准文档')]),
                pm('tbxTermDescriptor', { nodeId: 'term-type-alt', type: 'termType' }, [txt('abbreviation')]),
                pm('tbxTermDescriptor', { nodeId: 'term-usage-alt', type: 'usageStatus' }, [txt('admitted')]),
              ]),
            ]),
          ]),
          pm('tbxLangSet', { nodeId: 'term-lang-en', lang: 'en' }, [
            pm('tbxTig', { nodeId: 'term-tig-en' }, [
              pm('tbxTermVariant', { nodeId: 'term-variant-en' }, [
                pm('tbxTerm', undefined, [txt('normalized document')]),
                pm('tbxTermDescriptor', { nodeId: 'term-source-en', type: 'source' }, [txt('ISO vocabulary')]),
              ]),
            ]),
          ]),
        ]),
        pm('formula', { nodeId: 'formula-block', mathml: '<math><mi>x</mi><mo>=</mo><mn>2</mn></math>', latex: 'x = 2' }, [
          pm('formulaContent', undefined, [txt('x = 2')]),
          pm('formulaNote', { nodeId: 'formula-note' }, [txt('公式注：等式中的变量取实数。')]),
          pm('whereList', undefined, [
            pm('whereItem', { nodeId: 'where-x' }, [
              pm('whereTerm', undefined, [txt('x')]),
              pm('whereDefinition', undefined, [txt('自变量')]),
            ]),
          ]),
        ]),
        pm('stdTable', {
          nodeId: 'table-main', unit: 'mm', width: 120, widthUnit: 'mm', layout: 'fixed', borderModel: 'collapse',
          textAlign: 'center', verticalAlign: 'middle', borderColor: '#333333', borderWidth: 0.5,
          borderWidthUnit: 'pt', backgroundColor: '#ffffff', cellPadding: 1.5, cellPaddingUnit: 'mm',
        }, [
          pm('tableCaption', undefined, [txt('字段表')]),
          pm('table', undefined, [
            pm('tableRow', { nodeId: 'table-row-header', height: 8, heightUnit: 'mm', backgroundColor: '#eeeeee' }, [
              pm('tableHeader', { nodeId: 'table-cell-h1', cellType: 'columnHeader', unit: 'mm', width: 40, widthUnit: 'mm', colspan: 1, rowspan: 1, colwidth: [151], textAlign: 'center' }, [pm('paragraph', undefined, [txt('名称')])]),
              pm('tableHeader', { nodeId: 'table-cell-h2', cellType: 'columnHeader', colspan: 1, rowspan: 1, colwidth: [302] }, [pm('paragraph', undefined, [txt('取值')])]),
            ]),
            pm('tableRow', { nodeId: 'table-row-data' }, [
              pm('tableCell', { nodeId: 'table-cell-1', cellType: 'data', unit: 'mm', colspan: 1, rowspan: 1, colwidth: [151], borderTop: 0.25, borderTopUnit: 'pt', paddingLeft: 2, paddingLeftUnit: 'mm' }, [pm('paragraph', undefined, [txt('宽度')])]),
              pm('tableCell', { nodeId: 'table-cell-2', cellType: 'data', colspan: 1, rowspan: 1, colwidth: [302], backgroundColor: '#f8f8f8' }, [pm('paragraph', undefined, [txt('120')])]),
            ]),
          ]),
        ]),
        pm('figure', { nodeId: 'figure-main', unit: 'mm', orientation: 'portrait' }, [
          pm('figureImage', { src: svgData, resourceId: 'figure-resource', alt: '一像素示意图', title: '资源测试图', width: 12, widthUnit: 'mm', height: 8, heightUnit: 'mm' }),
          pm('figureCaption', undefined, [txt('资源示意图')]),
          pm('figureDescription', { nodeId: 'figure-description' }, [txt('该段说明与图题分开保存。')]),
          pm('figureGroup', { nodeId: 'figure-group' }, [
            pm('figureDescription', { nodeId: 'figure-group-description' }, [txt('组合图说明。')]),
            pm('figureResourceRef', { targetId: 'figure-resource' }),
          ]),
        ]),
        pm('warning', { nodeId: 'warning-main' }, [para('warning-p', txt('这是一个带稳定ID的警告块。'))]),
        pm('quoteBlock', { nodeId: 'quote-main' }, [para('quote-p', txt('这是一个独立表达的引文块。'))]),
        pm('codeBlock', { nodeId: 'code-main', language: 'text' }, [txt('key = value')]),
      ]),
    ]),
    pm('bibliography', { nodeId: 'bibliography-main' }, [
      pm('bibliographyTitle', undefined, [txt('参考文献')]),
      pm('bibEntry', { nodeId: 'bib-entry', entryType: 'standard' }, [
        txt('GB/T 46687.2—2026 标准机器语言表达'),
        pm('bibStructured', undefined, [
          pm('bibField', { nodeId: 'bib-title', name: 'title' }, [txt('标准机器语言表达')]),
          pm('bibField', { nodeId: 'bib-author', name: 'author' }, [txt('全国标准化技术委员会')]),
          pm('bibIdentifier', { nodeId: 'bib-identifier', scheme: 'GB/T', value: '46687.2—2026' }),
          pm('bibExternalLink', { href: 'https://example.org/bib', title: '文献链接', displayText: '在线来源', target: '_blank', rel: 'noopener' }),
        ]),
      ]),
    ]),
    pm('indexBlock', { nodeId: 'index-main', title: '主题索引' }, [
      pm('indexGroup', { nodeId: 'index-group-a', label: '规范化' }, [
        pm('indexEntry', { nodeId: 'index-entry-main' }, [
          pm('indexTerm', undefined, [txt('术语条目')]),
          pm('indexTarget', { targetId: 'term-main' }),
          pm('indexTarget', { targetId: 'clause-main' }),
          pm('indexSeeAlso', { targetId: 'bib-entry' }),
        ]),
      ]),
    ]),
    pm('figureResource', { nodeId: 'figure-resource', mediaType: 'image/svg+xml', name: 'figure.svg', encoding: 'dataUrl', data: svgData }),
  ])
}
