import test from 'node:test';
import assert from 'node:assert/strict';
import {simplified,simplifiedContent} from '../lib/text.mjs';
import {createStore} from '../lib/store.mjs';

test('简体转换保留英文、音标、数字、原始代码和链接',()=>{
  const input='學習筆記：投資與資產輪動。English aˈɡriː 2026\n`const 標題="繁體"`\n```js\nconst 變量=1;\n```\nhttps://example.com/繁體?q=學習\n繼續複習';
  const result=simplified(input);
  assert(result.startsWith('学习笔记：投资与资产轮动。English aˈɡriː 2026'));
  for(const part of ['`const 標題="繁體"`','```js\nconst 變量=1;\n```','https://example.com/繁體?q=學習'])assert(result.includes(part));
  assert(result.endsWith('继续复习'));assert.equal(simplified(result),result);
});
test('新识别正文和图文内容统一简体，时间戳和图片来源保留',()=>{
  const x=simplifiedContent({text:'[圖片 2] 認識資產輪動',segments:[{start:1.25,end:4,text:'這是學習方法'}],source:'AI 原图识别（2 张）'});
  assert.equal(x.text,'[图片 2] 认识资产轮动');assert.deepEqual(x.segments,[{start:1.25,end:4,text:'这是学习方法'}]);assert.equal(x.source,'AI 原图识别（2 张）');
});
test('已有识别结果就地转为简体，笔记、学习状态、时间戳和手写内容不丢失',()=>{
  const s=createStore(':memory:'),id='1234567890123456789',manualId='1234567890123456790';
  s.importItems([{id,title:'原始標題',sources:['collection']},{id:manualId,title:'人工正文',sources:['collection']}]);
  s.patch(id,{note:'我的手寫筆記',status:'learned'});s.patch(manualId,{transcript:'手動輸入的繁體正文'});
  s.db.prepare('UPDATE videos SET transcript=?,segments=?,content_source=?,summary=?,points=?,questions=?,summary_basis=? WHERE id=?').run('投資與資產輪動','[{"start":8.5,"text":"學習方法"}]','本地 Whisper 转写','複習重點','[{"text":"認識風險","time":8.5,"page":null}]','["如何複習？"]','transcript',id);
  assert.deepEqual(s.simplifyGeneratedContent(),{updated:1,transcripts:1});const v=s.get(id);
  assert.equal(v.transcript,'投资与资产轮动');assert.equal(v.segments[0].start,8.5);assert.equal(v.segments[0].text,'学习方法');assert.equal(v.summary,'复习重点');assert.equal(v.points[0].time,8.5);assert.equal(v.questions[0],'如何复习？');
  assert.equal(v.title,'原始標題');assert.equal(v.note,'我的手寫筆記');assert.equal(v.status,'learned');assert.equal(s.get(manualId).transcript,'手動輸入的繁體正文');assert.equal(s.list({q:'资产轮动'}).total,1);
  assert.deepEqual(s.simplifyGeneratedContent(),{updated:0,transcripts:0});
  s.content(id,{text:'這是新的識別結果',source:'平台字幕',segments:[{start:0,text:'學習'}]});s.summary(id,{summary:'學習筆記',points:[{text:'要點',time:0}],questions:['學到了什麼？']});assert.equal(s.get(id).transcript,'这是新的识别结果');assert.equal(s.get(id).summary,'学习笔记');assert.equal(s.get(id).questions[0],'学到了什么？');s.close();
});
