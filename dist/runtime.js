import {callModel} from './model.js?v=22';
import {readStreamedFiles} from './source-stream.js';
import {openWorkspace,applyFileWrites,describeFiles,compileWorkspace,modelWorkspace} from './workspace.js';
import {verifyInBrowser} from './preview.js?v=23';

export function createRun(onUpdate,signal){
 const steps=[];
 return {
  steps,signal,
  async step(label,operation){
   signal?.throwIfAborted();
   const row={label,status:'running',started:Date.now(),detail:''};
   steps.push(row);
   const update=()=>onUpdate(steps);
   update();
   try{
    const result=await operation(detail=>{row.detail=detail;update()});
    signal?.throwIfAborted();
    row.status='passed';
    return result;
   }catch(error){
    row.status='failed';
    row.detail='';
    throw error;
   }finally{
    row.durationMs=Date.now()-row.started;
    update();
   }
  }
 };
}

const clean=(value,limit)=>typeof value==='string'?value.trim().slice(0,limit):'';
class PlanFormatError extends Error{
 constructor(message,content,brief){
  super(message);
  this.content=content;
  this.brief=brief;
 }
}
function featureText(feature){
 if(typeof feature==='string')return clean(feature,140);
 const name=clean(feature?.name,60);
 const description=clean(feature?.description,100);
 return [name,description].filter(Boolean).join('：').slice(0,140);
}
const safeTarget=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:'';
const testValue=value=>typeof value==='boolean'||Number.isFinite(value)?String(value):clean(value,160);
function parseCheck(raw){
 if(raw===null)return null;
 if(!raw||!Array.isArray(raw.actions)||raw.actions.length>6)return undefined;
 const actions=raw.actions.map(action=>({
  type:action?.type,target:safeTarget(action?.target),label:clean(action?.label,80),scope:clean(action?.scope,80),
  row:clean(action?.row,80),column:clean(action?.column,80),value:testValue(action?.value)
 }));
 if(actions.some(action=>!['click','fill','select'].includes(action.type)||
  !(action.target||action.label||action.row&&action.column)||
  (action.type!=='click'&&!action.value)))return undefined;
 const expected=raw.expect;
 const expect={type:expected?.type,value:testValue(expected?.value),target:safeTarget(expected?.target),
  scope:clean(expected?.scope,80)};
 const valid={
  text:/[\p{L}\p{N}]/u.test(expect.value),
  hash:expect.value.startsWith('#')&&expect.value.length>1&&actions.some(action=>action.type==='click'),
  pressed:['true','false'].includes(expect.value)&&actions.some(action=>action.type==='click'),
  exists:Boolean(expect.target)
 };
 if(valid[expect.type]!==true)return undefined;
 return {label:clean(raw.label,120),actions,expect};
}
function parseBrief(content){
 let raw;
 try{raw=JSON.parse(String(content).trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi,''))}
 catch{throw new PlanFormatError('模型未返回可读取的构建计划。',content)}
 const draft={title:clean(raw?.title,80),summary:clean(raw?.summary,400),
  features:Array.isArray(raw?.features)?raw.features.map(featureText).filter(Boolean).slice(0,5):[]};
 if(!draft.summary||!draft.features.length)throw new PlanFormatError('构建计划缺少功能定义。',content);
 const check=parseCheck(raw.check);
 if(check===undefined)throw new PlanFormatError('构建计划没有可执行的验收步骤或可观察结果。',content,draft);
 return {...draft,check};
}
function showBrief(detail,brief){
 detail(['构建任务书',brief.summary,...brief.features.map(item=>'• '+item)].join('\n'));
}
function recoveryKey(error){
 return String(error.message).split('\n')[0].replace(/\d+/g,'#');
}
function countIssue(issues,error){
 const key=recoveryKey(error),count=(issues.get(key)||0)+1;
 issues.set(key,count);
 return count;
}
async function planBuild({request,previous,model,run}){
 let issue,lastBrief;
 for(let attempt=0;attempt<2;attempt++){
  try{
   return await run.step(issue?'规划 · 完善任务书':'规划 · 分析需求',async detail=>{
    const prompt=issue?[
     '原始需求：'+request,'上一次规划：'+clean(issue.content,4400),'格式诊断：'+issue.message,
     '请保留功能要求，并返回完整 JSON，包含 check 的操作和可观察结果。仅无交互的页面可返回 check:null。'
    ].join('\n\n'):request;
    const result=await model('plan',prompt,previous,detail);
    const brief=parseBrief(result.content);
    showBrief(detail,brief);
    return brief;
   });
  }catch(error){
   if(!(error instanceof PlanFormatError))throw error;
   lastBrief=error.brief||lastBrief;
   issue=error;
  }
 }
 return run.step('规划 · 整理原始需求',detail=>{
  detail('根据输入的需求准备生成');
  return {...(lastBrief||{title:'',summary:clean(request,400),features:['按原始需求实现核心功能']}),check:null};
 });
}

function verificationEvidence(error,check){
 const action=check?.actions[error.binding?.index];
 return [error.message,action&&'未定位的操作：'+JSON.stringify(action),
  error.binding&&'浏览器实际发现的候选控件：'+JSON.stringify(error.binding.candidates)
 ].filter(Boolean).join('\n');
}

async function reviewFailure({error,brief,task,files,model,run,allowRetarget}){
 const evidence=verificationEvidence(error,brief.check);
 const context=task+'\n\n浏览器验收诊断：\n'+evidence+
  (allowRetarget?'':'\n本次定位已复验，或当前失败与定位无关。请选择源码修复。');
 try{
  return await run.step('验收 · 核对需求与实现',async detail=>{
   const result=await model('review',context,modelWorkspace(files),detail);
   const review=JSON.parse(String(result.content).trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi,''));
   const choice=allowRetarget&&review?.decision==='retarget'&&Number.isInteger(review.candidateId)?
    error.binding?.candidates.find(candidate=>candidate.id===review.candidateId&&candidate.unique&&!candidate.control?.unavailable):null;
   detail(choice?'已校对页面控件':'已确定调整方案');
   return {choice,reason:clean(review?.reason,500)};
  });
 }catch(error){
  run.signal?.throwIfAborted();
  if(error.code==='auth-required'||error.code==='identity')throw error;
  return {};
 }
}

export async function runBuildAgent({request,previous,run,onFiles=()=>{},onStreamFiles=()=>{}}){
 const model=(stage,prompt,context,detail,onText)=>callModel(stage,prompt,context,detail,run.signal,onText);
 async function streamFiles(stage,prompt,context,base,detail){
  let output='',frame=0;
  onStreamFiles(null);
  function refresh(){
   frame=0;
   if(!run.signal?.aborted)onStreamFiles(readStreamedFiles(output,base));
  }
  try{
   return await model(stage,prompt,context,detail,text=>{
    output=text;
    if(!frame)frame=requestAnimationFrame(refresh);
   });
  }finally{
   if(frame){cancelAnimationFrame(frame);refresh()}
  }
 }
 const source=previous?.files?modelWorkspace(previous.files):previous?.html?.replace(/data:image\/[^;"']+;base64,[a-z0-9+/=]+/gi,'[图片素材]');
 const brief=await planBuild({request,previous:source,model,run});
 const working=await run.step(previous?'工作区 · 读取当前版本':'工作区 · 初始化项目',detail=>{
  const files=openWorkspace(previous);
  detail(describeFiles(files).join('\n'));
  return files;
 });
 const task='用户需求：\n'+request+'\n\n构建任务书：\n'+JSON.stringify(brief,null,2);
 const draft=(context,diagnostic='')=>run.step(diagnostic?'开发 · 更新实现方案':'开发 · 生成工作区文件',async detail=>{
  const result=await streamFiles('code',task+diagnostic,modelWorkspace(context),context,detail);
  detail('已返回文件内容');
  return result;
 });
 let candidate=await draft(working);
 let files=working;
 let bindings={};
 let usable,repairsAfterPreview=0;
 const hardFailure=error=>['workspace','identity','auth-required'].includes(error.code);
 async function verify(html){
  await run.step('验收 · 检查网页与交互',async detail=>{
   const [mobile,desktop]=await Promise.allSettled([
    verifyInBrowser(html,390,null,{},run.signal),
    verifyInBrowser(html,1200,brief.check,bindings,run.signal)
   ]);
   run.signal?.throwIfAborted();
   const issues=[];
   if(mobile.status==='rejected')issues.push('手机视图检查未通过');
   if(desktop.status==='rejected')issues.push(brief.check?'核心流程检查未通过':'桌面视图检查未通过');
   if(issues.length)throw Object.assign((desktop.status==='rejected'?desktop:mobile).reason,{issues});
   const matches=desktop.value;
   detail(['390 px 视口 · 渲染通过','1200 px 视口 · '+(brief.check?'交互通过':'渲染通过'),...matches].join('\n'));
  });
 }
 async function accept(html){
  const retargeted=new Set();
  let lastReview;
  for(;;){
   try{await verify(html);return}
   catch(error){
    run.signal?.throwIfAborted();
    error.acceptance=true;
    if(usable&&repairsAfterPreview>=2)throw error;
    const index=error.binding?.index;
    const allowRetarget=Number.isInteger(index)&&!retargeted.has(index);
    const reviewed=await reviewFailure({error,brief,task,files,model,run,allowRetarget});
    if(reviewed.choice){
     lastReview=reviewed.reason;
     retargeted.add(index);
     bindings[index]=JSON.stringify(reviewed.choice.control);
     continue;
    }
    error.review=reviewed.reason||lastReview;
    throw error;
   }
  }
 }
 async function buildPreview(){
  files=await run.step('工作区 · 应用文件修改',async detail=>{
   const next=applyFileWrites(candidate.content,files);
   await onFiles(next);
   detail(describeFiles(next,files).join('\n'));
   return next;
  });
  const html=await run.step('构建 · 组装并检查网页',detail=>{
   const source=compileWorkspace(files);
   detail('独立 HTML · '+new Blob([source]).size.toLocaleString('zh-CN')+' 字节 · 标题、正文和依赖检查通过');
   return source;
  });
  const result={html,files,model:candidate.model};
  try{await accept(html)}
  catch(error){
   run.signal?.throwIfAborted();
   if(!error.acceptance)throw error;
   try{
    await verifyInBrowser(html,1200,null,{},run.signal,true);
    if(!usable||error.issues.length<=usable.reviewIssues.length){
     usable={...result,reviewIssues:error.issues};
    }
   }catch{run.signal?.throwIfAborted()}
   throw error;
  }
  return result;
 }
 const issues=new Map(),phaseAttempts=new Map();
 let refreshed=false;
 for(;;){
  run.signal?.throwIfAborted();
  try{return await buildPreview()}
  catch(error){
   run.signal?.throwIfAborted();
   if(hardFailure(error))throw error;
   if(usable&&repairsAfterPreview>=2)break;
   const repeated=countIssue(issues,error);
   const phase=error.acceptance?'验收':run.steps.at(-1)?.label;
   const phaseCount=(phaseAttempts.get(phase)||0)+1;
   phaseAttempts.set(phase,phaseCount);
   if(phaseCount>=8){if(usable)break;throw error}
   const evidence='\n\n构建诊断：'+(error.acceptance?verificationEvidence(error,brief.check):error.message)+
    (error.review?'\n模型根据需求与源码的诊断：'+error.review:'');
   if(usable)repairsAfterPreview++;
   try{
    if(!usable&&repeated>=4&&!refreshed){
     refreshed=true;
     files=working;
     bindings={};
     candidate=await draft(working,evidence+'\n请调整实现方案并保留原有功能。');
     continue;
    }
    if(repeated>=6){if(usable)break;throw error}
    candidate=await run.step('调整 · 完善实现',async detail=>{
     detail('正在更新候选版本');
     const workspace=files===working?String(candidate.content??''):modelWorkspace(files);
     const result=await streamFiles('repair',task+evidence,workspace,files,detail);
     detail('已更新候选版本，准备重新构建');
     return result;
    });
   }catch(repairError){
    run.signal?.throwIfAborted();
    if(!usable||hardFailure(repairError))throw repairError;
    break;
   }
  }
 }
 await run.step('验收 · 保留可预览版本',detail=>detail(usable.reviewIssues.join('\n')));
 return usable;
}
