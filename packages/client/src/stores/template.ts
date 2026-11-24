import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { StandardTemplate } from '@ses/shared'
import { templateApi, type CreateTemplateRequest, type UpdateTemplateRequest } from '@/api/template'

const RECONNECT_DELAYS_MS = [3_000, 6_000, 12_000, 30_000]

export const useTemplateStore = defineStore('template', () => {
  const templates = ref<StandardTemplate[]>([])
  const currentTemplate = ref<StandardTemplate | null>(null)
  const loading = ref(false)

  let listGeneration = 0
  let eventSource: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let subscriberRefs = 0

  const builtinTemplates = computed(() => templates.value.filter((t) => t.readonly))
  const customTemplates = computed(() => templates.value.filter((t) => !t.readonly))

  async function fetchTemplates() {
    const generation = ++listGeneration
    loading.value = true
    try {
      const { data } = await templateApi.list()
      if (generation === listGeneration) {
        templates.value = data
      }
    } finally {
      if (generation === listGeneration) loading.value = false
    }
  }

  async function fetchTemplate(id: string | number) {
    loading.value = true
    try {
      const { data } = await templateApi.get(id)
      currentTemplate.value = data
      const idx = templates.value.findIndex((t) => String(t.id) === String(data.id))
      if (idx >= 0) templates.value[idx] = data
      else templates.value.push(data)
      return data
    } finally {
      loading.value = false
    }
  }

  async function createTemplate(payload: CreateTemplateRequest) {
    const { data } = await templateApi.create(payload)
    const idx = templates.value.findIndex((t) => String(t.id) === String(data.id))
    if (idx >= 0) templates.value[idx] = data
    else templates.value.push(data)
    return data
  }

  async function createFromDocument(documentId: number, payload: { name: string; description?: string }) {
    const { data } = await templateApi.createFromDocument(documentId, payload)
    templates.value.push(data)
    return data
  }

  async function updateTemplate(id: number, payload: UpdateTemplateRequest) {
    const { data } = await templateApi.update(id, payload)
    if (currentTemplate.value && currentTemplate.value.id === id) {
      currentTemplate.value = data
    }
    const idx = templates.value.findIndex((t) => t.id === id)
    if (idx >= 0) templates.value[idx] = data
    return data
  }

  async function revertTemplate(id: number, baseRevision: number) {
    const { data } = await templateApi.revert(id, baseRevision)
    if (currentTemplate.value && currentTemplate.value.id === id) {
      currentTemplate.value = data
    }
    const idx = templates.value.findIndex((t) => t.id === id)
    if (idx >= 0) templates.value[idx] = data
    return data
  }

  async function deleteTemplate(id: number) {
    await templateApi.remove(id)
    templates.value = templates.value.filter((t) => t.id !== id)
    if (currentTemplate.value && currentTemplate.value.id === id) {
      currentTemplate.value = null
    }
  }

  function connectEvents() {
    if (typeof EventSource === 'undefined' || eventSource) return
    const es = new EventSource(templateApi.eventsUrl())
    eventSource = es

    const refresh = () => {
      reconnectAttempt = 0
      void fetchTemplates().catch(() => undefined)
      const active = currentTemplate.value
      if (active && !active.readonly && typeof active.id === 'number') {
        void fetchTemplate(active.id).catch(() => undefined)
      }
    }

    es.addEventListener('template-changed', refresh)
    es.onopen = () => {
      reconnectAttempt = 0
    }
    es.onerror = () => {
      es.close()
      if (eventSource === es) eventSource = null
      if (subscriberRefs <= 0) return
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!
      reconnectAttempt += 1
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (subscriberRefs > 0) connectEvents()
      }, delay)
    }
  }

  function startEventSync(): () => void {
    subscriberRefs += 1
    connectEvents()
    return () => {
      subscriberRefs = Math.max(0, subscriberRefs - 1)
      if (subscriberRefs === 0) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        if (eventSource) {
          eventSource.close()
          eventSource = null
        }
      }
    }
  }

  return {
    templates,
    builtinTemplates,
    customTemplates,
    currentTemplate,
    loading,
    fetchTemplates,
    fetchTemplate,
    createTemplate,
    createFromDocument,
    updateTemplate,
    revertTemplate,
    deleteTemplate,
    startEventSync,
  }
})
