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
# 行首「字母+括号」起新段：扩到 A-O——C 节选项(A-D)与 B 节段落标记(A-K)同形，
# 后者也是段边界（防相邻段被短行启发合并）；词库行的行中词条(I) word)不受行首规则影响
_OPTION_RE = re.compile(r"^\s*[A-O][\.\)]\s*\S")
_MARKER_RE = re.compile(
    r"^(Part\s+(?:[IVX]+|[A-E])\b|Section\s+[A-E]\b"
    r"|Passage\s+(?:One|Two|Three|Four|Five|\d+)\b"
    r"|Questions\s+\d+\s+to\s+\d+)",
    re.IGNORECASE,
)
_SENT_END_RE = re.compile(r"[.!?][\"')\]]?$")

_QUESTION_HEAD_RE = re.compile(r"^\s*(\d{1,3})[\.\)]\s*(?!\d)\S")
_OPTION_HEAD_RE = re.compile(r"^\s*[A-F][\.\)]\s*\S")

# 节感知（全题型）：词库词条（A) word，一行可两词）、Directions 段、Part/Section 标记
_BANK_ITEM_RE = re.compile(r"([A-O])\)\s*([A-Za-z][A-Za-z\-\'\.]*)")
_BANK_HEAD_RE = re.compile(r"^\s*[A-O]\)\s*\S")
# 整行纯词条（单词、无空格短语才认；C 节选项句、B 节正文段不匹配）
_BANK_LINE_FULL_RE = re.compile(r"^(?:[A-O]\)\s*[A-Za-z][A-Za-z\-\'\.]*\s*)+$")
_DIRECTIONS_RE = re.compile(r"^\s*Directions\s*[:：]", re.IGNORECASE)
_READING_PART_RE = re.compile(r"^Part\s+[IVX]+\s*Reading Comprehension", re.IGNORECASE)
_ANY_PART_RE = re.compile(r"^Part\s+[IVX]+\b", re.IGNORECASE)

# PDF 页脚（"2026 年6月大学英语四级考试真题(第3套)" 等）：导入时整行丢弃
_FOOTER_RE = re.compile(
    r"^\d{4}\s*年\s*\d{1,2}\s*月.{0,30}大学英语[四六]级考试.{0,30}真题.{0,20}$"
)


def _split_legacy(paragraphs: list[str], kind: str = "", options_all: bool = False) -> tuple[list[str], list[dict]]:
    """旧版题组切分（无 Section 标记的老子篇兼容 / C 节复用）：
    题号段 + 折行续段 + 选项段聚为一题；长段（≥120 字符）视为正文。
    options_all=True 时把题组内的选项行结构化为 {key, text} 列表。"""
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
            num = _QUESTION_HEAD_RE.match(p).group(1)
            q: dict = {"num": num, "paras": [p]}
            j = i + 1
            while j < n:
                nxt = paragraphs[j]
                if is_question_start(nxt) and not is_body(nxt):
                    break
                if is_body(nxt) or _MARKER_RE.match(nxt):
                    break
                q["paras"].append(nxt)
                j += 1
            if options_all:
                q["kind"] = kind or "choice"
                stem_end = len(q["paras"])
                opts: list[dict] = []
                while stem_end > 0:
                    m = re.match(r"^([A-F])[\.\)]\s*(.+)$", q["paras"][stem_end - 1].strip(), re.DOTALL)
                    if not m:
                        break
                    # 两栏 PDF 排版：A/C 同行、B/D 同行——行内出现更大的选项标记时切开。
                    # 条件：标记字母距行首 key ≥2（两栏排版必然跳档；相邻字母如正文里
                    # "plan B) " 的字面量是 A→B 差 1，不切，防误伤）。
                    pieces = [(m.group(1), m.group(2).strip())]
                    while True:
                        k, t = pieces[-1]
                        im = re.search(r"\s+([B-F])[\.\)]\s+(\S.*)$", t)
                        if not im or ord(im.group(1)) - ord(k) < 2:
                            break
                        pieces[-1] = (k, t[:im.start()].rstrip())
                        pieces.append((im.group(1), im.group(2).strip()))
                    for k, t in reversed(pieces):
                        opts.insert(0, {"key": k, "text": t})
                    stem_end -= 1
                raw_stem = " ".join(q["paras"][:stem_end]) if stem_end else q["paras"][0]
                q["stem"] = re.sub(r"^\s*\d{1,3}[\.\)]\s*", "", raw_stem.strip()) or raw_stem
                q["options"] = opts
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


def _drop_structure_lines(paragraphs: list[str]) -> list[str]:
    """渲染层清洗：Directions 说明段、Part/Passage/Questions 标记段不显示。
    注意不能在 _split_sections 之前用——Section 标记行本身是分节信号。"""
    return [p for p in paragraphs
            if not _DIRECTIONS_RE.match(p.strip()) and not _MARKER_RE.match(p.strip())]


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


def extract_pdf(file) -> str:
    """pypdf 提取 PDF 文本。无文本层（扫描版）或库缺失时抛 ValueError（中文）。"""
    try:
        from pypdf import PdfReader
    except ImportError:
        raise ValueError("服务器还没装 pypdf，请联系管理员或先用复制粘贴导入")
    try:
        reader = PdfReader(file)
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception:
        raise ValueError("PDF 解析失败，请确认是文字版 PDF，或改用复制粘贴")
    text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        raise ValueError("这个 PDF 提取不到文字（可能是扫描版），请改用复制粘贴")
    return text


def slice_reading_part(text: str) -> tuple[str, bool]:
    """裁出 Reading Comprehension 部分。命中→(节选文本, True)；未命中→(原文本, False)。"""
    lines = str(text or "").split("\n")
    start = end = -1
    for i, ln in enumerate(lines):
        s = ln.strip()
        if _READING_PART_RE.match(s):
            if start < 0:
                start = i
        elif start >= 0 and _ANY_PART_RE.match(s):
            end = i
            break
    if start < 0:
        return text, False
    seg = lines[start:end if end > 0 else len(lines)]
    return "\n".join(seg), True


def _is_directions(p: str) -> bool:
    return bool(_DIRECTIONS_RE.match(p))


def _bank_items(p: str) -> list[tuple[str, str]]:
    """词库段 → [(key, word), ...]。一行 1-3 词条（PDF 双列/三列）。"""
    return _BANK_ITEM_RE.findall(p)


def _extract_bank_block(paragraphs: list[str]) -> tuple[list[str], list[tuple[str, str]]]:
    """全局摘除词库块：连续的纯词条短行段（合计 ≥10 词条才认）。
    2024 套的 PDF 文本流里词库区会被 Section B 标记提前截走、归错节——
    词库特征极强（A-O 单词短行），全局识别比节内识别可靠。
    返回 (剩余段落, 词库)。"""
    keep: list[str] = []
    bank: list[tuple[str, str]] = []
    i, n = 0, len(paragraphs)
    while i < n:
        p = paragraphs[i]
        s = p.strip()
        if len(s) < 100 and _BANK_LINE_FULL_RE.match(s):
            j = i
            block: list[tuple[str, str]] = []
            while j < n:
                q = paragraphs[j].strip()
                if len(q) >= 100 or not _BANK_LINE_FULL_RE.match(q):
                    break
                block.extend(_bank_items(q))
                j += 1
            if len(block) >= 10:
                bank.extend(block)
                i = j
                continue
        keep.append(p)
        i += 1
    return keep, bank


def _split_sections(paragraphs: list[str]) -> dict:
    """按 Section A/B/C 标记分组。无标记返回空 dict（走 legacy）。"""
    secs: dict[str, list[str]] = {}
    cur = None
    for p in paragraphs:
        m = re.match(r"^Section\s+([A-C])\b", p.strip(), re.IGNORECASE)
        if m:
            cur = m.group(1).upper()
            secs.setdefault(cur, [])
            continue
        if cur:
            secs[cur].append(p)
    return secs


def _split_sentences(paragraph: str) -> list[str]:
    """粗句切分：句点/？/！收尾（直引号+智能引号“”‘’均认），供 A 节题干提取。
    PDF 提取的智能引号若不认，句尾。”切不开、两句合并会吞掉后面的空格数字。"""
    parts = re.split(r"(?<=[.!?])[\"'\u201d\u2019)\]]?\s+(?=[A-Z\"'\u201c\u2018(])", paragraph)
    return [s.strip() for s in parts if s.strip()]


def _blank_nums(sentence: str) -> list[str]:
    """句中裸空格数字。两种形式分开认，避免宽正则的吞并副作用：
    1. `___33___` 下划线包裹——必为空格标记（年份/数量词不会带下划线），直接收；
    2. 空格包裹且两侧贴文字/标点——lookbehind 拒数字（防 `20,000` 尾 0 吞掉 `___`），
       lookahead 放宽数字（兼容 `for 29 40,000 words`），26-55 区间过滤误伤（19xx 年份、40,000）。"""
    out: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r"_+(\d{1,2})_+", sentence):
        n = m.group(1)
        if n not in seen:
            seen.add(n)
            out.append(n)
    for m in re.finditer(r"(?<=[a-zA-Z,\"\(\u201c\u2018])\s(\d{1,2})\s(?=[a-zA-Z,\.\"\)\u201d\u2019\d])", sentence):
        n = m.group(1)
        if 26 <= int(n) <= 55 and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _section_a(paras: list[str], bank: list[tuple[str, str]] | None = None) -> tuple[list[str], list[dict]]:
    """选词填空：正文段 + 每空一题（题干=含空格数字的原句）。
    词库由全局 _extract_bank_block 摘除后传入（PDF 文本流可能把词库区归错节）。"""
    bank = bank or []
    articles: list[str] = []
    questions: list[dict] = []
    if not bank:
        articles.extend(paras)
        return articles, questions
    for p in paras:
        items = _bank_items(p)
        if not (items and len(p) < 400 and len(items) <= 3 and _BANK_LINE_FULL_RE.match(p.strip())):
            articles.append(p)
    for ap in articles:
        for sent in _split_sentences(ap):
            for n in _blank_nums(sent):
                questions.append({
                    "num": n, "kind": "bank", "stem": sent,
                    "options": [{"key": k, "text": w} for k, w in bank],
                })
    # 同空多次出现（句子切分边界异常等）：留第一处
    seen: set[str] = set()
    uniq: list[dict] = []
    for q in sorted(questions, key=lambda x: int(x["num"])):
        if q["num"] not in seen:
            seen.add(q["num"])
            uniq.append(q)
    return articles, uniq


def _section_b(paras: list[str]) -> tuple[list[str], list[dict]]:
    """长篇阅读：字母标记长段为正文（原样保留字母前缀），题号段为陈述句题目。"""
    articles: list[str] = []
    questions: list[dict] = []
    para_letters: list[str] = []
    for p in paras:
        if _is_directions(p):
            continue
        m = re.match(r"^([A-O])\)\s*(.{80,})", p, re.DOTALL)
        if m and m.group(2).count(" ") > 10:
            para_letters.append(m.group(1).upper())
            articles.append(p)
        elif _QUESTION_HEAD_RE.match(p):
            questions.append({"num": _QUESTION_HEAD_RE.match(p).group(1),
                              "kind": "match",
                              "stem": re.sub(r"^\s*\d{1,3}[\.\)]\s*", "", p.strip()) or p,
                              "paras": [p]})
        elif questions and len(p) < 120:
            questions[-1].setdefault("paras", []).append(p)
        else:
            articles.append(p)
    opts = [{"key": k, "text": f"段落 {k}"} for k in para_letters]
    for q in questions:
        q["options"] = opts
    return articles, questions


def _section_c_parts(paras: list[str]) -> list[tuple[list[str], list[dict]]]:
    """仔细阅读按 Passage 标记拆篇（每篇 passage 一道阅读区）。
    Passage 标记之前的前导段（Section C / Directions 等结构行）丢弃——
    否则会形成一个空 part，被调用方 continue 后剩余篇目的硬编码名字整体错位。"""
    parts: list[list[str]] = []
    cur: list[str] | None = None
    for p in paras:
        if re.match(r"^Passage\s+(One|Two|Three|Four|Five|\d+)\b", p.strip(), re.IGNORECASE):
            if cur:
                parts.append(cur)
            cur = [p]
        elif cur is not None:
            cur.append(p)
    if cur:
        parts.append(cur)
    if not parts:
        # 整节无 Passage 标记：整节一篇
        parts = [list(paras)]
    out = []
    for part in parts:
        arts, qs = _split_legacy(part, kind="choice", options_all=True)
        out.append((arts, qs, part[0] if part else ""))
    return out


def build_sections(paragraphs: list[str]) -> list[dict]:
    """题目感知分组：每篇一个阅读区。返回：
    [{key, label, kind, articles, questions, bank?}, ...]
    kind: bank(选词填空)/match(长篇阅读)/choice(仔细阅读)/legacy(无标记旧文章)。
    空输入 → []。Section C 无 Passage 标记时整节一篇。"""
    paragraphs, bank = _extract_bank_block(paragraphs)
    secs = _split_sections(paragraphs)
    if not secs:
        arts, qs = _split_legacy(_drop_structure_lines(paragraphs))
        if not arts and not qs:
            return []
        return [{"key": "legacy", "label": "", "kind": "legacy",
                 "articles": arts, "questions": qs}]

    out: list[dict] = []
    if "A" in secs:
        arts, qs = _section_a(secs["A"], bank)
        arts = _drop_structure_lines(arts)
        if arts or qs:
            out.append({"key": "A", "label": "Section A · 选词填空", "kind": "bank",
                        "articles": arts, "questions": qs,
                        "bank": [{"key": k, "text": w} for k, w in bank]})
    if "B" in secs:
        arts, qs = _section_b(secs["B"])
        arts = _drop_structure_lines(arts)
        if arts or qs:
            out.append({"key": "B", "label": "Section B · 长篇阅读", "kind": "match",
                        "articles": arts, "questions": qs})
    if "C" in secs:
        parts = _section_c_parts(secs["C"])
        for i, (arts, qs, head) in enumerate(parts):
            arts = _drop_structure_lines(arts)
            if not arts and not qs:
                continue
            # 篇名取 part 首段的实际 Passage 标记（不按数组位置硬编码，防错位）
            m = re.match(r"^Passage\s+(\w+)", (head or "").strip(), re.IGNORECASE)
            name = (m.group(1).capitalize() if m else "")
            label = f"Section C · Passage {name}" if len(parts) > 1 and name else "Section C · 仔细阅读"
            out.append({"key": f"C{i + 1}", "label": label, "kind": "choice",
                        "articles": arts, "questions": qs})
    return out


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
        "folder_id": item.get("folder_id") or None,
        "archived": bool(item.get("archived", False)),
        "is_paper": bool(item.get("is_paper")),
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


# ---------- 试卷收纳：影子卷节条目入题库侧栏（folder_id/archived/is_paper） ----------
# 一张卷 = 一条 text 记录（原子单位）；侧栏「选词填空/段落匹配/仔细阅读一/二」是它的
# 入口投影，不进 bank.json，斩题/模考/错题/分享管道天然不可见。


def detect_paper(content) -> bool:
    """卷检测：有任一结构化节（bank/match/choice）且总题数 ≥10 视为试卷。"""
    paragraphs = [p for p in str(content or "").split("\n\n") if p.strip()]
    total = 0
    structured = False
    for s in build_sections(paragraphs):
        qs = s.get("questions") or []
        if s.get("kind") in ("bank", "match", "choice") and qs:
            structured = True
            total += len(qs)
    return structured and total >= 10


def _paper_sections(item: dict) -> list[dict]:
    """卷的节摘要（侧栏渲染投影用：key/kind/label/题数）。"""
    paragraphs = [p for p in str(item.get("content") or "").split("\n\n") if p.strip()]
    out = []
    for s in build_sections(paragraphs):
        qs = s.get("questions") or []
        if s.get("kind") == "legacy" or not qs:
            continue
        out.append({"key": s.get("key") or "", "kind": s.get("kind") or "",
                    "label": s.get("label") or "", "count": len(qs)})
    return out


def list_papers(username: str) -> list[dict]:
    """侧栏合并渲染用：全部阅读条目（试卷+普通文章），带收纳状态与节摘要。
    旧记录无 folder_id/archived/is_paper 字段 → 未分类/未归档/普通文章。"""
    data = load_readings(username)
    out = []
    for t in data["texts"]:
        if not isinstance(t, dict):
            continue
        is_paper = bool(t.get("is_paper"))
        out.append({
            "id": t.get("id") or "",
            "title": t.get("title") or "",
            "created_at": t.get("created_at") or "",
            "folder_id": t.get("folder_id") or None,
            "archived": bool(t.get("archived", False)),
            "is_paper": is_paper,
            "sections": _paper_sections(t) if is_paper else [],
        })
    return out


def mark_paper(username: str, text_id: str, folder_id=None) -> bool:
    """导入钩子：置卷标记并挂文件夹（None=未分类）。"""
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return False
    t["is_paper"] = True
    t["folder_id"] = str(folder_id) if folder_id not in (None, "") else None
    save_readings(username, data)
    return True


def set_paper_folder(username: str, text_id: str, folder_id) -> bool:
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return False
    t["folder_id"] = str(folder_id) if folder_id not in (None, "") else None
    save_readings(username, data)
    return True


def archive_paper(username: str, text_id: str) -> bool:
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return False
    t["archived"] = True
    save_readings(username, data)
    return True


def restore_paper(username: str, text_id: str) -> bool:
    """恢复回原 folder_id（语义对齐题库归档：归档不清归属）。"""
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return False
    t["archived"] = False
    save_readings(username, data)
    return True


def clear_folder_refs(username: str, folder_id) -> int:
    """文件夹被删时清试卷引用（回未分类）。返回清除条数。"""
    data = load_readings(username)
    fid = str(folder_id or "")
    n = 0
    for t in data["texts"]:
        if isinstance(t, dict) and str(t.get("folder_id") or "") == fid:
            t["folder_id"] = None
            n += 1
    if n:
        save_readings(username, data)
    return n


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
    - lookup：找 selection + sentence 都相同的词查记录
      （词库/选项查词 sentence 为空串：同词二查直接命中，不再调模型）"""
    sel = str(selection or "").strip()
    sent = str(sentence or "").strip()
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
    [{selection, gloss, imported, ...}]，去重键=词小写+区域（q_num 编码：
    正文''/题号/bank:词键/opt:题号:选项键）——同词跨区域各自保留，同区域后查覆盖
    （与前端 addMark 口径一致）；imported 是词级事实，跨区域一起升级不降级。"""
    data = load_readings(username)
    rows = [l for l in data["lookups"]
            if isinstance(l, dict) and l.get("text_id") == text_id and l.get("mode") == "lookup"]
    imported_words = {str(l.get("selection") or "").strip().lower()
                      for l in rows if l.get("imported")}
    marks: dict[str, dict] = {}
    for l in rows:
        sel = str(l.get("selection") or "").strip()
        if not sel:
            continue
        res = l.get("result") or {}
        key = sel.lower() + "@" + str(l.get("q_num") or "")
        prev = marks.get(key)
        marks[key] = {
            "selection": sel,
            "head": str(l.get("head") or "").strip().lower(),
            "gloss": str(res.get("meaning") or "")[:200],
            "imported": bool(l.get("imported")) or (sel.lower() in imported_words) or bool(prev and prev.get("imported")),
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


# ==================== 站内作答：答案键 / 作答 / 判分 ====================

_ANSWER_RANGE_RE = re.compile(r"(\d{1,2})\s*[-–~]\s*(\d{1,2})\s*[:：]?\s*([A-Oa-o][\sA-Oa-o\-]*)")
_ANSWER_PAIR_RE = re.compile(r"(\d{1,2})\s*[\.\,:：\)）]?\s*([A-Oa-o])\b")


def parse_answer_key(raw) -> dict:
    """宽松解析标准答案 → {题号: 字母}。
    认三种格式：`36-45 FBAID` 连写、`36. F` / `36 F` 逐行、混排。
    解析不出任何一对时抛 ValueError（原样提示，不存半截答案）。"""
    text = str(raw or "").strip()
    if not text:
        raise ValueError("答案内容为空")
    key: dict[str, str] = {}

    # 连写区间：26-35 ABCDEFGHIJ
    def expand_range(m: re.Match) -> str:
        start, end = int(m.group(1)), int(m.group(2))
        letters = re.findall(r"[A-Oa-o]", m.group(3))
        if letters and 1 <= end - start + 1 <= 20:
            for i, ch in enumerate(letters[: end - start + 1]):
                key[str(start + i)] = ch.upper()
        return " "

    text2 = _ANSWER_RANGE_RE.sub(expand_range, text)
    for m in _ANSWER_PAIR_RE.finditer(text2):
        n = int(m.group(1))
        if 1 <= n <= 55:
            key[str(n)] = m.group(2).upper()

    if not key:
        raise ValueError("没认出任何「题号+字母」，请检查格式，如 36-45 FBAID 或逐行 36. F")
    return dict(sorted(key.items(), key=lambda kv: int(kv[0])))


def _find_text(data: dict, text_id: str) -> dict | None:
    for t in data["texts"]:
        if isinstance(t, dict) and t.get("id") == text_id:
            return t
    return None


def set_answer_key(username: str, text_id: str, key: dict, source: str) -> bool:
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return False
    t["answer_key"] = {str(k): str(v).upper()[:1] for k, v in key.items()}
    t["answer_key_source"] = "user" if source == "user" else "ai"
    save_readings(username, data)
    return True


def get_answer_state(username: str, text_id: str) -> dict:
    """作答状态总览：answer_key/source/answers/judged（无则空结构）。"""
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return {}
    return {
        "answer_key": t.get("answer_key") or {},
        "answer_key_source": str(t.get("answer_key_source") or ""),
        "answers": t.get("answers") or {},
        "judged": t.get("judged") or {},
        "revealed": t.get("revealed") or {},
    }


def save_answer(username: str, text_id: str, num: str, choice: str) -> tuple[bool, str]:
    """存单题选择。判对/已看答案的题拒绝（锁定）；判错的题允许重选
    （选词填空重试流：清判分态，等再次对答案）。返回 (ok, err)。"""
    num = str(num or "").strip()
    choice = str(choice or "").strip().upper()[:1]
    if not num.isdigit() or not choice:
        return False, "题号或选项不合法"
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return False, "未找到"
    if num in (t.get("judged") or {}):
        if (t.get("judged") or {})[num]:
            return False, "这题已对过答案，锁定不可改；点「重做」可清空"
        # 判错 → 解锁重选：清判分态
        (t.get("judged") or {}).pop(num, None)
    if num in (t.get("revealed") or {}):
        return False, "这题已查看过答案，锁定不可改；点「重做」可清空"
    t.setdefault("answers", {})[num] = choice
    save_readings(username, data)
    return True, ""


def reveal_answer(username: str, text_id: str, num: str) -> tuple[bool, str]:
    """主动查看正确答案：置 revealed 锁定，作答与判分态不动。"""
    num = str(num or "").strip()
    if not num.isdigit():
        return False, "题号不合法"
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return False, "未找到"
    if not (t.get("answer_key") or {}).get(num):
        return False, "还没有这题的标准答案"
    t.setdefault("revealed", {})[num] = True
    save_readings(username, data)
    return True, ""


def judge_answers(username: str, text_id: str, num: str = "", nums=None) -> dict | None:
    """判分：num/nums 指定只判这些题；都缺省判全部已作答题（未作答不判不锁）。
    返回 {题号: 对错bool}；无答案键或未找到返回 None。"""
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return None
    key = t.get("answer_key") or {}
    if not key:
        return None
    answers = t.get("answers") or {}
    judged = t.setdefault("judged", {})
    revealed = t.get("revealed") or {}
    if nums is not None:
        targets = [str(n) for n in nums]
    elif num:
        targets = [str(num)]
    else:
        targets = None
    if targets is not None:
        todo = [n for n in targets if n in answers and n in key and n not in revealed]
    else:
        todo = [n for n in answers if n in key and n not in revealed]
    result: dict[str, bool] = {}
    for n in todo:
        correct = str(answers.get(n) or "").upper() == str(key.get(n) or "").upper()
        judged[n] = correct
        result[n] = correct
    save_readings(username, data)
    return result


def reset_answers(username: str, text_id: str) -> bool:
    """重做：清空作答、判分态与已看答案（答案键保留）。"""
    data = load_readings(username)
    t = _find_text(data, text_id)
    if not t:
        return False
    t["answers"] = {}
    t["judged"] = {}
    t["revealed"] = {}
    save_readings(username, data)
    return True
