# -*- coding: utf-8 -*-
"""从教资科二简答中抽出「分点明确、短答案」子集。"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "给cursor看的图片" / "简答题截图" / "教资科二简答-题库.json"
OUT_DIR = ROOT / "给cursor看的图片" / "简答题截图"
OUT_JSON = OUT_DIR / "教资科二简答-短题子集.json"
OUT_MD = OUT_DIR / "教资科二简答-短题子集.md"
OUT_SKIP = OUT_DIR / "教资科二简答-长题暂缓.md"


def point_texts(q: dict) -> list[str]:
    pts = q.get("points") or []
    return [(p.get("text") or "") for p in pts if not p.get("is_preamble")]


def is_nested(texts: list[str]) -> bool:
    for t in texts:
        if re.search(r"[（(]\s*[1-9]\s*[）)]", t):
            return True
        if re.search(r"(?:^|\n)\s*[①②③④⑤⑥⑦⑧⑨]", t):
            return True
        if t.count("（1）") + t.count("(1)") >= 1 and len(t) > 40:
            return True
    return False


def metrics(q: dict) -> dict:
    texts = point_texts(q)
    lengths = [len(re.sub(r"\s+", "", t)) for t in texts]
    n = len(texts)
    total = sum(lengths)
    maxlen = max(lengths) if lengths else 999
    avg = round(total / n, 1) if n else 999
    return {
        "n": n,
        "total": total,
        "maxlen": maxlen,
        "avg": avg,
        "nested": is_nested(texts),
        "has_preamble": any(p.get("is_preamble") for p in (q.get("points") or [])),
    }


def is_short(m: dict) -> bool:
    """典型短简答：类似「好课标准 / 特殊认识活动」——分点清、单点短词组级。"""
    if m["nested"] or m["has_preamble"]:
        return False
    if not (3 <= m["n"] <= 8):
        return False
    # 单点偏「目标明确」「间接性」；排除「直接经验与间接经验相结合」偏长条
    if m["maxlen"] > 18:
        return False
    if m["total"] > 80:
        return False
    if m["avg"] > 14:
        return False
    return True


def stable_id(q: dict) -> str:
    """以截图文件名为准（豆包 md 中「第N题」有重复编号）。"""
    src = (q.get("source_image") or "").strip()
    m = re.match(r"^(\d+)\.jpg$", src, re.I)
    return m.group(1) if m else str(q.get("id") or "")


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    questions = data["questions"]
    short, skipped = [], []
    for q in questions:
        m = metrics(q)
        q = {**q, "id": stable_id(q), "num": stable_id(q)}
        row = {**q, "_metrics": m}
        if is_short(m):
            short.append(row)
        else:
            skipped.append(row)

    short.sort(key=lambda x: int(x["id"]) if str(x["id"]).isdigit() else 0)

    # 导出子集（去掉 _metrics 写入题库形）
    export_q = []
    for q in short:
        item = {k: v for k, v in q.items() if k != "_metrics"}
        export_q.append(item)

    payload = {
        "name": "教资科二简答-短题",
        "note": "从96道中按规则自动抽出：3–8个分点、单点≤18字、总分≤80、均长≤14、无嵌套/前导长段；id=截图编号。供无脑背题试点。",
        "count": len(export_q),
        "source_total": len(questions),
        "questions": export_q,
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# 教资科二简答 · 短题子集（{len(export_q)} / {len(questions)}）",
        "",
        "筛选规则：分点 3–8；单点 ≤18 字；合计 ≤80；均长 ≤14；无嵌套子点、无前导长段；题号=截图编号。",
        "",
        "长题见同目录「长题暂缓」。",
        "",
    ]
    for q in short:
        m = q["_metrics"]
        lines.append(
            f"## {q['id']}. {q['stem']}  "
            f"<small>n={m['n']} max={m['maxlen']} tot={m['total']}</small>"
        )
        if q.get("keywords"):
            lines.append(f"关键词：{'、'.join(q['keywords'])}")
        lines.append("")
        lines.append(q.get("answer") or "")
        lines.append("")
        lines.append("---")
        lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    skip_lines = [
        f"# 长题 / 暂缓（{len(skipped)} 道）",
        "",
        "本批不做无脑短答试点。",
        "",
    ]
    for q in skipped:
        m = q["_metrics"]
        reasons = []
        if m["nested"]:
            reasons.append("嵌套分点")
        if m["has_preamble"]:
            reasons.append("有前导段")
        if m["n"] < 3:
            reasons.append(f"分点过少({m['n']})")
        if m["n"] > 8:
            reasons.append(f"分点过多({m['n']})")
        if m["maxlen"] > 30:
            reasons.append(f"单点过长({m['maxlen']})")
        if m["total"] > 120:
            reasons.append(f"总长({m['total']})")
        if m["avg"] > 22:
            reasons.append(f"均长({m['avg']})")
        skip_lines.append(
            f"- **{q['id']}. {q['stem']}** — {', '.join(reasons) or '未归入短题'}; "
            f"n={m['n']} max={m['maxlen']} tot={m['total']}"
        )
    OUT_SKIP.write_text("\n".join(skip_lines), encoding="utf-8")

    print("short", len(export_q))
    print("skipped", len(skipped))
    print("wrote", OUT_MD)
    for q in short:
        m = q["_metrics"]
        print(f"{q['id']}\t{m['n']}\t{m['maxlen']}\t{m['total']}\t{q['stem']}")


if __name__ == "__main__":
    main()
