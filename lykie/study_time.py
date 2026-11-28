# -*- coding: utf-8 -*-
"""学习时长：按天、按区域（题库区 bank / 英语作答区 english）累计；
英语作答区再下钻到题块（阅读卷的大题，如选词填空/段落匹配），
并按「次」保存每个题块的作答记录（用时、是否答完），用来对照考场参考时限。

前端作答时计时、空闲自动暂停，周期性心跳上报秒数；本模块只做累加，
统计接口负责聚合，供顶部计时器与统计面板使用。
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta

from lykie import accounts as lykie_accounts

AREAS = ("bank", "english")

AREA_NAMES = {"bank": "题库区", "english": "英语作答区"}

# 只保留近一年多的明细，防文件无限膨胀
_KEEP_DAYS = 400

# 统计接口单次返回的题块明细条数上限
_MAX_SECTION_ROWS = 40

# 单次上报上限：一天 24 小时
_MAX_SECONDS = 24 * 3600

# 每个题块保留的作答记录条数
_MAX_ATTEMPTS = 30

# 统计接口每个题块返回的最近作答记录条数
_MAX_ATTEMPT_ROWS = 8

# 考场参考时限（秒），按题型；未列出的题型不限时
SECTION_STANDARD = {
    "bank": 8 * 60,        # 选词填空
    "match": 10 * 60,      # 段落匹配
    "choice": 10 * 60,     # 仔细阅读（每篇）
    "translation": 30 * 60,
}


def study_time_path(username: str) -> str:
    return os.path.join(lykie_accounts.user_dir(username), "study_time.json")


def _empty() -> dict:
    return {"days": {}, "sections": {}}


def _to_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _clean_attempt(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    dur = max(0, min(_to_int(raw.get("dur")), _MAX_SECONDS))
    if dur <= 0:
        return None
    return {
        "ts": str(raw.get("ts") or "")[:16],
        "dur": dur,
        "paused": max(0, min(_to_int(raw.get("paused")), _MAX_SECONDS)),
        "answered": max(0, _to_int(raw.get("answered"))),
        "total": max(0, _to_int(raw.get("total"))),
        "fresh": bool(raw.get("fresh")),
        "done": bool(raw.get("done")),
    }


def load_study_time(username: str) -> dict:
    path = study_time_path(username)
    if not os.path.exists(path):
        return _empty()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    clean = {"days": {}, "sections": {}}
    if isinstance(data.get("days"), dict):
        for day, areas in data["days"].items():
            if not isinstance(areas, dict):
                continue
            clean_bucket = {}
            for area in AREAS:
                try:
                    clean_bucket[area] = max(0, int(areas.get(area) or 0))
                except (TypeError, ValueError):
                    clean_bucket[area] = 0
            clean["days"][day] = clean_bucket
    if isinstance(data.get("sections"), dict):
        for sec_id, entry in data["sections"].items():
            if not isinstance(entry, dict) or not isinstance(entry.get("days"), dict):
                continue
            clean_days = {}
            for d, v in entry["days"].items():
                if not str(d).strip():
                    continue
                try:
                    clean_days[str(d)] = max(0, int(v or 0))
                except (TypeError, ValueError):
                    continue
            attempts = []
            if isinstance(entry.get("attempts"), list):
                for a in entry["attempts"]:
                    item = _clean_attempt(a)
                    if item:
                        attempts.append(item)
            clean["sections"][str(sec_id)] = {
                "label": str(entry.get("label") or "")[:120],
                "kind": str(entry.get("kind") or "")[:40],
                "text_title": str(entry.get("text_title") or "")[:120],
                "last": str(entry.get("last") or ""),
                "days": clean_days,
                "attempts": attempts[:_MAX_ATTEMPTS],
            }
    return clean


def _prune(data: dict) -> None:
    cutoff = (datetime.now() - timedelta(days=_KEEP_DAYS)).strftime("%Y-%m-%d")
    for day in list(data["days"].keys()):
        if day < cutoff:
            del data["days"][day]
    for sec_id in list(data["sections"].keys()):
        entry = data["sections"].get(sec_id)
        if not isinstance(entry, dict) or not entry.get("last"):
            del data["sections"][sec_id]
            continue
        if str(entry["last"]) < cutoff:
            del data["sections"][sec_id]
        else:
            for d in list(entry.get("days") or {}):
                if str(d) < cutoff:
                    del entry["days"][d]
            if len(entry.get("attempts") or []) > _MAX_ATTEMPTS:
                del entry["attempts"][_MAX_ATTEMPTS:]


def save_study_time(username: str, data: dict) -> None:
    lykie_accounts.ensure_user_files(username)
    path = study_time_path(username)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        prefix="study_time.", suffix=".tmp", dir=os.path.dirname(path)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def today_str(when=None) -> str:
    return (when or datetime.now()).strftime("%Y-%m-%d")


def _apply_meta(entry: dict, info: dict) -> None:
    for field in ("label", "kind", "text_title"):
        v = str(info.get(field) or "").strip()[:120]
        if v:
            entry[field] = v


def add_seconds(
    username: str,
    pairs: dict,
    sections: dict | None = None,
    attempts: list | None = None,
    when=None,
) -> dict:
    """批量累计当日时长。一次读盘一次写盘。

    pairs 形如 {"bank": 秒, "english": 秒}；
    sections 形如 {"<text_id>::<sec_key>": {"seconds": 秒, "label": 题块名,
    "kind": 题型, "text_title": 卷标题}}，key 不合法/秒数无效的条目跳过。
    attempts 是本题块的一次作答记录列表：{"id": "<text_id>::<sec_key>",
    "dur": 有效用时秒, "paused": 暂停秒, "answered": 已答数, "total": 总数,
    "fresh": 是否全新开始, "done": 是否答完, 外加 label/kind/text_title}；
    同样跳过不合法的条目。

    返回当日各区累计秒数。
    """
    data = load_study_time(username)
    day = today_str(when)
    bucket = data["days"].setdefault(day, {a: 0 for a in AREAS})
    dirty = False
    for area, seconds in (pairs or {}).items():
        if area not in AREAS:
            continue
        try:
            sec = int(seconds or 0)
        except (TypeError, ValueError):
            continue
        sec = max(0, min(sec, _MAX_SECONDS))
        if sec <= 0:
            continue
        bucket[area] = bucket.get(area, 0) + sec
        dirty = True
    for sec_id, info in (sections or {}).items():
        sec_id = str(sec_id or "").strip()
        if not sec_id or "::" not in sec_id or not isinstance(info, dict):
            continue
        try:
            sec = max(0, min(int(info.get("seconds") or 0), _MAX_SECONDS))
        except (TypeError, ValueError):
            continue
        if sec <= 0:
            continue
        entry = data["sections"].setdefault(sec_id, {"days": {}})
        entry["days"][day] = int(entry["days"].get(day) or 0) + sec
        _apply_meta(entry, info)
        entry["last"] = day
        dirty = True
    ts = (when or datetime.now()).strftime("%Y-%m-%d %H:%M")
    for raw in (attempts or []):
        if not isinstance(raw, dict):
            continue
        sec_id = str(raw.get("id") or "").strip()
        if not sec_id or "::" not in sec_id:
            continue
        item = _clean_attempt(raw)
        if not item:
            continue
        entry = data["sections"].setdefault(sec_id, {"days": {}})
        _apply_meta(entry, raw)
        item["ts"] = ts
        entry.setdefault("attempts", []).insert(0, item)
        del entry["attempts"][_MAX_ATTEMPTS:]
        entry["last"] = day
        dirty = True
    if dirty:
        _prune(data)
        save_study_time(username, data)
    return {a: int(bucket.get(a) or 0) for a in AREAS}


def stats(username: str, days: int = 30) -> dict:
    """近 N 天逐日数据 + 今日 + 范围总计 + 题块用时明细（累计 + 每次作答记录，按最近活跃排序）。"""
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 30
    days = max(1, min(days, _KEEP_DAYS))
    data = load_study_time(username)
    end = datetime.now().date()
    start = end - timedelta(days=days - 1)
    rows = []
    totals = {a: 0 for a in AREAS}
    for i in range(days):
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        bucket = data["days"].get(d, {})
        row = {"date": d}
        for area in AREAS:
            sec = int(bucket.get(area) or 0)
            row[area] = sec
            totals[area] += sec
        rows.append(row)
    today = rows[-1] if rows else {a: 0 for a in AREAS}
    today_date = today.get("date") or end.strftime("%Y-%m-%d")
    sec_rows = []
    for sec_id, entry in data["sections"].items():
        total = 0
        for v in (entry.get("days") or {}).values():
            try:
                total += int(v)
            except (TypeError, ValueError):
                pass
        attempts = entry.get("attempts") or []
        if total <= 0 and not attempts:
            continue
        try:
            today_sec = int((entry.get("days") or {}).get(today_date) or 0)
        except (TypeError, ValueError):
            today_sec = 0
        # 平均/最快只看「全新开始且一次做完」的记录：接着上次做的时间不反映考场用时
        full = [a["dur"] for a in attempts if a.get("fresh") and a.get("done")]
        sec_rows.append({
            "id": sec_id,
            "label": entry.get("label") or "",
            "kind": entry.get("kind") or "",
            "text_title": entry.get("text_title") or "",
            "total": total,
            "today": today_sec,
            "last": entry.get("last") or "",
            "standard": SECTION_STANDARD.get(entry.get("kind") or "", 0),
            "attempts": attempts[:_MAX_ATTEMPT_ROWS],
            "avg": round(sum(full) / len(full)) if full else 0,
            "best": min(full) if full else 0,
        })
    sec_rows.sort(key=lambda r: (r["last"], r["total"]), reverse=True)
    return {
        "days": rows,
        "today": {a: int(today.get(a) or 0) for a in AREAS},
        "totals": {
            "bank": totals["bank"],
            "english": totals["english"],
            "all": totals["bank"] + totals["english"],
        },
        "sections": sec_rows[:_MAX_SECTION_ROWS],
        "standards": SECTION_STANDARD,
    }
