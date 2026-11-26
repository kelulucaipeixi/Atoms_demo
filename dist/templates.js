import {compileWorkspace} from './workspace.js';
import {escapeHTML as esc} from './generator.js';

const photo=(file,alt,author,license,source)=>({
 file,image:new URL('assets/templates/'+file,import.meta.url).href,alt,author,license,source
});
const scotland=photo('edinburgh.jpg','从亚瑟王座望向爱丁堡与索尔兹伯里峭壁','Rob Farrow','CC BY-SA 2.0','https://commons.wikimedia.org/wiki/File:Arthur%27s_Seat_-_view_over_Salisbury_Crags_-_geograph.org.uk_-_3118840.jpg');
const skye=photo('skye.jpg','斯凯岛波特里港口与彩色街屋','rboed','CC BY 2.0','https://commons.wikimedia.org/wiki/File:Portree_harbour,_Isle_of_Skye,_Scotland_-_53732030830.jpg');
const dolomites=photo('dolomites.jpg','从 Seceda 眺望多洛米蒂山脊','BobTanGo','CC BY 4.0','https://commons.wikimedia.org/wiki/File:The_Dolomites_from_Seceda.jpg');

export const templates=[
 {
  id:'edinburgh-goldsmith',category:'品牌与服务',title:'石砧金工',tag:'EDINBURGH · GOLDSMITH',
  hero:'为重要的一刻，<br>打一件金器。',description:'面向伴侣、收藏者和旧首饰持有者的爱丁堡定制金工工作室。',
  ...scotland,theme:'gold',
  prompt:'把网站改为「石砧金工」，一家为伴侣、收藏者与希望重制传家首饰的客人服务的爱丁堡金匠工作室。重点突出定制系列、五次会面流程和预约表单，其余区块全部保留。强调色使用赤陶色 #a7583b，用于按钮、色带和价格标记。保留浅灰底色、Georgia 衬线标题和系统无衬线正文。首屏使用附带的爱丁堡山丘与城景照片 assets/edinburgh.jpg，保留照片署名。保留全部价格、五次会面、常见问题和护理价目。行动按钮连接页内锚点。预约表单只在前端演示，提交后显示「预约演示已完成」，不发送数据。',
  nav:[['services','定制系列'],['process','五次会面'],['care','护理与问答']],cta:'预约会面'
 },
 {
  id:'skye-retreat',category:'旅行与住宿',title:'港湾来信',tag:'PORTREE · ISLE OF SKYE',
  hero:'在港湾，<br>慢慢住几天。',description:'面向自驾旅行者与周末访客的斯凯岛小型旅宿。',
  ...skye,theme:'coast',
  prompt:'将当前网站定制为「港湾来信」，一家位于斯凯岛波特里的小型旅宿。用海蓝色 #265c72 引导查看房型和尝试预约。首屏使用附带的波特里港湾照片 assets/skye.jpg，并保留摄影署名。保留两种房型及每晚价格、港口散步和附近行程建议。日期询价表单只在前端演示，提交后显示「询价演示已完成」。所有 CTA 定位到对应页内区块。',
  nav:[['services','房型'],['process','附近怎么玩'],['care','入住问题']],cta:'查询日期'
 },
 {
  id:'dolomites-guide',category:'户外与旅行',title:'山脊慢行',tag:'SECEDA · DOLOMITES',
  hero:'沿着山脊，<br>走进多洛米蒂。',description:'为初访者和进阶徒步者设计的高山向导工作室页面。',
  ...dolomites,theme:'alpine',
  prompt:'把当前模板改为「山脊慢行」多洛米蒂徒步向导工作室。使用深松绿色 #315849 和暖纸色背景。首屏保持附带的 Seceda 山脊图 assets/dolomites.jpg，并保留照片署名。重点突出轻松线和进阶线、持续时间、路线难度和装备。保留路线选择交互、常见问题、按页内锚点前往预约，以及只在前端演示的报名表单。选择路线时更新展示区，报名展示「报名演示已完成」。',
  nav:[['services','徒步路线'],['process','如何准备'],['care','常见问题']],cta:'选择徒步路线'
 }
];

const gold=
 '<section id="services"><p class="eyebrow">COMMISSION</p><h2>定制系列</h2><div class="items">'+
 '<article><h3>誓言对戒</h3><p>锻造纹理与低调手工刻字。</p><strong>£680 起</strong></article>'+
 '<article><h3>旧饰重制</h3><p>用旧金和已有宝石设计新的佩戴方式。</p><strong>£940 起</strong></article>'+
 '<article><h3>独件镶嵌</h3><p>从选石到最终抛光的一对一定制。</p><strong>£1,450 起</strong></article></div></section>'+
 '<section id="process" class="band"><p class="eyebrow">FIVE SITTINGS</p><h2>五次会面</h2><ol class="sittings">'+
 '<li>认识与需求访谈</li><li>材料和石材挑选</li><li>设计草图与尺寸确认</li><li>试戴与微调</li><li>交付及护理说明</li></ol></section>'+
 '<section id="care"><h2>护理与常见问题</h2><div class="items"><article><h3>护理价目</h3><p>清洁抛光 £45 · 检查镶口 £55 · 改圈 £85 起</p></article><article><details><summary>可以使用我原有的金和宝石吗？</summary><p>可以，在第一次会面评估材料。</p></details><details><summary>通常需要多久？</summary><p>建议为五次会面及制作预留 8–12 周。</p></details></article></div></section>';
const coast=
 '<section id="services"><p class="eyebrow">ROOMS</p><h2>两种港边房型</h2><div class="items"><article><h3>港景双人房</h3><p>临窗看渔船进港，提供早餐。</p><strong>£148 / 晚</strong></article><article><h3>山坡小套房</h3><p>独立起居区，适合三晚以上慢住。</p><strong>£198 / 晚</strong></article></div></section>'+
 '<section id="process" class="band"><h2>把一天留给岛上</h2><ol class="sittings"><li>早晨沿港口散步</li><li>午后去老桥听水声</li><li>看过海岸日落再回房间</li></ol></section>'+
 '<section id="care"><h2>入住问题</h2><details><summary>可以自驾抵达吗？</summary><p>旅宿位于港口步行区，附近设有公共停车场。</p></details><details><summary>早餐几点供应？</summary><p>每天 8:00–10:00。</p></details></section>';
const alpine=
 '<section id="services"><p class="eyebrow">TRAILS</p><h2>挑一条适合你的路线</h2><div class="trail-tabs"><button type="button" data-trail="easy" aria-pressed="true">轻松线</button><button type="button" data-trail="ridge" aria-pressed="false">进阶线</button></div>'+
 '<article id="trail-easy"><h3>草甸环线</h3><p>3 小时 · 5 公里 · 轻松。沿缓坡走到草甸观景点。</p></article><article id="trail-ridge" hidden><h3>山脊长线</h3><p>6 小时 · 11 公里 · 进阶。沿山脊往返，需具备碎石路经验。</p></article></section>'+
 '<section id="process" class="band"><h2>出发前准备</h2><ol class="sittings"><li>防滑徒步鞋与防风外套</li><li>至少 1.5 升饮水</li><li>提前核对天气与缆车时间</li></ol></section>'+
 '<section id="care"><h2>常见问题</h2><details><summary>第一次徒步应该选哪条？</summary><p>建议从草甸环线开始。</p></details><details><summary>下雨如何安排？</summary><p>路线及出发时间会随天气调整。</p></details></section>';
const bodies={gold,coast,alpine};
const forms={
 gold:['演示预约','预约演示已完成','服务','<option>誓言对戒</option><option>旧饰重制</option><option>独件镶嵌</option>'],
 coast:['演示询价','询价演示已完成','房型','<option>港景双人房</option><option>山坡小套房</option>'],
 alpine:['演示报名','报名演示已完成','路线','<option>草甸环线</option><option>山脊长线</option>']
};

function page(t){
 const [title,success,choice,options]=forms[t.theme];
 const license=t.license.toLowerCase().replace('cc ','').replace(' ','/');
 return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(t.title)+'</title><link rel="stylesheet" href="styles/site.css"><script src="src/app.js" defer></script></head><body class="'+t.theme+'"><header><a href="#top" class="wordmark">'+esc(t.title)+'</a><nav>'+t.nav.map(([id,label])=>'<a href="#'+id+'">'+label+'</a>').join('')+'</nav></header>'+
 '<main id="top"><section class="hero"><div><p class="eyebrow">'+t.tag+'</p><h1>'+t.hero+'</h1><p>'+esc(t.description)+'</p><a class="cta" href="#'+(t.theme==='alpine'?'services':'booking')+'">'+t.cta+'</a></div><figure><img src="assets/'+t.file+'" alt="'+esc(t.alt)+'"><figcaption>'+esc(t.alt)+'</figcaption></figure></section>'+
 bodies[t.theme]+'<section id="booking"><h2>'+title+'</h2><p>这是前端演示，表单数据不发送。</p><form data-confirm="'+success+'"><label>姓名<input name="name" placeholder="你的姓名" required></label><label>电子邮箱<input type="email" name="email" placeholder="hello@example.com" required></label><label>'+choice+'<select name="service">'+options+'</select></label>'+
 (t.theme==='coast'?'<label>入住日期<input type="date" name="date" required></label>':'')+'<button type="submit">提交'+title.slice(2)+'</button><output aria-live="polite"></output></form></section></main><footer><span>'+esc(t.title)+'</span><small>照片：<a href="'+esc(t.source)+'" target="_blank" rel="noreferrer">'+esc(t.author)+'</a> · <a href="https://creativecommons.org/licenses/'+esc(license)+'/" target="_blank" rel="noreferrer">'+esc(t.license)+'</a> · 缩放与压缩</small></footer></body></html>';
}

const siteCSS='*{box-sizing:border-box}html{scroll-behavior:smooth}body{--accent:#a7583b;--bg:#efeeeb;--ink:#252b2a;--paper:#fcfbf7;margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,sans-serif}.coast{--accent:#265c72;--bg:#edf4f5;--paper:#fff}.alpine{--accent:#315849;--bg:#f4f0e4;--paper:#fdf9ee}header,footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px max(5vw,18px);border-bottom:1px solid #0002}footer{border-top:1px solid #0002;border-bottom:0;flex-wrap:wrap}nav{display:flex;gap:clamp(8px,2vw,24px);flex-wrap:wrap}a{color:inherit}nav a,.cta,.wordmark{text-decoration:none}.wordmark{font:700 24px Georgia,serif}main{max-width:1300px;margin:auto}section{padding:clamp(28px,5vw,72px) max(5vw,18px);scroll-margin-top:16px}.hero{display:grid;grid-template-columns:1fr 1.2fr;gap:clamp(17px,4vw,64px);align-items:center;min-height:480px}.hero figure{margin:0;min-width:0}.hero img{width:100%;display:block;height:clamp(230px,33vw,450px);object-fit:cover}.hero figcaption{font-size:12px;padding-top:5px;color:#455348}.hero h1{font:500 clamp(44px,7vw,100px)/1.01 Georgia,serif;letter-spacing:-.075em;margin:14px 0}.hero p{max-width:34ch}.eyebrow{letter-spacing:.15em;font-size:12px;font-weight:700;color:var(--accent)}.cta,button{display:inline-block;background:var(--accent);color:#fff;border:0;padding:10px 18px;margin-top:7px;border-radius:3px;cursor:pointer;font:inherit}.alpine .hero{grid-template-columns:1.2fr 1fr}.alpine .hero figure{grid-area:1/1}.coast .hero img{border-radius:140px 140px 12px 12px}.band{background:var(--accent);color:white}.band .eyebrow{color:inherit}h2{font:500 clamp(30px,5vw,55px)/1.1 Georgia,serif;margin:0 0 18px}.items{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:14px}article,form{background:var(--paper);border:1px solid #0001;padding:18px}h3{margin:0}article strong{color:var(--accent);font-size:19px}.sittings{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr));padding-left:24px}.sittings li{padding:10px}details{padding:7px 0}summary{cursor:pointer}form{max-width:660px;display:grid;gap:12px;justify-items:start}label{display:grid;gap:3px;width:100%}input,select{padding:9px;border:1px solid #0004;border-radius:3px;max-width:100%;font:inherit}output{color:var(--accent);font-weight:700}.trail-tabs{display:flex;gap:10px;margin:0 0 14px}.trail-tabs button[aria-pressed=false]{background:#303f3a}[hidden]{display:none!important}@media(max-width:650px){header{align-items:flex-start}nav{justify-content:flex-end;font-size:13px}.hero,.alpine .hero{grid-template-columns:1fr;min-height:auto}.alpine .hero figure{grid-area:auto}.hero h1{margin-top:6px}}';
const siteJS='const form=document.querySelector("form");form.addEventListener("submit",event=>{event.preventDefault();form.querySelector("output").textContent=form.dataset.confirm;form.reset()});const tabs=[...document.querySelectorAll("[data-trail]")];for(const tab of tabs)tab.addEventListener("click",()=>{for(const option of tabs){const active=option===tab;option.setAttribute("aria-pressed",active);document.querySelector("#trail-"+option.dataset.trail).hidden=!active}});';

export async function templateVersion(template){
 const response=await fetch(template.image);
 if(!response.ok)throw Error('模板图片暂时无法加载。');
 const image=await response.blob();
 if(image.type!=='image/jpeg')throw Error('模板图片不可用。');
 const data=await new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(reader.error);
  reader.readAsDataURL(image);
 });
 const license=template.license.toLowerCase().replace('cc ','').replace(' ','/');
 const credit={file:'assets/'+template.file,author:template.author,source:template.source,
  license:template.license,licenseURL:'https://creativecommons.org/licenses/'+license+'/'};
 const files={'index.html':page(template),'styles/site.css':siteCSS,'src/app.js':siteJS,
  ['assets/'+template.file]:data,'assets/credits.json':JSON.stringify([credit],null,2)};
 return {title:template.title,html:compileWorkspace(files),files,prompt:template.prompt,at:Date.now(),engine:'官方模板'};
}
