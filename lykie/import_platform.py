# -*- coding: utf-8 -*-
"""平台脏文本规整：已知平台复制格式 → 流水线标准形态。

流水线位置：
  拿到原文 → **本模块规整（命中才改）** → 扫描（import_scan）→ 噪声 → 切块 → 成题

只收学习通答题页复制格式；纯正则/状态机，零模型调用。
未命中检测时原样返回，零副作用。以后新平台另立规整器，不做通用框架。
"""
from __future__ import annotations

import re

from lykie import import_scan as scan

# 选择/判断答案行：我的答案:A:内容;正确答案:A:内容;;
CORRECT_LETTER_RE = re.compile(r"正确答案\s*[:：]\s*([A-H]{1,6})\s*[:：.、．]")
CORRECT_JUDGE_RE = re.compile(r"正确答案\s*[:：]\s*(正确|错误|对|错|√|×)")

# 填空答案块：我的答案：独占一行 → 跳到 正确答案：独占一行 → 收集 (k) 编号块
MY_ANSWER_ONLY_RE = re.compile(r"^我的答案\s*[:：]\s*$")
CORRECT_ONLY_RE = re.compile(r"^正确答案\s*[:：]\s*$")
BLANK_NO_RE = re.compile(r"^[（(]\d+[)）]\s*$")

# 噪声行
AI_EXPLAIN_RE = re.compile(r"^AI\s*讲解\s*$")
DECIMAL_SCORE_RE = re.compile(r"^\d+\.\d+\s*分\s*$")

# 题号后粘连题型微标：1. (单选题) / 14. (单选题)某进程…将(
NUM_TYPE_TAG_RE = re.compile(
    r"^(\d+)[.、．]\s*[（(](单选题|多选题|判断题|填空题|简答题|选择题)[)）]\s*(.*)$"
)

PLATFORM_XUEXITONG = "xuexitong"

_JUDGE_TRUE = {"对", "正确", "√"}


def looks_like_xuexitong(text: str) -> bool:
    """学习通答题页特征：含「正确答案」且含「我的答案」或「AI讲解」。"""
    s = text or ""
    if "正确答案" not in s:
        return False
    return ("我的答案" in s) or ("AI讲解" in s)


def normalize_if_known(text: str) -> tuple[str, str | None]:
    """命中已知平台 → (规整后文本, 平台名)；否则 → (原文, None)。"""
    if looks_like_xuexitong(text):
        return _normalize_xuexitong(text), PLATFORM_XUEXITONG
    return text, None


def _fill_block_end(line: str) -> bool:
    """填空答案块终结：题号行 / 大题标题 / 题型微标行 / AI讲解 / 我的答案。"""
    s = (line or "").strip()
    if not s:
        return False
    if AI_EXPLAIN_RE.match(s) or "我的答案" in s:
        return True
    if scan.is_section_head_line(s):
        return True
    # is_item_start 覆盖题号行与题型微标行
    return scan.is_item_start(s)


def _normalize_xuexitong(text: str) -> str:
    """按行状态机规整学习通文本。规则顺序：填空块 → 答案行 → 噪声 → 微标。"""
    lines = (text or "").splitlines()
    out: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].strip()
        i += 1
        if not line:
            continue

        # 填空答案块：「我的答案：」独占一行 → 丢弃到「正确答案：」→ 收集 (k) 块
        if MY_ANSWER_ONLY_RE.match(line):
            while i < n and not CORRECT_ONLY_RE.match(lines[i].strip()):
                i += 1
            if i < n:
                i += 1  # 跳过「正确答案：」行
            answers: list[str] = []
            parts: list[str] = []
            open_blank = False
            while i < n:
                s = lines[i].strip()
                if not s:
                    i += 1
                    continue
                if BLANK_NO_RE.match(s):
                    if open_blank:
                        answers.append(" ".join(parts).strip())
                    parts = []
                    open_blank = True
                    i += 1
                    continue
                if _fill_block_end(s):
                    break
                if DECIMAL_SCORE_RE.match(s):
                    i += 1
                    continue
                if open_blank:
                    parts.append(s)
                    i += 1
                    continue
                break
            if open_blank:
                answers.append(" ".join(parts).strip())
            answers = [a for a in answers if a]
            if answers:
                # 空与空之间用全角；；一空内部备选保留原文半角 ;
                out.append("答案：" + "；".join(answers))
            continue

        # 选择/判断答案行：行内含「正确答案」→ 整行替换为标准答案行
        if "正确答案" in line:
            m = CORRECT_LETTER_RE.search(line)
            if m:
                out.append(f"答案：{m.group(1)}")
                continue
            m = CORRECT_JUDGE_RE.search(line)
            if m:
                out.append("答案：对" if m.group(1) in _JUDGE_TRUE else "答案：错")
                continue
            out.append(line)
            continue

        # 噪声行：AI讲解 / 小数分值 / 不含「正确答案」的我的答案行
        if AI_EXPLAIN_RE.match(line) or DECIMAL_SCORE_RE.match(line):
            continue
        if "我的答案" in line:
            continue

        # 题号后粘连微标剥离：14. (单选题)某进程… → 14. 某进程…
        m = NUM_TYPE_TAG_RE.match(line)
        if m:
            out.append(f"{m.group(1)}. {m.group(3)}".rstrip())
            continue

        # 其余行原样保留（含大题标题行）
        out.append(line)
    return "\n".join(out)
