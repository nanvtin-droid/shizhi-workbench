import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {setTimeout as sleep} from 'node:timers/promises';
import {extractImages,extractContent,imageBytes,mediaAllowed} from './content.mjs';
import {prepareVisionImage} from './vision-image.mjs';
import {simplifiedContent} from './text.mjs';
import {toutiaoUrl} from './platforms.mjs';
import {applySourceActions} from './source-actions.mjs';

const browserQueues=new Map();
async function acquireBrowser(profile){const previous=browserQueues.get(profile)||Promise.resolve();let release;const current=new Promise(r=>release=r);const tail=previous.then(()=>current);browserQueues.set(profile,tail);await previous;return ()=>{release();if(browserQueues.get(profile)===tail)browserQueues.delete(profile);};}
export const isToutiaoVideo=video=>/^\/video\//.test(new URL(video.url||toutiaoUrl(video.id)).pathname);
export async function openToutiaoBrowser(dataDir,signal,{launch=options=>puppeteer.launch(options)}={}){
 const executablePath=[process.env.FOCUS_BROWSER_PATH,'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p&&fs.existsSync(p));
 if(!executablePath)throw new Error('没有找到专用浏览器 Edge 或 Chrome');
 const profile=path.join(dataDir,'browser-profile');fs.mkdirSync(profile,{recursive:true,mode:0o700});
 const release=await acquireBrowser(profile);let browser;try{signal?.throwIfAborted();browser=await launch({executablePath,userDataDir:profile,headless:false,defaultViewport:{width:1280,height:900},args:['--mute-audio','--no-first-run','--no-default-browser-check','--disk-cache-size=52428800','--media-cache-size=52428800']});}catch(e){release();throw e;}if(browser.process())browser.process().once('close',release);else browser.once('disconnected',release);
 const abort=()=>void browser.close().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
 browser.once('disconnected',()=>signal?.removeEventListener('abort',abort));
 try{const page=await browser.newPage();await page.setCacheEnabled(false);return {browser,page};}catch(e){await browser.close().catch(()=>{});throw e;}
}
export async function openToutiaoFavorites(page,{signal,onProgress=()=>{}}){
 await page.goto('https://www.toutiao.com/',{waitUntil:'domcontentloaded',timeout:60000});
 let href='';const deadline=Date.now()+600000;
 while(!href){
  signal?.throwIfAborted();href=await page.evaluate(()=>[...document.querySelectorAll('a')].find(a=>a.innerText.trim()==='我的收藏')?.href||'');
  if(href)break;if(Date.now()>deadline)throw new Error('等待今日头条登录超时');onProgress('等待今日头条登录：请在专用浏览器完成登录，登录后自动继续');await sleep(1500,undefined,{signal});
 }
 const u=new URL(href);if(!['www.toutiao.com','toutiao.com'].includes(u.hostname))throw new Error('今日头条收藏入口无效');u.search='?tab=fav';
 await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>!!document.querySelector('.feed-card-article,.feed-card-wtt,.feed-card-video-single,.feed-card-video')||/暂无收藏|还没有收藏|暂时没有内容/.test(document.body.innerText),{timeout:30000}).catch(()=>{});
 return u.href;
}
// These DOM readers are also exercised against fixture pages in tests.
export function readToutiaoCollectionCards(){
 const items=new Map();
 for(const a of document.querySelectorAll('.feed-card-article a.title,.feed-card-wtt .content a[href],.feed-card-wtt-l .content a[href],.feed-card-video-single a.title,.feed-card-video a.title')){
  let u;try{u=new URL(a.href);}catch{continue;}
  const match=u.pathname.match(/^\/(article|w|video)\/(\d{10,25})\/?$/);if(!match||u.hash||!a.innerText.trim())continue;
  const card=a.closest('.feed-card-article,.feed-card-wtt,.feed-card-video-single,.feed-card-video')||a.closest('.feed-card-wtt-l')?.parentElement;if(!card)continue;
  const img=[...card.querySelectorAll('img')].find(i=>i.naturalWidth>=100||i.width>=100);
  const author=card.querySelector('a[href*="/c/user/"]')?.innerText.trim()||'';
  items.set(match[2],{platform:'toutiao',id:match[2],title:a.innerText.trim(),url:`https://www.toutiao.com/${match[1]}/${match[2]}/`,author,cover:img?.currentSrc||img?.getAttribute('data-src')||img?.src||'',images:[],duration:(card.querySelector('.duration')?.textContent.trim().split(':').reduce((n,v)=>n*60+Number(v),0)||0),tags:[],sources:['collection']});
 }
 return [...items.values()];
}
export function readToutiaoArticleDOM(){
 const micro=/^\/w\//.test(location.pathname);
 const root=micro?(document.querySelector('.weitoutiao-content,.wtt-content,.article-content')||document.querySelector('article')):(document.querySelector('article.syl-article-base,article.tt-article-content')||document.querySelector('.article-content'));
 if(!root)return null;
 const images=[...new Set([...root.querySelectorAll('img')].map(i=>i.getAttribute('data-src')||i.getAttribute('data-original')||i.currentSrc||i.src).filter(x=>/^https?:/.test(x)))];
 const author=document.querySelector('.article-meta a,.article-meta .name,.article-source a,.user-info .name,.author-name')?.innerText.trim()||'';
 return {text:root.innerText.trim(),images,title:document.querySelector('h1')?.innerText.trim()||'',author};
}
export async function readToutiaoArticle(video,{dataDir,signal,onProgress=()=>{}}){
 const {browser,page}=await openToutiaoBrowser(dataDir,signal);
 try{
  onProgress('读取今日头条原文与配图');await page.goto(toutiaoUrl(video.id,video.url),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>!!document.querySelector('article.syl-article-base,.article-content,.weitoutiao-content,.wtt-content'),{timeout:30000});
  await sleep(800,undefined,{signal});
  let result=await page.evaluate(readToutiaoArticleDOM);
  if(!result?.text&&!result?.images?.length)throw new Error('未读取到今日头条正文，请检查原文是否可访问');
  if(result.text.length>60000)throw new Error('图文超过 6 万字，请分段整理；本次未截断正文');
  return {...result,images:result.images.filter(mediaAllowed)};
 }finally{await browser.close().catch(()=>{});}
}
export function toutiaoVideoResource(detail){
 const info=detail.playInfo||{},bySize=(a,b)=>(a.audio_meta?.size||a.video_meta?.size||Infinity)-(b.audio_meta?.size||b.video_meta?.size||Infinity);
 const rows=[...(info.dynamic_video?.dynamic_audio_list||[])].sort(bySize).concat([...(info.video_list||[])].sort(bySize));
 const urls=[...new Set([...rows.flatMap(x=>[x.main_url,x.backup_url]),detail.currentSrc].filter(mediaAllowed))];
 if(!urls.length)throw new Error('头条视频播放地址暂不受支持，请稍后重试');
 return {id:detail.id,title:detail.title,author:detail.author,media:urls[0],mediaAlternatives:urls.slice(1),duration:Math.ceil(Number(info.video_duration)||detail.duration||0)};
}
export async function readToutiaoVideo(video,{dataDir,signal,onProgress=()=>{}}){
 const {browser,page}=await openToutiaoBrowser(dataDir,signal);
 try{
  onProgress('读取今日头条视频与音轨');await page.goto(toutiaoUrl(video.id,video.url),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>{try{return !!JSON.parse(decodeURIComponent(document.querySelector('#RENDER_DATA')?.textContent||'')).data?.initialVideo?.videoPlayInfo;}catch{return false;}},{timeout:45000});
  const raw=await page.evaluate(()=>{const initial=JSON.parse(decodeURIComponent(document.querySelector('#RENDER_DATA').textContent)).data.initialVideo,v=document.querySelector('video'),info=initial.videoPlayInfo;return {id:initial.itemId||initial.groupId||'',currentSrc:v?.currentSrc||'',duration:initial.duration||v?.duration||0,playInfo:{video_duration:info.video_duration,video_list:info.video_list,dynamic_video:info.dynamic_video},title:initial.title||document.querySelector('h1')?.innerText||'',author:initial.userInfo?.name||initial.userInfo?.screenName||''};});
  if(raw.id&&String(raw.id)!==String(video.id))throw new Error('视频页面与目标 ID 不一致，本次未识别');
  return toutiaoVideoResource(raw);
 }finally{await browser.close().catch(()=>{});}
}
export async function extractToutiao(video,{dataDir,model,signal,onProgress=()=>{},readArticle=readToutiaoArticle,readVideo=readToutiaoVideo,transcribe=extractContent,...options}){
 if(isToutiaoVideo(video)){
  const detail=await readVideo(video,{dataDir,signal,onProgress});let result;
  const urls=[detail.media,...(detail.mediaAlternatives||[])].slice(0,2);
  for(let i=0;i<urls.length;i++)try{result=await transcribe({...video,...detail,media:urls[i],images:[]},{...options,dataDir,model,signal,onProgress,root:options.root||path.dirname(dataDir),referer:'https://www.toutiao.com/'});break;}catch(e){if(signal?.aborted||i===urls.length-1||!/terminated|fetch failed|HTTP 403|HTTP 5\d\d|ECONNRESET|timeout/i.test(e.message))throw e;onProgress('视频资源连接中断，使用备用音轨重试');}
  return {...result,images:[],duration:detail.duration,author:detail.author,source:'今日头条视频 · '+result.source};
 }
 const article=await readArticle(video,{dataDir,signal,onProgress});
 let text=article.text,source='今日头条原文正文';
 if(article.images.length&&model.supportsVision?.()&&(!options.classifyOnly||article.text.trim().length<300)){
  const vision=await extractImages({...video,images:article.images},{model,signal,onProgress,maxImages:200,loadImage:async(url,signal)=>prepareVisionImage(await imageBytes(url,signal,{referer:'https://www.toutiao.com/'}),{dataDir,root:options.root||path.dirname(dataDir),signal})});
  text=`原文正文：\n${article.text}\n\n原文配图识别：\n${vision.text}`;source=vision.source.replace('AI 原图识别','AI 原图识别 · 今日头条');
 }else if(!text.trim())throw new Error('这条图文只有图片，请先配置支持图片输入的模型');
 if(text.length>180000)throw new Error('图文及配图识别正文过长，请分批整理');
 return simplifiedContent({text,segments:[],source,images:article.images,author:article.author,duration:Math.max(60,Math.ceil(article.text.length/300*60)+article.images.length*15)});
}
export function toutiaoCollectionControl(){
 const leaves=[...document.querySelectorAll('button,[role="button"],span,div,p')].filter(e=>e.children.length===0&&['已收藏','收藏'].includes(e.textContent.trim())&&e.getBoundingClientRect().width>0);
 const relevant=leaves.filter(e=>{let p=e;for(let i=0;i<4&&p;i++,p=p.parentElement)if(/collect|toolbar|action/i.test(p.className||''))return true;return false;});
 if(relevant.length!==1)return {state:null};
 return {state:relevant[0].textContent.trim()==='已收藏'?1:0};
}
export function toutiaoSourceAdapter(page,signal){
 let current=null;
 return {
  async inspect(video,source){
   if(source!=='collection')throw new Error('今日头条仅支持取消收藏');current=null;
   await page.goto(toutiaoUrl(video.id,video.url),{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForFunction(()=>[...document.querySelectorAll('span,div,button')].some(e=>e.children.length===0&&e.textContent.trim()==='已收藏'&&e.getBoundingClientRect().width>0)||!!document.querySelector('article.syl-article-base,.weitoutiao-content,.article-content'),{timeout:25000});
   await sleep(1200,undefined,{signal});const {state}=await page.evaluate(toutiaoCollectionControl);
   if(state!==0&&state!==1)throw new Error('未能识别今日头条收藏状态，本次没有点击');current={id:video.id,state};return state;
  },
  async remove(video){
   if(current?.id!==video.id||current.state!==1)throw new Error('未确认这条头条内容处于收藏状态');
   const target=await page.evaluateHandle(()=>{
    const nodes=[...document.querySelectorAll('button,[role="button"],span,div,p')].filter(e=>e.children.length===0&&e.textContent.trim()==='已收藏'&&e.getBoundingClientRect().width>0);
    return nodes.length===1?nodes[0]:null;
   });
   try{const element=target.asElement();if(!element)throw new Error('收藏按钮不明确，本次未点击');if(!new URL(page.url()).pathname.includes(video.id))throw new Error('页面已切换，本次未点击');current=null;await element.click();await sleep(1500,undefined,{signal});}finally{await target.dispose();}
  }
 };
}
export async function collectToutiao({store,dataDir,signal,onProgress=()=>{},limit=5000,mode='full'}){
 const {browser,page}=await openToutiaoBrowser(dataDir,signal),known=new Set(store.all().map(v=>v.id)),found=new Map(),pending=new Set();
 const report={platform:'toutiao',backend:'toutiao-cdp',sources:{},added:0,updated:0,completed:false,importedVideos:0};let exhausted=false,pages=0,capture=false;
 const save=()=>store.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('last_sync',?)").run(JSON.stringify({...report,at:new Date().toISOString()}));
 const listener=response=>{
  const url=new URL(response.url());if(!capture||url.pathname!=='/api/pc/list/user/feed'||response.request().method()==='OPTIONS')return;
  const category=url.searchParams.get('category')||'';if(category&&!/fav|collect/i.test(category))return;
  const promise=response.json().then(x=>{if(x.message!=='success')throw new Error('头条收藏列表读取失败');pages++;if(x.has_more===false||x.has_more===0)exhausted=true;}).catch(e=>{report.error=e.message;});pending.add(promise);promise.finally(()=>pending.delete(promise));
 };
 page.on('response',listener);
 try{
  onProgress('打开今日头条收藏入口');const actions=store.sourceActions().filter(a=>['pending','failed'].includes(a.state));
  capture=actions.length===0;await openToutiaoFavorites(page,{signal,onProgress});
  if(actions.length){report.actions=await applySourceActions({store,actions,adapter:toutiaoSourceAdapter(page,signal),signal,onProgress});capture=true;await openToutiaoFavorites(page,{signal,onProgress});}
  let last=-1,idle=0,reason='达到本次读取上限';
  for(let step=0;step<2000;step++){
   signal.throwIfAborted();await sleep(1800,undefined,{signal});await Promise.allSettled([...pending]);
   const items=await page.evaluate(readToutiaoCollectionCards);const fresh=items.filter(v=>!found.has(v.id));if(fresh.length){const r=store.importItems(fresh);report.added+=r.added;report.updated+=r.updated;for(const v of fresh)found.set(v.id,v);}
   onProgress(`同步头条收藏：${found.size} 条内容 · 新增 ${report.added} 条`);
   report.sources.collection={count:found.size,pages,complete:exhausted,reason:'正在扫描'};save();
   if(exhausted){reason='平台已返回收藏列表末尾';break;}if(found.size>=limit)break;
   if(mode==='incremental'&&step>=2&&[...found.keys()].filter(id=>known.has(id)).length>=10){reason='已遇到历史内容，结束增量读取';break;}
   idle=found.size===last?idle+1:0;last=found.size;if(idle>=10){reason='连续无新内容，未确认到底';break;}
   const challenge=await page.evaluate(()=>/(安全验证|请完成验证|拖动滑块)/.test(document.body.innerText));if(challenge){onProgress('今日头条需要验证，请在专用浏览器完成后继续');await page.waitForFunction(()=>!/(安全验证|请完成验证|拖动滑块)/.test(document.body.innerText),{timeout:600000});}
   await page.mouse.move(1000,700);await page.mouse.wheel({deltaY:1000});
   await page.evaluate(()=>{for(const e of [document.scrollingElement,...document.querySelectorAll('div')])if(e&&e.clientHeight>200&&e.scrollHeight>e.clientHeight+100)e.scrollTop+=1000;});
  }
  report.importedVideos=[...found.values()].filter(isToutiaoVideo).length;report.completed=exhausted;report.sources.collection={count:found.size,pages,complete:exhausted,reason};save();
  if(report.error)throw new Error(report.error);return report;
 }finally{page.off('response',listener);await Promise.allSettled([...pending]);await browser.close().catch(()=>{});}
}
