export const TAXONOMY = [
  {name:'AI 与编程',icon:'⌘',color:'#6958da',terms:['人工智能','ai工具','ai教程','大模型','codex','workbuddy','vibe','编程','代码','开源','github','智能体','python','前端','后端','软件','chatgpt','claude','skill','提示词']},
  {name:'英语与语言',icon:'Aa',color:'#3d83aa',terms:['英语','雅思','托福','口语','语法','单词','english','词汇','四六级','外语','发音']},
  {name:'科学与工程',icon:'⚙',color:'#b17b38',terms:['科普','物理','化学','螺栓','焊接','机械','电路','工程','科学','数学','原理','硬核','材料','电工']},
  {name:'育儿与教育',icon:'✳',color:'#ba6482',terms:['育儿','教育','启蒙','家教','孩子','儿童','宝宝','学习方法','读书','读绘本','早教','认知发展']},
  {name:'健康与运动',icon:'♡',color:'#4e967f',terms:['健康','医学','医生','近视','手术','健身','训练','运动','营养','减脂','肌肉','睡眠','眼科','康复']},
  {name:'商业与工作',icon:'↗',color:'#8e7362',terms:['电商','运营','营销','销售','带货','职场','管理','创业','谈判','成交','商业','赚钱','工作效率','产品经理','沟通','理财','投资','经济','专利']},
  {name:'生活与实用技能',icon:'☀',color:'#9c8a39',terms:['做饭','菜谱','烹饪','食谱','摄影','拍摄','剪辑','构图','教程','技巧','方法','攻略','申请条件','落户','户口','维修','装修','收纳','excel','word','效率','实用']},
  {name:'人文与思考',icon:'◎',color:'#797fa4',terms:['历史','哲学','心理','思维','文学','文化','名句','认知','逻辑','关系','自我提升','个人成长','社会','经济学']}
];
export function preliminary(item) {
  const text = `${item.title||''} ${(item.tags||[]).join(' ')}`.toLowerCase();
  const ranks=TAXONOMY.map(c=>({name:c.name,score:c.terms.reduce((n,t)=>n+(text.includes(t.toLowerCase())?1:0),0)})).sort((a,b)=>b.score-a.score);
  const category=ranks[0].score?ranks[0].name:'待归类';
  if(item.sources.includes('collection'))return {knowledge:'yes',category,confidence:1,reason:'收藏来源：按你的要求纳入知识候选',method:'source'};
  const signal=/(教程|科普|教学|讲解|原理|如何|方法|技巧|语法|词汇|开源|知识|英语|雅思|编程|学习|ai工具)/i.test(text);
  const entertainment=/(搞笑|颜值|美女|帅哥|舞蹈|纯享|翻唱|演唱会|萌宠|猫咪日常|段子|卡点|整活|跳舞|热舞|搞怪)/.test(text);
  if(entertainment&&!signal)return {knowledge:'no',category:'非知识',confidence:.8,reason:'标题与标签更偏娱乐；可手动改回',method:'rule'};
  // 喜欢列表仅凭标题的正向判定仍待模型确认，避免误把广告等纳入学习库。
  return {knowledge:'review',category,confidence:signal ? 0.65 : 0.35,reason:signal?'初步识别到知识线索，等待 AI 确认':'仅凭标题无法确定是否具有可学习内容',method:'rule'};
}
export function validateDecision(x) {
  if(!x||!['yes','no','review'].includes(x.knowledge))throw new Error('模型返回的知识类型不正确');
  return {knowledge:x.knowledge,category:typeof x.category==='string'?x.category.slice(0,30):'待归类',confidence:Math.min(1,Math.max(0,Number(x.confidence)||0)),reason:String(x.reason||'').slice(0,500),method:'ai'};
}
export function normalizeCategory(name){
  return ({'未知':'待归类','未明确':'待归类','其他':'待归类','娱乐':'待归类','非知识':'待归类','情感生活':'人文与思考','心理与成长':'人文与思考'})[name]||name;
}
