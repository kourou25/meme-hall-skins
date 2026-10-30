import {readFile,readdir,lstat,writeFile} from 'node:fs/promises'
import {resolve,join,relative,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {checkManifest,inspectImage} from './community-format.mjs'
import {compileCommunityCss} from './community-css.mjs'

const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
async function regular(root,path){const full=resolve(root,path),rel=relative(root,full);if(rel==='..'||rel.startsWith('..'+sep))throw Error('路径越界');let current=root;for(const p of rel.split(sep)){current=join(current,p);const s=await lstat(current);if(s.isSymbolicLink())throw Error('不支持符号链接')}const stat=await lstat(full);if(!stat.isFile()||stat.size>4*1024*1024)throw Error('文件不可用或过大');return readFile(full)}
export async function readSubmission(root,id){
 root=resolve(root);if(!/^[a-z0-9][a-z0-9-]{2,47}$/.test(id))throw Error('套装编号无效')
 const folder=`submissions/${id}`,raw=await regular(root,`${folder}/manifest.json`);if(raw.length>8192)throw Error('配置过大')
 const manifest=checkManifest(JSON.parse(raw.toString('utf8')),id),files=await readdir(join(root,folder,'assets'));let total=0
 const expected=Object.values(manifest.components).flatMap(x=>[x.file,...(x.style?[x.style]:[])]).map(x=>x.slice(7)).sort();if(JSON.stringify(files.sort())!==JSON.stringify(expected))throw Error('素材目录必须仅包含配置所用素材')
 const css=async(path,kind)=>{const b=await regular(root,`${folder}/${path}`);total+=b.length;if(!b.length||b.length>32768)throw Error('样式大小无效');const text=new TextDecoder('utf-8',{fatal:true}).decode(b);compileCommunityCss(text,id,kind);return {file:path,type:'text/css',bytes:b.length,sha256:digest(b)}}
 const components={};for(const [kind,spec] of Object.entries(manifest.components)){if(spec.file.endsWith('.css')){components[kind]=await css(spec.file,kind);continue}const bytes=await regular(root,`${folder}/${spec.file}`);total+=bytes.length;const ext=spec.file.split('.').at(-1),info=inspectImage(bytes,ext);if(spec.slice&&(spec.slice[0]+spec.slice[2]>=info.height||spec.slice[1]+spec.slice[3]>=info.width))throw Error('边框切片超过图片尺寸');components[kind]={...spec,...info,bytes:bytes.length,sha256:digest(bytes),...(spec.style?{style:await css(spec.style,kind)}:{})}}if(total>8*1024*1024)throw Error('套装总大小超过 8 MiB')
 return {...manifest,components}
}
export async function checkChanges(root,changed,actor,base){
 if(!changed.length)throw Error('投稿没有变化');const ids=new Set()
 for(const name of changed){const m=/^submissions\/([a-z0-9][a-z0-9-]{2,47})\/(manifest\.json|assets\/(?:bubble|title|badge|reply)\.(?:png|jpg|webp|css))$/.exec(name);if(!m)throw Error('投稿仅允许固定目录的配置和素材：'+name);ids.add(m[1])}
 if(ids.size!==1)throw Error('一次投稿只能修改一个套装');const id=[...ids][0],entry=await readSubmission(root,id)
 if(!actor||entry.github!==actor.toLowerCase())throw Error('投稿作者必须与 GitHub 账号一致')
 const commit=spawnSync('git',['-C',root,'cat-file','-e',`${base}^{commit}`],{timeout:10000});if(commit.status!==0)throw Error('投稿基准版本不可用');const tree=spawnSync('git',['-C',root,'ls-tree','--name-only',base,'--',`submissions/${id}`],{encoding:'utf8',timeout:10000});if(tree.status!==0)throw Error('无法核验原有套装');if(tree.stdout.trim()){const old=spawnSync('git',['-C',root,'show',`${base}:submissions/${id}/manifest.json`],{encoding:'utf8',timeout:10000});if(old.status!==0)throw Error('原有套装配置不可用');const prior=checkManifest(JSON.parse(old.stdout),id);if(prior.github!==entry.github)throw Error('不能修改其他作者的套装')}
 return entry
}
export async function buildCatalog(root,source){if(!/^[0-9a-f]{40}$/.test(source))throw Error('来源版本无效');let dirs=[];try{dirs=await readdir(join(root,'submissions'),{withFileTypes:true})}catch(e){if(e.code!=='ENOENT')throw e}if(dirs.length>200)throw Error('套装总数超过上限');const entries=[];for(const d of dirs.sort((a,b)=>a.name.localeCompare(b.name))){if(!d.isDirectory()||d.isSymbolicLink())throw Error('投稿目录无效');entries.push(await readSubmission(root,d.name))}let prior;try{prior=JSON.parse(await readFile(join(root,'catalog.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}if(prior?.source===source&&Number.isSafeInteger(prior.revision)&&prior.revision>0&&JSON.stringify(prior.entries)===JSON.stringify(entries))return prior;const revision=Number.isSafeInteger(prior?.revision)&&prior.revision>0?prior.revision+1:1;if(!Number.isSafeInteger(revision))throw Error('目录版本溢出');return {schemaVersion:1,revision,source,entries}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(process.argv[2]||'.'),source=process.argv[3],catalog=await buildCatalog(root,source);await writeFile(join(root,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');console.log(JSON.stringify({source,entries:catalog.entries.length}))
}
