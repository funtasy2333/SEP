import type { IRInline } from '../ir/types'

/** Legacy sources already contain their display label; typed sources store only the value. */
export function sourceWithLabel(source: IRInline[]): IRInline[] {
  const text = source.map(run => run.text).join('')
  return /^\s*[[［]?来源\s*[:：]/.test(text) ? source : [{ text: '[来源：' }, ...source, { text: ']' }]
}
