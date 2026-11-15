import fs from 'node:fs';
import path from 'node:path';
import {run} from './content.mjs';
const compiling=new Map();
export function imageDimensions(bytes){
 if(bytes.length<30)return null;
 if(bytes.subarray(1,4).toString()==='PNG')return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 if(/^GIF8/.test(bytes.subarray(0,4).toString()))return {width:bytes.readUInt16LE(6),height:bytes.readUInt16LE(8)};
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'){
  const kind=bytes.subarray(12,16).toString();
  if(kind==='VP8X')return {width:bytes.readUIntLE(24,3)+1,height:bytes.readUIntLE(27,3)+1};
  if(kind==='VP8 ')return {width:bytes.readUInt16LE(26)&16383,height:bytes.readUInt16LE(28)&16383};
  if(kind==='VP8L'){const bits=bytes.readUInt32LE(21);return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}
 }
 if(bytes[0]===255&&bytes[1]===216){let p=2;while(p+8<bytes.length){if(bytes[p++]!==255)continue;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===218||marker===217)break;if(marker===216||marker===1)continue;const n=bytes.readUInt16BE(p);if(n<2||p+n>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {width:bytes.readUInt16BE(p+5),height:bytes.readUInt16BE(p+3)};p+=n;}}
 return null;
}
export async function prepareVisionImage(image,{dataDir,root=path.dirname(dataDir),signal}){
 const dimensions=imageDimensions(image.bytes);if(dimensions&&dimensions.width<=8192&&dimensions.height<=8192)return image;
 if(process.platform!=='darwin')throw new Error('这张原图尺寸过大，需要本机图像分段或手动导入正文');
 fs.mkdirSync(dataDir,{recursive:true,mode:0o700});const binary=path.join(dataDir,'prepare-vision-image'),source=path.join(root,'scripts/prepare-vision-image.swift');
 if(!fs.existsSync(binary)||fs.statSync(binary).mtimeMs<fs.statSync(source).mtimeMs){
  if(!compiling.has(binary)){const task=run('swiftc',['-module-cache-path',path.join(dataDir,'swift-cache'),source,'-o',binary],signal).finally(()=>compiling.delete(binary));compiling.set(binary,task);}
  await compiling.get(binary);
 }
 const dir=fs.mkdtempSync(path.join(dataDir,'vision-parts-'));fs.chmodSync(dir,0o700);
 try{const input=path.join(dir,'original');fs.writeFileSync(input,image.bytes,{mode:0o600});const output=JSON.parse(await run(binary,[input,dir],signal));return output.parts.map((p,i)=>({bytes:fs.readFileSync(p.file),mime:'image/png',part:i+1,parts:output.parts.length}));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
