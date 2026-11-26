# -*- coding: utf-8 -*-
"""把《操作系统》章节题库中 4 道「一题多空」题从多选近似形式迁移为 cloze 题型。

背景：这 4 题此前以多选样式近似入库（answer 为集合字母串），现正式新增
「一题多空」题型（type=cloze，题干按（　）对应 blanks 数组，每空独立选项
与答案），本脚本把已入库数据原地迁移。

用法：
  python scripts/migrate_cloze_4.py            # 干跑：只打印迁移前后摘要
  python scripts/migrate_cloze_4.py --install  # 实际写入 LiZF 数据（幂等）
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 按题库名 + 完整题干等值匹配，避免误伤其他题（如半角括号的单空形似题）。
TARGETS = [
    {
        "bank": "操作系统-第二章习题·客观题",
        "stem": "进程的三个基本状态在一定条件下可以相互转化，进程由就绪状态变为运行状态的条件是（　）；由运行状态变为阻塞状态的条件是（　）。",
        "blanks": [
            {"options": ["时间片用完", "等待某事件发生", "等待的某事件已发生", "被进程调度程序选中"], "answer": "D"},
            {"options": ["时间片用完", "等待某事件发生", "等待的某事件已发生", "被进程调度程序选中"], "answer": "B"},
        ],
        "answer": "DB",
    },
    {
        "bank": "操作系统-第二章习题·客观题",
        "stem": "在一个单处理机系统中，存在5个进程，则最多有（　）进程处于阻塞状态，最多有（　）个进程处于就绪状态。",
        "blanks": [
            {"options": ["5", "4", "3", "2", "1", "0"], "answer": "A"},
            {"options": ["5", "4", "3", "2", "1", "0"], "answer": "B"},
        ],
        "answer": "AB",
    },
    {
        "bank": "操作系统-第三章习题·客观题",
        "stem": "在三种基本类型的操作系统中，都设置了（　）；在批处理系统中还应设置（　）；在分时系统中除了（　）以外，通常还设置了（　）。",
        "blanks": [
            {"options": ["剥夺调度", "作业调度", "进程调度", "中级调度"], "answer": "C"},
            {"options": ["剥夺调度", "作业调度", "进程调度", "中级调度"], "answer": "B"},
            {"options": ["剥夺调度", "作业调度", "进程调度", "中级调度"], "answer": "C"},
            {"options": ["剥夺调度", "作业调度", "进程调度", "中级调度"], "answer": "D"},
        ],
        "answer": "CBCD",
    },
    {
        "bank": "操作系统-第三章习题·客观题",
        "stem": "在面向用户的调度准则中，（　）是选择实时调度算法的重要准则，（　）是选择分时系统中进程调度算法的重要准则，（　）是批处理系统中选择作业调度算法的准则，而（　）准则是为了照顾紧急作业用户的要求而设置的。",
        "blanks": [
            {"options": ["响应时间快", "平均周转时间短", "截止时间的保证", "优先权高的作业能获得优先服务", "服务费低"], "answer": "C"},
            {"options": ["响应时间快", "平均周转时间短", "截止时间的保证", "优先权高的作业能获得优先服务", "服务费低"], "answer": "A"},
            {"options": ["响应时间快", "平均周转时间短", "截止时间的保证", "优先权高的作业能获得优先服务", "服务费低"], "answer": "B"},
            {"options": ["响应时间快", "平均周转时间短", "截止时间的保证", "优先权高的作业能获得优先服务", "服务费低"], "answer": "D"},
        ],
        "answer": "CABD",
    },
]


def locate(store, t):
    for b in store.banks or []:
        if b.get("name") != t["bank"]:
            continue
        for q in b.get("questions") or []:
            if q.get("stem") == t["stem"]:
                return b, q
    return None, None


def main() -> None:
    install = "--install" in sys.argv
    from app import UserData  # noqa: E402

    store = UserData("LiZF")
    report = []
    changed = False
    for t in TARGETS:
        b, q = locate(store, t)
        if not q:
            report.append(f"[缺失] {t['bank']} | {t['stem'][:22]}…")
            continue
        if q.get("type") == "cloze":
            report.append(f"[已是cloze] {t['bank']} | num={q.get('num')} | 空数={len(q.get('blanks') or [])}")
            continue
        report.append(
            f"[待迁移] {t['bank']} | num={q.get('num')} | type={q.get('type')} | answer={q.get('answer')}"
            f" -> cloze 空数={len(t['blanks'])} 空序答案={t['answer']}"
        )
        if install:
            q["type"] = "cloze"
            q["blanks"] = t["blanks"]
            q["options"] = []
            q["answer"] = t["answer"]
            changed = True
    print("\n".join(report))
    if install and changed:
        store.save()
        print("已写入并保存。")
    elif install:
        print("无需写入。")
    else:
        print("干跑模式：未写入。加 --install 实际写入。")


if __name__ == "__main__":
    main()
