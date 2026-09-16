# -*- coding: utf-8 -*-
"""题库分享：只拷贝题目内容，不带答题进度；收件方收通知。"""
from __future__ import annotations

import copy
import json
import os
import tempfile
import time
from datetime import datetime

from lykie import accounts as lykie_accounts

PROGRESS_KEYS = (
    "status",
    "phase",
    "interval",
    "countdown",
    "streak",
    "answer_count",
    "correct_count",
)

CONTENT_SKIP_KEYS = frozenset(PROGRESS_KEYS) | {
    "id",
}


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def notifications_path(username: str) -> str:
    return os.path.join(lykie_accounts.user_dir(username), "notifications.json")


def _empty_inbox() -> dict:
    return {"notifications": []}


def load_notifications(username: str) -> dict:
    path = notifications_path(username)
    if not os.path.exists(path):
        return _empty_inbox()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty_inbox()
    if not isinstance(data, dict):
        return _empty_inbox()
    notes = data.get("notifications")
    if not isinstance(notes, list):
        data["notifications"] = []
    return data


def save_notifications(username: str, data: dict) -> None:
    lykie_accounts.ensure_user_files(username)
    path = notifications_path(username)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        prefix="notif.",
        suffix=".tmp",
        dir=os.path.dirname(path),
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


def list_share_targets(except_user: str) -> list[str]:
    me = lykie_accounts.normalize_username(except_user)
    out = []
    for name in lykie_accounts.list_usernames():
        n = lykie_accounts.normalize_username(name)
        if n and n != me:
            out.append(n)
    return out


def _new_id(prefix: str = "") -> str:
    base = str(int(time.time() * 1000))
    return f"{prefix}{base}" if prefix else base


def new_notification_id(prefix: str = "n") -> str:
    return _new_id(prefix)


def clone_question(src: dict, new_qid: str) -> dict:
    """深拷贝题目内容，进度归零。"""
    q = copy.deepcopy(src) if isinstance(src, dict) else {}
    q["id"] = new_qid
    q["status"] = "active"
    q["phase"] = "new"
    q["interval"] = 0
    q["countdown"] = 0
    q["streak"] = 0
    q["answer_count"] = 0
    q["correct_count"] = 0
    return q


def clone_bank_for_share(src_bank: dict, from_user: str) -> dict:
    """生成可写入对方题库的副本：同名、新 id、无进度 / 无周目 / 不进文件夹。"""
    src = src_bank or {}
    name = str(src.get("name") or "未命名题库").strip() or "未命名题库"
    bank_id = _new_id()
    questions = []
    for i, q in enumerate(src.get("questions") or []):
        if not isinstance(q, dict):
            continue
        questions.append(clone_question(q, f"{bank_id}-{i + 1}"))
    mode = src.get("mode")
    if not mode:
        # 粗判：有 short_answer 题则标简答
        if any(str(q.get("type") or "") == "short_answer" for q in questions):
            mode = "short_answer"
        else:
            mode = "objective"
    out = {
        "id": bank_id,
        "name": name,
        "imported_at": now_str(),
        "questions": questions,
        "mode": mode,
        "folder_id": None,
        "shared_from": lykie_accounts.normalize_username(from_user),
        "shared_at": now_str(),
    }
    return out


def _load_user_bank_file(username: str) -> dict:
    path = lykie_accounts.bank_path(username)
    lykie_accounts.ensure_user_files(username)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        data = {"banks": [], "current_bank_id": None}
    if not isinstance(data, dict):
        data = {"banks": [], "current_bank_id": None}
    if not isinstance(data.get("banks"), list):
        data["banks"] = []
    return data


def _save_user_bank_file(username: str, data: dict) -> None:
    path = lykie_accounts.bank_path(username)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        prefix="bank.",
        suffix=".tmp",
        dir=os.path.dirname(path),
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


def append_bank_to_user(username: str, bank: dict) -> dict:
    data = _load_user_bank_file(username)
    data["banks"].append(bank)
    if not data.get("current_bank_id"):
        data["current_bank_id"] = bank.get("id")
    _save_user_bank_file(username, data)
    return bank


def push_share_notification(
    to_user: str,
    from_user: str,
    bank_id: str,
    bank_name: str,
) -> dict:
    inbox = load_notifications(to_user)
    note = {
        "id": _new_id("n"),
        "type": "bank_share",
        "from_user": lykie_accounts.normalize_username(from_user),
        "bank_id": str(bank_id),
        "bank_name": bank_name,
        "message": f"{lykie_accounts.normalize_username(from_user)} 给你分享了题库「{bank_name}」",
        "created_at": now_str(),
        "read": False,
    }
    notes = inbox.setdefault("notifications", [])
    notes.insert(0, note)
    # 保留最近 100 条
    inbox["notifications"] = notes[:100]
    save_notifications(to_user, inbox)
    return note


def share_bank_to_users(
    from_user: str,
    src_bank: dict,
    to_users: list[str],
) -> tuple[dict | None, str]:
    """
    将 src_bank 拷贝给多个目标用户。
    返回 ({ok:[], failed:[{user,error}]}, error) ；全局失败时 ok 为 None。
    """
    me = lykie_accounts.normalize_username(from_user)
    if not src_bank or not isinstance(src_bank, dict):
        return None, "题库不存在"
    if not (src_bank.get("questions") or []):
        return None, "题库里没有题目，无法分享"
    raw_targets = []
    for u in to_users or []:
        n = lykie_accounts.normalize_username(u)
        if n and n not in raw_targets:
            raw_targets.append(n)
    if not raw_targets:
        return None, "请选择至少一个账号"
    ok_list = []
    failed = []
    for target in raw_targets:
        if target == me:
            failed.append({"user": target, "error": "不能分享给自己"})
            continue
        if not lykie_accounts.user_exists(target):
            failed.append({"user": target, "error": "账号不存在"})
            continue
        try:
            clone = clone_bank_for_share(src_bank, me)
            append_bank_to_user(target, clone)
            note = push_share_notification(
                target, me, clone["id"], clone["name"]
            )
            ok_list.append({
                "user": target,
                "bank_id": clone["id"],
                "bank_name": clone["name"],
                "notification_id": note["id"],
            })
        except Exception as e:
            failed.append({"user": target, "error": str(e)[:120]})
    if not ok_list and failed:
        return {"ok": ok_list, "failed": failed}, failed[0].get("error") or "分享失败"
    return {"ok": ok_list, "failed": failed}, ""


def list_notifications(username: str, limit: int = 50) -> list[dict]:
    inbox = load_notifications(username)
    notes = inbox.get("notifications") or []
    return notes[: max(1, min(int(limit or 50), 100))]


def unread_count(username: str) -> int:
    return sum(1 for n in list_notifications(username, 100) if not n.get("read"))


def mark_notifications_read(
    username: str,
    ids: list[str] | None = None,
    all_read: bool = False,
) -> int:
    inbox = load_notifications(username)
    notes = inbox.get("notifications") or []
    id_set = {str(x) for x in (ids or []) if x}
    n = 0
    for note in notes:
        if all_read or str(note.get("id")) in id_set:
            if not note.get("read"):
                note["read"] = True
                n += 1
    save_notifications(username, inbox)
    return n
