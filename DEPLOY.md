# 部署上线（Phase 3，暂缓）

> 现状：已决定暂不上线，代码侧准备工作保留在这里，需要时可以直接按下面的步骤走。

## 个人主页入口

在项目目录用已有 Python 环境运行 `python -m uvicorn backend.main:app --reload`，
然后打开 `http://127.0.0.1:8000/portfolio`。个人主页、分析器和 API 由同一个 FastAPI 服务提供。

容器上线后，分享 `https://<部署域名>/portfolio`。访客点「体验评论分析器」即可进入工具。
在托管平台的密钥设置里配置 `YOUTUBE_API_KEY`，需要 AI 深度分析时再配置 `DEEPSEEK_API_KEY`。

## Docker 托管

托管平台选的是 **Hugging Face Spaces**（Docker SDK）。Key 策略是"站长自己的 key"——陌生人打开链接用的
是你的 YouTube/DeepSeek 配额和余额，所以代码里已经加了限流（`backend/budget.py`）：单 IP 滑动窗口 +
每日全局上限，都能用环境变量调，默认值偏保守，适合"分享给朋友圈"这个量级。

> **注意**：Hugging Face 最近把 Docker SDK 改成了需要 PRO 订阅（$9/月）才能创建，免费只剩 Static
> Space（纯静态，跑不了这个项目的后端）。走这条路之前先确认这个前提还成立，或者重新评估平台。

**步骤**：

1. 去 huggingface.co 注册/登录，右上角头像 → **New Space**
2. 起名字，**SDK 选 Docker**，硬件选 CPU basic，可见性按需（Private 只有你能打开，Public 谁都能访问）
3. 创建后会给你一个 git 仓库地址（`https://huggingface.co/spaces/<你的用户名>/<space名>`），
   把这个项目推上去：
   ```bash
   git remote add hf https://huggingface.co/spaces/<你的用户名>/<space名>
   git push hf main
   ```
4. 在 Space 页面的 **Settings → Repository secrets** 里添加：
   - `YOUTUBE_API_KEY`
   - `DEEPSEEK_API_KEY`（不加也行，Phase 2 功能会跳过，Phase 1 照常用）
5. 等它自动构建（首次构建要下 torch + 模型，得等几分钟），构建完 Space 页面就是能用的网址。

> Hugging Face Spaces 有时需要 `README.md` 顶部一段 YAML 元信息才能正确识别成 Docker Space。如果推
> 上去以后 Space 没有按 Dockerfile 构建，去 Space 的文件列表里确认有没有类似这样的块，没有就手动加：
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
