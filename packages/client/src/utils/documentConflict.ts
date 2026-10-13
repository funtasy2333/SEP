/**
 * 保存请求是否因 baseRevision 过期被服务端拒绝（HTTP 409，响应体含服务端当前 revision）。
 * 只看 response.status，不依赖 axios 类型，便于在 mock 了 API 模块的测试里使用。
 */
export function isRevisionConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { response?: { status?: number } }).response?.status === 409
}
