// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus from 'element-plus'
import { describe, expect, it } from 'vitest'
import type { CoverLayoutConfig } from '@ses/shared'
import CoverLayoutEditor from './CoverLayoutEditor.vue'

function mountCoverLayoutEditor(initialType: string, initialValue?: CoverLayoutConfig) {
  const root = document.createElement('div')
  document.body.append(root)
  const model = ref<CoverLayoutConfig | undefined>(initialValue)
  const stdType = ref(initialType)
  const app = createApp({
    setup: () => () => h(CoverLayoutEditor, {
      modelValue: model.value,
      standardType: stdType.value,
      'onUpdate:modelValue': (val: CoverLayoutConfig | undefined) => { model.value = val },
    }),
  })
  app.use(ElementPlus).mount(root)
  return {
    root,
    model,
    stdType,
    unmount: () => {
      app.unmount()
      root.remove()
    },
  }
}

const SAMPLE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('CoverLayoutEditor', () => {
  it('国家标准禁止选择 replace_mark 与修改右上角标志，团体标准允许选择', async () => {
    const mounted = mountCoverLayoutEditor('national', {
      logo: { dataUrl: SAMPLE_PNG, position: 'top_left', widthMm: 20, heightMm: 10 },
    })
    try {
      await nextTick()
      expect(mounted.root.querySelector('[data-testid="replace-mark-hint"]')?.textContent).toContain('禁止替换右上角 GB 标志')
      const replaceRadio = mounted.root.querySelector<HTMLInputElement>('input[value="replace_mark"]')!
      expect(replaceRadio.disabled).toBe(true)
      const hiddenMarkRadio = mounted.root.querySelector<HTMLInputElement>('[data-testid="top-right-mark-mode"] input[value="hidden"]')!
      expect(hiddenMarkRadio.disabled).toBe(true)
      expect(mounted.root.textContent).not.toContain('替代文本')

      mounted.stdType.value = 'group'
      await nextTick()
      expect(mounted.root.querySelector('[data-testid="replace-mark-hint"]')).toBeNull()
      expect(mounted.root.querySelector<HTMLInputElement>('input[value="replace_mark"]')!.disabled).toBe(false)
      expect(mounted.root.querySelector<HTMLInputElement>('[data-testid="top-right-mark-mode"] input[value="hidden"]')!.disabled).toBe(false)
    } finally {
      mounted.unmount()
    }
  })

  it('上传非 PNG/JPEG 或超限文件时显示错误提示，拒绝写入', async () => {
    const mounted = mountCoverLayoutEditor('group')
    try {
      await nextTick()
      const fileInput = mounted.root.querySelector<HTMLInputElement>('[data-testid="cover-logo-file-input"]')!
      const badFile = new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' })
      Object.defineProperty(fileInput, 'files', { value: [badFile], configurable: true })
      fileInput.dispatchEvent(new Event('change'))
      await nextTick()

      expect(mounted.root.querySelector('[data-testid="cover-logo-error"]')?.textContent).toContain('仅支持 PNG 或 JPEG')
      expect(mounted.model.value).toBeUndefined()
    } finally {
      mounted.unmount()
    }
  })

  it('支持独立调整徽标宽高与环绕、右上角文字标志、自由封底预设及正文水印', async () => {
    const mounted = mountCoverLayoutEditor('group', {
      logo: { dataUrl: SAMPLE_PNG, position: 'top_left', widthMm: 28, heightMm: 14 },
    })
    try {
      await nextTick()

      // 默认衬于文字下方，可切换为嵌入型
      const behindRadio = mounted.root.querySelector<HTMLInputElement>('[data-testid="cover-logo-wrap"] input[value="behind_text"]')!
      expect(behindRadio.checked).toBe(true)
      const inlineRadio = mounted.root.querySelector<HTMLInputElement>('[data-testid="cover-logo-wrap"] input[value="inline"]')!
      inlineRadio.click()
      await nextTick()
      expect(mounted.model.value?.logo?.wrap).toBe('inline')

      // 宽高独立修改
      const wInput = mounted.root.querySelector<HTMLInputElement>('[data-testid="cover-logo-width"] input')!
      wInput.value = '42'
      wInput.dispatchEvent(new Event('input', { bubbles: true }))
      wInput.dispatchEvent(new Event('change', { bubbles: true }))
      await nextTick()
      expect(mounted.model.value?.logo?.widthMm).toBe(42)
      expect(mounted.model.value?.logo?.heightMm).toBe(14)

      // 独立修改右上角文字标志
      const textMarkRadio = mounted.root.querySelector<HTMLInputElement>('[data-testid="top-right-mark-mode"] input[value="text"]')!
      textMarkRadio.click()
      await nextTick()
      const markInput = mounted.root.querySelector<HTMLInputElement>('input[data-testid="top-right-mark-text"]')!
      markInput.value = 'T/ZSM'
      markInput.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      expect(mounted.model.value?.topRightMark).toMatchObject({ mode: 'text', text: 'T/ZSM' })

      // 开启独立封底并载入版权保护文件预设
      const bcSwitch = mounted.root.querySelector<HTMLElement>('[data-testid="back-cover-switch"]')!
      bcSwitch.click()
      await nextTick()
      const presetBtn = mounted.root.querySelector<HTMLButtonElement>('[data-testid="back-cover-preset-btn"]')!
      presetBtn.click()
      await nextTick()
      expect(mounted.model.value?.backCover?.boxed).toBe(true)
      expect(mounted.model.value?.backCover?.verticalAlign).toBe('bottom')
      expect(mounted.model.value?.backCover?.blocks).toHaveLength(4)
      expect(mounted.model.value?.backCover?.blocks?.[1]).toMatchObject({ type: 'heading', text: '版权保护文件' })

      // 开启正文水印，切换隔一页并复用封面徽标
      const wmSwitch = mounted.root.querySelector<HTMLElement>('[data-testid="watermark-switch"]')!
      wmSwitch.click()
      await nextTick()
      const altFreqRadio = mounted.root.querySelector<HTMLInputElement>('[data-testid="watermark-frequency"] input[value="alternate"]')!
      altFreqRadio.click()
      await nextTick()
      const imgKindRadio = mounted.root.querySelector<HTMLInputElement>('[data-testid="watermark-kind"] input[value="image"]')!
      imgKindRadio.click()
      await nextTick()
      const reuseBtn = mounted.root.querySelector<HTMLButtonElement>('[data-testid="watermark-reuse-logo-btn"]')!
      reuseBtn.click()
      await nextTick()
      expect(mounted.model.value?.watermark).toMatchObject({
        enabled: true,
        kind: 'image',
        frequency: 'alternate',
        dataUrl: SAMPLE_PNG,
      })

      // 水印图片默认锁定宽高比（复用时为 105 x 35）：宽度改为 140 时高度等比变为 46.7；取消锁定后独立修改
      const wmWInput = mounted.root.querySelector<HTMLInputElement>('[data-testid="watermark-width"] input')!
      wmWInput.value = '140'
      wmWInput.dispatchEvent(new Event('input', { bubbles: true }))
      wmWInput.dispatchEvent(new Event('change', { bubbles: true }))
      await nextTick()
      expect(mounted.model.value?.watermark?.widthMm).toBe(140)
      expect(mounted.model.value?.watermark?.heightMm).toBe(46.7)

      const wmLockCheckbox = mounted.root.querySelector<HTMLInputElement>('[data-testid="watermark-lock-ratio"] input')!
      wmLockCheckbox.click()
      await nextTick()
      wmWInput.value = '100'
      wmWInput.dispatchEvent(new Event('input', { bubbles: true }))
      wmWInput.dispatchEvent(new Event('change', { bubbles: true }))
      await nextTick()
      expect(mounted.model.value?.watermark?.widthMm).toBe(100)
      expect(mounted.model.value?.watermark?.heightMm).toBe(46.7)

      // 透明度扩展范围 [0.01, 1.0]
      const wmOpacityInput = mounted.root.querySelector<HTMLInputElement>('[data-testid="watermark-opacity"] input')!
      wmOpacityInput.value = '0.85'
      wmOpacityInput.dispatchEvent(new Event('input', { bubbles: true }))
      wmOpacityInput.dispatchEvent(new Event('change', { bubbles: true }))
      await nextTick()
      expect(mounted.model.value?.watermark?.opacity).toBe(0.85)

      wmOpacityInput.value = '0.02'
      wmOpacityInput.dispatchEvent(new Event('input', { bubbles: true }))
      wmOpacityInput.dispatchEvent(new Event('change', { bubbles: true }))
      await nextTick()
      expect(mounted.model.value?.watermark?.opacity).toBe(0.02)

      // 逐一清除/关闭后可安全清空
      wmSwitch.click()
      await nextTick()
      bcSwitch.click()
      await nextTick()
      const defaultMarkRadio = mounted.root.querySelector<HTMLInputElement>('[data-testid="top-right-mark-mode"] input[value="default"]')!
      defaultMarkRadio.click()
      await nextTick()
      mounted.root.querySelector<HTMLButtonElement>('[data-testid="cover-logo-clear-btn"]')!.click()
      await nextTick()
      expect(mounted.model.value).toBeUndefined()
    } finally {
      mounted.unmount()
    }
  })

  it('使用原生非互斥 details 手风琴分组：summary 不含标题标签，且全部展开/收起按钮与展开状态严格同步', async () => {
    const mounted = mountCoverLayoutEditor('group')
    try {
      await nextTick()
      const detailsList = [...mounted.root.querySelectorAll<HTMLDetailsElement>('details.layout-acc-item')]
      expect(detailsList).toHaveLength(5)
      for (const detailsEl of detailsList) {
        expect(detailsEl.hasAttribute('name')).toBe(false)
        const summary = detailsEl.querySelector(':scope > summary')!
        expect(summary.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull()
      }

      const toggleBtn = mounted.root.querySelector<HTMLButtonElement>('[data-testid="layout-toggle-all-btn"]')!
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false')

      // 混合状态下点击应全部展开，随后变为全部收起
      toggleBtn.click()
      await nextTick()
      expect(detailsList.every((d) => d.open)).toBe(true)
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true')

      toggleBtn.click()
      await nextTick()
      expect(detailsList.every((d) => !d.open)).toBe(true)
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false')
    } finally {
      mounted.unmount()
    }
  })
})
