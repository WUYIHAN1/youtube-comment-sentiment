"""FastAPI 应用入口：路由 + 静态前端托管。

启动：uvicorn backend.main:app --reload
"""

import os
from threading import Lock
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import budget, quota
from .locale import english_error, request_locale
from .schema import ChannelVideosRequest, AdScreenRequest
from .youtube import list_recent_videos
from .llm import screen_ad_videos
from .llm import LLMError, reclassify_comments, summarize_topics, translate_comments
from .schema import (
    AnalyzeRequest,
    AnalyzeResponse,
    DeepAnalyzeRequest,
    DeepAnalyzeResponse,
    TranslateRequest,
    TranslateResponse,
)
from .sentiment import compute_summary, score_comments
from .youtube import YouTubeError, build_client, extract_video_id, fetch_comments, fetch_video_info

load_dotenv()

API_KEY = os.getenv("YOUTUBE_API_KEY", "").strip()
MAX_TOP_LEVEL = int(os.getenv("MAX_TOP_LEVEL_COMMENTS", "1000"))
DEEPSEEK_KEY_SET = bool(os.getenv("DEEPSEEK_API_KEY", "").strip())

# 跟 frontend/app.js 的 LOW_CONF_THRESHOLD 保持一致：低于这个把握度的评论才送去复核。
LOW_CONF_THRESHOLD = 0.6

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="CommentPulse API")
_model_lock = Lock()


@app.exception_handler(HTTPException)
async def localized_http_exception(request: Request, exc: HTTPException):
    if request_locale(request) == "en" and isinstance(exc.detail, str):
        exc = HTTPException(exc.status_code, english_error(exc.detail), headers=exc.headers)
    return await http_exception_handler(request, exc)


@app.middleware("http")
async def no_cache_for_static(request: Request, call_next):
    """Phase 1 还在频繁改前端，浏览器对没设 Cache-Control 的静态文件会启发式缓存，
    改完代码刷新页面却看到旧版本，很容易误以为改动没生效（2026-09-11 踩坑，见项目日志）。
    强制每次都带条件请求去服务器验证（ETag 命中时只是个很便宜的 304，不影响正常使用体验）。
    """
    response = await call_next(request)
    if request.url.path.startswith("/static/") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/portfolio", include_in_schema=False)
def portfolio():
    return FileResponse(FRONTEND_DIR / "portfolio.html", headers={"Cache-Control": "no-cache"})


@app.get("/portfolio/preview.png", include_in_schema=False)
def portfolio_preview():
    return FileResponse(FRONTEND_DIR.parent / "assets" / "overview.png")


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest, request: Request):
    if not API_KEY:
        raise HTTPException(500, "服务器未配置 YOUTUBE_API_KEY，请检查项目根目录的 .env 文件")

    ip = budget.client_ip(request)
    if not budget.check_ip_limit("analyze", ip, budget.ANALYZE_IP_LIMIT, budget.ANALYZE_IP_WINDOW):
        raise HTTPException(429, "请求太频繁，歇一会儿再试")

    return analyze_video(req)


def analyze_video(req: AnalyzeRequest):
    video_id = extract_video_id(req.url)
    if not video_id:
        raise HTTPException(400, "无法识别这个链接，请确认是完整的 YouTube 视频链接")

    try:
        youtube = build_client(API_KEY)
        video = fetch_video_info(youtube, video_id)
        raw_comments = fetch_comments(API_KEY, video_id, MAX_TOP_LEVEL)
    except YouTubeError as e:
        raise HTTPException(400, e.message)

    if not raw_comments:
        raise HTTPException(400, "没有抓到任何评论（评论区可能是空的）")

    with _model_lock:
        scored = score_comments(raw_comments)
    summary = compute_summary(scored)

    return {"video": video, "summary": summary, "comments": scored}


@app.post("/api/deep-analyze", response_model=DeepAnalyzeResponse)
def deep_analyze(req: DeepAnalyzeRequest, request: Request):
    if not DEEPSEEK_KEY_SET:
        raise HTTPException(500, "服务器未配置 DEEPSEEK_API_KEY，请检查 .env 文件")

    ip = budget.client_ip(request)
    if not budget.check_ip_limit("deep_analyze", ip, budget.DEEP_IP_LIMIT, budget.DEEP_IP_WINDOW):
        raise HTTPException(429, "深度分析请求太频繁，歇一会儿再试")
    if not budget.check_daily_cap("deep_analyze", budget.DEEP_DAILY_CAP):
        raise HTTPException(429, "今天的深度分析额度已经用完了，明天再来")

    all_comments = [c.model_dump() for c in req.comments]
    to_review = all_comments if req.full_recheck else [c for c in all_comments if c["confidence"] < LOW_CONF_THRESHOLD]

    language = request_locale(request)
    try:
        reclassified = reclassify_comments(to_review, req.video_title, language) if to_review else []
        topics = summarize_topics(all_comments, req.video_title, language)
    except LLMError as e:
        raise HTTPException(400, e.message)

    return {"reclassified": reclassified, "topics": topics}


@app.post("/api/translate", response_model=TranslateResponse, response_model_exclude_none=True)
def translate(req: TranslateRequest, request: Request):
    if not DEEPSEEK_KEY_SET:
        raise HTTPException(500, "服务器未配置 DEEPSEEK_API_KEY，请检查 .env 文件")
    if not req.comments:
        return {"translations": []}

    ip = budget.client_ip(request)
    if not budget.check_ip_limit("translate", ip, budget.TRANSLATE_IP_LIMIT, budget.TRANSLATE_IP_WINDOW):
        raise HTTPException(429, "翻译请求太频繁，歇一会儿再试")
    if not budget.check_daily_cap("translate", budget.TRANSLATE_DAILY_CAP):
        raise HTTPException(429, "今天的翻译额度已经用完了，明天再来")

    try:
        translations = translate_comments([c.model_dump() for c in req.comments], request_locale(request))
    except LLMError as e:
        raise HTTPException(400, e.message)
    return {"translations": translations}


@app.get("/api/quota")
def quota_status():
    """YouTube API 配额用量——本地估算，不是 Google 官方权威数字，见 backend/quota.py 顶部说明。"""
    return quota.get_usage()


@app.get("/api/health")
def health():
    return {"ok": True, "has_api_key": bool(API_KEY), "has_deepseek_key": DEEPSEEK_KEY_SET}


@app.post("/api/channel-videos")
def channel_videos(req: ChannelVideosRequest, request: Request):
    if not API_KEY:
        raise HTTPException(500, "服务器未配置 YOUTUBE_API_KEY")
    if not budget.check_ip_limit("channel", budget.client_ip(request), 15, 600):
        raise HTTPException(429, "频道查询过于频繁，请稍后重试")
    try:
        return list_recent_videos(API_KEY, req.channel, req.limit)
    except YouTubeError as e:
        raise HTTPException(400, e.message)


@app.post("/api/screen-ads")
def screen_ads(req: AdScreenRequest, request: Request):
    if not budget.check_ip_limit("screen_ads", budget.client_ip(request), 5, 3600):
        raise HTTPException(429, "广告初筛过于频繁，请稍后重试")
    if not budget.check_daily_cap("screen_ads", 40):
        raise HTTPException(429, "今日广告初筛额度已用完")
    try:
        return {"videos": screen_ad_videos([v.model_dump() for v in req.videos], request_locale(request))}
    except LLMError as e:
        raise HTTPException(400, e.message)


@app.post("/api/batch-item", response_model=AnalyzeResponse)
def batch_item(req: AnalyzeRequest, request: Request):
    if not API_KEY:
        raise HTTPException(500, "服务器未配置 YOUTUBE_API_KEY")
    if not budget.check_ip_limit("batch_item", budget.client_ip(request), 30, 3600):
        raise HTTPException(429, "批量分析每小时最多 30 条视频，请稍后继续")
    return analyze_video(req)


@app.post("/api/batch-topics")
def batch_topics(req: DeepAnalyzeRequest, request: Request):
    """Topic-only workflow: never reclassify comments or use its separate quota."""
    if len(req.comments) > 5000:
        raise HTTPException(400, "单视频主题总结最多接收 5000 条评论")
    if not budget.check_ip_limit("batch_topics", budget.client_ip(request), 15, 3600):
        raise HTTPException(429, "批量主题总结每小时最多 15 次，请稍后继续")
    if not budget.check_daily_cap("batch_topics", budget.DEEP_DAILY_CAP):
        raise HTTPException(429, "今日批量主题总结额度已用完")
    try:
        from .schema import TopicSummary
        topics = summarize_topics([c.model_dump() for c in req.comments], req.video_title, request_locale(request))
        return {"topics": TopicSummary.model_validate(topics).model_dump()}
    except LLMError as e:
        raise HTTPException(400, e.message)
    except ValueError:
        raise HTTPException(502, "AI 主题总结格式不完整，请重试")
