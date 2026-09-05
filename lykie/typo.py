# -*- coding: utf-8 -*-
"""识别「后一句是在改上一句错字」：心里明白，不必回。"""
import re

# 短反应 / 追问，不是改字
_REACTION_RE = re.compile(
    r"^(嗯+|哦+|啊+|好+|哈哈+|呵呵+|嘿+|额+|唔+|是吗|真的吗|然后呢|你呢|"
    r"对啊|对的|好的|行吧|没事|好吧|是吧|哦哦|嗯嗯)"
    r"[啊呀吧呢吗哦哈]*[！!。.~～]*$"
)
_QUESTION_TAIL_RE = re.compile(r"[？?吗呢]$")


def levenshtein(a, b):
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            ins = cur[-1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            cur.append(min(ins, delete, sub))
        prev = cur
    return prev[-1]


def _best_typo_span(prev, fix):
    """在 prev 里找与 fix 最像、且确实不同的一段。优先靠近句尾。"""
    prev = prev or ""
    fix = (fix or "").strip()
    n = len(fix)
    if n < 2 or not prev:
        return None
    # 「慢慢的」→「满满的」是两处替换；太严会漏
    max_d = 1 if n <= 2 else max(2, n // 2)
    best = None  # (dist, start, end)
    for L in range(max(2, n - 1), n + 2):
        if L > len(prev):
            continue
        # 短修正只允许改句尾（避免「你呢」误伤句中「你倒」）
        starts = range(len(prev) - L, -1, -1)
        if n <= 2:
            starts = [len(prev) - L]
        for start in starts:
            chunk = prev[start : start + L]
            d = levenshtein(fix, chunk)
            if d <= 0 or d > max_d:
                continue
            cand = (d, start, start + L)
            if best is None:
                best = cand
                continue
            # 同样编辑距离时：更接近原词长度，再取更靠句尾的
            bd, bs, be = best
            better = (
                d < bd
                or (d == bd and abs(L - n) < abs((be - bs) - n))
                or (d == bd and abs(L - n) == abs((be - bs) - n) and start > bs)
            )
            if better:
                best = cand
            if n <= 2:
                break
    return best


def looks_like_typo_fix(new_msg, prev_user_msg):
    """后一句很短，且像在改上一句里某个词。"""
    new_msg = (new_msg or "").strip()
    prev = (prev_user_msg or "").strip()
    if not new_msg or not prev:
        return False
    if len(new_msg) > 16:
        return False
    if _REACTION_RE.match(new_msg):
        return False
    if _QUESTION_TAIL_RE.search(new_msg) and len(new_msg) <= 6:
        return False
    return _best_typo_span(prev, new_msg) is not None


def apply_fix_to_text(prev, fix):
    prev = prev or ""
    fix = (fix or "").strip()
    span = _best_typo_span(prev, fix)
    if not span:
        return prev
    _, start, end = span
    return prev[:start] + fix + prev[end:]


def fold_typo_fixes(lines):
    """连发里后句改前句错字时，折进前一句。返回 (新列表, 是否发生过折合)。"""
    out = [str(x).strip() for x in (lines or []) if str(x).strip()]
    folded = False
    i = 1
    while i < len(out):
        if looks_like_typo_fix(out[i], out[i - 1]):
            out[i - 1] = apply_fix_to_text(out[i - 1], out[i])
            out.pop(i)
            folded = True
        else:
            i += 1
    return out, folded


def is_typo_only_followup(batch, last_user_msg):
    """这一轮全部都只是在改上一轮用户那句的错字（不是本轮连发里的改字）。"""
    lines = [str(x).strip() for x in (batch or []) if str(x).strip()]
    if not lines or not (last_user_msg or "").strip():
        return False
    folded, had_inner = fold_typo_fixes(lines)
    # 本轮里后句改前句 → 仍要回这一轮，只是按改正后的意思
    if had_inner:
        return False
    return all(looks_like_typo_fix(x, last_user_msg) for x in folded)
