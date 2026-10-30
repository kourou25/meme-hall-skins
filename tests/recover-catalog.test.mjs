import {test} from 'node:test'
import assert from 'node:assert/strict'
import {recoverCatalog} from '../scripts/recover-catalog.mjs'
const time=Date.parse('2026-10-30T01:00:00Z'),sha='a'.repeat(40),older='b'.repeat(40),pr={number:7,state:'closed',merged_at:new Date(time-3600000).toISOString(),merge_commit_sha:sha}
const setup=({comparison='behind',files=[{filename:'submissions/example/manifest.json',status:'added'}],runs=[]}={})=>{const calls=[];return {calls,options:{prs:[pr],runs,now:time,request:async(path,method,body)=>{calls.push([path,method,body]);if(path.startsWith('/contents/'))return {encoding:'base64',content:Buffer.from(JSON.stringify({source:older})).toString('base64')};if(path.startsWith('/compare/'))return {status:comparison};if(path.includes('/files?'))return files;if(path.includes('/dispatches'))return null;throw Error(path)}}}}
test('已合并投稿目录落后时自动恢复一次发布',async()=>{const f=setup();assert.deepEqual(await recoverCatalog(f.options),{dispatched:true,number:7});assert.equal(f.calls.filter(x=>x[1]==='POST').length,1)})
test('有发布任务运行时不重复派发',async()=>{const f=setup({runs:[{status:'in_progress',created_at:new Date(time-60000).toISOString()}]});assert.equal((await recoverCatalog(f.options)).dispatched,false);assert.equal(f.calls.length,0)})
test('近期失败任务不反复派发',async()=>{const f=setup({runs:[{status:'completed',conclusion:'failure',created_at:new Date(time-60000).toISOString()}]});assert.equal((await recoverCatalog(f.options)).reason,'发布冷却中');assert.equal(f.calls.filter(x=>x[1]==='POST').length,0)})
test('目录已包含投稿或未确认来源时不派发',async()=>{for(const comparison of ['ahead','identical','diverged']){const f=setup({comparison});assert.equal((await recoverCatalog(f.options)).dispatched,false)}})
test('人工代码投稿不作为自动素材恢复',async()=>{const f=setup({files:[{filename:'public/chat.css',status:'modified'}]});assert.equal((await recoverCatalog(f.options)).dispatched,false)})
test('读取目录失败时保守跳过',async()=>{const f=setup();f.options.request=async()=>{throw Error('unavailable')};assert.equal((await recoverCatalog(f.options)).reason,'目录不可用')})
