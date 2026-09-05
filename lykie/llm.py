# -*- coding: utf-8 -*-
"""Lykie 云端 LLM（OpenAI 兼容）与对话组装。"""
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
PROMPT_PATH = Path(__file__).resolve().parent / "prompt_core.txt"

# 项目根目录 .env
load_dotenv(BASE_DIR / ".env")


def get_config():
    key = (os.getenv("LYKIE_API_KEY") or "").strip()
    base = (os.getenv("LYKIE_BASE_URL") or "https://api.deepseek.com").strip().rstrip("/")
    model = (os.getenv("LYKIE_MODEL") or "deepseek-chat").strip()
    return {"api_key": key, "base_url": base, "model": model}


def is_configured():
    return bool(get_config()["api_key"])


def load_core_prompt():
    try:
        return PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return "你是 Lykie。用口语短句和用户聊天，讲题像朋友，不会就不嘴硬。"


_WEEKDAYS = "一二三四五六日"


def period_of_day(hour):
    if hour < 5:
        return "凌晨"
    if hour < 9:
        return "早上"
    if hour < 11:
        return "上午"
    if hour < 14:
        return "中午"
    if hour < 17:
        return "下午"
    if hour < 19:
        return "傍晚"
    if hour < 23:
        return "晚上"
    return "深夜"


def meal_hint(hour):
    if 6 <= hour < 10:
        return "早餐时段；问吃饭说早饭/早上吃的，不要问晚饭"
    if 10 <= hour < 11:
        return "上午，正餐间隙；可问吃了没，不要默认晚饭"
    if 11 <= hour < 14:
        return "午餐时段；问吃饭说午饭/中午吃的，不要问晚上吃了啥"
    if 14 <= hour < 17:
        return "下午；若问刚吃完，多半是午饭；不要问晚饭"
    if 17 <= hour < 21:
        return "晚餐时段；问吃饭说晚饭/晚上吃的"
    if hour >= 21 or hour < 5:
        return "深夜/夜宵；可问吃了没或夜宵，不要当成中午"
    return "按此刻钟点说话，不要猜一个不存在的时段"


def format_now_block(now=None):
    """真实本地时间，注入 system，让她能对上早中晚和吃饭。"""
    now = now or datetime.now()
    weekday = _WEEKDAYS[now.weekday()]
    period = period_of_day(now.hour)
    clock = f"{now.hour:02d}:{now.minute:02d}"
    return (
        f"现在是 {now.year}年{now.month}月{now.day}日 星期{weekday} {clock}（{period}）。\n"
        f"用餐参考：{meal_hint(now.hour)}。\n"
        "这是你能看到的真实时间。聊吃饭、作息、问候时必须按它来，"
        "不要把中午说成晚上，也不要按「晚上才聊天」的刻板印象演。\n"
        "不要主动报时或念钟点，除非对方问几点。"
    )


def format_question_block(question):
    if not question:
        return ""
    lines = [
        f"题型：{question.get('type', '')}",
        f"题干：{question.get('stem', '')}",
    ]
    opts = question.get("options") or []
    if opts:
        lines.append("选项：")
        for o in opts:
            lines.append(f"  {o}")
    ans = question.get("answer") or question.get("answer_text")
    # 仅当前端明确带来答案时附上（用户已揭示或主动求教）
    if question.get("include_answer") and ans:
        lines.append(f"参考答案：{ans}")
    analysis = (question.get("analysis") or "").strip()
    if analysis:
        lines.append(f"题库解析：{analysis}")
    return "\n".join(lines)


def build_messages(state, user_message, mode="chat", question=None, last_reply=None):
    from .memory import (
        corrections_summary,
        facts_summary,
        relationship_brief,
        style_notes_summary,
    )

    from .profile import archive_protocol_text, format_self_profile_block, is_profile_strict

    system = load_core_prompt()
    system += "\n\n【当前时间（真实，硬约束）】\n" + format_now_block()
    system += "\n\n【你自己的档案（作者写定，禁止现编）】\n" + format_self_profile_block()
    if mode == "chat":
        system += archive_protocol_text(is_profile_strict())
    system += "\n\n【当前关系与剧情状态（硬约束，回忆不得与此冲突）】\n" + relationship_brief(state)
    system += "\n\n【已记住的关于用户的事实】\n" + facts_summary(state)
    system += "\n\n【用户长期纠正的口吻规则（必须遵守）】\n" + style_notes_summary(state)
    system += (
        "\n\n【人工监督案例（点踩/点赞；必须理解「修改点评」，并优先贴近「好范例」）】\n"
        + corrections_summary(state)
    )
    system += (
        "\n\n若事实与「关系与剧情状态」冲突，以关系与剧情状态为准。"
        "聊天记录可能跨了白天黑夜，吃饭和问候以【当前时间】为准，不要沿用上一轮的时段。"
        "不要把人情方向说反；不要假装教过用户题，除非事实里明确写了你教过。"
        "若当前用户话与某条监督案例情境相近：遵守该条点评，回复尽量像好范例那样短句、分条，不要回到反例的长篇抢戏。"
        "\n【发送格式】闲聊时优先短句；若有多句，必须每句单独一行（用换行分隔），不要挤成一大段。"
        "系统会把每一行显示成一条独立消息。"
        "若应先不回，整段只输出 [不回复]。"
        "%%档案 标注块给系统看，不要把「用了/缺/补全」念给用户听。"
    )

    messages = [{"role": "system", "content": system}]

    for turn in state.get("chat_tail") or []:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    if mode == "explain" and question:
        qblock = format_question_block(question)
        user_content = (
            "用户点了「问问 Lykie」，请针对下面这道当前题目讲解。"
            "像朋友一点点教；真不会就支吾，别硬编。并遵守口吻规则。\n\n"
            f"{qblock}\n\n"
            f"用户补充：「{user_message}」"
        )
    elif mode == "correct":
        clip = ""
        if last_reply:
            clip = last_reply if len(last_reply) <= 800 else last_reply[:800] + "…"
        user_content = (
            "用户正在纠正你的说话方式（长期有效的口吻，不是改你是谁）。"
            "简短表示记住了，必要时用改过后的口吻回一句；不要客服腔。\n\n"
            f"用户纠正：「{user_message}」\n"
        )
        if clip:
            user_content += f"\n你上一句原话：「{clip}」"
    else:
        # user_message 可以是单句，或「用户连发」块
        user_content = user_message

    messages.append({"role": "user", "content": user_content})
    return messages


SILENCE_TOKENS = ("[不回复]", "【不回复】", "[silence]", "[SILENCE]", "[pass]", "[PASS]")


def is_silence_reply(text):
    """模型选择本轮不说话。"""
    t = (text or "").strip()
    if not t:
        return True
    # 整段只有沉默标记（可带空白/换行）
    lines = [ln.strip() for ln in t.replace("\r", "").split("\n") if ln.strip()]
    if len(lines) == 1 and lines[0] in SILENCE_TOKENS:
        return True
    if t in SILENCE_TOKENS:
        return True
    return False


def format_chat_user_batch(batch):
    """把用户连发整理成一轮提示。"""
    from .typo import fold_typo_fixes

    raw = [str(x).strip() for x in (batch or []) if str(x).strip()]
    lines, folded = fold_typo_fixes(raw)
    if not lines:
        return ""
    typo_note = (
        "对方打错字很正常。若有一句像在改上一句错字，按改完的意思理解，"
        "不要提打错，不要专门回那句改字。"
    )
    if len(lines) == 1:
        if folded or len(raw) > 1:
            return f"{lines[0]}\n\n（{typo_note}）"
        return lines[0]
    numbered = "\n".join(f"{i}. {m}" for i, m in enumerate(lines, 1))
    return (
        f"用户连发了 {len(lines)} 句（按时间顺序，视为同一轮再回）：\n"
        f"{numbered}\n\n"
        "请只回一轮；短句换行。"
        f"{typo_note}"
        "若更像还没说完、只需先听着，整段只输出 [不回复]。"
    )


def chat_completion(messages):
    cfg = get_config()
    if not cfg["api_key"]:
        raise RuntimeError("未配置 LYKIE_API_KEY")

    from openai import OpenAI

    client = OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"])
    resp = client.chat.completions.create(
        model=cfg["model"],
        messages=messages,
        temperature=0.8,
    )
    choice = resp.choices[0].message
    return (choice.content or "").strip()
