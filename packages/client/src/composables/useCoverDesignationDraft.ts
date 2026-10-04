import { watch } from 'vue'
import { buildCoverDesignation, getCoverDesignationName, getCoverDesignationParts } from '@ses/shared'

interface CoverDesignationDraft {
  coverDesignation?: string
  industryName?: string
  regionName?: string
}

interface CoverDesignationDraftOptions<TDraft extends CoverDesignationDraft, TType extends string> {
  getDraft: () => TDraft
  getType: (draft: TDraft) => TType
  setType: (draft: TDraft, type: TType) => void
}

/**
 * Keeps each editable designation with its draft object while the user changes
 * standard type. Replacing the draft (save, reset, or load) starts a fresh cache.
 */
export function useCoverDesignationDraft<TDraft extends CoverDesignationDraft, TType extends string>(
  options: CoverDesignationDraftOptions<TDraft, TType>,
) {
  const designations = new Map<string, string>()
  let activeDraft: TDraft | undefined
  let activeType: TType | undefined

  function initialize(draft: TDraft) {
    designations.clear()
    const type = options.getType(draft)
    if (getCoverDesignationParts(type)) {
      // Keep the stored value byte-for-byte. In particular, do not normalize a
      // legacy industry/local value just by opening or resetting the form.
      designations.set(type, draft.coverDesignation ?? '')
    }
    activeDraft = draft
    activeType = type
  }

  watch(options.getDraft, initialize, { immediate: true, flush: 'sync' })

  function ensureCurrentDraft(draft: TDraft) {
    if (activeDraft !== draft) initialize(draft)
  }

  function getName(): string {
    const draft = options.getDraft()
    ensureCurrentDraft(draft)
    const type = options.getType(draft)
    if (!getCoverDesignationParts(type)) return ''
    return getCoverDesignationName({
      standardType: type,
      coverDesignation: draft.coverDesignation,
      industryName: draft.industryName,
      regionName: draft.regionName,
    })
  }

  function setName(value: string) {
    const draft = options.getDraft()
    ensureCurrentDraft(draft)
    const type = options.getType(draft)
    if (!getCoverDesignationParts(type)) return

    const name = value.trim()
    const designation = name ? buildCoverDesignation(type, name) : ''
    draft.coverDesignation = designation
    if (type === 'industry') draft.industryName = name
    if (type === 'local') draft.regionName = name
    designations.set(type, designation)
    activeType = type
  }

  function changeType(type: TType) {
    const draft = options.getDraft()
    ensureCurrentDraft(draft)
    const previousType = activeType ?? options.getType(draft)
    if (previousType === type) return

    if (getCoverDesignationParts(previousType)) {
      designations.set(previousType, draft.coverDesignation ?? '')
    }

    options.setType(draft, type)
    draft.coverDesignation = getCoverDesignationParts(type)
      ? designations.get(type) ?? ''
      : ''
    activeType = type
  }

  return { changeType, getName, setName }
}
