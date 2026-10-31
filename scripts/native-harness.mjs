import {internalTask,taskPrompt} from './task-prompt.mjs';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {saveNativeHtml} from './native-html.mjs';
import {runAcpSession,runWorkbuddySession} from './native-agents.mjs';
process.env.CASEBENCH_ROOT ||= fileURLToPath(new URL('../',import.meta.url));
const id=process.argv[2];
try{
 if(!['workbuddy','deepseek','minimax'].includes(id))throw Error('未知的本机 Agent');
 const task=JSON.parse(await readFile(process.env.CASEBENCH_TASK_FILE,'utf8'));
 const html=task.case.executionMode==='html'&&task.case.artifactType==='web';
 if((!html&&(task.case.executionMode!=='text'||task.case.artifactType!=='copy'))||task.inputPaths.length)throw Error('此适配支持无附件文案或网页任务');
 const writing=task.case.scene==='writing'&&id==='workbuddy',scoped=!!task.toolSession;
 const prompt=taskPrompt(task);
 const text=id==='workbuddy'?await runWorkbuddySession(task,prompt):await runAcpSession(task,prompt,id);
 await saveNativeHtml(task,text);process.stdout.write(text);
}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
