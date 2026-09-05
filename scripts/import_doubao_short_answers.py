# -*- coding: utf-8 -*-
"""从豆包整理的 MD（【红】标记）生成 Lykie 题库并写入指定用户。"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MD_PATH = ROOT / "给cursor看的图片" / "简答题截图" / "96道简答题识别结果.md"
OUT_JSON = ROOT / "给cursor看的图片" / "简答题截图" / "教资科二简答-题库.json"
OUT_CLEAN_MD = ROOT / "给cursor看的图片" / "简答题截图" / "教资科二简答-校对稿.md"

RED_RE = re.compile(r"【红】(.*?)【/红】", re.S)
BLOCK_RE = re.compile(
    r"##\s*第(\d+)题（文件名：([^）]+)）\s*(.*?)(?=\n##\s*第\d+题|\Z)",
    re.S,
)
STEM_RE = re.compile(r"\*\*题目：\*\*\s*(.+?)(?=\n\*\*答案：\*\*|\n\*\*章节：\*\*|\Z)", re.S)
# 章节可能在题目前后
CHAPTER_RE = re.compile(r"\*\*章节：\*\*\s*(.+)")
ANSWER_RE = re.compile(r"\*\*答案：\*\*\s*(.+?)\s*(?=\n---|\Z)", re.S)


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def new_bank_id() -> str:
    return uuid.uuid4().hex[:12]


def strip_red(text: str) -> tuple[str, list[str]]:
    keywords = [m.group(1).strip() for m in RED_RE.finditer(text) if m.group(1).strip()]
    plain = RED_RE.sub(r"\1", text)
    # 去重保序
    seen = set()
    uniq = []
    for k in keywords:
        if k not in seen:
            seen.add(k)
            uniq.append(k)
    return plain.strip(), uniq


def parse_points(answer_body: str) -> list[dict]:
    """按顶级 1. 2. 3. 拆点；子项 (1)(2) 留在同一点内。"""
    body, _ = strip_red(answer_body)  # 先不在这里抽红，整段再抽
    # 用带红标记的原文拆，再逐点去红
    raw = answer_body.strip()
    # 拆顶级编号行：行首或换行后的 1. / 1、
    parts = re.split(r"(?:^|\n)(?=\d{1,2}[.、．]\s*)", raw)
    points = []
    preamble_kw = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(\d{1,2})[.、．]\s*(.*)$", part, re.S)
        if not m:
            # 答案前导说明段落
            plain, kws = strip_red(part)
            if plain:
                preamble_kw.extend(kws)
                points.append(
                    {
                        "index": 0,
                        "text": plain,
                        "keywords": kws,
                        "is_preamble": True,
                    }
                )
            continue
        idx = int(m.group(1))
        plain, kws = strip_red(m.group(2).strip())
        points.append(
            {
                "index": idx,
                "text": plain,
                "keywords": kws,
                "is_preamble": False,
            }
        )
    return points


def format_answer(points: list[dict]) -> str:
    lines = []
    for p in points:
        if p.get("is_preamble"):
            lines.append(p["text"])
        else:
            lines.append(f"{p['index']}. {p['text']}")
    return "\n".join(lines)


def make_question(num: str, source: str, stem: str, chapter: str, answer_raw: str) -> dict:
    points = parse_points(answer_raw)
    answer = format_answer(points)
    all_kw = []
    seen = set()
    for p in points:
        for k in p.get("keywords") or []:
            if k not in seen:
                seen.add(k)
                all_kw.append(k)
    analysis = ""
    if all_kw:
        analysis = "关键词：" + "、".join(all_kw)
    if chapter:
        analysis = (f"章节：{chapter}" + ("；" + analysis if analysis else ""))

    q = {
        "id": num,
        "num": num,
        "type": "fill",
        "stem": stem.strip(),
        "options": [],
        "answer": answer,
        "analysis": analysis,
        "status": "active",
        "phase": "new",
        "interval": 0,
        "countdown": 0,
        "streak": 0,
        "answer_count": 0,
        "correct_count": 0,
        # 扩展字段：背题流程可后用；现有 UI 忽略即可
        "source_image": source.strip(),
        "chapter": chapter.strip(),
        "points": [
            {
                "index": p["index"],
                "text": p["text"],
                "keywords": p["keywords"],
                "is_preamble": p.get("is_preamble", False),
            }
            for p in points
        ],
        "keywords": all_kw,
    }
    return q


def parse_md(text: str) -> list[dict]:
    questions = []
    for m in BLOCK_RE.finditer(text):
        num, source, body = m.group(1), m.group(2), m.group(3)
        ch = ""
        cm = CHAPTER_RE.search(body)
        if cm:
            ch = cm.group(1).strip()
        sm = STEM_RE.search(body)
        am = ANSWER_RE.search(body)
        if not sm or not am:
            print("skip incomplete", num, source)
            continue
        stem = sm.group(1).strip()
        # 题目块里可能混入章节行
        stem = CHAPTER_RE.sub("", stem).strip()
        stem = re.sub(r"\n+", "", stem)
        answer_raw = am.group(1).strip()
        questions.append(make_question(num, source, stem, ch, answer_raw))
    return questions


def write_clean_md(questions: list[dict], path: Path) -> None:
    lines = [
        "# 教资科二简答（已去红字标记，关键词单独列出）",
        "",
        f"共 {len(questions)} 道。",
        "",
    ]
    for q in questions:
        lines.append(f"## {q['id']}. {q['stem']}")
        if q.get("chapter"):
            lines.append(f"章节：{q['chapter']}")
        if q.get("keywords"):
            lines.append(f"关键词：{'、'.join(q['keywords'])}")
        lines.append("")
        lines.append(q["answer"])
        lines.append("")
        lines.append("---")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def upsert_user_bank(username: str, bank_name: str, questions: list[dict]) -> Path:
    bank_path = ROOT / "data" / "users" / username / "bank.json"
    bank_path.parent.mkdir(parents=True, exist_ok=True)
    if bank_path.exists():
        data = json.loads(bank_path.read_text(encoding="utf-8"))
    else:
        data = {"banks": [], "current_bank_id": None}
    banks = data.setdefault("banks", [])
    # 同名则替换
    existing = next((b for b in banks if b.get("name") == bank_name), None)
    payload_q = []
    for q in questions:
        # 写入 bank 时保留扩展字段
        payload_q.append(dict(q))
    if existing:
        existing["questions"] = payload_q
        existing["imported_at"] = now_str()
        bid = existing["id"]
    else:
        bid = new_bank_id()
        banks.append(
            {
                "id": bid,
                "name": bank_name,
                "imported_at": now_str(),
                "questions": payload_q,
            }
        )
    data["current_bank_id"] = bid
    bank_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return bank_path


def main() -> None:
    text = MD_PATH.read_text(encoding="utf-8")
    questions = parse_md(text)
    print("parsed", len(questions))
    if len(questions) != 96:
        print("WARNING expected 96")

    bank_obj = {
        "name": "教资科二简答",
        "imported_at": now_str(),
        "count": len(questions),
        "questions": questions,
    }
    OUT_JSON.write_text(
        json.dumps(bank_obj, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_clean_md(questions, OUT_CLEAN_MD)

    for user in ("LiZF", "ZhangPT"):
        path = upsert_user_bank(user, "教资科二简答", questions)
        print("wrote bank", user, path)

    # 抽查
    q1 = questions[0]
    print("Q1 stem:", q1["stem"])
    print("Q1 keywords:", q1["keywords"][:8])
    print("Q1 answer head:", q1["answer"][:80].replace("\n", " | "))


if __name__ == "__main__":
    main()
