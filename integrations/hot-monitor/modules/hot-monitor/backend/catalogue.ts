import { readFileSync } from "node:fs";
import { sql } from "@aihot/backend/db";
import { load } from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import {
  previewSource,
  createSource,
  updateSource,
  sourceIdentity,
} from "@aihot/backend/admin/sources";
import { mpHistory } from "@aihot/backend/providers/dajiala";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { mpCall, redactProviderError } from "./providers.ts";
import { digest, canonicalUrl } from "./domain.ts";
import { SOURCE_KINDS, SOURCE_PLATFORMS, sourcePlatform, type Candidate } from "../contracts.ts";
const raw = JSON.parse(
  readFileSync(
    new URL("../data/source-candidates.json", import.meta.url),
    "utf8",
  ),
);
const additional = JSON.parse(
  readFileSync(
    new URL("../data/additional-sources.json", import.meta.url),
    "utf8",
  ),
).sources;
const seeds = JSON.parse(
  readFileSync(
    new URL("../../../industry/sources.json", import.meta.url),
    "utf8",
  ),
).sources;
const knownNames: Record<string, string> = {
  "rss-openai-news": "OpenAI：官网动态",
  "rss-google-deepmind": "Google DeepMind：Blog",
  "rss-google-research": "Google Research：Blog",
  "rss-hugging-face": "Hugging Face 官方团队博客",
  "rss-microsoft-research": "Microsoft Research 博客",
  "rss-nvidia-blog": "NVIDIA Blog",
  "rss-the-verge-ai": "The Verge：AI",
  "rss-techcrunch-ai": "TechCrunch：AI",
  "rss-ars-technica-ai": "Ars Technica：AI",
  "rss-the-decoder": "The Decoder：AI",
  "rss-simon-willison": "Simon Willison",
  "rss-latent-space": "Latent Space",
  "rss-bair": "BAIR：",
};
export const SOURCE_INTERVAL_MINUTES = 60;
const nameKey=(name:string)=>name.normalize("NFKC").replace(/（[^）]*）|\([^)]*\)/g,"").replace(/\s+/g,"").toLowerCase();
export async function catalogue(): Promise<Candidate[]> {
  const saved=await sql`SELECT id,data FROM hm_source_checks`;
  const observed =
    await sql`SELECT DISTINCT ON (data->>'source') data->>'source' AS name,data->>'url' AS original FROM hm_reports WHERE data->>'source'<>'人工提交' ORDER BY data->>'source',updated_at DESC`;
  const grouped = new Map<string, Candidate>();
  const extras = seeds
    .filter(
      (seed: any) =>
        !knownNames[seed.id] ||
        !raw.sources.some((r: any) => r.name.startsWith(knownNames[seed.id])),
    )
    .map((seed: any) => ({
      ...seed,
      originalExample: null,
      example: "",
      priority: true,
    }));
  for (const source of [
    ...raw.sources,
    ...additional,
    ...extras,
    ...saved.filter(r=>r.data.registered).map(r=>r.data),
    ...observed.map((r) => ({
      name: r.name,
      originalExample: r.original,
      example: "",
      priority: false,
    })),
  ]) {
    let handle = source.handle ?? /@([a-zA-Z0-9_]+)/.exec(source.name)?.[1] ?? null;
    if (!handle && source.originalExample) {
      try {
        const u = new URL(source.originalExample);
        if (
          ["x.com", "twitter.com"].includes(u.hostname) &&
          /^\/[a-zA-Z0-9_]+\/status\//.test(u.pathname)
        )
          handle = u.pathname.split("/")[1];
      } catch {}
    }
    const kind = source.kind && ["unknown",...SOURCE_KINDS].includes(source.kind) ? source.kind : source.config?.feedUrl
      ? "rss"
      : source.name.startsWith("公众号：")
        ? "mp_account"
        : handle
          ? "x_search"
          : source.name.includes("RSS")
            ? "rss"
            : "unknown";
    const key = handle
      ? "x:" + handle.toLowerCase()
      : nameKey(source.name);
    const existing = grouped.get(key);
    if (existing) {
      if (existing.name !== source.name)
        (existing.aliases ??= []).push(source.name);
      existing.originalExample ??= source.originalExample;
      if(!existing.config&&source.config){existing.config=source.config;existing.kind=kind;existing.tier=source.tier??existing.tier;}
      if(source.sourceRole&&(!existing.sourceRole||existing.sourceRole==="待分类"))existing.sourceRole=source.sourceRole;
      if(source.fields?.length)existing.fields=[...new Set([...(existing.fields??[]),...source.fields])];
      continue;
    }
    const c = {
      ...source,
      id: "hm-" + digest(key).slice(0, 16),
      kind,
      handle,
      status: "candidate",
      aliases: [],
    } as Candidate;
    const seed = seeds.find(
      (x: any) => knownNames[x.id] && source.name.startsWith(knownNames[x.id]),
    );
    if (seed) {
      c.kind = "rss";
      c.config = seed.config;
      c.tier = seed.tier ?? "T2";
    }
    grouped.set(key, c);
  }
  const overrides = new Map(
    saved.map((r) => [
      r.id,
      r.data,
    ]),
  );
  const activity = new Map(
    (
      await sql`SELECT s.id,s.name,s.kind,s.config,s.tier,s.enabled,s.participation_mode,s.last_ok_at,(SELECT count(*) FROM articles a WHERE a.source_id=s.id AND a.published_at>now()-interval '7 days') AS recent FROM sources s`
    ).map((r) => [r.id, r]),
  );
  return [...grouped.values()].map((c) => {
    Object.assign(c, overrides.get(c.id));
    if (!c.fields) {
      const text=c.name+" "+(c.originalExample??"");
      c.fields=[];
      if(/OpenAI|DeepSeek|\bAI\b|_ai\b|模型|智能|Anthropic|Google|Hugging|Willison|机器之心|量子位|卡兹克|小互|Latent|BAIR|NVIDIA|Karpathy|WaytoAGI|人造人十号/i.test(text)) c.fields.push("AI与大模型");
      if(/苹果|Apple|AppSo|爱范儿|少数派|MacRumors|9to5Mac|iPhone|ifanr|sspai/i.test(text)) c.fields.push("苹果与软件");
      if(/IT之家|ithome|国产手机|OPPO|vivo|荣耀|小米|华为/i.test(text)) c.fields.push("国产手机");
      if(/TechCrunch|a16z|资本|融资|商业|36氪|晚点|投资/i.test(text)) c.fields.push("商业资本");
      if(/汽车|特斯拉|Tesla|Waymo|比亚迪|智驾/i.test(text)) c.fields.push("汽车");
      if(/机核|触乐|游戏|gcores|chuapp|Nintendo|Steam|娱乐/i.test(text)) c.fields.push("游戏文娱");
      if(/职场|社会|就业|劳动/i.test(text)) c.fields.push("职场社会");
      c.classificationMethod="suggested";
    }
    c.sourceRole ??= c.tier==="T1"||c.tier==="T1_5" ? "官方一手" : /Verge|Decoder|Ars|TechCrunch|少数派|量子位|爱范儿|IT之家|MacRumors|9to5Mac|MIT Technology|触乐|机核/i.test(c.name) ? "媒体" : /Hacker|Reddit|Product Hunt/i.test(c.name) ? "社区与综合" : "待分类";
    if(!c.sourceId) {
      const linked=[...activity.values()].find(a=>a.kind===c.kind && ((c.kind==="external" && a.id===c.id) || (c.config?.feedUrl && a.config.feedUrl===c.config.feedUrl) || (c.config?.ghid && a.config.ghid===c.config.ghid) || (c.config?.query && a.config.query===c.config.query)));
      if(linked) c.sourceId=linked.id;
    }
    const a = c.sourceId ? activity.get(c.sourceId) : null;
    c.enabled=a?.enabled ?? false;
    c.recentCount=Number(a?.recent??0);
    c.awaitingActivation=c.kind==="external"&&a?.participation_mode!=="editorial";
    if(a) {c.status=c.awaitingActivation?(c.verifiedAt?"verified":"candidate"):a.enabled&&a.last_ok_at&&Number(a.recent)>0?"active":"collectable";c.tier=a.tier;}
    return c;
  });
}
export async function checkSource(
  id: string,
  draft: { kind?: string; config?: Record<string, unknown>; tier?: string },
  activate: boolean,
  actor: string,
) {
  const c = (await catalogue()).find((x) => x.id === id);
  if (!c) throw new Error("候选来源不存在");
  let kind = draft.kind ?? c.kind;
  let sourceConfig =
    draft.config ??
    c.config ??
    (c.handle
      ? { query: "from:" + c.handle + " -filter:replies", searchType: "Latest" }
      : {});
  let count = 0;
  try {
    if (kind === "rss" && !sourceConfig.feedUrl && c.originalExample) {
      const page = await guardedFetch(c.originalExample, {
        timeoutMs: 20000,
        maxBytes: 2 * 1024 * 1024,
      });
      if (page.status !== 200)
        throw new Error("示例原文读取失败，待补充订阅入口");
      const $ = load(page.text());
      const href = $("link[rel='alternate']")
        .toArray()
        .filter(
          (n) =>
            /rss|atom/.test($(n).attr("type") ?? "") &&
            !/comments/i.test($(n).attr("href") ?? ""),
        )
        .map((n) => $(n).attr("href"))[0];
      if (!href) throw new Error("原文没有公开订阅入口，待补充采集配置");
      sourceConfig = { feedUrl: new URL(href, c.originalExample).toString() };
    }
    if (kind === "external") {
      if(c.sourceId&&c.kind!=="external") throw new Error("已接入的拉取来源不能直接改成外部推送，请单独登记脚本来源");
      const [source]=await sql`SELECT id FROM sources WHERE id=${c.sourceId??c.id} AND kind='external'`;
      if(!source) throw new Error("尚未收到外部推送；请用本条目录ID作为sourceId调用推送接口，再核验");
      c.sourceId=source.id;
      const [received]=await sql`SELECT count(*)::int n FROM articles a WHERE a.published_at IS NOT NULL AND a.title<>'' AND a.url ~ '^https?://' AND EXISTS (SELECT 1 FROM article_discoveries d WHERE d.article_id=a.id AND d.source_id=${source.id} AND d.via='ingest')`;
      count=received.n;
      sourceConfig={};
    } else if (kind === "mp_account") {
      let ghid = String(sourceConfig.ghid ?? "");
      if (!ghid && c.originalExample?.includes("mp.weixin.qq.com")) {
        const detail = await mpCall(
          "article_detail",
          { url: c.originalExample },
          { url: c.originalExample },
          id,
        );
        ghid = String((detail.response as any).gh_id ?? "");
        await completeReceipt(sql, detail.receiptId);
      }
      if (!ghid)
        throw new Error("待补充公众号原始ID（ghid）或可读取的文章链接");
      sourceConfig = { ghid, nickname: c.name.replace(/^公众号：/, "") };
      const history = await mpHistory(ghid, {
        subject: id,
        window: String(Math.floor(Date.now() / 600000)),
      });
      count = history.posts.filter((p) => p.url && p.post_time).length;
      await completeReceipt(sql, history.receiptId);
    } else if (["rss", "web_list", "json_list", "x_search"].includes(kind)) {
      const preview = await previewSource({
        id,
        kind: kind as never,
        config: sourceConfig,
      });
      count = preview.items.filter((p: any) => p.url && p.publishedAt).length;
    } else throw new Error("待确认采集类型与入口；示例文章地址不是订阅地址");
    if (!count) throw new Error("没有取得带日期的有效条目，保留候选状态");
    Object.assign(c, {
      kind,
      config: sourceConfig,
      tier: draft.tier ?? c.tier ?? "T2",
      status: "verified",
      verifiedAt: new Date().toISOString(),
      lastTestError: null,
    });
    if (activate) {
      if(kind==="external") {
        const [current]=await sql`SELECT updated_at FROM sources WHERE id=${c.sourceId!}`;
        await updateSource(c.sourceId!,{patch:{participation_mode:"editorial",enabled:true,tier:c.tier as "T1"|"T1_5"|"T2"},version:new Date(current.updated_at).toISOString(),reason:"来源目录已核验外部推送"},actor);
        c.awaitingActivation=false;
      } else {
      const created = await createSource(
        {
          id,
          name: c.name,
          kind,
          config: sourceConfig,
          tier: c.tier,
          participation_mode: "editorial",
          site_fulltext: false,
          syndicate_fulltext: false,
          interval_minutes: SOURCE_INTERVAL_MINUTES,
        },
        actor,
      );
      c.sourceId = created.created ? id : created.duplicate.id;
      if (!created.created) {
        const [current] =
          await sql`SELECT updated_at FROM sources WHERE id=${c.sourceId}`;
        await updateSource(
          c.sourceId,
          {
            patch: { enabled: true },
            version: new Date(current.updated_at).toISOString(),
            reason: "来源目录试采成功",
          },
          actor,
        );
      }
      }
      c.status = "collectable";
    }
  } catch (error) {
    c.lastTestError = redactProviderError(error);
  }
  await sql`INSERT INTO hm_source_checks(id,data) VALUES(${id},${sql.json(c as never)}) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`;
  return c;
}

export async function addCandidate(draft:{name:string;platform:string;kind:string;handle?:string;originalExample?:string;config?:Record<string,unknown>;tier?:string;fields?:string[];sourceRole?:string;priority?:boolean}) {
  const handle=draft.handle?.replace(/^@/,"").trim() || (/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([a-zA-Z0-9_]+)/i.exec(draft.originalExample??"")?.[1]) || null;
  const prefix=draft.platform==="公众号"?"公众号：":draft.platform==="X / 推特"?"X：":["网站 / RSS","其他 / 待确认"].includes(draft.platform)?"":draft.platform+"：";
  const name=(prefix && !draft.name.startsWith(prefix)?prefix:"")+draft.name.trim();
  const key=handle?"x:"+handle.toLowerCase():nameKey(name);
  const id="hm-"+digest(key).slice(0,16);
  const existing=(await catalogue()).find(c=>c.id===id || (draft.config&&c.config&&c.kind===draft.kind&&sourceIdentity(c.kind,c.config)===sourceIdentity(draft.kind,draft.config)&&sourceIdentity(draft.kind,draft.config)!==null));
  if(existing) return {created:false,source:existing};
  const c:Candidate={id,name,platform:draft.platform,registered:true,kind:draft.kind,handle,originalExample:draft.originalExample?canonicalUrl(draft.originalExample):null,example:"",priority:!!draft.priority,status:"candidate",config:draft.config??{},tier:draft.tier??"T2",fields:draft.fields??[],sourceRole:draft.sourceRole??"待分类",classificationMethod:"manual"};
  const inserted=await sql`INSERT INTO hm_source_checks(id,data) VALUES(${id},${sql.json(c as never)}) ON CONFLICT(id) DO NOTHING RETURNING id`;
  return {created:!!inserted.length,source:(await catalogue()).find(s=>s.id===id)!};
}
export function cataloguePage(sources:Candidate[],q:Record<string,string>) {
  const words=(q.q??"").normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows=sources.filter(c=>words.every(w=>[c.id,c.sourceId,c.name,c.handle,...(c.aliases??[]),c.originalExample,c.example,c.config?.feedUrl,c.config?.url,c.config?.ghid,c.config?.query].filter(Boolean).join(" ").normalize("NFKC").toLowerCase().includes(w)) && (!q.kind||c.kind===q.kind) && (!q.status||c.status===q.status) && (!q.platform||sourcePlatform(c)===q.platform) && (!q.field||(q.field==="待分类"?!c.fields?.length:c.fields?.includes(q.field))) && (!q.role||c.sourceRole===q.role) && (q.connection!=="connected"||Boolean(c.sourceId)) && (q.connection!=="enabled"||Boolean(c.enabled)) && (q.connection!=="paused"||Boolean(c.sourceId&&!c.enabled)) && (q.connection!=="unconnected"||!c.sourceId));
  const size=[20,50,100].includes(Number(q.pageSize))?Number(q.pageSize):20;
  const groups=SOURCE_PLATFORMS.filter(p=>rows.some(c=>sourcePlatform(c)===p)).map(platform=>{
    const all=rows.filter(c=>sourcePlatform(c)===platform).sort((a,b)=>Number(b.priority)-Number(a.priority)||a.name.localeCompare(b.name,"zh-CN")||a.id.localeCompare(b.id));
    const pageParam="page_"+platform;
    const total=Math.max(1,Math.ceil(all.length/size));
    const number=Math.min(total,Math.max(1,Math.floor(Number(q[pageParam]))||1));
    return {platform,total:all.length,sources:all.slice((number-1)*size,number*size),page:{number,total,count:all.length,size},pageParam};
  });
  return {groups,totals:{all:sources.length,matched:rows.length,connected:new Set(sources.filter(s=>s.sourceId).map(s=>s.sourceId)).size,enabled:new Set(sources.filter(s=>s.enabled&&s.sourceId).map(s=>s.sourceId)).size,active:new Set(sources.filter(s=>s.status==="active"&&s.sourceId).map(s=>s.sourceId)).size},platforms:SOURCE_PLATFORMS.map(name=>({name,count:sources.filter(c=>sourcePlatform(c)===name).length}))};
}
