import fs from 'node:fs';
import path from 'node:path';
export async function collect(options){
  if(options.platform==='toutiao'){const {collectToutiao}=await import('./toutiao.mjs');return collectToutiao(options);}
  let backend='cdp';try{backend=JSON.parse(fs.readFileSync(path.join(options.dataDir||path.join(options.root,'data'),'settings.json'),'utf8')).captureBackend||'cdp';}catch{}
  if(options.store.sourceActions().length)backend='cdp';
  if(backend==='bsk'){const {collect}=await import('./collector-bsk.mjs');return collect(options);}
  const {collectCDP}=await import('./collector-cdp.mjs');return collectCDP(options);
}
