"""抓取层：解析 YouTube 链接、调 YouTube Data API v3 拿视频信息和评论。

对应 mini-prd.md F1（URL 输入）+ F2（抓评论）。
"""

import json
import re
from typing import Optional

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from . import quota


class YouTubeError(Exception):
    """统一的、带用户可读中文文案的错误。对应 PRD 第 5 节「错误处理」。"""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


_VIDEO_ID_PATTERNS = [
    r"(?:v=|/embed/|/shorts/)([0-9A-Za-z_-]{11})",
    r"youtu\.be/([0-9A-Za-z_-]{11})",
]


def extract_video_id(url: str) -> Optional[str]:
    """从各种形态的 YouTube 链接里解析出 11 位 videoId；解析不出返回 None。"""
    url = url.strip()
    for pattern in _VIDEO_ID_PATTERNS:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    # 允许用户直接粘贴纯 videoId
    if re.fullmatch(r"[0-9A-Za-z_-]{11}", url):
        return url
    return None


def build_client(api_key: str):
    return build("youtube", "v3", developerKey=api_key, cache_discovery=False)


def _reason_of(e: HttpError) -> str:
    try:
        content = json.loads(e.content.decode("utf-8"))
        errors = content.get("error", {}).get("errors", [])
        if errors:
            return errors[0].get("reason", "")
    except Exception:
        pass
    return ""


def _translate_http_error(e: HttpError) -> YouTubeError:
    reason = _reason_of(e)
    status = e.resp.status if e.resp is not None else None
    if reason in ("commentsDisabled",):
        return YouTubeError("comments_disabled", "该视频的评论区已关闭，没有可分析的评论")
    if reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"):
        return YouTubeError("quota_exceeded", "今日 YouTube API 配额已用尽，请明天再试")
    if reason in ("keyInvalid", "badRequest") or status in (400, 401, 403):
        return YouTubeError(
            "invalid_key", "API key 无效或权限不足，请检查 .env 里的 YOUTUBE_API_KEY 和 Google Cloud 里的 API 限制设置"
        )
    if status == 404 or reason == "videoNotFound":
        return YouTubeError("video_not_found", "视频不存在、已被删除或设为私有")
    return YouTubeError("unknown", f"调用 YouTube API 时出错：{e}")


def fetch_video_info(youtube, video_id: str) -> dict:
    try:
        resp = youtube.videos().list(part="snippet", id=video_id).execute()
        quota.add_usage(1)
    except HttpError as e:
        raise _translate_http_error(e)
    items = resp.get("items", [])
    if not items:
        raise YouTubeError("video_not_found", "视频不存在、已被删除或设为私有")
    sn = items[0]["snippet"]
    thumbs = sn.get("thumbnails", {})
    thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url", "")
    return {
        "id": video_id,
        "title": sn.get("title", "（无标题）"),
        "channel": sn.get("channelTitle", "（未知频道）"),
        "thumbnail": thumb,
    }


def _comment_from_snippet(cid: str, sn: dict, is_reply: bool, parent_id: Optional[str] = None) -> dict:
    return {
        "id": cid,
        "author": sn.get("authorDisplayName", "匿名用户"),
        "text": sn.get("textOriginal", ""),
        "like_count": sn.get("likeCount", 0),
        "published_at": sn.get("publishedAt", ""),
        "is_reply": is_reply,
        "parent_id": parent_id,
    }


# 只在缺口不大时才去补全回复（commentThreads 内嵌返回的和 totalReplyCount 差距 <= 这个数）。
# 常见情况（一条评论有 6~15 条回复，内嵌只给了 5 条）值得补；"Me at the zoo" 这种被刷了几千条
# 玩梗回复的极端楼层不值得——补一条这种楼层就要几十次分页请求，会把整个分析拖到几分钟、
# 烧穿配额，而且这种楼层本身也不构成有代表性的样本。超过阈值就只保留内嵌的那几条，不强求穷举。
REPLY_BACKFILL_THRESHOLD = 30


def _fetch_remaining_replies(youtube, parent_id: str, already_have: set) -> list[dict]:
    """comments.list(parentId=...) 分页补齐 commentThreads 内嵌没给全的回复。
    只在 fetch_comments 里判断缺口 <= REPLY_BACKFILL_THRESHOLD 时才会被调用，
    所以这里最多也就分页一两次，不会失控。
    """
    extra: list[dict] = []
    page_token = None
    while True:
        resp = (
            youtube.comments()
            .list(
                part="snippet",
                parentId=parent_id,
                maxResults=100,
                textFormat="plainText",
                pageToken=page_token,
            )
            .execute()
        )
        quota.add_usage(1)
        for r in resp.get("items", []):
            if r["id"] in already_have:
                continue
            extra.append(_comment_from_snippet(r["id"], r["snippet"], True, parent_id))
            already_have.add(r["id"])
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return extra


# 整次分析最多为多少个楼层去补全回复。真正拖慢速度的不是"单个楼层缺口多大"，
# 是"有多少个楼层各自都要发一次额外请求"——额外请求是顺序发的，楼层一多，
# 哪怕每个缺口都很小，加起来也会把整个分析拖到一两分钟。评论按热门排序，
# 越靠前的楼层越有代表性，所以只给前面这些楼层补全，后面的楼层保留内嵌的那几条。
MAX_BACKFILL_THREADS_PER_ANALYSIS = 30


def fetch_comments(api_key: str, video_id: str, max_top_level: int = 500) -> list[dict]:
    """抓评论：按热门排序（relevance），含回复。回复数缺口不大（<= REPLY_BACKFILL_THRESHOLD）
    的楼层会补全，但整次分析最多补 MAX_BACKFILL_THREADS_PER_ANALYSIS 个楼层——防止
    "多数楼层都有点小缺口"的视频因为要发很多次顺序请求而拖慢整个分析（2026-09-11 踩坑，
    "Me at the zoo" 压测：不限制时 1752 条评论跑了 2 分钟，限制后应在 20 秒内）。
    抓到 max_top_level 条顶层评论为止。
    """
    youtube = build_client(api_key)
    comments: list[dict] = []
    page_token = None
    fetched_top = 0
    backfilled_threads = 0

    try:
        while fetched_top < max_top_level:
            resp = (
                youtube.commentThreads()
                .list(
                    part="snippet,replies",
                    videoId=video_id,
                    order="relevance",
                    maxResults=min(100, max_top_level - fetched_top),
                    textFormat="plainText",
                    pageToken=page_token,
                )
                .execute()
            )
            quota.add_usage(1)
            items = resp.get("items", [])
            if not items:
                break
            for item in items:
                top = item["snippet"]["topLevelComment"]
                comments.append(_comment_from_snippet(top["id"], top["snippet"], False))
                fetched_top += 1

                inline_replies = item.get("replies", {}).get("comments", [])
                seen_ids = set()
                for r in inline_replies:
                    comments.append(_comment_from_snippet(r["id"], r["snippet"], True, top["id"]))
                    seen_ids.add(r["id"])

                total_replies = item["snippet"].get("totalReplyCount", 0)
                gap = total_replies - len(inline_replies)
                if 0 < gap <= REPLY_BACKFILL_THRESHOLD and backfilled_threads < MAX_BACKFILL_THREADS_PER_ANALYSIS:
                    comments.extend(_fetch_remaining_replies(youtube, top["id"], seen_ids))
                    backfilled_threads += 1

            page_token = resp.get("nextPageToken")
            if not page_token:
                break
    except HttpError as e:
        raise _translate_http_error(e)

    return comments
