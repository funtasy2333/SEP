// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus from 'element-plus'
import { expect, it, vi } from 'vitest'
import DocumentSettingsPanel from './DocumentSettingsPanel.vue'
import type { DocumentSettingsDraft } from '@/utils/documentSettings'

it('文件设置通过真实类别选项切换并保留各类型名称，指导性文件仍显示固定称谓', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const draft = ref<DocumentSettingsDraft>({
    standardType: 'group',
    stage: 'working_draft',
    titleCn: '称谓缓存回归',
    titleEn: '',
    standardNo: '',
    icsCode: '',
    ccsCode: '',
    issuer: '',
    applicant: '',
    proposer: '',
    technicalCommittee: '',
    replaces: '',
    consistency: '',
    publishDate: '',
    implementDate: '',
    filingNo: '',
    industryName: '',
    regionName: '',
    coverDesignation: '初始协会团体标准',
  })
  const app = createApp({
    setup: () => () => h(DocumentSettingsPanel, {
      draft: draft.value,
      dirty: true,
      saving: false,
      saveError: false,
    }),
  })
  app.use(ElementPlus).mount(root)
  const settle = async () => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 25))
    await nextTick()
  }
  const selectType = async (name: string) => {
    const selector = root.querySelector<HTMLElement>('#settings-basic .el-select__wrapper')!
    expect(selector).not.toBeNull()
    selector.click()
    await settle()
    const option = [...document.querySelectorAll<HTMLElement>('.el-select-dropdown__item')]
      .find((item) => item.textContent?.includes(name))!
    expect(option).not.toBeNull()
    option.click()
    await settle()
  }
  const setDesignation = async (value: string) => {
    const input = root.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!
    expect(input).not.toBeNull()
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  }

  try {
    expect(root.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('初始协会')

    await selectType('企业标准')
    expect(draft.value.standardType).toBe('enterprise')
    expect(root.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
    await setDesignation('企业名称')

    await selectType('团体标准')
    expect(draft.value.standardType).toBe('group')
    expect(root.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('初始协会')
    await setDesignation('修订协会')

    await selectType('企业标准')
    expect(root.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('企业名称')
    await setDesignation('修订企业')

    await selectType('指导性技术文件')
    expect(draft.value.standardType).toBe('guidance')
    expect(root.querySelector('input[aria-label="标准类型名称"]')).toBeNull()
    expect(root.querySelector('.preview-designation')?.textContent).toContain('中华人民共和国国家标准化指导性技术文件')

    await selectType('团体标准')
    expect(root.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('修订协会')
    await setDesignation('')
    await selectType('企业标准')
    expect(root.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('修订企业')
    await selectType('团体标准')
    expect(root.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
  } finally {
    app.unmount()
    root.remove()
  }
})

it('文件设置在横屏容器（1200x600）下按容器高度计算像素 rootMargin，随尺寸变化更新并同步高亮', async () => {
  // 按 W3C IntersectionObserver 规范：百分比 margin 依据 root 宽度计算，px margin 直接按像素生效
  function resolveMargin(token: string, rootWidth: number): number {
    if (token.endsWith('%')) return (parseFloat(token) / 100) * rootWidth
    return parseFloat(token)
  }

  let rootWidth = 1200
  let rootHeight = 600
  let sectionTops: Record<string, number> = {
    'settings-basic': 100,
    'settings-classification': 520,
    'settings-publication': 940,
    'settings-organizations': 1360,
  }

  const observers: Array<{
    options: IntersectionObserverInit
    targets: Element[]
    disconnected: boolean
    evaluate: () => void
  }> = []
  const resizeObservers: Array<{
    callback: ResizeObserverCallback
    targets: Element[]
    disconnected: boolean
  }> = []

  class SpecIntersectionObserver {
    #cb: IntersectionObserverCallback
    #record: (typeof observers)[number]
    constructor(cb: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      this.#cb = cb
      this.#record = {
        options,
        targets: [],
        disconnected: false,
        evaluate: () => {
          if (this.#record.disconnected) return
          const parts = (options.rootMargin ?? '0px').trim().split(/\s+/)
          const [topStr, , bottomStr = topStr] = [
            parts[0] ?? '0px',
            parts[1] ?? parts[0] ?? '0px',
            parts[2] ?? parts[0] ?? '0px',
          ]
          const bandTop = -resolveMargin(topStr, rootWidth)
          const bandBottom = rootHeight + resolveMargin(bottomStr, rootWidth)
          const entries = this.#record.targets.map((target) => {
            const top = sectionTops[target.id] ?? 9999
            const bottom = top + 360
            const isIntersecting = bandBottom > bandTop && bottom >= bandTop && top <= bandBottom
            return { target, isIntersecting } as IntersectionObserverEntry
          })
          if (entries.length) this.#cb(entries, this as unknown as IntersectionObserver)
        },
      }
      observers.push(this.#record)
    }
    observe(target: Element) { this.#record.targets.push(target) }
    disconnect() { this.#record.disconnected = true }
    unobserve() {}
    takeRecords() { return [] }
  }

  class MockResizeObserver {
    #record: (typeof resizeObservers)[number]
    constructor(cb: ResizeObserverCallback) {
      this.#record = { callback: cb, targets: [], disconnected: false }
      resizeObservers.push(this.#record)
    }
    observe(target: Element) { this.#record.targets.push(target) }
    disconnect() { this.#record.disconnected = true }
    unobserve() {}
  }

  vi.stubGlobal('IntersectionObserver', SpecIntersectionObserver)
  vi.stubGlobal('ResizeObserver', MockResizeObserver)

  const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('settings-scroll') ? rootHeight : 0
  })

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () => h(DocumentSettingsPanel, {
      draft: {
        standardType: 'national',
        stage: 'working_draft',
        titleCn: '测试标准',
        titleEn: '',
        standardNo: '',
        icsCode: '',
        ccsCode: '',
        issuer: '',
        applicant: '',
        proposer: '',
        technicalCommittee: '',
        replaces: '',
        consistency: '',
        publishDate: '',
        implementDate: '',
        filingNo: '',
        industryName: '',
        regionName: '',
        coverDesignation: '',
      },
      dirty: false,
      saving: false,
      saveError: false,
    }),
  })
  try {
    app.use(ElementPlus).mount(root)
    await nextTick()

    expect(observers).toHaveLength(1)
    expect(observers[0]!.options.rootMargin).toBe('0px 0px -450px 0px')
    expect(observers[0]!.targets.map((el) => el.id)).toEqual([
      'settings-basic',
      'settings-classification',
      'settings-publication',
      'settings-organizations',
    ])

    const scrollEl = root.querySelector('.settings-scroll')!
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    scrollEl.dispatchEvent(new Event('scroll'))
    expect(rectSpy).not.toHaveBeenCalled()

    // 在 1200x600 横屏容器中向下滚动，第 3 节进入顶部 150px 观察带
    sectionTops = {
      'settings-basic': -780,
      'settings-classification': -360,
      'settings-publication': 40,
      'settings-organizations': 460,
    }
    observers[0]!.evaluate()
    await nextTick()
    const links = [...root.querySelectorAll<HTMLElement>('.section-link')]
    expect(links[2]?.classList.contains('is-active')).toBe(true)

    // 容器高度调整到 800px 后，重建观察器并把底部像素边距更新为 -600px
    const settingsResize = resizeObservers.find((item) => item.targets.includes(scrollEl))
    expect(settingsResize).toBeDefined()
    rootHeight = 800
    settingsResize!.callback([{ target: scrollEl, contentRect: { height: 800 } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
    expect(observers[0]!.disconnected).toBe(true)
    expect(observers).toHaveLength(2)
    expect(observers[1]!.options.rootMargin).toBe('0px 0px -600px 0px')

    sectionTops = {
      'settings-basic': -1200,
      'settings-classification': -780,
      'settings-publication': -380,
      'settings-organizations': 120,
    }
    observers[1]!.evaluate()
    await nextTick()
    expect(links[3]?.classList.contains('is-active')).toBe(true)

    app.unmount()
    expect(observers[1]!.disconnected).toBe(true)
    expect(settingsResize!.disconnected).toBe(true)
  } finally {
    clientHeightSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    root.remove()
  }
})
