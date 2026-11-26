# -*- coding: utf-8 -*-
"""《操作系统》三套真题试卷填空题追加脚本（阶段2，共30题）。

数据来源：D:\\Lykie-本地归档\\操作系统文件题 三套试卷 + 官方答案文档。
将每套试卷的10道填空题追加到阶段1已建立的对应题库（一套试卷一个题库）。

答案均按官方答案文档逐题核对：
- 20级：5 / 有限等待 / 3 / 阻塞 / 4 / 1024、5220 / 5 / ①wait(a)②signal(e)③wait(d)④wait(h) / 索引顺序文件 / 逻辑
- 21级：异步性 / 不可抢占 / 越界 / 直接存储器(DMA) / 记录式 / 内存 / 1-n(或-(n-1)) / 没有 / 1 / 6154
- 22级：2 / 树形结构 / 解除 / J1，J2，J3 / 5226 / 4 / 虚拟 / -2 / 外部设备 / 有
- 21级填空8、22级填空10 为资源分配图配图题，文本版无法还原图内容，题干加【含图片】标记并注明需对照原卷。
- 22级答案 docx 的 FIFO 缺页率 10/12 与缺页次数 9 矛盾，属应用题，与本脚本无关。

用法：
  python scripts/install_os_papers_stage2.py            # 干跑：只校验并打印题目清单
  python scripts/install_os_papers_stage2.py --install  # 追加到 LiZF 既有题库（幂等）
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# ---------------- 20级 填空题（10 题） ----------------
FILL_20 = {
    "bank": "操作系统-20级试卷A·客观题",
    "questions": [
        {"num": "31", "type": "fill", "options": [],
         "stem": "下面7个系统中，必须使用实时操作系统的总个数为______。①航空订票系统 ②火炮自动控制系统 ③飞机自动驾驶系统 ④播放视频的多媒体系统 ⑤嵌入式系统 ⑥办公自动化系统 ⑦计算机辅助设计系统",
         "answer": "5",
         "analysis": "②火炮自动控制、③飞机自动驾驶、④播放视频的多媒体、⑤嵌入式系统、①航空订票系统共5个必须使用实时系统；办公自动化与CAD不要求实时。"},
        {"num": "32", "type": "fill", "options": [],
         "stem": "同步机制应遵循的规则包括：空闲让进、忙则等待、______、让权等待。",
         "answer": "有限等待",
         "analysis": "同步机制应遵循四条规则：空闲让进、忙则等待、有限等待、让权等待。"},
        {"num": "33", "type": "fill", "options": [],
         "stem": "某系统中的空闲分区表如下：分区号1（28K，起始地址100K）、2（40K，150K）、3（95K，200K）、4（210K，320K）、5（15K，530K）。系统采用可变式分区存储管理策略，假设有一个作业大小为50K，采用首次适应算法可以为它分配______号分区。",
         "answer": "3",
         "analysis": "首次适应从低地址起找第一个能容纳50K的分区：1号28K、2号40K均不够，3号95K满足，分配3号分区。"},
        {"num": "34", "type": "fill", "options": [],
         "stem": "正在运行的进程，因某种原因而暂时停止运行，等待某个事件的发生，此时该进程处于______状态。",
         "answer": "阻塞",
         "analysis": "等待某个事件发生而暂停运行的进程处于阻塞态。"},
        {"num": "35", "type": "fill", "options": [],
         "stem": "用信号量S实现对系统中4台打印机的互斥使用，S的初值应设置为______。",
         "answer": "4",
         "analysis": "信号量初值等于资源数量，4台打印机 → S初值=4。"},
        {"num": "36", "type": "fill", "options": [],
         "stem": "某分页存储管理系统中，某作业一共有0、1、2三个页面，被分别装入了第5、2、3号物理块中，已知地址结构中用0-9位表示页内地址（位移量），则每页的大小为______字节，逻辑地址100转换成物理地址为______。",
         "answer": "1.1024 2.5220",
         "analysis": "页内地址占10位，每页=2^10=1024字节；逻辑地址100：页号=100/1024=0、页内偏移=100，页0在物理块5，物理地址=5×1024+100=5220。"},
        {"num": "37", "type": "fill", "options": [],
         "stem": "设某进程的访问页面的页面号序列为：1，3，1，2，4，3，5，2，1，2；则在分配给该程序的物理块数为4块，且采用OPT置换算法时的缺页次数是______次。",
         "answer": "5",
         "analysis": "OPT按「未来最久不再使用」原则淘汰：访问1、3、2、4依次缺页（4次），访问5缺页并淘汰未来不再出现的页（第5次），其后均命中，共5次。"},
        {"num": "38", "type": "fill", "options": [],
         "stem": "【含图片：前趋图】利用信号量来实现下图所示的前趋关系，补全①到④处空白。（注意英文用半角小写字母，括号用半角英文括号）\nP1(){S1; Signal(a); Signal(b);}\nP2(){ ① ; S2; Signal(c); Signal(d); }\nP3(){Wait(b); S3; ② ;}\nP4(){Wait(c); S4; Signal(f);}\nP5(){ ③ ; S5; Signal(g); }\nP6(){Wait(e); S6; Signal(h);}\nP7(){Wait(f); Wait(g); ④ ; S7; }\n（图片内容：前趋关系 P1→P2、P1→P3、P2→P4、P2→P5、P3→P6、P4→P7、P5→P7、P6→P7）",
         "answer": "① wait(a) ② signal(e) ③ wait(d) ④ wait(h)",
         "analysis": "前驱的Signal与后继的Wait配对：P1 Signal(a)→P2 ①wait(a)；P3的后继P6执行Wait(e)，故P3 ②signal(e)；P2 Signal(d)→P5 ③wait(d)；P6 Signal(h)→P7 ④wait(h)。"},
        {"num": "39", "type": "fill", "options": [],
         "stem": "根据文件的组织方式，可把有结构文件分为三类：顺序文件、索引文件、______。",
         "answer": "索引顺序文件",
         "analysis": "有结构文件（记录式文件）按组织方式分为顺序文件、索引文件、索引顺序文件。"},
        {"num": "40", "type": "fill", "options": [],
         "stem": "为了实现与设备的无关性，在应用程序中，应该使用______设备名请求使用某类设备。",
         "answer": "逻辑",
         "analysis": "设备无关性要求应用程序使用逻辑设备名，由系统映射到具体物理设备。"},
    ],
}

# ---------------- 21级 填空题（10 题） ----------------
FILL_21 = {
    "bank": "操作系统-21级试卷A·客观题",
    "questions": [
        {"num": "31", "type": "fill", "options": [],
         "stem": "由于资源等原因的限制，进程的执行通常都不可能“一气呵成”，而是以“停停走走”的方式运行，此即操作系统的（　）特性。",
         "answer": "异步性",
         "analysis": "进程以不可预知的速度“停停走走”地推进，这是操作系统的异步性特征。"},
        {"num": "32", "type": "fill", "options": [],
         "stem": "进程已获得的资源在未使用完之前，其他申请该资源的进程不能强行地从资源占有进程手中夺取资源，而只能由占有该资源的进程使用完自行释放。此指产生死锁的必要条件中的（　）条件。",
         "answer": "不可抢占",
         "analysis": "资源只能由占有者主动释放、不能被强行夺取，即不可抢占条件。"},
        {"num": "33", "type": "fill", "options": [],
         "stem": "在分页存储管理系统中，若逻辑地址中的页号超过页表寄存器中的页表长度，则会引起（　）中断。",
         "answer": "越界",
         "analysis": "页号≥页表长度时地址越界，引发越界中断。"},
        {"num": "34", "type": "fill", "options": [],
         "stem": "某种常用的I/O控制方式，该方式数据传输的基本单位必须是一个连续的数据块，可以由设备直接送入内存某一个区域，则该方式是（　）访问方式。",
         "answer": "直接存储器（DMA）",
         "analysis": "以连续数据块为单位、不经CPU直接在设备与内存之间传输，是DMA（直接存储器访问）方式。"},
        {"num": "35", "type": "fill", "options": [],
         "stem": "文件的逻辑结构从是否有结构来分可分为两种形式:一种是无结构的流式文件，一种是有结构的，又称为（　）文件。",
         "answer": "记录式",
         "analysis": "有结构文件由若干记录组成，又称记录式文件。"},
        {"num": "36", "type": "fill", "options": [],
         "stem": "通道是一种特殊的处理机，和CPU相比，它指令单一而且没有自己的（　），需要与CPU共用。",
         "answer": "内存",
         "analysis": "通道指令单一且没有自己的内存，需与CPU共用内存。"},
        {"num": "37", "type": "fill", "options": [],
         "stem": "现有n个进程都要访问一个临界资源，采用PV操作实现进程互斥时，则信号量Mutex可能出现的取值范围的最小值为（　）。",
         "answer": "1-n（或 -(n-1)）",
         "analysis": "互斥信号量初值1；最坏1个进程进入临界区、其余n-1个进程等待，最小值=1-n=-(n-1)。"},
        {"num": "38", "type": "fill", "options": [],
         "stem": "【含图片：资源分配图】某时刻系统中的资源和进程之间的资源分配图如右图所示，请判断该时刻（　）（有或没有）死锁发生。（图片内容：原题为资源分配图，文本版无法还原图中节点与箭头，需对照原卷）",
         "answer": "没有",
         "analysis": "该时刻资源分配图中无环路（或环路可化简），不发生死锁。"},
        {"num": "39", "type": "fill", "options": [],
         "stem": "在一请求分页系统中，假如一个作业的页面走向为：1、3、2、1、5、3、1、4、3、2，当分配给该作业的物理块数为4时（开始时已装入2，3页面），采用OPT页面淘汰算法将产生（　）次置换。",
         "answer": "1",
         "analysis": "初始已装2、3两页，还有2个空闲块；访问1、5直接装入（缺页但不置换）；访问4时4块已满，按OPT淘汰未来不再使用的页，仅置换1次。"},
        {"num": "40", "type": "fill", "options": [],
         "stem": "已知某分页系统，页面大小为1K，某作业有4个页面，页表如下：页号0→物理块2、页号1→物理块3、页号2→物理块1、页号3→物理块6。逻辑地址3082对应的物理地址为（　）（注3082为十进制）",
         "answer": "6154",
         "analysis": "页大小1K=1024：3082=3×1024+10，页号3、页内偏移10；页3在物理块6，物理地址=6×1024+10=6154。"},
    ],
}

# ---------------- 22级 填空题（10 题） ----------------
FILL_22 = {
    "bank": "操作系统-22级试卷A·客观题",
    "questions": [
        {"num": "31", "type": "fill", "options": [],
         "stem": "若信号量S的初值定义为8，则在S上调用了15次P操作和9次V操作后S的值应该为（　）。",
         "answer": "2",
         "analysis": "S=8-15+9=2。"},
        {"num": "32", "type": "fill", "options": [],
         "stem": "（　）目录指只有一个根目录，每个文件和每个目录都只能有一个父目录，把数据文件称为树叶，其它的目录均作为树的结点，或称为子目录，可以明显地提高对目录的检索速度和文件系统的性能。",
         "answer": "树形结构（树形）",
         "analysis": "目录整体呈树形结构：一个根目录，文件为树叶、目录为结点。"},
        {"num": "33", "type": "fill", "options": [],
         "stem": "当检测到系统中已发生死锁时，就采取相应措施，将进程从死锁状态中解脱出来。常用的方法是撤销一些进程，回收它们的资源，将它们分配给已处于阻塞状态的进程使其能运行，这种处理死锁的方法是（　）死锁。",
         "answer": "解除",
         "analysis": "死锁已发生后再撤销进程、回收资源使系统摆脱死锁，属死锁解除。"},
        {"num": "34", "type": "fill", "options": [],
         "stem": "某单道系统中4个作业的提交、运行时间如下：J1（4.0提交，运行0.5）、J2（4.3提交，运行1.0）、J3（4.5提交，运行1.5）。若从全部作业提交后开始采用高响应比优先调度算法，则各作业的执行顺序为（　）。（注：按执行先后次序写出作业名即可）",
         "answer": "J1，J2，J3",
         "analysis": "4.5时响应比：J1=(0.5+0.5)/0.5=2、J2=(0.2+1.0)/1.0=1.2、J3=1.5/1.5=1，J1最高先执行；J1完成后J2响应比1.7>J3的1.33，故顺序为J1、J2、J3。"},
        {"num": "35", "type": "fill", "options": [],
         "stem": "在一个分页存储管理系统中，页表内容如下：页号0→物理块1、页号1→物理块7、页号2→物理块5、页号3→物理块3。若页的大小为1K，则地址转换机构将逻辑地址2154转换成的物理地址为（　）。（注：2154为十进制）",
         "answer": "5226",
         "analysis": "页大小1K=1024：2154=2×1024+106，页号2、页内偏移106；页2在物理块5，物理地址=5×1024+106=5226。"},
        {"num": "36", "type": "fill", "options": [],
         "stem": "在一请求分页系统中，假如一个作业的页面走向为：4、3、2、5、1、3、1、4、3、2、1、5，当分配给该作业的物理块数为4时（开始时装入页面5），采用LRU页面淘汰算法将产生（　）次置换。",
         "answer": "4",
         "analysis": "初始已装5，访问4、3、2依次装入；访问1淘汰最久未用的4（第1次），访问4淘汰2（第2次），访问2淘汰5（第3次），访问5淘汰4（第4次），共4次置换。"},
        {"num": "37", "type": "fill", "options": [],
         "stem": "在操作系统中，把通过某种技术将一个物理实体变为若干个逻辑上的对应物的功能称为（　），这也是操作系统的四大基本特性之一。",
         "answer": "虚拟",
         "analysis": "把一个物理实体变为多个逻辑对应物，即操作系统的「虚拟」特性。"},
        {"num": "38", "type": "fill", "options": [],
         "stem": "设有4个进程共享同一程序段，每次最多允许两个进程进入该程序段，若用PV操作同步机制管理，则信号量S的取值最小值为（　）。",
         "answer": "-2",
         "analysis": "S初值=2（最多2个进入）；最坏2个进程进入、2个进程等待，最小值=2-4=-2。"},
        {"num": "39", "type": "fill", "options": [],
         "stem": "通道又称I/O处理机，它用于实现内存与（　）之间的信息传输。",
         "answer": "外部设备（外设/I/O设备）",
         "analysis": "通道用于实现内存与外部设备之间的信息传输。"},
        {"num": "40", "type": "fill", "options": [],
         "stem": "【含图片：资源分配图】某时刻系统中的资源和进程之间的资源分配图如图1所示，请判断该时刻（　）（有或没有）死锁发生。（图片内容：原题为图1资源分配图，文本版无法还原图中节点与箭头，需对照原卷）",
         "answer": "有",
         "analysis": "资源分配图中存在环路，环上进程互相等待资源，该时刻有死锁发生。"},
    ],
}


def validate(fills: list[dict]) -> list[str]:
    """返回校验错误列表（空 = 通过）。"""
    errors = []
    for f in fills:
        for i, q in enumerate(f["questions"], 1):
            tag = f"[{f['bank']} 第{i}题]"
            if q["type"] != "fill":
                errors.append(f"{tag} 非填空类型: {q['type']}")
            if not str(q.get("stem") or "").strip():
                errors.append(f"{tag} 题干为空")
            if not str(q.get("answer") or "").strip():
                errors.append(f"{tag} 答案为空")
            if q.get("options"):
                errors.append(f"{tag} 填空题不应有选项")
    return errors


def dry_run() -> None:
    fills = [FILL_20, FILL_21, FILL_22]
    errors = validate(fills)
    if errors:
        print("== 校验失败 ==")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("== 校验通过 ==")
    for f in fills:
        print(f"\n### {f['bank']}：追加填空 {len(f['questions'])} 题")
        for q in f["questions"]:
            print(f"  {q['num']}. {q['stem']}")
            print(f"     答案: {q['answer']}")


def install(user: str = "LiZF") -> None:
    from app import UserData  # noqa: E402
    from lykie.import_rules import attach_question_defaults  # noqa: E402

    fills = [FILL_20, FILL_21, FILL_22]
    errors = validate(fills)
    if errors:
        print("校验失败，中止安装：")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    store = UserData(user)
    changed = False
    for f in fills:
        bank = next((b for b in store.banks if b["name"] == f["bank"]), None)
        if not bank:
            print(f"跳过（题库不存在）: {f['bank']}")
            continue
        first_stem = f["questions"][0]["stem"]
        exists = any(q.get("stem") == first_stem for q in bank.get("questions") or [])
        if exists:
            print(f"跳过（已追加过）: {f['bank']}")
            continue
        base = len(bank.get("questions") or [])
        new_qs = [
            attach_question_defaults(q, base + i)
            for i, q in enumerate(f["questions"], 1)
        ]
        bank.setdefault("questions", []).extend(new_qs)
        print(f"{user} <- {f['bank']} 追加 {len(new_qs)} 题（现有 {base + len(new_qs)} 题）")
        changed = True
    if changed:
        store.save()
    print("完成。")


if __name__ == "__main__":
    if "--install" in sys.argv:
        install()
    else:
        dry_run()
