# -*- coding: utf-8 -*-
"""Sync Q6 keywords from short-subset md into json + user banks."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lykie.short_answer import apply_keywords_to_question, BANK_NAME  # noqa: E402

NEW_KW = [
    "直观性",
    "启发性",
    "巩固性",
    "系统性",
    "因材施教",
    "理论联系实际",
    "量力性",
    "思想性与科学性统一",
]


def patch_q6(questions: list) -> bool:
    for q in questions:
        if str(q.get("id")) == "6":
            apply_keywords_to_question(q, NEW_KW)
            return True
    return False


def main() -> None:
    # subset json
    p = ROOT / "给cursor看的图片" / "简答题截图" / "教资科二简答-短题子集.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    if patch_q6(data["questions"]):
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print("updated", p)
    # user banks
    for user in ("LiZF", "ZhangPT"):
        bp = ROOT / "data" / "users" / user / "bank.json"
        if not bp.exists():
            continue
        bank = json.loads(bp.read_text(encoding="utf-8"))
        changed = False
        for b in bank.get("banks") or []:
            if b.get("name") == BANK_NAME or "短题" in (b.get("name") or ""):
                if patch_q6(b.get("questions") or []):
                    changed = True
        if changed:
            bp.write_text(json.dumps(bank, ensure_ascii=False, indent=2), encoding="utf-8")
            print("updated", bp)


if __name__ == "__main__":
    main()
