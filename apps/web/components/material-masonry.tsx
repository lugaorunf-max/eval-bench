'use client';
import {useLayoutEffect,useRef,type ReactNode,type HTMLAttributes} from 'react';
/** Size each grid span from the rendered card, including wrapped article chips. */
export function MaterialMasonry({children,className='',...attrs}:HTMLAttributes<HTMLDivElement>&{children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const root=ref.current;if(!root)return;let stopped=false;const size=(node:HTMLElement)=>{if(stopped)return;const height=node.getBoundingClientRect().height;node.style.gridRowEnd='span '+Math.max(1,Math.ceil(height+14));};const observer=new ResizeObserver(entries=>entries.forEach(entry=>size(entry.target as HTMLElement)));const nodes=[...root.children] as HTMLElement[];root.dataset.masonryReady='true';for(const node of nodes){size(node);observer.observe(node);}return()=>{stopped=true;observer.disconnect();};},[children]);
 return <div ref={ref} className={'material-masonry '+className} {...attrs}>{children}</div>;
}
