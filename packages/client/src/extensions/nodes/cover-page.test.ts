import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../editorExtensions'

describe('EditorView 实际扩展链的封面元数据 schema', () => {
  it('真实编辑器 schema 保留五个新增字段并经 JSON 往返映射到 IR', () => {
    const schema = getSchema(createEditorExtensions())
    expect(schema.nodes.coverPage).toBeDefined()
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
