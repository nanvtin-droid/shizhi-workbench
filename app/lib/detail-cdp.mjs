import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {setTimeout as sleep} from 'node:timers/promises';
import {normalizeAweme,findAwemes} from './normalize.mjs';
// Signed media links expire. Refresh only this item through the user's dedicated
// browser, rather than making the user scan the entire collection again.
export async function refreshItem(video,{dataDir,signal,onProgress}){
  const executablePath=[process.env.FOCUS_BROWSER_PATH,'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p&&fs.existsSync(p));
  if(!executablePath)throw new Error('找不到专用采集浏览器');
  let browser,stop;let item=null;const pending=new Set();
  try{
    onProgress('播放链接已过期，正在刷新这条原片的地址');
    browser=await puppeteer.launch({executablePath,userDataDir:path.join(dataDir,'browser-profile'),headless:false,defaultViewport:null,args:['--no-first-run','--no-default-browser-check','--mute-audio','--disk-cache-size=52428800','--media-cache-size=52428800']});
    const page=await browser.newPage();
    stop=()=>{void browser.close().catch(()=>{});};signal.addEventListener('abort',stop,{once:true});
    page.on('response',response=>{
      if(response.request().method()==='OPTIONS'||!/^\/aweme\/v1\/web\/aweme\/(detail|post)\/$/.test(new URL(response.url()).pathname))return;
      const task=response.json().then(data=>{const raw=findAwemes(data).find(x=>String(x.aweme_id||x.awemeId)===video.id);if(raw)item={...normalizeAweme(raw,video.sources[0]),sources:video.sources};}).catch(()=>{});
      pending.add(task);task.finally(()=>pending.delete(task));
    });
    await page.goto(video.url,{waitUntil:'domcontentloaded',timeout:60000});
    const deadline=Date.now()+60000;
    while(!item&&Date.now()<deadline){signal.throwIfAborted();await sleep(500,undefined,{signal});}
    await Promise.allSettled([...pending]);
    if(!item?.media&&!item?.images?.length)throw new Error('未能刷新原片地址，请检查专用浏览器登录或原片是否仍可访问');
    return item;
  }finally{if(stop)signal.removeEventListener('abort',stop);if(browser)await browser.close().catch(()=>{});}
}
