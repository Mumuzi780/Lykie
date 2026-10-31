# -*- coding: utf-8 -*-
"""对话标注（// 反馈）与轮次留痕。

两件事：
1. 轮次留痕：每轮模型调用后把完整 messages 快照存进本账号 lykie_turns/（滚动覆盖），
   记录「她当时看到了什么」，供事后精确回放。
2. // 标注：作者在聊天输入框写 // 开头的反馈 → 拦截不进模型 → 锚定最近一轮快照
   固化进全站标注库。只给人看，禁止注入模型。
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import threading
import time
from datetime import datetime

from lykie import accounts as lykie_accounts

_lock = threading.RLock()

TURNS_MAX = 50       # 每账号滚动保留的快照轮数
ANNOT_MAX = 200      # 标注库上限，超出丢最旧
REPLY_PREVIEW_MAX = 120

STATUS_ALL = ("pending", "adopted", "ignored")
STATUS_LABELS = {
    "pending": "待分析",
    "adopted": "已采纳",
    "ignored": "已忽略",
}

# 「好」之后紧跟这些（或结束）才算好评标记，避免「//好烦」误判
_GOOD_TAIL = "，。！？：；、,.!?;: \t\r\n）)】」\"'…-—~"


# ==================== 轮次留痕 ====================

def _turns_dir(username):
    return lykie_accounts.lykie_turns_dir(username)


def save_turn(
    username,
    *,
    mode,
    stage,
    model,
    temperature,
    question_card,
    messages,
    reply,
    silent,
):
    """存一轮 prompt 快照，滚动保留最近 TURNS_MAX 轮。返回快照 id。"""
    ts = int(time.time() * 1000)
    tid = f"{ts}_{secrets.token_hex(2)}"
    snap = {
        "id": tid,
        "ts": ts,
        "account": lykie_accounts.normalize_username(username),
        "mode": str(mode or "chat"),
        "stage": str(stage or ""),
        "model": str(model or ""),
        "temperature": temperature,
        "question_card": question_card,
        "messages": json.loads(json.dumps(messages or [], ensure_ascii=False)),
        "reply": str(reply or ""),
        "silent": bool(silent),
    }
    with _lock:
        d = _turns_dir(username)
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, tid + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False, indent=2)
        _prune_turns_unlocked(username)
    return tid


def _prune_turns_unlocked(username):
    d = _turns_dir(username)
    try:
        names = sorted(n for n in os.listdir(d) if n.endswith(".json"))
    except OSError:
        return
    for name in names[:-TURNS_MAX]:
        try:
            os.remove(os.path.join(d, name))
        except OSError:
            pass


def latest_turn(username):
    """最近一轮快照；无留痕返回 None。"""
    with _lock:
        d = _turns_dir(username)
        try:
            names = sorted(n for n in os.listdir(d) if n.endswith(".json"))
        except OSError:
            return None
        if not names:
            return None
        path = os.path.join(d, names[-1])
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return None
        return data if isinstance(data, dict) else None


def clear_turns(username):
    """清空本账号轮次留痕（清空对话 / 清到开场后时联动，防 // 锚到重置前的旧轮次）。"""
    with _lock:
        d = _turns_dir(username)
        if os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)


# ==================== // 解析 ====================

def is_feedback(text) -> bool:
    """行首 // 开头 = 直达作者的意见（整条拦截，不进模型）。"""
    return str(text or "").lstrip().startswith("//")


def parse_feedback(text):
    """
    解析 // 反馈。返回 (vibe, body)；空反馈（// 后无内容）返回 None。
    - //好            → ("up", "")
    - //好，短句很自然 → ("up", "短句很自然")
    - //好烦          → ("down", "好烦")（「好」后接续文字不算好评）
    """
    s = str(text or "").lstrip()
    if not s.startswith("//"):
        return None
    body = s[2:].lstrip()
    if not body:
        return None
    if body.startswith("好"):
        tail = body[1:2]
        if not tail or tail in _GOOD_TAIL:
            return ("up", body[1:].lstrip(_GOOD_TAIL).strip())
    return ("down", body.strip())


# ==================== 标注库 ====================

def _empty():
    return {"items": []}


def _read_store() -> dict:
    path = lykie_accounts.lykie_annotations_path()
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


def _write_store(data: dict) -> None:
    path = lykie_accounts.lykie_annotations_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def capture(username, raw_text) -> dict:
    """
    把一条 // 反馈固化成标注：锚定最近一轮快照（整份拷贝，之后档案怎么改都不影响回放）。
    空反馈 / 本账号无留痕时抛 ValueError（中文，可直接给前端）。
    """
    parsed = parse_feedback(raw_text)
    if parsed is None:
        raise ValueError("反馈内容为空：// 后面写点什么")
    vibe, body = parsed
    turn = latest_turn(username)
    if not turn:
        raise ValueError("本账号还没有对话留痕，无从标注")
    turn_copy = json.loads(json.dumps(turn, ensure_ascii=False))
    ts = int(time.time())
    item = {
        "id": secrets.token_hex(6),
        "ts": ts,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "account": lykie_accounts.normalize_username(username),
        "vibe": vibe,
        "text": body[:2000],
        "raw": str(raw_text or "").strip()[:2100],
        "reply_preview": str(turn_copy.get("reply") or "")[:REPLY_PREVIEW_MAX],
        "turn": turn_copy,
        "status": "pending",
        "status_ts": ts,
    }
    with _lock:
        data = _read_store()
        data.setdefault("items", []).append(item)
        data["items"] = data["items"][-ANNOT_MAX:]
        _write_store(data)
    return item


def public_item(item) -> dict:
    """列表 / 状态回显用的瘦身版（去掉大块 turn.messages）。"""
    if not isinstance(item, dict):
        return {}
    turn = item.get("turn") or {}
    return {
        "id": item.get("id"),
        "ts": int(item.get("ts") or 0),
        "time": item.get("time") or "",
        "account": item.get("account") or "",
        "vibe": item.get("vibe") or "down",
        "text": item.get("text") or "",
        "raw": item.get("raw") or "",
        "reply_preview": item.get("reply_preview") or "",
        "turn_id": turn.get("id") or "",
        "turn_ts": int(turn.get("ts") or 0),
        "stage": turn.get("stage") or "",
        "mode": turn.get("mode") or "chat",
        "status": item.get("status") or "pending",
        "status_ts": int(item.get("status_ts") or 0),
    }


def list_annotations():
    """最新在前，只带元数据。"""
    with _lock:
        items = list(_read_store().get("items") or [])
    return [public_item(it) for it in reversed(items) if isinstance(it, dict)]


def get_annotation(aid):
    with _lock:
        for it in _read_store().get("items") or []:
            if isinstance(it, dict) and str(it.get("id") or "") == str(aid or "").strip():
                return it
    return None


def set_status(aid, status):
    """改状态（pending/adopted/ignored）。返回更新后的条目；找不到或状态非法返回 None。"""
    sid = str(status or "").strip()
    if sid not in STATUS_ALL:
        return None
    with _lock:
        data = _read_store()
        for it in data.get("items") or []:
            if isinstance(it, dict) and str(it.get("id") or "") == str(aid or "").strip():
                it["status"] = sid
                it["status_ts"] = int(time.time())
                _write_store(data)
                return it
    return None


def counts() -> dict:
    with _lock:
        items = [it for it in _read_store().get("items") or [] if isinstance(it, dict)]
    return {
        "total": len(items),
        "pending": sum(1 for it in items if it.get("status") == "pending"),
    }
