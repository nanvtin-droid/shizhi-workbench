import OpenCC from 'opencc-js';

const convert=OpenCC.Converter({from:'t',to:'cn'});
// Preserve verbatim code and links while normalizing surrounding Chinese prose.
const verbatim=/(```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s<>\[\]`]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g;
export function simplified(text){
  return String(text??'').split(verbatim).map((part,index)=>index%2?part:convert(part)).join('');
}
export function simplifiedContent({text,segments=[],source,...rest}){
  return {...rest,text:simplified(text),segments:segments.map(s=>({...s,text:simplified(s.text)})),source};
}
