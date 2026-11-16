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

it('文件设置通过 IntersectionObserver 同步导航高亮且不触发滚动布局查询', async () => {
  const observed: Element[] = []
  let callback: IntersectionObserverCallback | null = null
  const disconnect = vi.fn()
  class MockIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) { callback = cb }
    observe(target: Element) { observed.push(target) }
    disconnect() { disconnect() }
    unobserve() {}
    takeRecords() { return [] }
  }
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

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
    expect(observed.map((el) => el.id)).toEqual([
      'settings-basic',
      'settings-classification',
      'settings-publication',
      'settings-organizations',
    ])

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    root.querySelector('.settings-scroll')?.dispatchEvent(new Event('scroll'))
    expect(rectSpy).not.toHaveBeenCalled()

    const publication = root.querySelector('#settings-publication')!
    callback!([{ target: publication, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await nextTick()
    const links = [...root.querySelectorAll<HTMLElement>('.section-link')]
    expect(links[2]?.classList.contains('is-active')).toBe(true)

    app.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  } finally {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    root.remove()
  }
})
