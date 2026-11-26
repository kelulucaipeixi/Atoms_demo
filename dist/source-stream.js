import {entryFile,validPath} from './workspace.js';

function readString(source,start){
 if(source[start]!=='"')return null;
 let end=start+1;
 while(end<source.length){
  const character=source[end];
  if(character==='"'){
   try{return {value:JSON.parse(source.slice(start,end+1)),end:end+1,complete:true}}
   catch{return null}
  }
  if(character==='\\'){
   const escapeLength=source[end+1]==='u'?6:2;
   if(end+escapeLength>source.length)break;
   end+=escapeLength;
  }else end++;
 }
 // A network chunk may end inside an escape or a surrogate pair.
 try{
  const value=JSON.parse(source.slice(start,end)+'"').replace(/[\uD800-\uDBFF]$/,'');
  return {value,end,complete:false};
 }catch{return null}
}

export function readStreamedFiles(output,base){
 const text=output.trimStart().replace(/^\x60{3}(?:json|html)?\s*/i,'');
 if(/^<(?:!doctype\s+html|html\b)/i.test(text)){
  return {files:{...base,[entryFile]:text},path:entryFile};
 }
 const prefix=/^\{\s*"files"\s*:\s*\{/.exec(text);
 if(!prefix)return null;
 const files={...base};
 let cursor=prefix[0].length,path;
 const space=()=>{while(cursor<text.length&&/\s/.test(text[cursor]))cursor++};
 while(cursor<text.length){
  space();
  const name=readString(text,cursor);
  if(!name?.complete||!validPath(name.value))break;
  cursor=name.end;
  space();
  if(text[cursor++]!==':')break;
  space();
  const contents=readString(text,cursor);
  if(!contents)break;
  path=name.value;
  files[path]=contents.value;
  if(!contents.complete)break;
  cursor=contents.end;
  space();
  if(text[cursor++]!==',')break;
 }
 return path?{files,path}:null;
}
