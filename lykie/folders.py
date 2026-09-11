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
        count = sum(1 for b in (store.banks or []) if str(b.get("folder_id") or "") == fid)
        out.append(
            {
                "id": fid,
                "name": f.get("name") or "未命名文件夹",
                "created_at": f.get("created_at") or "",
                "count": count,
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
    if folder_id is None or folder_id == "":
        b["folder_id"] = None
        return True, ""
    if not find_folder(store, str(folder_id)):
        return False, "文件夹不存在"
    b["folder_id"] = str(folder_id)
    return True, ""
