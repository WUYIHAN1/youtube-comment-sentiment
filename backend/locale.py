"""Language selection and translations of errors returned by the API."""

import re

from fastapi import Request


def request_locale(request: Request) -> str:
    language = request.headers.get("accept-language", "").split(",", 1)[0].split(";", 1)[0]
    return "en" if language.strip().lower().split("-", 1)[0] == "en" else "zh-CN"


ENGLISH_ERRORS = {
    "服务器未配置 YOUTUBE_API_KEY": "Set YOUTUBE_API_KEY in the project's .env file.",
    "服务器未配置 YOUTUBE_API_KEY，请检查项目根目录的 .env 文件": "Set YOUTUBE_API_KEY in the project's .env file.",
    "服务器未配置 DEEPSEEK_API_KEY，请检查 .env 文件": "Set DEEPSEEK_API_KEY in the project's .env file.",
    "请求太频繁，歇一会儿再试": "Too many requests. Wait a moment and try again.",
    "无法识别这个链接，请确认是完整的 YouTube 视频链接": "Enter a complete YouTube video link.",
    "没有抓到任何评论（评论区可能是空的）": "No comments were found for this video.",
    "深度分析请求太频繁，歇一会儿再试": "Too many deep analysis requests. Try again later.",
    "今天的深度分析额度已经用完了，明天再来": "Today's deep analysis quota has been used. Try again tomorrow.",
    "翻译请求太频繁，歇一会儿再试": "Too many translation requests. Try again later.",
    "今天的翻译额度已经用完了，明天再来": "Today's translation quota has been used. Try again tomorrow.",
    "频道查询过于频繁，请稍后重试": "Too many channel lookups. Try again later.",
    "广告初筛过于频繁，请稍后重试": "Too many sponsorship screening requests. Try again later.",
    "今日广告初筛额度已用完": "Today's sponsorship screening quota has been used.",
    "批量分析每小时最多 30 条视频，请稍后继续": "Batch analysis allows up to 30 videos per hour. Try again later.",
    "单视频主题总结最多接收 5000 条评论": "A video topic summary accepts up to 5,000 comments.",
    "批量主题总结每小时最多 15 次，请稍后继续": "Batch topic summaries are limited to 15 per hour. Try again later.",
    "今日批量主题总结额度已用完": "Today's batch topic summary quota has been used.",
    "AI 主题总结格式不完整，请重试": "The AI topic summary was incomplete. Please try again.",
    "该视频的评论区已关闭，没有可分析的评论": "Comments are turned off for this video.",
    "今日 YouTube API 配额已用尽，请明天再试": "Today's YouTube API quota has been used. Try again tomorrow.",
    "API key 无效或权限不足，请检查 .env 里的 YOUTUBE_API_KEY 和 Google Cloud 里的 API 限制设置":
        "The YouTube API key is invalid or restricted. Check .env and your Google Cloud API settings.",
    "视频不存在、已被删除或设为私有": "This video could not be found. It may be private or deleted.",
    "连接 YouTube API 失败或超时，请检查网络和代理设置后重试": "Could not reach the YouTube API. Check your network and proxy settings.",
    "获取 YouTube 评论失败或超时，请检查网络和代理设置后重试": "Could not fetch YouTube comments. Check your network and proxy settings.",
    "请输入 YouTube 频道链接、@账号或频道 ID": "Enter a YouTube channel link, @handle, or channel ID.",
    "该链接格式暂不支持，请使用频道的 @账号链接": "This link format is unsupported. Use the channel's @handle link.",
    "找不到该频道，请检查 @账号或频道链接": "Channel not found. Check the @handle or link.",
    "读取频道失败，请检查网络和代理后重试": "Could not load the channel. Check your network and proxy settings.",
    "DeepSeek key 无效，检查 .env 里的 DEEPSEEK_API_KEY 是不是填对了": "The DeepSeek key is invalid. Check DEEPSEEK_API_KEY in .env.",
    "DeepSeek 请求太频繁，或者账户余额不足，稍等一下或去充值后再试":
        "DeepSeek is rate limiting requests or your balance is too low. Check your balance and try again.",
    "DeepSeek 返回的内容不是合法 JSON，解析失败": "DeepSeek returned an invalid response. Please try again.",
    "DeepSeek 返回的主题总结缺字段": "DeepSeek returned an incomplete summary. Please try again.",
    "广告初筛结果不完整，请重试": "Sponsorship screening returned incomplete results. Please try again.",
    "广告初筛结果 ID 无效，请重试": "Sponsorship screening returned invalid video IDs. Please try again.",
    "广告初筛格式无效，请重试": "Sponsorship screening returned an invalid response. Please try again.",
}

ERROR_PREFIXES = {
    "连不上 DeepSeek 服务器": "Could not reach DeepSeek. Check your network connection and try again.",
    "DeepSeek 返回错误": "DeepSeek rejected the request. Check your account and try again.",
    "调用 DeepSeek 出错": "The DeepSeek request failed. Please try again.",
    "调用 YouTube API 时出错": "The YouTube API request failed. Please try again.",
}


def english_error(detail: str) -> str:
    if detail in ENGLISH_ERRORS:
        return ENGLISH_ERRORS[detail]
    for prefix, message in ERROR_PREFIXES.items():
        if detail.startswith(prefix):
            return message
    if re.search(r"[\u3400-\u9fff]", detail):
        return "The request failed. Please try again."
    return detail
