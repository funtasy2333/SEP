// @vitest-environment happy-dom
import { Editor, getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../editorExtensions'

describe('EditorView 实际扩展链的封面元数据 schema', () => {
  it('实际编辑器DOM隐藏只供导出的元数据容器，不暴露会被导出忽略的输入区', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions: createEditorExtensions(), content: {
      type: 'doc', content: [
        { type: 'coverPage', attrs: { titleCn: '封面名称', standardNo: 'GB/T XXXXX—XXXX' }, content: [{ type: 'paragraph' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '可编辑正文' }] },
      ],
    } })
    try {
      const cover = element.querySelector<HTMLElement>('[data-type="cover-page"]')!
      expect(cover.hidden).toBe(true)
      expect(cover.getAttribute('aria-hidden')).toBe('true')
      expect(cover.contentEditable).toBe('false')
      expect(editor.schema.nodes.coverPage.spec.atom).toBe(true)
      expect(editor.schema.nodes.coverPage.spec.selectable).toBe(false)
      expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ titleCn: '封面名称', standardNo: 'GB/T XXXXX—XXXX' })
      expect(editor.getText()).toContain('可编辑正文')
      expect(pmToIr(editor.getJSON() as PMJsonNode).doc.meta).toMatchObject({ title: '封面名称', stdCode: 'GB/T XXXXX—XXXX' })
    } finally {
      editor.destroy()
      element.remove()
    }
  })

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
