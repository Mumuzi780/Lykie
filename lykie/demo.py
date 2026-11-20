# -*- coding: utf-8 -*-
"""新用户示例题库：注册即预置，答完四题顺便学会 Lykie 的核心玩法。

四题分别对应：斩题、错题自动复习、市场领取、明暗主题切换——
示例库本身就是新手引导的复习材料，答对即上手。
"""
from __future__ import annotations

import json
import os
import tempfile

from lykie import accounts as lykie_accounts
from lykie import share as lykie_share

DEMO_BANK_NAME = "示例 · 四题上手"

DEMO_QUESTIONS = [
    {
        "num": "1",
        "stem": "背熟的题想让它们不再出现，应该点哪个按钮？",
        "options": ["斩", "重置进度", "错题本", "放到对话里"],
        "answer": "A",
        "analysis": "点「斩」= 这道题从此不再出现，越背越少。",
        "type": "choice",
    },
    {
        "num": "2",
        "stem": "答错的题，Lykie 会怎么处理？",
        "options": ["直接消失", "自动多安排复习", "记入错题本就不管了", "需要手动重新抽"],
        "answer": "B",
        "analysis": "答错的题会自动更频繁地再来，直到你背熟为止。",
        "type": "choice",
    },
    {
        "num": "3",
        "stem": "想领取同学共享的题库，应该去哪里？",
        "options": ["翻译", "市场", "错题本", "资产"],
        "answer": "B",
        "analysis": "点侧栏「市场」领取共享题库副本，进度独立、随取随用。",
        "type": "choice",
    },
    {
        "num": "4",
        "stem": "怎么切换白天 / 夜间模式？",
        "options": ["点页面左上角的太阳 / 月亮按钮", "退出重新登录", "去「改密」页设置", "连点十下连击徽章"],
        "answer": "A",
        "analysis": "偏好会自动记住，下次进来还是你选的模式。",
        "type": "choice",
    },
]


def _save_bank_file(path: str, data: dict) -> None:
    """原子写入 bank.json。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="bank.", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def install_demo_bank(username: str) -> dict | None:
    """把示例题库写入用户 bank.json（幂等：已有同名库则跳过）。

    返回写入的题库 dict；跳过时返回 None。失败向上抛异常，由调用方决定是否忽略。
    """
    n = lykie_accounts.normalize_username(username)
    path = lykie_accounts.bank_path(n)
    data = {"banks": [], "folders": [], "current_bank_id": None}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                data = loaded
        except (json.JSONDecodeError, OSError):
            pass
    if not isinstance(data.get("banks"), list):
        data["banks"] = []
    if not isinstance(data.get("folders"), list):
        data["folders"] = []
    if any(str(b.get("name") or "") == DEMO_BANK_NAME for b in data["banks"]):
        return None

    clone = lykie_share.clone_bank_for_share(
        {"name": DEMO_BANK_NAME, "questions": DEMO_QUESTIONS, "mode": "objective"},
        "LiZF",
    )
    clone["demo"] = True
    data["banks"].append(clone)
    if not data.get("current_bank_id"):
        data["current_bank_id"] = clone["id"]
    _save_bank_file(path, data)
    return clone


def reset_to_newbie(username: str) -> dict:
    """一键变回刚注册的新手（测试用）。

    清空全部题库、文件夹与作答进度，重装一份全新的示例题库，并把当前题库指向它。
    不可恢复，调用方负责二次确认。失败向上抛异常。
    """
    n = lykie_accounts.normalize_username(username)
    clone = lykie_share.clone_bank_for_share(
        {"name": DEMO_BANK_NAME, "questions": DEMO_QUESTIONS, "mode": "objective"},
        "LiZF",
    )
    clone["demo"] = True
    data = {"banks": [clone], "folders": [], "current_bank_id": clone["id"]}
    _save_bank_file(lykie_accounts.bank_path(n), data)
    return clone
