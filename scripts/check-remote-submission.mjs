import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {readSubmission} from './community-catalog.mjs'
import {checkManifest} from './community-format.mjs'

const pathPattern=/^submissions\/([a-z0-9][a-z0-9-]{2,47})\/(manifest\.json|assets\/(?:bubble|title|badge|reply)\.(?:png|jpg|webp))$/
export function submissionId(files){
 if(!Array.isArray(files)||!files.length||files.length>10)throw Error('投稿文件数量无效')
 const ids=new Set()
 for(const item of files){const m=pathPattern.exec(item.filename||'');if(!m||item.status==='renamed')throw Error('投稿仅允许固定目录的配置和图片：'+item.filename);ids.add(m[1])}
 if(ids.size!==1)throw Error('一次投稿只能修改一个套装')
 return [...ids][0]
}
export async function checkRemote({repo,number,head,request,raw}){
 if(repo!=='kourou25/meme-hall-skins'||!Number.isSafeInteger(number)||number<1||!/^[a-f0-9]{40}$/.test(head||''))throw Error('投稿参数无效')
 const pr=await request(`/repos/${repo}/pulls/${number}`),actor=pr.user?.login,source=pr.head?.repo?.full_name,base=pr.base?.sha
 if(pr.state!=='open'||pr.draft||pr.head?.sha!==head||!/^[a-f0-9]{40}$/.test(base||'')||!actor||!/^[-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+$/.test(source||''))throw Error('投稿状态或版本已变化')
 const id=submissionId(await request(`/repos/${repo}/pulls/${number}/files?per_page=100`))
 const tree=async(r,sha)=>{const data=await request(`/repos/${r}/git/trees/${sha}`);if(data.truncated||!Array.isArray(data.tree))throw Error('素材目录不可完整读取');return data.tree}
 const folder=async(r,commit)=>{const data=await request(`/repos/${r}/git/commits/${commit}`);if(!/^[a-f0-9]{40}$/.test(data.tree?.sha||''))throw Error('提交目录无效');const root=await tree(r,data.tree.sha),s=root.find(x=>x.path==='submissions');if(!s)return null;if(s.type!=='tree'||s.mode!=='040000')throw Error('投稿目录类型无效');const dirs=await tree(r,s.sha),entry=dirs.find(x=>x.path===id);if(!entry)return null;if(entry.type!=='tree'||entry.mode!=='040000')throw Error('套装目录类型无效');return tree(r,entry.sha)}
 const baseFolder=await folder(repo,base)
 if(baseFolder){const prior=baseFolder.find(x=>x.path==='manifest.json');if(!prior||prior.type!=='blob'||prior.mode!=='100644'||prior.size>8192)throw Error('原有套装配置不可用');const value=await raw(`/repos/${repo}/git/blobs/${prior.sha}`,8192),manifest=checkManifest(JSON.parse(new TextDecoder().decode(value)),id);if(manifest.github!==actor.toLowerCase())throw Error('不能修改其他作者的套装')}
 const current=await folder(source,head);if(!current)throw Error('投稿目录不存在')
 if(current.some(x=>!['manifest.json','assets'].includes(x.path)))throw Error('套装目录包含未许可文件')
 const manifest=current.find(x=>x.path==='manifest.json'),assets=current.find(x=>x.path==='assets')
 if(!manifest||manifest.type!=='blob'||manifest.mode!=='100644'||manifest.size>8192||!assets||assets.type!=='tree'||assets.mode!=='040000')throw Error('投稿目录结构无效')
 const pictures=await tree(source,assets.sha);if(pictures.length>4||pictures.some(x=>x.type!=='blob'||x.mode!=='100644'||! /^(bubble|title|badge|reply)\.(png|jpg|webp)$/.test(x.path)||x.size>4*1024*1024))throw Error('素材文件无效')
 const temp=await mkdtemp(join(tmpdir(),'community-submission-'))
 try{
  const dir=join(temp,'submissions',id);await mkdir(join(dir,'assets'),{recursive:true})
  await writeFile(join(dir,'manifest.json'),await raw(`/repos/${source}/git/blobs/${manifest.sha}`,8192))
  for(const pic of pictures)await writeFile(join(dir,'assets',pic.path),await raw(`/repos/${source}/git/blobs/${pic.sha}`,4*1024*1024))
  const checked=await readSubmission(temp,id);if(checked.github!==actor.toLowerCase())throw Error('投稿作者必须与 GitHub 账号一致')
  return {id,head,base,author:actor}
 }finally{await rm(temp,{recursive:true,force:true})}
}
async function main(){
 const token=process.env.GITHUB_TOKEN,repo=process.env.GITHUB_REPOSITORY,number=Number(process.env.PR_NUMBER),head=process.env.HEAD_SHA;if(!token)throw Error('缺少检查权限')
 const call=async(path,accept,limit)=>{const r=await fetch('https://api.github.com'+path,{headers:{authorization:'Bearer '+token,accept,'x-github-api-version':'2022-11-28'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('GitHub 读取失败 '+r.status);if(!limit)return r.json();const size=Number(r.headers.get('content-length')||0);if(size>limit)throw Error('素材过大');const b=new Uint8Array(await r.arrayBuffer());if(b.length>limit)throw Error('素材过大');return b}
 const result=await checkRemote({repo,number,head,request:p=>call(p,'application/vnd.github+json'),raw:(p,n)=>call(p,'application/vnd.github.raw+json',n)})
 console.log(JSON.stringify(result))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
