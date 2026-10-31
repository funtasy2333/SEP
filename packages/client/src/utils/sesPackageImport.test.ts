import { describe, expect, it } from 'vitest'
import type { SesImportPreview } from '@/api/document'
import { sesImportPromptOf } from './sesPackageImport'

function preview(overrides: Partial<SesImportPreview>): SesImportPreview {
  return {
    match: { id: 1, title: '本地标准', revision: 3 },
    inTrash: false,
    newVersions: 1,
    localOnlyVersions: 0,
    contentDiffers: true,
    versionNoCollisions: [],
    ...overrides,
  }
}

describe('sesImportPromptOf', () => {
  it('正文不同时说明版本历史会记录本次导入', () => {
    expect(sesImportPromptOf(preview({})).details)
      .toContain('正文不同：包正文成为当前正文。版本历史会记录本次导入，可查看本次修改或回滚到导入前。')
  })

  it('正文相同时说明只追加版本', () => {
    expect(sesImportPromptOf(preview({ contentDiffers: false })).details)
      .toContain('正文相同，导入只追加版本，不改动当前正文。')
  })

  it('版本号冲突时列出冲突的版本号', () => {
    expect(sesImportPromptOf(preview({ versionNoCollisions: ['1.0', '1.1'] })).details.join(''))
      .toContain('版本号冲突：1.0、1.1')
  })
})
