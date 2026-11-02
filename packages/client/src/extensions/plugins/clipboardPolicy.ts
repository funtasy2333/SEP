import { Extension } from '@tiptap/core'
import { DOMSerializer, Fragment, Slice, type Node as PMNode, type ResolvedPos, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * 剪贴板策略：
 * - SES 内复制、剪切的内容保留格式与结构（上下标、表格、公式、交叉引用、条……）：剪贴板 HTML 带 {@link SES_CLIPBOARD_ATTR} 标记；
 * - 来自 Word、网页、其他编辑器等外部来源的 HTML（没有该标记）一律按纯文本粘贴，不带入外部样式与结构；
 * - Ctrl/Cmd+Shift+V（ProseMirror 的 shift 粘贴）始终按纯文本粘贴，包括 SES 内复制的内容；
 * - 纯文本按行拆段：每行一个正文段（光标在表格单元格等普通 paragraph 中时为 paragraph），连续空行合并，
 *   第一行并入光标所在段落，与带格式粘贴的合并方式一致。
 */

export const SES_CLIPBOARD_ATTR = 'data-ses-clipboard'

/** 在 SES 生成的剪贴板 HTML 上做标记；纯行内内容（首个子节点是文字）整体包一层 span 以便携带标记。 */
class SesClipboardSerializer extends DOMSerializer {
  serializeFragment(fragment: Fragment, options: { document?: Document } = {}, target?: HTMLElement | DocumentFragment) {
    const result = super.serializeFragment(fragment, options, target)
    const first = result.firstChild
    if (first && first.nodeType === 1) {
      (first as HTMLElement).setAttribute(SES_CLIPBOARD_ATTR, '1')
      return result
    }
    const doc = options.document ?? (typeof document !== 'undefined' ? document : null)
    if (!first || !doc) return result
    const wrapper = doc.createElement('span')
    wrapper.setAttribute(SES_CLIPBOARD_ATTR, '1')
    while (result.firstChild) wrapper.appendChild(result.firstChild)
    result.appendChild(wrapper)
    return result
  }
}

const serializers = new WeakMap<Schema, SesClipboardSerializer>()
function clipboardSerializer(schema: Schema): SesClipboardSerializer {
  let serializer = serializers.get(schema)
  if (!serializer) {
    const base = DOMSerializer.fromSchema(schema)
    serializer = new SesClipboardSerializer(base.nodes, base.marks)
    serializers.set(schema, serializer)
  }
  return serializer
}

/** 剪贴板 HTML 是否由 SES 生成。 */
export function isSesClipboardHtml(html: string): boolean {
  return html.includes(SES_CLIPBOARD_ATTR)
}

/** 纯文本 → 段落切片：光标所在文本块是普通 paragraph（表格单元格等）时沿用 paragraph，其余位置用正文段 stdParagraph。 */
export function plainTextSlice(text: string, $context: ResolvedPos, schema: Schema): Slice {
  const type = $context.parent.type.name === 'paragraph' ? schema.nodes.paragraph! : schema.nodes.stdParagraph!
  const marks = $context.marks()
  const blocks: PMNode[] = text.split(/(?:\r\n?|\n)+/).map(line => type.create(null, line ? schema.text(line, marks) : null))
  return new Slice(Fragment.from(blocks), 1, 1)
}

export const clipboardPolicyPluginKey = new PluginKey('clipboardPolicy')

export function clipboardPolicyPlugin(schema: Schema): Plugin {
  return new Plugin({
    key: clipboardPolicyPluginKey,
    props: {
      clipboardSerializer: clipboardSerializer(schema),
      clipboardTextParser(text, $context, _plain, view) {
        return plainTextSlice(text, $context, view.state.schema)
      },
      handlePaste(view: EditorView, event: ClipboardEvent) {
        const data = event.clipboardData
        if (!data) return false
        const html = data.getData('text/html')
        const text = data.getData('text/plain')
        // 外部来源的富文本：改按纯文本粘贴。pasteText 以无剪贴板数据的新事件重入，不会再次进入本分支。
        if (!html || isSesClipboardHtml(html) || !text) return false
        view.pasteText(text)
        return true
      },
    },
  })
}

export const ClipboardPolicy = Extension.create({
  name: 'clipboardPolicy',
  // 先于其他粘贴处理（链接、nodeId 重映射、章条结构检查）运行：外部内容先转成纯文本，再走统一的检查。
  priority: 1200,
  addProseMirrorPlugins() {
    return [clipboardPolicyPlugin(this.editor.schema)]
  },
})
