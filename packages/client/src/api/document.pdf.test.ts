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

beforeEach(() => vi.resetAllMocks())

describe('documentApi.exportPdf（服务端按文档 id 导出）', () => {
  it('请求 /documents/:id/export/pdf，以 Blob 取回并解析告警响应头', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
    mocks.get.mockResolvedValue({
      data: blob,
      headers: {
        'x-ses-export-warning-count': '2',
        'x-ses-export-warnings': encodeURIComponent(JSON.stringify([
          { code: 'image-resource-failed', nodeId: 'fig-1', message: '服务端导出不访问网络资源，请使用内嵌（data URL）图片' },
          { code: 'image-resource-failed', nodeId: 'fig-2', message: '服务端导出不访问网络资源，请使用内嵌（data URL）图片' },
        ])),
        'x-ses-export-warnings-truncated': 'false',
      },
    })

    await expect(documentApi.exportPdf(42)).resolves.toEqual({
      blob,
      warningCount: 2,
      warnings: [
        { code: 'image-resource-failed', nodeId: 'fig-1', message: '服务端导出不访问网络资源，请使用内嵌（data URL）图片' },
        { code: 'image-resource-failed', nodeId: 'fig-2', message: '服务端导出不访问网络资源，请使用内嵌（data URL）图片' },
      ],
      warningsTruncated: false,
    })
    expect(mocks.get).toHaveBeenCalledWith('/documents/42/export/pdf', { responseType: 'blob' })
  })

  it('保留告警被截断的标记；也支持 AxiosHeaders 风格的 get 取头', async () => {
    const headers = new Map([
      ['X-SES-Export-Warning-Count', '120'],
      ['X-SES-Export-Warnings-Truncated', 'TRUE'],
    ])
    mocks.get.mockResolvedValue({ data: new Blob(['%PDF']), headers: { get: (name: string) => headers.get(name) } })

    const result = await documentApi.exportPdf(1)
    expect(result.warningCount).toBe(120)
    expect(result.warnings).toEqual([])
    expect(result.warningsTruncated).toBe(true)
  })

  it('没有告警头或头无效时告警数为 0、明细为空', async () => {
    mocks.get.mockResolvedValue({ data: new Blob(['%PDF']), headers: {} })
    expect(await documentApi.exportPdf(1)).toMatchObject({ warningCount: 0, warnings: [], warningsTruncated: false })

    mocks.get.mockResolvedValue({
      data: new Blob(['%PDF']),
      headers: { 'x-ses-export-warning-count': '-3', 'x-ses-export-warnings': '%E0%A4%A' },
    })
    expect(await documentApi.exportPdf(1)).toMatchObject({ warningCount: 0, warnings: [] })
  })

  it('422 / 503 / 500 以 Blob 返回 JSON 错误时显示服务端消息', async () => {
    for (const message of ['导出被阻止：脚注未定义', 'PDF 导出不可用：服务端 IR→HTML→PDF 管线缺少依赖：poppler', 'PDF 导出失败：vivliostyle 退出码 1']) {
      mocks.get.mockRejectedValueOnce(Object.assign(new Error('Request failed'), {
        response: { data: new Blob([JSON.stringify({ message })], { type: 'application/json' }) },
      }))
      await expect(documentApi.exportPdf(7)).rejects.toThrow(message)
    }
  })

  it('网络错误没有响应体时使用错误自带消息，都没有则回退为「PDF 导出失败」', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Network Error'))
    await expect(documentApi.exportPdf(7)).rejects.toThrow('Network Error')
    mocks.get.mockRejectedValueOnce({})
    await expect(documentApi.exportPdf(7)).rejects.toThrow('PDF 导出失败')
  })
})
