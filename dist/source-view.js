import {escapeHTML as esc} from './generator.js';
import {entryFile,isImageData,isImagePath} from './workspace.js';

export function sourceState(){
 return {selected:entryFile,search:'',collapsed:new Set(),follow:true,streamPath:null};
}
function pathsTree(files,search){
 const root=new Map();
 for(const name of Object.keys(files).sort()){
  if(search&&!name.toLowerCase().includes(search.toLowerCase()))continue;
  let children=root,path='';
  for(const part of name.split('/')){
   path=path?path+'/'+part:part;
   if(!children.has(part))children.set(part,{name:part,path,children:new Map()});
   children=children.get(part).children;
  }
 }
 return root;
}
function treeRows(tree,state){
 const nodes=[...tree.values()].sort((a,b)=>Number(Boolean(b.children.size))-Number(Boolean(a.children.size))||a.name.localeCompare(b.name));
 return nodes.map(node=>{
  const folder=node.children.size>0;
  const open=state.search||!state.collapsed.has(node.path);
  const glyph=folder?(open?'▾':'▸'):'·';
  const target=folder?' data-folder="'+esc(node.path)+'" aria-expanded="'+Boolean(open)+'"':
   ' data-file="'+esc(node.path)+'" aria-pressed="'+(state.selected===node.path)+'"';
  return '<li><button class="tree-entry"'+target+' title="'+esc(node.path)+'"><span aria-hidden="true">'+glyph+
   '</span><span>'+esc(node.name)+'</span></button>'+(folder&&open?'<ul>'+treeRows(node.children,state)+'</ul>':'')+'</li>';
 }).join('');
}
function fileCode(files,state){
 if(!Object.hasOwn(files,state.selected))state.selected=Object.hasOwn(files,entryFile)?entryFile:Object.keys(files)[0];
 if(!state.selected)return '<p class="source-empty">这个项目暂时没有文件。</p>';
 if(isImagePath(state.selected)&&isImageData(files[state.selected])){
  return '<div class="source-path" data-path="'+esc(state.selected)+'">'+esc(state.selected)+
   '</div><div class="source-image"><img src="'+esc(files[state.selected])+'" alt="'+esc(state.selected)+'"></div>';
 }
 const lines=files[state.selected].split(/\r?\n/);
 const content=lines.map((line,index)=>'<div class="source-line"><span class="line-number" aria-hidden="true">'+
  (index+1)+'</span><code>'+esc(line||' ')+'</code></div>').join('');
 const streaming=state.streamPath===state.selected?'<span class="source-stream-label">生成中</span>':'';
 return '<div class="source-path" data-path="'+esc(state.selected)+'">'+esc(state.selected)+streaming+
  '</div><div class="source-content" tabindex="0" aria-label="文件内容">'+content+'</div>';
}
function fileTree(files,state){
 const rows=treeRows(pathsTree(files,state.search.trim()),state);
 return rows?'<ul>'+rows+'</ul>':'<p class="source-empty">没有匹配的文件。</p>';
}
export function renderSourceView(project,files,state){
 const content=fileCode(files,state);
 return '<div class="source-pane" id="source-pane"><aside class="source-browser" aria-label="项目文件">'+
  '<div class="source-project"><span aria-hidden="true">▰</span><strong>'+esc(project.title)+'</strong></div>'+
  '<input class="field source-filter" id="source-filter" type="search" placeholder="搜索文件" aria-label="搜索项目文件" value="'+esc(state.search)+'">'+
  '<nav class="source-tree" aria-label="项目文件树">'+fileTree(files,state)+'</nav></aside>'+
  '<section class="source-editor">'+content+'</section></div>';
}

export function refreshSourceView(pane,files,state,{code=true,tree=true,followTail=false}={}){
 if(code){
  const editor=pane.querySelector('.source-editor');
  const previous=editor.querySelector('.source-content');
  const x=previous?.scrollLeft||0,y=previous?.scrollTop||0;
  const same=editor.querySelector('.source-path')?.dataset.path===state.selected;
  const focused=document.activeElement===previous;
  const nearEnd=!previous||previous.scrollHeight-previous.scrollTop-previous.clientHeight<50;
  editor.innerHTML=fileCode(files,state);
  const current=editor.querySelector('.source-content');
  if(focused)current?.focus({preventScroll:true});
  if(current)current.scrollTo(same?x:0,followTail&&(!same||nearEnd)?current.scrollHeight:same?y:0);
 }
 if(tree)pane.querySelector('.source-tree').innerHTML=fileTree(files,state);
}
