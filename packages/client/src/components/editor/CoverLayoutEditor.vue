<template>
  <div class="cover-layout-editor" data-testid="cover-layout-editor">
    <section class="cover-layout-accordion" aria-label="封面与版式扩展配置">
      <div class="accordion-toolbar">
        <span class="toolbar-summary">
          已启用 <strong>{{ activeSectionCount }}</strong> / 5 项扩展（按需展开配置，修改实时反映到右侧预览）
        </span>
        <button
          type="button"
          class="toggle-all-btn"
          :aria-expanded="allOpen"
          data-testid="layout-toggle-all-btn"
          @click="toggleAllSections"
        >
          {{ allOpen ? '全部收起' : '全部展开' }}
        </button>
      </div>

      <!-- 1. 封面徽标 -->
      <details
        class="layout-acc-item"
        :open="openSections.logo"
        data-testid="acc-section-logo"
        @toggle="onSectionToggle('logo', $event)"
      >
        <summary class="acc-summary">
          <span class="acc-summary-text">
            <span class="acc-title">封面徽标</span>
            <span class="acc-desc">支持 PNG / JPEG（≤ 2 MB），支持衬于文字下方或嵌入型</span>
          </span>
          <span class="acc-status" :class="{ 'is-active': Boolean(logo) }">
            {{ logo ? `${positionLabel(logo.position)} · ${logo.widthMm}×${logo.heightMm}mm` : '未上传' }}
          </span>
        </summary>
        <div class="acc-body">
          <input
            ref="logoFileInputRef"
            type="file"
            accept="image/png,image/jpeg"
            class="sr-only-input"
            data-testid="cover-logo-file-input"
            :disabled="disabled"
            @change="onLogoFileSelected"
          />

          <div v-if="!logo" class="dropzone-empty" :class="{ 'is-dragover': logoDragOver }" @dragover.prevent="onLogoDragOver" @dragleave.self="logoDragOver = false" @drop.prevent="onLogoDrop">
            <div class="dropzone-text">
              <strong>拖拽 PNG / JPEG 图片到此处</strong>
              <span>或点击上传，仅在打印与导出 DOCX / PDF 时生效</span>
            </div>
            <el-button size="small" :disabled="disabled" data-testid="cover-logo-upload-btn" @click="triggerLogoPicker">
              上传徽标
            </el-button>
          </div>

          <div v-else class="logo-toolbar">
            <div class="block-actions">
              <el-button size="small" :disabled="disabled" data-testid="cover-logo-upload-btn" @click="triggerLogoPicker">
                更换徽标
              </el-button>
              <el-button
                size="small"
                plain
                type="danger"
                :disabled="disabled"
                data-testid="cover-logo-clear-btn"
                @click="clearLogo"
              >
                清除徽标
              </el-button>
            </div>
          </div>

          <p v-if="logoUploadError" class="inline-error" role="alert" data-testid="cover-logo-error">{{ logoUploadError }}</p>

          <div v-if="logo" class="logo-config">
            <div
              class="logo-preview-box drop-target"
              :class="{ 'is-dragover': logoDragOver }"
              title="可拖拽新图片至此替换徽标"
              @dragover.prevent="onLogoDragOver"
              @dragleave.self="logoDragOver = false"
              @drop.prevent="onLogoDrop"
            >
              <img :src="logo.dataUrl" alt="封面徽标预览" class="logo-thumb" />
            </div>
            <div class="logo-fields">
              <el-form-item label="徽标位置">
                <el-radio-group
                  :model-value="logo.position"
                  :disabled="disabled"
                  data-testid="cover-logo-position"
                  @update:model-value="(val: string | number | boolean | undefined) => updateLogoPosition(val as CoverLogoPosition)"
                >
                  <el-radio-button value="top_left">左上角独立徽标</el-radio-button>
                  <el-radio-button value="center">封面居中下方</el-radio-button>
                  <el-radio-button value="replace_mark" :disabled="replaceMarkBlocked">替换右上角标志</el-radio-button>
                </el-radio-group>
                <div v-if="replaceMarkBlocked" class="field-hint is-warn" data-testid="replace-mark-hint">
                  国家标准与指导性技术文件受法定版式限制，禁止替换右上角 GB 标志。
                </div>
              </el-form-item>

              <el-form-item label="环绕方式">
                <el-radio-group
                  :model-value="logo.wrap ?? 'behind_text'"
                  :disabled="disabled"
                  data-testid="cover-logo-wrap"
                  @update:model-value="(val: string | number | boolean | undefined) => updateLogoWrap(val as CoverLogoWrap)"
                >
                  <el-radio-button value="behind_text">衬于文字下方（默认）</el-radio-button>
                  <el-radio-button value="inline">嵌入型</el-radio-button>
                </el-radio-group>
              </el-form-item>

              <div class="size-grid">
                <el-form-item label="宽度 (mm)">
                  <el-input-number
                    v-model="logoWidthDraft"
                    :min="COVER_LOGO_MIN_MM"
                    :max="COVER_LOGO_MAX_WIDTH_MM"
                    :precision="1"
                    :step="1"
                    :disabled="disabled"
                    controls-position="right"
                    style="width: 100%"
                    data-testid="cover-logo-width"
                    @change="(val: number | undefined) => commitLogoDimension('widthMm', val)"
                  />
                </el-form-item>
                <el-form-item label="高度 (mm)">
                  <el-input-number
                    v-model="logoHeightDraft"
                    :min="COVER_LOGO_MIN_MM"
                    :max="COVER_LOGO_MAX_HEIGHT_MM"
                    :precision="1"
                    :step="1"
                    :disabled="disabled"
                    controls-position="right"
                    style="width: 100%"
                    data-testid="cover-logo-height"
                    @change="(val: number | undefined) => commitLogoDimension('heightMm', val)"
                  />
                </el-form-item>
                <el-form-item label="水平偏移 X (mm)">
                  <el-input-number
                    v-model="logoOffsetXDraft"
                    :min="-40"
                    :max="40"
                    :precision="1"
                    :step="1"
                    :disabled="disabled"
                    controls-position="right"
                    style="width: 100%"
                    data-testid="cover-logo-offset-x"
                    @change="(val: number | undefined) => commitLogoOffset('offsetXMm', val)"
                  />
                </el-form-item>
                <el-form-item label="垂直偏移 Y (mm)">
                  <el-input-number
                    v-model="logoOffsetYDraft"
                    :min="-40"
                    :max="40"
                    :precision="1"
                    :step="1"
                    :disabled="disabled"
                    controls-position="right"
                    style="width: 100%"
                    data-testid="cover-logo-offset-y"
                    @change="(val: number | undefined) => commitLogoOffset('offsetYMm', val)"
                  />
                </el-form-item>
              </div>
              <div class="lock-ratio-row">
                <el-checkbox v-model="lockLogoAspectRatio" :disabled="disabled" data-testid="cover-logo-lock-ratio">
                  锁定宽高比（修改其一时按当前比例同步另一边）
                </el-checkbox>
              </div>
            </div>
          </div>
        </div>
      </details>

      <!-- 2. 右上角标准标志 -->
      <details
        class="layout-acc-item"
        :open="openSections.topRightMark"
        data-testid="acc-section-mark"
        @toggle="onSectionToggle('topRightMark', $event)"
      >
        <summary class="acc-summary">
          <span class="acc-summary-text">
            <span class="acc-title">右上角标准标志</span>
            <span class="acc-desc">可保留默认标志、替换为自定义文字或隐藏删除</span>
          </span>
          <span class="acc-status" :class="{ 'is-active': !replaceMarkBlocked && topRightMode !== 'default' }">
            {{ topRightStatusText }}
          </span>
        </summary>
        <div class="acc-body">
          <el-form-item label="显示方式">
            <el-radio-group
              :model-value="topRightMode"
              :disabled="disabled || replaceMarkBlocked"
              data-testid="top-right-mark-mode"
              @update:model-value="(val: string | number | boolean | undefined) => updateTopRightMode(val as CoverTopRightMarkMode)"
            >
              <el-radio-button value="default">默认标志</el-radio-button>
              <el-radio-button value="text">自定义文字</el-radio-button>
              <el-radio-button value="hidden">删除 / 隐藏</el-radio-button>
            </el-radio-group>
            <div v-if="replaceMarkBlocked" class="field-hint is-warn" data-testid="top-right-mark-hint">
              国家标准与指导性技术文件受法定版式限制，禁止删除或改写右上角标志。
            </div>
            <div v-else-if="logo?.position === 'replace_mark'" class="field-hint" data-testid="top-right-mark-overridden">
              当前封面徽标设为「替换右上角标志」，右上角将显示徽标图片。
            </div>
          </el-form-item>

          <div v-if="!replaceMarkBlocked && topRightMode === 'text'" class="two-col">
            <el-form-item label="标志文字内容">
              <el-input
                :model-value="modelValue?.topRightMark?.text ?? ''"
                :maxlength="TOP_RIGHT_MARK_MAX_LENGTH"
                :disabled="disabled"
                placeholder="例如：T/ZSM"
                data-testid="top-right-mark-text"
                @update:model-value="updateTopRightText"
              />
            </el-form-item>
            <el-form-item label="字号 (pt)">
              <el-input-number
                v-model="topRightFontDraft"
                :min="TOP_RIGHT_MARK_MIN_PT"
                :max="TOP_RIGHT_MARK_MAX_PT"
                :precision="0"
                :step="1"
                :disabled="disabled"
                controls-position="right"
                style="width: 100%"
                data-testid="top-right-mark-size"
                @change="commitTopRightFont"
              />
            </el-form-item>
          </div>
        </div>
      </details>

      <!-- 3. 封面附加声明 -->
      <details
        class="layout-acc-item"
        :open="openSections.notice"
        data-testid="acc-section-notice"
        @toggle="onSectionToggle('notice', $event)"
      >
        <summary class="acc-summary">
          <span class="acc-summary-text">
            <span class="acc-title">封面附加声明</span>
            <span class="acc-desc">补充版权归属、内部受控或试点说明，留空不显示</span>
          </span>
          <span class="acc-status" :class="{ 'is-active': noticeText.trim().length > 0 }">
            {{ noticeText.trim().length > 0 ? (noticePosition === 'above_dates' ? '日期上方' : '发布单位下方') : '未设置' }}
          </span>
        </summary>
        <div class="acc-body">
          <el-form-item label="声明内容">
            <el-input
              type="textarea"
              :rows="2"
              :maxlength="COVER_NOTICE_MAX_LENGTH"
              show-word-limit
              :disabled="disabled"
              :model-value="noticeText"
              placeholder="例如：本文件仅供试点单位内部试用，未经许可不得翻印。"
              data-testid="cover-notice-text"
              @update:model-value="updateNoticeText"
            />
          </el-form-item>
          <el-form-item label="声明位置">
            <el-radio-group
              :model-value="noticePosition"
              :disabled="disabled"
              data-testid="cover-notice-position"
              @update:model-value="(val: string | number | boolean | undefined) => updateNoticePosition(val as CoverNoticePosition)"
            >
              <el-radio-button value="above_dates">发布/实施日期上方</el-radio-button>
              <el-radio-button value="below_issuer">发布单位下方</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </div>
      </details>

      <!-- 4. 封面背面 / 版权页（自由组合块） -->
      <details
        class="layout-acc-item"
        :open="openSections.backCover"
        data-testid="acc-section-back-cover"
        @toggle="onSectionToggle('backCover', $event)"
      >
        <summary class="acc-summary">
          <span class="acc-summary-text">
            <span class="acc-title">封面背面 / 版权页</span>
            <span class="acc-desc">插入在封面之后、目次之前（第 2 页），无页眉页脚/水印且不计页码</span>
          </span>
          <span class="acc-status" :class="{ 'is-active': Boolean(modelValue?.backCover?.enabled) }">
            {{ modelValue?.backCover?.enabled ? `已启用 · ${backCoverBlocks.length} 块` : '未启用' }}
          </span>
        </summary>
        <div class="acc-body">
          <div class="inline-switch-row">
            <span>启用后固定插入在封面之后、目次之前，支持自由增删和排序内容块。</span>
            <el-switch
              :model-value="Boolean(modelValue?.backCover?.enabled)"
              :disabled="disabled"
              active-text="启用版权页"
              data-testid="back-cover-switch"
              @update:model-value="(val: string | number | boolean) => toggleBackCover(Boolean(val))"
            />
          </div>

          <div v-if="modelValue?.backCover?.enabled" class="sub-fields" data-testid="back-cover-fields">
            <div class="bc-toolbar">
              <el-form-item label="页面垂直对齐">
                <el-radio-group
                  :model-value="backCoverVerticalAlign"
                  :disabled="disabled"
                  data-testid="back-cover-vertical-align"
                  @update:model-value="(val: string | number | boolean | undefined) => updateBackCoverPageProp('verticalAlign', val as BackCoverVerticalAlign)"
                >
                  <el-radio-button value="top">顶部</el-radio-button>
                  <el-radio-button value="middle">居中</el-radio-button>
                  <el-radio-button value="bottom">底部（版权页）</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="边框样式">
                <el-switch
                  :model-value="Boolean(modelValue.backCover.boxed)"
                  :disabled="disabled"
                  active-text="显示外框线"
                  data-testid="back-cover-boxed"
                  @update:model-value="(val: string | number | boolean) => updateBackCoverPageProp('boxed', Boolean(val))"
                />
              </el-form-item>
              <el-form-item label="快速预设">
                <el-button size="small" :disabled="disabled" data-testid="back-cover-preset-btn" @click="applyCopyrightPreset">
                  载入「版权保护文件」预设
                </el-button>
              </el-form-item>
            </div>

            <input
              ref="bcImageInputRef"
              type="file"
              accept="image/png,image/jpeg"
              class="sr-only-input"
              data-testid="back-cover-image-input"
              @change="onBackCoverImageSelected"
            />
            <p v-if="bcImageError" class="inline-error" role="alert">{{ bcImageError }}</p>

            <div class="bc-block-list" data-testid="back-cover-blocks">
              <div v-if="backCoverBlocks.length === 0" class="bc-empty">
                暂无内容块，请点击下方按钮添加标题、段落、图片或分隔线，或载入「版权保护文件」预设。
              </div>

              <div
                v-for="(block, idx) in backCoverBlocks"
                :key="block.id"
                class="bc-block-card"
                :data-testid="`bc-block-${idx}`"
              >
                <div class="bc-block-head">
                  <span class="bc-block-tag">{{ blockTypeLabel(block) }} #{{ idx + 1 }}</span>
                  <div class="bc-block-ops">
                    <el-button size="small" text :disabled="disabled || idx === 0" @click="moveBackCoverBlock(idx, -1)">上移</el-button>
                    <el-button size="small" text :disabled="disabled || idx === backCoverBlocks.length - 1" @click="moveBackCoverBlock(idx, 1)">下移</el-button>
                    <el-button size="small" text type="danger" :disabled="disabled" @click="removeBackCoverBlock(idx)">删除</el-button>
                  </div>
                </div>

                <template v-if="block.type === 'heading' || block.type === 'paragraph'">
                  <el-input
                    :type="block.type === 'paragraph' ? 'textarea' : 'text'"
                    :rows="block.type === 'paragraph' ? 3 : undefined"
                    :model-value="block.text"
                    :disabled="disabled"
                    :placeholder="block.type === 'heading' ? '输入标题文字（如：版权保护文件）' : '输入段落内容，支持换行'"
                    @update:model-value="(val: string) => patchBackCoverBlock(idx, { text: val })"
                  />
                  <div class="bc-block-props">
                    <el-radio-group
                      size="small"
                      :model-value="block.align ?? (block.type === 'heading' ? 'center' : 'left')"
                      :disabled="disabled"
                      @update:model-value="(val: string | number | boolean | undefined) => patchBackCoverBlock(idx, { align: val as BackCoverAlign })"
                    >
                      <el-radio-button value="left">左对齐</el-radio-button>
                      <el-radio-button value="center">居中</el-radio-button>
                      <el-radio-button value="right">右对齐</el-radio-button>
                    </el-radio-group>
                    <div class="inline-num">
                      <span>字号(pt)</span>
                      <el-input-number
                        size="small"
                        :model-value="block.fontSizePt ?? (block.type === 'heading' ? 14 : 10.5)"
                        :min="BACK_COVER_FONT_MIN_PT"
                        :max="BACK_COVER_FONT_MAX_PT"
                        :precision="1"
                        :step="0.5"
                        :disabled="disabled"
                        controls-position="right"
                        style="width: 96px"
                        @update:model-value="(val: number | undefined) => typeof val === 'number' && patchBackCoverBlock(idx, { fontSizePt: val })"
                      />
                    </div>
                    <el-checkbox
                      :model-value="block.bold ?? block.type === 'heading'"
                      :disabled="disabled"
                      @update:model-value="(val: string | number | boolean) => patchBackCoverBlock(idx, { bold: Boolean(val) })"
                    >
                      加粗
                    </el-checkbox>
                    <el-checkbox
                      v-if="block.type === 'paragraph'"
                      :model-value="Boolean(block.indent)"
                      :disabled="disabled"
                      @update:model-value="(val: string | number | boolean) => patchBackCoverBlock(idx, { indent: Boolean(val) })"
                    >
                      首行缩进
                    </el-checkbox>
                  </div>
                </template>

                <template v-else-if="block.type === 'image'">
                  <div class="bc-image-row">
                    <div class="bc-image-thumb-box">
                      <img :src="block.dataUrl" alt="封底图片" class="logo-thumb" />
                    </div>
                    <div class="bc-image-controls">
                      <div class="bc-image-btns">
                        <el-button size="small" :disabled="disabled" @click="triggerBackCoverImagePicker(idx)">更换图片</el-button>
                        <el-button v-if="logo" size="small" :disabled="disabled" @click="useCoverLogoForBackCoverBlock(idx)">使用封面徽标</el-button>
                        <el-button size="small" :disabled="disabled" @click="useWarningIconForBackCoverBlock(idx)">使用警示图标</el-button>
                      </div>
                      <div class="bc-block-props">
                        <el-radio-group
                          size="small"
                          :model-value="block.align ?? 'center'"
                          :disabled="disabled"
                          @update:model-value="(val: string | number | boolean | undefined) => patchBackCoverBlock(idx, { align: val as BackCoverAlign })"
                        >
                          <el-radio-button value="left">左</el-radio-button>
                          <el-radio-button value="center">中</el-radio-button>
                          <el-radio-button value="right">右</el-radio-button>
                        </el-radio-group>
                        <div class="inline-num">
                          <span>宽(mm)</span>
                          <el-input-number
                            size="small"
                            :model-value="block.widthMm"
                            :min="COVER_LOGO_MIN_MM"
                            :max="BACK_COVER_IMAGE_MAX_WIDTH_MM"
                            :precision="1"
                            :step="1"
                            :disabled="disabled"
                            controls-position="right"
                            style="width: 96px"
                            @update:model-value="(val: number | undefined) => typeof val === 'number' && patchBackCoverBlock(idx, { widthMm: clamp(val, COVER_LOGO_MIN_MM, BACK_COVER_IMAGE_MAX_WIDTH_MM) })"
                          />
                        </div>
                        <div class="inline-num">
                          <span>高(mm)</span>
                          <el-input-number
                            size="small"
                            :model-value="block.heightMm"
                            :min="COVER_LOGO_MIN_MM"
                            :max="BACK_COVER_IMAGE_MAX_HEIGHT_MM"
                            :precision="1"
                            :step="1"
                            :disabled="disabled"
                            controls-position="right"
                            style="width: 96px"
                            @update:model-value="(val: number | undefined) => typeof val === 'number' && patchBackCoverBlock(idx, { heightMm: clamp(val, COVER_LOGO_MIN_MM, BACK_COVER_IMAGE_MAX_HEIGHT_MM) })"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="block.type === 'divider'">
                  <div class="bc-divider-preview" />
                </template>
              </div>
            </div>

            <div class="bc-add-bar">
              <el-button size="small" :disabled="disabled || backCoverBlocks.length >= BACK_COVER_MAX_BLOCKS" data-testid="bc-add-heading" @click="addBackCoverBlock('heading')">
                + 标题
              </el-button>
              <el-button size="small" :disabled="disabled || backCoverBlocks.length >= BACK_COVER_MAX_BLOCKS" data-testid="bc-add-paragraph" @click="addBackCoverBlock('paragraph')">
                + 段落
              </el-button>
              <el-button size="small" :disabled="disabled || backCoverBlocks.length >= BACK_COVER_MAX_BLOCKS" data-testid="bc-add-image" @click="addBackCoverBlock('image')">
                + 图片
              </el-button>
              <el-button size="small" :disabled="disabled || backCoverBlocks.length >= BACK_COVER_MAX_BLOCKS" data-testid="bc-add-divider" @click="addBackCoverBlock('divider')">
                + 分隔线
              </el-button>
            </div>
          </div>
        </div>
      </details>

      <!-- 5. 正文水印 -->
      <details
        class="layout-acc-item"
        :open="openSections.watermark"
        data-testid="acc-section-watermark"
        @toggle="onSectionToggle('watermark', $event)"
      >
        <summary class="acc-summary">
          <span class="acc-summary-text">
            <span class="acc-title">正文水印</span>
            <span class="acc-desc">仅对目次、前言、引言、正文、附录及参考文献页生效，封面与版权页自动跳过</span>
          </span>
          <span class="acc-status" :class="{ 'is-active': Boolean(modelValue?.watermark?.enabled) }">
            {{ watermarkStatusText }}
          </span>
        </summary>
        <div class="acc-body">
          <div class="inline-switch-row">
            <span>支持文字或图片水印，可选择每页或隔一页（仅奇数页）显示。</span>
            <el-switch
              :model-value="Boolean(modelValue?.watermark?.enabled)"
              :disabled="disabled"
              active-text="启用水印"
              data-testid="watermark-switch"
              @update:model-value="(val: string | number | boolean) => toggleWatermark(Boolean(val))"
            />
          </div>

          <div v-if="modelValue?.watermark?.enabled" class="sub-fields" data-testid="watermark-fields">
            <div class="two-col">
              <el-form-item label="水印类型">
                <el-radio-group
                  :model-value="modelValue.watermark.kind"
                  :disabled="disabled"
                  data-testid="watermark-kind"
                  @update:model-value="(val: string | number | boolean | undefined) => updateWatermarkKind(val as WatermarkKind)"
                >
                  <el-radio-button value="text">文字水印</el-radio-button>
                  <el-radio-button value="image">图片 / 徽标水印</el-radio-button>
                </el-radio-group>
              </el-form-item>

              <el-form-item label="应用频率">
                <el-radio-group
                  :model-value="modelValue.watermark.frequency"
                  :disabled="disabled"
                  data-testid="watermark-frequency"
                  @update:model-value="(val: string | number | boolean | undefined) => updateWatermarkField({ frequency: val as WatermarkFrequency })"
                >
                  <el-radio-button value="every">每一页</el-radio-button>
                  <el-radio-button value="alternate">隔一页（仅奇数页）</el-radio-button>
                </el-radio-group>
              </el-form-item>
            </div>

            <template v-if="modelValue.watermark.kind === 'text'">
              <div class="two-col">
                <el-form-item label="水印文字">
                  <el-input
                    :model-value="modelValue.watermark.text ?? ''"
                    :maxlength="WATERMARK_TEXT_MAX_LENGTH"
                    :disabled="disabled"
                    placeholder="例如：内部草案"
                    data-testid="watermark-text"
                    @update:model-value="(val: string) => updateWatermarkField({ text: val })"
                  />
                </el-form-item>
                <el-form-item label="颜色">
                  <div class="color-row">
                    <input
                      type="color"
                      :value="modelValue.watermark.color ?? '#8c8c8c'"
                      :disabled="disabled"
                      class="color-swatch"
                      data-testid="watermark-color-picker"
                      @input="(e: Event) => updateWatermarkField({ color: (e.target as HTMLInputElement).value })"
                    />
                    <el-input
                      :model-value="modelValue.watermark.color ?? '#8c8c8c'"
                      :disabled="disabled"
                      maxlength="7"
                      data-testid="watermark-color"
                      @update:model-value="(val: string) => /^#[0-9a-fA-F]{6}$/.test(val) && updateWatermarkField({ color: val })"
                    />
                  </div>
                </el-form-item>
              </div>
              <div class="three-col">
                <el-form-item label="字号 (pt)">
                  <el-input-number
                    v-model="wmFontDraft"
                    :min="WATERMARK_FONT_MIN_PT"
                    :max="WATERMARK_FONT_MAX_PT"
                    :precision="0"
                    :step="2"
                    :disabled="disabled"
                    controls-position="right"
                    style="width: 100%"
                    data-testid="watermark-font-size"
                    @change="(val: number | undefined) => typeof val === 'number' && updateWatermarkField({ fontSizePt: Math.round(clamp(val, WATERMARK_FONT_MIN_PT, WATERMARK_FONT_MAX_PT)) })"
                  />
                </el-form-item>
                <el-form-item label="旋转角度 (°)">
                  <el-input-number
                    v-model="wmRotationDraft"
                    :min="-90"
                    :max="90"
                    :precision="0"
                    :step="5"
                    :disabled="disabled"
                    controls-position="right"
                    style="width: 100%"
                    data-testid="watermark-rotation"
                    @change="(val: number | undefined) => typeof val === 'number' && updateWatermarkField({ rotationDeg: Math.round(clamp(val, -90, 90)) })"
                  />
                </el-form-item>
                <el-form-item label="透明度 (0.01 ~ 1.0)">
                  <el-input-number
                    v-model="wmOpacityDraft"
                    :min="WATERMARK_MIN_OPACITY"
                    :max="WATERMARK_MAX_OPACITY"
                    :precision="2"
                    :step="0.05"
                    :disabled="disabled"
                    controls-position="right"
                    style="width: 100%"
                    data-testid="watermark-opacity"
                    @change="(val: number | undefined) => typeof val === 'number' && updateWatermarkField({ opacity: clampOpacity(val) })"
                  />
                </el-form-item>
              </div>
            </template>

            <template v-else>
              <input
                ref="wmFileInputRef"
                type="file"
                accept="image/png,image/jpeg"
                class="sr-only-input"
                data-testid="watermark-image-input"
                @change="onWatermarkImageSelected"
              />
              <p v-if="wmUploadError" class="inline-error" role="alert">{{ wmUploadError }}</p>
              <div
                class="bc-image-row wm-dropzone"
                :class="{ 'is-dragover': wmDragOver }"
                @dragover.prevent="onWatermarkDragOver"
                @dragleave.self="wmDragOver = false"
                @drop.prevent="onWatermarkDrop"
              >
                <div class="bc-image-thumb-box" title="支持拖拽 PNG / JPEG 图片至此">
                  <img v-if="modelValue.watermark.dataUrl" :src="modelValue.watermark.dataUrl" alt="水印图片预览" class="logo-thumb" />
                  <span v-else class="no-img-hint">拖拽或上传</span>
                </div>
                <div class="bc-image-controls">
                  <div class="bc-image-btns">
                    <el-button size="small" :disabled="disabled" data-testid="watermark-image-upload-btn" @click="triggerWatermarkImagePicker">
                      {{ modelValue.watermark.dataUrl ? '更换水印图片' : '上传水印图片' }}
                    </el-button>
                    <el-button
                      v-if="logo"
                      size="small"
                      :disabled="disabled"
                      data-testid="watermark-reuse-logo-btn"
                      @click="reuseCoverLogoForWatermark"
                    >
                      复用封面徽标
                    </el-button>
                  </div>
                  <div class="three-col">
                    <el-form-item label="宽度 (mm)">
                      <el-input-number
                        v-model="wmWidthDraft"
                        :min="COVER_LOGO_MIN_MM"
                        :max="WATERMARK_IMAGE_MAX_WIDTH_MM"
                        :precision="1"
                        :step="2"
                        :disabled="disabled"
                        controls-position="right"
                        style="width: 100%"
                        data-testid="watermark-width"
                        @change="(val: number | undefined) => commitWatermarkDimension('widthMm', val)"
                      />
                    </el-form-item>
                    <el-form-item label="高度 (mm)">
                      <el-input-number
                        v-model="wmHeightDraft"
                        :min="COVER_LOGO_MIN_MM"
                        :max="WATERMARK_IMAGE_MAX_HEIGHT_MM"
                        :precision="1"
                        :step="2"
                        :disabled="disabled"
                        controls-position="right"
                        style="width: 100%"
                        data-testid="watermark-height"
                        @change="(val: number | undefined) => commitWatermarkDimension('heightMm', val)"
                      />
                    </el-form-item>
                    <el-form-item label="透明度 (0.01 ~ 1.0)">
                      <el-input-number
                        v-model="wmOpacityDraft"
                        :min="WATERMARK_MIN_OPACITY"
                        :max="WATERMARK_MAX_OPACITY"
                        :precision="2"
                        :step="0.05"
                        :disabled="disabled"
                        controls-position="right"
                        style="width: 100%"
                        data-testid="watermark-opacity"
                        @change="(val: number | undefined) => typeof val === 'number' && updateWatermarkField({ opacity: clampOpacity(val) })"
                      />
                    </el-form-item>
                  </div>
                  <div class="lock-ratio-row">
                    <el-checkbox v-model="lockWatermarkAspectRatio" :disabled="disabled" data-testid="watermark-lock-ratio">
                      锁定宽高比（修改其一时按当前比例同步另一边）
                    </el-checkbox>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </details>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  BACK_COVER_FONT_MAX_PT,
  BACK_COVER_FONT_MIN_PT,
  BACK_COVER_IMAGE_MAX_HEIGHT_MM,
  BACK_COVER_IMAGE_MAX_WIDTH_MM,
  BACK_COVER_MAX_BLOCKS,
  COVER_LOGO_ALLOWED_MIMES,
  COVER_LOGO_MAX_BYTES,
  COVER_LOGO_MAX_HEIGHT_MM,
  COVER_LOGO_MAX_WIDTH_MM,
  COVER_LOGO_MIN_MM,
  COVER_NOTICE_MAX_LENGTH,
  TOP_RIGHT_MARK_MAX_LENGTH,
  TOP_RIGHT_MARK_MAX_PT,
  TOP_RIGHT_MARK_MIN_PT,
  WATERMARK_FONT_MAX_PT,
  WATERMARK_FONT_MIN_PT,
  WATERMARK_IMAGE_MAX_HEIGHT_MM,
  WATERMARK_IMAGE_MAX_WIDTH_MM,
  WATERMARK_MAX_OPACITY,
  WATERMARK_MIN_OPACITY,
  WATERMARK_TEXT_MAX_LENGTH,
  cloneCoverLayout,
  isReplaceMarkForbidden,
  parseCoverLogoDataUrl,
  validateCoverLayout,
  type BackCoverAlign,
  type BackCoverBlock,
  type BackCoverConfig,
  type BackCoverVerticalAlign,
  type CoverLayoutConfig,
  type CoverLogoConfig,
  type CoverLogoPosition,
  type CoverLogoWrap,
  type CoverNoticePosition,
  type CoverTopRightMarkMode,
  type WatermarkConfig,
  type WatermarkFrequency,
  type WatermarkKind,
} from '@ses/shared'

const WARNING_TRIANGLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAgCAYAAAB6kdqOAAAAm0lEQVR4nN3WQQ7AIAgEQN/i//9I0ya9GI3ALioeOFWWiaVJi4gUtGqt8hYji4Zhoe4CtRgGio5BUXeARsMZqPyg2VAUBe+N50wYCD0HgaxDvKicIG+4py8fCP2Mrf2hGE9OHhD7P0eblwPExlhyp02RoF72stvR5i/FaOacC1qFmc0LX2Qt6J85fLijPtBuRFvngY57ZdHLa60H1j9LtuuSWL8AAAAASUVORK5CYII='

const props = defineProps<{
  modelValue?: CoverLayoutConfig
  standardType: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: CoverLayoutConfig | undefined): void
}>()

const SECTION_KEYS = ['logo', 'topRightMark', 'notice', 'backCover', 'watermark'] as const
type SectionKey = (typeof SECTION_KEYS)[number]

const openSections = reactive<Record<SectionKey, boolean>>({
  logo: true,
  topRightMark: Boolean(props.modelValue?.topRightMark && props.modelValue.topRightMark.mode !== 'default'),
  notice: Boolean(props.modelValue?.notice?.text?.trim()),
  backCover: Boolean(props.modelValue?.backCover?.enabled),
  watermark: Boolean(props.modelValue?.watermark?.enabled),
})

const allOpen = computed(() => SECTION_KEYS.every((k) => openSections[k]))

function onSectionToggle(key: SectionKey, event: Event): void {
  const target = event.target as HTMLDetailsElement
  openSections[key] = target.open
}

function toggleAllSections(): void {
  const expand = !allOpen.value
  for (const key of SECTION_KEYS) {
    openSections[key] = expand
  }
}

const logoFileInputRef = ref<HTMLInputElement | null>(null)
const bcImageInputRef = ref<HTMLInputElement | null>(null)
const wmFileInputRef = ref<HTMLInputElement | null>(null)

const logoDragOver = ref(false)
const wmDragOver = ref(false)

const logoUploadError = ref('')
const bcImageError = ref('')
const wmUploadError = ref('')
const pendingBcImageIdx = ref<number | null>(null)

const lockLogoAspectRatio = ref(false)
const lockWatermarkAspectRatio = ref(true)
const logoWidthDraft = ref(28)
const logoHeightDraft = ref(14)
const logoOffsetXDraft = ref(0)
const logoOffsetYDraft = ref(0)
const topRightFontDraft = ref(32)
const wmFontDraft = ref(48)
const wmRotationDraft = ref(-45)
const wmOpacityDraft = ref(0.2)
const wmWidthDraft = ref(90)
const wmHeightDraft = ref(90)

const preferredNoticePosition = ref<CoverNoticePosition>(props.modelValue?.notice?.position ?? 'above_dates')

watch(
  () => props.modelValue?.notice?.position,
  (pos) => {
    if (pos) preferredNoticePosition.value = pos
  },
)

watch(
  () => props.modelValue?.logo,
  (nextLogo) => {
    if (!nextLogo) return
    logoWidthDraft.value = nextLogo.widthMm
    logoHeightDraft.value = nextLogo.heightMm
    logoOffsetXDraft.value = nextLogo.offsetXMm ?? 0
    logoOffsetYDraft.value = nextLogo.offsetYMm ?? 0
  },
  { immediate: true, deep: true },
)

watch(
  () => props.modelValue?.topRightMark,
  (mark) => {
    topRightFontDraft.value = mark?.fontSizePt ?? 32
  },
  { immediate: true, deep: true },
)

watch(
  () => props.modelValue?.watermark,
  (wm) => {
    if (!wm) return
    wmFontDraft.value = wm.fontSizePt ?? 48
    wmRotationDraft.value = wm.rotationDeg ?? -45
    wmOpacityDraft.value = wm.opacity ?? (wm.kind === 'image' ? 0.18 : 0.2)
    wmWidthDraft.value = wm.widthMm ?? 90
    wmHeightDraft.value = wm.heightMm ?? 90
  },
  { immediate: true, deep: true },
)

const logo = computed(() => props.modelValue?.logo)
const noticeText = computed(() => props.modelValue?.notice?.text ?? '')
const noticePosition = computed<CoverNoticePosition>(
  () => props.modelValue?.notice?.position ?? preferredNoticePosition.value,
)
const replaceMarkBlocked = computed(() => isReplaceMarkForbidden(props.standardType))
const topRightMode = computed<CoverTopRightMarkMode>(() => {
  if (replaceMarkBlocked.value) return 'default'
  return props.modelValue?.topRightMark?.mode ?? 'default'
})
const backCoverVerticalAlign = computed<BackCoverVerticalAlign>(
  () => props.modelValue?.backCover?.verticalAlign ?? 'bottom',
)

const activeSectionCount = computed(() => {
  let count = 0
  if (logo.value?.dataUrl) count += 1
  if (!replaceMarkBlocked.value && topRightMode.value !== 'default') count += 1
  if (noticeText.value.trim().length > 0) count += 1
  if (props.modelValue?.backCover?.enabled) count += 1
  if (props.modelValue?.watermark?.enabled) count += 1
  return count
})

const topRightStatusText = computed(() => {
  if (replaceMarkBlocked.value) return '受国标限制锁定'
  if (topRightMode.value === 'hidden') return '已隐藏'
  if (topRightMode.value === 'text') return `文字：${props.modelValue?.topRightMark?.text || '未填'}`
  return '默认标志'
})

const watermarkStatusText = computed(() => {
  const wm = props.modelValue?.watermark
  if (!wm?.enabled) return '未启用'
  const freq = wm.frequency === 'alternate' ? '隔一页' : '每页'
  return `${wm.kind === 'image' ? '图片' : '文字'} · ${freq}`
})

function positionLabel(pos: CoverLogoPosition): string {
  if (pos === 'top_left') return '左上角'
  if (pos === 'center') return '居中'
  return '替换右上角'
}

function legacyToBlocks(bc: BackCoverConfig): BackCoverBlock[] {
  const out: BackCoverBlock[] = []
  let seq = 1
  if (bc.title) out.push({ id: `legacy_${seq++}`, type: 'heading', text: bc.title, align: 'center', fontSizePt: 15, bold: true })
  if (bc.copyrightNotice) out.push({ id: `legacy_${seq++}`, type: 'paragraph', text: bc.copyrightNotice, align: 'left', fontSizePt: 10.5 })
  if (bc.publisherInfo) out.push({ id: `legacy_${seq++}`, type: 'paragraph', text: bc.publisherInfo, align: 'left', fontSizePt: 10.5 })
  if (bc.contactInfo) out.push({ id: `legacy_${seq++}`, type: 'paragraph', text: bc.contactInfo, align: 'left', fontSizePt: 10.5 })
  if (bc.note) out.push({ id: `legacy_${seq++}`, type: 'paragraph', text: bc.note, align: 'left', fontSizePt: 10 })
  return out
}

const backCoverBlocks = computed<BackCoverBlock[]>(() => {
  const bc = props.modelValue?.backCover
  if (!bc?.enabled) return []
  if (Array.isArray(bc.blocks)) return bc.blocks
  return legacyToBlocks(bc)
})

function assertNeverBlockType(block: never): never {
  throw new Error(`Unexpected backCover block type: ${JSON.stringify(block)}`)
}

function blockTypeLabel(block: BackCoverBlock): string {
  switch (block.type) {
    case 'heading':
      return '标题'
    case 'paragraph':
      return '段落'
    case 'image':
      return '图片'
    case 'divider':
      return '分隔线'
    default:
      return assertNeverBlockType(block)
  }
}

function nextBlockId(): string {
  return `bc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10
}

function clampOpacity(value: number): number {
  return Math.round(Math.min(WATERMARK_MAX_OPACITY, Math.max(WATERMARK_MIN_OPACITY, value)) * 100) / 100
}

function emitNormalized(next: CoverLayoutConfig | undefined): void {
  if (!next) {
    emit('update:modelValue', undefined)
    return
  }
  const cleaned: CoverLayoutConfig = {}
  if (next.logo && next.logo.dataUrl) {
    cleaned.logo = { ...next.logo }
  }
  if (next.topRightMark && next.topRightMark.mode !== 'default' && !replaceMarkBlocked.value) {
    cleaned.topRightMark = { ...next.topRightMark }
  }
  if (next.notice && next.notice.text.trim().length > 0) {
    cleaned.notice = {
      text: next.notice.text,
      position: next.notice.position,
    }
  }
  if (next.backCover?.enabled) {
    cleaned.backCover = { ...next.backCover, enabled: true }
  }
  if (next.watermark?.enabled) {
    cleaned.watermark = { ...next.watermark, enabled: true }
  }
  emit('update:modelValue', Object.keys(cleaned).length > 0 ? cleaned : undefined)
}

function triggerLogoPicker(): void {
  logoUploadError.value = ''
  logoFileInputRef.value?.click()
}

function computeLogoSizeMm(naturalWidth: number, naturalHeight: number): { widthMm: number; heightMm: number } {
  if (!naturalWidth || !naturalHeight) {
    return { widthMm: 28, heightMm: 14 }
  }
  const ratio = naturalWidth / naturalHeight
  let widthMm = 28
  let heightMm = widthMm / ratio
  if (heightMm > COVER_LOGO_MAX_HEIGHT_MM) {
    heightMm = COVER_LOGO_MAX_HEIGHT_MM
    widthMm = heightMm * ratio
  }
  if (widthMm > COVER_LOGO_MAX_WIDTH_MM) {
    widthMm = COVER_LOGO_MAX_WIDTH_MM
    heightMm = widthMm / ratio
  }
  if (heightMm < COVER_LOGO_MIN_MM) {
    heightMm = COVER_LOGO_MIN_MM
    widthMm = Math.min(COVER_LOGO_MAX_WIDTH_MM, heightMm * ratio)
  }
  if (widthMm < COVER_LOGO_MIN_MM) {
    widthMm = COVER_LOGO_MIN_MM
    heightMm = Math.min(COVER_LOGO_MAX_HEIGHT_MM, widthMm / ratio)
  }
  return {
    widthMm: clamp(widthMm, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_WIDTH_MM),
    heightMm: clamp(heightMm, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_HEIGHT_MM),
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('读取图片失败'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve({ width: 0, height: 0 })
      return
    }
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = dataUrl
  })
}

function validateImageFileMeta(file: File, label: string): string | null {
  if (!(COVER_LOGO_ALLOWED_MIMES as readonly string[]).includes(file.type)) {
    return `仅支持 PNG 或 JPEG 图片作为${label}。`
  }
  if (file.size > COVER_LOGO_MAX_BYTES) {
    return `${label}文件大小不能超过 2 MB。`
  }
  return null
}

async function readValidatedImageFile(file: File, label: string): Promise<{ dataUrl: string; width: number; height: number } | { error: string }> {
  const metaError = validateImageFileMeta(file, label)
  if (metaError) return { error: metaError }
  try {
    const dataUrl = await readFileAsDataUrl(file)
    const parsed = parseCoverLogoDataUrl(dataUrl)
    if (!parsed || parsed.bytes > COVER_LOGO_MAX_BYTES) {
      return { error: `${label}须为 2 MB 以内的有效 PNG / JPEG 图片。` }
    }
    const dims = await readImageDimensions(dataUrl)
    return { dataUrl, ...dims }
  } catch {
    return { error: `读取${label}图片失败，请重试。` }
  }
}

async function applyLogoFile(file: File): Promise<void> {
  const metaError = validateImageFileMeta(file, '封面徽标')
  if (metaError) {
    logoUploadError.value = metaError
    return
  }

  const loaded = await readValidatedImageFile(file, '封面徽标')
  if ('error' in loaded) {
    logoUploadError.value = loaded.error
    return
  }

  const existing = props.modelValue?.logo
  const computedSize = computeLogoSizeMm(loaded.width, loaded.height)
  const defaultPos: CoverLogoPosition = existing?.position ?? 'top_left'
  const nextLogo: CoverLogoConfig = {
    dataUrl: loaded.dataUrl,
    position: replaceMarkBlocked.value && defaultPos === 'replace_mark' ? 'top_left' : defaultPos,
    wrap: existing?.wrap ?? 'behind_text',
    widthMm: computedSize.widthMm,
    heightMm: computedSize.heightMm,
    ...(typeof existing?.offsetXMm === 'number' ? { offsetXMm: existing.offsetXMm } : {}),
    ...(typeof existing?.offsetYMm === 'number' ? { offsetYMm: existing.offsetYMm } : {}),
  }

  const base = cloneCoverLayout(props.modelValue) ?? {}
  base.logo = nextLogo
  const validation = validateCoverLayout({ logo: nextLogo }, props.standardType)
  if (!validation.valid) {
    logoUploadError.value = validation.errors[0]?.message ?? '封面徽标参数校验失败。'
    return
  }
  logoUploadError.value = ''
  openSections.logo = true
  emitNormalized(base)
}

async function onLogoFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await applyLogoFile(file)
}

function onLogoDragOver(): void {
  if (!props.disabled) logoDragOver.value = true
}

async function onLogoDrop(event: DragEvent): Promise<void> {
  logoDragOver.value = false
  if (props.disabled) return
  const file = event.dataTransfer?.files?.[0]
  if (file) await applyLogoFile(file)
}

function clearLogo(): void {
  logoUploadError.value = ''
  const next = cloneCoverLayout(props.modelValue)
  if (!next) return
  delete next.logo
  emitNormalized(next)
}

function updateLogoPosition(position: CoverLogoPosition): void {
  if (!logo.value) return
  if (position === 'replace_mark' && replaceMarkBlocked.value) return
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.logo = { ...logo.value, position }
  emitNormalized(next)
}

function updateLogoWrap(wrap: CoverLogoWrap): void {
  if (!logo.value) return
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.logo = { ...logo.value, wrap }
  emitNormalized(next)
}

function commitLogoDimension(field: 'widthMm' | 'heightMm', value: number | undefined): void {
  if (!logo.value || typeof value !== 'number' || !Number.isFinite(value)) return
  const prevW = logo.value.widthMm || 28
  const prevH = logo.value.heightMm || 14
  const nextLogo: CoverLogoConfig = { ...logo.value }
  if (field === 'widthMm') {
    const newW = clamp(value, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_WIDTH_MM)
    nextLogo.widthMm = newW
    logoWidthDraft.value = newW
    if (lockLogoAspectRatio.value && prevW > 0) {
      const scaledH = clamp((newW * prevH) / prevW, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_HEIGHT_MM)
      nextLogo.heightMm = scaledH
      logoHeightDraft.value = scaledH
    }
  } else {
    const newH = clamp(value, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_HEIGHT_MM)
    nextLogo.heightMm = newH
    logoHeightDraft.value = newH
    if (lockLogoAspectRatio.value && prevH > 0) {
      const scaledW = clamp((newH * prevW) / prevH, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_WIDTH_MM)
      nextLogo.widthMm = scaledW
      logoWidthDraft.value = scaledW
    }
  }
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.logo = nextLogo
  emitNormalized(next)
}

function commitLogoOffset(field: 'offsetXMm' | 'offsetYMm', value: number | undefined): void {
  if (!logo.value) return
  const num = typeof value === 'number' && Number.isFinite(value) ? clamp(value, -40, 40) : 0
  if (field === 'offsetXMm') logoOffsetXDraft.value = num
  else logoOffsetYDraft.value = num
  const updated: CoverLogoConfig = { ...logo.value }
  if (num === 0) delete updated[field]
  else updated[field] = num
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.logo = updated
  emitNormalized(next)
}

function updateTopRightMode(mode: CoverTopRightMarkMode): void {
  if (replaceMarkBlocked.value) return
  const next = cloneCoverLayout(props.modelValue) ?? {}
  if (mode === 'default') {
    delete next.topRightMark
  } else if (mode === 'hidden') {
    next.topRightMark = { mode: 'hidden' }
  } else {
    next.topRightMark = {
      mode: 'text',
      text: next.topRightMark?.text?.trim() || '标准',
      fontSizePt: next.topRightMark?.fontSizePt ?? 32,
    }
  }
  emitNormalized(next)
}

function updateTopRightText(text: string): void {
  if (replaceMarkBlocked.value) return
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.topRightMark = {
    mode: 'text',
    text,
    fontSizePt: next.topRightMark?.fontSizePt ?? topRightFontDraft.value,
  }
  emitNormalized(next)
}

function commitTopRightFont(value: number | undefined): void {
  if (replaceMarkBlocked.value || typeof value !== 'number' || !Number.isFinite(value)) return
  const pt = Math.round(clamp(value, TOP_RIGHT_MARK_MIN_PT, TOP_RIGHT_MARK_MAX_PT))
  topRightFontDraft.value = pt
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.topRightMark = {
    mode: 'text',
    text: next.topRightMark?.text ?? '',
    fontSizePt: pt,
  }
  emitNormalized(next)
}

function updateNoticeText(text: string): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  if (text.trim().length > 0) {
    next.notice = {
      text,
      position: noticePosition.value,
    }
  } else {
    delete next.notice
  }
  emitNormalized(next)
}

function updateNoticePosition(position: CoverNoticePosition): void {
  preferredNoticePosition.value = position
  if (!props.modelValue?.notice?.text?.trim()) return
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.notice = {
    text: props.modelValue.notice.text,
    position,
  }
  emitNormalized(next)
}

function toggleBackCover(enabled: boolean): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  if (enabled) {
    next.backCover = {
      ...(next.backCover ?? {}),
      enabled: true,
      verticalAlign: next.backCover?.verticalAlign ?? 'bottom',
    }
    openSections.backCover = true
  } else {
    delete next.backCover
  }
  emitNormalized(next)
}

function updateBackCoverBlocks(blocks: BackCoverBlock[], overrides?: Partial<BackCoverConfig>): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  const prev = next.backCover ?? { enabled: true }
  next.backCover = {
    enabled: true,
    verticalAlign: overrides?.verticalAlign ?? prev.verticalAlign ?? 'bottom',
    ...(overrides?.boxed !== undefined ? { boxed: overrides.boxed } : prev.boxed ? { boxed: true } : {}),
    blocks,
  }
  emitNormalized(next)
}

function updateBackCoverPageProp(prop: 'verticalAlign' | 'boxed', value: BackCoverVerticalAlign | boolean): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  const current = next.backCover ?? { enabled: true }
  next.backCover = {
    ...current,
    enabled: true,
    [prop]: value,
  }
  emitNormalized(next)
}

function applyCopyrightPreset(): void {
  const presetBlocks: BackCoverBlock[] = [
    {
      id: nextBlockId(),
      type: 'image',
      dataUrl: WARNING_TRIANGLE_PNG,
      widthMm: 9.5,
      heightMm: 8.5,
      align: 'center',
      spaceBeforeMm: 1,
      spaceAfterMm: 2,
    },
    {
      id: nextBlockId(),
      type: 'heading',
      text: '版权保护文件',
      align: 'center',
      fontSizePt: 14,
      bold: true,
      spaceBeforeMm: 1,
      spaceAfterMm: 3,
    },
    {
      id: nextBlockId(),
      type: 'paragraph',
      text: '版权所有，侵权必究。除非另有授权，任何单位和个人未经发布组织书面许可，不得以任何方式复制、传播、修改或用于商业用途。',
      align: 'left',
      fontSizePt: 10.5,
      indent: true,
      spaceBeforeMm: 1,
      spaceAfterMm: 3,
    },
    {
      id: nextBlockId(),
      type: 'paragraph',
      text: '出版/发布单位：\n地　　址：\n电　　话：\n网　　址：',
      align: 'left',
      fontSizePt: 10,
      indent: false,
      spaceBeforeMm: 2,
      spaceAfterMm: 1,
    },
  ]
  updateBackCoverBlocks(presetBlocks, { verticalAlign: 'bottom', boxed: true })
}

function addBackCoverBlock(kind: BackCoverBlock['type']): void {
  const current = [...backCoverBlocks.value]
  if (current.length >= BACK_COVER_MAX_BLOCKS) return
  let block: BackCoverBlock
  switch (kind) {
    case 'heading':
      block = { id: nextBlockId(), type: 'heading', text: '版权声明', align: 'center', fontSizePt: 14, bold: true }
      break
    case 'paragraph':
      block = { id: nextBlockId(), type: 'paragraph', text: '', align: 'left', fontSizePt: 10.5, indent: false }
      break
    case 'image':
      block = {
        id: nextBlockId(),
        type: 'image',
        dataUrl: logo.value?.dataUrl ?? WARNING_TRIANGLE_PNG,
        widthMm: logo.value ? Math.min(logo.value.widthMm, 30) : 12,
        heightMm: logo.value ? Math.min(logo.value.heightMm, 20) : 10.5,
        align: 'center',
      }
      break
    case 'divider':
      block = { id: nextBlockId(), type: 'divider', spaceBeforeMm: 2, spaceAfterMm: 2 }
      break
    default:
      return assertNeverBlockType(kind as never)
  }
  current.push(block)
  updateBackCoverBlocks(current)
}

function patchBackCoverBlock(idx: number, patch: Record<string, unknown>): void {
  const current = [...backCoverBlocks.value]
  const target = current[idx]
  if (!target) return
  current[idx] = { ...target, ...patch } as BackCoverBlock
  updateBackCoverBlocks(current)
}

function moveBackCoverBlock(idx: number, delta: -1 | 1): void {
  const targetIdx = idx + delta
  const current = [...backCoverBlocks.value]
  if (idx < 0 || idx >= current.length || targetIdx < 0 || targetIdx >= current.length) return
  const [item] = current.splice(idx, 1)
  if (!item) return
  current.splice(targetIdx, 0, item)
  updateBackCoverBlocks(current)
}

function removeBackCoverBlock(idx: number): void {
  const current = [...backCoverBlocks.value]
  current.splice(idx, 1)
  updateBackCoverBlocks(current)
}

function triggerBackCoverImagePicker(idx: number): void {
  bcImageError.value = ''
  pendingBcImageIdx.value = idx
  bcImageInputRef.value?.click()
}

async function onBackCoverImageSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const idx = pendingBcImageIdx.value
  pendingBcImageIdx.value = null
  if (!file || idx === null) return

  const loaded = await readValidatedImageFile(file, '封底图片')
  if ('error' in loaded) {
    bcImageError.value = loaded.error
    return
  }
  const size = computeLogoSizeMm(loaded.width, loaded.height)
  patchBackCoverBlock(idx, { dataUrl: loaded.dataUrl, widthMm: size.widthMm, heightMm: size.heightMm })
}

function useCoverLogoForBackCoverBlock(idx: number): void {
  if (!logo.value) return
  patchBackCoverBlock(idx, {
    dataUrl: logo.value.dataUrl,
    widthMm: logo.value.widthMm,
    heightMm: logo.value.heightMm,
  })
}

function useWarningIconForBackCoverBlock(idx: number): void {
  patchBackCoverBlock(idx, {
    dataUrl: WARNING_TRIANGLE_PNG,
    widthMm: 9.5,
    heightMm: 8.5,
  })
}

function toggleWatermark(enabled: boolean): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  if (enabled) {
    next.watermark = next.watermark
      ? { ...next.watermark, enabled: true }
      : {
          enabled: true,
          kind: 'text',
          frequency: 'every',
          text: '内部草案',
          fontSizePt: 48,
          color: '#8c8c8c',
          rotationDeg: -45,
          opacity: 0.2,
        }
    openSections.watermark = true
  } else {
    delete next.watermark
  }
  emitNormalized(next)
}

function updateWatermarkKind(kind: WatermarkKind): void {
  const current = props.modelValue?.watermark
  const base: WatermarkConfig = {
    enabled: true,
    kind,
    frequency: current?.frequency ?? 'every',
    opacity: current?.opacity ?? (kind === 'image' ? 0.18 : 0.2),
    ...(kind === 'text'
      ? {
          text: current?.text?.trim() || '内部草案',
          fontSizePt: current?.fontSizePt ?? 48,
          color: current?.color ?? '#8c8c8c',
          rotationDeg: current?.rotationDeg ?? -45,
        }
      : {
          dataUrl: current?.dataUrl || logo.value?.dataUrl || '',
          widthMm: current?.widthMm ?? (logo.value ? Math.min(logo.value.widthMm * 2.5, 100) : 90),
          heightMm: current?.heightMm ?? (logo.value ? Math.min(logo.value.heightMm * 2.5, 100) : 90),
        }),
  }
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.watermark = base
  emitNormalized(next)
}

function updateWatermarkField(patch: Partial<WatermarkConfig>): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  const current = next.watermark ?? {
    enabled: true,
    kind: 'text' as WatermarkKind,
    frequency: 'every' as WatermarkFrequency,
  }
  next.watermark = {
    ...current,
    ...patch,
    enabled: true,
  }
  emitNormalized(next)
}

function commitWatermarkDimension(field: 'widthMm' | 'heightMm', value: number | undefined): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  const current = props.modelValue?.watermark
  const prevW = current?.widthMm ?? 90
  const prevH = current?.heightMm ?? 90
  const patch: Partial<WatermarkConfig> = {}
  if (field === 'widthMm') {
    const newW = clamp(value, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_WIDTH_MM)
    patch.widthMm = newW
    wmWidthDraft.value = newW
    if (lockWatermarkAspectRatio.value && prevW > 0) {
      const scaledH = clamp((newW * prevH) / prevW, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_HEIGHT_MM)
      patch.heightMm = scaledH
      wmHeightDraft.value = scaledH
    }
  } else {
    const newH = clamp(value, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_HEIGHT_MM)
    patch.heightMm = newH
    wmHeightDraft.value = newH
    if (lockWatermarkAspectRatio.value && prevH > 0) {
      const scaledW = clamp((newH * prevW) / prevH, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_WIDTH_MM)
      patch.widthMm = scaledW
      wmWidthDraft.value = scaledW
    }
  }
  updateWatermarkField(patch)
}

function triggerWatermarkImagePicker(): void {
  wmUploadError.value = ''
  wmFileInputRef.value?.click()
}

async function applyWatermarkFile(file: File): Promise<void> {
  const metaError = validateImageFileMeta(file, '水印图片')
  if (metaError) {
    wmUploadError.value = metaError
    return
  }
  const loaded = await readValidatedImageFile(file, '水印图片')
  if ('error' in loaded) {
    wmUploadError.value = loaded.error
    return
  }
  const ratio = loaded.width && loaded.height ? loaded.width / loaded.height : 1
  const widthMm = clamp(80, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_WIDTH_MM)
  const heightMm = clamp(widthMm / ratio, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_HEIGHT_MM)
  wmUploadError.value = ''
  updateWatermarkField({
    kind: 'image',
    dataUrl: loaded.dataUrl,
    widthMm,
    heightMm,
  })
}

async function onWatermarkImageSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await applyWatermarkFile(file)
}

function onWatermarkDragOver(): void {
  if (!props.disabled) wmDragOver.value = true
}

async function onWatermarkDrop(event: DragEvent): Promise<void> {
  wmDragOver.value = false
  if (props.disabled) return
  const file = event.dataTransfer?.files?.[0]
  if (file) await applyWatermarkFile(file)
}

function reuseCoverLogoForWatermark(): void {
  if (!logo.value) return
  wmUploadError.value = ''
  updateWatermarkField({
    kind: 'image',
    dataUrl: logo.value.dataUrl,
    widthMm: clamp(logo.value.widthMm * 2.5, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_WIDTH_MM),
    heightMm: clamp(logo.value.heightMm * 2.5, COVER_LOGO_MIN_MM, WATERMARK_IMAGE_MAX_HEIGHT_MM),
  })
}
</script>

<style scoped>
.cover-layout-editor {
  container-type: inline-size;
  padding-top: 4px;
}

.cover-layout-accordion {
  display: grid;
  gap: 10px;
}

.accordion-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 2px 6px;
}

.toolbar-summary {
  font-size: 11.5px;
  color: var(--ses-ink-3);
}

.toolbar-summary strong {
  color: var(--ses-ink);
  font-weight: 650;
}

.toggle-all-btn {
  border: 1px solid var(--ses-line);
  background: var(--ses-surface);
  color: var(--ses-ink-2);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle-all-btn:hover {
  border-color: var(--ses-accent);
  color: var(--ses-accent);
}

.layout-acc-item {
  border: 1px solid var(--ses-line);
  border-radius: 10px;
  background: color-mix(in oklch, var(--ses-bg) 42%, var(--ses-surface));
  overflow: clip;
}

.acc-summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  cursor: pointer;
  user-select: none;
}

.acc-summary::-webkit-details-marker {
  display: none;
}

.acc-summary:hover {
  background: color-mix(in oklch, var(--ses-surface-2) 65%, transparent);
}

.acc-summary::before {
  content: '';
  inline-size: 14px;
  block-size: 14px;
  flex-shrink: 0;
  background-color: var(--ses-ink-3);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M3.5 6L8 10.5L12.5 6'/%3E%3C/svg%3E") no-repeat center / contain;
  rotate: -90deg;
}

details.layout-acc-item[open] > .acc-summary::before {
  rotate: 0deg;
}

@media (prefers-reduced-motion: no-preference) {
  .acc-summary::before {
    transition: rotate 0.2s ease;
  }

  details.layout-acc-item::details-content {
    transition: block-size, content-visibility, display;
    transition-duration: 0.25s;
    transition-timing-function: ease-in-out;
    transition-behavior: allow-discrete;
  }
}

details.layout-acc-item::details-content {
  interpolate-size: allow-keywords;
  overflow: clip;
  contain: layout;
}

details.layout-acc-item:not([open])::details-content {
  block-size: 0;
}

.acc-summary-text {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.acc-title {
  color: var(--ses-ink);
  font-size: 12.5px;
  font-weight: 650;
  line-height: 1.3;
}

.acc-desc {
  color: var(--ses-ink-4);
  font-size: 10.5px;
  line-height: 1.4;
}

.acc-status {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-3);
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}

.acc-status.is-active {
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
  font-weight: 600;
}

.acc-body {
  padding: 12px 14px 14px;
  border-top: 1px solid var(--ses-line);
  min-width: 0;
  overflow: hidden;
}

.cover-layout-editor :deep(.el-form-item) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  margin-bottom: 10px;
  min-width: 0;
}

.cover-layout-editor :deep(.el-form-item__label) {
  display: block;
  width: auto !important;
  height: auto;
  line-height: 1.4;
  text-align: left;
  justify-content: flex-start;
  padding: 0;
  margin-bottom: 4px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ses-ink-2);
}

.cover-layout-editor :deep(.el-form-item__content) {
  min-width: 0;
  width: 100%;
  margin-left: 0 !important;
  line-height: normal;
}

.cover-layout-editor :deep(.el-input-number) {
  width: 100%;
  min-width: 0;
}

.cover-layout-editor :deep(.el-input-number.is-controls-right .el-input__wrapper) {
  padding-left: 10px;
  padding-right: 36px;
}

.cover-layout-editor :deep(.el-radio-group) {
  display: flex;
  flex-wrap: wrap;
  row-gap: 4px;
  max-width: 100%;
}

.dropzone-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border: 1.5px dashed var(--ses-line-2);
  border-radius: 8px;
  background: var(--ses-surface);
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.dropzone-empty.is-dragover,
.drop-target.is-dragover,
.wm-dropzone.is-dragover {
  border-color: var(--ses-accent);
  background: var(--ses-accent-soft);
}

.dropzone-text {
  display: grid;
  gap: 2px;
}

.dropzone-text strong {
  font-size: 12px;
  font-weight: 600;
  color: var(--ses-ink);
}

.dropzone-text span {
  font-size: 10.5px;
  color: var(--ses-ink-4);
}

.logo-toolbar,
.inline-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.inline-switch-row > span {
  font-size: 11px;
  color: var(--ses-ink-3);
  line-height: 1.45;
}

.block-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.inline-error {
  margin: 8px 0 0;
  color: var(--ses-err);
  font-size: 11px;
}

.logo-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
  margin-top: 12px;
}

.logo-preview-box,
.bc-image-thumb-box {
  width: 84px;
  height: 84px;
  flex: 0 0 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  overflow: hidden;
  border: 1px dashed var(--ses-line-2);
  border-radius: 8px;
  background: var(--ses-surface);
}

.logo-thumb {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.no-img-hint {
  color: var(--ses-ink-4);
  font-size: 10.5px;
  text-align: center;
}

.logo-fields {
  flex: 1 1 auto;
  min-width: 0;
}

.size-grid,
.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px 12px;
  min-width: 0;
}

.three-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(136px, 1fr));
  gap: 8px 10px;
  min-width: 0;
}

.bc-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 6px 14px;
}

.lock-ratio-row {
  margin-top: -2px;
}

.field-hint {
  margin-top: 4px;
  color: var(--ses-ink-4);
  font-size: 10.5px;
}

.field-hint.is-warn {
  color: var(--ses-warn);
}

.sub-fields {
  margin-top: 12px;
}

.bc-block-list {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}

.bc-empty {
  padding: 16px;
  border: 1px dashed var(--ses-line);
  border-radius: 8px;
  text-align: center;
  color: var(--ses-ink-4);
  font-size: 11px;
}

.bc-block-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--ses-line);
  border-radius: 8px;
  background: var(--ses-surface);
}

.bc-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bc-block-tag {
  font-size: 11px;
  font-weight: 600;
  color: var(--ses-ink-2);
}

.bc-block-ops {
  display: flex;
  gap: 4px;
}

.bc-block-props {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.inline-num {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ses-ink-3);
}

.bc-image-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
}

.wm-dropzone {
  padding: 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  min-width: 0;
  overflow: hidden;
}

.bc-image-controls {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 8px;
}

.bc-image-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bc-divider-preview {
  height: 1px;
  background: var(--ses-ink-3);
  margin: 4px 0;
}

.bc-add-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.color-swatch {
  width: 34px;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--ses-line);
  border-radius: 6px;
  background: var(--ses-surface);
  cursor: pointer;
}

@media (min-width: 720px) {
  .logo-config,
  .bc-image-row {
    flex-direction: row;
    align-items: flex-start;
  }
}

@supports (container-type: inline-size) {
  @media (min-width: 720px) {
    .logo-config,
    .bc-image-row {
      flex-direction: column;
      align-items: stretch;
    }
  }

  @container (min-width: 440px) {
    .logo-config,
    .bc-image-row {
      flex-direction: row;
      align-items: flex-start;
    }
  }
}
</style>
