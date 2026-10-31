'use client';
import {useEffect,useState} from 'react';
import type {EditorialInstance} from '@/packages/contracts/editorial';
import type {MaterialCard} from '@/packages/contracts/material-cards';
import {editorialRequest as request,EditorialSheet as Sheet,EditorialText,WriterMark} from './editorial-ui';
import {InstancePreparation} from './instance-preparation';
import {ResultConversation} from './result-conversation';
import {ArticleAssociationControl} from './article-association-control';
import {useArticleScope} from './article-scope';
import {Copy,Download} from './tone-icon';
export const resultStatus:Record<string,string>={succeeded:'已完成',running:'执行中',pending:'待执行',failed:'执行失败',timed_out:'已超时',cancelled:'已取消',uploading:'归档中',imported:'人工导入'};
/** The same execution is opened from articles, the media library and test history. */
export function InstanceDetails({card,close,refresh,notify,initialPanel='effect'}:{card:MaterialCard;close:()=>void;refresh:()=>Promise<void>;notify:(s:string)=>void;initialPanel?:'effect'|'records'}){
 const [item,setItem]=useState<EditorialInstance|null>(null),[panel,setPanel]=useState(initialPanel),[error,setError]=useState(''),{articles}=useArticleScope();
 async function reload(){try{setItem(await request<EditorialInstance>('editorial/instances/'+card.instanceId));setError('');}catch(e){setError((e as Error).message);}}
 async function changed(){await refresh();await reload();}
 useEffect(()=>{void reload();const timer=setInterval(()=>void reload(),10000);return()=>clearInterval(timer);},[card.instanceId]);
 const number=(n:number|null|undefined)=>n==null?item?.origin==='manual'?'未记录':'未提供':n.toLocaleString();
 return <Sheet className="result-effect-dialog material-instance-dialog" title={card.title} close={close}><div className="result-detail-tabs ed-tabs" role="tablist" aria-label="实测详情">{([['effect','效果与素材'],['records','执行记录']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={panel===key} className={panel===key?'on':''} onClick={()=>setPanel(key)}>{label}</button>)}</div><div className="ed-dialog-body result-detail-body">{error&&<p className="ed-error">{error}</p>}{!item&&!error?<p>正在读取实测…</p>:item&&<>{panel==='effect'?<><div className="result-detail-agent"><WriterMark profileId={item.agent}/><strong>{item.agent||'人工导入'}</strong><small>{item.model||'模型未记录'}</small><span>{resultStatus[item.status||'']}</span></div><InstancePreparation key={item.id} item={item} refresh={changed} notify={notify}/>{item.output&&<button className="ed-button" onClick={()=>void navigator.clipboard.writeText(item.output).then(()=>notify('已复制文字')).catch(()=>notify('请手动选择复制'))}><Copy size={13}/>复制文字</button>}<details className="result-task"><summary>任务与提示词</summary><EditorialText text={item.task}/></details><ArticleAssociationControl items={card.items} ids={card.articleIds} articles={articles} refresh={changed} notify={notify}/></>:<><h3>{item.origin==='manual'?'人工导入记录':'累计执行信息'}</h3><dl className="result-metrics"><div><dt>累计耗时</dt><dd>{item.metrics?.durationMs==null?number(null):(item.metrics.durationMs/1000).toFixed(1)+' 秒'}</dd></div><div><dt>输入 Token</dt><dd>{number(item.metrics?.inputTokens)}</dd></div><div><dt>输出 Token</dt><dd>{number(item.metrics?.outputTokens)}</dd></div><div><dt>对话轮次</dt><dd>{number(item.metrics?.rounds)}</dd></div></dl>{item.metrics?.partial&&<p className="ed-hint">以上为已归档轮次的已知用量，包含未上报部分。</p>}{item.attemptId&&<ResultConversation attemptId={item.attemptId} refresh={changed}/>}<details className="result-execution-files"><summary>执行文件与错误记录</summary>{item.files.map(f=><a key={f.id} className="ed-file" href={'/api/files/'+f.id+'?download=1'}>{f.name}<Download size={14}/></a>)}{!item.files.length&&<p className="ed-hint">没有返回文件</p>}{item.notes&&<EditorialText text={item.notes}/>}</details></>}</>}</div></Sheet>;
}
