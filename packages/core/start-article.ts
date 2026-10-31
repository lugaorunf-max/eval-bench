import {createHash} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {EditorialService} from './editorial';
import {CasebenchService,now,AppError} from './service';
import {editorialRecords} from './schema';
import type {WritingArticle} from '../contracts/editorial';
export async function startArticle(e:EditorialService,body:unknown){
 const v=z.object({requestKey:z.string().uuid(),title:z.string().trim().min(1).max(100),articleId:z.string().max(130).optional(),references:z.array(z.object({kind:z.enum(['source','case','instance','media']),id:z.string().max(130)}).strict()).max(30).default([])}).strict().parse(body);
 const id='article_start_'+createHash('sha256').update(v.requestKey).digest('hex').slice(0,32),fingerprint=JSON.stringify([v.title,v.articleId||'',v.references]);
 const snapshots=await Promise.all(v.references.map(r=>e.snapshot(r)));
 return e.s.db.transaction(async tx=>{
  const at=now();await tx.insert(editorialRecords).values({id,kind:'article-start',data:{fingerprint},createdAt:at,updatedAt:at}).onConflictDoNothing();
  const row=(await tx.select().from(editorialRecords).where(eq(editorialRecords.id,id)).for('update'))[0],data=row.data as {fingerprint:string;articleId?:string};
  if(data.fingerprint!==fingerprint)throw new AppError(409,'该操作已用于另一篇文章');
  const service=new EditorialService(new CasebenchService({...e.s.store,db:tx as any}));
  if(data.articleId)return service.get<WritingArticle>(data.articleId,'article');
  const article=v.articleId?await service.mutate<WritingArticle>(v.articleId,'article',a=>({...a,references:[...a.references,...snapshots.filter(r=>!a.references.some(old=>!old.removed&&old.kind===r.kind&&old.sourceId===r.sourceId))],revision:a.revision+1,updatedAt:at})):await service.create({title:v.title,references:v.references});
  if(article.references.filter(r=>!r.removed).length>30)throw new AppError(400,'本篇参考资料已超过 30 条');
  await tx.update(editorialRecords).set({data:{fingerprint,articleId:article.id},updatedAt:at}).where(eq(editorialRecords.id,id));return article;
 });
}
