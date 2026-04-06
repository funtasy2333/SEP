<template>
  <div class="document-outline">
    <div class="outline-header">
      <el-icon><Document /></el-icon>
      <span>文档大纲</span>
    </div>
    <div class="outline-body">
      <div
        v-for="(item, index) in headings"
        :key="index"
        class="outline-item"
        :class="{
          active: activeIndex === index,
          'drag-over-above': dragOverIndex === index && dragPosition === 'above',
          'drag-over-below': dragOverIndex === index && dragPosition === 'below',
          dragging: dragIndex === index,
        }"
        :style="{ paddingLeft: (item.level - 1) * 16 + 8 + 'px' }"
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
          @click.stop="deleteSection(item)"
        >
          <Close />
        </el-icon>
      </div>
      <div v-if="headings.length === 0" class="outline-empty">
        暂无标题
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Document, Close, Rank } from '@element-plus/icons-vue'
import type { Editor } from '@tiptap/vue-3'

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
  let chapterCount = 0
  let appendixCount = 0
  let currentAppendixLetter = ''
  const clauseCounters = [0, 0, 0, 0, 0]

  props.editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'foreword') {
      items.push({ level: 1, text: '前言', pos, nodePos: pos, nodeSize: node.nodeSize, deletable: true })
      return false
    } else if (node.type.name === 'introduction') {
      items.push({ level: 1, text: '引言', pos, nodePos: pos, nodeSize: node.nodeSize, deletable: true })
      return false
    } else if (node.type.name === 'chapter') {
      chapterCount++
      currentAppendixLetter = ''
      clauseCounters.fill(0)
      node.forEach((child, offset) => {
        if (child.type.name === 'chapterTitle') {
          items.push({
            level: 1,
            text: `${chapterCount} ${child.textContent || '(空标题)'}`,
            pos: pos + offset + 1,
            nodePos: pos,
            nodeSize: node.nodeSize,
            deletable: true,
          })
        }
      })
      // 继续递归进章内部，以找到条
    } else if (node.type.name === 'appendix') {
      appendixCount++
      currentAppendixLetter = String.fromCharCode(64 + appendixCount)
      clauseCounters.fill(0)
      node.forEach((child, offset) => {
        if (child.type.name === 'appendixTitle') {
          const title = child.textContent
          items.push({
            level: 1,
            text: title ? `附录${currentAppendixLetter} ${title}` : `附录${currentAppendixLetter}`,
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
      clauseCounters[level - 1]++
      for (let i = level; i < 5; i++) clauseCounters[i] = 0
      const prefix = currentAppendixLetter || String(chapterCount)
      const numParts = [prefix, ...clauseCounters.slice(0, level)]
      const numStr = numParts.join('.')
      node.forEach((child, offset) => {
        if (child.type.name === 'clauseTitle') {
          const title = child.textContent
          items.push({
            level: level + 1,
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
      clauseCounters[level - 1]++
      for (let i = level; i < 5; i++) clauseCounters[i] = 0
      const prefix = currentAppendixLetter || String(chapterCount)
      const numParts = [prefix, ...clauseCounters.slice(0, level)]
      const numStr = numParts.join('.')
      node.forEach((child, offset) => {
        if (child.type.name === 'termName') {
          const title = child.textContent
          items.push({
            level: level + 1,
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

function deleteSection(item: HeadingItem) {
  if (!props.editor) return
  const { tr } = props.editor.state
  tr.delete(item.nodePos, item.nodePos + item.nodeSize)
  props.editor.view.dispatch(tr)
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
  width: 240px;
  border-right: 1px solid var(--el-border-color);
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}

.outline-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  font-weight: bold;
  font-size: 14px;
  border-bottom: 1px solid var(--el-border-color);
}

.outline-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.outline-item {
  padding: 6px 8px;
  cursor: default;
  font-size: 13px;
  color: var(--el-text-color-regular);
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background 0.15s;
}

.outline-item.dragging {
  opacity: 0.4;
}

.outline-item.drag-over-above {
  border-top: 2px solid var(--el-color-primary);
}

.outline-item.drag-over-below {
  border-bottom: 2px solid var(--el-color-primary);
}

.outline-item-drag {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  opacity: 0;
  transition: opacity 0.15s;
  cursor: grab;
  -webkit-user-select: none;
  user-select: none;
}

.outline-item:hover .outline-item-drag {
  opacity: 1;
}

.outline-item-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-item-delete {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  opacity: 0;
  transition: opacity 0.15s;
}

.outline-item:hover .outline-item-delete {
  opacity: 1;
}

.outline-item-delete:hover {
  color: var(--el-color-danger) !important;
}

.outline-item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}

.outline-item.active {
  color: var(--el-color-primary);
  font-weight: 600;
  background: var(--el-color-primary-light-9);
  border-right: 2px solid var(--el-color-primary);
}

.outline-empty {
  padding: 16px;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  text-align: center;
}
</style>
