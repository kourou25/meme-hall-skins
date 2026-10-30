import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {recoverCatalog} from './recover-catalog.mjs'

const delayedMs=15*60*1000
// 已逐项审查并由主站发布的投稿；仅确认精确合并版本。
const reviewedMerges=new Map([[2,'084e5978246a16c06099f8521fd9588f850cb87b'],[6,'1969e637178b91188673b4b6050c7639ee466ee6'],[13,'3e4c6dd6dafa2dc88d8c85ad27898aefa1597ab0']])
const reviewedRuns=new Set([40841712027,40841715092,40846329497,40850491966,40846332927,40850489775,40995935988,40995938150])
export function reviewedReleaseConfirmed(pr){return pr?.state==='closed'&&!!pr.merged_at&&reviewedMerges.get(pr.number)===pr.merge_commit_sha}
export function reviewedRunSettled(run){return run?.status==='completed'&&reviewedRuns.has(Number(run.id))}
export function findRunPullRequest(run,prs){
 if(!['pull_request','pull_request_target'].includes(run.event))return undefined
 const exact=prs.filter(p=>run.head_sha&&p.head?.sha===run.head_sha);if(exact.length===1)return exact[0]
 const repo=run.head_repository?.full_name,branch=run.head_branch
 if(!repo||!branch)return undefined
 const matching=prs.filter(p=>p.head?.repo?.full_name===repo&&p.head?.ref===branch);return matching.length===1?matching[0]:undefined
}
export function assessment(run,now=Date.now()){
 if(!run||!Number.isSafeInteger(Number(run.id)))throw Error('运行记录无效')
 const pending=['queued','in_progress','waiting','pending','requested'].includes(run.status)
 if(pending&&Number.isFinite(Date.parse(run.created_at))&&now-Date.parse(run.created_at)>=delayedMs)return '检查超过15分钟仍未完成'
 if(run.status==='completed'&&['failure','timed_out','cancelled','action_required','startup_failure'].includes(run.conclusion))return '检查未通过或被中断'
 return null
}
export function issueTitle(id){return `[装扮自动化] 检查异常 #${Number(id)}`}
export function pullRequestAlert(pr,now=Date.now(),published=false){
 if(!pr||!Number.isSafeInteger(Number(pr.number))||pr.draft)return null
 const merged=pr.state==='closed'&&pr.merged_at,at=merged?pr.merged_at:pr.updated_at
 if(!Number.isFinite(Date.parse(at))||now-Date.parse(at)<delayedMs)return null
 if(pr.state==='open')return {title:`[装扮自动化] 合并等待 #${pr.number}`,body:`合并请求已等待超过15分钟，尚未合并，请检查自动合并记录。\n\n[查看合并请求](https://github.com/kourou25/meme-hall-skins/pull/${pr.number})\n`}
 if(merged&&!published)return {title:`[装扮自动化] 上线等待 #${pr.number}`,body:`合并请求已合并，但网站尚未确认该版本，请检查目录发布记录。\n\n[查看合并请求](https://github.com/kourou25/meme-hall-skins/pull/${pr.number})\n`}
 return null
}
export async function reconcile({run,pr,issues,create,update,close,now=Date.now()}){
 const title=issueTitle(pr?.number||run.id),existing=issues.find(x=>x.title===title),reason=assessment(run,now)
 if(reviewedRunSettled(run)){if(existing)await close(existing.number);return}
 if(pr?.state==='closed'){if(existing)await close(existing.number);return}
 if(!reason){if(!pr&&existing&&run.status==='completed'&&run.conclusion==='success')await close(existing.number);return}
 const url=`https://github.com/kourou25/meme-hall-skins/actions/runs/${Number(run.id)}`
 const body=`${reason}。\n\n请查看 [GitHub 运行记录](${url})；检查通过后仍需等待网站确认发布。\n\n运行编号：${Number(run.id)}\n`
 if(existing){if(existing.body!==body)await update(existing.number,body)}else await create(title,body)
}
async function main(){
 const token=process.env.GITHUB_TOKEN,repo=process.env.GITHUB_REPOSITORY
 if(!token||repo!=='kourou25/meme-hall-skins')throw Error('缺少本仓库监控权限')
 const request=async(path,method='GET',body)=>{const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(`GitHub 请求失败 ${r.status}：${path}`);return r.status===204?null:r.json()}
 if(process.env.MONITOR_SELF_TEST==='true'){
  const issue=await request('/issues','POST',{title:'[装扮自动化自检] 提醒权限验证',body:'这是自动创建并关闭的测试记录，不是实际故障。',assignees:['kourou25']})
  try{const found=await request('/issues/'+issue.number);if(!found.assignees?.some(x=>x.login==='kourou25'))throw Error('测试提醒没有指派站长')}
  finally{await request('/issues/'+issue.number,'PATCH',{state:'closed'})}
  console.log(`提醒自检完成：${issue.html_url}`);return
 }
 const issues=(await request('/issues?state=all&per_page=100')).filter(x=>!x.pull_request&&x.user?.login==='github-actions[bot]')
 const input=process.env.WATCH_RUN_ID
 const prs=[...await request('/pulls?state=open&per_page=30'),...await request('/pulls?state=closed&sort=updated&direction=desc&per_page=30')]
 const workflowRuns=input?null:await Promise.all(['check-skins.yml','auto-merge-submission.yml','publish-catalog.yml'].map(x=>request('/actions/workflows/'+x+'/runs?per_page=30')))
 const runs=input?[await request('/actions/runs/'+Number(input))]:workflowRuns.flatMap(x=>x.workflow_runs)
 const handled=new Set();runs.sort((a,b)=>Number(!!assessment(b))-Number(!!assessment(a))||Date.parse(b.created_at||0)-Date.parse(a.created_at||0))
 for(const run of runs){const pr=reviewedRunSettled(run)?undefined:findRunPullRequest(run,prs);if(pr&&handled.has(pr.number))continue;if(pr)handled.add(pr.number);await reconcile({run,pr,issues:issues.filter(x=>x.state==='open'),create:async(title,body)=>{const prior=issues.find(x=>x.title===title);if(prior){if(pr&&prior.state==='closed'){await request('/issues/'+prior.number,'PATCH',{state:'open',body});prior.state='open';prior.body=body}return}const issue=await request('/issues','POST',{title,body,assignees:['kourou25']});issues.push(issue)},update:async(n,body)=>{await request('/issues/'+n,'PATCH',{body});const issue=issues.find(x=>x.number===n);if(issue)issue.body=body},close:async n=>{await request('/issues/'+n,'PATCH',{state:'closed'});const issue=issues.find(x=>x.number===n);if(issue)issue.state='closed'}})}
 if(!input){
  try{const recovery=await recoverCatalog({prs,runs:workflowRuns[2].workflow_runs,request});if(recovery.dispatched)console.log(`已恢复投稿 #${recovery.number} 的目录发布`)}catch(error){console.error('目录发布恢复失败：',error.message)}
  let published='';try{const r=await fetch('https://52dmeme.com/api/community-skins/status',{signal:AbortSignal.timeout(5000)});const data=await r.json();if(r.ok&&/^[a-f0-9]{40}$/.test(data.source))published=data.source}catch{}
  for(const pr of prs){
   const old=issues.find(x=>x.state==='open'&&x.title===`[装扮自动化] 合并等待 #${pr.number}`)
   const hasError=issues.some(x=>x.state==='open'&&x.title===issueTitle(pr.number))
   if(old&&(pr.state!=='open'||pr.draft||hasError)){await request('/issues/'+old.number,'PATCH',{state:'closed'});old.state='closed'}
   let confirmed=reviewedReleaseConfirmed(pr);if(!confirmed&&pr.merged_at&&published&&/^[a-f0-9]{40}$/.test(pr.merge_commit_sha||'')){try{const diff=await request(`/compare/${pr.merge_commit_sha}...${published}`);confirmed=['identical','ahead'].includes(diff.status)}catch{}}
   const waiting=issues.find(x=>x.state==='open'&&x.title===`[装扮自动化] 上线等待 #${pr.number}`);if(confirmed&&waiting){await request('/issues/'+waiting.number,'PATCH',{state:'closed'});waiting.state='closed'}
   const alert=pullRequestAlert(pr,Date.now(),confirmed);if(!alert||(pr.state==='open'&&hasError))continue
   const existing=issues.find(x=>x.title===alert.title)
   if(!existing){const issue=await request('/issues','POST',{...alert,assignees:['kourou25']});issues.push(issue)}else if(existing.state==='closed'){await request('/issues/'+existing.number,'PATCH',{state:'open',body:alert.body});existing.state='open';existing.body=alert.body}else if(existing.body!==alert.body)await request('/issues/'+existing.number,'PATCH',{body:alert.body})
  }
 }
 console.log(`已检查 ${runs.length} 条 GitHub 检查记录`)
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
