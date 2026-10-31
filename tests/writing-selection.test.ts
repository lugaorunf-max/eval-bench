import {fixtureKnowledge,citedReply} from './fixtures/writing-knowledge';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {Schema} from '@tiptap/pm/model';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {writingSelectionPlugin,selectedWritingPassage,writingSelectionKey} from '../apps/web/components/writing-selection';
import {verifyWritingSelection,reviseSelectedPassage} from '../packages/core/writing-selection';
import {documentText,markdownDocument} from '../packages/core/writing-document';
import {interpretWritingReply} from '../packages/core/writing-reply';
import {WritingDocumentService} from '../packages/core/writing-service';
import {EditorialService} from '../packages/core/editorial';
import {CasebenchService} from '../packages/core/service';
import {createStore} from '../packages/core/db';
import {UNKNOWN_USAGE,type LocalProfile} from '../packages/contracts';

test('ordinary selection clears on collapse; explicit AI quotations map with edits and clear without changing prose',()=>{
  const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*'},text:{}}});
  const doc=schema.node('doc',null,[schema.node('paragraph',null,schema.text('First selected ending.'))]);
  let state=EditorState.create({doc,plugins:[writingSelectionPlugin()]});
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,7,15)));
  assert.equal(selectedWritingPassage(state)?.text,'selected');
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,1)));
  assert.equal(selectedWritingPassage(state),null);
  state=state.apply(state.tr.setMeta(writingSelectionKey,{from:7,to:15,pinned:true}));
  state=state.apply(state.tr.insertText('New ',1));assert.equal(selectedWritingPassage(state)?.text,'selected');assert.equal(selectedWritingPassage(state)?.from,11);
  const before=state.doc.toJSON(),clear=state.tr.setMeta(writingSelectionKey,null);assert.equal(clear.docChanged,false);
  state=state.apply(clear);assert.equal(selectedWritingPassage(state),null);assert.deepEqual(state.doc.toJSON(),before);
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,11,19)));state=state.apply(state.tr.delete(11,19));assert.equal(selectedWritingPassage(state),null);
});

test('selected-text revision preserves text outside the exact range and verifies stale selections',()=>{
  const doc=markdownDocument('Before selected ending.\n\nKeep the other paragraph.');
  const selection={from:8,to:16,text:'selected'};
  verifyWritingSelection(doc,selection);
  const revised=reviseSelectedPassage(doc,selection,'**improved**');
  assert.equal(documentText(revised),'Before **improved** ending.\n\nKeep the other paragraph.');
  assert.throws(()=>verifyWritingSelection(doc,{...selection,text:'stale'}),/已变化/);
  const cross={from:8,to:30,text:verifyWritingSelection(doc,selection).textBetween(8,30,'\n')};
  const changed=reviseSelectedPassage(doc,cross,'Replacement.');assert.match(documentText(changed),/^Before Replacement/);assert.match(documentText(changed),/other paragraph\.$/);
  assert.throws(()=>interpretWritingReply('Plain discussion'),/写作格式异常/);
  assert.equal(interpretWritingReply('{"action":"reply","reply":"Consider the evidence."}').text,'Consider the evidence.');
  assert.equal(interpretWritingReply('```json\n{"action":"edit","target":"selection","markdown":"Rewritten"}\n```').target,'selection');
});

test('natural conversation distinguishes discussion from edits and removal stops selected context being sent',async()=>{
  const directory=await mkdtemp('/private/tmp/writing-auto-'),store=await createStore(directory);
  try{
    const profile:LocalProfile={id:'writer-api',name:'Writer',vendor:'test',model:'fixture',adapter:'api',color:'#242832',modes:['text'],supportsTemperature:false};
    let response='';const prompts:string[]=[];
    const e=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],knowledge:async()=>fixtureKnowledge(),execute:async task=>{prompts.push(task.case.prompt);return {text:citedReply(response),usage:UNKNOWN_USAGE,reportedModel:profile.model,logs:''};}}),w=new WritingDocumentService(e);
    let a=await e.create({});a=await w.save(a.id,{documentRevision:0,document:markdownDocument('Before selected ending.\n\nKeep the other paragraph.')});
    const selection={from:8,to:16,text:'selected'};
    async function send(message:string,selectedPassage?:typeof selection){a=await e.send(a.id,{text:message,purpose:'auto',selectedPassage,profileId:profile.id,model:profile.model,revision:a.revision,requestKey:randomUUID()});for(let n=0;n<100&&a.messages.at(-1)?.status==='pending';n++){await new Promise(r=>setTimeout(r,15));a=await e.article(a.id);}assert.equal(a.messages.at(-1)?.status,'complete');}
    response=JSON.stringify({action:'reply',reply:'This part needs clearer evidence.'});await send('What do you think?',selection);assert.equal(a.proposal,null);assert.equal(a.documentRevision,1);assert.equal(a.messages.at(-2)?.selectedPassage?.text,'selected');assert.match(prompts[0],/Selected paragraphs:\nselected/);
    response=JSON.stringify({action:'edit',target:'selection',markdown:'better wording'});await send('Make it clearer.',selection);a=await e.article(a.id);assert.equal(a.proposal,null);assert.equal(documentText(a.document!),'Before better wording ending.\n\nKeep the other paragraph.');
    response=JSON.stringify({action:'reply',reply:'We can discuss the whole article.'});await send('Let us reconsider the overall structure.');assert.equal(a.messages.at(-2)?.selectedPassage,undefined);assert.match(prompts.at(-1)!,/Selected paragraphs:\n\nUser request/);assert.match(prompts.at(-1)!,/Keep the other paragraph/);
    await assert.rejects(e.send(a.id,{text:'Edit',purpose:'auto',selectedPassage:selection,profileId:profile.id,model:profile.model,revision:a.revision,requestKey:randomUUID()}),/已变化/);
    response=JSON.stringify({action:'edit',target:'document',markdown:'# Complete outline\n\nNew structure.'});await send('Give me a new full outline.');assert.equal(a.proposal,null);assert.match(documentText(a.document!),/Complete outline/);
    let empty=await e.create({});empty=await e.send(empty.id,{text:'Write a full draft.',purpose:'auto',profileId:profile.id,model:profile.model,revision:empty.revision,requestKey:randomUUID()});for(let n=0;n<100&&empty.messages.at(-1)?.status==='pending';n++){await new Promise(r=>setTimeout(r,15));empty=await e.article(empty.id);}assert.match(documentText(empty.document!),/Complete outline/);assert.equal(empty.proposal,null);
  }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
