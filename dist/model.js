import {workspaceIdentity} from './workspace-client.js?v=22';

function pause(ms,signal){
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(signal.reason)};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);
  if(signal?.aborted)abort();
  else signal?.addEventListener('abort',abort,{once:true});
 });
}
async function readServerStream(response,onText){
 const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
 let buffer='',content='',model;
 let finished=false;
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   buffer+=value;
   const lines=buffer.split('\n');
   buffer=lines.pop();
   for(const line of lines){
    if(!line.trim())continue;
    const event=JSON.parse(line);
    if(event.type==='start')model=event.model;
    if(event.type==='delta'&&typeof event.text==='string'){
     content+=event.text;
     onText(content);
    }
    if(event.type==='done')finished=true;
    if(event.type==='error')throw Object.assign(Error(event.message),{retryable:event.retryable});
   }
   if(finished)break;
  }
 }finally{
  await reader.cancel().catch(()=>{});
 }
 if(!finished)throw Object.assign(Error('文件输出连接中断。'),{retryable:true});
 return {content,model};
}
async function requestServer(stage,prompt,previous,signal,onText){
 const timeout=AbortSignal.timeout(195000);
 const res=await fetch(new URL('api/generate',import.meta.url),{
  method:'POST',headers:{'Content-Type':'application/json',...workspaceIdentity()},body:JSON.stringify({stage,prompt,previous,stream:Boolean(onText),includeCheck:stage==='plan'}),
  signal:signal?AbortSignal.any([signal,timeout]):timeout
 });
 const contentType=res.headers.get('content-type')||'';
 if(res.ok&&onText&&contentType.includes('application/x-ndjson'))return readServerStream(res,onText);
 const transient=[408,429,500,502,503,504,520,521,522,523,524,525,526,527].includes(res.status);
 if(!contentType.includes('application/json')){
  throw Object.assign(Error('生成服务暂时未响应。'),{retryable:transient});
 }
 const data=await res.json();
 if(!res.ok||data.error){
  throw Object.assign(Error(data.error||'模型请求失败。'),{
   retryable:data.retryable??transient,retryAfter:Number(res.headers.get('retry-after'))||0,
   code:res.status===401&&data.code==='auth-required'?'auth-required':
    res.status===409?'identity':res.status===413?'input-size':'generation'
  });
 }
 return {content:data.content??data.html,model:data.model};
}
export async function callModel(stage,prompt,previous,progress,signal,onText){
 signal?.throwIfAborted();
 for(let attempt=0;;attempt++){
  try{return await requestServer(stage,prompt,previous,signal,onText)}
  catch(error){
   signal?.throwIfAborted();
   if(attempt>=3||!(error.retryable||error instanceof TypeError||error.name==='TimeoutError'))throw error;
   onText?.('');
   progress('正在恢复连接');
   const backoff=Math.max(800*2**attempt,Math.min(12000,(error.retryAfter||0)*1000));
   await pause(backoff,signal);
  }
 }
}
