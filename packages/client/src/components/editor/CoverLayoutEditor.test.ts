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
  it('国家标准禁止选择 replace_mark，团体标准允许选择', async () => {
    const mounted = mountCoverLayoutEditor('national', {
      logo: { dataUrl: SAMPLE_PNG, position: 'top_left', widthMm: 20, heightMm: 10 },
    })
    try {
      await nextTick()
      expect(mounted.root.querySelector('[data-testid="replace-mark-hint"]')?.textContent).toContain('禁止替换右上角 GB 标志')
      const replaceRadio = mounted.root.querySelector<HTMLInputElement>('input[value="replace_mark"]')!
      expect(replaceRadio.disabled).toBe(true)

      mounted.stdType.value = 'group'
      await nextTick()
      expect(mounted.root.querySelector('[data-testid="replace-mark-hint"]')).toBeNull()
      expect(mounted.root.querySelector<HTMLInputElement>('input[value="replace_mark"]')!.disabled).toBe(false)
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

  it('开启独立封底并填写声明后归一化输出；清空后回到 undefined', async () => {
    const mounted = mountCoverLayoutEditor('group')
    try {
      await nextTick()
      const noticeTextarea = mounted.root.querySelector<HTMLTextAreaElement>('textarea[data-testid="cover-notice-text"]')!
      noticeTextarea.value = '仅供征求意见'
      noticeTextarea.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      expect(mounted.model.value?.notice?.text).toBe('仅供征求意见')

      const switchEl = mounted.root.querySelector<HTMLElement>('[data-testid="back-cover-switch"]')!
      switchEl.click()
      await nextTick()
      expect(mounted.model.value?.backCover?.enabled).toBe(true)

      const bcTitle = mounted.root.querySelector<HTMLInputElement>('input[data-testid="back-cover-title"]')!
      bcTitle.value = '版权信息页'
      bcTitle.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      expect(mounted.model.value?.backCover?.title).toBe('版权信息页')

      noticeTextarea.value = ''
      noticeTextarea.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      switchEl.click()
      await nextTick()
      expect(mounted.model.value).toBeUndefined()
    } finally {
      mounted.unmount()
    }
  })
})
