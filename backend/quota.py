"""YouTube Data API v3 配额追踪。

注意：YouTube 官方**不提供任何接口查询"今天还剩多少配额"**——配额用量只能在 Google Cloud
控制台的 APIs & Services > Quotas 页面手动看。这里是我们自己按「每次调了哪个接口就记一笔」
做的本地估算，不是从 Google 那边查回来的权威数字。如果这个 key 还被别的程序/项目用，这个
数字就会跟 Google 后台的真实用量对不上——这种情况下只把它当参考，不当权威真相。

每个接口消耗的配额单位数按官方文档写死在这里（2026 年文档口径，Google 之后可能会调整）：
commentThreads.list / comments.list / videos.list 都是 1 单位。
"""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

QUOTA_FILE = Path(__file__).resolve().parent.parent / ".quota_usage.json"
DAILY_CAP = int(os.getenv("YOUTUBE_DAILY_QUOTA_CAP", "10000"))

# YouTube 配额按太平洋时间午夜重置。这里不处理夏令时切换的那一两天的一小时误差——
# 配额本身就是个粗粒度的东西，没必要为了这个引入时区库依赖。
_PACIFIC_OFFSET = timedelta(hours=-8)

_lock = Lock()


def _today_key() -> str:
    pacific_now = datetime.now(timezone.utc) + _PACIFIC_OFFSET
    return pacific_now.strftime("%Y-%m-%d")


def _load() -> dict:
    if QUOTA_FILE.exists():
        try:
            data = json.loads(QUOTA_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            data = {}
    else:
        data = {}
    if data.get("date") != _today_key():
        data = {"date": _today_key(), "used": 0}
    return data


def _save(data: dict) -> None:
    try:
        QUOTA_FILE.write_text(json.dumps(data))
    except OSError:
        pass  # 写文件失败不该让正常请求跟着失败，配额统计只是个辅助信息


def add_usage(units: int = 1) -> None:
    with _lock:
        data = _load()
        data["used"] = data.get("used", 0) + units
        _save(data)


def get_usage() -> dict:
    with _lock:
        data = _load()
    return {"date": data["date"], "used": data.get("used", 0), "cap": DAILY_CAP}
