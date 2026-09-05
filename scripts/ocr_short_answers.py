# -*- coding: utf-8 -*-
"""Batch OCR 教资简答截图 → 可校对 JSON/Markdown（全文；红字留给人工标注）。"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytesseract
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMG_DIR = ROOT / "给cursor看的图片" / "简答题截图"
OUT_DIR = ROOT / "给cursor看的图片"
OUT_JSON = OUT_DIR / "简答题识别结果.json"
OUT_MD = OUT_DIR / "简答题识别结果.md"
OUT_IMPORT = OUT_DIR / "简答题导入文本.txt"

# UI 噪声行
NOISE_LINE = re.compile(
    r"^(换一个|默记|检测|记忆口诀|收藏|设置|下一|交一|"
    r"\d{1,2}:\d{2}|"
    r"[0-9]+%$|"
    r"[《»<>]|E\s*E)$"
)
CHAPTER_RE = re.compile(r"^第\s*\d+\s*章")
# 允许「1.备课」「1 备课」「4- 课外」
NUM_POINT_RE = re.compile(
    r"^(\d{1,2})\s*[.、．:：\-—)]\s*(.+)$|^(\d{1,2})\s+([\u4e00-\u9fff].*)$"
)
# 同一行粘连的下一要点：。……3 作业 / 。4.课外
GLUE_POINT_RE = re.compile(
    r"([。；;！？])\s*(\d{1,2})\s*[.、．:：\-—)]?\s*(?=[\u4e00-\u9fff])"
)


def collapse_cjk_spaces(text: str) -> str:
    """去掉汉字之间被 Tesseract 插入的空格，保留英文/数字旁空格。"""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(
            r"([\u4e00-\u9fff])\s+([\u4e00-\u9fff])",
            r"\1\2",
            text,
        )
        text = re.sub(
            r"([\u4e00-\u9fff])\s+([，。；：、！？）】》])",
            r"\1\2",
            text,
        )
        text = re.sub(
            r"([（【《])\s+([\u4e00-\u9fff])",
            r"\1\2",
            text,
        )
    # 数字与后接中文：1.备课 / 3作业 → 保留「数字.」形式
    text = re.sub(r"(\d)\s+([.、．:：])\s*", r"\1\2", text)
    text = re.sub(r"([.、．:：])\s+([\u4e00-\u9fff])", r"\1\2", text)
    return text


def crop_content(im: Image.Image) -> Image.Image:
    """去掉顶部状态栏/章节栏与底部操作按钮，减少噪声。"""
    w, h = im.size
    top = int(h * 0.14)
    bottom = int(h * 0.82)
    left = int(w * 0.04)
    right = int(w * 0.96)
    return im.crop((left, top, right, bottom))


def ocr_image(path: Path) -> str:
    im = crop_content(Image.open(path))
    raw = pytesseract.image_to_string(im, lang="chi_sim")
    return collapse_cjk_spaces(raw)


def expand_glued_points(line: str) -> list[str]:
    """把「……。3 作业……」拆成多行。"""
    if not GLUE_POINT_RE.search(line):
        return [line]
    parts = []
    last = 0
    for m in GLUE_POINT_RE.finditer(line):
        chunk = line[last : m.start() + 1].strip()
        if chunk:
            parts.append(chunk)
        last = m.start(2)
    tail = line[last:].strip()
    if tail:
        parts.append(tail)
    return parts or [line]


def clean_lines(text: str) -> list[str]:
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if "记忆口诀" in line:
            line = re.split(r"记忆口诀", line, 1)[0].strip()
            if not line:
                continue
        if NOISE_LINE.match(line):
            continue
        if CHAPTER_RE.match(line):
            continue
        # 状态栏 / 信号残渣
        if re.fullmatch(r"[0-9oOIl\s:．.%-@》》><「」\-—]+", line) and len(line) < 24:
            continue
        if re.match(r"^[z2>》@【\s]*国", line) and len(line) < 30 and "？" not in line:
            continue
        for piece in expand_glued_points(line):
            lines.append(piece)
    return lines


def match_point(line: str) -> tuple[int, str] | None:
    m = NUM_POINT_RE.match(line)
    if not m:
        return None
    if m.group(1) is not None:
        idx, body = int(m.group(1)), m.group(2)
    else:
        idx, body = int(m.group(3)), m.group(4)
    # 排除把时钟「22:xx」当要点（裁图后应很少）
    if idx > 20:
        return None
    return idx, body.strip()


def parse_qa(lines: list[str], source: str) -> dict:
    """尽量拆成题干 + 编号要点。"""
    points = []
    stem_parts = []
    mode = "stem"
    for line in lines:
        hit = match_point(line)
        if hit:
            mode = "points"
            idx, body = hit
            points.append({"index": idx, "text": body, "keywords": []})
            continue
        if mode == "stem":
            stem_parts.append(line)
        elif points:
            points[-1]["text"] = (points[-1]["text"] + line).strip()
        else:
            stem_parts.append(line)

    stem = "".join(stem_parts).strip()
    # 去掉题干前残留的 UI 碎片
    stem = re.sub(
        r"^.*?([\u4e00-\u9fff]{2,}.*?[？?])$",
        r"\1",
        stem,
    ) if ("？" in stem or "?" in stem) else stem
    for mark in ("？", "?"):
        if mark in stem:
            i = stem.index(mark)
            head = stem[: i + 1]
            # 取最后一个像题干的问句
            cjk = re.findall(r"[\u4e00-\u9fff].*" + re.escape(mark), head)
            if cjk:
                stem = cjk[-1]
            else:
                stem = head
            break

    # 要点按 index 排序（保持稳定）
    points.sort(key=lambda p: p["index"])

    return {
        "source": source,
        "stem": stem,
        "points": points,
        "keywords": [],
        "raw_lines": lines,
        "needs_review": (not stem)
        or (not points)
        or (len(points) == 1 and len(points[0]["text"]) > 120),
    }


def to_import_block(q: dict, num: int) -> str:
    """贴近现有粘贴导入习惯的纯文本块。"""
    parts = [f"{num}. {q['stem']}"]
    for p in q["points"]:
        parts.append(f"{p['index']}. {p['text']}")
    # 用要点拼接作「参考答案」，便于先进 fill；简答结构在 JSON 里
    answer = "；".join(f"{p['index']}.{p['text']}" for p in q["points"])
    if answer:
        parts.append(f"参考答案：{answer}")
    else:
        parts.append("参考答案：" + " ".join(q.get("raw_lines") or []))
    return "\n".join(parts)


def main() -> int:
    files = sorted(
        IMG_DIR.glob("*.jpg"),
        key=lambda p: int(p.stem) if p.stem.isdigit() else p.stem,
    )
    if not files:
        print("no images in", IMG_DIR, file=sys.stderr)
        return 1

    questions = []
    for i, path in enumerate(files, 1):
        print(f"[{i}/{len(files)}] {path.name}", flush=True)
        text = ocr_image(path)
        lines = clean_lines(text)
        q = parse_qa(lines, path.name)
        q["id"] = str(i)
        questions.append(q)

    payload = {
        "note": "全文 OCR；keywords / points[].keywords 留空，校验时标红字。",
        "count": len(questions),
        "needs_review_count": sum(1 for q in questions if q["needs_review"]),
        "questions": questions,
    }
    OUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    md = [
        "# 简答题 OCR 校对稿",
        "",
        f"共 {len(questions)} 道；标记 `needs_review` 的优先人工看。",
        "红字：在 JSON 的 `keywords` 或各 `points[].keywords` 里填写即可。",
        "",
    ]
    for q in questions:
        flag = " **[需复核]**" if q["needs_review"] else ""
        md.append(f"## {q['id']}. {q['source']}{flag}")
        md.append("")
        md.append(f"**题干：** {q['stem'] or '（空）'}")
        md.append("")
        if q["points"]:
            for p in q["points"]:
                md.append(f"{p['index']}. {p['text']}")
        else:
            md.append("（未拆出要点，原始行：）")
            for line in q["raw_lines"]:
                md.append(f"- {line}")
        md.append("")
        md.append("---")
        md.append("")
    OUT_MD.write_text("\n".join(md), encoding="utf-8")

    blocks = [to_import_block(q, i) for i, q in enumerate(questions, 1)]
    OUT_IMPORT.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")

    print("wrote", OUT_JSON)
    print("wrote", OUT_MD)
    print("wrote", OUT_IMPORT)
    print("needs_review", payload["needs_review_count"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
