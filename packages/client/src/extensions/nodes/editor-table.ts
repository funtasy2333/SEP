import { Table } from '@tiptap/extension-table'
import { NodeSelection } from '@tiptap/pm/state'
import { columnResizingPluginKey, isInTable, selectedRect } from '@tiptap/pm/tables'
import type { EditorState } from '@tiptap/pm/state'

function standardTableRange(state: EditorState): { from: number; to: number } | null {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type.name === 'stdTable') return { from: selection.from, to: selection.to }
  const $pos = selection.$anchor
  let gridDepth = selection instanceof NodeSelection && selection.node.type.name === 'table' ? $pos.depth + 1 : -1
  for (let depth = $pos.depth; depth > 0; depth--) {
    const name = $pos.node(depth).type.name
    if (name === 'table') {
      if (gridDepth !== -1) return null // A nested bare grid belongs to itself.
      gridDepth = depth
    }
    if (name === 'stdTable') {
      if (gridDepth !== -1 && gridDepth !== depth + 1) return null
      return { from: $pos.before(depth), to: $pos.after(depth) }
    }
  }
  return null
}

function isInScaledTable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.tableWrapper[data-landscape-scale]') !== null
}

/** Deleting the grid alone makes the schema recreate a required table inside stdTable. */
export const EditorTable = Table.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent!()
    const resize = plugins.find(plugin => plugin.spec.key === columnResizingPluginKey)
    const events = resize?.props.handleDOMEvents
    if (!resize || !events) return plugins

    // Keep normal ProseMirror mouse handling available for selection inside scaled previews.
    const { mousemove, mousedown, mouseleave } = events
    events.mousemove = (view, event) => {
      if (isInScaledTable(event.target)) {
        mouseleave?.call(resize, view, event)
        return false
      }
      return mousemove?.call(resize, view, event)
    }
    events.mousedown = (view, event) => {
      const activeHandle = columnResizingPluginKey.getState(view.state)?.activeHandle ?? -1
      // The preview may have scaled since the last mousemove activated this handle.
      if (isInScaledTable(event.target) || (activeHandle >= 0 && isInScaledTable(view.nodeDOM(activeHandle)))) {
        mouseleave?.call(resize, view, event)
        return false
      }
      return mousedown?.call(resize, view, event)
    }
    return plugins
  },

  addCommands() {
    const base = this.parent!()
    return {
      ...base,
      deleteTable: () => props => {
        const range = standardTableRange(props.state)
        if (!range) return base.deleteTable!()(props)
        if (props.dispatch) props.tr.delete(range.from, range.to).scrollIntoView()
        return true
      },
      deleteRow: () => props => {
        if (standardTableRange(props.state) && isInTable(props.state)) {
          const rect = selectedRect(props.state)
          if (rect.bottom - rect.top === rect.map.height) return props.commands.deleteTable()
        }
        return base.deleteRow!()(props)
      },
      deleteColumn: () => props => {
        if (standardTableRange(props.state) && isInTable(props.state)) {
          const rect = selectedRect(props.state)
          if (rect.right - rect.left === rect.map.width) return props.commands.deleteTable()
        }
        return base.deleteColumn!()(props)
      },
    }
  },
})
