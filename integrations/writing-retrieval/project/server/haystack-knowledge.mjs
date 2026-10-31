import {createRagManifest,publicRagHit,cleanRagText} from './rag-documents.mjs';
import {createHaystackClient} from './haystack-client.mjs';
import {retrievalQuery} from './retrieval.mjs';

// Keep a bounded, balanced description for the local models. Full pasted
// references still reach lexical retrieval and the existing writing request.
export function balancedRagQuery(parts,maxChars=440){
 const values=parts.map(p=>String(p.text||'').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim()).filter(Boolean);
 if(!values.length)return '';
 const head=Array.from(values[0]).slice(0,values.length>1?180:maxChars).join(''),selected=values.slice(1,5),budget=maxChars-Array.from(head).length-selected.length;
 const per=Math.max(0,Math.floor(budget/(selected.length||1)));
 return [head,...selected.map(value=>Array.from(value).slice(0,per).join(''))].filter(Boolean).join('\n');
}
export function createHaystackKnowledge({client=createHaystackClient(),onProgress=()=>{},minimumScore=Number(process.env.RAG_MIN_RERANK_SCORE??-5)}={}){
 if(!Number.isFinite(minimumScore))throw Object.assign(new Error('重排相关性阈值配置无效。'),{code:'RAG_CONFIG_ERROR'});
 let preparedLibrary,prepared,committedRevision='',inflight;
 function prepare(library){if(preparedLibrary!==library){prepared=createRagManifest(library);preparedLibrary=library;}return prepared;}
 async function synchronize(library){
  if(committedRevision===library.revision&&preparedLibrary===library)return prepare(library);
  if(inflight){await inflight;if(committedRevision===library.revision&&preparedLibrary===library)return prepare(library);}
  const current=prepare(library),revision=library.revision;
  inflight=(async()=>{
   await client.acquireIndexLock?.();
   try{
   const plan=await client.plan(current.manifest),changed=new Set(plan.changed);
   let done=0,embedded=0;
   for(const source of current.sources){
    if(!changed.has(source.key))continue;
    const {chunks,...metadata}=source;
    const result=await client.upsert({...metadata,chunks:chunks()},{done,total:changed.size,totalSources:current.sources.length,revision});
    done++;embedded+=result.embedded||0;onProgress({done,total:changed.size,embedded,key:source.key});
   }
   await client.commit(current.manifest,revision);committedRevision=revision;
   }finally{await client.releaseIndexLock?.();}
  })();
  try{await inflight;}finally{inflight=null;}
  return current;
 }
 const info=()=>({name:'Haystack · 中文混合检索',methods:['SQLite BM25','FastEmbed 中文向量召回','Haystack RRF','中文交叉编码器重排'],...client.info()});
 const runQuery=async input=>{try{return await client.query(input);}catch(error){committedRevision='';throw error;}};
 function convert(result,current){return (result.hits||[]).map(hit=>publicRagHit(hit,current)).filter(Boolean);}
 function example(hit){
  const a=hit.item,source=hit.passages.filter(p=>p.kind==='source').map(p=>p.content).join('\n\n'),analysis=hit.passages.filter(p=>p.kind==='analysis').map(p=>p.content).join('\n\n');
  return {id:a.id,title:a.title,account:a.account,url:a.url,publishDate:a.publishDate,genre:a.genre,structureId:a.structureId,structureName:a.structureName,structureFit:cleanRagText(a.structureFit||''),reviewStatus:a.reviewStatus,evidenceLevel:a.evidenceLevel,analysisStatus:a.analysisStatus,notePath:a.notePath,obsidianUrl:a.obsidianUrl,originalNotePath:a.originalNotePath,originalObsidianUrl:a.originalObsidianUrl,
   recipe:Object.fromEntries(Object.entries(a.recipe||{}).map(([key,value])=>[key,cleanRagText(value)])),stages:(a.stages||[]).map(value=>cleanRagText(value)),stageNotes:[],opening:a.opening,middle:a.middle,ending:a.ending,hookChains:[],
   contentExcerpt:source.slice(0,1800),analysisExcerpt:a.evidenceLevel==='analyzed'?analysis.slice(0,2400):'',match:hit.match};
 }
 async function retrieve(library,input={},limit=12){
  const current=await synchronize(library),query=retrievalQuery(input),topic=query.topic.map(part=>part.text).filter(Boolean).join('\n').slice(0,6000),task=query.pattern.map(part=>part.text).filter(Boolean).join('\n').slice(0,2400)||topic;
  const articles=await runQuery({revision:library.revision,query:topic,semantic_query:balancedRagQuery(query.topic),genre:input.genre||'',kinds:['source','analysis'],limit:Math.max(1,Math.min(limit,30)),minimum_score:minimumScore});
  if(input.mode==='articles')return {templates:[],blueprints:[],guidance:[],examples:convert(articles,current).map(example),retrieval:{...info(),rerankApplied:Boolean(articles.meta?.rerankApplied)},revision:library.revision};
  const structures=await runQuery({revision:library.revision,query:task,semantic_query:balancedRagQuery(query.topic),genre:input.genre||'',kinds:['template','note'],limit:20,minimum_score:-100});
  let blueprints=[];
  if(input.genre==='资讯'&&(library.blueprints||[]).length){
   const response=await runQuery({revision:library.revision,query:task,semantic_query:balancedRagQuery(query.topic),genre:'资讯',kinds:['blueprint'],limit:5,minimum_score:-100});
   blueprints=convert(response,current).map(hit=>hit.item).filter(item=>(library.blueprints||[]).includes(item));
  }
  const matches=convert(articles,current),structuralHits=convert(structures,current),templateMatches=structuralHits.filter(hit=>current.parents.has('template:'+hit.item.id)&&(!input.genre||hit.item.genre===input.genre)),ranks=new Map(templateMatches.map((hit,index)=>[hit.item.id,index]));
  const guidance=convert({...structures,hits:(structures.hits||[]).filter(hit=>hit.parentKey.startsWith('note:')&&hit.score>=minimumScore)},current).slice(0,3).map(hit=>({title:hit.item.title,notePath:hit.match.notePath,obsidianUrl:hit.match.obsidianUrl,excerpt:hit.passages.map(p=>p.content).join('\n\n').slice(0,900)}));
  const templates=library.templates.filter(t=>!input.genre||t.genre===input.genre).sort((a,b)=>(ranks.get(a.id)??999)-(ranks.get(b.id)??999)||a.id.localeCompare(b.id));
  return {templates,blueprints,examples:matches.map(example),guidance,structureMatches:templateMatches.map(hit=>({id:hit.item.id,name:hit.item.name,matchedTerms:hit.match.terms,channels:hit.match.channels})),
   retrieval:{...info(),taskLabels:query.taskLabels,returnedExamples:matches.length,rerankApplied:Boolean(articles.meta?.rerankApplied),notice:matches.length?'已按主题、段落和中文重排模型筛选；模型分数不是准确率。':'没有通过相关性筛选的案例；请结合结构定义补充材料。'},
   stats:{...library.stats,matchedArticles:matches.length,returnedExamples:matches.length},source:{...library.source,retrieval:info()},revision:library.revision};
 }
 async function search(library,{q='',genre='',limit=5}={}){
  const current=await synchronize(library);
  const response=await runQuery({revision:library.revision,query:String(q).slice(0,2000),genre,kinds:['source','analysis','template','note','blueprint'],limit:Math.max(1,Math.min(Number(limit)||5,30)),minimum_score:minimumScore});
  const hits=convert(response,current),results=hits.map(hit=>({id:hit.item.id,title:hit.item.title||hit.item.id+' '+hit.item.name,notePath:hit.match.notePath,obsidianUrl:hit.match.obsidianUrl,snippet:hit.match.snippet,kind:hit.match.kind,reviewStatus:hit.item.reviewStatus||'参考笔记',evidenceLevel:hit.item.evidenceLevel||(hit.match.kind==='写作结构'?'analyzed':'candidate'),match:hit.match}));
  return {source:{...library.source,retrieval:info()},revision:library.revision,total:results.length,totalIsCandidateWindow:true,results,retrieval:{...info(),rerankApplied:Boolean(response.meta?.rerankApplied)}};
 }
 return {synchronize,retrieve,search,info,close:client.close,health:client.health};
}
