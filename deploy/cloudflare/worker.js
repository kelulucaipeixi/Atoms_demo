export default {
 async fetch(request,env){
  const incoming=new URL(request.url);
  if(incoming.pathname!=='/atoms'&&!incoming.pathname.startsWith('/atoms/'))return fetch(request);

  const upstream=new URL(incoming.pathname+incoming.search,env.ATOMS_ORIGIN);
  const headers=new Headers(request.headers);
  headers.delete('Host');
  // An adjacent site on the same host can use its own cookies and HTTP authentication.
  headers.delete('Authorization');
  const sessions=headers.get('Cookie')?.split(';').map(cookie=>cookie.trim())
   .filter(cookie=>/^studio_(workspace|account|oauth)=/.test(cookie));
  if(sessions?.length)headers.set('Cookie',sessions.join('; '));
  else headers.delete('Cookie');

  const isAsset=incoming.pathname.startsWith('/atoms/assets/');
  const response=await fetch(upstream,{
   method:request.method,headers,body:request.body,redirect:'manual',
   ...(!isAsset?{cache:'no-store'}:{})
  });
  if(!/^(text\/html|text\/css|text\/javascript|application\/javascript)\b/.test(response.headers.get('Content-Type')||'')){
   return response;
  }
  const fresh=new Response(response.body,response);
  fresh.headers.set('Cache-Control','no-cache, must-revalidate');
  return fresh;
 }
};
