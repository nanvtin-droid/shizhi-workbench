import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {ModelClient} from '../lib/model.mjs';
import {imageDimensions} from '../lib/vision-image.mjs';
import {extractImages,imageMime} from '../lib/content.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');
test('真实 Chat Completions 请求包含有序原图内容块，多批完整覆盖所有图片',async()=>{
 const requests=[];const server=http.createServer(async(req,res)=>{let body='';for await(const x of req)body+=x;const j=JSON.parse(body);requests.push(j);const payload=JSON.parse(j.messages[1].content[0].text);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({pages:payload.pages.map(page=>({page,text:`第 ${page} 张原文`,visual:'图表',uncertainty:''}))})}}]}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-test-'));
 try{const model=new ModelClient(dir);model.save({baseUrl:`http://127.0.0.1:${server.address().port}`,model:'fixture-vision',visionMode:'enabled'});
 const result=await extractImages({title:'配文',images:Array.from({length:6},(_,i)=>String(i))},{model,loadImage:async()=>({bytes:png,mime:imageMime(png)})});
 assert.equal(requests.length,2);assert.deepEqual(requests.map(j=>j.messages[1].content.filter(x=>x.type==='image_url').length),[4,2]);
 const parts=requests[0].messages[1].content;assert.equal(parts[1].text,'图片 1');assert(parts[2].image_url.url.startsWith('data:image/png;base64,'));assert.equal(parts[2].image_url.detail,'original');
 for(let i=1;i<=6;i++)assert(result.text.includes(`[图片 ${i}]`));assert.equal(result.source,'AI 原图识别（6 张 · fixture-vision）');
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('缺页、错序、虚构页码必须失败，不能假装已读完图文',async()=>{
 for(const pages of [[],[{page:2,text:'错序',visual:'',uncertainty:''}]])await assert.rejects(extractImages({title:'配文',images:['x']},{model:{json:async()=>({pages})},loadImage:async()=>({bytes:png,mime:'image/png'})}),/缺页/);
});
test('自动识别只对确认支持视觉的模型开启，纯文本模型不得发送图片',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-model-'));try{const m=new ModelClient(dir);m.save({baseUrl:'https://api.deepseek.com',model:'deepseek-flash'});assert.equal(m.public().supportsVision,true);m.save({model:'deepseek-v4-pro'});assert.equal(m.supportsVision(),false);await assert.rejects(m.json('test',{},undefined,[{page:1,url:'data:image/png;base64,x'}]),/未启用原图/);assert.throws(()=>imageMime(Buffer.from('<html>error</html>')),/原图格式/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('缺页批次自动拆成单页重试，最终仍须完整有序',async()=>{
 const groups=[];const model={json:async(_s,p)=>{groups.push(p.pages);return {pages:p.pages.length>1?[]:p.pages.map(page=>({page,text:'原文',visual:'图表',uncertainty:''}))};}};
 const result=await extractImages({title:'配文',images:['a','b','c','d']},{model,loadImage:async()=>({bytes:png,mime:'image/png'})});assert(groups.length>1);for(let i=1;i<=4;i++)assert(result.text.includes(`[图片 ${i}]`));
});
test('头条可明确按最多200页识别44张图，默认40页保护仍有效',async()=>{
 const v={title:'长图文',images:Array(44).fill('x')},model={json:async(_s,p)=>({pages:p.pages.map(page=>({page,text:'原文',visual:'图表',uncertainty:''}))})},loadImage=async()=>({bytes:png,mime:'image/png'});
 await assert.rejects(extractImages(v,{model,loadImage}),/超过 40/);const result=await extractImages(v,{model,loadImage,maxImages:200});assert(result.text.includes('[图片 44]'));
});

test('长图分段保持原图页码，每段完整读取，原图编号不因分段变化',async()=>{
 const model={json:async(_s,p)=>({pages:p.pages.map(page=>({page,text:'分段原文',visual:'图表',uncertainty:''}))})};const result=await extractImages({title:'长图',images:['x']},{model,loadImage:async()=>[{bytes:png,mime:'image/png',part:1,parts:2},{bytes:png,mime:'image/png',part:2,parts:2}]});assert(result.text.includes('[图片 1]'));assert(!result.text.includes('[图片 2]'));assert(result.text.includes('原图分段 1/2'));assert(result.text.includes('原图分段 2/2'));assert.equal(imageDimensions(png).width,1);
 const webp=Buffer.alloc(30);webp.write('RIFF');webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUIntLE(539,24,3);webp.writeUIntLE(10454,27,3);assert.deepEqual(imageDimensions(webp),{width:540,height:10455});
});
