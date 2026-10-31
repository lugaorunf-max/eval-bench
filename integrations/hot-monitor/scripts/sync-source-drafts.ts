// Explicit, offline import of source configurations. No fetch, job, credential or enable action.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {z} from 'zod';
import type {Candidate} from '../modules/hot-monitor/contracts.ts';
const Draft=z.object({id:z.string().regex(/^[a-z0-9-]{3,80}$/),name:z.string().min(1).max(200),kind:z.enum(['rss','web_list','x_search']),config:z.record(z.string(),z.unknown()),tier:z.enum(['T1','T1_5','T2']),interval_minutes:z.number().int().min(1).max(1440),tags:z.array(z.string()),participation_mode:z.enum(['editorial','hot_signal','isolated']),enabled:z.literal(false),site_fulltext:z.literal(false),syndicate_fulltext:z.literal(false)}).strict();
export function parseSourceDrafts(raw:unknown){const v=z.object({description:z.string(),sources:z.array(Draft).min(1).max(500)}).strict().parse(raw);const forbidden=(x:unknown):boolean=>!!x&&typeof x==='object'&&Object.entries(x).some(([k,value])=>/^(?:password|secret|cookie|token|access_token|refresh_token|authorization|api.?key)$/i.test(k)||forbidden(value));if(v.sources.some(s=>forbidden(s.config)))throw Error('信源配置不得包含凭据');return v.sources;}
const nameKey=(name:string)=>name.normalize('NFKC').replace(/（[^）]*）|\([^)]*\)/g,'').replace(/\s+/g,'').toLowerCase();
const digest=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,16);
const canonical=(v:unknown):string=>Array.isArray(v)?JSON.stringify(v.map(canonical)):v&&typeof v==='object'?JSON.stringify(Object.keys(v).sort().map(k=>[k,canonical((v as Record<string,unknown>)[k])])):JSON.stringify(v)??'null';
export function planSourceDrafts(drafts:ReturnType<typeof parseSourceDrafts>,existing:Candidate[],identity:(kind:string,config:Record<string,unknown>)=>string|null){
 const seen=new Set<string>(),working=[...existing];return drafts.map(d=>{const key=identity(d.kind,d.config);if(!key)throw Error('缺少采集入口：'+d.name);if(seen.has(d.kind+':'+key))throw Error('更新包包含重复入口：'+d.name);seen.add(d.kind+':'+key);const old=working.find(c=>c.id===d.id||c.kind===d.kind&&c.config&&identity(c.kind,c.config)===key||nameKey(c.name)===nameKey(d.name)&&c.kind!=='mp_account');
 if(old?.config&&Object.keys(old.config).length&&old.kind!==d.kind)throw Error('已有不同类型配置，请人工核对：'+d.name);
 if(old?.config&&Object.keys(old.config).length&&identity(old.kind,old.config)!==key)throw Error('已有不同入口，请人工核对：'+d.name);
 const handle=old?.handle??/@([a-zA-Z0-9_]+)/.exec(d.name)?.[1]??null,name=old?.name||d.name,id=old?.id||'hm-'+digest(handle?'x:'+handle.toLowerCase():nameKey(name)),config=old?.config&&Object.keys(old.config).length?old.config:d.config;
 const data:Candidate={...old,id,name,kind:d.kind,config,tier:old?.tier||d.tier,platform:d.kind==='x_search'?'X / 推特':'网站 / RSS',handle,registered:true,fields:old?.fields||[],sourceRole:old?.sourceRole||'待分类',classificationMethod:old?.classificationMethod||'suggested',originalExample:old?.originalExample||null,example:old?.example||'',priority:old?.priority||false,aliases:[...new Set([...(old?.aliases||[]),...(name!==d.name?[d.name]:[])])],status:old?.status||'candidate'};
 if(canonical(old?.config)!==canonical(config)){data.status='candidate';data.verifiedAt=null;data.lastTestError=null;}
 // Runtime activity is derived from actual local sources; never import a colleague's verification.
 data.verifiedAt??=null;data.lastTestError??=null;
 delete data.enabled;delete data.recentCount;delete data.awaitingActivation;
 const row={incomingId:d.id,id,name,identity:key,existing:!!old,configPreserved:!!old?.config&&Object.keys(old.config).length>0,data};working.push(data);return row;
 });
}
async function main(){
 const input=process.argv[2];if(!input)throw Error('用法：node scripts/sync-source-drafts.ts 配置.json [--apply] --backup-dir 目录');
 const raw=JSON.parse(await readFile(input,'utf8')),drafts=parseSourceDrafts(raw),base=fileURLToPath(new URL('../',import.meta.url)),c=JSON.parse(await readFile(path.join(base,'.data/database.json'),'utf8'));
 process.env.DATABASE_URL=`postgres://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@127.0.0.1:${c.port}/${c.database}`;
 const {sql,closeDb}=await import('../packages/backend/src/db.ts'),{sourceIdentity}=await import('../packages/backend/src/admin/sources.ts'),{assertSupportedConfig}=await import('../packages/backend/src/sources/config-keys.ts'),{catalogue}=await import('../modules/hot-monitor/backend/catalogue.ts'),{audit}=await import('../packages/backend/src/audit.ts');
 try{for(const d of drafts)assertSupportedConfig(d.kind,d.config);
 const entries=await catalogue(),checks=await sql`SELECT id,data FROM hm_source_checks`,sources=await sql`SELECT * FROM sources`,[before]=await sql`SELECT (SELECT count(*)::int FROM articles) articles,(SELECT count(*)::int FROM hm_events) events,(SELECT count(*)::int FROM hm_reports) reports,(SELECT count(*)::int FROM sources) sources,(SELECT count(*)::int FROM receipts) receipts`;
 const plan=planSourceDrafts(drafts,entries,sourceIdentity),summary=plan.map(({data,...r})=>r),apply=process.argv.includes('--apply');
 const outArg=process.argv.indexOf('--backup-dir'),out=outArg<0?null:process.argv[outArg+1];if(apply&&!out)throw Error('应用前必须提供备份目录');
 if(out){await mkdir(out,{recursive:true});await writeFile(path.join(out,'import-plan.json'),JSON.stringify(summary,null,2),{mode:0o600});}
 let changed=0;
 if(apply){await writeFile(path.join(out!,'source-config-before-'+Date.now()+'.json'),JSON.stringify({checks,sources,before},null,2),{mode:0o600,flag:'wx'});
 await sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(hashtext('monitor-source-draft-import'))`;
  for(const r of plan){const previous=checks.find(v=>v.id===r.id);if(previous&&canonical(previous.data)===canonical(r.data))continue;
   if(previous){const updated=await tx`UPDATE hm_source_checks SET data=${tx.json(r.data as never)} WHERE id=${r.id} AND data=${tx.json(previous.data)} RETURNING id`;if(!updated.length)throw Error('信源正在被其他操作修改，请重试：'+r.name);}else await tx`INSERT INTO hm_source_checks(id,data) VALUES(${r.id},${tx.json(r.data as never)})`;
   await audit('本机用户','monitor.source.import',r.id,'同事信源配置同步；未试采、未启用',previous?.data||null,r.data,{db:tx});changed++;
  }
 });
 const [after]=await sql`SELECT (SELECT count(*)::int FROM articles) articles,(SELECT count(*)::int FROM hm_events) events,(SELECT count(*)::int FROM hm_reports) reports,(SELECT count(*)::int FROM sources) sources,(SELECT count(*)::int FROM receipts) receipts`;
 if(canonical(before)!==canonical(after))throw Error('业务计数变化，请检查并发任务及备份');
 const afterEntries=await catalogue();for(const r of plan)if(!afterEntries.some(c=>c.id===r.id&&c.config&&sourceIdentity(c.kind,c.config)===r.identity))throw Error('目录回读不一致：'+r.name);
 if(out)await writeFile(path.join(out,'import-result.json'),JSON.stringify({changed,items:summary,before,after},null,2),{mode:0o600});
 }
 console.log(JSON.stringify({applied:apply,total:plan.length,newEntries:plan.filter(r=>!r.existing).length,existingEntries:plan.filter(r=>r.existing).length,changed,preservedConfigurations:plan.filter(r=>r.configPreserved).length}));
 }finally{await closeDb();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
