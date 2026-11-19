# -*- coding: utf-8 -*-
"""官方题库库：全站共享内容，用户按需领取为「文件夹」。

官方条目统一为文件夹形态：
- kind=folder：作者整理的文件夹，内含若干独立题库（banks）和/或试卷（papers）。
- kind=paper ：一套英语试卷 = 一个单试卷文件夹（papers 只有一项）。

领取 = 在领取者侧栏创建同名文件夹，把每套题库深拷贝挂进去（进度归零、
id 重排），每套试卷整体落为对方 readings.json 里的试卷记录并挂同一文件夹。
文件夹记录 official_id + official_version，供市场页「已领取 / 官方已更新」判定；
官方条目记 source(user, kind, src_id)，供发布台「已上架 → 更新版本」追踪。
"""
from __future__ import annotations

import copy
import json
import os
import random
import tempfile
import time
from datetime import datetime

from lykie import accounts as lykie_accounts
from lykie import bank_images as lykie_bank_images
from lykie import readings as lykie_readings
from lykie import share as lykie_share

OFFICIAL_FILE = os.path.join(lykie_accounts.DATA_DIR, "official_banks.json")


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _new_id() -> str:
    return str(int(time.time() * 1000)) + str(random.randint(10, 99))


def _empty() -> dict:
    return {"official": []}


def _migrate_entry(o: dict) -> bool:
    """旧结构 → 文件夹形态：questions/mode 聚合成单套题库；paper_content 转为单试卷。"""
    if "banks" in o or "papers" in o:
        return False
    o["banks"] = []
    o["papers"] = []
    if o.get("kind") == "paper":
        content = o.pop("paper_content", "") or ""
        if content.strip():
            o["papers"] = [{"name": o.get("name") or "未命名试卷", "content": content}]
    else:
        qs = o.pop("questions", None) or []
        if qs:
            mode = o.pop("mode", None) or "objective"
            o["banks"] = [{
                "name": o.get("name") or "未命名题库",
                "mode": mode,
                "questions": qs,
            }]
    return True


def load_official() -> dict:
    if not os.path.exists(OFFICIAL_FILE):
        return _empty()
    try:
        with open(OFFICIAL_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    if not isinstance(data.get("official"), list):
        data["official"] = []
    dirty = False
    for o in data.get("official") or []:
        if isinstance(o, dict) and _migrate_entry(o):
            dirty = True
    if dirty:
        save_official(data)
    return data


def save_official(data: dict) -> None:
    os.makedirs(os.path.dirname(OFFICIAL_FILE), exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        prefix="official.",
        suffix=".tmp",
        dir=os.path.dirname(OFFICIAL_FILE),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, OFFICIAL_FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _load_user_bank_raw(username: str) -> dict:
    """读用户 bank.json 原文（banks/folders/current_bank_id）。"""
    path = lykie_accounts.bank_path(username)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        data = {"banks": [], "current_bank_id": None}
    if not isinstance(data, dict):
        data = {"banks": [], "current_bank_id": None}
    if not isinstance(data.get("banks"), list):
        data["banks"] = []
    if not isinstance(data.get("folders"), list):
        data["folders"] = []
    return data


def _save_user_bank_raw(username: str, data: dict) -> None:
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


def _load_user_banks(username: str) -> list:
    return _load_user_bank_raw(username)["banks"]


def _user_papers(username: str) -> list:
    """读用户 readings.json 里的试卷记录（原文条目）。"""
    data = lykie_readings.load_readings(username)
    out = []
    for t in data.get("texts") or []:
        if isinstance(t, dict) and t.get("is_paper"):
            out.append(t)
    return out


# ==================== 市场列表 / 领取状态 ====================

def claimed_versions(username: str) -> dict:
    """官方条目 id -> 已领取文件夹记录的官方版本号（取最大）。"""
    data = _load_user_bank_raw(username)
    out: dict = {}
    for f in data.get("folders") or []:
        oid = f.get("official_id")
        if not oid:
            continue
        try:
            v = int(f.get("official_version") or 1)
        except (TypeError, ValueError):
            v = 1
        if out.get(str(oid), 0) < v:
            out[str(oid)] = v
    return out


def _public_entry(o: dict, my_v: int) -> dict:
    oid = str(o.get("id") or "")
    try:
        version = int(o.get("version") or 1)
    except (TypeError, ValueError):
        version = 1
    kind = o.get("kind") or "folder"
    return {
        "id": oid,
        "kind": kind,
        "name": o.get("name") or "未命名文件夹",
        "description": o.get("description") or "",
        "tags": o.get("tags") if isinstance(o.get("tags"), list) else [],
        "version": version,
        "total_banks": len(o.get("banks") or []),
        "total_papers": len(o.get("papers") or []),
        "claimed": my_v > 0,
        "my_version": my_v,
        "update_available": 0 < my_v < version,
        "published_at": o.get("published_at") or "",
    }


def list_official(username: str) -> list:
    data = load_official()
    claimed = claimed_versions(username)
    out = []
    for o in data.get("official") or []:
        if not isinstance(o, dict):
            continue
        out.append(_public_entry(o, claimed.get(str(o.get("id") or ""), 0)))
    return out


def get_official(oid: str) -> dict | None:
    data = load_official()
    return next(
        (o for o in data.get("official") or [] if str(o.get("id")) == str(oid)),
        None,
    )


# ==================== 领取 ====================

def _unique_folder_name(data: dict, name: str) -> str:
    """同名文件夹自动加序号后缀（领取者可能已有同名文件夹）。"""
    base = str(name or "").strip() or "官方题库包"
    taken = {str(f.get("name") or "") for f in data.get("folders") or []}
    if base not in taken:
        return base
    i = 2
    while f"{base} {i}" in taken:
        i += 1
    return f"{base} {i}"


def claim_official(username: str, oid: str) -> tuple[dict | None, str]:
    o = get_official(oid)
    if not o:
        return None, "这套官方内容不存在"
    kind = o.get("kind") or "folder"
    try:
        version = int(o.get("version") or 1)
    except (TypeError, ValueError):
        version = 1
    my_v = claimed_versions(username).get(str(oid), 0)
    if my_v >= version:
        return None, "你已经领取过这套内容"
    banks_src = [b for b in (o.get("banks") or []) if isinstance(b, dict)]
    papers_src = [p for p in (o.get("papers") or []) if isinstance(p, dict)]
    if not banks_src and not papers_src:
        return None, "官方内容为空"

    data = _load_user_bank_raw(username)
    folder = {
        "id": _new_id(),
        "name": _unique_folder_name(data, o.get("name") or "官方题库包"),
        "created_at": now_str(),
        "official_id": str(oid),
        "official_version": version,
    }
    data["folders"].append(folder)
    folder_id = folder["id"]
    for bsrc in banks_src:
        qs = bsrc.get("questions") or []
        if not qs:
            continue
        clone = lykie_share.clone_bank_for_share(
            {"name": bsrc.get("name"), "questions": qs, "mode": bsrc.get("mode")},
            "官方题库",
        )
        clone["folder_id"] = folder_id
        # 题目图片随行：从官方条目目录按文件名拷到领取者题库目录
        files = [
            e.get("file")
            for q in qs
            for e in (q.get("images") or [])
            if isinstance(e, dict) and e.get("file")
        ]
        if files:
            lykie_bank_images.copy_image_files(
                lykie_bank_images.bank_dir("_official", str(oid)),
                lykie_bank_images.bank_dir(username, clone["id"]),
                files,
            )
        data["banks"].append(clone)
        if not data.get("current_bank_id"):
            data["current_bank_id"] = clone["id"]
    _save_user_bank_raw(username, data)

    for psrc in papers_src:
        content = psrc.get("content") or ""
        if not content.strip():
            continue
        lykie_readings.import_official_paper(
            username,
            psrc.get("name") or "未命名试卷",
            content,
            str(oid),
            version,
            folder_id,
        )
    return {"folder_id": folder_id, "name": folder["name"], "kind": kind}, ""


# ==================== 发布（文件夹 / 试卷） ====================

def _strip_progress(questions: list) -> list:
    out = []
    for q in questions or []:
        if not isinstance(q, dict):
            continue
        c = copy.deepcopy(q)
        for key in list(lykie_share.PROGRESS_KEYS) + ["id"]:
            c.pop(key, None)
        out.append(c)
    return out


def _guess_mode(questions: list) -> str:
    if any(str(q.get("type") or "") == "short_answer" for q in questions):
        return "short_answer"
    return "objective"


def _meta(name: str, description: str, tags: list) -> dict:
    return {
        "name": str(name or "").strip() or "未命名文件夹",
        "description": str(description or "").strip(),
        "tags": [str(t).strip() for t in (tags or []) if str(t).strip()],
    }


def _upsert_entry(username: str, kind: str, src_id: str, **fields) -> dict:
    """按 source 匹配更新版本，否则新建。fields: name/description/tags/banks/papers"""
    data = load_official()
    me = lykie_accounts.normalize_username(username)
    existing = next(
        (
            o for o in data.get("official") or []
            if str((o.get("source") or {}).get("kind")) == kind
            and str((o.get("source") or {}).get("src_id")) == str(src_id)
            and (o.get("source") or {}).get("user") == me
        ),
        None,
    )
    if existing:
        for k, v in fields.items():
            existing[k] = v
        existing["published_at"] = now_str()
        try:
            existing["version"] = int(existing.get("version") or 1) + 1
        except (TypeError, ValueError):
            existing["version"] = 2
        out = existing
    else:
        out = {
            "id": f"off_{kind}_{src_id}",
            "kind": kind,
            "published_at": now_str(),
            "version": 1,
            "source": {"user": me, "kind": kind, "src_id": str(src_id)},
        }
        out.update(fields)
        data["official"].append(out)
    save_official(data)
    return out


def publish_folder(username: str, folder_id: str, name: str, description: str, tags: list) -> tuple[dict | None, str]:
    """发布文件夹：内部题库 / 试卷保持独立，原样打包。"""
    banks_out = []
    src_bank_ids = []  # 与 banks_out 平行：来源题库 id（图片随行用）
    members = [
        b for b in _load_user_banks(username)
        if str(b.get("folder_id") or "") == str(folder_id) and not b.get("archived")
    ]
    members.sort(key=lambda b: b.get("sort_order") or 0)
    for b in members:
        qs = _strip_progress(b.get("questions") or [])
        if not qs:
            continue
        banks_out.append({
            "name": b.get("name") or "未命名题库",
            "mode": b.get("mode") or _guess_mode(qs),
            "questions": qs,
        })
        src_bank_ids.append(str(b.get("id") or ""))
    papers_out = []
    for p in _user_papers(username):
        if str(p.get("folder_id") or "") == str(folder_id) and not p.get("archived"):
            content = p.get("content") or ""
            if content.strip():
                papers_out.append({
                    "name": p.get("title") or "未命名试卷",
                    "content": content,
                })
    if not banks_out and not papers_out:
        return None, "这个文件夹是空的，没有可发布的内容"
    # 题目图片随行：拷到官方条目目录，文件名加 bN_ 前缀避免跨题库撞名。
    # 必须在 _upsert_entry 落盘之前改名，否则落盘条目里是无前缀旧名，领取时按名找不到文件。
    entry_id = f"off_folder_{folder_id}"
    lykie_bank_images.remove_bank_images("_official", entry_id)
    for bi, (b_out, src_bid) in enumerate(zip(banks_out, src_bank_ids)):
        if not src_bid:
            continue
        prefix = f"b{bi}_"
        lykie_bank_images.copy_bank_images(
            username, src_bid, "_official", entry_id, prefix=prefix
        )
        for q in (b_out.get("questions") or []):
            for e in (q.get("images") or []):
                fname = e.get("file")
                if fname:
                    e["file"] = prefix + fname
    entry = _upsert_entry(
        username, "folder", str(folder_id),
        banks=banks_out,
        papers=papers_out,
        **_meta(name, description, tags),
    )
    return entry, ""


def publish_paper(username: str, text_id: str, name: str, description: str, tags: list) -> tuple[dict | None, str]:
    """发布试卷：一套试卷 = 一个单试卷文件夹。"""
    paper = lykie_readings.get_text(username, text_id)
    if not paper or not paper.get("is_paper"):
        return None, "试卷不存在"
    content = paper.get("content") or ""
    if not content.strip():
        return None, "试卷内容为空，无法发布"
    entry = _upsert_entry(
        username, "paper", str(text_id),
        banks=[],
        papers=[{"name": paper.get("title") or "未命名试卷", "content": content}],
        **_meta(name or paper.get("title"), description, tags),
    )
    return entry, ""


# ==================== 发布台数据 ====================

def _published_map(username: str) -> dict:
    """(kind, src_id) -> 已上架条目摘要（version/name/description/tags）。"""
    me = lykie_accounts.normalize_username(username)
    out: dict = {}
    for o in load_official().get("official") or []:
        src = o.get("source") or {}
        if src.get("user") != me:
            continue
        try:
            v = int(o.get("version") or 1)
        except (TypeError, ValueError):
            v = 1
        out[(str(src.get("kind")), str(src.get("src_id")))] = {
            "version": v,
            "name": o.get("name") or "",
            "description": o.get("description") or "",
            "tags": o.get("tags") if isinstance(o.get("tags"), list) else [],
        }
    return out


def publishables(username: str) -> dict:
    """发布台可选对象：我的文件夹 / 我的试卷（带已上架版本与 meta）。"""
    published = _published_map(username)

    def _pub(kind: str, src_id) -> dict:
        meta = published.get((kind, str(src_id)))
        if not meta:
            return {"published_version": 0, "published_name": "",
                    "published_description": "", "published_tags": []}
        return {
            "published_version": meta["version"],
            "published_name": meta["name"],
            "published_description": meta["description"],
            "published_tags": meta["tags"],
        }

    folders = []
    for f in _load_user_folder_meta(username):
        folders.append({
            "id": f.get("id"),
            "name": f.get("name") or "未命名文件夹",
            "bank_count": f.get("bank_count", 0),
            "paper_count": f.get("paper_count", 0),
            **_pub("folder", f.get("id")),
        })
    papers = []
    for p in _user_papers(username):
        sections = lykie_readings._paper_sections(p)
        papers.append({
            "id": p.get("id"),
            "title": p.get("title") or "未命名试卷",
            "section_count": len(sections),
            **_pub("paper", p.get("id")),
        })
    return {"folders": folders, "papers": papers}


def _load_user_folder_meta(username: str) -> list:
    """用户文件夹元数据（id/name/活跃题库数/活跃试卷数）。"""
    data = _load_user_bank_raw(username)
    raw = {
        str(f.get("id")): f
        for f in data.get("folders") or []
        if isinstance(f, dict) and f.get("id") is not None
    }
    banks = data.get("banks") or []
    papers = _user_papers(username)
    out = []
    for fid, f in raw.items():
        bank_count = sum(
            1 for b in banks
            if str(b.get("folder_id") or "") == fid and not b.get("archived")
        )
        paper_count = sum(
            1 for p in papers
            if str(p.get("folder_id") or "") == fid and not p.get("archived")
        )
        out.append({
            "id": fid,
            "name": f.get("name") or "未命名文件夹",
            "bank_count": bank_count,
            "paper_count": paper_count,
        })
    return out


def unpublish(oid: str) -> tuple[bool, str]:
    data = load_official()
    before = len(data.get("official") or [])
    data["official"] = [
        o for o in data.get("official") or [] if str(o.get("id")) != str(oid)
    ]
    if len(data["official"]) == before:
        return False, "没有这套官方内容"
    save_official(data)
    lykie_bank_images.remove_bank_images("_official", str(oid))
    return True, ""
