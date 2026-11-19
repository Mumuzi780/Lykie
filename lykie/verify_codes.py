# -*- coding: utf-8 -*-
"""邮箱验证码：生成、限频、校验。存 data/verify_codes.json（不进 git）。"""
import hashlib
import json
import os
import secrets
import tempfile
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CODES_FILE = os.path.join(DATA_DIR, "verify_codes.json")

TTL_SECONDS = 600    # 验证码 10 分钟有效
RESEND_SECONDS = 60  # 同一邮箱同一场景 60 秒内只能发一次
MAX_FAILS = 5        # 每个验证码最多错 5 次，超限作废


def _load():
    if not os.path.exists(CODES_FILE):
        return {}
    try:
        with open(CODES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="codes.", suffix=".tmp", dir=DATA_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, CODES_FILE)
    except Exception:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        raise


def _key(email, scene):
    return "%s|%s" % (email, scene)


def _prune(data, now=None):
    now = now if now is not None else time.time()
    for k in [k for k, v in data.items() if v.get("expires", 0) < now]:
        del data[k]


def can_send(email, scene):
    """同一邮箱同一场景 60 秒限频。"""
    entry = _load().get(_key(email, scene))
    return not entry or (time.time() - entry.get("sent_at", 0) >= RESEND_SECONDS)


def create(email, scene):
    """生成 6 位验证码并落盘，返回明文（用于发信）。"""
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    data = _load()
    _prune(data)
    data[_key(email, scene)] = {
        "hash": hashlib.sha256(code.encode("utf-8")).hexdigest(),
        "expires": time.time() + TTL_SECONDS,
        "sent_at": time.time(),
        "fails": 0,
    }
    _save(data)
    return code


def check(email, scene, code):
    """校验验证码；成功即消费（删除），失败累计次数，超限作废。"""
    key = _key(email, scene)
    data = _load()
    entry = data.get(key)
    if not entry or entry.get("expires", 0) < time.time():
        return False
    if hashlib.sha256(str(code or "").encode("utf-8")).hexdigest() != entry.get("hash"):
        entry["fails"] = entry.get("fails", 0) + 1
        if entry["fails"] >= MAX_FAILS:
            del data[key]
        else:
            data[key] = entry
        _save(data)
        return False
    del data[key]
    _save(data)
    return True
