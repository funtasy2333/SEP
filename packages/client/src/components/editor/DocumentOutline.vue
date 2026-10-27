<template>
  <div class="document-outline">
    <div class="outline-header">
      <span class="outline-title">文档结构</span>
      <div class="outline-actions"><slot name="actions" /></div>
    </div>
    <div class="outline-body">
      <div
        v-for="(item, index) in headings"
        :key="index"
        class="outline-item"
        :class="{
          active: activeIndex === index,
          'is-top': item.level === 1,
          'drag-over-above': dragOverIndex === index && dragPosition === 'above',
          'drag-over-below': dragOverIndex === index && dragPosition === 'below',
          dragging: dragIndex === index,
        }"
        :style="{ paddingLeft: (item.level - 1) * 14 + 18 + 'px' }"
        :draggable="item.level === 1"
        @click="scrollToHeading(item)"
        @dragstart="onDragStart(index, $event)"
        @dragover="onDragOver(index, $event)"
        @dragleave="onDragLeave"
        @drop="onDrop(index, $event)"
        @dragend="onDragEnd"
      >
        <el-icon v-if="item.level === 1" class="outline-item-drag"><Rank /></el-icon>
        <span class="outline-item-text">{{ item.text || '(空标题)' }}</span>
        <el-icon
          v-if="item.deletable"
          class="outline-item-delete"
          title="删除此节及其全部内容"
          @click.stop="deleteSection(item)"
        >
          <Close />
        </el-icon>
      </div>
      <div v-if="headings.length === 0" class="outline-empty">
        暂无章节。使用上方「添加」插入前言、章或附录。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Close, Rank } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import type { Editor } from '@tiptap/vue-3'
import { pmToIr, resolve } from '@ses/shared'

const props = defineProps<{
  editor: Editor | undefined
}>()

interface HeadingItem {
  level: number
  text: string
  pos: number
  /** 所属节点在文档中的起始位置（用于删除/移动） */
  nodePos: number
  /** 所属节点大小（用于删除/移动） */
  nodeSize: number
  /** 是否可删除 */
  deletable: boolean
}

const headings = ref<HeadingItem[]>([])
const activeIndex = ref(-1)

// === Drag & Drop ===
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const dragPosition = ref<'above' | 'below'>('below')

function onDragStart(index: number, e: DragEvent) {
  const item = headings.value[index]
  if (item.level !== 1) {
    e.preventDefault()
    return
  }
  dragIndex.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, e: DragEvent) {
  if (dragIndex.value === null) return
  const dragItem = headings.value[dragIndex.value]
  const overItem = headings.value[index]
  // 只允许同级（level 1）之间拖拽
  if (overItem.level !== 1 || dragItem.level !== 1) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  dragPosition.value = e.clientY < midY ? 'above' : 'below'
  dragOverIndex.value = index
}

function onDragLeave() {
  dragOverIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}

function onDrop(targetIndex: number, e: DragEvent) {
  e.preventDefault()
  if (!props.editor || dragIndex.value === null) {
    onDragEnd()
    return
  }
  const sourceIndex = dragIndex.value
  if (sourceIndex === targetIndex) {
    onDragEnd()
    return
  }

  const sourceItem = headings.value[sourceIndex]
  const targetItem = headings.value[targetIndex]
  if (sourceItem.level !== 1 || targetItem.level !== 1) {
    onDragEnd()
    return
  }

  const { tr } = props.editor.state
  const sourceNode = tr.doc.nodeAt(sourceItem.nodePos)
  if (!sourceNode) {
    onDragEnd()
    return
  }

  // 计算目标位置
  let insertPos: number
  if (dragPosition.value === 'above') {
    insertPos = targetItem.nodePos
  } else {
    insertPos = targetItem.nodePos + targetItem.nodeSize
  }

  // 如果源在目标之前，先删除源，位置需要调整
  if (sourceItem.nodePos < insertPos) {
    tr.delete(sourceItem.nodePos, sourceItem.nodePos + sourceItem.nodeSize)
    insertPos -= sourceItem.nodeSize
    tr.insert(insertPos, sourceNode)
  } else {
    tr.insert(insertPos, sourceNode)
    tr.delete(
      sourceItem.nodePos + sourceNode.nodeSize,
      sourceItem.nodePos + sourceNode.nodeSize + sourceItem.nodeSize,
    )
  }

  props.editor.view.dispatch(tr)
  onDragEnd()
}

function updateActiveIndex() {
  if (!props.editor || headings.value.length === 0) return
  const { from } = props.editor.state.selection
  let idx = -1
  for (let i = 0; i < headings.value.length; i++) {
    if (headings.value[i].pos <= from) idx = i
    else break
  }
  activeIndex.value = idx
}

function updateHeadings() {
  if (!props.editor) return
  const items: HeadingItem[] = []
  const labels = resolve(pmToIr(props.editor.state.doc.toJSON()).doc).labels
  const labelFor = (id: string) => labels[id]?.label ?? '?'

  props.editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'foreword') {
      items.push({ level: 1, text: '前言', pos, nodePos: pos, nodeSize: node.nodeSize, deletable: true })
      return false
    } else if (node.type.name === 'introduction') {
      items.push({ level: 1, text: '引言', pos, nodePos: pos, nodeSize: node.nodeSize, deletable: true })
      // 继续递归进引言内部，引言中的条（0.1、0.1.1，GB/T 1.1 8.4）要出现在大纲里
    } else if (node.type.name === 'chapter') {
      node.forEach((child, offset) => {
        if (child.type.name === 'chapterTitle') {
          items.push({
            level: 1,
            text: `${labelFor(node.attrs.nodeId)} ${child.textContent || '(空标题)'}`,
            pos: pos + offset + 1,
            nodePos: pos,
            nodeSize: node.nodeSize,
            deletable: true,
          })
        }
      })
      // 继续递归进章内部，以找到条
    } else if (node.type.name === 'appendix') {
      const appendixLabel = labelFor(node.attrs.nodeId)
      node.forEach((child, offset) => {
        if (child.type.name === 'appendixTitle') {
          const title = child.textContent
          items.push({
            level: 1,
            text: title ? `${appendixLabel} ${title}` : appendixLabel,
            pos: pos + offset + 1,
            nodePos: pos,
            nodeSize: node.nodeSize,
            deletable: true,
          })
        }
      })
      // 继续递归进附录内部，以找到条
    } else if (node.type.name === 'clause') {
      // 无题条不展示在大纲中
      if (node.attrs.hasTitle === false) return false
      const level = node.attrs.level || 1
      const numStr = labelFor(node.attrs.nodeId)
      node.forEach((child, offset) => {
        if (child.type.name === 'clauseTitle') {
          const title = child.textContent
          items.push({
            level: numStr === '?' ? level + 1 : numStr.split('.').length,
            text: title ? `${numStr} ${title}` : numStr,
            pos: pos + offset + 1,
            nodePos: pos,
            nodeSize: node.nodeSize,
            deletable: true,
          })
        }
      })
    } else if (node.type.name === 'termDef') {
      const level = node.attrs.level || 1
      const numStr = labelFor(node.attrs.nodeId)
      node.forEach((child, offset) => {
        if (child.type.name === 'termName') {
          const title = child.textContent
          items.push({
            level: numStr === '?' ? level + 1 : numStr.split('.').length,
            text: title ? `${numStr} ${title}` : numStr,
            pos: pos + offset + 1,
            nodePos: pos,
            nodeSize: node.nodeSize,
            deletable: true,
          })
        }
      })
    } else if (node.type.name === 'bibliography') {
      items.push({ level: 1, text: '参考文献', pos, nodePos: pos, nodeSize: node.nodeSize, deletable: true })
      return false
    }
  })
  headings.value = items
}

function scrollToHeading(item: HeadingItem) {
  if (!props.editor) return
  props.editor.chain().focus().setTextSelection(item.pos + 1).run()
}

async function deleteSection(item: HeadingItem) {
  if (!props.editor) return
  try {
    await ElMessageBox.confirm(`删除「${item.text || '(空标题)'}」及其下全部内容？删除后可用撤销（Ctrl+Z）恢复。`, '删除章节', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const editor = props.editor
  // 确认期间文档可能已变化：按位置重新核对，节点不再是原来那一个时放弃删除
  const node = editor.state.doc.nodeAt(item.nodePos)
  if (!node || node.nodeSize !== item.nodeSize) return
  const { tr } = editor.state
  tr.delete(item.nodePos, item.nodePos + item.nodeSize)
  editor.view.dispatch(tr)
}

watch(
  () => props.editor?.state.doc,
  () => {
    updateHeadings()
    updateActiveIndex()
  },
  { immediate: true },
)

watch(
  () => props.editor?.state.selection,
  () => updateActiveIndex(),
)
</script>

<style scoped>
.document-outline {
  width: 248px;
  height: 100%;
  min-height: 0;
  border-right: 1px solid var(--ses-line);
  display: flex;
  flex-direction: column;
  background: var(--ses-surface);
  overflow: hidden;
}

.outline-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 44px;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid var(--ses-line);
}
.outline-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ses-ink);
}
.outline-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.outline-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 8px 24px;
  scrollbar-width: thin;
}
.outline-body::-webkit-scrollbar { width: 8px; }
.outline-body::-webkit-scrollbar-thumb {
  background: var(--ses-line-2);
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.outline-body::-webkit-scrollbar-thumb:hover {
  background: var(--ses-ink-4);
  background-clip: padding-box;
  border: 2px solid transparent;
}

.outline-item {
  padding: 5px 10px;
  margin: 1px 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12.5px;
  color: var(--ses-ink-3);
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.1s ease, color 0.1s ease;
  line-height: 1.4;
  position: relative;
}

/* 章、附录、前言等顶层要素加重，与其下的条拉开层级 */
.outline-item.is-top {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ses-ink);
}
.outline-item.is-top:first-child { margin-top: 0; }

.outline-item.dragging { opacity: 0.4; }
.outline-item.drag-over-above { box-shadow: inset 0 2px 0 var(--ses-accent); }
.outline-item.drag-over-below { box-shadow: inset 0 -2px 0 var(--ses-accent); }

/* 拖动柄放在左侧留白里，不推挤标题文字，保证同级条目文字对齐 */
.outline-item-drag {
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--ses-ink-4);
  opacity: 0;
  transition: opacity 0.12s ease;
  cursor: grab;
  -webkit-user-select: none;
  user-select: none;
}
.outline-item:hover .outline-item-drag { opacity: 1; }

.outline-item-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-item-delete {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ses-ink-4);
  opacity: 0;
  transition: opacity 0.12s ease;
  border-radius: 4px;
  padding: 2px;
}
.outline-item:hover .outline-item-delete { opacity: 1; }
.outline-item-delete:hover { color: var(--ses-err) !important; background: var(--ses-err-soft); }

.outline-item:hover {
  background: var(--ses-surface-2);
  color: var(--ses-ink);
}

.outline-item.active {
  color: var(--ses-accent);
  font-weight: 600;
  background: var(--ses-accent-soft);
}

.outline-empty {
  padding: 24px 12px;
  line-height: 1.6;
  color: var(--ses-ink-4);
  font-size: 12.5px;
  text-align: center;
}
</style>
