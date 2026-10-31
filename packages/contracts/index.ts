import { z } from 'zod';

export const SCENES = { office: '办公沟通', writing: '内容营销', dataviz: '数据分析', landing: '网页落地', game: '游戏生成', document: '文档整理', qna: '知识问答', study: '学习辅导', research: '调研检索', voxel: '3D 体素', image: '图像生成', video: '视频制作', audio: '音频创作', automation: '流程自动化', code: '代码开发' } as const;
export const CAPABILITIES = { follow: '指令遵循', reason: '逻辑推理', vision: '视觉理解', extract: '信息提取', coding: '代码实现', tools: '工具使用', expression: '内容表达', long: '持续任务', chart: '图表推理（旧标签）' } as const;
export const ARTIFACT_TYPES = { web: '网页', image: '图片', video: '视频', copy: '文案' } as const;
export const EXECUTION_MODES = { text: '直接生成文案', html: '直接生成单页网页', harness: '使用工具执行' } as const;
export type Scene = keyof typeof SCENES;
export type Capability = keyof typeof CAPABILITIES;
export type ArtifactType = keyof typeof ARTIFACT_TYPES;
export type ExecutionMode = keyof typeof EXECUTION_MODES;

export interface FileRecord {
  id: string; name: string; mime: string; size: number; sha256: string;
  role: 'input' | 'reference' | 'output'; createdAt: string;
}
export interface CaseData {
  title: string; prompt: string; scene: Scene; scenes?: Scene[]; artifactTypes?: ArtifactType[]; capabilities: Capability[];
  artifactType: ArtifactType; executionMode: ExecutionMode;
  inputs: FileRecord[]; reference: FileRecord | null; referenceKind?: string;
  instructions: string; sample: boolean;
}
export interface CaseRecord extends CaseData {
  favorite?: boolean;
  id: string; versionId: string; version: number; contentHash: string;
  createdAt: string; updatedAt: string; runCount: number;
}
export interface Profile {
  agentId?: string;
  id: string; name: string; vendor: string; model: string; modelName?: string;
  adapter: 'demo' | 'api' | 'command'; color: string;
  modes: ExecutionMode[]; supportsTemperature: boolean; configHash?: string;
  parameters?: Record<string, unknown>; tool?: string; harnessVersion?: string;
}
export interface LocalProfile extends Profile {
  discovered?: boolean;
  baseUrl?: string; apiKeyEnv?: string; apiKey?: never;
  requestParams?: Record<string, unknown>; maxTokens?: number;
  program?: string; args?: string[]; outputExtensions?: string[];
}
export interface AgentModel { id: string; name: string; family: string; isDefault: boolean; available?: boolean; detail?: string }
export interface AgentCatalog { id: string; name: string; profileId: string | null; ready: boolean; detail: string; models: AgentModel[];
  installed?: boolean; version?: string; state?: 'ready' | 'not_installed' | 'not_logged_in' | 'unreachable' | 'unsupported';
  modelSource?: 'agent' | 'cli' | 'none'; capabilities?: { continuation: boolean; usage: boolean; streaming: boolean; history: boolean }; checkedAt?: string;
}
export interface ModelSelection { profileId: string; model?: string; temperature?: number }
export interface FrozenModel extends Profile { temperature?: number; baseProfileId?: string }
export interface RunSpec {
  articleId?: string;
  cases: CaseRecord[]; models: FrozenModel[]; concurrency: number;
  timeoutSeconds: number | null; operator: string; demo: boolean; createdAt: string;
}
export type ExecutionStatus = 'pending' | 'running' | 'uploading' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
export interface Usage {
  inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null;
  cost: number | null; currency: string | null; source: 'reported' | 'unknown';
}
export const UNKNOWN_USAGE: Usage = { inputTokens: null, outputTokens: null, cachedTokens: null, cost: null, currency: null, source: 'unknown' };
export type Verdict = 'usable' | 'pending' | 'unusable' | null;
export interface Annotation { verdict: Verdict; note: string; revision: number; updatedAt: string; updatedBy: string }
export interface ExecutionMetadata {
  agentId?: string; threadId?: string; turnId?: string; agentVersion?: string;
  sessionCwd?: string;
  activeDurationMs?: number; usageRaw?: { last?: Record<string, number | null>; total?: Record<string, number | null> };
}
export interface ConversationTurn { id: string; number: number; prompt: string; source: 'initial' | 'web' | 'desktop'; nativeTurnId: string | null; attempt: AttemptRecord; retryCount: number; previousAttempts?: AttemptRecord[] }
export interface ConversationRecord { id: string; initialAttemptId: string; nativeThreadId: string; model: string; turns: ConversationTurn[]; busy: boolean; canContinue: boolean; detail: string; agentId?: string; canSyncNative?: boolean;
  totals: { rounds: number; completedRounds: number; failedRounds: number; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; reportedRounds: number; measuredRounds: number; retries: number; attempts: number };
}
export interface AttemptRecord {
  metadata?: ExecutionMetadata;
  id: string; number: number; status: ExecutionStatus; startedAt: string;
  finishedAt: string | null; outputText: string; error: string | null;
  durationMs: number | null; usage: Usage; artifacts: FileRecord[];
  reportedModel: string | null; adapterVersion: string; logs: string;
  annotation: Annotation; audit: { at: string; by: string; verdict: Verdict; note: string }[];
}
export interface ResultRecord {
  id: string; caseVersionId: string; profileId: string; status: ExecutionStatus;
  attempt: AttemptRecord | null; attemptCount: number;
}
export interface RunRecord {
  name?: string; pinned?: boolean;
  id: string; spec: RunSpec; status: string; createdAt: string; updatedAt: string;
  lastHeartbeatAt: string | null; results: ResultRecord[];
}

const ids = z.string().regex(/^[a-z][a-z0-9_-]{1,120}$/i);
export const caseInputSchema = z.object({
  title: z.string().trim().max(100).default(''),
  prompt: z.string().trim().min(1, '请填写提示词').max(100_000),
  scene: z.enum(Object.keys(SCENES) as [Scene, ...Scene[]]),
  scenes: z.array(z.enum(Object.keys(SCENES) as [Scene, ...Scene[]])).min(1).max(15).optional(),
  artifactTypes: z.array(z.enum(['web', 'image', 'video', 'copy'])).min(1).max(4).optional(),
  capabilities: z.array(z.enum(Object.keys(CAPABILITIES) as [Capability, ...Capability[]])).min(1).max(5),
  artifactType: z.enum(['web', 'image', 'video', 'copy']),
  executionMode: z.enum(['text', 'html', 'harness']),
  inputIds: z.array(ids).max(20).default([]),
  referenceId: ids.nullable().default(null),
  instructions: z.string().max(10_000).default(''),
  expectedVersion: z.number().int().positive().optional()
});
export const runInputSchema = z.object({
  articleId: ids.optional(),
  name: z.string().trim().max(100).default(''),
  caseIds: z.array(ids).min(1).max(30),
  models: z.array(z.object({ profileId: ids, model: z.string().min(1).max(200).optional(), temperature: z.number().min(0).max(2).optional() })).min(1).max(3),
  concurrency: z.number().int().min(1).max(3),
  timeoutSeconds: z.number().int().min(30).max(2147483).nullable().default(null),
  requestKey: z.string().uuid()
});
export const runMetadataSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), pinned: z.boolean().optional() }).strict().refine(v => v.name !== undefined || v.pinned !== undefined, '请提供要修改的名称或置顶状态');
export const caseMetadataSchema = z.object({ favorite: z.boolean() }).strict();
export const annotationSchema = z.object({
  verdict: z.enum(['usable', 'pending', 'unusable']).nullable(),
  note: z.string().max(5000), revision: z.number().int().nonnegative()
});
export const executionMetadataSchema = z.object({
  sessionCwd: z.string().max(4096).optional(),
  agentId: z.string().max(100).optional(), threadId: z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/).optional(), turnId: z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/).optional(), agentVersion: z.string().max(200).optional(),
  activeDurationMs: z.number().nonnegative().optional(), usageRaw: z.object({ last: z.record(z.string().max(60), z.number().nonnegative().nullable()).optional(), total: z.record(z.string().max(60), z.number().nonnegative().nullable()).optional() }).optional()
});
export const continuationSchema = z.object({ prompt: z.string().trim().min(1).max(20000), requestKey: z.string().uuid(), retryTurnId: ids.optional() }).strict();
export const completionSchema = z.object({
  metadata: executionMetadataSchema.default({}),
  status: z.enum(['succeeded', 'failed', 'timed_out', 'cancelled']),
  outputText: z.string().max(2_000_000).default(''),
  error: z.string().max(10_000).nullable().default(null),
  durationMs: z.number().nonnegative().nullable().default(null),
  reportedModel: z.string().max(300).nullable().default(null),
  usage: z.object({
    inputTokens: z.number().nonnegative().nullable(), outputTokens: z.number().nonnegative().nullable(),
    cachedTokens: z.number().nonnegative().nullable(), cost: z.number().nonnegative().nullable(),
    currency: z.string().max(8).nullable(), source: z.enum(['reported', 'unknown'])
  }).default(UNKNOWN_USAGE),
  logs: z.string().max(500_000).default('')
});
