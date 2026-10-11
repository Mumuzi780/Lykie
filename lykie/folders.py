# -*- coding: utf-8 -*-
"""题库侧栏文件夹（一层收纳，不嵌套）。"""
from __future__ import annotations

import random
import time
from datetime import datetime


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def new_id() -> str:
    return str(int(time.time() * 1000)) + str(random.randint(10, 99))


def ensure_folders(store) -> None:
    if not hasattr(store, "folders") or store.folders is None:
        store.folders = []
    # 清理指向已删文件夹的 folder_id
    valid = {str(f.get("id")) for f in store.folders if f.get("id") is not None}
    for b in store.banks or []:
        fid = b.get("folder_id")
        if fid is None or fid == "":
            b["folder_id"] = None
        elif str(fid) not in valid:
            b["folder_id"] = None


def list_folders(store) -> list:
    ensure_folders(store)
    out = []
    for f in store.folders or []:
        fid = str(f.get("id"))
        count = 0
        last_used = ""
        for b in store.banks or []:
            if str(b.get("folder_id") or "") != fid:
                continue
            count += 1
            t = b.get("last_studied_at") or ""
            if t > last_used:
                last_used = t
        out.append(
            {
                "id": fid,
                "name": f.get("name") or "未命名文件夹",
                "created_at": f.get("created_at") or "",
                "count": count,
                "last_used": last_used,
                "sort_order": f.get("sort_order", 0),
                "collapsed": f.get("collapsed", False),
            }
        )
    return out


def find_folder(store, fid: str) -> dict | None:
    ensure_folders(store)
    return next((f for f in store.folders if str(f.get("id")) == str(fid)), None)


def create_folder(store, name: str) -> tuple[dict | None, str]:
    ensure_folders(store)
    name = str(name or "").strip()
    if not name:
        return None, "名称不能为空"
    for f in store.folders:
        if str(f.get("name") or "").strip() == name:
            return None, "已有同名文件夹"
    folder = {
        "id": new_id(),
        "name": name,
        "created_at": now_str(),
    }
    store.folders.append(folder)
    return folder, ""


def rename_folder(store, fid: str, name: str) -> tuple[bool, str]:
    ensure_folders(store)
    f = find_folder(store, fid)
    if not f:
        return False, "文件夹不存在"
    name = str(name or "").strip()
    if not name:
        return False, "名称不能为空"
    for other in store.folders:
        if str(other.get("id")) != str(fid) and str(other.get("name") or "").strip() == name:
            return False, "已有同名文件夹"
    f["name"] = name
    return True, ""


def delete_folder(store, fid: str) -> tuple[bool, str]:
    """只删文件夹；题库移回根列表。"""
    ensure_folders(store)
    f = find_folder(store, fid)
    if not f:
        return False, "文件夹不存在"
    for b in store.banks or []:
        if str(b.get("folder_id") or "") == str(fid):
            b["folder_id"] = None
    store.folders = [x for x in store.folders if str(x.get("id")) != str(fid)]
    return True, ""


def reorder_folders(store, ordered_ids) -> tuple[bool, str]:
    """按给定 id 列表重排文件夹；未出现的 id 保持相对顺序接在末尾。"""
    ensure_folders(store)
    if not isinstance(ordered_ids, (list, tuple)):
        return False, "顺序无效"
    id_map = {str(f.get("id")): f for f in store.folders if f.get("id") is not None}
    seen: set[str] = set()
    new_list: list = []
    for raw in ordered_ids:
        fid = str(raw or "").strip()
        if not fid or fid in seen or fid not in id_map:
            continue
        new_list.append(id_map[fid])
        seen.add(fid)
    for f in store.folders:
        fid = str(f.get("id") or "")
        if fid and fid not in seen:
            new_list.append(f)
    store.folders = new_list
    return True, ""


def move_bank(store, bank_id: str, folder_id) -> tuple[bool, str]:
    ensure_folders(store)
    b = next((x for x in (store.banks or []) if str(x.get("id")) == str(bank_id)), None)
    if not b:
        return False, "题库不存在"
    if b.get("archived"):
        return False, "先恢复再移动"
    if folder_id is None or folder_id == "":
        b["folder_id"] = None
        return True, ""
    if not find_folder(store, str(folder_id)):
        return False, "文件夹不存在"
    b["folder_id"] = str(folder_id)
    return True, ""


def archive_bank(store, bank_id: str) -> tuple[bool, str]:
    """归档：只改状态，不清 folder_id，不动 current_bank_id。"""
    ensure_folders(store)
    b = next((x for x in (store.banks or []) if str(x.get("id")) == str(bank_id)), None)
    if not b:
        return False, "题库不存在"
    b["archived"] = True
    return True, ""


def unarchive_bank(store, bank_id: str) -> tuple[bool, str]:
    ensure_folders(store)
    b = next((x for x in (store.banks or []) if str(x.get("id")) == str(bank_id)), None)
    if not b:
        return False, "题库不存在"
    b["archived"] = False
    return True, ""


def toggle_folder(store, folder_id: str, collapsed: bool) -> tuple[bool, str]:
    """持久化文件夹展开/收起状态。"""
    ensure_folders(store)
    f = find_folder(store, folder_id)
    if not f:
        return False, "文件夹不存在"
    f["collapsed"] = bool(collapsed)
    return True, ""


def reorder_banks(store, parent_id, ordered_ids) -> tuple[bool, str]:
    """按给定 id 列表重排同级题库；未出现的 id 保持相对顺序接在末尾。
    只修改目标 parent_id 分组的 sort_order，不动其他分组。
    parent_id: folder_id（None 表示根区）
    """
    ensure_folders(store)
    if not isinstance(ordered_ids, (list, tuple)):
        return False, "顺序无效"
    parent_key = str(parent_id) if parent_id is not None else None

    def _match(b):
        fid = b.get("folder_id")
        if parent_key is None:
            return fid is None or fid == ""
        return str(fid) == parent_key

    # 只取目标分组内的活跃题库
    siblings = [b for b in (store.banks or []) if _match(b) and not b.get("archived")]
    id_map = {str(b.get("id")): b for b in siblings if b.get("id") is not None}
    seen: set[str] = set()
    new_order: list = []
    for raw in ordered_ids:
        bid = str(raw or "").strip()
        if not bid or bid in seen or bid not in id_map:
            continue
        new_order.append(id_map[bid])
        seen.add(bid)
    for b in siblings:
        bid = str(b.get("id") or "")
        if bid and bid not in seen:
            new_order.append(b)

    # 只写回目标分组的 sort_order，不动其他分组
    for idx, b in enumerate(new_order):
        b["sort_order"] = idx

    return True, ""


def ensure_sort_defaults(store) -> None:
    """为旧数据补 sort_order 和 collapsed 默认值。"""
    ensure_folders(store)
    # 文件夹补 collapsed 和 sort_order
    for idx, f in enumerate(store.folders or []):
        if "collapsed" not in f:
            f["collapsed"] = False
        if "sort_order" not in f:
            f["sort_order"] = idx

    # 题库补 sort_order（按 folder_id 分组，组内按现有顺序）
    from collections import defaultdict
    groups = defaultdict(list)
    for b in store.banks or []:
        fid = str(b.get("folder_id") or "") or None
        groups[fid].append(b)

    for fid, banks in groups.items():
        # 活跃题库
        active = [b for b in banks if not b.get("archived")]
        for idx, b in enumerate(active):
            if "sort_order" not in b:
                b["sort_order"] = idx
        # 归档题库
        archived = [b for b in banks if b.get("archived")]
        for idx, b in enumerate(archived):
            if "sort_order" not in b:
                b["sort_order"] = 10000 + idx
