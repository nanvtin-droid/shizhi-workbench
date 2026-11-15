(() => {
  if (window.__douyinFocus) return {installed:true};
  const state = window.__douyinFocus = {items:{},pages:[],errors:[]};
  const first = x => x?.url_list?.[0] || x?.urlList?.[0] || '';
  const normalize = (x, source) => {
    if (!x || !(x.aweme_id || x.awemeId)) return;
    const id=String(x.aweme_id||x.awemeId), v=x.video||{};
    const subtitles=(v.subtitle_infos||x.subtitle_infos||[]).map(s=>({url:s.url||s.Url||'',language:s.language||s.LanguageCode||''}));
    const r = {id,title:x.desc||'',author:x.author?.nickname||'',url:`https://www.douyin.com/${x.images?.length?'note':'video'}/${id}`,duration:Math.round((v.duration||x.duration||0)/1000),cover:first(v.cover)||first(x.images?.[0]),tags:(x.text_extra||[]).map(t=>t.hashtag_name).filter(Boolean),media:first(v.play_addr_h264)||first(v.play_addr)||first(v.download_addr),images:(x.images||[]).map(first).filter(Boolean),subtitles,source,published:x.create_time||0};
    const old=state.items[id];
    r.sources=[...new Set([...(old?.sources||[]),source])];
    state.items[id]={...old,...r};
  };
  const visit=(o,source,depth=0)=>{
    if(!o||typeof o!=='object'||depth>8)return;
    if(o.aweme_id||o.awemeId){normalize(o,source);return;}
    for(const [key,v] of Object.entries(o)) if(v&&typeof v==='object' && !['author','music','statistics'].includes(key)) visit(v,source,depth+1);
  };
  const receive=(url,text)=>{
    const path=String(url).split('?')[0];
    let source = /\/aweme\/listcollection\/|\/collects\/video\/list\//.test(path)?'collection':/\/aweme\/favorite\//.test(path)?'like':null;
    if(!source)return;
    try {const json=JSON.parse(text);visit(json,source);state.pages.push({source,has_more:json.has_more??null,count:Object.keys(state.items).length,status:json.status_code??0});}catch{state.errors.push('读取列表响应失败');}
  };
  const originalFetch=window.fetch;
  window.fetch=async function(...args){const r=await originalFetch.apply(this,args);try{const u=r.url||String(args[0]);if(/aweme\/listcollection|aweme\/favorite|collects\/video\/list/.test(u))r.clone().text().then(t=>receive(u,t)).catch(()=>{});}catch{}return r;};
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...rest){this.__focusUrl=url;return open.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.send=function(...args){this.addEventListener('load',()=>{try{if(!this.responseType||this.responseType==='text')receive(this.responseURL||this.__focusUrl,this.responseText);else if(this.responseType==='json')receive(this.responseURL||this.__focusUrl,JSON.stringify(this.response));}catch{}});return send.apply(this,args);};
  return {installed:true};
})()
