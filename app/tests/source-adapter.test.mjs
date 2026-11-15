import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {douyinSourceAdapter} from '../lib/source-actions.mjs';
const video={id:'1234567890123456789',url:'https://www.douyin.com/note/1234567890123456789'};
class Page extends EventEmitter{
 constructor(value=1,dom='video-player-is-collected'){super();this.value=value;this.dom=dom;this.clicks=0;}
 async goto(){for(const id of ['9999999999999999999',video.id])this.emit('response',{request:()=>({method:()=> 'GET'}),url:()=> 'https://www.douyin.com/aweme/v1/web/aweme/post/',json:async()=>({status_code:0,aweme_list:[{aweme_id:id,collect_stat:id===video.id?this.value:0,user_digged:0}]})});}
 async waitForFunction(){}
 url(){return this.currentUrl||video.url;}
 async evaluateHandle(){const element={evaluate:async()=>this.dom,click:async()=>this.clicks++,hover:async()=>{}};return {asElement:()=>element,dispose:async()=>{}};}
}
test('图文从 post 响应读取精确 ID，不采用同一作者其他条目的状态',async()=>{const page=new Page();assert.equal(await douyinSourceAdapter(page,new AbortController().signal).inspect(video,'collection'),1);});
test('未检查来源、来源已无、或 DOM 状态冲突时不得点击',async()=>{
 for(const [value,dom] of [[0,'video-player-no-collected'],[1,'video-player-no-collected']]){const page=new Page(value,dom),adapter=douyinSourceAdapter(page,new AbortController().signal);await assert.rejects(adapter.remove(video,'collection'),/尚未确认/);await adapter.inspect(video,'collection');await assert.rejects(adapter.remove(video,'collection'));assert.equal(page.clicks,0);}
});
test('只有已确认的条目、来源与激活状态同时匹配才执行一次点击',async()=>{const page=new Page(),adapter=douyinSourceAdapter(page,new AbortController().signal);await adapter.inspect(video,'collection');await adapter.remove(video,'collection');assert.equal(page.clicks,1);await assert.rejects(adapter.remove(video,'collection'),/尚未确认/);assert.equal(page.clicks,1);});
test('自动连播或手动切换到其他视频后不得沿用上一条的状态点击',async()=>{const page=new Page(),adapter=douyinSourceAdapter(page,new AbortController().signal);await adapter.inspect(video,'collection');page.currentUrl='https://www.douyin.com/video/9999999999999999999';await assert.rejects(adapter.remove(video,'collection'),/已切换/);assert.equal(page.clicks,0);});
