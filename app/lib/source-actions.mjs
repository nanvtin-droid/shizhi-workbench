import {setTimeout as sleep} from 'node:timers/promises';
import {findAwemes} from './normalize.mjs';

export async function locateSourceButton(page,source,signal){
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-e2e="video-share-icon-container"],[data-e2e="note-detail"] [data-e2e="video-player-collect"]')].some(e=>e.getBoundingClientRect().width>0),{timeout:20000});
  const target=await page.evaluateHandle(source=>{
    const noteButtons=[...document.querySelectorAll(`[data-e2e="note-detail"] [data-e2e="${source==='collection'?'video-player-collect':'video-player-digg'}"]`)].filter(e=>e.getBoundingClientRect().width>0);
    if(noteButtons.length===1&&['video-player-is-collected','video-player-no-collected','video-player-is-digged','video-player-no-digged'].includes(noteButtons[0].getAttribute('data-e2e-state')))return noteButtons[0];
    const shares=[...document.querySelectorAll('[data-e2e="video-share-icon-container"]')].filter(e=>e.getBoundingClientRect().width>0);
    if(shares.length!==1)return null;
    const items=[...shares[0].parentElement.children];
    if(items.length!==4||items[3]!==shares[0])return null;
    // The whole row item includes the count. Its centre can be outside the icon,
    // so hovering it fails to open the label when the count is wide.
    const item=items[source==='collection'?2:0];
    return item.querySelector('[data-popupid][aria-describedby]');
  },source);
  try{
    const element=target.asElement();if(!element)throw new Error('抖音操作栏已变化，未执行点击');
    if(await element.evaluate(e=>!!e.getAttribute('data-e2e-state')))return target;
    await element.hover();await sleep(1000,undefined,{signal});
    // Douyin uses “收藏” / “点赞” even when active; the API determines direction.
    const expected=source==='collection'?['收藏','取消收藏']:['点赞','取消点赞'];
    const confirmed=await page.evaluate(expected=>[...document.querySelectorAll('[role="tooltip"],.semi-tooltip-wrapper')].some(e=>e.getBoundingClientRect().width>0&&expected.includes(e.innerText.trim())),expected);
    if(!confirmed)throw new Error(`程序未识别到抖音的${source==='collection'?'收藏':'点赞'}图标，本次未点击；无需手动确认，可重试同步`);
    return target;
  }catch(e){await target.dispose();throw e;}
}

export async function verifySourceRemoved(adapter,video,source,{signal,wait=sleep}={}){
  // Platform detail responses can briefly lag behind a successful toggle.
  // Re-read a few times; this function must never click the toggle again.
  for(let attempt=0;attempt<3;attempt++){
    signal?.throwIfAborted();const state=await adapter.inspect(video,source);
    if(state===0)return true;
    if(state!==1)return false;
    if(attempt<2)await wait(2000,undefined,{signal});
  }
  return false;
}

// A retry always reads remote state first. Never retry a toggle blindly.
export async function applySourceActions({store,actions,adapter,signal,onProgress=()=>{}}){
  const report={succeeded:0,failed:0,errors:[],videoIds:[]};
  for(const action of actions){
    signal.throwIfAborted();
    const claimed=store.db.prepare("UPDATE source_actions SET state='running',error='',attempts=attempts+1,updated=CURRENT_TIMESTAMP WHERE id=? AND state IN ('pending','failed')").run(action.id);
    if(!claimed.changes)continue;
    if(!report.videoIds.includes(action.video_id))report.videoIds.push(action.video_id);
    const v=store.get(action.video_id),label=action.source==='collection'?'收藏':'喜欢';
    onProgress(`取消${label} · ${v.title.slice(0,35)}`);
    try{
      const state=await adapter.inspect(v,action.source);
      if(state!==0&&state!==1)throw new Error('无法确定抖音当前状态，未执行点击');
      if(state===1){
        await adapter.remove(v,action.source);signal.throwIfAborted();
        if(!await verifySourceRemoved(adapter,v,action.source,{signal}))throw new Error('抖音状态暂未确认已取消，已保留待复查；无需再次手动点击');
      }
      store.finishSource(action.id);report.succeeded++;
    }catch(e){
      const message=signal.aborted?'同步已暂停；下次先复查抖音状态':e.message;
      store.finishSource(action.id,message);report.failed++;report.errors.push({id:v.id,source:action.source,message:`取消${label}：${message}`});
      if(signal.aborted)throw e;
    }
  }
  return report;
}

export function douyinSourceAdapter(page,signal){
  let current=null;
  return {
    async inspect(video,source){
      current=null;await page.setCacheEnabled?.(false);let resolveDetail;
      const detail=new Promise(resolve=>resolveDetail=resolve);
      const listener=async response=>{
        if(response.request().method()==='OPTIONS'||!new URL(response.url()).pathname.match(/^\/aweme\/v1\/web\/aweme\/(detail|post)\/$/))return;
        try{const x=await response.json(),v=findAwemes(x).find(v=>String(v.aweme_id||v.awemeId)===video.id);if(x.status_code===0&&v)resolveDetail(v);}catch{}
      };
      page.on('response',listener);const timeout=new AbortController();
      try{
        await page.goto(video.url,{waitUntil:'domcontentloaded',timeout:60000});
        const raw=await Promise.race([detail,sleep(25000,undefined,{signal:AbortSignal.any([signal,timeout.signal])})]);
        if(!raw)throw new Error('未取得本条视频的抖音状态，请检查登录、视频可见性或验证提示');
        const value=raw[source==='collection'?'collect_stat':'user_digged'];
        if(value!==0&&value!==1)throw new Error('抖音未返回明确的收藏或喜欢状态');
        current={id:video.id,source,value};return value;
      }finally{timeout.abort();page.off('response',listener);}
    },
    async remove(video,source){
      signal.throwIfAborted();
      if(current?.id!==video.id||current.source!==source||current.value!==1)throw new Error('尚未确认需要取消的来源');
      const target=await locateSourceButton(page,source,signal),element=target.asElement();
      try{
        if(new URL(page.url()).pathname.match(/^\/(?:video|note)\/(\d+)\/?$/)?.[1]!==video.id)throw new Error('页面已切换到其他条目，未执行点击');
        const domState=await element.evaluate(e=>e.getAttribute('data-e2e-state'));
        if(domState&&domState!==(source==='collection'?'video-player-is-collected':'video-player-is-digged'))throw new Error('页面状态与平台响应不一致，未执行点击');
        current=null;await element.click();await sleep(2000,undefined,{signal});
      }finally{await target.dispose();}
    }
  };
}
