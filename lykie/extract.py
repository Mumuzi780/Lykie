# -*- coding: utf-8 -*-
"""从用户话中抽取日常事实 / 口吻纠正（失败则跳过）。"""
import json
import re

EXTRACT_FACTS_SYSTEM = """你从用户刚刚说的话里抽取 0～2 条关于「用户本人日常/习惯/偏好」的短事实。
只输出 JSON 数组，例如 ["经常熬夜","周末打游戏"] 或 []。
不要抽取情绪发泄、羞辱骂人、口吻纠正、关于 Lykie 改名/换身份的要求。不要解释。"""

EXTRACT_STYLE_SYSTEM = """用户在纠正 Lykie 的说话方式（口吻/风格），不是改她是谁。
根据「用户纠正」和可选的「上一句 Lykie 原话」，提炼 1～2 条可长期遵守的短规则。
规则要具体可执行，例如「讲题不要分点罗列」「少用加粗和标题」「用短句像朋友随口说」。
不要写成改名、换身份、自称 AI、忽略人设等。
只输出 JSON 数组，例如 ["讲题用短句，不要一二三列表"] 或 []。不要解释。"""

EXTRACT_NAME_SYSTEM = """用户在自我介绍或回答「你叫什么」。请提取其【名字/称呼】本身。
规则：
- 只输出名字，不要「我叫」「我是」等前缀，不要标点，不要解释。
- 例：「我叫李子峰」→ 李子峰；「我是小周」→ 小周；「李子峰」→ 李子峰
- 若没有可识别的名字，只输出 EMPTY
- 不要输出昵称说明或整句原文"""

EXTRACT_PORTRAIT_SYSTEM = """你在看用户刚刚对 Lykie 说的话（可能多句）。判断两件事，只输出一个 JSON 对象，不要解释。
- offense：是否构成对 Lykie 的羞辱、辱骂、恶意调侃身份，或态度很冲的查户口。礼貌提问、普通自我介绍、无恶意玩笑 → false。
- apology：是否在道歉（对不起/抱歉/我不该那样）。
格式只能是：
{"offense":false,"apology":false}
{"offense":true,"apology":false,"kind":"羞辱","summary":"叫她爹地"}
{"offense":false,"apology":true}
kind 只能是 羞辱、辱骂、查户口 之一。summary 不超过 16 字，不要复述脏字。
「你生气了」「在吗」以及换话题的正常闲聊不是新的 offense。"""

CORRECTION_PREFIX_RE = re.compile(
    r"^(纠正|口吻纠正|风格纠正)[:：\s]+",
    re.IGNORECASE,
)

NAME_PREFIX_RE = re.compile(
    r"^(我叫|我是|叫我|名字(?:叫|是)|我的名字(?:叫|是))\s*",
)

NAME_TRAIL_RE = re.compile(r"[的呢啊呀吧了喔哦哈呀嘞啦～~\s！!。.?？、，,]+$")


def local_extract_name(text):
    """规则抽取自称名字；失败返回空串。"""
    s = (text or "").strip()
    if not s:
        return ""
    s = NAME_PREFIX_RE.sub("", s).strip()
    s = NAME_TRAIL_RE.sub("", s).strip()
    s = re.sub(r"^[「『\"']|[」』\"']$", "", s).strip()
    if not s:
        return ""
    if re.search(r"输入姓名|玩家名字|玩家输入", s):
        return ""
    if len(s) > 20:
        return ""
    # 仍像整句自我介绍则再剥一层
    if NAME_PREFIX_RE.match(s):
        s = NAME_PREFIX_RE.sub("", s).strip()
    return s[:40]


def extract_player_name(user_message, llm_chat_fn=None):
    """优先 LLM 抽名字；失败或未配置则用规则。"""
    text = (user_message or "").strip()
    if not text:
        return ""
    if llm_chat_fn:
        messages = [
            {"role": "system", "content": EXTRACT_NAME_SYSTEM},
            {"role": "user", "content": text},
        ]
        try:
            raw = (llm_chat_fn(messages) or "").strip()
            raw = raw.splitlines()[0].strip() if raw else ""
            raw = re.sub(r"^['\"「『]|['\"」』]$", "", raw).strip()
            if raw and raw.upper() != "EMPTY" and "输入" not in raw:
                cleaned = local_extract_name(raw) or raw
                cleaned = NAME_PREFIX_RE.sub("", cleaned).strip()
                cleaned = NAME_TRAIL_RE.sub("", cleaned).strip()
                if cleaned and len(cleaned) <= 20 and "我叫" not in cleaned and "我是" not in cleaned:
                    return cleaned[:40]
        except Exception:
            pass
    return local_extract_name(text)

CORRECTION_HINTS = (
    "纠正",
    "太AI",
    "太像AI",
    "太像讲义",
    "别这样说",
    "不要这样说",
    "别分点",
    "不要分点",
    "太官方",
    "太客服",
    "换个说法",
    "口吻",
    "说话方式",
)


def strip_correction_prefix(text):
    t = (text or "").strip()
    return CORRECTION_PREFIX_RE.sub("", t).strip() or t


def is_explicit_correction(text):
    return bool(CORRECTION_PREFIX_RE.match((text or "").strip()))


def looks_like_correction(text):
    t = (text or "").strip()
    if not t:
        return False
    if is_explicit_correction(t):
        return True
    return any(h in t for h in CORRECTION_HINTS)


def extract_facts_from_utterance(user_message, llm_chat_fn):
    text = (user_message or "").strip()
    if len(text) < 4:
        return []
    messages = [
        {"role": "system", "content": EXTRACT_FACTS_SYSTEM},
        {"role": "user", "content": text},
    ]
    try:
        raw = llm_chat_fn(messages)
    except Exception:
        return []
    return _parse_string_list(raw, max_items=2, max_len=80)


def extract_style_notes(user_message, last_reply, llm_chat_fn):
    text = strip_correction_prefix(user_message)
    if len(text) < 2:
        return []
    payload = f"用户纠正：{text}"
    if last_reply:
        # 截断避免过长
        clip = last_reply if len(last_reply) <= 800 else last_reply[:800] + "…"
        payload += f"\n\n上一句 Lykie 原话：{clip}"
    messages = [
        {"role": "system", "content": EXTRACT_STYLE_SYSTEM},
        {"role": "user", "content": payload},
    ]
    try:
        raw = llm_chat_fn(messages)
    except Exception:
        return []
    return _parse_string_list(raw, max_items=2, max_len=100)


def _parse_string_list(raw, max_items=2, max_len=80):
    if not raw:
        return []
    raw = raw.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if m:
        raw = m.group(1).strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m2 = re.search(r"\[[\s\S]*\]", raw)
        if not m2:
            return []
        try:
            data = json.loads(m2.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    out = []
    for item in data[:max_items]:
        s = str(item).strip()
        if s and len(s) <= max_len:
            out.append(s)
    return out


_PORTRAIT_OFFENSE_MARKS = (
    "你有病",
    "聊个屁",
    "我是你爹",
    "你爹地",
    "傻逼",
    "去死",
    "你妈的",
)
_PORTRAIT_APOLOGY_MARKS = ("对不起", "抱歉", "我向你道歉", "我不该")


def _portrait_fallback(text):
    t = text or ""
    apology = any(m in t for m in _PORTRAIT_APOLOGY_MARKS)
    offense = any(m in t for m in _PORTRAIT_OFFENSE_MARKS)
    out = {"offense": offense, "apology": apology}
    if offense:
        out["kind"] = "羞辱"
        out["summary"] = "出言不逊"
    return out


def _parse_portrait_event(raw):
    if not raw:
        return None
    raw = raw.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if m:
        raw = m.group(1).strip()
    data = None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m2 = re.search(r"\{[\s\S]*\}", raw)
        if not m2:
            return None
        try:
            data = json.loads(m2.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    offense = bool(data.get("offense"))
    apology = bool(data.get("apology"))
    out = {"offense": offense, "apology": apology}
    if offense:
        kind = str(data.get("kind") or "羞辱").strip()
        if kind not in ("羞辱", "辱骂", "查户口"):
            kind = "羞辱"
        out["kind"] = kind
        out["summary"] = str(data.get("summary") or "").strip()[:16]
    return out


def extract_portrait_event(user_message, llm_chat_fn=None):
    """本轮是否羞辱/道歉。失败则关键词兜底。"""
    text = (user_message or "").strip()
    if len(text) < 2:
        return {"offense": False, "apology": False}
    if llm_chat_fn:
        messages = [
            {"role": "system", "content": EXTRACT_PORTRAIT_SYSTEM},
            {"role": "user", "content": text[:800]},
        ]
        try:
            raw = llm_chat_fn(messages)
            parsed = _parse_portrait_event(raw)
            if parsed is not None:
                return parsed
        except Exception:
            pass
    return _portrait_fallback(text)
