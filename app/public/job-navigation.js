const routes=new Set(['home','library','review','focus']);
export function normalizeReturnContext(raw={}){
  if(!raw||typeof raw!=='object')raw={};
  const route=routes.has(raw.route)?raw.route:'library';
  return {platform:raw.platform==='toutiao'?'toutiao':'douyin',route,scope:['knowledge','review','excluded','archived'].includes(raw.scope)?raw.scope:'knowledge',category:String(raw.category||'').slice(0,100),source:['collection','like'].includes(raw.source)?raw.source:'',status:['unread','learning','learned','revisit'].includes(raw.status)?raw.status:'',q:String(raw.q||'').slice(0,500),page:Math.max(0,Math.floor(Number(raw.page)||0)),sessionId:Number.isSafeInteger(raw.sessionId)&&raw.sessionId>0?raw.sessionId:null,scrollY:Math.max(0,Number(raw.scrollY)||0)};
}
export function captureReturnContext(state,scrollY=0){
  return normalizeReturnContext({...state,sessionId:state.session?.id,scrollY});
}
