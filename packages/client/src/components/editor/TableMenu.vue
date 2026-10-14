<template>
  <el-dropdown ref="menu" trigger="click" :hide-on-click="false" @command="selectCommand">
    <button class="tbar-btn" @pointerdown="emit('open')" @keydown="emit('open')" @mousedown.prevent>表格 <el-icon><ArrowDown /></el-icon></button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="insert">插入表格 (3×3)</el-dropdown-item>
        <el-dropdown-item v-for="group in groups" :key="group.id" :command="group.id" :disabled="!inTable" :divided="group.id === 'rows'">
          <el-dropdown trigger="hover" placement="right-start" @command="selectCommand">
            <span class="table-submenu-trigger" tabindex="0" @mousedown.prevent>{{ group.label }} <el-icon><ArrowRight /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="item in group.items" :key="item.command" :command="item.command" :disabled="!inCell">{{ item.label }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-dropdown-item>
        <el-dropdown-item divided command="deleteTable" :disabled="!inTable">删除表格</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowDown, ArrowRight } from '@element-plus/icons-vue'
import type { DropdownInstance } from 'element-plus'

defineProps<{ inTable: boolean; inCell: boolean }>()
const emit = defineEmits<{ command: [command: string]; open: [] }>()
const menu = ref<DropdownInstance>()
const groups = [
  { id: 'rows', label: '行与列', items: [
    { command: 'addRowBefore', label: '上方插入行' }, { command: 'addRowAfter', label: '下方插入行' }, { command: 'deleteRow', label: '删除行' },
    { command: 'addColBefore', label: '左侧插入列' }, { command: 'addColAfter', label: '右侧插入列' }, { command: 'deleteCol', label: '删除列' },
  ] },
  { id: 'cells', label: '单元格', items: [
    { command: 'mergeCells', label: '合并单元格' }, { command: 'splitCell', label: '拆分单元格' },
  ] },
  { id: 'notes', label: '表注与脚注', items: [
    { command: 'addTableNote', label: '添加表注行' }, { command: 'addTableFootnote', label: '添加表脚注行（插入上标）' },
    { command: 'referenceTableFootnote', label: '引用已有表脚注' }, { command: 'deleteTableFootnoteRef', label: '删除当前上标引用' },
  ] },
]
function selectCommand(command: string) {
  if (groups.some(group => group.id === command)) return
  menu.value?.handleClose()
  emit('command', command)
}
</script>

<style scoped>
.table-submenu-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-width: 105px;
  color: var(--ses-ink);
  outline: none;
}
</style>
