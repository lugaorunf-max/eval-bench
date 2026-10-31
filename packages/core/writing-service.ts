import { z } from 'zod';
import type { DocumentNode, WritingArticle, WritingSelection } from '../contracts/editorial';
import type { EditorialService } from './editorial';
import { AppError, newId, now } from './service';
import { documentEqual, documentText, normalizeArticle, revisionChanges, revisionDocument, validateDocument } from './writing-document';
import { reviseSelectedPassage } from './writing-selection';
import {mergeWritingDocuments} from './writing-sync';
import type {WritingImageMap} from './writing-web-media';

export function documentVersion(a:WritingArticle,label:string){return {id:newId('version'),label,createdAt:now(),document:a.document!};}
export function finishDocumentGeneration(current:WritingArticle,base:WritingArticle,messageId:string,answer:string,purpose:string,scope?:{start:number;end:number},selection?:WritingSelection,versionLabel='AI 初稿',applyIfUnchanged=false,images:WritingImageMap={}):WritingArticle{
  const a=normalizeArticle(current);if(purpose==='discuss')return a;
  const document=validateDocument(selection?reviseSelectedPassage(base.document!,selection,answer,images):revisionDocument(base,answer,scope,images),a);
  if((applyIfUnchanged||!documentText(base.document!))&&a.documentRevision===base.documentRevision){return {...a,document,documentRevision:(a.documentRevision||0)+1,versions:[...(a.versions||[]),...(documentText(base.document!)?[documentVersion(a,'AI 修改前')]:[]),documentVersion({...a,document},versionLabel)].slice(-30),proposal:null};}
  return {...a,proposal:{id:newId('proposal'),messageId,baseRevision:base.documentRevision||0,createdAt:now(),changes:revisionChanges(base.document!,document)}};
}
export class WritingDocumentService {
  constructor(private e:EditorialService){}
  async save(id:string,raw:unknown){
    const v=z.object({documentRevision:z.number().int().nonnegative(),document:z.unknown(),baseDocument:z.unknown().optional(),keepConflictVersion:z.boolean().default(false),checkpoint:z.boolean().default(false)}).strict().parse(raw);
    return this.e.mutate<WritingArticle>(id,'article',raw=>{const a=normalizeArticle(raw);
      let document:DocumentNode;try{document=validateDocument(v.document,a);}catch(e){throw new AppError(400,(e as Error).message);}
      if(v.keepConflictVersion)return {...a,revision:a.revision+1,updatedAt:now(),versions:[...(a.versions||[]),documentVersion({...a,document},'未合并的本地修改')].slice(-30)};
      if(a.documentRevision!==v.documentRevision){
        if(documentEqual(document,a.document))return a;
        let merged:DocumentNode|null=null;
        if(v.baseDocument){try{const base=validateDocument(v.baseDocument,a);merged=mergeWritingDocuments(base,document,a.document!);}catch{}}
        if(!merged)throw new AppError(409,'正文已在其他窗口更新，重叠修改已保留，请在当前页面选择保留的版本');
        document=validateDocument(merged,a);
        if(documentEqual(document,a.document))return a;
      }
      if(JSON.stringify(a.document)===JSON.stringify(document))return a;
      const checkpoint=v.checkpoint||!a.versions?.length||Date.now()-Date.parse(a.versions.at(-1)!.createdAt)>60000;
      return {...a,document,documentRevision:(a.documentRevision||0)+1,revision:a.revision+1,updatedAt:now(),versions:checkpoint?[...(a.versions||[]),documentVersion(a,'手动编辑前')].slice(-30):a.versions};});
  }
  async proposal(id:string,raw:unknown){const v=z.object({proposalId:z.string(),action:z.enum(['apply','discard']),documentRevision:z.number().int(),changeIds:z.array(z.string()).max(200)}).strict().parse(raw);
    return this.e.mutate<WritingArticle>(id,'article',raw=>{const a=normalizeArticle(raw),p=a.proposal;if(!p||p.id!==v.proposalId)throw new AppError(409,'这份修订已处理，请刷新');
      if(v.action==='discard')return {...a,proposal:null,revision:a.revision+1,updatedAt:now()};
      if(a.documentRevision!==v.documentRevision||p.baseRevision!==a.documentRevision)throw new AppError(409,'生成期间正文有新修改，暂不能覆盖。请保留当前正文，重新生成修订。');
      const selected=p.changes.filter(c=>v.changeIds.includes(c.id));if(!selected.length)throw new AppError(400,'请至少选择一处修订');
      const content=[...(a.document!.content||[])];for(const c of [...selected].sort((a,b)=>b.index-a.index))content.splice(c.index,c.before.length,...c.after);
      const document=validateDocument({type:'doc',content:content.length?content:[{type:'paragraph'}]},a);
      return {...a,document,documentRevision:(a.documentRevision||0)+1,revision:a.revision+1,updatedAt:now(),versions:[...(a.versions||[]),documentVersion(a,'采用 AI 修订前')].slice(-30),proposal:null};});
  }
  async restore(id:string,raw:unknown){const v=z.object({versionId:z.string(),documentRevision:z.number().int()}).strict().parse(raw);return this.e.mutate<WritingArticle>(id,'article',raw=>{const a=normalizeArticle(raw);if(a.documentRevision!==v.documentRevision)throw new AppError(409,'正文已更新，请重试');const version=a.versions?.find(s=>s.id===v.versionId);if(!version)throw new AppError(404,'版本不存在');return {...a,document:validateDocument(version.document,a),documentRevision:(a.documentRevision||0)+1,revision:a.revision+1,updatedAt:now(),proposal:null,versions:[...(a.versions||[]),documentVersion(a,'恢复版本前')].slice(-30)};});}
}
