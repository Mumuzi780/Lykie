# -*- coding: utf-8 -*-
"""模考 + 错题本（与章节斩题路径分离）。"""
from __future__ import annotations

import random
import time
from datetime import datetime

from lykie import short_answer as lykie_sa


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def new_id() -> str:
    return str(int(time.time() * 1000)) + str(random.randint(10, 99))


def ensure_extras(store) -> None:
    if not hasattr(store, "collections") or store.collections is None:
        store.collections = []
    if not hasattr(store, "wrong_sets") or store.wrong_sets is None:
        store.wrong_sets = []
    if not hasattr(store, "active_mock"):
        store.active_mock = None
    if not hasattr(store, "active_wrong"):
        store.active_wrong = None
    if not hasattr(store, "last_mock_settle"):
        store.last_mock_settle = None


def mock_elapsed_sec(sess: dict | None) -> int:
    if not sess:
        return 0
    accum = float(sess.get("elapsed_accum") or 0)
    if sess.get("paused") or sess.get("finished"):
        return max(0, int(accum))
    started = float(sess.get("started_ts") or time.time())
    return max(0, int(accum + (time.time() - started)))


def pause_mock(store) -> tuple[dict | None, str]:
    ensure_extras(store)
    sess = store.active_mock
    if not sess or sess.get("finished"):
        return None, "没有进行中的模考"
    if not sess.get("paused"):
        accum = float(sess.get("elapsed_accum") or 0)
        started = float(sess.get("started_ts") or time.time())
        sess["elapsed_accum"] = accum + max(0.0, time.time() - started)
        sess["paused"] = True
        sess["paused_at"] = now_str()
    return sess, ""


def resume_mock(store) -> tuple[dict | None, str]:
    ensure_extras(store)
    sess = store.active_mock
    if not sess or sess.get("finished"):
        return None, "没有进行中的模考"
    if sess.get("paused"):
        sess["paused"] = False
        sess["started_ts"] = time.time()
        sess.pop("paused_at", None)
    return sess, ""


def abort_mock(store) -> tuple[dict | None, str]:
    """离开时选择终止：按已答交卷。"""
    ensure_extras(store)
    if not store.active_mock:
        return None, "没有进行中的模考"
    if store.active_mock.get("paused"):
        # 已累计在 elapsed_accum
        pass
    else:
        pause_mock(store)
    return finish_mock(store)


def _bank_map(store) -> dict:
    return {str(b["id"]): b for b in (store.banks or [])}


def _objective_qs(bank: dict) -> list:
    return [
        q
        for q in (bank.get("questions") or [])
        if q.get("type") != "short_answer"
    ]


def expand_collection_refs(store, collection: dict) -> list[dict]:
    """展开为 {source_bank_id, source_qid, stem, type, ...resolved q}；缺题跳过。"""
    bmap = _bank_map(store)
    refs = collection.get("question_refs")
    out = []
    if refs:
        for r in refs:
            bid = str(r.get("source_bank_id") or "")
            qid = str(r.get("source_qid") or "")
            b = bmap.get(bid)
            if not b:
                continue
            q = next((x for x in b.get("questions") or [] if str(x.get("id")) == qid), None)
            if not q or q.get("type") == "short_answer":
                continue
            out.append({"source_bank_id": bid, "source_qid": qid, "q": q, "bank_name": b.get("name")})
        return out
    # 无缓存则按源库顺序展开
    for bid in collection.get("source_bank_ids") or []:
        b = bmap.get(str(bid))
        if not b:
            continue
        for q in _objective_qs(b):
            out.append(
                {
                    "source_bank_id": str(b["id"]),
                    "source_qid": str(q["id"]),
                    "q": q,
                    "bank_name": b.get("name"),
                }
            )
    return out


def build_refs_from_banks(store, source_bank_ids: list) -> tuple[list, list[str]]:
    """返回 (refs, warnings)。"""
    bmap = _bank_map(store)
    refs = []
    warnings = []
    for bid in source_bank_ids:
        b = bmap.get(str(bid))
        if not b:
            warnings.append(f"题库不存在: {bid}")
            continue
        if lykie_sa.is_sa_bank(b):
            warnings.append(f"「{b.get('name')}」是简答库，已跳过")
            continue
        qs = _objective_qs(b)
        if not qs:
            warnings.append(f"「{b.get('name')}」没有客观题")
            continue
        obj = [q for q in qs if q.get("status") == "killed"]
        if len(obj) < len(qs):
            warnings.append(f"「{b.get('name')}」尚未全部斩完（建议先熟悉再模考）")
        for q in qs:
            refs.append({"source_bank_id": str(b["id"]), "source_qid": str(q["id"])})
    return refs, warnings


def create_collection(store, source_bank_ids: list, name: str | None = None) -> tuple[dict | None, str, list]:
    ensure_extras(store)
    ids = [str(x) for x in (source_bank_ids or []) if str(x).strip()]
    ids = list(dict.fromkeys(ids))
    if len(ids) < 2:
        return None, "请至少选择 2 个章节题库", []
    refs, warnings = build_refs_from_banks(store, ids)
    if len(refs) < 2:
        return None, "模考至少需要 2 道客观题", warnings
    bmap = _bank_map(store)
    names = [bmap[i].get("name", i) for i in ids if i in bmap and not lykie_sa.is_sa_bank(bmap[i])]
    col = {
        "id": new_id(),
        "name": (name or "").strip() or (" · ".join(names[:3]) + (" 等" if len(names) > 3 else "") + " · 模考"),
        "source_bank_ids": [i for i in ids if i in bmap and not lykie_sa.is_sa_bank(bmap[i])],
        "question_refs": refs,
        "created_at": now_str(),
        "runs": [],
    }
    store.collections.append(col)
    # 确保有对应错题集
    ensure_wrong_set_for_collection(store, col)
    return col, "", warnings


def ensure_wrong_set_for_collection(store, collection: dict) -> dict:
    ensure_extras(store)
    cid = str(collection["id"])
    for ws in store.wrong_sets:
        if ws.get("kind") == "from_collection" and str(ws.get("collection_id")) == cid:
            return ws
    ws = {
        "id": new_id(),
        "name": f"{collection.get('name') or '模考'} · 错题",
        "kind": "from_collection",
        "collection_id": cid,
        "items": [],
        "created_at": now_str(),
    }
    store.wrong_sets.append(ws)
    return ws


def find_collection(store, cid: str) -> dict | None:
    ensure_extras(store)
    return next((c for c in store.collections if str(c.get("id")) == str(cid)), None)


def find_wrong_set(store, wid: str) -> dict | None:
    ensure_extras(store)
    return next((w for w in store.wrong_sets if str(w.get("id")) == str(wid)), None)


def rename_collection(store, cid: str, name: str) -> tuple[bool, str]:
    c = find_collection(store, cid)
    if not c:
        return False, "模考不存在"
    n = (name or "").strip()
    if not n:
        return False, "名称不能为空"
    c["name"] = n
    ws = ensure_wrong_set_for_collection(store, c)
    if ws.get("kind") == "from_collection":
        ws["name"] = f"{n} · 错题"
    return True, ""


def delete_collection(store, cid: str) -> tuple[bool, str]:
    ensure_extras(store)
    c = find_collection(store, cid)
    if not c:
        return False, "模考不存在"
    store.collections = [x for x in store.collections if str(x.get("id")) != str(cid)]
    if store.active_mock and str(store.active_mock.get("collection_id")) == str(cid):
        store.active_mock = None
    # 保留错题集（用户可能还要练），仅解除绑定名可不变
    return True, ""


def start_mock(store, collection_id: str, *, force_new: bool = False) -> tuple[dict | None, str]:
    ensure_extras(store)
    col = find_collection(store, collection_id)
    if not col:
        return None, "模考不存在"

    # 同模考进行中：恢复，不重开
    if store.active_mock and not store.active_mock.get("finished"):
        if str(store.active_mock.get("collection_id")) == str(collection_id) and not force_new:
            resume_mock(store)
            return store.active_mock, ""
        if str(store.active_mock.get("collection_id")) != str(collection_id):
            return None, "另有模考进行中，请先结束或终止后再开新场"

    items = expand_collection_refs(store, col)
    if not items:
        return None, "模考没有可用题目（源题可能已删）"
    order = list(range(len(items)))
    random.shuffle(order)
    run_index = len(col.get("runs") or []) + 1
    session = {
        "collection_id": str(col["id"]),
        "run_index": run_index,
        "order": order,
        "cursor": 0,
        "streak": 0,
        "max_streak": 0,
        "correct_count": 0,
        "wrong_count": 0,
        "answered": 0,
        "total": len(items),
        "wrong_refs": [],
        "events": [],
        "started_at": now_str(),
        "started_ts": time.time(),
        "elapsed_accum": 0.0,
        "paused": False,
        "finished": False,
    }
    # 缓存展开快照，避免考中途源库变动导致错位
    session["items"] = [
        {
            "source_bank_id": it["source_bank_id"],
            "source_qid": it["source_qid"],
            "bank_name": it.get("bank_name") or "",
        }
        for it in items
    ]
    store.active_mock = session
    store.active_wrong = None
    if force_new:
        store.last_mock_settle = None
    return session, ""


def _mock_current_item(store) -> tuple[dict | None, dict | None, str]:
    """返回 (session, item_meta, err)。item_meta 含 q。"""
    ensure_extras(store)
    sess = store.active_mock
    if not sess or sess.get("finished"):
        return None, None, "没有进行中的模考"
    cur = int(sess.get("cursor") or 0)
    order = sess.get("order") or []
    items = sess.get("items") or []
    if cur >= len(order):
        return sess, None, "done"
    idx = order[cur]
    if idx < 0 or idx >= len(items):
        return sess, None, "题目索引无效"
    meta = items[idx]
    bmap = _bank_map(store)
    b = bmap.get(str(meta["source_bank_id"]))
    q = None
    if b:
        q = next(
            (x for x in b.get("questions") or [] if str(x.get("id")) == str(meta["source_qid"])),
            None,
        )
    if not q:
        # 跳过已删题
        sess["cursor"] = cur + 1
        return _mock_current_item(store)
    return sess, {**meta, "q": q}, ""


def add_wrong_item(store, collection_id: str, source_bank_id: str, source_qid: str) -> None:
    col = find_collection(store, collection_id)
    if not col:
        return
    ws = ensure_wrong_set_for_collection(store, col)
    items = ws.setdefault("items", [])
    for it in items:
        if str(it.get("source_bank_id")) == str(source_bank_id) and str(it.get("source_qid")) == str(source_qid):
            it["wrong_count"] = int(it.get("wrong_count") or 0) + 1
            it["last_wrong_at"] = now_str()
            return
    items.append(
        {
            "source_bank_id": str(source_bank_id),
            "source_qid": str(source_qid),
            "wrong_count": 1,
            "last_wrong_at": now_str(),
        }
    )


def answer_mock(store, correct: bool) -> tuple[dict | None, str]:
    sess, item, err = _mock_current_item(store)
    if err == "done":
        return finish_mock(store)
    if err or not sess or not item:
        return None, err or "没有进行中的模考"

    correct = bool(correct)
    q = item["q"]
    qid = str(item["source_qid"])
    bid = str(item["source_bank_id"])

    sess["answered"] = int(sess.get("answered") or 0) + 1
    if correct:
        sess["correct_count"] = int(sess.get("correct_count") or 0) + 1
        before = int(sess.get("streak") or 0)
        after = before + 1
        sess["streak"] = after
        sess["max_streak"] = max(int(sess.get("max_streak") or 0), after)
        sess.setdefault("events", []).append(
            {"type": "correct", "source_bank_id": bid, "source_qid": qid, "streak_after": after, "at": now_str()}
        )
    else:
        sess["wrong_count"] = int(sess.get("wrong_count") or 0) + 1
        before = int(sess.get("streak") or 0)
        sess["streak"] = 0
        sess.setdefault("wrong_refs", []).append({"source_bank_id": bid, "source_qid": qid})
        add_wrong_item(store, sess["collection_id"], bid, qid)
        sess.setdefault("events", []).append(
            {
                "type": "wrong",
                "source_bank_id": bid,
                "source_qid": qid,
                "streak_before": before,
                "at": now_str(),
            }
        )

    sess["cursor"] = int(sess.get("cursor") or 0) + 1
    done = int(sess["cursor"]) >= len(sess.get("order") or [])
    payload = {
        "ok": True,
        "correct": correct,
        "streak": int(sess.get("streak") or 0),
        "max_streak": int(sess.get("max_streak") or 0),
        "answered": int(sess.get("answered") or 0),
        "total": int(sess.get("total") or 0),
        "done": done,
        "qid": qid,
        "analysis": q.get("analysis") or "",
    }
    if done:
        fin, _ = finish_mock(store)
        payload["settle"] = fin
    return payload, ""


def finish_mock(store) -> tuple[dict | None, str]:
    ensure_extras(store)
    sess = store.active_mock
    if not sess:
        return None, "没有进行中的模考"
    if sess.get("finished") and sess.get("settle_cache"):
        return sess["settle_cache"], ""

    total = int(sess.get("total") or 0)
    correct = int(sess.get("correct_count") or 0)
    wrong = int(sess.get("wrong_count") or 0)
    # 未答完中途交卷：未答题不计对
    answered = int(sess.get("answered") or 0)
    score = round(correct / total * 100) if total else 0
    if not sess.get("paused"):
        pause_mock(store)
        sess = store.active_mock or sess
    duration_sec = mock_elapsed_sec(sess)

    col = find_collection(store, sess.get("collection_id"))
    wrong_set = ensure_wrong_set_for_collection(store, col) if col else None

    # 错题详情
    wrong_cards = []
    bmap = _bank_map(store)
    seen = set()
    for wr in sess.get("wrong_refs") or []:
        key = (str(wr.get("source_bank_id")), str(wr.get("source_qid")))
        if key in seen:
            continue
        seen.add(key)
        b = bmap.get(key[0])
        q = None
        if b:
            q = next((x for x in b.get("questions") or [] if str(x.get("id")) == key[1]), None)
        wrong_cards.append(
            {
                "source_bank_id": key[0],
                "source_qid": key[1],
                "stem": (q.get("stem") if q else "") or "(题目已删除)",
                "bank_name": (b.get("name") if b else "") or "",
            }
        )

    settle = {
        "collection_id": sess.get("collection_id"),
        "collection_name": (col or {}).get("name") or "",
        "run_index": int(sess.get("run_index") or 1),
        "score": score,
        "duration_sec": duration_sec,
        "max_streak": int(sess.get("max_streak") or 0),
        "total": total,
        "correct_count": correct,
        "wrong_count": wrong,
        "answered": answered,
        "wrong_cards": wrong_cards,
        "wrong_set_id": (wrong_set or {}).get("id"),
        "cleared_at": now_str(),
    }

    run_rec = {
        "index": settle["run_index"],
        "started_at": sess.get("started_at"),
        "cleared_at": settle["cleared_at"],
        "max_streak": settle["max_streak"],
        "correct_count": correct,
        "total_count": total,
        "score": score,
        "duration_sec": duration_sec,
        "wrong_qids": [f"{w['source_bank_id']}:{w['source_qid']}" for w in wrong_cards],
        "events": list(sess.get("events") or []),
    }
    if col is not None:
        col.setdefault("runs", []).append(run_rec)

    sess["finished"] = True
    sess["settle_cache"] = settle
    store.last_mock_settle = settle
    store.active_mock = None
    return settle, ""


def list_collections(store) -> list:
    ensure_extras(store)
    out = []
    for c in store.collections:
        refs = expand_collection_refs(store, c)
        out.append(
            {
                "id": c["id"],
                "name": c.get("name"),
                "created_at": c.get("created_at"),
                "source_bank_ids": c.get("source_bank_ids") or [],
                "total": len(refs),
                "run_count": len(c.get("runs") or []),
            }
        )
    return out


def list_wrong_sets(store) -> list:
    ensure_extras(store)
    out = []
    for w in store.wrong_sets:
        out.append(
            {
                "id": w["id"],
                "name": w.get("name"),
                "kind": w.get("kind"),
                "collection_id": w.get("collection_id"),
                "count": len(w.get("items") or []),
                "created_at": w.get("created_at"),
            }
        )
    return out


def merge_wrong_sets(store, ids: list, name: str | None = None) -> tuple[dict | None, str]:
    ensure_extras(store)
    ids = [str(x) for x in (ids or []) if str(x).strip()]
    ids = list(dict.fromkeys(ids))
    if len(ids) < 2:
        return None, "请至少选择 2 个错题集"
    sources = []
    for i in ids:
        w = find_wrong_set(store, i)
        if not w:
            return None, f"错题集不存在: {i}"
        sources.append(w)
    merged_items = []
    seen = set()
    for w in sources:
        for it in w.get("items") or []:
            key = (str(it.get("source_bank_id")), str(it.get("source_qid")))
            if key in seen:
                # 累加错次
                for m in merged_items:
                    if str(m.get("source_bank_id")) == key[0] and str(m.get("source_qid")) == key[1]:
                        m["wrong_count"] = int(m.get("wrong_count") or 0) + int(it.get("wrong_count") or 0)
                        break
                continue
            seen.add(key)
            merged_items.append(
                {
                    "source_bank_id": key[0],
                    "source_qid": key[1],
                    "wrong_count": int(it.get("wrong_count") or 1),
                    "last_wrong_at": it.get("last_wrong_at") or now_str(),
                }
            )
    if not merged_items:
        return None, "选中的错题集都是空的"
    label = (name or "").strip() or (" + ".join(w.get("name", "")[:12] for w in sources[:2]) + " · 合成")
    ws = {
        "id": new_id(),
        "name": label,
        "kind": "merged",
        "source_set_ids": ids,
        "items": merged_items,
        "created_at": now_str(),
    }
    store.wrong_sets.append(ws)
    return ws, ""


def remove_wrong_item(store, wrong_set_id: str, source_bank_id: str, source_qid: str) -> tuple[bool, str]:
    ws = find_wrong_set(store, wrong_set_id)
    if not ws:
        return False, "错题集不存在"
    before = len(ws.get("items") or [])
    ws["items"] = [
        it
        for it in (ws.get("items") or [])
        if not (
            str(it.get("source_bank_id")) == str(source_bank_id)
            and str(it.get("source_qid")) == str(source_qid)
        )
    ]
    if len(ws["items"]) == before:
        return False, "题目不在错题集中"
    return True, ""


def clear_mastered_wrong(store, wrong_set_id: str, keep_ids: set | None = None) -> int:
    """占位：练习时对过的已直接 remove。此函数用于批量按 keep。"""
    return 0


def start_wrong_practice(store, wrong_set_id: str) -> tuple[dict | None, str]:
    ensure_extras(store)
    ws = find_wrong_set(store, wrong_set_id)
    if not ws:
        return None, "错题集不存在"
    items = list(ws.get("items") or [])
    if not items:
        return None, "错题集是空的"
    order = list(range(len(items)))
    random.shuffle(order)
    sess = {
        "wrong_set_id": str(ws["id"]),
        "items": [
            {"source_bank_id": str(it["source_bank_id"]), "source_qid": str(it["source_qid"])}
            for it in items
        ],
        "order": order,
        "cursor": 0,
        "started_at": now_str(),
    }
    store.active_wrong = sess
    store.active_mock = None
    return sess, ""


def _wrong_current(store) -> tuple[dict | None, dict | None, str]:
    ensure_extras(store)
    sess = store.active_wrong
    if not sess:
        return None, None, "没有进行中的错题练习"
    cur = int(sess.get("cursor") or 0)
    order = sess.get("order") or []
    items = sess.get("items") or []
    if cur >= len(order):
        return sess, None, "done"
    idx = order[cur]
    meta = items[idx]
    bmap = _bank_map(store)
    b = bmap.get(str(meta["source_bank_id"]))
    q = None
    if b:
        q = next(
            (x for x in b.get("questions") or [] if str(x.get("id")) == str(meta["source_qid"])),
            None,
        )
    if not q:
        # 源题没了，从错题集移除并跳过
        remove_wrong_item(store, sess["wrong_set_id"], meta["source_bank_id"], meta["source_qid"])
        sess["cursor"] = cur + 1
        return _wrong_current(store)
    return sess, {**meta, "q": q}, ""


def answer_wrong_practice(store, correct: bool) -> tuple[dict | None, str]:
    sess, item, err = _wrong_current(store)
    if err == "done":
        store.active_wrong = None
        return {"ok": True, "done": True, "removed": False}, ""
    if err or not sess or not item:
        return None, err or "没有进行中的错题练习"

    removed = False
    if correct:
        ok, _ = remove_wrong_item(
            store, sess["wrong_set_id"], item["source_bank_id"], item["source_qid"]
        )
        removed = ok
    else:
        # 再记一次错
        ws = find_wrong_set(store, sess["wrong_set_id"])
        if ws:
            for it in ws.get("items") or []:
                if str(it.get("source_bank_id")) == str(item["source_bank_id"]) and str(
                    it.get("source_qid")
                ) == str(item["source_qid"]):
                    it["wrong_count"] = int(it.get("wrong_count") or 0) + 1
                    it["last_wrong_at"] = now_str()
                    break

    sess["cursor"] = int(sess.get("cursor") or 0) + 1
    done = int(sess["cursor"]) >= len(sess.get("order") or [])
    if done:
        store.active_wrong = None
    return {
        "ok": True,
        "correct": bool(correct),
        "removed": removed,
        "done": done,
        "analysis": (item["q"].get("analysis") if item.get("q") else "") or "",
    }, ""


def format_duration(sec: int) -> str:
    sec = max(0, int(sec or 0))
    m, s = divmod(sec, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"
