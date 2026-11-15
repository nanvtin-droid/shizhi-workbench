import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {Jobs} from '../lib/jobs.mjs';
const video=(n,sources=['like'])=>({id:String(1234567890123456700n+BigInt(n)),title:'测试视频 '+n,author:'测试',tags:[],sources});
const wait=async jobs=>{const deadline=Date.now()+5000;while(jobs.active&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(jobs.active,null);return jobs.list()[0];};
function setup(json){const store=createStore(':memory:');const model={configured:()=>true,settings:{batchLimit:20},json};const jobs=new Jobs({store,model,root:'/tmp',dataDir:'/tmp'});return {store,jobs};}
test('AI 筛选保留人工决定、收藏来源；低置信度喜欢不进入学习库',async()=>{
 const {store,jobs}=setup(async(_system,payload)=>({items:payload.items.map(v=>({id:v.id,knowledge:'no',category:'测试主题',confidence:.5,reason:'证据有限'}))}));
 store.importItems([video(1),video(2,['collection']),video(3)]);store.patch(video(3).id,{knowledge:'yes',category:'我的分类'});jobs.start('classify');assert.equal((await wait(jobs)).state,'completed');assert.equal(store.get(video(1).id).knowledge,'review');assert.equal(store.get(video(2).id).knowledge,'yes');assert.equal(store.get(video(3).id).category,'我的分类');store.close();
});
test('模型返回重复或虚构 ID 时不写入错误匹配，保留待确认',async()=>{
 const {store,jobs}=setup(async()=>({items:[{id:video(1).id,knowledge:'yes'},{id:video(1).id,knowledge:'no'}]}));store.importItems([video(1),video(2)]);jobs.start('classify');const r=await wait(jobs);assert.equal(r.state,'completed');assert.equal(r.unresolved,2);assert.equal(store.get(video(1).id).knowledge,'review');assert.equal(store.get(video(2).id).knowledge,'review');store.close();
});
test('总结只发送知识类正文，不把标题或非知识视频作为待总结内容',async()=>{
 const sent=[];const {store,jobs}=setup(async(_system,payload)=>{sent.push(payload);return {summary:'根据正文整理',points:[{text:'要点',time:99}],questions:['问题']};});
 store.importItems([video(1,['collection']),video(2,['collection']),video(3)]);store.content(video(1).id,{text:'有证据的真实正文',segments:[{start:0,text:'有证据的真实正文'}],source:'测试字幕'});store.patch(video(3).id,{knowledge:'no',transcript:'非知识正文'});
 jobs.start('summarize',{ids:[video(1).id,video(2).id,video(3).id]});const r=await wait(jobs);assert.equal(r.state,'partial');assert.equal(sent.length,1);assert.equal(sent[0].transcript,'有证据的真实正文');assert.equal(store.get(video(1).id).points[0].time,null);assert.equal(store.get(video(2).id).summary,'');assert.equal(store.get(video(3).id).summary,'');store.close();
});
test('超过 1000 条记录后，后续批次仍能处理未分类的视频',async()=>{
 const {store,jobs}=setup(async(_system,payload)=>({items:payload.items.map(v=>({id:v.id,knowledge:'yes',category:'科学与工程',confidence:.9,reason:'具体知识'}))}));store.importItems(Array.from({length:1002},(_,i)=>video(i)));store.db.prepare("UPDATE videos SET method='ai' WHERE id<>?").run(video(1001).id);jobs.start('classify',{limit:20});const r=await wait(jobs);assert.equal(r.state,'completed');assert.equal(store.get(video(1001).id).method,'ai');assert.equal(r.done,1);store.close();
});
test('模型遗漏条目时只补查缺少的 ID，仍不虚构分类',async()=>{
 let calls=0;const {store,jobs}=setup(async(_s,p)=>{calls++;const list=calls===1?p.items.slice(0,1):p.items;return {items:list.map(v=>({id:v.id,knowledge:'yes',category:'科学与工程',confidence:.9,reason:'具体知识'}))};});store.importItems([video(1),video(2)]);jobs.start('classify');const r=await wait(jobs);assert.equal(r.state,'completed');assert.equal(calls,2);assert.equal(store.get(video(2).id).knowledge,'yes');store.close();
});
test('模型持续遗漏时保留待确认，不会把缺失判断伪装成知识',async()=>{const {store,jobs}=setup(async()=>({items:[]}));store.importItems([video(1)]);jobs.start('classify_all');const r=await wait(jobs);assert.equal(r.state,'completed');assert.equal(store.get(video(1).id).knowledge,'review');assert.equal(r.unresolved,1);store.close();});
test('Focus 笔记在已有任务后自动执行，不丢失排队请求',async()=>{
 let release;const gate=new Promise(r=>release=r);const {store,jobs}=setup(async(_s,p)=>{if(p.items){await gate;return {items:p.items.map(v=>({id:v.id,knowledge:'yes',category:'英语与语言',confidence:.9,reason:'英语知识'}))};}return {summary:'学习笔记',points:[{text:'要点',time:null}],questions:[]};});
 store.importItems([video(1,['collection']),video(2)]);store.content(video(1).id,{text:'真实英语正文',source:'测试字幕'});jobs.start('classify',{ids:[video(2).id]});const q=jobs.enqueue('summarize',{ids:[video(1).id],limit:1});assert.equal(jobs.list().find(j=>j.id===q.id).state,'queued');release();await wait(jobs);assert.equal(store.get(video(1).id).summary,'学习笔记');assert.equal(jobs.list().find(j=>j.id===q.id).state,'completed');store.close();
});
test('历史任务可从原有视频 ID 获取结果入口，不需要重新生成笔记',()=>{
 const {store,jobs}=setup(async()=>{throw new Error('不应调用模型');});store.importItems([video(1,['collection'])]);
 store.db.prepare('INSERT INTO jobs(id,type,state,payload) VALUES(?,?,?,?)').run('legacy','process','completed',JSON.stringify({options:{ids:[video(1).id]},progress:'任务完成'}));
 const record=jobs.list().find(j=>j.id==='legacy');assert.deepEqual(record.videos,[{id:video(1).id,title:video(1).title}]);assert.equal(record.options.returnContext,undefined);store.close();
});
test('批量笔记任务保存实际处理的视频及发起页面，完成后入口仍可用',async()=>{
 const {store,jobs}=setup(async()=>({summary:'最新分析结果',points:[],questions:[]}));store.importItems([video(1,['collection']),video(2)]);store.content(video(1).id,{text:'真实正文',source:'测试字幕'});
 const returnContext={route:'library',category:'英语与语言',page:2,scrollY:380};jobs.start('summarize',{returnContext});const record=await wait(jobs);
 assert.equal(record.state,'completed');assert.deepEqual(record.options.returnContext,returnContext);assert.deepEqual(record.videos.map(v=>v.id),[video(1).id]);assert.equal(store.get(record.videos[0].id).summary,'最新分析结果');store.close();
});
test('原图升级失败保留旧正文与笔记，成功后保存图片来源和有效页码',async()=>{
 for(const fail of [true,false]){
  const store=createStore(':memory:');store.importItems([{...video(1,['collection']),images:['https://p3.douyinpic.com/page1']}]);store.content(video(1).id,{text:'旧 OCR',source:'本机图片文字识别'});store.summary(video(1).id,{summary:'旧笔记'});
  let extracted=0;const model={configured:()=>true,supportsVision:()=>true,settings:{},json:async()=>{if(fail)throw new Error('模型额度不足');return {summary:'原图笔记',points:[{text:'实际图文知识',time:99,page:1},{text:'无效页码',page:9}],questions:[]};}};
  const jobs=new Jobs({store,model,root:'/tmp',dataDir:'/tmp',extract:async()=>{extracted++;return {text:'[图片 1] 原图全文',source:'AI 原图识别（1 张）',segments:[]};}});
  jobs.start('summarize',{ids:[video(1).id]});const r=await wait(jobs),v=store.get(video(1).id);assert.equal(extracted,1);
  if(fail){assert.equal(r.state,'partial');assert.equal(v.transcript,'旧 OCR');assert.equal(v.summary,'旧笔记');}
  else{assert.equal(r.state,'completed');assert.equal(v.summary_basis,'images');assert.equal(v.points[0].page,1);assert.equal(v.points[1].page,null);assert.equal(v.points[0].time,null);}
  store.close();
 }
});
test('已归档条目和非知识图文不会提取正文或发送给模型',async()=>{
 const store=createStore(':memory:');store.importItems([video(1,['collection']),{...video(2),images:['x']}]);store.patch(video(2).id,{knowledge:'no'});store.stageSource(video(1).id,'collection');const a=store.sourceActions()[0];store.db.prepare("UPDATE source_actions SET state='running' WHERE id=?").run(a.id);store.finishSource(a.id);
 const jobs=new Jobs({store,model:{configured:()=>true,settings:{},supportsVision:()=>true,json:()=>{throw new Error('不得调用');}},root:'/tmp',dataDir:'/tmp',extract:()=>{throw new Error('不得提取');}});jobs.start('summarize',{ids:[video(1).id,video(2).id]});const r=await wait(jobs);assert.equal(r.done,0);assert.equal(r.state,'completed');store.close();
});
test('喜欢中的图文先读原图再判断知识，识别失败留待确认；非知识不生成学习笔记',async()=>{
 for(const failed of [false,true]){
  const store=createStore(':memory:');store.importItems([{...video(1),images:['x']}]);let calls=0;
  const model={configured:()=>true,supportsVision:()=>true,settings:{},json:async(_s,p)=>{calls++;assert(p.items[0].transcript.includes('[图片 2]'));return {items:[{id:video(1).id,knowledge:'no',category:'非知识',confidence:.99,reason:'娱乐图文'}]};}};
  const jobs=new Jobs({store,model,root:'/tmp',dataDir:'/tmp',extract:async()=>{if(failed)throw new Error('原图不可用');return {text:'[图片 1] 娱乐插图\n[图片 2] 娱乐插图',source:'AI 原图识别（2 张）',segments:[]};}});jobs.start('process');const r=await wait(jobs),v=store.get(video(1).id);
  assert.equal(v.knowledge,failed?'review':'no');assert.equal(v.summary,'');assert.equal(calls,failed?0:1);if(failed){assert.equal(r.state,'partial');assert.equal(v.method,'rule');}store.close();
 }
});
