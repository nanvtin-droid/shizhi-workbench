// CLI alternative for full sync. Same collector used by the workbench.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore} from '../lib/store.mjs';
import {collect} from '../lib/collector.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store=createStore(path.join(root,'data/library.sqlite'));
const abort=new AbortController();process.on('SIGINT',()=>abort.abort());
try{const r=await collect({root,store,signal:abort.signal,onProgress:console.log,limit:10000,mode:'full',sessionId:process.env.FOCUS_SYNC_SESSION||null});console.log(JSON.stringify(r));}catch(e){console.error(e.message);process.exitCode=1;}finally{store.close();}
