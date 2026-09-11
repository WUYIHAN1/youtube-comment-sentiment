# CommentPulse（工作名）— YouTube 评论区情感分析工具

Phase 1：本地网页 Dashboard。粘贴一个 YouTube 视频链接，抓取评论（含回复），用 Twitter-RoBERTa
本地打情感分，网页展示概览、分布、代表性评论、可排序筛选的全量表。

Phase 2：点「🤖 深度分析」按钮，用 DeepSeek 对把握度低的评论结合视频标题重新判断，并生成
评论区讨论主题总结；每条评论旁边还有个「翻译」链接，点哪条翻哪条（都是付费 API，手动点击才触发）。

Phase 3：部署上线，让别人打开链接就能用，见下面「部署上线」一节。

需求文档见 [mini-prd.md](mini-prd.md)；过程记录见项目根目录的
`YouTube评论情感分析-项目日志.md`。

## 环境要求

- Python 3.10+
- 一个 YouTube Data API v3 key（申请步骤见项目日志「学到的知识」或问 Claude）
- （可选，用 Phase 2 才需要）一个 DeepSeek API key：platform.deepseek.com 注册，
  「API keys」页新建，支持支付宝/微信支付充值

## 安装

```bash
cd youtube-comment-sentiment
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# 用编辑器打开 .env，填入：YOUTUBE_API_KEY=你的key
```

## 运行

```bash
source .venv/bin/activate
uvicorn backend.main:app --reload
```

打开浏览器访问 **http://127.0.0.1:8000**，粘贴一个 YouTube 视频链接，点「分析」。

> 首次分析会自动下载 Twitter-RoBERTa 模型（`cardiffnlp/twitter-roberta-base-sentiment-latest`，
> 约 500MB），需要联网，只需一次；之后会缓存在本地（`~/.cache/huggingface`）。

## 部署上线（Phase 3）

托管平台用 **Hugging Face Spaces**（免费、内存比多数免费平台宽裕，跑得动 RoBERTa + torch）。
Key 策略是"站长自己的 key"——陌生人打开链接用的是你的 YouTube/DeepSeek 配额和余额，所以代码里
已经加了限流（`backend/budget.py`）：单 IP 滑动窗口 + 每日全局上限，都能用环境变量调，默认值
偏保守，适合"分享给朋友圈"这个量级，不是为公开无限流量设计的。

**步骤**：

1. 去 huggingface.co 注册/登录，右上角头像 → **New Space**
2. 起名字，**SDK 选 Docker**，硬件选免费的 CPU basic，可见性按需（Private 只有你能打开，Public 谁都能访问）
3. 创建后会给你一个 git 仓库地址（`https://huggingface.co/spaces/<你的用户名>/<space名>`），
   把这个项目推上去：
   ```bash
   git remote add hf https://huggingface.co/spaces/<你的用户名>/<space名>
   git push hf main
   ```
4. 在 Space 页面的 **Settings → Repository secrets** 里添加：
   - `YOUTUBE_API_KEY`
   - `DEEPSEEK_API_KEY`（不加也行，Phase 2 功能会跳过，Phase 1 照常用）
5. 等它自动构建（首次构建要下 torch + 模型，得等几分钟），构建完 Space 页面就是能用的网址，
   可以直接分享这个链接。

> Hugging Face Spaces 有时需要 `README.md` 顶部一段 YAML 元信息才能正确识别成 Docker Space
> （创建 Space 时网页表单一般会自动帮你生成这段、或者提示你要不要生成）。如果推上去以后 Space
> 没有按 Dockerfile 构建，去 Space 的文件列表里确认 README.md 最上面有没有类似这样的块，没有就
> 手动加上：
> ```yaml
> ---
> title: CommentPulse
> emoji: 💬
> colorFrom: indigo
> colorTo: blue
> sdk: docker
> app_port: 7860
> ---
> ```
> 这几年 Hugging Face 的具体流程可能会变，实际操作以 Space 创建页面当时的提示为准。

**限流参数**（都是环境变量，可选，不设就用默认值）：

| 变量 | 默认值 | 含义 |
|---|---|---|
| `ANALYZE_IP_LIMIT` / `ANALYZE_IP_WINDOW` | 8 次 / 600 秒 | 单 IP 分析请求限流 |
| `DEEP_IP_LIMIT` / `DEEP_IP_WINDOW` | 5 次 / 3600 秒 | 单 IP 深度分析限流 |
| `DEEP_DAILY_CAP` | 40 | 深度分析全站每日上限 |
| `TRANSLATE_IP_LIMIT` / `TRANSLATE_IP_WINDOW` | 30 次 / 3600 秒 | 单 IP 翻译限流 |
| `TRANSLATE_DAILY_CAP` | 300 | 翻译全站每日上限 |

> `.quota_usage.json`（YouTube 配额估算）和限流计数都是进程内存/本地文件状态，Space 重启或重新
> 构建会清零——对"挡刷"这个目的够用，只是不追求跨重启精确统计。

## 目录结构

```
youtube-comment-sentiment/
  .env.example          # 环境变量模板，复制成 .env 后填 key
  .gitignore
  .dockerignore
  Dockerfile             # Phase 3 部署用，见「部署上线」
  requirements.txt
  README.md
  mini-prd.md
  demo笔记.md            # 训练营作品展示笔记
  backend/
    main.py             # FastAPI 应用 + 路由 + 限流接入点
    youtube.py          # 解析链接、调 YouTube Data API v3 抓评论
    sentiment.py         # Twitter-RoBERTa 打分 + 概览统计
    llm.py               # Phase 2：DeepSeek 复核 / 主题总结 / 翻译
    quota.py             # YouTube API 配额本地估算
    budget.py            # Phase 3：限流 + 每日预算
    schema.py            # 接口数据结构（pydantic）
  frontend/
    index.html
    app.js
    style.css
```

## 常见问题

- **"无法识别这个链接"**：确认粘贴的是完整链接（`youtube.com/watch?v=...` 或 `youtu.be/...`）。
- **"该视频的评论区已关闭"**：换一个开放评论的视频。
- **"API key 无效或权限不足"**：检查 `.env` 里的 key，以及 Google Cloud 控制台里这个 key 的
  「API 限制」是否包含 YouTube Data API v3。
- **"今日 YouTube API 配额已用尽"**：太平洋时间午夜重置，明天再试。
- **点「分析」后一直卡住不返回（首次运行）**：可能是 huggingface 的 `hf_xet` 传输后端在下载模型时卡死在
  0 字节（实测复现过）。代码里已经加了 `HF_HUB_DISABLE_XET=1` 兜底，正常情况下不会再遇到；如果还是卡住，
  删掉 `~/.cache/huggingface/hub/models--cardiffnlp--twitter-roberta-base-sentiment-latest` 整个文件夹再重试。
- **总评论数比 YouTube 页面显示的数字略少**：两个独立的原因，都不是代码 bug——
  ① `commentThreads.list` 接口对每条评论只内嵌返回前几条回复，代码会用 `comments.list` 补全缺口，
  但为了控制耗时和配额，只补前 30 个出现缺口的楼层，极端情况（个别楼层被刷屏几千条回复）可能仍有差异；
  ② **更常见的原因**：YouTube 视频页面显示的评论总数，包含"待审核 / 疑似垃圾"的评论——这些评论
  官方公开 API（`commentThreads.list`）根本不会返回，任何第三方工具调这个 API 都拿不到，只有频道
  主本人登录后台才看得到。实测过一个「显示 102、抓到 99」的案例，逐条核对后确认 ① 没有触发（回复
  全部抓齐），差的 3 条就是这类"官方计数里有、接口拿不到"的评论。这个差距**无法通过代码消除**。
