export async function authRequest(action,body){
 const options={cache:'no-store',signal:AbortSignal.timeout(action==='email/send'?16000:9000)};
 if(body!==undefined){
  options.method='POST';
  options.headers={'Content-Type':'application/json'};
  options.body=JSON.stringify(body);
 }
 const response=await fetch(new URL('api/auth/'+action,import.meta.url),options);
 if(!response.headers.get('content-type')?.includes('application/json')){
  throw Error('登录服务暂时不可用。');
 }
 const result=await response.json();
 if(!response.ok)throw Object.assign(Error(result.error||'暂时无法登录。'),{
  retryAfter:Number(response.headers.get('retry-after'))||0
 });
 return result;
}
