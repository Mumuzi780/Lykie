"""Lykie 对话核心管道：单次模型调用。

替代 think→lookup→speak 三段式。一次模型调用完成全部决策——
模型直接输出回复或 [不回复]，不暴露结构化中间产物。
"""
import os
import re

from .llm import (
    chat_completion,
    format_now_block,
    format_chat_user_batch,
    format_question_block,
    is_silence_reply,
)
from .profile import format_self_profile_block
from .memory import READ_TO_STAGE, facts_summary, relationship_brief

_IDENTITY_CORE = None

# 关系读数：模型每轮自报感受（门语义，无表现规则），程序只做护栏裁定。
# 文案定稿见 docs/交接-主仓-开局出口与阶段自动升层.md §4，禁止加条件式升层规则。
_REL_READ_PROMPT = (
    "【关系读数】每次回复的最后一行，单独附一条：%%关系:读数%%\n"
    "读数按你此刻真实的感受，从这些里挑一个：\n"
    "开局 / 认识但不熟悉 / 能说事 / 能谈心 / 情侣\n"
    "- 认识但不熟悉：知道对方是谁，仅此而已\n"
    "- 能说事：日常话题都聊得开\n"
    "- 能谈心：愿意跟对方说心里话\n"
    "- 情侣：你已认定这层关系\n"
    "这行标记不会给对方看见，除它之外不要输出任何标记。"
)
# 信号载体对齐 profile._META_RE 先例（模型带 %%…%% 标记、程序剥离、正文干净），
# 但语义不同（读数 vs 档案标注），独立常量，勿复用档案正则。
_REL_READ_RE = re.compile(r"[ \t]*%%关系\s*[:：]([^\n%]*)%%[ \t]*")
_READ_TAIL_MARKS = "，。！？；、,.!?;:：~…·—"


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

    # ── 关系读数（仅 chat 注入；correct 是纠正轮，不注入） ──
    if mode == "chat":
        system += "\n\n" + _REL_READ_PROMPT

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


def _match_rel_word(raw):
    """读数原词整词匹配；词后允许紧跟标点/空白，其余不认（"能说事情"≠"能说事"）。"""
    text = str(raw or "").strip()
    if not text:
        return ""
    for word in READ_TO_STAGE:
        if text.startswith(word):
            rest = text[len(word):].strip()
            if not rest or all(ch in _READ_TAIL_MARKS for ch in rest):
                return word
    return ""


def parse_rel_read(text):
    """从模型输出剥离 %%关系:读数%% 标记，返回 {reply, read}（对齐 profile.parse_archive_meta 先例）。"""
    raw = text or ""
    m = _REL_READ_RE.search(raw)
    if not m:
        return {"reply": raw, "read": ""}
    reply = (raw[: m.start()] + raw[m.end():]).strip()
    return {"reply": reply, "read": _match_rel_word(m.group(1))}


def handle_message(
    state,
    user_message,
    mode="chat",
    question_card=None,
    last_reply=None,
    batch=None,
):
    """主入口：单次模型调用，返回 {reply, silent, rel_read}。

    Args:
        state: 用户状态 dict（lykie_memory.load_state 返回的）
        user_message: 已格式化的用户消息文本
        mode: "chat" 或 "correct"
        question_card: 可选的题卡 dict
        last_reply: 上一轮 assistant 回复（correct 模式用）
        batch: 原始用户消息列表（用于后续处理，handle_message 内部不直接用）

    Returns:
        {"reply": str, "silent": bool, "messages": list, "temperature": float, "rel_read": str}
        messages = 实际发给模型的完整 messages（供轮次留痕，禁止重组）
        rel_read = 解析出的读数原词（无标记/无效为 ""），reply 已剥离标记、进 chat_tail 前干净
    """
    messages = build_messages(
        state, user_message, mode=mode, question_card=question_card, last_reply=last_reply
    )

    temperature = 0.8
    reply = chat_completion(messages, temperature=temperature)

    # 剥离 %%关系:读数%% 标记再判 silent/空回复（QQ 网关同管道，零改动即干净）
    parsed = parse_rel_read(reply)
    reply = parsed["reply"]
    rel_read = parsed["read"]

    silent = is_silence_reply(reply)
    if silent:
        reply = "[不回复]"
    elif not reply:
        reply = "嗯.....那个...."

    return {
        "reply": reply,
        "silent": silent,
        "messages": messages,
        "temperature": temperature,
        "rel_read": rel_read,
    }
