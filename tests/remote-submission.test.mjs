import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkRemote,submissionId} from '../scripts/check-remote-submission.mjs'
const a='a'.repeat(40),b='b'.repeat(40),root='c'.repeat(40),sub='d'.repeat(40),folder='e'.repeat(40),assets='f'.repeat(40),manifestSha='1'.repeat(40),imageSha='2'.repeat(40)
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1EAAAAASUVORK5CYII=','base64')
const manifest=Buffer.from(JSON.stringify({schemaVersion:1,id:'sample-set',name:'晨光',author:'作者',github:'artist',license:'CC0',permission:true,components:{badge:{file:'assets/badge.png'}}}))
const fake=(changes=[{filename:'submissions/sample-set/manifest.json',status:'added'}])=>{
 const request=async path=>{
  if(path.endsWith('/pulls/2'))return {state:'open',draft:false,user:{login:'artist'},head:{sha:a,repo:{full_name:'artist/fork'}},base:{sha:b,ref:'main'}}
  if(path.includes('/files?'))return changes
  if(path.includes('/git/commits/'+a))return {tree:{sha:root}}
  if(path.includes('/git/commits/'+b))return {tree:{sha:b}}
  if(path.endsWith('/git/trees/'+b))return {tree:[]}
  if(path.endsWith('/git/trees/'+root))return {tree:[{path:'submissions',type:'tree',mode:'040000',sha:sub}]}
  if(path.endsWith('/git/trees/'+sub))return {tree:[{path:'sample-set',type:'tree',mode:'040000',sha:folder}]}
  if(path.endsWith('/git/trees/'+folder))return {tree:[{path:'manifest.json',type:'blob',mode:'100644',sha:manifestSha,size:manifest.length},{path:'assets',type:'tree',mode:'040000',sha:assets}]}
  if(path.endsWith('/git/trees/'+assets))return {tree:[{path:'badge.png',type:'blob',mode:'100644',sha:imageSha,size:png.length}]}
  throw Error('unexpected '+path)
 }
 const raw=async path=>path.endsWith(manifestSha)?manifest:path.endsWith(imageSha)?png:Promise.reject(Error('unexpected blob'))
 return {repo:'kourou25/meme-hall-skins',number:2,head:a,request,raw}
}
test('仅以数据读取投稿并核验作者、图片与配置',async()=>{const result=await checkRemote(fake());assert.equal(result.id,'sample-set');assert.equal(result.author,'artist')})
test('拒绝脚本修改、跨套装修改和伪造提交',async()=>{assert.throws(()=>submissionId([{filename:'public/x.js'}]),/固定目录/);assert.throws(()=>submissionId([{filename:'submissions/abc/manifest.json'},{filename:'submissions/def/manifest.json'}]),/一个套装/);await assert.rejects(checkRemote({...fake(),head:'0'.repeat(40)}),/版本已变化/)})
test('手动重查仍只允许合并到主分支',async()=>{const f=fake(),request=f.request;f.request=async p=>{const value=await request(p);if(p.endsWith('/pulls/2'))value.base.ref='other';return value};await assert.rejects(checkRemote(f),/目标分支/)})
test('已合并的同一投稿可重新核验并恢复发布',async()=>{const f=fake(),request=f.request;f.request=async p=>{const value=await request(p);if(p.endsWith('/pulls/2'))Object.assign(value,{state:'closed',merged:true,merged_at:'2026-10-30T00:00:00Z',merge_commit_sha:'3'.repeat(40)});return value};assert.equal((await checkRemote(f)).merged,true)})
test('已关闭未合并的投稿不能恢复',async()=>{const f=fake(),request=f.request;f.request=async p=>{const value=await request(p);if(p.endsWith('/pulls/2'))Object.assign(value,{state:'closed',merged:false});return value};await assert.rejects(checkRemote(f),/状态/ )})
