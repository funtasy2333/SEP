<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="slash-menu"
      :style="{ left: position.left + 'px', top: position.top + 'px' }"
    >
      <div class="slash-menu-search">
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          class="slash-menu-input"
          placeholder="搜索节点类型..."
          @keydown.down.prevent="moveSelection(1)"
          @keydown.up.prevent="moveSelection(-1)"
          @keydown.enter.prevent="executeSelected"
          @keydown.escape.prevent="close"
        />
      </div>
      <div class="slash-menu-items">
        <template v-for="(group, gIdx) in groupedItems" :key="gIdx">
          <div class="slash-menu-group">{{ group.name }}</div>
          <div
            v-for="item in group.items"
            :key="item.command"
            class="slash-menu-item"
            :class="{ selected: selectedIndex === flatItems.indexOf(item) }"
            @click="executeItem(item)"
            @mouseenter="selectedIndex = flatItems.indexOf(item)"
          >
            <span class="slash-menu-item-label">{{ item.label }}</span>
            <span class="slash-menu-item-desc">{{ item.description }}</span>
          </div>
        </template>
        <div v-if="flatItems.length === 0" class="slash-menu-empty">
          无匹配项
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import type { SlashMenuItem } from '@/extensions/plugins/slashCommand'

const emit = defineEmits<{
  (e: 'execute', command: string): void
}>()

const visible = ref(false)
const position = ref({ left: 0, top: 0 })
const items = ref<SlashMenuItem[]>([])
const searchQuery = ref('')
const selectedIndex = ref(0)
const menuRef = ref<HTMLElement>()
const searchInputRef = ref<HTMLInputElement>()

const filteredItems = computed(() => {
  if (!searchQuery.value) return items.value
  const q = searchQuery.value.toLowerCase()
  return items.value.filter(
    item => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
  )
})

interface GroupedItems {
  name: string
  items: SlashMenuItem[]
}

const groupedItems = computed<GroupedItems[]>(() => {
  const groups = new Map<string, SlashMenuItem[]>()
  for (const item of filteredItems.value) {
    const g = item.group || '其他'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(item)
  }
  return Array.from(groups.entries()).map(([name, items]) => ({ name, items }))
})

const flatItems = computed(() => filteredItems.value)

function moveSelection(delta: number) {
  const len = flatItems.value.length
  if (len === 0) return
  selectedIndex.value = (selectedIndex.value + delta + len) % len
}

function executeSelected() {
  const item = flatItems.value[selectedIndex.value]
  if (item) executeItem(item)
}

function executeItem(item: SlashMenuItem) {
  close()
  emit('execute', item.command)
}

function close() {
  visible.value = false
  searchQuery.value = ''
  selectedIndex.value = 0
}

function onSlashCommand(e: Event) {
  const detail = (e as CustomEvent).detail
  items.value = detail.items
  position.value = detail.coords
  searchQuery.value = ''
  selectedIndex.value = 0
  visible.value = true
  nextTick(() => {
    searchInputRef.value?.focus()
    // 调整位置防止超出视口
    if (menuRef.value) {
      const rect = menuRef.value.getBoundingClientRect()
      if (rect.bottom > window.innerHeight) {
        position.value = { ...position.value, top: position.value.top - rect.height - 30 }
      }
      if (rect.right > window.innerWidth) {
        position.value = { ...position.value, left: window.innerWidth - rect.width - 8 }
      }
    }
  })
}

function onClickOutside(e: MouseEvent) {
  if (visible.value && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    close()
  }
}

watch(searchQuery, () => {
  selectedIndex.value = 0
})

onMounted(() => {
  window.addEventListener('slash-command', onSlashCommand)
  document.addEventListener('mousedown', onClickOutside)
})

onBeforeUnmount(() => {
  window.removeEventListener('slash-command', onSlashCommand)
  document.removeEventListener('mousedown', onClickOutside)
})
</script>

<style scoped>
.slash-menu {
  position: fixed;
  z-index: 9999;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line-2);
  border-radius: 10px;
  box-shadow: 0 20px 60px oklch(0.21 0.014 270 / 0.18);
  width: 280px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  padding: 6px;
  overflow: hidden;
}

.slash-menu-search {
  padding: 4px 4px 8px;
  border-bottom: 1px solid var(--ses-line);
  margin-bottom: 4px;
}

.slash-menu-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--ses-line);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  background: var(--ses-surface-2);
  font-family: inherit;
  color: var(--ses-ink);
  transition: all 0.12s ease;
}

.slash-menu-input:focus {
  border-color: var(--ses-accent);
  background: var(--ses-surface);
  box-shadow: 0 0 0 3px var(--ses-accent-ring);
}

.slash-menu-items {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  scrollbar-width: thin;
}

.slash-menu-group {
  padding: 8px 10px 4px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ses-ink-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.slash-menu-item {
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  transition: background 0.1s ease;
}

.slash-menu-item.selected {
  background: var(--ses-accent-soft);
}

.slash-menu-item:hover {
  background: var(--ses-surface-2);
}

.slash-menu-item.selected .slash-menu-item-label {
  color: var(--ses-accent);
}

.slash-menu-item-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ses-ink);
}

.slash-menu-item-desc {
  font-size: 11px;
  color: var(--ses-ink-3);
}

.slash-menu-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--ses-ink-4);
}
</style>
