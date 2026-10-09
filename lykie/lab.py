# -*- coding: utf-8 -*-
"""开场试验台：不读正式记忆 / 口吻 / 监督 / 开场节点程序。"""
from __future__ import annotations

import json
import os
import uuid

from . import accounts as lykie_accounts
from . import llm as lykie_llm

KINDS = ("system", "think", "clock")
TAIL_MAX = 24

MIN_CORE = (
    "你是 Lykie，表面上的女大学生。口语短句，多句时每句单独一行。"
    "不要认自己是程序，不要自称 AI 助手。"
    "若应先不回，整段只输出 [不回复]。"
)

OPENING_SITUATION = (
    "你刚把这句话发进对话框（你以为对面是手机里的 AI）：\n"
    "「以前我一直想象大学会是很明亮丰富的，有很多有意思的事。"
    "可是真正开始之后，大部分日子只是上课、赶作业，好像并没有那么精彩。"
    "总是会有一点失落，怎么办？」\n"
    "按这一轮对方实际怎么说，自己判断该怎么接。不要一次摊开两边世界不同。"
)

THINK_HINT = (
    "只输出一个 JSON 对象，不要台词。"
    '{"action":"thin|chat|push|silence","why":"一两句本轮理由"}。'
    "thin=薄回；chat=正常聊天，礼貌回复即可；push=顶或扣住；silence=先不回。"
    "寒暄、报名字、普通接话用 chat，不要塞进 push。"
    "看着这一轮对方的话来选，不要复读上一轮的理由。"
)

FIRST_QUESTION = (
    "以前我一直想象大学会是很明亮丰富的，有很多有意思的事。"
    "可是真正开始之后，大部分日子只是上课、赶作业，好像并没有那么精彩。"
    "总是会有一点失落，怎么办？"
)


def _new_id():
    return uuid.uuid4().hex[:10]


def default_layers():
    return [
        {
            "id": _new_id(),
            "name": "短核",
            "kind": "system",
            "enabled": True,
            "text": MIN_CORE,
        },
        {
            "id": _new_id(),
            "name": "开场情境",
            "kind": "system",
            "enabled": True,
            "text": OPENING_SITUATION,
        },
        {
            "id": _new_id(),
            "name": "思考步",
            "kind": "think",
            "enabled": False,
            "text": THINK_HINT,
        },
        {
            "id": _new_id(),
            "name": "当前时间",
            "kind": "clock",
            "enabled": False,
            "text": "（开启后由程序填入真实本地时间，不必手写）",
        },
        {
            "id": _new_id(),
            "name": "口吻皮",
            "kind": "system",
            "enabled": False,
            "text": "短句、口语，少写成一、二、三。",
        },
        {
            "id": _new_id(),
            "name": "自定义",
            "kind": "system",
            "enabled": False,
            "text": "",
        },
    ]


def default_state():
    return {"layers": default_layers(), "chat": []}


def _path(username):
    return os.path.join(lykie_accounts.user_dir(username), "lab_bench.json")


def _norm_layer(raw, index):
    kind = str((raw or {}).get("kind") or "system").strip().lower()
    if kind not in KINDS:
        kind = "system"
    text = str((raw or {}).get("text") or "")
    if kind == "think" and "thin|push|silence" in text and "chat=" not in text:
        text = THINK_HINT
    if len(text) > 8000:
        text = text[:8000]
    name = str((raw or {}).get("name") or f"层{index + 1}").strip()[:40]
    lid = str((raw or {}).get("id") or "").strip() or _new_id()
    return {
        "id": lid[:16],
        "name": name or f"层{index + 1}",
        "kind": kind,
        "enabled": bool((raw or {}).get("enabled")),
        "text": text,
    }


def _norm_think(raw):
    if not isinstance(raw, dict):
        return None
    action = str(raw.get("action") or "").strip().lower()[:40]
    why = str(raw.get("why") or "").strip()[:240]
    if not action and not why:
        return None
    out = {"action": action or "thin", "why": why}
    if "parse_ok" in raw:
        out["parse_ok"] = bool(raw.get("parse_ok"))
    return out


def _assistant_turn(content, think=None):
    item = {"role": "assistant", "content": str(content or "")}
    th = _norm_think(think)
    if th:
        item["think"] = th
    return item


def _norm_chat(raw):
    out = []
    for turn in raw or []:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "").strip()
        content = str(turn.get("content") or turn.get("text") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        item = {"role": role, "content": content[:4000]}
        if role == "assistant":
            th = _norm_think(turn.get("think"))
            if th:
                item["think"] = th
        out.append(item)
        if len(out) >= 80:
            break
    return out


def load_state(username):
    path = _path(username)
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError, TypeError):
        return default_state()
    if not isinstance(data, dict):
        return default_state()
    layers = data.get("layers")
    if not isinstance(layers, list):
        layers = default_layers()
    else:
        layers = [_norm_layer(x, i) for i, x in enumerate(layers[:20])]
    return {"layers": layers, "chat": _norm_chat(data.get("chat"))}


def save_state(username, state):
    os.makedirs(os.path.dirname(_path(username)), exist_ok=True)
    out = {
        "layers": [_norm_layer(x, i) for i, x in enumerate((state or {}).get("layers") or [])],
        "chat": _norm_chat((state or {}).get("chat")),
    }
    if not isinstance(out["layers"], list):
        out["layers"] = default_layers()
    tmp = _path(username) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _path(username))
    return out


def enabled_layers(state):
    return [x for x in (state or {}).get("layers") or [] if x.get("enabled")]


def think_layer(state):
    for x in enabled_layers(state):
        if x.get("kind") == "think":
            return x
    return None


def assemble_system(state):
    """按列表顺序拼接已开启的 system / clock。越靠上越先写入。"""
    parts = []
    for layer in enabled_layers(state):
        kind = layer.get("kind")
        if kind == "think":
            continue
        if kind == "clock":
            body = lykie_llm.format_now_block()
        else:
            body = str(layer.get("text") or "").strip()
        if not body:
            continue
        parts.append(f"【{layer.get('name') or '层'}】\n{body}")
    return "\n\n".join(parts).strip()


def public_state(state):
    system = assemble_system(state)
    return {
        "layers": (state or {}).get("layers") or [],
        "chat": (state or {}).get("chat") or [],
        "system": system,
        "system_chars": len(system),
        "think_on": think_layer(state) is not None,
        "isolated": True,
    }


def seed_first(state):
    state = dict(state or default_state())
    state["chat"] = [{"role": "assistant", "content": FIRST_QUESTION}]
    return state


def reset_chat(state):
    state = dict(state or default_state())
    state["chat"] = []
    return state


def reset_layers(state):
    state = dict(state or default_state())
    state["layers"] = default_layers()
    return state


def _run_think(layer, chat, user_text):
    messages = [
        {"role": "system", "content": str(layer.get("text") or THINK_HINT)},
        {
            "role": "user",
            "content": "最近对话：\n"
            + ("\n".join(f"{t['role']}: {t['content'][:400]}" for t in chat[-8:]) or "（还没有）")
            + f"\n\n本轮用户：\n{user_text}",
        },
    ]
    raw = lykie_llm.chat_completion(
        messages, temperature=0.2, json_mode=True, disable_thinking=True
    )
    parsed = None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    if not isinstance(parsed, dict):
        return {"action": "thin", "why": "思考不是合法 JSON，薄回", "parse_ok": False}
    action = str(parsed.get("action") or "thin").strip().lower()
    if action not in lykie_llm.ACTION_LINES:
        action = "thin"
    why = str(parsed.get("why") or "").strip()[:240]
    return {"action": action, "why": why or "按这一轮选的", "parse_ok": True}


def chat_once(state, user_text):
    text = str(user_text or "").strip()
    if not text:
        raise ValueError("消息为空")
    if not lykie_llm.is_configured():
        raise RuntimeError("未配置 LYKIE_API_KEY")

    chat = list((state or {}).get("chat") or [])
    think = None
    layer = think_layer(state)
    if layer:
        think = _run_think(layer, chat, text)

    system = assemble_system(state)
    if think:
        action = think.get("action") or "thin"
        system = (system + "\n\n" + (lykie_llm.ACTION_LINES.get(action) or "")).strip()
        if action == "silence":
            reply = "[不回复]"
            silent = True
            new_chat = chat + [
                {"role": "user", "content": text},
                _assistant_turn(reply, think),
            ]
            state = dict(state or {})
            state["chat"] = _norm_chat(new_chat)
            return state, {"reply": "", "silent": True, "think": think, "system_chars": len(assemble_system(state))}

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    for turn in chat[-TAIL_MAX:]:
        messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": text})
    reply = lykie_llm.chat_completion(messages, temperature=0.8)
    silent = lykie_llm.is_silence_reply(reply)
    if silent:
        reply = "[不回复]"
    elif not reply:
        reply = "嗯.....那个...."
    spoken = "" if silent else reply
    new_chat = chat + [
        {"role": "user", "content": text},
        _assistant_turn("[不回复]" if silent else spoken, think),
    ]
    state = dict(state or {})
    state["chat"] = _norm_chat(new_chat)
    return state, {
        "reply": spoken,
        "silent": silent,
        "think": think,
        "system_chars": len(assemble_system(state)),
    }
