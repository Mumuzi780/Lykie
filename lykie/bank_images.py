# -*- coding: utf-8 -*-
"""题库图片：docx 提取、落盘、渲染标记与复制。

图片落盘 data/bank_assets/<用户名>/<bank_id>/<file>；官方共享内容存
data/bank_assets/_official/<官方条目id>/<file>。

题目文本中用 [图:imgId] 标记图片位置；题 dict 存 images: [{id, file, alt}]，
file 为题库图片目录内的文件名，前端按当前题库 id 拼 /api/bank_images/<bank_id>/<file>。
"""
from __future__ import annotations

import base64
import os
import re
import secrets
import shutil

from docx import Document
from docx.oxml.ns import qn

from lykie import accounts as lykie_accounts

IMG_MARKER_RE = re.compile(r"\[图:([A-Za-z0-9_\-]+)\]")

# 缺图标记：导入时文本无法还原图的题在题干标【含图片：…】（补图台按此扫描）
MISSING_MARK_RE = re.compile(r"【含图片[^】]*】")

# 缺图题里随标记附带的文字描述（补图完成后一并移除；描述内可能嵌套一层括号）
MISSING_DESC_RE = re.compile(r"（图片(?:表格)?内容：(?:[^（）]|（[^（）]*）)*）")

ALLOWED_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

ASSETS_ROOT = os.path.join(lykie_accounts.DATA_DIR, "bank_assets")


def scope_dir(scope: str) -> str:
    return os.path.join(ASSETS_ROOT, scope or "_official")


def bank_dir(scope: str, bank_id) -> str:
    return os.path.join(scope_dir(scope), str(bank_id))


# ==================== docx 提取 ====================

def extract_docx_text_and_images(path) -> tuple[str, dict]:
    """docx → (文本, {imgId: {"data": bytes, "ext": "png"}})。

    图片标记 [图:imgN] 附在所在段落文本末尾；段落无文本时标记独占一行。
    只遍历正文段落（与 docx_to_text 原口径一致，表格内图片不在范围内）。
    """
    doc = Document(path)
    images: dict = {}
    lines: list[str] = []
    seq = 0

    def _blip_payload(blip):
        rid = blip.get(qn("r:embed"))
        if not rid:
            return None
        part = doc.part.related_parts.get(rid)
        if part is None or not getattr(part, "blob", None):
            return None
        ext = str(part.content_type or "image/png").split("/")[-1].lower()
        if ext == "jpeg":
            ext = "jpg"
        if ext not in ALLOWED_EXTS:
            ext = "png"
        return bytes(part.blob), ext

    for p in doc.paragraphs:
        markers: list[str] = []
        for run in p.runs:
            for blip in run._element.findall(".//" + qn("a:blip")):
                got = _blip_payload(blip)
                if not got:
                    continue
                seq += 1
                img_id = f"img{seq}"
                images[img_id] = {"data": got[0], "ext": got[1]}
                markers.append(f"[图:{img_id}]")
        text = (p.text or "").strip()
        if markers:
            text = (text + " " + " ".join(markers)).strip()
        if text:
            lines.append(text)
    return "\n".join(lines), images


# ==================== 载荷规整 / 落盘 ====================

def decode_image_payload(payload) -> dict:
    """把前端 images 载荷规整为 {imgId: {"data": bytes, "ext": "png"}}。

    接受 dataURL 字符串（data:image/png;base64,…）、裸 base64 字符串、
    或 {"data": bytes, "ext": "png"}。非法条目静默跳过。
    """
    out: dict = {}
    if not isinstance(payload, dict):
        return out
    for k, v in payload.items():
        try:
            if isinstance(v, str):
                s = v.strip()
                if not s:
                    continue
                if s.startswith("data:"):
                    head, _, b64 = s.partition(",")
                    m = re.search(r"data:image/([A-Za-z0-9+]+)", head)
                    ext = (m.group(1) if m else "png").lower()
                    if ext == "jpeg":
                        ext = "jpg"
                    if ext not in ALLOWED_EXTS:
                        ext = "png"
                    out[str(k)] = {"data": base64.b64decode(b64), "ext": ext}
                else:
                    out[str(k)] = {"data": base64.b64decode(s), "ext": "png"}
            elif isinstance(v, dict) and isinstance(v.get("data"), (bytes, bytearray)):
                ext = str(v.get("ext") or "png").lower()
                if ext == "jpeg":
                    ext = "jpg"
                if ext not in ALLOWED_EXTS:
                    ext = "png"
                out[str(k)] = {"data": bytes(v["data"]), "ext": ext}
        except Exception:
            continue
    return out


def to_data_urls(images: dict) -> dict:
    """{imgId: {data, ext}} → {imgId: dataURL}（导入预览用，不落盘）。"""
    out: dict = {}
    for k, v in (images or {}).items():
        if isinstance(v, dict) and isinstance(v.get("data"), (bytes, bytearray)):
            out[str(k)] = "data:image/{0};base64,{1}".format(
                v.get("ext") or "png",
                base64.b64encode(bytes(v["data"])).decode(),
            )
    return out


def write_image(dst_dir: str, data: bytes, ext: str, img_id: str) -> str:
    """落盘单张图片，返回题库目录内文件名（imgId_随机串.ext）。"""
    filename = f"{img_id}_{secrets.token_hex(3)}.{ext}"
    os.makedirs(dst_dir, exist_ok=True)
    with open(os.path.join(dst_dir, filename), "wb") as f:
        f.write(data)
    return filename


def attach_images(questions, src_images: dict, dst_dir: str, prefix: str = "") -> None:
    """按题内 [图:imgId] 标记落盘图片并写 q["images"]；无标记或无图不动。

    src_images: {imgId: {"data": bytes, "ext": "png"}}（docx 提取或 decode 产物）。
    """
    for q in questions or []:
        if not isinstance(q, dict):
            continue
        fields = [q.get("stem") or ""]
        opts = q.get("options")
        if isinstance(opts, list):
            fields.extend(str(x) for x in opts)
        if q.get("analysis"):
            fields.append(str(q["analysis"]))
        text = "\n".join(fields)
        wanted = []
        for m in IMG_MARKER_RE.finditer(text):
            if m.group(1) not in wanted:
                wanted.append(m.group(1))
        entries = [dict(e) for e in (q.get("images") or []) if isinstance(e, dict)]
        have = {e.get("id") for e in entries}
        for img_id in wanted:
            if img_id in have or img_id not in src_images:
                continue
            info = src_images[img_id]
            entries.append({
                "id": img_id,
                "file": write_image(dst_dir, info["data"], info["ext"], prefix + img_id),
                "alt": "",
            })
        if entries:
            q["images"] = entries


# ==================== 复制 / 清理 ====================

def copy_image_files(src_dir: str, dst_dir: str, filenames) -> int:
    """按文件名逐个复制（跨账号分享 / 官方领取用）；返回成功数。"""
    if not os.path.isdir(src_dir) or not filenames:
        return 0
    os.makedirs(dst_dir, exist_ok=True)
    n = 0
    for name in filenames:
        name = str(name)
        if not name or "/" in name or "\\" in name:
            continue
        src = os.path.join(src_dir, name)
        if os.path.isfile(src):
            try:
                shutil.copyfile(src, os.path.join(dst_dir, name))
                n += 1
            except OSError:
                pass
    return n


def copy_bank_images(src_scope: str, src_bank_id, dst_scope: str, dst_bank_id, prefix: str = "") -> int:
    """整目录复制（发布官方用）；prefix 非空时文件名统一加前缀。"""
    src = bank_dir(src_scope, src_bank_id)
    if not os.path.isdir(src):
        return 0
    dst = bank_dir(dst_scope, dst_bank_id)
    os.makedirs(dst, exist_ok=True)
    n = 0
    for name in os.listdir(src):
        if not os.path.isfile(os.path.join(src, name)):
            continue
        try:
            shutil.copyfile(os.path.join(src, name), os.path.join(dst, prefix + name))
            n += 1
        except OSError:
            pass
    return n


def remove_bank_images(scope: str, bank_id) -> None:
    shutil.rmtree(bank_dir(scope, bank_id), ignore_errors=True)


def remove_question_images(scope: str, bank_id, question) -> None:
    d = bank_dir(scope, bank_id)
    if not os.path.isdir(d):
        return
    for e in (question or {}).get("images") or []:
        f = e.get("file")
        if f and "/" not in f and "\\" not in f:
            try:
                os.remove(os.path.join(d, f))
            except OSError:
                pass


# ==================== 标记工具 ====================

def strip_marker(text, img_id) -> str:
    """删除指定图片的标记；其他标记原样保留。"""
    return IMG_MARKER_RE.sub(
        lambda m: "" if m.group(1) == img_id else m.group(0),
        text or "",
    )


def strip_all_markers(text) -> str:
    """所有图片标记替换为 [图片]（AI 讲题 / 无图渲染兜底）。"""
    return IMG_MARKER_RE.sub("[图片]", text or "")


def next_image_id(images) -> str:
    """现有 images 列表中 imgN 最大编号 + 1。"""
    ids = []
    for e in (images or []):
        m = re.fullmatch(r"img(\d+)", str(e.get("id") or ""))
        if m:
            ids.append(int(m.group(1)))
    return f"img{max(ids) + 1 if ids else 1}"
