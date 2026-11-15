import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {normalizeAweme,findAwemes} from './normalize.mjs';
import {applySourceActions,douyinSourceAdapter} from './source-actions.mjs';
const sources=[['collection','收藏'],['like','喜欢']];
const sourceOf=url=>/\/aweme\/listcollection\/|\/collects\/video\/list\//.test(url)?'collection':/\/aweme\/favorite\//.test(url)?'like':null;
const scrollPage=()=>{
  const all=[...new Set([document.scrollingElement,...document.querySelectorAll('*')])];let moved=false;
  for(const e of all){if(!e||e.clientHeight<100||e.clientWidth<100||e.scrollHeight<=e.clientHeight+100)continue;if(e!==document.scrollingElement&&e.getBoundingClientRect().height===0)continue;const before=e.scrollTop;e.scrollTop=Math.min(e.scrollHeight-e.clientHeight,e.scrollTop+Math.max(900,e.clientHeight*.9));if(before!==e.scrollTop){moved=true;e.dispatchEvent(new Event('scroll'));}}
  window.dispatchEvent(new Event('scroll'));return moved;
};
export async function collectCDP({root,dataDir=path.join(root,'data'),store,signal,onProgress,limit=5000,mode='full'}){
  const actions=store.sourceActions().filter(a=>['pending','failed'].includes(a.state));let captureEnabled=actions.length===0;
  const profile=path.join(dataDir,'browser-profile');fs.mkdirSync(profile,{recursive:true,mode:0o700});
  const candidates=[process.env.FOCUS_BROWSER_PATH,'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  const executablePath=candidates.find(p=>fs.existsSync(p));if(!executablePath)throw new Error('没有找到 Edge 或 Chrome，可设置 FOCUS_BROWSER_PATH');
  const known=new Set(store.all().map(v=>v.id));const found={collection:new Map(),like:new Map()};const exhausted={collection:false,like:false};const pages={collection:0,like:0};const errors=[];
  const report={sources:{},added:0,updated:0,completed:false,backend:'cdp'};let browser;
  let lastSavedCount=0,requests=new Set();
  const save=()=>store.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('last_sync',?)").run(JSON.stringify({...report,at:new Date().toISOString()}));
  try{
    onProgress('打开专用浏览器 · 登录态只保存在本机');
    browser=await puppeteer.launch({executablePath,userDataDir:profile,headless:false,defaultViewport:null,args:['--no-first-run','--no-default-browser-check','--disable-session-crashed-bubble','--mute-audio','--disk-cache-size=52428800','--media-cache-size=52428800']});
    const page=await browser.newPage();await page.setViewport({width:1280,height:900});await page.bringToFront();
    const abort=()=>{void browser.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
    page.on('response',response=>{
      if(!captureEnabled)return;
      if(response.request().method()==='OPTIONS')return;
      const source=sourceOf(response.url());if(!source)return;
      const pending=(async()=>{
        try{
          const payload=await response.json();if(payload.status_code&&payload.status_code!==0){errors.push('平台返回状态异常，请检查登录或验证码');return;}
          const items=findAwemes(payload).map(x=>normalizeAweme(x,source)).filter(Boolean);
          if(!items.length&&payload.has_more==null)return;
          const r=store.importItems(items);report.added+=r.added;report.updated+=r.updated;lastSavedCount+=r.added;
          for(const v of items)found[source].set(v.id,v);
          pages[source]++;
          const primaryList=source==='like'||/\/aweme\/listcollection\//.test(response.url());
          if(primaryList&&[0,false,'0','false'].includes(payload.has_more))exhausted[source]=true;
        }catch(e){if(!/Unexpected end|No data found|No resource with|Unexpected token|not available|preflight/i.test(e.message))errors.push(e.message.slice(0,150));}
      })();requests.add(pending);pending.finally(()=>requests.delete(pending));
    });
    await page.goto('https://www.douyin.com/user/self',{waitUntil:'domcontentloaded',timeout:60000});
    const logged=()=>page.evaluate(()=>{const names=[...document.querySelectorAll('[role="tab"]')].map(x=>x.textContent.trim());return names.some(t=>/^收藏\s*\d*$/.test(t))&&names.some(t=>/^喜欢\s*\d*$/.test(t));}).catch(()=>false);
    const deadline=Date.now()+10*60*1000;let notified=false;
    while(!(await logged())){
      signal.throwIfAborted();if(Date.now()>deadline)throw new Error('等待扫码登录超时，已保留已有资料');
      if(!notified){onProgress('等待扫码登录：请在专用浏览器里用抖音 App 扫码，登录后自动继续');notified=true;}
      await sleep(1000,undefined,{signal});
    }
    await sleep(2000,undefined,{signal});
    if(actions.length){
      report.actions=await applySourceActions({store,actions,adapter:douyinSourceAdapter(page,signal),signal,onProgress});save();
      // Detail visits must finish before a fresh list scan can import any sources.
      captureEnabled=true;
      await page.goto('https://www.douyin.com/user/self',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForSelector('[role="tab"]',{timeout:30000});await sleep(2000,undefined,{signal});
    }
    for(const [source,label] of sources){
      signal.throwIfAborted();onProgress(`正在打开${label}列表`);
      const opened=await page.evaluate(label=>{const e=[...document.querySelectorAll('[role="tab"]')].find(t=>new RegExp('^'+label+'\\s*\\d*$').test(t.textContent.trim()));if(!e)return false;e.click();return true;},label);
      if(!opened)throw new Error(`未找到${label}入口，请检查抖音页面`);
      if(source==='collection'){
        await sleep(800,undefined,{signal});
        await page.evaluate(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent.trim()==='视频');if(tab)tab.click();});
      }
      let idle=0,last=-1,reason='达到滚动次数上限';
      for(let step=0;step<2000;step++){
        await sleep(2200+Math.floor(Math.random()*1000),undefined,{signal});signal.throwIfAborted();await Promise.allSettled([...requests]);
        const count=found[source].size;onProgress(`同步${label}：${count} 条 · 本次新增 ${lastSavedCount} 条`);
        report.sources[source]={count,pages:pages[source],complete:exhausted[source],reason:'正在扫描'};save();
        if(exhausted[source]){reason='平台已返回列表末尾';break;}
        if(count>=limit){reason=`达到本次上限 ${limit}`;break;}
        const overlap=[...found[source].keys()].filter(id=>known.has(id)).length;
        if(mode==='incremental'&&step>=2&&overlap>=20){reason='已遇到历史条目，结束增量读取';break;}
        idle=count===last?idle+1:0;last=count;
        if(idle>=10){reason=count?'连续无新数据，未确认到底':'未读取到列表数据';break;}
        const challenge=await page.evaluate(()=>/(请完成下列验证|拖动滑块|安全验证|验证码登录)/.test(document.body.innerText));
        if(challenge){onProgress('抖音需要验证：请在专用浏览器完成验证，完成后自动继续');let waited=0;while(await page.evaluate(()=>/(请完成下列验证|拖动滑块|安全验证)/.test(document.body.innerText))){await sleep(1000,undefined,{signal});signal.throwIfAborted();if(++waited>600)throw new Error('验证等待超时');}}
        await page.mouse.move(20,450);await page.mouse.wheel({deltaY:1000});await page.evaluate(scrollPage);
      }
      await Promise.allSettled([...requests]);report.sources[source]={count:found[source].size,pages:pages[source],complete:exhausted[source],reason};save();
      if(!found[source].size)errors.push(`${label}未读取到数据`);
    }
    report.completed=sources.every(([s])=>report.sources[s]?.complete);report.errors=errors;save();
    if(errors.length&&sources.every(([s])=>!found[s].size))throw new Error(errors.join('；'));
    return report;
  }finally{await Promise.allSettled([...requests]);if(browser)await browser.close().catch(()=>{});}
}
