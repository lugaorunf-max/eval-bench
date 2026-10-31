import {writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
export async function createNativeFixture(directory:string){
 const file=path.join(directory,'mock-native');
 await writeFile(file,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),rl=require('node:readline'),{randomUUID}=require('node:crypto');
const root=${JSON.stringify(directory)},stateFile=path.join(root,'sessions.json');
const read=()=>{try{return JSON.parse(fs.readFileSync(stateFile,'utf8'))}catch{return {sessions:{},calls:0}}};
const save=s=>fs.writeFileSync(stateFile,JSON.stringify(s));const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
if(process.argv.includes('--version')){console.log('fixture-0.5');process.exit(0)}
if(process.argv.includes('--help')){console.log('--model <model> supported: (auto, test-model)');process.exit(0)}
if(process.argv.includes('--input-format')){rl.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{models:[{id:'test-model',name:'Test Model'}],currentModelId:'test-model',account:{type:'fixture'}}}})});return;}
if(process.argv.includes('-p')){
 const prompt=process.argv.at(-1),resume=process.argv.indexOf('--resume'),s=read(),id=resume>=0?process.argv[resume+1]:randomUUID();s.calls++;s.sessions[id]??={cwd:process.cwd(),turns:[]};s.sessions[id].argv=process.argv.slice(2);
 if(resume>=0&&s.sessions[id].cwd!==process.cwd())throw Error('cwd changed');
 send({type:'system',subtype:'init',session_id:id,model:'test-model'});
 if(prompt.includes('auth-error')){send({type:'result',session_id:id,is_error:true,errors:['Authentication required. Please use /login command'],usage:{input_tokens:0,output_tokens:0}});process.exit(0)}
 const text=prompt.includes('html-fixture')&&!prompt.includes('non-html-fixture')?'<!doctype html><html><body><h1>Actual HTML</h1></body></html>':'WorkBuddy '+s.calls;s.sessions[id].turns.push(text);save(s);
 send({type:'assistant',uuid:randomUUID(),session_id:id,message:{content:[{type:'text',text}]}});
 send({type:'result',is_error:false,session_id:id,_requestId:randomUUID(),usage:{input_tokens:s.sessions[id].turns.length*30,output_tokens:s.sessions[id].turns.length*6,cache_read_input_tokens:s.sessions[id].turns.length*4}});process.exit(0)
}
let active,pending;const reply=(m,result)=>send({jsonrpc:'2.0',id:m.id,result});
rl.createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}const p=m.params||{};const s=read();
if(m.method==='initialize')return reply(m,{protocolVersion:1,agentInfo:{version:'fixture-0.5'}});
if(m.method==='session/new'){active=randomUUID();s.sessions[active]={cwd:p.cwd,turns:[]};save(s);return reply(m,{sessionId:active,configOptions:[{id:'model',category:'model',currentValue:'test-model',options:[{value:'test-model',name:'Test Model'}]}]})}
if(m.method==='session/resume'){active=p.sessionId;if(!s.sessions[active]||s.sessions[active].cwd!==p.cwd)return send({id:m.id,error:{message:'session cwd does not match'}});return reply(m,{sessionId:active,configOptions:[{id:'model',category:'model',currentValue:'test-model',options:[{value:'test-model',name:'Test Model'}]}]})}
if(m.method==='session/set_config_option'){send({method:'session/update',params:{sessionId:active,update:{sessionUpdate:'available_commands_update',availableCommands:[{name:'usage',description:'Local recorded usage'}]}}});if(p.configId==='permissionMode'&&p.value!=='default')throw Error('unsafe permission');return reply(m,{})}
if(m.method==='session/close')return reply(m,{});
if(m.method==='session/cancel'){if(pending){reply(pending,{stopReason:'cancelled',usage:{inputTokens:8,outputTokens:2}});pending=null;}return;}
if(m.method==='session/prompt'&&p.prompt[0].text==='/usage'){const n=s.sessions[active].turns.length;send({method:'session/update',params:{sessionId:active,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:n?'Session usage:\\nInput tokens: '+(n*20)+'\\nOutput tokens: '+(n*5)+'\\nCache read tokens: '+(n*3):'No usage has been recorded for this session.'}}}});return reply(m,{stopReason:'end_turn'})}
if(m.method==='session/prompt'){s.calls++;const text='ACP '+s.calls;s.sessions[active].turns.push(text);save(s);send({method:'session/update',params:{sessionId:active,update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'不应混入正文'}}}});send({method:'session/update',params:{sessionId:active,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});if(p.prompt[0].text.includes('slow')){pending=m;return;}if(p.prompt[0].text.includes('balance-error'))return send({id:m.id,error:{message:'insufficient balance'}});return reply(m,{stopReason:'end_turn',usage:{inputTokens:20,outputTokens:5,cachedReadTokens:3,totalTokens:25}})}
});
`);await chmod(file,0o755);return file;
}
