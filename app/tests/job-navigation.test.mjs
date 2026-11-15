import test from 'node:test';
import assert from 'node:assert/strict';
import {captureReturnContext,normalizeReturnContext} from '../public/job-navigation.js';

test('发起分析时保存主题、搜索、分页及 Focus 会话，页面状态改变后仍可恢复',()=>{
  const state={route:'library',scope:'knowledge',category:'AI 与编程',source:'collection',status:'unread',q:'缓存 #1',page:3,session:{id:7}};
  const saved=captureReturnContext(state,842);
  state.route='sync';state.category='';state.page=0;
  const restored=normalizeReturnContext(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.route,'library');assert.equal(restored.category,'AI 与编程');assert.equal(restored.q,'缓存 #1');assert.equal(restored.page,3);assert.equal(restored.scrollY,842);assert.equal(restored.sessionId,7);
});
test('没有发起页面信息的历史任务回到知识库，不能跳到外部地址',()=>{
  assert.equal(normalizeReturnContext().route,'library');
  assert.equal(normalizeReturnContext({route:'https://untrusted.example'}).route,'library');
  assert.equal(normalizeReturnContext({route:'review',scope:'excluded'}).scope,'excluded');
});

test('任务回跳保留头条来源，旧任务默认抖音',()=>{assert.equal(captureReturnContext({route:'library',platform:'toutiao'},0).platform,'toutiao');assert.equal(normalizeReturnContext({platform:'toutiao'}).platform,'toutiao');assert.equal(normalizeReturnContext().platform,'douyin');});
