"""Phase 2：接 LLM 做「低把握度评论复核」+「主题总结」。

默认走 DeepSeek（2026-09-11 用户决定：先试 DeepSeek，效果不好再切 Claude）。
DeepSeek 的接口跟 OpenAI 兼容，所以这里用 openai SDK，只是把 base_url 换成 DeepSeek 的地址。
以后要换 Claude，只用改这一个文件——main.py 和前端都不用动，这是特意留的口子。
"""

import json
import os
from typing import Optional

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"

RECLASSIFY_BATCH_SIZE = 40
TOPIC_SAMPLE_SIZE = 150
TRANSLATE_BATCH_SIZE = 50


class LLMError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _get_client():
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise LLMError("no_key", "服务器未配置 DEEPSEEK_API_KEY，请检查 .env 文件")
    from openai import OpenAI

    return OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)


def _chat_json(client, system: str, user: str) -> dict:
    """发一次请求，要求模型只回 JSON，解析失败就抛 LLMError（不悄悄吞掉、不瞎猜）。"""
    from openai import APIError

    try:
        resp = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
    except APIError as e:
        raise LLMError("api_error", f"调用 DeepSeek 出错：{e}")

    raw = resp.choices[0].message.content
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise LLMError("bad_response", "DeepSeek 返回的内容不是合法 JSON，解析失败")


def reclassify_comments(comments: list[dict], video_title: str) -> list[dict]:
    """对置信度较低的评论重新判断情感，带上视频标题这个语境。
    comments: 至少要有 id / text 两个字段。返回 [{id, sentiment, confidence, reason}, ...]。
    这里的 confidence 固定给 0.95（代表"由 LLM 复核过"，跟 RoBERTa 那套置信度不是一回事，
    前端会用一个角标区分开，别混着比）。
    """
    client = _get_client()
    results: list[dict] = []

    for i in range(0, len(comments), RECLASSIFY_BATCH_SIZE):
        batch = comments[i : i + RECLASSIFY_BATCH_SIZE]
        numbered = "\n".join(f'{c["id"]}: "{c["text"]}"' for c in batch)
        system = (
            "You classify YouTube comments as positive, neutral, or negative based on the "
            "commenter's actual attitude toward the video and its creator — not just the "
            "literal words. A comment can use negative-sounding words while agreeing with "
            "criticism the video makes (that counts as positive support for the video). "
            "Watch for sarcasm and irony. Respond with a JSON object only, no other text."
        )
        user = (
            f'Video title: "{video_title}"\n\n'
            "Classify each comment below. Return JSON exactly in this shape:\n"
            '{"results": [{"id": "<comment id>", "sentiment": "positive|neutral|negative", '
            '"reason": "<one short sentence in Chinese explaining why>"}]}\n\n'
            f"Comments (id: text):\n{numbered}"
        )
        data = _chat_json(client, system, user)
        for item in data.get("results", []):
            sentiment = item.get("sentiment")
            if sentiment not in ("positive", "neutral", "negative"):
                continue
            results.append(
                {
                    "id": item.get("id"),
                    "sentiment": sentiment,
                    "confidence": 0.95,
                    "reason": item.get("reason", ""),
                    "reviewed_by": "deepseek",
                }
            )
    return results


def translate_comments(comments: list[dict]) -> list[dict]:
    """把评论原文翻译成简体中文。comments 至少要有 id / text。
    返回 [{id, text_zh}, ...]；翻译失败/漏掉的 id 前端会自动回退显示原文，不会空白。
    """
    client = _get_client()
    results: list[dict] = []

    for i in range(0, len(comments), TRANSLATE_BATCH_SIZE):
        batch = comments[i : i + TRANSLATE_BATCH_SIZE]
        numbered = "\n".join(f'{c["id"]}: "{c["text"]}"' for c in batch)
        system = (
            "You translate YouTube comments into natural, colloquial Simplified Chinese — "
            "the way a Chinese YouTube viewer would actually phrase it, not a stiff literal "
            "translation. Keep internet slang, emoji, and tone. Respond with a JSON object only."
        )
        user = (
            "Translate each comment below into Simplified Chinese. Return JSON exactly in this "
            'shape: {"results": [{"id": "<comment id>", "text_zh": "<翻译>"}]}\n\n'
            f"Comments (id: text):\n{numbered}"
        )
        data = _chat_json(client, system, user)
        for item in data.get("results", []):
            if item.get("id") and item.get("text_zh"):
                results.append({"id": item["id"], "text_zh": item["text_zh"]})
    return results


def summarize_topics(comments: list[dict], video_title: str) -> dict:
    """对评论区做主题总结。取点赞最高的一批评论（不分情感类别）作代表样本，控制 token 成本。
    返回 {"summary": str, "themes": [{"title": str, "description": str}]}。
    """
    client = _get_client()
    sample = sorted(comments, key=lambda c: c.get("like_count", 0), reverse=True)[:TOPIC_SAMPLE_SIZE]
    numbered = "\n".join(f'- ({c.get("like_count", 0)} 👍) "{c["text"]}"' for c in sample)

    system = (
        "You analyze a YouTube video's comment section and summarize what viewers are "
        "discussing, for a Chinese-speaking user who does not want to read every comment. "
        "Respond with a JSON object only, no other text. Write all output text in Simplified "
        "Chinese; you may quote short English snippets from comments in double quotes."
    )
    user = (
        f'Video title: "{video_title}"\n\n'
        "Here are the most-liked comments from the comment section (like count is shown). "
        "Identify 3 to 5 concrete discussion themes and write a short overall summary.\n\n"
        "Return JSON exactly in this shape:\n"
        '{"summary": "<2-3 句话总述评论区整体在聊什么、氛围如何>", '
        '"themes": [{"title": "<4-8字的主题标签>", "description": "<1-2句说明，可引用原文>"}]}\n\n'
        f"Comments:\n{numbered}"
    )
    data = _chat_json(client, system, user)
    if "summary" not in data or "themes" not in data:
        raise LLMError("bad_response", "DeepSeek 返回的主题总结缺字段")
    return data
