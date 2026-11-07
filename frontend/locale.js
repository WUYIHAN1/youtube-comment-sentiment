// An explicit link takes precedence over the saved preference and browser language.
const cpLocale = (() => {
  const requested = new URLSearchParams(location.search).get("lang");
  if (requested === "en" || requested === "zh-CN") return requested;
  try {
    const saved = localStorage.getItem("commentpulse_locale");
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "zh-CN";
})();
const cpText = (zh, en) => cpLocale === "en" ? en : zh;
const cpApiHeaders = { "Content-Type": "application/json", "Accept-Language": cpLocale };
const cpUrl = (path) => {
  const url = new URL(path, location.origin);
  url.searchParams.set("lang", cpLocale);
  return url.pathname + url.search + url.hash;
};

function localizePage() {
  const en = {
    "批量分析": "Batch analysis",
    "YouTube API 每日配额用量（本地估算，非 Google 官方数字）": "Daily YouTube API quota usage (local estimate)",
    "查询余额 —": "Quota used —",
    "粘贴 YouTube 视频链接，例如 https://www.youtube.com/watch?v=...": "Paste a YouTube video link, e.g. https://www.youtube.com/watch?v=...",
    "YouTube 视频链接": "YouTube video link",
    "分析": "Analyze",
    "粘贴一个 YouTube 视频链接，点「分析」开始": "Paste a YouTube video link and click Analyze to begin.",
    "首次分析会自动下载 Twitter-RoBERTa 模型（约 500MB），只需一次。": "The first analysis downloads the Twitter-RoBERTa model (about 500 MB). This happens once.",
    "页内导航": "On this page",
    "视频": "Video",
    "概览": "Overview",
    "情感分布": "Sentiment breakdown",
    "AI 深度分析": "AI deep analysis",
    "高频词": "Common words",
    "代表性评论": "Representative comments",
    "全部评论": "All comments",
    "历史记录": "History",
    "总评论": "Total comments",
    "含回复": "Includes replies",
    "平均情感分": "Average sentiment score",
    "范围 −1 ~ +1": "Range −1 to +1",
    "正面": "Positive",
    "中性": "Neutral",
    "负面": "Negative",
    "判断的是": "The model measures the",
    "评论文本本身的语气": "tone of the comment itself",
    "，不是\"是否认同视频\"——比如视频在批判某件事，评论写\"这也太离谱了\"是在附和视频，但文本语气本身是负面的，会被计入负面。讽刺、反语也是模型的弱项。下面的 AI 深度分析会结合视频语境判断，能改善这类情况。": ". For example, “This is ridiculous” may agree with a critical video while still sounding negative. The model can also miss sarcasm or irony. AI deep analysis uses the video title to help interpret the context.",
    "对把握度较低的评论用 DeepSeek 结合视频标题重新判断，并生成评论区讨论主题总结。": "DeepSeek reviews low-confidence comments using the video title and summarizes the main topics.",
    "复核所有评论（可选）": "Review all comments (optional)",
    "🤖 深度分析": "🤖 Run deep analysis",
    "情感主题": "Discussion themes",
    "产品需求": "Product requests",
    "从评论里提炼的具体功能建议/产品需求——测评类视频通常能挖出一些， 纯娱乐/教程类视频评论区一般没有这类内容，为空是正常情况，不代表分析出错。": "Suggestions and feature requests from the comments. These are more common on product reviews than on entertainment videos or tutorials.",
    "这条视频的评论区里没有发现明显的功能建议/产品需求。": "No clear feature suggestions or product requests were found in the comments.",
    "各情感类别高频词": "Common words by sentiment",
    "观众高赞评论（每类最多10条）": "Most liked viewer comments (up to 10 per category)",
    "最正面 · 按点赞排序": "Top positive comments · by likes",
    "最负面 · 按点赞排序": "Top negative comments · by likes",
    "⬇ 导出 CSV": "⬇ Export CSV",
    "包含原文、翻译（若已生成）、点赞、情感、把握度、AI 复核理由": "Includes original text, any translations, likes, sentiment, confidence, and AI review reasons",
    "搜关键词，比如 bambu lab……看含这个词的评论都是什么情感": "Search comments by keyword, e.g. Bambu Lab",
    "搜索评论关键词": "Search comments by keyword",
    "清除": "Clear",
    "按情感筛选": "Filter by sentiment",
    "全部": "All",
    "只看低把握度（<0.6，": "Low confidence only (<0.6,",
    "条）": "comments)",
    "展示": "Showing",
    "条 · 点击表头排序": "comments · Click a column heading to sort",
    "作者": "Author",
    "评论": "Comment",
    "👍 点赞": "👍 Likes",
    "情感": "Sentiment",
    "模型对这个标签有多确定，不代表判断一定准确": "How certain the model is about its label",
    "把握度（置信度）": "Confidence",
    "批量分析 · CommentPulse": "Batch analysis · CommentPulse",
    "← 单视频分析": "← Single video analysis",
    "批量视频分析": "Batch video analysis",
    "选择视频，比较评论反馈，导出可独立打开的 HTML 报告。结果仅保留在当前页面，刷新前请导出。": "Choose videos, compare viewer feedback, and export a standalone HTML report. Results are stored on this page until you refresh, so export them first.",
    "1. 添加视频": "1. Add videos",
    "YouTube 频道链接或 @账号": "YouTube channel link or @handle",
    "频道链接": "Channel link",
    "查看最近": "Recent videos:",
    "条": "",
    "读取频道": "Load channel",
    "或粘贴自选视频链接，每行一个（最多 10 条，可跨创作者）": "Or paste up to 10 video links, one per line. They can be from different channels.",
    "自选视频链接": "Video links",
    "使用这些视频": "Use these videos",
    "2. 确认视频": "2. Confirm videos",
    "选最近 10 条": "Select latest 10",
    "AI 初筛疑似广告（调用 DeepSeek）": "Screen for sponsorships with AI (DeepSeek)",
    "选最近 5 条疑似广告": "Select latest 5 suspected sponsorships",
    "取消全选": "Clear selection",
    "AI 仅阅读标题和简介，不观看视频；疑似广告并不代表已证实商业合作。请核对依据并勾选确认。仅在本次读取的范围内筛选，可能不足 5 条。": "AI screens titles and descriptions for signs of sponsorship. Review the evidence and confirm your selection. The videos loaded may contain fewer than five matches.",
    "分析选中视频": "Analyze selected videos",
    "3. 分析结果": "3. Results",
    "当前视频结束后停止": "Stop after this video",
    "重试失败／继续未完成视频": "Retry or resume unfinished videos",
    "生成各视频 AI 主题总结": "Generate AI topics for each video",
    "导出 HTML 报告": "Export HTML report",
    "按顺序分析，每条可能需要约一分钟。普通分析不调用 DeepSeek；主题总结为可选付费操作，按高赞评论样本生成，失败可再次点击补全。": "Videos are analyzed in order and may take about a minute each. AI topic summaries are optional, use DeepSeek credits, and draw on the most liked comments. Run summaries again to retry any that failed.",
    "浏览量": "Views",
    "视频点赞": "Video likes",
    "状态": "Status",
    "评论样本": "Sampled comments",
    "单视频完整分析详情": "Full video analysis",
    "关闭详情": "Close details",
  };
  document.documentElement.lang = cpLocale;
  if (cpLocale === "en") {
    const translate = (value) => {
      const key = value.trim().replace(/\s+/g, " ");
      return Object.hasOwn(en, key) ? en[key] : undefined;
    };
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest("script, style")) continue;
      const translated = translate(node.nodeValue);
      if (translated !== undefined) {
        node.nodeValue = node.nodeValue.replace(/\S[\s\S]*\S|\S/, () => translated);
      }
    }
    for (const el of document.querySelectorAll("[placeholder], [aria-label], [title]")) {
      for (const attr of ["placeholder", "aria-label", "title"]) {
        const value = el.getAttribute(attr);
        const translated = value === null ? undefined : translate(value);
        if (translated !== undefined) el.setAttribute(attr, translated);
      }
    }
  }
  for (const link of document.querySelectorAll("[data-locale-link]")) {
    link.href = cpUrl(link.getAttribute("href"));
  }
  const toggle = document.getElementById("languageToggle");
  toggle.textContent = cpText("English", "中文");
  toggle.addEventListener("click", () => {
    const hasResults = ["results", "selection"].some((id) => document.getElementById(id)?.hidden === false);
    if (hasResults && !confirm(cpText(
      "切换语言会重新加载页面并清除当前结果。继续吗？",
      "Changing the language reloads the page and clears the current results. Continue?"
    ))) return;
    const next = cpText("en", "zh-CN");
    try { localStorage.setItem("commentpulse_locale", next); } catch {}
    const url = new URL(location.href);
    url.searchParams.set("lang", next);
    location.assign(url);
  });
}

localizePage();
