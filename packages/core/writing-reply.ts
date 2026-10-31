import { z } from 'zod';
import {knowledgeCitationSchema} from './writing-citations';

const replySchema=z.object({
  action:z.enum(['reply','edit']),
  target:z.enum(['document','selection']).default('document'),
  reply:z.string().max(100000).default(''),
  markdown:z.string().max(500000).default(''),
  knowledgeCitations:z.array(knowledgeCitationSchema).max(16).default([])
});

// Repair punctuation only outside strings; never change article text or quoted evidence.
export function repairWritingJson(raw:string){
 let quoted=false,escaped=false,out='';
 for(const ch of raw){
  if(quoted){out+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
  if(ch==='"')quoted=true;
  out+=({'，':',','：':':','｛':'{','｝':'}','［':'[','］':']'} as Record<string,string>)[ch]||ch;
 }
 return out;
}
function decodeReply(raw:string):unknown{
 const repaired=repairWritingJson(raw);
 try{return JSON.parse(repaired);}catch{}
 // Tool-enabled agents may emit a short preamble before their final JSON.
 let start=-1,depth=0,quoted=false,escaped=false,candidate:unknown;
 for(let i=0;i<repaired.length;i++){
  const c=repaired[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(depth>0&&c==='"'){quoted=true;continue;}
  if(c==='{'){if(depth++===0)start=i;}else if(c==='}'&&depth>0&&--depth===0){try{const value=JSON.parse(repaired.slice(start,i+1));if(value?.action==='reply'||value?.action==='edit')candidate=value;}catch{}}
 }
 if(candidate)return candidate;
 throw Error('模型返回的写作格式异常，正文已保留，请重试本轮请求');
}

export const automaticWritingInstruction=`根据用户本轮要求自动判断是讨论、提问，还是生成大纲、初稿或修订，不要求用户选择模式。
只返回一个 JSON 对象，不加代码围栏：
讨论或询问：{"action":"reply","reply":"你的回答"}
生成或修改正文或大纲：{"action":"edit","target":"document","reply":"只给简短的生成或修改说明","markdown":"仅文章正文或大纲的完整 Markdown"}
修改选中的文字：{"action":"edit","target":"selection","reply":"简短说明","markdown":"只包含所选文字的替换内容"}
有选区时默认围绕该选区回答；用户要求修改它时仅替换选中文字，保留选区外的文字。用户明确要求全文修改才用 document。没有选区不可用 selection。
只有用户要求生成或修改时才返回 edit；评价、解释、讨论返回 reply。用户要求直接写文章时直接交付，不强迫先选三个方向。用户要大纲就只给大纲。markdown 只放交付文稿，不含“以下是正文”、写作分析、操作说明、参考清单、JSON 或对用户的提问；这些放 reply。正文以当前人工编辑版本为准，不能因移除选区而丢失全文语境。
根据本篇资料与参考文章自然组织内容，不套固定模板、蓝图、节点或片段数量。不要返回 narrative、plan 或 beats。
已有媒体与参考卡由编辑器保留，不要重复输出其文件链接。用户要求配图或抓取网页图片时，优先用 mcp__writing_web__read_public_page 读取网页实际图片候选（若当前执行器提供此工具），可以将实际读取的网页图片用独立段落的 ![说明](图片原始地址) 放在对应正文位置，说明中简要注明来源；后台会下载验证并保存到本篇。只用页面真实提供的 PNG、JPEG、WebP、GIF 地址，不猜图片路径，不用知识库历史文章的图冒充当前事件截图，最多六张。网页检索与图片抓取失败时如实说明，不宣称已经完成。这不包括尚未提供的素材：缺少的事实、引语、数据、案例或截图须在叙事需要的位置保留【素材位：具体所需内容及用途】，依赖它的判断保留【待写：补齐哪项证据后再写什么】。保留原稿已有的素材位；用户明确要求删除或已补齐对应证据时才调整。`;

export function interpretWritingReply(answer:string){
  const raw=answer.trim().replace(/^```(?:json)?\s*\n?/i,'').replace(/\n?```$/,'');
  const decoded=decodeReply(raw);
  const result=replySchema.safeParse(decoded);
  if(!result.success)throw Error('模型返回的写作字段格式异常，正文已保留，请重试本轮请求');
  const v=result.data;
  if(v.action==='edit'){
    if(!v.markdown.trim())throw Error('助手没有返回修改内容，请重试');const markdown=!v.markdown.includes('\n')&&/^#{1,3} .+\\n\\n/.test(v.markdown)?v.markdown.replace(/\\n/g,'\n'):v.markdown;return {purpose:'revise' as const,text:markdown,note:v.reply,target:v.target,citations:v.knowledgeCitations,requiredKnowledgeIds:[] as string[],sourceIds:[] as string[]};
  }
  if(!v.reply.trim())throw Error('助手没有返回正文，请重试');
  return {purpose:'discuss' as const,text:v.reply,target:'document' as const,citations:v.knowledgeCitations,requiredKnowledgeIds:[] as string[],sourceIds:[] as string[]};
}
