import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createStore} from '../packages/core/db';
import {CasebenchService} from '../packages/core/service';
import {EditorialService} from '../packages/core/editorial';
import {ArticleAssociations} from '../packages/core/article-associations';
import {ContentLibrary} from '../packages/core/content-library';
import {ContentWorkspace} from '../packages/core/content-workspace';
import type {WritingArticle} from '../packages/contracts/editorial';
import type {ResourceLink} from '../packages/contracts/content-workspace';
const fixture=async()=>{const dir=await mkdtemp('/private/tmp/card-articles-'),store=await createStore(dir,':memory:'),s=new CasebenchService(store),e=new EditorialService(s);return {s,e,lib:new ContentLibrary(e),links:new ArticleAssociations(e),w:new ContentWorkspace(e),close:async()=>{await store.close();await rm(dir,{recursive:true,force:true});}};};
test('case and media article chips are multi-value associations, not AI reference selection; attribution comes from server',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'文章 A'}),b=await t.e.create({title:'文章 B'}),c=await t.lib.promptCandidate({title:'方块',prompt:'制作方块'}),entry=await t.lib.promote(c.id,{prompt:'制作方块'}),file=await t.s.putFile(Buffer.from('image'),'cover.png','image/png','reference'),items=[{kind:'case',id:entry.id},{kind:'media',id:file.id}];
 await t.links.change({items,addArticleIds:[a.id,b.id]});await t.links.change({items,addArticleIds:[a.id]});
 const read=await t.links.read({items});for(const row of read.items){assert.deepEqual(new Set(row.articleIds),new Set([a.id,b.id]));assert.equal(row.attributions[0].addedBy?.name,'本机用户');}
 assert.equal((await t.e.article(a.id)).references.length,0);assert.equal((await t.e.article(a.id)).media.length,0);
 await t.links.change({items:[items[0]],removeArticleIds:[a.id]});const updated=await t.links.read({items});assert.deepEqual(updated.items[0].articleIds,[b.id]);assert.deepEqual(new Set(updated.items[1].articleIds),new Set([a.id,b.id]));assert.equal((await t.s.listCases()).length,1);assert.equal((await t.s.file(file.id)).id,file.id);
 await assert.rejects(t.links.change({items,addArticleIds:[a.id],addedBy:{name:'假用户'}}));
 await assert.rejects(t.links.change({items,addArticleIds:[a.id],removeArticleIds:[a.id]}),/不能同时/);
 }finally{await t.close();}
});
test('bulk deltas preserve unrelated associations and rollback all removals when any article uses embedded media',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'A'}),b=await t.e.create({title:'B'}),c=await t.e.create({title:'C'}),f=await t.s.putFile(Buffer.from('image'),'embedded.png','image/png','reference'),g=await t.s.putFile(Buffer.from('another image'),'other.png','image/png','reference'),items=[{kind:'media',id:f.id},{kind:'media',id:g.id}];
 await t.links.change({items:[items[0]],addArticleIds:[a.id,c.id]});await t.links.change({items:[items[1]],addArticleIds:[b.id]});await t.links.change({items,addArticleIds:[c.id]});
 const before=await t.links.read({items});assert.deepEqual(new Set(before.items[1].articleIds),new Set([b.id,c.id]));
 await t.e.mutate<WritingArticle>(c.id,'article',a=>({...a,document:{type:'doc',content:[{type:'image',attrs:{fileId:f.id,src:'/api/files/'+f.id}}]}}));
 await assert.rejects(t.links.change({items,removeArticleIds:[a.id,c.id]}),/仍在文章正文/);assert.equal((await t.links.read({items})).items[0].articleIds.includes(a.id),true);
 await t.e.mutate<WritingArticle>(c.id,'article',a=>({...a,document:{type:'doc',content:[]}}));await t.links.change({items,removeArticleIds:[c.id]});const after=await t.links.read({items});assert.deepEqual(after.items[0].articleIds,[a.id]);assert.deepEqual(after.items[1].articleIds,[b.id]);assert.equal((await t.s.file(f.id)).id,f.id);
 }finally{await t.close();}
});
test('source membership is visible before AI selection, source detach preserves files and other articles; missing candidates cannot be fabricated by metadata',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'A'}),b=await t.e.create({title:'B'}),src=await t.w.record({title:'原帖',url:'https://x.com/test/status/777'}),f=await t.s.putFile(Buffer.from('image'),'source.png','image/png','reference');await t.lib.link('media',f.id,{sourceId:src.id});const items=[{kind:'source',id:src.id}];await t.links.change({items,addArticleIds:[a.id,b.id]});assert.equal((await t.w.cards(a.id))[0].articleIds?.includes(a.id),true);assert.equal((await t.e.article(a.id)).references.length,0);
 await t.w.change(a.id,{items,state:'selected'});await t.links.change({items,removeArticleIds:[a.id]});assert.equal((await t.w.cards(a.id)).length,0);assert.equal((await t.w.cards(b.id)).length,1);assert.equal((await t.e.article(a.id)).references[0].removed,true);assert.equal((await t.s.file(f.id)).id,f.id);
 await t.lib.meta('candidate','candidate_missing');await assert.rejects(t.links.read({items:[{kind:'candidate',id:'candidate_missing'}]}),/不存在/);
 const link=(await t.e.list<ResourceLink>('article-resource')).find(l=>l.articleId===b.id&&l.kind==='source');assert.equal(link?.addedBy?.id,'local');
 }finally{await t.close();}
});
