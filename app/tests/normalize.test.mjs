import test from 'node:test';
import assert from 'node:assert/strict';
import {findAwemes,normalizeAweme} from '../lib/normalize.mjs';
test('CDP 响应标准化保留字符串 ID、图文顺序和来源，不收集用户凭据',()=>{
 const raw={aweme_id:'7700874933169098035',desc:'知识内容',author:{nickname:'作者',uid:'不需要的用户 ID'},images:[{url_list:['https://a.douyinpic.com/1']},{url_list:['https://a.douyinpic.com/2']}],video:{duration:12345},sessionid:'不应保留'};
 const items=findAwemes({data:{aweme_list:[raw]}}).map(v=>normalizeAweme(v,'collection'));
 assert.equal(items.length,1);assert.equal(items[0].id,'7700874933169098035');assert.deepEqual(items[0].sources,['collection']);assert.equal(items[0].images.length,2);assert.equal(items[0].duration,12);assert(!('sessionid' in items[0]));assert(!JSON.stringify(items[0]).includes('不需要的用户 ID'));
});
