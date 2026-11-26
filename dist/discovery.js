import {workspaceIdentity} from './workspace-client.js?v=22';

async function request(path,options){
 const response=await fetch(new URL('api/discovery'+path,import.meta.url),{signal:AbortSignal.timeout(10000),...options});
 if(!response.headers.get('content-type')?.includes('application/json'))throw Error('发现需要连接工作台服务。');
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'发现暂时不可用。');
 return data;
}
export const listDiscovered=()=>request('',{cache:'no-store'}).then(data=>data.projects);
export const getDiscovered=id=>request('/'+encodeURIComponent(id));
export const publishDiscovered=project=>request('',{
 method:'POST',headers:{'Content-Type':'application/json',...workspaceIdentity()},body:JSON.stringify(project)
});
