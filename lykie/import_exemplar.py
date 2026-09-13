# -*- coding: utf-8 -*-
"""样板切块：多题全文 → 单题块列表。

流水线：
  扫描（import_scan，滤噪声前）→ 噪声 → **本模块按样板切块** → 成题（import_rules）

本模块只学结构并切片。判断/填空/简答可各备样板；大题标题分段切。
"""
from __future__ import annotations

import re

from lykie import import_rules as rules
from lykie import import_scan as scan
from lykie.import_noise import filter_noise_lines, is_noise_line

BULLET_RE = re.compile(r"[\u2022\u2023\u2043\u25cf\u25cb\u25e6\u25aa\u00b7\u2219\u2027]")


def raw_lines(text: str) -> list[str]:
    text = BULLET_RE.sub("\n", text or "")
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def to_lines(text: str) -> list[str]:
    return filter_noise_lines(raw_lines(text))


def _section_looks_like_choice(lines: list[str]) -> bool:
    """假「填空题」标题下仍是单选时，用于回退选择样板。"""
    hits = 0
    for ln in lines or []:
        if rules.OPTION_INLINE_RE.match(ln) or rules.OPTION_LETTER_RE.match(ln):
            hits += 1
            if hits >= 2:
                return True
    return False


def _split_blocks_with_analysis(
    lines: list[str],
    answer_label: str,
    *,
    start_on_type_tag: bool,
    end_on_answer: bool = True,
) -> list[list[str]]:
    """切题块。默认答案行结束本块（答案后的解析行仍归本块）。

    end_on_answer=False：用于简答（答案后还有分点正文），仅靠题型微标/外层分段收束。
    """
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
        if start_on_type_tag and rules.is_type_tag_line(ln):
            flush()
            cur = [ln]
            continue

        if end_on_answer and after_answer:
            if rules.analysis_line_text(ln) is not None:
                cur.append(ln)
                continue
            flush()
            cur = [ln]
            if rules.answer_line_info(ln, answer_label) is not None:
                after_answer = True
            continue

        cur.append(ln)
        if end_on_answer and rules.answer_line_info(ln, answer_label) is not None:
            after_answer = True
            continue

    flush()
    return blocks


def split_blocks(
    lines: list[str],
    *,
    answer_label: str,
    has_type_tag: bool,
    has_num: bool,
    end_on_answer: bool = True,
) -> list[list[str]]:
    """按样板结构把行列表切成单题块。"""
    if not lines:
        return []

    if has_type_tag:
        return _split_blocks_with_analysis(
            lines,
            answer_label,
            start_on_type_tag=True,
            end_on_answer=end_on_answer,
        )

    if has_num:
        numbered = rules.split_numbered_blocks(lines)
        if numbered:
            return numbered

    return _split_blocks_with_analysis(
        lines,
        answer_label,
        start_on_type_tag=False,
        end_on_answer=end_on_answer,
    )


def split_sections(raw: list[str]) -> list[dict]:
    """按大题标题 / 段首微标分段。返回 [{kind, lines}]，lines 已滤噪声且不含标题行。"""
    sections: list[dict] = []
    cur_kind: str | None = None
    cur: list[str] = []

    def flush():
        nonlocal cur, cur_kind
        cleaned = filter_noise_lines(cur)
        if cleaned:
            sections.append({"kind": cur_kind or "unknown", "lines": cleaned})
        cur = []

    for ln in raw:
        head = scan.match_section_head(ln)
        if head:
            flush()
            cur_kind = head["kind"]
            continue
        # 段尚空时，题型微标也可开段
        if not cur and cur_kind is None:
            tag = scan.match_type_tag_kind(ln)
            if tag:
                cur_kind = tag["kind"]
                if not is_noise_line(ln):
                    cur.append(ln)
                continue
        if is_noise_line(ln) and scan.match_section_head(ln):
            continue
        if is_noise_line(ln):
            # 其它噪声仍丢；微标保留
            if rules.is_type_tag_line(ln):
                cur.append(ln)
            continue
        cur.append(ln)
    flush()
    return sections


def learn_structure(exemplar_text: str, *, expect_type: str = "choice") -> tuple[dict | None, str]:
    """从样板题学习切块结构。"""
    lines = to_lines(exemplar_text)
    if not lines:
        return None, f"请提供一道完整的样板{ {'choice':'单选','judge':'判断','fill':'填空','short_answer':'简答'}.get(expect_type, '') }题"

    label = rules.detect_answer_label(lines)
    option_style = rules.detect_option_style(lines)
    has_type_tag = any(rules.is_type_tag_line(ln) for ln in lines)
    has_num = any(rules.NUM_RE.match(ln) for ln in lines)

    if expect_type == "choice":
        q = rules.shape_choice_block(
            lines, option_style=option_style, answer_label=label, allow_multi=False
        )
        if not q:
            return None, (
                "样板未能识别为单选题。需要：题干、至少两个选项、"
                "以及标准答案行（如「答案：C」）。解析请另起一行写「解析：…」。"
            )
        if q.get("needs_answer_confirm"):
            return None, (
                "样板的答案行不是标准短答案。请改成单独一行「答案：C」（只有字母）。"
            )
    elif expect_type in ("judge", "fill"):
        q = rules.shape_non_choice_block(
            lines, answer_label=label, expect_type=expect_type
        )
        if not q:
            tip = "答案：对/错" if expect_type == "judge" else "答案：……（短文本）"
            return None, (
                f"样板未能识别为{'判断' if expect_type == 'judge' else '填空'}题。"
                f"需要题干与「{tip}」。"
            )
    elif expect_type == "short_answer":
        q = rules.shape_short_answer_block(lines, answer_label=label)
        if not q:
            return None, (
                "样板未能识别为简答题。需要题干，以及「答案：」行"
                "（可空，随后分点或正文）。"
            )
    else:
        return None, "未知样板题型"

    return {
        "expect_type": expect_type,
        "answer_label": label,
        "option_style": option_style,
        "has_type_tag": has_type_tag,
        "has_num": has_num,
        "option_count": len(q.get("options") or []),
        "stem_preview": (q["stem"][:40] + ("…" if len(q["stem"]) > 40 else "")),
        "question": q,
    }, ""


def _cut_with_learned(lines: list[str], learned: dict) -> tuple[list[dict], int]:
    label = learned["answer_label"]
    expect = learned.get("expect_type") or "choice"
    blocks = split_blocks(
        lines,
        answer_label=label,
        has_type_tag=bool(learned["has_type_tag"]),
        has_num=bool(learned["has_num"]),
        end_on_answer=(expect != "short_answer"),
    )
    choice_only = expect == "choice"
    questions, skipped = rules.shape_blocks(
        blocks,
        option_style=learned.get("option_style"),
        answer_label=label,
        choice_only=choice_only,
        expect_type=expect,
    )
    return questions, skipped


def _stem_key(stem: str) -> str:
    return re.sub(r"\s+", "", stem or "")[:80]


def _merge_questions(buckets: list[list[dict]]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for qs in buckets:
        for q in qs:
            key = _stem_key(q.get("stem") or "")
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            q = rules.attach_question_defaults(q, len(out) + 1)
            out.append(q)
    return out


def parse_by_exemplar(full_text: str, exemplar_text: str) -> tuple[list | None, str, dict]:
    """兼容旧接口：仅选择样板。"""
    return parse_by_exemplars(full_text, {"choice": exemplar_text})


def parse_by_exemplars(
    full_text: str,
    exemplars: dict[str, str],
) -> tuple[list | None, str, dict]:
    """多样板切块。

    exemplars keys: choice / judge / fill / short_answer（值为样板文本）。
    返回 (objective_questions|None, error, meta)；简答在 meta['sa_questions']。
    """
    raw = raw_lines(full_text)
    if not raw:
        return None, "题库文本为空", {}

    detected = scan.scan_types(raw)
    learned_map: dict[str, dict] = {}
    for kind, text in (exemplars or {}).items():
        t = (text or "").strip()
        if not t:
            continue
        learned, err = learn_structure(t, expect_type=kind)
        if err:
            return None, err, {"detected_types": detected}
        learned_map[kind] = learned

    if "choice" not in learned_map and not any(
        k in learned_map for k in ("judge", "fill", "short_answer")
    ):
        return None, "请至少提供一道样板题（选择 / 判断 / 填空 / 简答）", {
            "detected_types": detected,
        }

    sections = split_sections(raw)
    has_typed_sections = any(s.get("kind") in ("choice", "judge", "fill", "short_answer") for s in sections)

    obj_buckets: list[list[dict]] = []
    sa_questions: list[dict] = []
    skipped_total = 0

    def run_section(kind: str, lines: list[str]):
        nonlocal skipped_total
        if kind == "short_answer":
            learned = learned_map.get("short_answer")
            if not learned:
                return
            qs, skipped = _cut_with_learned(lines, learned)
            skipped_total += skipped
            sa_questions.extend(qs)
            return
        map_kind = "choice" if kind in ("choice", "unknown") else kind
        # unknown 段：尝试所有已给客观样板
        if kind == "unknown":
            for k in ("choice", "judge", "fill"):
                learned = learned_map.get(k)
                if not learned:
                    continue
                qs, skipped = _cut_with_learned(lines, learned)
                skipped_total += skipped
                if qs:
                    obj_buckets.append(qs)
            return
        learned = learned_map.get(map_kind)
        if not learned and map_kind in ("judge", "fill"):
            # 仅当该段其实像选择题时，才回退选择样板（假「填空题」标题）
            # 用户只选了选择样板、明确跳过填空/判断时，不得用选择样板硬切这些段
            if learned_map.get("choice") and _section_looks_like_choice(lines):
                learned = learned_map.get("choice")
            else:
                return
        if not learned and map_kind in ("choice", "unknown"):
            learned = learned_map.get("choice")
        if not learned:
            return
        qs, skipped = _cut_with_learned(lines, learned)
        skipped_total += skipped
        if qs:
            obj_buckets.append(qs)

    if has_typed_sections:
        for sec in sections:
            run_section(sec.get("kind") or "unknown", sec.get("lines") or [])
    else:
        # 无大题标题：各样板对全文各切一遍再合并
        full = to_lines(full_text)
        for kind, learned in learned_map.items():
            qs, skipped = _cut_with_learned(full, learned)
            skipped_total += skipped
            if kind == "short_answer":
                sa_questions.extend(qs)
            elif qs:
                obj_buckets.append(qs)

    # 简答题号重排
    sa_out = []
    for q in sa_questions:
        sa_out.append(rules.attach_question_defaults(q, len(sa_out) + 1))

    questions = _merge_questions(obj_buckets)
    needs_confirm_n = sum(1 for q in questions if q.get("needs_answer_confirm"))

    covered = set(learned_map.keys())
    uncovered = scan.uncovered_kinds(detected, covered)

    meta = {
        "detected_types": detected,
        "covered_types": sorted(covered),
        "uncovered_types": uncovered,
        "skipped_blocks": skipped_total,
        "needs_answer_confirm": needs_confirm_n,
        "mode": "exemplar_multi" if len(learned_map) > 1 else "exemplar_choice",
        "pipeline": "slice+shape",
        "sa_questions": sa_out,
        "sa_total": len(sa_out),
    }
    if learned_map.get("choice"):
        meta["answer_label"] = learned_map["choice"]["answer_label"]
        meta["exemplar_stem"] = learned_map["choice"]["stem_preview"]
        meta["option_style"] = learned_map["choice"]["option_style"]

    if not questions and not sa_out:
        return None, "按样板没有切出可用题目。请检查样板是否代表全文结构。", meta

    return questions, "", meta
