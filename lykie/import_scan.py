# -*- coding: utf-8 -*-
"""导入题型扫描：在滤噪声之前识别大题标题 / 题型微标，并按题型归并题块池。

供独立「题型扫描」步与强提醒使用。
"""
from __future__ import annotations

import re

# 完整题型名优先；短词「单选/多选」可跟「题」或分值括号，避免「2. 判断一下」误伤
SECTION_TYPE_BODY = (
    r"(?:"
    r"单选题|多选题|判断题|填空题|简答题|选择题|"
    r"单选|多选"
    r")"
)

SECTION_HEAD_RE = re.compile(
    rf"^[一二三四五六七八九十百千万零〇两\d]+[.、．]\s*"
    rf"{SECTION_TYPE_BODY}"
    rf"(?:\s*[（(].*)?.*$"
)

SECTION_HEAD_SHORT_RE = re.compile(
    r"^[一二三四五六七八九十百千万零〇两\d]+[.、．]\s*"
    r"(?:判断|填空|简答)"
    r"(?:题|\s*[（(]|\s*共|\s*$)"
)

TYPE_TAG_KIND_RE = re.compile(
    r"^[（(]\s*(单选题|多选题|判断题|填空题|简答题|选择题)\s*[)）]"
)

# 题号：1. / 1、 / 或粘连 1所谓；排除 7.3 这类章节号
ITEM_START_RE = re.compile(
    r"^(?!\d+\.\d+)"
    r"(?:"
    r"(\d+)[.、．:：]\s*(.*)$"
    r"|"
    r"(\d+)(?=[\u4e00-\u9fffA-Za-z（(])(.*)$"
    r")"
)

# 教材/讲义章节标题：7.3 总线接口 / 第3章 …
CHAPTER_HEAD_RE = re.compile(
    r"^(?:"
    r"\d+\.\d+(?:\.\d+)*\s+\S"
    r"|"
    r"第[一二三四五六七八九十百千零〇两\d]+章\b"
    r")"
)

ANALYSIS_LINE_RE = re.compile(
    r"^(?:答案解析|题目解析|解析|分析)\s*[:：]"
)

ANSWER_LINE_RE = re.compile(
    r"(?:参考答案|标准答案|正确答案|答案)\s*[:：]"
)

KIND_LABELS = {
    "choice": "选择题",
    "judge": "判断题",
    "fill": "填空题",
    "short_answer": "简答题",
}

_KIND_FROM_NAME = {
    "单选题": "choice",
    "多选题": "choice",
    "选择题": "choice",
    "单选": "choice",
    "多选": "choice",
    "判断题": "judge",
    "判断": "judge",
    "填空题": "fill",
    "填空": "fill",
    "简答题": "short_answer",
    "简答": "short_answer",
}

KIND_ORDER = ("choice", "judge", "fill", "short_answer")


def _kind_from_token(token: str) -> str | None:
    t = (token or "").strip()
    return _KIND_FROM_NAME.get(t)


def match_section_head(line: str) -> dict | None:
    """大题标题行 → {kind, label_line, token}；否则 None。"""
    s = (line or "").strip()
    if not s:
        return None
    m = SECTION_HEAD_RE.match(s) or SECTION_HEAD_SHORT_RE.match(s)
    if not m:
        return None
    m2 = re.search(
        r"(单选题|多选题|判断题|填空题|简答题|选择题|单选|多选|判断|填空|简答)",
        s,
    )
    if not m2:
        return None
    kind = _kind_from_token(m2.group(1))
    if not kind:
        return None
    return {"kind": kind, "label_line": s, "token": m2.group(1)}


def match_type_tag_kind(line: str) -> dict | None:
    """(单选题) 微标 → kind 信息。"""
    s = (line or "").strip()
    m = TYPE_TAG_KIND_RE.match(s)
    if not m:
        return None
    kind = _kind_from_token(m.group(1))
    if not kind:
        return None
    return {"kind": kind, "label_line": s, "token": m.group(1)}


def is_section_head_line(line: str) -> bool:
    return match_section_head(line) is not None


def is_chapter_heading_line(line: str) -> bool:
    """教材小节标题（如「7.3 总线接口」），不是题号。"""
    s = (line or "").strip()
    if not s:
        return False
    return bool(CHAPTER_HEAD_RE.match(s))


def is_item_start(line: str) -> bool:
    s = (line or "").strip()
    if not s or is_section_head_line(s) or is_chapter_heading_line(s):
        return False
    if match_type_tag_kind(s):
        return True
    return bool(ITEM_START_RE.match(s))


def is_answer_line(line: str) -> bool:
    return bool(ANSWER_LINE_RE.search(line or ""))


def is_analysis_line(line: str) -> bool:
    return bool(ANALYSIS_LINE_RE.match((line or "").strip()))


def raw_lines(text: str) -> list[str]:
    return [ln.strip() for ln in (text or "").splitlines() if ln.strip()]


def split_raw_sections(lines: list[str]) -> list[dict]:
    """按大题标题分段（标题行本身不进 body）。"""
    sections: list[dict] = []
    cur_kind: str | None = None
    cur_label = ""
    cur: list[str] = []

    def flush():
        nonlocal cur, cur_kind, cur_label
        if cur_kind and cur:
            sections.append({
                "kind": cur_kind,
                "label_line": cur_label,
                "lines": list(cur),
            })
        cur = []

    for ln in lines:
        head = match_section_head(ln)
        if head:
            flush()
            cur_kind = head["kind"]
            cur_label = head["label_line"]
            continue
        if cur_kind is None:
            tag = match_type_tag_kind(ln)
            if tag:
                cur_kind = tag["kind"]
                cur_label = tag["label_line"]
                cur.append(ln)
                continue
            continue
        if is_chapter_heading_line(ln):
            continue
        cur.append(ln)
    flush()
    return sections


def split_items(lines: list[str]) -> list[list[str]]:
    """段内粗切单题：题号/微标起块，答案行收束（其后解析仍可跟）。"""
    if not lines:
        return []
    blocks: list[list[str]] = []
    cur: list[str] = []
    after_answer = False

    def flush():
        nonlocal cur, after_answer
        if cur:
            blocks.append(cur)
        cur = []
        after_answer = False

    for ln in lines:
        if is_chapter_heading_line(ln):
            # 章节标题夹在大题之间：不并入上一题，也不另起一题
            continue
        if is_item_start(ln) and cur:
            flush()
            cur = [ln]
            continue
        if after_answer:
            if is_item_start(ln):
                flush()
                cur = [ln]
                continue
            # 答案后只保留解析行；大纲/关键词行丢弃
            if is_analysis_line(ln):
                cur.append(ln)
            continue
        cur.append(ln)
        if is_answer_line(ln):
            after_answer = True
    flush()
    return blocks


def item_preview(block: list[str], limit: int = 72) -> str:
    for ln in block:
        if match_type_tag_kind(ln) or is_answer_line(ln):
            continue
        s = re.sub(r"^\s*", "", ln)
        s = re.sub(r"^[A-Ha-h][.、．:：]\s*", "", s)
        if s:
            return s if len(s) <= limit else (s[: limit - 1] + "…")
    joined = " ".join(block)
    return joined if len(joined) <= limit else (joined[: limit - 1] + "…")


def scan_pools(text: str) -> dict:
    """完整扫描：题型列表 + 按题型归并的题块池（方便挑样板）。

    返回:
      detected_types: [{kind, label, count, section_count, label_line, approx_hint}]
      pools: {
        kind: {
          label, count, section_count,
          joined_text,  # 同型全部题粘在一起
          items: [{index, preview, text}]
        }
      }
    """
    lines = raw_lines(text)
    sections = split_raw_sections(lines)

    by_kind: dict[str, dict] = {}
    for sec in sections:
        kind = sec["kind"]
        bucket = by_kind.setdefault(kind, {
            "kind": kind,
            "label": KIND_LABELS.get(kind, kind),
            "sections": [],
            "items": [],
        })
        bucket["sections"].append(sec["label_line"])
        for block in split_items(sec["lines"]):
            if not block:
                continue
            # 至少要有答案行或足够长，避免标题残渣
            if not any(is_answer_line(x) for x in block) and len(block) < 2:
                continue
            text_block = "\n".join(block).strip()
            if not text_block:
                continue
            bucket["items"].append({
                "index": len(bucket["items"]) + 1,
                "preview": item_preview(block),
                "text": text_block,
                "section_label": sec["label_line"],
            })

    detected: list[dict] = []
    pools: dict[str, dict] = {}
    for kind in KIND_ORDER:
        bucket = by_kind.get(kind)
        if not bucket or not bucket["items"]:
            continue
        items = bucket["items"]
        joined = "\n\n".join(it["text"] for it in items)
        first_label = (bucket["sections"] or [""])[0]
        detected.append({
            "kind": kind,
            "label": bucket["label"],
            "count": len(items),
            "section_count": len(bucket["sections"]),
            "label_line": first_label,
            "approx_hint": f"{len(items)} 题 · 来自 {len(bucket['sections'])} 处大题",
        })
        pools[kind] = {
            "kind": kind,
            "label": bucket["label"],
            "count": len(items),
            "section_count": len(bucket["sections"]),
            "joined_text": joined,
            "items": items,
        }

    # 无大题标题时：整篇当作 unknown，不强行造池
    if not detected and lines:
        # 仍报告微标
        for ln in lines:
            info = match_type_tag_kind(ln)
            if not info:
                continue
            kind = info["kind"]
            if any(d["kind"] == kind for d in detected):
                continue
            detected.append({
                "kind": kind,
                "label": KIND_LABELS.get(kind, kind),
                "count": 0,
                "section_count": 0,
                "label_line": info["label_line"],
                "approx_hint": info["label_line"][:60],
            })

    return {"detected_types": detected, "pools": pools}


def scan_types(lines: list[str]) -> list[dict]:
    """兼容旧接口：只返回题型摘要（含粗计数量）。"""
    text = "\n".join(lines or [])
    return scan_pools(text)["detected_types"]


def scan_text(text: str) -> list[dict]:
    return scan_pools(text)["detected_types"]


def uncovered_kinds(detected: list[dict], covered: set[str]) -> list[str]:
    """未覆盖的需确认题型（判断/填空/简答）。"""
    need = {"judge", "fill", "short_answer"}
    found = {d["kind"] for d in detected}
    return sorted(found & need - covered)
