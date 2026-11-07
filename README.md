# CommentPulse — YouTube 评论区情感分析工具

[English setup guide](README.en.md)

需求文档见 [mini-prd.md](mini-prd.md)；部署说明见 [DEPLOY.md](DEPLOY.md)；过程记录见项目根目录的
`YouTube评论情感分析-项目日志.md`。

## 下载与本地运行

运行本项目需要 Python 后端。安装完成后，通过浏览器访问本地网址使用。

### 1. 下载项目

在仓库顶部点击绿色 **Code → Download ZIP**，解压后进入项目文件夹。
如果仓库处于私有状态，请先接受仓库所有者发出的 GitHub 协作者邀请。

也可以先安装 Git 并完成 GitHub 身份验证，然后在终端运行以下命令。

```bash
git clone https://github.com/WUYIHAN1/youtube-comment-sentiment.git
cd youtube-comment-sentiment
```

### 2. 安装 Python 和依赖

建议使用 **Python 3.11**（当前项目已在 Python 3.11 环境运行）。
安装时确认可以在终端调用 Python。Windows 安装程序中可以勾选 “Add Python to PATH”。
依赖包含 PyTorch，安装和首次下载模型需要联网，并预留数 GB 磁盘空间。

在项目根目录打开终端，按操作系统执行以下命令。

**macOS / Linux**

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

**Windows PowerShell**

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

首次安装时复制配置文件即可。已有 `.env` 时直接编辑，保留自己的配置。

### 3. 配置自己的 API Key

用文本编辑器打开项目根目录的 `.env`，填写以下配置。Windows 上注意文件名应为 `.env`，避免保存成 `.env.txt`。

```dotenv
YOUTUBE_API_KEY=填入你自己的YouTube_API_Key
MAX_TOP_LEVEL_COMMENTS=1000
DEEPSEEK_API_KEY=
```

- **YouTube API Key 必填**。登录 Google Cloud，创建或选择项目，启用 **YouTube Data API v3**，再在凭据页面创建 API 密钥。此工具读取公开视频和评论，使用 API Key 即可。调用会消耗该 Google Cloud 项目的 YouTube 配额。参考 Google 官方设置说明。[YouTube API 身份验证指南](https://developers.google.com/youtube/v3/guides/authentication)
- **DeepSeek API Key 可选**。需要 AI 深度分析、主题总结、翻译和广告初筛时，在 DeepSeek 平台申请 Key 并填入 `DEEPSEEK_API_KEY`。这些功能调用自己的 DeepSeek 账户并按平台计费。[DeepSeek 开放平台](https://platform.deepseek.com/)
- 基础情感分类使用本地模型。模型首次使用时从 Hugging Face 下载，后续使用本机缓存。
- `.env` 已在 `.gitignore` 中排除。密钥保存在自己的电脑上，每位使用者配置自己的 Key。

### 4. 启动服务

在项目根目录运行，保持这个终端窗口开启。

**macOS / Linux**

```bash
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

**Windows PowerShell**

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

看到 `Uvicorn running on http://127.0.0.1:8000` 后，在浏览器打开所需页面。

| 页面 | 本地网址 |
| --- | --- |
| 单视频评论分析 | http://127.0.0.1:8000/ |
| 批量分析与报告导出 | http://127.0.0.1:8000/static/batch.html |
| 个人项目主页 | http://127.0.0.1:8000/portfolio |
| 服务状态 | http://127.0.0.1:8000/api/health |

服务状态返回 `"ok": true` 且 `"has_api_key": true` 表示服务已启动并读取到 YouTube Key，
Key 是否有效需要实际分析视频确认。先选一个开放评论、评论量较少的视频进行测试。
首次分析会下载并加载情感模型，可能需要几分钟，请查看终端进度。按 **Ctrl+C** 停止服务。
每次重新使用时，运行启动命令即可。修改 `.env` 后需重新启动服务。

### 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 本地页面打不开 | 确认启动终端仍在运行，端口与浏览器地址一致；直接双击 HTML 文件会缺少后端服务 |
| 提示端口已占用 | 把启动命令的端口改成 `--port 8001`，浏览器也改为访问 `http://127.0.0.1:8001` |
| 提示未配置 YouTube Key | 检查项目根目录的 `.env` 文件名、Key 内容，并重启服务 |
| Key 无效、权限不足或额度用尽 | 确认已启用 YouTube Data API v3，检查密钥限制与该项目配额 |
| 首次分析等待较久 | 查看终端的模型下载进度；电脑需能访问 Hugging Face |
| 无法获取视频或评论 | 确认后端所在电脑能访问 Google / YouTube API，并选择开放评论的公开视频 |
| AI 功能失败 | 检查 DeepSeek Key、账户余额、网络和终端错误信息 |

上述入口与现有测试已在开发环境检查。Windows 命令尚未在 Windows 设备实测，
也尚未完成从全新电脑下载、安装到实际分析的完整验证。

## 介绍

这是一个 YouTube 视频评论区分析器。输入视频链接，可以快速了解评论区的情感倾向和主要讨论内容，
帮助海外产品经理/内容运营/用户研究等低成本快速了解 YouTube 评论区针对新品或竞品的态度和主要讨论
内容，不用再一条条翻评论。

## 适用场景

- **产品经理/用户研究**：快速了解新品或者竞品在 YouTube 的反馈，发现潜在产品痛点和需求，洞察新趋势
- **海外 KOL 运营**：了解 KOL 发布的视频的反馈，完善视频内容策略
- **海外公关/舆情团队**：视频发布后快速判断口碑走向，及时发现争议点决定要不要介入回应

## 功能

<!-- 把截图存进 assets/ 文件夹，文件名对上就行，图会自动显示 -->

### 评论区情感倾向概览

- **分析所有评论情感得分**：粘贴视频链接，自动抓取全部评论，情感分析模型给每条评论打情感分
  （正面/中性/负面）
- **情绪概览**：一眼看清评论区总体情绪、三类情绪分布，以及最具代表性的评论
- **各类情绪高频词**：按情感类别拆分高频词，快速抓住大家在聊什么

![分析概览](assets/overview.png)

- 按情感类别拆分的高频词，快速抓住每种情绪下大家具体在聊什么：

![各情感类别高频词](assets/word-freq.png)

- 正负面各自最具代表性的评论（按点赞数排序），支持逐条按需翻译：

![代表性评论](assets/representative-comments.png)

### AI 深度分析

- **部分评论主题总结**：对把握度低的评论结合视频标题重新判断，并生成评论区主题总结
- **全部评论主题总结**：可选结合全部评论和视频标题生成更全面的主题总结（更准，但调用量更大，
  需要稍等片刻）

![AI 深度分析](assets/deep-analysis.png)

### 全量评论表

- **按需定位**：关键词搜索 + 情感/把握度筛选 + 排序，精准定位到具体评论
- **翻译**：逐条按需中文翻译，点哪条翻哪条，不整页机翻，保留原汁原味
- **隐私风险控制**：用户名默认脱敏，保护评论者隐私
- **数据导出**：支持导出 CSV 分析结果

![评论表](assets/comment-table.png)

## 技术说明

- **数据来源**：评论数据通过 **YouTube Data API v3** 官方接口获取，不使用爬虫。API key 在 Google Cloud
  Console 官方渠道申请，合法合规，且遵守 YouTube 官方配额限制。
- **情感打分模型**：采用 [`cardiffnlp/twitter-roberta-base-sentiment-latest`](https://huggingface.co/cardiffnlp/twitter-roberta-base-sentiment-latest)
  （Twitter-RoBERTa），一个基于 RoBERTa、在约 1.24 亿条推文上微调过的情感分类模型，专门针对社交媒体
  短文本（口语化表达、缩写、emoji）优化，比通用情感分析模型更适合 YouTube 评论区这类短平快的文本。
  本地运行，零 API 成本。
- **AI 深度分析**：调用 **DeepSeek API**（`deepseek-chat` 模型），对本地模型把握度低的评论结合视频
  标题做二次判断，并分析归纳评论区的主要讨论主题——这类需要更强语言理解能力的任务本地模型做不好，
  所以设计成按需（手动点击）触发，控制调用成本。

## 目前状态

目前可在本地完整运行（Phase 1 免费本地分析 + Phase 2 AI 深度分析均已验证），接下来准备部署上线，
让别人打开链接就能用——计划和进度见 [DEPLOY.md](DEPLOY.md)。


## 批量分析与 HTML 报告

启动服务后，从页首「批量分析」进入，或打开 `/static/batch.html`。

- 输入频道 `@账号`、`/channel/UC…` 或 `/user/…` 链接，读取最近 10 / 30 / 50 条公开上传视频；不支持旧式 `/c/…` 链接，请改用 @账号。列表可能包含 Shorts 和直播。
- 默认选择最近 10 条，也可自行勾选；支持每行粘贴一个视频链接，最多 10 条，可跨频道。
- 「AI 初筛疑似广告」调用 DeepSeek，仅阅读标题和简介，展示疑似状态、理由与可核对的原文依据。操作者确认后，才开始评论分析；「最近 5 条」只在当前读取范围内选择，可能不足 5 条，不保证是该频道真实的最近 5 条广告。
- 视频按顺序分析，单条失败不会删除已完成结果，可停止后继续或重试失败项。结果保存在当前页面内存，刷新前请导出。
- 可选生成各视频 AI 主题总结（每条取最多 150 条高赞评论；不进行额外情感复核）。报告包含样本范围、逐视频对比、主题、需求及高赞正负面评论证据；没有做跨视频共同主题归纳。
- HTML 报告不依赖外部样式或脚本，可独立打开，在浏览器打印菜单另存为 PDF；评论者姓名不写入报告。单视频也可通过自选一条视频导出报告。

批量分析每 IP 每小时最多 30 条视频，批量主题总结每 IP 每小时最多 15 次、全站每日受 `DEEP_DAILY_CAP` 限制（计数与单视频复核分开）。广告初筛每 IP 每小时 5 次、全站每日 40 次。上述计数重启清零，不代表严格的金额预算。


### 视频指标与代表评论

频道清单、分析结果和报告展示视频浏览量及视频点赞数（YouTube 接口读取时的快照；未返回显示未公开／未获取，真实 0 显示为 0）。详情通过弹窗展示，可关闭或按 Esc 返回。

观众高赞评论按情感分类，每类最多 10 条，排除回复、可识别的频道主本人、重复文本和模型把握度低于 0.6 的评论，再按点赞数排序。批量详情默认展示每类前 5 条，其余展开；报告展示全部入选样本，并增加中性类。该规则减少选样噪声，不保证模型分类正确，尤其多语言评论仍需核查。


批量结果中的「查看详情」复用单视频完整 Dashboard：概览、分布、高频词、观众高赞评论、全量评论筛选／排序、逐条翻译、CSV 和 AI 深度分析。详情直接载入批次已有数据，不重复抓取或情感推理；详情中新生成的翻译、AI 主题和复核结果同步回批次，用于后续报告。翻译和深度分析仍需手动触发并消耗 DeepSeek 额度。
