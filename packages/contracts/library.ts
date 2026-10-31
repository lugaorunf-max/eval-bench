import type {FileRecord,CaseRecord} from './index';
export type LibraryKind='media'|'case'|'candidate'|'instance';
export interface LibrarySource {scenes?:import('./index').Scene[];artifactTypes?:import('./index').ArtifactType[];cardSummary?:string;scene?:import('./index').Scene;artifactType?:import('./index').ArtifactType;capabilities?:import('./index').Capability[];
 mediaAcquisition?:{checkedAt:string;complete:boolean;imageUrls:string[];imageFileIds:string[];videoFileId?:string};id:string;url:string;title:string;author:string;eventIds:string[];createdAt:string;summary?:string;previewUrl?:string;hasVideo?:boolean;intents?:('media'|'case'|'article')[]}
export interface LibraryMeta {summary?:string;coverFileId?:string|null;id:string;kind:LibraryKind;itemId:string;title?:string;tags:string[];collectionIds:string[];sourceIds:string[];articleIds:string[];eventIds:string[];favorite:boolean;reviewed:boolean;trashedAt:string|null;purgedAt?:string|null;createdAt:string;updatedAt:string}
export interface LibraryCollection {id:string;title:string;createdAt:string}
export interface CandidateCase {providedTitle?:boolean;prompt?:string;id:string;title:string;url:string;summary:string;author:string;sourceId:string;leadId?:string;eventId?:string;mediaIds:string[];savedCaseId?:string;draftId?:string;createdAt:string}
export interface LibraryUse {associated?:boolean;articleId:string;title:string;inserted:boolean;reference:boolean;history:boolean;positions:number[]}
export interface LibraryMedia {id:string;file:FileRecord;meta:LibraryMeta;source?:LibrarySource;sourceIds:string[];parentFileId:string|null;instanceId:string|null;uses:LibraryUse[];origin:string;createdAt:string}
export interface LibraryCase {source?:LibrarySource;cover?:FileRecord;origins?:('manual'|'automatic')[];priority?:boolean;entry:CaseRecord;meta:LibraryMeta;uses:LibraryUse[]}
