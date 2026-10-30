import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mergeAndPublish} from '../scripts/merge-submission.mjs'
const sha='a'.repeat(40),time=Date.parse('2026-10-30T00:00:00Z'),open=()=>({state:'open',draft:false,head:{sha},base:{ref:'main'}}),closed=()=>({...open(),state:'closed',merged:true,merged_at:new Date(time).toISOString()})
const options=request=>({number:13,sha,request,wait:async()=>{},clock:()=>time})
test('已核验投稿合并后派发目录发布',async()=>{const calls=[],request=async(p,m,b)=>{calls.push([p,m,b]);return m==='GET'?open():m==='PUT'?{merged:true}:{}};await mergeAndPublish(options(request));assert.deepEqual(calls.map(x=>x[1]),['GET','PUT','POST']);assert.equal(calls[1][2].sha,sha)})
test('同一版本已合并时重跑只派发发布',async()=>{const calls=[],request=async(p,m)=>{calls.push(m);return m==='GET'?closed():{}};await mergeAndPublish(options(request));assert.deepEqual(calls,['GET','POST'])})
test('合并回包丢失时查询结果后恢复',async()=>{let n=0;const request=async(p,m)=>{if(m==='GET')return ++n===1?open():closed();if(m==='PUT')throw Error('timeout');return {}};assert.equal((await mergeAndPublish(options(request))).published,true)})
test('GitHub 尚未算出可合并状态时有限重试',async()=>{let puts=0;const request=async(p,m)=>{if(m==='GET')return open();if(m==='PUT'){if(++puts<3)throw Error('暂不可合并');return {merged:true}}return {}};assert.equal((await mergeAndPublish(options(request))).published,true);assert.equal(puts,3)})
test('派发失败时重试，已启动的任务不重复派发',async()=>{let posts=0;const request=async(p,m)=>{if(p.includes('/runs?'))return {workflow_runs:[{created_at:new Date(time).toISOString(),head_branch:'main'}]};if(m==='GET')return closed();if(m==='POST'){posts++;throw Error('timeout')}};const r=await mergeAndPublish(options(request));assert.equal(r.recovered,true);assert.equal(posts,1)})
test('派发失败且未启动时有限重试',async()=>{let posts=0;const request=async(p,m)=>{if(p.includes('/runs?'))return {workflow_runs:[]};if(m==='GET')return closed();if(m==='POST'){if(++posts<3)throw Error('temporary');return {}}};await mergeAndPublish(options(request));assert.equal(posts,3)})
test('提交版本变更不得合并或派发',async()=>{let calls=0;await assert.rejects(mergeAndPublish(options(async()=>{calls++;return {...open(),head:{sha:'b'.repeat(40)}}})),/版本/);assert.equal(calls,1)})
