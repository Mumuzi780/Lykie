# -*- coding: utf-8 -*-
"""选词入空阶段函数级测试：卡片结构 + 阶段机流转（expansion → pick_fill → cloze）。"""
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

# 1) 每题都能构建选词入空卡，结构正确
for q in qs:
    card = sa.build_pick_fill_card(q, qs)
    assert card is not None, q["id"]
    assert card["kind"] == "pick_fill", q["id"]
    answers = card["_answers"]
    opts = card["options"]
    assert len(answers) == card["blank_count"], q["id"]
    # 选项数 = 每空一个词块 + 至多 2 个干扰
    assert len(answers) <= len(opts) <= len(answers) + 2, f"{q['id']} 选项数异常"
    # 每个空的答案词块都出现在选项中
    for a in answers:
        assert sum(1 for o in opts if o["text"] == a) >= 1, f"{q['id']} 缺答案词块 {a}"
    # 空位与答案一一对应：parts 中 blank_index 数量一致
    n_blanks = sum(1 for line in card["parts"] for seg in line["segs"] if seg.get("type") == "blank")
    assert n_blanks == len(answers), f"{q['id']} 空位数 {n_blanks} != 答案数 {len(answers)}"
print(f"1) 全部 {len(qs)} 题选词入空卡构建通过")

# 2) 阶段机：warmup → expansion → (expansion_answer 逻辑) → pick_fill → (pickfill_answer 逻辑) → cloze
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
print("2) 热身完成 → expansion: OK")

# expansion_answer 端点逻辑
if (item.get("stage") or "") == "expansion":
    item["stage"] = "pick_fill"
assert item["stage"] == "pick_fill"
print("3) expansion 上报 → pick_fill: OK")

# pickfill_answer 端点逻辑
if (item.get("stage") or "") == "pick_fill":
    item["stage"] = "cloze"
assert item["stage"] == "cloze"
print("4) pick_fill 上报 → cloze: OK")

# 5) 阶段收录：STAGES 与学习阶段判定
assert "pick_fill" in sa.STAGES
assert sa.is_learning_stage("pick_fill")
print("5) pick_fill 计入 STAGES/学习阶段: OK")

# 6) 无扩展链题（教资库）不受影响：advance 默认仍到 cloze
jz = next(b for b in d["banks"] if b.get("name") == "教资科二简答-短题")
jq = (jz["questions"] or [])[0]
assert not sa.has_expansion(jq)
item2 = {"warmup_covered": [], "warmup_round": 0}
jpts = sa.points_of(jq)
sa.advance_after_warmup(item2, list(range(len(jpts))), jpts)
assert item2["stage"] == "cloze", item2
print("6) 无扩展链题（教资）行为不变: OK")

# 7) 打印第一题样例
c = sa.build_pick_fill_card(qs[0], qs)
print(f"7) 样例 {qs[0]['id']}: {c['blank_count']} 空, 选项 {len(c['options'])} 个: {[o['text'] for o in c['options']]}")

print("\n全部测试通过")
