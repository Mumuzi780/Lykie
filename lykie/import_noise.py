# -*- coding: utf-8 -*-
"""导入已知格式噪声：整行丢弃，宁缺毋滥。

不处理无穷平台词典；只挡常见「会进题干的标题/批注行」。
题型微标如「(单选题)」留给切块逻辑，这里不删。
大题标题正则与 import_scan 共用，避免「2. 判断一下」误删。
"""
from __future__ import annotations

import re

from lykie.import_scan import is_chapter_heading_line, is_section_head_line

# 整行是解析/批注标题
ANALYSIS_HEAD_RE = re.compile(
    r"^(?:AI\s*解析|智能解析|解析如下|答案解析|题目解析)\s*[:：]?\s*$",
    re.I,
)

# 纯分值 / 题量装饰
SCORE_ONLY_RE = re.compile(r"^(?:共\s*)?\d+\s*分\s*$")
COUNT_ONLY_RE = re.compile(r"^共\s*\d+\s*题\s*$")

# 其它低误伤装饰行
DECOR_RE = re.compile(
    r"^(?:注意事项|考试说明|答题须知|本卷共|试卷总分)\s*[:：]?.*$"
)

# 章节下的关键词大纲行（「接口功能 · 并行/串行…」）
OUTLINE_DOT_RE = re.compile(
    r"^[^\d（(参考答案][^·\n]{0,48}(?:\s*·\s*[^·\n]+){1,8}\s*$"
)

_NOISE_RES = (
    ANALYSIS_HEAD_RE,
    SCORE_ONLY_RE,
    COUNT_ONLY_RE,
    DECOR_RE,
    OUTLINE_DOT_RE,
)


def is_noise_line(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    if is_section_head_line(s):
        return True
    if is_chapter_heading_line(s):
        return True
    return any(r.match(s) for r in _NOISE_RES)


def filter_noise_lines(lines: list[str]) -> list[str]:
    """去掉已知噪声行，保留其余（含题型微标、题干、选项、答案）。"""
    return [ln for ln in lines if not is_noise_line(ln)]
