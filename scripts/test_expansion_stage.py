# -*- coding: utf-8 -*-
"""扩展阶段端到端测试（函数级）：阶段机流转 + 卡片结构 + 判分字段。"""
import sys
sys.path.insert(0, r"d:\Lykie")
import json

from lykie import short_answer as sa

# 载入本地 LiZF 题库
d = json.load(open(r"d:\Lykie\data\users\LiZF\bank.json", encoding="utf-8"))
bank = next(b for b in d["banks"] if b.get("name") == "燃烧与爆炸-主观题背诵")
qs = [q for q in bank["questions"] if q.get("type") == "short_answer"]
print(f"题库: {len(qs)} 题, 带扩展链: {sum(1 for q in qs if sa.has_expansion(q))}")

ok = True

# 1) 每题都能构建扩展卡，结构正确
for q in qs:
    card = sa.build_expansion_card(q, qs)
    assert card is not None, q["id"]
    steps = card["steps"]
    # 首步送分：干扰项数>=2，正确项在选项中
    s0 = steps[0]
    assert s0["answer_id"] in {o["id"] for o in s0["options"]}, q["id"]
    assert len(s0["options"]) >= 3, f"{q['id']} 首步选项过少"
    # 每步 answer_id 唯一命中
    for st_ in steps:
        hit = [o for o in st_["options"] if o["id"] == st_["answer_id"]]
        assert len(hit) == 1, f"{q['id']} answer_id 异常"
    # 名解链层数: 句式层 2-4 + 全文 → steps = 句式层数
    if q["id"] in {f"rsbz_{i}" for i in range(1, 9)}:
        assert 2 <= len(steps) <= 4, f"{q['id']} steps={len(steps)}"
    # 全文非空
    assert card["full_answer"], q["id"]
print(f"1) 全部 {len(qs)} 题扩展卡构建通过")

# 2) 阶段机：warmup 全轮完成 → expansion → expansion_answer 后 → cloze
q0 = qs[0]
progress = {"items": {}}
item = sa.ensure_item(progress, q0["id"], q0)
pts = sa.points_of(q0)
while item["stage"] == "warmup":
    card = sa.build_warmup_card(q0, item)
    if card is None:
        break
    sa.advance_after_warmup(item, card["_chosen_point_indices"], pts,
                            next_stage="expansion" if sa.has_expansion(q0) else "cloze")
assert item["stage"] == "expansion", item["stage"]
print("2) 热身完成 → 进入 expansion 阶段: OK")

# 模拟 expansion_answer: stage → cloze
item["stage"] = "cloze"
assert sa.is_learning_stage("expansion")
assert "expansion" in sa.STAGES
print("3) expansion 计入学习阶段/STAGES: OK")

# 4) 无扩展链的题（教资库）不受影响：advance 默认仍到 cloze
jz = next(b for b in d["banks"] if b.get("name") == "教资科二简答-短题")
jq = (jz["questions"] or [])[0]
assert not sa.has_expansion(jq)
item2 = {"warmup_covered": [], "warmup_round": 0}
jpts = sa.points_of(jq)
sa.advance_after_warmup(item2, list(range(len(jpts))), jpts)
assert item2["stage"] == "cloze", item2
print("4) 无扩展链题（教资）行为不变: OK")

# 5) 首步干扰项确实是荒谬句
c = sa.build_expansion_card(qs[0], qs)
s0 = c["steps"][0]
wrong_texts = [o["text"] for o in s0["options"] if o["id"] != s0["answer_id"]]
print(f"5) 首步干扰示例: {wrong_texts}")

print("\n全部测试通过")
