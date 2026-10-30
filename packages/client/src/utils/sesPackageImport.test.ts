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
    createsSnapshot: true,
    versionNoCollisions: [],
    ...overrides,
  }
}

describe('sesImportPromptOf', () => {
  it('正文不同且会建快照时提示自动快照', () => {
    expect(sesImportPromptOf(preview({})).details).toContain('正文不同：包正文成为当前正文，本地正文会先自动保存为版本快照。')
  })

  it('正文不同但本地正文已在版本历史中时提示不另建快照', () => {
    const { details } = sesImportPromptOf(preview({ createsSnapshot: false }))
    expect(details).toContain('正文不同：包正文成为当前正文；本地正文已保存在版本历史中，不另建快照。')
    expect(details.join('')).not.toContain('自动保存为版本快照')
  })

  it('正文相同时不提示快照', () => {
    expect(sesImportPromptOf(preview({ contentDiffers: false, createsSnapshot: false })).details)
      .toContain('正文相同，不会创建本地正文自动快照。')
  })
})
