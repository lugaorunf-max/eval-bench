'use client';
import {SCENES,ARTIFACT_TYPES,type Scene,type ArtifactType} from '@/packages/contracts';
export function CaseTaxonomyFields({scene,scenes,artifactType,artifactTypes,change}:{scene:Scene;scenes?:Scene[];artifactType:ArtifactType;artifactTypes?:ArtifactType[];change:(v:{scenes:Scene[];artifactTypes:ArtifactType[]})=>void}){
 const ss=[...new Set([scene,...(scenes||[])])],aa=[...new Set([artifactType,...(artifactTypes||[])])];
 return <div className="case-taxonomy-fields"><fieldset><legend>适用任务类型</legend><div>{Object.entries(SCENES).map(([key,label])=><label key={key}><input type="checkbox" checked={ss.includes(key as Scene)} disabled={key===scene} onChange={e=>change({scenes:e.target.checked?[...ss,key as Scene]:ss.filter(s=>s!==key),artifactTypes:aa})}/>{label}</label>)}</div></fieldset><fieldset><legend>适用产物格式</legend><div>{Object.entries(ARTIFACT_TYPES).map(([key,label])=><label key={key}><input type="checkbox" checked={aa.includes(key as ArtifactType)} disabled={key===artifactType} onChange={e=>change({scenes:ss,artifactTypes:e.target.checked?[...aa,key as ArtifactType]:aa.filter(s=>s!==key)})}/>{label}</label>)}</div></fieldset></div>;
}
