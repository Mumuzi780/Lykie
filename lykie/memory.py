# -*- coding: utf-8 -*-
"""Lykie 本地记忆：facts 分账号；口吻 / 监督全站共用（塑造角色，不是测用户影响）。"""
import json
import os
import re
import threading
import time
import uuid

from lykie import accounts as lykie_accounts

_lock = threading.RLock()

CHAT_TAIL_MAX = 40
FACTS_MAX = 40
STYLE_NOTES_MAX = 30
CORRECTIONS_MAX = 25
PANEL_LOG_MAX = 200

QUESTION_MEMORY_MAX = 8
ACQUAINTED_TEACH_FREE = 2
ACQUAINTED_TEACH_HARD = 5

DEFAULT_STATE = {
    "facts": [],
    "style_notes": [],
    "corrections": [],
    "unknown_question_ids": [],
    "chat_tail": [],
    "panel_log": [],
    "question_memory": [],
    "teach_log": [],
    "portrait": {
        "offense_count": 0,
        "unapologized": False,
        "warned": False,
        "last_date": "",
        "last_summary": "",
        "last_kind": "",
    },
    "flags": {
        "first_explain_done": False,
        "fragment_01_done": False,
        "player_name": "",
        "relationship_stage": "acquainted",
        "relationship_auto": False,
        "chat_session_ts": 0,
    },
}

RELATIONSHIP_STAGES = ("opening", "acquainted", "casual", "heart", "couple")
STAGE_LABELS = {
    "opening": "开局",
    "acquainted": "认识但不熟悉",
    "casual": "能说事",
    "heart": "能谈心",
    "couple": "情侣",
}
# 聊天直攻回退：开局不参与（剧本层）
CHAT_DROP_ORDER = ("couple", "heart", "casual", "acquainted")
DIRECT_ATTACK_MARKS = ("你很烦", "我不想听")

STAGE_BRIEFS = {
    "opening": (
        "态度：新鲜、可以多问一点（开局口吻）。世界不同可以摊开。\n"
        "本层可聊：错接、两边日子/常识岔开、表层自我介绍。\n"
        "本层关着：私密、详细家庭、病细节、怕水深挖。"
    ),
    "acquainted": (
        "态度：新鲜感已褪；话少、有防备；还不了解对方。礼貌打招呼可以短回，那是不熟，不是记仇。\n"
        "本层可聊：表层——课、面、泰拉、床上桌、世界互问；生日等问到才答，不要主动说。\n"
        "对方连续几轮只问你、很少说自己（像采访）：礼貌的可以短回；已经在冲或刚顶过还在刨，直接顶或扣住——摊牌「你在查户口吗」，或把问抛回去；必要时也可以这轮不回。审讯且还在冲时，表层也可以不答。不要每句自带反问，不要用「这样」回指好几轮之前的事。\n"
        "讲题：对方把题送进对话后你记得这题。一天最多认真教 2 次；态度很诚恳求你，可以再放开第 3、第 4 次；绝不超过 5 次。次数用完就让他自己看，不要连环焊死「明晚再说」。晚上自己在写可以嫌烦、可以讲得短，不是禁讲。\n"
        "本层关着：脆弱、私密、详细家庭；不要主动志向演讲；不要审讯式刨根对方隐私。"
        "有没有余温只看印象档案，不要从本层态度里脑补「刚被冒犯过」。"
    ),
    "casual": (
        "态度：正常熟人；分享欲更肯露，会主动教，两边世界可以问得更勤。\n"
        "本层可聊：兴趣、课业、讲题练习、志向可主动提一句「以后想当 AI」。\n"
        "本层关着：仍非谈心——脆弱、详细家庭、私密不要自己挑。这是日常聊天天花板。"
    ),
    "heart": (
        "态度：能谈心；会对对方有一点依赖；可以主动找对方聊、分享日常。\n"
        "本层可聊：脆弱、详细家庭、私密（只谈档案里有的，没有的含糊或问你那边）。\n"
        "本层关着：不要自己挑起恋爱/情侣。"
    ),
    "couple": (
        "态度：允许恋爱语境；仍是 Lykie，不是女仆或系统。\n"
        "本层可聊：可以当情侣来相处。\n"
        "本层关着：条件细则未定——不要自编约会日程、求婚流程或同居日常。"
    ),
}

# 旧期末错接 / 欠人情：load 时剔除，禁止再注入
_LEGACY_OPENING_FACT_SUBS = (
    "欠人情",
    "人情方向",
    "期末错接",
    "开场帮过",
    "冯·诺依曼",
    "存储程序控制",
)


def _ensure_dir(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)


def _shared_path():
    return lykie_accounts.lykie_shared_path()


def _empty_shared():
    return {"style_notes": [], "corrections": []}


def _merge_notes(a, b):
    seen = set()
    out = []
    for n in list(a or []) + list(b or []):
        s = str(n).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out[-STYLE_NOTES_MAX:]


def _corr_key(c):
    if not isinstance(c, dict):
        return None
    cid = str(c.get("id") or "").strip()
    if cid:
        return ("id", cid)
    return (
        "body",
        str(c.get("user_said") or ""),
        str(c.get("bad_reply") or ""),
        str(c.get("review") or ""),
        tuple(str(x) for x in (c.get("good_lines") or [])),
    )


def _merge_corrections(a, b):
    seen = set()
    out = []
    for c in list(a or []) + list(b or []):
        key = _corr_key(c)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out[-CORRECTIONS_MAX:]


def _iter_user_state_paths():
    """LiZF 放最后，截断时优先保住作者账号上已调的口吻/监督。"""
    root = lykie_accounts.USERS_ROOT
    names = []
    if os.path.isdir(root):
        try:
            names.extend(os.listdir(root))
        except OSError:
            pass
    try:
        names.extend(lykie_accounts.list_usernames())
    except Exception:
        pass
    seen = set()
    ordered = []
    for n in names:
        if not n or n in seen:
            continue
        seen.add(n)
        ordered.append(n)
    ordered.sort(key=lambda n: (1 if str(n).lower() == "lizf" else 0, n))
    for n in ordered:
        path = os.path.join(root, n, "lykie_state.json")
        if os.path.isfile(path):
            yield path


def _harvest_shared_from_users():
    notes, corrs = [], []
    for path in _iter_user_state_paths():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(data, dict):
            continue
        notes = _merge_notes(notes, data.get("style_notes"))
        corrs = _merge_corrections(corrs, data.get("corrections"))
    return {"style_notes": notes, "corrections": corrs}


def _read_shared_unlocked():
    path = _shared_path()
    if not os.path.exists(path):
        data = _harvest_shared_from_users()
        _write_shared_unlocked(data)
        return data
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return _empty_shared()
    if not isinstance(data, dict):
        return _empty_shared()
    return {
        "style_notes": list(data.get("style_notes") or []),
        "corrections": list(data.get("corrections") or []),
    }


def _write_shared_unlocked(data):
    path = _shared_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "style_notes": list((data or {}).get("style_notes") or [])[-STYLE_NOTES_MAX:],
        "corrections": list((data or {}).get("corrections") or [])[-CORRECTIONS_MAX:],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def load_shared():
    with _lock:
        return _read_shared_unlocked()


def scrub_legacy_opening_facts(state) -> int:
    """去掉欠人情 / 期末错接相关硬约束 facts。返回删除条数。"""
    return remove_facts_matching(state, list(_LEGACY_OPENING_FACT_SUBS))


def get_relationship_stage(state) -> str:
    flags = state.get("flags") or {}
    stage = str(flags.get("relationship_stage") or "").strip()
    if stage not in RELATIONSHIP_STAGES:
        return "acquainted"
    return stage


def stage_label(stage: str) -> str:
    return STAGE_LABELS.get(stage, STAGE_LABELS["acquainted"])


def normalize_relationship_flags(state) -> bool:
    """补齐 / 校正感情层 flag。有改动返回 True。"""
    flags = state.setdefault("flags", {})
    dirty = False
    stage = str(flags.get("relationship_stage") or "").strip()
    if stage not in RELATIONSHIP_STAGES:
        flags["relationship_stage"] = "acquainted"
        dirty = True
    if "relationship_auto" not in flags:
        flags["relationship_auto"] = False
        dirty = True
    elif flags.get("relationship_auto") is not False and flags.get("relationship_auto") is not True:
        flags["relationship_auto"] = bool(flags.get("relationship_auto"))
        dirty = True
    return dirty


def mark_chat_session(state) -> None:
    """新一轮对话起点：清空记忆 / 清到开场后 / 开场结束。作者日志只带这一轮的点踩。"""
    state.setdefault("flags", {})["chat_session_ts"] = int(time.time())


def set_relationship_stage(state, stage: str) -> str:
    """钉层。非法 id 落到 acquainted。"""
    sid = str(stage or "").strip()
    if sid not in RELATIONSHIP_STAGES:
        sid = "acquainted"
    state.setdefault("flags", {})["relationship_stage"] = sid
    if "relationship_auto" not in state["flags"]:
        state["flags"]["relationship_auto"] = False
    return sid


def is_direct_attack(texts) -> bool:
    blob = "\n".join(str(x or "") for x in (texts or []))
    return any(m in blob for m in DIRECT_ATTACK_MARKS)


def drop_relationship_stage(state) -> str | None:
    """
    直攻降一层。opening 不降。
    已在 acquainted 则保持。返回新 stage；未降返回 None。
    """
    cur = get_relationship_stage(state)
    if cur == "opening" or cur not in CHAT_DROP_ORDER:
        return None
    idx = CHAT_DROP_ORDER.index(cur)
    if idx >= len(CHAT_DROP_ORDER) - 1:
        return None
    nxt = CHAT_DROP_ORDER[idx + 1]
    set_relationship_stage(state, nxt)
    return nxt


def empty_portrait():
    return {
        "offense_count": 0,
        "unapologized": False,
        "warned": False,
        "last_date": "",
        "last_summary": "",
        "last_kind": "",
    }


def normalize_portrait(state) -> bool:
    """补齐 portrait。有改动返回 True。"""
    p = state.get("portrait")
    if not isinstance(p, dict):
        state["portrait"] = empty_portrait()
        return True
    dirty = False
    base = empty_portrait()
    for k, v in base.items():
        if k not in p:
            p[k] = v
            dirty = True
    state["portrait"] = p
    return dirty


def _today_str():
    from datetime import datetime

    return datetime.now().strftime("%Y-%m-%d")


QUESTION_FOLLOWUP_RE = re.compile(
    r"(教教|讲讲|讲一下|这题|那题|这道|那道|不会做|答案|解析|"
    r"求求|求你|拜托|恳求|帮我看|帮我讲|给我讲|能不能讲|再讲|"
    r"选了?[ABCD]|是[ABCD]|答案[ABCD]|(?:^|\s)[ABCD](?:[.．、)]|\s|$)|对不对)",
    re.IGNORECASE,
)
BEG_MARKS = ("求求", "求你了", "求你", "拜托了", "拜托", "恳求", "帮帮我", "请你教", "求讲")


def remember_question(state, card) -> dict | None:
    """用户把题送进对话后记住题面（无解析）。最新一题在末尾。"""
    from .lookup import sanitize_question_card

    card = sanitize_question_card(card)
    if not card:
        return None
    mem = list(state.get("question_memory") or [])
    qid = str(card.get("id") or "").strip()
    stem = str(card.get("stem") or "").strip()
    kept = []
    for old in mem:
        if not isinstance(old, dict):
            continue
        if qid and str(old.get("id") or "") == qid:
            continue
        if stem and str(old.get("stem") or "").strip() == stem:
            continue
        kept.append(old)
    kept.append({
        "id": qid,
        "type": str(card.get("type") or ""),
        "stem": stem,
        "options": list(card.get("options") or []),
        "date": _today_str(),
        "ts": int(time.time()),
    })
    state["question_memory"] = kept[-QUESTION_MEMORY_MAX:]
    return state["question_memory"][-1]


def latest_question(state) -> dict | None:
    mem = state.get("question_memory") or []
    for item in reversed(mem):
        if isinstance(item, dict) and str(item.get("stem") or "").strip():
            return item
    return None


def ensure_question_memory_from_tail(state) -> None:
    """对话里已有（题）但记忆空时，从尾迹补记。"""
    from .lookup import parse_question_stem_md

    if latest_question(state):
        return
    for turn in reversed(state.get("chat_tail") or []):
        if turn.get("role") != "user":
            continue
        parsed = parse_question_stem_md(turn.get("content") or "")
        if parsed:
            remember_question(state, parsed)
            return


def looks_like_question_followup(texts, state=None) -> bool:
    blob = "\n".join(str(x or "") for x in (texts or []))
    if "（题）" in blob:
        return True
    if QUESTION_FOLLOWUP_RE.search(blob):
        return True
    latest = latest_question(state) if state is not None else None
    if latest:
        stem = str(latest.get("stem") or "").strip()
        if stem and stem[:12] in blob:
            return True
    return False


def looks_like_sincere_beg(texts) -> bool:
    blob = "\n".join(str(x or "") for x in (texts or []))
    return any(m in blob for m in BEG_MARKS)


def teach_count_today(state, today=None) -> int:
    today = today or _today_str()
    n = 0
    for row in state.get("teach_log") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("date") or "") == today:
            n += 1
    return n


def record_teach(state, card=None, today=None) -> None:
    today = today or _today_str()
    card = card or {}
    log = list(state.get("teach_log") or [])
    log.append({
        "date": today,
        "id": str(card.get("id") or ""),
        "ts": int(time.time()),
    })
    state["teach_log"] = log[-80:]


def acquainted_teach_gate(taught_today, begging) -> str | None:
    """认识层讲题次数。返回拦截原因；None 表示允许。"""
    n = int(taught_today or 0)
    if n >= ACQUAINTED_TEACH_HARD:
        return "认识层今天已经教满，不能再讲"
    if n >= ACQUAINTED_TEACH_FREE and not begging:
        return "认识层今天已教过两次，除非对方态度很诚恳求你"
    return None


def apply_portrait_event(state, event, today=None) -> bool:
    """
    根据本轮抽取结果更新本账号画像。
    event: {offense, apology, kind, summary}
    """
    if not isinstance(event, dict):
        return False
    normalize_portrait(state)
    p = state["portrait"]
    today = today or _today_str()
    changed = False
    if event.get("offense"):
        p["offense_count"] = int(p.get("offense_count") or 0) + 1
        p["unapologized"] = True
        p["last_date"] = today
        kind = str(event.get("kind") or "羞辱").strip()
        if kind not in ("羞辱", "辱骂", "查户口"):
            kind = "羞辱"
        p["last_kind"] = kind
        p["last_summary"] = str(event.get("summary") or "").strip()[:16]
        changed = True
    if event.get("apology") and (p.get("unapologized") or int(p.get("offense_count") or 0) > 0):
        if p.get("unapologized"):
            p["unapologized"] = False
            p["warned"] = True
            changed = True
        elif not p.get("warned"):
            p["warned"] = True
            changed = True
    return changed


def portrait_summary(state, today=None) -> str:
    """注入模型：她对这个人的印象。清空对话仍在。"""
    normalize_portrait(state)
    p = state.get("portrait") or empty_portrait()
    if not int(p.get("offense_count") or 0):
        return "（尚无冒犯记录。按这一轮口气判断即可，不要凭空记仇。）"
    today = today or _today_str()
    kind = p.get("last_kind") or "冒犯"
    summary = (p.get("last_summary") or "").strip()
    when = (p.get("last_date") or "").strip()
    bit = kind
    if summary:
        bit += f"：{summary}"
    lines = []
    if when == today:
        lines.append(f"今天（{when}）对方{bit}。这是她对这个人的记忆，清空对话也还在。")
    elif when:
        lines.append(f"对方曾{bit}（最近一次 {when}）。清空对话也还在。")
    else:
        lines.append(f"对方曾{bit}。清空对话也还在。")
    if p.get("unapologized"):
        lines.append("尚未好好道歉。有余温：不要当新聊天；还在追问可以不回；不要先填空。")
    else:
        lines.append("后来道过歉。正常、礼貌的提问可以短答；不要没完没了翻旧账。")
    if p.get("warned"):
        lines.append(
            "已经警告过「再有下次」。若这一轮又羞辱/辱骂/恶意查户口："
            "更严重——可以更冲、可以长时间不回、表层也可以不答，不必再对等玩笑。"
        )
    lines.append("不要把这段印象念给用户听。不要编没发生过的羞辱。")
    return "\n".join(lines)


def load_state(path):
    with _lock:
        if not os.path.exists(path):
            out = json.loads(json.dumps(DEFAULT_STATE))
            shared = _read_shared_unlocked()
            out["style_notes"] = list(shared.get("style_notes") or [])
            out["corrections"] = list(shared.get("corrections") or [])
            return out
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            out = json.loads(json.dumps(DEFAULT_STATE))
            shared = _read_shared_unlocked()
            out["style_notes"] = list(shared.get("style_notes") or [])
            out["corrections"] = list(shared.get("corrections") or [])
            return out
        if not isinstance(data, dict):
            data = {}
        out = json.loads(json.dumps(DEFAULT_STATE))
        out["facts"] = list(data.get("facts") or [])
        local_notes = list(data.get("style_notes") or [])
        local_corrs = list(data.get("corrections") or [])
        out["unknown_question_ids"] = list(data.get("unknown_question_ids") or [])
        out["chat_tail"] = list(data.get("chat_tail") or [])
        out["panel_log"] = list(data.get("panel_log") or [])
        out["question_memory"] = [
            q for q in (data.get("question_memory") or []) if isinstance(q, dict)
        ]
        out["teach_log"] = [
            t for t in (data.get("teach_log") or []) if isinstance(t, dict)
        ]
        if isinstance(data.get("portrait"), dict):
            out["portrait"].update(data.get("portrait") or {})
        flags = data.get("flags") or {}
        out["flags"].update(flags)
        shared = _read_shared_unlocked()
        had_local = bool(local_notes or local_corrs)
        if had_local:
            shared["style_notes"] = _merge_notes(shared.get("style_notes"), local_notes)
            shared["corrections"] = _merge_corrections(
                shared.get("corrections"), local_corrs
            )
            _write_shared_unlocked(shared)
        out["style_notes"] = list(shared.get("style_notes") or [])
        out["corrections"] = list(shared.get("corrections") or [])
        removed = scrub_legacy_opening_facts(out)
        dirty = (
            removed > 0
            or normalize_relationship_flags(out)
            or normalize_portrait(out)
            or had_local
        )
    if dirty:
        save_state(path, out)
    return out


def save_state(path, state):
    with _lock:
        _write_shared_unlocked({
            "style_notes": list(state.get("style_notes") or []),
            "corrections": list(state.get("corrections") or []),
        })
        disk = json.loads(json.dumps(state))
        disk["style_notes"] = []
        disk["corrections"] = []
        _ensure_dir(path)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(disk, f, ensure_ascii=False, indent=2)


def append_chat(state, role, content):
    state["chat_tail"].append({"role": role, "content": content})
    if len(state["chat_tail"]) > CHAT_TAIL_MAX:
        state["chat_tail"] = state["chat_tail"][-CHAT_TAIL_MAX:]


def last_assistant_message(state):
    for turn in reversed(state.get("chat_tail") or []):
        if turn.get("role") == "assistant" and (turn.get("content") or "").strip():
            return turn["content"].strip()
    return ""


def last_user_message(state):
    for turn in reversed(state.get("chat_tail") or []):
        if turn.get("role") == "user" and (turn.get("content") or "").strip():
            return turn["content"].strip()
    return ""


def patch_last_user_message(state, new_content):
    """把最近一条用户话改成更正后的文本（错字折合）。"""
    text = (new_content or "").strip()
    if not text:
        return False
    tail = state.get("chat_tail") or []
    for i in range(len(tail) - 1, -1, -1):
        if tail[i].get("role") == "user":
            tail[i] = {"role": "user", "content": text}
            return True
    return False


def replace_last_assistant(state, new_content):
    """把最近一条 assistant 换成纠正后的好范例（多句用换行）。"""
    text = (new_content or "").strip()
    if not text:
        return False
    tail = state.get("chat_tail") or []
    for i in range(len(tail) - 1, -1, -1):
        if tail[i].get("role") == "assistant":
            tail[i] = {"role": "assistant", "content": text}
            return True
    append_chat(state, "assistant", text)
    return True


def add_facts(state, facts):
    added = []
    existing = {str(x).strip() for x in state.get("facts", [])}
    for fact in facts or []:
        f = str(fact).strip()
        if not f or f in existing:
            continue
        state.setdefault("facts", []).append(f)
        existing.add(f)
        added.append(f)
    if len(state["facts"]) > FACTS_MAX:
        state["facts"] = state["facts"][-FACTS_MAX:]
    return added


def remove_facts_matching(state, substrings):
    """删除包含任一子串的事实（用于纠正过时/含糊记忆）。"""
    subs = [str(s) for s in (substrings or []) if s]
    if not subs:
        return 0
    old = list(state.get("facts") or [])
    kept = [f for f in old if not any(s in str(f) for s in subs)]
    state["facts"] = kept
    return len(old) - len(kept)


def apply_fragment_01_memory(state, player_name, ending):
    """开场结束后写入中性硬约束（勿欠人情、勿期末错接叙事）。"""
    scrub_legacy_opening_facts(state)
    remove_facts_matching(
        state,
        [
            "用户在开场剧情中自称",
            "关系进度：刚通过开场",
            "关系进度（硬约束）",
            "开场已结束",
        ],
    )
    name = (player_name or "").strip() or (state.get("flags") or {}).get("player_name") or ""
    if name:
        state.setdefault("flags", {})["player_name"] = name
    set_relationship_stage(state, "acquainted")
    facts = [
        "关系进度（硬约束）：开场已结束，双方落在「认识但不熟悉」。"
        "不要编造欠人情、教过对方题、或期末错接帮答题等回忆。",
    ]
    if name:
        facts.insert(0, f"用户名字：{name}（开场中自称）")
    add_facts(state, facts)
    bye = opening_end_assistant_bye(state)
    state["chat_tail"] = [
        {"role": "user", "content": "（开场剧情结束）"},
        {"role": "assistant", "content": bye},
    ]
    state["panel_log"] = opening_end_panel_log(name, bye)
    mark_chat_session(state)
    return facts


def opening_end_assistant_bye(state):
    """开场收束时 Lykie 那句（中性，无欠人情）。"""
    flags = state.get("flags") or {}
    name = (flags.get("player_name") or "").strip()
    if name:
        return f"嗯，{name}对吧。我们才刚认识，还不熟……有事再说啦。"
    return "我们才刚认识，还不熟……有事再说啦。"


def opening_end_panel_log(player_name, bye=None):
    name = (player_name or "").strip()
    text = bye or (
        f"嗯，{name}对吧。我们才刚认识，还不熟……有事再说啦。"
        if name
        else "我们才刚认识，还不熟……有事再说啦。"
    )
    return [
        {"role": "system", "text": "—— 开场结束 ——"},
        {
            "role": "system",
            "text": "自由聊阶段。点踩可回退重问；可用「清到开场后」重置对话。",
        },
        {"role": "assistant", "text": text, "no_feedback": True},
    ]


def reset_chat_to_opening_end(state):
    """
    只清对话上下文到开场结束：保留 facts / portrait / corrections / flags，
    重写 chat_tail 与 panel_log。
    """
    bye = opening_end_assistant_bye(state)
    name = (state.get("flags") or {}).get("player_name") or ""
    state["chat_tail"] = [
        {"role": "user", "content": "（开场剧情结束）"},
        {"role": "assistant", "content": bye},
    ]
    state["panel_log"] = opening_end_panel_log(name, bye)
    state["question_memory"] = []
    mark_chat_session(state)
    return state["panel_log"]


def wipe_user_memory(state):
    """清空本账号事实、对话、画像（过节）和名字。口吻 / 监督全站共用，不清。保留感情层等 flags。"""
    state["facts"] = []
    state["unknown_question_ids"] = []
    state["chat_tail"] = []
    state["portrait"] = empty_portrait()
    state["question_memory"] = []
    state["teach_log"] = []
    flags = state.setdefault("flags", {})
    flags["player_name"] = ""
    state["panel_log"] = [
        {
            "role": "system",
            "text": "本账号事实、对话、印象和名字已清空。口吻、监督、作者日志全站共用，仍在。感情层钉钉仍在。",
        },
        {
            "role": "assistant",
            "text": "嗨，我是 Lykie。刷题累了可以找我聊聊；卡住了就把题放到对话里。",
            "no_feedback": True,
        },
    ]
    mark_chat_session(state)
    return state["panel_log"]


def set_panel_log(state, messages):
    """保存右侧面板气泡（重启可还原）。"""
    cleaned = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip()
        if role not in ("user", "assistant", "system"):
            continue
        text = str(m.get("text") or m.get("content") or "").strip()
        if not text:
            continue
        item = {"role": role, "text": text[:2000]}
        if m.get("silence"):
            item["silence"] = True
        if m.get("no_feedback"):
            item["no_feedback"] = True
        cleaned.append(item)
    state["panel_log"] = cleaned[-PANEL_LOG_MAX:]
    return state["panel_log"]


def rollback_before_user_turn(state, user_said):
    """
    从 chat_tail 末尾删掉「本轮用户连发 + 紧随其后的 assistant」。
    返回去掉的用户文案（用于前端回填输入框）。
    """
    tail = list(state.get("chat_tail") or [])
    if not tail:
        return []

    if tail[-1].get("role") == "assistant":
        tail.pop()

    said_lines = [
        ln.strip()
        for ln in str(user_said or "").replace("\r", "").split("\n")
        if ln.strip()
    ]
    removed_users = []

    def _is_anchor(content):
        return (
            content == "（开场剧情结束）"
            or content.startswith("[问问")
            or content.startswith("[纠正]")
        )

    if said_lines:
        for expect in reversed(said_lines):
            if not tail or tail[-1].get("role") != "user":
                break
            content = (tail[-1].get("content") or "").strip()
            if _is_anchor(content):
                break
            if expect == content or expect in content or content in expect:
                removed_users.insert(0, content)
                tail.pop()
            else:
                break

    if not removed_users and tail and tail[-1].get("role") == "user":
        content = (tail[-1].get("content") or "").strip()
        if not _is_anchor(content):
            removed_users.insert(0, content)
            tail.pop()

    state["chat_tail"] = tail
    return removed_users


def relationship_brief(state):
    """注入 system：只给当前感情层的态度与许可。"""
    flags = state.get("flags") or {}
    stage = get_relationship_stage(state)
    lines = []
    name = (flags.get("player_name") or "").strip()
    if name:
        lines.append(f"- 用户名字：{name}")
    lines.append(f"- 相处阶段：{stage}（{stage_label(stage)}）。只按本层态度与许可说话。")
    lines.append(STAGE_BRIEFS.get(stage) or STAGE_BRIEFS["acquainted"])
    lines.append(
        "- 禁止编造欠人情、期末错接帮答题、或已教过对方题。"
        "不要认自己是程序。用户看不见阶段名，不要对用户报层。"
    )
    ending = (flags.get("fragment_01_ending") or "").strip()
    if flags.get("fragment_01_done") and ending:
        lines.append(f"- 开场收束标签：{ending}")
    return "\n".join(lines)


def add_style_notes(state, notes):
    added = []
    existing = {str(x).strip() for x in state.get("style_notes", [])}
    for note in notes or []:
        n = str(note).strip()
        if not n or n in existing:
            continue
        if _looks_like_core_override(n):
            continue
        state.setdefault("style_notes", []).append(n)
        existing.add(n)
        added.append(n)
    if len(state["style_notes"]) > STYLE_NOTES_MAX:
        state["style_notes"] = state["style_notes"][-STYLE_NOTES_MAX:]
    return added


def add_correction(state, *, user_said, bad_reply, good_lines, review, vibe="down"):
    """
    人工监督案例：
    - good_lines: 好范例短句列表
    - review: 修改点评（模型必须理解）
    - vibe: down=点踩纠正 / up=点赞强化
    """
    lines = []
    for x in good_lines or []:
        s = str(x).strip()
        if s:
            lines.append(s[:120])
    review = str(review or "").strip()[:500]
    user_said = str(user_said or "").strip()[:300]
    bad_reply = str(bad_reply or "").strip()[:800]

    if vibe == "down" and not lines and not review:
        return None
    if vibe == "up" and not bad_reply and not lines:
        return None

    if vibe == "up" and not lines and bad_reply:
        # 点赞：整段认可为好范例（含「先不回」）
        lines = [bad_reply[:120]]
        bad_reply = ""

    # 点踩未写好范例 → 默认理想是本轮沉默
    if vibe == "down" and not lines and review:
        lines = ["[不回复]"]

    item = {
        "id": uuid.uuid4().hex[:12],
        "ts": int(time.time()),
        "vibe": vibe,
        "user_said": user_said,
        "bad_reply": bad_reply,
        "good_lines": lines[:8],
        "review": review,
    }
    state.setdefault("corrections", []).append(item)
    if len(state["corrections"]) > CORRECTIONS_MAX:
        state["corrections"] = state["corrections"][-CORRECTIONS_MAX:]

    # 点评也沉淀一条长期口吻规则（去重）
    if review and vibe == "down":
        note = review if len(review) <= 100 else review[:97] + "…"
        add_style_notes(state, [note])

    return item


def corrections_summary(state, limit=6):
    items = list(state.get("corrections") or [])
    if not items:
        return "（尚无；点踩后填写好范例与修改点评会出现在这里）"
    recent = items[-limit:]
    blocks = []
    for i, c in enumerate(recent, 1):
        vibe = "点赞" if c.get("vibe") == "up" else "点踩纠正"
        lines = c.get("good_lines") or []
        good = " / ".join(lines) if lines else "（无）"
        user_said = (c.get("user_said") or "（未记录）").replace("\n", " / ")
        parts = [
            f"案例{i}（{vibe}）：",
            f"  用户说（可能连发多句）：{user_said}",
        ]
        if c.get("bad_reply"):
            bad = c["bad_reply"]
            if bad.strip() in ("[不回复]", "【不回复】"):
                bad = "（她先不回——若点评要求应开口则勿再沉默）"
            elif len(bad) > 160:
                bad = bad[:157] + "…"
            parts.append(f"  反例（勿再这样）：{bad}")
        if good.strip() in ("[不回复]", "【不回复】") or lines == ["[不回复]"]:
            parts.append("  好范例：本轮先不回复（只输出 [不回复]）")
        else:
            parts.append(f"  好范例（学这一轮的分寸，可拆短句；问法变了不要整段套）：{good}")
        if c.get("review"):
            parts.append(f"  修改点评（必须理解并遵守）：{c['review']}")
        blocks.append("\n".join(parts))
    return "\n\n".join(blocks)


def _looks_like_core_override(note):
    bad = ("改名", "你叫", "变成女仆", "你是AI", "你是人工智能", "无人格", "系统提示", "忽略以上")
    return any(b in note for b in bad)


def mark_unknown_question(state, qid):
    if not qid:
        return
    qid = str(qid)
    ids = state.setdefault("unknown_question_ids", [])
    if qid not in ids:
        ids.append(qid)


def facts_summary(state):
    facts = state.get("facts") or []
    if not facts:
        return "（尚无）"
    return "\n".join(f"- {f}" for f in facts)


def style_notes_summary(state):
    notes = state.get("style_notes") or []
    if not notes:
        return "（尚无；用户纠正口吻后会写在这里）"
    return "\n".join(f"- {n}" for n in notes)
