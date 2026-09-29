import { describe, expect, it } from 'vitest'
import { extractParagraphText } from './paragraphText'
import { parseXml, findChild } from './xmlTree'

describe('extractParagraphText', () => {
  it('提取超链接中的可见 run，忽略 PAGEREF 指令文本', () => {
    const doc = parseXml(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:p><w:hyperlink w:anchor="target"><w:r><w:t>目次条目</w:t></w:r></w:hyperlink>' +
        '<w:r><w:tab/></w:r><w:r><w:instrText>PAGEREF target \\h</w:instrText></w:r></w:p></w:document>',
    )
    expect(extractParagraphText(findChild(doc, 'w:p')!)).toBe('目次条目⇥')
  })
})
