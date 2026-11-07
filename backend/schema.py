"""数据结构定义。对应 mini-prd.md 第 6 节的接口设计。"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    url: str


class Comment(BaseModel):
    id: str
    author: str
    text: str
    like_count: int
    published_at: str
    is_reply: bool
    parent_id: Optional[str] = None
    author_channel_id: str = ""
    sentiment: Literal["positive", "neutral", "negative"]
    confidence: float


class Summary(BaseModel):
    total: int
    positive: int
    neutral: int
    negative: int
    positive_pct: float
    neutral_pct: float
    negative_pct: float
    avg_sentiment: float  # -1 ~ +1，positive=+1 / neutral=0 / negative=-1 按条数加权


class Video(BaseModel):
    id: str
    title: str
    channel: str
    thumbnail: str
    published_at: str = ""
    channel_id: str = ""
    view_count: Optional[int] = None
    like_count: Optional[int] = None


class AnalyzeResponse(BaseModel):
    video: Video
    summary: Summary
    comments: list[Comment]


# ---- Phase 2：DeepSeek 复核 + 主题总结 ----
# 接口保持无状态（跟 Phase 1 的设计原则一致）：前端把已经拿到的评论再传一次回来，
# 后端不缓存上一次 /api/analyze 的结果。


class CommentForReview(BaseModel):
    id: str
    text: str
    like_count: int = 0
    confidence: float = 1.0


class DeepAnalyzeRequest(BaseModel):
    video_title: str
    comments: list[CommentForReview]
    full_recheck: bool = False  # True = 复核全部评论；False（默认）= 只复核低把握度的


class ReclassifiedComment(BaseModel):
    id: str
    sentiment: Literal["positive", "neutral", "negative"]
    confidence: float
    reason: str
    reviewed_by: str


class Theme(BaseModel):
    title: str
    description: str
    tone: Literal["positive", "neutral", "negative"]  # 这个主题讨论呈现的整体情绪色彩


class ProductNeed(BaseModel):
    title: str
    description: str
    support: Literal["multiple", "few"]  # 多人提到 / 个别提到


class TopicSummary(BaseModel):
    summary: str
    themes: list[Theme]
    needs: list[ProductNeed]  # 从评论里提炼出的功能建议/产品需求，可能是空列表


class DeepAnalyzeResponse(BaseModel):
    reclassified: list[ReclassifiedComment]
    topics: TopicSummary


class TranslateRequest(BaseModel):
    comments: list[CommentForReview]


class Translation(BaseModel):
    id: str
    text_zh: str


class TranslateResponse(BaseModel):
    translations: list[Translation]


class ChannelVideosRequest(BaseModel):
    channel: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=30, ge=1, le=50)


class AdCandidate(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    title: str = Field(max_length=500)
    description: str = Field(default="", max_length=3000)


class AdScreenRequest(BaseModel):
    videos: list[AdCandidate] = Field(min_length=1, max_length=50)
