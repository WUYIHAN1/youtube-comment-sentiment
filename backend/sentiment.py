"""打分层：本地跑 Twitter-RoBERTa 给每条评论打情感标签 + 置信度。

对应 mini-prd.md F3。模型：cardiffnlp/twitter-roberta-base-sentiment-latest
（RoBERTa 用 ~1.24 亿条推文预训练后微调的情感分类器，标签 positive/neutral/negative）。

置信度 = 模型给这个标签的概率（三类概率之和为 1，取最高的那个）。
低置信度常见于讽刺/反语——这是 Phase 2 打算丢给 Claude 复核的重点，Phase 1 先如实呈现。
"""

MODEL_NAME = "cardiffnlp/twitter-roberta-base-sentiment-latest"

_classifier = None


def _get_classifier():
    """惰性加载模型：首次调用才下载/加载，避免 FastAPI 启动时卡住。"""
    global _classifier
    if _classifier is None:
        import os

        # hf_xet 传输后端在部分网络环境下会卡死在 0 字节下载进度（实测复现）。
        # 强制退回普通 HTTPS 下载，避免首次分析请求无限挂起。
        os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

        from transformers import pipeline

        _classifier = pipeline(
            "sentiment-analysis",
            model=MODEL_NAME,
            tokenizer=MODEL_NAME,
            truncation=True,
            max_length=512,
        )
    return _classifier


def warm_up():
    """提前触发一次模型加载（可选，用于减少用户第一次分析时的等待感）。"""
    _get_classifier()


def score_comments(comments: list[dict], batch_size: int = 16) -> list[dict]:
    """给每条评论加上 sentiment / confidence 字段，原地返回同一批 dict。"""
    if not comments:
        return comments
    clf = _get_classifier()
    texts = [c["text"] or "" for c in comments]
    results = clf(texts, batch_size=batch_size)
    for c, r in zip(comments, results):
        c["sentiment"] = r["label"]  # 模型自带 id2label，已经是 positive/neutral/negative
        c["confidence"] = round(float(r["score"]), 4)
    return comments


_SENTIMENT_WEIGHT = {"positive": 1, "neutral": 0, "negative": -1}


def compute_summary(comments: list[dict]) -> dict:
    """算概览：总数、三类占比、平均情感分。对应 PRD 决策记录里的算法。"""
    total = len(comments)
    counts = {"positive": 0, "neutral": 0, "negative": 0}
    for c in comments:
        counts[c["sentiment"]] += 1

    def pct(n: int) -> float:
        return round(n / total * 100, 1) if total else 0.0

    avg = (
        sum(_SENTIMENT_WEIGHT[c["sentiment"]] for c in comments) / total
        if total
        else 0.0
    )

    return {
        "total": total,
        "positive": counts["positive"],
        "neutral": counts["neutral"],
        "negative": counts["negative"],
        "positive_pct": pct(counts["positive"]),
        "neutral_pct": pct(counts["neutral"]),
        "negative_pct": pct(counts["negative"]),
        "avg_sentiment": round(avg, 2),
    }
