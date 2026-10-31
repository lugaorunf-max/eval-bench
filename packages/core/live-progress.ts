import path from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { z } from 'zod';
import { stateDir } from './config';
import { executionMetadataSchema } from '../contracts';
import type { RunRecord } from '../contracts';

const liveSchema = z.object({
  agentId: z.string().max(100).optional(), threadId: z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/).nullable(), turnId: z.string().max(150).nullable().optional(), usage: z.object({ inputTokens: z.number().nonnegative().nullable(), outputTokens: z.number().nonnegative().nullable(), cachedTokens: z.number().nonnegative().nullable(), cost: z.number().nullable(), currency: z.string().nullable(), source: z.enum(['reported','unknown']) }).optional(), activeDurationMs: z.number().nonnegative().optional(), phase: z.enum(['connecting', 'running', 'completed', 'failed']),
  model: z.string().max(200).nullable(), updatedAt: z.string().datetime(),
  events: z.array(z.object({ at: z.string().datetime(), text: z.string().max(2000) })).max(40),
  outputText: z.string().max(2_000_000)
});
export async function readLiveProgress(run: RunRecord) {
  const items = await Promise.all(run.results.map(async result => {
    if (!result.attempt) return null;
    const parts = [run.id, result.id, result.attempt.id];
    if (parts.some(id => !/^[a-z]+_[a-f0-9]{32}$/.test(id))) return null;
    const file = path.join(stateDir(), 'runs', ...parts, 'live.json');
    try {
      const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_200_000) return null;
      const parsed = liveSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      if(parsed.success&&result.attempt.status==='running'&&parsed.data.phase==='running'&&parsed.data.activeDurationMs!==undefined)parsed.data.activeDurationMs+=Math.max(0,Date.now()-Date.parse(parsed.data.updatedAt));
      return parsed.success ? { resultId: result.id, profileId: result.profileId, attemptId: result.attempt.id, ...parsed.data } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }));
  return items.filter(item => item !== null);
}
