/**
 * buildPackage 的分支测试（审查第 7 条：「buildPackage 的分支没有测试」）。
 * minimal.test.ts 只练到了「不带任何可选部件」这一条路径；这里补关联部件（页眉、图片）、
 * styles/numbering、以及输入校验失败的分支。
 */
import { describe, expect, it } from 'vitest'
import { assertChildOrder, assertWellFormed } from './__tests__/helpers/checks'
import { buildPackage, createRelationshipIdAllocator } from './package'

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function documentXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document ${W_NS}><w:body><w:p><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p></w:body></w:document>`
  )
}

describe('createRelationshipIdAllocator', () => {
  it('依次发放 rId1、rId2……', () => {
    const allocate = createRelationshipIdAllocator()
    expect(allocate()).toBe('rId1')
    expect(allocate()).toBe('rId2')
    expect(allocate()).toBe('rId3')
  })

  it('每次调用互不干扰（各自独立的计数器）', () => {
    const a = createRelationshipIdAllocator()
    const b = createRelationshipIdAllocator()
    expect(a()).toBe('rId1')
    expect(a()).toBe('rId2')
    expect(b()).toBe('rId1')
  })
})

describe('buildPackage / 关联部件（页眉 + 图片）', () => {
  it('用分配器申请两个 ID，挂一个 XML 部件与一个二进制部件', () => {
    const allocate = createRelationshipIdAllocator()
    const headerId = allocate()
    const imageId = allocate()
    expect(headerId).toBe('rId1')
    expect(imageId).toBe('rId2')

    const pkg = buildPackage({
      documentXml: documentXml(),
      title: '带页眉与图片的包',
      createdAt: '2026-09-25T08:00:00.000Z',
      relatedParts: [
        {
          id: headerId,
          target: 'word/header1.xml',
          relationshipType: `${REL}header`,
          content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W_NS}/>`,
          contentType: `${WML}header+xml`,
        },
        {
          id: imageId,
          target: 'word/media/image1.png',
          relationshipType: `${REL}image`,
          content: 'iVBORw0KGgo=',
          binary: true,
        },
      ],
    })

    // 关系 Target 相对 word/ 目录
    const docRels = pkg.parts['word/_rels/document.xml.rels']
    expect(docRels).toContain(`Id="rId1" Type="${REL}header" Target="header1.xml"`)
    expect(docRels).toContain(`Id="rId2" Type="${REL}image" Target="media/image1.png"`)

    // header 有 Override，png 有 Default
    expect(pkg.parts['[Content_Types].xml']).toContain(`PartName="/word/header1.xml" ContentType="${WML}header+xml"`)
    expect(pkg.parts['[Content_Types].xml']).toContain('Extension="png" ContentType="image/png"')

    // styles/settings/fontTable/numbering 的关系 ID 接在调用方最大 ID（rId2）之后
    expect(docRels).toContain(`Id="rId3" Type="${REL}settings" Target="settings.xml"`)
    expect(docRels).toContain(`Id="rId4" Type="${REL}fontTable" Target="fontTable.xml"`)

    expect(pkg.binaries['word/media/image1.png']).toBe('iVBORw0KGgo=')
    expect(pkg.parts['word/header1.xml']).toContain('<w:hdr')

    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
  })
})

describe('buildPackage / styles、numbering 可选部件', () => {
  it('传入 stylesXml、numberingXml 时，部件、Override、关系都齐全', () => {
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}/>`
    const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W_NS}/>`
    const pkg = buildPackage({
      documentXml: documentXml(),
      title: '带 styles/numbering 的包',
      createdAt: '2026-09-25T08:00:00.000Z',
      stylesXml,
      numberingXml,
    })

    expect(pkg.parts['word/styles.xml']).toBe(stylesXml)
    expect(pkg.parts['word/numbering.xml']).toBe(numberingXml)
    expect(pkg.parts['[Content_Types].xml']).toContain(`PartName="/word/styles.xml" ContentType="${WML}styles+xml"`)
    expect(pkg.parts['[Content_Types].xml']).toContain(`PartName="/word/numbering.xml" ContentType="${WML}numbering+xml"`)

    const docRels = pkg.parts['word/_rels/document.xml.rels']
    // 没有 relatedParts，调用方「已用 ID」为空集，styles 从 rId1 开始，按 styles→settings→
    // fontTable→numbering 的固定顺序接续
    expect(docRels).toContain(`Id="rId1" Type="${REL}styles" Target="styles.xml"`)
    expect(docRels).toContain(`Id="rId2" Type="${REL}settings" Target="settings.xml"`)
    expect(docRels).toContain(`Id="rId3" Type="${REL}fontTable" Target="fontTable.xml"`)
    expect(docRels).toContain(`Id="rId4" Type="${REL}numbering" Target="numbering.xml"`)

    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
  })

  it('不传 stylesXml/numberingXml 时不生成对应部件，也不登记关系', () => {
    const pkg = buildPackage({
      documentXml: documentXml(),
      title: '无 styles/numbering',
      createdAt: '2026-09-25T08:00:00.000Z',
    })
    expect(pkg.parts['word/styles.xml']).toBeUndefined()
    expect(pkg.parts['word/numbering.xml']).toBeUndefined()
    expect(pkg.parts['[Content_Types].xml']).not.toContain('styles.xml')
    expect(pkg.parts['[Content_Types].xml']).not.toContain('numbering.xml')
  })
})

describe('buildPackage / 标题含 XML 1.0 不允许的字符（审查第 2 条集成测试）', () => {
  it('标题含 U+0000、U+000B 时仍打出合法包，core.xml 里这两个字符已被删除', () => {
    const pkg = buildPackage({
      documentXml: documentXml(),
      title: '标题\u0000含\u000B控制字符',
      createdAt: '2026-09-25T08:00:00.000Z',
    })
    const core = pkg.parts['docProps/core.xml']
    expect(core).not.toContain('\u0000')
    expect(core).not.toContain('\u000B')
    expect(core).toContain('<dc:title>标题含控制字符</dc:title>')
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
  })
})

describe('buildPackage / 输入校验', () => {
  it('XML 关联部件缺 contentType 时抛错', () => {
    expect(() =>
      buildPackage({
        documentXml: documentXml(),
        title: 'x',
        createdAt: '2026-09-25T08:00:00.000Z',
        relatedParts: [{ id: 'rId1', target: 'word/header1.xml', relationshipType: `${REL}header`, content: '<a/>' }],
      }),
    ).toThrow(/contentType/)
  })

  it('二进制关联部件扩展名未知且未提供 contentType 时抛错', () => {
    expect(() =>
      buildPackage({
        documentXml: documentXml(),
        title: 'x',
        createdAt: '2026-09-25T08:00:00.000Z',
        relatedParts: [
          {
            id: 'rId1',
            target: 'word/media/image1.weird',
            relationshipType: `${REL}image`,
            content: 'AAAA',
            binary: true,
          },
        ],
      }),
    ).toThrow(/内容类型/)
  })

  it('二进制关联部件扩展名未知但显式提供 contentType 时不抛错', () => {
    const pkg = buildPackage({
      documentXml: documentXml(),
      title: 'x',
      createdAt: '2026-09-25T08:00:00.000Z',
      relatedParts: [
        {
          id: 'rId1',
          target: 'word/media/image1.weird',
          relationshipType: `${REL}image`,
          content: 'AAAA',
          binary: true,
          contentType: 'application/octet-stream',
        },
      ],
    })
    expect(pkg.parts['[Content_Types].xml']).toContain('Extension="weird" ContentType="application/octet-stream"')
  })
})
