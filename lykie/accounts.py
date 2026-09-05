# -*- coding: utf-8 -*-
"""邀请制账号：用户名+密码，每人一份题库和 Lykie 记忆。"""
import json
import os
import re
import secrets
import shutil
import tempfile
from datetime import datetime

from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
SECRET_FILE = os.path.join(DATA_DIR, "secret_key")
USERS_ROOT = os.path.join(DATA_DIR, "users")
LEGACY_BANK = os.path.join(DATA_DIR, "bank.json")
LEGACY_LYKIE = os.path.join(DATA_DIR, "lykie_state.json")

_USERNAME_RE = re.compile(r"^[\w\u4e00-\u9fff-]{2,24}$")
def normalize_username(name):
    return str(name or "").strip()


def valid_username(name):
    n = normalize_username(name)
    if not n or n in (".", ".."):
        return False
    if n.startswith(".") or "/" in n or "\\" in n:
        return False
    return bool(_USERNAME_RE.match(n))


def user_dir(username):
    n = normalize_username(username)
    if not valid_username(n):
        raise ValueError("用户名不合法")
    return os.path.join(USERS_ROOT, n)


def bank_path(username):
    return os.path.join(user_dir(username), "bank.json")


def lykie_path(username):
    return os.path.join(user_dir(username), "lykie_state.json")


def ensure_secret_key():
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "r", encoding="utf-8") as f:
            key = f.read().strip()
        if key:
            return key
    key = secrets.token_hex(32)
    with open(SECRET_FILE, "w", encoding="utf-8") as f:
        f.write(key)
    return key


def _empty_users():
    return {"users": []}


def _load_users():
    if not os.path.exists(USERS_FILE):
        return _empty_users()
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty_users()
    if not isinstance(data, dict):
        return _empty_users()
    users = data.get("users")
    if not isinstance(users, list):
        data["users"] = []
    return data


def _atomic_write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="users.", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        raise


def _save_users(data):
    _atomic_write_json(USERS_FILE, data)


def list_usernames():
    return [u.get("username") for u in _load_users().get("users") or [] if u.get("username")]


def has_users():
    return bool(list_usernames())


def user_exists(username):
    n = normalize_username(username)
    return n in list_usernames()


def ensure_user_files(username):
    d = user_dir(username)
    os.makedirs(d, exist_ok=True)
    bp = bank_path(username)
    lp = lykie_path(username)
    if not os.path.exists(bp):
        with open(bp, "w", encoding="utf-8") as f:
            json.dump({"banks": [], "current_bank_id": None}, f, ensure_ascii=False, indent=2)
    if not os.path.exists(lp):
        with open(lp, "w", encoding="utf-8") as f:
            json.dump({}, f, ensure_ascii=False, indent=2)


def _copy_if_exists(src, dest):
    if os.path.exists(src) and not os.path.exists(dest):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(src, dest)
        return True
    return False


def add_user(username, password):
    n = normalize_username(username)
    if not valid_username(n):
        raise ValueError("用户名须为 2–24 个字，可用中文、字母、数字、下划线、短横线")
    pwd = str(password or "")
    if len(pwd) < 4:
        raise ValueError("密码至少 4 位")

    data = _load_users()
    if any(u.get("username") == n for u in data["users"]):
        raise ValueError("这个用户名已经存在")

    first = not data["users"]
    data["users"].append({
        "username": n,
        "password_hash": generate_password_hash(pwd),
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
    })
    os.makedirs(user_dir(n), exist_ok=True)

    migrated = []
    if first:
        if _copy_if_exists(LEGACY_BANK, bank_path(n)):
            migrated.append("题库")
        if _copy_if_exists(LEGACY_LYKIE, lykie_path(n)):
            migrated.append("Lykie 记忆")
    ensure_user_files(n)
    _save_users(data)
    return {"username": n, "first": first, "migrated": migrated}


def verify_user(username, password):
    n = normalize_username(username)
    if not valid_username(n):
        return False
    for u in _load_users().get("users") or []:
        if u.get("username") == n:
            hashed = u.get("password_hash") or ""
            try:
                ok = check_password_hash(hashed, str(password or ""))
            except Exception:
                return False
            if ok:
                ensure_user_files(n)
            return ok
    return False


def main(argv=None):
    import getpass
    import sys

    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print("用法：")
        print("  python add_user.py 用户名")
        print("  python add_user.py 用户名 密码")
        print("  python add_user.py list")
        return 1
    if argv[0] == "list":
        names = list_usernames()
        if not names:
            print("还没有账号。添加：python add_user.py 用户名")
            return 0
        print("已有账号：")
        for n in names:
            print("  " + n)
        return 0
    if argv[0] == "add":
        argv = argv[1:]
    if not argv:
        print("请写用户名：python add_user.py 用户名")
        return 1
    username = argv[0]
    password = argv[1] if len(argv) > 1 else None
    if not password:
        password = getpass.getpass("密码：")
        again = getpass.getpass("再输入一次：")
        if password != again:
            print("两次密码不一致")
            return 1
    try:
        info = add_user(username, password)
    except ValueError as e:
        print("失败：" + str(e))
        return 1
    print("已创建账号：" + info["username"])
    if info["migrated"]:
        print("已把现有「" + "、".join(info["migrated"]) + "」拷进这个账号（原文件仍留在 data/ 作备份）。")
    elif info["first"]:
        print("这是第一个账号，题库和聊天从空白开始。")
    else:
        print("这是新账号，题库和聊天从空白开始。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
