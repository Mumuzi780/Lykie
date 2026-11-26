# -*- coding: utf-8 -*-
"""金海东《燃烧与爆炸》客观题直装脚本。

数据来源：
- 卷A（模拟期末试题）：河北工程大学.docx + 燃烧与爆炸模拟试题参考答案.docx
  注：答案文档填空第2条（燃烧三特征）在试题中无对应题，试题填空第5题（自燃
  分类）在答案文档中缺失，已按内容重新对位；自燃分类答案取自知识点总结。
- 卷B（复习测试题）：燃烧与防火防爆复习测试题.docx（无答案文件，答案按
  知识点总结 + 卷A参考答案解析推导）。

用法：
  python scripts/install_rsbz_banks.py            # 干跑：只校验并打印题目清单
  python scripts/install_rsbz_banks.py --install  # 实际写入 LiZF 题库
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FOLDER_NAME = "燃烧与爆炸"

# ---------------- 卷A：模拟期末试题（客观题 25 题） ----------------
PAPER_A = {
    "name": "燃烧与爆炸-模拟期末·客观题",
    "questions": [
        # 一、填空题（10 题，多空保留一题、答案分点列出，自评判分）
        {"num": "1", "type": "fill", "options": [],
         "stem": "燃烧七个学说分别为燃烧素学说、氧学说、______、过氧化物理论、分子碰撞理论、______和分支链反应理论；现代解释燃烧的主流理论是______。",
         "answer": "1.活化能理论 2.链（连锁）反应理论 3.链反应理论",
         "analysis": "现代主流解释为链反应理论，燃烧靠自由基持续传递。"},
        {"num": "2", "type": "fill", "options": [],
         "stem": "燃烧的三必要条件：______、______、______；燃烧还需要满足量的要求，称为燃烧的______条件。",
         "answer": "1.可燃物 2.氧化剂（助燃物） 3.着火源（点火源） 4.充分",
         "analysis": "三要素是必要条件而非充分条件，充分条件还要求足够的浓度、氧含量和点火能量。"},
        {"num": "3", "type": "fill", "options": [],
         "stem": "按燃烧发生特点，燃烧可分为闪燃、______、______和______。",
         "answer": "1.着火 2.自燃 3.爆炸",
         "analysis": ""},
        {"num": "4", "type": "fill", "options": [],
         "stem": "闪燃的持续时间一般小于______s；液体能发生闪燃的最低温度称为______。",
         "answer": "1.5 2.闪点",
         "analysis": "闪点越低，液体挥发性越强、火灾危险性越大。"},
        {"num": "5", "type": "fill", "options": [],
         "stem": "自燃分为______自燃和______自燃。",
         "answer": "1.自热 2.受热",
         "analysis": "自热自燃靠自身化学反应/物理/生物作用产热；受热自燃必须有外部热源加热。"},
        {"num": "6", "type": "fill", "options": [],
         "stem": "四种灭火基本方法：隔离法、______、窒息法和______。",
         "answer": "1.冷却法 2.化学抑制法",
         "analysis": ""},
        {"num": "7", "type": "fill", "options": [],
         "stem": "爆炸极限是可燃物质在空气中遇火源能够发生爆炸的______浓度与______浓度之间的范围。",
         "answer": "1.最低（爆炸下限） 2.最高（爆炸上限）",
         "analysis": ""},
        {"num": "8", "type": "fill", "options": [],
         "stem": "油罐火灾中，沸溢的水来自油品内部的______；喷溅的水来自油罐的______。",
         "answer": "1.乳化水（悬浮水） 2.水垫层",
         "analysis": ""},
        {"num": "9", "type": "fill", "options": [],
         "stem": "工业建筑耐火等级共分______级，其中______耐火等级最高；甲、乙类厂房的耐火等级不应低于______级。",
         "answer": "1.四 2.一级 3.二级",
         "analysis": ""},
        {"num": "10", "type": "fill", "options": [],
         "stem": "阻火器依靠______效应和器壁冷却作用熄灭火焰。",
         "answer": "金属网（传热）",
         "analysis": ""},
        # 二、单项选择题（10 题）
        {"num": "11", "type": "choice",
         "stem": "燃烧的本质是（　）",
         "options": ["物理相变", "放热、发光的氧化反应", "单纯升温过程", "物质熔化"],
         "answer": "B",
         "analysis": "燃烧本质是放热、发光的氧化反应，属于化学变化，不是单纯的物理相变或升温。"},
        {"num": "12", "type": "choice",
         "stem": "下列现象属于燃烧的是（　）",
         "options": ["白炽灯灯丝发光", "煤炭燃烧", "生石灰遇水放热", "灯泡发光发热"],
         "answer": "B",
         "analysis": "煤燃烧放热发光且生成新物质；灯泡灯丝发光、生石灰遇水放热均无新物质生成，不属于燃烧。"},
        {"num": "13", "type": "choice",
         "stem": "闪点用来评价哪类物质的火灾危险性（　）",
         "options": ["可燃固体", "可燃液体", "可燃粉尘", "金属固体"],
         "answer": "B",
         "analysis": "闪点是可燃液体能发生闪燃的最低温度，用于评定液体火灾危险性（闪点越低越危险）。"},
        {"num": "14", "type": "choice",
         "stem": "干粉灭火剂的主要灭火机理是（　）",
         "options": ["冷却降温", "隔离可燃物", "化学抑制、中断链式反应", "隔绝氧气"],
         "answer": "C",
         "analysis": "干粉灭火剂通过中断燃烧链式反应实现灭火，属化学抑制法。"},
        {"num": "15", "type": "choice",
         "stem": "下列条件会使爆炸极限范围变窄、危险性下降的是（　）",
         "options": ["温度升高", "加入惰性气体", "压力升高", "点火能量增大"],
         "answer": "B",
         "analysis": "加入惰性气体可降低氧含量、缩小爆炸极限范围；温度、压力、氧含量、点火能量升高均使范围变宽。"},
        {"num": "16", "type": "choice",
         "stem": "关于沸溢与喷溅，下面说法正确的是（　）",
         "options": ["喷溅先发生，沸溢后发生", "沸溢的水来自罐底水垫层", "喷溅的破坏力大于沸溢", "沸溢不需要油品具有热波特性"],
         "answer": "C",
         "analysis": "沸溢先发生、喷溅在其后；沸溢的水来自油品内部乳化水，喷溅的水来自罐底水垫层；喷溅爆发突然、破坏力更强。"},
        {"num": "17", "type": "choice",
         "stem": "六通安全液封属于（　）",
         "options": ["泄压装置", "阻火装置", "检测报警装置", "灭火装置"],
         "answer": "B",
         "analysis": "安全液封以水为阻火介质，属阻火装置，与阻火器、阻火闸门、单向阀同类。"},
        {"num": "18", "type": "choice",
         "stem": "不需要外部热源，依靠物质自身化学反应产热起火属于（　）",
         "options": ["受热自燃", "自热自燃", "闪燃", "着火"],
         "answer": "B",
         "analysis": "自热自燃靠自身化学反应、物理或生物作用产热；受热自燃必须有外部热源加热。"},
        {"num": "19", "type": "choice",
         "stem": "理查特里公式主要用于计算（　）",
         "options": ["闪点", "混合可燃气体的爆炸极限", "自燃点", "热波传播速度"],
         "answer": "B",
         "analysis": "理查特里（Le Chatelier）公式用于计算多组分混合可燃气体的爆炸极限。"},
        {"num": "20", "type": "choice",
         "stem": "甲、乙类厂房的耐火等级最低为（　）",
         "options": ["一级", "二级", "三级", "四级"],
         "answer": "B",
         "analysis": "甲、乙类厂房火灾危险性大，耐火等级不应低于二级。"},
        # 三、多项选择题（5 题，答案为字母串，前端自动识别为多选）
        {"num": "21", "type": "choice",
         "stem": "燃烧具有哪些特征（　）",
         "options": ["放热", "发光", "生成新物质", "必须有火焰"],
         "answer": "ABC",
         "analysis": "燃烧三特征为放热、发光、生成新物质，并不要求必须有可见火焰（如表面燃烧）。"},
        {"num": "22", "type": "choice",
         "stem": "属于阻火安全装置的有（　）",
         "options": ["安全液封", "阻火器", "阻火闸门", "单向阀"],
         "answer": "ABCD",
         "analysis": "安全液封、阻火器、阻火闸门、单向阀均属阻火安全装置；泄压装置属防爆泄压设施，不属阻火装置。"},
        {"num": "23", "type": "choice",
         "stem": "爆炸极限的影响因素包括（　）",
         "options": ["初始温度", "初始压力", "氧含量", "点火能量"],
         "answer": "ABCD",
         "analysis": "初始温度、压力升高，氧含量与点火能量增大，都会使爆炸极限范围变宽。"},
        {"num": "24", "type": "choice",
         "stem": "沸溢发生需要的条件有（　）",
         "options": ["油品具备热波特性", "油品含有乳化水、悬浮水", "油品黏度大", "罐底存在水垫层"],
         "answer": "ABC",
         "analysis": "沸溢需热波特性、内部乳化水（悬浮水）和黏度大三个条件；罐底水垫层是喷溅的条件。"},
        {"num": "25", "type": "choice",
         "stem": "灭火的基本方法有（　）",
         "options": ["隔离法", "冷却法", "窒息法", "化学抑制法"],
         "answer": "ABCD",
         "analysis": "灭火四法为隔离法、冷却法、窒息法、化学抑制法。"},
    ],
}

# ---------------- 卷B：复习测试题（客观题 28 题） ----------------
# 无答案文件：填空/判断按知识点总结直接确定；选择按知识点推导（多选已逐项核对）。
PAPER_B = {
    "name": "燃烧与爆炸-复习测试·客观题",
    "questions": [
        # 一、填空题（8 题）
        {"num": "1", "type": "fill", "options": [],
         "stem": "燃烧的七个学说是燃烧素学说、氧学说、______、过氧化物理论、分子碰撞理论、______和分支链反应理论。",
         "answer": "1.活化能理论 2.链（连锁）反应理论",
         "analysis": "现代主流解释为链反应理论，燃烧靠自由基持续传递。"},
        {"num": "2", "type": "fill", "options": [],
         "stem": "燃烧的三个特征是______、______和______。",
         "answer": "1.放热 2.发光 3.生成新物质（发生氧化反应）",
         "analysis": "易错点：灯泡发光是电能转化，无新物质生成，不属于燃烧。"},
        {"num": "3", "type": "fill", "options": [],
         "stem": "燃烧的必要条件是可燃物、______和______；此外还须满足足够的浓度、氧含量和点火能量，即燃烧的______条件。",
         "answer": "1.氧化剂（助燃物） 2.着火源（点火源） 3.充分",
         "analysis": ""},
        {"num": "4", "type": "fill", "options": [],
         "stem": "按燃烧发生特点，燃烧可分为闪燃、______、______和______。",
         "answer": "1.着火 2.自燃 3.爆炸",
         "analysis": ""},
        {"num": "5", "type": "fill", "options": [],
         "stem": "闪燃是可燃液体蒸发出的蒸气与空气混合后遇火源发生一闪即灭的燃烧现象，其持续时间一般小于______s。",
         "answer": "5",
         "analysis": ""},
        {"num": "6", "type": "fill", "options": [],
         "stem": "灭火的四种基本方法是隔离法、______、______和______。",
         "answer": "1.冷却法 2.窒息法 3.化学抑制法",
         "analysis": "隔离法：移走/隔离可燃物；冷却法：降温至燃点以下（如水灭火）；窒息法：隔绝空气/降低氧浓度；化学抑制法：中断链式反应（如干粉灭火剂）。"},
        {"num": "7", "type": "fill", "options": [],
         "stem": "工业建筑耐火等级共分______级，其中第______级最高；甲、乙类厂房的耐火等级不低于______级。",
         "answer": "1.四 2.一 3.二级",
         "analysis": ""},
        {"num": "8", "type": "fill", "options": [],
         "stem": "油罐发生沸溢时，水的来源是油品内部的______；发生喷溅时，水的来源是罐底的______。",
         "answer": "1.乳化水（悬浮水） 2.水垫层",
         "analysis": ""},
        # 二、选择题（12 题，第 4/5/9/11/12 题为多选）
        {"num": "9", "type": "choice",
         "stem": "现代解释燃烧现象的主流理论是（　）",
         "options": ["燃烧素学说", "氧学说", "链（连锁）反应理论", "活化能理论"],
         "answer": "C",
         "analysis": "现代主流解释为链反应理论，燃烧靠自由基持续传递。"},
        {"num": "10", "type": "choice",
         "stem": "下列现象中不属于燃烧的是（　）",
         "options": ["木炭燃烧", "灯泡通电发光发热", "镁条燃烧", "纸张燃烧"],
         "answer": "B",
         "analysis": "灯泡发光是电能转化，无新物质生成，不属于燃烧。"},
        {"num": "11", "type": "choice",
         "stem": "关于闪点，下列说法正确的是（　）",
         "options": ["闪点越高，火灾危险性越大", "闪点是液体能发生闪燃的最低温度", "闪点是液体发生自燃的温度", "闪点与液体蒸发出的蒸气无关"],
         "answer": "B",
         "analysis": "闪点越低，液体挥发性越强、火灾危险性越大，是评定液体火灾危险性的主要指标。"},
        {"num": "12", "type": "choice",
         "stem": "可燃液体火灾爆炸危险性参数包括（　）",
         "options": ["闪点", "沸点", "饱和蒸气压", "相对密度", "流动扩散性"],
         "answer": "ABCDE",
         "analysis": "闪点、沸点、饱和蒸气压、相对密度、流动扩散性均为可燃液体火灾爆炸危险性的评定参数。"},
        {"num": "13", "type": "choice",
         "stem": "会使爆炸极限范围变宽、危险性升高的因素有（　）",
         "options": ["温度升高", "压力增大", "氧含量提升", "点火能量增大", "温度降低"],
         "answer": "ABCD",
         "analysis": "温度升高、压力增大、氧含量提升、点火能量增大都会使爆炸极限范围变宽，危险性升高；温度降低则相反。"},
        {"num": "14", "type": "choice",
         "stem": "可燃气体爆炸威力最大的浓度是（　）",
         "options": ["爆炸下限浓度", "爆炸上限浓度", "完全反应的理论浓度", "低于爆炸下限的浓度"],
         "answer": "C",
         "analysis": "浓度接近完全反应浓度时，爆炸威力最大。"},
        {"num": "15", "type": "choice",
         "stem": "干粉灭火剂的主要灭火原理是（　）",
         "options": ["隔离可燃物", "冷却降温", "隔绝空气窒息", "化学抑制，中断链式反应"],
         "answer": "D",
         "analysis": "干粉灭火剂通过中断燃烧链式反应实现灭火，属化学抑制法。"},
        {"num": "16", "type": "choice",
         "stem": "用水灭火主要利用的灭火原理是（　）",
         "options": ["隔离法", "冷却法", "窒息法", "化学抑制法"],
         "answer": "B",
         "analysis": "水灭火主要是冷却降温至燃点以下。"},
        {"num": "17", "type": "choice",
         "stem": "油罐发生沸溢需具备的条件有（　）",
         "options": ["油品具有热波特性", "油品中含乳化水或悬浮水", "油品黏度大", "罐底存在水垫层"],
         "answer": "ABC",
         "analysis": "沸溢需热波特性、内部乳化水（悬浮水）和黏度大三个条件；罐底水垫层是喷溅的条件。"},
        {"num": "18", "type": "choice",
         "stem": "工业建筑耐火等级中最高的是（　）",
         "options": ["一级", "二级", "三级", "四级"],
         "answer": "A",
         "analysis": "耐火等级共分四级，一级最高。"},
        {"num": "19", "type": "choice",
         "stem": "下列属于阻火安全装置的有（　）",
         "options": ["安全液封", "阻火器", "单向阀", "阻火闸门", "泄压装置"],
         "answer": "ABCD",
         "analysis": "安全液封、阻火器、阻火闸门、单向阀均属阻火安全装置；泄压装置属防爆泄压设施，不属阻火装置。"},
        {"num": "20", "type": "choice",
         "stem": "下列属于防爆技术措施的有（　）",
         "options": ["加强通风", "惰性气体保护", "采用防爆电气", "防静电", "设置泄压装置"],
         "answer": "ABCDE",
         "analysis": "防爆三类措施：防止形成爆炸性混合物（通风、惰性气体保护）、消除点火源（防爆电气、防静电）、削弱爆炸危害（泄压装置等）。"},
        # 三、判断题（8 题，答案统一「对/错」）
        {"num": "21", "type": "judge", "options": [],
         "stem": "灯泡通电发光发热属于燃烧。",
         "answer": "错",
         "analysis": "灯泡发光是电能转化，无新物质生成，不属于燃烧。"},
        {"num": "22", "type": "judge", "options": [],
         "stem": "闪点越低，液体的火灾危险性越大。",
         "answer": "对",
         "analysis": "闪点越低，液体挥发性越强、火灾危险性越大。"},
        {"num": "23", "type": "judge", "options": [],
         "stem": "自热自燃必须由外部热源加热才能发生。",
         "answer": "错",
         "analysis": "自热自燃靠自身化学反应、物理或生物作用产热，不需要外部热源；受热自燃才必须有外部热源。"},
        {"num": "24", "type": "judge", "options": [],
         "stem": "干粉灭火剂灭火属于化学抑制法。",
         "answer": "对",
         "analysis": "干粉灭火剂通过中断燃烧链式反应实现灭火。"},
        {"num": "25", "type": "judge", "options": [],
         "stem": "甲、乙类厂房的耐火等级不应低于三级。",
         "answer": "错",
         "analysis": "甲、乙类厂房耐火等级不应低于二级。"},
        {"num": "26", "type": "judge", "options": [],
         "stem": "喷溅一般发生在沸溢之后，破坏力更强。",
         "answer": "对",
         "analysis": "沸溢先发生、喷溅在其后；喷溅爆发突然、破坏力更强。"},
        {"num": "27", "type": "judge", "options": [],
         "stem": "燃烧的三个特征为放热、发光和生成新物质。",
         "answer": "对",
         "analysis": ""},
        {"num": "28", "type": "judge", "options": [],
         "stem": "可燃气体浓度接近完全反应的浓度时，爆炸威力最大。",
         "answer": "对",
         "analysis": "浓度接近完全反应浓度（理论爆炸反应浓度）时，爆炸威力最大。"},
    ],
}


def validate(papers: list[dict]) -> list[str]:
    """返回校验错误列表（空 = 通过）。"""
    errors = []
    for p in papers:
        for i, q in enumerate(p["questions"], 1):
            tag = f"[{p['name']} 第{i}题]"
            if q["type"] not in ("choice", "judge", "fill"):
                errors.append(f"{tag} 非客观题类型: {q['type']}")
            if not str(q.get("stem") or "").strip():
                errors.append(f"{tag} 题干为空")
            if not str(q.get("answer") or "").strip():
                errors.append(f"{tag} 答案为空")
            if q["type"] == "choice":
                opts = q.get("options") or []
                if len(opts) < 2:
                    errors.append(f"{tag} 选项少于2个")
                ans = re.sub(r"[^A-H]", "", str(q["answer"]).upper())
                if not ans or not re.fullmatch(r"[A-H]+", ans):
                    errors.append(f"{tag} 选择题答案非字母: {q['answer']}")
                else:
                    for ch in ans:
                        if ord(ch) - ord("A") >= len(opts):
                            errors.append(f"{tag} 答案 {ch} 超出选项范围")
            if q["type"] == "judge" and str(q["answer"]).strip() not in ("对", "错"):
                errors.append(f"{tag} 判断题答案非「对/错」: {q['answer']}")
        # 题号唯一且连续（从1起）
        nums = [q.get("num") for q in p["questions"]]
        expect = [str(i) for i in range(1, len(nums) + 1)]
        if nums != expect:
            errors.append(f"[{p['name']}] 题号不连续: {nums}")
    return errors


def dry_run() -> None:
    papers = [PAPER_A, PAPER_B]
    errors = validate(papers)
    if errors:
        print("== 校验失败 ==")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("== 校验通过 ==")
    for p in papers:
        from collections import Counter
        c = Counter(q["type"] for q in p["questions"])
        multi = sum(1 for q in p["questions"]
                    if q["type"] == "choice"
                    and len(re.sub(r"[^A-H]", "", str(q["answer"]).upper())) > 1)
        print(f"\n### {p['name']}：共 {len(p['questions'])} 题 "
              f"(选择 {c.get('choice', 0)}（其中多选 {multi}）/ 填空 {c.get('fill', 0)} / 判断 {c.get('judge', 0)}）")
        for q in p["questions"]:
            ans = q["answer"]
            if q["type"] == "choice":
                letters = re.sub(r"[^A-H]", "", str(ans).upper())
                ans = "、".join(
                    f"{ch}.{q['options'][ord(ch) - ord('A')]}" for ch in letters)
            print(f"  {q['num']}. [{q['type']}] {q['stem']}")
            if q["type"] == "choice":
                for j, o in enumerate(q["options"]):
                    print(f"     {chr(ord('A') + j)}. {o}")
            print(f"     答案: {ans}")


def install(user: str = "LiZF") -> None:
    from app import UserData, new_bank_id, now_str  # noqa: E402
    from lykie import folders as lykie_folders  # noqa: E402
    from lykie import settle as lykie_settle  # noqa: E402
    from lykie.import_rules import attach_question_defaults  # noqa: E402

    errors = validate([PAPER_A, PAPER_B])
    if errors:
        print("校验失败，中止安装：")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    store = UserData(user)
    existing = {b["name"] for b in store.banks}
    for p in (PAPER_A, PAPER_B):
        if p["name"] in existing:
            print(f"跳过（已存在同名题库）: {p['name']}")
            continue
        questions = [
            attach_question_defaults(q, i)
            for i, q in enumerate(p["questions"], 1)
        ]
        folder, err = lykie_folders.ensure_folder(store, FOLDER_NAME)
        if not folder:
            print(f"建文件夹失败: {err}")
            sys.exit(1)
        bank = {
            "id": new_bank_id(),
            "name": p["name"],
            "imported_at": now_str(),
            "questions": questions,
            "folder_id": folder["id"],
        }
        lykie_settle.ensure_bank_runs(bank)
        store.banks.append(bank)
        print(f"{user} <- {p['name']} (id={bank['id']}, "
              f"{len(questions)}题, 文件夹={folder['name']})")
    store.save()
    print("完成。")


if __name__ == "__main__":
    if "--install" in sys.argv:
        install()
    else:
        dry_run()
