'use client';
import {MediaLoginSettings} from './media-workflow-controls';
import {WritingKnowledgeSettings} from './writing-knowledge-settings';
import {useLibraryArticleFilter,LibraryArticleFilter} from './library-article-filter';
import {CaseCoverPreview} from './case-cover-preview';
import {CaseEditor} from './case-editor';
import CaseLibraryManager from './case-library-manager';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutGrid, List, MoreHorizontal, Pencil, Pin, Star, ArrowLeft, ArrowRight, Check, CheckCheck, CheckSquare, ChevronRight, Clipboard, Code2, Copy, Download, ExternalLink, FileText, FolderOpen, ImageIcon, Layers, LoaderCircle, Plus, RefreshCw, Search, Settings2, Terminal, Upload, X } from './tone-icon';
import { ARTIFACT_TYPES, CAPABILITIES, EXECUTION_MODES, SCENES, type AgentCatalog, type Annotation, type AttemptRecord, type CaseRecord, type FileRecord, type FrozenModel, type Profile, type ResultRecord, type RunRecord, type Verdict } from '@/packages/contracts';
import { ArtifactPreview, ReferencePreview, ResultThumbnail } from './preview';
import { useConversation, ConversationSummary, ConversationTranscript, ConversationComposer } from './conversation';
import { CaseLibrary, CapabilityCoverage } from './case-library';
import Editorial from './editorial';
import Hotspots from './hotspots';
import { WorkspaceFrame, SecondaryContent, useWorkspaceMemory } from './workspace-navigation';
import { QuoteInstanceButton } from './unified-results';
import { RoundedPlayIcon, SidebarToggleIcon, TaxonomyIcon } from './taxonomy-icon';
import { LIBRARY_CAPABILITIES, caseCapabilities, caseScenes, caseArtifacts, type LibraryCapability } from '@/packages/core/library-taxonomy';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api/' + url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers }, cache: 'no-store' });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败，请重试'); return result;
}
const statusLabels: Record<string, string> = { waiting_runner: '等待本机执行', preflight: '执行前检查', running: '执行中', uploading: '上传中', completed: '已完成', partial_failed: '部分失败', failed: '执行失败', pending: '待执行', succeeded: '已完成', timed_out: '已超时', cancelled: '已取消' };
const verdictLabels = { usable: '可用', pending: '需修改', unusable: '不可用' };
function time(at: string) { return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
function duration(ms: number | null | undefined) { return ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }
function usage(n: number | null | undefined) { return n === null || n === undefined ? '未知' : n.toLocaleString(); }
function labelVerdict(verdict: Verdict | undefined) { return verdict ? verdictLabels[verdict] : '未评审'; }
async function copyText(text: string) { await navigator.clipboard.writeText(text); }
type SearchItem = { runId: string; case: CaseRecord; model: FrozenModel; result: ResultRecord; createdAt: string; demo: boolean };
type FixedResult = { run: RunRecord; case: CaseRecord; model: FrozenModel; result: ResultRecord };

function runName(run: RunRecord) { const d = new Date(run.createdAt); return run.name || `测试 ${d.getMonth() + 1}/${d.getDate()} · ${run.spec.cases.length} 个案例`; }
function useSavedFlag(key: string) {
  const [value, setValue] = useState(false);
  useEffect(() => { try { setValue(localStorage.getItem(key) === 'true'); } catch {} }, [key]);
  return [value, (next: boolean) => { setValue(next); try { localStorage.setItem(key, String(next)); } catch {} }] as const;
}
function ModalFrame({ title, close, children, className = '' }: { title: string; close: () => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    ref.current?.showModal(); document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`design-dialog ${className}`} aria-label={title} onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}>{children}</dialog>;
}

export default function Workspace() {
  const pathname = usePathname(), router = useRouter();
  const isHotspots=pathname.startsWith('/hotspots');
  const isLaunch = pathname === '/launch', isMaterials = pathname === '/materials', isFixed = pathname.startsWith('/a/'), isCase = pathname.startsWith('/c/');
  const isEditorial = pathname === '/topics' || (pathname.startsWith('/write') || pathname.startsWith('/articles')) || pathname === '/instances' || isMaterials;
  const isResults = pathname === '/runs' || pathname.startsWith('/r/') || isMaterials || isFixed || pathname === '/instances';
  const [cases, setCases] = useState<CaseRecord[]>([]), [profiles, setProfiles] = useState<Profile[]>([]), [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true), [fatal, setFatal] = useState(''), [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]), [hydrated, setHydrated] = useState(false);
  const [q, setQ] = useState(''), [caseTab, setCaseTab] = useState<'requirements' | 'coverage'>('requirements');
  const [edit, setEdit] = useState<CaseRecord | 'new' | null>(null), [settings, setSettings] = useState(false), [caseEntry, setCaseEntry] = useState<CaseRecord | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null), [runError, setRunError] = useState(''), [fixed, setFixed] = useState<FixedResult | null>(null);
  const [runSearch, setRunSearch] = useWorkspaceMemory('runs.query',''), [rename, setRename] = useState<RunRecord | null>(null), [renameValue, setRenameValue] = useState(''), [metadataBusy, setMetadataBusy] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState<string[]>([]);
  const notify = useCallback((text: string) => setNotice(text), []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4200); return () => clearTimeout(timer); }, [notice]);
  const refresh = useCallback(async () => {
    try { const data = await api<{ cases: CaseRecord[]; profiles: Profile[]; runs: RunRecord[] }>('bootstrap'); setCases(data.cases); setProfiles(data.profiles); setRuns(data.runs); setFatal(''); }
    catch (e) { setFatal((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { try { const ids = JSON.parse(sessionStorage.getItem('casebench.selection') || '[]'); if (Array.isArray(ids)) setSelected(ids.filter((id: unknown) => typeof id === 'string')); } catch {} setHydrated(true); }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (hydrated) sessionStorage.setItem('casebench.selection', JSON.stringify(selected)); }, [selected, hydrated]);
  useEffect(()=>{const receive=(e:Event)=>setSelected((e as CustomEvent<string[]>).detail);window.addEventListener('casebench-select-cases',receive);return()=>window.removeEventListener('casebench-select-cases',receive);},[]);
  const runId = pathname.startsWith('/r/') ? pathname.split('/')[2] : pathname === '/runs' ? runs[0]?.id : undefined;
  const currentRunId = useRef(runId); currentRunId.current = runId;
  const reloadRun = useCallback(async () => {
    if (!runId) return;
    try { const data = await api<RunRecord>(`runs/${runId}`); if (currentRunId.current !== data.id) return; setRun(data); setRuns(old => old.map(r => r.id === data.id ? { ...r, ...data, results: data.results.map(v => ({ ...v, attempt: v.attempt ? { ...v.attempt, outputText: '', logs: '' } : null })) } : r)); setRunError(''); }
    catch (e) { if (currentRunId.current === runId) setRunError((e as Error).message); }
  }, [runId]);
  useEffect(() => { setRun(null); setRunError(''); void reloadRun(); if (!runId) return; const timer = setInterval(() => void reloadRun(), 2500); return () => clearInterval(timer); }, [reloadRun, runId]);
  useEffect(() => {
    if (!isFixed) return; let active = true; setFixed(null); setRunError('');
    api<FixedResult>(`attempts/${pathname.split('/')[2]}`).then(r => { if (active) setFixed(r); }).catch(e => { if (active) setRunError(e.message); }); return () => { active = false; };
  }, [isFixed, pathname]);
  const choose = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const selectedCases = selected.map(id => cases.find(c => c.id === id)).filter(Boolean) as CaseRecord[];
  const directCase = isCase ? cases.find(c => c.id === pathname.split('/')[2]) : null;
  const shownCase = caseEntry ? { ...caseEntry, favorite: cases.find(c => c.id === caseEntry.id)?.favorite ?? caseEntry.favorite } : directCase;
  useEffect(() => { setCaseTab('requirements'); }, [shownCase?.versionId]);
  const closeCase = () => { setCaseEntry(null); if (isCase) router.replace('/'); };
  const showCopy = async (text: string, success = '已复制') => { try { await copyText(text); notify(success); } catch { notify('当前浏览器限制复制，请下载或手动选择文本。'); } };
  async function favorite(c: CaseRecord) {
    if (favoriteBusy.includes(c.id)) return; setFavoriteBusy(ids => [...ids, c.id]);
    try { const updated = await api<CaseRecord>(`cases/${c.id}/metadata`, { method: 'PATCH', body: JSON.stringify({ favorite: !c.favorite }) }); setCases(old => old.map(v => v.id === updated.id ? updated : v)); }
    catch (e) { notify((e as Error).message); } finally { setFavoriteBusy(ids => ids.filter(id => id !== c.id)); }
  }
  async function updateRun(r: RunRecord, patch: { name?: string; pinned?: boolean }) {
    if (metadataBusy) return; setMetadataBusy(true);
    try { const next = await api<RunRecord>(`runs/${r.id}/metadata`, { method: 'PATCH', body: JSON.stringify(patch) }); setRuns(old => old.map(v => v.id === next.id ? { ...v, name: next.name, pinned: next.pinned } : v)); setRun(old => old?.id === next.id ? { ...old, name: next.name, pinned: next.pinned } : old); setRename(null); }
    catch (e) { notify((e as Error).message); } finally { setMetadataBusy(false); }
  }
  const openRename = (r: RunRecord) => { setRename(r); setRenameValue(runName(r)); };
  const matchingRuns = runs.filter(r => !runSearch || `${runName(r)} ${r.spec.cases.map(c => c.title).join(' ')}`.toLowerCase().includes(runSearch.toLowerCase()));
  const nav = [{ label: '选题池', icon: <FileText size={18}/>, path: '/topics', active: pathname === '/topics' }, { label: 'AI 写作', icon: <Pencil size={18}/>, path: '/write', active: (pathname.startsWith('/write') || pathname.startsWith('/articles')) }, { label: '案例库', icon: <LayoutGrid size={18}/>, path: '/', active: !isLaunch && !isResults && !isEditorial }, { label: '发起测试', icon: <RoundedPlayIcon/>, path: '/launch', active: isLaunch }, { label: '结果与素材', icon: <FolderOpen size={18}/>, path: '/instances', active: isResults }];
  const historyGroup = (title: string, entries: RunRecord[]) => <section className="test-group"><h2>{title}<span>{entries.length}</span></h2>{entries.length ? entries.map(r => <div className={`test-row ${runId === r.id ? 'active' : ''}`} key={r.id}><button className="test-open" title={`${runName(r)} · ${time(r.createdAt)} · ${statusLabels[r.status]}`} onClick={() => router.push(`/r/${r.id}`)} aria-current={runId === r.id ? 'page' : undefined}><FileText size={14}/><span>{runName(r)}</span>{r.pinned && title === '我的测试' && <Pin size={10}/>}<i className={`status-dot ${r.status}`}/></button><details className="test-menu"><summary aria-label={`${runName(r)}的更多操作`}><MoreHorizontal size={15}/></summary><div><button disabled={metadataBusy} onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); void updateRun(r, { pinned: !r.pinned }); }}><Pin size={13}/>{r.pinned ? '取消置顶' : '置顶测试'}</button><button onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); openRename(r); }}><Pencil size={13}/>重命名</button></div></details></div>) : <p className="test-empty">{title === '置顶' ? '暂无置顶' : '没有匹配的测试'}</p>}</section>;
  return <WorkspaceFrame settings={() => setSettings(true)} className={`app redesigned top-workspaces ${pathname === '/runs' || pathname.startsWith('/r/') ? 'with-history' : ''} ${isFixed || pathname.startsWith('/r/') || pathname === '/runs' ? 'view-result-detail' : ''} ${isHotspots ? 'view-hotspots' : isEditorial ? 'view-editorial' : !isLaunch && !isResults ? 'view-library' : ''} ${!isEditorial && !isFixed ? 'testing-workspace' : ''}`}>
    <div className="workspace-layout">
      {(pathname === '/runs' || pathname.startsWith('/r/')) && <SecondaryContent><div className="context-history test-context"><label className="context-search"><Search size={14}/><input aria-label="搜索我的测试" placeholder="搜索测试名称、案例…" value={runSearch} onChange={e=>setRunSearch(e.target.value)}/></label><div className="context-scroll">{historyGroup('置顶',matchingRuns.filter(r=>r.pinned))}{historyGroup('我的测试',matchingRuns)}</div></div></SecondaryContent>}
      <main className="workspace-main"><div className="workspace-topline"><span>{isLaunch ? '发起测试' : isResults ? '结果与素材' : '案例库'}</span><div className="top-spacer"/><span className="local-badge"><i/>本地开发版</span><button className="icon-btn" aria-label="执行配置" onClick={() => setSettings(true)}><Settings2 size={16}/></button></div>
        {fatal && <div className="alert error">{fatal}<button onClick={() => void refresh()}>重新加载</button></div>}
        {isHotspots ? <Hotspots key={pathname} notify={notify} refreshCases={refresh}/> : loading ? <div className="page-loading"><LoaderCircle className="spin" size={22}/>正在加载…</div> : isEditorial ? <Editorial profiles={profiles} notify={notify}/> : isLaunch ? <Launch cases={selectedCases} profiles={profiles} remove={id => setSelected(old => old.filter(v => v !== id))} notify={notify} settings={() => setSettings(true)} back={() => router.push('/')} created={r => { setSelected([]); setRuns(old => [r, ...old.filter(x => x.id !== r.id)]); router.push(`/r/${r.id}`); }}/>
        : isMaterials ? <><label className="library-search"><Search size={18}/><input aria-label="搜索素材" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索提示词、正文和备注…"/></label><Materials query={q} profiles={profiles} notify={notify} open={id => router.push(`/a/${id}`)}/></>
        : isFixed ? runError ? <Empty title="结果无法打开" text={runError}/> : fixed ? <><button className="back-link" onClick={() => router.push('/instances')}><ArrowLeft size={14}/>实测结果</button><div className="page-heading"><div><h1>{fixed.case.title}</h1><p>固定结果 · v{fixed.case.version} · {time(fixed.run.createdAt)}</p></div></div><div className="unified-fixed-tools"><button className="text-btn" onClick={() => setCaseEntry(fixed.case)}>查看案例要求<ChevronRight size={13}/></button><button className="text-btn" onClick={() => router.push(`/r/${fixed.run.id}`)}>所属测试与再次测试<ChevronRight size={13}/></button></div>{fixed.run.spec.models.length > 1 && <div className="conversation-agent-tabs" aria-label="选择 Agent">{fixed.run.spec.models.map(m => {const slot=fixed.run.results.find(r => r.caseVersionId === fixed.case.versionId && r.profileId === m.id);return <button key={m.id} className={m.id === fixed.model.id ? "on" : ""} aria-pressed={m.id === fixed.model.id} onClick={() => router.push(slot?.attempt ? `/a/${slot.attempt.id}` : `/r/${fixed.run.id}`)}><AgentIcon agent={agentFor(m)} size={20}/><span>{agentName(m)}<small>{slot?.attempt?.reportedModel || m.modelName || m.model}</small></span></button>;})}</div>}<ResultColumn entry={fixed.case} model={fixed.model} result={fixed.result} fixedAttempt demo={fixed.run.spec.demo} notify={notify} copy={showCopy}/></> : <div className="page-loading">正在读取结果…</div>
        : isResults ? runError ? <Empty title="测试暂时无法打开" text={runError}/> : run ? <RunDetail key={run.id} run={run} refresh={reloadRun} notify={notify} copy={showCopy} created={r => { setRuns(old => [r, ...old.filter(x => x.id !== r.id)]); router.push(`/r/${r.id}`); }} rename={() => openRename(run)} requirements={c => setCaseEntry(c)} rerun={() => { sessionStorage.setItem('casebench.rerun-models', JSON.stringify(run.spec.models.map(m => ({ profileId: m.baseProfileId || m.id, model: m.model })))); setSelected(run.spec.cases.map(c => c.id).filter(id => cases.some(c => c.id === id))); router.push('/launch'); }}/>
        : runId ? <div className="page-loading"><LoaderCircle size={20} className="spin"/>正在读取测试…</div> : <Empty title="还没有测试记录" text="选择案例，开始第一批测试。记录和产物会自动保存在这里。" action={<button className="btn primary" onClick={() => router.push('/')}>去选案例</button>}/>
        : <CaseLibraryManager notify={notify} refresh={refresh} cases={cases} selected={selected} choose={choose} selectVisible={ids => setSelected(old => ids.every(id => old.includes(id)) ? old.filter(id => !ids.includes(id)) : [...new Set([...old, ...ids])])} open={setCaseEntry} create={() => setEdit('new')} favorite={c => void favorite(c)} favoriteBusy={favoriteBusy}/>}

      </main>
    </div>

    {shownCase && <ModalFrame title={shownCase.title} close={closeCase} className="case-dialog"><div className="detail-head"><h2>{shownCase.title}</h2><button className={`favorite-button ${shownCase.favorite ? 'on' : ''}`} aria-label="切换收藏" aria-pressed={!!shownCase.favorite} onClick={() => void favorite(shownCase)} disabled={!cases.some(c => c.id === shownCase.id)}><Star size={18} fill={shownCase.favorite ? 'currentColor' : 'none'}/></button><button className="icon-btn" aria-label="关闭案例详情" onClick={closeCase}><X size={20}/></button></div><div className="detail-body simple-case-detail"><section><h3>参考效果</h3><div className="detail-reference"><CaseCoverPreview entry={shownCase}/></div><div className="detail-section-heading"><h3>完整提示词</h3><button className="btn small" onClick={() => void showCopy(shownCase.prompt)}>复制</button></div><pre className="detail-prompt">{shownCase.prompt}</pre>{shownCase.inputs.length>0&&<><h3>输入附件</h3>{shownCase.inputs.map(f=><a className="file-link" key={f.id} href={'/api/files/'+f.id+'?download=1'}><FileText size={14}/>{f.name}<Download size={13}/></a>)}</>}</section></div><div className="detail-footer"><button className="btn" onClick={() => { const c = cases.find(c => c.id === shownCase.id); closeCase(); if (c) setEdit(c); }}>编辑案例</button><div className="top-spacer"/><button className="btn" onClick={() => choose(shownCase.id)}>{selected.includes(shownCase.id) ? '移出已选' : '加入已选'}</button><button className="btn primary" onClick={() => { setSelected([shownCase.id]); closeCase(); router.push('/launch'); }}>测试此案例</button></div></ModalFrame>}
    {rename && <ModalFrame title="重命名测试" close={() => { if (!metadataBusy) setRename(null); }} className="rename-dialog"><form onSubmit={e => { e.preventDefault(); if (renameValue.trim()) void updateRun(rename, { name: renameValue.trim() }); }}><h2>重命名测试</h2><label htmlFor="run-name-edit">测试名称</label><input id="run-name-edit" autoFocus required maxLength={100} value={renameValue} onChange={e => setRenameValue(e.target.value)}/><div className="dialog-actions"><button className="btn" type="button" disabled={metadataBusy} onClick={() => setRename(null)}>取消</button><button className="btn primary" disabled={metadataBusy || !renameValue.trim()} type="submit">{metadataBusy ? '保存中…' : '保存名称'}</button></div></form></ModalFrame>}
    {edit && <CaseEditor entry={edit === 'new' ? null : edit} close={() => setEdit(null)} saved={c => { setCases(old => [c, ...old.filter(x => x.id !== c.id)]); setEdit(null); notify('案例已保存，历史测试保留原版本'); }}/>} 
    {settings && <SettingsModal profiles={profiles} close={() => setSettings(false)} refresh={() => { void refresh(); notify('执行配置已重新读取'); }}/>} 
    {notice && <div className="toast" role="status">{notice}</div>}
  </WorkspaceFrame>;
}

export function RunDetail({ run, refresh, notify, copy, rename, requirements, rerun, created }: { run: RunRecord; refresh: () => Promise<void>; notify: (v: string) => void; copy: (t: string, success?: string) => Promise<void>; rename: () => void; requirements: (c: CaseRecord) => void; rerun: () => void; created: (run: RunRecord) => void }) {
  const [caseId, setCaseId] = useState(run.spec.cases[0]?.versionId || ''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [activeModel, setActiveModel] = useState(run.spec.models[0]?.id || ''), [retrying, setRetrying] = useState(false);
  const sessions = useLiveSessions(run);
  const filtered = run.spec.cases.filter(c => (!query || c.title.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || run.results.some(r => r.caseVersionId === c.versionId && (filter === 'failed' ? ['failed', 'timed_out', 'cancelled'].includes(r.status) : r.attempt?.status === 'succeeded' && !r.attempt.annotation.verdict))));
  const entry = filtered.find(c => c.versionId === caseId) || filtered[0];
  const models = run.spec.models.filter(m => m.id === activeModel);
  const activeAttempt = run.results.find(r => r.caseVersionId === entry?.versionId && r.profileId === activeModel)?.attempt;
  const visualOutput = !!entry && (entry.artifactType !== 'copy' || !!activeAttempt?.artifacts.some(f => f.mime === 'text/html' || /^(image|video)\//.test(f.mime)));
  const multipleCases = run.spec.cases.length > 1;
  async function retry(model: FrozenModel) {
    if (!entry || retrying) return; setRetrying(true);
    try {
      const currentCases = await api<CaseRecord[]>('cases');
      if (currentCases.find(c => c.id === entry.id)?.versionId !== entry.versionId) throw new Error('案例已更新，请使用“再次测试”确认最新要求后执行');
      const next = await api<RunRecord>('runs', { method: 'POST', body: JSON.stringify({ name: `${runName(run)} · 重试`, caseIds: [entry.id], models: [{ profileId: model.baseProfileId || model.id, ...(model.baseProfileId ? { model: model.model } : {}), ...(model.temperature !== undefined ? { temperature: model.temperature } : {}) }], concurrency: 1, timeoutSeconds: run.spec.timeoutSeconds, requestKey: crypto.randomUUID() }) });
      try { await api(`runs/${next.id}/${next.spec.demo ? 'demo' : 'start-local'}`, { method: 'POST', body: '{}' }); } catch (e) { notify(`新测试已保存：${(e as Error).message}`); }
      created(next);
    } catch (e) { notify((e as Error).message); } finally { setRetrying(false); }
  }
  function nextUnreviewed() { const next = run.spec.cases.find(c => c.versionId !== entry?.versionId && run.results.some(r => r.caseVersionId === c.versionId && r.attempt?.status === 'succeeded' && !r.attempt.annotation.verdict)); if (next) { setFilter('all'); setQuery(''); setCaseId(next.versionId); } else notify('没有其他未评审案例'); }
  return <div className={`conversation-run ${visualOutput ? 'visual-result' : 'text-result'}`}><header className="conversation-heading"><div><button className="run-title-button" onClick={rename} title="重命名测试"><h1>{runName(run)}</h1><Pencil size={14}/></button><p>{time(run.createdAt)} · {run.spec.cases.length} 个案例{run.spec.demo ? ' · 历史演示' : ''}</p></div><div className="conversation-heading-actions"><button className="btn" onClick={rerun}>再次测试</button><details className="conversation-menu"><summary className="btn" aria-label="测试更多操作"><MoreHorizontal size={18}/></summary><div><button onClick={rename}><Pencil size={14}/>重命名</button><button onClick={() => void copy(location.origin + `/r/${run.id}`, '测试链接已复制')}><Copy size={14}/>复制链接</button><a href={`/api/runs/${run.id}/export`}><Download size={14}/>下载全部产物</a><button onClick={() => void refresh()}><RefreshCw size={14}/>刷新进度</button></div></details></div></header><RunStartControl run={run} refresh={refresh} notify={notify}/><div className="result-reading-surface"><div className="conversation-toolbar">{multipleCases ? <><select aria-label="本次案例" value={entry?.versionId || ''} onChange={e => setCaseId(e.target.value)}>{filtered.length ? filtered.map(c => <option key={c.versionId} value={c.versionId}>{c.title}</option>) : <option value="">没有匹配案例</option>}</select><small>{entry ? run.spec.cases.findIndex(c => c.versionId === entry.versionId) + 1 : 0} / {run.spec.cases.length}</small></> : <strong className="single-case-title">{entry?.title}</strong>}{entry && <button className="text-btn case-requirements-button" onClick={() => requirements(entry)}>查看案例要求<ChevronRight size={13}/></button>}{multipleCases && <details className="conversation-filter"><summary className="text-btn"><Search size={14}/>{query || filter !== 'all' ? '筛选中' : '筛选案例'}</summary><div><input aria-label="搜索本次案例" placeholder="搜索案例…" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="案例评审筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部案例</option><option value="unreviewed">未评审</option><option value="failed">执行失败</option></select></div></details>}</div>{entry ? <>{run.spec.models.length > 1 && <div className="conversation-agent-tabs" aria-label="选择 Agent">{run.spec.models.map(m => <button key={m.id} className={activeModel === m.id ? 'on' : ''} aria-pressed={activeModel === m.id} onClick={() => setActiveModel(m.id)}><AgentIcon agent={agentFor(m)} size={20}/><span>{agentName(m)}<small>{run.results.find(r => r.caseVersionId === entry.versionId && r.profileId === m.id)?.attempt?.reportedModel || (m.model === 'default' ? '默认模型' : m.modelName||m.model)}</small></span></button>)}</div>}<div className="conversation-responses">{models.map(m => { const result = run.results.find(r => r.caseVersionId === entry.versionId && r.profileId === m.id); return <ResultColumn key={`${entry.versionId}-${m.id}`} entry={entry} model={m} result={result} live={sessions.find(s => s.resultId === result?.id)} demo={run.spec.demo} notify={notify} copy={copy} retry={run.spec.demo || ['gpt','workbuddy','deepseek','minimax'].includes(agentFor(m)) ? () => void retry(m) : undefined} retrying={retrying}/>; })}</div>{run.spec.cases.length > 1 && <div className="next-review"><button className="text-btn" onClick={nextUnreviewed}>下一个未评审<ArrowRight size={13}/></button></div>}</> : <Empty title="没有符合筛选的案例" text="切换到全部案例，或清空搜索。" action={<button className="btn" onClick={() => { setQuery(''); setFilter('all'); }}>查看全部案例</button>}/>}</div></div>;
}


function FilterGroup({ title, values, selected, setSelected, cases, countFor }: { title: string; values: Record<string, string>; selected: string; setSelected: (v: string) => void; cases: CaseRecord[]; countFor: (c: CaseRecord, k: string) => boolean }) {
  return <section className="filter-group"><h2>{title}</h2><button className={!selected ? 'on' : ''} onClick={() => setSelected('')}><span>全部</span><small>{cases.length}</small></button>{Object.entries(values).map(([k, label]) => <button className={selected === k ? 'on' : ''} key={k} onClick={() => setSelected(selected === k ? '' : k)}><span>{label}</span><small>{cases.filter(c => countFor(c, k)).length}</small></button>)}</section>;
}
function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon"><FolderOpen size={27} strokeWidth={1.4}/></span><h2>{title}</h2><p>{text}</p>{action}</div>; }
function AgentIcon({ agent, size = 32 }: { agent: string; size?: number }) {
  if (agent === 'deepseek' || agent === 'minimax') return <img className="agent-icon" src={`/agents/${agent}.png`} alt={agent === 'deepseek' ? 'DeepSeek Harness' : 'MiniMax Code'} width={size} height={size}/>;
  if (agent === 'gpt') return <span className="agent-icon openai-icon" style={{ width: size, height: size }} role="img" aria-label="OpenAI"><img src="/agents/openai-blossom-black.svg" alt=""/></span>;
  return agent === 'workbuddy' ? <span className="agent-icon workbuddy-icon" style={{ width: size, height: size }} role="img" aria-label="WorkBuddy"><span className="workbuddy-mask"><img src="/agents/workbuddy-art.svg" alt=""/></span></span> : agent === 'kimi' ? <img className="agent-icon" src="/agents/kimi.png" alt="Kimi Code" width={size} height={size}/> : <span className="agent-icon generic-agent" style={{ width: size, height: size }}><Terminal size={18}/></span>;
}
function agentFor(model: Profile) { if(model.agentId)return model.agentId; const id = model.id; return /chatgpt|codex|gpt/i.test(id + model.vendor) ? 'gpt' : /workbuddy/i.test(id + model.vendor) ? 'workbuddy' : /kimi/i.test(id + model.vendor) ? 'kimi' : 'other'; }
function agentName(model: Profile) { const key = agentFor(model); if(key==='deepseek')return 'DeepSeek Harness'; if(key==='minimax')return 'MiniMax Code'; return key === 'gpt' ? 'GPT 桌面端' : key === 'workbuddy' ? 'WorkBuddy' : key === 'kimi' ? 'Kimi Code' : model.name; }
export function Launch({ cases, profiles, remove, notify, created, back, settings }: { cases: CaseRecord[]; profiles: Profile[]; remove: (id: string) => void; notify: (v: string) => void; created: (run: RunRecord) => void; back: () => void; settings: () => void }) {
  const {articleId,setArticleId,articles}=useLibraryArticleFilter();
  const [agents, setAgents] = useState<AgentCatalog[]>([]), [loadingAgents, setLoadingAgents] = useState(true), [catalogError, setCatalogError] = useState('');
  const [configs, setConfigs] = useState<{ key: string; profileId: string; model: string }[]>([]), [name, setName] = useWorkspaceMemory('launch.name',''), [concurrency, setConcurrency] = useWorkspaceMemory('launch.concurrency',1), [timeoutSeconds, setTimeoutSeconds] = useWorkspaceMemory<number|null>('launch.timeoutSeconds.v2',null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [picker, setPicker] = useState<string | null>(null), [family, setFamily] = useState(''), [search, setSearch] = useState('');
  const requestKey = useRef<{ payload: string; key: string } | null>(null), seeded = useRef(false);
  const loadAgents = useCallback(async (force = false) => { setLoadingAgents(true); setCatalogError(''); try { setAgents(await api<AgentCatalog[]>(force ? 'agents?refresh=1' : 'agents')); } catch (e) { setCatalogError((e as Error).message); } finally { setLoadingAgents(false); } }, []);
  useEffect(() => { void loadAgents(); }, [loadAgents]);
  useEffect(() => {
    if (loadingAgents || catalogError || seeded.current) return;
    seeded.current = true;
    try {
      const rerun = sessionStorage.getItem('casebench.rerun-models');
      if (rerun) {
        sessionStorage.removeItem('casebench.rerun-models');
        const saved: { profileId: string; model: string }[] = JSON.parse(rerun);
        const restored = Array.isArray(saved) ? saved.filter(c => c && typeof c.profileId === 'string' && typeof c.model === 'string' && agents.some(a => a.profileId === c.profileId)).slice(0, 3) : [];
        setConfigs(restored.map(c => ({ ...c, key: crypto.randomUUID() })));
        setSelectedProfiles([...new Set(restored.map(c => c.profileId))]);
      } else {
        const saved = JSON.parse(sessionStorage.getItem('casebench.agent-draft') || 'null');
        if (saved && Array.isArray(saved.configs) && Array.isArray(saved.selectedProfiles)) {
          const restored = saved.configs.filter((c: { profileId?: unknown; model?: unknown }) => c && typeof c.profileId === 'string' && typeof c.model === 'string' && agents.some(a => a.profileId === c.profileId));
          setConfigs(restored.map((c: { profileId: string; model: string }) => ({ ...c, key: crypto.randomUUID() })));
          setSelectedProfiles(saved.selectedProfiles.filter((id: unknown) => typeof id === 'string' && restored.some((c: { profileId: string }) => c.profileId === id)));
        }
      }
    } catch {}
  }, [agents, loadingAgents, catalogError]);
  useEffect(() => {
    if (!seeded.current) return;
    try { sessionStorage.setItem('casebench.agent-draft', JSON.stringify({ configs: configs.map(({ profileId, model }) => ({ profileId, model })), selectedProfiles })); } catch {}
  }, [configs, selectedProfiles]);
  const activeConfigs = configs.filter(c => selectedProfiles.includes(c.profileId));
  function toggleAgent(agent: AgentCatalog) {
    const profileId = agent.profileId; if (!profileId) return;
    if (selectedProfiles.includes(profileId)) { setSelectedProfiles(ids => ids.filter(id => id !== profileId)); setPicker(null); return; }
    if (!agent.ready || activeConfigs.length >= 3 || !agent.models.length) return;
    const existing = configs.filter(c => c.profileId === profileId && agent.models.some(m => m.id === c.model && m.available!==false));
    const model = agent.models.find(m => m.isDefault && m.available!==false) || agent.models.find(m=>m.available!==false);if(!model)return;
    const next = (existing.length ? existing : [{ key: crypto.randomUUID(), profileId, model: model.id }]).slice(0, 3 - activeConfigs.length);
    setConfigs(old => [...old.filter(c => c.profileId !== profileId), ...next]); setSelectedProfiles(ids => [...ids, profileId]);
  }
  const activeConfig = configs.find(c => c.key === picker), activeAgent = agents.find(a => a.profileId === activeConfig?.profileId);
  const unsupported = cases.filter(c => !activeConfigs.every(v => { const p = profiles.find(p => p.id === v.profileId); return p?.modes.includes(c.executionMode) && !(['chatgpt-session','workbuddy-session','deepseek-session','minimax-session'].includes(v.profileId) && (c.inputs.length > 0 || !(['copy','web'].includes(c.artifactType)&&['text','html'].includes(c.executionMode)))); }));
  const valid = !loadingAgents && !catalogError && activeConfigs.length > 0 && activeConfigs.length <= 3 && activeConfigs.every(c => agents.some(a => a.ready && a.profileId === c.profileId && a.models.some(m => m.id === c.model && m.available!==false)));
  async function create() {
    if (busy) return; setBusy(true); setError('');
    try {
      if (!cases.length) throw new Error('请先从案例库选择测试案例');
      if (!valid || unsupported.length) throw new Error('请确认案例与 Agent 的支持范围，并选择可用模型');
      const payload = { ...(articleId?{articleId}:{}),name: name.trim(), caseIds: cases.map(c => c.id), models: activeConfigs.map(c => ({ profileId: c.profileId, model: c.model })), concurrency, timeoutSeconds };
      const signature = JSON.stringify(payload); if (requestKey.current?.payload !== signature) requestKey.current = { payload: signature, key: crypto.randomUUID() };
      const run = await api<RunRecord>('runs', { method: 'POST', body: JSON.stringify({ ...payload, requestKey: requestKey.current.key }) });
      try { await api(`runs/${run.id}/start-local`, { method: 'POST', body: '{}' }); notify('本地任务已启动，进度会自动同步'); } catch (e) { notify(`测试已保存：${(e as Error).message}。可在结果页重新启动。`); }
      created(run);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const caseSelection=<SecondaryContent><div className="launch-context"><div className="context-section-head"><strong>已选案例 <span>{cases.length}</span></strong><button className="context-icon" aria-label="从案例库添加" onClick={back}><Plus size={15}/></button></div><div className="context-scroll">{!cases.length&&<button className="btn small" onClick={back}><Plus size={14}/>从案例库选择</button>}{cases.map(c=><div className="launch-case-item" key={c.id}><span><strong>{c.title}</strong><small>{ARTIFACT_TYPES[c.artifactType]}</small></span><button className="context-icon" aria-label={`移除${c.title}`} onClick={()=>remove(c.id)}><X size={14}/></button></div>)}</div></div></SecondaryContent>;
  return <div className="agent-launch">{caseSelection}<header className="page-action-bar"><strong>发起测试</strong><LibraryArticleFilter value={articleId} change={setArticleId} articles={articles}/></header><h1 className="sr-only">发起测试</h1><div className="agent-launch-grid"><div className="launch-left-column"><section className="run-settings"><h2>运行设置</h2><div className="settings-row"><div className="field"><label htmlFor="test-name">测试名称</label><input id="test-name" maxLength={100} placeholder="留空自动命名" value={name} onChange={e => setName(e.target.value)}/></div><div className="field"><label htmlFor="agent-concurrency">并发任务</label><select id="agent-concurrency" value={concurrency} onChange={e => setConcurrency(Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}</select></div><details className="launch-advanced"><summary>高级设置</summary><div className="field"><label htmlFor="agent-timeout">任务时限</label><select id="agent-timeout" value={timeoutSeconds??0} onChange={e => setTimeoutSeconds(Number(e.target.value)||null)}><option value="0">不限时</option>{[600,1800,3600,7200,14400].map(n=><option key={n} value={n}>{n/60} 分钟</option>)}</select></div></details></div></section></div><section className="agent-configurations"><div className="section-title"><h2>Agent 配置</h2><button className="text-btn" onClick={() => void loadAgents(true)} disabled={loadingAgents}>{loadingAgents ? '正在读取…' : '刷新连接'}</button></div>{loadingAgents && !agents.length && <div className="agent-loading"><LoaderCircle className="spin" size={16}/>正在读取本地 Agent 与模型…</div>}{catalogError && <div className="alert error" role="alert">{catalogError}<button onClick={() => void loadAgents(true)}>重试</button></div>}{agents.map(agent => {
    const chosen = !!agent.profileId && selectedProfiles.includes(agent.profileId), rows = configs.filter(c => c.profileId === agent.profileId);
    const selectable = chosen || (agent.ready && !!agent.profileId && agent.models.some(m=>m.available!==false) && activeConfigs.length < 3);
    return <section className={`agent-config-card ${agent.ready ? 'ready' : 'pending'} ${chosen ? 'is-selected' : ''}`} key={agent.id}>
      <label className="agent-identity agent-participation"><input type="checkbox" aria-label={`使用${agent.name}执行测试`} checked={chosen} disabled={busy || !selectable} onChange={() => toggleAgent(agent)}/><AgentIcon agent={agent.id}/><div><strong>{agent.name}</strong><small className="agent-card-description" title={agent.detail}>{agent.ready ? `${chosen ? '参与本次测试' : `${agent.models.length} 个可选模型`} · ${agent.detail}` : agent.detail}</small></div><span className={agent.ready ? 'connected' : 'muted'}>{agent.ready ? '已连接' : agent.state === 'not_installed' ? '未安装' : agent.state === 'not_logged_in' ? '未登录' : agent.state === 'unsupported' ? '待接入协议' : '连接异常'}</span></label>
      {chosen && <><div className="agent-model-configs">{rows.map(c => <div className="agent-model-config" key={c.key}><label>模型</label><div><button className="btn model-picker-button" disabled={busy || !agent.ready} aria-label={`${agent.name}选择模型 ${agent.models.find(m=>m.id===c.model)?.name||c.model}`} onClick={() => { setPicker(c.key); setFamily(''); setSearch(''); }}><span>{agent.models.find(m=>m.id===c.model)?.name||c.model}</span><ChevronRight size={15}/></button><button className="btn small remove-model" disabled={busy || rows.length === 1} aria-label={`移除模型${c.model}`} title={rows.length === 1 ? '至少保留一个模型；取消勾选可停用此 Agent' : '移除此模型配置'} onClick={() => setConfigs(old => old.filter(v => v.key !== c.key))}>移除</button></div></div>)}</div>
      <button className="btn small add-model" disabled={busy || !agent.ready || activeConfigs.length >= 3 || agent.models.every(m => m.available===false||rows.some(c => c.model === m.id))} onClick={() => { const m = agent.models.find(m => m.available!==false&&!rows.some(c => c.model === m.id)); if (m && agent.profileId) setConfigs(old => [...old, { key: crypto.randomUUID(), profileId: agent.profileId!, model: m.id }]); }}><Plus size={14}/>添加另一模型</button>
      {(!agent.ready || rows.some(c => !agent.models.some(m => m.id === c.model))) && <p className="error-text agent-config-hint" role="alert">请刷新连接并确认可用模型后开始。</p>}</>}
      {agent.installed && !agent.ready && <details className="agent-discovery-details"><summary>安装与模型信息</summary><p>版本：{agent.version || '未知'} · {agent.detail}</p>{agent.models.length > 0 && <><p>以下型号来自已安装程序的目录，登录与执行权限尚未确认。</p><div>{agent.models.map(m => <span key={m.id}>{m.name}</span>)}</div></>}</details>}
      {!agent.ready && <button className="text-btn connection-help" onClick={settings}>查看连接说明</button>}
    </section>;
  })}</section></div>{unsupported.length > 0 && <div className="agent-compatibility" role="status"><strong>当前 Agent 暂不支持 {unsupported.length} 个已选案例</strong><p>目前本地持续任务支持无附件文案与网页。{unsupported.map(c => c.title).join('、')}需要附件或其他产物能力，请移除这些案例后开始。</p></div>}<div className="agent-launch-action"><div className="execution-summary" aria-live="polite">{activeConfigs.length ? <><strong>已选 {agents.filter(a => a.profileId && selectedProfiles.includes(a.profileId)).map(a => `${a.name}：${activeConfigs.filter(c => c.profileId === a.profileId).map(c => a.models.find(m=>m.id===c.model)?.name||c.model).join('、')}`).join('；')}</strong><span>{cases.length} 个案例 × {activeConfigs.length} 个模型 = {cases.length * activeConfigs.length} 个任务</span></> : <><strong>尚未选择执行 Agent</strong></>}</div><button className="btn primary" disabled={busy || !cases.length || !valid || unsupported.length > 0} onClick={() => void create()}>{busy && <LoaderCircle size={15} className="spin"/>}{busy ? '正在启动…' : '开始测试'}</button></div>{error && <div className="alert error" role="alert">{error}</div>}{activeConfig && activeAgent && <ModalFrame title="选择模型" close={() => setPicker(null)} className="agent-model-dialog"><div className="detail-head"><h2>选择 {activeAgent.name} 模型</h2><button className="icon-btn" aria-label="关闭模型选择" onClick={() => setPicker(null)}><X size={19}/></button></div><div className="model-dialog-body"><div className="agent-identity"><AgentIcon agent={activeAgent.id}/><div><strong>{activeAgent.name}</strong><small>当前执行配置 · 型号由本地 Agent 返回</small></div></div><label className="test-search"><Search size={15}/><input autoFocus placeholder="搜索型号…" aria-label="搜索模型" value={search} onChange={e => setSearch(e.target.value)}/></label><div className="model-family-tabs"><button className={!family ? 'on' : ''} onClick={() => setFamily('')}>全部</button>{[...new Set(activeAgent.models.map(m => m.family))].sort().map(f => <button key={f} className={family === f ? 'on' : ''} onClick={() => setFamily(f)}>{f === '其他' ? f : `${f} 系列`}</button>)}</div><div className="model-option-list">{activeAgent.models.filter(m => (!family || m.family === family) && `${m.id} ${m.name}`.toLowerCase().includes(search.toLowerCase())).map(m => { const duplicate = configs.some(c => c.key !== activeConfig.key && c.profileId === activeConfig.profileId && c.model === m.id); return <button key={m.id} className={`model-choice ${m.id === activeConfig.model ? 'selected' : ''}`} disabled={duplicate || m.available===false} onClick={() => { setConfigs(old => old.map(c => c.key === activeConfig.key ? { ...c, model: m.id } : c)); setPicker(null); }}><div><strong>{m.name}</strong><small>{m.detail || (duplicate ? '已在其他执行配置中选择' : m.isDefault ? '推荐模型' : `${m.family} 系列`)}</small></div>{m.id === activeConfig.model && <Check size={17}/>}</button>; })}{!activeAgent.models.some(m => (!family || m.family === family) && `${m.id} ${m.name}`.toLowerCase().includes(search.toLowerCase())) && <p className="muted">没有匹配型号</p>}</div><p className="field-hint">列表来自当前 Agent 的模型目录，实际权限以启动时校验为准。</p></div></ModalFrame>}</div>;
}

type LiveSession = { usage?: AttemptRecord['usage']; activeDurationMs?: number; resultId: string; profileId: string; threadId: string | null; phase: string; model: string | null; updatedAt: string; events: { at: string; text: string }[]; outputText: string };
function useLiveSessions(run: RunRecord) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const terminal = ['completed', 'partial_failed', 'failed', 'cancelled'].includes(run.status);
  useEffect(() => { if (run.spec.demo) return; let disposed = false, busy = false; const load = async () => { if (busy) return; busy = true; try { const next = await api<LiveSession[]>(`runs/${run.id}/live`); if (!disposed) setSessions(next); } catch {} finally { busy = false; } }; void load(); const timer = terminal ? undefined : setInterval(() => void load(), 1500); return () => { disposed = true; clearInterval(timer); }; }, [run.id, terminal, run.spec.demo]);
  return sessions;
}
function RunStartControl({ run, refresh, notify }: { run: RunRecord; refresh: () => Promise<void>; notify: (v: string) => void }) {
  const [starting, setStarting] = useState(false);
  if ((!run.spec.demo && run.spec.models.some(m => !['gpt','workbuddy','deepseek','minimax'].includes(agentFor(m)))) || !run.results.some(r => r.status === 'pending') || run.results.some(r => r.status === 'running' || r.status === 'uploading')) return null;
  async function start() { setStarting(true); try { await api(`runs/${run.id}/${run.spec.demo ? 'demo' : 'start-local'}`, { method: 'POST', body: '{}' }); await refresh(); notify('本地任务已启动'); } catch (e) { notify((e as Error).message); } finally { setStarting(false); } }
  return <div className="pending-run-action"><span>待执行的任务尚未启动</span><button className="btn small" disabled={starting} onClick={() => void start()}>{starting ? '正在连接…' : '启动本地任务'}</button></div>;
}
function ResultColumn({ entry, model, result, live, demo, notify, copy, retry, retrying, fixedAttempt = false }: { entry: CaseRecord; model: FrozenModel; result?: ResultRecord; live?: LiveSession; demo: boolean; notify: (v: string) => void; copy: (text: string, success?: string) => Promise<void>; retry?: () => void; retrying?: boolean; fixedAttempt?: boolean }) {
  const initial = result?.attempt;
  const conversation = useConversation(initial, !demo && ['gpt','workbuddy','deepseek','minimax'].includes(agentFor(model)));
  useEffect(() => { if (fixedAttempt && conversation.record && initial) conversation.setSelectedId(initial.id); }, [fixedAttempt, conversation.record?.id, initial?.id]);
  const a = conversation.selected?.attempt || initial;
  const state = a?.status || result?.status || 'pending', running = ['pending', 'running', 'uploading'].includes(state), failed = ['failed', 'timed_out', 'cancelled'].includes(state);
  const [inspector, setInspector] = useState<InspectorTab | null>(null), [reviewOpen, setReviewOpen] = useState(false);
  const isInitial = !conversation.selected || conversation.selected.number === 1;
  const text = running && isInitial ? live?.outputText || a?.outputText || '' : a?.outputText || '';
  const displayResult = result && a ? { ...result, status: a.status, attempt: a } : result;
  const reported = a?.reportedModel || live?.model || (model.model === 'default' ? 'Agent 默认模型' : `请求：${model.modelName||model.model}`);
  return <section className="result-column chat-response"><header className="result-column-head"><AgentIcon agent={agentFor(model)}/><div><div className="agent-output-name"><strong>{agentName(model)}</strong><span className={`output-status ${state}`}>{statusLabels[state] || state}</span></div><small>{reported}{demo ? ' · 历史演示' : ''}</small></div></header><ConversationSummary controller={conversation} attempt={a} liveUsage={running && isInitial ? live?.usage : undefined} liveDuration={running && isInitial ? live?.activeDurationMs : undefined} onInspect={() => setInspector('files')}/><div className="unified-artifact-surface">{a && !running && <div className="unified-artifact-label"><strong>{a.artifacts.find(f => !f.name.endsWith('session.json'))?.name || '生成结果'}</strong><small>当前选中产物 · {conversation.selected ? `第 ${conversation.selected.number} 轮` : '首轮'}</small></div>}{conversation.history && conversation.record ? <ConversationTranscript record={conversation.record}/> : running ? <><div className="inline-progress" role="status"><LoaderCircle size={15} className="spin"/><span>{live?.events.at(-1)?.text || (state === 'pending' ? '等待本地任务启动…' : '正在等待 Agent 返回…')}</span></div>{text && <pre className="artifact-text live-artifact" aria-label="实时正文">{text}</pre>}{a && isInitial && ['gpt','workbuddy','deepseek','minimax'].includes(agentFor(model)) && <button className="btn small" onClick={() => { void api(`attempts/${a!.id}/stop`, { method: 'POST', body: '{}' }).then(() => notify('停止请求已发送')).catch(e => notify(e.message)); }}>停止执行</button>}</> : <>{a && (a.outputText || a.artifacts.length > 0) && <ArtifactPreview attempt={a}/ >}{failed && <div className="inline-failure"><strong>{state === 'timed_out' ? '任务超时' : state === 'cancelled' ? '任务已取消' : '任务暂时中断'}</strong><p>{state === 'timed_out' ? 'Agent 未在设定时间内完成，可以重试或增加超时时间。' : '这次执行没有顺利完成。原始记录已保留，可查看原因后重试。'}</p><div>{retry && <button className="btn primary small" disabled={retrying} onClick={retry}>{retrying ? '正在创建…' : '重试此任务'}</button>}<button className="btn small" onClick={() => setInspector('logs')}>查看原因</button></div></div>}{a && !failed && !a.outputText && !a.artifacts.length && <p className="field-hint">本次没有返回正文或产物文件。</p>}</>}{a?.annotation.note && <div className="unified-result-note"><strong>结果说明</strong><p>{a.annotation.note}</p></div>}<div className="result-actions">{text && <button className="btn" onClick={() => void copy(text, '正文已复制')}><Copy size={13}/>复制</button>}{a?.status === 'succeeded' && <button className="btn" aria-haspopup="dialog" onClick={() => setReviewOpen(true)}>产物评审{a.annotation.verdict && <span className={`review-verdict ${a.annotation.verdict}`}>{verdictLabels[a.annotation.verdict]}</span>}</button>}{a?.status === 'succeeded' && <QuoteInstanceButton id={a.id} notify={notify}/>}</div></div><ConversationComposer controller={conversation}/>{reviewOpen && a && <ModalFrame title="产物评审" close={() => setReviewOpen(false)} className="artifact-review-dialog"><div className="detail-head"><h2>产物评审</h2><button className="icon-btn" aria-label="关闭产物评审" onClick={() => setReviewOpen(false)}><X size={20}/></button></div><div className="review-dialog-body"><AnnotationEditor key={a.id} attempt={a} notify={notify}/></div></ModalFrame>}{inspector && <ExecutionInspector entry={entry} model={model} result={displayResult} live={live} initialTab={inspector} close={() => setInspector(null)} copy={copy}/>}</section>;
}

type InspectorTab = 'overview' | 'files' | 'logs';
function ExecutionInspector({ entry, model, result, live, initialTab, close, copy }: { entry: CaseRecord; model: FrozenModel; result?: ResultRecord; live?: LiveSession; initialTab: InspectorTab; close: () => void; copy: (text: string, success?: string) => Promise<void> }) {
  const [tab, setTab] = useState<InspectorTab>(initialTab), id = useId();
  const a = result?.attempt, state = result?.status || 'pending';
  const failed = ['failed', 'timed_out', 'cancelled'].includes(state);
  const reported = a?.reportedModel || live?.model || (model.model === 'default' ? 'Agent 默认模型' : `请求：${model.modelName||model.model}`);
  const tabs: { key: InspectorTab; label: string }[] = [{ key: 'overview', label: '概览' }, { key: 'files', label: '产物文件' }, { key: 'logs', label: '运行日志' }];
  const files = a?.artifacts.filter(f => !f.name.endsWith('session.json')) || [], metadata = a?.artifacts.filter(f => f.name.endsWith('session.json')) || [];
  function fileRows(items: FileRecord[]) { return items.map(f => <a className="inspector-file" href={`/api/files/${f.id}?download=1`} key={f.id}><FileText size={19}/><span><strong>{f.name}</strong><small>{f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`}</small></span><Download size={16}/><span className="sr-only">下载</span></a>); }
  return <ModalFrame title="文件与执行记录" close={close} className="execution-inspector"><header className="inspector-heading"><div><h2>文件与执行记录</h2><p>{entry.title}</p></div><button className="icon-btn" aria-label="关闭文件与执行记录" onClick={close}><X size={20}/></button></header><div className="inspector-tabs" role="tablist" aria-label="执行信息分类">{tabs.map((t, index) => <button key={t.key} role="tab" id={`${id}-${t.key}`} aria-controls={`${id}-panel`} aria-selected={tab === t.key} tabIndex={tab === t.key ? 0 : -1} onClick={() => setTab(t.key)} onKeyDown={e => { let next = index; if (e.key === 'ArrowRight') next = (index + 1) % 3; else if (e.key === 'ArrowLeft') next = (index + 2) % 3; else if (e.key === 'Home') next = 0; else if (e.key === 'End') next = 2; else return; e.preventDefault(); setTab(tabs[next].key); document.getElementById(`${id}-${tabs[next].key}`)?.focus(); }}>{t.label}</button>)}</div><div className="inspector-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
    {tab === 'overview' && <>{agentFor(model)==='gpt' && live?.threadId && <a className="btn inspector-desktop-link" href={`codex://threads/${live.threadId}`}>打开桌面任务<ExternalLink size={13}/></a>}<div className={`inspector-status ${failed ? 'failed' : ''}`}><strong>{statusLabels[state] || state}</strong><p>{failed ? '本次任务未完成，请在日志中查看原因。' : state === 'succeeded' ? '产物已归档，可复制或下载。' : live?.events.at(-1)?.text || '正在等待本地 Agent 返回。'}</p></div><div className="inspector-metrics"><div><span>执行耗时</span><strong>{duration(a?.metadata?.activeDurationMs ?? a?.durationMs)}</strong></div><div><span>输入 Token</span><strong>{usage(a?.usage.inputTokens)}</strong></div><div><span>输出 Token</span><strong>{usage(a?.usage.outputTokens)}</strong></div></div><section className="inspector-section"><h3>执行信息</h3><dl><div><dt>实际模型</dt><dd>{reported}</dd></div><div><dt>开始时间</dt><dd>{a ? time(a.startedAt) : '—'}</dd></div><div><dt>结束时间</dt><dd>{a?.finishedAt ? time(a.finishedAt) : '—'}</dd></div><div><dt>案例版本</dt><dd>v{entry.version}</dd></div><div><dt>成本</dt><dd>{a?.usage.cost === null || a?.usage.cost === undefined ? '未知' : `${a.usage.currency || ''} ${a.usage.cost}`}</dd></div></dl></section><details className="inspector-secondary"><summary>参数与标识</summary><dl><div><dt>请求模型</dt><dd>{model.model}</dd></div><div><dt>适配器</dt><dd>{a?.adapterVersion || '—'}</dd></div><div><dt>执行标识</dt><dd>{a?.id || result?.id || '—'}</dd></div><div><dt>用量来源</dt><dd>{a?.usage.source === 'reported' ? 'Agent 返回' : '未提供'}</dd></div></dl>{model.parameters && <pre>{JSON.stringify(model.parameters, null, 2)}</pre>}{a && <button className="text-btn" onClick={() => void copy(location.origin + `/a/${a.id}`, '固定结果链接已复制')}>复制固定结果链接</button>}</details></>}
    {tab === 'files' && <><section className="inspector-section"><h3>产物文件 <small>{files.length}</small></h3>{files.length ? fileRows(files) : <p className="inspector-empty">{state === 'succeeded' ? '本次没有返回产物文件。' : '产物文件将在任务完成后显示。'}</p>}</section>{agentFor(model)==='gpt' && live?.threadId && <a className="btn inspector-desktop-link" href={`codex://threads/${live.threadId}`}>打开桌面任务<ExternalLink size={13}/></a>}{metadata.length > 0 && <section className="inspector-section"><h3>执行元信息</h3>{fileRows(metadata)}<p className="field-hint">供追溯执行记录使用。</p></section>}</>}
    {tab === 'logs' && <><section className="inspector-section"><h3>执行时间线</h3>{live?.events.length ? <ol className="inspector-timeline">{live.events.map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}</time><p>{event.text}</p></li>)}</ol> : <p className="inspector-empty">当前记录没有过程事件。</p>}</section>{a?.error && <section className="inspector-section inspector-error"><h3>错误信息</h3><pre>{a.error}</pre></section>}<details className="inspector-secondary raw-execution-log"><summary>原始日志</summary><pre>{a?.logs || '没有额外日志'}</pre>{a?.logs && <button className="text-btn" onClick={() => void copy(a.logs, '日志已复制')}>复制日志</button>}</details></>}
  </div></ModalFrame>;
}

function AnnotationEditor({ attempt, notify }: { attempt: AttemptRecord; notify: (v: string) => void }) {
  const [draft, setDraft] = useState({ verdict: attempt.annotation.verdict, note: attempt.annotation.note });
  const [saveState, setSaveState] = useState('已保存'), [meta, setMeta] = useState(attempt.annotation);
  const revision = useRef(attempt.annotation.revision), timer = useRef<ReturnType<typeof setTimeout> | null>(null), dirty = useRef(false), blocked = useRef(false), latest = useRef(draft), queue = useRef(Promise.resolve());
  const persist = useCallback((value: { verdict: Verdict; note: string }) => {
    if (blocked.current) return;
    queue.current = queue.current.then(async () => {
      if (blocked.current) return;
      try {
        const updated = await api<Annotation>(`attempts/${attempt.id}/annotation`, { method: 'PATCH', body: JSON.stringify({ ...value, revision: revision.current }) });
        revision.current = updated.revision; setMeta(updated);
        if (JSON.stringify(latest.current) === JSON.stringify(value)) { dirty.current = false; setSaveState('已保存'); }
      } catch (e) { blocked.current = true; setSaveState('保存失败，请重新载入'); notify((e as Error).message); }
    });
  }, [attempt.id, notify]);
  function change(value: { verdict: Verdict; note: string }) {
    setDraft(value); latest.current = value; dirty.current = true; setSaveState('保存中…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; persist(value); }, 600);
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; if (dirty.current) persist(latest.current); } }, [persist]);
  useEffect(() => {
    if (!dirty.current && attempt.annotation.revision > revision.current) {
      revision.current = attempt.annotation.revision; setMeta(attempt.annotation);
      const value = { verdict: attempt.annotation.verdict, note: attempt.annotation.note }; setDraft(value); latest.current = value;
    }
  }, [attempt.annotation]);
  async function reload() {
    try { const data = await api<FixedResult>(`attempts/${attempt.id}`), a = data.result.attempt!.annotation;
      if (timer.current) clearTimeout(timer.current); timer.current = null;
      revision.current = a.revision; blocked.current = false; dirty.current = false;
      const value = { verdict: a.verdict, note: a.note }; latest.current = value; setDraft(value); setMeta(a); setSaveState('已保存');
    } catch (e) { notify((e as Error).message); }
  }
  return <div className="annotation"><div className="review-row"><span>这份产物如何？</span><div className="verdict-buttons">{(['usable', 'pending', 'unusable'] as const).map(v => <button key={v} className={`${v} ${draft.verdict === v ? 'on' : ''}`} onClick={() => change({ ...latest.current, verdict: latest.current.verdict === v ? null : v })}>{draft.verdict === v && <Check size={12}/>} {verdictLabels[v]}</button>)}</div></div><details className="review-note" open><summary>评审备注{draft.note ? ' · 已记录' : ''}</summary><label className="note-label" htmlFor={`note-${attempt.id}`}>一句话备注 <span>写文章的人会看到</span></label><textarea id={`note-${attempt.id}`} maxLength={5000} value={draft.note} placeholder="记录可以直接取用的部分，或需要留意的问题…" onChange={e => change({ ...latest.current, note: e.target.value })}/><div className="save-state"><span className={saveState.startsWith('保存失败') ? 'error-text' : ''}>{saveState === '已保存' && <Check size={11}/>} {saveState}</span>{saveState.startsWith('保存失败') ? <button onClick={() => void reload()}>重新载入</button> : meta.revision > 0 && <small>{time(meta.updatedAt)} · {meta.updatedBy}</small>}</div></details>{attempt.audit.length > 0 && <details className="audit-details"><summary>修改痕迹 · {attempt.audit.length} 条</summary>{attempt.audit.slice(0, 10).map((e, i) => <p key={i}>{time(e.at)} · {e.by} · {labelVerdict(e.verdict)}{e.note && <span>{e.note}</span>}</p>)}</details>}</div>;
}
function Materials({ query, profiles, notify, open }: { query: string; profiles: Profile[]; notify: (v: string) => void; open: (id: string) => void }) {
  const [verdict, setVerdict] = useState('usable'), [model, setModel] = useState(''), [items, setItems] = useState<SearchItem[]>([]), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true);
    const timer = setTimeout(() => api<SearchItem[]>(`search?q=${encodeURIComponent(query)}&verdict=${verdict}&profile=${encodeURIComponent(model)}`).then(data => { if (active) setItems(data); }).catch(e => { if (active) notify(e.message); }).finally(() => { if (active) setLoading(false); }), 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, verdict, model, notify]);
  return <><div className="page-heading"><div><div className="eyebrow">跨运行检索与取用</div><h1>找素材</h1><p>从过去的提示词、实际正文和备注中，找到可引用的结果。</p></div></div><div className="material-filters"><select aria-label="按判定筛选" value={verdict} onChange={e => setVerdict(e.target.value)}><option value="usable">可用素材</option><option value="unreviewed">未评审</option><option value="pending">待定</option><option value="unusable">不能用</option><option value="all">所有成功结果</option></select><select aria-label="按执行配置筛选" value={model} onChange={e => setModel(e.target.value)}><option value="">所有执行配置</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span>{loading ? '检索中…' : `${items.length} 条结果`}</span></div>{loading ? <div className="page-loading"><LoaderCircle size={20} className="spin"/>正在找素材…</div> : items.length ? <div className="material-grid">{items.map(item => <button key={item.result.attempt!.id} className="material-card" onClick={() => open(item.result.attempt!.id)}><div className="material-thumb"><ResultThumbnail attempt={item.result.attempt}/>{item.demo && <span className="badge demo">演示</span>}</div><div className="material-body"><strong>{item.case.title}</strong><p>{item.result.attempt?.annotation.note || item.result.attempt?.outputText.slice(0, 80) || '查看完整产物与执行记录'}</p><div><span className="model-dot" style={{ background: item.model.color }}/><span>{item.model.name}</span><i className={`verdict ${item.result.attempt?.annotation.verdict || ''}`}>{labelVerdict(item.result.attempt?.annotation.verdict)}</i></div><small>{time(item.createdAt)} · 案例 v{item.case.version}</small></div></button>)}</div> : <Empty title={verdict === 'usable' ? '还没有标为可用的素材' : '没有找到符合条件的结果'} text="可以先在运行结果里完成判定，或切换到未评审、所有成功结果。"/>}</>;
}
function SettingsModal({ profiles, close, refresh }: { profiles: Profile[]; close: () => void; refresh: () => void }) {
  return <ModalFrame title="设置" close={close} className="settings-modal"><div className="detail-head"><h2>设置</h2><button className="icon-btn" aria-label="关闭执行配置" onClick={close}><X size={19}/></button></div><div className="editor-body"><details className="workspace-setting-section"><summary>采集连接</summary><MediaLoginSettings/></details><details className="workspace-setting-section"><summary>写法知识库</summary><WritingKnowledgeSettings/></details><details className="workspace-setting-section" open><summary>本地 Agent</summary><p className="agent-settings-intro">在本机 Agent 中完成登录，再到发起测试页面刷新连接。模型列表由 Agent 提供，测试时使用其当前账号与额度。</p>{[{ id: 'gpt', name: 'GPT 桌面端', detail: profiles.some(p => p.id === 'chatgpt-session') ? '自动发现本机执行程序与模型目录，支持文本续聊、逐轮用量和历史记录。' : '本机尚未发现可用的 GPT 执行器。' }, { id: 'workbuddy', name: 'WorkBuddy', detail: '已接入内置持续执行器；执行器登录与桌面登录独立，桌面任务同步尚未验证。' }, {id:'deepseek',name:'DeepSeek Harness',detail:'使用已安装的官方 ACP，支持网页续聊与持久会话。'}, {id:'minimax',name:'MiniMax Code',detail:'使用项目内官方 CLI 与动态模型目录，执行使用本机账号或模型配置。'}, { id: 'kimi', name: 'Kimi Code', detail: '待接入持续任务与模型目录。' }].map(a => <div className="agent-settings-row" key={a.id}><div className="agent-identity"><AgentIcon agent={a.id}/><div><strong>{a.name}</strong><small>{a.detail}</small></div></div></div>)}<p className="agent-settings-intro">历史测试仍可查看、下载和评审。实际型号会随产物保存，之后切换模型不会改变旧结果。</p></details></div><div className="detail-footer"><button className="btn" onClick={refresh}><RefreshCw size={14}/>重新读取配置</button><button className="btn primary" onClick={close}>完成</button></div></ModalFrame>;
}
