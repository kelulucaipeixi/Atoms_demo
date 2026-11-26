export const entryFile='index.html';
const stylesheet='styles/site.css';
const scriptFile='src/app.js';
const starter={
 [entryFile]:'<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>应用</title><link rel="stylesheet" href="styles/site.css"><script src="src/app.js" defer></script></head><body><main></main></body></html>',
 [stylesheet]:'',
 [scriptFile]:''
};

export function openWorkspace(previous){
 if(previous?.files)return {...previous.files};
 return previous?.html?{[entryFile]:previous.html}:{...starter};
}

export const isImagePath=name=>/\.(?:jpe?g|png|webp)$/i.test(name);
export const isImageData=value=>typeof value==='string'&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
export function modelWorkspace(files){
 return JSON.stringify({
  files:Object.fromEntries(Object.entries(files).filter(([name])=>!isImagePath(name))
   .map(([name,source])=>[name,source.replace(/data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+/gi,'[图片素材]')])),
  images:Object.keys(files).filter(isImagePath)
 });
}
export function validPath(name){
 const parts=name.split('/');
 return name.length<=180&&parts.length<=6&&
  parts.every(part=>/^[\w.-]{1,64}$/.test(part)&&part!=='.'&&part!=='..')&&
  /\.(?:html|css|js|json|md|txt|svg)$/i.test(name);
}

export function applyFileWrites(content,current){
 const output=String(content??'').trim();
 let updates;
 try{
  const parsed=JSON.parse(output.replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi,''));
  updates=parsed.files;
 }catch{
  if(/^\s*(?:\x60{3}(?:json)?\s*)?\{/.test(output))throw Error('模型返回的工作区文件不完整。');
  // Older providers may still return a single, standalone document.
  const html=output.match(/(?:<!doctype html>\s*)?<html\b[\s\S]*?<\/html>/i)?.[0];
  if(!html)throw Error('模型没有返回可读取的工作区文件。');
  const assetFiles=Object.fromEntries(Object.entries(current).filter(([name])=>isImagePath(name)||name==='assets/credits.json'));
  return {[entryFile]:html,...assetFiles};
 }
 if(!updates||typeof updates!=='object'||Array.isArray(updates))throw Error('模型未提供文件内容。');
 const files={...current};
 const changes=Object.entries(updates);
 if(!changes.length)throw Error('模型没有返回任何文件修改。');
 for(const [name,source] of changes){
  if(!validPath(name)||typeof source!=='string'||new Blob([source]).size>80000)throw Error('工作区文件格式无效：'+name);
  files[name]=source;
 }
 const names=Object.keys(files);
 if(names.length>48||names.some(name=>names.some(other=>name!==other&&other.startsWith(name+'/')))){
  throw Error('工作区文件太多或存在同名文件夹冲突。');
 }
 return files;
}

export function describeFiles(files,before={}){
 return Object.keys(files).sort().map(name=>{
  const action=!Object.hasOwn(before,name)?'写入':files[name]===before[name]?'保留':'更新';
  return action+' '+name+' · '+new Blob([files[name]]).size.toLocaleString('zh-CN')+' 字节';
 });
}

function inlineStyle(doc,source){
 const style=doc.createElement('style');
 style.textContent=source.replace(/<\/style/gi,'<\\/style');
 return style;
}
function inlineScript(doc,source){
 const script=doc.createElement('script');
 script.textContent=source.replace(/<\/script/gi,'<\\/script');
 return script;
}

function appendImageCredits(doc,files,usedImages){
 let credits;
 try{credits=JSON.parse(files['assets/credits.json']||'[]')}catch{return}
 if(!Array.isArray(credits))return;
 const links=new Set(Array.from(doc.querySelectorAll('a[href]'),link=>link.getAttribute('href')));
 for(const item of credits){
  if(!item||!usedImages.has(item.file)||links.has(item.source)||typeof item.author!=='string'||
   typeof item.license!=='string'||!/^https:\/\/commons\.wikimedia\.org\/wiki\//.test(item.source)||
   !/^https:\/\/creativecommons\.org\/licenses\//.test(item.licenseURL))continue;
  const credit=doc.createElement('small'),author=doc.createElement('a'),license=doc.createElement('a');
  author.setAttribute('href',item.source);author.textContent=item.author;
  license.setAttribute('href',item.licenseURL);license.textContent=item.license;
  for(const link of [author,license]){link.target='_blank';link.rel='noreferrer'}
  credit.append('照片 ',author,' · ',license,' · 缩放与压缩');
  doc.body.append(credit);
 }
}

export function compileWorkspace(files){
 const html=files[entryFile];
 if(!html||!/<html\b[^>]*>[\s\S]*?<\/html>/i.test(html)||!/<body\b[^>]*>[\s\S]*?<\/body>/i.test(html)){
  throw Error('index.html 缺少完整的文档或正文。');
 }
 const doc=new DOMParser().parseFromString(html,'text/html');
 if(!doc.title.trim()||!doc.body.childElementCount)throw Error('index.html 缺少标题或可渲染内容。');
 const included=new Set();
 const deferred=[];
 const usedImages=new Set();
 for(const image of doc.querySelectorAll('img[src]')){
  const path=(image.getAttribute('src')||'').replace(/^\.\//,'');
  if(isImagePath(path)&&Object.hasOwn(files,path)&&isImageData(files[path])){
   image.setAttribute('src',files[path]);
   usedImages.add(path);
  }
 }
 appendImageCredits(doc,files,usedImages);
 for(const node of doc.querySelectorAll('script[src],link[rel~="stylesheet"][href]')){
  const isScript=node.matches('script');
  const path=(node.getAttribute(isScript?'src':'href')||'').replace(/^\.\//,'');
  if(!validPath(path)||!path.endsWith(isScript?'.js':'.css')||!Object.hasOwn(files,path)){
   throw Error('index.html 无法解析依赖 '+path);
  }
  included.add(path);
  if(isScript){
   const script=inlineScript(doc,files[path]);
   if(node.type==='module')throw Error('请使用经典脚本以支持单文件导出：'+path);
   if(node.defer){deferred.push(script);node.remove()}
   else node.replaceWith(script);
  }else{
   const style=inlineStyle(doc,files[path]);
   if(node.media)style.media=node.media;
   node.replaceWith(style);
  }
 }
 for(const name of ['style.css',stylesheet]){
  if(files[name]&&!included.has(name))doc.head.append(inlineStyle(doc,files[name]));
 }
 doc.body.append(...deferred);
 for(const name of ['app.js',scriptFile]){
  if(files[name]&&!included.has(name))doc.body.append(inlineScript(doc,files[name]));
 }
 return '<!doctype html>\n'+doc.documentElement.outerHTML;
}
