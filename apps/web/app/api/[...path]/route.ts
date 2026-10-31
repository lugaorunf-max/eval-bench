import {materialCatalog} from '@/packages/core/material-cards';
import {ArticleAssociations} from '@/packages/core/article-associations';
import {CAPABILITIES} from '@/packages/contracts';
import {openArtifact} from '@/packages/core/artifact-viewer';
import {SCENES} from '@/packages/contracts';
import {HotspotsBridge} from '@/packages/core/hotspots/bridge';
import {ContentLibrary,activeLibraryMeta} from '@/packages/core/content-library';
import {ContentWorkspace} from '@/packages/core/content-workspace';
import {DiscoveryService} from '@/packages/core/discovery';
import type {ResourceLink} from '@/packages/contracts/content-workspace';
import {startArticle} from '@/packages/core/start-article';
import type {CandidateCase,LibrarySource} from '@/packages/contracts/library';
import {searchX,readXPost} from '@/packages/core/media-runtime';
import {chromeMediaStatus,chromeMediaControl} from '@/packages/core/chrome-media-bridge';
import {knowledgeStatus,saveKnowledgeConfig} from '@/packages/core/writing-knowledge';
import { sessionAgent } from '@/scripts/native-agents.mjs';
import { ConversationService } from '@/packages/core/conversations';
import { launchConversation } from '@/packages/core/conversation-launcher';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { stateDir } from '@/packages/core/config';
import { agentCatalog } from '@/packages/core/agent-catalog';
import { Readable } from 'node:stream';
import path from 'node:path';
import { z,ZodError } from 'zod';
import { getStore } from '@/packages/core/db';
import { seedStore } from '@/packages/core/seed';
import { CasebenchService, AppError } from '@/packages/core/service';
import { compareHtml, compareMarkdown, makeArchive } from '@/packages/core/export';
import { startDemo, startLocalRun } from '@/packages/core/demo-runner';
import { readLiveProgress } from '@/packages/core/live-progress';
import { EditorialService } from '@/packages/core/editorial';
import {MediaWorkflowService} from '@/packages/core/media-workflow';
import {mediaToolRequest} from '@/packages/core/media-tool-session';
import {collectorJson} from '@/packages/core/hotspots/client';
import { ArticleMaterialsService } from '@/packages/core/article-materials';
import { MediaPreparationService } from '@/packages/core/media-preparation';
import { WritingDocumentService } from '@/packages/core/writing-service';
import { files as storedFiles } from '@/packages/core/schema';
import { desc } from 'drizzle-orm';
import {isWritingVideo,writingMediaMime,WRITING_VIDEO_LIMIT} from '@/packages/contracts/writing-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const ALLOWED = new Set(
  (process.env.CASEBENCH_ALLOWED_HOSTS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
);
function permittedHost(host: string) { return LOCAL.has(host) || ALLOWED.has(host); }
function guard(request: Request) {
  const url = new URL(request.url);
  if (!permittedHost(url.hostname)) throw new AppError(403, '当前仅接受本机或已授权的局域网地址访问');
  const host = (request.headers.get('host') || '').split(':')[0];
  if (!permittedHost(host)) throw new AppError(403, '未授权的主机地址');
  url.host = request.headers.get('host')!;
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) throw new AppError(403, '请求来源不匹配');
  if (['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') || '') && request.method !== 'GET') throw new AppError(403, '请从本网站提交修改');
  return url;
}
async function limitedBody(request: Request, max: number) {
  if (Number(request.headers.get('content-length')) > max) throw new AppError(413, '上传内容过大');
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new AppError(413, '上传内容过大'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request: Request,max=3*1024*1024) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError(415, '请使用 JSON 提交');
  try { return JSON.parse((await limitedBody(request, max)).toString('utf8')); }
  catch (e) { if (e instanceof AppError) throw e; throw new AppError(400, 'JSON 格式无效'); }
}
async function formBody(request: Request, max=26 * 1024 * 1024) {
  return new Response(new Uint8Array(await limitedBody(request, max)), { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData();
}
function uploadedFile(form: FormData) {
  const f = form.get('file');
  if (!f || typeof f === 'string') throw new AppError(400, '请选择文件');
  return f;
}
async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const url = guard(request);
    const p = (await context.params).path;
    const method = request.method;
    const store = await getStore(); await seedStore(store);
    const s = new CasebenchService(store);
    const ok = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (p[0] === 'editorial') {
      const origin='http://127.0.0.1:'+url.port;
      const e = new EditorialService(s,{origin});
      const workflow=new MediaWorkflowService(e,origin);
      if(p[1]==='material-cards'&&method==='GET')return ok(await materialCatalog(e,url.searchParams.get('articleId')||''));
      if(p[1]==='resource-source'&&method==='POST'){const v=z.object({url:z.string().url().max(2000),title:z.string().min(1).max(300),articleId:z.string().optional()}).strict().parse(await jsonBody(request));return ok(await new ContentWorkspace(e).record({...v,origin:'manual'}),201);}
      if(p[1]==='start-article'&&method==='POST')return ok(await startArticle(e,await jsonBody(request)),201);
      if(p[1]==='article-associations'&&method==='POST')return ok(await new ArticleAssociations(e).read(await jsonBody(request)));
      if(p[1]==='article-associations'&&method==='PATCH')return ok(await new ArticleAssociations(e).change(await jsonBody(request)));
      if(p[1]==='resources'){
       const workspace=new ContentWorkspace(e),articleId=url.searchParams.get('articleId')||'';
       if(method==='GET')return ok(await workspace.cards(articleId));
       if(method==='PATCH')return ok(await workspace.change(articleId,await jsonBody(request)));
       if(method==='POST'){const v=z.object({articleId:z.string(),kind:z.enum(['source','case','candidate','media','instance']),ids:z.array(z.string()).min(1).max(100)}).strict().parse(await jsonBody(request));return ok(await Promise.all(v.ids.map(id=>workspace.attach(v.articleId,v.kind,id))));}
      }
      if(p[1]==='discovery'){
       const discovery=new DiscoveryService(e,origin);
       if(!p[2]&&method==='GET')return ok(await discovery.list(url.searchParams.has('articleId')?url.searchParams.get('articleId')!:undefined));
       if(!p[2]&&method==='POST')return ok(await discovery.start(await jsonBody(request)),202);
       if(p[2]&&method==='PATCH'){const v=z.object({hidden:z.boolean()}).strict().parse(await jsonBody(request));return ok(await discovery.dismiss(p[2],v.hidden));}
       if(p[2]&&method==='DELETE')return ok(await discovery.stop(p[2]));
       if(p[2]&&p[3]==='resume'&&method==='POST')return ok(await discovery.resume(p[2],await jsonBody(request)),202);
      }
      if(p[1]==='collection-settings'){
       if(method==='GET')return ok((await e.list('collection-settings'))[0]||{});
       if(method==='PATCH'){const v=z.object({profileId:z.string().min(1).max(130),model:z.string().min(1).max(200)}).strict().parse(await jsonBody(request));const old=(await e.list<any>('collection-settings'))[0];return ok(old?await e.mutate(old.id,'collection-settings',()=>({...old,...v})):await e.insert('collection-settings',{id:'collection_settings',...v,createdAt:new Date().toISOString()}));}
      }
      if(p[1]==='library'){
       const library=new ContentLibrary(e,method==='GET'),kind=z.enum(['media','case','candidate','instance']);
       if(p[2]==='media'&&method==='GET')return ok(await library.media());
       if(p[2]==='cases'&&method==='GET'){const entries=await s.listCases(true),links=await e.list<ResourceLink>('article-resource'),sources=await e.list<LibrarySource>('library-source');return ok(await Promise.all(entries.map(async entry=>{const meta=activeLibraryMeta(await library.meta('case',entry.id),links),origins=links.filter(l=>l.kind==='source'&&meta.sourceIds.includes(l.itemId)||l.kind==='case'&&l.itemId===entry.id);const scope=url.searchParams.get('articleId')||'',scoped=origins.filter(l=>l.articleId===scope),global=origins.filter(l=>!l.articleId),context=scoped.length?scoped:global;return {entry,meta,source:sources.find(source=>meta.sourceIds.includes(source.id)),cover:await library.cover('case',entry.id),uses:await library.uses('case',entry.id),origins:[...new Set(context.some(l=>l.origins.length)?context.flatMap(l=>l.origins):global.flatMap(l=>l.origins))],priority:context.some(l=>l.priority)};})));}
       if(p[2]==='candidates'&&method==='GET')return ok(await library.candidates());
       if(p[2]==='candidates'&&method==='POST')return ok(await library.candidate(await jsonBody(request)),201);
       if(p[2]==='prompt'&&method==='POST')return ok(await library.promptCandidate(await jsonBody(request)),201);
       if(p[2]==='sources'&&method==='GET')return ok(await e.list('library-source'));
       if(p[2]==='collections'&&method==='GET')return ok(await library.collections());
       if(p[2]==='collections'&&p[3]&&method==='PATCH')return ok(await library.updateCollection(p[3],await jsonBody(request)));
       if(p[2]==='collections'&&method==='POST')return ok(await library.collection(await jsonBody(request)),201);
       if(p[2]==='collect'&&method==='POST')return ok(await workflow.collect(await jsonBody(request)),202);
       if(p[2]==='migrate'&&method==='POST'){await jsonBody(request);return ok({...(await library.reconcile()),collector:await new HotspotsBridge(s).migrateLibrary().catch(error=>({deferred:String(error)}))});}
       if(p[2]==='batch'&&method==='POST'){const v=z.object({kind,ids:z.array(z.string()).min(1).max(100),patch:z.record(z.string(),z.unknown())}).strict().parse(await jsonBody(request));return ok(await s.db.transaction(async tx=>{const shared=new ContentLibrary(new EditorialService(new CasebenchService({...s.store,db:tx as any})));for(const id of v.ids)await shared.ensureItem(v.kind,id);const updated=[];for(const id of v.ids)updated.push(await shared.patch(v.kind,id,v.patch));return updated;}));}
       if(p[2]==='item'&&p[3]&&p[4]){const k=kind.parse(p[3]),id=p[4];if(k==='case'&&p[5]==='classification'&&method==='POST')return ok(await workflow.suggestTaxonomy(id,await jsonBody(request)));if(p[5]==='cover'&&method==='GET'){await library.ensureItem(k,id);const entry=k==='case'?(await s.listCases(true)).find(c=>c.id===id):undefined;return ok({selected:await library.cover(k,id)||entry?.reference||undefined});}if(p[5]==='covers'&&method==='GET')return ok(await library.coverChoices(k,id));if(p[5]==='article'&&method==='POST'){const v=z.object({articleId:z.string()}).strict().parse(await jsonBody(request));await e.get(v.articleId,'article');await library.ensureItem(k,id);return ok(await new ContentWorkspace(e).attach(v.articleId,k,id));}if(p[5]==='dependencies'&&method==='GET')return ok(await library.dependencies(k,id));if(p[5]==='purge'&&method==='POST'){await jsonBody(request);return ok(await library.purge(k,id));}if(method==='PATCH')return ok(await library.patch(k,id,await jsonBody(request)));}
       if(p[2]==='candidate'&&p[3]&&p[4]==='promote'&&method==='POST')return ok(await library.promote(p[3],await jsonBody(request)));
       if(p[2]==='candidate'&&p[3]&&p[4]==='analyze'&&method==='POST'){const c=await e.get<CandidateCase>(p[3],'case-candidate');return ok(await (c.prompt?workflow.parsePrompt(c,await jsonBody(request)):workflow.analyzeCase(c,await jsonBody(request))),202);}
       if(p[2]==='article'&&p[3]&&p[4]==='media'&&p[5]&&method==='DELETE')return ok(await library.detachMedia(p[3],p[5]));
       if(p[2]==='targets'&&method==='GET'){const articles=await e.list<any>('article');let events:any[]=[];try{events=(await collectorJson('cases?pageSize=100')).events||[];}catch{}return ok({articles:articles.map(a=>({id:a.id,title:a.title})),events:events.map(e=>({id:e.id,title:e.title}))});}
       throw new AppError(404,'内容库操作不存在');
      }
      if(p[1]==='browser-check'&&method==='POST'){
        const v=z.discriminatedUnion('action',[z.object({action:z.literal('search'),query:z.string().min(2).max(300)}).strict(),z.object({action:z.literal('post'),url:z.string().max(2000),screenshot:z.boolean().default(false)}).strict()]).parse(await jsonBody(request));
        if(v.action==='search')return ok(await searchX(v.query,AbortSignal.timeout(65000)));
        const directory=path.join(s.store.directory,'media-checks',crypto.randomUUID()),post=await readXPost(v.url,{screenshot:v.screenshot,directory,signal:AbortSignal.timeout(65000)});
        return ok({...post,screenshotPath:undefined,...(post.screenshotPath?{screenshotBase64:(await readFile(post.screenshotPath)).toString('base64')}:{})});
      }
      if(p[1]==='browser-bridge'&&method==='GET')return ok(chromeMediaStatus());
      if(p[1]==='browser-bridge'&&method==='POST'){const body=await jsonBody(request,12*1024*1024);try{return ok(chromeMediaControl(body));}catch(error){if(error instanceof ZodError)throw error;throw new AppError(409,(error as Error).message);}}
      if(p[1]==='tool-session'&&method==='POST')return ok(await mediaToolRequest(await jsonBody(request)));
      if(p[1]==='media-jobs'&&p[2]&&p[3]==='retry'&&method==='POST'){const previous=await e.get<any>(p[2],'media-job');if(!previous.request)throw new AppError(409,'旧任务没有完整参数，请从原帖重新收集并指定文章');return ok(await workflow.collect(previous.request),202);}
      if(p[1]==='media-jobs'&&p[2]&&method==='PATCH'){await jsonBody(request);const job=await e.get<any>(p[2],'media-job');if(job.status==='running')throw new AppError(409,'请先停止任务');for(const other of await e.list<any>('media-job'))if(other.targetId===job.targetId&&(other.articleId||'')===(job.articleId||'')&&other.status!=='running')await e.mutate<any>(other.id,'media-job',j=>({...j,dismissedAt:new Date().toISOString()}));return ok({cleared:true});}
      if(p[1]==='media-jobs'&&method==='GET')return ok(await workflow.jobs(url.searchParams.get('targetId')||undefined));
      if(p[1]==='media-jobs'&&p[2]&&method==='DELETE')return ok(await workflow.cancel(p[2]));
      if(p[1]==='instances'&&p[2]&&p[3]==='open-effect'&&method==='POST'){await jsonBody(request);return ok(await openArtifact(e,p[2]));}
      if(p[1]==='instances'&&p[2]&&p[3]==='capture'&&method==='POST')return ok(await workflow.capture(p[2],await jsonBody(request)),202);
      if(p[1]==='case-analysis'&&method==='POST'){
        const body=await jsonBody(request),detail=await collectorJson('events/'+encodeURIComponent(String(body.eventId))),lead=detail.cases.find((c:any)=>c.id===body.leadId);
        if(!lead)throw new AppError(404,'案例线索不存在');return ok(await workflow.analyzeCase(lead,{profileId:body.profileId,model:body.model}),202);
      }
      if(p[1]==='case-drafts'&&!p[2]&&method==='GET')return ok((await e.list<any>('case-prompt-draft')).filter(d=>d.leadId===url.searchParams.get('leadId')));
      if(p[1]==='case-drafts'&&p[2]&&method==='PATCH'){const v=z.object({review:z.object({scenes:z.array(z.enum(Object.keys(SCENES) as [string,...string[]])).min(1).max(15).optional(),artifactTypes:z.array(z.enum(['web','copy','image','video'])).min(1).max(4).optional(),summary:z.string().max(500).optional(),capabilities:z.array(z.enum(Object.keys(CAPABILITIES) as [string,...string[]])).min(1).max(7).optional(),title:z.string().min(1).max(100),prompt:z.string().max(100000),kind:z.enum(['original','reconstructed']),scene:z.enum(Object.keys(SCENES) as [string,...string[]]),artifactType:z.enum(['web','copy','image','video'])}).strict()}).strict().parse(await jsonBody(request));return ok(await e.mutate<any>(p[2],'case-prompt-draft',d=>({...d,review:v.review})));}
      if(p[1]==='case-drafts'&&p[2]&&method==='GET')return ok(await e.get(p[2],'case-prompt-draft'));
      if(p[1]==='case-drafts'&&p[2]&&method==='POST')return ok(await workflow.saveDraft(p[2],await jsonBody(request)),201);
      if(p[1]==='knowledge'&&method==='GET')return ok(await knowledgeStatus(url.searchParams.get('check')==='1'));
      if(p[1]==='knowledge'&&method==='PATCH')return ok(await saveKnowledgeConfig(await jsonBody(request)));
      if (method === 'GET' && p[1] === 'sources') return ok(await e.list('source'));
      if (method === 'POST' && p[1] === 'sources') return ok(await e.addSource(await jsonBody(request)), 201);
      if (method === 'PATCH' && p[1] === 'sources' && p[2]) return ok(await e.favorite(p[2], await jsonBody(request)));
      if (method === 'GET' && p[1] === 'media') return ok(await e.list('prepared-media'));
      if (method === 'POST' && p[1] === 'media' && !p[2]) return ok(await new MediaPreparationService(e).attach(await jsonBody(request)),201);
      if (method === 'POST' && p[1] === 'media' && p[2] === 'process') return ok(await new MediaPreparationService(e).process(await jsonBody(request)),201);
      if (method === 'PATCH' && p[1] === 'instances' && p[2] && p[3] === 'preparation') return ok(await new MediaPreparationService(e).save(p[2],await jsonBody(request)));
      if (method === 'GET' && p[1] === 'instances') {const items=await e.instances();if(p[2]){const item=items.find(i=>i.id===p[2]);if(!item)throw new AppError(404,'实测记录不存在');return ok(item);}return ok(items);}
      if (method === 'POST' && p[1] === 'instances') return ok(await e.addInstance(await jsonBody(request)), 201);
      if (method === 'GET' && p[1] === 'files') return ok((await s.db.select().from(storedFiles).orderBy(desc(storedFiles.createdAt)).limit(300)).map(f => ({ ...f, role: f.role as 'reference' })));
      if (method === 'POST' && p[1] === 'files') {
        const form = await formBody(request,WRITING_VIDEO_LIMIT+1024*1024), file = uploadedFile(form),mime=writingMediaMime(file.name,file.type)||'application/octet-stream';
        return ok(await s.putFile(new Uint8Array(await file.arrayBuffer()), file.name, mime, 'reference',undefined,undefined,{editorialVideo:true}), 201);
      }
      if (p[1] === 'articles') {
        if (method === 'GET' && !p[2]) {
          const items = await e.list<import('@/packages/contracts/editorial').WritingArticle>('article');
          return ok(items.map(a => ({id:a.id,title:a.title,kind:a.kind,pinned:a.pinned,updatedAt:a.updatedAt,createdAt:a.createdAt,messageCount:a.messages.length})));
        }
        if (method === 'POST' && !p[2]) return ok(await e.create(await jsonBody(request)), 201);
        if (method === 'POST' && p[2] && p[3] === 'references') return ok(await new ArticleMaterialsService(e).references(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'media') return ok(await new ArticleMaterialsService(e).media(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'import-images') return ok(await new ArticleMaterialsService(e).importImages(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'insert') return ok(await new ArticleMaterialsService(e).insert(p[2],await jsonBody(request)));
        if (method === 'PATCH' && p[2] && p[3] === 'document') return ok(await new WritingDocumentService(e).save(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'proposal') return ok(await new WritingDocumentService(e).proposal(p[2],await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'restore') return ok(await new WritingDocumentService(e).restore(p[2],await jsonBody(request)));
        if (method === 'GET' && p[2] && !p[3]) return ok(await e.article(p[2]));
        if (method === 'PATCH' && p[2] && !p[3]) return ok(await e.patch(p[2], await jsonBody(request)));
        if (method === 'POST' && p[2] && p[3] === 'messages') return ok(await e.send(p[2], await jsonBody(request)), 202);
      }
      throw new AppError(404, '内容接口不存在');
    }
    if (method === 'GET' && p[0] === 'health') return ok({ ok: true, mode: 'local-development', engine: store.engine, version: '0.1.0' });
    if (method === 'GET' && p[0] === 'agents' && p.length === 1) return ok(await agentCatalog(url.searchParams.get('refresh') === '1'));
    if (method === 'GET' && p[0] === 'bootstrap') return ok({ cases: await s.listCases(), profiles: await s.catalog(), runs: await s.listRuns() });
    if (p[0] === 'cases') {
      if (method === 'GET' && p.length === 1) return ok(await s.listCases());
      if (method === 'POST' && p.length === 1) return ok(await s.saveCase(await jsonBody(request)), 201);
      if (method === 'PATCH' && p.length === 2) return ok(await s.saveCase(await jsonBody(request), p[1]));
      if (method === 'PATCH' && p.length === 3 && p[2] === 'metadata') return ok(await s.updateCaseMetadata(p[1], await jsonBody(request)));
    }
    if (p[0] === 'runs') {
      if (method === 'GET' && p.length === 1) return ok(await s.listRuns());
      if (method === 'POST' && p.length === 1) return ok(await s.createRun(await jsonBody(request)), 201);
      if (method === 'GET' && p.length === 2) return ok(await s.getRun(p[1]));
      if (method === 'PATCH' && p.length === 3 && p[2] === 'metadata') return ok(await s.updateRunMetadata(p[1], await jsonBody(request)));
      if (method === 'GET' && p.length === 3 && p[2] === 'live') return ok(await readLiveProgress(await s.getRun(p[1], false)));
      if (method === 'POST' && p[2] === 'demo') { await jsonBody(request); return ok(await startDemo(s, p[1], url.origin), 202); }
      if (method === 'POST' && p.length === 3 && p[2] === 'start-local') { await jsonBody(request); return ok(await startLocalRun(s, p[1], url.origin), 202); }
      if (method === 'GET' && p[2] === 'export') {
        const run = await s.getRun(p[1]), format = url.searchParams.get('format');
        if (format === 'html') return ok({ html: compareHtml(run, url.origin), text: compareMarkdown(run, url.origin) });
        if (format === 'md') return new Response(compareMarkdown(run, url.origin), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${run.id}.md"` } });
        const stream = makeArchive(s, run, url.origin);
        return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="casebench-${run.id}.zip"`, 'Cache-Control': 'no-store' } });
      }
    }
    if (p[0] === 'search' && method === 'GET') return ok(await s.searchResults((url.searchParams.get('q') || '').slice(0, 300), url.searchParams.get('verdict') || 'usable', url.searchParams.get('profile') || ''));
    if (p[0] === 'conversations' && p[1]) {
      const conversations = new ConversationService(s), id = p[1];
      if (method === 'GET' && p.length === 2) return ok(await conversations.get(id));
      if (method === 'POST' && p[2] === 'sync') { await jsonBody(request); return ok(await conversations.synchronize(id)); }
      if (method === 'POST' && p[2] === 'stop') { await jsonBody(request); return ok(await conversations.stop(id)); }
      if (method === 'POST' && p[2] === 'recover') {
        await jsonBody(request); const record = await conversations.get(id), turn = [...record.turns].reverse().find(t => ['pending','running','uploading'].includes(t.attempt.status));
        if (!turn) throw new AppError(409,'没有等待恢复归档的轮次');
        await launchConversation(conversations,turn.id,url.origin,true); return ok({started:true},202);
      }
      if (method === 'POST' && p[2] === 'turns') {
        const body = await jsonBody(request);
        // A lost HTTP response can be retried with the same key without running inference twice.
        const result = await conversations.enqueue(id, body);
        await launchConversation(conversations,result.turnId,url.origin); return ok(result,202);
      }
    }
    if (p[0] === 'attempts') {
      if (method === 'GET' && p.length === 3 && p[2] === 'conversation') return ok(await new ConversationService(s).attach(p[1]));
      if (method === 'POST' && p[2] === 'stop') {
        await jsonBody(request); const item = await s.getAttempt(p[1]);
        if (!['running','uploading'].includes(item.result.status)) throw new AppError(409,'当前没有正在执行的任务');
        if (!['gpt','workbuddy','deepseek','minimax'].includes(sessionAgent(item.model)||'')) throw new AppError(400,'这个 Agent 暂不支持网页停止');
        const directory=path.join(stateDir(),'runs',item.run.id,item.result.id,item.result.attempt!.id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'cancel.json'),'{}');return ok({ok:true});
      }
      if (method === 'GET' && p.length === 2) return ok(await s.getAttempt(p[1]));
      if (method === 'PATCH' && p[2] === 'annotation') return ok(await s.annotate(p[1], await jsonBody(request)));
    }
    if (p[0] === 'files') {
      if (method === 'POST' && p.length === 1) {
        const form = await formBody(request), file = uploadedFile(form);
        const role = form.get('role') === 'reference' ? 'reference' : 'input';
        return ok(await s.putFile(new Uint8Array(await file.arrayBuffer()), file.name, file.type, role), 201);
      }
      if (method === 'GET' && p.length === 2) {
        const f = await s.file(p[1]);
        const bytes = await s.fileBytes(f.id);
        const safeInline = (/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.mime)||isWritingVideo(f.mime)) && url.searchParams.get('download') !== '1';
        const headers: Record<string, string> = {
          'Content-Type': safeInline ? f.mime : 'application/octet-stream',
          'Content-Disposition': `${safeInline ? 'inline' : 'attachment'}; filename="artifact"; filename*=UTF-8''${encodeURIComponent(path.basename(f.name))}`,
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'
        };
        const range = request.headers.get('range');
        if (range && safeInline && isWritingVideo(f.mime)) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
          const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
          const end = match[1] && match[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
          return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) } });
        }
        return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Length': String(bytes.length) } });
      }
    }
    if (p[0] === 'runner') {
      if (p[1] === 'register' && method === 'POST') {
        const body = await jsonBody(request);
        return ok(await s.registerDevice(typeof body.name === 'string' ? body.name : '本地执行器'), 201);
      }
      const runnerId = await s.authenticate((request.headers.get('authorization') || '').replace(/^Bearer /, ''));
      if (p[1] === 'conversations' && p[2]) {
        const service = new ConversationService(s), id=p[2];
        if (method === 'POST' && (p[3] === 'claim' || p[3] === 'recover')) { await jsonBody(request); return ok(await service.claim(id,runnerId,p[3] === 'recover')); }
        const lease=request.headers.get('x-casebench-conversation-lease')||'';
        if (method === 'POST' && p[3] === 'progress') return ok(await service.progress(id,runnerId,lease,await jsonBody(request)));
        if (method === 'POST' && p[3] === 'complete') return ok(await service.complete(id,runnerId,lease,await jsonBody(request)));
        if (method === 'POST' && p[3] === 'files') {
          const form=await formBody(request),f=uploadedFile(form),fileId=form.get('id');if(typeof fileId!=='string')throw new AppError(400,'缺少产物编号');
          return ok(await service.upload(id,runnerId,lease,new Uint8Array(await f.arrayBuffer()),f.name,f.type,fileId),201);
        }
      }
      if (p[1] === 'runs' && p[2]) {
        const id = p[2], action = p[3];
        if (method === 'POST' && action === 'claim') return ok(await s.claim(id, runnerId));
        const generation = Number(request.headers.get('x-casebench-lease'));
        if (!Number.isSafeInteger(generation) || generation < 1) throw new AppError(400, '缺少运行授权编号');
        if (method === 'POST' && action === 'heartbeat') return ok(await s.heartbeat(id, runnerId, generation));
        if (method === 'POST' && action === 'attempts' && p.length === 4) {
          const body = await jsonBody(request);
          if (typeof body.resultId !== 'string' || (body.retry !== undefined && typeof body.retry !== 'boolean')) throw new AppError(400, '任务参数无效');
          return ok(await s.beginAttempt(id, body.resultId, runnerId, generation, body.retry === true), 201);
        }
        if (method === 'POST' && action === 'attempts' && p[4] && p[5] === 'files') {
          const form = await formBody(request), f = uploadedFile(form), fileId = form.get('id');
          if (typeof fileId !== 'string') throw new AppError(400, '缺少产物编号');
          return ok(await s.uploadArtifact(id, p[4], runnerId, generation, new Uint8Array(await f.arrayBuffer()), f.name, f.type, fileId), 201);
        }
        if (method === 'POST' && action === 'attempts' && p[4] && p[5] === 'complete') {
          const body=await jsonBody(request),result=await s.completeAttempt(id,p[4],runnerId,generation,body);
          return ok(result);
        }
      }
    }
    throw new AppError(404, '没有找到这个入口');
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: e.issues.map(i => `${i.path.join('.')} ${i.message}`).join('；') }, { status: 400 });
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    console.error('Casebench API:', e instanceof Error ? e.message : 'unknown error');
    return Response.json({ error: '服务暂时无法处理请求，请重试并检查本地服务日志' }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
