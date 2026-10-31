'use client';
import {usePathname} from 'next/navigation';
import type {Profile} from '@/packages/contracts';
import ArticleWorkbench from './article-workbench';
import WritingWorkspace from './writing-workspace';
import MediaLibrary from './media-library';
import UnifiedResults from './unified-results';
/** Article creation owns only documents and the assistant. Topics and results have one home each. */
export default function Editorial(props:{profiles:Profile[];notify:(s:string)=>void}){
 const path=usePathname();return path.startsWith('/articles')?<ArticleWorkbench notify={props.notify}/>:path.startsWith('/write')?<WritingWorkspace {...props}/>:path==='/materials'?<MediaLibrary notify={props.notify}/>:<UnifiedResults notify={props.notify}/>;
}
