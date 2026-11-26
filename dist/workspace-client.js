let session;
let identity='guest';
export function setWorkspaceIdentity(id){identity=id||'guest';session=null}
export const workspaceIdentity=()=>({'X-Studio-Identity':identity});
const retryableStatus=status=>[408,429,500,502,503,504,520,521,522,523,524].includes(status);
function workspaceError(message,code='workspace',retryable=false){
 return Object.assign(Error(message),{code,retryable});
}

async function establishSession(){
 const response=await fetch(new URL('api/workspace/session',import.meta.url),{
  method:'POST',headers:workspaceIdentity(),signal:AbortSignal.timeout(8000)
 });
 if(!response.headers.get('content-type')?.includes('application/json')){
  if(retryableStatus(response.status))throw workspaceError('工作区暂时不可用。','workspace',true);
  return false;
 }
 const payload=await response.json();
 if(!response.ok)throw workspaceError(payload.error||'工作区暂时不可用。',
  response.status===401?'auth-required':response.status===409?'identity':'workspace',retryableStatus(response.status));
 return payload.ready===true;
}
async function connect(){
 session??=establishSession().catch(error=>{session=null;throw error});
 return session;
}

function sourceURL(projectId,kind,runId){
 return new URL('api/workspace/projects/'+projectId+'/'+kind+'/'+runId,import.meta.url);
}

export async function saveWorkspace(projectId,kind,runId,files,signal){
 const body=JSON.stringify({files});
 for(let attempt=0;;attempt++){
  signal?.throwIfAborted();
  try{
   if(!await connect())return false;
   signal?.throwIfAborted();
   const deadline=AbortSignal.timeout(8000);
   const response=await fetch(sourceURL(projectId,kind,runId),{
    method:'PUT',headers:{'Content-Type':'application/json',...workspaceIdentity()},body,
    signal:signal?AbortSignal.any([signal,deadline]):deadline
   });
   if(response.ok)return true;
   const code=response.status===401?'auth-required':[403,404,409].includes(response.status)?'identity':'workspace';
   throw workspaceError('无法保存项目文件。',code,retryableStatus(response.status));
  }catch(error){
   signal?.throwIfAborted();
   const network=error instanceof TypeError||error.name==='TimeoutError';
   if(attempt>=2||(!network&&!error.retryable)){
    throw error.code?error:workspaceError('工作区暂时无法连接。');
   }
   await new Promise(resolve=>setTimeout(resolve,400*2**attempt));
  }
 }
}

export async function readWorkspace(projectId,kind,runId){
 const response=await fetch(sourceURL(projectId,kind,runId),{headers:workspaceIdentity(),signal:AbortSignal.timeout(8000)});
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))return null;
 return (await response.json()).files||null;
}
