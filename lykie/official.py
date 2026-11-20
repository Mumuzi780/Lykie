# -*- coding: utf-8 -*-
"""官方题库库：全站共享内容，用户按需领取为「文件夹」。

官方条目统一为文件夹形态（kind=folder）：作者整理的文件夹，内含若干独立题库
（banks）和/或试卷（papers）。一套英语试卷 = 一个含单张试卷的文件夹，试卷命名
唯一来源 = 文件夹名。历史 kind=paper 条目由 _migrate_paper_to_folder 惰性转换。

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
    """第一层迁移：旧结构 → 文件夹形态。questions/mode 聚合成单套题库；
    paper_content 转为单试卷。"""
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


def _find_paper_folder_id(username: str, text_id: str) -> str | None:
    """在作者 readings 中找源卷的有效文件夹（folder_id 指向现存文件夹）。"""
    if not username or not text_id:
        return None
    data = lykie_readings.load_readings(username)
    t = next(
        (x for x in data.get("texts") or []
         if isinstance(x, dict) and x.get("is_paper")
         and str(x.get("id") or "") == str(text_id)),
        None,
    )
    if not t:
        return None
    fid = t.get("folder_id")
    if fid in (None, ""):
        return None
    bank = _load_user_bank_raw(username)
    valid = {str(f.get("id")) for f in bank.get("folders") or [] if f.get("id") is not None}
    return str(fid) if str(fid) in valid else None


def _migrate_paper_to_folder(o: dict) -> bool:
    """第二层迁移：废弃 kind=paper，转文件夹形态（幂等：转后 kind=folder 不再命中）。
    源卷文件夹仍有效则绑定 folder_id（保住发布台更新链），否则以 text_id 为稳定键
    （条目继续在市场供领取）。旧 id 记入 legacy_id 供用户侧 claimed 映射。"""
    if not isinstance(o, dict) or o.get("kind") != "paper":
        return False
    src = o.get("source") or {}
    if not isinstance(src, dict) or src.get("kind") != "paper":
        return False
    text_id = str(src.get("src_id") or "")
    if not text_id:
        return False
    author = src.get("user") or ""
    old_id = str(o.get("id") or "")
    fid = _find_paper_folder_id(author, text_id)
    new_key = fid or text_id
    o["legacy_id"] = old_id
    o["id"] = f"off_folder_{new_key}"
    o["kind"] = "folder"
    o["source"] = {"user": author, "kind": "folder", "src_id": new_key}
    return True


def legacy_official_id_map() -> dict:
    """旧官方条目 id → 迁移后 id（供用户侧 claimed 记录映射）。"""
    out: dict = {}
    for o in load_official().get("official") or []:
        if isinstance(o, dict) and o.get("legacy_id"):
            out[str(o["legacy_id"])] = str(o.get("id") or "")
    return out


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
    for o in data.get("official") or []:
        if _migrate_paper_to_folder(o):
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


# ==================== 用户存量迁移：试卷归文件夹 ====================

def _unique_paper_folder_name(folders: list, name: str) -> str:
    """重名唯一化（区别于 ensure_folder 的同名复用：迁移必须新建专属夹）。"""
    base = str(name or "").strip() or "未命名试卷"
    taken = {str(f.get("name") or "") for f in folders if isinstance(f, dict)}
    if base not in taken:
        return base
    i = 2
    while f"{base} {i}" in taken:
        i += 1
    return f"{base} {i}"


def _new_migrate_folder(folders: list, name: str, official_id=None,
                        official_version=None) -> str:
    """迁移建夹并返回 id；official_id/official_version 用于修复 claimed 记录。"""
    fid = _new_id()
    folder = {
        "id": fid,
        "name": _unique_paper_folder_name(folders, name),
        "created_at": now_str(),
    }
    if official_id:
        folder["official_id"] = str(official_id)
        try:
            folder["official_version"] = int(official_version or 1)
        except (TypeError, ValueError):
            folder["official_version"] = 1
    folders.append(folder)
    return fid


def migrate_user_papers(username: str, bank_data: dict, readings_data: dict,
                        official_map: dict) -> bool:
    """用户存量迁移（幂等）：试卷命名/归属统一到文件夹。
    - 挂夹正常 → title 同步为文件夹名（命名唯一来源）
    - 无夹/失效夹 → 建专属夹（重名唯一化）；官方卷同步修复 claimed 记录
    - 多卷同夹（防御）→ 拆分，除第一张外各建专属夹
    - folders 的 official_id 按官方条目迁移映射更新
    返回是否有改动（落盘由调用方负责）。"""
    changed = False
    folders = bank_data.get("folders")
    if not isinstance(folders, list):
        folders = []
        bank_data["folders"] = folders
    fmap = {str(f.get("id")): f for f in folders
            if isinstance(f, dict) and f.get("id") is not None}

    # 官方 id 映射：folder.official_id 跟随官方条目迁移
    for f in folders:
        if not isinstance(f, dict):
            continue
        oid = f.get("official_id")
        if oid and str(oid) in official_map:
            f["official_id"] = official_map[str(oid)]
            changed = True

    texts = readings_data.get("texts")
    if not isinstance(texts, list):
        texts = []
        readings_data["texts"] = texts

    for t in texts:
        if not isinstance(t, dict) or not t.get("is_paper"):
            continue
        fid = t.get("folder_id")
        f = fmap.get(str(fid)) if fid not in (None, "") else None
        if f is not None:
            fname = str(f.get("name") or "")
            if fname and t.get("title") != fname:
                t["title"] = fname
                changed = True
            continue
        # 无夹或失效夹：建专属夹
        oid = t.get("official_id")
        if oid and str(oid) in official_map:
            oid = official_map[str(oid)]
            t["official_id"] = oid
            changed = True
        new_fid = _new_migrate_folder(
            folders,
            str(t.get("title") or "").strip() or "未命名试卷",
            official_id=oid,
            official_version=t.get("official_version"),
        )
        t["folder_id"] = new_fid
        fmap[new_fid] = next(f2 for f2 in folders if str(f2.get("id")) == new_fid)
        changed = True

    # 多卷同夹拆分（防御）：组内 >1 张 → 除第一张外各建专属夹
    from collections import defaultdict
    groups = defaultdict(list)
    for t in texts:
        if isinstance(t, dict) and t.get("is_paper"):
            fid = t.get("folder_id")
            if fid not in (None, ""):
                groups[str(fid)].append(t)
    for members in groups.values():
        if len(members) <= 1:
            continue
        for t in members[1:]:
            oid = t.get("official_id")
            if oid and str(oid) in official_map:
                oid = official_map[str(oid)]
                t["official_id"] = oid
                changed = True
            new_fid = _new_migrate_folder(
                folders,
                str(t.get("title") or "").strip() or "未命名试卷",
                official_id=oid,
                official_version=t.get("official_version"),
            )
            t["folder_id"] = new_fid
            changed = True
    return changed


def migrate_user(username: str) -> bool:
    """文件层用户迁移封装（供无 store 上下文入口调用，如发布台）。"""
    bank_data = _load_user_bank_raw(username)
    readings_data = lykie_readings.load_readings(username)
    changed = migrate_user_papers(
        username, bank_data, readings_data, legacy_official_id_map()
    )
    if changed:
        _save_user_bank_raw(username, bank_data)
        lykie_readings.save_readings(username, readings_data)
    return changed


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


# ==================== 发布（文件夹） ====================

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


def _folder_name(username: str, folder_id) -> str:
    """查文件夹实际名称（发布打包试卷命名用：命名唯一来源 = 文件夹名）。"""
    data = _load_user_bank_raw(username)
    for f in data.get("folders") or []:
        if isinstance(f, dict) and str(f.get("id") or "") == str(folder_id):
            return str(f.get("name") or "")
    return ""


def publish_folder(username: str, folder_id: str, name: str, description: str, tags: list) -> tuple[dict | None, str]:
    """发布文件夹：内部题库 / 试卷保持独立，原样打包。试卷命名取文件夹名。"""
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
    src_text_ids = []  # 本次打包卷 text_id（发布后清理历史"试卷"条目用）
    folder_name = _folder_name(username, folder_id)
    for p in _user_papers(username):
        if str(p.get("folder_id") or "") == str(folder_id) and not p.get("archived"):
            content = p.get("content") or ""
            if content.strip():
                papers_out.append({
                    "name": folder_name or p.get("title") or "未命名试卷",
                    "content": content,
                    "_src_text_id": str(p.get("id") or ""),
                })
                src_text_ids.append(str(p.get("id") or ""))
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
    _cleanup_legacy_paper_entries(username, folder_id, src_text_ids)
    return entry, ""


def _cleanup_legacy_paper_entries(username: str, folder_id: str, src_text_ids: list) -> int:
    """发布文件夹后清理历史"试卷"条目：作者名下 kind=folder 且 src_id 为本次打包卷
    text_id（非当前 folder_id）的条目——即 kind=paper 迁移产物，避免市场重复上架。"""
    if not src_text_ids:
        return 0
    me = lykie_accounts.normalize_username(username)
    data = load_official()
    ids = set(src_text_ids)
    cur = str(folder_id)
    doomed_ids = {
        str(o.get("id") or "")
        for o in data.get("official") or []
        if isinstance(o, dict)
        and o.get("kind") == "folder"
        and (o.get("source") or {}).get("user") == me
        and str((o.get("source") or {}).get("src_id") or "") in ids
        and str((o.get("source") or {}).get("src_id") or "") != cur
    }
    if not doomed_ids:
        return 0
    data["official"] = [
        o for o in data.get("official") or []
        if not (isinstance(o, dict) and str(o.get("id") or "") in doomed_ids)
    ]
    save_official(data)
    return len(doomed_ids)


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
    """发布台可选对象：我的文件夹（试卷随文件夹发布，无独立"试卷"入口）。"""
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
    return {"folders": folders}


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


def my_published(username: str) -> list:
    """管理台：作者名下已上架条目（含来源文件夹是否还在，供前端提示）。"""
    me = lykie_accounts.normalize_username(username)
    data = load_official()
    folder_ids = {
        str(f.get("id"))
        for f in _load_user_bank_raw(username).get("folders") or []
        if isinstance(f, dict) and f.get("id") is not None
    }
    out = []
    for o in data.get("official") or []:
        if not isinstance(o, dict):
            continue
        src = o.get("source") or {}
        if not isinstance(src, dict) or src.get("user") != me:
            continue
        try:
            version = int(o.get("version") or 1)
        except (TypeError, ValueError):
            version = 1
        src_id = str(src.get("src_id") or "")
        out.append({
            "id": str(o.get("id") or ""),
            "name": o.get("name") or "未命名文件夹",
            "description": o.get("description") or "",
            "tags": o.get("tags") if isinstance(o.get("tags"), list) else [],
            "version": version,
            "total_banks": len(o.get("banks") or []),
            "total_papers": len(o.get("papers") or []),
            "published_at": o.get("published_at") or "",
            "source_folder": src_id if src_id in folder_ids else "",
        })
    out.sort(key=lambda x: x.get("published_at") or "", reverse=True)
    return out


def edit_official(username: str, oid: str, name: str, description: str,
                  tags: list) -> tuple[dict | None, str]:
    """修改已上架条目的市场元数据（名称/简介/标签）。仅发布者可操作；
    不升版本、不动内容（版本只随内容发布升级，避免惊扰已领取用户）。"""
    me = lykie_accounts.normalize_username(username)
    data = load_official()
    o = next(
        (x for x in data.get("official") or []
         if isinstance(x, dict) and str(x.get("id") or "") == str(oid)),
        None,
    )
    if not o:
        return None, "这套官方内容不存在"
    if (o.get("source") or {}).get("user") != me:
        return None, "只有发布者可以修改"
    o.update(_meta(name, description, tags))
    save_official(data)
    return o, ""


def unpublish(username: str, oid: str) -> tuple[bool, str]:
    """下架（从市场删除）：仅发布者可操作，同时清理官方图片目录。"""
    me = lykie_accounts.normalize_username(username)
    data = load_official()
    o = next(
        (x for x in data.get("official") or []
         if isinstance(x, dict) and str(x.get("id") or "") == str(oid)),
        None,
    )
    if not o:
        return False, "没有这套官方内容"
    if (o.get("source") or {}).get("user") != me:
        return False, "只有发布者可以下架"
    data["official"] = [
        x for x in data.get("official") or [] if str(x.get("id")) != str(oid)
    ]
    save_official(data)
    lykie_bank_images.remove_bank_images("_official", str(oid))
    return True, ""
