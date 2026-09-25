/**
 * assertWellFormed / assertChildOrder 的反例测试（审查第 6 条：「检查器从未被证明能失败」）。
 *
 * 从一个已知合法的包出发（深拷贝，不改动原对象），逐项篡改，验证每种篡改都会被对应的检查
 * 函数抓出来。正例（合法包能通过）也各留一条，避免只测「会抛错」而不测「不误抛」。
 */
import { describe, expect, it } from 'vitest'
import { buildPackage, type DocxRelatedPart } from '../../package'
import type { DocxPackage } from '../../types'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from './checks'

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function baseDocumentXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document ${W_NS}><w:body><w:p><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p></w:body></w:document>`
  )
}

function buildBasePackage(relatedParts?: DocxRelatedPart[]): DocxPackage {
  return buildPackage({
    documentXml: baseDocumentXml(),
    title: 'checks 测试用包',
    createdAt: '2026-09-25T08:00:00.000Z',
    relatedParts,
  })
}

/** 深拷贝，篡改测试不改动原始 fixture（也顺带覆盖了「可 JSON 往返」这条不变式的日常使用） */
function clone(pkg: DocxPackage): DocxPackage {
  return JSON.parse(JSON.stringify(pkg)) as DocxPackage
}

describe('assertWellFormed / 正例', () => {
  it('合法的包通过', () => {
    expect(() => assertWellFormed(buildBasePackage())).not.toThrow()
  })

  it('带二进制关联部件的合法包也通过', () => {
    const pkg = buildBasePackage([
      {
        id: 'rId1',
        target: 'word/media/image1.png',
        relationshipType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        content: 'iVBORw0KGgo=',
        binary: true,
      },
    ])
    expect(() => assertWellFormed(pkg)).not.toThrow()
  })
})

describe('assertWellFormed / 反例（篡改合法包，逐项验证检查器真的会抛错）', () => {
  it('某个部件解析失败时抛错', () => {
    const pkg = clone(buildBasePackage())
    pkg.parts['word/document.xml'] = '<w:document><unclosed></w:document>'
    expect(() => assertWellFormed(pkg)).toThrow(/解析失败/)
  })

  it('.xml 部件缺 Override 时抛错（哪怕有 Default Extension="xml" 兜底）', () => {
    const pkg = clone(buildBasePackage())
    pkg.parts['[Content_Types].xml'] = pkg.parts['[Content_Types].xml'].replace(
      /<Override PartName="\/word\/settings\.xml"[^>]*\/>/,
      '',
    )
    // 篡改前确认这条 Override 真的存在，否则这个测试本身就是假阳性
    expect(pkg.parts['[Content_Types].xml']).not.toContain('/word/settings.xml')
    expect(() => assertWellFormed(pkg)).toThrow(/settings\.xml/)
  })

  it('二进制部件没有对应 Default 时抛错', () => {
    const pkg = clone(
      buildBasePackage([
        {
          id: 'rId1',
          target: 'word/media/image1.png',
          relationshipType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
          content: 'iVBORw0KGgo=',
          binary: true,
        },
      ]),
    )
    pkg.parts['[Content_Types].xml'] = pkg.parts['[Content_Types].xml'].replace(
      /<Default Extension="png"[^>]*\/>/,
      '',
    )
    expect(pkg.parts['[Content_Types].xml']).not.toContain('Extension="png"')
    expect(() => assertWellFormed(pkg)).toThrow(/image1\.png/)
  })

  it('关系 Target 悬空时抛错', () => {
    const pkg = clone(buildBasePackage())
    expect(pkg.parts['word/_rels/document.xml.rels']).toContain('Target="settings.xml"')
    pkg.parts['word/_rels/document.xml.rels'] = pkg.parts['word/_rels/document.xml.rels'].replace(
      'Target="settings.xml"',
      'Target="nope.xml"',
    )
    expect(() => assertWellFormed(pkg)).toThrow(/悬空/)
  })
})

describe('assertChildOrder / 正例', () => {
  it('合法的包通过', () => {
    expect(() => assertChildOrder(buildBasePackage())).not.toThrow()
  })
})

describe('assertChildOrder / 反例', () => {
  it('子元素顺序错误时抛错：jc 排在 pStyle 前面', () => {
    const pkg = clone(buildBasePackage())
    pkg.parts['word/document.xml'] = pkg.parts['word/document.xml'].replace(
      '<w:p><w:r>',
      '<w:p><w:pPr><w:jc w:val="center"/><w:pStyle w:val="SesPara"/></w:pPr><w:r>',
    )
    expect(() => assertChildOrder(pkg)).toThrow(/顺序错误/)
  })

  it('附录 B 所列容器里出现清单外的子元素时抛错', () => {
    const pkg = clone(buildBasePackage())
    pkg.parts['word/document.xml'] = pkg.parts['word/document.xml'].replace(
      '<w:p><w:r>',
      '<w:p><w:pPr><w:notAThing/></w:pPr><w:r>',
    )
    expect(() => assertChildOrder(pkg)).toThrow(/不在附录 B 清单内/)
  })
})

// ---------------- WP7.2 增补：r:id / r:embed / r:link（assertWellFormed） ----------------

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
const HDR_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function buildPackageWithHeaderRef(): DocxPackage {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document ${HDR_NS}><w:body><w:p><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p>` +
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' +
    '</w:body></w:document>'
  const header1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${HDR_NS}><w:p/></w:hdr>`
  return buildPackage({
    documentXml,
    title: 'r:id 测试包',
    createdAt: '2026-09-25T08:00:00.000Z',
    relatedParts: [
      { id: 'rIdHdr', target: 'word/header1.xml', relationshipType: `${REL}header`, content: header1Xml, contentType: `${WML}header+xml` },
    ],
  })
}

describe('assertWellFormed / r:id 检查（WP7.2 增补）', () => {
  it('r:id 在部件自己的 .rels 里能找到对应 Relationship 时通过', () => {
    expect(() => assertWellFormed(buildPackageWithHeaderRef())).not.toThrow()
  })

  it('r:id 的值在 .rels 里找不到对应 Relationship 时抛错', () => {
    const pkg = clone(buildPackageWithHeaderRef())
    pkg.parts['word/document.xml'] = pkg.parts['word/document.xml'].replace('r:id="rIdHdr"', 'r:id="rIdNope"')
    expect(() => assertWellFormed(pkg)).toThrow(/rIdNope/)
  })

  it('.rels 内 Id 重复时抛错', () => {
    const pkg = clone(buildPackageWithHeaderRef())
    pkg.parts['word/_rels/document.xml.rels'] = pkg.parts['word/_rels/document.xml.rels'].replace(
      /<Relationship Id="rIdHdr"[^>]*\/>/,
      (m) => m + m, // 复制一份同 Id 的 Relationship
    )
    expect(() => assertWellFormed(pkg)).toThrow(/重复/)
  })

  it('部件里有 r:id，但对应的 .rels 文件不存在时抛错（#34 审查）', () => {
    const pkg = clone(buildPackageWithHeaderRef())
    expect(pkg.parts['word/_rels/document.xml.rels']).toBeDefined() // 篡改前确认它本来存在
    delete pkg.parts['word/_rels/document.xml.rels']
    expect(() => assertWellFormed(pkg)).toThrow(/没有对应的关系文件/)
  })
})

// ---------------- WP7.2 增补：assertNumberingIntegrity ----------------

function buildPackageWithNumbering(): DocxPackage {
  const W_NS_R = `${W_NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
  const numberingXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:numbering ${W_NS}>` +
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:suff w:val="nothing"/>' +
    '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr></w:lvl>' +
    '</w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
    '</w:numbering>'
  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TestOwner"><w:name w:val="TestOwner"/><w:qFormat/>' +
    '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' +
    '</w:styles>'
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document ${W_NS_R}><w:body><w:p><w:pPr><w:pStyle w:val="TestOwner"/></w:pPr><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p></w:body></w:document>`
  return buildPackage({
    documentXml,
    title: 'numbering 测试包',
    createdAt: '2026-09-25T08:00:00.000Z',
    stylesXml,
    numberingXml,
  })
}

describe('assertNumberingIntegrity', () => {
  it('合法的包（num 的 abstractNumId 存在、样式 numPr 的 numId 存在）通过', () => {
    expect(() => assertNumberingIntegrity(buildPackageWithNumbering())).not.toThrow()
  })

  it('num 引用的 abstractNumId 不存在时抛错', () => {
    const pkg = clone(buildPackageWithNumbering())
    pkg.parts['word/numbering.xml'] = pkg.parts['word/numbering.xml'].replace(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>',
      '<w:num w:numId="1"><w:abstractNumId w:val="99"/></w:num>',
    )
    expect(() => assertNumberingIntegrity(pkg)).toThrow(/abstractNumId "99" 不存在/)
  })

  it('样式的 numPr 引用的 numId 不在 numbering.xml 中时抛错', () => {
    const pkg = clone(buildPackageWithNumbering())
    pkg.parts['word/styles.xml'] = pkg.parts['word/styles.xml'].replace('w:numId w:val="1"', 'w:numId w:val="999"')
    expect(() => assertNumberingIntegrity(pkg)).toThrow(/numId "999" 不在 numbering\.xml 中/)
  })

  it('段落引用的 numId 不在 numbering.xml 中时抛错', () => {
    const pkg = clone(buildPackageWithNumbering())
    pkg.parts['word/document.xml'] = pkg.parts['word/document.xml'].replace(
      '<w:pStyle w:val="TestOwner"/>',
      '<w:pStyle w:val="TestOwner"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="777"/></w:numPr>',
    )
    expect(() => assertNumberingIntegrity(pkg)).toThrow(/段落引用的 numId "777" 不在/)
  })

  it('段落 numPr 的 numId="0"（显式无编号）不检查、不抛错', () => {
    const pkg = clone(buildPackageWithNumbering())
    pkg.parts['word/document.xml'] = pkg.parts['word/document.xml'].replace(
      '<w:pStyle w:val="TestOwner"/>',
      '<w:pStyle w:val="TestOwner"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>',
    )
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
  })

  it('两个样式的 numPr 引用同一个 (abstractNumId, ilvl) 时抛错（§4.1 约束 1）', () => {
    const pkg = clone(buildPackageWithNumbering())
    pkg.parts['word/styles.xml'] = pkg.parts['word/styles.xml'].replace(
      '</w:styles>',
      '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TestOwner2"><w:name w:val="TestOwner2"/><w:qFormat/>' +
        '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>',
    )
    expect(() => assertNumberingIntegrity(pkg)).toThrow(/同时被样式 "TestOwner" 与 "TestOwner2"/)
  })

  it('包内没有 word/numbering.xml 时抛错', () => {
    const pkg = clone(buildBasePackage())
    expect(() => assertNumberingIntegrity(pkg)).toThrow(/没有 word\/numbering\.xml/)
  })
})
