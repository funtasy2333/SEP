/**
 * assertWellFormed / assertChildOrder 的反例测试（审查第 6 条：「检查器从未被证明能失败」）。
 *
 * 从一个已知合法的包出发（深拷贝，不改动原对象），逐项篡改，验证每种篡改都会被对应的检查
 * 函数抓出来。正例（合法包能通过）也各留一条，避免只测「会抛错」而不测「不误抛」。
 */
import { describe, expect, it } from 'vitest'
import { buildPackage, type DocxRelatedPart } from '../../package'
import type { DocxPackage } from '../../types'
import { assertChildOrder, assertWellFormed } from './checks'

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
