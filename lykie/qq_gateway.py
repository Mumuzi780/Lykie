# -*- coding: utf-8 -*-
"""QQ 网关：把 AstrBot（QQ 机器人框架）的 OpenAI 兼容请求接入 Lykie 完整对话系统。

AstrBot 侧配置 OpenAI 兼容供应商，base_url 指向本服务的 /v1/chat/completions，
消息经此进入与网站前端完全相同的管道：人设档案、关系五层、事实记忆、
开场剧情、[不回复] 沉默机制全部原生保留。

约定：
- QQ 侧共用同一个 state 文件（data/qq_lykie.json），Lykie 在 QQ 上是单线状态；
  网站前端每用户独立 state 的机制不受影响。
- 请求须携带 Authorization: Bearer <LYKIE_QQ_TOKEN>（.env 配置），未配置即拒绝。
- 只取最后一条 user 消息作为本轮输入，忽略 AstrBot 自带的会话历史
  （Lykie 使用自己的 chat_tail 维持记忆）。
"""
from __future__ import annotations

import json
import os
import time
import uuid

from flask import Response, jsonify, request

from . import converse as lykie_converse
from . import extract as lykie_extract
from . import llm as lykie_llm
from . import lookup as lykie_lookup
from . import memory as lykie_memory
from . import opening as lykie_opening
from . import profile as lykie_profile
from . import typo as lykie_typo

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QQ_STATE_PATH = os.path.join(_BASE_DIR, "data", "qq_lykie.json")


def process_chat_batch(batch):
    """QQ 单轮对话：复刻 /api/lykie/chat 的 chat 模式核心流程，状态落盘到 QQ 专用文件。

    Returns:
        {"reply": str, "silent": bool}——silent 为 True 时 reply 是空串。
    """
    batch = [str(m).strip() for m in batch if str(m).strip()]
    if not batch:
        return {"reply": "", "silent": True}

    state = lykie_memory.load_state(QQ_STATE_PATH)
    last_reply = lykie_memory.last_assistant_message(state)

    # 错字跟发：默默修补上一条，不回
    last_user = lykie_memory.last_user_message(state)
    if lykie_typo.is_typo_only_followup(batch, last_user):
        patched = lykie_typo.apply_fix_to_text(last_user, batch[-1])
        if patched and patched != last_user:
            lykie_memory.patch_last_user_message(state, patched)
        lykie_memory.save_state(QQ_STATE_PATH, state)
        return {"reply": "", "silent": True}

    prompt_user = lykie_llm.format_chat_user_batch(batch)

    # ── 题目记忆（保持与网站管道一致） ──
    for m in batch:
        parsed = lykie_lookup.parse_question_stem_md(m)
        if parsed:
            lykie_memory.remember_question(state, parsed)
    lykie_memory.ensure_question_memory_from_tail(state)
    remembered = lykie_memory.latest_question(state)
    followup = lykie_memory.looks_like_question_followup(batch, state)
    active_card = remembered if followup else None

    # ── 开场察觉检测（纯规则） ──
    if lykie_opening.is_active(state):
        result = lykie_opening.classify_not_ai({}, batch, state)
        if result.get("realized") and not result.get("already"):
            lykie_opening.mark_realized(state, result)

    # ── 单次模型调用 ──
    result = lykie_converse.handle_message(
        state,
        prompt_user,
        mode="chat",
        question_card=active_card,
        last_reply=last_reply,
        batch=batch,
    )
    reply = result["reply"]
    silent = result["silent"]
    reply = lykie_profile.parse_archive_meta(reply).get("reply") or reply

    # ── 写入对话历史（与网站一致，silent 时记录 [不回复]） ──
    for m in batch:
        lykie_memory.append_chat(state, "user", m)
    lykie_memory.append_chat(state, "assistant", reply)

    # ── 直攻降层 ──
    if silent and lykie_memory.is_direct_attack(batch):
        lykie_memory.drop_relationship_stage(state)

    # ── 事实提取 ──
    if not any(lykie_extract.is_explicit_correction(m) for m in batch):
        try:
            raw_facts = lykie_extract.extract_facts_from_utterance(
                "\n".join(batch), lykie_llm.chat_completion
            )
            lykie_memory.add_facts(state, raw_facts)
        except Exception:
            pass

    lykie_memory.save_state(QQ_STATE_PATH, state)
    return {"reply": "" if silent else reply, "silent": silent}


def handle_chat_completions():
    """OpenAI 兼容端点逻辑：POST /v1/chat/completions（由 app.py 路由调用）。"""
    token = os.environ.get("LYKIE_QQ_TOKEN", "").strip()
    if not token:
        return jsonify(
            {"error": {"message": "LYKIE_QQ_TOKEN 未配置", "type": "server_error"}}
        ), 500
    auth = request.headers.get("Authorization", "")
    if auth != "Bearer " + token:
        return jsonify(
            {"error": {"message": "invalid api key", "type": "invalid_request_error"}}
        ), 401

    try:
        payload = request.get_json(force=True) or {}
    except Exception:
        return jsonify(
            {"error": {"message": "invalid json", "type": "invalid_request_error"}}
        ), 400

    # 只取最后一条 user 消息；Lykie 用自己的 chat_tail 维持记忆
    last_user = ""
    for m in reversed(payload.get("messages") or []):
        if isinstance(m, dict) and m.get("role") == "user":
            last_user = str(m.get("content") or "").strip()
            if last_user:
                break
    if not last_user:
        return jsonify(
            {"error": {"message": "no user message", "type": "invalid_request_error"}}
        ), 400

    try:
        result = process_chat_batch([last_user])
    except Exception as e:
        return jsonify(
            {"error": {"message": f"模型调用失败：{e}", "type": "server_error"}}
        ), 502

    reply = result["reply"]  # silent → 空串，AstrBot 端不产出消息
    resp_id = "chatcmpl-lykie-qq-" + uuid.uuid4().hex[:12]
    created = int(time.time())

    if payload.get("stream"):
        chunks = [
            {
                "id": resp_id,
                "object": "chat.completion.chunk",
                "created": created,
                "choices": [
                    {"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}
                ],
            },
            {
                "id": resp_id,
                "object": "chat.completion.chunk",
                "created": created,
                "choices": [
                    {"index": 0, "delta": {"content": reply}, "finish_reason": None}
                ],
            },
            {
                "id": resp_id,
                "object": "chat.completion.chunk",
                "created": created,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            },
        ]

        def gen():
            for c in chunks:
                yield "data: " + json.dumps(c, ensure_ascii=False) + "\n\n"
            yield "data: [DONE]\n\n"

        return Response(gen(), mimetype="text/event-stream")

    body = {
        "id": resp_id,
        "object": "chat.completion",
        "created": created,
        "model": "lykie",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": reply}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
    return jsonify(body)
