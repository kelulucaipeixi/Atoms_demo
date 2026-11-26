import {escapeHTML as esc} from './generator.js';
import {createRun,runBuildAgent} from './runtime.js?v=23';
import {previewDocument} from './preview.js?v=23';
import {openWorkspace} from './workspace.js';
import {templates,templateVersion} from './templates.js';
import {getDiscovered,listDiscovered,publishDiscovered} from './discovery.js?v=22';
import {readWorkspace,saveWorkspace,setWorkspaceIdentity} from './workspace-client.js?v=22';
import {authRequest} from './auth-client.js?v=21';
import {sourceState,renderSourceView,refreshSourceView} from './source-view.js';
const $=id=>document.getElementById(id);
const paths={home:'M3 10l9-7 9 7v10H3z M9 16h6',folder:'M3 6h7l2 3h9v11H3z',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',book:'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z',settings:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',send:'M12 20V4 M5 11l7-7 7 7',menu:'M4 6h16 M4 12h16 M4 18h16',plus:'M4 12h16 M12 4v16',box:'M4 5h16v14H4z M8 5v14',compass:'M12 2a10 10 0 1 0 .01 0 M16 8l-2 6-6 2 2-6z',code:'M8 7l-5 5 5 5 M16 7l5 5-5 5',device:'M3 4h18v13H3z M8 21h8 M12 17v4'};
Object.assign(paths,{refresh:'M20 7v5h-5 M20 12a8 8 0 1 0-2 6',expand:'M8 4H4v4 M16 4h4v4 M4 16v4h4 M20 16v4h-4',spark:'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z'});
const icon=name=>'<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="'+paths[name]+'"/></svg>';
const titles={home:'首页',projects:'项目',templates:'模板库',settings:'工作区设置',discover:'发现',edit:'项目工作室',login:'登录'};
const nav=[['home','home'],['projects','folder'],['discover','compass'],['templates','grid']];
let account=null,providers=[],emailEnabled=false,authError='',storagePrefix='atoms:';
let loginEmail='',emailChallenge='',resendAt=0,resendTimer,authBusy=false;
const emailFlowKey='atoms:email-flow';
const loginActionKey='atoms:login-action';
function read(key,initial){const value=localStorage.getItem(storagePrefix+key);return value?JSON.parse(value):initial}
function save(key,value){localStorage.setItem(storagePrefix+key,JSON.stringify(value))}
let buildingFiles=null,streamedFiles=null;
const sourceStates=new Map();
const sourceSnapshots=new Map();
let buildController=null;
let settings=read('settings',{name:'我的工作区'}),view='preview',phone=false,working=false,projectId='',statusTimer,homeTab='discover',pending=null,attachment=null,sidebarCompact=read('sidebar-compact',false);
function untouchedStarter(project){
 return project?.id==='starter-board'&&project.title==='团队冲刺看板'&&!project.customTitle&&!project.latestRunId&&
  project.versions?.length===1&&project.versions[0].engine==='内置示例'&&!read('state:starter-board:board',null);
}
function projects(){return Object.keys(localStorage).filter(k=>k.startsWith(storagePrefix+'p:')).map(k=>get(k.slice((storagePrefix+'p:').length))).filter(Boolean).sort((a,b)=>b.updated-a.updated)}
function get(id){const project=read('p:'+id,null);return untouchedStarter(project)?null:project}
const put=p=>save('p:'+p.id,p),stamp=n=>new Date(n).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
function notice(msg){$('message').textContent=msg;clearTimeout(statusTimer);statusTimer=setTimeout(()=>$('message').textContent='',5500)}
function route(){const [page='home',id='']=location.hash.slice(1).split('/');return [titles[page]?page:'home',id]}
const getRun=id=>id?read('run:'+id,null):null;
const putRun=run=>save('run:'+run.runId,run);
const link=(r,s,c='')=>'<a class="'+c+'" href="#'+r+'">'+s+'</a>';
function sidebar(page){
 const recent=projects().slice(0,5);
 const mark='<span class="brand-mark">'+icon('spark')+'</span>';
 $('sidebar').innerHTML='<div class="brand-row">'+link('home',mark+'<span>应用工坊</span>','logo')+
 '<button class="plain-icon collapse" data-act="collapse" aria-label="切换侧栏宽度">'+icon('box')+'</button></div>'+
 link('settings','<span class="avatar">W</span><b>'+esc(settings.name)+'</b><span>⌄</span>','workspace')+
 '<nav aria-label="工作区导航">'+nav.map(([key,i])=>link(key,icon(i)+'<span>'+titles[key]+'</span>','navitem '+(key===page?'active':'')).replace('<a ', '<a title="'+titles[key]+'" '+(key===page?'aria-current="page" ':''))).join('')+'</nav>'+
 (recent.length?'<details class="recent-group" open><summary>最近项目</summary>'+recent.map(p=>link('edit/'+p.id,esc(p.title),'recent')).join('')+'</details>':'')+
 '<div class="bottom">'+link('settings',icon('settings')+'<span>设置</span>','navitem')+
 (account?link('settings','<span class="avatar">'+esc(account.name.slice(0,1).toUpperCase())+'</span><span>'+esc(account.name)+'<small>已登录</small></span>','account'):
  link('login','<span class="avatar">P</span><span>登录</span>','account').replace('<a ','<a aria-label="登录" '))+'</div>';
}
function top(page){return '<header class="top"><div class="row"><button class="mobilebar" data-act="menu" aria-label="展开侧栏">'+icon('menu')+'</button><div class="crumb">'+esc(settings.name)+'　/　<b>'+titles[page]+'</b></div></div><button class="soft" data-act="new-project">'+icon('plus')+' 新建项目</button></header>'}
function projectRows(items,empty='还没有项目。'){return items.map(p=>link('edit/'+p.id,'<div><strong>'+esc(p.title)+'</strong><br><small>'+(p.versions.length?p.versions.length+' 个版本':'待生成')+'</small></div><small>'+stamp(p.updated)+'</small>','project')).join('')||'<div class="empty">'+empty+'</div>'}
let draft='',composerTemplate=null;
const editorDrafts=new Map();
let failedAttachment=null;
const ideas=[
 ['活动报名','帮我制作一个周末市集活动报名页，包含活动日程和报名表，提交后显示确认信息。'],
 ['交互测验','做一个三题的咖啡知识测验，答题后即时显示反馈，最后汇总成绩。'],
 ['习惯打卡','做一个一周习惯打卡工具，能够添加新习惯、逐日打卡并显示完成率。']
];
function home(){
 const tabs=[['discover','发现'],['projects','我的项目'],['templates','模板库']];
 return '<header class="top home-top"><div class="row"><button class="mobilebar plain-icon" data-act="menu" aria-label="展开侧栏">'+icon('menu')+'</button><span class="crumb">'+esc(settings.name)+'</span></div>'+(account?'':link('login','登录','soft'))+'</header>'+
 '<section class="hero"><span class="hero-mark">'+icon('spark')+'</span><h1>今天想构建什么？</h1><p>描述你的需求，由 AI 生成可运行的网页。</p>'+
 '<form class="composer'+(composerTemplate?' has-template':'')+'" id="create" novalidate><div class="composer-attachments" id="attachment-chip">'+attachmentChip()+'</div>'+
 '<textarea required maxlength="6000" id="prompt" aria-label="应用需求" placeholder="例如，做一个能收集报名信息的活动页面…">'+esc(draft)+'</textarea>'+
 '<div class="tools between"><div class="row"><button type="button" class="plain-icon" data-act="attach" aria-label="添加参考文件" title="添加参考文件">'+icon('plus')+'</button><input class="hidden" id="reference-file" type="file" accept=".txt,.md,.csv,.json,text/plain"></div><div class="row"><button class="primary round" aria-label="生成应用">'+icon('send')+'</button></div></div><div class="error" role="status" id="progress"></div></form>'+
 '<div class="ideas row">'+ideas.slice(0,3).map(([t],i)=>'<button data-idea="'+i+'">'+t+'</button>').join('')+'</div></section>'+
 '<section class="page home-library"><div class="library-bar"><div class="tabs" aria-label="工作区内容">'+tabs.map(([k,t])=>'<button aria-pressed="'+(homeTab===k)+'" class="'+(homeTab===k?'active':'')+'" data-home-tab="'+k+'">'+t+'</button>').join('')+'</div>'+link(homeTab,'查看全部','textbtn')+'</div>'+
 (homeTab==='projects'?projectRows(projects().slice(0,4)):homeTab==='templates'?templateCards():'<div id="discover-list">'+discoveryList(3)+'</div>')+'</section>';
}
function attachmentChip(){
 const template=composerTemplate;
 const templateChip=template?'<div class="composer-template"><img src="'+esc(template.image)+'" alt="'+esc(template.alt)+'"><div><strong>'+
  esc(template.title)+'</strong><small>'+esc(template.file)+'</small></div><button type="button" class="plain-icon" data-act="detach-template" aria-label="移除模板附件">×</button></div>':'';
 const referenceChip=attachment?'<span class="chip">'+esc(attachment.name)+' <button type="button" data-act="detach" aria-label="移除参考文件">×</button></span>':'';
 return templateChip+referenceChip;
}
const templateById=id=>templates.find(item=>item.id===id);
function templateControls(template){
 return '<div class="shelf-actions"><button class="soft" data-edit-template="'+template.id+'">编辑模板</button>'+
  '<button class="primary" data-clone-template="'+template.id+'">克隆模板</button></div>';
}
function templateCards(){
 return '<div class="shelf-grid">'+templates.map(template=>'<article class="shelf-card">'+
  link('templates/'+template.id,'<img loading="lazy" src="'+esc(template.image)+'" alt="'+esc(template.alt)+'">','shelf-cover')+
  '<div class="shelf-body"><small>'+esc(template.category)+'</small><h3>'+link('templates/'+template.id,esc(template.title))+
  '</h3><p>'+esc(template.description)+'</p>'+templateControls(template)+'</div></article>').join('')+'</div>';
}
function templatePage(id){
 if(!id)return '<h1 class="title">模板库</h1><p class="subtitle">克隆现成网站，或从预设 Prompt 和图片开始编辑。</p>'+templateCards();
 const template=templateById(id);
 if(!template)return '<p class="empty">模板不存在。</p>';
 return '<div class="gallery-detail"><div class="row between"><div>'+link('templates','返回模板库','textbtn')+
  '<h1 class="title">'+esc(template.title)+'</h1><p class="subtitle">'+esc(template.description)+'</p></div>'+
  templateControls(template)+'</div><div class="template-detail-grid"><div class="template-preset"><img src="'+esc(template.image)+
  '" alt="'+esc(template.alt)+'"><small>摄影 '+esc(template.author)+' · '+esc(template.license)+'</small>'+
  '<h2>预设 Prompt</h2><p>'+esc(template.prompt)+'</p></div><div class="gallery-preview"><iframe id="gallery-frame" sandbox="allow-scripts allow-forms" title="模板预览"></iframe></div></div></div>';
}
let discoveryItems=null,discoveryRequest=null,discoveryFailed=false,discoveryRefreshTimer;
const discoveryRefreshMs=15000;
const discoveryCache=new Map();
function discoveryList(limit){
 if(discoveryFailed)return '<div class="empty">暂时无法加载发现。<button class="soft" data-act="retry-discovery">重试</button></div>';
 if(!discoveryItems)return '<p class="empty" role="status">正在加载作品…</p>';
 if(!discoveryItems.length)return '<p class="empty">还没有分享的作品。完成项目后，可在编辑器中分享到发现。</p>';
 return '<div class="shelf-grid">'+discoveryItems.slice(0,limit).map(item=>{
  const cover=item.hasCover?'<img loading="lazy" src="'+esc(new URL('api/discovery/'+item.id+'/cover',import.meta.url).href)+'" alt="">':
   '<span class="discovery-cover-text">'+esc(item.title)+'</span>';
  return '<article class="shelf-card">'+link('discover/'+item.id,cover,'shelf-cover discovery-cover')+
   '<div class="shelf-body"><small>'+esc(item.author||'工作台用户')+'</small><h3>'+link('discover/'+item.id,esc(item.title))+
   '</h3><p>'+esc(item.description||'')+'</p><div class="shelf-actions">'+
   link('discover/'+item.id,'预览','soft')+'<button class="primary" data-clone-discovery="'+esc(item.id)+'">克隆项目</button></div></div></article>';
 }).join('')+'</div>';
}
function discoverPage(id){
 if(!id)return '<div class="row between"><h1 class="title">发现</h1><button class="soft" data-act="retry-discovery">刷新作品</button></div><p class="subtitle">浏览用户分享的网站，克隆到自己的工作区。</p><div id="discover-list">'+discoveryList(60)+'</div>';
 const item=discoveryCache.get(id);
 if(!item)return '<div class="empty" id="gallery-pending" role="status">正在加载作品…</div>';
 return '<div class="gallery-detail"><div class="row between"><div>'+link('discover','返回发现','textbtn')+
  '<h1 class="title">'+esc(item.title)+'</h1><p class="subtitle">'+esc(item.author||'工作台用户')+
  (item.description?' · '+esc(item.description):'')+'</p></div>'+
  '<button class="primary" data-clone-discovery="'+esc(item.id)+'">克隆项目</button></div>'+
  '<div class="gallery-preview"><iframe id="gallery-frame" sandbox="allow-scripts allow-forms" title="分享作品预览"></iframe></div></div>';
}
function updateDiscoveryList(){
 const list=$('discover-list');
 if(list)list.innerHTML=discoveryList(route()[0]==='home'?3:60);
}
function scheduleDiscoveryRefresh(){
 clearTimeout(discoveryRefreshTimer);
 if(!document.hidden&&$('discover-list')){
  discoveryRefreshTimer=setTimeout(()=>loadDiscoveryList(),discoveryRefreshMs);
 }
}
function loadDiscoveryList(manual=false){
 if(discoveryRequest||!$('discover-list'))return;
 clearTimeout(discoveryRefreshTimer);
 discoveryRequest=listDiscovered().then(items=>{
  const changed=discoveryFailed||!discoveryItems||items.length!==discoveryItems.length||
   items.some((item,index)=>item.id!==discoveryItems[index].id||item.publishedAt!==discoveryItems[index].publishedAt);
  discoveryItems=items;discoveryFailed=false;
  for(const item of items)if(discoveryCache.get(item.id)?.publishedAt!==item.publishedAt)discoveryCache.delete(item.id);
  if(changed)updateDiscoveryList();
 })
  .catch(error=>{
   if(!discoveryItems&&!discoveryFailed){discoveryFailed=true;updateDiscoveryList()}
   else if(manual)notice(error.message);
  }).finally(()=>{
   discoveryRequest=null;
   scheduleDiscoveryRefresh();
  });
}
async function loadGalleryDetail(page,id){
 try{
  if(page==='templates'){
   const template=templateById(id);
   if(!template)return;
   const version=await templateVersion(template);
   if(route()[0]===page&&route()[1]===id&&$('gallery-frame'))$('gallery-frame').srcdoc=previewDocument(version.html);
   return;
  }
  if(!discoveryCache.has(id)){
   discoveryCache.set(id,await getDiscovered(id));
   if(route()[0]===page&&route()[1]===id)render();
   return;
  }
  if($('gallery-frame'))$('gallery-frame').srcdoc=previewDocument(discoveryCache.get(id).html);
 }catch(error){
  if(route()[0]===page&&route()[1]===id){
   if($('gallery-pending'))$('gallery-pending').textContent=error.message;
   else notice(error.message);
  }
 }
}
function settingsPage(){
 return '<div class="settings"><h1 class="title">工作区设置</h1><form id="prefs" class="panel">'+
  '<label for="ws">工作区名称</label><input class="field" id="ws" required maxlength="40" value="'+esc(settings.name)+'">'+
  '<button class="primary">保存设置</button></form>'+
  (account?'<section class="panel account-settings"><h2>账号</h2><p>'+esc(account.email||account.name)+'</p>'+
   '<button class="soft" data-act="signout">退出登录</button></section>':'')+'</div>';
}
function loginPage(){
 if(account)return '<div class="panel auth-panel"><h1 class="title">已登录</h1><p>'+esc(account.email||account.name)+'</p>'+link('projects','查看我的项目','primary')+'</div>';
 return '<section class="panel auth-panel"><h1 class="title">登录</h1>'+
  (providers.length?'<div class="provider-options">'+providers.map(provider=>
   '<button class="soft" data-provider="'+provider+'">使用 '+(provider==='google'?'Google':'GitHub')+' 登录</button>').join('')+'</div>':'')+
  '<form id="email-auth"><label for="auth-email">邮箱</label><input class="field" type="email" id="auth-email" name="email" autocomplete="email" required maxlength="254" value="'+
  esc(loginEmail)+'">'+
  (emailChallenge?'<label for="auth-code">验证码</label><input class="field" id="auth-code" name="code" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="6" pattern="[0-9]{6}" required>'+
   '<small class="muted">验证码 10 分钟内有效。</small><button class="primary" type="submit">验证并登录</button>':
   '<button class="primary" type="submit"'+(emailEnabled?'':' disabled')+'>发送验证码</button>')+
  '</form>'+
  (emailChallenge?'<div class="row auth-links"><button class="textbtn" type="button" data-act="change-email">更换邮箱</button>'+
   '<button class="textbtn" type="button" data-act="resend-code"'+(Date.now()<resendAt?' disabled':'')+'>发送验证码</button></div>':
   '<p class="muted">'+(emailEnabled?'首次验证邮箱后会自动创建账号。':'邮箱验证码暂时不可用。')+'</p>')+
  '<p class="error" id="auth-error" role="alert">'+esc(authError)+'</p></section>';
}
function reloadWorkspace(){
 history.replaceState(null,'',new URL('./#projects',import.meta.url));
 location.reload();
}
function newProjectAction(prompt=draft){
 return {kind:'create',prompt,attachment,templateId:composerTemplate?.id};
}
function requireLogin(action,expired=false){
 if(account&&!expired)return true;
 try{sessionStorage.setItem(loginActionKey,JSON.stringify(action))}catch{}
 if(expired){
  history.replaceState(null,'',new URL('./#login',import.meta.url));
  location.reload();
 }else{
  navigate('login');
  notice('登录后即可继续。');
 }
 return false;
}
function takeLoginAction(){
 if(!account)return null;
 try{
  const action=JSON.parse(sessionStorage.getItem(loginActionKey));
  sessionStorage.removeItem(loginActionKey);
  return action;
 }catch{return null}
}
function showAuthError(error){
 authError=error.message;
 if($('auth-error'))$('auth-error').textContent=authError;
 else notice(authError);
}
function scheduleResend(seconds){
 clearTimeout(resendTimer);
 resendAt=Date.now()+seconds*1000;
 resendTimer=setTimeout(()=>{
  const button=document.querySelector('[data-act=resend-code]');
  if(button)button.disabled=false;
 },seconds*1000);
}
function resetEmailChallenge(){
 emailChallenge='';authError='';clearTimeout(resendTimer);resendAt=0;
 try{sessionStorage.removeItem(emailFlowKey)}catch{}
}
function rememberEmailFlow(){
 sessionStorage.setItem(emailFlowKey,JSON.stringify({loginEmail,emailChallenge,resendAt,expires:Date.now()+600000}));
}
function restoreEmailFlow(){
 try{
  const flow=JSON.parse(sessionStorage.getItem(emailFlowKey));
  if(!flow||flow.expires<=Date.now())return;
  ({loginEmail,emailChallenge}=flow);
  scheduleResend(Math.max(0,(flow.resendAt-Date.now())/1000));
 }catch{}
}
async function sendLoginCode(email,button){
 if(authBusy)return;
 authBusy=true;
 button.disabled=true;
 authError='';
 $('auth-error')?.replaceChildren();
 const address=email.trim();
 loginEmail=address;
 try{
  const result=await authRequest('email/send',{email:address});
  if(loginEmail!==address)return;
  emailChallenge=result.challenge;
  scheduleResend(result.resendAfter);
  try{rememberEmailFlow()}catch{}
  if(route()[0]==='login'){render();$('auth-code')?.focus()}
 }catch(error){
  if(loginEmail!==address)return;
  showAuthError(error);
  if(emailChallenge&&error.retryAfter)scheduleResend(error.retryAfter);
  else button.disabled=false;
 }finally{
  authBusy=false;
  if(loginEmail!==address&&button.isConnected)button.disabled=false;
 }
}
async function submitLogin(form){
 const button=form.querySelector('button[type=submit]');
 if(button.disabled||authBusy)return;
 if(!emailChallenge){await sendLoginCode(form.elements.email.value,button);return}
 authBusy=true;
 button.disabled=true;
 authError='';
 $('auth-error')?.replaceChildren();
 try{
  await authRequest('email/verify',{email:loginEmail,challenge:emailChallenge,code:form.elements.code.value});
  try{sessionStorage.removeItem(emailFlowKey)}catch{}
  reloadWorkspace();
 }catch(error){showAuthError(error);button.disabled=false}
 finally{authBusy=false}
}
async function signInWith(provider,button){
 button.disabled=true;
 try{
  const {url}=await authRequest(provider,{});
  location.assign(url);
 }catch(error){showAuthError(error);button.disabled=false}
}
async function signOut(button){
 if(working){notice('请等待当前构建完成。');return}
 button.disabled=true;
 try{await authRequest('logout',{});reloadWorkspace()}
 catch(error){showAuthError(error);button.disabled=false}
}
function projectSourceState(id){
 if(!sourceStates.has(id))sourceStates.set(id,sourceState());
 return sourceStates.get(id);
}
function projectSourceRef(project){
 const report=activeReport(project),version=project.versions[project.active];
 if(report?.state==='interrupted'||(!version&&report?.runId))return ['drafts',report.runId];
 const saved=version?.workspaceId||version?.runId;
 return saved?['versions',saved]:null;
}
function projectFiles(project){
 if(pending?.id===project.id&&pending.state==='building'&&buildingFiles)return streamedFiles?.files||buildingFiles;
 const ref=projectSourceRef(project);
 const snapshot=ref&&sourceSnapshots.get([project.id,...ref].join('/'));
 return snapshot||openWorkspace(project.versions[project.active]);
}
async function loadProjectFiles(project){
 if(pending?.id===project.id&&pending.state==='building')return;
 const ref=projectSourceRef(project);
 if(!ref)return;
 const key=[project.id,...ref].join('/');
 if(sourceSnapshots.has(key))return;
 sourceSnapshots.set(key,null);
 try{
  const files=await readWorkspace(project.id,...ref);
  if(!files)return;
  sourceSnapshots.set(key,files);
  if(projectId===project.id&&view==='code')refreshProjectFiles();
 }catch{sourceSnapshots.delete(key)}
}
function refreshProjectFiles(options){
 const pane=$('source-pane'),project=currentProject();
 if(pane&&project)refreshSourceView(pane,projectFiles(project),projectSourceState(project.id),options);
}
function showStreamedFiles(project,stream){
 const state=projectSourceState(project.id);
 const before=streamedFiles?.files||buildingFiles;
 const after=stream?.files||buildingFiles;
 const selected=state.selected;
 if(stream&&state.follow)state.selected=stream.path;
 state.streamPath=stream?.path;
 streamedFiles=stream;
 const tree=selected!==state.selected||Object.keys(before||{}).join()!==Object.keys(after||{}).join();
 if(route()[1]===project.id)refreshProjectFiles({tree,followTail:Boolean(stream)&&state.follow});
}
function editor(p){
 const version=p.versions[p.active];
 const task=activeReport(p);
 const locked=task?.state==='building';
 const tabs=[['preview','预览'],['code','代码'],['versions','版本 '+p.versions.length]];
 const toolbar='<div class="actionbar"><div class="row view-tabs">'+tabs.map(([key,label])=>'<button class="'+(view===key?'active':'')+'" data-view="'+key+'" aria-pressed="'+(view===key)+'" '+(!version&&key==='versions'?'disabled':'')+'>'+label+'</button>').join('')+'</div>'+
 (view==='preview'&&version?'<div class="row preview-controls"><button class="plain-icon" data-act="phone" aria-label="'+(phone?'桌面视图':'手机视图')+'" title="'+(phone?'桌面视图':'手机视图')+'">'+icon('device')+'</button><button class="plain-icon" data-act="refresh" aria-label="刷新预览" title="刷新预览">'+icon('refresh')+'</button><button class="plain-icon" data-act="expand" aria-label="全屏预览" title="全屏预览">'+icon('expand')+'</button></div>':'')+'</div>';
 const history=p.versions.slice(0,p.active+1).map((v,i)=>{
  const report=getRun(v.runId);
  return '<div class="bubble">'+esc(v.prompt)+'</div>'+activityCard(report)+
   '<div class="build-record version-card"><strong>已生成版本 '+(i+1)+'</strong><small>'+stamp(v.at)+(v.durationMs?' · '+(v.durationMs/1000).toFixed(1)+' 秒 · '+(new Blob([v.html]).size/1024).toFixed(1)+' KB':'')+'</small></div>';
 }).join('');
 const preset=templateById(p.templateId);
 const activity=task?'<div class="bubble">'+esc(task.prompt)+'</div>'+activityCard(task,true):'';
 const content=view==='code'?renderSourceView(p,projectFiles(p),projectSourceState(p.id)):!version?'<div class="build-empty"><span class="hero-mark">'+icon('spark')+'</span><h2>'+(locked?'正在生成预览':'等待生成应用')+'</h2><p>'+(locked?'生成可运行的网页后，会在这里打开。':'修改左侧需求后可重新提交。')+'</p></div>':
 view==='preview'?((version.reviewIssues?.length?'<p class="preview-review" role="status">已保留可预览版本。'+esc(version.reviewIssues.join('，'))+'。</p>':'')+
 '<div class="framebox '+(phone?'phone':'')+'"><iframe sandbox="allow-scripts allow-forms" title="生成应用的实时预览" id="frame"></iframe></div>'):
 '<div class="version-list">'+p.versions.map((v,i)=>'<button class="version" data-version="'+i+'" '+(locked?'disabled':'')+'><b>版本 '+(i+1)+(i===p.active?' · 当前':'')+'</b><span>'+esc(v.prompt)+'</span><small>'+stamp(v.at)+(v.reviewIssues?.length?' · 部分检查未通过':'')+'</small></button>').join('')+'</div>';
 const menu='<details class="project-menu"><summary>'+esc(p.title)+' <span>⌄</span></summary><div class="menu">'+link('home','返回工作台')+
 (version?'<button data-act="rename" '+(locked?'disabled':'')+'>重命名项目</button><button data-act="clone" '+(locked?'disabled':'')+'>复制项目</button>':'')+'</div></details>';
 return '<header class="editor-top"><div class="row">'+link('home','<span aria-hidden="true">‹</span><span class="back-label">工作台</span>','back')+menu+
 '</div><div class="row">'+(locked?'<button class="soft" data-act="stop-build">停止构建</button>':'')+
 (version?'<button class="soft" data-act="share-discovery" '+(locked?'disabled':'')+'>分享到发现</button><button class="primary" data-act="export">导出 HTML</button>':'')+'</div></header>'+
 '<div class="editor"><div class="split"><section class="chat"><header class="chat-head"><span class="chat-mark">'+icon('spark')+'</span><b>构建对话</b></header><div class="chatlog">'+history+activity+'</div><form id="iterate"><textarea id="instruction" maxlength="6000" required aria-label="修改需求" placeholder="描述你希望改动的地方…" '+(locked?'disabled':'')+'>'+esc(editorDrafts.get(p.id)??(task&&!locked?task.prompt:''))+'</textarea>'+(preset?'<div class="template-attachment"><img src="'+esc(preset.image)+'" alt=""><span>'+esc(preset.file)+'</span></div>':'')+'<div class="tools editor-tools"><button class="primary round" aria-label="提交修改" '+(locked?'disabled':'')+'>'+icon('send')+'</button></div><div class="error" id="progress" role="status"></div></form></section><section class="viewer">'+toolbar+content+'</section></div></div>';
}
function currentProject(id=projectId){
 return get(id);
}
function loadPreview(p){
 const frame=$('frame');
 if(!frame)return;
 frame.srcdoc=previewDocument(p.versions[p.active].html);
}
function render(){
 const [page,id]=route();projectId=id;sidebar(page);
 document.body.classList.remove('open');
 document.body.classList.toggle('in-editor',page==='edit'&&Boolean(currentProject(id)));
 document.body.classList.toggle('sidebar-compact',sidebarCompact);
 document.title=titles[page]+' · 应用工坊';
 if(page==='home')$('screen').innerHTML=home();
 else if(page==='edit'){
  const p=currentProject(id);
  $('screen').innerHTML=p?editor(p):top(page)+'<div class="empty">项目不存在。'+link('projects','返回项目')+'</div>';
  if(p){loadPreview(p);if(view==='code')void loadProjectFiles(p)}
  const log=document.querySelector('.chatlog');
  if(log)log.scrollTop=log.scrollHeight;
 }
 else{
 const body={projects:()=>{
  const items=projects();
  return '<h1 class="title">我的项目</h1>'+
   (items.length?'<input id="search" class="field" placeholder="搜索项目名称" aria-label="搜索项目">':'')+
   '<div id="results">'+projectRows(items)+'</div>';
 },templates:()=>templatePage(id),settings:settingsPage,discover:()=>discoverPage(id),login:loginPage};
 $('screen').innerHTML=top(page)+'<div class="page">'+body[page]()+'</div>';
 }
 clearTimeout(discoveryRefreshTimer);
 if(!document.hidden)loadDiscoveryList();
 if(id&&(page==='discover'||page==='templates'))void loadGalleryDetail(page,id);
}
window.addEventListener('message',e=>{
 if(!$('frame')||e.source!==$('frame').contentWindow)return;
 const p=get(projectId);if(!p?.versions[p.active]?.cfg)return;
 const key='state:'+p.id+':'+p.versions[p.active].cfg.kind;
 if(e.data?.type==='studio-ready')e.source.postMessage({type:'studio-restore',value:read(key,{})},'*');
 if(e.data?.type==='studio-state'){try{save(key,e.data.value)}catch{notice('空间已满，应用数据未保存。')}}
});
function activeReport(p){
 const report=pending&&pending.runId===p.latestRunId?pending:getRun(p.latestRunId);
 if(!report||p.versions.some(version=>version.runId===report.runId))return null;
 if(report===pending||report.state!=='building')return report;
 return {...report,state:'interrupted',steps:report.steps.map(step=>step.status==='running'?{...step,status:'interrupted'}:step)};
}
const statusLabel={running:'进行中',passed:'完成'};
const legacyAdjustments=new Set(['规划 · 补全验收计划','修复 · 将诊断交回模型','定位 · 重新绑定页面控件']);
function visibleSteps(steps){
 return steps.filter(step=>Object.hasOwn(statusLabel,step.status)).map(step=>{
  const detail=legacyAdjustments.has(step.label)?'':
   step.detail?.replace(/^[^\n]+ · (构建任务书|已返回文件内容)(?=\n|$)/,'$1');
  return {...step,detail};
 });
}
function stepList(steps){
 return visibleSteps(steps).map(step=>'<li class="runtime-step '+step.status+'"><div class="runtime-row"><span class="runtime-dot" aria-hidden="true"></span><b>'+esc(step.label)+'</b><small>'+statusLabel[step.status]+(step.durationMs===undefined?'':' · '+(step.durationMs/1000).toFixed(1)+' 秒')+'</small></div>'+
  (step.detail?'<p>'+esc(step.detail)+'</p>':'')+'</li>').join('');
}
function runCaption(report){
 const count=visibleSteps(report.steps).length;
 if(report.state==='building')return '正在构建 · '+count+' 个步骤';
 if(report.state==='error')return '构建暂未完成';
 if(report.state==='cancelled')return '已停止构建';
 if(report.state==='interrupted')return '构建中断';
 return '构建过程 · '+count+' 个步骤';
}
const failureMessages={
 acceptance:'应用未通过交互验收。需求和已保存版本仍在。',
 generation:'生成服务暂时未能完成请求。需求已保留。',
 workspace:'项目文件暂时无法保存。需求已保留。',
 identity:'登录状态发生变化。刷新页面后可继续构建。',
 'input-size':'当前需求和项目源码超出处理上限。可以缩短需求后重试。',
 storage:'浏览器存储空间不足。需求已保留。',
 output:'生成的网页尚未完整构建。需求已保留。'
};
function buildFailure(error,steps){
 if(error?.name==='QuotaExceededError')return 'storage';
 if(Object.hasOwn(failureMessages,error?.code))return error.code;
 if(error?.acceptance)return 'acceptance';
 const label=steps.findLast(step=>step.status==='failed')?.label||'';
 if(label.startsWith('验收'))return 'acceptance';
 if(label.startsWith('规划')||label.startsWith('开发')||label.startsWith('调整'))return 'generation';
 if(label.startsWith('交付'))return 'workspace';
 return 'output';
}
function activityCard(report,active=false){
 if(!report)return '';
 const message=report.state==='error'?failureMessages[report.failure||buildFailure(null,report.steps)]:
  report.state==='interrupted'?'已保留需求，可重新提交。':'';
 return '<details class="runtime-card" '+(active?'id="active-run" open':'')+'><summary><span class="runtime-caption"'+(active?' aria-live="polite"':'')+'>'+runCaption(report)+'</span></summary><ol class="runtime-steps">'+stepList(report.steps)+'</ol>'+
 (message?'<p class="runtime-message">'+esc(message)+'</p>'+
  (active&&report.failure!=='identity'?'<button type="button" class="soft retry-build" data-act="retry-build">重试构建</button>':''):'')+'</details>';
}
async function build(text,p,context,run,runId){
 const old=p.versions[p.active],at=Date.now();
 const preset=old?null:templateById(p.templateId);
 let base=old;
 const writeDraft=async next=>{
  await saveWorkspace(p.id,'drafts',runId,next,run.signal);
  buildingFiles=next;
  streamedFiles=null;
  projectSourceState(p.id).streamPath=null;
  if(route()[1]===p.id)refreshProjectFiles();
 };
 await run.step('工作区 · 准备项目文件夹',async detail=>{
  if(preset)base=await templateVersion(preset);
  await writeDraft(openWorkspace(base));
  detail(preset?'已载入模板源码与参考图片':'项目目录已就绪');
 });
 const request=context?text+'\n\n参考文件 '+context.name+'：\n'+context.content:text;
 const {html,files,model,reviewIssues}=await runBuildAgent({
  request,previous:base,run,onFiles:writeDraft,onStreamFiles:stream=>showStreamedFiles(p,stream)
 });
 const title=p.customTitle||new DOMParser().parseFromString(html,'text/html').title||text.slice(0,30);
 const versions=[...p.versions,{html,files,prompt:text,at,engine:model,durationMs:Date.now()-at,runId,reviewIssues}];
 await run.step('交付 · 保存项目版本',async detail=>{
  if(!await saveWorkspace(p.id,'versions',runId,files,run.signal)){
   throw Object.assign(Error('无法保存项目文件。'),{code:'workspace'});
  }
  run.signal?.throwIfAborted();
  const latest=get(p.id);
  if(latest?.latestRunId!==runId)throw Error('项目已在另一个页面发起新构建，当前结果无法保存。');
  put({...latest,title:latest.customTitle||title,versions,active:versions.length-1,updated:Date.now()});
  detail('版本 '+versions.length+' · 已保存工作区文件、HTML 和对话');
 });
 return reviewIssues;
}
function navigate(hash){
 if(location.hash==='#'+hash)render();
 else location.hash=hash;
}
function showSteps(steps){
 pending.steps=steps;
 try{putRun(pending)}catch{}
 const card=$('active-run');
 if(route()[1]!==pending.id||!card)return;
 card.querySelector('.runtime-caption').textContent=runCaption(pending);
 card.querySelector('.runtime-steps').innerHTML=stepList(steps);
 const chat=card.closest('.chatlog');
 if(card.open)chat.scrollTop=chat.scrollHeight;
}
async function saveClone(version,title,template,origin){
 const id=crypto.randomUUID(),workspaceId=crypto.randomUUID();
 const stored={...version,at:Date.now(),workspaceId,prompt:template?.prompt||'从发现克隆 · '+title};
 const now=Date.now();
 if(!await saveWorkspace(id,'versions',workspaceId,openWorkspace(stored)))throw Error('无法保存项目副本。');
 const project={id,title,customTitle:title,templateId:template?.id,
  discoveryOrigin:origin,updated:now,active:0,versions:[stored]};
 put(project);
 return project;
}
function editTemplateDraft(id){
 const template=templateById(id);
 if(!template)return;
 composerTemplate=template;
 draft=template.prompt;
 focusPrompt();
}
const personalWorkspace='personal';
function cloneTemplateDialog(id){
 const template=templateById(id);
 if(template)cloneDialog({
  heading:'克隆模板',title:template.title,action:{kind:'clone-template',id},
  clone:async title=>saveClone(await templateVersion(template),title,template)
 });
}
function cloneDiscoveryDialog(id){
 const item=discoveryItems?.find(entry=>entry.id===id)||discoveryCache.get(id);
 if(item)cloneDialog({
  heading:'克隆项目',title:item.title,action:{kind:'clone-discovery',id},
  clone:async title=>{
   const version=discoveryCache.get(id)||await getDiscovered(id);
   return saveClone({html:version.html,files:version.files,engine:'发现作品'},title,null,id);
  }
 });
}
function cloneDialog({heading,title,action,clone}){
 const dialog=document.createElement('dialog');
 dialog.className='template-clone-dialog';
 dialog.setAttribute('aria-labelledby','clone-heading');
 dialog.innerHTML='<button type="button" class="plain-icon clone-close" data-act="close-dialog" aria-label="关闭克隆窗口">×</button>'+
  '<form><h2 id="clone-heading">'+esc(heading)+'</h2>'+
  '<p class="muted">复制「'+esc(title)+'」到指定工作区。</p>'+
  '<label for="clone-title">项目名称</label><input id="clone-title" class="field" required maxlength="90">'+
  '<label for="clone-workspace">目标工作区</label><select id="clone-workspace" class="field" required>'+
  '<option value="" disabled selected>选择工作区</option><option value="'+personalWorkspace+'">'+esc(settings.name)+'</option></select>'+
  '<div class="error" role="alert" id="clone-error"></div>'+
  '<div class="row"><button type="button" class="soft" data-act="close-dialog">取消</button><button type="submit" class="primary" disabled>克隆</button></div></form>';
 const form=dialog.querySelector('form');
 $('screen').append(dialog);
 const titleField=form.querySelector('#clone-title');
 titleField.value=Array.from(title).slice(0,titleField.maxLength).join('');
 form.addEventListener('submit',event=>{
  event.preventDefault();
  void confirmClone(form,action,clone);
 });
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.addEventListener('cancel',event=>{if(form.dataset.saving)event.preventDefault()});
 dialog.showModal();
 titleField.focus();
}
function updateCloneButton(form){
 form.querySelector('button[type=submit]').disabled=Boolean(form.dataset.saving)||
  !form.querySelector('#clone-title').value.trim()||form.querySelector('#clone-workspace').value!==personalWorkspace;
}
async function confirmClone(form,action,clone){
 const title=form.querySelector('#clone-title').value.trim();
 const workspace=form.querySelector('#clone-workspace').value;
 if(!title||workspace!==personalWorkspace||form.dataset.saving)return;
 if(!requireLogin(action))return;
 const dialog=form.closest('dialog');
 const errorMessage=form.querySelector('#clone-error');
 errorMessage.textContent='';
 form.dataset.saving='true';
 updateCloneButton(form);
 for(const button of dialog.querySelectorAll('[data-act=close-dialog]'))button.disabled=true;
 try{
  const project=await clone(title);
  dialog.close();
  navigate('edit/'+project.id);
  notice('已克隆到 '+settings.name);
 }catch(error){
  if(error.code==='auth-required'){requireLogin(action,true);return}
  errorMessage.textContent=error.message;
  delete form.dataset.saving;
  updateCloneButton(form);
  for(const button of dialog.querySelectorAll('[data-act=close-dialog]'))button.disabled=false;
 }
}
function shareDialog(project){
 const dialog=document.createElement('dialog');
 dialog.innerHTML='<form id="publish-discovery"><h2>分享到发现</h2><p class="muted">发布当前版本的网页和源码，供其他用户预览和克隆。</p>'+
  '<label for="discovery-title">作品名称</label><input id="discovery-title" class="field" required maxlength="120">'+
  '<label for="discovery-summary">作品简介</label><input id="discovery-summary" class="field" maxlength="220">'+
  '<div class="row"><button type="button" class="soft" data-act="close-dialog">取消</button><button class="primary">确认发布</button></div></form>';
 $('screen').append(dialog);
 $('discovery-title').value=project.title;
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.showModal();
}
async function shareProject(form){
 const project=currentProject(),version=project?.versions[project.active];
 if(!version)return;
 const button=form.querySelector('.primary');
 if(button.disabled)return;
 const title=form.querySelector('#discovery-title').value.trim();
 const description=form.querySelector('#discovery-summary').value.trim();
 button.disabled=true;
 try{
  const versionId=version.workspaceId||version.runId||crypto.randomUUID();
  const saved=await saveWorkspace(project.id,'versions',versionId,openWorkspace(version));
  if(!saved)throw Error('需要连接工作台服务才能发布。');
  const entry=await publishDiscovered({
   projectId:project.id,versionId,title,description,author:settings.name,html:version.html
  });
  discoveryItems=null;discoveryCache.delete(entry.id);discoveryFailed=false;
  form.closest('dialog').close();
  navigate('discover/'+entry.id);
  notice('已分享到发现');
 }catch(error){
  notice(error.message);
  button.disabled=false;
 }
}
document.addEventListener('submit',async e=>{
 const form=e.target;
 if(form.id==='email-auth'){e.preventDefault();await submitLogin(form);return}
 if(!['prefs','create','iterate','rename-project','publish-discovery'].includes(form.id))return;
 e.preventDefault();
 if(form.id==='publish-discovery'){await shareProject(form);return}
 if(form.id==='prefs'){
  const name=$('ws').value.trim();
  if(name){settings={name};save('settings',settings);render();notice('设置已保存')}
  return;
 }
 if(form.id==='rename-project'){
  const title=$('project-title').value.trim(),p=get(projectId);
  if(title&&p){put({...p,title,customTitle:title,updated:Date.now()});render();notice('项目已重命名')}
  return;
 }
 if(working){notice('已有应用正在生成');return}
 const text=form.querySelector('textarea').value.trim();
 const isNew=form.id==='create';
 if(!requireLogin(isNew?newProjectAction(text):{kind:'project',id:projectId}))return;
 if(!text){notice('请输入应用需求');return}
 const p=isNew?{id:crypto.randomUUID(),title:composerTemplate?.title||text.slice(0,32),
  templateId:composerTemplate?.id,versions:[],active:-1}:currentProject();
 const context=isNew?attachment:activeReport(p)?.reference||(failedAttachment?.id===p.id?failedAttachment.file:null);
 const runId=crypto.randomUUID();
 const project={...p,latestRunId:runId,updated:Date.now()};
 pending={id:p.id,runId,prompt:text,reference:context||undefined,state:'building',steps:[]};
 try{
  putRun(pending);
  put(project);
 }catch{
  pending=null;
  notice('无法保存项目，请检查浏览器存储空间');
  return;
 }
 working=true;
 const controller=new AbortController();
 buildController=controller;
 buildingFiles=openWorkspace(project.versions[project.active]);
 streamedFiles=null;
 const source=projectSourceState(project.id);
 source.selected='index.html';source.follow=true;source.streamPath=null;
 view='code';
 if(isNew){draft='';attachment=null;composerTemplate=null}
 else editorDrafts.delete(p.id);
 navigate('edit/'+p.id);
 try{
  const reviewIssues=await build(text,project,context,createRun(showSteps,controller.signal),runId);
  pending.state='complete';
  try{putRun(pending)}catch{}
  pending=null;failedAttachment=null;
  if(route()[1]===p.id){view='preview';render();notice(reviewIssues?.length?'可预览版本已保存':'应用已生成并保存')}
 }catch(error){
  pending.state=controller.signal.aborted?'cancelled':'error';
  if(pending.state==='error')pending.failure=buildFailure(error,pending.steps);
  source.streamPath=null;
  if(context)failedAttachment={id:p.id,file:context};
  try{putRun(pending)}catch{}
  if(error.code==='auth-required'){requireLogin({kind:'project',id:p.id},true);return}
  if(route()[1]===p.id){
   if(p.versions[p.active])view='preview';
   render();
  }
 }finally{working=false;buildController=null;buildingFiles=null;streamedFiles=null;source.streamPath=null}
});
document.addEventListener('click',e=>{
 const btn=e.target.closest('button');if(!btn){if(document.body.classList.contains('open')&&(!e.target.closest('#sidebar')||e.target.closest('a')))document.body.classList.remove('open');return}
 const {act,view:tab,version,idea,homeTab:tabKey,file,folder,cloneTemplate:templateId,editTemplate,cloneDiscovery:publicId,provider}=btn.dataset;
 if(provider){void signInWith(provider,btn);return}
 if(act==='signout'){void signOut(btn);return}
 if(act==='change-email'){
  if(authBusy)return;
  resetEmailChallenge();
  render();$('auth-email')?.focus();return;
 }
 if(act==='resend-code'){if(!btn.disabled)void sendLoginCode(loginEmail,btn);return}
 if(act==='new-project'){if(requireLogin(newProjectAction()))focusPrompt();return}
 if(templateId){if(requireLogin({kind:'clone-template',id:templateId}))cloneTemplateDialog(templateId);return}
 if(editTemplate){if(requireLogin({kind:'edit-template',id:editTemplate}))editTemplateDraft(editTemplate);return}
 if(publicId){if(requireLogin({kind:'clone-discovery',id:publicId}))cloneDiscoveryDialog(publicId);return}
 if(act==='share-discovery'){if(requireLogin({kind:'project',id:projectId}))shareDialog(currentProject());return}
 if(act==='close-dialog'){btn.closest('dialog').close();return}
 if(act==='retry-discovery'){loadDiscoveryList(true);return}
 if(act==='retry-build'){
  if(working)return;
  const project=currentProject(),task=project&&activeReport(project);
  if(!task)return;
  $('instruction').value=task.prompt;
  $('iterate').requestSubmit();
  return;
 }
 if(act==='stop-build'){
  if(pending?.id===projectId){btn.disabled=true;btn.textContent='正在停止';buildController?.abort()}
  return;
 }
 if(file){
  const state=projectSourceState(projectId);
  state.selected=file;
  state.follow=false;
  refreshProjectFiles();
  document.querySelector('[data-file][aria-pressed=true]')?.focus();
  return;
 }
 if(folder){
  const state=projectSourceState(projectId);
  if(state.collapsed.has(folder))state.collapsed.delete(folder);
  else state.collapsed.add(folder);
  refreshProjectFiles({code:false});
  Array.from(document.querySelectorAll('[data-folder]')).find(el=>el.dataset.folder===folder)?.focus();
  return;
 }
 if(tabKey){homeTab=tabKey;render();document.querySelector('[data-home-tab="'+tabKey+'"]')?.focus();return}
 if(idea!==undefined){composerTemplate=null;draft=ideas[Number(idea)][1];focusPrompt();return}
 if(act==='collapse'){sidebarCompact=!sidebarCompact;save('sidebar-compact',sidebarCompact);document.body.classList.toggle('sidebar-compact',sidebarCompact);return}
 if(act==='attach'){$('reference-file')?.click();return}
 if(act==='detach'){attachment=null;$('attachment-chip').innerHTML=attachmentChip();$('reference-file').value='';return}
 if(act==='detach-template'){composerTemplate=null;render();$('prompt')?.focus();return}
 if(act==='refresh'){loadPreview(currentProject());return}
 if(act==='expand'){
  const framebox=$('frame')?.parentElement;
  if(document.fullscreenElement)document.exitFullscreen();
  else if(framebox?.requestFullscreen)framebox.requestFullscreen().catch(()=>notice('当前浏览器无法打开全屏预览'));
  else notice('当前浏览器不支持全屏预览');
  return;
 }
 if(act==='rename'){
  const dialog=document.createElement('dialog');
  dialog.innerHTML='<form id="rename-project"><label for="project-title">项目名称</label><input class="field" id="project-title" maxlength="90" required><div class="row"><button type="button" class="soft" data-act="cancel-rename">取消</button><button class="primary">保存名称</button></div></form>';
  $('screen').append(dialog);
  $('project-title').value=currentProject().title;
  dialog.showModal();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});return;
 }
 if(act==='cancel-rename'){btn.closest('dialog').close();return}
 if(act==='clone'){
  if(!requireLogin({kind:'project',id:projectId}))return;
  const p=currentProject();
  const title=p.title+'（副本）',id=crypto.randomUUID();
  const versions=[...p.versions];
  const active=versions[p.active];
  const workspaceId=active.workspaceId||active.runId||crypto.randomUUID();
  versions[p.active]={...active,workspaceId};
  btn.disabled=true;
  void saveWorkspace(id,'versions',workspaceId,openWorkspace(active)).then(saved=>{
   if(!saved)throw Error('无法保存项目副本。');
   put({...p,id,title,versions,customTitle:title,latestRunId:active.runId,updated:Date.now()});
   navigate('edit/'+id);
  }).catch(error=>{
   if(error.code==='auth-required'){requireLogin({kind:'project',id:p.id},true);return}
   btn.disabled=false;notice(error.message);
  });
  return;
 }
 if(tab){view=tab;render();return}
 if(version!==undefined){const p=get(projectId);p.active=Number(version);p.title=p.customTitle||p.versions[p.active].cfg?.title||new DOMParser().parseFromString(p.versions[p.active].html,'text/html').title||p.title;p.updated=Date.now();put(p);view='preview';render();return}
 if(act==='menu')document.body.classList.toggle('open');
 if(act==='phone'){phone=!phone;view='preview';render()}
 if(act==='export'){const p=get(projectId);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([p.versions[p.active].html],{type:'text/html'}));a.download=p.title+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
});
document.addEventListener('input',e=>{
 if(e.target.id==='auth-email'){
  const changed=e.target.value.trim().toLowerCase()!==loginEmail.trim().toLowerCase();
  loginEmail=e.target.value;
  if(emailChallenge&&changed){
   resetEmailChallenge();
   render();
   $('auth-email')?.focus();
  }
  return;
 }
 if(e.target.id==='clone-title'){updateCloneButton(e.target.form);return}
 if(e.target.id==='source-filter'){projectSourceState(projectId).search=e.target.value;refreshProjectFiles({code:false});return}
 if(e.target.id==='prompt')draft=e.target.value;if(e.target.id==='instruction')editorDrafts.set(projectId,e.target.value);if(e.target.id==='search')$('results').innerHTML=projectRows(projects().filter(p=>p.title.toLowerCase().includes(e.target.value.toLowerCase())))});
let shouldFocusPrompt=false;
function applyPromptFocus(){
 if(!shouldFocusPrompt||!$('prompt'))return;
 $('prompt').focus();
 shouldFocusPrompt=false;
}
function focusPrompt(){
 shouldFocusPrompt=true;
 if(route()[0]==='home'){render();applyPromptFocus()}
 else navigate('home');
}
document.addEventListener('change',async e=>{
 if(e.target.id==='clone-workspace'){updateCloneButton(e.target.form);return}
 if(e.target.id!=='reference-file')return;
 const file=e.target.files[0];
 if(!file)return;
 if(file.size>6000){notice('参考文件需小于 6 KB');e.target.value='';return}
 const content=await file.text();
 if(content.includes(String.fromCharCode(0))){notice('请选择文本文件');e.target.value='';return}
 attachment={name:file.name,content};
 if($('attachment-chip'))$('attachment-chip').innerHTML=attachmentChip();
});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)clearTimeout(discoveryRefreshTimer);
 else loadDiscoveryList();
});
window.onhashchange=()=>{
 view=pending?.id===route()[1]&&pending.state==='building'?'code':'preview';phone=false;render();scrollTo(0,0);
 applyPromptFocus();
};
window.onstorage=e=>{
 if(e.key==='atoms:session-owner'&&e.newValue!==(account?.id||'guest'))location.reload();
 else if(e.key?.startsWith(storagePrefix+'p:')&&route()[0]==='projects')render();
};
async function openStudio(){
 restoreEmailFlow();
 try{
  ({account,providers,emailEnabled}=await authRequest('session'));
  setWorkspaceIdentity(account?.id);
  if(account){
   storagePrefix='atoms:account:'+account.id+':';
   settings=read('settings',{name:account.name||'我的工作区'});
   sidebarCompact=read('sidebar-compact',false);
  }
  localStorage.setItem('atoms:session-owner',account?.id||'guest');
 }catch{}
 const url=new URL(location.href);
 if(url.searchParams.get('auth')==='failed'){
  authError='登录未完成，请重试。';
  url.searchParams.delete('auth');
  history.replaceState(null,'',url);
 }
 const action=takeLoginAction();
 if(action){await resumeLoginAction(action);return}
 render();
}
async function resumeLoginAction(action){
 const {kind,id}=action;
 const template=templateById(id);
 let destination='projects';
 if(kind==='create'){
  draft=typeof action.prompt==='string'?action.prompt:'';
  attachment=action.attachment||null;
  composerTemplate=templateById(action.templateId)||null;
  destination='home';
 }else if(kind==='edit-template'&&template){
  composerTemplate=template;
  draft=template.prompt;
  destination='home';
 }else if(kind==='clone-template'&&template)destination='templates/'+id;
 else if(kind==='clone-discovery'&&typeof id==='string'&&/^[a-f0-9]{32}$/.test(id))destination='discover/'+id;
 else if(kind==='project'&&typeof id==='string'&&get(id))destination='edit/'+id;
 history.replaceState(null,'','#'+destination);
 if(kind==='clone-discovery'&&destination.startsWith('discover/')){
  try{discoveryCache.set(id,await getDiscovered(id))}catch(error){notice(error.message)}
 }
 render();
 if(destination==='home')$('prompt')?.focus();
 if(kind==='clone-template'&&template)cloneTemplateDialog(id);
 if(kind==='clone-discovery'&&discoveryCache.has(id))cloneDiscoveryDialog(id);
}
void openStudio();
if(location.protocol!=='file:' && 'serviceWorker' in navigator)navigator.serviceWorker.register(new URL('./sw.js',import.meta.url)).catch(()=>{});
