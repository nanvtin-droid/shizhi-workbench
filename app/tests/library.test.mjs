import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStore} from '../lib/store.mjs';
import {mediaAllowed} from '../lib/content.mjs';
const video=(id='1234567890123456789',sources=['like'])=>({id,title:'英语学习方法',author:'测试',sources,tags:['英语'],duration:120});
test('重复同步合并来源并保留人工分类、正文、总结与学习笔记',()=>{
 const s=createStore(':memory:');s.importItems([video()]);s.patch(video().id,{knowledge:'yes',category:'自定义分类',note:'我的体会',status:'learned'});s.content(video().id,{text:'真实正文',source:'测试字幕'});s.summary(video().id,{summary:'基于正文的笔记'});
 s.importItems([video(video().id,['collection'])]);s.importItems([video(video().id,['like'])]);const r=s.get(video().id);
 assert.equal(s.stats().total,1);assert.deepEqual(r.sources,['like','collection']);assert.equal(r.category,'自定义分类');assert.equal(r.note,'我的体会');assert.equal(r.status,'learned');assert.equal(r.transcript,'真实正文');assert.equal(r.summary,'基于正文的笔记');s.close();
});
test('非知识与待确认不会出现在知识库、Focus 候选查询或知识分类统计中',()=>{
 const s=createStore(':memory:');s.importItems([video('1234567890123456781'),video('1234567890123456782'),video('1234567890123456783',['collection'])]);s.patch('1234567890123456781',{knowledge:'no'});
 const k=s.list({scope:'knowledge'});assert.equal(k.total,1);assert.equal(k.items[0].id,'1234567890123456783');assert.equal(s.stats().review,1);assert.equal(s.stats().excluded,1);s.close();
});
test('模拟采集包重复导入数量稳定，来源分别保留，ID 没有数值精度损失',()=>{
 const s=createStore(':memory:');
 const items=Array.from({length:1000},(_,i)=>{
   const id=String(9000000000000000001n+BigInt(i));
   const sources=[['collection'],['like'],['collection','like']][i%3];
   return video(id,sources);
 });
 s.importItems(items);s.importItems(items);
 assert.equal(s.stats().total,items.length);assert.equal(s.stats().collection,items.filter(v=>v.sources.includes('collection')).length);assert.equal(s.stats().like,items.filter(v=>v.sources.includes('like')).length);for(const v of items)assert.equal(s.get(v.id).id,v.id);s.close();
});
test('替换正文会使旧总结失效，不会留下与正文不符的笔记',()=>{const s=createStore(':memory:');s.importItems([video()]);s.summary(video().id,{summary:'旧总结'});s.patch(video().id,{transcript:'新正文'});assert.equal(s.get(video().id).summary,'');assert.equal(s.get(video().id).content_source,'手动导入逐字稿');s.close();});
test('搜索能够命中正文和手写笔记，符号不会变成 SQL 条件',()=>{const s=createStore(':memory:');s.importItems([video()]);s.patch(video().id,{knowledge:'yes',note:'番茄工作法 复习',transcript:'专注学习'});assert.equal(s.list({q:'番茄'}).total,1);assert.equal(s.list({q:'专注学习'}).total,1);assert.equal(s.list({q:"' OR 1=1 --"}).total,0);s.close();});
test('导入错误会回滚整个批次',()=>{const s=createStore(':memory:');assert.throws(()=>s.importItems([video(),video('bad')]));assert.equal(s.stats().total,0);s.close();});
test('AI 排除的喜欢视频后来出现在收藏中，应按用户收藏意图重新纳入；人工排除仍保留',()=>{const s=createStore(':memory:');s.importItems([video()]);s.applyDecision(video().id,{knowledge:'no',category:'非知识',confidence:.9,reason:'AI 初步排除',method:'ai'});s.importItems([video(video().id,['collection'])]);assert.equal(s.get(video().id).knowledge,'yes');s.patch(video().id,{knowledge:'no'});s.importItems([video(video().id,['collection'])]);assert.equal(s.get(video().id).knowledge,'no');s.close();});
test('媒体下载只允许抖音 CDN，拒绝本机、伪装子域和带凭据地址',()=>{assert(mediaAllowed('https://v3.douyinvod.com/test.mp4'));assert(!mediaAllowed('http://127.0.0.1/a'));assert(!mediaAllowed('https://douyin.com.attacker.example/a'));assert(!mediaAllowed('https://a:d@www.douyin.com/a'));assert(!mediaAllowed('file:///etc/passwd'));});
test('自定义标题独立于原始标题，同步不覆盖，搜索两种标题均可命中',()=>{
 const s=createStore(':memory:'),id=video().id;s.importItems([{...video(id,['collection']),title:'瞒不住了…… #歪比巴卜'}]);s.content(id,{text:'已经识别的正文',source:'平台字幕'});s.summary(id,{summary:'已有正文笔记'});
 const before=s.get(id);s.patch(id,{custom_title:'  相机运镜技巧  与构图  '});let v=s.get(id);assert.equal(v.custom_title,'相机运镜技巧 与构图');assert.equal(v.display_title,v.custom_title);assert.equal(v.title,'瞒不住了…… #歪比巴卜');assert.equal(v.manual,before.manual);assert.equal(v.method,before.method);assert.equal(v.summary,'已有正文笔记');
 assert.equal(s.list({q:'相机运镜'}).total,1);assert.equal(s.list({q:'歪比巴卜'}).total,1);
 s.importItems([{...video(id,['collection']),title:'平台更新后的原始标题',custom_title:'过期导入的自定义标题'}]);v=s.get(id);assert.equal(v.custom_title,'相机运镜技巧 与构图');assert.equal(v.title,'平台更新后的原始标题');
 s.patch(id,{custom_title:''});assert.equal(s.get(id).display_title,'平台更新后的原始标题');assert.equal(s.get(id).summary,'已有正文笔记');s.close();
});
test('导出数据恢复时保留自定义标题，非法标题不会覆盖已有名称',()=>{
 const s=createStore(':memory:'),copy=createStore(':memory:');s.importItems([video()]);s.patch(video().id,{custom_title:'英语口语训练'});copy.importItems(s.all());assert.equal(copy.get(video().id).custom_title,'英语口语训练');assert.equal(copy.get(video().id).title,'英语学习方法');
 for(const custom_title of [null,123,'字'.repeat(201)])assert.throws(()=>s.patch(video().id,{custom_title}));assert.equal(s.get(video().id).custom_title,'英语口语训练');copy.close();s.close();
});
test('旧资料库升级后保留正文、笔记及原始标题，重启后自定义标题仍在',async()=>{
 const os=await import('node:os'),path=await import('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'custom-title-migration-')),file=path.join(dir,'library.sqlite');let s;
 try{s=createStore(file);s.importItems([video()]);s.patch(video().id,{note:'我的学习收获',status:'learned'});s.content(video().id,{text:'旧版本已有正文',source:'平台字幕'});s.db.exec('ALTER TABLE videos DROP COLUMN custom_title');s.close();
 s=createStore(file);let v=s.get(video().id);assert.equal(v.title,'英语学习方法');assert.equal(v.custom_title,'');assert.equal(v.note,'我的学习收获');assert.equal(v.transcript,'旧版本已有正文');assert.equal(v.status,'learned');s.patch(v.id,{custom_title:'口语复习'});s.close();s=createStore(file);assert.equal(s.get(v.id).display_title,'口语复习');
 }finally{s?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
