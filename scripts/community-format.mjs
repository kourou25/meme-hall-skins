// Shared, runtime-independent rules. Values from submissions are data only.
const keys=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))throw Error('配置字段无效')}
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||[...value].length>max||/[<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value))throw Error('文字字段无效');return value.trim()}
export function checkManifest(raw,id){
 keys(raw,['schemaVersion','id','name','author','github','license','permission','components'])
 if(raw.schemaVersion!==1||typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{2,47}$/.test(id)||raw.id!==id||raw.permission!==true)throw Error('套装编号或授权声明无效')
 const name=text(raw.name,24),author=text(raw.author,24),license=text(raw.license,100)
 if(typeof raw.github!=='string'||!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(raw.github))throw Error('作者 GitHub 用户名无效')
 keys(raw.components,['bubble','title','badge','reply']);const components={}
 for(const [kind,v] of Object.entries(raw.components)){
  keys(v,['file','slice','style']);if(typeof v.file!=='string'||!new RegExp(`^assets/${kind}\\.(png|jpg|webp|css)$`).test(v.file))throw Error('素材路径无效')
  if(v.style!==undefined&&(v.file.endsWith('.css')||v.style!==`assets/${kind}.css`))throw Error('样式路径无效')
  if(v.slice!==undefined&&(v.file.endsWith('.css')||!['bubble','title','reply'].includes(kind)||!Array.isArray(v.slice)||v.slice.length!==4||v.slice.some(x=>!Number.isInteger(x)||x<0||x>64)))throw Error('边框切片无效')
  components[kind]={file:v.file,...(v.slice?{slice:[...v.slice]}:{}),...(v.style?{style:v.style}:{})}
 }
 if(!Object.keys(components).length)throw Error('至少需要一项装扮')
 return {schemaVersion:1,id,name,author,github:raw.github.toLowerCase(),license,permission:true,components}
}
export function inspectImage(input,ext){
 const b=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(b.buffer,b.byteOffset,b.byteLength),ascii=(at,n)=>String.fromCharCode(...b.subarray(at,at+n))
 if(b.length<20||b.length>4*1024*1024)throw Error('图片大小无效')
 let width=0,height=0,type=''
 if(ext==='png'&&ascii(0,8)==='\x89PNG\r\n\x1a\n'){
  if(b.length<33||view.getUint32(8)!==13||ascii(12,4)!=='IHDR')throw Error('PNG 头无效')
  width=view.getUint32(16);height=view.getUint32(20);type='image/png';let pos=8,ended=false
  while(pos+12<=b.length){const len=view.getUint32(pos),name=ascii(pos+4,4);if(len>b.length-pos-12)throw Error('PNG 分块无效');if(name==='acTL'||name==='fcTL'||name==='fdAT')throw Error('不支持动画图片');pos+=12+len;if(name==='IEND'){ended=true;break}}
  if(!ended||pos!==b.length)throw Error('PNG 结尾无效')
 }else if(ext==='jpg'&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217){
  type='image/jpeg';let p=2,frames=0
  while(p+4<b.length){if(b[p++]!==255)throw Error('JPEG 结构无效');while(b[p]===255)p++;const marker=b[p++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;const len=view.getUint16(p);if(len<2||p+len>b.length)throw Error('JPEG 分块无效');if([0xc0,0xc1,0xc2].includes(marker)){if(len<8||++frames>1)throw Error('JPEG 帧无效');height=view.getUint16(p+3);width=view.getUint16(p+5)}p+=len}
  if(!frames)throw Error('JPEG 缺少尺寸')
 }else if(ext==='webp'&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'&&view.getUint32(4,true)+8===b.length){
  type='image/webp';let p=12
  while(p+8<=b.length){const name=ascii(p,4),len=view.getUint32(p+4,true),start=p+8;if(len>b.length-start)throw Error('WebP 分块无效');if(name==='ANIM'||name==='ANMF')throw Error('不支持动画图片')
   if(name==='VP8X'){if(len<10||b[start]&2)throw Error('不支持动画图片');width=1+b[start+4]+(b[start+5]<<8)+(b[start+6]<<16);height=1+b[start+7]+(b[start+8]<<8)+(b[start+9]<<16)}
   else if(name==='VP8 '&&!width){if(len<10||b[start+3]!==0x9d||b[start+4]!==1||b[start+5]!==0x2a)throw Error('WebP 帧无效');width=view.getUint16(start+6,true)&0x3fff;height=view.getUint16(start+8,true)&0x3fff}
   else if(name==='VP8L'&&!width){if(len<5||b[start]!==0x2f)throw Error('WebP 帧无效');const bits=view.getUint32(start+1,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1}
   p=start+len+(len&1)
  }
  if(p!==b.length)throw Error('WebP 结尾无效')
 }else throw Error('图片类型与内容不一致')
 if(!width||!height||width>2048||height>2048||width*height>4194304)throw Error('图片尺寸超限')
 return {type,width,height}
}
