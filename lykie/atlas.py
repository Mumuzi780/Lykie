# -*- coding: utf-8 -*-
"""Lykie 档案 Atlas：条目化档案（唯一事实源）+ 散文派生（发布制）+ 用户画像分层。

红线：
- self.txt 永不被本模块写入。
- 散文只在 publish 时写入 profile_prose.txt；未发布前模型读旧版。
- verbatim / undecided 条目渲染时逐字拷贝，不过 LLM（渲染在 app.py 阶段三接入）。
"""
import json
import os
import re
import threading
import time
import uuid

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES_PATH = os.path.join(BASE_DIR, "lykie", "profile_entries.json")
PROSE_PATH = os.path.join(BASE_DIR, "lykie", "profile_prose.txt")

LAYERS = ("core", "stable", "current", "floating")
ARCHIVE_LAYERS = ("core", "stable", "current")  # 她的档案允许的层
FACT_LAYERS = ("core", "stable", "current", "floating")  # 用户画像允许的层

_lock = threading.RLock()

_EMPTY = {
    "version": 1,
    "strict": None,  # None = 跟随 self.txt 的严格模式
    "prose_stale": False,
    "prose_published_at": None,
    "sections": [],  # 节表：[{"name", "weight", "secret", "undecided", "verbatim"}]
    "entries": [],
}


def _ensure_dir(path):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)


def _write_json_atomic(path, data):
    import tempfile
    _ensure_dir(path)
    fd, tmp = tempfile.mkstemp(prefix="atlas.", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        raise


def new_entry(text, layer="current", secret=False, undecided=False, verbatim=False,
              edges=None, source="", section=""):
    return {
        "id": "e" + uuid.uuid4().hex[:8],
        "text": str(text or "").strip(),
        "layer": layer if layer in LAYERS else "current",
        "secret": bool(secret),
        "undecided": bool(undecided),
        "verbatim": bool(verbatim),
        "edges": [str(e) for e in (edges or [])],
        "source": str(source or ""),
        "section": str(section or "").strip(),
        "updated": time.strftime("%Y-%m-%d"),
    }


def new_section(name, weight=0, secret=False, undecided=False, verbatim=False):
    return {
        "name": str(name or "").strip(),
        "weight": int(weight or 0),
        "secret": bool(secret),
        "undecided": bool(undecided),
        "verbatim": bool(verbatim),
    }


_SECTION_HEAD_RE = re.compile(r"^【([^】]+)】")


def _section_head(text):
    m = _SECTION_HEAD_RE.match((text or "").strip())
    return m.group(1).strip() if m else ""


def _migrate_sections(data):
    """阶段二一次性迁移：条目补 section 字段（【X】头开新节，无头归上一节）。

    只补缺省，已有 section 不覆盖（作者在界面上的移动优先）。
    节表为空时按条目首现顺序重建；节级 flag = 节内条目全部带该标。
    返回是否有改动。
    """
    changed = False
    cur = ""
    order = []
    for e in data["entries"]:
        head = _section_head(e.get("text"))
        if head:
            cur = head
        if "section" not in e:
            e["section"] = cur
            changed = True
        if cur and cur not in order:
            order.append(cur)
    if not data["sections"] and order:
        data["sections"] = []
        for name in order:
            members = [e for e in data["entries"] if e.get("section") == name]
            data["sections"].append(new_section(
                name,
                weight=len(data["sections"]),
                secret=bool(members) and all(e.get("secret") for e in members),
                undecided=bool(members) and all(e.get("undecided") for e in members),
                verbatim=bool(members) and all(e.get("verbatim") for e in members),
            ))
        changed = True
    return changed


def ensure_sections(data):
    """节表补齐：条目里出现但节表没有的节追加到末尾。返回是否有新增。"""
    names = [s["name"] for s in data["sections"]]
    added = False
    for e in data["entries"]:
        sec = (e.get("section") or "").strip()
        if sec and sec not in names:
            data["sections"].append(new_section(sec, weight=len(data["sections"])))
            names.append(sec)
            added = True
    return added


def load_entries():
    with _lock:
        if not os.path.exists(ENTRIES_PATH):
            return json.loads(json.dumps(_EMPTY))
        try:
            with open(ENTRIES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return json.loads(json.dumps(_EMPTY))
        if not isinstance(data, dict):
            return json.loads(json.dumps(_EMPTY))
        out = json.loads(json.dumps(_EMPTY))
        out["strict"] = data.get("strict")
        out["prose_stale"] = bool(data.get("prose_stale"))
        out["prose_published_at"] = data.get("prose_published_at")
        sections = data.get("sections")
        if isinstance(sections, list):
            out["sections"] = [s for s in sections
                               if isinstance(s, dict) and (s.get("name") or "").strip()]
        entries = data.get("entries")
        if isinstance(entries, list):
            out["entries"] = [e for e in entries if isinstance(e, dict) and (e.get("text") or "").strip()]
        if out["entries"] and (_migrate_sections(out) or ensure_sections(out)):
            _write_json_atomic(ENTRIES_PATH, out)  # 一次性迁移落盘
        return out


def save_entries(entries, strict=None, sections=None):
    """整表保存。任何保存都置 prose_stale（档案动了，散文待重渲）。"""
    with _lock:
        data = load_entries()
        clean = []
        for e in entries or []:
            if not isinstance(e, dict):
                continue
            item = new_entry(
                e.get("text"),
                layer=e.get("layer"),
                secret=e.get("secret"),
                undecided=e.get("undecided"),
                verbatim=e.get("verbatim"),
                edges=e.get("edges"),
                source=e.get("source"),
                section=e.get("section"),
            )
            if e.get("id"):
                item["id"] = str(e["id"])
            if e.get("updated"):
                item["updated"] = str(e["updated"])
            clean.append(item)
        data["entries"] = clean
        if sections is not None:
            clean_sections = []
            for s in sections:
                if not isinstance(s, dict):
                    continue
                ns = new_section(s.get("name"), weight=s.get("weight", len(clean_sections)),
                                 secret=s.get("secret"), undecided=s.get("undecided"),
                                 verbatim=s.get("verbatim"))
                if ns["name"]:
                    clean_sections.append(ns)
            data["sections"] = clean_sections
        ensure_sections(data)
        if strict is not None:
            data["strict"] = bool(strict)
        data["prose_stale"] = True
        _write_json_atomic(ENTRIES_PATH, data)
        return data


def mark_prose_published():
    with _lock:
        data = load_entries()
        data["prose_stale"] = False
        data["prose_published_at"] = time.strftime("%Y-%m-%d %H:%M")
        _write_json_atomic(ENTRIES_PATH, data)
        return data


def load_prose():
    """已发布的散文（只读派生物）。不存在返回空串。"""
    try:
        with open(PROSE_PATH, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def _self_txt_path():
    return os.path.join(BASE_DIR, "lykie", "self.txt")


def draft_from_self_txt():
    """把 self.txt 按行导成草稿条目（未分层、堆在 floating 的待整理栏）。

    只读 self.txt，绝不写。分类判断完全留给作者。
    """
    try:
        with open(_self_txt_path(), "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return []
    drafts = []
    buf = []          # 聚合连续行（字段+其注释行）
    start_ln = 0
    secret_hint = re.compile(r"作者层|禁止说出口|不要说出口|不要当她知道的真事")
    undecided_hint = re.compile(r"未定，不要编|未定。不要编|不要编|不要现编|尚未写")
    verbatim_hint = re.compile(r"^【(课表|已经钉死|不要由模型发明的)")

    def is_noise(s):
        t = s.strip()
        return (not t) or t.startswith("# 语气、短句") or t == "# Lykie 自己的档案（作者手写）" \
            or t.startswith("# 模型会把这里当成") or t.startswith("# 改完保存即可") \
            or t.startswith("# 开 =") or t.startswith("# 关 =") \
            or t == "严格模式：开" or t == "严格模式：关"

    def flush():
        nonlocal buf, start_ln
        if not buf:
            return
        text = "\n".join(buf).strip()
        buf = []
        if not text:
            return
        secret = bool(secret_hint.search(text)) and not text.startswith("作者写作层")
        undecided = bool(undecided_hint.search(text)) and not secret
        verbatim = bool(verbatim_hint.search(text))
        drafts.append(new_entry(
            text,
            layer="floating",
            secret=secret,
            undecided=undecided,
            verbatim=verbatim,
            source=f"self.txt#L{start_ln}",
            section=sec_name,
        ))

    section = False
    sec_name = ""
    for i, raw in enumerate(lines, 1):
        s = raw.rstrip()
        if s.startswith("【") and "】" in s:
            flush()
            section = True
            sec_name = s.strip()[1:s.index("】")].strip()
            buf.append(s)
            start_ln = i
            continue
        if is_noise(s):
            flush()
            section = False
            continue
        if not s.strip():
            flush()
            continue
        if s.strip().startswith("#"):
            # 注释行：归属到当前聚集团
            if buf:
                buf.append(s.strip())
            else:
                buf = [s.strip()]
                start_ln = i
            continue
        if buf and not section:
            flush()
        if not buf:
            start_ln = i
        buf.append(s.strip())
    flush()
    return drafts


def draft_status(entries):
    """导入草稿的整理进度：未分层的还剩多少条。"""
    total = len(entries or [])
    pending = sum(1 for e in (entries or []) if e.get("layer") == "floating")
    return {"total": total, "pending": pending}


# ---------- 用户画像（facts 对象化） ----------

def fact_obj(f):
    """兼容旧字符串 facts：惰性迁移为对象。"""
    if isinstance(f, dict):
        return {
            "text": str(f.get("text") or "").strip(),
            "layer": f.get("layer") if f.get("layer") in FACT_LAYERS else "floating",
            "added": str(f.get("added") or ""),
        }
    s = str(f or "").strip()
    if not s:
        return None
    return {"text": s, "layer": "floating", "added": ""}


def facts_as_objects(state):
    out = []
    for f in state.get("facts") or []:
        o = fact_obj(f)
        if o:
            out.append(o)
    return out
