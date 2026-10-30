import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {assessment,issueTitle,reconcile,pullRequestAlert,reviewedReleaseConfirmed,reviewedRunSettled,findRunPullRequest} from '../scripts/monitor-checks.mjs'
const now=Date.parse('2026-10-29T08:00:00Z'),run=(extra={})=>({id:42,status:'in_progress',created_at:new Date(now-16*60000).toISOString(),...extra})
test('等待中超过15分钟提示，正常运行和成功不报异常',()=>{assert.match(assessment(run(),now),/15分钟/);assert.equal(assessment(run({created_at:new Date(now-2*60000).toISOString()}),now),null);assert.equal(assessment(run({status:'completed',conclusion:'success'}),now),null);assert.match(assessment(run({status:'completed',conclusion:'failure'}),now),/未通过/)})
test('异常只创建一次，同一条恢复成功后关闭',async()=>{const issues=[],log=[],ctx={issues,now,create:async(title,body)=>{log.push('create');issues.push({number:1,title,body})},update:async()=>log.push('update'),close:async()=>log.push('close')};await reconcile({...ctx,run:run()});await reconcile({...ctx,run:run()});assert.deepEqual(log,['create']);assert.equal(issues[0].title,issueTitle(42));await reconcile({...ctx,run:run({status:'completed',conclusion:'success'})});assert.deepEqual(log,['create','close'])})
test('同一投稿的多次异常使用一条记录，投稿结束才关闭',async()=>{
 const issues=[],log=[],pr={number:77,state:'open'},ctx={issues,now,pr,create:async(title,body)=>{log.push('create');issues.push({number:1,title,body})},update:async(n,body)=>{log.push('update');issues[0].body=body},close:async()=>log.push('close')}
 await reconcile({...ctx,run:run({id:100,status:'completed',conclusion:'failure'})});await reconcile({...ctx,run:run({id:101,status:'completed',conclusion:'failure'})});assert.deepEqual(log,['create','update']);assert.equal(issues[0].title,issueTitle(77))
 await reconcile({...ctx,run:run({id:102,status:'completed',conclusion:'success'})});assert.deepEqual(log,['create','update']);await reconcile({...ctx,pr:{...pr,state:'closed'},run:run({id:101,status:'completed',conclusion:'failure'})});assert.deepEqual(log,['create','update','close'])
})
test('投稿更新后仍关联同一来源分支，其他仓库同名分支不匹配',()=>{
 const pr={number:3,state:'open',head:{sha:'new',ref:'topic',repo:{full_name:'alice/skins'}}}
 assert.equal(findRunPullRequest({event:'pull_request',head_sha:'old',head_branch:'topic',head_repository:{full_name:'alice/skins'}},[pr]),pr)
 assert.equal(findRunPullRequest({event:'pull_request',head_sha:'old',head_branch:'topic',head_repository:{full_name:'other/skins'}},[pr]),undefined)
 assert.equal(findRunPullRequest({event:'workflow_dispatch',head_sha:'new'},[pr]),undefined)
})
test('合并请求和已合并未上线均不会静默等待，草稿不提醒',()=>{const old=new Date(now-16*60000).toISOString(),recent=new Date(now-2*60000).toISOString();assert.match(pullRequestAlert({number:3,state:'open',updated_at:old},now).title,/合并等待/);assert.match(pullRequestAlert({number:3,state:'closed',merged_at:old},now).title,/上线等待/);assert.equal(pullRequestAlert({number:3,state:'open',draft:true,updated_at:old},now),null);assert.equal(pullRequestAlert({number:3,state:'open',updated_at:recent},now),null)})
test('已核验的两次主站发布按精确合并版本确认，其他版本不误判',()=>{
 const pr={number:2,state:'closed',merged_at:'2026-10-29T10:08:44Z',merge_commit_sha:'084e5978246a16c06099f8521fd9588f850cb87b'}
 assert.equal(reviewedReleaseConfirmed(pr),true);assert.equal(reviewedReleaseConfirmed({...pr,merge_commit_sha:'f'.repeat(40)}),false);assert.equal(reviewedReleaseConfirmed({...pr,state:'open'}),false);assert.equal(reviewedReleaseConfirmed({...pr,number:9}),false)
 assert.equal(reviewedRunSettled({id:40841712027,status:'completed',conclusion:'failure'}),true);assert.equal(reviewedRunSettled({id:40841712028,status:'completed',conclusion:'failure'}),false);assert.equal(reviewedRunSettled({id:40841712027,status:'in_progress'}),false)
})
test('上线未确认时保留提醒，定时扫描不重复派发目录发布',()=>{
 const dir=mkdtempSync(join(tmpdir(),'skin-monitor-')),fixture=join(dir,'mock.mjs')
 try{
  writeFileSync(fixture,`globalThis.fetch=async (url,options={})=>{const u=String(url);let data=[];if(u.includes('dispatches')){console.log('UNEXPECTED_DISPATCH');return new Response(null,{status:204})}if(u.includes('community-skins/status'))data={source:'a'.repeat(40)};else if(u.includes('/compare/'))data={status:'behind'};else if(u.includes('/actions/workflows/'))data={workflow_runs:[]};else if(u.includes('/pulls?state=closed'))data=[{number:2,state:'closed',merged_at:'2026-01-01T00:00:00Z',merge_commit_sha:'b'.repeat(40)}];else if(u.includes('/issues?'))data=[{number:12,title:'[装扮自动化] 上线等待 #2',state:'open',user:{login:'github-actions[bot]'}}];else if(options.method==='PATCH')data={};return new Response(JSON.stringify(data),{status:200})}`)
  const run=spawnSync(process.execPath,['--import',pathToFileURL(fixture).href,'scripts/monitor-checks.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_TOKEN:'fixture',GITHUB_REPOSITORY:'kourou25/meme-hall-skins'}})
  assert.equal(run.status,0,run.stderr);assert.doesNotMatch(run.stdout,/UNEXPECTED_DISPATCH/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('定时扫描关闭已发布投稿的历史失败和上线等待',()=>{
 const dir=mkdtempSync(join(tmpdir(),'skin-monitor-release-')),fixture=join(dir,'mock.mjs')
 try{
  writeFileSync(fixture,`globalThis.fetch=async (url,options={})=>{const u=String(url);let data=[];if(options.method==='PATCH'){console.log('CLOSED:'+u.split('/').at(-1)+':'+JSON.parse(options.body).state);return new Response('{}')}if(u.includes('community-skins/status'))data={source:'a'.repeat(40)};else if(u.includes('/actions/workflows/check-skins'))data={workflow_runs:[{id:40841712027,status:'completed',conclusion:'failure',event:'pull_request'}]};else if(u.includes('/actions/workflows/'))data={workflow_runs:[]};else if(u.includes('/pulls?state=closed'))data=[{number:2,state:'closed',merged_at:'2026-10-29T10:08:44Z',merge_commit_sha:'084e5978246a16c06099f8521fd9588f850cb87b'}];else if(u.includes('/issues?'))data=[{number:3,title:'[装扮自动化] 检查异常 #40841712027',state:'open',user:{login:'github-actions[bot]'}},{number:12,title:'[装扮自动化] 上线等待 #2',state:'open',user:{login:'github-actions[bot]'}}];return new Response(JSON.stringify(data),{status:200})}`)
  const run=spawnSync(process.execPath,['--import',pathToFileURL(fixture).href,'scripts/monitor-checks.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_TOKEN:'fixture',GITHUB_REPOSITORY:'kourou25/meme-hall-skins'}})
  assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/CLOSED:3:closed/);assert.match(run.stdout,/CLOSED:12:closed/);assert.doesNotMatch(run.stdout,/:open/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
