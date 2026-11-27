import { describe, expect, it } from 'vitest'
import type { SesImportPreview } from '@/api/document'
import { sesImportPromptOf } from './sesPackageImport'

function preview(overrides: Partial<SesImportPreview>): SesImportPreview {
  return {
    match: { id: 1, title: '本地标准', revision: 3 },
    inTrash: false,
    versionScope: 'all',
    newVersions: 1,
    localOnlyVersions: 0,
    contentDiffers: true,
    coverLayoutDiffers: false,
    versionNoCollisions: [],
    ...overrides,
  }
}

describe('sesImportPromptOf', () => {
  it('正文不同时说明版本历史会记录本次导入', () => {
    expect(sesImportPromptOf(preview({})).details)
      .toContain('正文不同：包正文成为当前正文。版本历史会记录本次导入，可查看本次修改或回滚正文到导入前。')
  })

  it('正文相同时说明保留当前正文', () => {
    expect(sesImportPromptOf(preview({ contentDiffers: false })).details)
      .toContain('正文相同，导入时保留当前正文。')
  })

  it('封面版式单独变化时说明覆盖且正文历史不能恢复封面', () => {
    const details = sesImportPromptOf(preview({ contentDiffers: false, coverLayoutDiffers: true })).details.join('')
    expect(details).toContain('封面版式不同')
    expect(details).toContain('正文版本历史无法恢复')
    expect(details).not.toContain('版本历史会记录本次导入')
    expect(details).not.toContain('导入只追加版本')
  })

  it('正文和封面均变化时只承诺回滚正文并警告封面覆盖', () => {
    const details = sesImportPromptOf(preview({ contentDiffers: true, coverLayoutDiffers: true })).details.join('')
    expect(details).toContain('回滚正文到导入前')
    expect(details).toContain('封面版式不同')
    expect(details).toContain('正文版本历史无法恢复')
  })

  it('旧服务端未区分正文和封面时不保证一定创建版本', () => {
    const details = sesImportPromptOf(preview({ coverLayoutDiffers: undefined })).details.join('')
    expect(details).toContain('正文或封面版式可能不同')
    expect(details).toContain('正文变化时会记录导入版本')
    expect(details).toContain('正文版本历史无法恢复封面版式')
  })

  it('最新稿包提示不含版本历史、本地版本全部保留，且不把本地独有版本说成对方删除', () => {
    const details = sesImportPromptOf(preview({ versionScope: 'latest', newVersions: 0, localOnlyVersions: 5 })).details
    expect(details).toContain('此文档包只含最新稿，不含版本历史；本地已有版本全部保留。')
    expect(details.join('')).not.toContain('本地独有')
    expect(details.join('')).not.toContain('包中新增')
    expect(details).toContain('正文不同：包正文成为当前正文。版本历史会记录本次导入，可查看本次修改或回滚正文到导入前。')
  })

  it('最新稿包正文相同时不再说追加版本', () => {
    const details = sesImportPromptOf(preview({ versionScope: 'latest', newVersions: 0, contentDiffers: false })).details
    expect(details).toContain('正文相同，导入不会追加版本，不改动当前正文。')
    expect(details.join('')).not.toContain('只追加版本')
  })

  it('全部历史快照和未标记的包不出现最新稿提示', () => {
    for (const versionScope of ['all', null] as const) {
      const details = sesImportPromptOf(preview({ versionScope })).details.join('')
      expect(details).not.toContain('只含最新稿')
      expect(details).toContain('本地独有 0 个版本')
    }
  })

  it('版本号冲突时列出冲突的版本号', () => {
    expect(sesImportPromptOf(preview({ versionNoCollisions: ['1.0', '1.1'] })).details.join(''))
      .toContain('版本号冲突：1.0、1.1')
  })
})
