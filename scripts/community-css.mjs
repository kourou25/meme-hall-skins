import postcss from 'postcss'

const kinds=new Set(['bubble','title','badge','reply'])
const unsafeProperty=/^(?:behavior|-moz-binding|cursor|pointer-events|user-select|content-visibility|contain|all)$/i
const unsafeValue=/(?:javascript\s*:|expression\s*\(|@import|image-set\s*\(|element\s*\(|-moz-binding|behavior\s*:)/i
function validSvg(value){
 let svg;try{svg=decodeURIComponent(value)}catch{throw Error('SVG 编码无效')}
 if(svg.length>24576||/[&]|<!|<\?|\bon\w+\s*=|\bhref\s*=|<\s*(?:script|style|image|foreignObject|animate|set)\b/i.test(svg)||!/^\s*<svg\b/i.test(svg)||!/<\/svg>\s*$/i.test(svg))throw Error('SVG 包含不支持的内容')
 const tags=new Set(['svg','defs','linearGradient','radialGradient','stop','circle','path','polygon','ellipse','rect','g','line','polyline'])
 const attrs=new Set(['xmlns','viewBox','width','height','id','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','offset','stop-color','stop-opacity','fill','fill-opacity','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','opacity','points','d','transform'])
 const remainder=svg.replace(/<\/?([A-Za-z][A-Za-z0-9]*)([^<>]*?)\s*\/?>/g,(all,tag,raw)=>{
  if(!tags.has(tag))throw Error('SVG 元素不受支持')
  const left=raw.replace(/\s+([A-Za-z][A-Za-z0-9:-]*)\s*=\s*(['"])(.*?)\2/g,(_,name,q,v)=>{
   if(!attrs.has(name)||/[<>\\&]/.test(v)||/https?:|data:|javascript:/i.test(v)&&!(name==='xmlns'&&v==='http://www.w3.org/2000/svg'))throw Error('SVG 属性不受支持')
   if(/url\s*\(/i.test(v)&&!/^url\(#[A-Za-z][A-Za-z0-9_-]*\)$/.test(v))throw Error('SVG 引用不受支持')
   return ''
  })
  if(left.trim())throw Error('SVG 格式无效')
  return ''
 })
 if(remainder.trim())throw Error('SVG 内容不受支持')
}
function validateUrls(value){
 const re=/url\s*\(/ig;let match
 while((match=re.exec(value))){
  let i=re.lastIndex;while(/\s/.test(value[i]||''))i++
  const q=value[i];if(q!=='"'&&q!=="'")throw Error('CSS 资源须使用引号')
  const end=value.indexOf(q,i+1);if(end<0)throw Error('CSS 资源格式无效')
  const uri=value.slice(i+1,end);let j=end+1;while(/\s/.test(value[j]||''))j++;if(value[j]!==')')throw Error('CSS 资源格式无效')
  if(/^data:image\/svg\+xml,/i.test(uri))validSvg(uri.slice(uri.indexOf(',')+1))
  else if(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(uri)||uri.length>32768)throw Error('CSS 不允许外部资源')
  re.lastIndex=j+1
 }
}
function scopeSelector(selector,kind,id){
 let text=selector.trim(),dark=''
 const theme=text.match(/^\[data-theme\s*=\s*['"]?(dark|light)['"]?\]\s+/i)
 if(theme){dark=`[data-theme="${theme[1].toLowerCase()}"] `;text=text.slice(theme[0].length)}
 const pseudo=text.match(/::?(before|after)$/i)?.[1]?.toLowerCase()||''
 if(pseudo)text=text.replace(/::?(before|after)$/i,'')
 if(!/^(?::scope|(?:\.[a-zA-Z_][\w-]*)+|:is\((?:\s*(?:\.[a-zA-Z_][\w-]*)+\s*,?)+\))$/.test(text))throw Error('CSS 选择器只能作用于本装扮及其前后装饰')
 return {value:dark+`.cskin-${kind}-${id}`+(pseudo?'::'+pseudo:''),pseudo}
}
export function compileCommunityCss(input,id,kind){
 if(!kinds.has(kind)||!/^[a-z0-9][a-z0-9-]{2,47}$/.test(id)||typeof input!=='string'||input.length>32768||/[\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)||/<\/style/i.test(input))throw Error('CSS 内容无效或过大')
 let root;try{root=postcss.parse(input,{from:undefined})}catch{throw Error('CSS 语法无效')}
 const prefix=`skin-${id}-${kind}-`,animations=new Map(),custom=new Map();let rules=0,declarations=0
 root.walkComments(n=>n.remove())
 root.walkAtRules(at=>{
  const name=at.name.toLowerCase()
  if(name==='keyframes'){if(!/^[a-zA-Z_][\w-]{0,63}$/.test(at.params))throw Error('动画名称无效');animations.set(at.params,prefix+at.params)}
  else if(name==='property'){if(!/^--[a-zA-Z_][\w-]{0,63}$/.test(at.params))throw Error('CSS 变量名称无效');custom.set(at.params,'--'+prefix+at.params.slice(2))}
  else if(name==='media'){if(!/^\s*\((?:prefers-reduced-motion|prefers-color-scheme)\s*:\s*(?:reduce|no-preference|dark|light)\)\s*$/i.test(at.params))throw Error('CSS 媒体条件不受支持')}
  else throw Error('CSS 指令不受支持')
 })
 root.walkRules(rule=>{
  if(++rules>100)throw Error('CSS 规则过多')
  if(rule.parent?.type==='atrule'&&rule.parent.name.toLowerCase()==='keyframes'){
   if(!postcss.list.comma(rule.selector).every(x=>/^(?:from|to|(?:100|\d{1,2})(?:\.\d+)?%)$/i.test(x.trim())))throw Error('动画帧无效')
   return
  }
  const sels=postcss.list.comma(rule.selector).map(s=>scopeSelector(s,kind,id));rule.selector=sels.map(x=>x.value).join(', ')
  rule._communityPseudo=sels.every(x=>!!x.pseudo)
 })
 root.walkDecls(decl=>{
  if(++declarations>500)throw Error('CSS 属性过多')
  if(unsafeProperty.test(decl.prop)||unsafeValue.test(decl.value)||/\b(?:fixed|sticky)\b/i.test(decl.value))throw Error('CSS 属性或值不受支持')
  if(decl.prop.toLowerCase()==='position'&&decl.value.trim().toLowerCase()==='absolute'&&!decl.parent?._communityPseudo)throw Error('绝对定位仅可用于装饰')
  if(decl.prop.toLowerCase()==='z-index'&&(!/^\d+$/.test(decl.value.trim())||Number(decl.value)>3))throw Error('CSS 层级超出范围')
  validateUrls(decl.value)
  decl.prop=decl.prop.replace(/--[a-zA-Z_][\w-]*/g,x=>custom.get(x)||'--'+prefix+x.slice(2))
  decl.value=decl.value.replace(/--[a-zA-Z_][\w-]*/g,x=>custom.get(x)||'--'+prefix+x.slice(2))
  if(/^animation(?:-name)?$/i.test(decl.prop))for(const [from,to] of animations)decl.value=decl.value.replace(new RegExp(`(?<![\\w-])${from}(?![\\w-])`,'g'),to)
 })
 root.walkAtRules(at=>{if(at.name.toLowerCase()==='keyframes')at.params=animations.get(at.params);else if(at.name.toLowerCase()==='property')at.params=custom.get(at.params)})
 return root.toString()
}
