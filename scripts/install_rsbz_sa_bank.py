# -*- coding: utf-8 -*-
"""金海东《燃烧与爆炸》主观题（简答背诵）直装脚本。

方法论（与用户对齐）：
- 两卷主观题去重合并单库，按知识点组织；计算题不进背记管道
- 名解=定义成分拆点；简答=要点拆点；易混对（自热/受热自燃、沸溢/喷溅）
  的关键词互埋对方维度（对比锚点），连线/热身阶段同屏出干扰项
- 题 id 用 rsbz_ 前缀，避开 short_answer.py 中 MATCH_CLOZE_IDS={"2"}、
  UNORDERED_CLOZE_IDS={"6"} 的按题号硬编码碰撞
- 不用 install_short_bank（它会按 name/mode 替换现有教资简答库），
  直接追加独立 bank（mode=short_answer），放入「燃烧与爆炸」文件夹

用法：
  python scripts/install_rsbz_sa_bank.py            # 干跑：校验并打印数据稿
  python scripts/install_rsbz_sa_bank.py --install  # 实际写入 LiZF 题库
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FOLDER_NAME = "燃烧与爆炸"
BANK_NAME = "燃烧与爆炸-主观题背诵"


def P(idx: int, text: str, kws: list[str]) -> dict:
    """要点：index + 文本 + 该点关键词（自由默写按点判分用）。"""
    return {"index": idx, "text": text, "keywords": kws, "is_preamble": False}


QUESTIONS = [
    # ================= 名词解释（8 题） =================
    {
        "id": "rsbz_1", "num": "1", "type": "short_answer",
        "stem": "名词解释：闪燃",
        "options": [],
        "points": [
            P(1, "可燃液体蒸发出的蒸气与空气混合后，遇火源发生一闪即灭的燃烧现象",
              ["可燃液体", "蒸气", "火源", "一闪即灭"]),
            P(2, "持续时间一般小于5s", ["5s"]),
        ],
        "analysis": "闪燃与着火的区别：一闪即灭、不能持续燃烧。",
    },
    {
        "id": "rsbz_2", "num": "2", "type": "short_answer",
        "stem": "名词解释：闪点",
        "options": [],
        "points": [
            P(1, "可燃液体能发生闪燃的最低温度", ["闪燃", "最低温度"]),
            P(2, "闪点越低，火灾危险性越大，是评定液体火灾危险性的主要指标",
              ["越低", "火灾危险性", "主要指标"]),
        ],
        "analysis": "闪点越低，液体挥发性越强、火灾危险性越大。",
    },
    {
        "id": "rsbz_3", "num": "3", "type": "short_answer",
        "stem": "名词解释：自热自燃",
        "options": [],
        "points": [
            P(1, "在没有外部热源加热的情况下，可燃物依靠自身化学反应、物理或生物作用产热并蓄积",
              ["外部热源", "自身", "产热", "蓄积"]),
            P(2, "温度达到自燃点而自行起火的现象", ["自燃点", "自行起火"]),
        ],
        "analysis": "对比受热自燃：热量来源是自身产热，不需要外部热源。",
    },
    {
        "id": "rsbz_4", "num": "4", "type": "short_answer",
        "stem": "名词解释：受热自燃",
        "options": [],
        "points": [
            P(1, "可燃物在外部热源加热下，温度达到自燃点而自行燃烧的现象",
              ["外部热源", "自燃点", "自行燃烧"]),
            P(2, "与自热自燃的区别：必须有外部热源，起火过程由外部受热向内部蔓延",
              ["自热自燃", "外部热源", "内部蔓延"]),
        ],
        "analysis": "对比自热自燃：热量来自外部热源加热。",
    },
    {
        "id": "rsbz_5", "num": "5", "type": "short_answer",
        "stem": "名词解释：爆炸极限",
        "options": [],
        "points": [
            P(1, "可燃气体、蒸气或粉尘与空气形成的混合物，遇火源能够发生爆炸的浓度范围",
              ["可燃气体", "蒸气", "粉尘", "火源", "浓度范围"]),
            P(2, "以体积分数表示，介于爆炸下限与爆炸上限之间",
              ["体积分数", "爆炸下限", "爆炸上限"]),
        ],
        "analysis": "浓度接近完全反应浓度时爆炸威力最大。",
    },
    {
        "id": "rsbz_6", "num": "6", "type": "short_answer",
        "stem": "名词解释：喷溅",
        "options": [],
        "points": [
            P(1, "储油罐火灾中，高温热波传递至罐底水垫层，水大量汽化，蒸汽压力急剧升高",
              ["热波", "水垫层", "汽化", "蒸汽压力"]),
            P(2, "将上层油品顶起并抛洒出罐外的现象，爆发突然、破坏力极强",
              ["抛洒", "爆发突然", "破坏力"]),
        ],
        "analysis": "喷溅的水来自罐底水垫层，发生在沸溢之后。",
    },
    {
        "id": "rsbz_7", "num": "7", "type": "short_answer",
        "stem": "名词解释：沸溢",
        "options": [],
        "points": [
            P(1, "油罐火灾中，油品内部的乳化水、悬浮水受热汽化膨胀，使燃烧的油品泡沫化并溢出罐外",
              ["乳化水", "悬浮水", "汽化", "溢出"]),
            P(2, "发生在火灾早期，先于喷溅发生，使火势蔓延但危害相对较轻",
              ["火灾早期", "先于喷溅", "火势蔓延"]),
        ],
        "analysis": "沸溢的水来自油品内部（乳化水/悬浮水），区别于喷溅的罐底水垫层。",
    },
    {
        "id": "rsbz_8", "num": "8", "type": "short_answer",
        "stem": "名词解释：危险货物（危险物品）",
        "options": [],
        "points": [
            P(1, "具有爆炸、易燃、毒害、腐蚀、放射性等性质的物品",
              ["爆炸", "易燃", "毒害", "腐蚀", "放射性"]),
            P(2, "在运输、装卸和储存过程中，容易造成人身伤亡和财产损毁，需要特别防护",
              ["运输", "人身伤亡", "财产损毁", "特别防护"]),
        ],
        "analysis": "",
    },
    # ================= 简答题（7 题） =================
    {
        "id": "rsbz_9", "num": "9", "type": "short_answer",
        "stem": "简述燃烧的必要条件与充分条件。",
        "options": [],
        "points": [
            P(1, "必要条件即三要素：可燃物、氧化剂（助燃物）、着火源（点火源），三者同时存在、相互作用才可能燃烧",
              ["三要素", "可燃物", "氧化剂", "着火源", "相互作用"]),
            P(2, "充分条件：上述条件还需满足量的要求，即可燃物与氧化剂达到足够浓度、具备足够的点火能量并充分接触",
              ["量的要求", "足够浓度", "点火能量", "充分接触"]),
            P(3, "三要素是必要条件而非充分条件", ["必要条件", "充分条件"]),
        ],
        "analysis": "",
    },
    {
        "id": "rsbz_10", "num": "10", "type": "short_answer",
        "stem": "列表比较自热自燃与受热自燃的异同点。",
        "options": [],
        "points": [
            P(1, "共同点：均无需明火直接点燃，温度达到自燃点后自行燃烧，同属自燃范畴",
              ["明火", "自燃点", "自燃范畴"]),
            P(2, "热量来源：自热自燃靠可燃物自身化学反应、物理或生物作用产热；受热自燃必须由外部热源加热",
              ["热量来源", "自身", "产热", "外部热源"]),
            P(3, "外部加热：自热自燃不需要，常温或低温下即可发生；受热自燃必须有外部热源",
              ["常温", "低温", "外部热源"]),
            P(4, "起火过程：自热自燃由可燃物内部向外炭化、延烧；受热自燃由外部受热向内部蔓延",
              ["内部向外", "延烧", "向内部蔓延"]),
        ],
        "analysis": "",
    },
    {
        "id": "rsbz_11", "num": "11", "type": "short_answer",
        "stem": "简述防火技术措施的基本原则，并写出四类具体防火措施。",
        "options": [],
        "points": [
            P(1, "基本原则一：防止燃烧基本条件产生，即消除可燃物、消除火源、隔绝空气",
              ["基本条件", "消除火源", "隔绝空气"]),
            P(2, "基本原则二：防止燃烧条件相互作用，隔离可燃物与火源，阻止火势蔓延",
              ["相互作用", "阻止火势蔓延"]),
            P(3, "消除着火源：禁烟禁火、防爆灯具与防爆电气、接地避雷、控制温度",
              ["消除着火源", "防爆灯具", "接地避雷", "控制温度"]),
            P(4, "控制可燃物：以不燃或难燃材料替代、限制储存量、通风稀释降低浓度",
              ["控制可燃物", "不燃", "限制储存量", "通风稀释"]),
            P(5, "隔绝空气：惰性气体保护、设备密闭、充氮保护",
              ["隔绝空气", "惰性气体", "设备密闭"]),
            P(6, "阻止火势蔓延：设置防火墙、防火间距、防火堤、阻火装置",
              ["防火墙", "防火间距", "阻火装置"]),
        ],
        "analysis": "",
    },
    {
        "id": "rsbz_12", "num": "12", "type": "short_answer",
        "stem": "简述灭火的四种基本方法，并分别举例说明。",
        "options": [],
        "points": [
            P(1, "隔离法：移走或隔离可燃物，如关闭管道阀门、搬走易燃物",
              ["隔离法", "管道阀门", "易燃物"]),
            P(2, "冷却法：降温至燃点以下，如用水灭火",
              ["冷却法", "燃点", "用水灭火"]),
            P(3, "窒息法：隔绝空气、降低氧浓度，如二氧化碳、氮气灭火",
              ["窒息法", "氧浓度", "二氧化碳", "氮气"]),
            P(4, "化学抑制法：中断链式反应，如干粉灭火剂",
              ["化学抑制法", "链式反应", "干粉"]),
        ],
        "analysis": "核心原理：消除燃烧三要素中任意一个，燃烧就会终止。",
    },
    {
        "id": "rsbz_13", "num": "13", "type": "short_answer",
        "stem": "简述防火与防爆的总原则，并说明防爆的主要技术措施。",
        "options": [],
        "points": [
            P(1, "防火总原则：预防为主、防消结合，从源头控制燃烧条件",
              ["预防为主", "防消结合", "源头"]),
            P(2, "防爆总原则：控制爆炸极限范围，消除点火源，配套泄压、隔爆设施",
              ["爆炸极限", "点火源", "泄压", "隔爆"]),
            P(3, "防止形成爆炸性混合物：加强通风、惰性气体保护、设备密闭",
              ["爆炸性混合物", "加强通风", "惰性气体", "设备密闭"]),
            P(4, "消除点火源：采用防爆电气、防静电与防雷接地、严禁明火与高温表面",
              ["防爆电气", "防静电", "防雷接地", "明火"]),
            P(5, "削弱爆炸危害：设置泄压装置（安全阀、爆破片、泄爆口）、阻火隔爆装置、采用抗爆建筑结构",
              ["安全阀", "爆破片", "抗爆建筑结构"]),
        ],
        "analysis": "",
    },
    {
        "id": "rsbz_14", "num": "14", "type": "short_answer",
        "stem": "简述阻火安全装置的作用及常见类型。",
        "options": [],
        "points": [
            P(1, "作用：防止外部火焰窜入设备、管道，或阻止火焰在设备和管道之间蔓延，熄灭火焰",
              ["窜入", "蔓延", "熄灭火焰"]),
            P(2, "常见类型：安全液封、阻火器、阻火闸门、单向阀",
              ["安全液封", "阻火器", "阻火闸门", "单向阀"]),
            P(3, "阻火器依靠金属网的传热效应和器壁冷却作用熄灭火焰",
              ["金属网", "传热效应", "冷却作用"]),
        ],
        "analysis": "泄压装置属防爆泄压设施，不属于阻火装置。",
    },
    {
        "id": "rsbz_15", "num": "15", "type": "short_answer",
        "stem": "列表对比油罐火灾沸溢与喷溅的区别。",
        "options": [],
        "points": [
            P(1, "发生顺序：沸溢发生在火灾早期，先发生；喷溅在沸溢之后，发生更晚",
              ["火灾早期", "先发生", "沸溢之后"]),
            P(2, "水的来源：沸溢的水来自油品内部的乳化水、悬浮水；喷溅的水来自罐底的水垫层",
              ["乳化水", "悬浮水", "水垫层"]),
            P(3, "危害程度：沸溢使火势蔓延，危害相对较轻；喷溅油品大量喷出，爆发突然，破坏力极强",
              ["火势蔓延", "爆发突然", "破坏力极强"]),
            P(4, "发生条件：沸溢需热波特性、内部乳化水和黏度大；喷溅需高温热波传至罐底水垫层",
              ["热波特性", "黏度大", "罐底"]),
        ],
        "analysis": "",
    },
]

# 渐进扩展链（用户设计的"无错误学习"新阶段，插在热身多选与挖空之间）：
# 名解 = 范畴句 → 逐层补成分 → 完整定义；简答 = 总起句 → 骨架清单 → 全文。
# 约束：名解链每层包含前一层的全部实词（前缀式扩展），最后一层=完整答案。
EXPANSIONS = {
    # ---- 名词解释：逐层补成分 ----
    "rsbz_1": [
        "闪燃是燃烧现象。",
        "闪燃是遇火源发生一闪即灭的燃烧现象。",
        "闪燃是可燃液体蒸发出的蒸气与空气混合后，遇火源发生一闪即灭的燃烧现象。",
        "闪燃是可燃液体蒸发出的蒸气与空气混合后，遇火源发生一闪即灭的燃烧现象，持续时间一般小于5s。",
    ],
    "rsbz_2": [
        "闪点是温度。",
        "闪点是液体能发生闪燃的最低温度。",
        "闪点是可燃液体能发生闪燃的最低温度，是评定液体火灾危险性的主要指标。",
    ],
    "rsbz_3": [
        "自热自燃是自燃现象。",
        "自热自燃是无需外部热源、可燃物自身产热引起的自燃现象。",
        "自热自燃是在没有外部热源加热的情况下，可燃物依靠自身化学反应、物理或生物作用产热并蓄积，温度达到自燃点而自行起火的现象。",
    ],
    "rsbz_4": [
        "受热自燃是自燃现象。",
        "受热自燃是可燃物在外部热源加热下发生的自燃现象。",
        "受热自燃是可燃物在外部热源加热下，温度达到自燃点而自行燃烧的现象，起火过程由外部受热向内部蔓延。",
    ],
    "rsbz_5": [
        "爆炸极限是浓度范围。",
        "爆炸极限是可燃物遇火源能够发生爆炸的浓度范围。",
        "爆炸极限是可燃气体、蒸气或粉尘与空气形成的混合物，遇火源能够发生爆炸的浓度范围。",
        "爆炸极限是可燃气体、蒸气或粉尘与空气形成的混合物，遇火源能够发生爆炸的浓度范围，以体积分数表示，介于爆炸下限与爆炸上限之间。",
    ],
    "rsbz_6": [
        "喷溅是油罐火灾现象。",
        "喷溅是罐内油品被顶起并抛洒出罐外的油罐火灾现象。",
        "喷溅是储油罐火灾中，高温热波传递至罐底水垫层，水大量汽化、蒸汽压力急剧升高，将上层油品顶起并抛洒出罐外的现象。",
        "喷溅是储油罐火灾中，高温热波传递至罐底水垫层，水大量汽化、蒸汽压力急剧升高，将上层油品顶起并抛洒出罐外的现象，爆发突然、破坏力极强。",
    ],
    "rsbz_7": [
        "沸溢是油罐火灾现象。",
        "沸溢是燃烧的油品溢出罐外的油罐火灾现象。",
        "沸溢是油罐火灾中，油品内部的乳化水、悬浮水受热汽化膨胀，使燃烧的油品泡沫化并溢出罐外的现象。",
        "沸溢是油罐火灾中，油品内部的乳化水、悬浮水受热汽化膨胀，使燃烧的油品泡沫化并溢出罐外的现象，发生在火灾早期，先于喷溅，危害相对较轻。",
    ],
    "rsbz_8": [
        "危险货物是物品。",
        "危险货物是具有危险性质的物品。",
        "危险货物是具有爆炸、易燃、毒害、腐蚀、放射性等性质的物品。",
        "危险货物是具有爆炸、易燃、毒害、腐蚀、放射性等性质，在运输、装卸和储存过程中容易造成人身伤亡和财产损毁、需要特别防护的物品。",
    ],
    # ---- 简答题：总起句 → 骨架清单 → 全文（最后一层运行时取 answer） ----
    "rsbz_9": [
        "燃烧条件分为必要条件和充分条件，必要条件就是三要素。",
        "必要条件（三要素）：可燃物、氧化剂（助燃物）、着火源（点火源）；充分条件：满足量的要求——足够浓度、足够能量、充分接触。",
    ],
    "rsbz_10": [
        "自热自燃与受热自燃同属自燃范畴，从热量来源、外部加热、起火过程三个维度区别。",
        "共同点：无需明火、达到自燃点后自行燃烧；区别维度：热量来源（自身产热/外部热源）、外部加热（不需要/必须）、起火过程（内部向外/外部向内）。",
    ],
    "rsbz_11": [
        "防火技术措施有两条基本原则、四类具体措施。",
        "基本原则：防止燃烧基本条件产生、防止燃烧条件相互作用；四类措施：消除着火源、控制可燃物、隔绝空气、阻止火势蔓延。",
    ],
    "rsbz_12": [
        "灭火有四种基本方法。",
        "四种方法：隔离法、冷却法、窒息法、化学抑制法。",
    ],
    "rsbz_13": [
        "防火与防爆各有总原则，防爆技术措施分三类。",
        "防火总原则：预防为主、防消结合；防爆总原则：控制爆炸极限、消除点火源、配套泄压隔爆；三类措施：防止形成爆炸性混合物、消除点火源、削弱爆炸危害。",
    ],
    "rsbz_14": [
        "阻火安全装置有明确的作用和四种常见类型。",
        "作用：防止外部火焰窜入或阻止火焰蔓延；常见类型：安全液封、阻火器、阻火闸门、单向阀。",
    ],
    "rsbz_15": [
        "沸溢与喷溅从四个维度区别。",
        "四个维度：发生顺序、水的来源、危害程度、发生条件。",
    ],
}


def finalize_questions() -> list[dict]:
    """补全 answer 汇总文本与全局 keywords（挖空用，长词优先无序）。"""
    out = []
    for q in QUESTIONS:
        q = dict(q)
        kws: list[str] = []
        for p in q["points"]:
            for k in p["keywords"]:
                if k not in kws:
                    kws.append(k)
        q["keywords"] = kws
        q["answer"] = "\n".join(
            f"{p['index']}. {p['text']}" for p in q["points"])
        # 渐进扩展链：名解末层=完整定义句；简答末层=分点全文（运行时拼接）
        chain = list(EXPANSIONS.get(q["id"], []))
        if chain:
            chain.append(q["answer"])
        q["expansion"] = chain
        out.append(q)
    return out


def validate(qs: list[dict]) -> list[str]:
    """校验：关键词必须是某个要点文本的子串（否则挖不出空）。"""
    errors = []
    seen_ids = set()
    for q in qs:
        tag = f"[{q['stem']}]"
        if q["id"] in seen_ids:
            errors.append(f"{tag} id 重复: {q['id']}")
        seen_ids.add(q["id"])
        if str(q.get("id")) in ("2", "6"):
            errors.append(f"{tag} id 与教资硬编码集碰撞")
        all_text = " ".join(p["text"] for p in q["points"])
        for k in q["keywords"]:
            if k not in all_text:
                errors.append(f"{tag} 关键词「{k}」不在任何要点文本中，挖不出空")
        if not q["points"]:
            errors.append(f"{tag} 无要点")
        for p in q["points"]:
            for k in p["keywords"]:
                if k not in p["text"]:
                    errors.append(f"{tag} 第{p['index']}点关键词「{k}」不在该点文本中")
        chain = q.get("expansion") or []
        if len(chain) < 3:
            errors.append(f"{tag} 扩展链层数不足（{len(chain)}<3）")
        # 名解链：除末层（分点全文）外，各层应以同一术语开头（前缀式扩展）
        if q["id"] in {f"rsbz_{i}" for i in range(1, 9)} and len(chain) >= 3:
            head = chain[0][:2]
            for i, layer in enumerate(chain[:-1]):
                if not layer.startswith(head):
                    errors.append(f"{tag} 扩展链第{i+1}层未以「{head}」开头")
    return errors


def dry_run() -> None:
    qs = finalize_questions()
    errors = validate(qs)
    if errors:
        print("== 校验失败 ==")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print(f"== 校验通过：{BANK_NAME} 共 {len(qs)} 题（名解 8 + 简答 7）==\n")
    for q in qs:
        print(f"◆ {q['num']}. {q['stem']}")
        print("   [渐进扩展链]")
        for i, layer in enumerate(q["expansion"], 1):
            text = layer.replace("\n", " ／ ")
            print(f"      L{i}: {text}")
        for p in q["points"]:
            print(f"   {p['index']}. {p['text']}")
            print(f"      关键词: {'、'.join(p['keywords'])}")
        print()


def install(user: str = "LiZF") -> None:
    from app import UserData, new_bank_id, now_str  # noqa: E402
    from lykie import folders as lykie_folders  # noqa: E402
    from lykie import settle as lykie_settle  # noqa: E402
    from lykie.import_rules import attach_question_defaults  # noqa: E402

    qs = finalize_questions()
    errors = validate(qs)
    if errors:
        print("校验失败，中止安装：")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    store = UserData(user)
    questions = [attach_question_defaults(q, i) for i, q in enumerate(qs, 1)]
    # attach_question_defaults 会覆写 id 为序号——恢复 rsbz_ 前缀 id
    for q, src in zip(questions, qs):
        q["id"] = src["id"]

    existing = next((b for b in store.banks if b.get("name") == BANK_NAME), None)
    if existing:
        # 已入库：原位更新题目（id 稳定，sa_progress.json 不受影响）
        existing["questions"] = questions
        lykie_settle.ensure_bank_runs(existing)
        store.save()
        print(f"已更新现有题库: {BANK_NAME} (id={existing['id']}, {len(questions)}题, "
              f"含扩展链 {sum(1 for q in questions if q.get('expansion'))} 题)")
        return
    folder, err = lykie_folders.ensure_folder(store, FOLDER_NAME)
    if not folder:
        print(f"建文件夹失败: {err}")
        sys.exit(1)
    bank = {
        "id": new_bank_id(),
        "name": BANK_NAME,
        "mode": "short_answer",
        "imported_at": now_str(),
        "questions": questions,
        "folder_id": folder["id"],
    }
    lykie_settle.ensure_bank_runs(bank)
    store.banks.append(bank)
    store.save()
    print(f"{user} <- {BANK_NAME} (id={bank['id']}, {len(questions)}题, "
          f"mode=short_answer, 文件夹={folder['name']})")


if __name__ == "__main__":
    if "--install" in sys.argv:
        install()
    else:
        dry_run()
