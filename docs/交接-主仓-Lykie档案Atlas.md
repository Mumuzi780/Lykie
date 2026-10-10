# 交接-主仓：Lykie 档案 Atlas（条目化 + 分节可视化 + 散文渲染）

> 起草：顾问智能体，2026-10-10。供作者审改后交主仓执行。
> 上游讨论结论（已与作者对齐）：
> - 碎片（条目）适合作者管理；模型需要明确因果。**两套标准 = 源 + 派生，不是两份平行档案**
> - 散文版由 LLM **离线渲染 + 作者逐条审核后发布**，运行时只读；运行时**永远不**现场改写档案
>
> **修订（2026-10-11，作者拍板，优先级高于下文旧表述）**：
> 1. **因果边取消**：`edges` 字段废弃（数据里保留不用），渲染器不做"因为…所以…"改写，编辑器不做连线模式
> 2. **权重单位改为分节**：档案条目不再逐条分层；条目增加 `section` 字段（身份卡/世界观/…，与重构后的 self.txt 分节对齐），节有权重（决定总览展示顺序与散文渲染中节的顺序）。`secret/undecided/verbatim` 默认由节继承（如【她不知道的真相】整节 secret、【未定清单】整节 undecided、【课表】整节 verbatim），条目级 flag 字段保留以支持例外。`layer` 字段此后只用于"他的画像" facts
> 3. **拆条粒度**：只拆"填空式"字段条目（姓名、生日、学校这类改一个词就改完的）；有因果/语义关联的句群**不拆**，整段作为一个条目，编辑时整段修改
> 4. **阶段二内容变更**（同心圆方案取消）：分节总览页（节卡片 + 权重编辑 + 节级 flag 展示）→ 点进某节进入条目页（字段条目填空式编辑；段落块整段编辑）；条目的 secret/undecided/verbatim 视觉标记保留
> 5. **画像侧同步且只读**：他的画像 Tab 与档案侧样式同步（两级页面：分层总览 → 钻取条目），但**只读不可编辑**——无改文字/换层/删除入口，`/api/atlas/facts/save` 取消；facts 的层级仅作分组展示，手动升层入口不在本期

---

## 一、背景与目标

现状：`lykie/self.txt`（143 行自然语言长文）是 Lykie 档案的唯一载体，`profile.py::format_self_profile_block` 全文注入。两个问题：

1. **作者侧**：内容多了分不清什么重要、什么不重要，无法可视化查看和编辑
2. **模型侧**：143 行是"平"的——核身份和一个爱好权重一样；碎片之间的因果全靠模型自由脑补，每次可能拼出不同版本，行为漂移

目标：把档案拆成**带圈层的句子条目 + 显式因果边**（作者在图形界面编辑），再渲染成**分节散文**（注入给模型）。作者获得可视化与掌控，模型获得分层与钦定因果。

## 二、红线（违反任何一条即返工）

1. **self.txt 只读**：迁移期间与迁移后，代码一律不得写 `lykie/self.txt`。它是存档与兜底
2. **运行时零改写**：任何模型调用不得在请求-响应路径里改写档案；散文渲染只在作者显式点击"渲染"时发生，且**发布前不生效**
3. **内容保真**：verbatim 条目（课表等表格类）与 undecided 条目（未定禁编）渲染时**逐字拷贝，不过 LLM**
4. **严格模式协议不破坏**：`严格模式`开关、`%%档案` 标注协议、`format_profile_notices` 的补全提示全部保留（仅提示文案从"请补全 lykie/self.txt"改为"请在 /atlas 补全档案"）
5. **作者层禁语不泄露**：secret 条目渲染进独立的【作者层·禁止说出口】段，永不出现在对用户的输出约束之外

## 三、数据结构

### A. 条目文件 `lykie/profile_entries.json`（全站共用一份，随部署打包）

```json
{
  "version": 1,
  "strict": true,
  "prose_stale": false,
  "prose_published_at": null,
  "entries": [
    {
      "id": "e001",
      "text": "她叫 Lykie，2007 年生，复读一年，现在是河北科技师范学院（秦皇岛校区）2026 级大一学生，人工智能专业。",
      "layer": "core",
      "secret": false,
      "undecided": false,
      "verbatim": false,
      "edges": [],
      "source": "self.txt#L11-L16",
      "updated": "2026-10-10"
    }
  ]
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `layer` | `core`（核：身份与世界设定）/ `stable`（稳：长期人生事实）/ `current`（摆：近期状态）。她的档案不用 `floating`——浮层预留给将来的 memories.json（关键事件），同心圆第四环先留空位 |
| `secret` | true = 作者层禁语（如"那场重病她没挺过来"），渲染进【作者层·禁止说出口】 |
| `undecided` | true = 未定禁编（如"高中校名未定"），渲染进【不要由模型发明的】，**逐字拷贝** |
| `verbatim` | true = 渲染时逐字保留（课表块、锚点清单这类表格/清单），**不过 LLM** |
| `edges` | 因果边数组，语义为"本条是原因，指向结果"：渲染成"因为<本条>，所以<目标条>" |

### B. 散文文件 `lykie/profile_prose.txt`（派生物，只读，发布时整体写入）

分节结构（由渲染器产出，节的标题固定，`profile.py` 拼装 strict 头部后注入）：

```
【你是谁（核）】
…core 条目（含"因为…所以…"句）…

【你的人生（稳）】
…stable 条目…

【你最近的状态（摆）】
…current 条目…

【作者层·禁止说出口】
…secret 条目…

【不要由模型发明的】
…undecided 条目逐字 + verbatim 块逐字…
```

- 【课表】整个块作为一个 `verbatim: true` 的条目存放在 stable 层，渲染时原样进入稳节（保证 `profile_runtime_info` 里 `"【课表】" in raw` 等解析继续工作）
- 渲染器提示词要求：保留 `专业：…`、`住哪：…` 行首字段写法（`profile_runtime_info` 依赖）；只允许重组措辞，不允许增删事实
- `prose_stale: true` 时**继续使用旧散文**，编辑器显示"档案已修改，散文待重新渲染"黄点

### C. facts 对象化（用户画像侧）

`state["facts"]` 从字符串列表升级为对象列表：

```json
{"text": "他是李子峰，通过这个网站认识", "layer": "core", "added": "2026-10-10"}
```

- `memory.py::add_facts` 写入时包对象；读取处兼容旧字符串（load 时惰性迁移：字符串 → `{"text": s, "layer": "floating"}`）；`facts_summary`、`remove_facts_matching`、FACTS_MAX 截断逻辑对 `text` 字段工作，行为不变
- 新事实默认 `layer: "floating"`；作者在 /atlas 里手动升层

## 四、/atlas 编辑器（作者工具，仅 LiZF 可见，复用现有作者门禁）

### 页面与文件

- 路由：`GET /atlas`；模板 `templates/atlas.html`；前端 `static/atlas.js`（原生 JS + SVG，**不建新构建管线**）；样式 `static/atlas.css`
- 新后端模块 `lykie/atlas.py`：entries 读写（JSON 原子写 + `_lock`）、prose 发布、stale 管理、facts 层级操作

### 布局

```
/atlas
├─ 顶部：Tab[她的档案 | 他的画像] · [渲染散文] [发布] · stale 黄点
├─ 左侧：SVG 同心圆画布（4 环：核/稳/摆/浮）
│   ├─ 条目 = 圆点，按层落环，环内简单环绕布局（不引入物理引擎）
│   ├─ 核环条目更大更靠中心；secret 锁形图标；undecided 虚线边框
│   └─ 连线模式：开关切换后点 A 再点 B 生成因果边 A→B；点边删除
├─ 右侧：编辑面板（点条目弹出）：改文字 / 下拉换层 / 勾选 secret·undecided·verbatim / 删除
└─ 每环 "+" 按钮：新增条目到该层
```

### 交互要点

- **拖拽换层**：条目从"摆"拖到"稳" = 升格为长期事实；拖入浮环的条目（她的档案侧）提示"浮层预留给运行时记忆，请放摆层"
- **保存**：整表保存（`POST /api/atlas/entries/save`，单作者场景足够）；任何保存置 `prose_stale: true`
- **渲染**：`POST /api/atlas/render` → 调 `lykie.llm.chat_completion` 生成散文草稿，**只在编辑器里展示，不生效**
- **发布**：作者审核草稿后 `POST /api/atlas/publish` → 原子写入 `lykie/profile_prose.txt`，清 stale，记录时间
- **他的画像 Tab**：读当前账号 `state.facts`（对象化后），同样同心圆（他的核=名字/怎么认识的，浮=对话事实），支持改层/改文字/删除（`POST /api/atlas/facts/save`）

### API 一览

| 路由 | 方法 | 作用 |
|---|---|---|
| `/atlas` | GET | 页面（作者门禁） |
| `/api/atlas/state` | GET | entries + meta + stale + 当前散文 + facts |
| `/api/atlas/entries/save` | POST | 整表保存条目，置 stale |
| `/api/atlas/render` | POST | LLM 渲染草稿（不落盘） |
| `/api/atlas/publish` | POST | 审核后发布散文，清 stale |
| `/api/atlas/facts/save` | POST | 保存画像 facts（含层级/删除） |

## 五、注入切换（profile.py + converse.py）

1. `format_self_profile_block` 改为：`profile_prose.txt` 存在且非空 → 注入 prose（strict 头照旧拼）；否则回退读 `self.txt`（现状）
2. A/B 对比开关：环境变量 `LYKIE_PROFILE_SOURCE=legacy|auto`，默认 `auto`；设为 `legacy` 强制走 self.txt，用于回归对照
3. `profile_runtime_info`：继续解析注入源文本（渲染器保证字段可解析，见四-B）；`【课表】` verbatim 条目保证该函数不受影响
4. `format_profile_notices` 里补全提示文案改为"请在 /atlas 补全档案"
5. converse.py **不需要改**（它调的就是 `format_self_profile_block`）——这是本方案不动已冻结管道的验证点

## 六、迁移流程（self.txt → 条目，作者亲手拆）

1. 主仓交付后，作者打开 /atlas，点"从 self.txt 导入草稿"：后端把 self.txt **按行**生成未分层的草稿条目（`source` 记录行号），全堆在"未分组"栏，**不做任何自动分层判断**
2. 作者逐条：改写成完整自然句（去字段腔）→ 分层 → 打 secret / undecided / verbatim 标 → 连因果边
3. 迁移期注入照旧走 self.txt（prose 未发布），零风险
4. 全部拆完 → 渲染 → 逐条审核 → 发布 → 切 auto
5. self.txt 原文件保留原地不动，作为存档与 A/B 对照

**分类决策点（需要作者迁移时拍板，主仓不要替作者决定）**：

| self.txt 内容类型 | 默认建议 | 说明 |
|---|---|---|
| 人生事实（复读/班长/怕水/课表/游戏…） | 全部迁入 core/stable | 主体 |
| 作者层禁语（L40、L111 等） | 迁入，`secret: true` | 必须保留 |
| 未定禁编（"未定，不要编"句） | 迁入，`undecided: true` | 汇入【不要由模型发明的】 |
| 行为规则段（审讯式连问、拒绝被冒犯等） | **默认不迁移** | 白模已验证行为靠模型自悟；若作者想保留个别条，作为 core 条目迁入即可 |
| 【已经钉死、可以反复出现的锚】 | 大多并入对应事实条；重复的锚不重复迁 | 它是事实段的手写摘要，条目化后天然去重 |

## 七、分阶段交付

| 阶段 | 内容 | 验收 |
|---|---|---|
| 一 | 数据层（entries/prose 文件 + atlas.py 读写）+ /atlas 编辑器（列表 CRUD + 分层 + 导入草稿）| 作者能完成 self.txt 全量拆条 |
| 二 | 分节总览页（节卡片 + 权重编辑 + 节级 flag 展示）+ 钻取条目页（字段条目填空式编辑；段落块整段编辑）+ 条目 flag 视觉标记 | 两级页面可用，编辑保存正常 |
| 三 | 渲染/审核/发布 + 注入切换 + stale 机制（无因果边，散文按节权重排序输出） | A/B 对比无退坡（见八-3） |
| 四 | 他的画像 Tab（facts 对象化 + 两级只读视图，样式与档案侧同步） | 画像只读展示正常、注入不变 |

每阶段独立提交、独立验收；任一阶段停下，系统都保持可用（阶段一~二 prose 未发布，注入走 self.txt；阶段三后 prose 生效但 legacy 开关可随时回退）。

## 八、总验收清单

- [ ] `lykie/self.txt` 全程未被代码修改（git diff 为空）
- [ ] 严格模式、`%%档案` 协议、补全提示链路正常（提示文案指向 /atlas）
- [ ] verbatim 条目（课表）与 undecided 条目渲染前后逐字一致（测试断言）
- [ ] secret 条目只出现在【作者层·禁止说出口】段
- [ ] 渲染只由作者显式触发；发布前模型侧行为与发布前完全一致
- [ ] `LYKIE_PROFILE_SOURCE=legacy` 回退后行为与现状一致
- [ ] facts 对象化后：`facts_summary`/`remove_facts_matching`/FACTS_MAX 行为不变，旧字符串数据自动迁移
- [ ] `deploy_to_bt.py` 打包清单加入 `lykie/profile_entries.json`、`lykie/profile_prose.txt`、`lykie/atlas.py`、`templates/atlas.html`、`static/atlas.js`、`static/atlas.css`
- [ ] 非 LiZF 账号访问 /atlas 与其 API 返回 404 或 403（复用现有作者门禁）
- [ ] /atlas 上完成的拆条 + 渲染发布后，作者与 Lykie 实聊十轮，无"档案感退坡"（作者人工判定）

## 九、不做的事（本期明确排除）

- 浮层自动衰减 / 条目自动升层降层（留给 memories.json 阶段）
- 用户画像的自动事实提取改造（extract 链路不动）
- /atlas 的移动端适配（作者桌面工具）
- 散文版的多版本历史（发布即覆盖；要回滚就切 legacy + 重新渲染）
