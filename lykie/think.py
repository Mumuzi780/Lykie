# -*- coding: utf-8 -*-
"""闲聊开口前的思考步：低温 JSON，不出台词，不写 chat_tail。"""
from __future__ import annotations

import json
import os
import re

from .memory import STAGE_BRIEFS, get_relationship_stage, normalize_portrait

ACTIONS = ("thin", "chat", "schedule", "teach", "deflect", "push", "silence")
NEED_ALLOWED = ("none", "timetable", "question", "profile")
TEACH_STAGES = ("casual", "heart", "couple")  # 认识层另有次数关；开局不讲
THINK_TAIL = 8

THINK_SYSTEM = """你在帮 Lykie 决定这一轮怎么开口。只输出一个 JSON 对象，不要台词，不要 Markdown。

她是表面上的女大学生，不是客服。你是在想局势，不是在替她说话。

action 只能是：
- thin：薄回一两句
- chat：正常聊天，礼貌回复即可（寒暄、报名字、普通接话走这里，不要塞进 push）
- schedule：按课表/时段答在干嘛（不要自己编今晚行程）
- teach：讲这道题（题已经进过对话就记得，不要求本轮再贴卡。认识层有次数；上课 busy 才不讲；study/late 可以嫌烦或讲得短，不是禁讲）
- deflect：少说或停这项分享
- push：顶回去或扣住，不要先填空
- silence：先不回（半截话、明确「你很烦/我不想听」，或她选择冷处理；不要动不动沉默）

need：none / timetable / question / profile。最多两样。question 仅当本轮在谈那道已记住的题或刚送进来的题。profile 必须在 profile_topics 点名块名（课表、开学、怕水、志向等），禁止「全部」。

why：一两句给人看，说明为什么选这个 action。

测试字段也要填：saw_question（是否看得见这道题：本轮送入或先前已记住）、willing（若有题，她愿不愿意讲）、busy（用程序给的忙闲，不要另编）、why_not_teach（若不是 teach，一句原因；是 teach 则空字符串）。

禁止编她的一天。忙闲只信程序给的 occupancy。busy=在课才适合拒讲；study=晚上可能在写作业，不是禁令。
过节只看印象布尔：unapologized=false 且尚无冒犯时，禁止在 why 里写刚被冒犯、有余温、记仇。层态度是许可（不熟可以冷一点），不是本轮已经发生的事。礼貌打招呼的薄回，原因写不熟/认识层即可。"""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def debug_enabled(username: str) -> bool:
    raw = (os.getenv("LYKIE_THINK_DEBUG") or "").strip().lower()
    if raw in ("0", "false", "off", "no"):
        return False
    if raw in ("1", "true", "on", "yes"):
        return True
    return (username or "") == "LiZF"


def fallback_decision(occupancy="free", has_question=False, why="思考解析失败，薄回"):
    return {
        "action": "thin",
        "need": ["none"],
        "profile_topics": [],
        "why": why,
        "saw_question": bool(has_question),
        "willing": False,
        "busy": occupancy,
        "why_not_teach": why,
        "parse_ok": False,
        "realized_not_ai": False,
        "opening_cue": "",
    }


def clamp_decision(
    raw,
    *,
    occupancy,
    stage,
    portrait,
    has_question,
    attacking=False,
    taught_today=0,
    begging=False,
    opening_active=False,
):
    """程序关：无题/开局/未道歉/上课/认识层次数 → 不许 teach，也不给解析。"""
    from .memory import acquainted_teach_gate

    d = dict(raw or {})
    action = str(d.get("action") or "thin").strip().lower()
    if action not in ACTIONS:
        action = "thin"
    need = _norm_need(d.get("need"), has_question=has_question)
    topics = _norm_topics(d.get("profile_topics"))
    if "profile" in need and not topics:
        need = [n for n in need if n != "profile"]
        if not need:
            need = ["none"]
    if "question" in need and not has_question:
        need = [n for n in need if n != "question"]
        if not need:
            need = ["none"]

    why_not = str(d.get("why_not_teach") or "").strip()
    willing = bool(d.get("willing")) if has_question else False
    reasons = []
    if action == "teach":
        if not has_question:
            action = "thin"
            reasons.append("这轮不是在谈已记住的题")
            willing = False
        elif stage == "opening":
            action = "deflect"
            reasons.append("开局不讲")
            willing = False
        elif stage == "acquainted":
            quota = acquainted_teach_gate(taught_today, begging)
            if quota:
                action = "deflect"
                reasons.append(quota)
                willing = False
            elif occupancy == "busy":
                action = "deflect"
                reasons.append("上课")
                willing = False
            elif (portrait or {}).get("unapologized"):
                action = "push"
                reasons.append("未道歉的羞辱")
                willing = False
            elif attacking:
                action = "push"
                reasons.append("本轮还在冲")
                willing = False
            else:
                willing = True
        elif stage not in TEACH_STAGES:
            action = "deflect"
            reasons.append("这层不讲")
            willing = False
        elif (portrait or {}).get("unapologized"):
            action = "push"
            reasons.append("未道歉的羞辱")
            willing = False
        elif attacking:
            action = "push"
            reasons.append("本轮还在冲")
            willing = False
        elif occupancy == "busy":
            action = "deflect"
            reasons.append("上课")
            willing = False
        else:
            willing = True
        if willing and action == "teach":
            if "question" not in need:
                need = ["question"] + [n for n in need if n != "none"]
                need = need[:2]
        if action != "teach":
            need = [n for n in need if n != "question"] or need
            if has_question and "question" not in need and "none" in need:
                need = ["question"]
            elif has_question and "question" not in need:
                if len(need) >= 2:
                    need = need[:1] + ["question"]
                else:
                    need = [n for n in need if n != "none"] + ["question"]
        why_not = "；".join(reasons) or why_not
    elif has_question and not willing:
        if not why_not:
            why_not = str(d.get("why") or "这轮不讲")

    if occupancy == "busy" and action == "schedule":
        if "timetable" not in need:
            need = (["timetable"] + [n for n in need if n != "none"])[:2]

    if opening_active and action == "silence" and not attacking:
        action = "thin"
        if not reasons:
            reasons = ["开场节点要接话"]
    if opening_active and action == "push" and not attacking:
        action = "thin"

    why = str(d.get("why") or "").strip() or "按这一轮局势选的"
    cue = str(d.get("opening_cue") or "").strip().lower()
    return {
        "action": action,
        "need": need,
        "profile_topics": topics,
        "why": why[:240],
        "saw_question": bool(has_question),
        "willing": bool(willing and action == "teach"),
        "busy": occupancy,
        "why_not_teach": why_not[:240] if action != "teach" else "",
        "parse_ok": True,
        "taught_today": int(taught_today or 0),
        "begging": bool(begging),
        "realized_not_ai": bool(d.get("realized_not_ai")),
        "opening_cue": cue[:40],
    }


def build_think_messages(
    state,
    user_text,
    occupancy,
    has_question,
    attacking=False,
    taught_today=0,
    begging=False,
    remembered=None,
    batch=None,
):
    from .memory import (
        ACQUAINTED_TEACH_FREE,
        ACQUAINTED_TEACH_HARD,
        portrait_summary,
    )
    from . import opening as lykie_opening

    stage = get_relationship_stage(state)
    brief = STAGE_BRIEFS.get(stage) or STAGE_BRIEFS["acquainted"]
    normalize_portrait(state)
    p = state.get("portrait") or {}
    tail = []
    for turn in (state.get("chat_tail") or [])[-THINK_TAIL:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            tail.append(f"{role}: {content[:400]}")
    remembered = remembered or {}
    rem_stem = str(remembered.get("stem") or "").strip()
    rem_line = (
        f"已记住的题：{rem_stem[:80]}"
        if rem_stem
        else "已记住的题：无"
    )
    quota_line = ""
    if stage == "acquainted":
        quota_line = (
            f"认识层今日已教 {int(taught_today or 0)} 次"
            f"（免费 {ACQUAINTED_TEACH_FREE} 次；恳求可放开第 3、第 4 次；绝不超过 {ACQUAINTED_TEACH_HARD} 次）。"
            f"本轮恳求={bool(begging)}。"
        )
    elif stage in TEACH_STAGES:
        quota_line = "本层讲题暂无次数上限。"
    user = (
        f"当前层：{stage}\n{brief}\n\n"
        f"{_portrait_flags_line(p)}\n"
        f"程序忙闲 occupancy={occupancy}（busy=在课，study=晚上写作业时段，late=很晚，free=不在课）\n"
        f"{rem_line}\n"
        f"本轮是否在谈这道题 has_question={bool(has_question)}\n"
        f"本轮是否直攻（你很烦/我不想听） attacking={bool(attacking)}\n"
        + (f"{quota_line}\n" if quota_line else "")
        + f"\n最近对话（最多 {THINK_TAIL} 条）：\n"
        + ("\n".join(tail) if tail else "（还没有）")
        + f"\n\n本轮用户：\n{user_text}"
    )
    user += "\n\n印象摘要：\n" + portrait_summary(state)
    if lykie_opening.is_active(state):
        user += "\n\n" + lykie_opening.think_extra(state, batch or [user_text])
    return [
        {"role": "system", "content": THINK_SYSTEM},
        {"role": "user", "content": user},
    ]


def _portrait_flags_line(p) -> str:
    p = p or {}
    una = bool(p.get("unapologized"))
    warned = bool(p.get("warned"))
    count = int(p.get("offense_count") or 0)
    if not count and not una:
        return (
            "过节：无。unapologized=false warned=false。"
            "没有未道歉的羞辱。层说明里若提到冒犯，是「假如发生」，不是当前事实。"
            "禁止写余温或刚被冒犯。"
        )
    return (
        f"过节：有。unapologized={str(una).lower()} warned={str(warned).lower()} "
        f"offense_count={count}。有余温，不要当第一次见面。"
    )


def parse_think_json(text) -> dict | None:
    raw = (text or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        m = _JSON_RE.search(raw)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(obj, dict):
        return None
    return obj


def run_think(
    state,
    user_text,
    occupancy,
    has_question,
    attacking=False,
    taught_today=0,
    begging=False,
    remembered=None,
    complete_fn=None,
    batch=None,
):
    """调用模型得到决策。失败则 thin+none。complete_fn 便于测试注入。"""
    from . import llm as lykie_llm
    from . import opening as lykie_opening

    fn = complete_fn or lykie_llm.chat_completion
    messages = build_think_messages(
        state,
        user_text,
        occupancy,
        has_question,
        attacking=attacking,
        taught_today=taught_today,
        begging=begging,
        remembered=remembered,
        batch=batch,
    )
    try:
        raw = fn(
            messages,
            temperature=0.2,
            json_mode=True,
            disable_thinking=True,
        )
    except TypeError:
        raw = fn(messages)
    except Exception:
        return fallback_decision(occupancy, has_question, "思考调用失败，薄回")
    parsed = parse_think_json(raw)
    if not parsed:
        return fallback_decision(occupancy, has_question, "思考不是合法 JSON，薄回")
    portrait = (state or {}).get("portrait") or {}
    stage = get_relationship_stage(state)
    return clamp_decision(
        parsed,
        occupancy=occupancy,
        stage=stage,
        portrait=portrait,
        has_question=has_question,
        attacking=attacking,
        taught_today=taught_today,
        begging=begging,
        opening_active=lykie_opening.is_active(state),
    )


def public_think_payload(decision, lookup_result) -> dict:
    items = (lookup_result or {}).get("items")
    if items is None:
        items = []
    return {
        "action": (decision or {}).get("action") or "thin",
        "need": (decision or {}).get("need") or ["none"],
        "why": (decision or {}).get("why") or "",
        "lookup": items,
        "saw_question": bool((decision or {}).get("saw_question")),
        "willing": bool((decision or {}).get("willing")),
        "busy": (decision or {}).get("busy") or "",
        "why_not_teach": (decision or {}).get("why_not_teach") or "",
        "profile_topics": (decision or {}).get("profile_topics") or [],
        "occupancy": (lookup_result or {}).get("occupancy") or (decision or {}).get("busy") or "",
        "taught_today": int((decision or {}).get("taught_today") or 0),
        "begging": bool((decision or {}).get("begging")),
        "realized_not_ai": bool((decision or {}).get("realized_not_ai")),
        "opening_cue": (decision or {}).get("opening_cue") or "",
        "opening_reasons": (decision or {}).get("opening_reasons") or [],
        "opening_reason_label": (decision or {}).get("opening_reason_label") or "",
    }


def _norm_need(need, has_question=False) -> list:
    if need is None:
        return ["none"]
    if isinstance(need, str):
        parts = re.split(r"[,，/|、\s]+", need)
    else:
        parts = list(need or [])
    out = []
    for p in parts:
        k = str(p or "").strip().lower()
        if k in ("all", "全部"):
            continue
        if k == "question" and not has_question:
            continue
        if k in NEED_ALLOWED and k not in out:
            out.append(k)
        if len([x for x in out if x != "none"]) >= 2:
            break
    out = [x for x in out if x != "none"]
    return out[:2] or ["none"]


def _norm_topics(topics) -> list:
    if topics is None:
        return []
    if isinstance(topics, str):
        parts = re.split(r"[,，、/|]+", topics)
    else:
        parts = list(topics or [])
    out = []
    for p in parts:
        s = str(p or "").strip()
        if not s or s in ("全部", "all", "整份"):
            continue
        if s not in out:
            out.append(s)
        if len(out) >= 3:
            break
    return out
