/** 正文后长表接排样稿：生产schema、JSON重开、XML往返和buildDocxBlob。
 * node packages/client/scripts/wp76-inline-table-samples.mjs <absolute output directory>
 * 所有材料均为功能fixture，不代替真实标准文稿。 */
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.argv[2]
if (!output?.startsWith('/')) throw new Error('请提供输出目录绝对路径')
const require = createRequire(resolve(root, 'package.json'))
const { createServer } = await import(require.resolve('vite'))
const { getSchema } = await import(require.resolve('@tiptap/core'))
const { Window } = await import(require.resolve('happy-dom'))
const window = new Window()
window.document.write('<!doctype html><html><body></body></html>')
for (const name of ['DOMParser','Node','Element','HTMLElement','CustomEvent']) globalThis[name] = window[name]
globalThis.document = window.document
globalThis.window = window
Object.defineProperty(globalThis, 'navigator', {value:window.navigator, configurable:true})
const server = await createServer({root, configFile:false, resolve:{alias:{'@':resolve(root,'src')}}, optimizeDeps:{noDiscovery:true}, server:{middlewareMode:true}})
let counter = 0
const id = prefix => `${prefix}-${++counter}`
const t = text => ({type:'text', text})
const paragraph = text => ({type:'stdParagraph', attrs:{nodeId:id('p')}, content:[t(text)]})
const cell = (value, header=false) => ({type:header?'tableHeader':'tableCell', attrs:{colspan:1,rowspan:1}, content:[{type:'paragraph',content:[t(value)]}]})
const meta = {titleCn:'正文后跨页表格分页测试', titleEn:'Pagination test for a table following body text',standardType:'national',standardNo:'GB/T XXXXX—XXXX',icsCode:'01.120',ccsCode:'A 00'}
const intro = [
 '本章规定记录表的编排要求。记录以编号为索引，说明栏采用相同长度的短句，使各数据行保持基本一致的高度，便于观察表格在正文后及续页中的位置。',
 '记录编号从1连续编至70，每个编号对应一条说明。阅读时可按编号检查数据是否遗漏或重复，并核对各页最后一条记录与下一页第一条记录是否衔接。',
 '表格跨页时，后续页面应重复表题和列标题，续表仍沿用同一表号。表注放在最后一段之后，表后文字应接续出现，不另插入空白页。',
 '正文与表格之间不设置人工分页符。本段结束后仍有足够空间容纳表题、列标题及若干数据行，适合观察长表首段是否直接利用当前页余量。',
 '以下记录按编号连续排列，正文结束后直接给出表1。',
]
const longTable = {type:'stdTable', attrs:{nodeId:'inline-long-table',orientation:'portrait'}, content:[
 {type:'tableCaption',content:[t('连续编号记录表')]},
 {type:'table',content:[{type:'tableRow',content:[cell('记录编号',true),cell('记录说明',true)]},...Array.from({length:70},(_,i)=>({type:'tableRow',content:[cell(`记录${i+1}`),cell('检查数据顺序与跨页衔接。')]}))]},
 {type:'tableNoteRow',content:[{type:'note',attrs:{nodeId:'inline-table-note'},content:[t('本表共70条记录，表注仅置于最后一段。')]}]},
]}
const source = {type:'doc',content:[
 {type:'coverPage',attrs:{nodeId:'cover',...meta},content:[{type:'paragraph'}]},
 {type:'chapter',attrs:{nodeId:'body-chapter'},content:[{type:'chapterTitle',content:[t('记录编排')]},...intro.map(paragraph),longTable,paragraph('表1结束。上述70条记录应连续完整，表注仅出现一次。')]},
]}
const clone = value => JSON.parse(JSON.stringify(value))
const variants = [['body-followed-table', clone(source)]]
for (const [name, count] of [['near-page-bottom', 13], ['long-body', 40]]) {
 const variant = clone(source)
 const children = variant.content[1].content
 children.splice(5, 0, ...Array.from({length:count}, (_,i) => paragraph(`补充段落${i+1}：记录应按次序整理，保持各项说明的完整性。跨页后仍按原编号继续排列，检查正文末尾与后续表格是否连续。`)))
 variants.push([name, variant])
}
const noted = clone(source)
noted.content[1].content[1].content.push({type:'footnoteRef',attrs:{nodeId:'body-note-call',content:[t('正文条文脚注占用页底空间。首表段应在扣除该空间后接排，脚注与调用保持同页，表格行不得覆盖脚注。')]}})
variants.push(['body-footnote', noted])
const merged = clone(source)
const mergedTable = merged.content[1].content.find(block=>block.type==='stdTable')
const rows = mergedTable.content[1].content
for(let i=1;i<rows.length;i++) {
 rows[i].content[0].content[0].content = [t(`项目${i}`)]
 rows[i].content[1].content[0].content = [t(`记录${i}：检查数据顺序与跨页衔接。`)]
}
for (const index of [1, 29]) {
 rows[index].content[0].attrs.rowspan=2
 rows[index+1].content.splice(0,1)
}
for(const [index, targetId] of [[3,'table-def-b'],[4,'table-def-a'],[5,'table-def-b']]) {
 rows[index].content.at(-1).content[0].content.push({type:'tableFootnoteRef',attrs:{nodeId:id('table-call'),targetId}})
}
mergedTable.content.push({type:'tableFootnoteRow',content:[
 {type:'tableFootnoteEntry',attrs:{nodeId:'table-def-a'},content:[t('定义A：按第二次首次调用派生编号。')]},
 {type:'tableFootnoteEntry',attrs:{nodeId:'table-def-b'},content:[t('定义B：按首次调用派生编号，重复调用不重造定义。')]},
]})
variants.push(['merged-table-footnotes',merged])
const landscape = clone(source)
const wide = clone(longTable)
wide.attrs={nodeId:'wide-short-table',orientation:'landscape'}
wide.content=[{type:'tableCaption',content:[t('横排前置表')]},{type:'table',content:[{type:'tableRow',content:[cell('项目',true),cell('说明',true)]},{type:'tableRow',content:[cell('横排检查'),cell('下文恢复竖排。')]}]}]
landscape.content[1].content.splice(1,0,wide)
variants.push(['landscape-followed-portrait-table',landscape])
const captioned = clone(source)
captioned.content[1].content.find(block=>block.type==='stdTable').content[0].content=[t('连续编号记录表：'+ '检查跨页表题换行后是否完整显示并为数据行预留空间。'.repeat(5))]
variants.push(['long-caption',captioned])
const formulaSmall = clone(source)
const formulaBlocks = formulaSmall.content[1].content
const small = formulaBlocks.find(block=>block.type==='stdTable')
small.content[1].content=small.content[1].content.slice(0,3)
small.content=small.content.slice(0,2)
formulaBlocks.splice(formulaBlocks.indexOf(small),0,{type:'formula',attrs:{nodeId:'flow-unknown-formula',id:'flow-unknown-formula'},content:[{type:'formulaContent',content:[t('x=1')]}]})
formulaBlocks.at(-1).content=[t('公式后小表结束，两条记录应完整；不可估高度回退应另起页。')]
variants.push(['formula-followed-small-table',formulaSmall])
const brokenLines = (count, text) => Array.from({length:count},(_,i)=>[...(i>0?[{type:'hardBreak'}]:[]),t(`${text}${i+1}`)]).flat()
for(const [name,lineCount,records] of [['tall-header-footer-risk',46,1],['tight-footer-budget',36,10],['last-group-footer-risk',50,1]]) {
 const variant=clone(source)
 const blocks=variant.content[1].content
 const boundary=blocks.find(block=>block.type==='stdTable')
 const header=boundary.content[1].content[0]
 boundary.content[1].content=[...Array.from({length:name==='last-group-footer-risk'?1:6},()=>{
  const copied=clone(header)
  for(const cell of copied.content)cell.content[0].content=name==='last-group-footer-risk'?[t('表头')]:brokenLines(2,'表头')
  return copied
 }),...boundary.content[1].content.slice(1,records+1)]
 boundary.content[2].content[0].content=brokenLines(lineCount,'表注')
 blocks.at(-1).content=[t(`边界表结束，本表共${records}条记录。`)]
 variants.push([name,variant])
}


// 复审边界：图片与图题靠近页底；长列项的回行缩进影响紧随其后的长表。
const chain = clone(source)
chain.content[1].content = [chain.content[1].content[0], {
 type:'stdParagraph',attrs:{nodeId:'keep-chain-preamble'},content:brokenLines(28,'图前正文')
}, {type:'figure',attrs:{nodeId:'keep-chain-figure',orientation:'portrait'},content:[
 {type:'figureImage',attrs:{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAACXCAIAAAAgZfEgAAABvklEQVR4nO3TMQEAIAzAsIEz3CAIwcjokxjo1XXuG6CzwzZgQuiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCmNYH1+UCazbBD8cAAAAASUVORK5CYII='}},
 {type:'figureCaption',content:[t('图片与图题应同页')]},
]},clone(longTable),paragraph('图后表结束，70条记录应连续完整。')]
variants.push(['figure-caption-followed-table',chain])
for(const [name,listType] of [['alpha-list-followed-table','alpha'],['numeric-list-followed-table','numeric'],['dash-list-followed-table','dash']]) {
 const variant=clone(source)
 variant.content[1].content=[variant.content[1].content[0],{
  type:'stdList',attrs:{nodeId:`${name}-list`,listType,level:1},content:Array.from({length:8},(_,i)=>({
   type:'stdListItem',attrs:{nodeId:`${name}-item-${i}`},content:[t(`列项${i+1}：`+'记录应保持完整并检查跨页衔接。'.repeat(8))]
  }))
 },clone(longTable),paragraph('列项后表结束，70条记录应连续完整。')]
 variants.push([name,variant])
}


// 标题后直接接表：标题本身能留在旧页，但标题与表格首段应一起移页。
for(const [name,shortFirst] of [
 ['heading-short-table-then-long-table',true],
 ['heading-long-table',false],
]) {
 const variant=clone(source)
 const small=clone(longTable);small.attrs.nodeId=`${name}-short`;small.content=small.content.slice(0,2);small.content[1].content=small.content[1].content.slice(0,3);small.content[0].content=[t('标题后短表')]
 const title=[t('表前条标题')]
 variant.content[1].content=[variant.content[1].content[0],{type:'stdParagraph',attrs:{nodeId:`${name}-preamble`},content:brokenLines(30,'标题前正文')},{
  type:'clause',attrs:{nodeId:`${name}-clause`,level:1,hasTitle:true},content:[
   {type:'clauseTitle',attrs:{level:1},content:title},...(shortFirst?[small]:[]),clone(longTable)
  ]
 },paragraph('标题后长表结束，70条记录应连续完整。')]
 variants.push([name,variant])
}

// 普通正文不带keepLines；脚注引用在早/晚行，Word应允许这段自然跨页。
for (const [name, anchor, heading] of [
 ['split-footnote-early-then-table',0,false],
 ['split-footnote-late-then-table',10,false],
 ['split-footnote-late-heading-table',10,true],
]) {
 const variant = clone(source)
 const content = brokenLines(12,'跨页脚注正文行')
 const anchorIndex = content.findIndex(node => node.type==='text' && node.text===`跨页脚注正文行${anchor+1}`)
 content.splice(anchorIndex+1,0,{type:'footnoteRef',attrs:{nodeId:`${name}-call`,content:[t('跨页条文脚注检查：定义应与调用标记同页，段落允许分布在相邻两页。')]}})
 const following = heading ? {type:'clause',attrs:{nodeId:`${name}-clause`,level:1,hasTitle:true},content:[
  {type:'clauseTitle',attrs:{level:1},content:[t('脚注正文后的表前标题')]},clone(longTable)
 ]} : clone(longTable)
 variant.content[1].content=[variant.content[1].content[0],{type:'stdParagraph',attrs:{nodeId:`${name}-preamble`},content:brokenLines(30,'脚注前正文行')},
  {type:'stdParagraph',attrs:{nodeId:`${name}-paragraph`},content},following,paragraph('脚注正文后的长表结束，70条记录应连续完整。')]
 variants.push([name,variant])
}

// 表头合并覆盖较多数据行，甚至整张表；后续长表必须使用实际输出分段的页流。
for (const [name, covered, total] of [
 ['header-rowspan-20-then-long-table',20,110],
 ['header-rowspan-60-then-long-table',60,110],
 ['header-rowspan-all-then-long-table',70,70],
]) {
 const variant = clone(source)
 const spanning = clone(longTable)
 spanning.attrs.nodeId = `${name}-first`
 spanning.content[0].content = [t('表头跨行合并表')]
 const spanCell = cell('合并分类',true);spanCell.attrs.rowspan = covered+1
 spanning.content[1].content = [{type:'tableRow',content:[spanCell,cell('合并记录编号',true),cell('记录说明',true)]},
  ...Array.from({length:total},(_,i)=>({type:'tableRow',content:[...(i<covered?[]:[cell(`分类${i+1}`)]),cell(`合并记录${i+1}`),cell('检查合并行与后续表格接排。')]}))]
 spanning.content[2].content[0].attrs.nodeId = `${name}-note`
 spanning.content[2].content[0].content = [t(`本合并表共${total}条记录，合并表注只出现一次。`)]
 variant.content[1].content = [variant.content[1].content[0],paragraph('下列表头分类列跨入数据行，检查输出分段与高度记账是否一致。'),spanning,clone(longTable),paragraph('合并表后的长表结束，70条记录应连续完整。')]
 variants.push([name,variant])
}

// 接近两整页的数据量：短表旧页定位错误会让后续长表多出一张续页。
const consecutive = clone(variants.find(([name]) => name === 'heading-short-table-then-long-table')[1])
const consecutiveTable = consecutive.content[1].content[2].content.at(-1)
consecutiveTable.content[1].content.push(...Array.from({length:23}, (_,i) => ({type:'tableRow',content:[cell(`记录${i+71}`),cell('检查数据顺序与跨页衔接。')]})))
consecutiveTable.content[2].content[0].content = [t('本表共93条记录，表注仅置于最后一段。')]
consecutive.content[1].content.at(-1).content = [t('标题后长表结束，93条记录应连续完整。')]
variants.push(['heading-short-table-then-93-records', consecutive])

// 不可测公式后仍有充足物理余量；强制回退必须把整个两级标题链带到新页。
for (const [name, shortFirst] of [
 ['formula-heading-small-table', true], ['formula-heading-long-table', false],
]) {
 const variant = clone(source)
 const small = clone(longTable)
 small.attrs.nodeId = `${name}-short`
 small.content = small.content.slice(0, 2)
 small.content[1].content = small.content[1].content.slice(0, 3)
 small.content[0].content = [t('公式标题后短表')]
 variant.content[1].content = [variant.content[1].content[0], paragraph('公式前正文，当前页仍有充足空间。'),
  {type:'formula',attrs:{nodeId:`${name}-formula`,id:`${name}-formula`},content:[{type:'formulaContent',content:[t('x=1')]}]},
  {type:'clause',attrs:{nodeId:`${name}-clause`,level:1,hasTitle:true},content:[
   {type:'clauseTitle',attrs:{level:1},content:[t('公式后第一条标题')]},
   {type:'clause',attrs:{nodeId:`${name}-child`,level:2,hasTitle:true},content:[
    {type:'clauseTitle',attrs:{level:2},content:[t('公式后第二条标题')]},
    ...(shortFirst?[small]:[]), clone(longTable),
   ]},
  ]}, paragraph('公式后长表结束，70条记录应连续完整。')]
 variants.push([name, variant])
}

try {
 await mkdir(output,{recursive:true})
 const {createEditorExtensions}=await server.ssrLoadModule('/src/extensions/editorExtensions.ts')
 const {buildDocxBlob}=await server.ssrLoadModule('/src/serializer/docxExporter.ts')
 const {serializeToXml}=await server.ssrLoadModule('/src/serializer/xmlSerializer.ts')
 const {parseXmlToEditorJson}=await server.ssrLoadModule('/src/serializer/xmlParser.ts')
 const schema = getSchema(createEditorExtensions())
 const normalize = source => {const node=schema.nodeFromJSON({...source,type:schema.topNodeType.name});node.check();return node}
 const manifest=[]
 for(const [name, source] of variants) {
  const node=normalize(source)
  const before=JSON.stringify(node.toJSON())
  const reopened=normalize(JSON.parse(before));assert.deepEqual(reopened.toJSON(),node.toJSON())
  const xml=serializeToXml(node)
  await writeFile(resolve(output,`${name}.xml`),xml)
  // happy-dom 的 XML parser 拒绝合法 CDATA；公式样稿仅验证 JSON 重开和生产 DOCX，
  // 原始 XML 仍输出供独立解析校验，不把未运行的往返写成通过。
  const roundtrip=xml.includes('<![CDATA[') ? undefined : normalize(parseXmlToEditorJson(xml,schema.topNodeType.name))
  const {blob,warnings}=await buildDocxBlob({pmDoc:node,documentMeta:meta,stage:'working_draft',createdAt:'2026-10-03T00:00:00Z'})
  if(roundtrip) {
   const exportedAgain=await buildDocxBlob({pmDoc:roundtrip,documentMeta:meta,stage:'working_draft',createdAt:'2026-10-03T00:00:00Z'})
   assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),new Uint8Array(await exportedAgain.blob.arrayBuffer()))
  }
  assert.equal(JSON.stringify(node.toJSON()),before)
  await writeFile(resolve(output,`${name}.docx`),new Uint8Array(await blob.arrayBuffer()))
  await writeFile(resolve(output,`${name}.json`),JSON.stringify({meta,stage:'working_draft',content:node.toJSON()},null,2))
  manifest.push({name,qualification:'fixture',sourceHasManualPageBreak:false,warnings,bytes:blob.size,jsonReopen:true,xmlRoundtripByteIdentical:roundtrip ? true : null,xmlRoundtripLimitation:roundtrip ? null : 'fixture DOM rejects CDATA; not executed'})
 }
 await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2))
 console.log(JSON.stringify(manifest))
} finally {await server.close();window.happyDOM.abort()}
