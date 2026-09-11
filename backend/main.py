"""FastAPI 应用入口：路由 + 静态前端托管。

启动：uvicorn backend.main:app --reload
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import quota
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
MAX_TOP_LEVEL = int(os.getenv("MAX_TOP_LEVEL_COMMENTS", "500"))
DEEPSEEK_KEY_SET = bool(os.getenv("DEEPSEEK_API_KEY", "").strip())

# 跟 frontend/app.js 的 LOW_CONF_THRESHOLD 保持一致：低于这个把握度的评论才送去复核。
LOW_CONF_THRESHOLD = 0.6

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="CommentPulse API")


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


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    if not API_KEY:
        raise HTTPException(500, "服务器未配置 YOUTUBE_API_KEY，请检查项目根目录的 .env 文件")

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

    scored = score_comments(raw_comments)
    summary = compute_summary(scored)

    return {"video": video, "summary": summary, "comments": scored}


@app.post("/api/deep-analyze", response_model=DeepAnalyzeResponse)
def deep_analyze(req: DeepAnalyzeRequest):
    if not DEEPSEEK_KEY_SET:
        raise HTTPException(500, "服务器未配置 DEEPSEEK_API_KEY，请检查 .env 文件")

    all_comments = [c.model_dump() for c in req.comments]
    to_review = all_comments if req.full_recheck else [c for c in all_comments if c["confidence"] < LOW_CONF_THRESHOLD]

    try:
        reclassified = reclassify_comments(to_review, req.video_title) if to_review else []
        topics = summarize_topics(all_comments, req.video_title)
    except LLMError as e:
        raise HTTPException(400, e.message)

    return {"reclassified": reclassified, "topics": topics}


@app.post("/api/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    if not DEEPSEEK_KEY_SET:
        raise HTTPException(500, "服务器未配置 DEEPSEEK_API_KEY，请检查 .env 文件")
    if not req.comments:
        return {"translations": []}
    try:
        translations = translate_comments([c.model_dump() for c in req.comments])
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
