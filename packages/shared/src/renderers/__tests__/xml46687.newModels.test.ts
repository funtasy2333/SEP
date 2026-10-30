import { expect, it } from 'vitest'
import type { IRBlock } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { chapter, labelsOf, makeDoc, para } from './xml46687Kit'
import { stubOptions } from './xml46687StubKit'
import { shouldSkipValidation, validateWithPython } from './xml46687PythonValidation'

it('[M-8.4-01] [M-8.4-02] [M-C.1-04] [M-C.1-05] [M-10.1.8-04] 新模型组合输出符合导入与导出校验', () => {
  expect(shouldSkipValidation()).toBe(false)
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aQAAAABJRU5ErkJggg=='
  const formula = (id:string, text:string) => ({kind:'formula' as const,id,latex:'',numbered:false,whereList:[],mathml:`<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>${text}</mi></math>`})
  const fig = (id:string) => ({kind:'figure' as const,id,caption:[{text:id}],orientation:'portrait' as const,src,notes:[]})
  const blocks: IRBlock[] = [
    para('p','引用', {text:'',footnoteRef:{targetId:'fn',refText:'1)'}}, '及', {text:'',footnoteRef:{targetId:'fn',refText:'1)'}}, {text:'',footnoteDefinition:{id:'fn',content:[{text:'共享脚注'}]}}),
    {kind:'array',id:'array',columns:[{width:{value:40,unit:'%'}},{width:{value:60,unit:'%'}}],columnGroups:[{start:0,count:2}],rows:[{id:'r',cells:[{id:'c1',colspan:1,rowspan:1,header:false,content:[para('c1.p','甲')]},{id:'c2',colspan:1,rowspan:1,header:false,content:[para('c2.p','乙')]}]}]},
    {kind:'formulaGroup',id:'fg',numbered:true,formulas:[formula('f1','a'),formula('f2','b')]},
    {...fig('multi'),additionalGraphics:[{id:'extra',src,contentType:'image',specificUse:'size:M'}]},
    {kind:'figureSet',id:'set',legend:{id:'legend',items:[{id:'item',term:[{text:'1'}],definition:[{text:'说明'}]}]},figures:[fig('s1'),fig('s2')]},
    {kind:'table',id:'table',caption:[{text:'表'}],orientation:'portrait',headerRowCount:0,rows:[{id:'tr',cells:[{id:'td',colspan:1,rowspan:1,header:false,content:[para('td.p','值')]}]}],notes:[],alternativeGraphic:{id:'alt',src,contentType:'disp_table'}},
  ]
  const doc = makeDoc([chapter('ch','范围',blocks,'scope')])
  const result = exportXml46687(doc,labelsOf(doc),stubOptions(doc))
  expect(result.problems.filter(p=>p.severity === 'error')).toEqual([])
  for (const profile of ['import','export']) {
    const checked = validateWithPython(result.xml!,profile)
    expect(checked.errors, `${profile}: ${JSON.stringify(checked.errors)}`).toEqual([])
    expect(checked.valid).toBe(true)
  }
})
