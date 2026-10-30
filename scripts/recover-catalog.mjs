import {submissionId} from './check-remote-submission.mjs'
const cooldown=15*60*1000
// 仅恢复已合并的受控投稿；检查正在运行的发布和冷却时间，避免重复派发。
export async function recoverCatalog({prs,runs,request,now=Date.now()}){
 const pending=(runs||[]).some(r=>r.status!=='completed')
 if(pending)return {dispatched:false,reason:'发布进行中'}
 let catalog
 try{const data=await request('/contents/catalog.json?ref=main');if(data.encoding!=='base64'||typeof data.content!=='string')return {dispatched:false,reason:'目录不可用'};catalog=JSON.parse(Buffer.from(data.content,'base64').toString('utf8'))}catch{return {dispatched:false,reason:'目录不可用'}}
 if(!/^[a-f0-9]{40}$/.test(catalog.source||''))return {dispatched:false,reason:'目录版本无效'}
 const candidates=(prs||[]).filter(p=>p.state==='closed'&&p.merged_at&&/^[a-f0-9]{40}$/.test(p.merge_commit_sha||'')&&Number.isSafeInteger(p.number)&&now-Date.parse(p.merged_at)>=cooldown).sort((a,b)=>Date.parse(b.merged_at)-Date.parse(a.merged_at))
 for(const pr of candidates){
  let comparison,files
  try{comparison=await request(`/compare/${pr.merge_commit_sha}...${catalog.source}`);if(comparison.status!=='behind')continue;files=await request(`/pulls/${pr.number}/files?per_page=100`);submissionId(files)}catch{continue}
  const last=(runs||[]).filter(r=>Date.parse(r.created_at)>=Date.parse(pr.merged_at)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0]
  if(last&&now-Date.parse(last.created_at)<cooldown)return {dispatched:false,reason:'发布冷却中'}
  await request('/actions/workflows/publish-catalog.yml/dispatches','POST',{ref:'main'})
  return {dispatched:true,number:pr.number}
 }
 return {dispatched:false,reason:'目录已包含投稿'}
}
