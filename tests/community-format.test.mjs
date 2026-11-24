import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkManifest,inspectImage} from '../scripts/community-format.mjs'

const sample={schemaVersion:1,id:'sample-set',name:'晨光',author:'作者',github:'artist',license:'CC BY 4.0',permission:true,components:{bubble:{file:'assets/bubble.png',slice:[0,0,0,0]},badge:{file:'assets/badge.png'}}}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1EAAAAASUVORK5CYII=','base64')
test('四类受控配置通过，名称与作者保留',()=>{const out=checkManifest(sample,'sample-set');assert.equal(out.name,'晨光');assert.deepEqual(Object.keys(out.components),['bubble','badge']);assert.deepEqual(inspectImage(png,'png'),{type:'image/png',width:1,height:1})})
test('拒绝脚本、外链、越界切片和未授权素材',()=>{assert.throws(()=>checkManifest({...sample,js:'alert(1)'},'sample-set'));assert.throws(()=>checkManifest({...sample,permission:false},'sample-set'));assert.throws(()=>checkManifest({...sample,components:{bubble:{file:'https://example.com/a.png'}}},'sample-set'));assert.throws(()=>checkManifest({...sample,components:{bubble:{file:'assets/bubble.png',slice:[-1,0,0,0]}}},'sample-set'));assert.throws(()=>inspectImage(Buffer.from('<svg></svg>'),'png'))})
test('图片尺寸超限及动画标识不通过',()=>{const oversized=Buffer.from(png);oversized.writeUInt32BE(2049,16);assert.throws(()=>inspectImage(oversized,'png'));const animated=Buffer.concat([png.subarray(0,33),Buffer.from('000000086163544c000000010000000000000000','hex'),png.subarray(33)]);assert.throws(()=>inspectImage(animated,'png'))})
test('头像框作为第五类部件：允许图片和样式，不允许边框切片',()=>{
 const out=checkManifest({...sample,components:{frame:{file:'assets/frame.png',style:'assets/frame.css'}}},'sample-set')
 assert.deepEqual(out.components.frame,{file:'assets/frame.png',style:'assets/frame.css'})
 assert.throws(()=>checkManifest({...sample,components:{frame:{file:'assets/frame.png',slice:[1,1,1,1]}}},'sample-set'))
 assert.throws(()=>checkManifest({...sample,components:{frame:{file:'assets/badge.png'}}},'sample-set'))
})
