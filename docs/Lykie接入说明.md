# Lykie 第一版：接入与冒烟

在现有背题助手上增加 Lykie 聊天（云端 OpenAI 兼容 API）。刷题不依赖密钥；聊天需要配置后可用。

## 1. 安装依赖

```bash
pip install -r requirements.txt
```

## 2. 配置密钥

```bash
copy .env.example .env
```

编辑 `.env`：

```
LYKIE_API_KEY=你的密钥
LYKIE_BASE_URL=https://api.deepseek.com
LYKIE_MODEL=deepseek-flash
```

也可换成其它兼容端点（通义、OpenAI 等），改 `LYKIE_BASE_URL` 与 `LYKIE_MODEL` 即可。  
`.env` 已在 `.gitignore` 中，勿提交密钥。

## 3. 启动

双击仓库根目录 **`启动背题助手.bat`**，或：

```bash
python app.py
```

打开 http://127.0.0.1:5000/（脚本会尝试自动打开浏览器）。首次需先开账号：

```bash
python add_user.py 你的用户名
```

按提示输入密码。第一个账号会把现有 `data/bank.json` 拷进去；之后给朋友开的号是空白题库。  
**Lykie 的口吻、监督、作者日志全站共用**（现在是在塑造角色，不是测「不同用户把她带偏」）。新账号也会带上已经调过的口吻/监督。各账号自己的是：对话、面板、日常事实（例如这人叫什么）。

```bash
python add_user.py list
```

## 4. 冒烟检查

1. 右侧出现 **Lykie** 面板；未配 key 时状态栏提示配置方法，刷题仍可用。
2. 配好 key 并重启后，状态显示「已连接」与模型名。
3. 在输入框闲聊一句（如「我经常熬夜刷题」），应收到带人格的短回复。
4. 抽到题目后点卡片上的 **放到对话里**，题面会挂在输入区上方（不发送）；再点发送才进对话。她只看得见题干/选项，解析要等她肯讲才由服务端另取。换题但没再送出，她仍只有已经发过的题面。
5. 再开一次 `python app.py`，闲聊时她仍可能用到已记住的日常（见该账号目录 `data/users/用户名/lykie_state.json` 的 `facts`）。口吻与监督在全站 `data/lykie_shared.json`。
6. **口吻纠正（长期）：** 发送 `纠正：别分点，短句说`，或点「纠正上一句」后写完再发。成功后会出现「已记住口吻：…」，状态栏「口吻 N」增加；规则在 `style_notes`（不改人设核）。
7. **人工监督：** 自由聊气泡上 👍 认可 / 👎 填写好范例短句与修改点评（详见 `docs/Lykie人工监督.md`）。
8. **思考面板（作者）：** 闲聊每轮会先想再开口。默认仅账号 `LiZF` 在气泡旁看到 `action` / `why` / 查空。`.env` 里 `LYKIE_THINK_DEBUG=0` 全关，`=1` 所有账号都能看。思考原文不进 `chat_tail`。

## 相关文件

| 路径 | 说明 |
|------|------|
| `lykie/prompt_core.txt` | 人设核（纠正等仍用；闲聊开口改走 `prompt_speak.txt`） |
闲聊先思考再按 need 摘档案块，不再每轮注入整份 `lykie/self.txt`。右侧状态栏显示「档案(严) 人工智能·宿舍·课表」仍表示档案已装入查找。
| `lykie/think.py` / `lookup.py` / `prompt_speak.txt` / `lykie/opening.py` | 思考、按需摘材、开口短核、开场节点 1 |
| `lykie/llm.py` / `memory.py` / `extract.py` | 调用、记忆、事实抽取 |
| `data/users/用户名/lykie_state.json` | 该账号的对话 / 日常事实 / 感情层 |
| `data/lykie_shared.json` | 全站口吻（`style_notes`）与监督（`corrections`） |
| `data/lykie_author_log.md` | 全站作者现场日志（不进模型） |
| `/api/lykie/state`、`/api/lykie/chat`、`/api/lykie/feedback` | 后端接口 |

开场剧情见 `docs/开场剧情接入.md`。现行测法：面板「测开场」进入节点 1（不自动对所有账号开；旧 `fragment_01` 不自动播）。最少提示词实验用 `/lab` 试验台。桌宠、主动催题、慢变特质自动演化仍未做。
