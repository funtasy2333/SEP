/** Preserve structured schema attributes through HTML copy/paste; malformed JSON stays visible to validation. */
export function jsonAttribute(name: string) {
  return {
    default: null,
    parseHTML: (element: HTMLElement): unknown => {
      const raw = element.getAttribute(name)
      if (raw === null) return null
      try { return JSON.parse(raw) as unknown } catch { return raw }
    },
    renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
      const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
      return attrs[key] == null ? {} : { [name]: JSON.stringify(attrs[key]) }
    },
  }
}
