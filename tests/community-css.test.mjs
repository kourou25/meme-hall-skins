import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readSubmission,checkChanges} from '../scripts/community-catalog.mjs'
import {compileCommunityCss} from '../scripts/community-css.mjs'

test('CSS 投稿生成摘要并约束到自己的气泡',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'skin-css-'))
 try{
  const folder=join(dir,'submissions','test-set');await mkdir(join(folder,'assets'),{recursive:true})
  await writeFile(join(folder,'manifest.json'),JSON.stringify({schemaVersion:1,id:'test-set',name:'测试',author:'作者',github:'artist',license:'CC0',permission:true,components:{bubble:{file:'assets/bubble.css'}}}))
  await writeFile(join(folder,'assets','bubble.css'),'.cm-text.bb-example { color: red; animation: glow 2s infinite } @keyframes glow { from { opacity: .5 } to { opacity: 1 } }')
  const entry=await readSubmission(dir,'test-set');assert.equal(entry.components.bubble.type,'text/css');assert.equal(entry.components.bubble.sha256.length,64)
  const css=compileCommunityCss('.cm-text.bb-example { color: red }','test-set','bubble');assert.match(css,/\.cskin-bubble-test-set/);assert.doesNotMatch(css,/bb-example/)
  assert.throws(()=>compileCommunityCss('body { color: red }','test-set','bubble'))
  assert.throws(()=>compileCommunityCss('.example { background: url("https://example.com/a.png") }','test-set','bubble'))
 }finally{await rm(dir,{recursive:true,force:true})}
})
