import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exportXml46687, pmToIr, resolve } from '@ses/shared'
import { createEditorSchema } from '../../client/src/extensions/editorSchema'
import { shouldSkipValidation, validateWithPython } from '../../shared/src/renderers/__tests__/xml46687PythonValidation'
import { collectXml46687Resources } from './xml46687Resources'
import { importXml46687 } from './xml46687Import'

const schema = createEditorSchema()
async function roundtrip09() {
  const input = readFileSync('../../schemas/gbt46687.2/samples/valid/09-import-pending.xml','utf8')
  let n = 0
  const result = await importXml46687(input, {generateId:()=>`n${++n}`, validateContent:content=>{
    try { const node = schema.nodeFromJSON(content); node.check(); return {ok:true,content:node.toJSON()} }
    catch (error) { return {ok:false,message:String(error)} }
  }})
  expect(result.problems.filter(p=>p.severity === 'error')).toEqual([])
  expect(result.pmDoc).not.toBeNull()
  const saved = JSON.parse(JSON.stringify(result.pmDoc))
  const reopened = schema.nodeFromJSON(saved)
  reopened.check()
  const doc = pmToIr(reopened.toJSON()).doc
  const labels = resolve(doc).labels
  const resources = await collectXml46687Resources(doc,labels)
  expect(resources.problems.filter(p=>p.severity === 'error')).toEqual([])
  const output = exportXml46687(doc,labels,{mathml:{},resources:resources.manifest})
  expect(output.problems.filter(p=>p.severity === 'error')).toEqual([])
  expect(output.xml).not.toBeNull()
  return {doc,xml:output.xml!}
}

it('[M-5.8-01] [M-C.1-05] [M-10.1.8-04] valid09 生产 Schema 保存重开后保留关系并输出', async () => {
  const {doc,xml} = await roundtrip09()
  const blocks = doc.body[0]!.children
  const array = blocks.find(b=>b.kind === 'array')
  const group = blocks.find(b=>b.kind === 'formulaGroup')
  expect(array?.kind).toBe('array')
  if (array?.kind !== 'array' || group?.kind !== 'formulaGroup') throw new Error('数组或公式组缺失')
  expect(array.columnGroups).toEqual([{start:0,count:2}])
  expect(array.rows[0]!.cells).toHaveLength(2)
  expect(group.formulas.map(f=>f.numbered)).toEqual([false,false])
  expect(group.numbered).toBe(true)
  expect(xml.match(/<xref ref-type="fn" rid="fn_1">/g)).toHaveLength(2)
  expect(xml.match(/<fn id="fn_1">/g)).toHaveLength(1)
  expect(xml).toContain('脚注内容。')
  expect(xml).toContain('<disp-formula-group id="formula_1">')
})

describe.skipIf(shouldSkipValidation())('valid09 生产往返的 XML 外部校验', () => {
  it('import/export profile 均有效', async () => {
    const {xml} = await roundtrip09()
    for (const profile of ['import','export']) {
      const result = validateWithPython(xml,profile)
      expect(result.errors, JSON.stringify(result.errors)).toEqual([])
      expect(result.valid).toBe(true)
    }
  })
})
