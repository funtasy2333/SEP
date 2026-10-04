<template>
  <el-dialog
    v-model="visible"
    :show-close="false"
    width="min(960px, calc(100vw - 24px))"
    align-center
    class="new-doc-dialog"
    @open="onOpen"
  >
    <template #header>
      <div class="dlg-head">
        <div class="title-line">
          <span class="eyebrow">新建</span>
          <h2>创建标准文件</h2>
        </div>
        <button class="dlg-close" @click="visible = false">
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </template>

    <!-- Live preview -->
    <div class="dlg-preview">
      <div class="mini-cover">
        <div class="left">
          <div class="stdno">
            {{ newDocumentStandardNo(form) }}
          </div>
          <div class="designation-cn">{{ coverDesignationPreview }}</div>
          <div class="title-cn">{{ form.titleCn || '请输入文件名称…' }}</div>
          <div class="title-en">{{ form.titleEn || 'English title (optional)' }}</div>
        </div>
        <div class="right">
          <span class="ses-stage" :class="form.stage">
            <span class="dot" />
            {{ STAGE_LABELS[form.stage] || form.stage }}
          </span>
          <div class="mc-meta">
            <span class="k">类型</span><span class="v zh">{{ typeDef.name }}</span>
            <span class="k">ICS</span><span class="v">{{ form.icsCode || '—' }}</span>
            <span class="k">CCS</span><span class="v">{{ form.ccsCode || '—' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="dlg-body">
      <aside class="dlg-steps">
        <button
          v-for="(s, i) in steps"
          :key="s.id"
          class="dlg-step"
          :class="{ 'is-active': activeStep === s.id, 'is-done': stepDone[s.id] && activeStep !== s.id }"
          @click="activeStep = s.id"
        >
          <span class="num">
            <el-icon v-if="stepDone[s.id] && activeStep !== s.id"><Check /></el-icon>
            <template v-else>{{ i + 1 }}</template>
          </span>
          <div>
            <div>{{ s.label }}</div>
            <span class="meta">{{ s.meta }}</span>
          </div>
        </button>
        <div class="rule" />
        <div class="dlg-step" style="color: var(--ses-ink-4); cursor: default">
          <span class="num" style="background: transparent">·</span>
          <div>
            <div>导入已有 XML</div>
            <span class="meta">直接从 .xml 文件载入</span>
          </div>
        </div>
      </aside>

      <div class="dlg-form">
        <!-- 1. Type -->
        <section class="form-section">
          <header>
            <h3><span class="idx">01</span>标准类别</h3>
            <p>编号前缀与模板将基于此自动设置。</p>
          </header>
          <div class="type-grid">
            <button
              v-for="t in TYPE_DEFS"
              :key="t.id"
              class="type-radio"
              :class="{ 'is-active': form.type === t.id }"
              @click="selectType(t.id)"
            >
              <span class="glyph">{{ t.glyph }}</span>
              <div class="info">
                <div class="info-title">{{ t.name }}</div>
                <div class="info-code">{{ t.code }}</div>
              </div>
            </button>
          </div>
          <el-form v-if="customDesignationTypes.has(form.type)" label-position="top" :model="form">
            <StandardTypeNameInput
              v-model="coverDesignationName"
              :standard-type="form.type"
            />
          </el-form>
        </section>

        <!-- 2. Basic info -->
        <section class="form-section">
          <header>
            <h3><span class="idx">02</span>基本信息</h3>
          </header>

          <el-form label-position="top" :model="form">
            <el-form-item>
              <template #label>
                文件名称<span class="req">*</span>
                <span class="help">建议简明，体现标准的对象与对象的特性</span>
              </template>
              <el-input
                ref="titleInputRef"
                v-model="form.titleCn"
                placeholder="例：信息技术 标准化文件编辑系统 通用要求"
              />
            </el-form-item>

            <el-form-item>
              <template #label>
                English Title <span class="help">可选，符合 GB/T 1.1 多语言推荐</span>
              </template>
              <el-input
                v-model="form.titleEn"
                placeholder="例：Information technology — Standards Editor System — General requirements"
              />
            </el-form-item>

            <el-form-item>
              <template #label>
                标准编号 <span class="help">不填会自动生成占位编号</span>
              </template>
              <div class="input-group">
                <input
                  v-model="form.stdPrefix"
                  class="prefix-input"
                  :placeholder="typeDef.prefix"
                />
                <input v-model="form.stdNo" :placeholder="STANDARD_NO_PLACEHOLDER" />
              </div>
            </el-form-item>
            <el-form-item>
              <template #label>标准替代情况 <span class="help">填写被代替的标准编号；首次发布可留空</span></template>
              <el-input v-model="form.replaces" placeholder="如 GB/T 12345—2020" />
            </el-form-item>

            <el-form-item>
              <template #label>标准采标情况 <span class="help">填写采标文件编号和一致性程度；未采标可留空</span></template>
              <el-input v-model="form.consistency" placeholder="如 （ISO 1234:2020，MOD）" />
            </el-form-item>
          </el-form>
        </section>

        <!-- 3. Classification + stage -->
        <section class="form-section">
          <header>
            <h3><span class="idx">03</span>分类与阶段</h3>
          </header>

          <el-form label-position="top" :model="form">
            <div class="two-col">
              <el-form-item>
                <template #label>ICS 号 <span class="help">国际标准分类法</span></template>
                <el-input v-model="form.icsCode" placeholder="如 35.240.99" class="mono-input" />
              </el-form-item>
              <el-form-item>
                <template #label>CCS 号 <span class="help">中国标准文献分类</span></template>
                <el-input v-model="form.ccsCode" placeholder="如 L 70" class="mono-input" />
              </el-form-item>
            </div>

            <el-form-item label="起始阶段">
              <div class="ses-stage-seg">
                <button
                  v-for="s in STAGES"
                  :key="s"
                  :class="{ 'is-active': form.stage === s }"
                  type="button"
                  @click="form.stage = s"
                >
                  {{ STAGE_LABELS[s] }}
                  <span class="short">{{ STAGE_SHORT[s] }}</span>
                </button>
              </div>
            </el-form-item>
          </el-form>
        </section>

        <!-- 4. Drafter info -->
        <section class="form-section">
          <header>
            <h3><span class="idx">04</span>起草信息</h3>
            <p>可在文件设置中随时修改。</p>
          </header>
          <el-form label-position="top" :model="form">
            <div class="two-col">
              <el-form-item label="提出单位">
                <el-input v-model="form.proposer" placeholder="如 工业和信息化部" />
              </el-form-item>
              <el-form-item label="归口单位">
                <el-input v-model="form.technicalCommittee" placeholder="如 全国信息技术标准化技术委员会（SAC/TC 28）" />
              </el-form-item>
            </div>
            <div class="two-col">
              <el-form-item label="发布单位">
                <el-input v-model="form.issuer" placeholder="如 国家标准化管理委员会" />
              </el-form-item>
              <el-form-item label="起草单位">
                <el-input v-model="form.applicant" placeholder="如 中国电子技术标准化研究院" />
              </el-form-item>
            </div>
          </el-form>
        </section>
      </div>
    </div>

    <template #footer>
      <div class="dlg-foot">
        <div class="foot-l">
          <el-icon><MagicStick /></el-icon>
          将自动套用 GB/T 1.1 默认结构（前言 + 范围 + 规范性引用文件 + 术语和定义）
        </div>
        <div class="foot-r">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" @click="handleCreate">
            <el-icon><Plus /></el-icon>
            <span>创建草案</span>
            <kbd style="margin-left: 8px">⌘↵</kbd>
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, Check, Plus, MagicStick } from '@element-plus/icons-vue'
import { getCoverDesignation } from '@ses/shared'
import {
  STAGE_LABELS, STAGE_SHORT, STAGES, TYPE_DEFS,
} from '@/constants/standards'
import StandardTypeNameInput from '@/components/StandardTypeNameInput.vue'
import { useCoverDesignationDraft } from '@/composables/useCoverDesignationDraft'
import { newDocumentStandardNo, STANDARD_NO_PLACEHOLDER, type NewDocForm } from '@/utils/newDocument'

const props = defineProps<{
  modelValue: boolean
  initialType?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'create', form: NewDocForm): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const form = ref<NewDocForm>({
  type: 'national',
  stage: 'working_draft',
  stdPrefix: '',
  stdNo: '',
  titleCn: '',
  titleEn: '',
  icsCode: '',
  ccsCode: '',
  issuer: '',
  applicant: '',
  proposer: '',
  technicalCommittee: '',
  replaces: '',
  consistency: '',
  industryName: '',
  regionName: '',
  coverDesignation: '',
})

const activeStep = ref<'type' | 'basic' | 'classify' | 'contrib'>('type')
const titleInputRef = ref<{ focus: () => void } | null>(null)
const customDesignationTypes = new Set(['industry', 'local', 'group', 'enterprise'])
const designationDraft = useCoverDesignationDraft({
  getDraft: () => form.value,
  getType: (draft) => draft.type,
  setType: (draft, type) => { draft.type = type },
})

const typeDef = computed(() =>
  TYPE_DEFS.find((t) => t.id === form.value.type) || TYPE_DEFS[0],
)
const coverDesignationName = computed({
  get: designationDraft.getName,
  set: designationDraft.setName,
})
const coverDesignationPreview = computed(() => getCoverDesignation({
  standardType: form.value.type,
  coverDesignation: form.value.coverDesignation,
  industryName: form.value.industryName,
  regionName: form.value.regionName,
}))

const steps = computed(() => [
  { id: 'type' as const,     label: '标准类型',     meta: typeDef.value.name },
  { id: 'basic' as const,    label: '基本信息',     meta: form.value.titleCn ? '✓ 已填写' : '题名 / 编号 / 替代 / 采标' },
  { id: 'classify' as const, label: '分类与阶段',   meta: `${form.value.icsCode || 'ICS'} · ${STAGE_SHORT[form.value.stage]}` },
  { id: 'contrib' as const,  label: '起草信息',     meta: form.value.proposer || form.value.issuer ? '✓ 已填写' : '提出 / 归口 / 起草单位' },
])

const stepDone = computed(() => ({
  type: true,
  basic: !!form.value.titleCn,
  classify: !!form.value.icsCode || !!form.value.ccsCode || !!form.value.stage,
  contrib: !!form.value.proposer || !!form.value.technicalCommittee || !!form.value.issuer || !!form.value.applicant,
}))

watch(() => props.modelValue, (open) => {
  if (open) {
    form.value = {
      type: TYPE_DEFS.find((t) => t.id === props.initialType)?.id ?? 'national',
      stage: 'working_draft',
      stdPrefix: '',
      stdNo: '',
      titleCn: '',
      titleEn: '',
      icsCode: '',
      ccsCode: '',
      issuer: '',
      applicant: '',
      proposer: '',
      technicalCommittee: '',
      replaces: '',
      consistency: '',
      industryName: '',
      regionName: '',
      coverDesignation: '',
    }
    activeStep.value = 'type'
  }
})

function selectType(type: NewDocForm['type']) {
  designationDraft.changeType(type)
}

function onOpen() {
  nextTick(() => titleInputRef.value?.focus())
}

function handleCreate() {
  if (!form.value.titleCn.trim()) {
    ElMessage.warning('请输入文件名称')
    titleInputRef.value?.focus()
    return
  }
  emit('create', form.value)
}

// keyboard shortcut: Cmd/Ctrl + Enter to submit
function onKey(e: KeyboardEvent) {
  if (!visible.value) return
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    handleCreate()
  }
}
window.addEventListener('keydown', onKey)
</script>

<style scoped>
/* === Header === */
.dlg-head {
  display: flex; align-items: center; justify-content: space-between;
}
.title-line { display: flex; align-items: center; gap: 12px; }
.eyebrow {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ses-accent);
  background: var(--ses-accent-soft);
  padding: 2px 8px;
  border-radius: 4px;
}
.dlg-head h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--ses-ink); }
.dlg-close {
  width: 32px; height: 32px;
  border-radius: 8px;
  color: var(--ses-ink-3);
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 0; cursor: pointer;
}
.dlg-close:hover { background: var(--ses-surface-2); color: var(--ses-ink); }

/* === Live preview === */
.dlg-preview {
  margin: -20px -24px 20px;
  padding: 18px 24px;
  background: linear-gradient(180deg, var(--ses-accent-soft) 0%, var(--ses-surface-2) 100%);
  border-bottom: 1px solid var(--ses-line);
}
.mini-cover {
  padding: 18px 24px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 20px;
  align-items: center;
  background: var(--ses-paper);
  border-radius: 8px;
  box-shadow: 0 1px 0 var(--ses-line) inset, 0 8px 24px -16px oklch(0.21 0.014 270 / 0.3);
}
.mini-cover .left { border-left: 3px solid var(--ses-accent); padding-left: 16px; }
.stdno {
  font-family: var(--ses-font-mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ses-ink-3);
}
.designation-cn { margin-top: 10px; color: var(--ses-ink-2); font-size: 12px; }
.title-cn {
  font-family: var(--ses-font-zh-hei);
  font-size: 18px;
  font-weight: 700;
  color: var(--ses-ink);
  margin: 4px 0 2px;
  line-height: 1.4;
}
.title-en { font-size: 11.5px; color: var(--ses-ink-3); font-style: italic; }

.mini-cover .right { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.mc-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 8px;
  font-size: 11px;
  color: var(--ses-ink-3);
  min-width: 140px;
}
.mc-meta .k {
  font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px;
}
.mc-meta .v { font-family: var(--ses-font-mono); color: var(--ses-ink-2); }
.mc-meta .v.zh { font-family: var(--ses-font-ui); }

/* === Body === */
.dlg-body {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 32px;
}

.dlg-steps { display: flex; flex-direction: column; gap: 4px; position: sticky; top: 0; align-self: start; }
.dlg-step {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ses-ink-3);
  cursor: pointer;
  background: transparent;
  border: 0;
  text-align: left;
  font-family: inherit;
}
.dlg-step:hover { background: var(--ses-surface-2); }
.dlg-step.is-active { background: var(--ses-accent-soft); color: var(--ses-accent); font-weight: 600; }
.dlg-step.is-done { color: var(--ses-ink-2); }
.dlg-step .num {
  width: 22px; height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ses-surface-3);
  font-size: 11px;
  font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ses-ink-3);
}
.dlg-step.is-done .num { background: var(--ses-ok); color: white; }
.dlg-step.is-active .num { background: var(--ses-accent); color: white; }
.dlg-step .meta { display: block; font-size: 10.5px; font-weight: 500; color: var(--ses-ink-4); margin-top: 1px; }
.rule { margin: 8px 0; height: 1px; background: var(--ses-line); }

/* === Form === */
.dlg-form { display: flex; flex-direction: column; gap: 28px; }

.form-section header { margin-bottom: 12px; }
.form-section h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ses-ink);
  display: flex; align-items: center; gap: 8px;
}
.form-section h3 .idx {
  font-family: var(--ses-font-mono);
  font-size: 11px;
  color: var(--ses-accent);
  background: var(--ses-accent-soft);
  padding: 2px 6px;
  border-radius: 4px;
}
.form-section header p {
  font-size: 11.5px; color: var(--ses-ink-3);
  margin: 4px 0 0;
}
.req { color: var(--ses-err); font-weight: 600; margin-left: 4px; }
.help { font-size: 10.5px; color: var(--ses-ink-4); margin-left: 8px; font-weight: 400; }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* Type radio cards */
.type-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.type-radio {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border: 1.5px solid var(--ses-line);
  border-radius: 10px;
  cursor: pointer;
  background: var(--ses-surface);
  transition: all 0.12s ease;
  text-align: left;
  font-family: inherit;
}
.type-radio:hover { border-color: var(--ses-line-2); background: var(--ses-surface-2); }
.type-radio.is-active {
  border-color: var(--ses-accent);
  background: var(--ses-accent-soft);
  box-shadow: 0 0 0 3px var(--ses-accent-ring);
}
.type-radio .glyph {
  font-family: var(--ses-font-zh-hei);
  font-weight: 700; font-size: 16px;
  color: var(--ses-ink);
  width: 36px; height: 36px;
  background: var(--ses-surface-2);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.type-radio.is-active .glyph { background: var(--ses-accent); color: white; }
.type-radio .info-title { font-size: 12.5px; font-weight: 600; color: var(--ses-ink); }
.type-radio .info-code  { font-size: 10.5px; color: var(--ses-ink-3); font-family: var(--ses-font-mono); margin-top: 1px; }

/* std-no input group */
.input-group {
  display: flex; align-items: stretch;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  border-radius: 8px;
  transition: all 0.12s ease;
  overflow: hidden;
  width: 100%;
}
.input-group:focus-within {
  border-color: var(--ses-accent);
  box-shadow: 0 0 0 3px var(--ses-accent-ring);
}
.input-group .prefix-input {
  width: 90px;
  flex-shrink: 0;
  border: 0; background: var(--ses-surface-2); outline: none;
  padding: 0 12px;
  height: 36px;
  font-size: 12.5px;
  font-family: var(--ses-font-mono);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ses-ink);
  border-right: 1px solid var(--ses-line);
}
.input-group .prefix-input::placeholder {
  color: var(--ses-ink-4);
}
.input-group input {
  flex: 1;
  border: 0; background: transparent; outline: none;
  padding: 0 12px;
  height: 36px;
  font-size: 13.5px;
  font-family: var(--ses-font-mono);
  color: var(--ses-ink);
}
:deep(.mono-input .el-input__inner) { font-family: var(--ses-font-mono); font-size: 13px; }

/* Footer */
.dlg-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.foot-l {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; color: var(--ses-ink-3);
}
.foot-r { display: flex; gap: 8px; }
</style>

<style>
/* Dialog-level overrides (not scoped — affect el-dialog internals) */
.new-doc-dialog .el-dialog {
  border-radius: 16px;
  overflow: hidden;
}
.new-doc-dialog .el-dialog__header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--ses-line);
}
.new-doc-dialog .el-dialog__body { padding: 20px 24px; max-height: 70vh; overflow-y: auto; }
.new-doc-dialog .el-dialog__footer { padding: 14px 24px; background: var(--ses-surface-2); }
.new-doc-dialog .el-form-item__label { padding-bottom: 4px; font-size: 11.5px; font-weight: 500; color: var(--ses-ink-2); display: flex; align-items: center; }

@media (max-width: 720px) {
  .new-doc-dialog .el-dialog__body { padding: 16px; max-height: 72dvh; }
  .new-doc-dialog .el-dialog__header { padding: 14px 16px; }
  .new-doc-dialog .el-dialog__footer { padding: 12px 16px; }
  .new-doc-dialog .dlg-preview { margin: -16px -16px 16px; padding: 16px; }
  .new-doc-dialog .mini-cover { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 16px; }
  .new-doc-dialog .mini-cover .right { align-items: flex-start; }
  .new-doc-dialog .dlg-body { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .new-doc-dialog .dlg-steps { display: none; }
  .new-doc-dialog .type-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .new-doc-dialog .type-radio { min-width: 0; gap: 8px; padding: 10px 9px; }
  .new-doc-dialog .type-radio .glyph { width: 32px; height: 32px; }
  .new-doc-dialog .dlg-foot { flex-wrap: wrap; }
  .new-doc-dialog .foot-l { flex: 1 1 100%; }
  .new-doc-dialog .foot-r { margin-left: auto; }
}
</style>
