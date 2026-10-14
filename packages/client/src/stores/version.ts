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

  // 列表请求的代次：每发出一次请求加 1，只有最近一次发出的请求可以写入列表、关闭 loading。
  // 同一文档的多次刷新（打开面板的首次加载、每次 AI 事件的 silent 刷新）会重叠，
  // 先发出、后返回的较旧响应不能覆盖较新的列表；切换文档时旧文档的响应同样因此被丢弃。
  let fetchGeneration = 0
  /** 最近一次发出的列表请求是否已经返回（成功或失败）。 */
  let latestFetchSettled = true

  /**
   * 获取文档的所有版本。silent 用于后台刷新（如收到 AI 写入的推送）：不切换 loading，
   * 列表不会闪出加载遮罩。只采用最近一次发出的请求的响应；被更新的请求取代的请求，
   * 其响应与 loading 都交给取代它的那次处理（即使后者是 silent，返回时也会关掉前者打开的 loading）。
   */
  async function fetchVersions(documentId: number, options: { silent?: boolean } = {}) {
    const generation = ++fetchGeneration
    latestFetchSettled = false
    if (!options.silent) loading.value = true
    currentDocumentId.value = documentId
    try {
      const { data } = await versionApi.listByDocument(documentId)
      if (generation === fetchGeneration) versions.value = data
    } finally {
      if (generation === fetchGeneration) {
        latestFetchSettled = true
        loading.value = false
      }
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
    // 创建前发出、尚未返回的刷新可能不含这个版本，它返回时会整体替换列表而丢掉刚创建的版本：
    // 此时再刷新一次（更新的请求取代旧的），之后的列表来自创建之后的请求。没有进行中的刷新则不多发请求。
    if (!latestFetchSettled && currentDocumentId.value !== null) {
      void fetchVersions(currentDocumentId.value, { silent: true }).catch(() => undefined)
    }
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
    // 进行中的请求作废（响应不再写入列表），loading 也不能留给它们关闭。
    fetchGeneration += 1
    latestFetchSettled = true
    loading.value = false
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
