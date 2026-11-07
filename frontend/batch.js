'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let candidates = [], jobs = [], busy = false, stopped = false, screened = false, source = '', batchSource = '';
const metric = value => value == null ? '未公开／未获取' : Number(value).toLocaleString('zh-CN');
const statuses = {pending:'等待分析',running:'正在分析',done:'已完成',error:'失败'};
function error(message='') {$('batchError').hidden=!message; $('batchError').textContent=message;}
async function api(path, payload) {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  let data; try {data=await response.json();} catch {throw new Error(`服务器响应异常（HTTP ${response.status}）`);}
  if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:`请求失败（HTTP ${response.status}）`);
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
  $('candidates').innerHTML=candidates.map((v,i)=>`<article><label><input type="checkbox" data-index="${i}" ${v.selected?'checked':''}> ${escapeHtml(v.title)}</label> <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">打开视频</a><div class="reason muted">${escapeHtml(v.published_at?.slice(0,10)||'发布日期待分析')} · ${escapeHtml(v.channel||'自选视频')} · 浏览 ${metric(v.view_count)} · 视频点赞 ${metric(v.like_count)}</div>${v.ad?`<div class="reason">${escapeHtml({suspected:'疑似广告',unlikely:'未发现明显广告信号',unknown:'无法判断'}[v.ad.status])}：${escapeHtml(v.ad.reason)}${v.ad.evidence?`<blockquote>${escapeHtml(v.ad.evidence)}</blockquote>`:''}</div>`:''}</article>`).join('');
  $('selectedCount').textContent=`已选 ${candidates.filter(v=>v.selected).length} 条，单批最多 10 条`;
  $('latestAds').disabled=busy||!screened;
}
$('candidates').addEventListener('change',e=>{if(e.target.matches('input[data-index]')){candidates[Number(e.target.dataset.index)].selected=e.target.checked; $('selectedCount').textContent=`已选 ${candidates.filter(v=>v.selected).length} 条，单批最多 10 条`;}});
$('loadChannel').onclick=async()=>{
  error(); setBusy(true);
  try {const data=await api('/api/channel-videos',{channel:$('channelInput').value.trim(),limit:Number($('scanLimit').value)}); candidates=data.videos.map((v,i)=>({...v,selected:i<10}));screened=false;source=`${data.channel} · 最近 ${candidates.length} 条公开上传视频（含可能的 Shorts / 直播）`;showCandidates();}
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
  if(!ids.length||ids.some(id=>!id)){error('请输入有效的 YouTube 视频链接，每行一个。');return;}
  const unique=[...new Set(ids)];if(unique.length>10){error('单批最多 10 条视频。');return;}
  candidates=unique.map(id=>({id,title:id,description:'',selected:true}));screened=false;source='自选视频链接';showCandidates();
};
$('latestTen').onclick=()=>{candidates.forEach((v,i)=>v.selected=i<10);showCandidates();};
$('clearSelection').onclick=()=>{candidates.forEach(v=>v.selected=false);showCandidates();};
$('latestAds').onclick=()=>{let n=0;candidates.forEach(v=>v.selected=v.ad?.status==='suspected'&&n++<5);showCandidates();};
$('screenAds').onclick=async()=>{
  error();if(candidates.every(v=>!v.description&&!v.channel)){error('请先读取频道，再进行标题和简介的 AI 广告初筛。');return;}
  setBusy(true); $('screenAds').textContent='正在初筛…';
  try {const data=await api('/api/screen-ads',{videos:candidates.map(v=>({id:v.id,title:v.title,description:v.description||''}))});const byId=new Map(data.videos.map(v=>[v.id,v]));candidates.forEach(v=>v.ad=byId.get(v.id));screened=true;showCandidates();}
  catch(e){error(e.message);}finally{$('screenAds').textContent='AI 初筛疑似广告（调用 DeepSeek）';setBusy(false);}
};
function showJobs(){
  $('batchOutput').hidden=false;
  const completed=jobs.filter(j=>j.data).length;
  $('progressText').textContent=`已完成 ${completed}/${jobs.length} · 失败 ${jobs.filter(j=>j.status==='error').length} 条${busy?' · 正在处理，请保持页面打开':''}`;
  $('batchRows').innerHTML=jobs.map((j,i)=>`<tr><td>${escapeHtml(j.data?.video.title||j.title)}${j.data?` <button data-detail="${i}">查看详情</button>`:''}</td><td>${metric(j.data?.video.view_count??j.view_count)}</td><td>${metric(j.data?.video.like_count??j.like_count)}</td><td>${escapeHtml(j.error||statuses[j.status])}${j.topicError?`<br>主题总结失败：${escapeHtml(j.topicError)}`:''}</td><td>${j.data?.summary.total??'—'}</td>${['positive_pct','neutral_pct','negative_pct'].map(k=>`<td>${j.data?j.data.summary[k]+'%':'—'}</td>`).join('')}</tr>`).join('');
}
async function runJobs(){
  stopped=false;$('stopBatch').textContent='当前视频结束后停止';setBusy(true);error();$('stopBatch').hidden=false;$('retryBatch').hidden=true;
  for(const j of jobs){
    if(stopped)break;if(j.data)continue;j.status='running';j.error='';showJobs();
    try{j.data=await api('/api/batch-item',{url:`https://www.youtube.com/watch?v=${j.id}`});j.status='done';}
    catch(e){j.status='error';j.error=e.message;}
    showJobs();
  }
  setBusy(false);$('stopBatch').hidden=true;$('retryBatch').hidden=!jobs.some(j=>!j.data);showJobs();
}
$('runBatch').onclick=()=>{const selected=candidates.filter(v=>v.selected);if(!selected.length||selected.length>10){error('请选择 1–10 条视频。');return;}if(jobs.some(j=>j.data)&&!confirm('开始新批次将替换当前结果，建议先导出报告。继续吗？'))return;batchSource=source;jobs=selected.map(v=>({...v,status:'pending'}));$('detail').innerHTML='';runJobs();};
$('retryBatch').onclick=runJobs;
$('stopBatch').onclick=()=>{stopped=true;$('stopBatch').textContent='将于当前视频结束后停止';};
function topicsHtml(topics){if(!topics)return '<p>未生成 AI 主题总结。</p>';return `<p>${escapeHtml(topics.summary)}</p><h4>讨论主题</h4>${topics.themes.map(t=>`<p><strong>${escapeHtml(t.title)}</strong> · ${escapeHtml(t.tone)}<br>${escapeHtml(t.description)}</p>`).join('')}<h4>明确产品需求</h4>${(topics.needs||[]).map(n=>`<p><strong>${escapeHtml(n.title)}</strong>：${escapeHtml(n.description)}</p>`).join('')||'<p>样本中未发现明确需求。</p>'}`;}
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
  return '<p class="muted">每类最多 10 条：仅选观众顶层评论，排除创作者本人、重复文本及把握度低于 0.6 的评论，再按点赞数排序。模型标签并非人工确认，尤其非英文评论可能误判；这些是高赞样本，不代表全部观点。</p>' + ['positive','neutral','negative'].map(sent=>{
    const list=representativeComments(j,sent);
    const card=c=>`<blockquote>${escapeHtml(c.text)}<footer>评论点赞 ${c.like_count} · 模型把握度 ${Math.round(c.confidence*100)}% · <a href="https://www.youtube.com/watch?v=${j.id}&amp;lc=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">查看原评论</a></footer></blockquote>`;
    const label={positive:'正面',neutral:'中性',negative:'负面'}[sent];
    return `<h4>${label}高赞评论（符合筛选条件 ${list.length} 条${list.length===10?'，最多展示10条':''}）</h4>` + (list.length ? list.slice(0,interactive?5:10).map(card).join('')+(interactive&&list.length>5?`<details><summary>展开其余 ${list.length-5} 条</summary>${list.slice(5).map(card).join('')}</details>`:'') : '<p>没有符合筛选条件的评论；不等于该视频没有此类观点。</p>');
  }).join('');
}
let activeDetailJob = null;
$('batchRows').onclick=e=>{
  const b=e.target.closest('[data-detail]');if(!b)return;
  const j=jobs[Number(b.dataset.detail)];if(!j?.data)return;
  activeDetailJob=j;
  $('modalDetail').innerHTML='<iframe id="detailFrame" title="单视频完整分析详情" src="/?embedded=1"></iframe>';
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
  const pending=jobs.filter(j=>j.data&&!j.topics);if(!pending.length){error('所有已完成视频均已有主题总结。');return;}
  if(!confirm(`将为 ${pending.length} 条视频调用 DeepSeek，消耗账户余额。继续吗？`))return;
  setBusy(true);error();
  for(const j of pending){$('progressText').textContent=`正在生成主题总结：${j.data.video.title}`;try{const data=await api('/api/batch-topics',{video_title:j.data.video.title,comments:j.data.comments.slice().sort((a,b)=>b.like_count-a.like_count).slice(0,150).map(c=>({id:c.id,text:c.text,like_count:c.like_count,confidence:1})),full_recheck:false});j.topics=data.topics;j.topicError='';}catch(e){j.topicError=e.message;}}
  setBusy(false);showJobs();
};
function reportHtml(){
  const done=jobs.filter(j=>j.data), total=done.reduce((n,j)=>n+j.data.summary.total,0);
  const count=k=>done.reduce((n,j)=>n+j.data.summary[k],0);
  const pct=k=>total?(count(k)/total*100).toFixed(1):'0.0';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CommentPulse 评论反馈报告</title><style>body{font:16px/1.7 system-ui,sans-serif;color:#202332;max-width:1000px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.3}h2{border-bottom:2px solid #7665d8;padding-bottom:12px;margin-top:36px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:left}blockquote{border-left:3px solid #7665d8;padding:10px 16px;background:#f7f6fb;white-space:pre-wrap;overflow-wrap:anywhere}footer,.note{font-size:14px;color:#596174}a{color:#5542b3}section{break-inside:auto}tr,blockquote{break-inside:avoid}@media print{body{margin:0;max-width:none}button{display:none}h2,h3{break-after:avoid}a{color:inherit}}</style></head><body><h1>视频评论反馈报告</h1><p>${escapeHtml(batchSource)}<br>生成时间：${escapeHtml(new Date().toLocaleString('zh-CN'))}</p><h2>核心发现与范围</h2><p>本批计划分析 ${jobs.length} 条视频，完成 ${done.length} 条，未完成 ${jobs.length-done.length} 条；共分析 ${total.toLocaleString()} 条评论（含回复）。</p><p>按评论条数合计：正面 ${pct('positive')}%、中性 ${pct('neutral')}%、负面 ${pct('negative')}%。该分布描述评论区整体氛围，不能直接解释为对产品的满意度。</p><p class="note">评论较多的视频在合计中权重更高；请结合逐视频结果阅读。视频发布时间、样本数及选择依据见下表。</p><h2>视频对比</h2><table><thead><tr><th>视频／创作者／发布日期</th><th>状态与选择依据</th><th>浏览量</th><th>视频点赞</th><th>评论样本</th><th>正／中／负</th></tr></thead><tbody>${jobs.map(j=>`<tr><td><a href="https://www.youtube.com/watch?v=${j.id}">${escapeHtml(j.data?.video.title||j.title)}</a><br>${escapeHtml(j.data?.video.channel||j.channel||'')}<br>${escapeHtml((j.published_at||j.data?.video.published_at)?.slice(0,10)||'未获取')}</td><td>${escapeHtml(j.data?'完成':j.error||'未分析')}${j.ad?`<br>人工选中；AI 初筛：${escapeHtml(j.ad.status)}<br>${escapeHtml(j.ad.reason)}`:''}</td><td>${metric(j.data?.video.view_count??j.view_count)}</td><td>${metric(j.data?.video.like_count??j.like_count)}</td><td>${j.data?.summary.total??'—'}</td><td>${j.data?`${j.data.summary.positive_pct}% / ${j.data.summary.neutral_pct}% / ${j.data.summary.negative_pct}%`:'—'}</td></tr>`).join('')}</tbody></table><h2>逐视频发现与原文证据</h2>${done.map((j,i)=>`<section><h3>${i+1}. ${escapeHtml(j.data.video.title)}</h3>${topicsHtml(j.topics)}${j.topicError?`<p>主题总结未完成：${escapeHtml(j.topicError)}</p>`:''}${evidenceHtml(j)}</section>`).join('')}<h2>分析方法与局限</h2><p>每个视频按热门排序抓取评论，顶层评论数量受服务器配置限制（默认 1,000 条），回复仅有限补全，并非完整评论普查。情感由 Twitter-RoBERTa 逐条分类，可能误判讽刺、混合语言或评价对象。AI 主题总结如已生成，仅基于每条视频最多 150 条高赞评论，不代表全体观众；引述应回到原评论核实。本文没有进行跨视频共同主题的自动归纳，不应将各视频主题当作跨视频共识。</p><p>广告初筛仅参考标题及简介，在本次读取的近期视频范围内寻找线索，不能证明或排除商业合作；视频由操作者最终选定。报告不包含评论者姓名。</p><p>CommentPulse · 可在浏览器打印菜单中选择“另存为 PDF”。</p></body></html>`;
}
$('exportReport').onclick=()=>{const blob=new Blob([reportHtml()],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`CommentPulse-报告-${new Date().toISOString().slice(0,10)}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
