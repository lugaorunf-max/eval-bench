'use client';
import {useEffect,useState} from 'react';
import {SCENES,ARTIFACT_TYPES,CAPABILITIES,type Scene,type ArtifactType,type Capability} from '@/packages/contracts';
import {ModelChoice} from './media-workflow-controls';
import {editorialRequest as request} from './editorial-ui';
export type ClassificationSuggestion={scenes:Scene[];artifactTypes:ArtifactType[];capabilities:Capability[];evidence:string};
export function CaseClassificationSuggestion({id,apply}:{id:string;apply:(s:ClassificationSuggestion)=>void}){
 const [model,setModel]=useState({profileId:'',model:''}),[value,setValue]=useState<ClassificationSuggestion|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void request<typeof model>('editorial/collection-settings').then(v=>{if(v.profileId&&v.model)setModel(v);}).catch(()=>{});},[]);
 return <details className="classification-suggestion"><summary>AI 补全标签</summary><div className="ed-row"><ModelChoice value={model} change={setModel}/><button type="button" className="ed-button" disabled={busy||!model.profileId||!model.model} onClick={()=>{setBusy(true);setError('');void request<ClassificationSuggestion>('editorial/library/item/case/'+id+'/classification',model).then(setValue).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'正在分析…':'生成建议'}</button></div>{value&&<div><p>{value.scenes.map(k=>SCENES[k]).join('、')} · {value.artifactTypes.map(k=>ARTIFACT_TYPES[k]).join('、')}</p><p>{value.capabilities.map(k=>CAPABILITIES[k]).join('、')}</p><p>{value.evidence}</p><button type="button" className="ed-button" onClick={()=>apply(value)}>采用建议到编辑表单</button></div>}{error&&<p role="alert" className="ed-error">{error}</p>}</details>;
}
