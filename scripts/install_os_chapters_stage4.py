# -*- coding: utf-8 -*-
"""《操作系统》章节习题·填空题追加脚本（阶段4，共71题）。

数据来源（doc 已提取为纯文本，答案内嵌在题干中）：
  C:\\Users\\27302\\AppData\\Local\\Temp\\os_docs_text\\第一章习题.doc.txt  填空15题
  C:\\Users\\27302\\AppData\\Local\\Temp\\os_docs_text\\第二章习题.doc.txt  填空20题
  C:\\Users\\27302\\AppData\\Local\\Temp\\os_docs_text\\第三章习题.doc.txt  填空14题
  C:\\Users\\27302\\AppData\\Local\\Temp\\os_docs_text\\第四章习题.doc.txt  填空13题
  C:\\Users\\27302\\AppData\\Local\\Temp\\os_docs_text\\第五章习题.doc.txt  填空9题

说明：
- 仅提取「填空」部分，选择/综合/实验均不纳入本阶段（综合题属阶段5）。
- 答案内嵌在题干文本中，题干中所有答案文字统一替换为 ______（多空用多个 ______）。
- 多空题答案按空序以「1.答案一 2.答案二」形式拼接（仿阶段2写法）。
- 含图题：第四章第13题（分页地址结构图）纯图无法还原，题干加【含图片】标记并注明需对照原书。
- 答案缺失/格式混乱的题：无（71题答案均来自内嵌答案，逐题核对）。

用法：
  python scripts/install_os_chapters_stage4.py            # 干跑：只校验并打印题目清单
  python scripts/install_os_chapters_stage4.py --install  # 追加到 LiZF 既有题库（幂等）
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# ---------------- 第一章 填空（15 题，num 34-48） ----------------
FILL_1 = {
    "bank": "操作系统-第一章习题·客观题",
    "questions": [
        {"num": "34", "type": "fill", "options": [],
         "stem": "计算机系统是由______系统和______系统两部分组成。",
         "answer": "1.硬件 2.软件",
         "analysis": "计算机系统由硬件系统和软件系统两部分组成。"},
        {"num": "35", "type": "fill", "options": [],
         "stem": "分时操作系统的主要特征有______。",
         "answer": "多路性、交互性、独立性、及时性",
         "analysis": "分时系统的四大特征：多路性、交互性、独立性、及时性。"},
        {"num": "36", "type": "fill", "options": [],
         "stem": "采用多道程序设计技术能充分发挥______与______的并行工作的能力。",
         "answer": "1.CPU 2.外设",
         "analysis": "多道程序设计使CPU与外部设备并行工作，提高资源利用率。"},
        {"num": "37", "type": "fill", "options": [],
         "stem": "在主机控制下进行的输入/输出操作称为______输入/输出操作。",
         "answer": "联机",
         "analysis": "在主机控制下进行的输入/输出为联机操作。"},
        {"num": "38", "type": "fill", "options": [],
         "stem": "按内存中同时运行程序的数目可以将批处理系统分为两类：______批处理系统和______批处理系统。",
         "answer": "1.单道 2.多道",
         "analysis": "批处理系统按内存中同时运行程序数目分为单道与多道批处理系统。"},
        {"num": "39", "type": "fill", "options": [],
         "stem": "操作系统的基本功能包括______管理、______管理、______管理、______管理。",
         "answer": "1.处理机 2.存储器 3.设备 4.文件",
         "analysis": "操作系统四大功能：处理机管理、存储器管理、设备管理、文件管理。"},
        {"num": "40", "type": "fill", "options": [],
         "stem": "______操作系统用户随时干预自己程序的运行。",
         "answer": "分时",
         "analysis": "分时系统允许用户通过终端随时干预程序运行。"},
        {"num": "41", "type": "fill", "options": [],
         "stem": "实时操作系统与分时操作系统的主要区别是______和______。",
         "answer": "1.及时性 2.高可靠性",
         "analysis": "实时系统强调及时性与高可靠性，这是与分时系统的主要区别。"},
        {"num": "42", "type": "fill", "options": [],
         "stem": "操作系统的最重要的特征是______。",
         "answer": "并发",
         "analysis": "并发是操作系统最重要的特征。"},
        {"num": "43", "type": "fill", "options": [],
         "stem": "操作系统的最基本的特征是______和______。",
         "answer": "1.并发 2.共享",
         "analysis": "操作系统的两个最基本特征：并发与共享。"},
        {"num": "44", "type": "fill", "options": [],
         "stem": "操作系统的基本特征有______、共享、虚拟、异步。",
         "answer": "并发",
         "analysis": "操作系统基本特征：并发、共享、虚拟、异步。"},
        {"num": "45", "type": "fill", "options": [],
         "stem": "______指计算机系统中的资源可被多个并发执行的用户程序和系统程序共同使用。",
         "answer": "共享",
         "analysis": "共享指资源可被多个并发执行的程序共同使用。"},
        {"num": "46", "type": "fill", "options": [],
         "stem": "______是指把一个物理上的实体，变为若干个逻辑上的对应物。",
         "answer": "虚拟",
         "analysis": "虚拟把一个物理实体变为多个逻辑对应物。"},
        {"num": "47", "type": "fill", "options": [],
         "stem": "每个程序在何时执行，多个程序间的执行顺序以及完成每道程序所需的时间都是不确定和不可预知的。进程是以人们不可预知的速度向前推进，此即进程的______。",
         "answer": "异步性",
         "analysis": "进程以不可预知的速度推进，即进程的异步性。"},
        {"num": "48", "type": "fill", "options": [],
         "stem": "在操作系统中引入进程的目的，就是为了使多个程序能______执行。",
         "answer": "并发",
         "analysis": "引入进程使多个程序能并发执行。"},
    ],
}

# ---------------- 第二章 填空（20 题，num 38-57） ----------------
FILL_2 = {
    "bank": "操作系统-第二章习题·客观题",
    "questions": [
        {"num": "38", "type": "fill", "options": [],
         "stem": "进程的基本特征有______、______、独立、异步四个特征。",
         "answer": "1.动态 2.并发",
         "analysis": "进程的四个基本特征：动态、并发、独立、异步。"},
        {"num": "39", "type": "fill", "options": [],
         "stem": "______是进程的最基本的特征。进程实体有一定的生命期，而程序则只是一组有序指令的集合，并存放于某种介质上，其本身并不具有活动的含义，因而是______的。",
         "answer": "1.动态性 2.静态",
         "analysis": "动态性是进程最基本特征；程序本身是静态的。"},
        {"num": "40", "type": "fill", "options": [],
         "stem": "______是指多个进程实体同存于内存中，且能在一段时间内同时运行。",
         "answer": "并发性",
         "analysis": "并发性指多个进程实体同存内存、在一段时间内同时运行。"},
        {"num": "41", "type": "fill", "options": [],
         "stem": "______是指进程实体是一个能独立运行、独立分配资源和独立接受调度的基本单位。",
         "answer": "独立性",
         "analysis": "独立性指进程能独立运行、分配资源、接受调度。"},
        {"num": "42", "type": "fill", "options": [],
         "stem": "______是指进程按各自独立的、______的速度向前推进，或说进程实体按异步方式运行。",
         "answer": "1.异步性 2.不可预知",
         "analysis": "异步性指进程按各自独立、不可预知的速度推进。"},
        {"num": "43", "type": "fill", "options": [],
         "stem": "进程可能具有______状态、______状态、______状态三个基本状态。",
         "answer": "1.就绪 2.执行 3.阻塞",
         "analysis": "进程三个基本状态：就绪、执行、阻塞。"},
        {"num": "44", "type": "fill", "options": [],
         "stem": "原语是由若干条指令组成的，用于完成一定功能的一个过程，与一般过程的区别在于：它们是“______”，它是一个不可分割的基本单位。",
         "answer": "原子操作",
         "analysis": "原语是不可分割的原子操作。"},
        {"num": "45", "type": "fill", "options": [],
         "stem": "信号量的物理意义是当信号量值大于0时表示______当信号量值小于0时，其绝对值为______。",
         "answer": "1.可用资源的数目 2.因请求该资源而被阻塞的进程的数目",
         "analysis": "信号量>0表示可用资源数目；<0时绝对值表示被阻塞进程数目。"},
        {"num": "46", "type": "fill", "options": [],
         "stem": "操作系统中，对信号量S的P原语操作定义中，使进程进入相应等待队列等待的条件是______。",
         "answer": "S<0",
         "analysis": "P操作中S减1后若S<0，进程进入等待队列。"},
        {"num": "47", "type": "fill", "options": [],
         "stem": "在一个单处理机系统中，若有5个用户进程，且假设当前时刻为用户态，则处于就绪状态的用户进程最多有______个，最少有______个。",
         "answer": "1.4 2.0",
         "analysis": "5个进程，当前时刻用户态下至多1个运行，就绪最多4个、最少0个。"},
        {"num": "48", "type": "fill", "options": [],
         "stem": "有M个进程共享同一个临界资源，若使用信号量机制实现对临界资源的互斥访问，则信号量值的变化范围是______至______。",
         "answer": "1.1 2.-(M-1)",
         "analysis": "互斥信号量初值1，最小值1-M=-(M-1)。"},
        {"num": "49", "type": "fill", "options": [],
         "stem": "用信号量S实现对系统中4台打印机的互斥使用，S的初值应设置为______；若S的当前值为-1，则表示等待队列有______个等待进程。",
         "answer": "1.4 2.1",
         "analysis": "S初值=资源数4；S=-1表示有1个进程在等待。"},
        {"num": "50", "type": "fill", "options": [],
         "stem": "从资源分配的角度看，P操作意味着向系统______一个资源，V操作意味着______一个资源。",
         "answer": "1.申请 2.释放",
         "analysis": "P操作申请资源，V操作释放资源。"},
        {"num": "51", "type": "fill", "options": [],
         "stem": "处于执行状态的进程，若其“时间片结束”，则该进程在三种基本状态中应从执行状态变为______状态。",
         "answer": "就绪",
         "analysis": "时间片用完，进程从执行态变为就绪态。"},
        {"num": "52", "type": "fill", "options": [],
         "stem": "在每个进程中访问临界资源的那段代码称为______。",
         "answer": "临界区",
         "analysis": "访问临界资源的代码段称为临界区。"},
        {"num": "53", "type": "fill", "options": [],
         "stem": "______是指每次仅允许一个进程访问的资源。",
         "answer": "临界资源",
         "analysis": "临界资源每次仅允许一个进程访问。"},
        {"num": "54", "type": "fill", "options": [],
         "stem": "进程同步机制应遵循的原则有______，______，______，______。",
         "answer": "1.空闲让进 2.忙则等待 3.有限等待 4.让权等待",
         "analysis": "同步机制四条规则：空闲让进、忙则等待、有限等待、让权等待。"},
        {"num": "55", "type": "fill", "options": [],
         "stem": "进程主要由______、______和______三部分内容组成，其中______是进程存在的惟一标识，而______部分也可以为其它进程共享。",
         "answer": "1.程序 2.数据 3.PCB 4.PCB 5.数据",
         "analysis": "进程由程序段、数据段、PCB组成；PCB是唯一标识，数据段可共享。"},
        {"num": "56", "type": "fill", "options": [],
         "stem": "当处理器空闲时，调度程序从______进程队列中选择一个进程给其分配CPU，处于______状态的进程是不会获得CPU的。",
         "answer": "1.就绪 2.阻塞",
         "analysis": "调度程序从就绪队列选进程；阻塞态进程不会获得CPU。"},
        {"num": "57", "type": "fill", "options": [],
         "stem": "信箱逻辑上分成______和______两部分。用信箱实现通信时，应有______和______两条基本原语。",
         "answer": "1.信箱头 2.信箱体 3.发送 4.接收",
         "analysis": "信箱分为信箱头和信箱体，通信用发送和接收两条原语。"},
    ],
}

# ---------------- 第三章 填空（14 题，num 45-58） ----------------
FILL_3 = {
    "bank": "操作系统-第三章习题·客观题",
    "questions": [
        {"num": "45", "type": "fill", "options": [],
         "stem": "处理机调度可分为三级，它们是高级调度、______和低级调度；在一般操作系统中，必须具备的调度是______。",
         "answer": "1.中级调度 2.进程调度",
         "analysis": "处理机三级调度：高级、中级、低级；一般系统必须具备进程调度。"},
        {"num": "46", "type": "fill", "options": [],
         "stem": "进程的调度方式有两种，一种是______，另一种是______。",
         "answer": "1.抢占方式 2.非抢占方式",
         "analysis": "进程调度方式分为抢占与非抢占两种。"},
        {"num": "47", "type": "fill", "options": [],
         "stem": "死锁是指在系统中的多个______无限期地等待永远不会发生的条件。",
         "answer": "进程",
         "analysis": "死锁是多个进程无限期等待永远不会发生的条件。"},
        {"num": "48", "type": "fill", "options": [],
         "stem": "进程调度负责______的分配工作。",
         "answer": "处理机",
         "analysis": "进程调度负责处理机的分配。"},
        {"num": "49", "type": "fill", "options": [],
         "stem": "在______调度算法中，按照进程进入就绪队列的先后次序来分配处理机。",
         "answer": "先来先服务",
         "analysis": "按进入就绪队列先后次序分配处理机的是先来先服务算法。"},
        {"num": "50", "type": "fill", "options": [],
         "stem": "在进程的轮转调度算法中，如果时间片为无穷大，则轮转调度就变为______调度。",
         "answer": "先来先服务",
         "analysis": "时间片无穷大时轮转退化为先来先服务。"},
        {"num": "51", "type": "fill", "options": [],
         "stem": "死锁避免是指______。",
         "answer": "检查资源的分配情况使系统始终不进入不安全状态",
         "analysis": "死锁避免通过检查资源分配使系统始终不进入不安全状态。"},
        {"num": "52", "type": "fill", "options": [],
         "stem": "死锁产生的必要条件有四个，即______、______、______、______。",
         "answer": "1.互斥条件 2.不可抢占条件 3.请求和保持条件 4.循环等待条件",
         "analysis": "死锁四必要条件：互斥、不可抢占、请求和保持、循环等待。"},
        {"num": "53", "type": "fill", "options": [],
         "stem": "解除死锁常用的方法有两种。______是从其他进程那里剥夺足够数量的资源给______进程，以解除死锁状态。",
         "answer": "1.资源剥夺 2.死锁",
         "analysis": "资源剥夺是从其他进程剥夺资源给死锁进程以解除死锁。"},
        {"num": "54", "type": "fill", "options": [],
         "stem": "银行家算法中，当一个进程提出的资源请求将导致系统从______进入______时，系统就拒绝它的资源请求。",
         "answer": "1.安全状态 2.不安全状态",
         "analysis": "银行家算法：请求使系统从安全态进入不安全态则拒绝。"},
        {"num": "55", "type": "fill", "options": [],
         "stem": "如果要求所有进程一次性申请它所需要的全部资源。若系统有足够的资源分配给进程，便一次把所有的资源分配给该进程。但在分配时只要有一种资源要求不能满足，则资源全不分配，进程等待。这种死锁预防方法破坏了死锁产生必要条件中的______条件。",
         "answer": "请求与保持",
         "analysis": "一次性申请全部资源破坏了请求和保持条件。"},
        {"num": "56", "type": "fill", "options": [],
         "stem": "对待死锁，一般应考虑死锁的预防、避免、检查和解除四个问题。典型的银行家算法是属于______，破坏环路等待条件是属于______，而剥夺资源是______的基本方法。",
         "answer": "1.死锁的避免 2.死锁的预防 3.死锁的解除",
         "analysis": "银行家算法属死锁避免；破坏环路等待属死锁预防；剥夺资源属死锁解除。"},
        {"num": "57", "type": "fill", "options": [],
         "stem": "死锁的必要条件之一是“______”，该条件是指对所分配的资源进行排它性的使用，即在一段时间内资源只有一个进程占用。",
         "answer": "互斥",
         "analysis": "互斥条件指资源在一段时间内只能被一个进程占用。"},
        {"num": "58", "type": "fill", "options": [],
         "stem": "______优先级是在创建进程时确定的，在进程的整个运行期间保持不变。______优先级是指在创建进程之初，先赋予其一个优先级，然后其值随进程的推进或等待时间的增加而改变，以便获得更好的调度性能。",
         "answer": "1.静态 2.动态",
         "analysis": "静态优先级创建时确定且不变；动态优先级随推进/等待时间改变。"},
    ],
}

# ---------------- 第四章 填空（13 题，num 29-41） ----------------
FILL_4 = {
    "bank": "操作系统-第四章习题·客观题",
    "questions": [
        {"num": "29", "type": "fill", "options": [],
         "stem": "在分页系统中，必须设置页表，其主要作用是实现______到______的映射。",
         "answer": "1.页号 2.块号",
         "analysis": "页表实现页号到物理块号的映射。"},
        {"num": "30", "type": "fill", "options": [],
         "stem": "在可变分区存储管理中采用______技术可集中分散的空闲区。",
         "answer": "紧凑",
         "analysis": "紧凑技术可集中分散的空闲区。"},
        {"num": "31", "type": "fill", "options": [],
         "stem": "在分区分配算法中，首次适应法倾向于优先利用内存中______部分的空闲分区，从而保留了______部分的大空闲区。",
         "answer": "1.低地址 2.高地址",
         "analysis": "首次适应优先用低地址空闲区，保留高地址大空闲区。"},
        {"num": "32", "type": "fill", "options": [],
         "stem": "内存中很多容量太小、无法被利用的空闲块被称为______。",
         "answer": "碎片",
         "analysis": "容量太小无法利用的空闲块称为碎片。"},
        {"num": "33", "type": "fill", "options": [],
         "stem": "将作业地址空间中的逻辑地址转换为主存中的物理地址的过程称为______。",
         "answer": "地址变换/地址映射",
         "analysis": "逻辑地址到物理地址的转换称为地址变换/地址映射。"},
        {"num": "34", "type": "fill", "options": [],
         "stem": "在页式和段式管理中，指令的地址部分结构形式分别为______和______。",
         "answer": "1.页号及页内位移 2.段号及段内位移",
         "analysis": "页式地址=页号+页内位移；段式地址=段号+段内位移。"},
        {"num": "35", "type": "fill", "options": [],
         "stem": "重定位的方式有______和______两种。",
         "answer": "1.静态重定位 2.动态重定位",
         "analysis": "重定位分静态重定位与动态重定位。"},
        {"num": "36", "type": "fill", "options": [],
         "stem": "分区管理中采用“首次适应”分配算法时，应将空闲区按______次序登记在空闲区表中。",
         "answer": "地址递增",
         "analysis": "首次适应算法将空闲区按地址递增次序登记。"},
        {"num": "37", "type": "fill", "options": [],
         "stem": "页表表目的主要内容包括______。",
         "answer": "页号和块号",
         "analysis": "页表表目主要内容是页号和块号。"},
        {"num": "38", "type": "fill", "options": [],
         "stem": "静态重定位在______时进行；而动态重定位在______时进行。",
         "answer": "1.程序装入内存 2.程序执行",
         "analysis": "静态重定位在装入内存时进行，动态重定位在程序执行时进行。"},
        {"num": "39", "type": "fill", "options": [],
         "stem": "在段页式存储管理系统中，每道程序都有一个______表和一组______表。",
         "answer": "1.段 2.页",
         "analysis": "段页式管理中每道程序一个段表、一组页表。"},
        {"num": "40", "type": "fill", "options": [],
         "stem": "系统为每个进程建立一张页面映像表，简称页表。页表的作用是实现从______到______的地址映射。",
         "answer": "1.页号 2.物理块号",
         "analysis": "页表实现从页号到物理块号的地址映射。"},
        {"num": "41", "type": "fill", "options": [],
         "stem": "【含图片：分页地址结构图】分页地址中的地址结构如上图：它包含两部分内容：前一部分为页号P，后一部分为位移量W，即页内地址，图中的地址长度为32位，其中0-11位为页内地址，即每页的大小为______；12-31位为页号，地址空间最多允许有______页。（图片内容：原题为分页地址结构图，文本版无法还原，需对照原书）",
         "answer": "1.4KB 2.1M",
         "analysis": "0-11位页内地址共12位，每页=2^12=4KB；12-31位页号共20位，最多2^20=1M页。"},
    ],
}

# ---------------- 第五章 填空（9 题，num 17-25） ----------------
FILL_5 = {
    "bank": "操作系统-第五章习题·客观题",
    "questions": [
        {"num": "17", "type": "fill", "options": [],
         "stem": "假设某程序的页面访问序列为1、2、3、4、5、2、3、4、5、1、2、3、4、5且开始执行时主存中没有页面，则在分配给该程序的物理块数是3且采用FIFO方式时缺页次数是______；在分配给程序的物理块数是4且采用FIFO方式时，缺页次数是______；在分配给该程序的物理块数是3且采用LRU方式时，缺页次数是______；在分配给该程序的物理块数为4且采用LRU方式时，缺页次数是______。",
         "answer": "1.14 2.10 3.14 4.10",
         "analysis": "按FIFO/LRU逐次模拟：3块FIFO=14、4块FIFO=10、3块LRU=14、4块LRU=10。"},
        {"num": "18", "type": "fill", "options": [],
         "stem": "若选用的______算法不合适，可能会出现抖动现象。",
         "answer": "页面置换",
         "analysis": "页面置换算法选择不当会引起抖动。"},
        {"num": "19", "type": "fill", "options": [],
         "stem": "在页式存储管理系统中，常用的页面淘汰算法有：______，选择淘汰不再使用或最远的将来才使用的页；______，选择淘汰在主存驻留时间最长的页；______，选择淘汰离当前时刻最近的一段时间内使用得少的页。",
         "answer": "1.最佳算法 2.先进先出法 3.最近最少使用",
         "analysis": "三种淘汰算法：最佳算法、先进先出法、最近最少使用(LRU)。"},
        {"num": "20", "type": "fill", "options": [],
         "stem": "在请求页式存储管理中，若采用FIFO页面淘汰算法，则当分配的页面数增加时，______的次数可能增加也可能减少。",
         "answer": "缺页中断",
         "analysis": "FIFO存在Belady现象，页面数增加时缺页次数可能增加也可能减少。"},
        {"num": "21", "type": "fill", "options": [],
         "stem": "虚拟存储器最基本的特征包括______，______，______。",
         "answer": "1.多次性 2.对换性 3.虚拟性",
         "analysis": "虚拟存储器三大特征：多次性、对换性、虚拟性。"},
        {"num": "22", "type": "fill", "options": [],
         "stem": "LRU置换算法是将驻留集中的______页面换出内存。",
         "answer": "最近最久使用的页面",
         "analysis": "LRU换出最近最久未使用的页面（原文作“最近最久使用的页面”）。"},
        {"num": "23", "type": "fill", "options": [],
         "stem": "刚被调出的页面又立即要用而装入，而装入后不久又被调出，如此反复，使调度非常频繁，这种现象称为______。",
         "answer": "抖动",
         "analysis": "页面频繁调入调出的现象称为抖动。"},
        {"num": "24", "type": "fill", "options": [],
         "stem": "设某进程的访问串为：1，3，1，2，4，分配给它的页框数为3，按FIFO页面置换算法，当访问4号页面时，应淘汰______。",
         "answer": "1号页面",
         "analysis": "FIFO下访问串1、3、1、2装入后，访问4时淘汰最先进入的1号页面。"},
        {"num": "25", "type": "fill", "options": [],
         "stem": "______是利用操作系统产生的一个假想的特大存储器，是逻辑上扩充了内存容量，而物理内存的容量并未增加。",
         "answer": "虚拟存储器",
         "analysis": "虚拟存储器逻辑上扩充内存容量，物理内存容量并未增加。"},
    ],
}


def validate(fills: list[dict]) -> list[str]:
    """返回校验错误列表（空 = 通过）。"""
    errors = []
    for f in fills:
        nums = []
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
            num = q.get("num")
            if not str(num or "").strip():
                errors.append(f"{tag} 题号为空")
            else:
                nums.append(str(num))
        # 题号库内唯一（允许跳号，不要求连续）
        if len(nums) != len(set(nums)):
            from collections import Counter
            dup = [n for n, c in Counter(nums).items() if c > 1]
            errors.append(f"[{f['bank']}] 题号重复: {dup}")
    return errors


def dry_run() -> None:
    fills = [FILL_1, FILL_2, FILL_3, FILL_4, FILL_5]
    errors = validate(fills)
    if errors:
        print("== 校验失败 ==")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("== 校验通过 ==")
    total = 0
    for f in fills:
        total += len(f["questions"])
        print(f"\n### {f['bank']}：追加填空 {len(f['questions'])} 题")
        for q in f["questions"]:
            print(f"  {q['num']}. {q['stem']}")
            print(f"     答案: {q['answer']}")
    print(f"\n合计：{total} 题")


def install(user: str = "LiZF") -> None:
    from app import UserData  # noqa: E402
    from lykie.import_rules import attach_question_defaults  # noqa: E402

    fills = [FILL_1, FILL_2, FILL_3, FILL_4, FILL_5]
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
