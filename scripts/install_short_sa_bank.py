# -*- coding: utf-8 -*-
"""把短题子集写入用户题库（type=short_answer）。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import UserData  # noqa: E402
from lykie import short_answer as lykie_sa  # noqa: E402

SRC = ROOT / "给cursor看的图片" / "简答题截图" / "教资科二简答-短题子集.json"


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    questions = data["questions"]
    users = sys.argv[1:] or ["LiZF", "ZhangPT"]
    for u in users:
        store = UserData(u)
        bank = lykie_sa.install_short_bank(store, questions)
        store.save()
        print(u, "bank", bank["name"], "id", bank["id"], "n", len(bank["questions"]))


if __name__ == "__main__":
    main()
