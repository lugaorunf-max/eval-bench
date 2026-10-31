'use client';
import {useEffect,useState} from 'react';
import {editorialRequest as request} from './editorial-ui';
type Status={enabled:boolean;url:string;hasToken:boolean;ready:boolean;error?:string;stats?:Record<string,number>};
export function WritingKnowledgeSettings(){
 const [config,setConfig]=useState<Status|null>(null),[url,setUrl]=useState(''),[token,setToken]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 useEffect(()=>{let live=true;request<Status>('editorial/knowledge').then(c=>{if(live){setConfig(c);setUrl(c.url);setEnabled(c.enabled);}}).catch(e=>{if(live)setStatus(e.message);});return()=>{live=false;};},[]);
 async function save(){setBusy(true);setStatus('');try{await request('editorial/knowledge',{enabled,url:url.trim(),token},'PATCH');setToken('');const result=await request<Status>('editorial/knowledge?check=1');setConfig(result);setStatus(result.ready?'知识库已连接':result.error||'连接配置已保存，知识库尚未连接');}catch(e){setStatus((e as Error).message);}finally{setBusy(false);}}
 return <section className="wd-knowledge-settings"><strong>写法知识库</strong><label className="context-option"><input type="checkbox" checked={enabled} disabled={!config||busy} onChange={e=>setEnabled(e.target.checked)}/>写作时检索参考文章</label><label>服务地址<input aria-label="知识库服务地址" placeholder="http://同事的私有网络地址:43130" value={url} onChange={e=>setUrl(e.target.value)} disabled={!config||busy}/></label><label>访问凭据<input aria-label="知识库访问凭据" type="password" autoComplete="new-password" placeholder={config?.hasToken?'已保存，留空保留':'服务端配置的访问凭据'} value={token} onChange={e=>setToken(e.target.value)} disabled={!config||busy}/></label><div className="ed-row"><button type="button" className="ed-button" disabled={!config||busy} onClick={()=>void save()}>{busy?'正在检查…':'保存并检查连接'}</button>{status&&<span role="status">{status}</span>}</div></section>;
}
