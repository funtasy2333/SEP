<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="560px"
    class="ses-math-dlg"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
    @opened="handleOpened"
    @close="releaseMathfield"
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
          v-for="item in shortcuts"
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
        :placeholder="displayMode ? '例如 \\frac{a}{b}' : '例如 q_{V}、\\rho_{\\mathrm{w}}'"
        class="math-dlg-source-input"
        @input="error = ''"
      />
    </div>

    <div class="math-dlg-preview" aria-label="预览">
      <span class="math-dlg-preview-label">预览：</span>
      <span class="math-dlg-preview-body" v-html="previewHtml" />
    </div>
    <p v-if="complexHint" class="math-dlg-complex">该式较高（分式、求和、根式等），放在文字中会撑高所在行；运算式请用「公式」单独成行输入，这里只宜输入带上下标的符号。</p>
    <p v-if="error" class="math-dlg-error" role="alert">{{ error }}</p>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" class="math-dlg-confirm" @click="handleConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useZIndex } from 'element-plus'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { isComplexInlineLatex, loadMathLive, validateMathLatex, WHERE_SYMBOL_SHORTCUTS, type MathfieldStatics } from '@/utils/mathlive'

/** MathLive `<math-field>` 元素在本组件内用到的接口。 */
interface MathfieldLike extends HTMLElement {
  value: string
  getValue(format: 'latex-expanded'): string
  insert(latex: string, options: { selectionMode: 'placeholder'; focus: boolean }): boolean
  resetUndo(): void
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  initialLatex?: string
  title?: string
  displayMode?: boolean
  loader?: () => Promise<MathfieldStatics | null>
}>(), { initialLatex: '', title: '编辑式中符号', displayMode: false, loader: () => loadMathLive() })

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
let openSession: symbol | null = null

const blockShortcuts = [
  { label: 'a⁄b', latex: '\\frac{#?}{#?}', title: '分式' },
  { label: '√', latex: '\\sqrt{#?}', title: '平方根' },
  { label: '∑', latex: '\\sum_{#?}^{#?}', title: '求和' },
  ...WHERE_SYMBOL_SHORTCUTS,
]
const shortcuts = computed(() => props.displayMode ? blockShortcuts : WHERE_SYMBOL_SHORTCUTS)

const { nextZIndex } = useZIndex()

let keyboardAdjustFrame: number | null = null

function cancelKeyboardAdjustFrame(): void {
  if (keyboardAdjustFrame !== null) {
    cancelAnimationFrame(keyboardAdjustFrame)
    keyboardAdjustFrame = null
  }
}

/**
 * MathLive 的屏幕键盘挂在 body 上，默认 z-index 105，低于 el-dialog 的遮罩（2000 起）：
 * 键盘被遮罩盖住，点按键实际点在遮罩上，弹窗随之关闭。打开时把键盘层级抬到弹窗之上。
 */
function raiseVirtualKeyboard(): void {
  document.body.style.setProperty('--keyboard-zindex', String(nextZIndex()))
  window.mathVirtualKeyboard?.addEventListener('geometrychange', fitDialogAboveKeyboard)
}

function releaseVirtualKeyboard(): void {
  cancelKeyboardAdjustFrame()
  const keyboard = window.mathVirtualKeyboard
  keyboard?.removeEventListener('geometrychange', fitDialogAboveKeyboard)
  keyboard?.hide()
  mathfieldRef.value?.closest<HTMLElement>('.el-overlay-dialog')?.style.removeProperty('padding-bottom')
  document.body.style.removeProperty('--keyboard-zindex')
}

/**
 * 键盘从底部弹出会盖住弹窗下半部（含「确定」）。先集中读取几何信息，再写入样式，
 * 并把 scrollTop 调整放到下一帧，避免「先写后读再写」触发强制同步回流。
 */
function fitDialogAboveKeyboard(): void {
  const field = mathfieldRef.value
  const overlay = field?.closest<HTMLElement>('.el-overlay-dialog')
  const dialog = field?.closest<HTMLElement>('.el-dialog')
  const keyboard = window.mathVirtualKeyboard
  if (!field || !overlay || !dialog || !keyboard) return
  cancelKeyboardAdjustFrame()
  const height = keyboard.visible ? keyboard.boundingRect.height : 0
  let shift = 0
  if (height > 0) {
    const viewportHeight = window.innerHeight
    const covered = dialog.getBoundingClientRect().bottom - (viewportHeight - height)
    shift = Math.min(covered, field.getBoundingClientRect().top - 8)
  }
  overlay.style.paddingBottom = height > 0 ? `${height}px` : ''
  if (shift > 0) {
    keyboardAdjustFrame = requestAnimationFrame(() => {
      keyboardAdjustFrame = null
      overlay.scrollTop += shift
    })
  }
}

const complexHint = computed(() => !props.displayMode && isComplexInlineLatex(source.value))

const previewHtml = computed(() => {
  const latex = source.value.trim()
  if (!latex) return ''
  try {
    return katex.renderToString(latex, { displayMode: props.displayMode, throwOnError: true, strict: 'ignore' })
  } catch {
    return `<span class="math-dlg-preview-invalid">${escapeHtml(latex)}</span>`
  }
})

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function prepareMathfield(field: MathfieldLike): void {
  field.value = source.value
  field.resetUndo()
  mathfieldReady.value = true
}

function releaseMathfield(): void {
  if (openSession === null) return
  openSession = null
  mathfieldReady.value = false
  loading.value = false
  mathfieldRef.value?.blur()
  releaseVirtualKeyboard()
}

watch(() => props.modelValue, open => {
  if (!open) {
    releaseMathfield()
    return
  }
  openSession = Symbol()
  source.value = props.initialLatex
  error.value = ''
  mode.value = loadFailed.value ? 'source' : 'visual'
  // MathLive 聚焦时会暂缓处理失焦。保留同一个元素可避免快速关闭时销毁仍被它引用的编辑模型。
  const field = mathfieldRef.value
  if (field && !loadFailed.value && typeof field.resetUndo === 'function') prepareMathfield(field)
}, { immediate: true })

async function handleOpened(): Promise<void> {
  const session = openSession
  if (session === null || loadFailed.value) return
  loading.value = true
  const element = await props.loader()
  if (session !== openSession) return
  loading.value = false
  if (!element) {
    loadFailed.value = true
    mode.value = 'source'
    return
  }
  await customElements.whenDefined('math-field')
  await nextTick()
  if (session !== openSession) return
  const field = mathfieldRef.value
  if (!field) return
  if (!mathfieldReady.value) prepareMathfield(field)
  raiseVirtualKeyboard()
  if (mode.value === 'visual') field.focus()
}

onBeforeUnmount(releaseMathfield)

function handleVisualInput(): void {
  const field = mathfieldRef.value
  if (!field || !mathfieldReady.value) return
  source.value = field.getValue('latex-expanded')
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
  const result = validateMathLatex(source.value, props.displayMode)
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

.math-dlg-complex {
  margin: 8px 0 0;
  color: #b88230;
  font-size: 13px;
}

.math-dlg-error {
  margin: 8px 0 0;
  color: #c0392b;
  font-size: 13px;
}
</style>
