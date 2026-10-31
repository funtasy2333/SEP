import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exportXml46687, pmToIr, resolve } from '@ses/shared'
import { createEditorSchema } from '../../client/src/extensions/editorSchema'
import { shouldSkipValidation, validateWithPython } from '../../shared/src/renderers/__tests__/xml46687PythonValidation'
import { collectXml46687Resources } from './xml46687Resources'
import { importXml46687 } from './xml46687Import'

const schema = createEditorSchema()
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aQAAAABJRU5ErkJggg==','base64')
const imageBytes = (href: string) => Buffer.concat([pixel,Buffer.from(href)])
async function roundtrip(name: string) {
  const input = readFileSync(`../../schemas/gbt46687.2/samples/valid/${name}.xml`,'utf8')
  let n = 0
  const result = await importXml46687(input, {resolveResource: async({href})=>({src:`data:image/png;base64,${imageBytes(href).toString('base64')}`,mediaType:'image/png'}),generateId:()=>`n${++n}`, validateContent:content=>{
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
  return {doc,xml:output.xml!,resources}
}

it('[M-5.8-01] [M-C.1-05] [M-10.1.8-04] valid09 生产 Schema 保存重开后保留关系并输出', async () => {
  const {doc,xml} = await roundtrip('09-import-pending')
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
    const {xml} = await roundtrip('09-import-pending')
    for (const profile of ['import','export']) {
      const result = validateWithPython(xml,profile)
      expect(result.errors, JSON.stringify(result.errors)).toEqual([])
      expect(result.valid).toBe(true)
    }
  })
})


it.each([
  ['[M-4.5.4-04]','03-structure', ['示例网站','index-entry','see-entry','警告是带有警告标签的注。']],
  ['[M-8.4-01]','05-formulas-figures', ['fig-group','fig_2_g1','组合图的共用说明。','公式注紧跟在公式之后。']],
  ['[M-6.1-04]','08-original-forms-vs-sts', ['tab_1_alt','单位为毫米','disp_table']],
])('%s 完整样例 %s 导出保留主要内容与关系', async (_matrix, name, expected) => {
  const {xml} = await roundtrip(name)
  for (const value of expected) expect(xml).toContain(value)
})

describe.skipIf(shouldSkipValidation())('真实样例生产往返的 XML 外部校验', () => {
  it.each(['03-structure','05-formulas-figures','08-original-forms-vs-sts'])('%s 的 import/export profile 均有效', async name => {
    const {xml} = await roundtrip(name)
    for (const profile of ['import','export']) {
      const result = validateWithPython(xml,profile)
      expect(result.errors, JSON.stringify(result.errors)).toEqual([])
      expect(result.valid).toBe(true)
    }
  })
})


it('[M-8.4-01] [M-8.4-02] 样例多图与组合图的每份资源字节保持原归属', async () => {
  const {xml,resources} = await roundtrip('05-formulas-figures')
  const expected: Record<string,string> = {inl_1:'icon_1',fig_1:'fig_1',fig_2:'fig_2',fig_2_g1:'fig_2_b',fig_3:'fig_3',fig_4:'fig_4'}
  expect(resources.manifest.entries).toHaveLength(Object.keys(expected).length)
  for (const entry of resources.manifest.entries) {
    expect(expected[entry.href]).toBeDefined()
    expect(Buffer.from(resources.files[entry.fileName]!)).toEqual(imageBytes(expected[entry.href]!))
    expect(xml).toContain(`xlink:href="${entry.href}"`)
  }
  expect(xml).toMatch(/<fig-group>[\s\S]*组合图的共用说明。[\s\S]*<fig id="fig_3">[\s\S]*<fig id="fig_4">[\s\S]*<\/fig-group>/)
})

it('[M-6.1-04] 表替代图资源字节归属于父表', async () => {
  const {xml,resources} = await roundtrip('08-original-forms-vs-sts')
  const entry = resources.manifest.entries.find(item=>item.href === 'tab_1_alt')!
  expect(entry).toBeDefined()
  expect(Buffer.from(resources.files[entry.fileName]!)).toEqual(imageBytes('tab_1'))
  expect(xml).toMatch(/<table-wrap id="tab_1">[\s\S]*<table-wrap-foot>[\s\S]*<graphic content-type="disp_table" xlink:href="tab_1_alt"\/>[\s\S]*<\/table-wrap>/)
})
