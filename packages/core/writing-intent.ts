/** Describes the requested deliverable; never forces a template or a workflow stage. */
export function writingGenerationStage(request:string):'planning'|'drafting'|'default'{
 const positive=request.replace(/(?:不要|不用|无需|不必|暂不|先不|别)(?:再|先|直接|急着)?\s*(?:生成|撰写|输出|写(?:出|成)?)?\s*(?:完整)?(?:正文|全文|初稿|成稿|文章)/g,'');
 if(/(?:生成|撰写|输出|写出|重写|写|完成)[^。\n！？!?]{0,16}(?:正文|全文|初稿|成稿|文章)(?!的?(?:大纲|提纲|框架|结构))|(?:正文|全文|初稿|成稿)[^。\n！？!?]{0,12}(?:重写|重新生成)|\b(?:write|generate|draft)\b.{0,35}\b(?:article|full draft)\b/i.test(positive))return 'drafting';
 if(/大纲|提纲|框架|(?:写作|叙事|文章)结构|\b(?:outline|writing structures?)\b/i.test(request))return 'planning';
 return 'default';
}
