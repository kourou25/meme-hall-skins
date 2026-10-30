import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const delayedMs=15*60*1000
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
export async function reconcile({run,issues,create,update,close,now=Date.now()}){
 const title=issueTitle(run.id),existing=issues.find(x=>x.title===title),reason=assessment(run,now)
 if(!reason){if(existing&&run.status==='completed'&&run.conclusion==='success')await close(existing.number);return}
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
 const runs=input?[await request('/actions/runs/'+Number(input))]:(await Promise.all(['check-skins.yml','auto-merge-submission.yml','publish-catalog.yml'].map(x=>request('/actions/workflows/'+x+'/runs?per_page=30')))).flatMap(x=>x.workflow_runs)
 for(const run of runs)await reconcile({run,issues:issues.filter(x=>x.state==='open'),create:async(title,body)=>{const prior=issues.find(x=>x.title===title);if(prior)return;const issue=await request('/issues','POST',{title,body,assignees:['kourou25']});issues.push(issue)},update:(n,body)=>request('/issues/'+n,'PATCH',{body}),close:n=>request('/issues/'+n,'PATCH',{state:'closed'})})
 if(!input){
  const prs=[...await request('/pulls?state=open&per_page=30'),...await request('/pulls?state=closed&sort=updated&direction=desc&per_page=30')]
  let published='';try{const r=await fetch('https://52dmeme.com/api/community-skins/status',{signal:AbortSignal.timeout(5000)});const data=await r.json();if(r.ok&&/^[a-f0-9]{40}$/.test(data.source))published=data.source}catch{}
  for(const pr of prs){
   const old=issues.find(x=>x.state==='open'&&x.title===`[装扮自动化] 合并等待 #${pr.number}`)
   if(old&&(pr.state!=='open'||pr.draft)){await request('/issues/'+old.number,'PATCH',{state:'closed'});old.state='closed'}
   let confirmed=false;if(pr.merged_at&&published&&/^[a-f0-9]{40}$/.test(pr.merge_commit_sha||'')){try{const diff=await request(`/compare/${pr.merge_commit_sha}...${published}`);confirmed=['identical','ahead'].includes(diff.status)}catch{}}
   const waiting=issues.find(x=>x.state==='open'&&x.title===`[装扮自动化] 上线等待 #${pr.number}`);if(confirmed&&waiting){await request('/issues/'+waiting.number,'PATCH',{state:'closed'});waiting.state='closed'}
   const alert=pullRequestAlert(pr,Date.now(),confirmed);if(!alert)continue
   const existing=issues.find(x=>x.title===alert.title)
   if(!existing){const issue=await request('/issues','POST',{...alert,assignees:['kourou25']});issues.push(issue)}else if(existing.state==='closed'){await request('/issues/'+existing.number,'PATCH',{state:'open',body:alert.body});existing.state='open';existing.body=alert.body}else if(existing.body!==alert.body)await request('/issues/'+existing.number,'PATCH',{body:alert.body})
  }
 }
 console.log(`已检查 ${runs.length} 条 GitHub 检查记录`)
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
