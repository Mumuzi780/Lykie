# -*- coding: utf-8 -*-
"""客观题周目（run）统计、斩题规则与斩完结算汇总。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

MIN_ANSWERS_TO_KILL = 3
MIN_ANSWERS_FAST_KILL = 2  # 两次全对可提前斩
MIN_ACCURACY_TO_KILL = 0.5
MIN_ANSWERS_FOR_BOARD = 1  # 上榜由斩题门槛把关，答过即可统计


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _new_run(index: int) -> dict[str, Any]:
    return {
        "index": index,
        "started_at": now_str(),
        "cleared_at": None,
        "max_streak": 0,
        "streak": 0,
        "events": [],
        "qstats": {},
    }


def ensure_bank_runs(bank: dict | None) -> dict | None:
    if not bank:
        return None
    runs = bank.get("runs")
    if not isinstance(runs, list):
        runs = []
        bank["runs"] = runs
    if not runs:
        runs.append(_new_run(1))
    return current_run(bank)


def current_run(bank: dict) -> dict:
    runs = bank.setdefault("runs", [])
    if not runs:
        runs.append(_new_run(1))
        return runs[0]
    for r in reversed(runs):
        if not r.get("cleared_at"):
            return r
    return runs[-1]


def get_run(bank: dict, index: int | None) -> dict | None:
    ensure_bank_runs(bank)
    runs = bank.get("runs") or []
    if index is None:
        return current_run(bank)
    for r in runs:
        if int(r.get("index") or 0) == int(index):
            return r
    return None


def run_qstat(run: dict, qid: str) -> dict:
    qs = run.setdefault("qstats", {})
    st = qs.get(qid)
    if not st:
        st = {"answer_count": 0, "correct_count": 0, "killed": False}
        qs[qid] = st
    return st


def _accuracy(correct: int, answered: int) -> float:
    if answered <= 0:
        return 0.0
    return correct / answered


def can_kill_by_counts(answer_count: int, correct_count: int) -> tuple[bool, str]:
    """本轮次数/正确率是否达到可斩（不含答错相位）。"""
    ac = int(answer_count or 0)
    cc = int(correct_count or 0)
    rate = _accuracy(cc, ac)
    if ac >= MIN_ANSWERS_FAST_KILL and rate >= 1.0 - 1e-9:
        return True, ""
    if ac >= MIN_ANSWERS_TO_KILL and rate >= MIN_ACCURACY_TO_KILL:
        return True, ""
    if ac < MIN_ANSWERS_FAST_KILL:
        return False, f"本轮至少作答 {MIN_ANSWERS_FAST_KILL} 次才能斩（已答 {ac}）"
    if ac < MIN_ANSWERS_TO_KILL:
        return False, f"未满 {MIN_ANSWERS_TO_KILL} 次时需正确率 100% 才能斩（当前 {int(round(rate * 100))}%）"
    return False, f"本轮正确率需≥50%（当前 {int(round(rate * 100))}%）"


def kill_gate(q: dict, run: dict) -> tuple[bool, str]:
    """本轮作答次数 / 正确率 / 答错相位。"""
    st = run_qstat(run, str(q["id"]))
    ac = int(st.get("answer_count") or 0)
    cc = int(st.get("correct_count") or 0)
    if q.get("phase") == "wrong":
        return False, "答错后需先答对才能斩"
    return can_kill_by_counts(ac, cc)


def record_answer(bank: dict, q: dict, correct: bool) -> dict:
    """写入 lifetime + 本轮；更新连击事件。返回当前 run。"""
    run = ensure_bank_runs(bank)
    assert run is not None
    qid = str(q["id"])
    st = run_qstat(run, qid)

    st["answer_count"] = int(st.get("answer_count") or 0) + 1
    q["answer_count"] = int(q.get("answer_count") or 0) + 1
    if correct:
        st["correct_count"] = int(st.get("correct_count") or 0) + 1
        q["correct_count"] = int(q.get("correct_count") or 0) + 1

    if correct:
        before = int(run.get("streak") or 0)
        after = before + 1
        run["streak"] = after
        run["max_streak"] = max(int(run.get("max_streak") or 0), after)
        q["streak"] = int(q.get("streak") or 0) + 1
        q["interval"] = 8 * (2 ** (q["streak"] - 1))
        q["countdown"] = q["interval"]
        q["phase"] = "right"
        run.setdefault("events", []).append(
            {
                "type": "correct",
                "qid": qid,
                "streak_before": before,
                "streak_after": after,
                "at": now_str(),
            }
        )
    else:
        before = int(run.get("streak") or 0)
        run["streak"] = 0
        q["streak"] = 0
        q["interval"] = 5
        q["countdown"] = 5
        q["phase"] = "wrong"
        run.setdefault("events", []).append(
            {
                "type": "wrong",
                "qid": qid,
                "streak_before": before,
                "streak_after": 0,
                "at": now_str(),
            }
        )
    return run


def apply_kill(bank: dict, q: dict, *, as_correct: bool) -> tuple[bool, str, dict | None]:
    """
    斩题。as_correct=True：未先作答的直接斩，先记一次答对再斩。
    答对后再斩：as_correct=False，连击不变。
    """
    run = ensure_bank_runs(bank)
    assert run is not None
    qid = str(q["id"])

    if q.get("status") == "killed":
        return False, "已经斩过了", run

    if as_correct:
        if q.get("phase") == "wrong":
            return False, "答错后需先答对才能斩", run
        st = run_qstat(run, qid)
        preview_ac = int(st.get("answer_count") or 0) + 1
        preview_cc = int(st.get("correct_count") or 0) + 1
        ok, reason = can_kill_by_counts(preview_ac, preview_cc)
        if not ok:
            # 提示里带上「直接斩会计入 1 次」
            if preview_ac < MIN_ANSWERS_FAST_KILL:
                reason = (
                    f"本轮至少作答 {MIN_ANSWERS_FAST_KILL} 次才能斩"
                    f"（直接斩会计入 1 次，完成后为 {preview_ac}）"
                )
            return False, reason, run
        record_answer(bank, q, True)
    else:
        ok, reason = kill_gate(q, run)
        if not ok:
            return False, reason, run

    st = run_qstat(run, qid)
    st["killed"] = True
    q["status"] = "killed"
    run.setdefault("events", []).append(
        {
            "type": "kill",
            "qid": qid,
            "streak_before": int(run.get("streak") or 0),
            "streak_after": int(run.get("streak") or 0),
            "at": now_str(),
            "direct": bool(as_correct),
        }
    )

    # 若客观题全部斩完，归档本周目
    if _objective_all_killed(bank):
        mark_run_cleared(bank, run)

    return True, "", run


def _objective_questions(bank: dict) -> list:
    return [
        q
        for q in (bank.get("questions") or [])
        if q.get("type") != "short_answer"
    ]


def _objective_all_killed(bank: dict) -> bool:
    qs = _objective_questions(bank)
    if not qs:
        return False
    return all(q.get("status") == "killed" for q in qs)


def mark_run_cleared(bank: dict, run: dict | None = None) -> None:
    run = run or current_run(bank)
    if not run.get("cleared_at"):
        run["cleared_at"] = now_str()


def start_new_run_on_reset(bank: dict) -> dict:
    """重置进度：归档当前周目并开新周目；题状态清零，lifetime 答次保留。"""
    ensure_bank_runs(bank)
    cur = current_run(bank)
    if not cur.get("cleared_at"):
        # 未清空就重置：仍归档这一轮（中途放弃）
        cur["cleared_at"] = now_str()
        cur["abandoned"] = True

    for q in bank.get("questions") or []:
        q["status"] = "active"
        q["phase"] = "new"
        q["interval"] = 0
        q["countdown"] = 0
        q["streak"] = 0

    nxt = _new_run(int(cur.get("index") or 0) + 1)
    bank.setdefault("runs", []).append(nxt)
    return nxt


def _stem_brief(q: dict, n: int = 36) -> str:
    s = (q.get("stem") or "").replace("\n", " ").strip()
    if len(s) <= n:
        return s
    return s[: n - 1] + "…"


def _q_meta(bank: dict, qid: str) -> dict:
    q = next((x for x in (bank.get("questions") or []) if str(x.get("id")) == str(qid)), None)
    if not q:
        return {"id": qid, "num": "", "stem": "(题目已删除)", "type": ""}
    return {
        "id": str(q["id"]),
        "num": q.get("num") or q.get("id") or "",
        "stem": _stem_brief(q),
        "stem_full": q.get("stem") or "",
        "type": q.get("type") or "",
    }


def _board_entries(bank: dict, run: dict) -> list[dict]:
    """本轮可上榜题目（作答≥3）。"""
    out = []
    for qid, st in (run.get("qstats") or {}).items():
        ac = int(st.get("answer_count") or 0)
        cc = int(st.get("correct_count") or 0)
        if ac < MIN_ANSWERS_FOR_BOARD:
            continue
        meta = _q_meta(bank, qid)
        rate = _accuracy(cc, ac)
        out.append(
            {
                **meta,
                "answer_count": ac,
                "correct_count": cc,
                "accuracy": round(rate * 100),
                "killed": bool(st.get("killed")),
            }
        )
    return out


def _card_most_answered(entries: list[dict]) -> dict | None:
    if not entries:
        return None
    best = max(e["answer_count"] for e in entries)
    tied = [e for e in entries if e["answer_count"] == best]
    return {"value": best, "unit": "次", "items": tied, "label": "答题次数最多"}


def _card_lowest_acc(entries: list[dict]) -> dict | None:
    if not entries:
        return None
    best = min(e["accuracy"] for e in entries)
    tied = [e for e in entries if e["accuracy"] == best]
    tied.sort(key=lambda e: (-e["answer_count"], e["id"]))
    return {"value": best, "unit": "%", "items": tied, "label": "正确率最低"}


def _card_perfect(entries: list[dict]) -> dict | None:
    tied = [e for e in entries if e["accuracy"] == 100]
    if not tied:
        return None
    tied.sort(key=lambda e: (-e["answer_count"], e["id"]))
    return {"value": len(tied), "unit": "题", "items": tied, "label": "正确率 100%"}


def _streak_detail(bank: dict, run: dict) -> dict:
    events = run.get("events") or []
    curve = []
    breaks = []
    peak = 0
    peak_at = None
    for ev in events:
        t = ev.get("type")
        if t == "correct":
            after = int(ev.get("streak_after") or 0)
            curve.append(
                {
                    "at": ev.get("at"),
                    "qid": ev.get("qid"),
                    "streak": after,
                    "kind": "correct",
                    **_q_meta(bank, ev.get("qid")),
                }
            )
            if after > peak:
                peak = after
                peak_at = ev.get("at")
        elif t == "wrong":
            before = int(ev.get("streak_before") or 0)
            curve.append(
                {
                    "at": ev.get("at"),
                    "qid": ev.get("qid"),
                    "streak": 0,
                    "kind": "break",
                    "broke_streak": before,
                    **_q_meta(bank, ev.get("qid")),
                }
            )
            if before > 0:
                breaks.append(
                    {
                        "broke_streak": before,
                        "at": ev.get("at"),
                        **_q_meta(bank, ev.get("qid")),
                    }
                )
        elif t == "kill":
            curve.append(
                {
                    "at": ev.get("at"),
                    "qid": ev.get("qid"),
                    "streak": int(ev.get("streak_after") or 0),
                    "kind": "kill",
                    "direct": bool(ev.get("direct")),
                    **_q_meta(bank, ev.get("qid")),
                }
            )
    return {
        "max_streak": int(run.get("max_streak") or peak or 0),
        "peak_at": peak_at,
        "curve": curve,
        "breaks": breaks,
    }


def _hist_best(bank: dict) -> dict:
    """跨周目历史最佳。"""
    runs = bank.get("runs") or []
    best_streak = 0
    best_streak_run = None
    most_ans = None  # (count, run_index, item)
    lowest = None
    perfect_count_best = None

    for r in runs:
        idx = int(r.get("index") or 0)
        ms = int(r.get("max_streak") or 0)
        if ms > best_streak:
            best_streak = ms
            best_streak_run = idx
        entries = _board_entries(bank, r)
        c1 = _card_most_answered(entries)
        if c1 and (most_ans is None or c1["value"] > most_ans[0]):
            most_ans = (c1["value"], idx, c1["items"][0] if c1["items"] else None)
        c2 = _card_lowest_acc(entries)
        if c2 and (lowest is None or c2["value"] < lowest[0]):
            lowest = (c2["value"], idx, c2["items"][0] if c2["items"] else None)
        c3 = _card_perfect(entries)
        if c3 and (perfect_count_best is None or c3["value"] > perfect_count_best[0]):
            perfect_count_best = (c3["value"], idx)

    return {
        "max_streak": best_streak,
        "max_streak_run": best_streak_run,
        "most_answered": (
            {"value": most_ans[0], "run": most_ans[1], "item": most_ans[2]}
            if most_ans
            else None
        ),
        "lowest_accuracy": (
            {"value": lowest[0], "run": lowest[1], "item": lowest[2]}
            if lowest
            else None
        ),
        "perfect_count": (
            {"value": perfect_count_best[0], "run": perfect_count_best[1]}
            if perfect_count_best
            else None
        ),
    }


def build_settle(bank: dict, run_index: int | None = None) -> dict:
    ensure_bank_runs(bank)
    runs = bank.get("runs") or []
    run = get_run(bank, run_index) or current_run(bank)
    entries = _board_entries(bank, run)
    streak = _streak_detail(bank, run)
    hist = _hist_best(bank)

    cards = []
    for builder, key in (
        (_card_most_answered, "most_answered"),
        (_card_lowest_acc, "lowest_accuracy"),
        (_card_perfect, "perfect"),
    ):
        card = builder(entries)
        if not card:
            cards.append(
                {
                    "key": key,
                    "label": {
                        "most_answered": "答题次数最多",
                        "lowest_accuracy": "正确率最低",
                        "perfect": "正确率 100%",
                    }[key],
                    "empty": True,
                    "hint": "本轮暂无上榜题（答过即可计入）",
                }
            )
            continue
        preview = card["items"][0] if card["items"] else None
        hist_note = None
        if key == "most_answered" and hist.get("most_answered"):
            h = hist["most_answered"]
            if h["run"] != run.get("index") or h["value"] != card["value"]:
                hist_note = f"历史最佳 {h['value']} 次 · 第 {h['run']} 周目"
        if key == "lowest_accuracy" and hist.get("lowest_accuracy"):
            h = hist["lowest_accuracy"]
            if h["run"] != run.get("index") or h["value"] != card["value"]:
                hist_note = f"历史最低 {h['value']}% · 第 {h['run']} 周目"
        if key == "perfect" and hist.get("perfect_count"):
            h = hist["perfect_count"]
            if h["run"] != run.get("index") or h["value"] != card["value"]:
                hist_note = f"历史最多 {h['value']} 题全对 · 第 {h['run']} 周目"
        cards.append(
            {
                "key": key,
                "label": card["label"],
                "empty": False,
                "value": card["value"],
                "unit": card["unit"],
                "tie_count": len(card["items"]),
                "preview": preview,
                "items": card["items"],
                "hist_note": hist_note,
            }
        )

    hist_streak_note = None
    if hist.get("max_streak_run") and (
        hist["max_streak"] > streak["max_streak"]
        or hist["max_streak_run"] != run.get("index")
    ):
        hist_streak_note = f"历史最佳 ×{hist['max_streak']} · 第 {hist['max_streak_run']} 周目"

    cards.append(
        {
            "key": "max_streak",
            "label": "最高连击",
            "empty": streak["max_streak"] <= 0,
            "value": streak["max_streak"],
            "unit": "",
            "hint": "含答对与直接斩；答对后再斩不加连击",
            "hist_note": hist_streak_note,
            "detail": streak,
        }
    )

    run_list = [
        {
            "index": int(r.get("index") or 0),
            "started_at": r.get("started_at"),
            "cleared_at": r.get("cleared_at"),
            "abandoned": bool(r.get("abandoned")),
            "max_streak": int(r.get("max_streak") or 0),
            "is_current": r is run,
        }
        for r in runs
    ]

    obj = _objective_questions(bank)
    killed = sum(1 for q in obj if q.get("status") == "killed")

    return {
        "run_index": int(run.get("index") or 1),
        "run": {
            "index": int(run.get("index") or 1),
            "started_at": run.get("started_at"),
            "cleared_at": run.get("cleared_at"),
            "abandoned": bool(run.get("abandoned")),
            "streak": int(run.get("streak") or 0),
            "max_streak": int(run.get("max_streak") or 0),
        },
        "runs": run_list,
        "bank_name": bank.get("name"),
        "total": len(obj),
        "killed": killed,
        "cards": cards,
        "history_best": hist,
        "compare": _compare_runs(bank, runs),
    }


def _compare_runs(bank: dict, runs: list) -> list[dict]:
    """供系统/UI 做周目对照的摘要行。"""
    rows = []
    for r in runs:
        entries = _board_entries(bank, r)
        total_ans = sum(int(st.get("answer_count") or 0) for st in (r.get("qstats") or {}).values())
        total_ok = sum(int(st.get("correct_count") or 0) for st in (r.get("qstats") or {}).values())
        rows.append(
            {
                "index": int(r.get("index") or 0),
                "max_streak": int(r.get("max_streak") or 0),
                "answered": total_ans,
                "correct": total_ok,
                "accuracy": int(round(_accuracy(total_ok, total_ans) * 100)) if total_ans else 0,
                "board_count": len(entries),
                "cleared_at": r.get("cleared_at"),
                "abandoned": bool(r.get("abandoned")),
            }
        )
    return rows


def attach_question_kill_info(bank: dict, q: dict, out: dict) -> None:
    run = ensure_bank_runs(bank)
    assert run is not None
    st = run_qstat(run, str(q["id"]))
    ac = int(st.get("answer_count") or 0)
    cc = int(st.get("correct_count") or 0)
    ok, reason = kill_gate(q, run)
    out["run_answer_count"] = ac
    out["run_correct_count"] = cc
    out["run_accuracy"] = int(round(_accuracy(cc, ac) * 100)) if ac else 0
    out["phase"] = q.get("phase") or "new"
    out["can_kill"] = ok
    out["kill_block_reason"] = "" if ok else reason
    out["run_streak"] = int(run.get("streak") or 0)
    out["run_index"] = int(run.get("index") or 1)
