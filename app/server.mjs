import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {backup} from 'node:sqlite';
import {createStore} from './lib/store.mjs';
import {ModelClient} from './lib/model.mjs';
import {Jobs} from './lib/jobs.mjs';
import {mediaFetch,mediaAllowed,imageBytes} from './lib/content.mjs';
import {PLATFORMS,platformId} from './lib/platforms.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),dataDir=process.env.FOCUS_DATA_DIR||path.join(root,'data');
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});fs.chmodSync(dataDir,0o700);
const model=new ModelClient(dataDir);
async function createWorkspace(platform,directory){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const store=createStore(path.join(directory,'library.sqlite'),{platform});
 if(!store.db.prepare("SELECT value FROM meta WHERE key='generated_simplified_v1'").get()){
  if(store.db.prepare("SELECT COUNT(*) n FROM videos WHERE transcript<>'' OR summary<>''").get().n){
   const dir=path.join(directory,'backups');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,`before-simplified-${Date.now()}.sqlite`);await backup(store.db,file);fs.chmodSync(file,0o600);
  }
  store.simplifyGeneratedContent();
 }
 return {store,dataDir:directory,jobs:new Jobs({store,model,root,dataDir:directory,platform})};
}
const workspaces={douyin:await createWorkspace('douyin',dataDir),toutiao:await createWorkspace('toutiao',path.join(dataDir,'toutiao'))};
const store=workspaces.douyin.store;
const port=Number(process.env.PORT)||4317,host='127.0.0.1';
const seed=path.join(dataDir,'phase1-capture.json');
if(fs.existsSync(seed)&&store.db.prepare('SELECT COUNT(*) n FROM videos').get().n===0){const x=JSON.parse(fs.readFileSync(seed,'utf8'));store.importItems(Object.values(x.items||{}));}
function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(typeof data==='string'?data:JSON.stringify(data));}
async function body(req){let size=0,text='';for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new Error('请求超过 8MB 限制');text+=chunk;}return text?JSON.parse(text):{};}
const publicVideo=v=>{if(!v)return v;const {media,subtitles,images,...rest}=v;return {...rest,imageCount:images.length,hasMedia:!!media};};
function markdown(v){return `# ${v.display_title.replace(/\n/g,' ')}\n\n${v.custom_title?'原始标题和简介：'+v.title+'\n\n':''}作者：${v.author}\n来源：${v.sources.map(s=>s==='like'?'喜欢':'收藏').join('、')}\n分类：${v.category}\n原文：${v.url}\n\n## 学习笔记\n\n${v.summary||'尚未生成正文总结'}\n\n${v.points.map(p=>'- '+p.text).join('\n')}\n\n## 自测\n\n${v.questions.map(q=>'- '+q).join('\n')}\n\n## 我的笔记\n\n${v.note}\n\n## 正文\n\n${v.transcript||'尚未提取正文'}\n`;}
const server=http.createServer(async(req,res)=>{
  try {
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(res,403,{error:'仅支持本机访问'});
    const origin=req.headers.origin;
    if(origin&&![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin))return send(res,403,{error:'不允许跨站请求'});
    if(req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'不允许跨站请求'});
    const url=new URL(req.url,`http://${host}:${port}`),p=url.pathname;
    const platform=platformId(req.headers['x-focus-platform']||url.searchParams.get('platform')||'douyin'),{store,jobs,dataDir:workspaceDataDir}=workspaces[platform];
    if(p.startsWith('/api/')&&req.method!=='GET'&&req.headers['content-type']?.split(';')[0]!=='application/json')return send(res,415,{error:'请使用 JSON 请求'});
    if(p==='/api/bootstrap'&&req.method==='GET'){
      const meta=store.db.prepare("SELECT value FROM meta WHERE key='last_sync'").get();
      return send(res,200,{platform,platforms:Object.entries(PLATFORMS).map(([id,p])=>({id,name:p.name})),stats:store.stats(),settings:model.public(),jobs:jobs.list(),sourceActions:store.sourceActions(),lastSync:meta?JSON.parse(meta.value):null});
    }
    if(p==='/api/videos'&&req.method==='GET'){const x=store.list(Object.fromEntries(url.searchParams));return send(res,200,{...x,items:x.items.map(publicVideo)});}
    const action=p.match(/^\/api\/videos\/(\d+)\/source-actions$/);
    if(action&&req.method==='POST'){const x=await body(req);return send(res,200,publicVideo(store.stageSource(action[1],x.source)));}
    const undo=p.match(/^\/api\/source-actions\/(\d+)\/cancel$/);
    if(undo&&req.method==='POST')return send(res,200,publicVideo(store.cancelSource(Number(undo[1]))));
    const allow=p.match(/^\/api\/source-actions\/(\d+)\/allow-sync$/);
    if(allow&&req.method==='POST')return send(res,200,publicVideo(store.allowSource(Number(allow[1]))));
    const image=p.match(/^\/api\/videos\/(\d+)\/images\/(\d+)$/);
    if(image&&req.method==='GET'){
      const v=store.get(image[1]),index=Number(image[2]);if(!v||index>=v.images.length)return send(res,404,{error:'图片不存在'});
      const {bytes,mime}=await imageBytes(v.images[index],undefined,{referer:platform==='toutiao'?'https://www.toutiao.com/':'https://www.douyin.com/'});res.writeHead(200,{'Content-Type':mime,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});return res.end(bytes);
    }
    const match=p.match(/^\/api\/videos\/(\d+)(?:\/(export|cover))?$/);
    if(match){const v=store.get(match[1]);if(!v)return send(res,404,{error:'内容不存在'});
      if(req.method==='GET'){
        if(match[2]==='export')return send(res,200,markdown(v),{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${v.id}.md"`});
        if(match[2]==='cover'){
          if(!mediaAllowed(v.cover))return send(res,404,{error:'无封面'});
          const cache=path.join(workspaceDataDir,'covers');fs.mkdirSync(cache,{recursive:true});const file=path.join(cache,v.id);
          if(fs.existsSync(file)){res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});return fs.createReadStream(file).pipe(res);}
          const r=await mediaFetch(v.cover,undefined,{referer:platform==='toutiao'?'https://www.toutiao.com/':'https://www.douyin.com/'});if(!r.headers.get('content-type')?.startsWith('image/'))return send(res,415,{error:'无效封面'});
          const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>5*1024*1024)throw new Error('封面过大');fs.writeFileSync(file,bytes);
          res.writeHead(200,{'Content-Type':r.headers.get('content-type'),'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(bytes);
        }
        return send(res,200,publicVideo(v));
      }
      if(req.method==='PATCH'&&!match[2])return send(res,200,publicVideo(store.patch(v.id,await body(req))));
    }
    if(p==='/api/settings'&&req.method==='POST')return send(res,200,model.save(await body(req)));
    if(p==='/api/settings/test'&&req.method==='POST')return send(res,200,await model.test());
    if(p==='/api/jobs'&&req.method==='GET')return send(res,200,jobs.list());
    if(p==='/api/jobs'&&req.method==='POST'){const x=await body(req);return send(res,202,jobs.start(x.type,x.options||{}));}
    if(p==='/api/jobs/cancel'&&req.method==='POST')return send(res,200,jobs.cancel());
    if(p==='/api/import'&&req.method==='POST'){const x=await body(req);const items=Array.isArray(x)?x:Array.isArray(x.items)?x.items:Object.values(x.items||{});if(!items.length)throw new Error('未找到内容条目，请导入工作台采集的 JSON');return send(res,200,store.importItems(items));}
    if(p==='/api/export'&&req.method==='GET'){
      const videos=store.all().filter(v=>v.knowledge==='yes');
      return send(res,200,{platform,exportedAt:new Date().toISOString(),stats:store.stats(),items:videos.map(publicVideo)},{'Content-Disposition':'attachment; filename="knowledge-library.json"'});
    }
    if(p==='/api/sessions'&&req.method==='GET')return send(res,200,store.db.prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT 10').all().map(x=>({...x,video_ids:JSON.parse(x.video_ids),completed:JSON.parse(x.completed)})));
    if(p==='/api/sessions'&&req.method==='POST'){
      const x=await body(req),category=String(x.category||''),minutes=Math.max(5,Math.min(120,Number(x.minutes)||20));
      const items=store.all().filter(v=>v.knowledge==='yes'&&(!category||v.category===category)).filter(v=>v.status!=='learned').sort((a,b)=>Number(!!b.summary)-Number(!!a.summary)||Number(b.status==='learning')-Number(a.status==='learning'));
      const selected=[];let duration=0;
      for(const v of items){if(selected.length>=12)break;const d=v.duration||180;if(selected.length&&duration+d>minutes*60)continue;selected.push(v.id);duration+=d;}
      if(!selected.length)throw new Error('这个主题没有待学视频，可以将已学条目标记为值得重看');
      const r=store.db.prepare('INSERT INTO sessions(category,minutes,video_ids) VALUES(?,?,?)').run(category,minutes,JSON.stringify(selected));
      const needsNotes=selected.filter(id=>!store.get(id).summary);
      const preparingNotes=needsNotes.length>0&&model.configured()&&model.settings.autoFocusNotes!==false;
      if(preparingNotes)jobs.enqueue('process',{ids:needsNotes,limit:needsNotes.length,returnContext:{route:'focus',platform,sessionId:Number(r.lastInsertRowid)}});
      return send(res,200,{id:Number(r.lastInsertRowid),category,minutes,video_ids:selected,completed:[],note:'',duration,preparingNotes});
    }
    if(/^\/api\/sessions\/\d+$/.test(p)&&req.method==='GET'){
      const session=store.db.prepare('SELECT * FROM sessions WHERE id=?').get(Number(p.split('/').at(-1)));
      if(!session)return send(res,404,{error:'学习记录不存在'});
      return send(res,200,{...session,video_ids:JSON.parse(session.video_ids),completed:JSON.parse(session.completed)});
    }
    if(/^\/api\/sessions\/\d+$/.test(p)&&req.method==='PATCH'){
      const id=Number(p.split('/').at(-1)),x=await body(req),old=store.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);if(!old)throw new Error('学习记录不存在');
      const ids=JSON.parse(old.video_ids),done=x.completed||JSON.parse(old.completed);if(!Array.isArray(done)||done.some(v=>!ids.includes(v)))throw new Error('学习记录含无效条目');
      store.db.prepare('UPDATE sessions SET completed=?,note=? WHERE id=?').run(JSON.stringify(done),String(x.note??old.note).slice(0,10000),id);return send(res,200,{ok:true});
    }
    if(p==='/api/topic'&&req.method==='GET'){const c=url.searchParams.get('category');const x=store.db.prepare('SELECT * FROM topic_summaries WHERE category=?').get(c);return send(res,200,x?{...x,summary:JSON.parse(x.summary),video_ids:JSON.parse(x.video_ids)}:null);}
    if(p==='/api/health')return send(res,200,{ok:true});
    if(p.startsWith('/api/'))return send(res,404,{error:'接口不存在'});
    if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'不支持该操作'});
    const files={'/':'index.html','/app.js':'app.js','/job-navigation.js':'job-navigation.js','/styles.css':'styles.css'};const file=files[p];if(!file)return send(res,404,{error:'页面不存在'});
    const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
    res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
    if(req.method==='HEAD')res.end();else res.end(fs.readFileSync(path.join(root,'public',file)));
  } catch(e){if(!res.headersSent)send(res,400,{error:e.message});else res.end();}
});
server.listen(port,host,()=>console.log(`拾知学习工作台：http://${host}:${port}`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{for(const w of Object.values(workspaces)){w.jobs.stopping=true;w.jobs.active?.controller.abort();}server.close(()=>{for(const w of Object.values(workspaces))w.store.close();process.exit(0);});});
