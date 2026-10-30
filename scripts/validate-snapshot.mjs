import {lstat,readFile,readdir} from 'node:fs/promises'
import {resolve,relative,sep,extname} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {checkChanges} from './community-catalog.mjs'

const allowedExtensions=new Set(['.js','.mjs','.css','.html','.json','.svg','.png','.webp','.jpg','.jpeg','.gif','.md','.txt'])
export async function validateSnapshot(root,changed=[],options={}){
 root=resolve(root)
 for(const name of ['preview.html','preview.js','serve.mjs','public/title-collection.js','public/title-visuals.js']){
  const file=resolve(root,name),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error(`必要文件不可用：${name}`)
 }
 const problems=[]
 if(!options.trusted){await checkChanges(root,changed,options.actor,options.base);return {changed:changed.length,passed:true}}
 for(const name of changed){
  if(!name||name.includes('\0')||name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')){problems.push(`路径无效：${JSON.stringify(name)}`);continue}
  const file=resolve(root,name),rel=relative(root,file)
  if(rel.startsWith('..'+sep)||rel==='..'){problems.push(`路径越界：${name}`);continue}
  // Infrastructure changes must be made by a maintainer separately; a skin
  // submission cannot redefine the trusted checks or deployment workflow.
  if(!options.trusted&&(name.startsWith('.github/')||name.startsWith('scripts/')||name.startsWith('tests/'))){problems.push(`请将自动化配置调整单独提交：${name}`);continue}
  let target=root,missing=false
  for(const part of name.split('/')){target=resolve(target,part);try{const info=await lstat(target);if(info.isSymbolicLink()){problems.push(`不支持符号链接：${name}`);missing=true;break}}catch(e){if(e.code==='ENOENT'){missing=true;break}throw e}}
  if(missing)continue // Deleted files are allowed; required files checked above.
  const st=await lstat(file);if(!st.isFile()){problems.push(`不是普通文件：${name}`);continue}
  if(!allowedExtensions.has(extname(name).toLowerCase())&&name!=='LICENSE'&&name!=='.gitattributes'&&!(options.trusted&&(name.startsWith('.github/')||name==='.gitignore'))){problems.push(`不支持的文件类型：${name}`);continue}
  if(st.size>25*1024*1024){problems.push(`单文件超过静态资源25 MiB上限：${name}`);continue}
  if(['.js','.mjs'].includes(extname(name).toLowerCase())){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:15000});if(result.status!==0)problems.push(`JavaScript 语法错误：${name}`)}
 }
 if(problems.length)throw Error(problems.join('\n'))
 return {changed:changed.length,passed:true}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(process.argv[2]||'.'),base=process.argv[3],head=process.argv[4]||'HEAD'
 if(!base)throw Error('需要提供基线提交')
 const diff=spawnSync('git',['-C',root,'diff','--no-renames','--name-only','-z',base,head],{encoding:'utf8',timeout:30000})
 if(diff.status!==0)throw Error('无法读取提交差异：'+diff.stderr)
 const changed=diff.stdout.split('\0').filter(Boolean)
 console.log(JSON.stringify(await validateSnapshot(root,changed,{trusted:process.argv[5]==='--trusted',actor:process.env.SUBMISSION_AUTHOR,base})))
}
