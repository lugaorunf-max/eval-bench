'use client';
import {useLayoutEffect} from 'react';
/** Restore the content scroller after asynchronous lists arrive, until the person interacts. */
export function useWorkspaceScroll(key:string){
 useLayoutEffect(()=>{
  const main=document.querySelector<HTMLElement>('.workspace-main');if(!main)return;
  const storageKey='casebench.scroll.'+key;let restoring=true,frame=0;
  const saved=Number(sessionStorage.getItem(storageKey)||0),write=()=>{if(!restoring)sessionStorage.setItem(storageKey,String(main.scrollTop));};
  const restore=()=>{if(!restoring)return;main.scrollTop=saved;if(main.scrollHeight-main.clientHeight>=saved){restoring=false;observer.disconnect();}};
  const observer=new MutationObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(restore);});
  observer.observe(main,{childList:true,subtree:true});frame=requestAnimationFrame(restore);
  const interact=()=>{restoring=false;observer.disconnect();write();},timer=setTimeout(()=>{restoring=false;observer.disconnect();},8000);
  main.addEventListener('scroll',write,{passive:true});main.addEventListener('wheel',interact,{passive:true});main.addEventListener('pointerdown',interact);main.addEventListener('keydown',interact);
  return()=>{if(!restoring)write();clearTimeout(timer);cancelAnimationFrame(frame);observer.disconnect();main.removeEventListener('scroll',write);main.removeEventListener('wheel',interact);main.removeEventListener('pointerdown',interact);main.removeEventListener('keydown',interact);};
 },[key]);
}
