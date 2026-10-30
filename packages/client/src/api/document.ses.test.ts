import { beforeEach, describe, expect, it, vi } from 'vitest'
import { documentApi } from './document'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: () => mocks,
  },
}))

const MIME = 'application/vnd.ses-package+json'

beforeEach(() => vi.resetAllMocks())

describe('documentApi SES 文档包', () => {
  it('导出 Blob 和完整告警头，保留总数与截断状态', async () => {
    const blob = new Blob(['{}'], { type: MIME })
    mocks.get.mockResolvedValue({
      data: blob,
      headers: {
        'x-ses-export-warning-count': '3',
        'x-ses-export-warnings': encodeURIComponent(JSON.stringify([
          { code: 'image-resource-failed', nodeId: 'img-1', message: '外部图片未打包' },
        ])),
        'x-ses-export-warnings-truncated': 'true',
      },
    })

    await expect(documentApi.exportSesPackage(42)).resolves.toEqual({
      blob,
      warningCount: 3,
      warnings: [{ code: 'image-resource-failed', nodeId: 'img-1', message: '外部图片未打包' }],
      warningsTruncated: true,
    })
    expect(mocks.get).toHaveBeenCalledWith('/documents/42/export/ses', { responseType: 'blob' })
  })

  it('以原始文件和 SES MIME 预览导入', async () => {
    const file = new File(['{}'], 'backup.ses', { type: MIME })
    const preview = {
      match: null,
      inTrash: false,
      newVersions: 2,
      localOnlyVersions: 0,
      contentDiffers: false,
     
      versionNoCollisions: [],
    }
    mocks.post.mockResolvedValue({ data: preview })

    await expect(documentApi.previewSesImport(file)).resolves.toEqual(preview)
    expect(mocks.post).toHaveBeenCalledWith('/documents/import/ses?mode=preview', file, {
      headers: { 'Content-Type': MIME },
    })
  })

  it('按模式构造新建和快照修订号更新请求', async () => {
    const file = new File(['{}'], 'backup.ses', { type: MIME })
    const imported = { id: 9, title: '导入文档', meta: {}, stage: 'working_draft', content: {}, revision: 1 }
    mocks.post.mockResolvedValue({ data: imported })

    await expect(documentApi.importSesPackage(file, 'new')).resolves.toEqual(imported)
    expect(mocks.post).toHaveBeenNthCalledWith(1, '/documents/import/ses?mode=new', file, {
      headers: { 'Content-Type': MIME },
    })
    await expect(documentApi.importSesPackage(file, 'update', { targetId: 9, baseRevision: 7 })).resolves.toEqual(imported)
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/documents/import/ses?mode=update&targetId=9&baseRevision=7', file, {
      headers: { 'Content-Type': MIME },
    })
  })

  it('导出接口以 Blob 返回 JSON 错误时显示服务端消息', async () => {
    mocks.get.mockRejectedValue(Object.assign(new Error('Request failed with status code 422'), {
      response: { data: new Blob([JSON.stringify({ message: 'SES 文档包 schema 错误' })], { type: 'application/json' }) },
    }))

    await expect(documentApi.exportSesPackage(42)).rejects.toThrow('SES 文档包 schema 错误')
  })
})
