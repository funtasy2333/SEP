// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus from 'element-plus'
import { expect, it } from 'vitest'
import NewDocDialog from './NewDocDialog.vue'
import { createNewDocument, type NewDocForm } from '../../utils/newDocument'

it('实际表单提交新增两字段和单位，重新打开不沿用上一份的填写值', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const visible = ref(false)
  const submitted: NewDocForm[] = []
  const app = createApp({ setup: () => () => h(NewDocDialog, {
    modelValue: visible.value,
    initialType: 'group',
    'onUpdate:modelValue': (value: boolean) => { visible.value = value },
    onCreate: (form: NewDocForm) => { submitted.push({ ...form }) },
  }) })
  app.use(ElementPlus).mount(root)
  const settle = async () => { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 25)); await nextTick() }
  const input = async (placeholder: string, value: string) => {
    const el = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
    expect(el).not.toBeNull()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  const selectType = async (name: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.type-radio')]
      .find((item) => item.querySelector('.info-title')?.textContent?.trim() === name)!
    expect(button).not.toBeNull()
    button.click()
    await settle()
  }
  const setDesignation = async (value: string) => {
    const el = document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!
    expect(el).not.toBeNull()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  }
  try {
    visible.value = true
    await settle()
    expect(document.querySelector('.stdno')!.textContent).toContain('T/XXX XXXXX—XXXX')
    const designation = document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!
    expect(designation).not.toBeNull()
    designation.value = '电子信息协会'
    designation.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(document.querySelector('.designation-cn')!.textContent).toContain('电子信息协会团体标准')
    await selectType('企业标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
    await setDesignation('企业研究所')
    await selectType('行业标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
    await setDesignation('装备制造')
    await selectType('地方标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
    await setDesignation('杭州市')
    await selectType('企业标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('企业研究所')
    await setDesignation('企业研究所修订')
    await selectType('团体标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('电子信息协会')
    await setDesignation('电子信息协会修订')
    await selectType('行业标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('装备制造')
    await selectType('地方标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('杭州市')
    await selectType('团体标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('电子信息协会修订')
    await input('例：信息技术 标准化文件编辑系统 通用要求', '表单提交验收')
    await input('如 GB/T 12345—2020', 'T/ABC 123—2020')
    await input('如 （ISO 1234:2020，MOD）', '（ISO 1234:2020，MOD）')
    await input('如 工业和信息化部', '测试提出单位')
    await input('如 全国信息技术标准化技术委员会（SAC/TC 28）', '测试归口单位')
    await input('如 中国电子技术标准化研究院', '测试起草单位')
    const create = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('创建草案'))!
    create.click()
    await settle()
    expect(submitted).toHaveLength(1)
    const saved = createNewDocument(submitted[0]!)
    expect(saved.meta).toMatchObject({ standardType: 'group', standardNo: 'T/XXX XXXXX—XXXX',
      replaces: 'T/ABC 123—2020', consistency: '（ISO 1234:2020，MOD）', proposer: '测试提出单位',
      technicalCommittee: '测试归口单位', applicant: '测试起草单位',
      coverDesignation: '电子信息协会修订团体标准' })
    const foreword = saved.content.content!.find((node) => node.type === 'foreword')!
    expect(JSON.stringify(foreword)).toContain('本文件起草单位：测试起草单位。')
    visible.value = false
    await settle()
    visible.value = true
    await settle()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
    expect(document.querySelector<HTMLInputElement>('input[placeholder="如 GB/T 12345—2020"]')!.value).toBe('')
    expect(document.querySelector<HTMLInputElement>('input[placeholder="如 （ISO 1234:2020，MOD）"]')!.value).toBe('')
    await setDesignation('重置后团体')
    await selectType('企业标准')
    await setDesignation('临时企业名称')
    await selectType('团体标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('重置后团体')
    await setDesignation('')
    await selectType('企业标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('临时企业名称')
    await selectType('团体标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
    visible.value = false
    await settle()
    visible.value = true
    await settle()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
    await selectType('企业标准')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="标准类型名称"]')!.value).toBe('')
  } finally {
    app.unmount()
    root.remove()
  }
})
