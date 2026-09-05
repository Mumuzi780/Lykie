# -*- coding: utf-8 -*-
"""短简答无脑训练：热身多选 → 挖空关键词 → 无提示写。"""
from __future__ import annotations

import json
import math
import os
import random
import re
import uuid
from collections import Counter
from datetime import date, datetime, timedelta

from lykie import accounts as lykie_accounts

BANK_NAME = "教资科二简答-短题"
PAIR_SIZE = 2
REVIEW_BATCH_SIZE = 2  # 每批最多抽几道复习；刷完一组学习题后再开下一批
ABSURD_POOL = [
    "石头", "云朵", "大学生", "小学生", "蜜雪冰城", "麻辣烫", "咖啡",
    "自行车", "雨伞", "筷子", "电梯", "快递", "地铁", "西瓜",
    "图书馆", "插座", "耳机", "口罩", "充电宝", "便利店",
    "食堂", "闹钟", "草稿纸", "白板笔", "校园卡",
]

STAGES = (
    "warmup", "cloze", "half_cloze", "stem_pick", "free_write",
    "done", "review_free", "review_cloze",
)

# 复习间隔（天）：首次完成 → +1；连续轻测过关 → 2、4、7、14
REVIEW_INTERVALS_DAYS = (1, 2, 4, 7, 14)

# 挖空默认按位有序；题字段 cloze_unordered=true / UNORDERED_CLOZE_IDS 整组无序。
# 另：相同左右文架的空自动成一组无序（如多个「认识的____」）。
UNORDERED_CLOZE_IDS = {"6"}  # 教学原则：并列原则名，可打乱


def cloze_is_unordered(q: dict) -> bool:
    if q.get("cloze_unordered") is True:
        return True
    if q.get("cloze_unordered") is False:
        return False
    qid = str(q.get("id") or q.get("num") or "")
    return qid in UNORDERED_CLOZE_IDS


def cloze_blank_contexts(parts: list[dict]) -> list[tuple[str, str]]:
    """每个空在本行中的 (左侧固定文字, 右侧固定文字)。"""
    out = []
    for line in parts or []:
        segs = line.get("segs") or []
        for i, seg in enumerate(segs):
            if seg.get("type") != "blank":
                continue
            left = "".join(
                (s.get("text") or "") for s in segs[:i] if s.get("type") == "text"
            )
            right = "".join(
                (s.get("text") or "") for s in segs[i + 1 :] if s.get("type") == "text"
            )
            out.append((left.strip(), right.strip()))
    return out


def cloze_unordered_groups(
    q: dict,
    answers: list[str],
    parts: list[dict] | None = None,
) -> list[list[int]]:
    """
    无序组：
    - 整题 opt-in → 全部空一组；
    - 否则按相同左右文架自动成组（≥2 才无序）。
    """
    n = len(answers or [])
    if n < 2:
        return []
    if cloze_is_unordered(q):
        return [list(range(n))]
    if not parts:
        return []
    contexts = cloze_blank_contexts(parts)
    if len(contexts) != n:
        return []
    buckets: dict[tuple[str, str], list[int]] = {}
    for i, ctx in enumerate(contexts):
        buckets.setdefault(ctx, []).append(i)
    return [idxs for idxs in buckets.values() if len(idxs) >= 2]


# 特例：挖空阶段改为左右连线（不做填空）；连线后再走半边挖空
MATCH_CLOZE_IDS = {"2"}  # 一堂好课的标准


def uses_match_cloze(q: dict) -> bool:
    return str(q.get("id") or q.get("num") or "") in MATCH_CLOZE_IDS


def uses_half_cloze(q: dict) -> bool:
    """连线题在连线成功后进入半边挖空（展示词尾、默词头）。"""
    return uses_match_cloze(q)


def build_match_pairs(q: dict) -> list[tuple[str, str]]:
    """从要点拆成 (左关键词, 右剩余)。优先用 keywords 匹配前缀。"""
    kws = sorted(keywords_of(q), key=len, reverse=True)
    pairs = []
    for p in q.get("points") or []:
        if p.get("is_preamble"):
            continue
        text = (p.get("text") or "").strip().rstrip("。.;；、")
        if not text:
            continue
        left = None
        right = None
        for kw in kws:
            if text.startswith(kw) and len(text) > len(kw):
                left, right = kw, text[len(kw) :]
                break
        if left is None:
            # 退化为前半/后半各半（少见）
            mid = max(1, len(text) // 2)
            left, right = text[:mid], text[mid:]
        pairs.append((left, right))
    return pairs


def build_match_card(q: dict) -> dict:
    pairs = build_match_pairs(q)
    lefts = [a for a, _ in pairs]
    rights = [b for _, b in pairs]
    left_opts = [{"id": uuid.uuid4().hex[:8], "text": t} for t in lefts]
    right_opts = [{"id": uuid.uuid4().hex[:8], "text": t} for t in rights]
    random.shuffle(left_opts)
    random.shuffle(right_opts)
    answer_map = {a: b for a, b in pairs}
    return {
        "kind": "match",
        "stem": q.get("stem") or "",
        "prompt": "将左侧与右侧正确搭配（两边均已打乱）。须一次全部连对；连不全会显示正确答案并换题，下次仍练连线。",
        "left": left_opts,
        "right": right_opts,
        "_answer_map": answer_map,
    }


def build_half_cloze_card(q: dict, blank_side: str = "left") -> dict:
    """
    半边挖空：展示连线的一边，默另一边。
    默认 blank_side=left：展示词尾、挖词头（____明确），便于先找回词头骨架。
    """
    pairs = build_match_pairs(q)
    random.shuffle(pairs)
    blanks = []
    parts = []
    for i, (left, right) in enumerate(pairs, 1):
        if blank_side == "right":
            blanks.append(right)
            segs = [
                {"type": "text", "text": left},
                {"type": "blank", "blank_index": len(blanks) - 1},
            ]
        else:
            blanks.append(left)
            segs = [
                {"type": "blank", "blank_index": len(blanks) - 1},
                {"type": "text", "text": right},
            ]
        parts.append({"prefix": f"{i}. ", "segs": segs})
    side_hint = "词头" if blank_side != "right" else "词尾"
    shown = "词尾" if blank_side != "right" else "词头"
    return {
        "kind": "half_cloze",
        "stem": q.get("stem") or "",
        "prompt": (
            f"半边挖空：已给出{shown}，请填出对应{side_hint}。"
            "须一次全部填对；填不全会给提示并换题（与组内其他题交替），下次仍练本阶段。"
        ),
        "parts": parts,
        "blank_count": len(blanks),
        "answers": blanks,
        "unordered_groups": [],
    }


def build_stem_pick_card(q: dict, bank_questions: list) -> dict:
    """给出完整答案，二选一题干；干扰项从题库其它原题干抽取（可同组）。"""
    correct = (q.get("stem") or "").strip()
    qid = str(q.get("id") or "")
    others = []
    for other in bank_questions or []:
        oid = str(other.get("id") or "")
        if oid == qid:
            continue
        stem = (other.get("stem") or "").strip()
        if stem and stem != correct:
            others.append({"id": oid, "text": stem})
    if not others:
        # 极端：题库只有一题时造一个离谱干扰
        others = [{"id": "_absurd", "text": "下列哪项属于蜜雪冰城新品研发原则？"}]
    distractor = random.choice(others)
    options = [
        {"id": "correct", "text": correct, "correct": True},
        {"id": distractor["id"], "text": distractor["text"], "correct": False},
    ]
    random.shuffle(options)
    return {
        "kind": "stem_pick",
        "stem_label": "请选择与下列答案对应的题干",
        "answer_text": q.get("answer") or "",
        "prompt": "答案已给出，选出正确的题干（二选一）。选错会提示并换题，下次仍练本阶段。",
        "options": [{"id": o["id"], "text": o["text"]} for o in options],
        "_correct_id": next(o["id"] for o in options if o["correct"]),
    }


def grade_match(answer_map: dict, links: list) -> dict:
    """links: [{left_text, right_text}, ...]"""
    expected = dict(answer_map or {})
    used_left = set()
    used_right = set()
    details = []
    ok_count = 0
    for link in links or []:
        lt = str((link or {}).get("left_text") or "").strip()
        rt = str((link or {}).get("right_text") or "").strip()
        good = (
            lt in expected
            and expected.get(lt) == rt
            and lt not in used_left
            and rt not in used_right
        )
        if good:
            ok_count += 1
            used_left.add(lt)
            used_right.add(rt)
        details.append({"left": lt, "right": rt, "ok": good})
    all_ok = ok_count == len(expected) and len(links or []) == len(expected)
    hint_pairs = [{"left": a, "right": b} for a, b in expected.items()]
    random.shuffle(hint_pairs)
    return {
        "all_ok": all_ok,
        "details": details,
        "hint_pairs": hint_pairs,
        "ok_count": ok_count,
        "need": len(expected),
    }


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def today_str() -> str:
    return date.today().isoformat()


def add_days_iso(day: str, n: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=int(n))).isoformat()


def progress_path(username: str) -> str:
    return os.path.join(lykie_accounts.user_dir(username), "sa_progress.json")


def load_progress(username: str) -> dict:
    path = progress_path(username)
    empty = {
        "cursor": 0,
        "items": {},
        "active_pair": [],
        "pair_turn": 0,
        "review_quota": REVIEW_BATCH_SIZE,
        "need_learn_gate": False,
        "updated_at": now_str(),
    }
    if not os.path.exists(path):
        return dict(empty)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return dict(empty)
    if not isinstance(data, dict):
        return dict(empty)
    data.setdefault("cursor", 0)
    data.setdefault("items", {})
    data.setdefault("active_pair", [])
    data.setdefault("pair_turn", 0)
    data.setdefault("review_quota", REVIEW_BATCH_SIZE)
    data.setdefault("need_learn_gate", False)
    return data


def save_progress(username: str, data: dict) -> None:
    path = progress_path(username)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data["updated_at"] = now_str()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def split_round_sizes(n: int) -> list[int]:
    """一轮 2～3 个；能均分则均分，余数放最后。例：7→2+2+3。"""
    if n <= 0:
        return []
    if n <= 3:
        return [n]
    rounds = math.ceil(n / 3)
    base, rem = divmod(n, rounds)
    sizes = [base] * rounds
    for i in range(rem):
        sizes[-(i + 1)] += 1
    # 兜底：避免出现 1（理论上 ceil(n/3) 不会）
    fixed = []
    carry = 0
    for s in sizes:
        s += carry
        carry = 0
        if s == 1 and fixed:
            fixed[-1] += 1
        else:
            fixed.append(s)
    return fixed


def is_sa_bank(bank: dict | None) -> bool:
    """题库是否为简答训练库（与客观斩题隔离）。"""
    if not bank:
        return False
    mode = bank.get("mode") or bank.get("kind")
    if mode in ("short_answer", "sa"):
        return True
    if mode in ("objective", "kill"):
        return False
    if bank.get("name") == BANK_NAME:
        return True
    qs = bank.get("questions") or []
    if not qs:
        return False
    return all(q.get("type") == "short_answer" for q in qs)


def ensure_bank_modes(banks: list) -> bool:
    """补全 bank.mode；有改动返回 True（调用方决定是否 save）。"""
    changed = False
    for b in banks or []:
        if b.get("mode") in ("short_answer", "objective"):
            continue
        if is_sa_bank(b):
            b["mode"] = "short_answer"
            changed = True
        else:
            b["mode"] = "objective"
            changed = True
    return changed


def find_short_bank(store) -> dict | None:
    """优先当前选中的简答库，否则按名称/mode 回退。"""
    cur = store.current_bank() if hasattr(store, "current_bank") else None
    if is_sa_bank(cur):
        return cur
    for b in store.banks:
        if b.get("mode") == "short_answer" or b.get("name") == BANK_NAME:
            return b
    return next((b for b in store.banks if is_sa_bank(b)), None)


def keyword_variants(kw: str) -> list[str]:
    """同一关键词的书写变体（与/和互通），长变体优先。"""
    if not kw:
        return []
    alts = {kw}
    if "与" in kw:
        alts.add(kw.replace("与", "和"))
    if "和" in kw:
        alts.add(kw.replace("和", "与"))
    return sorted(alts, key=len, reverse=True)


def keyword_matches_text(kw: str, text: str) -> bool:
    """关键词是否出现在文本中；「与」「和」互通。"""
    if not kw:
        return False
    t = text or ""
    return any(v in t for v in keyword_variants(kw))


def find_keyword_hit(remaining: str, ordered_kws: list[str]) -> tuple[str, str, int] | None:
    """在 remaining 中找最早出现的关键词。返回 (标准关键词, 命中原文片段, 位置)。"""
    best = None  # (pos, -len_span, canonical, span)
    for kw in ordered_kws:
        for span in keyword_variants(kw):
            pos = remaining.find(span)
            if pos < 0:
                continue
            cand = (pos, -len(span), kw, span)
            if best is None or cand < best:
                best = cand
    if best is None:
        return None
    return best[2], best[3], best[0]


def answers_equivalent(expected: str, got: str) -> bool:
    a = (expected or "").strip()
    b = (got or "").strip()
    if a == b:
        return True
    if not a or not b:
        return False
    return a.replace("与", "和") == b.replace("与", "和")


def apply_keywords_to_question(q: dict, keywords: list[str]) -> None:
    """写入 keywords，并尽量挂到各 point；同步 analysis 中的关键词行。"""
    kws = [str(k).strip() for k in (keywords or []) if str(k).strip()]
    seen = set()
    uniq = []
    for k in kws:
        if k not in seen:
            seen.add(k)
            uniq.append(k)
    q["keywords"] = uniq
    for p in q.get("points") or []:
        text = p.get("text") or ""
        matched = [k for k in uniq if keyword_matches_text(k, text)]
        matched.sort(key=len, reverse=True)
        p["keywords"] = matched
    old = str(q.get("analysis") or "")
    kept = []
    for chunk in old.replace("；", "\n").splitlines():
        c = chunk.strip()
        if not c or c.startswith("关键词"):
            continue
        kept.append(c)
    kw_line = ("关键词：" + "、".join(uniq)) if uniq else ""
    if kept and kw_line:
        q["analysis"] = "；".join(kept + [kw_line])
    elif kw_line:
        q["analysis"] = kw_line
    elif kept:
        q["analysis"] = "；".join(kept)


def apply_point_keywords(
    q: dict,
    point_keywords: list[dict],
    *,
    cloze_unordered: bool | None = None,
) -> None:
    """
    按分点写入关键词。
    point_keywords: [{ "index": 1, "keywords": ["直观性"] | "直观性、…" }, ...]
    """
    by_idx = {}
    for row in point_keywords or []:
        try:
            idx = int(row.get("index"))
        except (TypeError, ValueError):
            continue
        raw = row.get("keywords")
        if isinstance(raw, str):
            kws = parse_keywords_input(raw)
        else:
            kws = [str(x).strip() for x in (raw or []) if str(x).strip()]
        by_idx[idx] = kws

    all_kws = []
    seen = set()
    for p in q.get("points") or []:
        if p.get("is_preamble"):
            continue
        try:
            idx = int(p.get("index"))
        except (TypeError, ValueError):
            idx = None
        if idx is not None and idx in by_idx:
            p["keywords"] = by_idx[idx]
        else:
            p.setdefault("keywords", p.get("keywords") or [])
        for k in p.get("keywords") or []:
            k = str(k).strip()
            if k and k not in seen:
                seen.add(k)
                all_kws.append(k)

    q["keywords"] = all_kws
    if cloze_unordered is not None:
        q["cloze_unordered"] = bool(cloze_unordered)

    old = str(q.get("analysis") or "")
    kept = []
    for chunk in old.replace("；", "\n").splitlines():
        c = chunk.strip()
        if not c or c.startswith("关键词"):
            continue
        kept.append(c)
    kw_line = ("关键词：" + "、".join(all_kws)) if all_kws else ""
    if kept and kw_line:
        q["analysis"] = "；".join(kept + [kw_line])
    elif kw_line:
        q["analysis"] = kw_line
    elif kept:
        q["analysis"] = "；".join(kept)


def points_editor_payload(q: dict) -> list[dict]:
    """编辑器用：完整分点 + 当前关键词。"""
    out = []
    for p in q.get("points") or []:
        if p.get("is_preamble"):
            continue
        text = (p.get("text") or "").strip()
        kws = [str(k).strip() for k in (p.get("keywords") or []) if str(k).strip()]
        if not kws:
            # 从题级关键词里推断挂接
            kws = [k for k in keywords_of(q) if keyword_matches_text(k, text)]
            kws.sort(key=len, reverse=True)
        out.append({
            "index": p.get("index"),
            "text": text,
            "keywords": kws,
        })
    return out


def parse_keywords_input(text: str) -> list[str]:
    """支持顿号/逗号/换行分隔。"""
    raw = str(text or "").replace("，", "、").replace(",", "、").replace("\n", "、")
    return [x.strip() for x in raw.split("、") if x.strip()]


def keywords_of(q: dict) -> list[str]:
    kws = [str(k).strip() for k in (q.get("keywords") or []) if str(k).strip()]
    if kws:
        return kws
    return points_of(q)


def points_of(q: dict) -> list[str]:
    """热身多选用完整小点文本（非仅关键词）。"""
    out = []
    for p in q.get("points") or []:
        if p.get("is_preamble"):
            continue
        text = (p.get("text") or "").strip()
        text = text.rstrip("。.;；、")
        if text:
            out.append(text)
    return out


def is_learning_stage(stage: str) -> bool:
    return stage in ("warmup", "cloze", "half_cloze", "stem_pick", "free_write")


def is_review_stage(stage: str) -> bool:
    return stage in ("review_free", "review_cloze")


def is_review_due(item: dict, today: str | None = None) -> bool:
    """已完成且到期（含无 due_date 的旧完成题，视为今天到期）。"""
    if (item.get("stage") or "") != "done":
        return False
    today = today or today_str()
    due = item.get("due_date")
    if not due:
        return True
    try:
        return str(due)[:10] <= today
    except (TypeError, ValueError):
        return True


def schedule_after_learning_done(item: dict) -> None:
    """学习车道首次完成 → 进入复习池，明天到期。"""
    item["stage"] = "done"
    item["srs_level"] = 0
    item["due_date"] = add_days_iso(today_str(), REVIEW_INTERVALS_DAYS[0])
    item["lane"] = "review"
    for key in ("pending_warmup", "pending_cloze", "pending_match", "pending_stem"):
        item.pop(key, None)


def schedule_after_review_pass(item: dict) -> None:
    """复习默写过关 → 拉长间隔。"""
    level = int(item.get("srs_level") or 0) + 1
    level = min(level, len(REVIEW_INTERVALS_DAYS) - 1)
    item["srs_level"] = level
    item["stage"] = "done"
    item["due_date"] = add_days_iso(today_str(), REVIEW_INTERVALS_DAYS[level])
    item["lane"] = "review"
    for key in ("pending_warmup", "pending_cloze", "pending_match", "pending_stem"):
        item.pop(key, None)


def schedule_after_review_cloze_pass(item: dict) -> None:
    """复习挖空过关（借了脚手架）→ 明天再轻测，等级不升。"""
    level = int(item.get("srs_level") or 0)
    item["srs_level"] = level
    item["stage"] = "done"
    item["due_date"] = add_days_iso(today_str(), 1)
    item["lane"] = "review"
    for key in ("pending_warmup", "pending_cloze", "pending_match", "pending_stem"):
        item.pop(key, None)


def demote_review_to_cloze(item: dict) -> None:
    item["stage"] = "review_cloze"
    item.pop("pending_cloze", None)
    item.pop("pending_match", None)


def demote_review_to_learning(item: dict) -> None:
    """复习挖空仍过不了 → 退回学习车道特色阶段。"""
    item["stage"] = "cloze"
    item["due_date"] = None
    item["lane"] = "learning"
    item["srs_level"] = max(0, int(item.get("srs_level") or 0) - 1)
    for key in ("pending_warmup", "pending_cloze", "pending_match", "pending_stem"):
        item.pop(key, None)


def count_progress(progress: dict, qs: list) -> dict:
    """状态栏统计。"""
    today = today_str()
    learning = 0
    review_due = 0
    review_waiting = 0
    review_active = 0
    stages = {s: 0 for s in STAGES}
    for q in qs:
        item = ensure_item(progress, str(q.get("id")), q)
        st = item.get("stage") or "warmup"
        stages[st] = stages.get(st, 0) + 1
        if is_review_stage(st):
            review_active += 1
        elif st == "done":
            if is_review_due(item, today):
                review_due += 1
            else:
                review_waiting += 1
        elif is_learning_stage(st):
            learning += 1
    return {
        "stages": stages,
        "learning": learning,
        "review_due": review_due,
        "review_waiting": review_waiting,
        "review_active": review_active,
    }


def select_next_question(progress: dict, qs: list) -> dict | None:
    """
    复习与学习穿插：
    - 每批最多 REVIEW_BATCH_SIZE 道到期复习；
    - 批满后须刷完一组学习题（active_pair 两题都离开学习车道），再开下一批复习；
    - 进行中的复习题 / 未完成学习组优先续做；
    - 已无学习题时，不再卡复习批次。
    """
    if not qs:
        return None
    qmap = {str(q.get("id")): q for q in qs}
    ordered_ids = [str(q.get("id")) for q in qs]
    today = today_str()
    progress.setdefault("review_quota", REVIEW_BATCH_SIZE)
    progress.setdefault("need_learn_gate", False)

    def item_of(qid: str) -> dict:
        return ensure_item(progress, qid, qmap[qid])

    def stage_of(qid: str) -> str:
        return item_of(qid).get("stage") or "warmup"

    def still_learning(qid: str) -> bool:
        return is_learning_stage(stage_of(qid))

    learning_left = any(still_learning(qid) for qid in ordered_ids if qid in qmap)

    # 上一组学习已刷完 → 解锁下一批复习名额
    pair = [qid for qid in (progress.get("active_pair") or []) if qid in qmap]
    incomplete_in_pair = [qid for qid in pair if still_learning(qid)]
    if pair and not incomplete_in_pair:
        progress["need_learn_gate"] = False
        progress["review_quota"] = REVIEW_BATCH_SIZE
        progress["active_pair"] = []
        progress["pair_turn"] = 0
        pair = []
        incomplete_in_pair = []

    # 1) 进行中的复习题续做（不占用新批次名额）
    for qid in ordered_ids:
        if qid not in qmap:
            continue
        if is_review_stage(stage_of(qid)):
            return qmap[qid]

    # 2) 未完成的学习组继续刷（批次中间不插新复习）
    if incomplete_in_pair:
        turn = int(progress.get("pair_turn") or 0)
        n = len(pair)
        for step in range(n):
            idx = (turn + step) % n
            qid = pair[idx]
            if not still_learning(qid):
                continue
            progress["pair_turn"] = (idx + 1) % n
            return qmap[qid]

    # 3) 开启到期复习（受批次名额限制）
    due_ids = [
        qid for qid in ordered_ids
        if qid in qmap and is_review_due(item_of(qid), today)
    ]
    quota = int(progress.get("review_quota") or 0)
    gate = bool(progress.get("need_learn_gate"))
    allow_new_review = bool(due_ids) and (
        (not learning_left) or (quota > 0 and not gate)
    )
    if allow_new_review:
        qid = due_ids[0]
        item = item_of(qid)
        item["stage"] = "review_free"
        item["lane"] = "review"
        if learning_left:
            progress["review_quota"] = max(0, quota - 1)
            if progress["review_quota"] <= 0:
                progress["need_learn_gate"] = True
        progress["active_pair"] = []
        return qmap[qid]

    # 4) 开新学习组
    new_pair = []
    for qid in ordered_ids:
        if still_learning(qid):
            new_pair.append(qid)
            if len(new_pair) >= PAIR_SIZE:
                break
    if not new_pair:
        progress["active_pair"] = []
        return None
    progress["active_pair"] = new_pair
    progress["pair_turn"] = 0
    # 从组内第一题开始
    progress["pair_turn"] = 1 % len(new_pair)
    return qmap[new_pair[0]]


def ensure_item(progress: dict, qid: str, q: dict) -> dict:
    items = progress.setdefault("items", {})
    item = items.get(qid)
    pts = points_of(q)
    n = len(pts)
    if not item:
        item = {
            "stage": "warmup",
            "warmup_sizes": split_round_sizes(n),
            "warmup_round": 0,
            "warmup_covered": [],
            "free_last_hits": 0,
            "srs_level": 0,
            "due_date": None,
            "lane": "learning",
        }
        items[qid] = item
    else:
        item.setdefault("stage", "warmup")
        item.setdefault("warmup_round", 0)
        item.setdefault("warmup_covered", [])
        item.setdefault("free_last_hits", 0)
        item.setdefault("srs_level", 0)
        item.setdefault("due_date", None)
        item.setdefault("lane", "learning")
        sizes = item.get("warmup_sizes")
        if not sizes or sum(sizes) != n:
            item["warmup_sizes"] = split_round_sizes(n)
            if item.get("stage") == "warmup":
                covered = [i for i in (item.get("warmup_covered") or []) if isinstance(i, int) and 0 <= i < n]
                item["warmup_covered"] = covered
                item["warmup_round"] = min(int(item.get("warmup_round") or 0), len(item["warmup_sizes"]))
        # 旧进度：已完成但无到期日 → 今天可复习
        if (item.get("stage") or "") == "done" and not item.get("due_date"):
            item["due_date"] = today_str()
            item["lane"] = "review"
    return item


def build_cloze(q: dict) -> dict:
    """按关键词挖空；返回展示片段与标准答案列表。"""
    kws = keywords_of(q)
    # 长词优先，避免短词先挖坏长词
    ordered = sorted(kws, key=len, reverse=True)
    blanks = []
    parts = []
    for p in q.get("points") or []:
        if p.get("is_preamble"):
            continue
        text = (p.get("text") or "").strip()
        idx = p.get("index")
        prefix = f"{idx}. " if idx else ""
        remaining = text
        segs = []
        while remaining:
            hit = find_keyword_hit(remaining, ordered)
            if hit is None:
                segs.append({"type": "text", "text": remaining})
                break
            canonical, span, hit_pos = hit
            if hit_pos > 0:
                segs.append({"type": "text", "text": remaining[:hit_pos]})
            blanks.append(canonical)
            segs.append({"type": "blank", "blank_index": len(blanks) - 1})
            remaining = remaining[hit_pos + len(span) :]
        parts.append({"prefix": prefix, "segs": segs})
    return {
        "parts": parts,
        "answers": blanks,
        "unordered_groups": cloze_unordered_groups(q, blanks, parts),
    }


def grade_cloze(answers: list[str], blanks: list[str], unordered_groups: list | None = None) -> dict:
    """判挖空。unordered_groups 内下标之间只要求答案集合一致（可打乱）。"""
    n = len(answers)
    details = [{"index": i, "ok": False, "expected": answers[i], "got": blanks[i] if i < len(blanks) else ""} for i in range(n)]
    if len(blanks) != n:
        return {"all_ok": False, "details": details, "hints": list(answers)}

    unordered_indices = set()
    for group in unordered_groups or []:
        unordered_indices.update(group)

    # 先判有序空
    for i in range(n):
        if i in unordered_indices:
            continue
        details[i]["ok"] = answers_equivalent(answers[i], blanks[i])

    # 无序组：多重集合匹配（与/和 归一后比较）
    def norm(s: str) -> str:
        return (s or "").strip().replace("与", "和")

    for group in unordered_groups or []:
        idxs = [i for i in group if 0 <= i < n]
        expected = [answers[i] for i in idxs]
        got = [blanks[i] for i in idxs]
        ok_bag = Counter(norm(x) for x in expected) == Counter(norm(x) for x in got)
        if ok_bag:
            for i in idxs:
                details[i]["ok"] = True
                details[i]["expected"] = "(无序)" + "/".join(expected)
        else:
            pool = Counter(norm(x) for x in expected)
            for i in idxs:
                g = blanks[i]
                key = norm(g)
                if g and pool[key] > 0:
                    details[i]["ok"] = True
                    pool[key] -= 1
                else:
                    details[i]["ok"] = False
                    details[i]["expected"] = "无序：" + " / ".join(expected)

    all_ok = all(d["ok"] for d in details)
    hints = [""] * n
    if not all_ok:
        for i in range(n):
            if i not in unordered_indices and not details[i]["ok"]:
                hints[i] = answers[i]
        for group in unordered_groups or []:
            idxs = [i for i in group if 0 <= i < n]
            wrong_idxs = [i for i in idxs if not details[i]["ok"]]
            got_ok = Counter()
            for i in idxs:
                if details[i]["ok"]:
                    got_ok[norm(blanks[i])] += 1
            remaining_answers = []
            for a in (answers[i] for i in idxs):
                k = norm(a)
                if got_ok[k] > 0:
                    got_ok[k] -= 1
                else:
                    remaining_answers.append(a)
            random.shuffle(remaining_answers)
            for i, text in zip(wrong_idxs, remaining_answers):
                hints[i] = text
            if len(wrong_idxs) > len(remaining_answers):
                extra = [answers[i] for i in idxs]
                random.shuffle(extra)
                for j, i in enumerate(wrong_idxs[len(remaining_answers) :]):
                    hints[i] = extra[j % len(extra)]

    return {"all_ok": all_ok, "details": details, "hints": hints}


def hit_keywords(text: str, kws: list[str]) -> list[str]:
    t = text or ""
    hits = []
    for kw in kws:
        if keyword_matches_text(kw, t):
            hits.append(kw)
    return hits


def pick_absurd(n: int, forbid: set[str]) -> list[str]:
    pool = [w for w in ABSURD_POOL if w not in forbid]
    random.shuffle(pool)
    out = pool[:n]
    while len(out) < n:
        out.append(f"物品{len(out)+1}")
    return out


def build_warmup_card(q: dict, item: dict) -> dict | None:
    pts = points_of(q)
    covered = set(item.get("warmup_covered") or [])
    remaining = [i for i in range(len(pts)) if i not in covered]
    if not remaining:
        return None
    sizes = item.get("warmup_sizes") or split_round_sizes(len(pts))
    r = int(item.get("warmup_round") or 0)
    if r >= len(sizes):
        take_n = len(remaining)
    else:
        take_n = sizes[r]
    take_n = min(take_n, len(remaining))
    chosen_idx = remaining[:take_n]
    correct = [pts[i] for i in chosen_idx]
    absurd_n = max(0, 5 - len(correct))
    absurd = pick_absurd(absurd_n, set(pts) | set(correct))
    options = []
    for text in correct:
        options.append({"id": uuid.uuid4().hex[:8], "text": text, "correct": True})
    for text in absurd:
        options.append({"id": uuid.uuid4().hex[:8], "text": text, "correct": False})
    random.shuffle(options)
    return {
        "kind": "warmup",
        "stem": q.get("stem") or "",
        "prompt": "下列哪项属于本题要点？（多选，请勾选全部正确项）",
        "options": [{"id": o["id"], "text": o["text"]} for o in options],
        "_correct_ids": [o["id"] for o in options if o["correct"]],
        "_chosen_point_indices": chosen_idx,
        "round": r + 1,
        "total_rounds": len(sizes),
        "remaining_points": len(remaining),
    }


def advance_after_warmup(item: dict, chosen_idx: list[int], points: list[str]) -> None:
    covered = list(item.get("warmup_covered") or [])
    for i in chosen_idx:
        if i not in covered:
            covered.append(i)
    item["warmup_covered"] = covered
    item["warmup_round"] = int(item.get("warmup_round") or 0) + 1
    if len(covered) >= len(points):
        item["stage"] = "cloze"


def install_short_bank(store, questions: list[dict]) -> dict:
    """写入/替换短题库，题型 short_answer。不强制改 current_bank。"""
    payload = []
    for q in questions:
        item = dict(q)
        item["type"] = "short_answer"
        item.setdefault("options", [])
        item.setdefault("status", "active")
        item.setdefault("phase", "new")
        item.setdefault("interval", 0)
        item.setdefault("countdown", 0)
        item.setdefault("streak", 0)
        item.setdefault("answer_count", 0)
        item.setdefault("correct_count", 0)
        payload.append(item)

    existing = next(
        (b for b in store.banks if b.get("name") == BANK_NAME or b.get("mode") == "short_answer"),
        None,
    )
    if existing:
        existing["questions"] = payload
        existing["imported_at"] = now_str()
        existing["mode"] = "short_answer"
        return existing
    bid = uuid.uuid4().hex[:12]
    bank = {
        "id": bid,
        "name": BANK_NAME,
        "mode": "short_answer",
        "imported_at": now_str(),
        "questions": payload,
    }
    store.banks.append(bank)
    return bank
