"""Phase 3 专用：限流 + 每日总预算，保护站长自己的 key 不被访客刷爆。

Key 策略是"站长自己的 key"（不是访客各带各的），所以陌生人一多，花的是你自己的钱和配额。
两层保护：
1. **单 IP 滑动窗口限流**——防止一个人短时间内狂点。
2. **每天全局调用上限**——防止很多不同的人加起来刷爆（单 IP 限流挡不住这种）。

都是进程内存状态，服务重启/重新部署就清零——对"挡刷"这个目的完全够用，没必要为了
这个引入 Redis 之类的外部依赖（Phase 3 first version，先简单，真被刷爆了再升级）。
"""

import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock

_lock = Lock()
_ip_hits: dict[tuple, list] = defaultdict(list)
_daily_counts: dict[str, dict] = {}


def check_ip_limit(bucket: str, ip: str, max_calls: int, window_seconds: int) -> bool:
    """同一个 IP 在 window_seconds 秒内最多调 max_calls 次。True=放行，False=超限。"""
    now = time.time()
    key = (bucket, ip)
    with _lock:
        hits = _ip_hits[key]
        cutoff = now - window_seconds
        while hits and hits[0] < cutoff:
            hits.pop(0)
        if len(hits) >= max_calls:
            return False
        hits.append(now)
        return True


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def check_daily_cap(bucket: str, max_calls: int) -> bool:
    """这个 bucket（比如"deep_analyze"）今天全站一共最多调 max_calls 次，不分 IP 统一算。"""
    today = _today()
    with _lock:
        entry = _daily_counts.get(bucket)
        if not entry or entry["date"] != today:
            entry = {"date": today, "count": 0}
        if entry["count"] >= max_calls:
            _daily_counts[bucket] = entry
            return False
        entry["count"] += 1
        _daily_counts[bucket] = entry
        return True


def client_ip(request) -> str:
    """部署到反向代理后面时，真实 IP 在 X-Forwarded-For 里，不是 request.client.host。"""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# 各接口的限流参数，都能用环境变量覆盖，不用改代码就能调。
ANALYZE_IP_LIMIT = int(os.getenv("ANALYZE_IP_LIMIT", "8"))
ANALYZE_IP_WINDOW = int(os.getenv("ANALYZE_IP_WINDOW", "600"))

DEEP_IP_LIMIT = int(os.getenv("DEEP_IP_LIMIT", "5"))
DEEP_IP_WINDOW = int(os.getenv("DEEP_IP_WINDOW", "3600"))
DEEP_DAILY_CAP = int(os.getenv("DEEP_DAILY_CAP", "40"))

TRANSLATE_IP_LIMIT = int(os.getenv("TRANSLATE_IP_LIMIT", "30"))
TRANSLATE_IP_WINDOW = int(os.getenv("TRANSLATE_IP_WINDOW", "3600"))
TRANSLATE_DAILY_CAP = int(os.getenv("TRANSLATE_DAILY_CAP", "300"))
