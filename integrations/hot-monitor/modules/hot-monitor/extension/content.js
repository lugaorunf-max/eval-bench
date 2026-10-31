(() => {
 if(globalThis.__cexieCollect){globalThis.__cexieCollect.open();return;}
 // Hide an already injected older UI without touching the underlying page.
 const legacy=document.getElementById('hot-monitor-collector-overlay');if(legacy)legacy.style.display='none';
 const host=document.createElement('div');host.id='cexie-library-collector';host.style.cssText='all:initial;position:fixed;right:16px;top:16px;z-index:2147483647';const root=host.attachShadow({mode:'closed'});
 root.innerHTML=`<style>*{box-sizing:border-box}section{width:min(320px,calc(100vw - 32px));font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#292d36;background:white;border:1px solid #e3e5ec;border-radius:18px;box-shadow:0 8px 35px #20253b20;padding:16px}header{display:flex;justify-content:space-between;align-items:center}button,select{font:inherit;border:1px solid #e3e5ec;border-radius:20px;padding:7px 12px;background:white;color:inherit;cursor:pointer}header button{border:0;padding:0 6px}.preview{font-size:13px;max-height:65px;overflow:hidden;color:#7b8495;margin:12px 0}.actions{display:flex;gap:6px;flex-wrap:wrap}.actions button{font-size:12px;padding:6px 8px;white-space:nowrap}.priority{display:flex;align-items:center;gap:6px;font-size:12px;margin:10px 0}.open{display:inline-block;font-size:12px;margin-top:8px;color:#6266f5;text-decoration:none}.actions button{flex:1}.primary{background:#191b20;color:white;border-color:#191b20}select{width:100%;margin-top:12px;font-size:12px}.connect{font-size:12px;color:#6266f5;margin-top:12px;border:0;padding:3px 0}.status{font-size:12px;color:#7b8495;overflow-wrap:anywhere;margin:8px 0 0}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible{outline:2px solid #676bff;outline-offset:2px}</style><section aria-label="测写收集"><header><strong>测写收集</strong><button class="close" aria-label="关闭收集面板">×</button></header><div class="preview"></div><div class="actions"><button class="primary" data-intent="media">收集素材</button><button data-intent="case">收集案例</button><button data-intent="case" data-analyze="true">收集并解析</button></div><select aria-label="关联到"><option value="">全局库 · 不关联文章</option></select><label class="priority"><input type="checkbox"/>标为重点</label><a class="open" target="_blank" rel="noreferrer" hidden>查看收集结果</a><button class="connect">连接此 X 标签供 AI 使用</button><p class="status" role="status"></p></section>`;
 const $=s=>root.querySelector(s);let busy=false;$('.preview').textContent=document.title;$('.connect').hidden=!/^https:\/\/x\.com\//.test(location.href);$('.close').onclick=()=>host.style.display='none';
 const send=async v=>{const r=await chrome.runtime.sendMessage(v);if(!r?.ok)throw Error(r?.error||'操作未完成');return r;};
  function xPostMetadata() {
    if (!/^(?:(?:www|mobile|m)\.)?(?:x|twitter)\.com$/i.test(location.hostname)) return null;
    const current = /^\/[^/]+\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/.exec(location.pathname);
    if (!current) return null;
    const belongsToPost = anchor => {
      try {
        const url = new URL(anchor.getAttribute("href"), location.href);
        const post = /^\/[^/]+\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/.exec(url.pathname);
        return /^(?:(?:www|mobile|m)\.)?(?:x|twitter)\.com$/i.test(url.hostname) && post?.[1] === current[1];
      } catch { return false; }
    };
    // A reply may link or quote the original; use the article's own timestamp/author permalink.
    const article = [...document.querySelectorAll("article")].find(node => [...node.querySelectorAll("a[href]")].some(anchor => belongsToPost(anchor) && (anchor.querySelector("time") || anchor.closest('[data-testid="User-Name"]'))));
    const text = article?.querySelector('[data-testid="tweetText"]')?.textContent?.trim();
    if (!article || !text) throw new Error("当前原帖文字尚未加载，请等待原帖显示完整后再点击保存，避免收集到回复或通用X页面。");
    const authorNode = article.querySelector('[data-testid="User-Name"]');
    const author = (authorNode?.innerText || authorNode?.textContent || "").replace(/\s+/g," ").trim();
    const time = [...article.querySelectorAll("a[href]")].find(anchor => belongsToPost(anchor) && anchor.querySelector("time"))?.querySelector("time")?.getAttribute("datetime") || "";
    const photo = [...article.querySelectorAll('[data-testid="tweetPhoto"] img[src]')].map(image => image.getAttribute("src")).find(value => {
      try { const url = new URL(value,location.href); return url.protocol === "https:" && url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/"); } catch { return false; }
    });
    const cover = photo || article.querySelector("video[poster]")?.getAttribute("poster") || "";
    return {url:location.href,title:text.slice(0,300),summary:text,author,publishedAt:time,cover};
  }
  function metadata() {
    const post = xPostMetadata();
    if (post) return post;
    const meta = key => [...document.querySelectorAll("meta")].find(node => [node.getAttribute("property"),node.getAttribute("name")].some(value => value?.toLowerCase() === key))?.getAttribute("content")?.trim() || "";
    return {url:location.href,pageTitle:document.title,heading:document.querySelector("h1")?.textContent??"",title:meta("og:title") || meta("twitter:title") || document.title,author:meta("author") || meta("article:author"),summary:meta("og:description") || meta("description") || meta("twitter:description"),publishedAt:meta("article:published_time"),cover:meta("og:image") || meta("twitter:image")};
  }

 async function targets(){try{const data=await send({type:'HM_LIBRARY_TARGETS'});for(const [kind,label]of [['articles','文章']]){const group=document.createElement('optgroup');group.label=label;for(const v of data[kind]||[]){const o=document.createElement('option');o.value=(kind==='articles'?'article:':'event:')+v.id;o.textContent=v.title;group.append(o);}root.querySelector('select').append(group);}if(data.currentArticleId)root.querySelector('select').value='article:'+data.currentArticleId;}catch(e){$('.status').textContent=e.message;}}
 let priorityTouched=false;root.querySelector('.priority input').addEventListener('change',()=>priorityTouched=true);root.querySelector('[data-analyze]').addEventListener('mouseenter',()=>{if(!priorityTouched)root.querySelector('.priority input').checked=true;});
 root.querySelectorAll('[data-intent]').forEach(button=>button.addEventListener('click',async event=>{if(!event.isTrusted||busy)return;busy=true;if(button.dataset.analyze==='true'&&!priorityTouched)root.querySelector('.priority input').checked=true;root.querySelectorAll('[data-intent]').forEach(b=>b.disabled=true);$('.status').textContent='正在保存…';try{const r=await send({type:'HM_LIBRARY_SAVE',intent:button.dataset.intent,analyze:button.dataset.analyze==='true',priority:root.querySelector('.priority input').checked,destination:root.querySelector('select').value,item:metadata()});$('.status').textContent=r.message;const article=root.querySelector('select').value.replace(/^article:/,'');$('.open').href='http://127.0.0.1:43110/'+(root.querySelector('select').value.startsWith('article:')?'articles/'+article:button.dataset.intent==='case'?'?library=candidate':'materials');$('.open').hidden=false;const job=r.result?.job||(r.result?.kind?r.result:null);if(job?.id){const timer=setInterval(async()=>{if(!host.isConnected||host.style.display==='none'){clearInterval(timer);return;}try{const state=(await send({type:'HM_LIBRARY_JOB',id:job.id})).job;$('.status').textContent=state.error||state.phase||(state.status==='complete'?'处理完成':'处理中');if(state.status!=='running')clearInterval(timer);}catch{clearInterval(timer);}},2500);}}catch(e){$('.status').textContent=e.message;}finally{busy=false;root.querySelectorAll('[data-intent]').forEach(b=>b.disabled=false);}}));
 $('.connect').addEventListener('click',async event=>{if(!event.isTrusted)return;try{const r=await send({type:'HM_LIBRARY_CONNECT'});$('.status').textContent=r.message;}catch(e){$('.status').textContent=e.message;}});
 function open(){host.style.display='block';$('.preview').textContent=document.title;}
 globalThis.__cexieCollect={open};chrome.runtime.onMessage.addListener(message=>{if(message.type==='HM_LIBRARY_SHOW')open();});document.documentElement.append(host);void targets();
})();
