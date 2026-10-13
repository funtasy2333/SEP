import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { versionApi, type VersionData, type CreateVersionData } from '@/api/version'

export const useVersionStore = defineStore('version', () => {
  const versions = ref<VersionData[]>([])
  const loading = ref(false)
  const currentDocumentId = ref<number | null>(null)

  /** 按时间倒序排列的版本列表 */
  const sortedVersions = computed(() => {
    return [...versions.value].sort((a, b) => {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    })
  })

  /**
   * 获取文档的所有版本。silent 用于后台刷新（如收到 AI 写入的推送）：不切换 loading，
   * 列表不会闪出加载遮罩；切换到别的文档后才返回的旧响应也不会覆盖当前列表。
   */
  async function fetchVersions(documentId: number, options: { silent?: boolean } = {}) {
    if (!options.silent) loading.value = true
    currentDocumentId.value = documentId
    try {
      const { data } = await versionApi.listByDocument(documentId)
      if (currentDocumentId.value === documentId) versions.value = data
    } finally {
      if (!options.silent) loading.value = false
    }
  }

  /** 获取单个版本详情 */
  async function fetchVersion(id: number): Promise<VersionData> {
    const { data } = await versionApi.get(id)
    return data
  }

  /** 创建新版本 */
  async function createVersion(data: CreateVersionData): Promise<VersionData> {
    const { data: version } = await versionApi.create(data)
    versions.value.unshift(version)
    return version
  }

  /** 生成下一个版本号 */
  function getNextVersionNo(): string {
    if (versions.value.length === 0) return '1.0'
    const latest = sortedVersions.value[0]
    const parts = latest.versionNo.split('.')
    const major = parseInt(parts[0]) || 1
    const minor = (parseInt(parts[1]) || 0) + 1
    return `${major}.${minor}`
  }

  function clearVersions() {
    versions.value = []
    currentDocumentId.value = null
  }

  return {
    versions,
    sortedVersions,
    loading,
    currentDocumentId,
    fetchVersions,
    fetchVersion,
    createVersion,
    getNextVersionNo,
    clearVersions,
  }
})
