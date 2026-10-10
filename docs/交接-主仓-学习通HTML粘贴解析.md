# 交接：学习通 HTML 粘贴解析（二期）

> 给**主仓**。规格已定，按本文实现；冲突时以本文为准。
> 日期：2026-10-10（v2：依据新增样本 2/3 扩展至全题型）
> 前置：一期「学习通纯文本规整器」已落地（[`交接-主仓-学习通纯文本规整.md`](交接-主仓-学习通纯文本规整.md)、`lykie/import_platform.py`）。二期是**并列的新管道**，不改动一期行为。

---

## 要做什么 / 不要做什么

- 做：导入页粘贴时读取剪贴板 `text/html`，后端用 **DOM 适配器**直接解析出结构化题目，绕过脏文本规整与切块流水线。
- 做：支持五种题型（单选 / 多选 / 判断 / 填空 / 简答·论述），依据三份真实样本，不猜。
- 做：用户手势零变化——照旧复制 → 粘贴；HTML 读不到或非学习通 → 完全走现有纯文本管道。
- **不要：引入任何新依赖**（无 bs4/lxml，用标准库 `html.parser`，理由见规格 A）。
- 不要：调用任何模型。
- 不要：改动一期的 `import_platform.py`、`import_exemplar.py` 既有行为。
- 未在样本中出现的题型（名词解释、连线等）→ 跳过计数，不猜结构。

---

## 现状锚点

- `/api/import_text` 请求体：`{text, exemplar, exemplars, preview, name?, answer_picks?, ack_skipped_types?, import_sa}`（[import.js](../static/import.js) L662 预览、L703 入库两次调用）。
- 一期已在 `/api/import_text` 里先跑 `normalize_if_known`。
- 标准题目结构（`import_rules.shape_*` 产物）：
  - choice：`{num, stem, options, answer(字母串), analysis, type:"choice"}`，非标准答案才带 `needs_answer_confirm`
  - judge：`{..., options: [], answer:"对"|"错", type:"judge"}`（归一化用 `import_rules.JUDGE_TRUE/JUDGE_FALSE`）
  - fill：answer = 单字符串，多空以全角 `；` 连接、空内半角 `;` 原样
  - short_answer：`{num, stem, options: [], answer:"1. …
2. …", analysis, type:"short_answer", points:[{index, text, keywords:[], is_preamble:False}]}`（见 [import_rules.py](../lykie/import_rules.py) `shape_short_answer_block` L382-457；points 文本剥 `1.`/`（1）` 前缀）
- 项目题型词汇：`choice / fill / judge / short_answer`；`app.py` L1835 用 `short_answer` 检测简答。**论述题无独立词汇 → 映射为 `short_answer`**。
- 依赖（[requirements.txt](../requirements.txt)）：flask / python-docx / openai / python-dotenv / waitress——**零 HTML 库**。

---

## DOM 事实（三份真实样本解剖，本规格的权威依据）

样本（临时根目录文件，fixture 生成后以 fixture 为准）：

| 文件 | 题量构成 | 特有特征 |
|---|---|---|
| 作业详情.html（样本1） | 36 单选 + 10 填空 | 基线结构 |
| 作业详情2.html（样本2） | 9 单选 + 9 填空 + 2 简答 + 1 论述 | 简答/论述结构；题干含内层 span |
| 作业详情3.html（样本3） | 4 单选 + 4 多选 + 3 填空 + 4 判断 | 题型带分值；判断汉字答案；多选字母串；答案解析 |

**题目容器**：`div.marBom60.questionLi`，每题一个。**陷阱**：所有题型的容器 class 都含 `singleQuesId`（连填空/简答也是）——**题型绝不能从容器 class 判断**，必须读 `span.colorShallow` 文本。

### 公共部分

- 题号：`h3.mark_name` 裸文本头（`1. `）。
- 题型：`h3 > span.colorShallow`，两种变体：`(单选题)`、`(单选题, 6分)`——**剥 `, N分` 后缀**再取词。
- 题干：`h3 > span.qtContent`。有的内包 `<p>`（样本1/2），有的裸文本（样本3 选择/判断）；样本2 有内层 `<span style="text-wrap-mode: nowrap;">`。解析须兼容：剥所有内层标签、`&nbsp;` 转空格（`convert_charrefs=True` 默认开）、合并空白。
- 答案解析（**可选**，样本1/2 无、样本3 有）：`div.analysisDiv > span.qtAnalysis`，前缀文本 `答案解析：` → 填 `analysis` 字段。
- 噪声（一律忽略）：`span.element-invisible-hidden`（复制文本脏化元凶）、`div.mark_score`、`a.aiAssistant`、`dl.mark_fill`（**无** colorGreen，即"我的答案"块）、script/style。

### choice（单选 + 多选，样本1 / 样本3 L321-358）

- 选项：`ul.mark_letter > li`，一选项一个 li，`A. 内容` → 剥 `X. ` 前缀按字母归位。
- 答案：非 dl 语境的 `span.rightAnswerContent`，**字母串**（`A` 或 `ABC`）→ 直接作 `answer`，不设 `needs_answer_confirm`。

### judge（样本3 L656-691）

- 选项同样是 `ul.mark_letter`（`A. 对 / B. 错`）——**丢弃，输出 `options: []`**（与项目 judge 产物对齐）。
- 答案：非 dl 语境 `span.rightAnswerContent` = **汉字** `对`/`错`。按 `JUDGE_TRUE/JUDGE_FALSE` 校验归一；对不上 → 跳过计数。

### fill（样本1 / 样本2 / 样本3 L489-533）

- 正确答案：`dl.mark_fill.colorGreen > dd.rightAnswerContent`，**一空一个 dd**，dd 内 `(k) <p>内容</p>` → 剥 `(k)` 前缀。
- **清理**：空内容尾部可能挂 `<br>`（样本3 实测 `测试集<br>`）→ 块级标签转空格后 trim。
- 多空 = 多 dd，按序全角 `；` 连接；空内备选半角 `;` 原样（一期约定）。

### short_answer（简答 / 论述，样本2 L864-895 简答、L943-976 论述）

- 结构：`div.mark_answer_key.pad0 > dl.mark_fill.colorGreen > dd.rightAnswerContent`，答案为**多个块级段落**（`<p>`，空段 `<p><br></p>`）。
- points 映射：每个非空 `<p>` → 一个 point（剥 `1.`/`（1）` 行首编号、`keywords: []`、`is_preamble: False`），`answer = "1. …
2. …"`，与 `shape_short_answer_block` 产物同构。
- 论述题 `(论述题)` → 同样按 short_answer 解析，`type: "short_answer"`。

### 与剪贴板选区的差异（必须兼容）

另存页有完整外壳；剪贴板复制的是**片段**——可能从任意层级开始、结尾截断。适配器**按片段设计**：扫描 class 含 `questionLi` 的 div 就切题，不依赖 html/body 结构，容忍尾部未闭合标签（HTMLParser 流式天然容忍）。

---

## 规格 A · 新模块 `lykie/import_dom.py`

```python
def looks_like_xuexitong_html(html: str) -> bool
    """含 'questionLi' 或 'rightAnswerContent' 即命中。"""
def parse_xuexitong_html(html: str) -> tuple[list[dict], str | None]
    """返回 (标准题目列表, 错误信息)。无题可解 → ([], '原因')。"""
```

- 标准库 `html.parser.HTMLParser` 流式状态机。**不引第三方 HTML 库**。
- 状态机骨架：div 深度计数；进入 class 含 `questionLi` 的 div 开新题；子状态收 colorShallow（题型）、qtContent（题干）、`mark_letter > li`（choice 选项）、非 dl 语境 `rightAnswerContent`（choice/judge 答案）、`dl.mark_fill.colorGreen` 内逐 `dd`（fill / short_answer 答案）、`qtAnalysis`（解析）。
- 题型映射表：`单选题/选择题→choice`、`多选题→choice`、`判断题→judge`、`填空题→fill`、`简答题/论述题→short_answer`；表外题型 → 跳过计数。
- 输出对齐标准题目结构（见现状锚点）；`needs_answer_confirm` 一律不设（DOM 答案是平台权威值）；`num` 取题号。
- 文本规整：块级标签边界转空格、合并连续空白，与一期产出风格一致（最终以验收为准）。

## 规格 B · 前端（`static/import.js`）

- 粘贴框 `#importText` 加 `paste` 监听：`e.clipboardData.getData('text/html')` 非空且含 `questionLi` / `rightAnswerContent` 子串 → 存入模块级变量 `pasteHtml`；`text/plain` 照旧落入文本框（兜底展示）。
- L662 / L703 两处 `/api/import_text` 请求体追加可选字段 `html: pasteHtml || undefined`。
- 手动输入、docx 路径无 `paste` 事件 → 无 html，行为与现状完全一致。
- 响应 meta 带 `platform` 时预览页可显示提示（`xuexitong-html` → 「已按学习通网页格式解析」；文案不硬性要求）。

## 规格 C · 后端接入（`app.py` `/api/import_text`）

- 入口处：请求体可选字段 `html`；若 `html` 且 `looks_like_xuexitong_html(html)` → `questions, err = parse_xuexitong_html(html)`。
- 有题 → **跳过** `normalize_if_known` 与样板解析，`questions` 直接进入现有预览/入库阶段（与 `_resolve_import_questions` 产出的下游对齐；meta 注入 `platform: "xuexitong-html"`）。含 `short_answer` 题时与既有 `import_sa` 分流逻辑正常衔接（L1835 检测照常工作）。
- `err` 非空或零题 → 回落纯文本管道并 meta 注入 `platform: "xuexitong-html-fallback"`（可观测降级，不报错打断用户）。
- 无 html 或未命中特征 → 与现状逐字节一致。

## 规格 D · fixture 与样本登记

1. `tests/fixtures/import/xuexitong_html_001.html`：样本1 裁题（36 单选 + 10 填空），去 script/无关外层，保留完整 DOM。
2. `tests/fixtures/import/xuexitong_html_002.html`：样本2 裁题（21 题，含 2 简答 + 1 论述）。
3. `tests/fixtures/import/xuexitong_html_003.html`：样本3 裁题（15 题，含 4 多选 + 4 判断 + 答案解析块）。
4. `tests/fixtures/import/xuexitong_html_004.html`：**片段版**——从某个 `questionLi` 开始、截尾不闭合（至少 1 单选 + 1 多空填空 + 1 判断），模拟剪贴板选区。
5. 临时《作业详情*.html》三份转为上述 fixture 后**删除根目录原件**（处置随本次一并完成）。
6. [`进题导入-脏文本样本.md`](进题导入-脏文本样本.md) 登记四份 fixture 与 DOM 陷阱结论（容器 class 全是 singleQuesId、题型带分值变体、判断答案是汉字、invisible span、填空答案挂 `<br>`、qtContent 有无 `<p>` 两种）。

---

## 验收

- [ ] fixture 001：46 题（36 单选 + 10 填空）全解析，单选答案全为字母、无 `needs_answer_confirm`，多空答案 `4；0` 等。
- [ ] fixture 002：21 题全解析（9 单选 + 9 填空 + 3 short_answer，其中论述并入 short_answer）；简答 points 结构与 `shape_short_answer_block` 产物同构（points / answer 编号行格式）。
- [ ] fixture 003：15 题全解析（8 choice 含 4 多选字母串 + 3 fill + 4 judge）；judge `answer` ∈ {对, 错}、`options: []`；`analysis` 从 qtAnalysis 正确提取（选择题1-4）。
- [ ] fixture 004（片段）通过；尾截断不崩。
- [ ] **交叉验收（最强）**：fixture 001 剥出纯文本跑一期 `normalize_if_known` + 样板流水线，两通道产出的题干/选项/答案**逐题一致**（此即自动答案核对）。不一致的题逐个人工裁决后修订其中一侧。（样本2/3 无用户真实粘贴文本，不做交叉，用结构断言验收。）
- [ ] 无 html 字段 / 非学习通 HTML → 全流程行为与现状完全一致（一期 fixtures 回归不变）。
- [ ] `requirements.txt` 零新增；无任何模型调用。

## 边界

- 五题型已由三份样本覆盖；表外题型（名词解释、连线、样本里没出现过的）跳过计数，不猜。日后遇到按样本库流程另攒采样再扩。
- DOM 随学习通改版漂移的风险由一期文本管道兜底——**一期规整器永久保留**。
- 站对站直连学习通接口：不做（此前已定论）。

---

## 附：v2 修订记录

- 依据样本2/3 新增：多选 / 判断 / 简答 / 论述支持；题型带分值变体；判断汉字答案；qtAnalysis 解析提取；填空答案 `<br>` 清理；qtContent 无 `<p>` 兼容。
- fixture 由 2 份扩为 4 份；交叉验收限定样本1（其余用结构断言）。
- 原「不支持判断/多选/简答」条款废除。
