import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {assessment,issueTitle,reconcile,pullRequestAlert} from '../scripts/monitor-checks.mjs'
const now=Date.parse('2026-10-29T08:00:00Z'),run=(extra={})=>({id:42,status:'in_progress',created_at:new Date(now-16*60000).toISOString(),...extra})
test('等待中超过15分钟提示，正常运行和成功不报异常',()=>{assert.match(assessment(run(),now),/15分钟/);assert.equal(assessment(run({created_at:new Date(now-2*60000).toISOString()}),now),null);assert.equal(assessment(run({status:'completed',conclusion:'success'}),now),null);assert.match(assessment(run({status:'completed',conclusion:'failure'}),now),/未通过/)})
test('异常只创建一次，同一条恢复成功后关闭',async()=>{const issues=[],log=[],ctx={issues,now,create:async(title,body)=>{log.push('create');issues.push({number:1,title,body})},update:async()=>log.push('update'),close:async()=>log.push('close')};await reconcile({...ctx,run:run()});await reconcile({...ctx,run:run()});assert.deepEqual(log,['create']);assert.equal(issues[0].title,issueTitle(42));await reconcile({...ctx,run:run({status:'completed',conclusion:'success'})});assert.deepEqual(log,['create','close'])})
test('合并请求和已合并未上线均不会静默等待，草稿不提醒',()=>{const old=new Date(now-16*60000).toISOString(),recent=new Date(now-2*60000).toISOString();assert.match(pullRequestAlert({number:3,state:'open',updated_at:old},now).title,/合并等待/);assert.match(pullRequestAlert({number:3,state:'closed',merged_at:old},now).title,/上线等待/);assert.equal(pullRequestAlert({number:3,state:'open',draft:true,updated_at:old},now),null);assert.equal(pullRequestAlert({number:3,state:'open',updated_at:recent},now),null)})
test('上线未确认时保留提醒，定时扫描不重复派发目录发布',()=>{
 const dir=mkdtempSync(join(tmpdir(),'skin-monitor-')),fixture=join(dir,'mock.mjs')
 try{
  writeFileSync(fixture,`globalThis.fetch=async (url,options={})=>{const u=String(url);let data=[];if(u.includes('dispatches')){console.log('UNEXPECTED_DISPATCH');return new Response(null,{status:204})}if(u.includes('community-skins/status'))data={source:'a'.repeat(40)};else if(u.includes('/compare/'))data={status:'behind'};else if(u.includes('/actions/workflows/'))data={workflow_runs:[]};else if(u.includes('/pulls?state=closed'))data=[{number:2,state:'closed',merged_at:'2026-01-01T00:00:00Z',merge_commit_sha:'b'.repeat(40)}];else if(u.includes('/issues?'))data=[{number:12,title:'[装扮自动化] 上线等待 #2',state:'open',user:{login:'github-actions[bot]'}}];else if(options.method==='PATCH')data={};return new Response(JSON.stringify(data),{status:200})}`)
  const run=spawnSync(process.execPath,['--import',pathToFileURL(fixture).href,'scripts/monitor-checks.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_TOKEN:'fixture',GITHUB_REPOSITORY:'kourou25/meme-hall-skins'}})
  assert.equal(run.status,0,run.stderr);assert.doesNotMatch(run.stdout,/UNEXPECTED_DISPATCH/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
