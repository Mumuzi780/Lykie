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
    model = (os.getenv("LYKIE_MODEL") or "deepseek-flash").strip()
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


def chat_completion(messages, temperature=0.8, json_mode=False, disable_thinking=False):
    cfg = get_config()
    if not cfg["api_key"]:
        raise RuntimeError("未配置 LYKIE_API_KEY")

    from openai import OpenAI

    client = OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"])
    kwargs = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": temperature,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if disable_thinking:
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}

    try:
        resp = client.chat.completions.create(**kwargs)
    except Exception:
        if json_mode or disable_thinking:
            kwargs.pop("response_format", None)
            kwargs.pop("extra_body", None)
            resp = client.chat.completions.create(**kwargs)
        else:
            raise
    choice = resp.choices[0].message
    return (choice.content or "").strip()
