import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export type Channel = 'stable' | 'commit'

export interface UpgradeStatusFile {
  state: 'running' | 'succeeded' | 'rolled-back' | 'failed'
  step: string
  from: string
  to: string
  message: string | null
  log: string
  updatedAt: string
}

export interface DownloadStatus {
  phase: 'idle' | 'downloading' | 'verifying' | 'handing-off' | 'handed-off' | 'error'
  receivedBytes: number
  totalBytes: number | null
  error: string | null
  startedAt: string | null
}

export interface SystemInfo {
  version: string
  channel: Channel | null
  commit: string | null
  launcher: 'macos' | 'windows' | null
  canShutdown: boolean
  shutdownBlockedReason: string | null
  canUpgrade: boolean
  upgradeBlockedReason: string | null
  upgrade: { download: DownloadStatus; last: UpgradeStatusFile | null }
}

export interface UpdateCommit {
  sha: string
  message: string
  date: string
  author: string | null
}

export interface UpdateCheck {
  channel: Channel
  current: { version: string; commit: string | null; channel: Channel | null }
  latest: {
    version: string | null
    commit: string
    publishedAt: string | null
    notes: string | null
    url: string
    assetSize: number | null
  } | null
  available: boolean
  reason: string | null
  commits: UpdateCommit[]
}

export const systemApi = {
  info() {
    return api.get<SystemInfo>('/system/info')
  },
  checkUpdate(channel: Channel) {
    return api.get<UpdateCheck>('/system/update/check', { params: { channel } })
  },
  startUpdate(channel: Channel, commit: string) {
    return api.post<{ accepted: true }>('/system/update', { channel, commit })
  },
  updateStatus() {
    return api.get<DownloadStatus>('/system/update/status')
  },
  shutdown() {
    return api.post<{ accepted: true }>('/system/shutdown', {})
  },
}

/** 取接口错误里的可读信息；没有时返回 fallback。 */
export function systemErrorMessage(error: unknown, fallback: string): string {
  const data = typeof error === 'object' && error !== null
    ? (error as { response?: { data?: unknown } }).response?.data
    : undefined
  if (typeof data === 'object' && data !== null && 'message' in data) {
    const message = (data as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
    if (Array.isArray(message)) {
      const parts = message.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      if (parts.length) return parts.join('；')
    }
  }
  return fallback
}

/** 请求是否因为没有收到服务端响应而失败（服务已停止、网络断开）。 */
export function isNoResponse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && !(error as { response?: unknown }).response
}

export function httpStatusOf(error: unknown): number | undefined {
  const status = typeof error === 'object' && error !== null
    ? (error as { response?: { status?: unknown } }).response?.status
    : undefined
  return typeof status === 'number' ? status : undefined
}
