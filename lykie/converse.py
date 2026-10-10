"""Lykie 对话核心管道：单次模型调用。

替代 think→lookup→speak 三段式。一次模型调用完成全部决策——
模型直接输出回复或 [不回复]，不暴露结构化中间产物。
"""
import os

from .llm import (
    chat_completion,
    format_now_block,
    format_chat_user_batch,
    format_question_block,
    is_silence_reply,
)
from .profile import format_self_profile_block
from .memory import facts_summary, relationship_brief

_IDENTITY_CORE = None


def _load_identity_core():
    """加载身份核 prompt（≤20 行），缓存。"""
    global _IDENTITY_CORE
    if _IDENTITY_CORE is None:
        path = os.path.join(os.path.dirname(__file__), "prompt_core.txt")
        try:
            with open(path, "r", encoding="utf-8") as f:
                _IDENTITY_CORE = f.read().strip()
        except OSError:
            _IDENTITY_CORE = "你是 Lykie，一名女大学生。用口语短句聊天，不是客服。"
    return _IDENTITY_CORE


def build_messages(state, user_message, mode="chat", question_card=None, last_reply=None):
    """单次调用：全量上下文 → messages。

    注入顺序：
    1. 身份核（prompt_core.txt 精简版）
    2. 人生档案全文（self.txt）
    3. 当前时间（真实）
    4. 关系层（当前层许可）
    5. 开场剧情（如活跃）
    6. 已记住的事实
    7. 当前题目（如有）
    8. 发送格式
    9. 对话历史（最近 N 轮）
    10. 本轮用户消息
    """
    from . import opening as lykie_opening

    system = _load_identity_core()

    # ── 当前时间 ──
    system += "\n\n【当前时间（真实）】\n" + format_now_block()

    # ── 人生档案全文 ──
    system += "\n\n【你的人生档案】\n" + format_self_profile_block()

    # ── 关系层 ──
    system += "\n\n【你和这个人的关系】\n" + relationship_brief(state)

    # ── 开场剧情 ──
    if lykie_opening.is_active(state):
        flags = (state or {}).get("flags") or {}
        realized = str(flags.get("opening_beat") or "") == "realized"
        cue = str(flags.get("opening_realized_cue") or "")
        system += "\n\n" + lykie_opening.speak_block(state, realized, cue)

    # ── 已记住的事实 ──
    facts = facts_summary(state)
    if facts and facts != "（尚无）":
        system += "\n\n【你记得的关于他的事】\n" + facts

    # ── 当前题目 ──
    if question_card:
        qblock = format_question_block(question_card)
        if qblock:
            system += "\n\n【当前题目】\n" + qblock

    # ── 发送格式 ──
    system += (
        "\n\n【发送格式】闲聊优先短句；多句必须每句单独一行（换行分隔）。"
        "若应先不回，整段只输出 [不回复]。"
    )

    messages = [{"role": "system", "content": system}]

    # ── 对话历史 ──
    for turn in state.get("chat_tail") or []:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    # ── 本轮用户消息 ──
    if mode == "correct":
        user_content = (
            "用户觉得你刚才说话方式不太好。"
            "简短表示记住了，不要客服腔。\n\n"
            f"用户说：「{user_message}」\n"
        )
        if last_reply:
            clip = last_reply if len(last_reply) <= 800 else last_reply[:800] + "…"
            user_content += f"\n你上一句原话：「{clip}」"
    else:
        user_content = user_message

    messages.append({"role": "user", "content": user_content})
    return messages


def handle_message(
    state,
    user_message,
    mode="chat",
    question_card=None,
    last_reply=None,
    batch=None,
):
    """主入口：单次模型调用，返回 {reply, silent}。

    Args:
        state: 用户状态 dict（lykie_memory.load_state 返回的）
        user_message: 已格式化的用户消息文本
        mode: "chat" 或 "correct"
        question_card: 可选的题卡 dict
        last_reply: 上一轮 assistant 回复（correct 模式用）
        batch: 原始用户消息列表（用于后续处理，handle_message 内部不直接用）

    Returns:
        {"reply": str, "silent": bool}
    """
    messages = build_messages(
        state, user_message, mode=mode, question_card=question_card, last_reply=last_reply
    )

    reply = chat_completion(messages, temperature=0.8)

    silent = is_silence_reply(reply)
    if silent:
        reply = "[不回复]"
    elif not reply:
        reply = "嗯.....那个...."

    return {"reply": reply, "silent": silent}
