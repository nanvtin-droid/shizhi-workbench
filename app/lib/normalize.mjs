const first=x=>x?.url_list?.[0]||x?.urlList?.[0]||'';
export function normalizeAweme(x,source){
  const id=String(x.aweme_id||x.awemeId||'');if(!/^\d{10,25}$/.test(id))return null;const v=x.video||{};
  return {id,title:x.desc||'',author:x.author?.nickname||'',duration:Math.round((v.duration||x.duration||0)/1000),cover:first(v.cover)||first(x.images?.[0]),tags:(x.text_extra||[]).map(t=>t.hashtag_name).filter(Boolean),media:first(v.play_addr_h264)||first(v.play_addr)||first(v.download_addr),images:(x.images||[]).map(first).filter(Boolean),subtitles:(v.subtitle_infos||x.subtitle_infos||[]).map(s=>({url:s.url||s.Url||'',language:s.language||s.LanguageCode||''})),sources:[source],published:x.create_time||0};
}
export function findAwemes(node,depth=0){
  if(!node||typeof node!=='object'||depth>9)return [];
  if(node.aweme_id||node.awemeId)return [node];
  return Object.entries(node).filter(([k])=>!['author','music','statistics'].includes(k)).flatMap(([,value])=>findAwemes(value,depth+1));
}
