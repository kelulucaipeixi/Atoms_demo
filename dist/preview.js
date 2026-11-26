// Shared restrictions for preview and the verification frame.
const policy='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:; media-src data: blob:; form-action &#39;none&#39;">';

export function previewDocument(html,script=''){
 return html.replace(/<html\b[^>]*>/i,tag=>tag+'<base href="about:srcdoc">'+policy+script);
}

// Serialized into a sandbox, with no access to the workspace or its data.
function exercise(channel,check,bindings,renderOnly){
 let sent=false;
 const matches=[];
 const text=value=>String(value??'').replace(/\s+/g,' ').trim();
 const key=value=>text(value).toLowerCase().replace(/[\s:_－—-]+/g,'').replace(/[：*＊]/g,'');
 const candidates={
  click:'a[href],button,summary,input[type=submit],input[type=button],input[type=checkbox],input[type=radio],[role=button],[role=link],[role=checkbox],[role=switch]',
  fill:'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=reset]),textarea',
  select:'select'
 };
 const visible=element=>element.getClientRects().length&&getComputedStyle(element).visibility==='visible';
 function report(error,binding){
  if(sent)return;
  sent=true;
  parent.postMessage({channel,error,matches,binding},'*');
 }
 function scopeNames(element){
  const scopes=[element.form||element.closest('form'),element.closest('section,[role=region]')].filter(Boolean);
  return [...new Set(scopes.flatMap(scope=>[
   scope.getAttribute('aria-label'),scope.getAttribute('name'),scope.id,
   ...labelledBy(scope),scope.querySelector('legend,h1,h2,h3,h4')?.textContent
  ]).map(text).filter(Boolean))].slice(0,5);
 }
 function labelledBy(element){
  return (element.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean)
   .map(id=>document.getElementById(id)?.textContent);
 }
 function dayKey(value){
  const label=key(value);
  const chinese=label.match(/(?:周|星期|礼拜)([一二三四五六日天])/);
  if(chinese)return '一二三四五六日'.indexOf(chinese[1]==='天'?'日':chinese[1])+1;
  const english=label.match(/^(mon|tue|wed|thu|fri|sat|sun)/);
  return english?['mon','tue','wed','thu','fri','sat','sun'].indexOf(english[1])+1:0;
 }
 function gridPosition(element){
  const explicitRow=text(element.closest('[data-habit],[data-row]')?.getAttribute('data-habit')||
   element.closest('[data-row]')?.getAttribute('data-row'));
  const explicitColumn=text(element.closest('[data-day],[data-column]')?.getAttribute('data-day')||
   element.closest('[data-column]')?.getAttribute('data-column'));
  const cell=element.closest('td,th,[role=gridcell],[role=cell]');
  const row=cell?.closest('tr,[role=row]'), table=row?.closest('table,[role=grid],[role=table]');
  if(!table)return {row:explicitRow,column:explicitColumn};
  const cells=Array.from(row.children).filter(item=>item.matches('td,th,[role=gridcell],[role=cell],[role=rowheader]'));
  const index=Number(cell.getAttribute('aria-colindex'))-1;
  const columnIndex=index>=0?index:cells.slice(0,cells.indexOf(cell)).reduce((sum,item)=>sum+(item.colSpan||1),0);
  const header=row.querySelector('th[scope=row],[role=rowheader]')||cells[0];
  const columns=Array.from(table.querySelectorAll('thead tr,[role=row]')).filter(item=>
   item.querySelector('th,[role=columnheader]')&&!item.querySelector('td,[role=gridcell]'));
  const headers=Array.from((columns.at(-1)||table.querySelector('tr'))?.children||[]);
  let offset=0, columnHeader;
  for(const item of headers){
   const start=Number(item.getAttribute('aria-colindex'))-1;
   const first=start>=0?start:offset;
   const span=item.colSpan||1;
   if(columnIndex>=first&&columnIndex<first+span){columnHeader=item;break}
   offset=first+span;
  }
  return {
   row:explicitRow||text(header!==cell?header?.textContent:''),
   column:explicitColumn||text(columnHeader?.textContent||cell.getAttribute('aria-label'))
  };
 }
 function controlInfo(element){
  const labels=[element.getAttribute('aria-label'),...labelledBy(element),
   ...Array.from(element.labels||[],label=>label.textContent),
   element.getAttribute('placeholder'),element.getAttribute('title'),
   element.matches('a,button,summary,[role=button],[role=link]')?element.textContent:null,
   element.matches('input[type=submit],input[type=button]')?element.getAttribute('value'):null];
  const grid=gridPosition(element);
  return {
   tag:element.localName,
   type:element.getAttribute('type')||element.getAttribute('role')||'',
   labels:[...new Set(labels.map(label=>text(label).slice(0,65)).filter(Boolean))].slice(0,5),
   id:text(element.id).slice(0,60),name:text(element.name).slice(0,60),
   marker:text(element.dataset.check).slice(0,60),
   scope:scopeNames(element).map(value=>value.slice(0,65)),
   autocomplete:text(element.getAttribute('autocomplete')).slice(0,60),
   href:element.matches('a[href^="#"]')?text(element.getAttribute('href')).slice(0,80):'',
   row:grid.row.slice(0,65),column:grid.column.slice(0,65),
   unavailable:element.matches(':disabled,[aria-disabled=true]')||Boolean(element.readOnly)
  };
 }
 function inScope(names,scope){
  const wanted=key(scope).replace(/(?:表单|区域|区块|form|section)$/,'');
  return wanted.length>1&&names.some(name=>{
   const actual=key(name);
   return actual===wanted||actual.includes(wanted);
  });
 }
 function semanticField(value){
  const label=key(value).replace(/^(请输入|请填写|您的|你的)/,'').replace(/^(联系人|联系|contact)/,'');
  if(/^(姓名|全名|名字|称呼|name|fullname|yourname)$/.test(label))return 'name';
  if(/^(邮箱|电子邮件|邮件地址|email|emailaddress)$/.test(label))return 'email';
  if(/^(电话|手机|手机号|联系电话|phone|telephone|tel)$/.test(label))return 'tel';
  if(/^(留言|留言内容|表单留言|message|yourmessage)$/.test(label))return 'message';
  return '';
 }
 function resolveAction(action,index){
  const {target,type,label,scope}=action;
  const column=action.column||((scope&&type==='click'&&dayKey(label))?label:'');
  const row=action.row||(column?scope:'');
  const explicit=type==='click'&&target?', [data-check="'+target+'"]':'';
  const entries=Array.from(document.querySelectorAll(candidates[type]+explicit)).filter(visible)
   .map(element=>({element,info:controlInfo(element)}));
  const sameRow=({info})=>!row||(info.row&&key(info.row).includes(key(row)))||
   (!info.row&&[...info.labels,...info.scope].some(value=>key(value).includes(key(row))));
  const sameColumn=({info})=>!column||(dayKey(column)?
   dayKey(info.column)===dayKey(column)||(!info.column&&info.labels.some(value=>dayKey(value)===dayKey(column))):
   key(info.column)===key(column));
  const coordinate=(row||column)?entries.filter(item=>sameRow(item)&&sameColumn(item)):[];
  const scoped=scope?entries.filter(item=>inScope(item.info.scope,scope)):entries;
  const pool=row||column?coordinate:scoped;
  const wanted=label||target;
  const pinned=bindings[index];
  const unique=items=>items.length===1?items[0]:null;
  const findSignature=item=>JSON.stringify(item.info);
  function selected(item,reason){
   if(reason)matches.push(wanted+' → '+reason);
   return item.element;
  }
  if(pinned){
   const bound=unique(entries.filter(item=>findSignature(item)===pinned));
   if(bound&&!bound.info.unavailable)return selected(bound,'已校对页面控件');
  }
  const gridControl=unique(coordinate);
  if(gridControl)return selected(gridControl,'表格 '+(gridControl.info.row||row)+' / '+(gridControl.info.column||column));
  const exactLabel=label?pool.filter(({info})=>info.labels.some(value=>key(value)===key(label))):[];
  const named=unique(exactLabel);
  if(named)return selected(named,'控件标签「'+label+'」');
  const labeledPool=exactLabel.length?exactLabel:pool;
  if(target){
   const marker=unique(labeledPool.filter(({info})=>info.marker===target));
   if(marker)return selected(marker,'');
   const identified=unique(labeledPool.filter(({info})=>info.id===target||info.name===target));
   if(identified)return selected(identified,'页面 ID 或名称');
  }
  if(type==='fill'&&exactLabel.length===0){
   const field=semanticField(wanted);
   const fieldMatches=field?pool.filter(({info})=>[
    ...info.labels,info.autocomplete,info.id,info.name,info.type
   ].some(value=>semanticField(value)===field)):[];
   const input=unique(fieldMatches);
   if(input)return selected(input,'输入字段「'+(input.info.labels[0]||input.info.name||input.info.id)+'」');
  }
  if(type==='click'&&target.startsWith('nav-')){
   const section=target.slice(4);
   const fragment='#'+section;
   const anchored=pool.filter(({info})=>info.href===fragment&&document.getElementById(section));
   if(anchored.length===1)return selected(anchored[0],'页面锚点 '+fragment);
  }
  const priority=new Set(labeledPool);
  const ranked=[...priority,...entries.filter(item=>!priority.has(item))];
  const counts=new Map();
  for(const item of entries){
   const signature=findSignature(item);
   counts.set(signature,(counts.get(signature)||0)+1);
  }
  const options=ranked.slice(0,16).map((item,i)=>({
   id:i+1,control:item.info,unique:counts.get(findSignature(item))===1
  }));
  const error=Error('无法唯一定位「'+wanted+'」'+(scope?'（'+scope+'）':''));
  error.binding={index,candidates:options};
  throw error;
 }
 if(!renderOnly){
  addEventListener('error',event=>report(String(event.message||'脚本加载失败')));
  addEventListener('unhandledrejection',event=>report(String(event.reason)));
 }
 addEventListener('load',()=>{
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const find=target=>document.querySelector('[data-check="'+target+'"]')||document.getElementById(target);
  const readText=node=>node&&visible(node)?text(node.innerText):'';
  const outcomeNodes=expect=>{
   const scope=expect.scope;
   const roots=scope?Array.from(document.querySelectorAll('form,section,[role=region]')).filter(node=>
    inScope([node.id,node.getAttribute('aria-label'),node.querySelector('legend,h1,h2,h3,h4')?.textContent],scope)):[];
   return scope?roots:[document.body];
  };
  const outcomeText=expect=>outcomeNodes(expect).map(readText).join(' ');
 const normalizeResult=value=>text(value).normalize('NFKC');
 const countMatches=(result,expected)=>{
  const wanted=normalizeResult(expected);
  const actual=normalizeResult(result);
  if(/^[+-]?\d+(?:\.\d+)?$/.test(wanted)){
   return Array.from(actual.matchAll(/[+-]?\d+(?:\.\d+)?/g),match=>match[0])
    .filter(value=>Number(value)===Number(wanted)).length;
  }
  const phrase=wanted.replace(/\s+/g,'');
  return phrase?actual.replace(/\s+/g,'').split(phrase).length-1:0;
 };
  void (async()=>{
   await pause(60);
   if(!readText(document.body)&&!Array.from(document.querySelectorAll('canvas,svg,img,input,textarea,select,video')).some(visible)){
    throw Error('页面没有可渲染的正文');
   }
   if(renderOnly){report('');return}
   const width=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);
   if(width>innerWidth+12)throw Error(innerWidth+' px 视口发生横向溢出，内容宽度 '+width+' px');
   if(!check){report('');return}
   const expected=check.expect;
   const displayed=()=>{
    const node=expected.target?find(expected.target):null;
    if(expected.type==='exists')return node&&visible(node)?1:0;
    return countMatches(expected.target?readText(node):outcomeText(expected),expected.value);
   };
   const displayCheck=['text','exists'].includes(expected.type);
   const initiallyDisplayed=displayCheck?displayed():0;
   const lastClick=check.actions.findLastIndex(action=>action.type==='click');
   const isPressed=control=>control.matches('input[type=checkbox],input[type=radio]')?String(control.checked):
    control.getAttribute('aria-pressed')||control.getAttribute('aria-checked');
   let initialPressed,clickedControl;
   for(const [index,action] of check.actions.entries()){
    const element=resolveAction(action,index);
    const label=action.label||action.target;
    if(element.matches(':disabled,[aria-disabled=true]')||(action.type==='fill'&&element.readOnly)){
     throw Error('操作目标不可用「'+label+'」');
    }
    if(action.type==='click'){
     if(index===lastClick&&expected.type==='pressed'){
      clickedControl=element;
      initialPressed=isPressed(element);
     }
     element.click();
    }
    else{
     const option=action.type==='select'?Array.from(element.options).find(item=>!item.disabled&&
      (item.value===action.value||key(item.label)===key(action.value))):null;
     const value=option?option.value:action.value;
     element.value=value;
     if(element.value!==value||action.type==='select'&&element.selectedIndex<0)throw Error('无法设置「'+label+'」的测试值');
     element.dispatchEvent(new Event('input',{bubbles:true}));
     element.dispatchEvent(new Event('change',{bubbles:true}));
    }
    await pause(45);
   }
   let pressed;
   for(let attempt=0;attempt<12;attempt++){
    if(expected.type==='pressed'){
     try{
      const previousMatches=matches.length;
      const control=clickedControl?.isConnected?clickedControl:resolveAction(check.actions[lastClick],lastClick);
      matches.length=previousMatches;
      pressed=isPressed(control);
     }catch{pressed=null}
    }
    const passed=expected.type==='pressed'?pressed===expected.value&&pressed!==initialPressed:expected.type==='hash'
     ?location.hash===expected.value:displayed()>(check.actions.length?initiallyDisplayed:0);
    if(passed){report('');return}
    await pause(75);
   }
   const observed=expected.type==='hash'?location.hash:expected.type==='pressed'?pressed:
    expected.target?readText(find(expected.target)):outcomeText(expected);
   throw Error('交互结果未满足预期：'+(expected.value||expected.target)+'；实际：'+text(observed).slice(0,240));
  })().catch(error=>report(error.message,error.binding));
 });
}

export function verifyInBrowser(html,width,check,bindings,signal,renderOnly=false){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const channel=crypto.randomUUID();
  const frame=document.createElement('iframe');
  frame.setAttribute('sandbox','allow-scripts allow-forms');
  frame.setAttribute('aria-hidden','true');
  frame.tabIndex=-1;
  frame.style.cssText='position:fixed;left:-10000px;top:0;border:0;opacity:0;pointer-events:none;width:'+width+'px;height:800px';

  function finish(error,result){
   clearTimeout(timer);
   signal?.removeEventListener('abort',abort);
   removeEventListener('message',receive);
   frame.remove();
   if(error)reject(error);
   else resolve(result);
  }
  const abort=()=>finish(signal.reason);
  const timer=setTimeout(()=>finish(Error(width+' px 视口未完成渲染或交互')),4500);
  function receive(event){
   if(event.source!==frame.contentWindow||event.data?.channel!==channel)return;
   const {error,binding,matches}=event.data;
   if(typeof error!=='string')return;
   const validBinding=Number.isInteger(binding?.index)&&binding.index>=0&&binding.index<(check?.actions.length??0)&&
    Array.isArray(binding.candidates);
   if(error)finish(Object.assign(Error(error.slice(0,500)),{
    binding:validBinding?{index:binding.index,candidates:binding.candidates.slice(0,16)}:undefined
   }));
   else finish(null,Array.isArray(matches)?matches.slice(0,6).map(value=>String(value).slice(0,120)):[]);
  }
  signal?.addEventListener('abort',abort,{once:true});
  addEventListener('message',receive);
  const args=JSON.stringify([channel,check,bindings,renderOnly]).replace(/</g,'\\u003c');
  frame.srcdoc=previewDocument(html,'<script>('+exercise.toString()+')(...'+args+')</script>');
  document.body.append(frame);
 });
}

