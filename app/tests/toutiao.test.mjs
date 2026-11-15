import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import puppeteer from 'puppeteer-core';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';
import {createStore} from '../lib/store.mjs';import {Jobs} from '../lib/jobs.mjs';
import {extractToutiao,openToutiaoBrowser,isToutiaoVideo,toutiaoVideoResource,readToutiaoCollectionCards,readToutiaoArticleDOM,toutiaoCollectionControl} from '../lib/toutiao.mjs';
import {toutiaoUrl} from '../lib/platforms.mjs';
import {mediaAllowed} from '../lib/content.mjs';
const executablePath=[process.env.FOCUS_BROWSER_PATH,'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p&&fs.existsSync(p));
const id='7688571077903073815';
test('头条直接读取真实文章正文，转换简体并保留作者',async()=>{
 const plain=await extractToutiao({id,title:'原始标题'},{model:{supportsVision:()=>false},readArticle:async()=>({text:'這是真實文章正文，不是標題猜測。',images:[],author:'作者'})});assert.equal(plain.text,'这是真实文章正文，不是标题猜测。');assert.equal(plain.duration,60);assert.equal(plain.author,'作者');assert.equal(plain.source,'今日头条原文正文');
 assert(mediaAllowed('https://p3-sign.toutiaoimg.com/a.jpeg'));assert(!mediaAllowed('https://toutiaoimg.com.attacker.example/a'));
});
test('头条收藏需筛选，普通新闻不能因为收藏而强制纳入知识库',async()=>{
 const store=createStore(':memory:',{platform:'toutiao'});store.importItems([{id,title:'新闻标题',sources:['collection']}]);assert.equal(store.get(id).knowledge,'review');let sent;
 const model={configured:()=>true,settings:{batchLimit:5},supportsVision:()=>false,json:async(_s,p)=>{sent=p;return {items:[{id,knowledge:'no',category:'非知识',confidence:.99,reason:'普通新闻'}]};}};
 const jobs=new Jobs({store,model,root:'/tmp',dataDir:'/tmp',extract:async()=>({text:'真实的普通新闻正文',images:[],segments:[],source:'今日头条原文正文'})});jobs.start('classify');
 const until=Date.now()+5000;while(jobs.active&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.equal(jobs.active,null);assert.equal(sent.items[0].transcript,'真实的普通新闻正文');assert.equal(store.get(id).knowledge,'no');assert.equal(store.get(id).summary,'');assert.equal(jobs.list()[0].platform,'toutiao');store.close();
});
test('收藏 DOM 采文章、微头条和视频，跳过评论与页脚链接',{skip:!executablePath},async()=>{
 const browser=await puppeteer.launch({executablePath,headless:true});try{const page=await browser.newPage();await page.setContent(`<base href="https://www.toutiao.com/"><div class="feed-card-article"><a class="title" href="/article/${id}/">知识文章</a><a href="/article/${id}/#comment">评论</a></div><div class="feed-card-wtt"><div class="feed-card-wtt-l"><p class="content"><a href="/w/1874033176808460/">微头条完整配文</a></p></div></div><div class="feed-card-video"><a class="title" href="/video/7687105728556827155/">混入的视频</a></div><footer><a href="/article/7486434702922531379/">页脚公示</a></footer>`);
 const items=await page.evaluate(readToutiaoCollectionCards);assert.deepEqual(items.map(x=>x.id),[id,'1874033176808460','7687105728556827155']);assert.equal(items[0].platform,'toutiao');assert(items[1].url.includes('/w/'));assert(isToutiaoVideo(items[2]));assert.equal(toutiaoUrl(items[2].id,items[2].url),items[2].url);
 await page.setContent('<article class="syl-article-base"><p>正文里的知识内容</p><img data-src="https://p3-sign.toutiaoimg.com/real.jpeg" src="data:image/gif;base64,x"></article><aside>推荐列表和广告</aside><div class="article-toolbar"><span>已收藏</span></div>');
 const article=await page.evaluate(readToutiaoArticleDOM);assert.equal(article.text,'正文里的知识内容');assert.deepEqual(article.images,['https://p3-sign.toutiaoimg.com/real.jpeg']);assert.equal((await page.evaluate(toutiaoCollectionControl)).state,1);
 }finally{await browser.close();}
});

test('头条视频读取实际媒体后复用转写，保留视频时长与时间点',async()=>{
 const v={id,url:`https://www.toutiao.com/video/${id}/`,images:[]};let opts;
 const result=await extractToutiao(v,{dataDir:'/tmp/data/toutiao',root:'/tmp/app',model:{},readVideo:async()=>({media:'https://v9-web.toutiaovod.com/test.mp4',duration:120,author:'视频作者'}),transcribe:async(video,options)=>{opts=options;assert.equal(video.media,'https://v9-web.toutiaovod.com/test.mp4');return {text:'真实视频口述',segments:[{start:0,text:'真实视频口述'}],source:'本地 Whisper 转写'};}});
 assert.equal(result.duration,120);assert.equal(result.segments[0].start,0);assert.equal(opts.root,'/tmp/app');assert.equal(opts.referer,'https://www.toutiao.com/');assert.match(result.source,/今日头条视频/);assert(mediaAllowed('https://v9-web.toutiaovod.com/test.mp4'));
});
test('全库整理超过200条，仅知识类生成笔记，非知识排除、不确定待确认',async()=>{
 const store=createStore(':memory:',{platform:'toutiao'});const items=Array.from({length:209},(_,i)=>({id:String(7000000000000000000n+BigInt(i)),title:'资料'+i,sources:['collection']}));store.importItems(items);let summarized=0;
 const model={configured:()=>true,settings:{batchLimit:5},supportsVision:()=>false,json:async(_s,p)=>{if(p.items)return {items:p.items.map((v)=>({id:v.id,knowledge:v.id===items[208].id?'yes':v.id===items[207].id?'review':'no',category:'科学与工程',confidence:.95,reason:'依据真实正文'}))};summarized++;return {summary:'知识笔记',points:[],questions:[]};}};
 const jobs=new Jobs({store,model,root:'/tmp',dataDir:'/tmp',extract:async()=>({text:'有证据的正文',images:[],source:'今日头条原文正文'})});jobs.start('process_all');const until=Date.now()+10000;while(jobs.active&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.equal(jobs.active,null);assert.equal(jobs.list()[0].state,'completed');assert.equal(jobs.list()[0].result.classified,209);assert.equal(summarized,1);assert.equal(store.get(items[208].id).summary,'知识笔记');assert.equal(store.get(items[207].id).knowledge,'review');assert.equal(store.stats().excluded,207);store.close();
});

test('长视频 blob 播放时优先独立音轨，保持资源白名单和真实时长',()=>{
 const resource=toutiaoVideoResource({id,currentSrc:'blob:https://www.toutiao.com/local',playInfo:{video_duration:4052.44,dynamic_video:{dynamic_audio_list:[{main_url:'https://v3-web.toutiaovod.com/audio.mp4',backup_url:'https://v6-web.toutiaovod.com/audio.mp4',audio_meta:{size:33000000}}]}}});assert.equal(resource.media,'https://v3-web.toutiaovod.com/audio.mp4');assert.equal(resource.duration,4053);assert.equal(resource.mediaAlternatives.length,1);
 assert.throws(()=>toutiaoVideoResource({currentSrc:'http://127.0.0.1/private',playInfo:{video_list:[{main_url:'https://attacker.example/media'}]}}),/不受支持/);
});
test('长配文先用真实正文筛选，知识笔记再进行原图完整识别',async()=>{
 const text='可学习的方法与知识。'.repeat(40),images=['https://p3-sign.toutiaoimg.com/page.jpeg'];
 const result=await extractToutiao({id},{model:{supportsVision:()=>true,json:()=>{throw Error('筛选阶段有足够原文，不应提前调用图片');}},classifyOnly:true,readArticle:async()=>({text,images,author:'作者'})});assert.equal(result.text,text);assert.deepEqual(result.images,images);assert.equal(result.source,'今日头条原文正文');
});

test('创建页面失败时关闭浏览器并释放串行锁，后续条目能继续',{skip:!executablePath},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tt-browser-cleanup-'));let closed=0,timer;
 const launch=async()=>{const b=new EventEmitter(),p=new EventEmitter();b.process=()=>p;b.newPage=async()=>{throw Error('Target closed')};b.close=async()=>{closed++;b.emit('disconnected');p.emit('close');};return b;};
 try{await assert.rejects(openToutiaoBrowser(dir,undefined,{launch}),/Target closed/);await Promise.race([assert.rejects(openToutiaoBrowser(dir,undefined,{launch}),/Target closed/),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('浏览器锁没有释放')),1000))]);assert.equal(closed,2);}finally{clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true});}
});
