import { Extension, getTextBetween, getTextSerializersFromSchema } from '@tiptap/core'
import { DOMSerializer, Fragment, Slice, type ResolvedPos, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { visibleBlockRange } from '../../utils/selectionRange'

/**
 * 剪贴板策略：
 * - SES 内复制、剪切的内容保留格式与结构（上下标、表格、公式、交叉引用、条……）：剪贴板 HTML 带 {@link SES_CLIPBOARD_ATTR} 标记；
 * - 来自 Word、网页、其他编辑器等外部来源的 HTML（没有该标记）一律按纯文本粘贴，不带入外部样式与结构；
 * - Ctrl/Cmd+Shift+V（ProseMirror 的 shift 粘贴）始终按纯文本粘贴，包括 SES 内复制的内容；
 * - 纯文本一律插入光标所在的文本块，沿用该处格式（正文段、列项、注、条标题、单元格……都一样），不新建段落或条目；
 *   多行内容合并为一行（见 {@link joinPlainTextLines}）。需要新段落、新条目时由用户按回车。
 * - 复制（剪切、拖动）的选区终点落在下一块开头、或起点落在上一块末尾时，那一块屏幕上没有被选中，
 *   不放进剪贴板（见 {@link visibleCopiedSlice}）：否则会带上一个空的列项/段落，粘贴后多出空白条目。
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

const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F]/u

/**
 * 多行纯文本合并为一行：每行去掉首尾空白、跳过空行；相邻两行在中文（含全角标点）一侧直接相连，
 * 两侧都不是中文时（英文、数字）补一个空格。制表符（如 Word 表格复制出的列分隔）视为空格。单行文本原样保留。
 */
export function joinPlainTextLines(text: string): string {
  if (!/[\r\n]/.test(text)) return text.replace(/\t/g, ' ')
  const lines = text.split(/\r\n?|\n/).map(line => line.replace(/\t/g, ' ').trim()).filter(Boolean)
  return lines.reduce((joined, line) => {
    if (!joined) return line
    const glue = CJK.test(joined[joined.length - 1]!) || CJK.test(line[0]!) ? '' : ' '
    return joined + glue + line
  }, '')
}

/** 纯文本 → 只含行内文字的切片：插入光标所在文本块，带上光标处的 marks（与输入文字一致）。 */
export function plainTextSlice(text: string, $context: ResolvedPos, schema: Schema): Slice {
  const joined = joinPlainTextLines(text)
  if (!joined) return Slice.empty
  return new Slice(Fragment.from(schema.text(joined, $context.marks())), 0, 0)
}

/**
 * 复制当前文本选区时，按用户看到的范围（{@link visibleBlockRange}）生成切片。
 * 只处理由当前选区生成的切片；其他来源（节点选区、单元格选区、调用方自给的切片）原样返回。
 */
export function visibleCopiedSlice(slice: Slice, view: EditorView): Slice {
  const { selection, doc } = view.state
  if (!(selection instanceof TextSelection) || selection.empty) return slice
  const range = visibleBlockRange(doc, selection.from, selection.to)
  if (range.from === selection.from && range.to === selection.to) return slice
  if (!slice.eq(selection.content())) return slice
  return doc.slice(range.from, range.to, true)
}

/**
 * 与 {@link visibleCopiedSlice} 一致的纯文本：Tiptap 自带的剪贴板纯文本按原选区取文字，会多出一个空行。
 * 选区不需要裁剪时返回 undefined。
 */
export function visibleCopiedText(view: EditorView): string | undefined {
  const { selection, doc, schema } = view.state
  if (!(selection instanceof TextSelection) || selection.empty) return undefined
  const range = visibleBlockRange(doc, selection.from, selection.to)
  if (range.from === selection.from && range.to === selection.to) return undefined
  return getTextBetween(doc, range, { textSerializers: getTextSerializersFromSchema(schema) })
}

export const clipboardPolicyPluginKey = new PluginKey('clipboardPolicy')

export function clipboardPolicyPlugin(schema: Schema): Plugin {
  return new Plugin({
    key: clipboardPolicyPluginKey,
    props: {
      clipboardSerializer: clipboardSerializer(schema),
      transformCopied: visibleCopiedSlice,
      // 返回空串（不需要裁剪）时 ProseMirror 继续询问下一个插件，即 Tiptap 自带的序列化。
      clipboardTextSerializer: (_slice, view) => visibleCopiedText(view) ?? '',
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
