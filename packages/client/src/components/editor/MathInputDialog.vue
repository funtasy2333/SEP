<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="560px"
    class="ses-math-dlg"
    append-to-body
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
    @opened="handleOpened"
  >
    <div class="math-dlg-mode">
      <el-radio-group v-model="mode" size="small" @change="handleModeChange">
        <el-radio-button value="visual" :disabled="loadFailed">可视化</el-radio-button>
        <el-radio-button value="source">LaTeX 源码</el-radio-button>
      </el-radio-group>
      <span v-if="loadFailed" class="math-dlg-hint">可视化编辑器加载失败，已切换为 LaTeX 源码输入。</span>
      <span v-else-if="loading && mode === 'visual'" class="math-dlg-hint">正在加载可视化编辑器…</span>
    </div>

    <div v-show="mode === 'visual'" class="math-dlg-visual">
      <div class="math-dlg-shortcuts">
        <button
          v-for="item in WHERE_SYMBOL_SHORTCUTS"
          :key="item.latex"
          type="button"
          class="math-dlg-key"
          :title="item.title"
          :disabled="!mathfieldReady"
          @mousedown.prevent
          @click="insertShortcut(item.latex)"
        >{{ item.label }}</button>
      </div>
      <math-field ref="mathfieldRef" class="math-dlg-field" math-virtual-keyboard-policy="manual" @input="handleVisualInput" />
    </div>

    <div v-show="mode === 'source'" class="math-dlg-source">
      <el-input
        v-model="source"
        type="textarea"
        :rows="2"
        placeholder="例如 q_{V}、\rho_{\mathrm{w}}"
        class="math-dlg-source-input"
        @input="error = ''"
      />
    </div>

    <div class="math-dlg-preview" aria-label="预览">
      <span class="math-dlg-preview-label">预览：</span>
      <span class="math-dlg-preview-body" v-html="previewHtml" />
    </div>
    <p v-if="error" class="math-dlg-error" role="alert">{{ error }}</p>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" class="math-dlg-confirm" @click="handleConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { loadMathLive, validateWhereSymbolLatex, WHERE_SYMBOL_SHORTCUTS, type MathfieldStatics } from '@/utils/mathlive'

/** MathLive `<math-field>` 元素在本组件内用到的接口。 */
interface MathfieldLike extends HTMLElement {
  value: string
  getValue(format: 'latex-expanded'): string
  insert(latex: string, options: { selectionMode: 'placeholder'; focus: boolean }): boolean
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  initialLatex?: string
  title?: string
  loader?: () => Promise<MathfieldStatics | null>
}>(), { initialLatex: '', title: '编辑式中符号', loader: () => loadMathLive() })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [latex: string]
}>()

const mode = ref<'visual' | 'source'>('visual')
const source = ref('')
const error = ref('')
const loading = ref(false)
const loadFailed = ref(false)
const mathfieldReady = ref(false)
const mathfieldRef = ref<MathfieldLike | null>(null)

const previewHtml = computed(() => {
  const latex = source.value.trim()
  if (!latex) return ''
  try {
    return katex.renderToString(latex, { displayMode: false, throwOnError: true, strict: 'ignore' })
  } catch {
    return `<span class="math-dlg-preview-invalid">${escapeHtml(latex)}</span>`
  }
})

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  source.value = props.initialLatex
  error.value = ''
  mode.value = loadFailed.value ? 'source' : 'visual'
})

async function handleOpened(): Promise<void> {
  if (loadFailed.value) return
  loading.value = true
  const element = await props.loader()
  loading.value = false
  if (!element) {
    loadFailed.value = true
    mode.value = 'source'
    return
  }
  await customElements.whenDefined('math-field')
  await nextTick()
  const field = mathfieldRef.value
  if (!field) return
  field.value = source.value
  mathfieldReady.value = true
  if (mode.value === 'visual') field.focus()
}

function currentVisualLatex(): string {
  const field = mathfieldRef.value
  return field && mathfieldReady.value ? field.getValue('latex-expanded') : source.value
}

function handleVisualInput(): void {
  source.value = currentVisualLatex()
  error.value = ''
}

function handleModeChange(next: string | number | boolean | undefined): void {
  if (next === 'visual' && mathfieldRef.value && mathfieldReady.value) {
    mathfieldRef.value.value = source.value
    mathfieldRef.value.focus()
  }
}

function insertShortcut(latex: string): void {
  const field = mathfieldRef.value
  if (!field) return
  // 选中插入内容里的第一个占位（如下标位置），按钮不抢焦点（mousedown.prevent），可直接接着输入。
  field.insert(latex, { selectionMode: 'placeholder', focus: true })
  handleVisualInput()
}

function handleConfirm(): void {
  const latex = mode.value === 'visual' ? currentVisualLatex() : source.value
  const result = validateWhereSymbolLatex(latex)
  if (!result.ok) {
    error.value = result.error
    return
  }
  emit('confirm', result.latex)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.math-dlg-mode {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.math-dlg-hint {
  color: #888;
  font-size: 12px;
}

.math-dlg-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.math-dlg-key {
  min-width: 32px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-family: 'Times New Roman', serif;
}

.math-dlg-key:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
}

.math-dlg-field {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 6px 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 22px;
}

.math-dlg-preview {
  margin-top: 12px;
  min-height: 32px;
  font-size: 18px;
}

.math-dlg-preview-label {
  color: #888;
  font-size: 13px;
}

.math-dlg-error {
  margin: 8px 0 0;
  color: #c0392b;
  font-size: 13px;
}
</style>
