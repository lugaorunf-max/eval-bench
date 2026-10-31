'use client';
import {useEffect,useState,useSyncExternalStore,useRef} from 'react';
import {useSearchParams,useRouter,usePathname} from 'next/navigation';
import {useWorkspaceMemory} from './workspace-navigation';
import {ResizeHandle} from './resize-handle';
import {Plus} from './tone-icon';
import {editorialRequest as request} from './editorial-ui';
import {ContextIcon} from './context-icon';
const key='casebench.article-scope',event='casebench-article-scope';
const subscribe=(fn:()=>void)=>{window.addEventListener(event,fn);return()=>window.removeEventListener(event,fn);};
const snapshot=()=>sessionStorage.getItem(key)||'';
export function selectArticleScope(id:string){sessionStorage.setItem(key,id);window.dispatchEvent(new Event(event));}
export function useArticleScope(){
 const articleId=useSyncExternalStore(subscribe,snapshot,()=>''),params=useSearchParams();
 const [articles,setArticles]=useState<{id:string;title:string;updatedAt?:string;pinned?:boolean}[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;const refresh=()=>void request<typeof articles>('editorial/articles').then(a=>{if(live){setArticles(a);setError('');}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setReady(true);});refresh();window.addEventListener('casebench-library-changed',refresh);return()=>{live=false;window.removeEventListener('casebench-library-changed',refresh);};},[]);
 useEffect(()=>{const id=params.get('articleId');if(id)selectArticleScope(id);},[params.get('articleId')]);
 return {articleId,setArticleId:selectArticleScope,articles,ready,error,article:articles.find(a=>a.id===articleId)};
}
export function ArticleScopeList({label='所属文章',navigate,showAll=true,beforeNavigate}:{label?:string;navigate?:'materials'|'writing';showAll?:boolean;beforeNavigate?:()=>Promise<void>}){
 const {articleId,setArticleId,articles,ready,error}=useArticleScope(),[query,setQuery]=useWorkspaceMemory('article-list.query',''),[height,setHeight]=useWorkspaceMemory('article-list.height',224),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),router=useRouter(),path=usePathname(),list=useRef<HTMLDivElement>(null);
 useEffect(()=>{list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest'});},[articleId,articles.length]);
 async function choose(id:string){try{await beforeNavigate?.();setArticleId(id);if(navigate)router.push((navigate==='materials'?'/articles/':'/write/')+id);}catch(e){setFailure((e as Error).message);}}
 async function create(){if(busy)return;setBusy(true);try{await beforeNavigate?.();const a=await request<{id:string}>('editorial/start-article',{title:'新文章',requestKey:crypto.randomUUID()});setArticleId(a.id);window.dispatchEvent(new Event('casebench-library-changed'));router.push((navigate==='writing'?'/write/':'/articles/')+a.id);}catch(e){setFailure((e as Error).message);}finally{setBusy(false);}}
 return <section className={'article-scope'+(navigate?' article-navigator':'')} aria-label={label}><div className="article-scope-heading"><h3><ContextIcon name="source"/>{label}</h3>{navigate&&<button className="context-icon" aria-label="新建文章" disabled={busy} onClick={()=>void create()}><Plus size={15}/></button>}</div><input className="article-scope-search" aria-label="筛选文章" placeholder="搜索文章…" value={query} onChange={e=>setQuery(e.target.value)}/><div ref={list} className="article-scope-list" style={{height:Math.max(120,Math.min(560,height))}}>{showAll&&<button aria-pressed={!articleId} className={!articleId?'on':''} onClick={()=>choose('')}><ContextIcon name="all" selected={!articleId}/><span>全部文章</span></button>}{articles.filter(a=>a.title.toLowerCase().includes(query.toLowerCase())).map(a=><button key={a.id} aria-pressed={articleId===a.id} className={articleId===a.id?'on':''} onClick={()=>choose(a.id)} title={a.title}><ContextIcon name="source" selected={articleId===a.id}/><span>{a.title}</span></button>)}</div><ResizeHandle axis="y" label="调整文章列表高度" value={height} change={setHeight} min={120} max={560} reset={224}/>{!ready&&<small role="status">正在读取文章…</small>}{(error||failure)&&<small role="alert">{error||failure}</small>}</section>;
}
