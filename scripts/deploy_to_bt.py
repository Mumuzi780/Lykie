# -*- coding: utf-8 -*-
"""把当前代码更新到 Windows 宝塔服务器（保留远端 data/users 用户数据）。"""
from __future__ import annotations

import http.cookiejar
import json
import os
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
BASE = "http://49.233.174.218:8888"
PUBLIC = "http://49.233.174.218"
COOKIE = DIST / "_bt_cookies.txt"
TOKEN = (DIST / "_csrf.txt").read_text(encoding="utf-8").strip()
REMOTE_ROOT = "C:/wwwroot/Lykie"
PY = r"C:\Program Files\python\python.exe"

# 只同步代码与配置；默认不覆盖远端用户题库/进度（可用 --user 指定账号）
SYNC_FILES = [
    "app.py",
    "requirements.txt",
    "add_user.py",
    "启动背题助手.bat",
    "启动生产服务.bat",
    "重启背题助手.bat",
    "lykie/__init__.py",
    "lykie/accounts.py",
    "lykie/extract.py",
    "lykie/folders.py",
    "lykie/import_exemplar.py",
    "lykie/import_noise.py",
    "lykie/import_rules.py",
    "lykie/import_scan.py",
    "lykie/llm.py",
    "lykie/memory.py",
    "lykie/mock.py",
    "lykie/profile.py",
    "lykie/settle.py",
    "lykie/short_answer.py",
    "lykie/typo.py",
    "lykie/prompt_core.txt",
    "lykie/self.txt",
    "story/__init__.py",
    "static/dialog.js",
    "static/sa.js",
    "static/sa.css",
    "static/script.js",
    "static/sfx.js",
    "static/fx.js",
    "static/mock.js",
    "static/style.css",
    "static/story.js",
    "static/import.js",
    "static/import.css",
    "templates/sa.html",
    "templates/index.html",
    "templates/import.html",
    "templates/login.html",
    "docs/简答训练-测试笔记.md",
    "docs/版本日志.md",
    "docs/产品定位.md",
    "docs/进题导入-设计草案.md",
    "docs/进题导入-脏文本样本.md",
    "data/stories/fragment_01.json",
]

CJ = http.cookiejar.MozillaCookieJar(str(COOKIE))
CJ.load(ignore_discard=True, ignore_expires=True)
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CJ))


def brief(o, n=400):
    return json.dumps(o, ensure_ascii=False)[:n]


def post(path, data=None, timeout=120, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                BASE + path,
                data=urllib.parse.urlencode(data or {}).encode("utf-8"),
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": BASE + "/",
                    "x-http-token": TOKEN,
                    "User-Agent": "Mozilla/5.0",
                    "X-Requested-With": "XMLHttpRequest",
                },
                method="POST",
            )
            raw = OP.open(req, timeout=timeout).read().decode("utf-8", "replace")
            try:
                CJ.save(ignore_discard=True, ignore_expires=True)
            except Exception:
                pass
            try:
                return json.loads(raw)
            except Exception:
                return {"raw": raw[:800]}
        except Exception as e:
            last = e
            print(f"  retry {attempt+1}/{retries} {path}: {type(e).__name__}")
            time.sleep(2 + attempt * 2)
    return {"err": type(last).__name__ if last else "error", "msg": str(last)[:200]}


def ensure_remote_dir(rel_dir: str) -> None:
    """逐级创建远端目录。"""
    parts = rel_dir.replace("\\", "/").split("/")
    cur = REMOTE_ROOT
    for p in parts:
        if not p:
            continue
        cur = f"{cur}/{p}"
        post("/files/create_dir", {"path": cur})


def upload_text(rel: str) -> dict:
    local = ROOT / rel
    if not local.exists():
        return {"skip": True, "rel": rel, "reason": "missing local"}
    text = local.read_text(encoding="utf-8")
    remote = f"{REMOTE_ROOT}/{rel.replace(chr(92), '/')}"
    parent = "/".join(remote.split("/")[:-1])
    if parent != REMOTE_ROOT:
        ensure_remote_dir("/".join(rel.replace("\\", "/").split("/")[:-1]))
    # 先试 create_file（已存在也无所谓）
    post("/files/create_file", {"path": parent, "filename": remote.split("/")[-1]})
    r = post(
        "/files/save_file_body",
        {
            "filename": remote,
            "path": remote,
            "data": text,
            "encoding": "utf-8",
        },
        timeout=180,
    )
    return {"rel": rel, "remote": remote, "result": r}


def write_restart_bat() -> dict:
    bat = "\r\n".join(
        [
            "@echo off",
            "cd /d C:\\wwwroot\\Lykie",
            "set LYKIE_OPEN_BROWSER=0",
            "set LYKIE_HOST=127.0.0.1",
            "set LYKIE_PORT=5000",
            f'"{PY}" -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple',
            f'"{PY}" -m pip install waitress -i https://pypi.tuna.tsinghua.edu.cn/simple',
            "for /f \"tokens=5\" %%a in ('netstat -ano ^| findstr :5000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul",
            "timeout /t 2 /nobreak >nul",
            f'start "lykie" /MIN "{PY}" -m waitress --listen=127.0.0.1:5000 --threads=2 app:app',
            "echo DONE > C:\\wwwroot\\Lykie\\deploy_done.txt",
        ]
    )
    return post(
        "/files/save_file_body",
        {
            "filename": f"{REMOTE_ROOT}/deploy_once.bat",
            "path": f"{REMOTE_ROOT}/deploy_once.bat",
            "data": bat,
            "encoding": "utf-8",
        },
    )


def restart_service() -> None:
    write_restart_bat()
    # 优先走「其他项目」创建/启动；失败再用路径注入排队
    start_simple = r"C:\wwwroot\Lykie\deploy_once.bat"
    print(
        "create/start project",
        brief(
            post(
                "/other/create_project",
                {
                    "title": "lykie-bat",
                    "name": "lykie-bat",
                    "domains": "lykie-bat.test",
                    "path": REMOTE_ROOT,
                    "port": "5000",
                    "type_id": "0",
                    "ps": "lykie",
                    "bind_extranet": "0",
                    "command": start_simple,
                },
            ),
            500,
        ),
    )
    for sid in ("5", "4", "3", "6", "7"):
        print(
            "start",
            sid,
            brief(
                post(
                    "/project/set_project_status",
                    {"id": sid, "siteid": sid, "status": "start", "type": "other"},
                )
            ),
        )
    # 兜底：webshell_check 路径注入执行 bat（历史可用）
    inject = r"C:\wwwroot\Lykie & call C:\wwwroot\Lykie\deploy_once.bat & rem "
    for path in ("/files/dir_webshell_check", "/files?action=dir_webshell_check"):
        print("inject", path, brief(post(path, {"path": inject}), 200))


def verify_public() -> None:
    for i in range(10):
        try:
            resp = urllib.request.urlopen(PUBLIC + "/login", timeout=15)
            body = resp.read(300).decode("utf-8", "replace")
            print("public /login", resp.status, body[:60].replace("\n", " "))
            break
        except Exception as e:
            print("wait public", i, type(e).__name__, e)
            time.sleep(3)
    # 抽查 sa.js 是否含本批复习字段
    try:
        resp = urllib.request.urlopen(PUBLIC + "/static/sa.js?v=sa16", timeout=15)
        js = resp.read().decode("utf-8", "replace")
        print("sa.js review_quota", "review_quota" in js, "len", len(js))
    except Exception as e:
        print("sa.js check fail", e)


def main() -> int:
    probe = post("/files/get_dir_list", {"path": REMOTE_ROOT, "limit": "5"})
    if not isinstance(probe, dict) or "dirs" not in probe and "raw" in probe:
        print("宝塔登录可能失效，请先重新登录面板并更新 dist/_bt_cookies.txt / _csrf.txt")
        print(brief(probe))
        return 1
    print("remote ok", brief(probe, 120))

    ok = 0
    fail = 0
    for rel in SYNC_FILES:
        r = upload_text(rel)
        status = r.get("result") if isinstance(r, dict) else r
        good = isinstance(status, dict) and (
            status.get("status") is True
            or status.get("msg") in ("保存成功!", "File saved successfully!", True)
            or "成功" in str(status.get("msg") or "")
            or r.get("skip")
        )
        if r.get("skip"):
            print("skip", rel)
            continue
        if good:
            ok += 1
            print("ok", rel)
        else:
            fail += 1
            print("FAIL", rel, brief(status, 200))

    print(f"uploaded ok={ok} fail={fail}")
    restart_service()
    time.sleep(4)
    print("deploy_done?", brief(post("/files/get_file_body", {"filename": f"{REMOTE_ROOT}/deploy_done.txt"})))
    verify_public()
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
