import { effectScope, ref, type Ref } from 'vue'
import { expect, it } from 'vitest'
import { useCoverDesignationDraft } from './useCoverDesignationDraft'

interface Draft {
  type: string
  coverDesignation: string
  industryName: string
  regionName: string
}

function createCache(draft: Ref<Draft>) {
  const scope = effectScope()
  const cache = scope.run(() => useCoverDesignationDraft({
    getDraft: () => draft.value,
    getType: (value) => value.type,
    setType: (value, type) => { value.type = type },
  }))!
  return { cache, stop: () => scope.stop() }
}

it('keeps each type independent through edits and explicit clearing', () => {
  const draft = ref<Draft>({
    type: 'group',
    coverDesignation: '原团体名称团体标准',
    industryName: '原行业名称',
    regionName: '原地方名称',
  })
  const { cache, stop } = createCache(draft)

  try {
    expect(cache.getName()).toBe('原团体名称')

    cache.changeType('enterprise')
    expect(cache.getName()).toBe('')
    cache.setName('原企业名称')

    cache.changeType('group')
    expect(cache.getName()).toBe('原团体名称')
    cache.setName('修订团体名称')

    cache.changeType('industry')
    expect(cache.getName()).toBe('原行业名称')
    cache.setName('修订行业名称')

    cache.changeType('local')
    expect(cache.getName()).toBe('原地方名称')
    cache.setName('修订地方名称')

    cache.changeType('enterprise')
    expect(cache.getName()).toBe('原企业名称')
    cache.setName('修订企业名称')

    cache.changeType('group')
    expect(cache.getName()).toBe('修订团体名称')
    cache.setName('')
    expect(cache.getName()).toBe('')
    expect(draft.value.coverDesignation).toBe('')

    cache.changeType('enterprise')
    expect(cache.getName()).toBe('修订企业名称')
    cache.changeType('group')
    expect(cache.getName()).toBe('')
    cache.changeType('industry')
    expect(cache.getName()).toBe('修订行业名称')
    cache.changeType('local')
    expect(cache.getName()).toBe('修订地方名称')
  } finally {
    stop()
  }
})

it('rebuilds type values when the parent replaces the saved draft', () => {
  const draft = ref<Draft>({
    type: 'enterprise',
    coverDesignation: '',
    industryName: '',
    regionName: '',
  })
  const { cache, stop } = createCache(draft)

  try {
    cache.setName('未保存企业名称')
    cache.changeType('group')
    cache.setName('未保存团体名称')

    draft.value = {
      type: 'group',
      coverDesignation: '已保存团体名称团体标准',
      industryName: '',
      regionName: '',
    }

    expect(cache.getName()).toBe('已保存团体名称')
    cache.changeType('enterprise')
    expect(draft.value.coverDesignation).toBe('')
    expect(cache.getName()).toBe('')
  } finally {
    stop()
  }
})
