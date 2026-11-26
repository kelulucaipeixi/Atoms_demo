/* Build standalone applications from a small, explicit offline vocabulary. */
export const catalog = [
 {kind:'board', label:'项目看板', en:'Sprint board', title:'团队冲刺看板', category:'效率工具', prompt:'创建一个名为「团队冲刺看板」的任务看板，支持优先级、截止日期和拖拽。', color:'#5555db'},
 {kind:'timer', label:'专注计时器', en:'Focus room', title:'深度工作室', category:'生活方式', prompt:'生成一个名为「深度工作室」的专注计时器，每次专注 25 分钟，休息 5 分钟。', color:'#215b43'},
 {kind:'ledger', label:'记账应用', en:'Daily ledger', title:'日常账本', category:'生活方式', prompt:'生成一个名为「日常账本」的记账工具，可以添加收入、支出并查看结余。', color:'#ad533c'},
 {kind:'mortgage', label:'贷款计算器', en:'Loan studio', title:'购房预算助手', category:'实用工具', prompt:'做一个名为「购房预算助手」的等额本息房贷计算器，贷款 100 万元，期限 30 年。',color:'#304e82'}
];
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors = {蓝:'#3069cb',绿:'#21744f',紫:'#7754c7',红:'#b84346',黑:'#272828',橙:'#b65525',粉:'#bb537b'};
export function plan(text, previous) {
 const type = /房贷|贷款|月供|mortgage/i.test(text)?'mortgage':/记账|账本|收支|ledger|expense/i.test(text)?'ledger':/番茄|专注|计时|timer|pomodoro/i.test(text)?'timer':/任务|待办|看板|todo|kanban/i.test(text)?'board':previous?.kind;
 if(!type) throw Error('本地生成支持任务看板、专注计时、记账和房贷计算。请描述其中一种，或在设置中启用模型生成。');
 const base=catalog.find(item=>item.kind===type);
 const old=previous?.kind===type?previous:{};
 const read=(pattern,fallback,max)=>Math.min(max,Math.max(1,Number(text.match(pattern)?.[1])||fallback));
 const name=text.match(/[「“《]([^」”》]{1,60})[」”》]/)?.[1];
 const color=text.match(/#[0-9a-f]{6}\b/i)?.[0] || colors[text.match(/(蓝|绿|紫|红|黑|橙|粉)色/)?.[1]];
 const next={kind:type,title:name||old.title||base.title,color:color||old.color||base.color,
 minutes:read(/(?:专注|工作)\s*(\d+)\s*分钟/,old.minutes||25,240),rest:read(/休息\s*(\d+)\s*分钟/,old.rest||5,120),
 amount:read(/(?:贷款|本金)\s*(\d+)\s*万/,old.amount||100,100000),years:read(/(\d+)\s*年/,old.years||30,60)};
 if(previous && JSON.stringify(next)===JSON.stringify(previous)) throw Error('本地模式可修改名称（如「我的项目」）、主色、专注时长或贷款参数。这个指令还未改变应用。');
 return next;
}
// This function is serialized into the exported HTML and runs in its sandbox.
function runtime(cfg){
 const $=id=>document.getElementById(id), body=$('controls'), list=$('list');
 let data={rows:[],end:0,left:cfg.minutes*60,phase:'专注',sessions:0};
 function draw(){
  list.replaceChildren();
  if(cfg.kind==='board'){
   list.className='columns';
   for(const col of ['待处理','进行中','已完成']){
    const section=document.createElement('section'),title=document.createElement('h3');
    title.textContent=col+' · '+data.rows.filter(r=>r.status===col).length;
    section.append(title);section.ondragover=e=>e.preventDefault();
    section.ondrop=e=>{e.preventDefault();const r=data.rows.find(x=>x.id===e.dataTransfer.getData('text/plain'));if(r){r.status=col;save();draw()}};
    for(const r of data.rows.filter(x=>x.status===col)){
     const card=document.createElement('article');card.draggable=true;
     card.ondragstart=e=>e.dataTransfer.setData('text/plain',r.id);
     const meta=document.createElement('small');meta.textContent=r.priority+'优先级 · '+(r.date||'无截止日');
     const name=document.createElement('strong');name.textContent=r.name;
     const move=document.createElement('button');move.textContent=col==='待处理'?'开始任务':col==='进行中'?'完成任务':'重新打开';
     move.onclick=()=>{r.status=col==='待处理'?'进行中':col==='进行中'?'已完成':'待处理';save();draw()};
     card.append(meta,name,move,remove(r));section.append(card);
    }list.append(section);
   }
  }
  if(cfg.kind==='ledger'){
   const balance=data.rows.reduce((s,r)=>s+(r.type==='收入'?r.value:-r.value),0);
   $('metric').textContent='¥ '+balance.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
   for(const r of data.rows){const row=document.createElement('article');row.textContent=r.name+' · '+r.type+' ¥'+r.value.toFixed(2)+' ';row.append(remove(r));list.append(row)}
  }
  if(cfg.kind==='timer') tick();
  if(cfg.kind==='mortgage'){for(const [key,val] of Object.entries(data.loan||{})) if($(key))$(key).value=val;calculate()}
 }
 const storageKey='studio-app:'+cfg.id;
 function save(){
  if(parent!==window)parent.postMessage({type:'studio-state',value:data},'*');
  else try{localStorage.setItem(storageKey,JSON.stringify(data))}catch{}
 }
 function remove(row){const b=document.createElement('button');b.textContent='删除';b.onclick=()=>{data.rows=data.rows.filter(x=>x.id!==row.id);save();draw()};return b}
 function tick(){
  if(data.end){data.left=Math.max(0,Math.ceil((data.end-Date.now())/1000));if(!data.left){data.end=0;if(data.phase==='专注')data.sessions++;data.phase=data.phase==='专注'?'休息':'专注';data.left=(data.phase==='休息'?cfg.rest:cfg.minutes)*60;save()}}
  $('metric').textContent=String(Math.floor(data.left/60)).padStart(2,'0')+':'+String(data.left%60).padStart(2,'0');$('mode').textContent=data.phase+' · 已完成 '+data.sessions+' 次专注';$('start').textContent=data.end?'暂停':'开始';
 }
 function calculate(){
  const p=Number($('principal').value)*10000,r=Number($('rate').value)/1200,n=Number($('years').value)*12;
  if(!body.checkValidity()){$('metric').textContent='请输入有效参数';return}
  const payment=r?p*r/(-Math.expm1(-n*Math.log1p(r))):p/n;
  $('metric').textContent='¥ '+payment.toFixed(2);list.textContent='总利息 ¥ '+(payment*n-p).toFixed(2);
 }
 if(cfg.kind==='board'||cfg.kind==='ledger')body.onsubmit=e=>{e.preventDefault();const name=$('name').value.trim();if(!name)return;
  data.rows.unshift(cfg.kind==='board'?{id:Math.random().toString(36).slice(2),name,status:'待处理',priority:$('priority').value,date:$('date').value}:{name,type:$('type').value,value:Number($('value').value)});body.reset();save();draw()};
 if(cfg.kind==='timer'){ $('start').onclick=()=>{tick();data.end=data.end?0:Date.now()+data.left*1000;save();tick()};$('reset').onclick=()=>{data.phase='专注';data.end=0;data.left=cfg.minutes*60;save();tick()};setInterval(tick,250)}
 if(cfg.kind==='mortgage')body.oninput=()=>{data.loan=Object.fromEntries(['principal','rate','years'].map(k=>[k,$(k).value]));save();calculate()};
 if(parent===window){try{Object.assign(data,JSON.parse(localStorage.getItem(storageKey)))}catch{}}
 else {window.addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='studio-restore'){Object.assign(data,e.data.value||{});draw()}});parent.postMessage({type:'studio-ready'},'*')}
 draw();
}
export function generate(config,id){
 const cfg={...config,id},t=catalog.find(x=>x.kind===cfg.kind);
 const forms={board:'<input id="name" required maxlength="120" placeholder="任务名称" aria-label="任务名称"><select id="priority" aria-label="优先级"><option>普通</option><option>高</option><option>低</option></select><input id="date" type="date" aria-label="截止日期"><button>添加任务</button>',
 ledger:'<p>当前结余</p><h2 id="metric"></h2><input id="name" required maxlength="100" placeholder="收支项目" aria-label="收支项目"><select id="type" aria-label="类型"><option>支出</option><option>收入</option></select><input id="value" type="number" min=".01" max="999999999" step=".01" required placeholder="金额" aria-label="金额"><button>记一笔</button>',
 timer:'<p id="mode"></p><h2 id="metric"></h2><button type="button" id="start">开始</button> <button type="button" id="reset">重置</button>',
 mortgage:'<p>每月还款</p><h2 id="metric"></h2>'+[['贷款本金（万元）','principal',cfg.amount,0.01,100000],['年利率（%）','rate',3.2,0,50],['还款年限','years',cfg.years,1,60]].map(([name,key,v,min,max])=>'<label>'+name+'<input type="number" required step="'+(key==='years'?'1':'.01')+'" id="'+key+'" min="'+min+'" max="'+max+'" value="'+v+'"></label>').join('')};
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(cfg.title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f5f2;color:#232c2b;font:16px system-ui}main{max-width:1080px;margin:auto;padding:clamp(18px,4vw,58px)}header{border-top:5px solid ${cfg.color};padding:24px 0 12px}small{color:#58635f}h1{font-size:clamp(30px,5vw,56px);letter-spacing:-.06em;margin:12px 0 20px}form,section,article{background:white;border-radius:13px;padding:18px}form{margin-bottom:18px}input,button,select{font:inherit;padding:10px;border:1px solid #d6dad8;border-radius:8px;max-width:100%;margin:3px}button{cursor:pointer;color:white;background:${cfg.color};border:0}label,strong{display:block}h2{font-size:clamp(32px,7vw,74px);margin:0 0 16px;letter-spacing:-.05em}p{color:#58635f}.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:10px}section{min-height:160px;background:#e8ebe8}h3{font-size:16px;margin:0 0 12px}article{margin:8px 0;overflow-wrap:anywhere}article button{font-size:12px}strong{margin:8px 0}label input{display:block}</style><main><header><small>${t.en.toUpperCase()}</small><h1>${escapeHTML(cfg.title)}</h1></header><form id="controls">${forms[cfg.kind]}</form><div id="list"></div></main><script>(${runtime.toString()})(${JSON.stringify(cfg).replace(/</g,'\\u003c')})</script></html>`;
}
