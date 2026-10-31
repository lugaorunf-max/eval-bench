import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executeAdapter,readSessionOutput,type AdapterTask} from '../adapters';
import {interpretWritingReply} from './writing-reply';
import {validateKnowledgeCitations} from './writing-citations';
import type {KnowledgeArticleReference,KnowledgeCitation} from '../contracts/editorial';
import type {Usage} from '../contracts';

// One bounded continuation repairs a missing delivery. The first output stays on disk.
export async function deliverWriting(task:AdapterTask,articles:(KnowledgeArticleReference&{content:string})[],execute=executeAdapter){
 let current=task,total:Usage|undefined,lastError:Error|undefined;
 for(let attempt=0;attempt<2;attempt++){
  const output=await execute(current),session=await readSessionOutput(current.outputDirectory),raw=session.text||output.text;
  total=total?{...output.usage,inputTokens:sum(total.inputTokens,output.usage.inputTokens),outputTokens:sum(total.outputTokens,output.usage.outputTokens),cachedTokens:sum(total.cachedTokens,output.usage.cachedTokens),cost:null,currency:null}:output.usage;
  try{const reply=interpretWritingReply(raw),citations=validateKnowledgeCitations(reply.citations,articles,reply.requiredKnowledgeIds);return {reply,citations,output:{...output,usage:total},repaired:attempt>0};}
  catch(e){lastError=e as Error;if(attempt)throw lastError;
   await writeFile(path.join(current.directory,'delivery-failed.txt'),lastError.message,{mode:0o600});
   const directory=path.join(task.directory,'delivery-retry'),out=path.join(directory,'output');await mkdir(out,{recursive:true});
   const metadata=output.metadata||session.metadata;
   current={...task,directory,outputDirectory:out,...(metadata.threadId?{conversation:{threadId:metadata.threadId,clientMessageId:crypto.randomUUID(),sessionCwd:typeof metadata.sessionCwd==='string'?metadata.sessionCwd:task.directory,previousTotal:(metadata.usageRaw as any)?.total}}:{}),case:{...task.case,prompt:task.case.prompt+`\n本轮上一次交付未通过校验：${lastError.message}\n复用已经取得的材料，不必重复搜索。请补交完整写作 JSON。若 action 为 edit，markdown 必须含实际文稿；knowledgeCitations 只用本轮实际读到的文章 ID 和原文短引文。不要只返回“已完成”或操作说明。\n上次响应末尾：${raw.slice(-6000)}`}};
  }
 }
 throw lastError||Error('未取得有效文稿');
}
function sum(a:number|null,b:number|null){return a==null&&b==null?null:(a||0)+(b||0);}
