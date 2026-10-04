<template>
  <main class="settings-page ses-scroll" aria-label="文件设置">
    <div class="settings-layout">
      <aside class="settings-rail">
        <div class="rail-heading">
          <span class="rail-mark"><el-icon><Setting /></el-icon></span>
          <div><strong>文件设置</strong><span>DOCUMENT PROFILE</span></div>
        </div>
        <nav class="section-nav" aria-label="设置分组">
          <button
            v-for="section in sections"
            :key="section.id"
            type="button"
            class="section-link"
            :class="{ 'is-active': activeSection === section.id }"
            @click="scrollToSection(section.id)"
          >
            <span class="section-link-num">{{ section.number }}</span>
            <span>{{ section.label }}</span>
            <el-icon><ArrowRight /></el-icon>
          </button>
        </nav>
        <div class="rail-note">
          <span class="note-icon"><el-icon><InfoFilled /></el-icon></span>
          <p>更新文档信息，前言正文保持原样。</p>
        </div>
      </aside>

      <div class="settings-scroll" @scroll="onScroll">
        <header class="settings-heading">
          <div>
            <div class="settings-eyebrow">DOCUMENT PROFILE</div>
            <h1>文件设置</h1>
            <p>维护标准文件的基础信息、分类阶段、发布字段与相关单位。</p>
          </div>
          <span class="draft-state" :class="{ 'is-dirty': dirty, 'is-saving': saving }">
            <i />{{ statusText }}
          </span>
        </header>

        <section class="cover-preview" aria-label="封面信息实时预览">
          <div class="preview-topline"><span>封面预览</span><span class="preview-live"><i />实时更新</span></div>
          <div class="preview-content">
            <div class="preview-main">
              <div class="preview-standard-no">{{ draft.standardNo.trim() || '标准编号待填写' }}</div>
              <div class="preview-title-cn">{{ draft.titleCn.trim() || '请输入标准中文名称' }}</div>
              <div class="preview-title-en">{{ draft.titleEn.trim() || 'English title (optional)' }}</div>
            </div>
            <div class="preview-details">
              <span class="preview-type">{{ typeName }}</span>
              <span class="preview-stage" :class="{ 'is-unknown': !knownStages.has(draft.stage) }">{{ stageName }}</span>
              <div class="preview-classification">
                <span><small>ICS</small>{{ draft.icsCode.trim() || '—' }}</span>
                <span><small>CCS</small>{{ draft.ccsCode.trim() || '—' }}</span>
              </div>
            </div>
          </div>
        </section>

        <el-form :model="draft" label-position="top" class="settings-form" @submit.prevent="emit('save')">
          <section id="settings-basic" class="settings-card" aria-labelledby="settings-basic-title">
            <header class="card-heading">
              <span class="card-number">01</span>
              <div><h2 id="settings-basic-title">基础信息</h2><p>标准类型、名称与完整标准编号</p></div>
              <span class="card-icon"><el-icon><CollectionTag /></el-icon></span>
            </header>
            <div class="field-grid">
              <el-form-item label="标准类型" class="field-span-2">
                <el-select v-model="draft.standardType" :disabled="saving" class="full-width" aria-label="标准类型">
                  <el-option
                    v-if="!knownTypes.has(draft.standardType)"
                    :label="`未知旧类型（${draft.standardType || '空值'}）`"
                    :value="draft.standardType"
                    disabled
                  />
                  <el-option v-for="type in TYPE_DEFS" :key="type.id" :label="type.name" :value="type.id">
                    <span class="type-option"><i>{{ type.glyph }}</i><span>{{ type.name }}</span><small>{{ type.code }}</small></span>
                  </el-option>
                </el-select>
                <div v-if="!knownTypes.has(draft.standardType)" class="field-hint">当前值「{{ draft.standardType || '空值' }}」来自旧文档，已原样保留；选择受支持类型后才会更新。</div>
              </el-form-item>

              <el-form-item label="标准中文名称" class="field-span-2 is-required">
                <el-input
                  v-model="draft.titleCn"
                  :disabled="saving"
                  placeholder="请输入标准中文名称"
                  aria-label="标准中文名称"
                />
              </el-form-item>

              <el-form-item label="标准英文名称" class="field-span-2">
                <el-input v-model="draft.titleEn" :disabled="saving" placeholder="可选；留空会清除已有英文名称" aria-label="标准英文名称" />
              </el-form-item>

              <el-form-item label="标准编号" class="field-span-2">
                <el-input
                  v-model="draft.standardNo"
                  :disabled="saving"
                  placeholder="填写完整编号，如 GB/T 12345—2026"
                  aria-label="完整标准编号"
                />
                <div class="field-hint">按正式编号完整填写；系统不会推测编号或年份。</div>
              </el-form-item>
            </div>
          </section>

          <section id="settings-classification" class="settings-card" aria-labelledby="settings-classification-title">
            <header class="card-heading">
              <span class="card-number">02</span>
              <div><h2 id="settings-classification-title">分类与阶段</h2><p>分类号、阶段，以及行业或地方名称</p></div>
              <span class="card-icon"><el-icon><Grid /></el-icon></span>
            </header>
            <div class="field-grid">
              <el-form-item label="ICS 分类号">
                <el-input v-model="draft.icsCode" :disabled="saving" placeholder="如 35.240.99" aria-label="ICS 分类号" />
                <div class="field-hint">国际标准分类号</div>
              </el-form-item>
              <el-form-item label="CCS 分类号">
                <el-input v-model="draft.ccsCode" :disabled="saving" placeholder="如 L 70" aria-label="CCS 分类号" />
                <div class="field-hint">中国标准文献分类号</div>
              </el-form-item>
              <el-form-item label="文档阶段" class="field-span-2">
                <el-select v-model="draft.stage" :disabled="saving" class="full-width" aria-label="文档阶段">
                  <el-option
                    v-if="!knownStages.has(draft.stage)"
                    :label="`未知旧阶段（${draft.stage || '空值'}）`"
                    :value="draft.stage"
                    disabled
                  />
                  <el-option v-for="stage in STAGES" :key="stage" :label="STAGE_LABELS[stage]" :value="stage">
                    <span class="stage-option"><i :class="`stage-dot ${stage}`" />{{ STAGE_LABELS[stage] }}<small>{{ STAGE_SHORT[stage] }}</small></span>
                  </el-option>
                </el-select>
                <div v-if="!knownStages.has(draft.stage)" class="field-hint">当前值「{{ draft.stage || '空值' }}」来自旧文档，已原样保留；选择受支持阶段后才会更新。</div>
              </el-form-item>
              <el-form-item label="行业名称">
                <el-input v-model="draft.industryName" :disabled="saving" placeholder="行业标准可填写行业名称" aria-label="行业名称" />
              </el-form-item>
              <el-form-item label="地方名称">
                <el-input v-model="draft.regionName" :disabled="saving" placeholder="地方标准可填写省、市名称" aria-label="地方名称" />
              </el-form-item>
            </div>
          </section>

          <section id="settings-publication" class="settings-card" aria-labelledby="settings-publication-title">
            <header class="card-heading">
              <span class="card-number">03</span>
              <div><h2 id="settings-publication-title">发布信息</h2><p>发布日期、实施日期及标准关系</p></div>
              <span class="card-icon"><el-icon><Calendar /></el-icon></span>
            </header>
            <div class="field-grid">
              <el-form-item label="发布日期">
                <el-input v-model="draft.publishDate" :disabled="saving" placeholder="如 2026-10-01；未知时留空" aria-label="发布日期" />
              </el-form-item>
              <el-form-item label="实施日期">
                <el-input v-model="draft.implementDate" :disabled="saving" placeholder="如 2027-04-01；未知时留空" aria-label="实施日期" />
              </el-form-item>
              <el-form-item label="代替标准" class="field-span-2">
                <el-input v-model="draft.replaces" :disabled="saving" placeholder="填写被代替的标准编号；没有时留空" aria-label="代替标准" />
              </el-form-item>
              <el-form-item label="一致性程度标识" class="field-span-2">
                <el-input v-model="draft.consistency" :disabled="saving" placeholder="如 （ISO 1234:2020，MOD）；没有时留空" aria-label="一致性程度标识" />
              </el-form-item>
              <el-form-item label="备案号" class="field-span-2">
                <el-input v-model="draft.filingNo" :disabled="saving" placeholder="适用时填写备案号；未知时留空" aria-label="备案号" />
              </el-form-item>
            </div>
          </section>

          <section id="settings-organizations" class="settings-card" aria-labelledby="settings-organizations-title">
            <header class="card-heading">
              <span class="card-number">04</span>
              <div><h2 id="settings-organizations-title">单位信息</h2><p>维护标准提出、归口、发布与起草单位</p></div>
              <span class="card-icon"><el-icon><OfficeBuilding /></el-icon></span>
            </header>
            <div class="field-grid">
              <el-form-item label="提出单位" class="field-span-2">
                <el-input v-model="draft.proposer" :disabled="saving" placeholder="标准提出单位；没有时留空" aria-label="提出单位" />
              </el-form-item>
              <el-form-item label="归口单位" class="field-span-2">
                <el-input v-model="draft.technicalCommittee" :disabled="saving" placeholder="归口单位或技术委员会；没有时留空" aria-label="归口单位" />
              </el-form-item>
              <el-form-item label="发布单位" class="field-span-2">
                <el-input v-model="draft.issuer" :disabled="saving" placeholder="标准发布单位；没有时留空" aria-label="发布单位" />
              </el-form-item>
              <el-form-item label="起草单位" class="field-span-2">
                <el-input v-model="draft.applicant" :disabled="saving" placeholder="标准起草单位；没有时留空" aria-label="起草单位" />
              </el-form-item>
            </div>
          </section>

          <footer class="settings-actions">
            <div class="action-status" :class="{ 'is-error': saveError }">
              <el-icon v-if="saveError"><CircleCloseFilled /></el-icon>
              <el-icon v-else-if="!dirty && !saving"><CircleCheckFilled /></el-icon>
              <span>{{ statusText }}</span>
            </div>
            <div class="action-buttons">
              <el-button :disabled="saving || !dirty" @click="emit('reset')">重置为已保存内容</el-button>
              <el-button type="primary" :loading="saving" :disabled="!dirty || !draft.titleCn.trim()" @click="emit('save')">
                <el-icon v-if="!saving"><Select /></el-icon>
                {{ saving ? '正在保存…' : '保存设置' }}
              </el-button>
            </div>
          </footer>
        </el-form>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowRight, Calendar, CircleCheckFilled, CircleCloseFilled, CollectionTag,
  Grid, InfoFilled, OfficeBuilding, Select, Setting,
} from '@element-plus/icons-vue'
import { STAGES, STAGE_LABELS, STAGE_SHORT, TYPE_DEFS, TYPE_LABELS } from '@/constants/standards'
import type { DocumentSettingsDraft } from '@/utils/documentSettings'

const props = defineProps<{
  draft: DocumentSettingsDraft
  dirty: boolean
  saving: boolean
  saveError: boolean
}>()

const emit = defineEmits<{
  (event: 'save'): void
  (event: 'reset'): void
}>()

const sections = [
  { id: 'settings-basic', number: '01', label: '基础信息' },
  { id: 'settings-classification', number: '02', label: '分类与阶段' },
  { id: 'settings-publication', number: '03', label: '发布信息' },
  { id: 'settings-organizations', number: '04', label: '单位信息' },
]
const activeSection = ref(sections[0].id)
const knownTypes = new Set<string>(TYPE_DEFS.map((type) => type.id))
const knownStages = new Set<string>(STAGES)
const typeName = computed(() => Object.prototype.hasOwnProperty.call(TYPE_LABELS, props.draft.standardType)
  ? TYPE_LABELS[props.draft.standardType]
  : `旧类型：${props.draft.standardType || '未设置'}`)
const stageName = computed(() => Object.prototype.hasOwnProperty.call(STAGE_LABELS, props.draft.stage)
  ? STAGE_LABELS[props.draft.stage]
  : `旧阶段：${props.draft.stage || '未设置'}`)
const statusText = computed(() => {
  if (props.saving) return '正在保存…'
  if (props.saveError) return '保存失败，草稿仍保留'
  return props.dirty ? '有尚未保存的修改' : '与已保存内容一致'
})

function scrollToSection(id: string) {
  activeSection.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onScroll(event: Event) {
  const container = event.currentTarget as HTMLElement
  let current = sections[0].id
  for (const section of sections) {
    const element = document.getElementById(section.id)
    if (element && element.getBoundingClientRect().top <= container.getBoundingClientRect().top + 150) current = section.id
  }
  activeSection.value = current
}
</script>

<style scoped>
.settings-page { flex: 1; min-height: 0; overflow: auto; background: var(--ses-bg); }
.settings-layout { min-height: 100%; display: grid; grid-template-columns: 218px minmax(0, 1fr); max-width: 1440px; margin: 0 auto; }
.settings-rail { position: sticky; top: 0; align-self: start; min-height: calc(100vh - 48px); padding: 30px 16px 24px 20px; background: color-mix(in oklch, var(--ses-surface) 82%, var(--ses-bg)); border-right: 1px solid var(--ses-line); }
.rail-heading { display: flex; align-items: center; gap: 11px; padding: 0 5px 26px; border-bottom: 1px solid var(--ses-line); }
.rail-mark { width: 34px; height: 34px; display: grid; place-items: center; color: var(--ses-accent); background: var(--ses-accent-soft); border-radius: 10px; font-size: 17px; }
.rail-heading strong, .rail-heading span:not(.rail-mark) { display: block; }
.rail-heading strong { color: var(--ses-ink); font-size: 13px; font-weight: 650; }
.rail-heading div > span { margin-top: 3px; color: var(--ses-ink-4); font-size: 9px; letter-spacing: .09em; }
.section-nav { display: grid; gap: 5px; padding: 18px 0; }
.section-link { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 9px; border: 0; border-radius: 8px; background: transparent; color: var(--ses-ink-3); font-family: inherit; font-size: 12.5px; font-weight: 500; text-align: left; cursor: pointer; transition: .14s ease; }
.section-link-num { width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--ses-line); border-radius: 7px; color: var(--ses-ink-4); font: 600 10px var(--ses-font-mono); }
.section-link .el-icon { margin-left: auto; opacity: 0; }
.section-link:hover, .section-link.is-active { color: var(--ses-accent); background: var(--ses-accent-soft); }
.section-link.is-active .section-link-num { color: var(--ses-accent); border-color: color-mix(in oklch, var(--ses-accent) 30%, var(--ses-line)); background: var(--ses-surface); }
.section-link.is-active .el-icon { opacity: 1; }
.rail-note { display: flex; gap: 8px; margin: 12px 2px 0; padding: 11px 10px; border: 1px solid var(--ses-line); border-radius: 9px; background: var(--ses-surface); }
.note-icon { flex: 0 0 auto; margin-top: 1px; color: var(--ses-accent); font-size: 14px; }
.rail-note p { margin: 0; color: var(--ses-ink-3); font-size: 10.5px; line-height: 1.65; }
.settings-scroll { min-width: 0; max-height: calc(100vh - 48px); overflow: auto; padding: 30px clamp(18px, 4vw, 56px) 28px; scroll-behavior: smooth; }
.settings-heading { max-width: 940px; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin: 0 auto 20px; }
.settings-eyebrow { color: var(--ses-accent); font: 650 9.5px var(--ses-font-mono); letter-spacing: .11em; }
.settings-heading h1 { margin: 5px 0 4px; color: var(--ses-ink); font-size: 23px; letter-spacing: -.025em; }
.settings-heading p { margin: 0; color: var(--ses-ink-3); font-size: 12px; line-height: 1.65; }
.draft-state { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px; margin-bottom: 4px; padding: 6px 10px; border: 1px solid var(--ses-line); border-radius: 999px; background: var(--ses-surface); color: var(--ses-ink-3); font-size: 10.5px; }
.draft-state i, .preview-live i { width: 6px; height: 6px; border-radius: 50%; background: var(--ses-ok); }
.draft-state.is-dirty { border-color: color-mix(in oklch, var(--ses-warn) 40%, var(--ses-line)); color: var(--ses-warn); }
.draft-state.is-dirty i { background: var(--ses-warn); }
.draft-state.is-saving i { background: var(--ses-accent); animation: pulse 1s infinite; }
.cover-preview, .settings-card { max-width: 940px; margin: 0 auto 15px; overflow: hidden; border: 1px solid var(--ses-line); border-radius: 13px; background: var(--ses-surface); box-shadow: var(--ses-shadow-1); }
.cover-preview { position: relative; padding: 14px 19px 17px; background: radial-gradient(ellipse at 90% 20%, color-mix(in oklch, var(--ses-accent-soft) 86%, transparent), transparent 36%), var(--ses-surface); }
.cover-preview::before { position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--ses-accent); content: ''; }
.preview-topline { display: flex; justify-content: space-between; align-items: center; color: var(--ses-ink-3); font-size: 10.5px; font-weight: 600; }
.preview-live { display: inline-flex; align-items: center; gap: 5px; color: var(--ses-ink-4); font-size: 9.5px; font-weight: 400; }
.preview-live i { width: 5px; height: 5px; background: var(--ses-accent); }
.preview-content { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-top: 13px; }
.preview-main { min-width: 0; }
.preview-standard-no { margin-bottom: 9px; color: var(--ses-ink-2); font: 600 12px var(--ses-font-mono); overflow-wrap: anywhere; }
.preview-title-cn { max-width: 660px; color: var(--ses-ink); font-size: 17px; font-weight: 650; line-height: 1.4; overflow-wrap: anywhere; }
.preview-title-en { max-width: 660px; margin-top: 4px; color: var(--ses-ink-3); font: 11px/1.5 var(--ses-font-mono); overflow-wrap: anywhere; }
.preview-details { flex: 0 0 auto; display: grid; justify-items: end; gap: 8px; }
.preview-type { padding: 4px 8px; border-radius: 5px; background: var(--ses-accent-soft); color: var(--ses-accent); font-size: 10px; font-weight: 650; }
.preview-stage { color: var(--ses-ink-2); font-size: 10.5px; }
.preview-stage.is-unknown { color: var(--ses-warn); }
.preview-classification { display: flex; gap: 14px; color: var(--ses-ink-2); font: 10px var(--ses-font-mono); }
.preview-classification span { display: grid; gap: 2px; max-width: 100px; overflow-wrap: anywhere; }
.preview-classification small { color: var(--ses-ink-4); font: 600 8px var(--ses-font-mono); letter-spacing: .08em; }
.settings-form { padding-bottom: 18px; }
.settings-card { padding: 0 19px 17px; scroll-margin-top: 16px; }
.card-heading { display: flex; align-items: center; gap: 12px; padding: 16px 0 14px; border-bottom: 1px solid var(--ses-line); }
.card-number { width: 32px; height: 32px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid color-mix(in oklch, var(--ses-accent) 20%, var(--ses-line)); border-radius: 9px; background: var(--ses-accent-soft); color: var(--ses-accent); font: 650 10px var(--ses-font-mono); }
.card-heading h2 { margin: 0; color: var(--ses-ink); font-size: 13px; font-weight: 650; }
.card-heading p { margin: 3px 0 0; color: var(--ses-ink-4); font-size: 10.5px; }
.card-icon { margin-left: auto; color: var(--ses-ink-4); font-size: 17px; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 18px; padding-top: 14px; }
.field-span-2 { grid-column: 1 / -1; }
.full-width { width: 100%; }
.field-hint { margin-top: 3px; color: var(--ses-ink-4); font-size: 10px; line-height: 1.5; }
.type-option { display: flex; align-items: center; gap: 8px; }
.type-option i { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 5px; background: var(--ses-accent-soft); color: var(--ses-accent); font-style: normal; font-size: 10px; }
.type-option small, .stage-option small { margin-left: auto; color: var(--ses-ink-4); font: 10px var(--ses-font-mono); }
.stage-option { display: flex; align-items: center; gap: 7px; }
.stage-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ses-accent); }
.stage-dot.published { background: var(--ses-ok); }
.stage-dot.comment_draft, .stage-dot.public_draft { background: var(--ses-warn); }
.settings-actions { position: sticky; bottom: 0; z-index: 2; max-width: 940px; display: flex; justify-content: space-between; align-items: center; gap: 16px; margin: 0 auto; padding: 12px 15px; border: 1px solid var(--ses-line); border-radius: 12px 12px 0 0; background: color-mix(in oklch, var(--ses-surface) 95%, transparent); box-shadow: 0 -5px 22px oklch(0.25 0.02 275 / .06); backdrop-filter: blur(12px); }
.action-status { min-width: 0; display: inline-flex; align-items: center; gap: 7px; color: var(--ses-ink-3); font-size: 10.5px; }
.action-status .el-icon { color: var(--ses-ok); }
.action-status.is-error, .action-status.is-error .el-icon { color: var(--ses-err); }
.action-buttons { display: flex; gap: 8px; }
@keyframes pulse { 50% { opacity: .35; } }

:deep(.el-form-item) { min-width: 0; margin-bottom: 12px; }
:deep(.el-form-item__label) { height: auto; padding-bottom: 5px; color: var(--ses-ink-2); font-size: 11px; line-height: 1.45; font-weight: 600; }
:deep(.el-input__wrapper), :deep(.el-select__wrapper) { min-height: 36px; border-radius: 7px; box-shadow: 0 0 0 1px var(--ses-line) inset; }
:deep(.el-input__wrapper:hover), :deep(.el-select__wrapper:hover) { box-shadow: 0 0 0 1px color-mix(in oklch, var(--ses-accent) 45%, var(--ses-line)) inset; }
:deep(.el-input__inner) { color: var(--ses-ink); font-size: 11.5px; }
:deep(.el-input__inner::placeholder) { color: var(--ses-ink-4); }
:deep(.el-button) { border-radius: 7px; font-size: 11px; }
:deep(.el-button--primary) { --el-button-bg-color: var(--ses-accent); --el-button-border-color: var(--ses-accent); --el-button-hover-bg-color: var(--ses-accent-2); --el-button-hover-border-color: var(--ses-accent-2); }

@media (max-width: 1000px) {
  .settings-layout { grid-template-columns: 176px minmax(0, 1fr); }
  .settings-rail { padding-left: 12px; padding-right: 10px; }
  .settings-scroll { padding-left: 20px; padding-right: 20px; }
  .settings-actions { align-items: flex-start; }
}
@media (max-width: 760px) {
  .settings-layout { display: block; }
  .settings-rail { position: static; min-height: 0; padding: 12px 14px 8px; border-right: 0; border-bottom: 1px solid var(--ses-line); }
  .rail-heading { padding: 0 2px 9px; border: 0; }
  .rail-mark { width: 29px; height: 29px; border-radius: 8px; }
  .section-nav { display: flex; gap: 6px; overflow-x: auto; padding: 0 0 3px; }
  .section-link { width: auto; flex: 0 0 auto; gap: 6px; padding: 6px 8px; font-size: 10px; }
  .section-link-num { width: 19px; height: 19px; font-size: 8px; }
  .section-link .el-icon, .rail-note { display: none; }
  .settings-scroll { max-height: none; overflow: visible; padding: 17px 13px 20px; }
  .settings-heading { align-items: flex-start; margin-bottom: 13px; }
  .settings-heading h1 { font-size: 20px; }
  .settings-heading p { max-width: 300px; font-size: 10.5px; }
  .draft-state { max-width: 138px; white-space: normal; line-height: 1.35; }
  .cover-preview { padding: 12px 13px; }
  .preview-content { align-items: flex-start; gap: 8px; }
  .preview-title-cn { font-size: 14px; }
  .preview-title-en { font-size: 9.5px; }
  .preview-details { max-width: 95px; }
  .preview-classification { flex-direction: column; gap: 5px; }
  .settings-card { padding: 0 13px 12px; }
  .field-grid { column-gap: 10px; }
  .settings-actions { flex-direction: column; align-items: stretch; padding: 10px; }
  .action-status { min-height: 16px; }
  .action-buttons { justify-content: flex-end; }
}
@media (max-width: 440px) {
  .field-grid { grid-template-columns: minmax(0, 1fr); }
  .field-span-2 { grid-column: auto; }
  .settings-heading { display: block; }
  .draft-state { margin-top: 8px; }
  .preview-content { display: block; }
  .preview-details { display: flex; flex-wrap: wrap; align-items: center; justify-items: start; max-width: none; margin-top: 12px; }
  .preview-classification { flex-direction: row; }
  .action-buttons { width: 100%; }
  .action-buttons .el-button:first-child { flex: 1; }
}
</style>
