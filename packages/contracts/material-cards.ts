import type {FileRecord} from './index';
import type {InstanceMetrics} from './editorial';
import type {ResourceKind} from './content-workspace';
export interface MaterialTile {file:FileRecord;title:string;posterId?:string;parentFileId:string|null;instanceId:string|null;caseId?:string;instanceIds?:string[];agent?:string;model?:string;articleIds:string[];trashed:boolean;insertedIn:string[]}
export interface MaterialSection {id:string;title:string;instanceId?:string;agent?:string;model?:string;files:MaterialTile[]}
export interface MaterialCard {id:string;kind:'case'|'material';variant:'reference'|'execution'|'material';cover?:FileRecord;posterId?:string;favorite?:boolean;itemKind:ResourceKind;title:string;summary:string;prompt?:string;sourceUrl?:string;articleIds:string[];items:{kind:ResourceKind;id:string}[];sections:MaterialSection[];createdAt:string;caseId?:string;candidateId?:string;instanceId?:string;agent?:string;model?:string;status?:string;metrics?:InstanceMetrics}
export interface MaterialCatalog {cards:MaterialCard[];tiles:MaterialTile[]}
