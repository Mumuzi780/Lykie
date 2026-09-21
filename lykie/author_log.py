# -*- coding: utf-8 -*-
"""作者现场日志：给人看、给方案/主仓读，禁止注入模型。"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime

from lykie import accounts as lykie_accounts

_lock = threading.RLock()
LOG_MAX = 200
SCENE_MAX = 200
TAIL_MAX = 80
CORR_MAX = 12


def _empty():
    return {"items": []}


def _read_json_log(path: str) -> dict:
    if not os.path.exists(path):
        return _empty()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty()
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return _empty()
    return data


def _item_id(item) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("id") or "")


def _merge_items(*groups):
    seen = set()
    out = []
    for group in groups:
        for item in (group or []):
            if not isinstance(item, dict):
                continue
            cid = _item_id(item)
            key = cid or json.dumps(item, ensure_ascii=False, sort_keys=True)[:240]
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
    out.sort(key=lambda x: int(x.get("ts") or 0))
    return out[-LOG_MAX:]


def _legacy_user_log_paths():
    root = lykie_accounts.USERS_ROOT
    names = []
    if os.path.isdir(root):
        try:
            names.extend(os.listdir(root))
        except OSError:
            pass
    try:
        names.extend(lykie_accounts.list_usernames())
    except Exception:
        pass
    seen = set()
    for n in names:
        if not n or n in seen:
            continue
        seen.add(n)
        path = lykie_accounts.lykie_author_log_user_path(n)
        if os.path.isfile(path):
            yield n, path


def _harvest_legacy_items():
    items = []
    for _name, path in _legacy_user_log_paths():
        items = _merge_items(items, _read_json_log(path).get("items"))
    return items


def load_log(username: str | None = None) -> dict:
    """全站共用。若尚无全局文件，从各账号旧日志迁出。"""
    path = lykie_accounts.lykie_author_log_path()
    with _lock:
        data = _read_json_log(path)
        dirty = False
        if not os.path.exists(path):
            data = {"items": _harvest_legacy_items()}
            dirty = True
        elif username:
            try:
                legacy = lykie_accounts.lykie_author_log_user_path(username)
            except ValueError:
                legacy = ""
            if legacy and os.path.isfile(legacy):
                merged = _merge_items(data.get("items"), _read_json_log(legacy).get("items"))
                if len(merged) != len(data.get("items") or []):
                    data = {"items": merged}
                    dirty = True
        if dirty:
            _save_log_unlocked(data)
            _rewrite_markdown_unlocked(data.get("items") or [])
        return data


def _save_log_unlocked(data: dict) -> None:
    path = lykie_accounts.lykie_author_log_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def save_log(username: str | None, data: dict) -> None:
    with _lock:
        _save_log_unlocked(data)


def _clip_scene(raw) -> list:
    out = []
    for m in raw or []:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip()
        if role not in ("user", "assistant", "system"):
            continue
        text = str(m.get("text") or m.get("content") or "").strip()
        if not text:
            continue
        out.append({"role": role, "text": text[:2000]})
    return out[-SCENE_MAX:]


def _clip_tail(raw) -> list:
    out = []
    for t in raw or []:
        if not isinstance(t, dict):
            continue
        role = str(t.get("role") or "").strip()
        content = str(t.get("content") or t.get("text") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        out.append({"role": role, "content": content[:2000]})
    return out[-TAIL_MAX:]


def _scene_blob(scene, user_said, focus_text) -> str:
    parts = [str(user_said or ""), str(focus_text or "")]
    for m in scene or []:
        parts.append(str((m or {}).get("text") or (m or {}).get("content") or ""))
    return "\n".join(parts)


def _pack_correction(c: dict) -> dict:
    return {
        "vibe": c.get("vibe") or "down",
        "user_said": str(c.get("user_said") or "")[:500],
        "bad_reply": str(c.get("bad_reply") or "")[:800],
        "good_lines": [str(x)[:120] for x in (c.get("good_lines") or [])][:8],
        "review": str(c.get("review") or "")[:500],
        "ts": int(c.get("ts") or 0),
    }


def _overlap(c: dict, blob: str) -> bool:
    keys = [
        str(c.get("user_said") or ""),
        str(c.get("bad_reply") or ""),
        "\n".join(str(x) for x in (c.get("good_lines") or [])),
    ]
    return any(k.strip() and k.strip()[:12] in blob for k in keys)


def corrections_in_scope(state, scene, user_said, focus_text) -> list:
    """圈定对话里对得上的点踩/点赞。点踩会回退气泡，本轮（清空/开场结束后）的点评仍带上；上一轮的不带。"""
    blob = _scene_blob(scene, user_said, focus_text)
    for t in state.get("chat_tail") or []:
        if isinstance(t, dict):
            blob += "\n" + str(t.get("content") or t.get("text") or "")
    session_ts = int((state.get("flags") or {}).get("chat_session_ts") or 0)
    matched, recent = [], []
    for c in state.get("corrections") or []:
        if not isinstance(c, dict):
            continue
        packed = _pack_correction(c)
        if blob.strip() and _overlap(c, blob):
            matched.append(packed)
        elif session_ts and int(c.get("ts") or 0) >= session_ts and (
            packed["review"] or packed["good_lines"]
        ):
            recent.append(packed)
    seen = set()
    out = []
    for item in matched + recent:
        key = (
            item["vibe"],
            item["user_said"],
            item["bad_reply"],
            tuple(item["good_lines"]),
            item["review"],
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out[-CORR_MAX:]


def _item_markdown(item: dict) -> str:
    stage = item.get("stage_label") or item.get("stage") or ""
    account = item.get("account") or ""
    head = f"## {item.get('time')} · {stage}"
    if account:
        head += f" · @{account}"
    lines = [
        head,
        "",
        f"**备注：** {item.get('note') or '（无）'}",
        f"**焦点·用户：** {(item.get('user_said') or '（无）').replace(chr(10), ' / ')}",
        f"**焦点·她：** {(item.get('focus_text') or '（无）').replace(chr(10), ' / ')}",
        "",
        "### 范围内的点踩 / 点赞（必看点评）",
    ]
    reviews = item.get("reviews") or []
    if not reviews:
        lines.append("（范围内没有点踩/点赞）")
    for i, c in enumerate(reviews, 1):
        vibe = "点赞" if c.get("vibe") == "up" else "点踩"
        good = " / ".join(c.get("good_lines") or []) or "（无）"
        lines.extend([
            f"{i}. **{vibe}**",
            f"   - 用户：{(c.get('user_said') or '').replace(chr(10), ' / ')}",
            f"   - 反例：{(c.get('bad_reply') or '（无）').replace(chr(10), ' / ')}",
            f"   - 你改成：{good}",
            f"   - 点评：{c.get('review') or '（无）'}",
        ])
    lines.extend(["", "### 选定对话"])
    for m in item.get("scene") or []:
        role = {"user": "你", "assistant": "Lykie", "system": "系统"}.get(
            m.get("role"), m.get("role")
        )
        lines.append(f"- **{role}：** {m.get('text')}")
    lines.extend(["", "---", ""])
    return "\n".join(lines)


def _rewrite_markdown_unlocked(items) -> None:
    path = lykie_accounts.lykie_author_log_md_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("".join(_item_markdown(it) for it in (items or []) if isinstance(it, dict)))


def _append_markdown(username: str | None, item: dict) -> None:
    path = lykie_accounts.lykie_author_log_md_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with _lock:
        with open(path, "a", encoding="utf-8") as f:
            f.write(_item_markdown(item))


def add_entry(
    username: str,
    *,
    note: str,
    stage: str,
    stage_label: str,
    user_said: str,
    focus_text: str,
    scene,
    chat_tail,
    reviews=None,
) -> dict:
    data = load_log(username)
    scene_n = _clip_scene(scene)
    item = {
        "id": uuid.uuid4().hex[:12],
        "ts": int(datetime.now().timestamp()),
        "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "account": str(username or "").strip(),
        "note": str(note or "").strip()[:2000],
        "stage": str(stage or "").strip(),
        "stage_label": str(stage_label or "").strip(),
        "user_said": str(user_said or "").strip()[:2000],
        "focus_text": str(focus_text or "").strip()[:2000],
        "scene": scene_n,
        "chat_tail": _clip_tail(chat_tail),
        "reviews": list(reviews or [])[-CORR_MAX:],
    }
    data.setdefault("items", []).append(item)
    data["items"] = data["items"][-LOG_MAX:]
    save_log(username, data)
    _append_markdown(username, item)
    return item
