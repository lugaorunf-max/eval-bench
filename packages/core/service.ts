import { agentCatalog } from './agent-catalog';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { annotationSchema, caseInputSchema, caseMetadataSchema, runMetadataSchema, completionSchema, runInputSchema, UNKNOWN_USAGE, type CaseData, type CaseRecord, type FileRecord, type FrozenModel, type RunRecord, type AttemptRecord } from '../contracts/index';
import * as t from './schema';
import type { Store } from './db';
import { digest, loadProfiles, publicProfile } from './config';

export class AppError extends Error { constructor(public status: number, message: string) { super(message); } }
export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function safeId(id: string) { if (!/^[a-z][a-z0-9_-]{1,120}$/i.test(id)) throw new AppError(400, '无效的记录编号'); return id; }
function required<T>(value: T | null | undefined, message = '记录不存在'): T { if (value === undefined || value === null) throw new AppError(404, message); return value; }
function asFile(row: typeof t.files.$inferSelect): FileRecord {
  return { id: row.id, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256, role: row.role as FileRecord['role'], createdAt: row.createdAt };
}
export class CasebenchService {
  constructor(public store: Store, private readonly getAgentCatalog = agentCatalog) {}
  get db() { return this.store.db; }
  async file(id: string) { return asFile(required((await this.db.select().from(t.files).where(eq(t.files.id, safeId(id))))[0], '文件不存在')); }
  filePath(id: string) { return path.join(this.store.directory, 'files', safeId(id)); }
  async fileBytes(id: string) { await this.file(id); return readFile(this.filePath(id)); }
  async putFile(bytes: Uint8Array, name: string, mime: string, role: FileRecord['role'], attemptId?: string, providedId?: string, options?:{editorialVideo?:boolean}):Promise<FileRecord> {
    const limit=options?.editorialVideo&&role==='reference'&&['video/mp4','video/webm','video/quicktime'].includes(mime)?100*1024*1024:25*1024*1024;
    if (!bytes.byteLength || bytes.byteLength > limit) throw new AppError(400, `文件需介于 1 字节至 ${limit/1024/1024} MB`);
    if(role==='reference'&&!providedId&&/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime))$/.test(mime)){
      const hash=createHash('sha256').update(bytes).digest('hex');return this.db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${hash}))`);const candidates=await tx.select().from(t.files).where(and(eq(t.files.sha256,hash),eq(t.files.mime,mime),eq(t.files.role,'reference'))),hidden=(await tx.select().from(t.editorialRecords).where(eq(t.editorialRecords.kind,'library-meta'))).filter(r=>r.data.trashedAt||r.data.purgedAt).map(r=>r.data.itemId),existing=candidates.find(f=>!hidden.includes(f.id));return existing?asFile(existing):new CasebenchService({...this.store,db:tx as any}).putFile(bytes,name,mime,role,attemptId,newId('file'),options);});
    }
    const id = safeId(providedId || newId('file'));
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const existing = (await this.db.select().from(t.files).where(eq(t.files.id, id)))[0];
    if (existing) {
      if (existing.sha256 !== checksum || existing.attemptId !== (attemptId || null) || existing.role !== role) throw new AppError(409, '该文件编号已用于其他产物');
      return asFile(existing);
    }
    const normalizedName = name.replaceAll('\\', '/').replace(/[\u0000-\u001f\u007f]/g, '');
    if (role === 'output' && (normalizedName.startsWith('/') || normalizedName.split('/').some(part => !part || part === '.' || part === '..') || normalizedName.length > 500)) throw new AppError(400, '产物文件名包含无效路径');
    const cleanName = role === 'output' ? normalizedName : path.basename(normalizedName).slice(0, 180) || 'artifact.bin';
    const at = now();
    const record = { id, name: cleanName, mime: mime.slice(0, 100) || 'application/octet-stream', size: bytes.byteLength, sha256: checksum, role, attemptId: attemptId || null, createdAt: at };
    try { await writeFile(this.filePath(id), bytes, { flag: 'wx' }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const disk = await readFile(this.filePath(id));
      if (createHash('sha256').update(disk).digest('hex') !== checksum) throw new AppError(409, '磁盘上的文件校验不一致');
    }
    const inserted = await this.db.insert(t.files).values(record).onConflictDoNothing().returning();
    if (!inserted.length) {
      const actual = (await this.db.select().from(t.files).where(eq(t.files.id, id)))[0];
      if (!actual || actual.sha256 !== checksum || actual.attemptId !== (attemptId || null)) throw new AppError(409, '该次尝试已经有同名文件，不能覆盖归档产物');
    }
    return this.file(id);
  }
  async listCases(includeTrashed=false): Promise<CaseRecord[]> {
    const rows = await this.db.select({ c: t.cases, v: t.caseVersions }).from(t.cases).innerJoin(t.caseVersions, eq(t.cases.versionId, t.caseVersions.id)).orderBy(desc(t.cases.updatedAt), asc(t.cases.id));
    const counts = await this.db.select({ caseId: t.caseVersions.caseId, n: count() }).from(t.results).innerJoin(t.caseVersions, eq(t.results.caseVersionId, t.caseVersions.id)).groupBy(t.caseVersions.caseId);
    const metadata=(await this.db.select().from(t.editorialRecords).where(eq(t.editorialRecords.kind,'library-meta'))).filter(r=>r.data.kind==='case'),removed=includeTrashed?[]:metadata.filter(r=>r.data.trashedAt||r.data.purgedAt).map(r=>r.data.itemId);
    return rows.filter(({c})=>!removed.includes(c.id)).map(({ c, v }) => ({ ...v.data, title:(metadata.find(r=>r.data.itemId===c.id)?.data.title as string)||v.data.title, id: c.id, versionId: v.id, version: v.version, contentHash: v.hash, createdAt: c.createdAt, updatedAt: c.updatedAt, favorite: c.favorite, runCount: counts.find(x => x.caseId === c.id)?.n || 0 }));
  }
  async updateCaseMetadata(id: string, raw: unknown) {
    const input = caseMetadataSchema.parse(raw);
    required((await this.db.update(t.cases).set(input).where(eq(t.cases.id, safeId(id))).returning())[0], '案例不存在');
    return required((await this.listCases()).find(c => c.id === id));
  }
  async updateRunMetadata(id: string, raw: unknown) {
    const input = runMetadataSchema.parse(raw);
    required((await this.db.update(t.runs).set(input).where(eq(t.runs.id, safeId(id))).returning())[0], '运行不存在');
    return this.getRun(id);
  }
  async saveCase(raw: unknown, caseId?: string) {
    const input = caseInputSchema.parse(raw);
    if (new Set(input.inputIds).size !== input.inputIds.length) throw new AppError(400, '输入附件不能重复');
    const inputs = await Promise.all(input.inputIds.map(id => this.file(id)));
    const reference = input.referenceId ? await this.file(input.referenceId) : null;
    if (inputs.some(f => f.role === 'output') || reference?.role === 'output') throw new AppError(400, '请通过案例上传入口添加素材');
    if (input.executionMode === 'text' && input.artifactType !== 'copy') throw new AppError(400, '文案模板的产物类型应为文案');
    if (input.executionMode === 'html' && input.artifactType !== 'web') throw new AppError(400, '网页模板的产物类型应为网页');
    const data: CaseData = { title: input.title || input.prompt.slice(0, 28), prompt: input.prompt, scene: input.scene, scenes: [...new Set([input.scene,...(input.scenes||[])])], artifactTypes: [...new Set([input.artifactType,...(input.artifactTypes||[])])], capabilities: [...new Set(input.capabilities)], artifactType: input.artifactType, executionMode: input.executionMode, inputs, reference, instructions: input.instructions, sample: false };
    const at = now(), id = caseId ? safeId(caseId) : newId('case'), versionId = newId('ver');
    await this.db.transaction(async tx => {
      const old = (await tx.select().from(t.cases).where(eq(t.cases.id, id)).for('update'))[0];
      if (caseId && !old) throw new AppError(404, '案例不存在');
      if (old && input.expectedVersion !== old.version) throw new AppError(409, '案例已被其他人修改，请重新打开后再编辑');
      const version = old ? old.version + 1 : 1;
      if (!old) await tx.insert(t.cases).values({ id, versionId, version, createdAt: at, updatedAt: at });
      await tx.insert(t.caseVersions).values({ id: versionId, caseId: id, version, data, hash: digest(data), createdAt: at });
      if (old) await tx.update(t.cases).set({ versionId, version, updatedAt: at }).where(eq(t.cases.id, id));
    });
    return required((await this.listCases()).find(c => c.id === id));
  }
  async catalog() { return (await loadProfiles()).map(publicProfile); }
  async createRun(raw: unknown): Promise<RunRecord> {
    const input = runInputSchema.parse(raw);
    if(input.articleId&&!((await this.db.select().from(t.editorialRecords).where(and(eq(t.editorialRecords.id,input.articleId),eq(t.editorialRecords.kind,'article'))))[0]))throw new AppError(404,'目标文章不存在');
    if (new Set(input.caseIds).size !== input.caseIds.length || new Set(input.models.map(m => `${m.profileId}:${m.model || ""}`)).size !== input.models.length) throw new AppError(400, '案例或执行配置不能重复');
    const allCases = await this.listCases(), profiles = await this.catalog();
    const selected = input.caseIds.map(id => required(allCases.find(c => c.id === id), '选中的案例不存在'));
    const catalog = input.models.some(m => m.model !== undefined) ? await this.getAgentCatalog() : [];
    const models: FrozenModel[] = input.models.map(m => {
      const p = required(profiles.find(p => p.id === m.profileId), '执行配置不存在，请刷新页面');
      if (m.model !== undefined && !catalog.some(a => a.ready && a.profileId === p.id && a.models.some(v => v.id === m.model && v.available!==false))) throw new AppError(400, '所选型号不在本地 Agent 返回的模型列表中，请刷新后重试');
      if (m.temperature !== undefined && !p.supportsTemperature) throw new AppError(400, `${p.name} 未开放温度参数`);
      for (const c of selected) { if (!p.modes.includes(c.executionMode)) throw new AppError(400, `${p.name} 不支持「${c.title}」的执行模板`); if(['chatgpt-session','workbuddy-session','deepseek-session','minimax-session'].includes(p.id) && (c.inputs.length || !(['copy','web'].includes(c.artifactType)&&['text','html'].includes(c.executionMode))))throw new AppError(400, `${p.name} 当前适配支持无附件文案或网页任务`); }
      return { ...p, ...(m.model !== undefined ? { baseProfileId: p.id, id: `${p.id}--${digest(m.model).slice(0, 12)}`, model: m.model, modelName:catalog.find(a=>a.profileId===p.id)?.models.find(v=>v.id===m.model)?.name } : {}), ...(p.supportsTemperature && m.temperature !== undefined ? { temperature: m.temperature, parameters: { ...p.parameters, temperature: m.temperature } } : {}) };
    });
    if (new Set(models.map(p => p.adapter === 'demo')).size > 1) throw new AppError(400, '演示执行器与真实模型请分别创建运行');
    const existing = (await this.db.select().from(t.runs).where(eq(t.runs.requestKey, input.requestKey)))[0];
    if (existing) {
      if (digest({ cases: existing.spec.cases.map(c => c.id), models: existing.spec.models, concurrency: existing.spec.concurrency, timeoutSeconds: existing.spec.timeoutSeconds,articleId:existing.spec.articleId }) !== digest({ cases: selected.map(c => c.id), models, concurrency: input.concurrency, timeoutSeconds: input.timeoutSeconds,articleId:input.articleId })) throw new AppError(409, '请求编号已经用于其他运行配置');
      return this.getRun(existing.id);
    }
    const at = now(), id = newId('run');
    const spec = { ...(input.articleId?{articleId:input.articleId}:{}),cases: selected, models, concurrency: input.concurrency, timeoutSeconds: input.timeoutSeconds, operator: '本地成员', demo: models.every(m => m.adapter === 'demo'), createdAt: at };
    let actualId = id;
    await this.db.transaction(async tx => {
      const inserted = await tx.insert(t.runs).values({ id, spec, name: input.name, requestKey: input.requestKey, createdAt: at, updatedAt: at }).onConflictDoNothing().returning();
      if (!inserted.length) { actualId = required((await tx.select().from(t.runs).where(eq(t.runs.requestKey, input.requestKey)))[0]).id; return; }
      await tx.insert(t.results).values(selected.flatMap(c => models.map(m => ({ id: newId('result'), runId: id, caseVersionId: c.versionId, profileId: m.id, status: 'pending' as const }))));
      if(input.articleId)for(const entry of selected){const mid='lib_'+createHash('sha256').update('case:'+entry.id).digest('hex').slice(0,32);const initial={id:mid,kind:'case',itemId:entry.id,tags:[],collectionIds:[],sourceIds:[],articleIds:[],eventIds:[],favorite:false,reviewed:false,trashedAt:null,createdAt:at,updatedAt:at};await tx.insert(t.editorialRecords).values({id:mid,kind:'library-meta',data:initial,createdAt:at,updatedAt:at}).onConflictDoNothing();const row=(await tx.select().from(t.editorialRecords).where(eq(t.editorialRecords.id,mid)).for('update'))[0];await tx.update(t.editorialRecords).set({data:{...row.data,articleIds:[...new Set([...(row.data.articleIds as string[]||[]),input.articleId])],updatedAt:at},updatedAt:at}).where(eq(t.editorialRecords.id,mid));}
    });
    return this.getRun(actualId);
  }
  async listRuns(): Promise<RunRecord[]> {
    const rows = await this.db.select({ id: t.runs.id }).from(t.runs).orderBy(desc(t.runs.createdAt), desc(t.runs.id));
    return Promise.all(rows.map(r => this.getRun(r.id, false)));
  }
  async getRun(id: string, includeBodies = true): Promise<RunRecord> {
    const row = required((await this.db.select().from(t.runs).where(eq(t.runs.id, safeId(id))))[0], '运行不存在');
    const resultRows = await this.db.select().from(t.results).where(eq(t.results.runId, id)).orderBy(asc(t.results.id));
    const resultIds = resultRows.map(r => r.id);
    const attemptRows = resultIds.length ? await this.db.select().from(t.attempts).where(inArray(t.attempts.resultId, resultIds)).orderBy(asc(t.attempts.number)) : [];
    const attemptIds = attemptRows.map(a => a.id);
    const fileRows = attemptIds.length ? await this.db.select().from(t.files).where(inArray(t.files.attemptId, attemptIds)) : [];
    const annotationRows = attemptIds.length ? await this.db.select().from(t.annotations).where(inArray(t.annotations.attemptId, attemptIds)) : [];
    const events = includeBodies && attemptIds.length ? await this.db.select().from(t.annotationEvents).where(inArray(t.annotationEvents.attemptId, attemptIds)).orderBy(desc(t.annotationEvents.at)) : [];
    const results = resultRows.map(r => {
      const a = attemptRows.find(a => a.id === r.attemptId);
      const annotation = a ? annotationRows.find(n => n.attemptId === a.id) : null;
      const attempt: AttemptRecord | null = a ? {
        id: a.id, number: a.number, status: a.status, startedAt: a.startedAt, finishedAt: a.finishedAt,
        outputText: includeBodies ? a.outputText : '', error: a.error, durationMs: a.durationMs, usage: a.usage,
        artifacts: fileRows.filter(f => f.attemptId === a.id).map(asFile), reportedModel: a.reportedModel,
        metadata: a.metadata, adapterVersion: a.adapterVersion, logs: includeBodies ? a.logs : '',
        annotation: annotation ? { verdict: annotation.verdict, note: annotation.note, revision: annotation.revision, updatedAt: annotation.updatedAt, updatedBy: annotation.updatedBy } : { verdict: null, note: '', revision: 0, updatedAt: a.startedAt, updatedBy: '' },
        audit: events.filter(e => e.attemptId === a.id).map(e => ({ at: e.at, by: e.by, verdict: e.verdict, note: e.note }))
      } : null;
      return { id: r.id, caseVersionId: r.caseVersionId, profileId: r.profileId, status: r.status, attempt, attemptCount: attemptRows.filter(a => a.resultId === r.id && a.kind !== 'followup').length };
    });
    const terminal = results.every(r => ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(r.status));
    const good = results.filter(r => r.status === 'succeeded').length;
    const status = terminal ? good === results.length ? 'completed' : good ? 'partial_failed' : results.every(r => r.status === 'cancelled') ? 'cancelled' : 'failed' : results.some(r => r.status === 'running' || r.status === 'uploading') ? 'running' : row.lastHeartbeatAt ? 'preflight' : 'waiting_runner';
    return { id: row.id, name: row.name, pinned: row.pinned, spec: row.spec, status, createdAt: row.createdAt, updatedAt: row.updatedAt, lastHeartbeatAt: row.lastHeartbeatAt, results };
  }
  async searchResults(query: string, verdict = 'usable', profileId = '') {
    const all = await this.listRuns();
    const items = [];
    for (const r of all) {
      const full = await this.getRun(r.id);
      for (const result of full.results) {
        const c = required(full.spec.cases.find(c => c.versionId === result.caseVersionId));
        const model = required(full.spec.models.find(m => m.id === result.profileId));
        const a = result.attempt;
        if (!a || result.status !== 'succeeded') continue;
        if (verdict && verdict !== 'all' && (verdict === 'unreviewed' ? a.annotation.verdict !== null : a.annotation.verdict !== verdict)) continue;
        if (profileId && result.profileId !== profileId) continue;
        if (query && !`${c.title} ${c.prompt} ${a.outputText} ${a.annotation.note} ${model.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
        items.push({ runId: r.id, case: c, model, result, createdAt: r.createdAt, demo: r.spec.demo });
      }
    }
    return items.slice(0, 200);
  }
  async getAttempt(attemptId: string) {
    const joined = required((await this.db.select({ a: t.attempts, r: t.results }).from(t.attempts).innerJoin(t.results, eq(t.attempts.resultId, t.results.id)).where(eq(t.attempts.id, safeId(attemptId))))[0]);
    const run = await this.getRun(joined.r.runId);
    const a = joined.a;
    const annotation = required((await this.db.select().from(t.annotations).where(eq(t.annotations.attemptId, a.id)))[0]);
    const outputFiles = await this.db.select().from(t.files).where(eq(t.files.attemptId, a.id));
    const events = await this.db.select().from(t.annotationEvents).where(eq(t.annotationEvents.attemptId, a.id)).orderBy(desc(t.annotationEvents.at));
    const attempt: AttemptRecord = {
      id: a.id, number: a.number, status: a.status, startedAt: a.startedAt, finishedAt: a.finishedAt,
      outputText: a.outputText, error: a.error, durationMs: a.durationMs, usage: a.usage,
      artifacts: outputFiles.map(asFile), reportedModel: a.reportedModel, metadata: a.metadata, adapterVersion: a.adapterVersion, logs: a.logs,
      annotation, audit: events.map(e => ({ at: e.at, by: e.by, verdict: e.verdict, note: e.note }))
    };
    return { run, case: required(run.spec.cases.find(c => c.versionId === joined.r.caseVersionId)), model: required(run.spec.models.find(m => m.id === joined.r.profileId)), result: { id: joined.r.id, caseVersionId: joined.r.caseVersionId, profileId: joined.r.profileId, status: a.status, attempt, attemptCount: a.number } };
  }
  async registerDevice(name: string) {
    const token = randomBytes(32).toString('base64url'), id = newId('device');
    await this.db.insert(t.devices).values({ id, tokenHash: hashToken(token), name: name.slice(0, 100), createdAt: now() });
    return { id, token };
  }
  async authenticate(token: string) {
    if (!token || token.length > 300) throw new AppError(401, '请先执行 casebench login');
    const row = (await this.db.select().from(t.devices).where(eq(t.devices.tokenHash, hashToken(token))))[0];
    if (!row || !timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(hashToken(token)))) throw new AppError(401, '执行器登录已失效，请重新登录');
    return row.id;
  }
  async claim(id: string, runnerId: string) {
    let generation = 0;
    await this.db.transaction(async tx => {
      const row = required((await tx.select().from(t.runs).where(eq(t.runs.id, safeId(id))).for('update'))[0]);
      if (row.runnerId && row.runnerId !== runnerId) throw new AppError(409, '这次运行已由另一台执行器接入，请先在原电脑恢复或创建新的运行');
      generation = row.leaseGeneration + (row.runnerId ? 0 : 1);
      const at = now();
      await tx.update(t.runs).set({ runnerId, leaseGeneration: generation, leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(), lastHeartbeatAt: at, updatedAt: at }).where(eq(t.runs.id, id));
    });
    return { generation, run: await this.getRun(id) };
  }
  async assertLease(id: string, runnerId: string, generation: number) {
    const row = required((await this.db.select().from(t.runs).where(eq(t.runs.id, safeId(id))))[0]);
    if (row.runnerId !== runnerId || row.leaseGeneration !== generation) throw new AppError(409, '执行器授权已失效');
    if (!row.leaseExpiresAt || row.leaseExpiresAt < now()) throw new AppError(409, '连接已过期，请在原电脑恢复运行');
    return row;
  }
  async heartbeat(id: string, runnerId: string, generation: number) {
    await this.assertLease(id, runnerId, generation);
    await this.db.update(t.runs).set({ leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(), lastHeartbeatAt: now(), updatedAt: now() }).where(eq(t.runs.id, id));
    return { ok: true };
  }
  async beginAttempt(runId: string, resultId: string, runnerId: string, generation: number, retry = false) {
    await this.assertLease(runId, runnerId, generation);
    let attemptId = '';
    await this.db.transaction(async tx => {
      const r = required((await tx.select().from(t.results).where(and(eq(t.results.id, safeId(resultId)), eq(t.results.runId, runId))).for('update'))[0]);
      if (r.status !== 'pending' && !retry) throw new AppError(409, '该格已启动，请先同步本地产物；重新调用需明确使用 --retry-failed');
      if (r.status === 'succeeded') throw new AppError(409, '成功结果不会被重试覆盖，请创建新的运行');
      const previous = await tx.select().from(t.attempts).where(eq(t.attempts.resultId, r.id));
      attemptId = newId('attempt');
      const at = now();
      await tx.insert(t.attempts).values({ id: attemptId, resultId: r.id, number: previous.length + 1, status: 'running', startedAt: at, usage: UNKNOWN_USAGE, adapterVersion: 'casebench-0.1.0' });
      await tx.insert(t.annotations).values({ attemptId, updatedAt: at, updatedBy: '本地成员' });
      await tx.update(t.results).set({ status: 'running', attemptId }).where(eq(t.results.id, r.id));
    });
    return { attemptId };
  }
  async ownedAttempt(runId: string, attemptId: string) {
    const row = (await this.db.select({ a: t.attempts, r: t.results }).from(t.attempts).innerJoin(t.results, eq(t.attempts.resultId, t.results.id)).where(and(eq(t.attempts.id, safeId(attemptId)), eq(t.results.runId, safeId(runId)))))[0];
    const found = required(row);
    if (found.r.attemptId !== attemptId) throw new AppError(409, '该次尝试已经被新尝试替换，不能再写入');
    return found;
  }
  async uploadArtifact(runId: string, attemptId: string, runnerId: string, generation: number, bytes: Uint8Array, name: string, mime: string, fileId: string) {
    await this.assertLease(runId, runnerId, generation);
    const { a, r } = await this.ownedAttempt(runId, attemptId);
    if (['succeeded', 'failed', 'timed_out', 'cancelled'].includes(a.status)) {
      const existing = (await this.db.select().from(t.files).where(and(eq(t.files.id, fileId), eq(t.files.attemptId, attemptId))))[0];
      if (!existing || existing.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new AppError(409, '已完成的产物不可修改');
      return asFile(existing);
    }
    const oldFiles = await this.db.select().from(t.files).where(eq(t.files.attemptId, attemptId));
    if (!oldFiles.some(f => f.id === fileId) && (oldFiles.length >= 30 || oldFiles.reduce((s, f) => s + f.size, 0) + bytes.byteLength > 100 * 1024 * 1024)) throw new AppError(400, '首版每格最多 30 个文件、合计 100 MB');
    const file = await this.putFile(bytes, name, mime, 'output', attemptId, fileId);
    await this.db.update(t.attempts).set({ status: 'uploading' }).where(eq(t.attempts.id, attemptId));
    await this.db.update(t.results).set({ status: 'uploading' }).where(eq(t.results.id, r.id));
    return file;
  }
  // Called only by the parent that observed its own runner exit, never on a silence timer.
  async runnerExited(runId:string, reason:string) {
    const run=await this.getRun(runId);
    const {readLiveProgress}=await import('./live-progress');
    const live=await readLiveProgress(run);
    await this.db.transaction(async tx=>{
      for(const result of run.results){if(!['running','uploading','pending'].includes(result.status))continue;
        const a=result.attempt,progress=live.find(l=>l.attemptId===a?.id);
        if(a)await tx.update(t.attempts).set({status:'failed',error:reason,outputText:progress?.outputText||a.outputText,usage:progress?.usage||a.usage,durationMs:progress?.activeDurationMs??a.durationMs,finishedAt:now()}).where(and(eq(t.attempts.id,a.id),inArray(t.attempts.status,['running','uploading'])));
        await tx.update(t.results).set({status:'failed'}).where(and(eq(t.results.id,result.id),inArray(t.results.status,['running','uploading','pending'])));
      }
      await tx.update(t.runs).set({updatedAt:now()}).where(eq(t.runs.id,runId));
    });
  }
  async completeAttempt(runId: string, attemptId: string, runnerId: string, generation: number, raw: unknown) {
    await this.assertLease(runId, runnerId, generation);
    const input = completionSchema.parse(raw);
    await this.db.transaction(async tx => {
      const joined = required((await tx.select({ a: t.attempts, r: t.results }).from(t.attempts).innerJoin(t.results, eq(t.attempts.resultId, t.results.id)).where(and(eq(t.attempts.id, safeId(attemptId)), eq(t.results.runId, runId))).for('update'))[0]);
      if (joined.r.attemptId !== attemptId) throw new AppError(409, '当前有效尝试已改变');
      const a = joined.a;
      if (['succeeded', 'failed', 'timed_out', 'cancelled'].includes(a.status)) {
        if (a.status !== input.status || a.outputText !== input.outputText || (digest(a.usage) !== digest(input.usage) && !(input.usage.source === 'unknown' && a.usage.source === 'reported')) || a.error !== input.error) throw new AppError(409, '已完成的结果不可修改');
        return;
      }
      const outputFiles = await tx.select().from(t.files).where(eq(t.files.attemptId, attemptId));
      if (input.status === 'succeeded' && !input.outputText && !outputFiles.length) throw new AppError(400, '成功结果必须含正文或产物文件');
      await tx.update(t.attempts).set({ ...input, finishedAt: now() }).where(eq(t.attempts.id, attemptId));
      await tx.update(t.results).set({ status: input.status }).where(eq(t.results.id, joined.r.id));
      await tx.update(t.runs).set({ updatedAt: now() }).where(eq(t.runs.id, runId));
    });
    return { ok: true };
  }
  async annotate(attemptId: string, raw: unknown) {
    const input = annotationSchema.parse(raw);
    let updated;
    await this.db.transaction(async tx => {
      const a = required((await tx.select().from(t.attempts).where(eq(t.attempts.id, safeId(attemptId))))[0]);
      if (a.status !== 'succeeded') throw new AppError(400, '请在执行成功后进行人工判定');
      const at = now();
      updated = (await tx.update(t.annotations).set({ verdict: input.verdict, note: input.note, revision: input.revision + 1, updatedAt: at, updatedBy: '本地成员' }).where(and(eq(t.annotations.attemptId, attemptId), eq(t.annotations.revision, input.revision))).returning())[0];
      if (!updated) throw new AppError(409, '这条判定或备注已被修改，请重新载入后再编辑');
      await tx.insert(t.annotationEvents).values({ id: newId('event'), attemptId, verdict: input.verdict, note: input.note, at, by: '本地成员' });
    });
    return updated;
  }
}
