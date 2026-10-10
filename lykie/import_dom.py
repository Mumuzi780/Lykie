# -*- coding: utf-8 -*-
"""学习通 HTML DOM 适配器：剪贴板 text/html → 标准题目。

流水线位置：
  粘贴 text/html（学习通答题页结构化 DOM）→ **本模块直解出题**
  → 预览/入库下游（绕过 import_platform 规整与样板切块流水线）

结构依据三份真实另存页解剖（docs/交接-主仓-学习通HTML粘贴解析.md）：
  - 题目容器 div class 含 questionLi（各题型 class 全含 singleQuesId，
    题型绝不能从容器 class 判断，必须读 h3 > span.colorShallow 文本）
  - choice/judge 答案：非 dl 语境 span.rightAnswerContent（字母串 / 汉字对错）
  - fill / 简答答案：dl.mark_fill.colorGreen 内逐 dd.rightAnswerContent
  - 噪声一律忽略：element-invisible-hidden、mark_score、aiAssistant、
    无 colorGreen 的 mark_fill（「我的答案」块）、script/style

只用标准库 html.parser 流式状态机；零第三方依赖、零模型调用。
按片段设计：不依赖 html/body 外壳，容忍剪贴板选区从任意层级开始、尾部截断。
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

from lykie import import_rules

PLATFORM_XUEXITONG_HTML = "xuexitong-html"

# 题型词 → 项目题型；表外题型不在表内 → 跳过计数，不猜
_TYPE_MAP = {
    "单选题": "choice",
    "选择题": "choice",
    "多选题": "choice",
    "判断题": "judge",
    "填空题": "fill",
    "简答题": "short_answer",
    "论述题": "short_answer",
}

# 题型带分值变体：(单选题, 6分)
_SCORE_SUFFIX_RE = re.compile(r"[,，]\s*\d+(?:\.\d+)?\s*分\s*$")
# 题号：h3.mark_name 裸文本头「1. 」
_NUM_PREFIX_RE = re.compile(r"^(\d+)")
# 填空空号前缀：dd 内「(1) 」
_FILL_NO_RE = re.compile(r"^[（(]\d+[)）]\s*")
# 简答分点行首编号：1. / 1) / （1）
_POINT_NO_RE = re.compile(r"^(?:\d+[.、．)]\s*|[（(]\d+[)）]\s*)")
# 选项字母前缀：A. 内容
_OPTION_RE = re.compile(r"^([A-Za-z])\s*[.、．:：]\s*(.*)$", re.S)

# 自闭合元素：不参与深度计数
_VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}

# 块级边界：捕获文本时转空白分隔
_BLOCK_TAGS = {
    "p", "div", "li", "dd", "dt", "dl", "ul", "ol", "table", "tr",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article",
}


def looks_like_xuexitong_html(html: str) -> bool:
    """学习通答题页 HTML 特征：含 questionLi 或 rightAnswerContent 即命中。"""
    s = html or ""
    return ("questionLi" in s) or ("rightAnswerContent" in s)


def _flatten(buf: str) -> str:
    """捕获文本规整：&nbsp; 转空格、块边界与连续空白合并为单空格。"""
    return re.sub(r"\s+", " ", (buf or "").replace("\u00a0", " ")).strip()


def _classes(attrs: list[tuple[str, str | None]]) -> set[str]:
    for k, v in attrs:
        if k == "class" and v:
            return set(v.split())
    return set()


class _QTParser(HTMLParser):
    """学习通题目页流式状态机。

    cur 非空表示正在题内；cap 记录当前文本捕获槽
    （num/type/stem/option/answer/blank/analysis），cap_tag/cap_depth
    用于嵌套同名标签时准确定位捕获终点。skip 栈记录整块忽略区域
    （script/style/invisible/mark_score/aiAssistant/非 colorGreen mark_fill）。
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.questions: list[dict] = []
        self.skipped = 0
        self.saw_li = False

        self.depth = 0          # 当前打开的元素数
        self.cur: dict | None = None
        self.cur_d: dict | None = None
        self.q_depth = 0        # 题目容器 div 的元素深度

        self.cap: str | None = None
        self.cap_tag = ""
        self.cap_depth = -1
        self.buffers: dict[str, list[str]] = {}
        self.options: dict[str, str] = {}   # 字母 → 选项内容（choice 用）
        self.opt_seq = 0                    # 无字母前缀选项的兜底序号

        self.skip: list[tuple[str, int]] = []   # (tag, 元素深度)
        self.dl_depth = 0
        self.green_depth = -1
        self.in_green = False
        self.letter_depth = -1
        self.in_letter = False

    # ---- HTMLParser 事件 ----

    def handle_starttag(self, tag, attrs):
        self._on_start(tag, attrs, self_closing=False)

    def handle_startendtag(self, tag, attrs):
        self._on_start(tag, attrs, self_closing=True)

    def handle_endtag(self, tag):
        if self.depth > 0:
            self.depth -= 1
        el = self.depth
        # 结构区计数先回退（跳过区内的 dl/ul 也要配对，防止漂移）
        if tag == "dl":
            self.dl_depth = max(0, self.dl_depth - 1)
            if self.in_green and el == self.green_depth:
                self.in_green = False
        elif tag == "ul":
            if self.in_letter and el == self.letter_depth:
                self.in_letter = False
        if self.skip:
            top_tag, top_depth = self.skip[-1]
            if top_tag == tag and top_depth == el:
                self.skip.pop()
                return
        if self.cur is not None:
            self._on_end_in_question(tag, el)

    def handle_data(self, data):
        if self.skip or self.cap is None:
            return
        self.buffers.setdefault(self.cap, []).append(data)

    def close(self):
        super().close()
        if self.cur is not None:
            self._finalize()

    # ---- 状态机 ----

    def _on_start(self, tag, attrs, *, self_closing: bool):
        cls = _classes(attrs)
        el = self.depth

        # 结构区标记（跳过区内也要计数，保证配对）
        if tag == "dl":
            self.dl_depth += 1
            if "mark_fill" in cls and "colorGreen" in cls:
                self.in_green = True
                self.green_depth = el
        elif tag == "ul" and "mark_letter" in cls:
            self.in_letter = True
            self.letter_depth = el

        if self._skip_start(tag, cls, el):
            if not (self_closing or tag in _VOID_TAGS):
                self.depth += 1
            return

        if tag == "div" and "questionLi" in cls:
            # 异常嵌套防御：上一题未闭合就来新题，先收上一题
            if self.cur is not None:
                self._finalize()
            self.saw_li = True
            self.cur = {}
            self.cur_d = {"num": "", "type_raw": "", "stem": "",
                          "answer": "", "blanks": [], "analysis": ""}
            self.q_depth = el
            self.options = {}
            self.opt_seq = 0
            if not (self_closing or tag in _VOID_TAGS):
                self.depth += 1
            return

        if self.cur is not None:
            self._cap_start(tag, cls, el)

        if not (self_closing or tag in _VOID_TAGS):
            self.depth += 1

    def _skip_start(self, tag: str, cls: set[str], el: int) -> bool:
        """整块忽略区域：进栈后其内文本/嵌套捕获一律无视。"""
        hit = (
            tag in ("script", "style")
            or "element-invisible-hidden" in cls
            or "mark_score" in cls
            or "aiAssistant" in cls
            or (tag == "dl" and "mark_fill" in cls and "colorGreen" not in cls)
        )
        if hit:
            self.skip.append((tag, el))
        return hit

    def _cap_start(self, tag: str, cls: set[str], el: int):
        if self.cap == "num" and tag == "span":
            # h3 裸文本题号到此为止，切进子 span 捕获
            self._cap_end_now()

        if self.cap is not None:
            # 捕获中遇到块级边界只补分隔符；不叠开新捕获
            if tag == "br" or tag in _BLOCK_TAGS:
                self.buffers.setdefault(self.cap, []).append("\n")
            return

        if tag == "h3" and "mark_name" in cls:
            self._begin("num", tag, el)
        elif tag == "span":
            if "colorShallow" in cls:
                self._begin("type", tag, el)
            elif "qtContent" in cls:
                self._begin("stem", tag, el)
            elif "qtAnalysis" in cls:
                self._begin("analysis", tag, el)
            elif "rightAnswerContent" in cls and self.dl_depth == 0:
                # 非 dl 语境 → choice / judge 答案
                self._begin("answer", tag, el)
        elif tag == "li" and self.in_letter:
            self._begin("option", tag, el)
        elif tag == "dd" and self.in_green and "rightAnswerContent" in cls:
            # dl.mark_fill.colorGreen 内 → fill / 简答答案，一空一个 dd
            self._begin("blank", tag, el)

    def _begin(self, cap: str, tag: str, el: int):
        self.cap = cap
        self.cap_tag = tag
        self.cap_depth = el
        self.buffers[cap] = []  # 捕获不嵌套，每次开槽即清空

    def _cap_end_now(self):
        """立即收当前捕获（嵌套切换 / 容器终结用）。"""
        cap = self.cap
        self.cap = None
        if not cap or self.cur_d is None:
            return
        text = _flatten("".join(self.buffers.get(cap) or []))
        d = self.cur_d
        if cap == "num":
            m = _NUM_PREFIX_RE.match(text)
            d["num"] = m.group(1) if m else ""
        elif cap == "type":
            # 剥外层括号与「, N分」后缀
            d["type_raw"] = _SCORE_SUFFIX_RE.sub(
                "", text.strip().strip("()（）").strip()
            ).strip()
        elif cap == "stem":
            d["stem"] = text
        elif cap == "answer":
            d["answer"] = text
        elif cap == "analysis":
            d["analysis"] = text
        elif cap == "option":
            m = _OPTION_RE.match(text)
            if m:
                self.options[m.group(1).upper()] = m.group(2).strip()
            elif text:
                self.opt_seq += 1
                self.options[chr(ord("A") + self.opt_seq - 1)] = text
        elif cap == "blank":
            # 保留 \n 块边界（简答分点靠它切段），后按题型各自清理
            d["blanks"].append("".join(self.buffers.get(cap) or []))

    def _on_end_in_question(self, tag: str, el: int):
        if self.cap is not None and tag == self.cap_tag and el == self.cap_depth:
            self._cap_end_now()
        elif self.cap is not None and (tag == "br" or tag in _BLOCK_TAGS):
            self.buffers.setdefault(self.cap, []).append("\n")

        if tag == "div" and el == self.q_depth:
            self._finalize()

    def _finalize(self):
        cur, d = self.cur, self.cur_d
        self.cur = None
        self.cur_d = None
        self.cap = None
        self.in_green = False
        self.in_letter = False
        if cur is None or not d:
            return
        q = self._build_question(d)
        if q:
            self.questions.append(q)
        else:
            self.skipped += 1

    def _build_question(self, d: dict) -> dict | None:
        """题型词映射并产出标准题目；表外题型 / 残题返回 None 跳过计数。"""
        qtype = _TYPE_MAP.get(d.get("type_raw") or "")
        stem = d.get("stem") or ""
        if not qtype or not stem:
            return None
        num = d.get("num") or ""
        analysis = re.sub(r"^答案解析\s*[:：]\s*", "", d.get("analysis") or "").strip()

        if qtype == "choice":
            raw = (d.get("answer") or "").strip()
            if not raw:
                return None
            letters = sorted(self.options.keys())
            return {
                "num": num, "stem": stem,
                "options": [self.options[k] for k in letters],
                "answer": re.sub(r"\s+", "", raw).upper(),
                "analysis": analysis, "type": "choice",
            }

        if qtype == "judge":
            raw = (d.get("answer") or "").strip().lower()
            if raw in import_rules.JUDGE_TRUE:
                ans = "对"
            elif raw in import_rules.JUDGE_FALSE:
                ans = "错"
            else:
                return None
            # DOM 里 A. 对/B. 错 选项丢弃，与项目 judge 产物对齐
            return {
                "num": num, "stem": stem, "options": [],
                "answer": ans, "analysis": analysis, "type": "judge",
            }

        if qtype == "fill":
            blanks = [
                _flatten(_FILL_NO_RE.sub("", b or ""))
                for b in (d.get("blanks") or [])
            ]
            if not blanks or not any(blanks):
                return None
            # 多空按序全角；连接；空内备选半角 ; 原样（一期约定）
            return {
                "num": num, "stem": stem, "options": [],
                "answer": "；".join(blanks), "analysis": analysis,
                "type": "fill",
            }

        # short_answer（简答 / 论述）：dd 内块级段落 → points
        paras = []
        for p in ((d.get("blanks") or [""])[0]).split("\n"):
            p = _POINT_NO_RE.sub("", p.replace("\u00a0", " ")).strip()
            if p:
                paras.append(p)
        if not paras:
            return None
        points = [
            {"index": i + 1, "text": t, "keywords": [], "is_preamble": False}
            for i, t in enumerate(paras)
        ]
        answer = "\n".join(f"{p['index']}. {p['text']}" for p in points)
        return {
            "num": num, "stem": stem, "options": [], "answer": answer,
            "analysis": analysis, "type": "short_answer",
            "points": points, "keywords": [],
        }


def parse_xuexitong_html(html: str) -> tuple[list[dict], str | None]:
    """学习通 HTML → (标准题目列表, 错误信息)。无题可解 → ([], 原因)。

    题目结构与 import_rules.shape_* 产物同构；needs_answer_confirm 一律不设
    （DOM 答案是平台权威值）。表外题型 / 残题跳过计数，不猜。
    """
    s = html or ""
    if not s.strip():
        return [], "HTML 为空"
    parser = _QTParser()
    try:
        parser.feed(s)
        parser.close()
    except Exception as e:  # 剪贴板脏 HTML 兜底，不让异常打断导入
        return [], f"HTML 解析异常：{e}"
    if not parser.saw_li:
        return [], "未发现学习通题目块（questionLi）"
    if not parser.questions:
        return [], f"学习通题目块均无法解析（跳过 {parser.skipped} 块）"
    return parser.questions, None
