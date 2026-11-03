import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shouldSkipValidation } from '../../renderers/__tests__/xml46687PythonValidation'
import { parseXml46687 } from '../parse'
import { detectLegacyXml46687 } from './legacy'
import { validateXml46687 } from './validate'

const sampleDir = resolve(process.cwd(), '../../schemas/gbt46687.2/samples')

interface PythonSampleResult { file: string; valid: boolean; engines_consistent: boolean; errors: Array<{ rule: string }> }
let external: Map<string, PythonSampleResult> | undefined
function externalResults(): Map<string, PythonSampleResult> {
  if (external) return external
  const paths = ['valid', 'invalid'].flatMap(group =>
    readdirSync(resolve(sampleDir, group)).filter(n => n.endsWith('.xml')).map(n => resolve(sampleDir, group, n)))
  const script = resolve(process.cwd(), '../../scripts/xml46687/validate.py')
  const result = spawnSync('python3', ['-I', script, '--profile', 'import', '--json', ...paths], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(1) // 负例存在时整批命令必须为 1
  const parsed = JSON.parse(result.stdout) as { results: PythonSampleResult[] }
  expect(parsed.results).toHaveLength(paths.length)
  external = new Map(parsed.results.map(r => [resolve(r.file), r]))
  return external
}

describe.skipIf(shouldSkipValidation())('WP8.3 与 Python import 裁判的格式判定一致', () => {
  for (const group of ['valid', 'invalid']) {
    for (const file of readdirSync(resolve(sampleDir, group)).filter(n => n.endsWith('.xml')).sort()) {
      it(`${group}/${file} 的解析与语义结论一致`, () => {
        const path = resolve(sampleDir, group, file)
        const xml = parseXml46687(readFileSync(path, 'utf8'))
        const problems = xml.tree ? [...detectLegacyXml46687(xml.tree), ...validateXml46687(xml.tree).problems] : xml.problems
        const actual = !problems.some(p => p.severity === 'error')
        const oracle = externalResults().get(path)!
        expect(oracle.engines_consistent, file).toBe(true)
        expect(actual, `${file}: Python ${JSON.stringify(oracle.errors)}; TS ${JSON.stringify(problems)}`).toBe(oracle.valid)
      }, 30000)
    }
  }
})
