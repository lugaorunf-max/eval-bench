'use client';
import {useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {useArticleScope} from './article-scope';

// Public collections use their own explicit filter, never the last editing context.
export function useLibraryArticleFilter(){
 const params=useSearchParams(),{articles}=useArticleScope();
 const [articleId,setArticleId]=useState(()=>params.get('articleId')||'');
 return {articleId,setArticleId,articles};
}
export function LibraryArticleFilter({value,change,articles}:{value:string;change:(id:string)=>void;articles:{id:string;title:string}[]}){
 return <select className="library-article-filter" aria-label="关联文章" value={value} onChange={e=>change(e.target.value)}><option value="">关联文章：全部</option>{articles.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select>;
}
export function ArticleRelationTags({ids,articles}:{ids:string[];articles:{id:string;title:string}[]}){
 return <span className="article-relation-tags">{[...new Set(ids)].map(id=>{const a=articles.find(v=>v.id===id);if(!a)return null;const hash=[...id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0),hue=[238,165,30,315,200][hash%5];return <a key={id} href={'/articles/'+id} title={a.title} onClick={e=>e.stopPropagation()} style={{background:`hsl(${hue} 50% 96%)`,color:`hsl(${hue} 35% 38%)`}}>{a.title}</a>;})}</span>;
}
