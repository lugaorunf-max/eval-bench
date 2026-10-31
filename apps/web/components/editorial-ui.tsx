'use client';
import { useEffect, useRef } from 'react';
import { FileText, Pencil, X } from './tone-icon';
import type { FileRecord } from '@/packages/contracts';
const collectionReads=new Map<string,{at:number;value:Promise<unknown>}>();
const cacheable=(r:string)=>/^(editorial\/(articles|files|library\/(cases|media|candidates|sources|collections))|cases|bootstrap)$/.test(r.split('?')[0]);
if(typeof window!=='undefined')for(const event of ['casebench-library-changed','casebench-resources-changed'])window.addEventListener(event,()=>collectionReads.clear());
export async function editorialRequest<T>(route:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
 const read=method==='GET'&&cacheable(route);if(method!=='GET')collectionReads.clear();
 const prior=collectionReads.get(route);if(read&&prior&&Date.now()-prior.at<3000)return structuredClone(await prior.value) as T;
 const value=(async()=>{const r=await fetch('/api/'+route,{method,headers:body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'请求失败');return data;})();
 if(read)collectionReads.set(route,{at:Date.now(),value});try{return structuredClone(await value);}catch(e){if(collectionReads.get(route)?.value===value)collectionReads.delete(route);throw e;}
}
export function EditorialSheet({title,close,children,className=''}:{title:string;close:()=>void;children:React.ReactNode;className?:string}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const before=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>before?.focus();},[]);return <dialog ref={ref} className={'ed-dialog '+className} aria-label={title} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)close();}}}><header><h2>{title}</h2><button className="ed-icon" aria-label="关闭" onClick={close}><X size={18}/></button></header>{children}</dialog>;}
export function EditorialText({text}:{text:string}){return <div className="ed-prose">{text.split(/\n\s*\n/).map((p,i)=>/^#{1,4}\s/.test(p)?<h3 key={i}>{p.replace(/^#{1,4}\s/,'')}</h3>:<p key={i}>{p}</p>)}</div>;}
export function WriterMark({profileId}:{profileId?:string}){const key=profileId||'';const src=/chatgpt|gpt|codex|openai/i.test(key)?'openai-blossom-black.svg':/workbuddy/i.test(key)?'workbuddy-art.svg':/deepseek/i.test(key)?'deepseek.png':/minimax/i.test(key)?'minimax.png':/kimi/i.test(key)?'kimi.png':'';return src?<img className="ed-brand-icon" src={'/agents/'+src} alt="Agent"/>:<span className="ed-assistant-mark"><Pencil size={15}/></span>;}
export function EditorialMedia({file}:{file:FileRecord}){return /^image\/(png|jpeg|webp|gif)$/.test(file.mime)?<img loading="lazy" src={`/api/files/${file.id}`} alt={file.name}/>:file.mime.startsWith('video/')?<video src={`/api/files/${file.id}`} controls preload="metadata"/>:<FileText size={24}/>;}
export const editorialDate=(s:string)=>new Date(s).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
