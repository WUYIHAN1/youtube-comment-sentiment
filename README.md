# CommentPulse（工作名）— YouTube 评论区情感分析工具

Phase 1：本地网页 Dashboard。粘贴一个 YouTube 视频链接，抓取评论（含回复），用 Twitter-RoBERTa
本地打情感分，网页展示概览、分布、代表性评论、可排序筛选的全量表。

Phase 2：点「🤖 深度分析」按钮，用 DeepSeek 对把握度低的评论结合视频标题重新判断，并生成
评论区讨论主题总结（会调用付费 API，手动点击才触发）。

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

## 目录结构

```
youtube-comment-sentiment/
  .env.example          # 环境变量模板，复制成 .env 后填 key
  .gitignore
  requirements.txt
  README.md
  mini-prd.md
  backend/
    main.py             # FastAPI 应用 + 路由
    youtube.py          # 解析链接、调 YouTube Data API v3 抓评论
    sentiment.py         # Twitter-RoBERTa 打分 + 概览统计
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
