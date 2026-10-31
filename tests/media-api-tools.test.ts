import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {createMediaToolSession,mediaToolRequest,toolText} from '../packages/core/media-tool-session';
import {executeAdapter} from '../packages/adapters';

test('API tool loop groups all tool responses before visual input and totals both model calls',async()=>{
 const dir=await mkdtemp('/private/tmp/casebench-media-api-');let calls=0;
 const server=createServer(async(req,res)=>{try{const parts=[];for await(const b of req)parts.push(b);const body=JSON.parse(Buffer.concat(parts).toString());res.setHeader('content-type','application/json');
  if(req.url==='/api/editorial/tool-session'){res.end(JSON.stringify(await mediaToolRequest(body)));return;}
  calls++;if(calls===1){res.end(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'visual',type:'function',function:{name:'look',arguments:'{}'}},{id:'source',type:'function',function:{name:'source',arguments:'{}'}}]}}],usage:{prompt_tokens:10,completion_tokens:5}}));return;}
  assert.deepEqual(body.messages.map((m:any)=>m.role),['user','assistant','tool','tool','user']);assert.equal(body.messages.at(-1).content[1].type,'image_url');res.end(JSON.stringify({model:'verified-api-model',choices:[{message:{role:'assistant',content:'正文交付'}}],usage:{prompt_tokens:15,completion_tokens:7}}));
 }catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address() as any).port;
 const tools=['look','source'].map(name=>({name,description:'test',inputSchema:{type:'object',properties:{}}})),session=await createMediaToolSession(origin,dir,tools,async name=>name==='look'?{content:[{type:'image',mimeType:'image/png',data:'cG5n'}]}:toolText('actual source'));
 try{const profile:any={id:'api',name:'API',adapter:'api',model:'test',baseUrl:origin+'/v1',modes:['text']};const result=await executeAdapter({case:{executionMode:'text',artifactType:'copy',prompt:'test',instructions:'',inputs:[]} as any,profile,model:profile,directory:dir,outputDirectory:dir,inputPaths:[],signal:AbortSignal.timeout(5000),toolSession:{file:session.file,tools}});assert.equal(result.text,'正文交付');assert.equal(calls,2);assert.equal(result.usage.inputTokens,25);assert.equal(result.usage.outputTokens,12);}finally{session.close();server.close();await rm(dir,{recursive:true,force:true});}
});
