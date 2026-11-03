import type { Channel } from '@/api/system'

export const CHANNEL_LABELS: Record<Channel, string> = {
  stable: '稳定版',
  commit: '提交版',
}

export function shortSha(sha: string | null | undefined): string {
  return (sha ?? '').slice(0, 7)
}

/** 「SES 0.1.1-preview · 稳定版」/「SES 0.1.1 · 提交版 a1b2c3d」；通道未知时只显示版本。 */
export function describeVersion(info: { version: string; channel: Channel | null; commit: string | null }): string {
  const base = `SES ${info.version}`
  if (!info.channel) return base
  const sha = shortSha(info.commit)
  return info.channel === 'commit' && sha
    ? `${base} · ${CHANNEL_LABELS.commit} ${sha}`
    : `${base} · ${CHANNEL_LABELS[info.channel]}`
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}
