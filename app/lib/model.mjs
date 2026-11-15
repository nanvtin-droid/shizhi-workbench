import fs from 'node:fs';
import path from 'node:path';
export class ModelClient {
  constructor(dataDir){this.file=path.join(dataDir,'settings.json');this.settings=this.read();}
  read(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{return {baseUrl:'',model:'',apiKey:'',asrBaseUrl:'',asrModel:'whisper-1',asrApiKey:'',batchLimit:20};}}
  public(){const {apiKey,asrApiKey,...s}=this.settings;return {...s,visionMode:s.visionMode||'auto',supportsVision:this.supportsVision(),autoFocusNotes:s.autoFocusNotes!==false,hasKey:!!apiKey,hasAsrKey:!!asrApiKey,configured:!!(s.baseUrl&&s.model)};}
  save(input){
    const s={...this.settings};
    for(const k of ['baseUrl','model','asrBaseUrl','asrModel'])if(k in input)s[k]=String(input[k]).trim();
    for(const k of ['apiKey','asrApiKey'])if(input[k])s[k]=String(input[k]);
    if(input.clearKey)s.apiKey='';if(input.clearAsrKey)s.asrApiKey='';
    if('autoFocusNotes' in input)s.autoFocusNotes=input.autoFocusNotes===true||input.autoFocusNotes==='true';
    if('visionMode' in input){if(!['auto','enabled','disabled'].includes(input.visionMode))throw new Error('无效的图片识别设置');s.visionMode=input.visionMode;}
    for(const k of ['baseUrl','asrBaseUrl'])if(s[k]){const u=new URL(s[k]);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new Error('模型地址需使用 HTTPS，本地模型可使用 HTTP');if(u.username||u.password||u.search||u.hash)throw new Error('模型地址不应包含密钥或查询参数');s[k]=s[k].replace(/\/+$/,'');}
    s.batchLimit=Math.min(200,Math.max(1,Number(input.batchLimit??s.batchLimit)||20));
    fs.writeFileSync(this.file,JSON.stringify(s,null,2),{mode:0o600});fs.chmodSync(this.file,0o600);this.settings=s;return this.public();
  }
  configured(){return !!(this.settings.baseUrl&&this.settings.model);}
  supportsVision(){const s=this.settings;if(s.visionMode==='disabled'||!this.configured())return false;if(s.visionMode==='enabled')return true;try{return new URL(s.baseUrl).hostname==='api.deepseek.com'&&['deepseek-flash','deepseek-v4-flash-vision-exp'].includes(s.model);}catch{return false;}}
  async json(system,payload,signal,images=[]){
    system+='\n所有中文输出统一使用简体中文；英文等外语原文、代码和链接保持原样。';
    if(!this.configured())throw new Error('请先在设置中配置模型 API 地址和模型名称');
    if(images.length&&!this.supportsVision())throw new Error('当前模型未启用原图识别，请在模型与设置中选择支持图片的模型');
    const s=this.settings, url=s.baseUrl.endsWith('/chat/completions')?s.baseUrl:s.baseUrl+'/chat/completions';
    const providerOptions=new URL(s.baseUrl).hostname==='api.deepseek.com'?{thinking:{type:'disabled'},response_format:{type:'json_object'}}:{};
    const content=images.length?[{type:'text',text:JSON.stringify(payload)},...images.flatMap(x=>[{type:'text',text:`图片 ${x.page}${x.parts>1?` · 同一原图分段 ${x.part}/${x.parts}`:''}`},{type:'image_url',image_url:{url:x.url,detail:'original'}}])]:JSON.stringify(payload);
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(s.apiKey?{Authorization:`Bearer ${s.apiKey}`}:{})},body:JSON.stringify({model:s.model,...providerOptions,messages:[{role:'system',content:system},{role:'user',content}]}),signal:AbortSignal.any([AbortSignal.timeout(180000),...(signal?[signal]:[])])});
    if(!res.ok){
      const error=await res.json().catch(()=>null);
      let detail=String(error?.error?.message||'请检查地址、模型名、密钥和额度');
      if(s.apiKey)detail=detail.split(s.apiKey).join('[密钥已隐藏]');
      throw new Error(`模型服务返回 HTTP ${res.status}：${detail.slice(0,350)}`);
    }
    const data=await res.json(),text=data.choices?.[0]?.message?.content;
    if(typeof text!=='string')throw new Error('模型未返回可读取的文本');
    try{return JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new Error('模型未返回有效 JSON，本次结果未保存');}
  }
  async test(){const x=await this.json('只返回 JSON：{"ok":true}，不要包含其他内容。',{test:'连接测试'});if(x.ok!==true)throw new Error('连接成功，但模型未按要求返回 JSON');return {ok:true};}
}
