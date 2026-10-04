// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus from 'element-plus'
import { expect, it } from 'vitest'
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
