import {taskPrompt} from './task-prompt.mjs';
// Text-only connectivity adapter for the CLIs bundled with the installed apps.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {saveNativeHtml} from './native-html.mjs';
import { runCodexSession } from './codex-session.mjs';

async function main() {
const kind = process.argv[2];
if (!['workbuddy', 'chatgpt-codex', 'chatgpt-session'].includes(kind)) throw new Error('未知的本机工具');
const task = JSON.parse(await readFile(process.env.CASEBENCH_TASK_FILE, 'utf8'));
const html=kind==='chatgpt-session'&&task.case.executionMode==='html'&&task.case.artifactType==='web';
if ((!html&&(task.case.executionMode!=='text'||task.case.artifactType!=='copy'))||task.inputPaths.length)throw Error('此适配支持无附件文案或网页任务。');
const prompt = taskPrompt(task);
if (kind === 'chatgpt-session') { const text=await runCodexSession(task,prompt);await saveNativeHtml(task,text);process.stdout.write(text);return; }
const outputFile = path.join(task.outputDirectory, 'response.md');
const env = { ...process.env };
let program, args;
if (kind === 'workbuddy') {
  program = process.execPath;
  env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = '1';
  args = ['/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy', '-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--max-turns', '1', '--no-session-persistence', '--model', task.model.model, prompt];
} else {
  program = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
  args = ['exec', '--ignore-user-config', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '--color', 'never', '-o', outputFile, prompt];
}
const result = await new Promise((resolve, reject) => {
  const child = spawn(program, args, { cwd: process.cwd(), env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout = (stdout + b).slice(-200_000); });
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-20_000); });
  child.once('error', reject);
  child.once('close', code => resolve({ code, stdout, stderr }));
});
if (result.code !== 0) {
  const detail = (result.stderr || result.stdout).replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').slice(-1500);
  throw new Error(`${kind} 执行失败（${result.code}）：${detail}`);
}
let text = kind === 'chatgpt-codex' ? await readFile(outputFile, 'utf8') : result.stdout.trim();
if (kind === 'workbuddy' && text) {
  const data = JSON.parse(text);
  if (data.is_error) throw new Error(`WorkBuddy 返回错误：${String(data.result || data.error || '未知错误').slice(0,1000)}`);
  text = typeof data.result === 'string' ? data.result : typeof data.content === 'string' ? data.content : '';
}
if (!text.trim() || /^error\s*:/i.test(text.trim())) {
  const detail = result.stderr.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').slice(-1800);
  if (/Authentication required|\/login command/i.test(detail)) throw new Error('WorkBuddy 执行器尚未登录；此次调用未能复用桌面端的登录态，需要先完成执行器登录。');
  throw new Error(`${kind} 没有返回有效正文。执行器诊断：${detail || '进程退出码为 0，但 stdout 与 stderr 均为空。'}`);
}
await writeFile(outputFile, text);
process.stdout.write(text);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
