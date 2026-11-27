// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { describe, expect, it } from 'vitest'
import type { TemplateImportPreview } from '@/api/template'
import TemplateImportDialog from './TemplateImportDialog.vue'

describe('TemplateImportDialog', () => {
  it('UID 冲突时展示章节差异统计、差异行及 coverLayout 差异，并触发选择事件', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const choices: Array<'update' | 'new' | null> = []

    const preview: TemplateImportPreview = {
      status: 'match',
      existing: {
        id: 1,
        uid: 'tpl-conflict-1',
        name: '本地团体模板',
        description: '',
        baseType: 'group',
        defaultStage: 'working_draft',
        defaultMeta: {},
        content: {
          type: 'doc',
          content: [
            { type: 'coverPage', attrs: { standardType: 'group', titleCn: '{{titleCn}}' }, content: [{ type: 'paragraph' }] },
            {
              type: 'chapter',
              attrs: { nodeId: 'c1' },
              content: [
                { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
                { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: '旧章节段落' }] },
              ],
            },
          ],
        },
        source: 'human',
        readonly: false,
        revision: 3,
      },
      incoming: {
        uid: 'tpl-conflict-1',
        name: '导入团体模板',
        description: '',
        baseType: 'group',
        defaultStage: 'review_draft',
        defaultMeta: {},
        coverLayout: {
          backCover: { enabled: true, copyrightNotice: '© 2026' },
        },
        content: {
          type: 'doc',
          content: [
            { type: 'coverPage', attrs: { standardType: 'group', titleCn: '{{titleCn}}' }, content: [{ type: 'paragraph' }] },
            {
              type: 'chapter',
              attrs: { nodeId: 'c1' },
              content: [
                { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
                { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: '新导入章节段落' }] },
              ],
            },
          ],
        },
      },
    }

    const app = createApp({
      setup: () => () => h(TemplateImportDialog, {
        modelValue: true,
        preview,
        onChoose: (mode: 'update' | 'new' | null) => { choices.push(mode) },
      }),
    })

    try {
      app.use(ElementPlus).mount(root)
      await nextTick()

      const diffPanel = document.querySelector('[data-testid="template-import-diff"]')!
      expect(diffPanel.textContent).toContain('tpl-conflict-1')
      expect(diffPanel.textContent).toContain('独立封底')
      expect(document.querySelector('[data-testid="template-import-diff-stats"]')?.textContent).toContain('+1')
      expect(document.querySelector('[data-testid="template-import-diff-stats"]')?.textContent).toContain('-1')

      document.querySelector<HTMLButtonElement>('[data-testid="template-import-update-btn"]')!.click()
      document.querySelector<HTMLButtonElement>('[data-testid="template-import-new-btn"]')!.click()
      await nextTick()
      expect(choices).toEqual(['update', 'new'])
    } finally {
      app.unmount()
      root.remove()
    }
  })
})
