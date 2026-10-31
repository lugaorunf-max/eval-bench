'use client';
import {useEffect,useState} from 'react';
import type {CaseRecord,FileRecord} from '@/packages/contracts';
import {editorialRequest as request} from './editorial-ui';
import {ReferencePreview} from './preview';
export function CaseCoverPreview({entry}:{entry:CaseRecord}){const [cover,setCover]=useState<FileRecord|null>(null);useEffect(()=>{let live=true;void request<{selected?:FileRecord}>('editorial/library/item/case/'+entry.id+'/cover').then(v=>{if(live)setCover(v.selected||null);}).catch(()=>{});return()=>{live=false;};},[entry.id,entry.version]);return cover?<img data-case-cover={cover.id} className="reference-image" src={'/api/files/'+cover.id} alt={entry.title}/>:<ReferencePreview entry={entry}/>;}
