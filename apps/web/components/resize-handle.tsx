'use client';
import {useRef,useEffect,type PointerEvent} from 'react';
export function ResizeHandle({axis,value,change,min,max,reset,label}:{axis:'x'|'y';value:number;change:(v:number)=>void;min:number;max:number;reset:number;label:string}){
 const cleanup=useRef<()=>void>(()=>{});useEffect(()=>()=>cleanup.current(),[]);
 const clamp=(n:number)=>Math.round(Math.max(min,Math.min(max,n)));
 function start(e:PointerEvent){if(e.button!==0)return;e.preventDefault();cleanup.current();const at=axis==='x'?e.clientX:e.clientY,initial=value,previous=document.body.style.cursor;document.body.style.cursor=axis==='x'?'col-resize':'row-resize';
  const move=(event:globalThis.PointerEvent)=>change(clamp(initial+(axis==='x'?event.clientX:event.clientY)-at));
  const end=()=>{document.body.style.cursor=previous;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);};cleanup.current=end;window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
 }
 return <div className={'resize-handle resize-'+axis} role="separator" aria-label={label} aria-orientation={axis==='x'?'vertical':'horizontal'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0} onPointerDown={start} onDoubleClick={()=>change(reset)} onKeyDown={e=>{const delta=e.key===(axis==='x'?'ArrowRight':'ArrowDown')?12:e.key===(axis==='x'?'ArrowLeft':'ArrowUp')?-12:0;if(delta){e.preventDefault();change(clamp(value+delta));}if(e.key==='Home'){e.preventDefault();change(reset);}}}/>;
}
