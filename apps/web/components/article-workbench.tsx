'use client';
import {useEffect,useState,useRef} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {WRITING_MEDIA_ACCEPT,writingMediaError} from '@/packages/contracts/writing-media';
import type {FileRecord} from '@/packages/contracts';
import type {WritingArticle} from '@/packages/contracts/editorial';
import type {ResourceCard} from '@/packages/contracts/content-workspace';
import {ArticleScopeList,useArticleScope,selectArticleScope} from './article-scope';
import {SecondaryContent,useWorkspaceMemory} from './workspace-navigation';
import {editorialRequest as request,EditorialSheet as Sheet} from './editorial-ui';
import {ArticleMaterials} from './material-card';
import {DiscoveryButton,DiscoveryProgress} from './discovery-controls';

import {CaseEditor} from './case-editor';
import {Search,Plus,Upload,Settings2} from './tone-icon';
export default function ArticleWorkbench({notify}:{notify:(s:string)=>void}){
 const path=usePathname(),params=useSearchParams(),router=useRouter(),{articleId,articles,ready}=useArticleScope(),id=path.split('/')[2]||'',target=id||articleId;
 const [query,setQuery]=useWorkspaceMemory('article.resources.query.'+target,''),[dialog,setDialog]=useState<'link'|'public'|'case'|'connection'|null>(null),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),upload=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(id){selectArticleScope(id);return;}const selected=params.get('articleId')||articleId||articles[0]?.id;if(ready&&selected)router.replace('/articles/'+selected);},[id,ready,articles.length,params.get('articleId')]);
 const article=articles.find(a=>a.id===target);
 async function act(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);try{await fn();window.dispatchEvent(new Event('casebench-library-changed'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="editorial article-workbench"><SecondaryContent><ArticleScopeList label="文章" navigate="materials" showAll={false}/><div className="context-filters"><button className="context-option" onClick={()=>setDialog('public')}><Plus size={14}/><span>从公共库添加</span></button><button className="context-option" onClick={()=>setDialog('case')} disabled={!target}><Plus size={14}/><span>新建本篇案例</span></button></div></SecondaryContent><header className="collection-toolbar"><label className="collection-search"><Search size={15}/><input aria-label="搜索本篇资料" placeholder="搜索本篇资料…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="collection-actions"><DiscoveryButton kind="article" articleId={target} query={query||article?.title||''} notify={notify}/><button className="ed-button" disabled={!target} onClick={()=>setDialog('link')}>添加链接</button><button className="ed-button ed-primary" disabled={!target||busy} onClick={()=>upload.current?.click()}><Upload size={13}/>上传</button></div></header>{error&&<p className="ed-error">{error}</p>}{article&&<div className="article-resource-title"><strong>{article.title}</strong></div>}{target?<><DiscoveryProgress articleId={target} notify={notify}/><ArticleMaterials key={target} articleId={target} query={query} notify={notify}/></>:<div className="ed-empty">{ready?'新建文章或从选题开始':'正在读取文章…'}</div>}<input hidden ref={upload} type="file" accept={WRITING_MEDIA_ACCEPT} multiple onChange={e=>{const files=[...e.target.files||[]],owner=target;e.target.value='';void act(async()=>{for(const file of files){const issue=writingMediaError(file);if(issue)throw Error(issue);const form=new FormData();form.set('file',file);const stored=await request<FileRecord>('editorial/files',form);await request('editorial/media',{fileId:stored.id,origin:'uploaded',articleId:owner});}});}}/>
 {dialog==='link'&&<Sheet title="添加资料链接" close={()=>setDialog(null)}><form onSubmit={e=>{e.preventDefault();void act(async()=>{await request('editorial/resource-source',{url,title:url,articleId:target});setUrl('');setDialog(null);});}}><div className="ed-dialog-body ed-form"><label>原文链接<input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></label></div><footer><button className="ed-button ed-primary" disabled={busy||!url}>保存到本篇</button></footer></form></Sheet>}
 {dialog==='public'&&<Sheet title="从公共库添加" className="resource-picker" close={()=>setDialog(null)}><div className="ed-dialog-body"><ArticleMaterials picker notify={notify} onPick={async card=>{await act(async()=>{await request('editorial/article-associations',{items:card.items,addArticleIds:[target]},'PATCH');setDialog(null);});}}/></div></Sheet>}
 {dialog==='case'&&<CaseEditor entry={null} close={()=>{setDialog(null);window.dispatchEvent(new Event('casebench-library-changed'));}} saved={()=>{setDialog(null);window.dispatchEvent(new Event('casebench-library-changed'));}}/>}

 </div>;
}
