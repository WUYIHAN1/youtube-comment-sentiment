const form = document.getElementById("qform");
const urlInput = document.getElementById("url");
const btn = document.getElementById("analyzeBtn");
const prog = document.getElementById("progress");
const progressLabel = document.getElementById("progressLabel");
const progressFill = document.getElementById("progressFill");
const errorBox = document.getElementById("errorBox");
const emptyState = document.getElementById("emptyState");
const resultsEl = document.getElementById("results");

// 双保险：字体真正加载完成后（可能晚于第一次渲染）再全量重新判定一次哪些评论被截断了，
// 避免"用后备字体量出来当时没溢出，换字体后其实溢出了"的情况一直没人发现。
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    if (typeof markOverflowingCells === "function") markOverflowingCells();
  });
}

const SENT = {
  positive: { label: cpText("正面", "Positive"), cls: "pos" },
  neutral: { label: cpText("中性", "Neutral"), cls: "neu" },
  negative: { label: cpText("负面", "Negative"), cls: "neg" },
};
const nf = (n) => Number(n).toLocaleString(cpLocale);
const translationField = cpText("text_zh", "text_en");
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = {
  comments: [],
  filter: "all",
  sort: { k: "like_count", dir: -1 },
  search: "",
  videoTitle: "",
};

// ---- 历史记录：纯前端存 localStorage，只存标题/封面这类轻量信息，不缓存评论数据 ----
// 点历史记录里的某一条等于重新分析一次（会再花一次 YouTube/DeepSeek 调用），不是读缓存。
const HISTORY_KEY = "commentpulse_history";
const HISTORY_MAX = 20;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistoryEntry(video) {
  try {
    const list = loadHistory().filter((h) => h.id !== video.id);
    list.unshift({ id: video.id, title: video.title, thumbnail: video.thumbnail });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {
    // 存储失败（比如隐私模式）不影响主流程，安静跳过
  }
  renderHistory();
}

function renderHistory() {
  const list = loadHistory();
  document.getElementById("historyBar").hidden = list.length === 0;
  document.getElementById("historyList").innerHTML = list
    .map(
      (h) => `
      <button type="button" class="history-item" data-id="${esc(h.id)}" title="${esc(h.title)}">
        <span class="history-thumb" style="${h.thumbnail ? `background-image:url('${esc(h.thumbnail)}')` : ""}"></span>
        <span class="history-title">${esc(h.title)}</span>
      </button>`
    )
    .join("");
}

document.getElementById("historyList").addEventListener("click", (e) => {
  const item = e.target.closest(".history-item");
  if (!item) return;
  urlInput.value = `https://www.youtube.com/watch?v=${item.dataset.id}`;
  form.requestSubmit();
});

renderHistory();

// 用户名遮蔽：**始终生效，没有开关**（2026-09-12 用户明确要求：默认隐藏，且不可显示原名）。
// 保留开头几个字符（含 @），其余统一换成 3 个星号——不暴露真实长度。CSV 导出也走这个函数，
// 所以导出的文件里也是脱敏后的名字，不会绕过这条规则。
function displayAuthor(author) {
  if (!author) return author;
  const at = author.startsWith("@") ? "@" : "";
  const rest = at ? author.slice(1) : author;
  return at + rest.slice(0, 2) + "***";
}

// 评论展示文本：这条评论自己翻译过、且当前切到"显示中文"时显示译文，否则显示原文。
// 逐条翻译（点评论旁边的"翻译"才会调用 API），不是全局一键翻译，所以状态挂在每条评论对象上。
function displayText(c) {
  return c.showTranslation && c[translationField] ? c[translationField] : c.text;
}

const searchBox = document.getElementById("searchBox");
const searchClear = document.getElementById("searchClear");
const searchStats = document.getElementById("searchStats");

const deepBtn = document.getElementById("deepBtn");
const deepProgress = document.getElementById("deepProgress");
const deepProgressFill = document.getElementById("deepProgressFill");
const deepProgressLabel = document.getElementById("deepProgressLabel");
const deepErrorBox = document.getElementById("deepErrorBox");
const deepResults = document.getElementById("deepResults");
const fullRecheckToggle = document.getElementById("fullRecheckToggle");

function updateDeepEstimate() {
  const total = state.comments.length;
  const lowConf = state.comments.filter((c) => c.confidence < LOW_CONF_THRESHOLD).length;
  const full = fullRecheckToggle.checked;
  document.getElementById("deepDesc").textContent = full
    ? `${cpText("对全部 ", "Review all ")}${nf(total)}${cpText(" 条评论用 DeepSeek 结合视频标题重新判断，并生成评论区讨论主题总结。", " comments with DeepSeek using the video title, and summarize the main topics.")}`
    : `${cpText("对把握度较低的 ", "Review ")}${nf(lowConf)}${cpText(" 条评论用 DeepSeek 结合视频标题重新判断，并生成评论区讨论主题总结。", " low-confidence comments with DeepSeek using the video title, and summarize the main topics.")}`;
}
fullRecheckToggle.addEventListener("change", updateDeepEstimate);

// ---- 进度动画（真实进度拿不到具体百分比，用轮播文案表达当前阶段）----
let progTimer = null;
const STEPS = [cpText("正在解析视频…", "Reading video link…"), cpText("正在抓取评论（含回复）…", "Fetching comments and replies…"), cpText("本地 Twitter-RoBERTa 打分中…", "Scoring comments with Twitter-RoBERTa…"), cpText("整理结果…", "Preparing results…")];

function startProgress() {
  prog.classList.add("on");
  let i = 0;
  progressFill.style.width = "10%";
  progressLabel.textContent = STEPS[0];
  progTimer = setInterval(() => {
    i = Math.min(i + 1, STEPS.length - 1);
    progressLabel.textContent = STEPS[i];
    progressFill.style.width = Math.min(88, 15 + i * 24) + "%";
  }, 1500);
}

function stopProgress() {
  clearInterval(progTimer);
  progressFill.style.width = "100%";
  setTimeout(() => {
    prog.classList.remove("on");
    progressFill.style.width = "0%";
  }, 250);
}

async function readApiResponse(res) {
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`${cpText("服务器响应异常（HTTP ", "Unexpected server response (HTTP ")}${res.status}${cpText("），请稍后重试", "). Please try again.")}`);
  }
  if (!res.ok) throw new Error(data.detail || `${cpText("请求失败（HTTP ", "Request failed (HTTP ")}${res.status}${cpText("）", ")")}`);
  return data;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  errorBox.hidden = true;
  btn.disabled = true;
  startProgress();

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: cpApiHeaders,
      body: JSON.stringify({ url }),
    });
    const data = await readApiResponse(res);
    if (!res.ok) {
      throw new Error(data.detail || cpText("分析失败，请稍后再试", "Analysis failed. Please try again."));
    }
    render(data);
    refreshQuota();
  } catch (err) {
    errorBox.hidden = false;
    errorBox.textContent = "⚠ " + err.message;
    resultsEl.hidden = true;
    emptyState.hidden = false;
  } finally {
    stopProgress();
    btn.disabled = false;
  }
});

// YouTube API 配额用量——本地估算，不是 Google 的权威数字（他们没开放查询接口）。
// 页面一加载就查一次，每次分析完再刷新一次。
async function refreshQuota() {
  try {
    const res = await fetch("/api/quota");
    if (!res.ok) return;
    const q = await res.json();
    const pct = q.cap ? Math.min(100, Math.round((q.used / q.cap) * 100)) : 0;
    const pill = document.getElementById("quotaPill");
    pill.hidden = false;
    pill.classList.toggle("warn", pct >= 80);
    document.getElementById("quotaText").textContent = `${cpText("查询余额 ", "Quota used ")}${nf(q.used)}/${nf(q.cap)}`;
    document.getElementById("quotaBarFill").style.width = pct + "%";
  } catch (err) {
    // 配额面板只是个参考信息，查不到就悄悄跳过，不打扰主流程
  }
}
refreshQuota();

function render(data) {
  state.comments = data.comments;
  state.videoChannelId = data.video.channel_id || "";
  state.search = "";
  state.filter = "all";
  state.lowConfOnly = false;
  searchBox.value = "";
  document.getElementById("lowConfToggle").checked = false;
  fullRecheckToggle.checked = false;
  document.querySelectorAll("#filters button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.f === "all"));

  document.getElementById("videoTitle").textContent = data.video.title;
  document.getElementById("videoChannel").textContent = data.video.channel;
  document.getElementById(
    "videoMeta"
  ).textContent = `${cpText("已分析 ", "Analyzed ")}${nf(data.summary.total)}${cpText(" 条评论（含回复）· 浏览 ", " comments and replies · Views: ")}${data.video.view_count == null ? cpText("未获取", "Unavailable") : nf(data.video.view_count)}${cpText(" · 视频点赞 ", " · Video likes: ")}${data.video.like_count == null ? cpText("未公开／未获取", "Unavailable") : nf(data.video.like_count)}${cpText(" · 按「热门」排序", " · Sorted by relevance")}`;

  const thumb = document.getElementById("thumb");
  if (data.video.thumbnail) {
    thumb.style.backgroundImage = `url("${data.video.thumbnail}")`;
    thumb.classList.add("has-img");
  }

  state.videoTitle = data.video.title;
  saveHistoryEntry(data.video);
  renderSummary(data.summary);
  renderReps();
  renderWordFreq();
  renderTable();
  updateDeepEstimate();

  deepResults.hidden = true;
  deepErrorBox.hidden = true;

  emptyState.hidden = true;
  resultsEl.hidden = false;
  setupSideNav();
}

// 左侧导航滚动定位：滚到哪个区块，对应链接就高亮。只用注册一次
// IntersectionObserver，区块元素本身在多次分析之间是同一批 DOM 节点，不会被重建。
let sideNavReady = false;
function setupSideNav() {
  if (sideNavReady) return;
  sideNavReady = true;
  const links = [...document.querySelectorAll(".side-nav a")];
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const href = "#" + entry.target.id;
        links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === href));
      });
    },
    { rootMargin: "-15% 0px -70% 0px" }
  );
  links.forEach((a) => {
    const section = document.querySelector(a.getAttribute("href"));
    if (section) observer.observe(section);
  });
}

// 概览卡片 + 分布条 + 图例。抽成独立函数是因为 AI 深度分析改完标签后，
// 要用同一套渲染逻辑刷新这些数字（数据来源从「服务器返回的 summary」变成「前端自己重新统计」）。
function renderSummary(summary) {
  document.getElementById("tTotal").textContent = nf(summary.total);
  const avg = summary.avg_sentiment;
  document.getElementById("tAvg").textContent = (avg >= 0 ? "+" : "") + avg.toFixed(2);
  document.getElementById("tPos").textContent = summary.positive_pct + "%";
  document.getElementById("tPosSub").textContent = nf(summary.positive) + cpText(" 条", " comments");
  document.getElementById("tNeu").textContent = summary.neutral_pct + "%";
  document.getElementById("tNeuSub").textContent = nf(summary.neutral) + cpText(" 条", " comments");
  document.getElementById("tNeg").textContent = summary.negative_pct + "%";
  document.getElementById("tNegSub").textContent = nf(summary.negative) + cpText(" 条", " comments");

  const segPos = document.getElementById("segPos");
  const segNeu = document.getElementById("segNeu");
  const segNeg = document.getElementById("segNeg");
  segPos.style.width = summary.positive_pct + "%";
  segPos.textContent = summary.positive_pct >= 8 ? summary.positive_pct + "%" : "";
  segNeu.style.width = summary.neutral_pct + "%";
  segNeu.textContent = summary.neutral_pct >= 8 ? summary.neutral_pct + "%" : "";
  segNeg.style.width = summary.negative_pct + "%";
  segNeg.textContent = summary.negative_pct >= 8 ? summary.negative_pct + "%" : "";
  document.getElementById("legPos").textContent = nf(summary.positive);
  document.getElementById("legNeu").textContent = nf(summary.neutral);
  document.getElementById("legNeg").textContent = nf(summary.negative);
}

// 跟 backend/sentiment.py 的 compute_summary 算法保持一致：
// positive=+1 / neutral=0 / negative=-1 按条数加权取均值。
function computeSummaryClient(comments) {
  const total = comments.length;
  const counts = { positive: 0, neutral: 0, negative: 0 };
  comments.forEach((c) => counts[c.sentiment]++);
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const weight = { positive: 1, neutral: 0, negative: -1 };
  const avg = total ? comments.reduce((sum, c) => sum + weight[c.sentiment], 0) / total : 0;
  return {
    total,
    positive: counts.positive,
    neutral: counts.neutral,
    negative: counts.negative,
    positive_pct: pct(counts.positive),
    neutral_pct: pct(counts.neutral),
    negative_pct: pct(counts.negative),
    avg_sentiment: Math.round(avg * 100) / 100,
  };
}

// 英文常用虚词表，词频统计时过滤掉——不是权威词表，够用就行。
const STOPWORDS = new Set(
  ("the a an and or but is are was were be been being to of in on for this that these those it " +
    "its it's i i'm i've you your you're they them their he she we our us my me mine his her " +
    "what which who whom when where why how all any some more most other into than too very " +
    "just so not no nor as at by with from about up down out over under again also only own " +
    "same do does did doing have has had having will would shall should can could may might " +
    "must if then there here s t m re ve ll d don won isn aren wasn weren didn doesn hasn " +
    "haven couldn wouldn shouldn ok okay yeah yes na gonna wanna got get like one im").split(" ")
);

// 数一批评论里每个词/词组出现在多少条不同评论里（同一条评论内重复出现只算一次，
// 防止个别刷屏评论主导结果）。除了单词，也抽相邻两个词的词组（bigram）——像
// "bambu lab" "3d printer" 这种品牌名/术语拆成单词看就没意义了，词组才有信息量。
// 词组只从原文里真正相邻、且两个词都不是虚词的位置抽，不会把中间隔着虚词的词硬拼在一起。
function countWords(comments) {
  const counts = new Map();
  for (const c of comments) {
    const raw = c.text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ") // 链接会被拆成一堆无意义的路径片段挤进高频词，先整段剔除
      .match(/[a-z']{3,}/g) || [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i++) {
      const w = raw[i];
      if (!STOPWORDS.has(w) && !seen.has(w)) {
        seen.add(w);
        counts.set(w, (counts.get(w) || 0) + 1);
      }
      if (i < raw.length - 1) {
        const w2 = raw[i + 1];
        if (!STOPWORDS.has(w) && !STOPWORDS.has(w2)) {
          const phrase = w + " " + w2;
          if (!seen.has(phrase)) {
            seen.add(phrase);
            counts.set(phrase, (counts.get(phrase) || 0) + 1);
          }
        }
      }
    }
  }
  return counts;
}

// 单纯按出现次数排序，三个情感类别的榜单会被"整条视频都在聊的词"（比如视频主题本身、
// game、print 这类）霸占，看起来都差不多，看不出类别之间的差异。
// 改成看"这个词有多大程度上集中出现在这一类"——用该类出现次数除以全量出现次数的平方根，
// 类似 TF-IDF 的思路：全场都在用的词会被压下去，真正这一类特有的词会冒出来。
// 至少出现 2 次才纳入候选，防止孤例噪音（比如打字错误、生僻昵称）排到前面。
function computeWordFreq(bucketComments, globalCounts, topN = 10) {
  const bucketCounts = countWords(bucketComments);
  return [...bucketCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([w, n]) => [w, n, n / Math.sqrt(globalCounts.get(w) || n)])
    .sort((a, b) => b[2] - a[2] || b[1] - a[1])
    .slice(0, topN)
    .map(([w, n]) => [w, n]);
}

function renderWordFreq() {
  const globalCounts = countWords(state.comments);
  const groups = { pos: "positive", neu: "neutral", neg: "negative" };
  for (const [elSuffix, sentiment] of Object.entries(groups)) {
    const comments = state.comments.filter((c) => c.sentiment === sentiment);
    const words = computeWordFreq(comments, globalCounts);
    const el = document.getElementById("words" + elSuffix[0].toUpperCase() + elSuffix.slice(1));
    el.innerHTML = words.length
      ? words
          .map(([w, n]) => `<button type="button" class="word-chip" data-word="${esc(w)}">${esc(w)}<b>${n}</b></button>`)
          .join("")
      : `<span class="empty">${cpText("（评论太少，统计不出高频词）", "Too few comments to show common words.")}</span>`;
  }
}

// 代表性评论每类最多显示 10 条：前 3 条常驻，第 4-10 条折叠起来，点"展开更多"才出现——
// 列表本来就是按点赞排第一屏最值得看的三条，10 条一起铺开容易变成第二个"全部评论表"。
const REP_VISIBLE = 5;
const REP_TOTAL = 10;

// 跟"全部评论"共用同一个 state.search：高频词点进来的词、表格里手打的关键词，
// 都会让这里同步只看命中的代表性评论，而不是自己停在"全部"，看起来像是被跳过的孤立板块。
function renderReps() {
  const q = state.search.trim().toLowerCase();
  const top = (sent) => {
    const seen = new Set();
    return state.comments
      .filter((c) => c.sentiment === sent && !c.is_reply && c.confidence >= 0.6)
      .filter((c) => !state.videoChannelId || c.author_channel_id !== state.videoChannelId)
      .filter((c) => {const text = c.text.trim().toLowerCase().replace(/\s+/g, " "); if (!text || seen.has(text)) return false; seen.add(text); return true;})
      .filter((c) => !q || c.text.toLowerCase().includes(q))
      .sort((a, b) => b.like_count - a.like_count)
      .slice(0, REP_TOTAL);
  };
  const card = (c, extra) => `<li class="rep${extra ? " rep-extra" : ""}"${extra ? " hidden" : ""}>
      <p class="rep-text">&ldquo;${esc(displayText(c))}&rdquo;</p>
      <p class="rep-foot">
        <span class="who">${esc(displayAuthor(c.author))}</span><span>👍 ${nf(c.like_count)}</span><span class="mono">${cpText("把握度 ", "Confidence: ")}${c.confidence.toFixed(2)}</span>
        <button type="button" class="mini-link translate-btn" data-id="${esc(c.id)}">${translateLabel(c)}</button>
      </p>
    </li>`;

  const fill = (elId, sent) => {
    const list = top(sent);
    const el = document.getElementById(elId);
    if (!list.length) {
      const label = sent === "positive" ? cpText("正面", "positive") : cpText("负面", "negative");
      el.innerHTML = `<li class="rep-empty">${q ? `${cpText("没有匹配「", "No comments match “")}${esc(q)}${cpText("」的", "” in the ")}${label}${cpText("代表性评论", " category.")}` : `${cpText("暂无", "No ")}${label}${cpText("评论", " comments yet")}`}</li>`;
      return;
    }
    const visible = list.slice(0, REP_VISIBLE).map((c) => card(c, false));
    const rest = list.slice(REP_VISIBLE);
    const extraCards = rest.map((c) => card(c, true));
    const toggle = rest.length
      ? `<li class="rep-toggle-row"><button type="button" class="mini-link rep-toggle">${cpText("展开更多（+", "Show more (+")}${rest.length}${cpText("）", ")")}</button></li>`
      : "";
    el.innerHTML = visible.join("") + extraCards.join("") + toggle;
  };

  fill("repPos", "positive");
  fill("repNeg", "negative");

  const filterNote = document.getElementById("repsFilterNote");
  filterNote.hidden = !q;
  if (q) filterNote.textContent = `${cpText("按「", "Filter: “")}${q}${cpText("」筛选", "”")}`;
}

function updateSearchStats() {
  const q = state.search.trim();
  if (!q) {
    searchStats.hidden = true;
    searchClear.hidden = true;
    return;
  }
  searchClear.hidden = false;
  const needle = q.toLowerCase();
  const matches = state.comments.filter((c) => c.text.toLowerCase().includes(needle));
  searchStats.hidden = false;
  if (matches.length === 0) {
    searchStats.textContent = `${cpText("没有找到包含「", "No comments contain “")}${q}${cpText("」的评论", "”")}`;
    return;
  }
  const counts = { positive: 0, neutral: 0, negative: 0 };
  matches.forEach((c) => counts[c.sentiment]++);
  const pct = (n) => Math.round((n / matches.length) * 100);
  searchStats.innerHTML =
    `${cpText("包含「", "Keyword “")}<b>${esc(q)}</b>${cpText("」的评论共 ", "” appears in ")}<b>${nf(matches.length)}</b>${cpText(" 条 —— ", " comments · ")}` +
    `<span class="dot pos" style="display:inline-block"></span>${cpText("正面 ", "Positive ")}<b>${counts.positive}</b>(${pct(counts.positive)}%) · ` +
    `<span class="dot neu" style="display:inline-block"></span>${cpText("中性 ", "Neutral ")}<b>${counts.neutral}</b>(${pct(counts.neutral)}%) · ` +
    `<span class="dot neg" style="display:inline-block"></span>${cpText("负面 ", "Negative ")}<b>${counts.negative}</b>(${pct(counts.negative)}%)`;
}

const LOW_CONF_THRESHOLD = 0.6;

function renderTable() {
  updateSearchStats();
  let rows = state.comments.slice();
  const q = state.search.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.text.toLowerCase().includes(q));
  if (state.filter !== "all") rows = rows.filter((r) => r.sentiment === state.filter);

  const lowConfCount = rows.filter((r) => r.confidence < LOW_CONF_THRESHOLD).length;
  document.getElementById("lowConfCount").textContent = lowConfCount;
  if (state.lowConfOnly) rows = rows.filter((r) => r.confidence < LOW_CONF_THRESHOLD);

  const rank = { positive: 0, neutral: 1, negative: 2 };
  rows.sort((a, b) => {
    let av, bv;
    if (state.sort.k === "sentiment") {
      av = rank[a.sentiment];
      bv = rank[b.sentiment];
    } else {
      av = a[state.sort.k];
      bv = b[state.sort.k];
    }
    if (av === bv) return b.like_count - a.like_count;
    return (av < bv ? -1 : 1) * state.sort.dir;
  });

  document.getElementById("shownCount").textContent = rows.length;
  document.getElementById("tbody").innerHTML = rows
    .map((r) => {
      const s = SENT[r.sentiment];
      return `<tr data-cid="${esc(r.id)}">
        <td class="author">${esc(displayAuthor(r.author))}</td>
        <td class="text">
          <div class="body">${r.is_reply ? cpText("<span class=\"reply-tag\">回复</span>", "<span class=\"reply-tag\">Reply</span>") : ""}${esc(displayText(r))}</div>
          <div class="text-tools">
            <button type="button" class="mini-link expand-btn" hidden>${cpText("展开", "Expand")}</button>
            <button type="button" class="mini-link translate-btn" data-id="${esc(r.id)}">${translateLabel(r)}</button>
          </div>
        </td>
        <td class="num mono">${nf(r.like_count)}</td>
        <td><span class="pill ${s.cls}"><span class="dot ${s.cls}"></span>${s.label}</span>${
        r.reviewed_by ? `<span class="reviewed-badge" title="${esc(r.reason || "")}${cpText("\">AI 复核", "\">AI reviewed")}</span>` : ""
      }</td>
        <td class="num mono">${r.confidence.toFixed(2)}</td>
      </tr>`;
    })
    .join("");

  document.querySelectorAll("th.sortable").forEach((th) => {
    const k = th.dataset.k;
    const arrow = th.querySelector(".arrow");
    if (k === state.sort.k) {
      th.setAttribute("aria-sort", state.sort.dir === -1 ? "descending" : "ascending");
      arrow.textContent = state.sort.dir === -1 ? "▼" : "▲";
    } else {
      th.removeAttribute("aria-sort");
      arrow.textContent = k === "like_count" ? "▼" : "▲▼";
    }
  });

  // 插入 DOM 后立刻同步读 scrollHeight 有时候会踩到"布局还没吃到最终字体宽度"的窗口期
  // （Google Fonts 还没换上、用后备字体量的尺寸），等一帧再量更保险。
  requestAnimationFrame(markOverflowingCells);
}

// 长评论被两行折叠后，"展开"提示如果写在被折叠的文字里面，会跟溢出的文字一起被裁掉——
// 正好在最需要展开的时候消失（2026-09-12 用户反馈的真实 bug）。改法：展开按钮放在折叠框
// 外面，且只有真的溢出（scrollHeight > clientHeight）才显示，短评论不会出现点了没反应的按钮。
function markOverflowingCells() {
  document.querySelectorAll("#tbody tr").forEach((tr) => {
    const body = tr.querySelector(".text .body");
    const btn = tr.querySelector(".expand-btn");
    if (!body || !btn) return;
    if (body.classList.contains("expanded")) {
      btn.hidden = false;
      return;
    }
    btn.hidden = body.scrollHeight <= body.clientHeight + 1;
  });
}

// 展开/收起：按钮在折叠框外面，点评论正文本身也顺手展开（大目标好点）。
document.getElementById("tbody").addEventListener("click", (e) => {
  const expandBtn = e.target.closest(".expand-btn");
  const bodyClicked = e.target.closest("td.text .body");
  const cell = (expandBtn || bodyClicked) && (expandBtn || bodyClicked).closest("td.text");
  if (!cell) return;
  const body = cell.querySelector(".body");
  const btn = cell.querySelector(".expand-btn");
  const expanded = body.classList.toggle("expanded");
  btn.hidden = false;
  btn.textContent = expanded ? cpText("收起", "Collapse") : cpText("展开", "Expand");
});

document.getElementById("lowConfToggle").addEventListener("change", (e) => {
  state.lowConfOnly = e.target.checked;
  renderTable();
});

// 点高频词 chip = 拿它去搜，先落到"代表性评论"（这里也会同步按这个词筛选，不再是路过
// 跳过的孤立板块），再往下滚就是筛选后的全部评论表——三个板块串成一条一致的下钻路径。
document.getElementById("wordFreqSection").addEventListener("click", (e) => {
  const chip = e.target.closest(".word-chip");
  if (!chip) return;
  const word = chip.dataset.word;
  searchBox.value = word;
  state.search = word;
  renderReps();
  renderTable();
  document.getElementById("repsSection").scrollIntoView({ behavior: "smooth", block: "start" });
});

// 每敲一个字母就重新筛选、列表跟着跳动，体验很闹心，防抖到停手 350ms 后再筛一次。
let searchDebounceTimer = null;
searchBox.addEventListener("input", () => {
  state.search = searchBox.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    renderReps();
    renderTable();
  }, 350);
});
searchClear.addEventListener("click", () => {
  clearTimeout(searchDebounceTimer);
  searchBox.value = "";
  state.search = "";
  renderReps();
  renderTable();
  searchBox.focus();
});

document.getElementById("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.filter = b.dataset.f;
  document.querySelectorAll("#filters button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  renderTable();
});

document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (state.sort.k === k) state.sort.dir *= -1;
    else state.sort = { k, dir: -1 };
    renderTable();
  });
});

// 按钮文案是"点了会切到哪个模式"，不是"当前是什么模式"——所以显示的永远是下一个状态。
function currentTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function updateThemeBtnLabel() {
  document.getElementById("themeToggle").textContent =
    currentTheme() === "dark" ? cpText("☀️ 白天模式", "☀️ Light mode") : cpText("🌙 夜晚模式", "🌙 Dark mode");
}
updateThemeBtnLabel();

document.getElementById("themeToggle").addEventListener("click", () => {
  const root = document.documentElement;
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  updateThemeBtnLabel();
});

// ---- 导出 CSV：纯前端生成，不额外调用任何 API，免费瞬间完成 ----
document.getElementById("exportBtn").addEventListener("click", () => {
  if (!state.comments.length) return;
  const headers = [cpText("作者", "Author"), cpText("评论原文", "Original comment"), cpText("中文翻译", "English translation"), cpText("点赞数", "Likes"), cpText("发布时间", "Published at"), cpText("是否回复", "Reply"), cpText("情感", "Sentiment"), cpText("把握度", "Confidence"), cpText("AI复核", "AI reviewed"), cpText("复核理由", "Review reason")];
  const csvEscape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = state.comments.map((c) => [
    displayAuthor(c.author),
    c.text,
    c[translationField] || "",
    c.like_count,
    c.published_at,
    c.is_reply ? cpText("是", "Yes") : cpText("否", "No"),
    SENT[c.sentiment] ? SENT[c.sentiment].label : c.sentiment,
    c.confidence.toFixed(2),
    c.reviewed_by ? cpText("是", "Yes") : cpText("否", "No"),
    c.reason || "",
  ]);
  const csv = "﻿" + [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeTitle = (state.videoTitle || "comments").replace(/[^\w一-龥-]+/g, "_").slice(0, 40);
  const a = document.createElement("a");
  a.href = url;
  a.download = `commentpulse-${safeTitle}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---- 翻译（DeepSeek，逐条按需）----
// 不再是"一键全部翻译"：每条评论旁边有个小"翻译"链接，点了才翻译这一条，翻完缓存在
// 评论对象自己身上（c[translationField] / c.showTranslation），再点就是本地切换、不重复调用 API。
async function translateOneComment(id) {
  const c = state.comments.find((x) => x.id === id);
  if (!c || c.translating) return;

  if (c[translationField]) {
    c.showTranslation = !c.showTranslation;
    renderReps();
    renderTable();
    return;
  }

  c.translating = true;
  c.translateError = false;
  renderReps();
  renderTable();

  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: cpApiHeaders,
      body: JSON.stringify({ comments: [{ id: c.id, text: c.text, like_count: c.like_count, confidence: c.confidence }] }),
    });
    const data = await readApiResponse(res);
    if (!res.ok) throw new Error(data.detail || cpText("翻译失败", "Translation failed."));
    const t = data.translations.find((x) => x.id === id);
    if (!t) throw new Error(cpText("DeepSeek 没有返回这条的翻译", "DeepSeek returned no translation for this comment."));
    c[translationField] = t[translationField];
    queueMicrotask(publishEmbeddedUpdate);
    c.showTranslation = true;
  } catch (err) {
    c.translateError = true;
  } finally {
    c.translating = false;
    renderReps();
    renderTable();
    if (c.translateError) {
      setTimeout(() => {
        c.translateError = false;
        renderReps();
        renderTable();
      }, 2500);
    }
  }
}

function translateLabel(c) {
  if (c.translating) return cpText("翻译中…", "Translating…");
  if (c.translateError) return cpText("翻译失败", "Translation failed");
  if (c[translationField]) return c.showTranslation ? cpText("原文", "Show original") : cpText("翻译", "Translate to English");
  return cpText("翻译", "Translate to English");
}

// 全部评论表和代表性评论卡片共用同一套"翻译"链接行为，在结果区顶层代理一次就够；
// 代表性评论的"展开更多"也在这里一起代理。
resultsEl.addEventListener("click", (e) => {
  const t = e.target.closest(".translate-btn");
  if (t) {
    translateOneComment(t.dataset.id);
    return;
  }
  const toggle = e.target.closest(".rep-toggle");
  if (toggle) {
    const list = toggle.closest("ul");
    const extras = list.querySelectorAll(".rep-extra");
    const nowHidden = extras.length && !extras[0].hidden; // 当前是展开状态就收起，反之展开
    extras.forEach((li) => (li.hidden = nowHidden));
    toggle.textContent = nowHidden ? `${cpText("展开更多（+", "Show more (+")}${extras.length}${cpText("）", ")")}` : cpText("收起", "Collapse");
  }
});

// ---- AI 深度分析：DeepSeek（低把握度复核 / 全量复核 + 主题总结）----
// 这是个要点一下才会花钱的动作，绝不在页面加载或普通分析时自动触发。
deepBtn.addEventListener("click", async () => {
  if (deepBtn.disabled) return;
  deepErrorBox.hidden = true;
  deepBtn.disabled = true;

  const full = fullRecheckToggle.checked;
  const steps = [
    cpText("正在把评论发给 DeepSeek…", "Sending comments to DeepSeek…"),
    full ? cpText("正在重新判断全部评论…", "Reviewing all comments…") : cpText("正在重新判断低把握度评论…", "Reviewing low-confidence comments…"),
    cpText("正在总结讨论主题…", "Summarizing discussion topics…"),
    cpText("整理结果…", "Preparing results…"),
  ];

  let stepTimer = null;
  let stepI = 0;
  deepProgress.classList.add("on");
  deepProgressFill.style.width = "10%";
  deepProgressLabel.textContent = steps[0];
  stepTimer = setInterval(() => {
    stepI = Math.min(stepI + 1, steps.length - 1);
    deepProgressLabel.textContent = steps[stepI];
    deepProgressFill.style.width = Math.min(88, 15 + stepI * 24) + "%";
  }, 1800);

  try {
    const payload = {
      video_title: state.videoTitle,
      full_recheck: full,
      comments: state.comments.map((c) => ({
        id: c.id,
        text: c.text,
        like_count: c.like_count,
        confidence: c.confidence,
      })),
    };
    const res = await fetch("/api/deep-analyze", {
      method: "POST",
      headers: cpApiHeaders,
      body: JSON.stringify(payload),
    });
    const data = await readApiResponse(res);
    if (!res.ok) throw new Error(data.detail || cpText("深度分析失败，请稍后再试", "Deep analysis failed. Please try again."));

    // 把复核结果合并回 state.comments（按 id 匹配），然后用同一套渲染逻辑重新刷新所有统计。
    const byId = new Map(data.reclassified.map((r) => [r.id, r]));
    state.comments = state.comments.map((c) => {
      const r = byId.get(c.id);
      if (!r) return c;
      return { ...c, sentiment: r.sentiment, confidence: r.confidence, reason: r.reason, reviewed_by: r.reviewed_by };
    });

    renderSummary(computeSummaryClient(state.comments));
    renderReps();
    renderWordFreq();
    renderTable();

    embeddedTopics = data.topics;
    document.getElementById("topicSummary").textContent = data.topics.summary;
    document.getElementById("themeList").innerHTML = data.topics.themes
      .map(
        (t) =>
          `<div class="theme-card ${SENT[t.tone].cls}"><div class="t-title">${esc(t.title)}</div><div class="t-desc">${esc(t.description)}</div></div>`
      )
      .join("");
    const needs = data.topics.needs || [];
    document.getElementById("needsList").innerHTML = needs
      .map(
        (n) =>
          `<div class="need-card"><div class="t-title">${esc(n.title)}<span class="support-badge">${
            n.support === "multiple" ? cpText("多人提到", "Mentioned by multiple viewers") : cpText("个别提到", "Mentioned by one viewer")
          }</span></div><div class="t-desc">${esc(n.description)}</div></div>`
      )
      .join("");
    document.getElementById("needsEmpty").hidden = needs.length > 0;

    const scope = full ? cpText("全部", "all") : cpText("低把握度", "low-confidence");
    document.getElementById("reclassifiedNote").textContent = data.reclassified.length
      ? `${cpText("已用 DeepSeek 重新判断了 ", "DeepSeek reviewed ")}${data.reclassified.length}${cpText(" 条", " comments (scope: ")}${scope}${cpText("评论。", ").")}`
      : `${cpText("这次没有需要复核的", "There were no comments to review (scope: ")}${scope}${cpText("评论。", ").")}`;
    deepResults.hidden = false;
    publishEmbeddedUpdate();
  } catch (err) {
    deepErrorBox.hidden = false;
    deepErrorBox.textContent = "⚠ " + err.message;
  } finally {
    clearInterval(stepTimer);
    deepProgressFill.style.width = "100%";
    setTimeout(() => {
      deepProgress.classList.remove("on");
      deepProgressFill.style.width = "0%";
    }, 250);
    deepBtn.disabled = false;
  }
});


// Batch details reuse the full single-video dashboard without fetching/scoring again.
let embeddedTopics = null;
let embeddedVideoId = null;
function publishEmbeddedUpdate() {
  if (!embeddedVideoId || window.parent === window) return;
  window.parent.postMessage({type:'commentpulse-update',videoId:embeddedVideoId,
    comments:state.comments,summary:computeSummaryClient(state.comments),topics:embeddedTopics},location.origin);
}
if (new URLSearchParams(location.search).get('embedded') === '1' && window.parent !== window) {
  document.querySelector('.query').hidden=true;
  document.querySelector("[data-locale-link]").hidden = true;
  document.getElementById("languageToggle").hidden = true;
  document.getElementById('historyBar').style.display='none';
  window.addEventListener('message',e=>{
    if(e.origin!==location.origin || e.source!==window.parent || e.data?.type!=='commentpulse-load')return;
    const data=e.data.data;
    if(!data?.video || !Array.isArray(data.comments))return;
    embeddedVideoId=data.video.id;
    render(data);
    embeddedTopics=e.data.topics||null;
    if(embeddedTopics){
      document.getElementById('topicSummary').textContent=embeddedTopics.summary;
      document.getElementById('themeList').innerHTML=embeddedTopics.themes.map(t=>`<div class="theme-card ${SENT[t.tone]?.cls||''}"><div class="t-title">${esc(t.title)}</div><div class="t-desc">${esc(t.description)}</div></div>`).join('');
      const needs=embeddedTopics.needs||[];
      document.getElementById('needsList').innerHTML=needs.map(n=>`<div class="need-card"><div class="t-title">${esc(n.title)}</div><div class="t-desc">${esc(n.description)}</div></div>`).join('');
      document.getElementById('needsEmpty').hidden=needs.length>0;
      document.getElementById('reclassifiedNote').textContent=cpText("已载入批量分析生成的主题总结。", "Loaded the topics generated during batch analysis.");
      deepResults.hidden=false;
    }
  });
  window.parent.postMessage({type:'commentpulse-ready'},location.origin);
}
