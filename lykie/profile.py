# -*- coding: utf-8 -*-
"""Lykie 个人档案：读取、严格模式、回复里的档案标注。"""
import os
import re
from pathlib import Path

SELF_PROFILE_PATH = Path(__file__).resolve().parent / "self.txt"
PROSE_PATH = Path(__file__).resolve().parent / "profile_prose.txt"

_STRICT_RE = re.compile(r"^严格模式\s*[:：]\s*(\S+)", re.MULTILINE)
_META_RE = re.compile(r"%%档案\s*\n(.*?)\n%%\s*", re.DOTALL)
_TRUE = {"开", "on", "true", "1", "yes", "是"}
_FALSE = {"关", "off", "false", "0", "no", "否"}


def load_self_profile():
    try:
        return SELF_PROFILE_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _profile_source():
    """auto：已发布散文存在则用散文，否则回退 self.txt；legacy：强制 self.txt。"""
    mode = (os.environ.get("LYKIE_PROFILE_SOURCE") or "auto").strip().lower()
    if mode == "legacy":
        return load_self_profile(), "legacy"
    try:
        prose = PROSE_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        prose = ""
    if prose:
        return prose, "atlas"
    return load_self_profile(), "legacy"


def is_profile_strict(raw=None):
    text = raw if raw is not None else load_self_profile()
    m = _STRICT_RE.search(text or "")
    if not m:
        return True
    v = m.group(1).strip().strip("。．. ").lower()
    if v in _FALSE:
        return False
    if v in _TRUE:
        return True
    return True


def _split_items(s):
    s = (s or "").strip()
    if not s or s in ("无", "沒", "没有", "無", "-", "none", "n/a"):
        return []
    parts = re.split(r"[；;、|/]+", s)
    return [p.strip() for p in parts if p.strip() and p.strip() not in ("无", "没有")]


def parse_archive_meta(text):
    """从模型输出里拆出档案标注，正文里不再带 %% 块。"""
    raw = (text or "").strip()
    m = _META_RE.search(raw)
    empty = {
        "reply": raw,
        "used": [],
        "missing": [],
        "invented": [],
        "fill": False,
        "has_meta": False,
    }
    if not m:
        return empty
    inner = m.group(1)
    reply = (raw[: m.start()] + raw[m.end() :]).strip()
    used, missing, invented = [], [], []
    fill = False
    for line in inner.splitlines():
        line = line.strip()
        if not line:
            continue
        if "：" in line:
            k, v = line.split("：", 1)
        elif ":" in line:
            k, v = line.split(":", 1)
        else:
            continue
        k, v = k.strip(), v.strip()
        if k in ("用了", "档案用了", "used"):
            used = _split_items(v)
        elif k in ("缺", "缺少", "未定", "missing"):
            missing = _split_items(v)
        elif k in ("现编", "現編", "invented", "编的"):
            invented = _split_items(v)
        elif k in ("补全", "請補全", "fill"):
            fill = v.lower() in _TRUE or v in ("要", "需要")
    return {
        "reply": reply,
        "used": used,
        "missing": missing,
        "invented": invented,
        "fill": fill,
        "has_meta": True,
    }


def format_self_profile_block():
    body, source = _profile_source()
    strict = is_profile_strict(load_self_profile())
    if strict:
        head = (
            "当前是【严格模式 / 测试补全档案】。\n"
            "档案里写了的私事才能当成你的真事说出来。\n"
            "没写或标了未定的私事：不要现编。可以只接用户的话、反问、表情，或 [不回复]。\n"
            "需要那些私事才能接下去时：标注「补全：是」，并在「缺」里写清要补哪一栏、补什么。"
        )
    else:
        head = (
            "当前是【正式体验】。档案里有的当真事；未定的可以含糊或薄编，"
            "但必须在标注里列出「现编」，不要装成档案里写过。"
        )
    if not body:
        return head + "\n（档案文件缺失：一切具体私事都按未定处理。）"
    return head + "\n\n" + body


def archive_protocol_text(strict):
    example = (
        "%%档案\n"
        "用了：无\n"
        "缺：近期日程（今天中午吃了什么）\n"
        "现编：无\n"
        "补全：是\n"
        "%%\n"
    )
    if strict:
        return (
            "\n【档案标注（闲聊每一轮都必须，可放在回复开头或末尾）】\n"
            "先写或后写如下块，块外才是给用户看的话：\n"
            f"{example}"
            "用了：本轮真正用到的档案要点，没有则写无。\n"
            "缺：本轮需要但档案未写/未定的私事，没有则写无。\n"
            "现编：严格模式下必须写无；不要发明课表、菜单、行程、家庭、游戏名。\n"
            "补全：只要「缺」不是无，就必须为是；此时不要在给用户的话里说出那些私事。\n"
            "单纯接对方的吃了什么、上课怎样，不需要你自己的档案细节时：补全为否，正常短句回。\n"
            "问你「你吃了没/你在干嘛/你不上课吗」而档案没写：补全为是，话里不要编答案。"
        )
    return (
        "\n【档案标注（闲聊每一轮都必须）】\n"
        "%%档案\n用了：…\n缺：…\n现编：…\n补全：否\n%%\n"
        "档案里有的放「用了」；你自己编的私事必须放「现编」，不要假装档案里有。"
    )


def format_profile_notices(meta, strict):
    """给面板用的系统提示，不进模型上下文。"""
    notes = []
    used = meta.get("used") or []
    missing = meta.get("missing") or []
    invented = meta.get("invented") or []
    fill = bool(meta.get("fill"))
    if used:
        notes.append({"kind": "used", "text": "档案用了：" + "；".join(used)})
    if strict:
        need = list(missing)
        if invented:
            need.extend(invented)
            fill = True
        if fill or need:
            if not need:
                need = ["（本轮需要私事，但没写清缺哪一条）"]
            lines = ["请补全档案（/atlas 或 lykie/self.txt），补完再说一遍即可"]
            for item in need:
                lines.append("· " + item)
            notes.append({"kind": "fill", "text": "\n".join(lines)})
        if not meta.get("has_meta"):
            notes.append({
                "kind": "warn",
                "text": "本轮没有档案标注，内容可能是现编，请当不可靠",
            })
    else:
        if invented:
            notes.append({"kind": "invented", "text": "现编（档案没有）：" + "；".join(invented)})
        if missing:
            notes.append({"kind": "missing", "text": "档案未定：" + "；".join(missing)})
        if not meta.get("has_meta"):
            notes.append({"kind": "warn", "text": "本轮没有档案标注"})
    return notes


def _field_value(raw, name):
    for line in (raw or "").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith(name + "：") or s.startswith(name + ":"):
            return s.split("：", 1)[-1].split(":", 1)[-1].strip()
    return ""


def profile_runtime_info():
    """给状态栏用：已装入助手的档案摘要（不含作者层秘密）。"""
    raw, _source = _profile_source()
    if not raw:
        return {"loaded": False, "strict": True, "bits": []}
    major = _field_value(raw, "专业")
    if "（" in major:
        major = major.split("（", 1)[0].strip()
    housing = _field_value(raw, "住哪")
    bits = []
    if major:
        bits.append(major)
    if "宿舍" in housing:
        bits.append("宿舍")
    if "【课表】" in raw and "来源：" in raw:
        bits.append("课表")
    return {
        "loaded": True,
        "strict": is_profile_strict(load_self_profile()),
        "bits": bits,
    }
