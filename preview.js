import {TITLE_COLLECTION,titleStage} from '/title-collection.js'
import {PERSONAL_TITLES} from '/personal-catalog.js'
import {PERSONAL_V2_TITLES} from '/personal-v2-catalog.js'
import {titleVisualClass,attachTitleMotion} from '/title-visuals.js'
const byId=id=>document.getElementById(id),family=byId('family'),search=byId('search'),level=byId('level'),cards=byId('cards')
const presets=['laowu','cloud','candy','neon','paper','ink','pixel','sakura','gold','night','jelly','puff','paw','galaxy','bit','petal','boba','cyber','prism','mint','bunny','lemon','yinlu','aurora'].map(id=>({id,name:id==='aurora'?'极光流转':id}))
const officials=['serene','gentleman','coder','banana','peach','oracle','whale','diver','reborn'].map(id=>({id,name:id}))
const personal=Object.entries({...PERSONAL_TITLES,...PERSONAL_V2_TITLES}).map(([id,x])=>({id,...x}))
const growth=['guess','luck_king','luck_last','rank_guess_winrate','resource_respect'].flatMap(series=>[1,2,3,4,5].map(level=>({id:series+'-'+level,name:series+' Lv'+level,series,level})))
const groups={raffle:[...TITLE_COLLECTION,{id:'oldfarmer',name:'老农民'}],preset:presets,official:officials,personal,growth};let page=0
function draw(){
 const list=groups[family.value].filter(x=>(x.id+' '+x.name).toLowerCase().includes(search.value.trim().toLowerCase())),pages=Math.max(1,Math.ceil(list.length/24));page=Math.max(0,Math.min(page,pages-1));cards.replaceChildren()
 for(const item of list.slice(page*24,page*24+24)){
  const box=document.createElement('article'),heading=document.createElement('h2'),bubble=document.createElement('div'),copy=document.createElement('span');box.className='sample';heading.textContent=item.name+' · '+item.id;copy.className='rt-copy';copy.textContent='每次相遇，都留有光芒。支持彩色表情 😀 与换行。'
  const n=Number(level.value)
  bubble.className='cm-text '+(family.value==='raffle'?'ot-bubble rt-bubble '+titleVisualClass(item.id,titleStage(n)):family.value==='preset'?'bb bb-'+item.id:family.value==='official'?'ot-bubble ot-'+item.id:family.value==='growth'?'guess-frame gr-'+item.level+' guess-bubble '+(item.series.startsWith('luck_')?'luck-frame '+item.series:item.series.startsWith('rank_')?'luck-frame rank-frame '+item.series+' rank-all':item.series):'pt-bubble pt-'+item.id+(item.art==='v2'?' pt-v2':''))
  if(item.id==='claude')bubble.dataset.sgLevel=String(n);bubble.append(copy);if(bubble.classList.contains('rt-bubble'))attachTitleMotion(bubble);box.append(heading,bubble);cards.append(box)
 }
 byId('position').textContent=`${page+1} / ${pages} · ${list.length} 款`;byId('prev').disabled=page===0;byId('next').disabled=page===pages-1
}
family.onchange=()=>{page=0;draw()};search.oninput=()=>{page=0;draw()};level.onchange=draw;byId('prev').onclick=()=>{page--;draw()};byId('next').onclick=()=>{page++;draw()};byId('theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'};draw()
