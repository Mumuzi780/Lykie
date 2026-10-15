# -*- coding: utf-8 -*-
"""阅读视图：粘贴真题文章，划词查词/翻译 —— 学习现场与资产库之间的桥。"""
from __future__ import annotations

import json
import os
import re
import tempfile
import time
from datetime import datetime
from typing import Any

from lykie import accounts as lykie_accounts

_lookup_id_seq = 0
_text_id_seq = 0


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def readings_path(username: str) -> str:
    return os.path.join(lykie_accounts.user_dir(username), "readings.json")


def _empty() -> dict:
    return {"texts": [], "lookups": []}


def load_readings(username: str) -> dict:
    path = readings_path(username)
    if not os.path.exists(path):
        return _empty()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    if not isinstance(data.get("texts"), list):
        data["texts"] = []
    if not isinstance(data.get("lookups"), list):
        data["lookups"] = []
    return data


def save_readings(username: str, data: dict) -> None:
    lykie_accounts.ensure_user_files(username)
    path = readings_path(username)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        prefix="readings.",
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


# CET 感知分段：题号/选项/题区标记行识别（只插段落边界，不动任何正文字符）
_QUESTION_RE = re.compile(r"^\s*\d{1,3}[\.\)]\s*(?!\d)\S")
_OPTION_RE = re.compile(r"^\s*[A-F][\.\)]\s*\S")
_MARKER_RE = re.compile(
    r"^(Part\s+(?:[IVX]+|[A-E])\b|Section\s+[A-E]\b"
    r"|Passage\s+(?:One|Two|Three|Four|Five|\d+)\b"
    r"|Questions\s+\d+\s+to\s+\d+)",
    re.IGNORECASE,
)
_SENT_END_RE = re.compile(r"[.!?][\"')\]]?$")

_QUESTION_HEAD_RE = re.compile(r"^\s*(\d{1,3})[\.\)]\s*(?!\d)\S")
_OPTION_HEAD_RE = re.compile(r"^\s*[A-F][\.\)]\s*\S")

# PDF 页脚（"2026 年6月大学英语四级考试真题(第3套)" 等）：导入时整行丢弃
_FOOTER_RE = re.compile(
    r"^\d{4}\s*年\s*\d{1,2}\s*月.{0,30}大学英语[四六]级考试.{0,30}真题.{0,20}$"
)


def split_questions(paragraphs: list[str]) -> tuple[list[str], list[dict]]:
    """把分段结果拆为（正文段, 题目组）。

    题目组 = 题号段 + 其后紧邻的折行续段 + 选项段（至下一题号/题区标记/正文段为止）。
    判定「正文段」：长段（≥2 行折行合并且非选项非标记）视为文章正文，不属于任何题目。
    纯文章（无题号）时 questions 为空，调用方据此隐藏侧栏。"""
    articles: list[str] = []
    questions: list[dict] = []

    def is_question_start(p: str) -> bool:
        return bool(_QUESTION_HEAD_RE.match(p))

    def is_option(p: str) -> bool:
        return bool(_OPTION_HEAD_RE.match(p))

    def is_body(p: str) -> bool:
        # 长段视为正文：折行合并后明显长于单行选项/题干。
        # 但题号开头的段永远是题目（正文段不会以 "46." 开头）
        return (len(p) >= 120 and not is_option(p)
                and not _MARKER_RE.match(p) and not is_question_start(p))

    i = 0
    n = len(paragraphs)
    while i < n:
        p = paragraphs[i]
        if is_question_start(p) and not is_body(p):
            q = {"num": _QUESTION_HEAD_RE.match(p).group(1), "paras": [p]}
            j = i + 1
            while j < n:
                nxt = paragraphs[j]
                if is_question_start(nxt) and not is_body(nxt):
                    break
                if is_body(nxt) or _MARKER_RE.match(nxt):
                    break
                q["paras"].append(nxt)
                j += 1
            questions.append(q)
            i = j
        elif questions and not is_body(p) and not _MARKER_RE.match(p) and not is_option(p):
            # 孤立短段（分段阶段被短行启发拆出的题干续句等）归入上一题
            questions[-1]["paras"].append(p)
            i += 1
        else:
            articles.append(p)
            i += 1
    return articles, questions


def normalize_content(raw) -> str:
    """文章导入规整：空行=段落分隔（保留）；题号/选项行起新段（折行续文并入同段）；
    题区标记（Part IV / Section C / Passage One / Questions 46 to 50）独立成段；
    PDF 硬换行按句内软换行连接（空格）；段末短行启发（以 .!? 结尾且明显短于平均行长）
    判定段落结束。只插入段落边界，不增删改正文字符。
    防误判：小数（3.5）、Part of 开头、无标点数字行（50 percent）不触发分段。"""
    text = str(raw or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.strip() for ln in text.split("\n")]

    # 平均行长（仅统计正文行，排除题号/选项/标记）
    body = [ln for ln in lines
            if ln and not _QUESTION_RE.match(ln) and not _OPTION_RE.match(ln)
            and not _MARKER_RE.match(ln)]
    avg = (sum(len(ln) for ln in body) / len(body)) if body else 0.0
    short_len = max(28, int(avg * 0.62))

    paras: list[str] = []
    cur: list[str] = []

    def flush() -> None:
        if cur:
            paras.append(" ".join(cur))
            cur.clear()

    for ln in lines:
        if not ln:
            flush()
            continue
        if _FOOTER_RE.match(ln):
            continue  # 页脚行：整行丢弃
        if _MARKER_RE.match(ln):
            flush()
            paras.append(ln)
            continue
        if _QUESTION_RE.match(ln) or _OPTION_RE.match(ln):
            flush()
        cur.append(ln)
        if len(ln) < short_len and _SENT_END_RE.search(ln):
            flush()
    flush()

    out = [re.sub(r"\s+", " ", p).strip() for p in paras]
    return "\n\n".join([p for p in out if p])


def _new_text_id() -> str:
    global _text_id_seq
    _text_id_seq += 1
    return f"rt_{int(time.time() * 1000)}{_text_id_seq:03d}"


def _new_lookup_id() -> str:
    global _lookup_id_seq
    _lookup_id_seq += 1
    return f"lk_{int(time.time() * 1000)}{_lookup_id_seq:03d}"


def _public_text(item: dict, with_content: bool = False) -> dict:
    out = {
        "id": item.get("id") or "",
        "title": item.get("title") or "",
        "source": item.get("source") or "",
        "created_at": item.get("created_at") or "",
    }
    if with_content:
        out["content"] = item.get("content") or ""
    return out


def list_texts(username: str) -> list[dict]:
    data = load_readings(username)
    return [_public_text(t, with_content=False) for t in data["texts"] if isinstance(t, dict)]


def get_text(username: str, text_id: str) -> dict | None:
    data = load_readings(username)
    for t in data["texts"]:
        if isinstance(t, dict) and t.get("id") == text_id:
            return _public_text(t, with_content=True)
    return None


def create_text(username: str, title: str, source: str, content: str) -> dict:
    item = {
        "id": _new_text_id(),
        "title": str(title or "").strip()[:120],
        "source": str(source or "").strip()[:200],
        "content": normalize_content(content),
        "created_at": now_str(),
    }
    data = load_readings(username)
    data["texts"].insert(0, item)
    save_readings(username, data)
    return _public_text(item, with_content=True)


def delete_text(username: str, text_id: str) -> bool:
    data = load_readings(username)
    before = len(data["texts"])
    data["texts"] = [
        t for t in data["texts"]
        if not (isinstance(t, dict) and t.get("id") == text_id)
    ]
    data["lookups"] = [
        l for l in data["lookups"]
        if not (isinstance(l, dict) and l.get("text_id") == text_id)
    ]
    if len(data["texts"]) == before:
        return False
    save_readings(username, data)
    return True


def append_lookup(username: str, text_id: str, selection: str, sentence: str,
                  mode: str, head: str = "", result: dict | None = None,
                  para_index: int | None = None, occur_index: int | None = None,
                  q_num: str = "", q_para_index: int | None = None) -> dict:
    record = {
        "id": _new_lookup_id(),
        "text_id": str(text_id or ""),
        "selection": str(selection or "").strip()[:300],
        "sentence": str(sentence or "").strip()[:1200],
        "mode": "translate" if mode == "translate" else "lookup",
        "head": str(head or "").strip()[:120],
        "imported": False,
        "result": result if isinstance(result, dict) else {},
        "para_index": para_index if isinstance(para_index, int) and para_index >= 0 else None,
        "occur_index": occur_index if isinstance(occur_index, int) and occur_index >= 0 else None,
        "q_num": str(q_num or "").strip()[:10],
        "q_para_index": q_para_index if isinstance(q_para_index, int) and q_para_index >= 0 else None,
        "at": now_str(),
    }
    data = load_readings(username)
    data["lookups"].append(record)
    save_readings(username, data)
    return record


def find_cached_lookup(username: str, text_id: str, mode: str,
                       selection: str, sentence: str) -> dict | None:
    """缓存命中查询：同文章内查过的内容直接复用，不再调模型。

    - translate：找 sentence 相同的任一记录（词查词时顺带存的整句译同样可复用）
    - lookup：找 selection + sentence 都相同的词查记录"""
    sel = str(selection or "").strip()
    sent = str(sentence or "").strip()
    if not sent and mode != "translate":
        return None
    data = load_readings(username)
    for l in reversed(data["lookups"]):
        if not isinstance(l, dict) or l.get("text_id") != text_id:
            continue
        if mode == "translate":
            if l.get("sentence") == sent and l.get("result"):
                zh = (l.get("result") or {}).get("example_zh") or (l.get("result") or {}).get("zh")
                if zh:
                    return l
        else:
            if (l.get("mode") == "lookup" and l.get("selection") == sel
                    and l.get("sentence") == sent and (l.get("result") or {}).get("meaning")):
                return l
    return None


def get_lookup_marks(username: str, text_id: str) -> list[dict]:
    """聚合该文章全部查词记录 → 已查词标记表：
    [{selection, gloss, imported}]，按 selection 去重（后查覆盖先查）。"""
    data = load_readings(username)
    marks: dict[str, dict] = {}
    for l in data["lookups"]:
        if not isinstance(l, dict) or l.get("text_id") != text_id or l.get("mode") != "lookup":
            continue
        sel = str(l.get("selection") or "").strip()
        if not sel:
            continue
        res = l.get("result") or {}
        marks[sel] = {
            "selection": sel,
            "head": str(l.get("head") or "").strip().lower(),
            "gloss": str(res.get("meaning") or "")[:200],
            "imported": bool(l.get("imported")),
            "para_index": l.get("para_index") if isinstance(l.get("para_index"), int) else None,
            "occur_index": l.get("occur_index") if isinstance(l.get("occur_index"), int) else None,
            "q_num": str(l.get("q_num") or "").strip(),
            "q_para_index": l.get("q_para_index") if isinstance(l.get("q_para_index"), int) else None,
        }
    return list(marks.values())


def mark_lookup_imported(username: str, lookup_id: str) -> bool:
    data = load_readings(username)
    for l in data["lookups"]:
        if isinstance(l, dict) and l.get("id") == lookup_id:
            l["imported"] = True
            save_readings(username, data)
            return True
    return False
