import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// 同一 head 重跑只恢复目录发布；绝不合并未核验的新 head。
export async function mergeAndPublish({number,sha,request,wait=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now()}){
 if(!Number.isSafeInteger(number)||number<1||!/^[a-f0-9]{40}$/.test(sha||''))throw Error('合并参数无效')
 const read=async()=>{
  const pr=await request(`/pulls/${number}`,'GET')
  if(pr.head?.sha!==sha||pr.base?.ref!=='main')throw Error('投稿版本或目标分支已变化')
  return pr
 }
 let pr=await read()
 if(pr.state==='open'&&!pr.draft){
  for(let attempt=0;attempt<4;attempt++){
   try{const merged=await request(`/pulls/${number}/merge`,'PUT',{sha,merge_method:'squash'});if(!merged.merged)throw Error('投稿未合并');break}
   catch(error){
    pr=await read()
    if(pr.state==='closed'&&pr.merged===true&&pr.merged_at)break
    if(pr.state!=='open'||pr.draft||attempt===3)throw error
    await wait(1500*(attempt+1))
   }
  }
 }else if(!(pr.state==='closed'&&pr.merged===true&&pr.merged_at))throw Error('投稿未合并或仍为草稿')
 const start=clock()
 for(let attempt=0;attempt<3;attempt++){
  try{await request('/actions/workflows/publish-catalog.yml/dispatches','POST',{ref:'main'});return {number,published:true}}
  catch(error){
   // 超时可能已成功派发；先查新任务，避免对同一笔请求重复发起。
   try{const data=await request('/actions/workflows/publish-catalog.yml/runs?event=workflow_dispatch&per_page=10','GET');if((data.workflow_runs||[]).some(r=>Date.parse(r.created_at)>=start-2000&&r.head_branch==='main'))return {number,published:true,recovered:true}}catch{}
   if(attempt===2)throw error
   await wait(1500*(attempt+1))
  }
 }
 throw Error('目录发布未启动')
}
async function main(){
 const token=process.env.GITHUB_TOKEN,repo=process.env.GITHUB_REPOSITORY,number=Number(process.env.PR_NUMBER),sha=process.env.HEAD_SHA
 if(!token||repo!=='kourou25/meme-hall-skins')throw Error('缺少本仓库合并权限')
 const request=async(path,method,body)=>{const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const result=await r.json().catch(()=>({}));if(!r.ok)throw Error(`GitHub 操作失败 ${r.status}：${path}`);return result}
 await mergeAndPublish({number,sha,request});console.log(`投稿 #${number} 已合并，目录发布已启动`)
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
