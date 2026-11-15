export const PLATFORMS={douyin:{name:'抖音',item:'视频'},toutiao:{name:'今日头条',item:'内容'}};
export function platformId(value='douyin'){
  if(!Object.hasOwn(PLATFORMS,value))throw new Error('无效的数据来源');return value;
}
export function toutiaoUrl(id,url=''){
  if(!/^\d{10,25}$/.test(String(id)))throw new Error('无效的头条内容 ID');
  try{const u=new URL(url);if(u.protocol==='https:'&&['www.toutiao.com','toutiao.com','m.toutiao.com'].includes(u.hostname)&&u.pathname===`/video/${id}/`)return `https://www.toutiao.com/video/${id}/`;if(u.protocol==='https:'&&['www.toutiao.com','toutiao.com','m.toutiao.com'].includes(u.hostname)&&new RegExp('^/w/(?:a)?'+id+'/?$').test(u.pathname))return `https://www.toutiao.com/w/${id}/`;}catch{}
  return `https://www.toutiao.com/article/${id}/`;
}
