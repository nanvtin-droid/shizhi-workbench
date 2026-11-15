import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
const bin=process.env.BSK_BIN||'bsk';
function bsk(args,signal,timeout=60000){return new Promise((resolve,reject)=>execFile(bin,args,{maxBuffer:30*1024*1024,timeout,signal},(err,out,stderr)=>{if(err){let detail='';try{const x=JSON.parse(out);detail=[x.message,x.hint,x.data?.reason].filter(Boolean).join(' · ');}catch{}reject(new Error(detail||stderr.replace(/A new bsk version.*\n/g,'').slice(-800)||err.message));}else resolve(out.trim());}));}
function parse(value){let x=JSON.parse(value);return typeof x==='string'?JSON.parse(x):x;}
const scroll=`(()=>{const moved=[];for(const e of [...new Set([document.scrollingElement,...document.querySelectorAll('*')])]){if(!e||e.clientHeight<100||e.clientWidth<100||e.scrollHeight<=e.clientHeight+100)continue;if(e!==document.scrollingElement&&e.getBoundingClientRect().height<=0)continue;const before=e.scrollTop;e.scrollTop=Math.min(e.scrollHeight-e.clientHeight,e.scrollTop+Math.max(800,e.clientHeight*.95));if(e.scrollTop!==before){e.dispatchEvent(new Event('scroll'));moved.push({tag:e.tagName,from:before,to:e.scrollTop,max:e.scrollHeight-e.clientHeight})}}window.dispatchEvent(new Event('scroll'));return {moved,windowY:window.scrollY}})()`;
export async function collect({root,store,signal,onProgress,limit=5000,mode='full',sessionId=null}) {
  let session=null;const report={sources:{},added:0,updated:0,completed:false};
  let baseline=null,observationSequence=0;
  const cacheDir=path.join(root,'data','browser-state');fs.mkdirSync(cacheDir,{recursive:true,mode:0o700});
  const known=new Set(store.db.prepare('SELECT id FROM videos').all().map(x=>x.id));
  try {
    onProgress('打开抖音浏览器');
    if(sessionId)session=sessionId;
    else {const start=await bsk(['session','start','--json'],signal);session=JSON.parse(start).session_id;}
    if(!session)throw new Error('浏览器连接未成功，请先运行 bsk status 检查扩展');
    const raw=(args,t=60000)=>bsk([...args,'--session',session],signal,t);
    async function sync(){
      const deadline=Date.now()+120000;
      while(Date.now()<deadline){
        signal.throwIfAborted();
        try{
          const destination=path.join(cacheDir,`${session}-${++observationSequence}.json`);
          const x=parse(await raw(['cooperate','sync','--settle','--json',...(baseline?['--baseline',baseline]:[]),'--save-full',destination]));
          if(fs.existsSync(destination)){if(baseline)fs.rmSync(baseline,{force:true});baseline=destination;}
          if(x.context_id)return x;
        }
        catch(e){if(!/cooperation_sync_required|while synchronizing|shared page control|Document changed during observation|ref_not_found/.test(e.message))throw e;}
        onProgress('等待浏览器页面稳定或交回控制');
        const wait=parse(await raw(['cooperate','wait','--timeout-ms','2000','--json']));
        if(wait.stopped)throw new Error('浏览器同步已由你停止');
      }
      throw new Error('浏览器仍由你操作，请完成操作后重新同步');
    }
    const cmd=async(args,t=60000)=>{
      if(['snapshot','request-help'].includes(args[0]))return raw(args,t);
      for(let attempt=0;attempt<8;attempt++) {
        const context=await sync();
        const text=context.observation?.text||'';
        const tabLines=text.split('\n').filter(l=>/@e\d+ tab "(?:收藏|喜欢)"/.test(l));
        const tabDependency=(tabLines.find(l=>/\[selected\]/.test(l))||tabLines[0])?.match(/@e\d+/)?.[0];
        if(!tabDependency)throw new Error('当前页面已离开收藏与喜欢入口，停止本次采集');
        const dependency=tabDependency;
        const action=args[0]==='hover'?['hover',dependency]:args[0]==='wheel'?[...args,'--ref',dependency]:args;
        try{return await raw([...action,'--context',context.context_id,'--depends-on',dependency],t);}
        catch(e){
          // A guard refusal occurs before dispatch. Re-read the page and validate
          // the task scope before deciding whether the bounded read/scroll still applies.
          if(!/shared page control|observed content changed|cooperation_sync_required|Document changed during observation|ref_not_found/.test(e.message))throw e;
          onProgress('页面动态更新，等待稳定后重新核对采集入口');
          const w=parse(await raw(['cooperate','wait','--timeout-ms','1000','--json']));
          if(w.stopped)throw new Error('浏览器同步已由你停止');
        }
      }
      throw new Error('抖音页面持续变化，暂时无法安全读取，请稍后重试');
    };
    // Only untouched blank tabs allow the initial navigation without a context.
    if(!sessionId)await raw(['navigate','https://www.douyin.com/user/self']);
    let initial=await sync();
    let snapshot=initial.observation?.text||'';
    if(/登录后即可|扫码登录|请输入手机号/.test(snapshot)) {
      onProgress('等待扫码登录：请在抖音窗口扫码，然后点击 Done/完成');
      const help=await cmd(['request-help','--prompt','请用抖音 App 扫码登录。登录成功后点击辅助面板 Done/完成。','--title','登录抖音','--timeout','10m'],660000);
      if(!/outcome=(continued|completed)/.test(help))throw new Error('登录未完成，本次同步已暂停');
      snapshot=(await sync()).observation?.text||'';
      if(/登录后即可|扫码登录/.test(snapshot))throw new Error('仍未登录，请重新同步');
    }
    await cmd(['evaluate',fs.readFileSync(path.join(root,'scripts/page-hook.js'),'utf8')]);
    const sourceOrder=sessionId?[['like','喜欢'],['collection','收藏']]:[['collection','收藏'],['like','喜欢']];
    for(const [source,label] of sourceOrder) {
      let selected=false;
      for(let attempt=0;attempt<6&&!selected;attempt++) {
        signal.throwIfAborted();const observation=await sync();snapshot=observation.observation?.text||'';
        const tab=snapshot.split('\n').find(l=>new RegExp(`@e\\d+ tab "${label}(?:[ "\\d])`).test(l));
        const ref=tab?.match(/@e\d+/)?.[0];if(!ref)throw new Error(`找不到「${label}」标签，页面结构可能已变化`);
        // Reconcile a person's successful tab selection instead of replaying a click.
        if(/\[selected\]/.test(tab)){selected=true;break;}
        try{await raw(['click',ref,'--context',observation.context_id,'--depends-on',ref]);selected=true;}
        catch(e){
          if(!/shared page control|observed content changed|cooperation_sync_required|Document changed during observation|ref_not_found/.test(e.message))throw e;
          onProgress(`页面发生变化，重新确认「${label}」当前选择`);
          const wait=parse(await raw(['cooperate','wait','--timeout-ms','1500','--json']));
          if(wait.stopped)throw new Error('浏览器同步已由你停止');
        }
      }
      if(!selected)throw new Error(`「${label}」页面持续变化，请手动打开该标签后重试`);
      const importedIds=new Set();
      let idle=0,lastCount=0,result={complete:false,reason:'limit',count:0};
      for(let step=0;step<1500;step++) {
        signal.throwIfAborted();await sleep(2500+Math.floor(Math.random()*1200),undefined,{signal});
        // Keep the pointer off video cards: hover previews continuously change
        // their unlabelled playback counters and also consume bandwidth.
        await cmd(['hover']);
        const data=parse(await cmd(['evaluate','JSON.stringify(window.__douyinFocus)']));
        if(!data?.items)throw new Error('页面采集状态丢失，请重新同步');
        const items=Object.values(data.items).filter(x=>x.sources.includes(source));
        const changed=items.filter(x=>!known.has(x.id)).length;
        const fresh=items.filter(v=>!importedIds.has(v.id));
        const imported=store.importItems(fresh);fresh.forEach(v=>importedIds.add(v.id));report.added+=imported.added;report.updated+=imported.updated;
        const pages=data.pages.filter(x=>x.source===source),last=pages.at(-1);
        onProgress(`同步${label}：${items.length} 条，新增 ${changed} 条`);
        result.count=items.length;
        if(last?.status && last.status!==0){result.reason='平台返回异常';break;}
        if(last&&[0,false,'0','false'].includes(last.has_more)){result.complete=true;result.reason='列表返回末尾';break;}
        if(items.length>=limit){result.reason=`达到本次数量上限 ${limit}`;break;}
        if(mode==='incremental'&&step>=2&&items.length>=20&&items.length-changed>=20){result.reason='已遇到历史条目，结束增量读取';break;}
        idle=items.length===lastCount?idle+1:0;lastCount=items.length;
        if(idle>=6){result.reason=items.length?'列表连续无新数据，未确认到底':'没有读取到列表数据';break;}
        await cmd(['wheel','--delta-y','1100']);
        const scrolled=await cmd(['evaluate',scroll]);
        if(process.env.FOCUS_DEBUG_SCROLL)onProgress('滚动状态 '+scrolled);
      }
      report.sources[source]=result;
      if(result.count===0)throw new Error(`「${label}」未取得数据：${result.reason}`);
    }
    report.completed=Object.values(report.sources).every(x=>x.complete);
    store.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('last_sync',?)").run(JSON.stringify({...report,at:new Date().toISOString()}));
    return report;
  } finally {if(session)await bsk(['session','stop',session],undefined,15000).catch(()=>{});if(baseline)fs.rmSync(baseline,{force:true});}
}
