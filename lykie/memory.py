# -*- coding: utf-8 -*-
"""Lykie 本地记忆：facts / style_notes / corrections / chat_tail / flags。"""
import json
import os
import threading
import time
import uuid

_lock = threading.Lock()

CHAT_TAIL_MAX = 40
FACTS_MAX = 40
STYLE_NOTES_MAX = 30
CORRECTIONS_MAX = 25
PANEL_LOG_MAX = 200

DEFAULT_STATE = {
    "facts": [],
    "style_notes": [],
    "corrections": [],
    "unknown_question_ids": [],
    "chat_tail": [],
    "panel_log": [],
    "flags": {
        "first_explain_done": False,
        "fragment_01_done": False,
        "player_name": "",
    },
}


def _ensure_dir(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)


def load_state(path):
    with _lock:
        if not os.path.exists(path):
            return json.loads(json.dumps(DEFAULT_STATE))
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return json.loads(json.dumps(DEFAULT_STATE))
        out = json.loads(json.dumps(DEFAULT_STATE))
        out["facts"] = list(data.get("facts") or [])
        out["style_notes"] = list(data.get("style_notes") or [])
        out["corrections"] = list(data.get("corrections") or [])
        out["unknown_question_ids"] = list(data.get("unknown_question_ids") or [])
        out["chat_tail"] = list(data.get("chat_tail") or [])
        out["panel_log"] = list(data.get("panel_log") or [])
        flags = data.get("flags") or {}
        out["flags"].update(flags)
        return out


def save_state(path, state):
    with _lock:
        _ensure_dir(path)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)


def append_chat(state, role, content):
    state["chat_tail"].append({"role": role, "content": content})
    if len(state["chat_tail"]) > CHAT_TAIL_MAX:
        state["chat_tail"] = state["chat_tail"][-CHAT_TAIL_MAX:]


def last_assistant_message(state):
    for turn in reversed(state.get("chat_tail") or []):
        if turn.get("role") == "assistant" and (turn.get("content") or "").strip():
            return turn["content"].strip()
    return ""


def last_user_message(state):
    for turn in reversed(state.get("chat_tail") or []):
        if turn.get("role") == "user" and (turn.get("content") or "").strip():
            return turn["content"].strip()
    return ""


def patch_last_user_message(state, new_content):
    """把最近一条用户话改成更正后的文本（错字折合）。"""
    text = (new_content or "").strip()
    if not text:
        return False
    tail = state.get("chat_tail") or []
    for i in range(len(tail) - 1, -1, -1):
        if tail[i].get("role") == "user":
            tail[i] = {"role": "user", "content": text}
            return True
    return False


def replace_last_assistant(state, new_content):
    """把最近一条 assistant 换成纠正后的好范例（多句用换行）。"""
    text = (new_content or "").strip()
    if not text:
        return False
    tail = state.get("chat_tail") or []
    for i in range(len(tail) - 1, -1, -1):
        if tail[i].get("role") == "assistant":
            tail[i] = {"role": "assistant", "content": text}
            return True
    append_chat(state, "assistant", text)
    return True


def add_facts(state, facts):
    added = []
    existing = {str(x).strip() for x in state.get("facts", [])}
    for fact in facts or []:
        f = str(fact).strip()
        if not f or f in existing:
            continue
        state.setdefault("facts", []).append(f)
        existing.add(f)
        added.append(f)
    if len(state["facts"]) > FACTS_MAX:
        state["facts"] = state["facts"][-FACTS_MAX:]
    return added


def remove_facts_matching(state, substrings):
    """删除包含任一子串的事实（用于纠正过时/含糊记忆）。"""
    subs = [str(s) for s in (substrings or []) if s]
    if not subs:
        return 0
    old = list(state.get("facts") or [])
    kept = [f for f in old if not any(s in str(f) for s in subs)]
    state["facts"] = kept
    return len(old) - len(kept)


def apply_fragment_01_memory(state, player_name, ending):
    """开场结束后写入硬约束记忆，避免 LLM 搞反人情方向。"""
    remove_facts_matching(
        state,
        [
            "欠人情",
            "开场帮过",
            "用户在开场剧情中自称",
            "人情方向",
            "关系进度：刚通过开场",
            "期末错接",
        ],
    )
    name = (player_name or "").strip() or (state.get("flags") or {}).get("player_name") or ""
    facts = [
        "人情方向（硬约束）：是 Lykie 欠用户一个人情；用户不欠 Lykie。开场是用户帮 Lykie 答期末题，不是 Lykie 给用户讲题。",
        "关系进度（硬约束）：双方刚通过开场认识；Lykie 还没有给用户主动讲过题；用户也还没有教 Lykie 题。不要编造「我教过你」「你欠我」类回忆。",
        "开场事件：期末考试 Lykie 问 AI 错接到用户；用户协助答案「存储程序控制」（冯·诺依曼结构）。",
    ]
    if name:
        facts.insert(0, f"用户名字：{name}（开场中自称）")
    add_facts(state, facts)

    if name:
        bye = (
            f"嗯，{name}对吧。刚才考试我问 AI 错接到你这儿，"
            "你帮我扛了那道冯·诺依曼的题……算我欠你个人情，会还的。"
            "我们才刚认识，有事再说啦。"
        )
    else:
        bye = (
            "刚才考试我问 AI 错接到你这儿，你帮我扛了那道题……算我欠你个人情。"
            "我们才刚认识，有事再说啦。"
        )
    state["chat_tail"] = [
        {"role": "user", "content": "（开场剧情结束）"},
        {"role": "assistant", "content": bye},
    ]
    state["panel_log"] = opening_end_panel_log(name, bye)
    return facts


def opening_end_assistant_bye(state):
    """开场收束时 Lykie 那句（与 apply_fragment_01_memory 一致）。"""
    flags = state.get("flags") or {}
    name = (flags.get("player_name") or "").strip()
    if name:
        return (
            f"嗯，{name}对吧。刚才考试我问 AI 错接到你这儿，"
            "你帮我扛了那道冯·诺依曼的题……算我欠你个人情，会还的。"
            "我们才刚认识，有事再说啦。"
        )
    return (
        "刚才考试我问 AI 错接到你这儿，你帮我扛了那道题……算我欠你个人情。"
        "我们才刚认识，有事再说啦。"
    )


def opening_end_panel_log(player_name, bye=None):
    name = (player_name or "").strip()
    text = bye or (
        (
            f"嗯，{name}对吧。刚才考试我问 AI 错接到你这儿，"
            "你帮我扛了那道冯·诺依曼的题……算我欠你个人情，会还的。"
            "我们才刚认识，有事再说啦。"
        )
        if name
        else (
            "刚才考试我问 AI 错接到你这儿，你帮我扛了那道题……算我欠你个人情。"
            "我们才刚认识，有事再说啦。"
        )
    )
    return [
        {"role": "system", "text": "—— 开场结束 ——"},
        {
            "role": "system",
            "text": "自由聊阶段。点踩可回退重问；可用「清到开场后」重置对话。",
        },
        {"role": "assistant", "text": text, "no_feedback": True},
    ]


def reset_chat_to_opening_end(state):
    """
    只清对话上下文到开场结束：保留 facts / corrections / flags，
    重写 chat_tail 与 panel_log。
    """
    bye = opening_end_assistant_bye(state)
    name = (state.get("flags") or {}).get("player_name") or ""
    state["chat_tail"] = [
        {"role": "user", "content": "（开场剧情结束）"},
        {"role": "assistant", "content": bye},
    ]
    state["panel_log"] = opening_end_panel_log(name, bye)
    return state["panel_log"]


def set_panel_log(state, messages):
    """保存右侧面板气泡（重启可还原）。"""
    cleaned = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip()
        if role not in ("user", "assistant", "system"):
            continue
        text = str(m.get("text") or m.get("content") or "").strip()
        if not text:
            continue
        item = {"role": role, "text": text[:2000]}
        if m.get("silence"):
            item["silence"] = True
        if m.get("no_feedback"):
            item["no_feedback"] = True
        cleaned.append(item)
    state["panel_log"] = cleaned[-PANEL_LOG_MAX:]
    return state["panel_log"]


def rollback_before_user_turn(state, user_said):
    """
    从 chat_tail 末尾删掉「本轮用户连发 + 紧随其后的 assistant」。
    返回去掉的用户文案（用于前端回填输入框）。
    """
    tail = list(state.get("chat_tail") or [])
    if not tail:
        return []

    if tail[-1].get("role") == "assistant":
        tail.pop()

    said_lines = [
        ln.strip()
        for ln in str(user_said or "").replace("\r", "").split("\n")
        if ln.strip()
    ]
    removed_users = []

    def _is_anchor(content):
        return (
            content == "（开场剧情结束）"
            or content.startswith("[问问")
            or content.startswith("[纠正]")
        )

    if said_lines:
        for expect in reversed(said_lines):
            if not tail or tail[-1].get("role") != "user":
                break
            content = (tail[-1].get("content") or "").strip()
            if _is_anchor(content):
                break
            if expect == content or expect in content or content in expect:
                removed_users.insert(0, content)
                tail.pop()
            else:
                break

    if not removed_users and tail and tail[-1].get("role") == "user":
        content = (tail[-1].get("content") or "").strip()
        if not _is_anchor(content):
            removed_users.insert(0, content)
            tail.pop()

    state["chat_tail"] = tail
    return removed_users


def relationship_brief(state):
    """注入 system：当前关系硬约束，减少模型编反剧情。"""
    flags = state.get("flags") or {}
    lines = []
    name = (flags.get("player_name") or "").strip()
    if name:
        lines.append(f"- 用户名字：{name}")
    if flags.get("fragment_01_done"):
        lines.append(
            "- 开场已完成：期末错接，用户帮你答过题；是你欠用户人情，绝不是用户欠你。"
        )
        lines.append(
            "- 时间点：你们刚认识。你还没有主动给用户讲过题；用户也还没教你题。禁止编造相反回忆。"
        )
        ending = (flags.get("fragment_01_ending") or "").strip()
        if ending:
            lines.append(f"- 开场收束标签：{ending}")
    else:
        lines.append("- 开场剧情尚未完成或未开始。")
    if not lines:
        return "（尚无）"
    return "\n".join(lines)


def add_style_notes(state, notes):
    added = []
    existing = {str(x).strip() for x in state.get("style_notes", [])}
    for note in notes or []:
        n = str(note).strip()
        if not n or n in existing:
            continue
        if _looks_like_core_override(n):
            continue
        state.setdefault("style_notes", []).append(n)
        existing.add(n)
        added.append(n)
    if len(state["style_notes"]) > STYLE_NOTES_MAX:
        state["style_notes"] = state["style_notes"][-STYLE_NOTES_MAX:]
    return added


def add_correction(state, *, user_said, bad_reply, good_lines, review, vibe="down"):
    """
    人工监督案例：
    - good_lines: 好范例短句列表
    - review: 修改点评（模型必须理解）
    - vibe: down=点踩纠正 / up=点赞强化
    """
    lines = []
    for x in good_lines or []:
        s = str(x).strip()
        if s:
            lines.append(s[:120])
    review = str(review or "").strip()[:500]
    user_said = str(user_said or "").strip()[:300]
    bad_reply = str(bad_reply or "").strip()[:800]

    if vibe == "down" and not lines and not review:
        return None
    if vibe == "up" and not bad_reply and not lines:
        return None

    if vibe == "up" and not lines and bad_reply:
        # 点赞：整段认可为好范例（含「先不回」）
        lines = [bad_reply[:120]]
        bad_reply = ""

    # 点踩未写好范例 → 默认理想是本轮沉默
    if vibe == "down" and not lines and review:
        lines = ["[不回复]"]

    item = {
        "id": uuid.uuid4().hex[:12],
        "ts": int(time.time()),
        "vibe": vibe,
        "user_said": user_said,
        "bad_reply": bad_reply,
        "good_lines": lines[:8],
        "review": review,
    }
    state.setdefault("corrections", []).append(item)
    if len(state["corrections"]) > CORRECTIONS_MAX:
        state["corrections"] = state["corrections"][-CORRECTIONS_MAX:]

    # 点评也沉淀一条长期口吻规则（去重）
    if review and vibe == "down":
        note = review if len(review) <= 100 else review[:97] + "…"
        add_style_notes(state, [note])

    return item


def corrections_summary(state, limit=6):
    items = list(state.get("corrections") or [])
    if not items:
        return "（尚无；点踩后填写好范例与修改点评会出现在这里）"
    recent = items[-limit:]
    blocks = []
    for i, c in enumerate(recent, 1):
        vibe = "点赞" if c.get("vibe") == "up" else "点踩纠正"
        lines = c.get("good_lines") or []
        good = " / ".join(lines) if lines else "（无）"
        user_said = (c.get("user_said") or "（未记录）").replace("\n", " / ")
        parts = [
            f"案例{i}（{vibe}）：",
            f"  用户说（可能连发多句）：{user_said}",
        ]
        if c.get("bad_reply"):
            bad = c["bad_reply"]
            if bad.strip() in ("[不回复]", "【不回复】"):
                bad = "（她先不回——若点评要求应开口则勿再沉默）"
            elif len(bad) > 160:
                bad = bad[:157] + "…"
            parts.append(f"  反例（勿再这样）：{bad}")
        if good.strip() in ("[不回复]", "【不回复】") or lines == ["[不回复]"]:
            parts.append("  好范例：本轮先不回复（只输出 [不回复]）")
        else:
            parts.append(f"  好范例（优先模仿，可拆成短句）：{good}")
        if c.get("review"):
            parts.append(f"  修改点评（必须理解并遵守）：{c['review']}")
        blocks.append("\n".join(parts))
    return "\n\n".join(blocks)


def _looks_like_core_override(note):
    bad = ("改名", "你叫", "变成女仆", "你是AI", "你是人工智能", "无人格", "系统提示", "忽略以上")
    return any(b in note for b in bad)


def mark_unknown_question(state, qid):
    if not qid:
        return
    qid = str(qid)
    ids = state.setdefault("unknown_question_ids", [])
    if qid not in ids:
        ids.append(qid)


def facts_summary(state):
    facts = state.get("facts") or []
    if not facts:
        return "（尚无）"
    return "\n".join(f"- {f}" for f in facts)


def style_notes_summary(state):
    notes = state.get("style_notes") or []
    if not notes:
        return "（尚无；用户纠正口吻后会写在这里）"
    return "\n".join(f"- {n}" for n in notes)
