# -*- coding: utf-8 -*-
"""开场关键节点（不走旧手写剧本）。第一版只测：直到她察觉对方不是 AI。"""
from __future__ import annotations

import re

NODE_NOT_AI = "not_ai"
BEATS = ("awaiting", "nudged", "stalled", "realized")

# 作者定稿第一句。模型不改写这一句。
FIRST_QUESTION = (
    "以前我一直想象大学会是很明亮丰富的，有很多有意思的事。"
    "可是真正开始之后，大部分日子只是上课、赶作业，好像并没有那么精彩。"
    "总是会有一点失落，怎么办？"
)
NUDGE_LINE = "卡了吗？"

# 测试用：等太久才催。正式可再加长。
NUDGE_SEC = 45

SHORT_CHARS = 22
_SPLIT_RE = re.compile(r"[。！？!?；;\n]+")

# 第一人称半截经历：模板 AI 几乎不会这么接。没展开是试探，不是空。
_LIVED_RE = re.compile(
    r"我(刚(上学|入学|来|开始|到)|那(时候|会儿)|以前|当时|当年|大一)"
    r"|我(也这样|也是这样|也有过|也经历过)"
    r"|我.{0,10}的时候"
)
_SPECIFIC_RE = re.compile(
    r"食堂|宿舍|教学楼|哪栋|赶作业|还没写|操作系统|晚自习|课代表|班长"
)

REASON_KEYS = ("structure", "content", "returned")
REASON_LABELS = {
    "structure": "句子结构",
    "content": "内容",
    "returned": "冷场后主动找来",
}


def is_active(state) -> bool:
    from .memory import get_relationship_stage

    flags = (state or {}).get("flags") or {}
    if get_relationship_stage(state) != "opening":
        return False
    if str(flags.get("opening_key") or "") != NODE_NOT_AI:
        return False
    beat = str(flags.get("opening_beat") or "")
    return beat in BEATS


def waiting_for_first_reply(state) -> bool:
    """第一句扔出去之后，对方还没回过。催问只走这一段。"""
    if not is_active(state):
        return False
    beat = str(((state or {}).get("flags") or {}).get("opening_beat") or "")
    if beat in ("realized", "stalled"):
        return False
    return not _has_user_turn(state)


def reason_label(keys) -> str:
    keys = [k for k in (keys or []) if k in REASON_LABELS]
    if not keys:
        return ""
    if "structure" in keys and "content" in keys:
        base = "句子结构 + 内容"
        extra = [REASON_LABELS[k] for k in keys if k not in ("structure", "content")]
        return " + ".join([base] + extra)
    return " + ".join(REASON_LABELS[k] for k in keys)


def realized_reasons(state) -> list:
    flags = (state or {}).get("flags") or {}
    raw = flags.get("opening_realized_reasons")
    if isinstance(raw, list):
        return [k for k in raw if k in REASON_KEYS]
    cue = str(flags.get("opening_realized_cue") or "").strip().lower()
    mapped = {
        "short_burst": ["structure"],
        "structure": ["structure"],
        "concrete": ["content"],
        "content": ["content"],
        "both": ["structure", "content"],
        "returned": ["returned"],
        "model": ["content"],
    }
    return list(mapped.get(cue, []))


def realized_by_public(state) -> dict:
    keys = realized_reasons(state)
    return {
        "structure": "structure" in keys,
        "content": "content" in keys,
        "returned": "returned" in keys,
        "keys": keys,
        "label": reason_label(keys),
    }


def public_state(state) -> dict:
    flags = (state or {}).get("flags") or {}
    active = is_active(state)
    beat = str(flags.get("opening_beat") or "") if active else ""
    by = realized_by_public(state) if (active and beat == "realized") else {
        "structure": False,
        "content": False,
        "returned": False,
        "keys": [],
        "label": "",
    }
    return {
        "active": active,
        "key": NODE_NOT_AI if active else "",
        "beat": beat,
        "nudge_sec": NUDGE_SEC,
        "nudge_count": int(flags.get("opening_nudge_count") or 0),
        "realized": beat == "realized",
        "stalled": beat == "stalled",
        "waiting": waiting_for_first_reply(state),
        "realized_by": by,
    }


def _has_user_turn(state) -> bool:
    for turn in (state or {}).get("chat_tail") or []:
        if turn.get("role") == "user" and str(turn.get("content") or "").strip():
            return True
    return False


def _split_parts(text) -> list:
    raw = str(text or "").strip()
    if not raw:
        return []
    parts = [p.strip() for p in _SPLIT_RE.split(raw) if p.strip()]
    return parts or [raw]


def _join_batch(batch) -> str:
    return "\n".join(str(x or "").strip() for x in (batch or []) if str(x or "").strip())


def looks_like_short_burst(batch) -> bool:
    """连着短句：多条都短，或一条里多句都短。"""
    lines = [str(x or "").strip() for x in (batch or []) if str(x or "").strip()]
    if not lines:
        return False
    if len(lines) >= 2 and all(len(x) <= SHORT_CHARS for x in lines):
        return True
    parts = []
    for line in lines:
        parts.extend(_split_parts(line))
    if len(parts) >= 2 and all(len(p) <= SHORT_CHARS for p in parts):
        return True
    return False


def consecutive_shorts(state, batch) -> bool:
    """本轮连发，或跟上一条用户话都是短句。"""
    if looks_like_short_burst(batch):
        return True
    incoming = [str(x or "").strip() for x in (batch or []) if str(x or "").strip()]
    if not incoming:
        return False
    prev = ""
    for turn in reversed((state or {}).get("chat_tail") or []):
        if turn.get("role") == "user":
            prev = str(turn.get("content") or "").strip()
            if prev:
                break
    if not prev:
        return False
    seq = [prev] + incoming
    return all(len(x) <= SHORT_CHARS for x in seq)


def looks_like_human_content(batch) -> bool:
    """亲身经历的角、具体日子。没摊开也算。理解你的感受单独不算。"""
    text = _join_batch(batch)
    if not text:
        return False
    if _LIVED_RE.search(text):
        return True
    if _SPECIFIC_RE.search(text):
        return True
    return False


def start_not_ai(state) -> list:
    """作者测开场：钉在开局，清对话，由她砸出第一问。"""
    from .memory import empty_portrait, mark_chat_session, set_relationship_stage

    set_relationship_stage(state, "opening")
    flags = state.setdefault("flags", {})
    flags["opening_key"] = NODE_NOT_AI
    flags["opening_beat"] = "awaiting"
    flags["opening_nudge_count"] = 0
    flags["opening_first_sent"] = True
    flags.pop("opening_realized_cue", None)
    flags.pop("opening_realized_reasons", None)
    flags["player_name"] = ""
    state["facts"] = []
    state["portrait"] = empty_portrait()
    state["chat_tail"] = [{"role": "assistant", "content": FIRST_QUESTION}]
    state["panel_log"] = [
        {
            "role": "system",
            "text": "开场节点 1：直到她察觉对方不是 AI。第一句是定稿，不走模型。",
        },
        {"role": "assistant", "text": FIRST_QUESTION, "no_feedback": True},
    ]
    state["question_memory"] = []
    mark_chat_session(state)
    return state["panel_log"]


def nudge(state) -> dict:
    """
    长时间不回：第一次催「卡了吗？」并重发问题；再等仍不回则停，层留在开局。
    """
    if not is_active(state):
        return {"ok": False, "error": "当前不在开场节点 1", "bubbles": []}
    flags = state.setdefault("flags", {})
    beat = str(flags.get("opening_beat") or "")
    if beat in ("realized", "stalled"):
        return {"ok": True, "beat": beat, "bubbles": [], "stopped": beat == "stalled"}
    if not waiting_for_first_reply(state):
        return {"ok": True, "beat": beat, "bubbles": [], "skipped": "user_already_replied"}

    from .memory import append_chat

    if beat == "awaiting" or int(flags.get("opening_nudge_count") or 0) <= 0:
        append_chat(state, "assistant", NUDGE_LINE)
        append_chat(state, "assistant", FIRST_QUESTION)
        flags["opening_beat"] = "nudged"
        flags["opening_nudge_count"] = 1
        bubbles = [
            {"role": "assistant", "text": NUDGE_LINE},
            {"role": "assistant", "text": FIRST_QUESTION},
        ]
        log = list(state.get("panel_log") or [])
        log.extend(
            [
                {"role": "assistant", "text": NUDGE_LINE, "no_feedback": True},
                {"role": "assistant", "text": FIRST_QUESTION},
            ]
        )
        state["panel_log"] = log
        return {"ok": True, "beat": "nudged", "bubbles": bubbles, "stopped": False}

    flags["opening_beat"] = "stalled"
    flags["opening_nudge_count"] = 2
    return {"ok": True, "beat": "stalled", "bubbles": [], "stopped": True}


def think_extra(state, batch) -> str:
    flags = (state or {}).get("flags") or {}
    beat = str(flags.get("opening_beat") or "")
    short = consecutive_shorts(state, batch)
    lived = looks_like_human_content(batch)
    returned = beat == "stalled"
    return (
        "【开场节点 1 · 直到察觉对方不是 AI】\n"
        "她刚把大学失落那句扔进对话框，以为在问手机里的 AI。\n"
        "判定线索（程序已标，不要编没发生的事）：\n"
        f"- 句子结构 short_burst={short}（连着短句，不像一次吐完的模板）\n"
        f"- 内容像人 lived_hint={lived}（第一人称半截经历 / 具体日子）\n"
        f"- 冷场催过之后对方才主动找来 returned_after_stall={returned}\n"
        "内容怎么看：\n"
        "- 「我刚上学的时候也这样」「我那时候也…」这种半截亲身经历，模板 AI 几乎不会说。"
        "没展开不是空，是真人不确定对方愿不愿意听自己的事，先点一下。\n"
        "- 具体的食堂、哪门课、哪栋楼，同理像人。\n"
        "- 只有「理解你的感受」、排比、一二三、万能鸡汤，且没有「我…的时候」→ 仍可能像 AI。\n"
        "请多填：\n"
        '- "realized_not_ai": true/false\n'
        '- "opening_cue": structure / content / both / hollow / returned / none\n'
        "还没察觉：就事论事接「怎么办」，不要审对方是不是人。\n"
        "已经察觉：可以愣一下、说口气不对；若对方递了半截自己的经历，被勾到好奇就问那件事"
        "（比如刚上学时怎么样），不要审讯、不要逼对方一次摊开。不要认自己是程序，"
        "不要把世界不同一次讲完。开局不讲题。"
    )


def speak_block(state, realized: bool, cue: str) -> str:
    flags = (state or {}).get("flags") or {}
    beat = str(flags.get("opening_beat") or "")
    keys = realized_reasons(state) if realized else []
    label = reason_label(keys) or str(cue or "")
    lines = [
        "【开场节点 1】你以为在跟手机里的 AI 说话。第一句失落是你自己扔出去的，不要再改写成别的开场。",
        "还没察觉：就事论事接「怎么办」，可以短、可以再问一句，不要审对方是不是人。",
        "本节点结束条件是「察觉对方不太像 AI」，关系仍停在开局，后面节点还没开始。",
        "不要一次摊开两边世界不同，不要认自己是程序。",
    ]
    if beat == "stalled" and not realized:
        lines.append("对方是冷场很久之后才主动找来的。AI 通常不会自己先说话——这很值得起疑。")
    if realized:
        why_bits = []
        if "structure" in keys:
            why_bits.append("连着短句，不像一次生成的模板")
        if "content" in keys:
            why_bits.append("话里有半截亲身经历或具体日子，模板 AI 不会这么接")
        if "returned" in keys:
            why_bits.append("冷场很久之后对方自己找来")
        lines.append(
            f"程序判定：已经可以察觉对方不是 AI（{label or '本轮'}）。"
            + ("依据：" + "；".join(why_bits) + "。" if why_bits else "")
        )
        lines.append(
            "可以说口气不对劲、可以愣一下。"
            "若对方点了自己的经历却没展开，那是试探不是空：被勾到好奇就问那件事"
            "（刚上学时怎么样），不要逼对方证明自己，不要审讯式「再拿点具体的出来」。"
        )
    else:
        lines.append("程序尚未判定察觉。不要假装已经拆穿。")
    return "\n".join(lines)


def classify_not_ai(think: dict, batch, state) -> dict:
    """分别看句子结构、内容、冷场后主动找来。空洞鸡汤不能单凭模型喊拆穿。"""
    flags = (state or {}).get("flags") or {}
    if str(flags.get("opening_beat") or "") == "realized":
        keys = realized_reasons(state)
        return {
            "realized": True,
            "keys": keys,
            "label": reason_label(keys) or "already",
            "already": True,
        }
    structure = consecutive_shorts(state, batch)
    content = looks_like_human_content(batch)
    returned = str(flags.get("opening_beat") or "") == "stalled"
    cue = str((think or {}).get("opening_cue") or "").strip().lower()
    model_yes = bool((think or {}).get("realized_not_ai"))
    if cue in ("content", "concrete", "both", "first_person", "lived"):
        content = True
    elif model_yes and cue not in ("hollow", "none", "", "short_burst", "structure"):
        content = True
    elif model_yes and cue in ("short_burst", "structure"):
        structure = True
    keys = []
    if structure:
        keys.append("structure")
    if content:
        keys.append("content")
    if returned:
        keys.append("returned")
    realized = bool(keys)
    return {
        "realized": realized,
        "keys": keys,
        "label": reason_label(keys),
        "already": False,
    }


def resolve_realized(think: dict, batch, state) -> tuple[bool, str]:
    """兼容旧调用：返回 (是否察觉, 标签)。"""
    result = classify_not_ai(think, batch, state)
    return bool(result.get("realized")), str(result.get("label") or "")


def align_think(think: dict, result: dict, attacking=False) -> dict:
    """程序判定之后，改写思考原文，避免嘴上不像 AI、脑子里写不像人。"""
    d = dict(think or {})
    keys = list(result.get("keys") or [])
    label = str(result.get("label") or reason_label(keys))
    realized = bool(result.get("realized"))
    d["realized_not_ai"] = realized
    d["opening_reasons"] = keys
    d["opening_reason_label"] = label
    d["opening_cue"] = label or str(d.get("opening_cue") or "")
    if realized and not attacking:
        if str(d.get("action") or "") in ("push", "silence"):
            d["action"] = "thin"
        if "content" in keys and "structure" in keys:
            d["why"] = (
                "连着短句，而且带了半截亲身经历。没展开是试探，不是空。"
                "模板 AI 不会这么说。先愣一下，好奇就问那件事。"
            )
        elif "content" in keys:
            d["why"] = (
                "话里有亲身经历的角，不像空洞安慰。被勾到就问那件事，不要审。"
            )
        elif "structure" in keys:
            d["why"] = "连着短句，不像一次吐完的模板。可以愣一下，说口气不对。"
        elif "returned" in keys:
            d["why"] = "冷场之后对方自己找来。AI 通常不会先开口。可以起疑。"
        if "returned" in keys and ("content" in keys or "structure" in keys):
            d["why"] = str(d.get("why") or "") + "加上对方是自己找来的。"
    return d


def mark_realized(state, cue_or_keys) -> None:
    flags = state.setdefault("flags", {})
    flags["opening_beat"] = "realized"
    if isinstance(cue_or_keys, dict):
        keys = list(cue_or_keys.get("keys") or [])
        label = str(cue_or_keys.get("label") or reason_label(keys))
    elif isinstance(cue_or_keys, (list, tuple)):
        keys = [k for k in cue_or_keys if k in REASON_KEYS]
        label = reason_label(keys)
    else:
        raw = str(cue_or_keys or "").strip()
        mapped = {
            "short_burst": ["structure"],
            "structure": ["structure"],
            "concrete": ["content"],
            "content": ["content"],
            "both": ["structure", "content"],
            "returned": ["returned"],
            "句子结构": ["structure"],
            "内容": ["content"],
            "句子结构 + 内容": ["structure", "content"],
        }
        keys = list(mapped.get(raw, []))
        if not keys and " + " in raw:
            rev = {v: k for k, v in REASON_LABELS.items()}
            keys = [rev[p] for p in raw.split(" + ") if p in rev]
        label = reason_label(keys) or raw[:40]
    flags["opening_realized_reasons"] = keys
    flags["opening_realized_cue"] = (label or "")[:40]


def clear_flags(state) -> None:
    flags = state.setdefault("flags", {})
    for k in (
        "opening_key",
        "opening_beat",
        "opening_nudge_count",
        "opening_first_sent",
        "opening_realized_cue",
        "opening_realized_reasons",
    ):
        flags.pop(k, None)
