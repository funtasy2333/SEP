import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { CoverPage } from './cover-page'

describe('CoverPage 元数据属性', () => {
  it('五个新增字段经真实 ProseMirror schema JSON 往返后仍可映射到 IR', () => {
    const schema = getSchema([
      StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      CoverPage,
    ])
    const attrs = {
      replaces: 'GB/T 1000—2010',
      consistency: '（ISO 1234:2020，MOD）',
      filingNo: '备案 123',
      industryName: '机械行业',
      regionName: '浙江省',
    }
    const doc = schema.node('doc', null, [
      schema.nodes.coverPage.create(attrs, [schema.nodes.paragraph.create()]),
    ])

    const serialized = JSON.parse(JSON.stringify(doc.toJSON()))
    const restored = schema.nodeFromJSON(serialized)
    expect(restored.toJSON().content?.[0]?.attrs).toMatchObject(attrs)

    const { doc: ir, warnings } = pmToIr(restored.toJSON() as PMJsonNode)
    expect(ir.meta).toMatchObject(attrs)
    expect(warnings).toEqual([])
  })
})
