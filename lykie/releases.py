# -*- coding: utf-8 -*-
"""站内版本更新：写入与分享共用的收件箱。"""
from __future__ import annotations

from lykie import share as lykie_share

# 当前对用户宣告的版本号（小版本用 3.1 这种形式）
SITE_VERSION = "3.1"

# 用户向短说明（收件箱详情用）。改版本时同步更新 docs/版本更新-v*.md
RELEASES: dict[str, dict] = {
    "3.1": {
        "title": "V3.1 · 斩题手感升级",
        "message": "Lykie V3.1 已更新",
        "summary": "斩题更有手感，收件箱也能看见版本更新。",
        "bullets": [
            "斩题进度条分档鼓励：约 25% / 50% / 75% / 100% 短句 + 闪电，播完即消失。",
            "斩满过场：进度条上移居中再透视远去；结算从偏大缩小到位（错开播放）。",
            "二周目起：答对一次即可斩；答错后需再答对才能斩（一周目规则不变）。",
            "登录标语改为「把学会的，变成自己的。」",
            "分享通知与版本更新共用铃铛收件箱；点本条可看更新说明。",
        ],
        "date": "2026-09-15",
    },
}


def get_release(version: str | None = None) -> dict | None:
    ver = str(version or SITE_VERSION).strip()
    meta = RELEASES.get(ver)
    if not meta:
        return None
    out = dict(meta)
    out["version"] = ver
    return out


def ensure_release_notification(username: str, version: str | None = None) -> dict | None:
    """
    若收件箱尚无该版本的更新通知，则插入一条（每人每版本至多一条）。
    返回新建的通知，或 None（已有 / 无此版本）。
    """
    ver = str(version or SITE_VERSION).strip()
    meta = RELEASES.get(ver)
    if not meta or not username:
        return None

    inbox = lykie_share.load_notifications(username)
    notes = inbox.setdefault("notifications", [])
    for note in notes:
        if note.get("type") == "release" and str(note.get("version") or "") == ver:
            return None

    note = {
        "id": lykie_share.new_notification_id("r"),
        "type": "release",
        "version": ver,
        "title": meta.get("title") or f"V{ver}",
        "message": meta.get("message") or f"Lykie V{ver} 已更新",
        "summary": meta.get("summary") or "",
        "bullets": list(meta.get("bullets") or []),
        "created_at": meta.get("date") or lykie_share.now_str(),
        "read": False,
    }
    notes.insert(0, note)
    inbox["notifications"] = notes[:100]
    lykie_share.save_notifications(username, inbox)
    return note
