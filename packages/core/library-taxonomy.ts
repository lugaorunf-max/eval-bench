import { SCENES, type CaseRecord, type Scene, type ArtifactType } from '../contracts/index';

export const caseScenes=(c:Pick<CaseRecord,'scene'|'scenes'>):Scene[]=>[...new Set([c.scene,...(c.scenes||[])])];
export const caseArtifacts=(c:Pick<CaseRecord,'artifactType'|'artifactTypes'>):ArtifactType[]=>[...new Set([c.artifactType,...(c.artifactTypes||[])])];
export const LIBRARY_SCENES = [
  { key: '', label: '全部', icon: 'all', scenes: [] },
  { key: 'game', label: '游戏生成', icon: 'game', scenes: ['game'] },
  { key: 'voxel', label: '3D 体素', icon: 'visual', scenes: ['voxel'] },
  { key: 'image', label: '图像生成', icon: 'image', scenes: ['image'] },
  { key: 'landing', label: '网页落地', icon: 'web', scenes: ['landing', 'code'] },
  { key: 'document', label: '文档整理', icon: 'document', scenes: ['document'] },
  { key: 'writing', label: '内容营销', icon: 'marketing', scenes: ['writing'] },
  { key: 'office', label: '办公沟通', icon: 'office', scenes: ['office'] },
  { key: 'dataviz', label: '数据分析', icon: 'data', scenes: ['dataviz'] },
  { key: 'qna', label: '知识问答', icon: 'qna', scenes: ['qna'] },
  { key: 'study', label: '学习辅导', icon: 'study', scenes: ['study'] },
  { key: 'research', label: '调研检索', icon: 'research', scenes: ['research'] },
  { key: 'video', label: '视频制作', icon: 'video', scenes: ['video'] },
  { key: 'audio', label: '音频创作', icon: 'audio', scenes: ['audio'] },
  { key: 'automation', label: '流程自动化', icon: 'automation', scenes: ['automation'] },
] as const;
export const LIBRARY_CAPABILITIES = {
  follow: { label: '指令遵循', icon: 'instruction', aliases: ['指令遵循', '遵守约束', '听指令'], observe: '是否遵守提示词中的格式、内容与约束要求。' },
  reason: { label: '逻辑推理', icon: 'reason', aliases: ['逻辑推理', '推理', '计算', '算数', '图表分析'], observe: '结论是否与数据一致，计算与推理过程是否成立。' },
  vision: { label: '视觉理解', icon: 'vision', aliases: ['视觉理解', '读图', '识图', '看图', '读懂图表', '图片理解'], observe: '是否准确理解输入图像中的内容与细节。' },
  extract: { label: '信息提取', icon: 'extract', aliases: ['信息提取', '提取信息', '抽取', '摘录', 'OCR'], observe: '关键信息是否完整、准确，是否混入不存在的内容。' },
  coding: { label: '代码实现', icon: 'code', aliases: ['代码实现', '编程', '写代码', '代码能力'], observe: '功能是否可运行，交互、边界条件与实现约束是否满足。' },
  tools: { label: '工具使用', icon: 'tool', aliases: ['工具使用', '工具调用', '使用工具', '调用工具'], observe: '工具选择与调用是否正确，任务是否完成闭环。' },
  expression: { label: '内容表达', icon: 'expression', aliases: ['内容表达', '写作能力', '文案能力', '表达能力'], observe: '表达是否清楚，语气与目标读者是否符合要求。' },
} as const;
export type LibraryCapability = keyof typeof LIBRARY_CAPABILITIES;
export function caseCapabilities(entry: Pick<CaseRecord, 'capabilities'>): LibraryCapability[] {
  return [...new Set(entry.capabilities.flatMap(key => key === 'chart' ? ['reason' as const] : key in LIBRARY_CAPABILITIES ? [key as LibraryCapability] : []))];
}
/** Deterministic keyword interpretation, not an AI or embedding search. */
export function interpretCapabilityQuery(query: string): LibraryCapability[] {
  const text = query.trim().toLowerCase();
  if (!/(想|测|能力|考察|检验|评估)/.test(text) && !Object.values(LIBRARY_CAPABILITIES).some(c => c.aliases.some(a => text === a.toLowerCase()))) return [];
  return (Object.keys(LIBRARY_CAPABILITIES) as LibraryCapability[]).filter(key => LIBRARY_CAPABILITIES[key].aliases.some(alias => text.includes(alias.toLowerCase())));
}
export function matchesLibraryCase(entry: CaseRecord, options: { scenes: readonly string[]; artifacts: readonly string[]; favorites: boolean; query: string; capabilities: readonly LibraryCapability[]; interpreted?: boolean }): boolean {
  // Each facet accepts any selected value; separate facets must all match.
  if (options.scenes.length && !options.scenes.some(key => {
    const group = LIBRARY_SCENES.find(s => s.key === key);
    return group && caseScenes(entry).some(s=>(group.scenes as readonly string[]).includes(s));
  })) return false;
  if (options.artifacts.length && !caseArtifacts(entry).some(a=>options.artifacts.includes(a))) return false;
  if (options.favorites && !entry.favorite) return false;
  const caps = caseCapabilities(entry);
  if (options.capabilities.length && !options.capabilities.some(c => caps.includes(c))) return false;
  if (options.interpreted || !options.query.trim()) return true;
  const haystack = `${entry.title} ${entry.prompt} ${caseScenes(entry).map(s=>SCENES[s]).join(" ")} ${caps.map(c => LIBRARY_CAPABILITIES[c].label).join(' ')}`.toLowerCase();
  return options.query.trim().toLowerCase().split(/\s+/).every(term => haystack.includes(term));
}
export function sceneLabel(scene: Scene) { return LIBRARY_SCENES.find(s => (s.scenes as readonly string[]).includes(scene))?.label || SCENES[scene]; }
