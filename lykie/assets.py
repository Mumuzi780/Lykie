# -*- coding: utf-8 -*-
"""个人词汇资产：可视化大脑 —— 一词一头，再录加深并补全义项；旁系为词族关系圈。"""
from __future__ import annotations

import json
import os
import re
import tempfile
import time
from datetime import datetime
from typing import Any

from lykie import accounts as lykie_accounts

POS_OPTIONS = ("n.", "v.", "adj.", "adv.", "prep.", "conj.", "phr.", "other")

_WORD_RE = re.compile(r"\s+")


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def assets_path(username: str) -> str:
    return os.path.join(lykie_accounts.user_dir(username), "assets.json")


def _empty() -> dict:
    return {"vocab": []}


def load_assets(username: str) -> dict:
    path = assets_path(username)
    if not os.path.exists(path):
        return _empty()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    if not isinstance(data.get("vocab"), list):
        data["vocab"] = []
    return data


def _coerce_phrase_nodes(raw) -> list[dict]:
    """Always persist phrases as {text, meaning, examples[]} — never bare strings."""
    out: list[dict] = []
    seen = set()
    for it in raw or []:
        if isinstance(it, dict):
            text = str(it.get("text") or it.get("phrase") or "").strip()
            meaning = str(it.get("meaning") or "").strip()
            exs = _parse_examples(it.get("examples") or [])
            if not exs and (it.get("example") or it.get("en")):
                exs = _parse_examples(
                    it.get("example") or it,
                    default_source=str(it.get("source") or ""),
                )
        else:
            text = str(it or "").strip()
            meaning = ""
            exs = []
        if not text:
            continue
        key = normalize_meaning(text)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({"text": text, "meaning": meaning, "examples": exs})
    return out


def _normalize_vocab_phrases(data: dict) -> None:
    for item in data.get("vocab") or []:
        if not isinstance(item, dict):
            continue
        if "phrases" in item:
            item["phrases"] = _coerce_phrase_nodes(item.get("phrases"))


def save_assets(username: str, data: dict) -> None:
    lykie_accounts.ensure_user_files(username)
    _normalize_vocab_phrases(data)
    path = assets_path(username)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        prefix="assets.",
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


def normalize_word(word: str) -> str:
    return _WORD_RE.sub(" ", str(word or "").strip().lower())


def normalize_meaning(meaning: str) -> str:
    return _WORD_RE.sub(" ", str(meaning or "").strip().lower())


def normalize_pos(pos: str) -> str:
    p = str(pos or "").strip().lower()
    if not p:
        return "other"
    if not p.endswith(".") and p != "other":
        p = p + "."
    for opt in POS_OPTIONS:
        if p == opt.lower():
            return opt
    return "other"


_id_seq = 0


def _new_id(prefix: str = "") -> str:
    global _id_seq
    _id_seq += 1
    base = f"{int(time.time() * 1000)}{_id_seq:03d}"
    return f"{prefix}{base}" if prefix else base


def _parse_examples(raw, default_source: str = "") -> list[dict]:
    """Accept list of dicts, list of strings, or multiline text with optional ||.
    In text, a single newline is a soft wrap inside one example (PDF paste
    often carries hard wraps); a blank line separates examples.
    Each example may carry source; string blocks inherit default_source.
    """
    out: list[dict] = []
    src_default = str(default_source or "").strip()
    if raw is None:
        return out
    if isinstance(raw, str):
        blocks = re.split(r"\n\s*\n", raw.replace("\r\n", "\n"))
        items = [re.sub(r"\s+", " ", b).strip() for b in blocks]
        items = [b for b in items if b]
    elif isinstance(raw, list):
        items = raw
    else:
        return out

    seen = set()
    for it in items:
        en, zh, src = "", "", src_default
        if isinstance(it, dict):
            en = str(it.get("en") or "").strip()
            zh = str(it.get("zh") or "").strip()
            own = str(it.get("source") or "").strip()
            if len(own) > 200:
                own = own[:200]
            if own:
                src = own
        else:
            s = str(it).strip()
            if "||" in s:
                left, right = s.split("||", 1)
                en, zh = left.strip(), right.strip()
            else:
                en = s
        if not en and not zh:
            continue
        key = (en.lower(), zh)
        if key in seen:
            continue
        seen.add(key)
        out.append({"en": en, "zh": zh, "source": src})
    return out


def _merge_examples(existing: list, incoming: list) -> list:
    index = {}
    merged = []
    for e in existing:
        if not isinstance(e, dict):
            continue
        key = (str(e.get("en") or "").lower(), str(e.get("zh") or ""))
        item = {
            "en": str(e.get("en") or "").strip(),
            "zh": str(e.get("zh") or "").strip(),
            "source": str(e.get("source") or "").strip(),
        }
        index[key] = item
        merged.append(item)
    for e in incoming:
        if not isinstance(e, dict):
            continue
        key = (str(e.get("en") or "").lower(), str(e.get("zh") or ""))
        src = str(e.get("source") or "").strip()
        if key in index:
            if src and not index[key].get("source"):
                index[key]["source"] = src
            continue
        item = {
            "en": str(e.get("en") or "").strip(),
            "zh": str(e.get("zh") or "").strip(),
            "source": src,
        }
        index[key] = item
        merged.append(item)
    return merged


def _normalize_source(raw) -> tuple[str, str]:
    s = str(raw or "").strip()
    if len(s) > 200:
        return "", "来源太长"
    return s, ""


def _parse_related(raw) -> list[dict]:
    """Normalize related payload to [{word, pos}, ...]."""
    out: list[dict] = []
    if raw is None:
        return out
    if isinstance(raw, str):
        items = [ln.strip() for ln in raw.replace("\r\n", "\n").split("\n") if ln.strip()]
    elif isinstance(raw, list):
        items = raw
    else:
        return out

    seen = set()
    for it in items:
        word, pos = "", ""
        if isinstance(it, dict):
            word = str(it.get("word") or "").strip()
            pos = str(it.get("pos") or "").strip()
        else:
            word = str(it).strip()
        if not word or len(word) > 80:
            continue
        key = normalize_word(word)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({
            "word": word,
            "pos": normalize_pos(pos) if pos else "",
        })
    return out


def _parse_senses(
    senses_raw,
    *,
    pos: str = "other",
    meaning: str = "",
    examples=None,
) -> tuple[list[dict], str]:
    """
    Build sense list from senses[] or legacy pos/meaning/examples.
    Returns (senses, error). Each sense: {pos, meaning, examples}.
    """
    items: list = []
    if isinstance(senses_raw, list) and senses_raw:
        items = senses_raw
    else:
        items = [{
            "pos": pos,
            "meaning": meaning,
            "examples": examples,
        }]

    out: list[dict] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        pos_n = normalize_pos(it.get("pos") or "other")
        meaning_n = str(it.get("meaning") or "").strip()
        if len(meaning_n) > 500:
            return [], "释义太长"
        src_n, src_err = _normalize_source(it.get("source"))
        if src_err:
            return [], src_err
        exs = _parse_examples(it.get("examples"), default_source=src_n)
        out.append({
            "pos": pos_n,
            "meaning": meaning_n,
            "examples": exs,
        })
    if not out:
        out.append({
            "pos": normalize_pos(pos or "other"),
            "meaning": "",
            "examples": [],
        })
    if len(out) > 20:
        return [], "一次最多 20 个义项"
    return out, ""


def _senses_have_content(sense_list: list[dict]) -> bool:
    for s in sense_list:
        if str(s.get("meaning") or "").strip() or (s.get("examples") or []):
            return True
    return False


def _apply_senses(entry: dict, sense_list: list[dict]) -> None:
    for s in sense_list:
        _merge_sense_into(
            entry,
            s["pos"],
            s.get("meaning") or "",
            s.get("examples") or [],
        )


def find_by_word(data: dict, word: str) -> dict | None:
    key = normalize_word(word)
    if not key:
        return None
    for item in data.get("vocab") or []:
        if normalize_word(item.get("word") or "") == key:
            return item
    return None


def find_by_id(data: dict, entry_id: str) -> dict | None:
    for item in data.get("vocab") or []:
        if str(item.get("id")) == str(entry_id):
            return item
    return None


def _is_stub(item: dict) -> bool:
    return bool(item.get("stub"))


def _related_public(item: dict, data: dict) -> list[dict]:
    out = []
    for edge in item.get("related") or []:
        if not isinstance(edge, dict):
            continue
        eid = edge.get("entry_id")
        target = find_by_id(data, eid) if eid else None
        word = str(edge.get("word") or (target.get("word") if target else "") or "").strip()
        pos = str(edge.get("pos") or "").strip()
        if target and not pos:
            senses = target.get("senses") or []
            if senses:
                pos = str(senses[0].get("pos") or "").strip()
        if not word and not eid:
            continue
        out.append({
            "entry_id": eid or (target.get("id") if target else None),
            "word": word,
            "pos": pos,
            "stub": bool(target.get("stub")) if target else False,
        })
    return out


def _normalize_example_obj(raw) -> dict:
    if isinstance(raw, dict):
        return {
            "en": str(raw.get("en") or "").strip(),
            "zh": str(raw.get("zh") or "").strip(),
        }
    if isinstance(raw, str):
        s = raw.strip()
        if "||" in s:
            left, right = s.split("||", 1)
            return {"en": left.strip(), "zh": right.strip()}
        return {"en": s, "zh": ""}
    return {"en": "", "zh": ""}


def _co_sents_public(item: dict, data: dict) -> list[dict]:
    out = []
    for edge in item.get("co_sents") or []:
        if not isinstance(edge, dict):
            continue
        eid = edge.get("entry_id")
        target = find_by_id(data, eid) if eid else None
        word = str(edge.get("word") or (target.get("word") if target else "") or "").strip()
        ex = _normalize_example_obj(edge.get("example"))
        if not word and not eid:
            continue
        out.append({
            "entry_id": eid or (target.get("id") if target else None),
            "word": word,
            "example": ex,
            "stub": bool(target.get("stub")) if target else False,
        })
    return out


def public_entry(item: dict, data: dict | None = None) -> dict:
    """Serialize for API."""
    if _is_stub(item):
        count = int(item.get("record_count") or 0)
        show_count = False
    else:
        count = int(item.get("record_count") or 1)
        show_count = count >= 2
    payload = {
        "id": item.get("id"),
        "word": item.get("word"),
        "stub": _is_stub(item),
        "record_count": count,
        "show_count": show_count,
        "source": str(item.get("source") or "").strip(),
        "phrases": _phrases_public(item),
        "senses": item.get("senses") or [],
        "related": [],
        "co_sents": [],
        "created_at": item.get("created_at") or "",
        "updated_at": item.get("updated_at") or "",
    }
    if data is not None:
        payload["related"] = _related_public(item, data)
        payload["co_sents"] = _co_sents_public(item, data)
    else:
        for edge in item.get("related") or []:
            if not isinstance(edge, dict):
                continue
            payload["related"].append({
                "entry_id": edge.get("entry_id"),
                "word": edge.get("word") or "",
                "pos": edge.get("pos") or "",
                "stub": False,
            })
        for edge in item.get("co_sents") or []:
            if not isinstance(edge, dict):
                continue
            payload["co_sents"].append({
                "entry_id": edge.get("entry_id"),
                "word": edge.get("word") or "",
                "example": _normalize_example_obj(edge.get("example")),
                "stub": False,
            })
    return payload


def _edge_dict(target: dict, pos: str = "") -> dict:
    p = pos or ""
    if not p:
        senses = target.get("senses") or []
        if senses:
            p = str(senses[0].get("pos") or "")
    return {
        "entry_id": target.get("id"),
        "word": target.get("word"),
        "pos": p,
    }


def _add_related_edge(a: dict, b: dict, pos_on_b: str = "", pos_on_a: str = "") -> None:
    """Bidirectional link; dedupe by normalized word; no self-link."""
    if str(a.get("id")) == str(b.get("id")):
        return
    if normalize_word(a.get("word") or "") == normalize_word(b.get("word") or ""):
        return

    def ensure(host: dict, target: dict, pos: str) -> None:
        related = host.setdefault("related", [])
        key = normalize_word(target.get("word") or "")
        tid = str(target.get("id"))
        for edge in related:
            if not isinstance(edge, dict):
                continue
            if str(edge.get("entry_id")) == tid:
                if pos and not edge.get("pos"):
                    edge["pos"] = pos
                edge["word"] = target.get("word")
                return
            if normalize_word(edge.get("word") or "") == key:
                edge["entry_id"] = tid
                edge["word"] = target.get("word")
                if pos:
                    edge["pos"] = pos
                elif not edge.get("pos"):
                    edge["pos"] = pos
                return
        related.append(_edge_dict(target, pos))

    ensure(a, b, pos_on_b)
    ensure(b, a, pos_on_a)


def _ensure_stub(data: dict, word: str, pos: str = "", stamp: str = "") -> dict:
    existing = find_by_word(data, word)
    if existing:
        return existing
    stamp = stamp or now_str()
    pos_n = normalize_pos(pos) if pos else "other"
    sense = {
        "id": _new_id("s"),
        "pos": pos_n,
        "meaning": "",
        "examples": [],
    }
    entry = {
        "id": _new_id("v"),
        "word": str(word).strip(),
        "stub": True,
        "record_count": 0,
        "senses": [sense],
        "related": [],
        "co_sents": [],
        "phrases": [],
        "created_at": stamp,
        "updated_at": stamp,
    }
    data.setdefault("vocab", []).append(entry)
    return entry


def _link_related(data: dict, main: dict, related_items: list[dict], stamp: str) -> None:
    main_pos = ""
    senses = main.get("senses") or []
    if senses:
        main_pos = str(senses[0].get("pos") or "")
    for item in related_items:
        w = str(item.get("word") or "").strip()
        if not w:
            continue
        if normalize_word(w) == normalize_word(main.get("word") or ""):
            continue
        pos = str(item.get("pos") or "").strip()
        other = find_by_word(data, w)
        if not other:
            other = _ensure_stub(data, w, pos=pos, stamp=stamp)
        elif pos:
            # refresh display pos on edge; if stub with empty meaning, update placeholder pos
            if _is_stub(other):
                osenses = other.setdefault("senses", [])
                if osenses and not str(osenses[0].get("meaning") or "").strip():
                    osenses[0]["pos"] = normalize_pos(pos)
        _add_related_edge(main, other, pos_on_b=pos or "", pos_on_a=main_pos)


def _merge_sense_into(existing: dict, pos_n: str, meaning_n: str, exs: list) -> None:
    senses = existing.setdefault("senses", [])
    meaning_key = normalize_meaning(meaning_n)
    matched = None
    for s in senses:
        if normalize_pos(s.get("pos") or "") != pos_n:
            continue
        if normalize_meaning(s.get("meaning") or "") == meaning_key:
            matched = s
            break
    if matched is None and not meaning_key:
        for s in senses:
            if normalize_pos(s.get("pos") or "") == pos_n and not normalize_meaning(
                s.get("meaning") or ""
            ):
                matched = s
                break
    if matched is None:
        senses.append({
            "id": _new_id("s"),
            "pos": pos_n,
            "meaning": meaning_n,
            "examples": exs,
        })
    else:
        if meaning_n and not str(matched.get("meaning") or "").strip():
            matched["meaning"] = meaning_n
        matched["pos"] = pos_n
        matched["examples"] = _merge_examples(matched.get("examples") or [], exs)


def _strip_related_to(data: dict, entry_id: str) -> None:
    eid = str(entry_id)
    for it in data.get("vocab") or []:
        related = it.get("related")
        if related:
            it["related"] = [
                e for e in related
                if not isinstance(e, dict) or str(e.get("entry_id")) != eid
            ]
        co = it.get("co_sents")
        if co:
            it["co_sents"] = [
                e for e in co
                if not isinstance(e, dict) or str(e.get("entry_id")) != eid
            ]


def _first_example_from_senses(sense_list: list[dict]) -> dict:
    for s in sense_list or []:
        for ex in s.get("examples") or []:
            if isinstance(ex, dict) and (ex.get("en") or ex.get("zh")):
                return {
                    "en": str(ex.get("en") or "").strip(),
                    "zh": str(ex.get("zh") or "").strip(),
                }
    return {"en": "", "zh": ""}


def _add_co_sent_edge(a: dict, b: dict, example: dict | None = None) -> None:
    """Bidirectional 同句 link; dedupe by entry_id / word; no self-link."""
    if str(a.get("id")) == str(b.get("id")):
        return
    if normalize_word(a.get("word") or "") == normalize_word(b.get("word") or ""):
        return
    ex = _normalize_example_obj(example)

    def ensure(host: dict, target: dict) -> None:
        edges = host.setdefault("co_sents", [])
        tid = str(target.get("id"))
        key = normalize_word(target.get("word") or "")
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            if str(edge.get("entry_id")) == tid or normalize_word(edge.get("word") or "") == key:
                edge["entry_id"] = tid
                edge["word"] = target.get("word")
                if ex.get("en") or ex.get("zh"):
                    edge["example"] = ex
                elif not isinstance(edge.get("example"), dict):
                    edge["example"] = {"en": "", "zh": ""}
                return
        edges.append({
            "entry_id": tid,
            "word": target.get("word"),
            "example": ex,
        })

    ensure(a, b)
    ensure(b, a)


def _link_from_entry(
    data: dict,
    current: dict,
    link_from: str,
    link_example=None,
    sense_list: list | None = None,
) -> None:
    src = find_by_id(data, str(link_from or "").strip())
    if not src:
        return
    if str(src.get("id")) == str(current.get("id")):
        return
    ex = _normalize_example_obj(link_example)
    if not ex.get("en") and not ex.get("zh"):
        ex = _first_example_from_senses(sense_list or [])
    if not ex.get("en") and not ex.get("zh"):
        # fall back to any example already on current entry
        ex = _first_example_from_senses(current.get("senses") or [])
    _add_co_sent_edge(current, src, ex)


def _normalize_source(raw) -> tuple[str, str]:
    s = str(raw or "").strip()
    if len(s) > 200:
        return "", "来源太长"
    return s, ""


def _parse_phrases(raw) -> tuple[list[dict], str]:
    """Normalize phrases to [{text, meaning, examples:[{en,zh,source}]}, ...]."""
    out: list[dict] = []
    if raw is None:
        return out, ""
    if isinstance(raw, str):
        items = [ln.strip() for ln in raw.replace("\r\n", "\n").split("\n") if ln.strip()]
    elif isinstance(raw, list):
        items = raw
    else:
        return out, "短语格式不对"

    seen = set()
    for it in items:
        meaning_n = ""
        if isinstance(it, dict):
            text = str(it.get("text") or it.get("phrase") or "").strip()
            meaning_n = str(it.get("meaning") or "").strip()
            if len(meaning_n) > 500:
                return [], "短语释义太长"
            src_n, src_err = _normalize_source(it.get("source"))
            if src_err:
                return [], src_err
            exs = _parse_examples(it.get("examples"), default_source=src_n)
        else:
            text = str(it or "").strip()
            exs = []
        if not text:
            continue
        if len(text) > 200:
            return [], "短语太长"
        key = normalize_meaning(text)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({"text": text, "meaning": meaning_n, "examples": exs})
    if len(out) > 40:
        return [], "一次最多 40 条短语"
    return out, ""


def _phrases_public(item: dict) -> list[dict]:
    return _coerce_phrase_nodes(item.get("phrases"))


def _merge_phrases(existing: dict, incoming: list[dict]) -> bool:
    """Merge phrases by text; merge meaning/examples under same phrase."""
    if not incoming:
        return False
    cur = existing.setdefault("phrases", [])
    by_key: dict[str, dict] = {}
    ordered: list[dict] = []
    for it in cur:
        if isinstance(it, dict):
            text = str(it.get("text") or it.get("phrase") or "").strip()
            meaning = str(it.get("meaning") or "").strip()
            exs = list(it.get("examples") or [])
        else:
            text = str(it or "").strip()
            meaning = ""
            exs = []
        if not text:
            continue
        key = normalize_meaning(text)
        if key in by_key:
            continue
        node = {"text": text, "meaning": meaning, "examples": exs}
        by_key[key] = node
        ordered.append(node)

    changed = False
    for it in incoming:
        text = str(it.get("text") or "").strip()
        if not text:
            continue
        key = normalize_meaning(text)
        meaning = str(it.get("meaning") or "").strip()
        exs = list(it.get("examples") or [])
        if key in by_key:
            node = by_key[key]
            before = (
                str(node.get("meaning") or ""),
                [
                    (
                        str(e.get("en") or "").lower(),
                        str(e.get("zh") or ""),
                        str(e.get("source") or ""),
                    )
                    for e in (node.get("examples") or [])
                ],
            )
            if meaning and not str(node.get("meaning") or "").strip():
                node["meaning"] = meaning
            elif meaning and meaning != str(node.get("meaning") or "").strip():
                # keep existing if already set; only fill empty
                pass
            node["examples"] = _merge_examples(node.get("examples") or [], exs)
            after = (
                str(node.get("meaning") or ""),
                [
                    (
                        str(e.get("en") or "").lower(),
                        str(e.get("zh") or ""),
                        str(e.get("source") or ""),
                    )
                    for e in (node.get("examples") or [])
                ],
            )
            if before != after:
                changed = True
        else:
            node = {"text": text, "meaning": meaning, "examples": exs}
            by_key[key] = node
            ordered.append(node)
            changed = True
    existing["phrases"] = ordered
    return changed


def _sync_examples_from_lib(data: dict, entry: dict, word: str) -> int:
    """Pull examples containing this word from other entries (local, deterministic).

    When recording a word, scan the user's own library for examples whose
    English text contains the word (word-boundary, case-insensitive) and merge
    them into this entry's first sense. Dedup via _merge_examples.
    """
    if not word:
        return 0
    try:
        pattern = re.compile(r"(?<!\w)" + re.escape(word) + r"(?!\w)", re.IGNORECASE)
    except re.error:
        return 0

    def iter_examples(owner: dict):
        for s in owner.get("senses") or []:
            for ex in s.get("examples") or []:
                if isinstance(ex, dict) and str(ex.get("en") or "").strip():
                    yield ex
        for p in owner.get("phrases") or []:
            if not isinstance(p, dict):
                continue
            for ex in p.get("examples") or []:
                if isinstance(ex, dict) and str(ex.get("en") or "").strip():
                    yield ex

    hits: list[dict] = []
    for other in data.get("vocab") or []:
        if other is entry or not isinstance(other, dict) or _is_stub(other):
            continue
        for ex in iter_examples(other):
            if pattern.search(str(ex.get("en") or "")):
                hits.append({
                    "en": str(ex.get("en") or "").strip(),
                    "zh": str(ex.get("zh") or "").strip(),
                    "source": str(ex.get("source") or "").strip(),
                })

    if not hits:
        return 0
    senses = entry.setdefault("senses", [])
    if not senses:
        senses.append({
            "id": _new_id("s"),
            "pos": "other",
            "meaning": "",
            "examples": [],
        })
    target = senses[0]
    added = 0
    for ex in hits:
        before = len(target.get("examples") or [])
        target["examples"] = _merge_examples(target.get("examples") or [], [ex])
        if len(target["examples"]) > before:
            added += 1
    return added


def _push_examples_to_lib(data: dict, entry: dict, stamp: str) -> int:
    """Push this entry's examples to other entries whose word appears in them.

    Bidirectional counterpart of _sync_examples_from_lib: examples on this
    entry get merged into other non-stub entries whose word head appears in
    the example text (word-boundary, case-insensitive). Merged into the
    target's first sense; dedup via _merge_examples.
    """
    own: list[dict] = []
    for s in entry.get("senses") or []:
        for ex in s.get("examples") or []:
            if isinstance(ex, dict) and str(ex.get("en") or "").strip():
                own.append(ex)
    for p in entry.get("phrases") or []:
        if not isinstance(p, dict):
            continue
        for ex in p.get("examples") or []:
            if isinstance(ex, dict) and str(ex.get("en") or "").strip():
                own.append(ex)
    if not own:
        return 0

    pushed = 0
    for target in data.get("vocab") or []:
        if target is entry or not isinstance(target, dict) or _is_stub(target):
            continue
        word = str(target.get("word") or "").strip()
        if not word:
            continue
        try:
            pattern = re.compile(r"(?<!\w)" + re.escape(word) + r"(?!\w)", re.IGNORECASE)
        except re.error:
            continue
        senses = target.get("senses") or []
        if not senses:
            continue
        target_sense = senses[0]
        changed = False
        for ex in own:
            if not pattern.search(str(ex.get("en") or "")):
                continue
            item = {
                "en": str(ex.get("en") or "").strip(),
                "zh": str(ex.get("zh") or "").strip(),
                "source": str(ex.get("source") or "").strip(),
            }
            before = len(target_sense.get("examples") or [])
            target_sense["examples"] = _merge_examples(target_sense.get("examples") or [], [item])
            if len(target_sense["examples"]) > before:
                pushed += 1
                changed = True
        if changed:
            target["updated_at"] = stamp
    return pushed


def record_vocab(
    username: str,
    *,
    word: str,
    pos: str = "other",
    meaning: str = "",
    examples=None,
    related=None,
    senses=None,
    link_from=None,
    link_example=None,
    source=None,
    phrases=None,
) -> tuple[dict | None, str, bool]:
    """
    Create or deepen a headword; optionally link 旁系 / 同句(link_from).
    Accepts senses=[{pos, meaning, examples}, ...] for multi-POS one-shot entry,
    or legacy single pos/meaning/examples.
    Returns (entry, error, created).
    """
    w = str(word or "").strip()
    if not w:
        return None, "请输入单词", False
    if len(w) > 80:
        return None, "单词太长", False

    source_n, source_err = _normalize_source(source)
    if source_err:
        return None, source_err, False
    phrase_list, perr = _parse_phrases(phrases)
    if perr:
        return None, perr, False

    sense_list, serr = _parse_senses(
        senses, pos=pos, meaning=meaning, examples=examples
    )
    if serr:
        return None, serr, False
    related_items = _parse_related(related)

    data = load_assets(username)
    existing = find_by_word(data, w)
    stamp = now_str()
    has_content = _senses_have_content(sense_list)
    created = False

    if not existing:
        entry = {
            "id": _new_id("v"),
            "word": w,
            "stub": False,
            "record_count": 1,
            "source": source_n,
            "phrases": [],
            "senses": [],
            "related": [],
            "co_sents": [],
            "created_at": stamp,
            "updated_at": stamp,
        }
        _apply_senses(entry, sense_list)
        if phrase_list:
            _merge_phrases(entry, phrase_list)
        data.setdefault("vocab", []).insert(0, entry)
        existing = entry
        created = True
    else:
        was_stub = _is_stub(existing)
        meta_only = (not has_content) and (
            bool(related_items) or bool(phrase_list) or bool(source_n)
        )
        link_only = (not has_content) and bool(related_items) and not phrase_list
        promote_stub = was_stub and (has_content or not (related_items or phrase_list))

        if promote_stub:
            existing["stub"] = False
            existing["record_count"] = max(int(existing.get("record_count") or 0), 1)
            created = True
            _apply_senses(existing, sense_list)
            existing["updated_at"] = stamp
        elif was_stub and meta_only and not has_content:
            existing["updated_at"] = stamp
        elif has_content:
            existing["record_count"] = int(existing.get("record_count") or 1) + 1
            existing["updated_at"] = stamp
            _apply_senses(existing, sense_list)
        elif meta_only or link_only:
            existing["updated_at"] = stamp
        else:
            existing["updated_at"] = stamp
            _apply_senses(existing, sense_list)

        # 词头来源仅兼容旧数据；新录入以来源挂在例句上为主
        if source_n and not str(existing.get("source") or "").strip():
            existing["source"] = source_n
        phrases_added = _merge_phrases(existing, phrase_list)

        if (
            created
            or has_content
            or related_items
            or promote_stub
            or link_from
            or source_n
            or phrases_added
        ):
            vocab = data.get("vocab") or []
            data["vocab"] = [existing] + [
                x for x in vocab if x.get("id") != existing.get("id")
            ]

    if related_items:
        _link_related(data, existing, related_items, stamp)

    if link_from:
        _link_from_entry(
            data,
            existing,
            link_from,
            link_example=link_example,
            sense_list=sense_list,
        )

    synced = 0
    if not _is_stub(existing):
        pulled = _sync_examples_from_lib(data, existing, w)
        pushed = _push_examples_to_lib(data, existing, stamp)
        synced = pulled + pushed
        if pulled:
            existing["updated_at"] = stamp

    save_assets(username, data)
    return public_entry(existing, data), "", created, synced


def list_vocab(
    username: str,
    *,
    q: str = "",
    limit: int = 50,
) -> list[dict]:
    data = load_assets(username)
    items = [it for it in (data.get("vocab") or []) if not _is_stub(it)]

    def sort_key(it: dict) -> str:
        return str(it.get("updated_at") or it.get("created_at") or "")

    items.sort(key=sort_key, reverse=True)
    query = normalize_word(q)
    if query:
        items = [
            it
            for it in items
            if query in normalize_word(it.get("word") or "")
            or any(
                query in normalize_meaning(s.get("meaning") or "")
                for s in (it.get("senses") or [])
            )
            or query in normalize_meaning(it.get("source") or "")
            or any(
                (
                    query in normalize_meaning(
                        (p.get("text") if isinstance(p, dict) else str(p or ""))
                    )
                    or query in normalize_meaning(
                        (p.get("meaning") if isinstance(p, dict) else "") or ""
                    )
                    or any(
                        query in normalize_meaning(str(e.get("en") or ""))
                        or query in normalize_meaning(str(e.get("source") or ""))
                        for e in ((p.get("examples") if isinstance(p, dict) else None) or [])
                        if isinstance(e, dict)
                    )
                )
                for p in (it.get("phrases") or [])
            )
        ]
    lim = max(1, min(int(limit or 50), 200))
    return [public_entry(it, data) for it in items[:lim]]


def get_vocab(username: str, entry_id: str) -> dict | None:
    data = load_assets(username)
    for it in data.get("vocab") or []:
        if str(it.get("id")) == str(entry_id):
            return public_entry(it, data)
    return None


def delete_vocab(username: str, entry_id: str) -> bool:
    data = load_assets(username)
    before = len(data.get("vocab") or [])
    data["vocab"] = [
        it for it in (data.get("vocab") or []) if str(it.get("id")) != str(entry_id)
    ]
    if len(data["vocab"]) == before:
        return False
    _strip_related_to(data, entry_id)
    save_assets(username, data)
    return True


def ensure_assets_file(username: str) -> None:
    """Touch empty assets.json when ensuring user files."""
    lykie_accounts.ensure_user_files(username)
    path = assets_path(username)
    if not os.path.exists(path):
        save_assets(username, _empty())


def flatten_examples(entry: dict) -> list[dict]:
    """展平词条例句，附全局编号：[{id, sense_index, example}]（id = 下标）。"""
    flat = []
    for si, s in enumerate(entry.get("senses") or []):
        for ex in (s.get("examples") or []):
            if isinstance(ex, dict):
                flat.append({"id": len(flat), "sense_index": si, "example": ex})
    return flat


def tidy_vocab(username: str, entry_id: str, senses_payload: list) -> tuple[dict | None, str]:
    """按 AI 整理建议重组词条义项（用户过目确认后调用）。

    senses_payload: [{pos, meaning, example_ids: [全局编号]}]
    - 原例句只按白名单保留，未列出的删除（用户已确认）
    - 原 senses 深拷贝备份到 _tidy_backup（后悔药，仅保留最近一次）
    - record_count / related / phrases / co_sents 不动
    """
    data = load_assets(username)
    entry = None
    for it in data.get("vocab") or []:
        if str(it.get("id")) == str(entry_id):
            entry = it
            break
    if entry is None:
        return None, "未找到词条"
    if _is_stub(entry):
        return None, "空壳词头无需整理"

    flat = flatten_examples(entry)
    total = len(flat)

    new_senses = []
    seen_ids = set()
    for item in senses_payload or []:
        if not isinstance(item, dict):
            return None, "整理数据格式错误"
        meaning = str(item.get("meaning") or "").strip()
        if not meaning:
            return None, "整理后的义项释义不能为空"
        pos = normalize_pos(item.get("pos") or "")
        ids = []
        for e in item.get("example_ids") or []:
            try:
                eid = int(e)
            except (TypeError, ValueError):
                return None, "例句编号异常"
            if eid < 0 or eid >= total:
                return None, "例句编号越界"
            if eid in seen_ids:
                return None, "同一例句不能保留在多个义项"
            seen_ids.add(eid)
            ids.append(eid)
        examples = [flat[i]["example"] for i in ids]
        new_senses.append({"pos": pos, "meaning": meaning, "examples": examples})

    if not new_senses:
        return None, "整理结果为空"

    import copy as _copy
    entry["_tidy_backup"] = {
        "senses": _copy.deepcopy(entry.get("senses") or []),
        "at": now_str(),
    }
    entry["senses"] = new_senses
    entry["updated_at"] = now_str()
    save_assets(username, data)
    return entry, ""
