import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {locateSourceButton} from '../lib/source-actions.mjs';

const executablePath=[process.env.FOCUS_BROWSER_PATH,'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p&&fs.existsSync(p));
test('长点赞数不会使鼠标悬停到数字；只定位当前操作栏的心形与收藏图标',{skip:!executablePath},async()=>{
  const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-first-run','--mute-audio']});
  try{
    const page=await browser.newPage();
    await page.setContent(`<style>.row{display:flex;margin:80px}.item{display:flex;width:240px;height:40px;align-items:center;gap:16px}.icon{display:block;width:24px;height:24px;background:#f88}.tooltip{display:none;position:absolute;top:10px;left:80px}</style>
      <div class="row"><div class="item"><div id="like-icon" class="icon" data-popupid="like-tip" aria-describedby="like-tip"></div><span>9999.9万</span></div><div class="item">评论</div><div class="item"><div id="collect-icon" class="icon" data-popupid="collect-tip" aria-describedby="collect-tip"></div><span>9999.9万</span></div><div class="item" data-e2e="video-share-icon-container">分享</div></div>
      <div class="tooltip" role="tooltip" id="like-tip">点赞</div><div class="tooltip" role="tooltip" id="collect-tip">收藏</div>
      <script>for(const icon of document.querySelectorAll('.icon')){const tip=document.getElementById(icon.dataset.popupid);icon.addEventListener('mouseenter',()=>tip.style.display='block');icon.addEventListener('mouseleave',()=>tip.style.display='none');}</script>`);
    // This reproduces the original failure: the wide count shifts the item centre.
    await (await page.$('.item')).hover();
    assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('like-tip')).display),'none');
    for(const source of ['like','collection']){
      const handle=await locateSourceButton(page,source,new AbortController().signal);
      assert.equal(await handle.evaluate(e=>e.id),source==='like'?'like-icon':'collect-icon');await handle.dispose();
    }
  }finally{await browser.close();}
});
