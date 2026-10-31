import {writeFile} from 'node:fs/promises';
import path from 'node:path';
// Kept for compatibility with old consumers, never appended to benchmark prompts.
export const HTML_DELIVERY='只返回可运行的完整 HTML 文档（包含 html、head、body），不要解释或 Markdown 围栏。原任务的效果和交互要求不变。若同时要求截图、录屏、视频或 GIF，本轮只生成网页，录制和编码由网站后处理完成；不要为视频交付停下网页生成，也不要用假视频占位。此次仅通过最终回复交付网页，不调用工具、不读写本机文件；网页文件由网站后台保存。';
export function extractNativeHtml(text){
 const raw=String(text).trim(),valid=html=>/^(?:<!doctype html[^>]*>\s*)?<html\b[\s\S]*<\/html>\s*$/i.test(html);
 if(valid(raw))return raw;
 const blocks=[...raw.matchAll(/```(?:html)?\s*\n([\s\S]*?)\n```/gi)].map(m=>m[1].trim()).filter(valid);
 if(blocks.length===1)return blocks[0];
 const documents=[...raw.matchAll(/(?:<!doctype html[^>]*>\s*)?<html\b[\s\S]*?<\/html>/gi)].map(m=>m[0].trim());
 if(documents.length===1)return documents[0];
 throw Error('执行器没有返回唯一完整 HTML 文档，未把说明文字保存成有效网页');
}
export async function saveNativeHtml(task,text){
 if(task.case.executionMode!=='html')return;
 await writeFile(path.join(task.outputDirectory,'index.html'),extractNativeHtml(text));
}
