import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'douyin-focus-test-'));
const port=14317;
const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:String(port),FOCUS_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
let errors='';child.stderr.on('data',d=>errors+=d);
const base=`http://127.0.0.1:${port}/api`;
async function req(p,method='GET',body,extra={}){const res=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};}
const video=(id,sources=['collection'])=>({id:String(id),title:'测试知识视频',sources,tags:[],duration:120});
try{
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('测试服务启动失败 '+errors);})]);
 test('真实 API 流程：导入、知识隔离、Focus、状态保存与导出',async()=>{
  const items=[video('1234567890123456781'),video('1234567890123456782',['like']),video('1234567890123456783')];
  assert.equal((await req('/import','POST',{items})).data.added,3);
  await req('/videos/1234567890123456782','PATCH',{knowledge:'no'});
  await req('/videos/1234567890123456783','PATCH',{status:'learned'});
  const focus=await req('/sessions','POST',{minutes:20});assert.equal(focus.status,200);assert.deepEqual(focus.data.video_ids,['1234567890123456781']);
  assert.deepEqual((await req('/sessions/'+focus.data.id)).data.video_ids,focus.data.video_ids);
  await req('/videos/1234567890123456781','PATCH',{note:'这是真实学习笔记的测试',status:'learned'});
  await req('/import','POST',{items});const v=(await req('/videos/1234567890123456781')).data;assert.equal(v.note,'这是真实学习笔记的测试');assert.equal(v.status,'learned');
  const exported=(await req('/export')).data;assert.equal(exported.items.length,2);assert(!exported.items.some(v=>v.knowledge==='no'));
 });
 test('设置只返回密钥状态；跨站请求无法改动本地资料',async()=>{
  const x=await req('/settings','POST',{baseUrl:'http://127.0.0.1:19999/v1',model:'test-model',apiKey:'test-secret-only'});assert.equal(x.data.hasKey,true);assert(!JSON.stringify(x.data).includes('test-secret-only'));
  const b=(await req('/bootstrap')).data;assert(!JSON.stringify(b).includes('test-secret-only'));
  const r=await req('/settings','POST',{model:'attacker'},{Origin:'https://untrusted.example'});assert.equal(r.status,403);assert.equal((await req('/bootstrap')).data.settings.model,'test-model');
 });
 test('取消操作 API 可分别排队和撤销，不会在点击时改动来源',async()=>{
  const id='1234567890123456790';await req('/import','POST',{items:[video(id,['collection','like'])]});
  const staged=await req('/videos/'+id+'/source-actions','POST',{source:'like'});assert.equal(staged.status,200);assert.deepEqual(staged.data.sources,['collection','like']);
  const a=staged.data.sourceActions.find(a=>a.source==='like');assert.equal(a.state,'pending');assert((await req('/bootstrap')).data.sourceActions.some(x=>x.id===a.id));
  assert.equal((await req('/source-actions/'+a.id+'/cancel','POST',{})).status,200);assert(!(await req('/bootstrap')).data.sourceActions.some(x=>x.id===a.id));assert.deepEqual((await req('/videos/'+id)).data.sources,['collection','like']);
  assert.equal((await req('/videos/'+id+'/source-actions','POST',{source:'invalid'})).status,400);
 });
 test('自定义标题 API：可搜索、导出并恢复原始标题，不改动原始简介',async()=>{
  const id='1234567890123456791';await req('/import','POST',{items:[{...video(id),title:'抽象的原始标题'}]});
  const saved=await req('/videos/'+id,'PATCH',{custom_title:'识别视频主旨的方法',title:'不能覆盖的原始标题'});assert.equal(saved.status,200);assert.equal(saved.data.title,'抽象的原始标题');assert.equal(saved.data.display_title,'识别视频主旨的方法');
  assert((await req('/videos?scope=all&q='+encodeURIComponent('识别视频主旨'))).data.items.some(v=>v.id===id));
  const exported=(await req('/export')).data.items.find(v=>v.id===id);assert.equal(exported.custom_title,'识别视频主旨的方法');assert.equal(exported.title,'抽象的原始标题');
  const markdown=await (await fetch(base+'/videos/'+id+'/export')).text();assert(markdown.startsWith('# 识别视频主旨的方法'));assert(markdown.includes('原始标题和简介：抽象的原始标题'));
  assert.equal((await req('/videos/'+id,'PATCH',{custom_title:'字'.repeat(201)})).status,400);
  const restored=(await req('/videos/'+id,'PATCH',{custom_title:''})).data;assert.equal(restored.display_title,'抽象的原始标题');
 });
 test('抖音与头条：相同内容 ID、资料、搜索、取消队列和 Focus 记录完全独立',async()=>{
  const id='1234567890123456799',tt={'X-Focus-Platform':'toutiao'};
  await req('/import','POST',{items:[{...video(id),title:'抖音独立资料'}]});
  const imported=await req('/import','POST',{items:[{...video(id),platform:'toutiao',title:'头条独立图文',url:'https://www.toutiao.com/w/'+id+'/'}]},tt);assert.equal(imported.status,200);
  const tv=(await req('/videos/'+id,'GET',null,tt)).data;assert.equal(tv.platform,'toutiao');assert.equal(tv.knowledge,'review');assert(tv.url.includes('/w/'));
  assert.equal((await req('/videos/'+id)).data.title,'抖音独立资料');assert.equal((await req('/videos?scope=all&q='+encodeURIComponent('头条独立'))).data.total,0);
  assert.equal((await req('/videos?scope=all&q='+encodeURIComponent('头条独立'),'GET',null,tt)).data.total,1);
  assert.equal((await req('/bootstrap','GET',null,tt)).data.stats.total,1);assert.equal((await req('/bootstrap')).data.platform,'douyin');
  await req('/videos/'+id+'/source-actions','POST',{source:'collection'},tt);assert.equal((await req('/bootstrap')).data.sourceActions.length,0);assert.equal((await req('/bootstrap','GET',null,tt)).data.sourceActions.length,1);
  await req('/videos/'+id,'PATCH',{knowledge:'yes',category:'头条专属主题',custom_title:'头条自定义名'},tt);assert.equal((await req('/videos/'+id)).data.custom_title,'');
  await req('/settings','POST',{autoFocusNotes:false});const ts=(await req('/sessions','POST',{category:'头条专属主题',minutes:5},tt)).data;assert.deepEqual(ts.video_ids,[id]);assert.equal((await req('/sessions','GET',null,tt)).data.length,1);assert(!(await req('/sessions')).data.some(x=>x.category==='头条专属主题'));
  const ex=(await req('/export','GET',null,tt)).data;assert.equal(ex.platform,'toutiao');assert.equal(ex.items.length,1);assert.equal(ex.items[0].title,'头条独立图文');
  assert.equal((await req('/import','POST',{items:ex.items})).status,400);
  assert.equal((await req('/bootstrap','GET',null,{'X-Focus-Platform':'bad'})).status,400);
 });
 test.after(async()=>{child.kill('SIGTERM');await once(child,'exit');fs.rmSync(directory,{recursive:true,force:true});});
}catch(e){child.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});throw e;}
