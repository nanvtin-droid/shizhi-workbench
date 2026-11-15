import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {preliminary,TAXONOMY} from './classifier.mjs';
import {simplified,simplifiedContent} from './text.mjs';
import {toutiaoUrl} from './platforms.mjs';
function customTitle(value){
  if(typeof value!=='string')throw new Error('自定义标题必须是文字');
  const title=value.replace(/\s+/g,' ').trim();if(title.length>200)throw new Error('自定义标题最多 200 个字符');return title;
}
export function createStore(filename,{platform='douyin'}={}) {
  if(!['douyin','toutiao'].includes(platform))throw new Error('无效的数据来源');
  if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL DEFAULT '',url TEXT NOT NULL,duration INTEGER DEFAULT 0,cover TEXT DEFAULT '',tags TEXT DEFAULT '[]',sources TEXT DEFAULT '[]',media TEXT DEFAULT '',images TEXT DEFAULT '[]',subtitles TEXT DEFAULT '[]',published INTEGER DEFAULT 0,knowledge TEXT DEFAULT 'review',category TEXT DEFAULT '待归类',confidence REAL DEFAULT 0,reason TEXT DEFAULT '',method TEXT DEFAULT 'rule',manual INTEGER DEFAULT 0,status TEXT DEFAULT 'unread',note TEXT DEFAULT '',transcript TEXT DEFAULT '',segments TEXT DEFAULT '[]',content_source TEXT DEFAULT '',summary TEXT DEFAULT '',points TEXT DEFAULT '[]',questions TEXT DEFAULT '[]',summary_basis TEXT DEFAULT '',content_error TEXT DEFAULT '',first_seen TEXT DEFAULT CURRENT_TIMESTAMP,last_seen TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,type TEXT,state TEXT,payload TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY,category TEXT,minutes INTEGER,video_ids TEXT,completed TEXT DEFAULT '[]',note TEXT DEFAULT '',created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS topic_summaries(category TEXT PRIMARY KEY,summary TEXT,video_ids TEXT,updated TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE IF NOT EXISTS source_actions(id INTEGER PRIMARY KEY,video_id TEXT NOT NULL,source TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT DEFAULT '',attempts INTEGER DEFAULT 0,updated TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(video_id,source));`);
  if(!db.prepare('PRAGMA table_info(videos)').all().some(c=>c.name==='custom_title'))db.exec("ALTER TABLE videos ADD COLUMN custom_title TEXT NOT NULL DEFAULT ''");
  db.prepare("UPDATE source_actions SET state='failed',error='上次同步中断；下次将先检查抖音当前状态' WHERE state='running'").run();
  const sourceActions=(id)=>db.prepare(`SELECT a.*,COALESCE(NULLIF(v.custom_title,''),v.title) title FROM source_actions a JOIN videos v ON v.id=a.video_id ${id?'WHERE video_id=?':"WHERE state IN ('pending','running','failed')"} ORDER BY a.id`).all(...(id?[id]:[])).map(r=>({...r}));
  const decode=r=>{if(!r)return null;const d={...r};for(const k of ['tags','sources','images','subtitles','segments','points','questions'])d[k]=JSON.parse(d[k]||'[]');d.platform=platform;d.display_title=d.custom_title||d.title;d.archived=!d.sources.length;d.sourceActions=sourceActions(d.id);return d;};
  const get=id=>decode(db.prepare('SELECT * FROM videos WHERE id=?').get(id));
  function importItems(items) {
    let added=0,updated=0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for(const item of items) {
        if(!/^\d{10,25}$/.test(String(item.id))||!Array.isArray(item.sources)||!item.sources.length||item.sources.some(s=>!['like','collection'].includes(s)))throw new Error('视频 ID 或来源无效');
        if(item.platform&&item.platform!==platform)throw new Error('导入内容属于另一数据来源，请先切换来源');
        if(platform==='toutiao'&&item.sources.some(s=>s!=='collection'))throw new Error('今日头条目前只接入收藏来源');
        const old=get(String(item.id)),blocked=new Set(sourceActions(String(item.id)).filter(a=>a.state==='succeeded').map(a=>a.source));
        const sources=[...new Set([...(old?.sources||[]),...item.sources.filter(s=>!blocked.has(s))])];
        const normalized={...item,id:String(item.id),sources};
        const d=platform==='toutiao'?{...preliminary(normalized),knowledge:'review',confidence:.35,reason:'头条收藏内容，等待 AI 知识筛选',method:'rule'}:preliminary(normalized);
        if(!old) {
          db.prepare('INSERT INTO videos(id,title,author,url,duration,cover,tags,sources,media,images,subtitles,published,knowledge,category,confidence,reason,method) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(normalized.id,String(item.title||'未命名视频'),String(item.author||''),platform==='toutiao'?toutiaoUrl(normalized.id,item.url):`https://www.douyin.com/${item.images?.length?'note':'video'}/${normalized.id}`,Number(item.duration)||0,String(item.cover||''),JSON.stringify(item.tags||[]),JSON.stringify(sources),String(item.media||''),JSON.stringify(item.images||[]),JSON.stringify(item.subtitles||[]),Number(item.published)||0,d.knowledge,d.category,d.confidence,d.reason,d.method);added++;
          if(item.custom_title!==undefined)db.prepare('UPDATE videos SET custom_title=? WHERE id=?').run(customTitle(item.custom_title),normalized.id);
        } else {
          db.prepare("UPDATE videos SET title=?,author=?,duration=?,cover=?,tags=?,sources=?,media=?,images=?,subtitles=?,last_seen=CURRENT_TIMESTAMP WHERE id=?").run(item.title||old.title,item.author||old.author,Number(item.duration)||old.duration,item.cover||old.cover,JSON.stringify(item.tags||old.tags),JSON.stringify(sources),item.media||old.media,JSON.stringify(item.images?.length?item.images:old.images),JSON.stringify(item.subtitles?.length?item.subtitles:old.subtitles),normalized.id);
          if(platform==='toutiao')db.prepare('UPDATE videos SET url=? WHERE id=?').run(toutiaoUrl(normalized.id,item.url||old.url),normalized.id);
          // 人工修改、AI 结论和已有学习状态不会被再次同步覆盖。新增收藏来源可提升规则候选。
          if(platform==='douyin'&&!old.manual && sources.includes('collection')&&!old.sources.includes('collection'))applyDecision(normalized.id,{...d,knowledge:'yes',method:'source',reason:'新增收藏来源：按你的要求纳入知识候选'});
          else if(!old.manual && old.method!=='ai')applyDecision(normalized.id,d);
          updated++;
        }
      }
      db.exec('COMMIT');
    } catch(e){db.exec('ROLLBACK');throw e;}
    return {added,updated,total:items.length};
  }
  function applyDecision(id,d) {
    const old=get(id);if(!old||old.manual)return false;
    db.prepare('UPDATE videos SET knowledge=?,category=?,confidence=?,reason=?,method=? WHERE id=?').run(d.knowledge,d.category,d.confidence,d.reason,d.method||'ai',id);return true;
  }
  function patch(id,values) {
    const old=get(id);if(!old)throw new Error('视频不存在');
    const permitted=['knowledge','category','status','note','transcript','custom_title'];
    const entries=Object.entries(values).filter(([k])=>permitted.includes(k)).map(([k,v])=>[k,k==='custom_title'?customTitle(v):v]);
    if(values.knowledge&&!['yes','no','review'].includes(values.knowledge))throw new Error('无效的知识状态');
    if(values.status&&!['unread','learning','learned','revisit'].includes(values.status))throw new Error('无效的学习状态');
    if(entries.length)db.prepare(`UPDATE videos SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`).run(...entries.map(([,v])=>String(v).slice(0,300000)),id);
    if('knowledge' in values || 'category' in values)db.prepare("UPDATE videos SET manual=1,method='manual',reason='你的手动选择',confidence=1 WHERE id=?").run(id);
    if('transcript' in values)db.prepare("UPDATE videos SET content_source='手动导入逐字稿',summary='',points='[]',questions='[]',summary_basis='' WHERE id=?").run(id);
    return get(id);
  }
  function content(id,values) {
    const {text,segments,source}=simplifiedContent(values);
    if(platform==='toutiao'){db.prepare('UPDATE videos SET duration=? WHERE id=?').run(Number(values.duration)>0?Number(values.duration):Math.max(60,Math.ceil(text.length/300*60)),id);if(values.author)db.prepare('UPDATE videos SET author=? WHERE id=?').run(values.author,id);}
    if(platform==='toutiao'&&Array.isArray(values.images))db.prepare('UPDATE videos SET images=? WHERE id=?').run(JSON.stringify(values.images),id);
    db.prepare("UPDATE videos SET transcript=?,segments=?,content_source=?,content_error='',summary='',points='[]',questions='[]',summary_basis='' WHERE id=?").run(text,JSON.stringify(segments),source,id);
  }
  function summary(id,{summary,points=[],questions=[],basis='transcript'}) {
    db.prepare('UPDATE videos SET summary=?,points=?,questions=?,summary_basis=? WHERE id=?').run(simplified(summary),JSON.stringify(points.map(p=>({...p,text:simplified(p.text)}))),JSON.stringify(questions.map(simplified)),basis,id);
  }
  function simplifyGeneratedContent(){
    let updated=0,transcripts=0;db.exec('BEGIN IMMEDIATE');
    try{
      const write=db.prepare('UPDATE videos SET transcript=?,segments=?,summary=?,points=?,questions=? WHERE id=?');
      for(const row of db.prepare("SELECT id,transcript,segments,content_source,summary,points,questions FROM videos WHERE transcript<>'' OR summary<>''").all()){
        const manual=row.content_source==='手动导入逐字稿';
        const text=manual?row.transcript:simplified(row.transcript),segments=manual?row.segments:JSON.stringify(JSON.parse(row.segments).map(s=>({...s,text:simplified(s.text)})));
        const summary=simplified(row.summary),points=JSON.stringify(JSON.parse(row.points).map(p=>({...p,text:simplified(p.text)}))),questions=JSON.stringify(JSON.parse(row.questions).map(simplified));
        if([text,segments,summary,points,questions].some((v,i)=>v!==[row.transcript,row.segments,row.summary,row.points,row.questions][i])){write.run(text,segments,summary,points,questions,row.id);updated++;if(text!==row.transcript)transcripts++;}
      }
      db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('generated_simplified_v1',?)").run(JSON.stringify({at:new Date().toISOString(),updated,transcripts}));
      db.exec('COMMIT');return {updated,transcripts};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function stageSource(id,source){
    const v=get(id);if(!v||!['like','collection'].includes(source)||!v.sources.includes(source))throw new Error('该条目没有此来源');
    const old=v.sourceActions.find(a=>a.source===source);if(old?.state==='running')throw new Error('正在同步这项操作，请等待完成');
    db.prepare("INSERT INTO source_actions(video_id,source) VALUES(?,?) ON CONFLICT(video_id,source) DO UPDATE SET state='pending',error='',updated=CURRENT_TIMESTAMP").run(id,source);return get(id);
  }
  function cancelSource(actionId){
    const a=db.prepare('SELECT * FROM source_actions WHERE id=?').get(actionId);if(!a)throw new Error('操作不存在');
    if(!['pending','failed'].includes(a.state))throw new Error('仅可撤销尚未执行或失败的操作');
    db.prepare("UPDATE source_actions SET state='cancelled',error='',updated=CURRENT_TIMESTAMP WHERE id=?").run(actionId);return get(a.video_id);
  }
  function allowSource(actionId){
    const a=db.prepare('SELECT * FROM source_actions WHERE id=?').get(actionId);if(!a||a.state!=='succeeded')throw new Error('此来源没有已完成的取消操作');
    db.prepare("UPDATE source_actions SET state='released',updated=CURRENT_TIMESTAMP WHERE id=?").run(actionId);return get(a.video_id);
  }
  function finishSource(actionId,error=''){
    const a=db.prepare('SELECT * FROM source_actions WHERE id=?').get(actionId);if(!a||a.state!=='running')throw new Error('操作状态已改变');
    db.exec('BEGIN IMMEDIATE');try{
      if(!error){const v=get(a.video_id);db.prepare('UPDATE videos SET sources=? WHERE id=?').run(JSON.stringify(v.sources.filter(s=>s!==a.source)),a.video_id);}
      db.prepare("UPDATE source_actions SET state=?,error=?,updated=CURRENT_TIMESTAMP WHERE id=?").run(error?'failed':'succeeded',String(error).slice(0,1000),actionId);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function list({scope='knowledge',category='',source='',status='',q='',limit=100,offset=0}={}) {
    const conditions=[scope==='archived'?"json_array_length(sources)=0":"json_array_length(sources)>0"],args=[];
    if(scope==='knowledge')conditions.push("knowledge='yes'");
    else if(scope==='review')conditions.push("knowledge='review'");
    else if(scope==='excluded')conditions.push("knowledge='no'");
    else if(!['all','archived'].includes(scope))throw new Error('无效的视图');
    if(category){conditions.push('category=?');args.push(category);}
    if(source){conditions.push('EXISTS(SELECT 1 FROM json_each(videos.sources) WHERE value=?)');args.push(source);}
    if(status){conditions.push('status=?');args.push(status);}
    if(q){conditions.push("(instr(lower(title||' '||custom_title||' '||author||' '||tags||' '||transcript||' '||summary||' '||note),lower(?))>0)");args.push(q);}
    const where=conditions.length?'WHERE '+conditions.join(' AND '):'';
    const total=db.prepare(`SELECT COUNT(*) n FROM videos ${where}`).get(...args).n;
    const rows=db.prepare(`SELECT * FROM videos ${where} ORDER BY first_seen DESC,rowid ASC LIMIT ? OFFSET ?`).all(...args,Math.min(1000,Math.max(1,Number(limit)||100)),Math.max(0,Number(offset)||0)).map(decode);
    return {items:rows,total};
  }
  function stats() {
    const all=db.prepare('SELECT COUNT(*) total,SUM(knowledge=\'yes\') knowledge,SUM(knowledge=\'review\') review,SUM(knowledge=\'no\') excluded,SUM(knowledge=\'yes\' AND status=\'learned\') learned,SUM(length(summary)>0) summarized,SUM(length(transcript)>0) transcribed FROM videos WHERE json_array_length(sources)>0').get();
    all.archived=db.prepare('SELECT COUNT(*) n FROM videos WHERE json_array_length(sources)=0').get().n;
    for(const k of Object.keys(all))all[k]??=0;
    all.collection=db.prepare("SELECT COUNT(*) n FROM videos WHERE EXISTS(SELECT 1 FROM json_each(sources) WHERE value='collection')").get().n;
    all.like=db.prepare("SELECT COUNT(*) n FROM videos WHERE EXISTS(SELECT 1 FROM json_each(sources) WHERE value='like')").get().n;
    const categories=db.prepare("SELECT category name,COUNT(*) count,SUM(status='learned') learned,SUM(duration) duration,SUM(length(summary)>0) summarized FROM videos WHERE knowledge='yes' AND json_array_length(sources)>0 GROUP BY category ORDER BY count DESC").all().map(c=>({...c,...TAXONOMY.find(t=>t.name===c.name)})).map(({terms,...c})=>c);
    return {...all,categories};
  }
  return {platform,db,get,all:()=>db.prepare('SELECT * FROM videos WHERE json_array_length(sources)>0 ORDER BY first_seen DESC,rowid ASC').all().map(decode),importItems,applyDecision,patch,content,summary,simplifyGeneratedContent,list,stats,sourceActions,stageSource,cancelSource,allowSource,finishSource,close:()=>db.close()};
}
