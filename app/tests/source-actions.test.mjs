import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {applySourceActions} from '../lib/source-actions.mjs';
const id='1234567890123456789';
function setup(){const s=createStore(':memory:');s.importItems([{id,title:'保留学习笔记',sources:['collection','like']}]);s.patch(id,{note:'自己的体会'});s.summary(id,{summary:'旧学习笔记'});return s;}
const run=(s,adapter,actions=s.sourceActions())=>applySourceActions({store:s,actions,adapter,signal:new AbortController().signal});
test('分别取消来源，成功后归档并保留笔记；旧采集包不会重新加回来源',async()=>{
 const s=setup();s.stageSource(id,'collection');assert.deepEqual(s.get(id).sources,['collection','like']);
 let remote=1,clicks=0;const adapter={inspect:async()=>remote,remove:async()=>{clicks++;remote=0;}};
 await run(s,adapter);assert.deepEqual(s.get(id).sources,['like']);assert.equal(s.get(id).summary,'旧学习笔记');assert.equal(clicks,1);
 s.stageSource(id,'like');remote=1;await run(s,adapter);assert.equal(s.get(id).archived,true);assert.equal(s.all().length,0);assert.equal(s.stats().archived,1);assert.equal(s.list({scope:'archived'}).total,1);
 s.importItems([{id,title:'过期采集数据',sources:['collection','like']}]);assert.deepEqual(s.get(id).sources,[]);assert.equal(s.get(id).note,'自己的体会');s.close();
});
test('撤销的排队项不会执行；执行中的操作不能撤销',async()=>{
 const s=setup();s.stageSource(id,'collection');const actions=s.sourceActions();s.cancelSource(actions[0].id);
 await run(s,{inspect:()=>{throw new Error('不能执行');}},actions);
 s.stageSource(id,'like');await run(s,{inspect:async()=>{assert.throws(()=>s.cancelSource(s.sourceActions()[0].id),/仅可撤销/);return 0;}});assert.deepEqual(s.get(id).sources,['collection']);s.close();
});
test('点击后结果未知时保留本地来源，重试先检查已取消状态，不会重新点赞',async()=>{
 const s=setup();s.stageSource(id,'like');let remote=1,clicks=0;
 let r=await run(s,{inspect:async()=>remote,remove:async()=>{clicks++;remote=0;throw new Error('网络中断');}});assert.equal(r.failed,1);assert(s.get(id).sources.includes('like'));
 r=await run(s,{inspect:async()=>remote,remove:async()=>clicks++});assert.equal(r.succeeded,1);assert.equal(clicks,1);assert(!s.get(id).sources.includes('like'));s.close();
});
test('未知状态和未通过刷新验证的结果不写成成功',async()=>{
 for(const state of [undefined,1]){const s=setup();s.stageSource(id,'collection');let clicks=0;const r=await run(s,{inspect:async()=>state,remove:async()=>clicks++});assert.equal(r.failed,1);assert.equal(clicks,state===1?1:0);assert(s.get(id).sources.includes('collection'));s.close();}
});
test('取消成功的来源可明确重新允许同步，再纳入抖音后来添加的来源',async()=>{
 const s=setup();s.stageSource(id,'collection');await run(s,{inspect:async()=>0});const a=s.get(id).sourceActions.find(a=>a.source==='collection');s.allowSource(a.id);s.importItems([{id,title:'重新收藏',sources:['collection']}]);assert(s.get(id).sources.includes('collection'));s.close();
});
test('抖音详情状态延迟更新时只重复读取，绝不再次切换喜欢',async()=>{
 const {verifySourceRemoved}=await import('../lib/source-actions.mjs');const states=[1,1,0];let waits=0;
 assert.equal(await verifySourceRemoved({inspect:async()=>states.shift(),remove:()=>assert.fail('校验不能点击')},{id},'like',{signal:new AbortController().signal,wait:async()=>waits++}),true);assert.equal(waits,2);assert.equal(states.length,0);
});
test('刷新持续未确认时保留待复查；重试期间清除旧错误信息',async()=>{
 const {verifySourceRemoved}=await import('../lib/source-actions.mjs');let reads=0;
 assert.equal(await verifySourceRemoved({inspect:async()=>{reads++;return 1;}},{id},'like',{wait:async()=>{}}),false);assert.equal(reads,3);
 const s=setup();s.stageSource(id,'like');s.db.prepare("UPDATE source_actions SET state='failed',error='旧错误'").run();await run(s,{inspect:async()=>{assert.equal(s.sourceActions()[0].error,'');return 0;}});s.close();
});
