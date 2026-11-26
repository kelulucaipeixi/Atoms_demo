const scopeCache = 'atoms-studio-shell-'+new URL(self.registration.scope).pathname+'-';
const cacheName = scopeCache+'v24';
const files = ['./','./index.html','./style.css?v=23','./app.js?v=24','./model.js?v=22','./runtime.js?v=23','./preview.js?v=23','./workspace.js','./workspace-client.js?v=22','./source-view.js','./source-stream.js','./discovery.js?v=22','./auth-client.js?v=21','./templates.js','./assets/templates/edinburgh.jpg','./assets/templates/skye.jpg','./assets/templates/dolomites.jpg','./generator.js','./zh/dashboard/'];
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(files)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>
 (key.startsWith(scopeCache)||(/^atoms-studio-shell-v\d+$/.test(key)&&new URL(self.registration.scope).pathname==='/'))&&key!==cacheName
).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const r=event.request;
 if(r.method!=='GET'||!r.url.startsWith(self.registration.scope))return;
 event.respondWith(fetch(r).catch(async()=>{
  const cache=await caches.open(cacheName);
  return await cache.match(r)||(r.mode==='navigate'?await cache.match('./index.html'):null)||Response.error();
 }));
});
