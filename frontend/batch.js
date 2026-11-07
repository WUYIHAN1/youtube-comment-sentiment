'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let candidates = [], jobs = [], busy = false, stopped = false, screened = false, source = '', batchSource = '';
const metric = value => value == null ? cpText("未公开／未获取", "Unavailable") : Number(value).toLocaleString(cpLocale);
const statuses = {pending:cpText("等待分析", "Queued"),running:cpText("正在分析", "Analyzing"),done:cpText("已完成", "Done"),error:cpText("失败", "Failed")};
function error(message='') {$('batchError').hidden=!message; $('batchError').textContent=message;}
async function api(path, payload) {
  const response=await fetch(path,{method:'POST',headers:cpApiHeaders,body:JSON.stringify(payload)});
  let data; try {data=await response.json();} catch {throw new Error(`${cpText("服务器响应异常（HTTP ", "Unexpected server response (HTTP ")}${response.status}${cpText("）", ")")}`);}
  if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:`${cpText("请求失败（HTTP ", "Request failed (HTTP ")}${response.status}${cpText("）", ")")}`);
  return data;
}
function setBusy(value) {
  busy=value;
  document.querySelectorAll('#selection button,#selection input,#loadChannel,#addUrls,#deepBatch,#exportReport,#retryBatch').forEach(el=>el.disabled=value);
  $('latestAds').disabled=value||!screened;
  $('deepBatch').disabled=value||!jobs.some(j=>j.data);
  $('exportReport').disabled=value||!jobs.some(j=>j.data);
}
function showCandidates() {
  $('selection').hidden=false; $('sourceNote').textContent=source;
  $('candidates').innerHTML=candidates.map((v,i)=>`<article><label><input type="checkbox" data-index="${i}" ${v.selected?'checked':''}> ${escapeHtml(v.title)}</label> <a href="https://www.youtube.com/watch?v=${v.id}${cpText("\" target=\"_blank\" rel=\"noopener\">打开视频", "\" target=\"_blank\" rel=\"noopener\">Watch video")}</a><div class="reason muted">${escapeHtml(v.published_at?.slice(0,10)||cpText("发布日期待分析", "Date pending"))} · ${escapeHtml(v.channel||cpText("自选视频", "Manually added video"))}${cpText(" · 浏览 ", " · Views: ")}${metric(v.view_count)}${cpText(" · 视频点赞 ", " · Video likes: ")}${metric(v.like_count)}</div>${v.ad?`<div class="reason">${escapeHtml({suspected:cpText("疑似广告", "Suspected sponsorship"),unlikely:cpText("未发现明显广告信号", "No clear sponsorship signals"),unknown:cpText("无法判断", "Unclear")}[v.ad.status])}${cpText("：", ": ")}${escapeHtml(v.ad.reason)}${v.ad.evidence?`<blockquote>${escapeHtml(v.ad.evidence)}</blockquote>`:''}</div>`:''}</article>`).join('');
  $('selectedCount').textContent=`${cpText("已选 ", "")}${candidates.filter(v=>v.selected).length}${cpText(" 条，单批最多 10 条", " of 10 videos selected")}`;
  $('latestAds').disabled=busy||!screened;
}
$('candidates').addEventListener('change',e=>{if(e.target.matches('input[data-index]')){candidates[Number(e.target.dataset.index)].selected=e.target.checked; $('selectedCount').textContent=`${cpText("已选 ", "")}${candidates.filter(v=>v.selected).length}${cpText(" 条，单批最多 10 条", " of 10 videos selected")}`;}});
$('loadChannel').onclick=async()=>{
  error(); setBusy(true);
  try {const data=await api('/api/channel-videos',{channel:$('channelInput').value.trim(),limit:Number($('scanLimit').value)}); candidates=data.videos.map((v,i)=>({...v,selected:i<10}));screened=false;source=`${data.channel}${cpText(" · 最近 ", " · Latest ")}${candidates.length}${cpText(" 条公开上传视频（含可能的 Shorts / 直播）", " public uploads (may include Shorts and livestreams)")}`;showCandidates();}
  catch(e){error(e.message);}finally{setBusy(false);}
};
function videoId(value) {
  if(/^[\w-]{11}$/.test(value)) return value;
  let u;try{u=new URL(value);}catch{return null;}
  let id=null;
  if(u.hostname==='youtu.be')id=u.pathname.split('/')[1];
  if(['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname))id=u.searchParams.get('v')||(/^\/(shorts|embed|live)\//.test(u.pathname)?u.pathname.split('/')[2]:null);
  return /^[\w-]{11}$/.test(id||'')?id:null;
}
$('addUrls').onclick=()=>{
  error();const values=$('videoUrls').value.split(/\n/).map(v=>v.trim()).filter(Boolean);const ids=values.map(videoId);
  if(!ids.length||ids.some(id=>!id)){error(cpText("请输入有效的 YouTube 视频链接，每行一个。", "Enter valid YouTube video links, one per line."));return;}
  const unique=[...new Set(ids)];if(unique.length>10){error(cpText("单批最多 10 条视频。", "You can analyze up to 10 videos per batch."));return;}
  candidates=unique.map(id=>({id,title:id,description:'',selected:true}));screened=false;source=cpText("自选视频链接", "Manually added videos");showCandidates();
};
$('latestTen').onclick=()=>{candidates.forEach((v,i)=>v.selected=i<10);showCandidates();};
$('clearSelection').onclick=()=>{candidates.forEach(v=>v.selected=false);showCandidates();};
$('latestAds').onclick=()=>{let n=0;candidates.forEach(v=>v.selected=v.ad?.status==='suspected'&&n++<5);showCandidates();};
$('screenAds').onclick=async()=>{
  error();if(candidates.every(v=>!v.description&&!v.channel)){error(cpText("请先读取频道，再进行标题和简介的 AI 广告初筛。", "Load a channel before screening titles and descriptions for sponsorships."));return;}
  setBusy(true); $('screenAds').textContent=cpText("正在初筛…", "Screening…");
  try {const data=await api('/api/screen-ads',{videos:candidates.map(v=>({id:v.id,title:v.title,description:v.description||''}))});const byId=new Map(data.videos.map(v=>[v.id,v]));candidates.forEach(v=>v.ad=byId.get(v.id));screened=true;showCandidates();}
  catch(e){error(e.message);}finally{$('screenAds').textContent=cpText("AI 初筛疑似广告（调用 DeepSeek）", "Screen for sponsorships with AI (DeepSeek)");setBusy(false);}
};
function showJobs(){
  $('batchOutput').hidden=false;
  const completed=jobs.filter(j=>j.data).length;
  $('progressText').textContent=`${cpText("已完成 ", "Completed ")}${completed}/${jobs.length}${cpText(" · 失败 ", " · Failed: ")}${jobs.filter(j=>j.status==='error').length}${cpText(" 条", "")}${busy?cpText(" · 正在处理，请保持页面打开", " · Processing, please keep this page open"):''}`;
  $('batchRows').innerHTML=jobs.map((j,i)=>`<tr><td>${escapeHtml(j.data?.video.title||j.title)}${j.data?` <button data-detail="${i}${cpText("\">查看详情", "\">View details")}</button>`:''}</td><td>${metric(j.data?.video.view_count??j.view_count)}</td><td>${metric(j.data?.video.like_count??j.like_count)}</td><td>${escapeHtml(j.error||statuses[j.status])}${j.topicError?`<br>${cpText("主题总结失败：", "Topic summary failed: ")}${escapeHtml(j.topicError)}`:''}</td><td>${j.data?.summary.total??'—'}</td>${['positive_pct','neutral_pct','negative_pct'].map(k=>`<td>${j.data?j.data.summary[k]+'%':'—'}</td>`).join('')}</tr>`).join('');
}
async function runJobs(){
  stopped=false;$('stopBatch').textContent=cpText("当前视频结束后停止", "Stop after this video");setBusy(true);error();$('stopBatch').hidden=false;$('retryBatch').hidden=true;
  for(const j of jobs){
    if(stopped)break;if(j.data)continue;j.status='running';j.error='';showJobs();
    try{j.data=await api('/api/batch-item',{url:`https://www.youtube.com/watch?v=${j.id}`});j.status='done';}
    catch(e){j.status='error';j.error=e.message;}
    showJobs();
  }
  setBusy(false);$('stopBatch').hidden=true;$('retryBatch').hidden=!jobs.some(j=>!j.data);showJobs();
}
$('runBatch').onclick=()=>{const selected=candidates.filter(v=>v.selected);if(!selected.length||selected.length>10){error(cpText("请选择 1–10 条视频。", "Select 1–10 videos."));return;}if(jobs.some(j=>j.data)&&!confirm(cpText("开始新批次将替换当前结果，建议先导出报告。继续吗？", "Starting a new batch replaces your current results. Export them first if you want to keep them. Continue?")))return;batchSource=source;jobs=selected.map(v=>({...v,status:'pending'}));$('detail').innerHTML='';runJobs();};
$('retryBatch').onclick=runJobs;
$('stopBatch').onclick=()=>{stopped=true;$('stopBatch').textContent=cpText("将于当前视频结束后停止", "Stopping after this video");};
function topicsHtml(topics){if(!topics)return cpText("<p>未生成 AI 主题总结。</p>", "<p>AI topics have not been generated.</p>");return `<p>${escapeHtml(topics.summary)}</p><h4>${cpText("讨论主题", "Discussion topics")}</h4>${topics.themes.map(t=>`<p><strong>${escapeHtml(t.title)}</strong> · ${escapeHtml(t.tone)}<br>${escapeHtml(t.description)}</p>`).join('')}<h4>${cpText("明确产品需求", "Product requests")}</h4>${(topics.needs||[]).map(n=>`<p><strong>${escapeHtml(n.title)}</strong>${cpText("：", ": ")}${escapeHtml(n.description)}</p>`).join('')||cpText("<p>样本中未发现明确需求。</p>", "<p>No clear product requests were found in the sample.</p>")}`;}
function representativeComments(j, sentiment) {
  const seen = new Set();
  return j.data.comments.filter(c => {
    if (c.sentiment !== sentiment || c.is_reply) return false;
    if (j.data.video.channel_id && c.author_channel_id === j.data.video.channel_id) return false;
    if (typeof c.confidence !== 'number' || c.confidence < 0.6) return false;
    const text = c.text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!text || seen.has(text)) return false;
    if (/^(?:omg[ !,]*)?(?:i[’']?m |i am )?(?:first|second|third)[ !.\d]*$/i.test(text)) return false;
    if (/listen to (?:the|my) voice message|^https?:\/\/\S+$/.test(text)) return false;
    seen.add(text); return true;
  }).sort((a,b) => b.like_count-a.like_count || b.confidence-a.confidence).slice(0,10);
}
function evidenceHtml(j, interactive=false) {
  return cpText("<p class=\"muted\">每类最多 10 条：仅选观众顶层评论，排除创作者本人、重复文本及把握度低于 0.6 的评论，再按点赞数排序。模型标签并非人工确认，尤其非英文评论可能误判；这些是高赞样本，不代表全部观点。</p>", "<p class=\"muted\">Up to 10 top-level viewer comments per category, ranked by likes. The list excludes creator comments, duplicates, and comments with model confidence below 0.6. The model can mislabel comments, especially in languages other than English. This sample reflects the most liked comments that meet these criteria.</p>") + ['positive','neutral','negative'].map(sent=>{
    const list=representativeComments(j,sent);
    const card=c=>`<blockquote>${escapeHtml(c.text)}<footer>${cpText("评论点赞 ", "Comment likes: ")}${c.like_count}${cpText(" · 模型把握度 ", " · Model confidence: ")}${Math.round(c.confidence*100)}% · <a href="https://www.youtube.com/watch?v=${j.id}&amp;lc=${encodeURIComponent(c.id)}${cpText("\" target=\"_blank\" rel=\"noopener\">查看原评论", "\" target=\"_blank\" rel=\"noopener\">View original comment")}</a></footer></blockquote>`;
    const label={positive:cpText("正面", "Positive"),neutral:cpText("中性", "Neutral"),negative:cpText("负面", "Negative")}[sent];
    return `<h4>${label}${cpText("高赞评论（符合筛选条件 ", " comments by likes (")}${list.length}${cpText(" 条", " eligible")}${list.length===10?cpText("，最多展示10条", ", showing up to 10"):''}${cpText('）', ')')}</h4>` + (list.length ? list.slice(0,interactive?5:10).map(card).join('')+(interactive&&list.length>5?`<details><summary>${cpText("展开其余 ", "Show the remaining ")}${list.length-5}${cpText(" 条", " comments")}</summary>${list.slice(5).map(card).join('')}</details>`:'') : cpText("<p>没有符合筛选条件的评论；不等于该视频没有此类观点。</p>", "<p>No comments met the selection criteria.</p>"));
  }).join('');
}
let activeDetailJob = null;
$('batchRows').onclick=e=>{
  const b=e.target.closest('[data-detail]');if(!b)return;
  const j=jobs[Number(b.dataset.detail)];if(!j?.data)return;
  activeDetailJob=j;
  $('modalDetail').innerHTML=cpText("<iframe id=\"detailFrame\" title=\"单视频完整分析详情\" src=\"/?embedded=1&amp;lang=zh-CN\"></iframe>", "<iframe id=\"detailFrame\" title=\"Full video analysis\" src=\"/?embedded=1&amp;lang=en\"></iframe>");
  $('detailDialog').showModal();
};
window.addEventListener('message',e=>{
  const frame=$('detailFrame');
  if(e.origin!==location.origin || !frame || e.source!==frame.contentWindow || !activeDetailJob)return;
  if(e.data?.type==='commentpulse-ready'){
    frame.contentWindow.postMessage({type:'commentpulse-load',data:activeDetailJob.data,topics:activeDetailJob.topics||null},location.origin);
  } else if(e.data?.type==='commentpulse-update'){
    const update=e.data;
    if(update.videoId!==activeDetailJob.id || !Array.isArray(update.comments))return;
    activeDetailJob.data.comments=update.comments;
    activeDetailJob.data.summary=update.summary;
    if(update.topics)activeDetailJob.topics=update.topics;
    showJobs();
  }
});
$('closeDetail').onclick=()=>$('detailDialog').close();
$('detailDialog').addEventListener('close',()=>{activeDetailJob=null;$('modalDetail').innerHTML='';});
$('deepBatch').onclick=async()=>{
  const pending=jobs.filter(j=>j.data&&!j.topics);if(!pending.length){error(cpText("所有已完成视频均已有主题总结。", "All completed videos already have topic summaries."));return;}
  if(!confirm(`${cpText("将为 ", "Generate summaries for ")}${pending.length}${cpText(" 条视频调用 DeepSeek，消耗账户余额。继续吗？", " videos with DeepSeek? This uses your account balance.")}`))return;
  setBusy(true);error();
  for(const j of pending){$('progressText').textContent=`${cpText("正在生成主题总结：", "Generating topics for ")}${j.data.video.title}`;try{const data=await api('/api/batch-topics',{video_title:j.data.video.title,comments:j.data.comments.slice().sort((a,b)=>b.like_count-a.like_count).slice(0,150).map(c=>({id:c.id,text:c.text,like_count:c.like_count,confidence:1})),full_recheck:false});j.topics=data.topics;j.topicError='';}catch(e){j.topicError=e.message;}}
  setBusy(false);showJobs();
};
function reportHtml(){
  const done=jobs.filter(j=>j.data), total=done.reduce((n,j)=>n+j.data.summary.total,0);
  const count=k=>done.reduce((n,j)=>n+j.data.summary[k],0);
  const pct=k=>total?(count(k)/total*100).toFixed(1):'0.0';
  return `<!doctype html><html lang="${cpLocale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cpText("CommentPulse 评论反馈报告", "CommentPulse Feedback Report")}</title><style>body{font:16px/1.7 system-ui,sans-serif;color:#202332;max-width:1000px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.3}h2{border-bottom:2px solid #7665d8;padding-bottom:12px;margin-top:36px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:left}blockquote{border-left:3px solid #7665d8;padding:10px 16px;background:#f7f6fb;white-space:pre-wrap;overflow-wrap:anywhere}footer,.note{font-size:14px;color:#596174}a{color:#5542b3}section{break-inside:auto}tr,blockquote{break-inside:avoid}@media print{body{margin:0;max-width:none}button{display:none}h2,h3{break-after:avoid}a{color:inherit}}</style></head><body><h1>${cpText("视频评论反馈报告", "Video comment feedback report")}</h1><p>${escapeHtml(batchSource)}<br>${cpText("生成时间：", "Generated: ")}${escapeHtml(new Date().toLocaleString(cpLocale))}</p><h2>${cpText("核心发现与范围", "Overview and sample")}</h2><p>${cpText("本批计划分析 ", "Videos selected: ")}${jobs.length}${cpText(" 条视频，完成 ", " · Completed: ")}${done.length}${cpText(" 条，未完成 ", " · Incomplete: ")}${jobs.length-done.length}${cpText(" 条；共分析 ", " · Total: ")}${total.toLocaleString()}${cpText(" 条评论（含回复）。", " comments and replies.")}</p><p>${cpText("按评论条数合计：正面 ", "Combined sentiment: positive ")}${pct('positive')}${cpText("%、中性 ", "%, neutral ")}${pct('neutral')}${cpText("%、负面 ", "%, negative ")}${pct('negative')}${cpText("%。该分布描述评论区整体氛围，不能直接解释为对产品的满意度。", "%. These figures describe the tone of the comments.")}</p><p class="note">${cpText("评论较多的视频在合计中权重更高；请结合逐视频结果阅读。视频发布时间、样本数及选择依据见下表。", "Videos with more comments have more weight in the combined figures. See the table for publication dates, sample sizes, and how the videos were selected.")}</p><h2>${cpText("视频对比", "Video comparison")}</h2><table><thead><tr><th>${cpText("视频／创作者／发布日期", "Video / creator / publication date")}</th><th>${cpText("状态与选择依据", "Status and selection")}</th><th>${cpText("浏览量", "Views")}</th><th>${cpText("视频点赞", "Video likes")}</th><th>${cpText("评论样本", "Sampled comments")}</th><th>${cpText("正／中／负", "Pos / Neu / Neg")}</th></tr></thead><tbody>${jobs.map(j=>`<tr><td><a href="https://www.youtube.com/watch?v=${j.id}">${escapeHtml(j.data?.video.title||j.title)}</a><br>${escapeHtml(j.data?.video.channel||j.channel||'')}<br>${escapeHtml((j.published_at||j.data?.video.published_at)?.slice(0,10)||cpText("未获取", "Unavailable"))}</td><td>${escapeHtml(j.data?cpText("完成", "Complete"):j.error||cpText("未分析", "Pending"))}${j.ad?`<br>${cpText("人工选中；AI 初筛：", "Manually selected. AI screening: ")}${escapeHtml(j.ad.status)}<br>${escapeHtml(j.ad.reason)}`:''}</td><td>${metric(j.data?.video.view_count??j.view_count)}</td><td>${metric(j.data?.video.like_count??j.like_count)}</td><td>${j.data?.summary.total??'—'}</td><td>${j.data?`${j.data.summary.positive_pct}% / ${j.data.summary.neutral_pct}% / ${j.data.summary.negative_pct}%`:'—'}</td></tr>`).join('')}</tbody></table><h2>${cpText("逐视频发现与原文证据", "Findings and original comments by video")}</h2>${done.map((j,i)=>`<section><h3>${i+1}. ${escapeHtml(j.data.video.title)}</h3>${topicsHtml(j.topics)}${j.topicError?`<p>${cpText("主题总结未完成：", "Topic summary incomplete: ")}${escapeHtml(j.topicError)}</p>`:''}${evidenceHtml(j)}</section>`).join('')}<h2>${cpText("分析方法与局限", "Method and limitations")}</h2><p>${cpText("每个视频按热门排序抓取评论，顶层评论数量受服务器配置限制（默认 1,000 条），回复仅有限补全，并非完整评论普查。情感由 Twitter-RoBERTa 逐条分类，可能误判讽刺、混合语言或评价对象。AI 主题总结如已生成，仅基于每条视频最多 150 条高赞评论，不代表全体观众；引述应回到原评论核实。本文没有进行跨视频共同主题的自动归纳，不应将各视频主题当作跨视频共识。", "Comments are fetched by relevance, up to the configured limit for top-level comments (1,000 by default). Only some missing replies are retrieved. Twitter-RoBERTa classifies each comment and may miss sarcasm, mixed languages, or what the comment refers to. When generated, AI summaries use up to 150 of the most liked comments per video. Follow the original comment links to verify quotes. Topics are identified separately for each video.")}</p><p>${cpText("广告初筛仅参考标题及简介，在本次读取的近期视频范围内寻找线索，不能证明或排除商业合作；视频由操作者最终选定。报告不包含评论者姓名。", "AI screening looks for signs of sponsorship in the titles and descriptions of the recent videos loaded. The operator makes the final selection. Commenter names are omitted from the report.")}</p><p>${cpText("CommentPulse · 可在浏览器打印菜单中选择“另存为 PDF”。", "CommentPulse · Use your browser’s print menu to save this report as a PDF.")}</p></body></html>`;
}
$('exportReport').onclick=()=>{const blob=new Blob([reportHtml()],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${cpText("CommentPulse-报告-", "CommentPulse-report-")}${new Date().toISOString().slice(0,10)}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
