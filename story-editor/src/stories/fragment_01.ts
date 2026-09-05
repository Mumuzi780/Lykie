import type { StoryGraph } from '../types'

/** 片段 01；Lykie=400ms/字（纯符号0.5s）；系统默认0.5s。 */
export const fragment01Graph: StoryGraph = {
  "id": "fragment_01  ",
  "title": "期末错接",
  "startNodeId": "a_q",
  "nodes": [
    {
      "id": "a_q",
      "type": "lykie",
      "position": {
        "x": 231.879996224041,
        "y": -340.3374489292265
      },
      "data": {
        "text": "冯·诺依曼结构的核心思想是（ ）。",
        "delayMs": 4800
      }
    },
    {
      "id": "a_choice1",
      "type": "choice",
      "position": {
        "x": 247.70777845539124,
        "y": -205.12120351648042
      },
      "data": {
        "timeoutMs": 0,
        "options": [
          {
            "id": "opt_qmark",
            "label": "？"
          },
          {
            "id": "opt_who",
            "label": "你是谁？"
          },
          {
            "id": "opt_silent",
            "label": "不回复"
          }
        ],
        "handleLayout": {
          "opt_qmark": {
            "side": "bottom",
            "t": 0.06074657217065657
          },
          "opt_who": {
            "side": "bottom",
            "t": 0.48298910745565465
          },
          "opt_silent": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "a_dot",
      "type": "lykie",
      "position": {
        "x": 45.33982024050755,
        "y": 91.00397322949455
      },
      "data": {
        "text": "？",
        "delayMs": 500
      }
    },
    {
      "id": "a_what",
      "type": "lykie",
      "position": {
        "x": 42.62386832859761,
        "y": 205.2304212034141
      },
      "data": {
        "text": "什么意思？",
        "delayMs": 1600
      }
    },
    {
      "id": "a_possess",
      "type": "lykie",
      "position": {
        "x": 49.44459287789431,
        "y": 325.2304212034141
      },
      "data": {
        "text": "Ai被夺舍了？",
        "delayMs": 2400
      }
    },
    {
      "id": "a_hurry",
      "type": "lykie",
      "position": {
        "x": -99.24473971199663,
        "y": 494.6603020346629
      },
      "data": {
        "text": "快快，没时间了！我不管你是谁，赶紧告诉我答案！",
        "delayMs": 7600
      }
    },
    {
      "id": "a_sys",
      "type": "system",
      "position": {
        "x": 106.49208401123826,
        "y": 664.3787730161662
      },
      "data": {
        "text": "提示：可靠自己的脑子、上网搜索、查书本，或问 AI，把答案交给她。（参考答案：存储程序控制）",
        "delayMs": 500
      }
    },
    {
      "id": "a_deliver",
      "type": "choice",
      "position": {
        "x": 121.95175497545966,
        "y": 854.524193765169
      },
      "data": {
        "timeoutMs": 0,
        "options": [
          {
            "id": "opt_ans",
            "label": "交付：存储程序控制"
          }
        ],
        "handleLayout": {
          "opt_ans": {
            "side": "bottom",
            "t": 0.49865814208984377
          }
        }
      }
    },
    {
      "id": "a_wait",
      "type": "wait",
      "position": {
        "x": 133.58743688042708,
        "y": 1031.187747705086
      },
      "data": {
        "delayMs": 12000,
        "note": "她去交卷、出教室"
      }
    },
    {
      "id": "b_who",
      "type": "lykie",
      "position": {
        "x": 139,
        "y": 1166.5
      },
      "data": {
        "text": "所以，你到底是谁？",
        "delayMs": 2800
      }
    },
    {
      "id": "b_ai",
      "type": "lykie",
      "position": {
        "x": 146.22120839760527,
        "y": 1292.8160018175934
      },
      "data": {
        "text": "你把我的Ai夺舍了？",
        "delayMs": 3600
      }
    },
    {
      "id": "b_choice1",
      "type": "choice",
      "position": {
        "x": 144.45359411034997,
        "y": 1437.600382077558
      },
      "data": {
        "timeoutMs": 1000,
        "options": [
          {
            "id": "opt_b1a",
            "label": "没有，我是....."
          },
          {
            "id": "opt_b1b",
            "label": "我还想问你是谁呢？！"
          },
          {
            "id": "opt_b1c",
            "label": "......"
          }
        ],
        "handleLayout": {
          "opt_b1a": {
            "side": "bottom",
            "t": 0.05
          },
          "opt_b1b": {
            "side": "bottom",
            "t": 0.3302520751953125
          },
          "opt_b1c": {
            "side": "bottom",
            "t": 0.6977520751953125
          },
          "timeout": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "b_hacker",
      "type": "lykie",
      "position": {
        "x": 153.11175276158127,
        "y": 1738.22740824781
      },
      "data": {
        "text": "你是黑客？来骗我的钱？",
        "delayMs": 3600
      }
    },
    {
      "id": "b_choice2",
      "type": "choice",
      "position": {
        "x": 144.55407588104345,
        "y": 1870.735748497656
      },
      "data": {
        "timeoutMs": 1000,
        "options": [
          {
            "id": "opt_b2a",
            "label": "这都什么跟什么？"
          },
          {
            "id": "opt_b2b",
            "label": "你等会....."
          },
          {
            "id": "opt_b2c",
            "label": "........"
          }
        ],
        "handleLayout": {
          "opt_b2a": {
            "side": "bottom",
            "t": 0.05
          },
          "opt_b2b": {
            "side": "bottom",
            "t": 0.2983145300253397
          },
          "opt_b2c": {
            "side": "bottom",
            "t": 0.6771813846251192
          },
          "timeout": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "b_money",
      "type": "lykie",
      "position": {
        "x": 112.92052867763562,
        "y": 2172.521116693637
      },
      "data": {
        "text": "我可没什么钱可骗，你还是趁早死了这条心吧！",
        "delayMs": 7600
      }
    },
    {
      "id": "b_choice3",
      "type": "choice",
      "position": {
        "x": 142.71342619543412,
        "y": 2367.6208947027226
      },
      "data": {
        "timeoutMs": 10000,
        "options": [
          {
            "id": "opt_stop1",
            "label": "停停停！！！"
          },
          {
            "id": "opt_stop2",
            "label": "别发了！！！"
          },
          {
            "id": "opt_stop3",
            "label": "你先打住..."
          }
        ],
        "handleLayout": {
          "opt_stop1": {
            "side": "bottom",
            "t": 0.1847728044361348
          },
          "opt_stop2": {
            "side": "bottom",
            "t": 0.39697310028947
          },
          "opt_stop3": {
            "side": "bottom",
            "t": 0.6205412691349481
          },
          "timeout": {
            "side": "bottom",
            "t": 0.8441094379804264
          }
        }
      }
    },
    {
      "id": "c_hit",
      "type": "lykie",
      "position": {
        "x": 363.1002167548784,
        "y": 2743.201229360675
      },
      "data": {
        "text": "果然被我说中了",
        "delayMs": 2800
      }
    },
    {
      "id": "c_broken",
      "type": "lykie",
      "position": {
        "x": 365.7392325764242,
        "y": 2875.736554513018
      },
      "data": {
        "text": "完了，这ai没法用了",
        "delayMs": 3600
      }
    },
    {
      "id": "c_end",
      "type": "end",
      "position": {
        "x": 357.369812494807,
        "y": 3020.147450862317
      },
      "data": {
        "label": "Lykie 已下线"
      }
    },
    {
      "id": "d_choice",
      "type": "choice",
      "position": {
        "x": 34.560789545933176,
        "y": 2701.761810838893
      },
      "data": {
        "timeoutMs": 0,
        "options": [
          {
            "id": "opt_d_ask",
            "label": "你先说你是谁"
          },
          {
            "id": "opt_d_name",
            "label": "我是（输入姓名）"
          }
        ],
        "handleLayout": {
          "opt_d_ask": {
            "side": "bottom",
            "t": 0.0845831065731559
          },
          "opt_d_name": {
            "side": "bottom",
            "t": 0.4507464814169405
          },
          "timeout": {
            "side": "bottom",
            "t": 0.7938184722615675
          }
        }
      }
    },
    {
      "id": "n_8inldrr",
      "type": "lykie",
      "position": {
        "x": 268.03344075629764,
        "y": 83.80416404534635
      },
      "data": {
        "text": "？？？",
        "delayMs": 500
      }
    },
    {
      "id": "n_u5az0o9",
      "type": "lykie",
      "position": {
        "x": 262.7284327735112,
        "y": 208.85078078245402
      },
      "data": {
        "text": "什么情况？",
        "delayMs": 1600
      }
    },
    {
      "id": "n_v74kh63",
      "type": "lykie",
      "position": {
        "x": 261.2127162070008,
        "y": 334.6552558028169
      },
      "data": {
        "text": "Ai你失忆了？",
        "delayMs": 2400
      }
    },
    {
      "id": "n_zgdspnn",
      "type": "lykie",
      "position": {
        "x": 502.969508565409,
        "y": 92.1406051611535
      },
      "data": {
        "text": " ？",
        "delayMs": 500
      }
    },
    {
      "id": "n_eqdx9vi",
      "type": "lykie",
      "position": {
        "x": 500.6959337156435,
        "y": 215.67150533175078
      },
      "data": {
        "text": "卡了这是？？",
        "delayMs": 1600
      }
    },
    {
      "id": "n_ctvtj4f",
      "type": "lykie",
      "position": {
        "x": 494.63306744960187,
        "y": 333.89739751956165
      },
      "data": {
        "text": "别搞啊！！",
        "delayMs": 1200
      }
    },
    {
      "id": "n_s1l4ecs",
      "type": "lykie",
      "position": {
        "x": 208.43766301213822,
        "y": 496.3489726870223
      },
      "data": {
        "text": "我是Lykie啊，快告诉我答案，来等不及了！！！",
        "delayMs": 7600
      }
    },
    {
      "id": "n_di1if04",
      "type": "lykie",
      "position": {
        "x": -56.09226156668927,
        "y": 2946.1495498780823
      },
      "data": {
        "text": "看在你帮了我的份上，我就让你一步（傲娇表情）",
        "delayMs": 7600
      }
    },
    {
      "id": "n_dcqe5e4",
      "type": "lykie",
      "position": {
        "x": -14.03925848578794,
        "y": 3083.9120379040905
      },
      "data": {
        "text": "我叫Lykie",
        "delayMs": 2800
      }
    },
    {
      "id": "n_7ge2ij1",
      "type": "lykie",
      "position": {
        "x": -15.938509218827761,
        "y": 3208.3229602065167
      },
      "data": {
        "text": "你呢？",
        "delayMs": 800
      }
    },
    {
      "id": "n_oo2lypx",
      "type": "choice",
      "position": {
        "x": -30.616491940132335,
        "y": 3351.3542384341886
      },
      "data": {
        "options": [
          {
            "id": "opt_u23mukd",
            "label": "(玩家输入名字)"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_u23mukd": {
            "side": "bottom",
            "t": 0.5049759519319083
          },
          "opt_8adb4zu": {
            "side": "bottom",
            "t": 0.5012625122070312
          },
          "timeout": {
            "side": "bottom",
            "t": 0.8362625122070313
          }
        }
      }
    },
    {
      "id": "n_9sm11bh",
      "type": "lykie",
      "position": {
        "x": -20.559853352169057,
        "y": 3535.2396809030224
      },
      "data": {
        "text": "（玩家名字），很好听的名字",
        "delayMs": 4000
      }
    },
    {
      "id": "n_jkz5vut",
      "type": "lykie",
      "position": {
        "x": -52.81511931411228,
        "y": 3674.949451530782
      },
      "data": {
        "text": "话说回来，我在用Ai查答案呢，怎么就接到了你这里呢",
        "delayMs": 9200
      }
    },
    {
      "id": "n_ad41qo3",
      "type": "choice",
      "position": {
        "x": -33.77773667281298,
        "y": 3829.0545749225084
      },
      "data": {
        "options": [
          {
            "id": "opt_osyklqh",
            "label": "可能我有大智慧？"
          },
          {
            "id": "opt_54dm6d4",
            "label": "谁知道呢？"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_osyklqh": {
            "side": "bottom",
            "t": 0.0875
          },
          "opt_54dm6d4": {
            "side": "bottom",
            "t": 0.485
          },
          "timeout": {
            "side": "bottom",
            "t": 0.895
          }
        }
      }
    },
    {
      "id": "n_922r2ql",
      "type": "lykie",
      "position": {
        "x": -258.58169075433597,
        "y": 4029.433660255787
      },
      "data": {
        "text": "什么呀，你还不是在网上查的答案",
        "delayMs": 5600
      }
    },
    {
      "id": "n_kcof0ic",
      "type": "lykie",
      "position": {
        "x": 99.48396320936668,
        "y": 4052.033652052177
      },
      "data": {
        "text": "算了算了，想那么多也没用",
        "delayMs": 4400
      }
    },
    {
      "id": "n_bjj39pz",
      "type": "lykie",
      "position": {
        "x": -248.95154213517242,
        "y": 4154.708940855088
      },
      "data": {
        "text": "不过，还是谢谢你",
        "delayMs": 2800
      }
    },
    {
      "id": "n_j0f1411",
      "type": "lykie",
      "position": {
        "x": 98.31751874163675,
        "y": 4181.332822400063
      },
      "data": {
        "text": "还是想想之后该怎么办吧 ",
        "delayMs": 4400
      }
    },
    {
      "id": "n_d4ekm9k",
      "type": "lykie",
      "position": {
        "x": 116.03421427476303,
        "y": 4314.6699053652965
      },
      "data": {
        "text": "（伤心表情）",
        "delayMs": 1600
      }
    },
    {
      "id": "n_gazs20c",
      "type": "choice",
      "position": {
        "x": -244.5776989149362,
        "y": 4447.9026717273955
      },
      "data": {
        "options": [
          {
            "id": "opt_xnqhz4g",
            "label": "不用客气，举手之劳"
          },
          {
            "id": "opt_c2pf1t0",
            "label": "这一道题这么重要吗"
          }
        ],
        "timeoutMs": 60000,
        "handleLayout": {
          "opt_xnqhz4g": {
            "side": "bottom",
            "t": 0.05
          },
          "opt_c2pf1t0": {
            "side": "bottom",
            "t": 0.476373291015625
          },
          "timeout": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "n_sh5zvbv",
      "type": "lykie",
      "position": {
        "x": -243.81293799443426,
        "y": 4288.048997117663
      },
      "data": {
        "text": "没有你帮助这次就真的完了 ",
        "delayMs": 4800
      }
    },
    {
      "id": "n_5um00uz",
      "type": "lykie",
      "position": {
        "x": -424.60625913659544,
        "y": 4657.846340414553
      },
      "data": {
        "text": "不过这一道题就能帮到你这么多吗",
        "delayMs": 6000
      }
    },
    {
      "id": "n_fur0onc",
      "type": "lykie",
      "position": {
        "x": -269.8412329723153,
        "y": 4833.8435122445735
      },
      "data": {
        "text": "也不是了，就是",
        "delayMs": 2400
      }
    },
    {
      "id": "n_p8gldxg",
      "type": "lykie",
      "position": {
        "x": 124.20843382099056,
        "y": 175.12936990175564
      },
      "data": {
        "text": "……",
        "delayMs": 500
      }
    },
    {
      "id": "n_y7vkqdx",
      "type": "lykie",
      "position": {
        "x": -268.70399862513773,
        "y": 4964.818303106045
      },
      "data": {
        "text": "在你之前我查了几道题",
        "delayMs": 4000
      }
    },
    {
      "id": "n_2fezm75",
      "type": "lykie",
      "position": {
        "x": -274.03456762182395,
        "y": 5081.3323426906245
      },
      "data": {
        "text": "唯独这道题是老师重点讲的",
        "delayMs": 4800
      }
    },
    {
      "id": "n_cl8rg4w",
      "type": "lykie",
      "position": {
        "x": -296.66888226752314,
        "y": 5194.50391591912
      },
      "data": {
        "text": "说亲自阅卷，神错了绝对饶不了他",
        "delayMs": 5600
      }
    },
    {
      "id": "n_jb06900",
      "type": "lykie",
      "position": {
        "x": -274.90511818512005,
        "y": 5311.157691400801
      },
      "data": {
        "text": "谁",
        "delayMs": 400
      }
    },
    {
      "id": "n_dn82x65",
      "type": "choice",
      "position": {
        "x": -288.0408623295609,
        "y": 5446.516450006312
      },
      "data": {
        "options": [
          {
            "id": "opt_e6oy70c",
            "label": "明白了"
          },
          {
            "id": "opt_k7r6lui",
            "label": "原来是这样啊"
          },
          {
            "id": "opt_2h71shu",
            "label": "神也会犯错吗            "
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_e6oy70c": {
            "side": "bottom",
            "t": 0.05
          },
          "opt_k7r6lui": {
            "side": "bottom",
            "t": 0.48821803446593626
          },
          "opt_2h71shu": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "n_tyucryw",
      "type": "lykie",
      "position": {
        "x": -449.6548083305541,
        "y": 5714.683257264337
      },
      "data": {
        "text": "嗯呢 ",
        "delayMs": 800
      }
    },
    {
      "id": "n_nvkf77i",
      "type": "lykie",
      "position": {
        "x": -169.78373432105087,
        "y": 5719.920112407524
      },
      "data": {
        "text": "什么呀，别逗我笑了（大笑表情）",
        "delayMs": 4800
      }
    },
    {
      "id": "n_nteo4vw",
      "type": "lykie",
      "position": {
        "x": -148.19626718862662,
        "y": 5850.931400950072
      },
      "data": {
        "text": "我得回去了，下次再说吧",
        "delayMs": 4000
      }
    },
    {
      "id": "n_6jqt934",
      "type": "lykie",
      "position": {
        "x": -150.17552905478595,
        "y": 5978.923668295041
      },
      "data": {
        "text": "白白啦",
        "delayMs": 1200
      }
    },
    {
      "id": "n_8md9vmz",
      "type": "choice",
      "position": {
        "x": -460.0688595262278,
        "y": 5832.915171530503
      },
      "data": {
        "options": [
          {
            "id": "opt_vbygfhq",
            "label": "你们的老师还真严苛呢"
          },
          {
            "id": "opt_ng8xfjv",
            "label": "我们从来都没有这样的情况"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_vbygfhq": {
            "side": "bottom",
            "t": 0.05
          },
          "opt_ng8xfjv": {
            "side": "bottom",
            "t": 0.4711041120653209
          },
          "timeout": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "n_tg2fczg",
      "type": "lykie",
      "position": {
        "x": -774.3336637390653,
        "y": 6039.737545571491
      },
      "data": {
        "text": "是呀，我不和你说了，我得回去了",
        "delayMs": 5200
      }
    },
    {
      "id": "n_m6a254a",
      "type": "lykie",
      "position": {
        "x": -585.626951208521,
        "y": 6186.7620525229995
      },
      "data": {
        "text": "白白",
        "delayMs": 800
      }
    },
    {
      "id": "n_qyoey4y",
      "type": "lykie",
      "position": {
        "x": -498.47324863417333,
        "y": 6045.800411837532
      },
      "data": {
        "text": "羡慕，我要回去了",
        "delayMs": 2800
      }
    },
    {
      "id": "n_pcmoobc",
      "type": "end",
      "position": {
        "x": -325.89951359453505,
        "y": 6348.975088335871
      },
      "data": {
        "label": "结束"
      }
    },
    {
      "id": "n_uqx0zo5",
      "type": "choice",
      "position": {
        "x": 120.29194938246522,
        "y": 4456.906983279072
      },
      "data": {
        "options": [
          {
            "id": "opt_k74yydo",
            "label": "这个Ai不能用了还可以用其他的啊"
          },
          {
            "id": "opt_ken56va",
            "label": "我还会上线的，你可以接着问我"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_k74yydo": {
            "side": "bottom",
            "t": 0.05
          },
          "opt_ken56va": {
            "side": "bottom",
            "t": 0.886905040470683
          }
        }
      }
    },
    {
      "id": "n_byjtdkb",
      "type": "lykie",
      "position": {
        "x": -45.413843892239754,
        "y": 4705.820941302584
      },
      "data": {
        "text": "嗯，我会尝试尝试其他的",
        "delayMs": 4000
      }
    },
    {
      "id": "n_ll3j7kb",
      "type": "lykie",
      "position": {
        "x": -41.71787824740437,
        "y": 4833.4488353481165
      },
      "data": {
        "text": "这次要谢谢你的帮助",
        "delayMs": 3600
      }
    },
    {
      "id": "n_jg4w9aw",
      "type": "lykie",
      "position": {
        "x": -69.19727361547464,
        "y": 4961.910636043337
      },
      "data": {
        "text": "别的题还好，这道题错了老师要骂死我",
        "delayMs": 6400
      }
    },
    {
      "id": "n_f70l9mg",
      "type": "choice",
      "position": {
        "x": 71.26926561399948,
        "y": 5099.785577831843
      },
      "data": {
        "options": [
          {
            "id": "opt_w870wzt",
            "label": "为什么"
          },
          {
            "id": "opt_v3z80tr",
            "label": "老师专门强调了这道题吧"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_w870wzt": {
            "side": "bottom",
            "t": 0.11486983895506588
          },
          "opt_v3z80tr": {
            "side": "bottom",
            "t": 0.5858361786708359
          }
        }
      }
    },
    {
      "id": "n_0fn1dul",
      "type": "lykie",
      "position": {
        "x": -71.12190129053421,
        "y": 5309.0907190448115
      },
      "data": {
        "text": "因为老师考前刚强调的这道题啊",
        "delayMs": 5600
      }
    },
    {
      "id": "n_80gj7wj",
      "type": "lykie",
      "position": {
        "x": 147.50490975883037,
        "y": 176.51903135309396
      },
      "data": {
        "text": "……",
        "delayMs": 500
      }
    },
    {
      "id": "n_66rt8gd",
      "type": "lykie",
      "position": {
        "x": -64.21165756645536,
        "y": 5428.909296105179
      },
      "data": {
        "text": "他亲自判卷，说谁错了绕不了谁",
        "delayMs": 5200
      }
    },
    {
      "id": "n_ags76c8",
      "type": "lykie",
      "position": {
        "x": 167.79196790200592,
        "y": 5313.728150495011
      },
      "data": {
        "text": "嗯呢，要是错了，他得骂死我",
        "delayMs": 4400
      }
    },
    {
      "id": "n_3prinrq",
      "type": "choice",
      "position": {
        "x": 373.32732291603475,
        "y": 5561.644767118529
      },
      "data": {
        "options": [
          {
            "id": "opt_sndwghn",
            "label": "这次多亏了我吧"
          },
          {
            "id": "opt_d5f5s2n",
            "label": "你真惨"
          },
          {
            "id": "opt_k7i72o1",
            "label": "我们没有这样的老师"
          },
          {
            "id": "opt_vzkyb3q",
            "label": "我们老师也这样"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_sndwghn": {
            "side": "bottom",
            "t": 0.069274165945195
          },
          "opt_d5f5s2n": {
            "side": "bottom",
            "t": 0.3694622183743733
          },
          "opt_k7i72o1": {
            "side": "bottom",
            "t": 0.6729490406104657
          },
          "opt_vzkyb3q": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "n_mgc6s67",
      "type": "lykie",
      "position": {
        "x": 62.20132467953121,
        "y": 5858.172673185854
      },
      "data": {
        "text": "这次确实要谢谢你",
        "delayMs": 3200
      }
    },
    {
      "id": "n_ofs6kj1",
      "type": "lykie",
      "position": {
        "x": 61.62697550203268,
        "y": 5977.637302105547
      },
      "data": {
        "text": "不过你别得意",
        "delayMs": 2400
      }
    },
    {
      "id": "n_v7yqsog",
      "type": "lykie",
      "position": {
        "x": 47.26824606456975,
        "y": 6100.548026090229
      },
      "data": {
        "text": "算我欠你一个人情",
        "delayMs": 3200
      }
    },
    {
      "id": "n_hndvm1y",
      "type": "lykie",
      "position": {
        "x": 36.92996086959644,
        "y": 6221.233147012106
      },
      "data": {
        "text": "会还你的",
        "delayMs": 1600
      }
    },
    {
      "id": "n_gglmxan",
      "type": "lykie",
      "position": {
        "x": 266.6569034682598,
        "y": 5830.405455657162
      },
      "data": {
        "text": "（无奈表情）",
        "delayMs": 1600
      }
    },
    {
      "id": "n_6ffvy96",
      "type": "lykie",
      "position": {
        "x": 268.51489961075623,
        "y": 5966.715535657221
      },
      "data": {
        "text": " 这样的生活早日结束吧",
        "delayMs": 4000
      }
    },
    {
      "id": "n_6tng1nd",
      "type": "lykie",
      "position": {
        "x": 484.1022438365303,
        "y": 5841.950200294017
      },
      "data": {
        "text": " 你真幸运",
        "delayMs": 1600
      }
    },
    {
      "id": "n_0p398ps",
      "type": "lykie",
      "position": {
        "x": 481.3139193815048,
        "y": 5966.379649884414
      },
      "data": {
        "text": "什么时候我也能过上那样的日子",
        "delayMs": 5600
      }
    },
    {
      "id": "n_vqb19my",
      "type": "lykie",
      "position": {
        "x": 712.7766379134073,
        "y": 5841.7458783672355
      },
      "data": {
        "text": "哈哈，果然天底下的老师都一个样",
        "delayMs": 5600
      }
    },
    {
      "id": "n_52hj9s7",
      "type": "lykie",
      "position": {
        "x": 729.6400950268495,
        "y": 5971.317639655686
      },
      "data": {
        "text": "我们学生苦命相连啊",
        "delayMs": 3600
      }
    },
    {
      "id": "n_je75t8f",
      "type": "lykie",
      "position": {
        "x": 464.3990923386891,
        "y": 6164.803870937045
      },
      "data": {
        "text": "我得回去了，下次再聊",
        "delayMs": 3600
      }
    },
    {
      "id": "n_b8cek8h",
      "type": "lykie",
      "position": {
        "x": 458.3362260726473,
        "y": 6289.092629390898
      },
      "data": {
        "text": "白白",
        "delayMs": 800
      }
    },
    {
      "id": "n_1qwspia",
      "type": "end",
      "position": {
        "x": 459.5469248192955,
        "y": 6443.536385036754
      },
      "data": {
        "label": "结束"
      }
    },
    {
      "id": "n_pi4pcp0",
      "type": "choice",
      "position": {
        "x": 21.656485868654784,
        "y": 6363.471888304797
      },
      "data": {
        "options": [
          {
            "id": "opt_ban1goo",
            "label": "举手之劳，何足挂齿"
          },
          {
            "id": "opt_2umh8xq",
            "label": "那我可记住了 "
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_ban1goo": {
            "side": "bottom",
            "t": 0.2656366073633991
          },
          "opt_2umh8xq": {
            "side": "bottom",
            "t": 0.7392979820360224
          }
        }
      }
    },
    {
      "id": "n_bkq68e7",
      "type": "lykie",
      "position": {
        "x": -91.18717994214072,
        "y": 6570.09380749951
      },
      "data": {
        "text": "没想到你还挺谦虚",
        "delayMs": 3200
      }
    },
    {
      "id": "n_68whxzr",
      "type": "lykie",
      "position": {
        "x": 124.04457250233551,
        "y": 6573.883098915785
      },
      "data": {
        "text": "嗯呢，我能帮的一定帮",
        "delayMs": 3600
      }
    },
    {
      "id": "n_7u46sk8",
      "type": "lykie",
      "position": {
        "x": 5.060822031269396,
        "y": 6720.149747584039
      },
      "data": {
        "text": "好了，我得回去了",
        "delayMs": 2800
      }
    },
    {
      "id": "n_pmkb45f",
      "type": "lykie",
      "position": {
        "x": 4.302963748014221,
        "y": 6839.89135633836
      },
      "data": {
        "text": "下次再聊吧，白白",
        "delayMs": 2800
      }
    },
    {
      "id": "n_n07fxrs",
      "type": "end",
      "position": {
        "x": 3.5451054647590183,
        "y": 6968.727264491744
      },
      "data": {
        "label": "结束"
      }
    },
    {
      "id": "n_ot59418",
      "type": "lykie",
      "position": {
        "x": 400.6385447099195,
        "y": 4678.131837946051
      },
      "data": {
        "text": "那多不好意思",
        "delayMs": 2400
      }
    },
    {
      "id": "n_qtql04x",
      "type": "lykie",
      "position": {
        "x": 409.1823167917118,
        "y": 4797.412957759985
      },
      "data": {
        "text": "这次是没办法了",
        "delayMs": 2800
      }
    },
    {
      "id": "n_7ld1dpp",
      "type": "lykie",
      "position": {
        "x": 410.3213248386227,
        "y": 4925.428424537541
      },
      "data": {
        "text": "我总不能一直找你问问题啊",
        "delayMs": 4800
      }
    },
    {
      "id": "n_di49brq",
      "type": "choice",
      "position": {
        "x": 668.2416263989173,
        "y": 5074.927365257512
      },
      "data": {
        "options": [
          {
            "id": "opt_q461n19",
            "label": "没关系，我每天都会上线"
          },
          {
            "id": "opt_42qcdpq",
            "label": "举手之劳啊，我每天都会上线学习"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_q461n19": {
            "side": "bottom",
            "t": 0.13492893522001198
          },
          "opt_42qcdpq": {
            "side": "bottom",
            "t": 0.7599291259549334
          }
        }
      }
    },
    {
      "id": "n_2kslxe2",
      "type": "lykie",
      "position": {
        "x": 667.7624167218875,
        "y": 5285.710713428257
      },
      "data": {
        "text": "什么意思，在你那边是什么学习网站吗",
        "delayMs": 6400
      }
    },
    {
      "id": "n_fce40eu",
      "type": "lykie",
      "position": {
        "x": 123.1404153806448,
        "y": 154.83096586248757
      },
      "data": {
        "text": "……",
        "delayMs": 500
      }
    },
    {
      "id": "n_vtza3im",
      "type": "choice",
      "position": {
        "x": 709.9697581229792,
        "y": 5415.421685296743
      },
      "data": {
        "options": [
          {
            "id": "opt_kbp4y2n",
            "label": "是的，我正在刷题，突然收到了你的信息"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_kbp4y2n": {
            "side": "right",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "n_xcquoeg",
      "type": "lykie",
      "position": {
        "x": 950.0341388009815,
        "y": 5601.686505952759
      },
      "data": {
        "text": "还能这样的",
        "delayMs": 2000,
        "handleLayout": {
          "out": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "n_vguzb37",
      "type": "lykie",
      "position": {
        "x": 1075.9549800598948,
        "y": 5774.409815907256
      },
      "data": {
        "text": "怪不得Ai也有学习能力",
        "delayMs": 4400
      }
    },
    {
      "id": "n_deibjl2",
      "type": "lykie",
      "position": {
        "x": 1072.6756380165025,
        "y": 5909.21462883534
      },
      "data": {
        "text": "原来背后真的有人在操作",
        "delayMs": 4400
      }
    },
    {
      "id": "n_xklwi90",
      "type": "lykie",
      "position": {
        "x": 1069.8038921290101,
        "y": 6037.294495417508
      },
      "data": {
        "text": "你是被困在Ai里的人吗",
        "delayMs": 4400
      }
    },
    {
      "id": "n_6vt6d6v",
      "type": "lykie",
      "position": {
        "x": 1068.7635153385932,
        "y": 6154.631553854327
      },
      "data": {
        "text": "还是说是你自愿的？",
        "delayMs": 3200
      }
    },
    {
      "id": "n_xbzlp3o",
      "type": "choice",
      "position": {
        "x": 125.1256915048252,
        "y": 116.62442549959397
      },
      "data": {
        "options": [
          {
            "id": "opt_uokhjke",
            "label": "选项 A"
          },
          {
            "id": "opt_03aeo30",
            "label": "选项 B"
          }
        ],
        "timeoutMs": 0
      }
    },
    {
      "id": "n_c6m85pv",
      "type": "choice",
      "position": {
        "x": 1057.7614746948395,
        "y": 6294.91500010228
      },
      "data": {
        "options": [
          {
            "id": "opt_4z9hksg",
            "label": "？？？"
          },
          {
            "id": "opt_rpf5j6t",
            "label": "你都把我说晕了"
          },
          {
            "id": "opt_ej8muot",
            "label": "你这脑回路，我还真没想过"
          }
        ],
        "timeoutMs": 0,
        "handleLayout": {
          "opt_4z9hksg": {
            "side": "bottom",
            "t": 0.07390838623046875
          },
          "opt_rpf5j6t": {
            "side": "bottom",
            "t": 0.5539083862304688
          },
          "opt_ej8muot": {
            "side": "bottom",
            "t": 0.95
          }
        }
      }
    },
    {
      "id": "n_wqzi3wr",
      "type": "lykie",
      "position": {
        "x": 850.8468791388666,
        "y": 6518.02504280521
      },
      "data": {
        "text": "哈哈！我开玩笑的",
        "delayMs": 2800
      }
    },
    {
      "id": "n_m501swt",
      "type": "lykie",
      "position": {
        "x": 838.67030874892,
        "y": 6635.099391982709
      },
      "data": {
        "text": "因为这件事很难解释啊",
        "delayMs": 4000
      }
    },
    {
      "id": "n_4i9akym",
      "type": "lykie",
      "position": {
        "x": 1061.3468791388666,
        "y": 6525.02504280521
      },
      "data": {
        "text": "哈昂昂哈",
        "delayMs": 1600
      }
    },
    {
      "id": "n_o6xsf4a",
      "type": "lykie",
      "position": {
        "x": 1280.1182429488015,
        "y": 6522.6663133677475
      },
      "data": {
        "text": "哈哈哈哈哈哈",
        "delayMs": 2400
      }
    },
    {
      "id": "n_bp3hbfd",
      "type": "lykie",
      "position": {
        "x": 1050.3283368037405,
        "y": 6841.289798875654
      },
      "data": {
        "text": "好了，我该回去了",
        "delayMs": 2800
      }
    },
    {
      "id": "n_o7y9158",
      "type": "lykie",
      "position": {
        "x": 1054.8962716651267,
        "y": 6980.340820417463
      },
      "data": {
        "text": "下次再聊吧，白白",
        "delayMs": 2800
      }
    },
    {
      "id": "n_nhkhjxw",
      "type": "lykie",
      "position": {
        "x": 1061.2141126176105,
        "y": 6667.320518680769
      },
      "data": {
        "text": "那就好好想想这个问题嘿",
        "delayMs": 4400
      }
    },
    {
      "id": "n_kgfqhdq",
      "type": "lykie",
      "position": {
        "x": 1282.9128951320379,
        "y": 6671.340962923258
      },
      "data": {
        "text": "也许这是真的呢",
        "delayMs": 2800
      }
    },
    {
      "id": "n_yvqs3qu",
      "type": "end",
      "position": {
        "x": 1058.2393404173242,
        "y": 7110.528323301504
      },
      "data": {
        "label": "结束"
      }
    },
    {
      "id": "n_0r0953k",
      "type": "lykie",
      "position": {
        "x": 516.4859615370957,
        "y": 506.3442916108273
      },
      "data": {
        "text": "？？？？？",
        "delayMs": 500
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "a_q",
      "target": "a_choice1",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e2a",
      "source": "a_choice1",
      "target": "a_dot",
      "sourceHandle": "opt_qmark",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e3",
      "source": "a_dot",
      "target": "a_what",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e4",
      "source": "a_what",
      "target": "a_possess",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e5",
      "source": "a_possess",
      "target": "a_hurry",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e6",
      "source": "a_hurry",
      "target": "a_sys",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e7",
      "source": "a_sys",
      "target": "a_deliver",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e8",
      "source": "a_deliver",
      "target": "a_wait",
      "sourceHandle": "opt_ans",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e9",
      "source": "a_wait",
      "target": "b_who",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e10",
      "source": "b_who",
      "target": "b_ai",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e11",
      "source": "b_ai",
      "target": "b_choice1",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e12a",
      "source": "b_choice1",
      "target": "b_hacker",
      "sourceHandle": "opt_b1a",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e12b",
      "source": "b_choice1",
      "target": "b_hacker",
      "sourceHandle": "opt_b1b",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e12c",
      "source": "b_choice1",
      "target": "b_hacker",
      "sourceHandle": "opt_b1c",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e12t",
      "source": "b_choice1",
      "target": "b_hacker",
      "sourceHandle": "timeout",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e13",
      "source": "b_hacker",
      "target": "b_choice2",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e14a",
      "source": "b_choice2",
      "target": "b_money",
      "sourceHandle": "opt_b2a",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e14b",
      "source": "b_choice2",
      "target": "b_money",
      "sourceHandle": "opt_b2b",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e14c",
      "source": "b_choice2",
      "target": "b_money",
      "sourceHandle": "opt_b2c",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e14t",
      "source": "b_choice2",
      "target": "b_money",
      "sourceHandle": "timeout",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e15",
      "source": "b_money",
      "target": "b_choice3",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e16a",
      "source": "b_choice3",
      "target": "d_choice",
      "sourceHandle": "opt_stop1",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e16b",
      "source": "b_choice3",
      "target": "d_choice",
      "sourceHandle": "opt_stop2",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e16c",
      "source": "b_choice3",
      "target": "d_choice",
      "sourceHandle": "opt_stop3",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e16t",
      "source": "b_choice3",
      "target": "c_hit",
      "sourceHandle": "timeout",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e17",
      "source": "c_hit",
      "target": "c_broken",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e18",
      "source": "c_broken",
      "target": "c_end",
      "sourceHandle": "out",
      "targetHandle": null,
      "data": {}
    },
    {
      "id": "e_9xuabq5",
      "source": "a_choice1",
      "target": "n_8inldrr",
      "sourceHandle": "opt_who",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_8z7o3al",
      "source": "n_8inldrr",
      "target": "n_u5az0o9",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_taz3cug",
      "source": "n_u5az0o9",
      "target": "n_v74kh63",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_0id7hw2",
      "source": "a_choice1",
      "target": "n_zgdspnn",
      "sourceHandle": "opt_silent",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_z4g8kmo",
      "source": "n_zgdspnn",
      "target": "n_eqdx9vi",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_dgjaf74",
      "source": "n_eqdx9vi",
      "target": "n_ctvtj4f",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_xmawi4x",
      "source": "n_v74kh63",
      "target": "n_s1l4ecs",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_ed563ls",
      "source": "n_s1l4ecs",
      "target": "a_sys",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_wrdl5uz",
      "source": "d_choice",
      "target": "n_di1if04",
      "sourceHandle": "opt_d_ask",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_c9quj6e",
      "source": "n_di1if04",
      "target": "n_dcqe5e4",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_vpz31z3",
      "source": "n_dcqe5e4",
      "target": "n_7ge2ij1",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_k5kkt3z",
      "source": "n_7ge2ij1",
      "target": "n_oo2lypx",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_912l8rb",
      "source": "n_oo2lypx",
      "target": "n_9sm11bh",
      "sourceHandle": "opt_u23mukd",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_rop5xif",
      "source": "n_9sm11bh",
      "target": "n_jkz5vut",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_c8uotlm",
      "source": "n_jkz5vut",
      "target": "n_ad41qo3",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_6j28wid",
      "source": "n_ad41qo3",
      "target": "n_922r2ql",
      "sourceHandle": "opt_osyklqh",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_ows5q6b",
      "source": "n_922r2ql",
      "target": "n_bjj39pz",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_5nsid77",
      "source": "n_ad41qo3",
      "target": "n_kcof0ic",
      "sourceHandle": "opt_54dm6d4",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_6mk0t6r",
      "source": "n_kcof0ic",
      "target": "n_j0f1411",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_19c1ij8",
      "source": "n_j0f1411",
      "target": "n_d4ekm9k",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_pexyihm",
      "source": "n_bjj39pz",
      "target": "n_sh5zvbv",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_jfkev1g",
      "source": "n_sh5zvbv",
      "target": "n_gazs20c",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_colerm4",
      "source": "n_gazs20c",
      "target": "n_5um00uz",
      "sourceHandle": "opt_xnqhz4g",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_v7hpz4f",
      "source": "n_5um00uz",
      "target": "n_fur0onc",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_3t6qpv8",
      "source": "n_gazs20c",
      "target": "n_fur0onc",
      "sourceHandle": "opt_c2pf1t0",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_n9z27f4",
      "source": "n_fur0onc",
      "target": "n_y7vkqdx",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_hmhfitl",
      "source": "n_y7vkqdx",
      "target": "n_2fezm75",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_k7nb4nf",
      "source": "n_2fezm75",
      "target": "n_cl8rg4w",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_ed52gxz",
      "source": "n_cl8rg4w",
      "target": "n_jb06900",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_pl646g2",
      "source": "n_jb06900",
      "target": "n_dn82x65",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_ssv89eb",
      "source": "n_dn82x65",
      "target": "n_tyucryw",
      "sourceHandle": "opt_e6oy70c",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_eq09vam",
      "source": "n_dn82x65",
      "target": "n_nvkf77i",
      "sourceHandle": "opt_2h71shu",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_2fi5zy0",
      "source": "n_dn82x65",
      "target": "n_tyucryw",
      "sourceHandle": "opt_k7r6lui",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_cg0litb",
      "source": "n_nvkf77i",
      "target": "n_nteo4vw",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_xovov5m",
      "source": "n_nteo4vw",
      "target": "n_6jqt934",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_vreitaw",
      "source": "n_tyucryw",
      "target": "n_8md9vmz",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_32pjhrg",
      "source": "n_8md9vmz",
      "target": "n_tg2fczg",
      "sourceHandle": "opt_vbygfhq",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_i73a0di",
      "source": "n_tg2fczg",
      "target": "n_m6a254a",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_j8ylsvx",
      "source": "n_8md9vmz",
      "target": "n_qyoey4y",
      "sourceHandle": "opt_ng8xfjv",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_qy337xy",
      "source": "n_qyoey4y",
      "target": "n_m6a254a",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_vg9wqnt",
      "source": "n_m6a254a",
      "target": "n_pcmoobc",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_gmgfs94",
      "source": "n_6jqt934",
      "target": "n_pcmoobc",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_6b2b7no",
      "source": "n_d4ekm9k",
      "target": "n_uqx0zo5",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_4wsjzil",
      "source": "n_uqx0zo5",
      "target": "n_byjtdkb",
      "sourceHandle": "opt_k74yydo",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_7wcmfsp",
      "source": "n_byjtdkb",
      "target": "n_ll3j7kb",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_2ucwo2r",
      "source": "n_ll3j7kb",
      "target": "n_jg4w9aw",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_qckcbvt",
      "source": "n_jg4w9aw",
      "target": "n_f70l9mg",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_xpgjiyj",
      "source": "n_f70l9mg",
      "target": "n_0fn1dul",
      "sourceHandle": "opt_w870wzt",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_7w4xmeq",
      "source": "n_0fn1dul",
      "target": "n_66rt8gd",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_bs4m8p8",
      "source": "n_f70l9mg",
      "target": "n_ags76c8",
      "sourceHandle": "opt_v3z80tr",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_cppr617",
      "source": "n_66rt8gd",
      "target": "n_3prinrq",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_g37cp4e",
      "source": "n_ags76c8",
      "target": "n_3prinrq",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_ong322w",
      "source": "n_3prinrq",
      "target": "n_mgc6s67",
      "sourceHandle": "opt_sndwghn",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_akv0x4z",
      "source": "n_mgc6s67",
      "target": "n_ofs6kj1",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_o8mtqrl",
      "source": "n_ofs6kj1",
      "target": "n_v7yqsog",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_wf9ucue",
      "source": "n_v7yqsog",
      "target": "n_hndvm1y",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_kxi1t3w",
      "source": "n_3prinrq",
      "target": "n_gglmxan",
      "sourceHandle": "opt_d5f5s2n",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_xrau5mp",
      "source": "n_gglmxan",
      "target": "n_6ffvy96",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_02gyss9",
      "source": "n_3prinrq",
      "target": "n_6tng1nd",
      "sourceHandle": "opt_k7i72o1",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_vloegvd",
      "source": "n_6tng1nd",
      "target": "n_0p398ps",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_aao9zuq",
      "source": "n_3prinrq",
      "target": "n_vqb19my",
      "sourceHandle": "opt_vzkyb3q",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_jzl5zaf",
      "source": "n_vqb19my",
      "target": "n_52hj9s7",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_z3jlivp",
      "source": "n_6ffvy96",
      "target": "n_je75t8f",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_xd2zroc",
      "source": "n_0p398ps",
      "target": "n_je75t8f",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_eomgl3h",
      "source": "n_52hj9s7",
      "target": "n_je75t8f",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_sr0e4vv",
      "source": "n_je75t8f",
      "target": "n_b8cek8h",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_7o9pbtm",
      "source": "n_b8cek8h",
      "target": "n_1qwspia",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_deaodrr",
      "source": "n_hndvm1y",
      "target": "n_pi4pcp0",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_63mk9k3",
      "source": "n_pi4pcp0",
      "target": "n_bkq68e7",
      "sourceHandle": "opt_ban1goo",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_143gmc1",
      "source": "n_bkq68e7",
      "target": "n_7u46sk8",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_b7etvrr",
      "source": "n_7u46sk8",
      "target": "n_pmkb45f",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_e0gz4hy",
      "source": "n_pi4pcp0",
      "target": "n_68whxzr",
      "sourceHandle": "opt_2umh8xq",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_tf7ow7g",
      "source": "n_68whxzr",
      "target": "n_7u46sk8",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_kcj9phm",
      "source": "n_pmkb45f",
      "target": "n_n07fxrs",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_mjvo7ms",
      "source": "n_uqx0zo5",
      "target": "n_ot59418",
      "sourceHandle": "opt_ken56va",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_rzje6rf",
      "source": "n_ot59418",
      "target": "n_qtql04x",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_7kc761o",
      "source": "n_qtql04x",
      "target": "n_7ld1dpp",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_knm4baj",
      "source": "n_7ld1dpp",
      "target": "n_di49brq",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_3i0iuzu",
      "source": "n_di49brq",
      "target": "n_2kslxe2",
      "sourceHandle": "opt_q461n19",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_n2aj2m4",
      "source": "n_di49brq",
      "target": "n_2kslxe2",
      "sourceHandle": "opt_42qcdpq",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_hsczlqi",
      "source": "n_2kslxe2",
      "target": "n_vtza3im",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_uviqhwq",
      "source": "n_vtza3im",
      "target": "n_xcquoeg",
      "sourceHandle": "opt_kbp4y2n",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_36oo80v",
      "source": "n_vguzb37",
      "target": "n_deibjl2",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_g1agjtt",
      "source": "n_xcquoeg",
      "target": "n_vguzb37",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_cjq9fk2",
      "source": "n_deibjl2",
      "target": "n_xklwi90",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_ufeev33",
      "source": "n_xklwi90",
      "target": "n_6vt6d6v",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_r577k74",
      "source": "n_6vt6d6v",
      "target": "n_c6m85pv",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_7z5f6m2",
      "source": "n_c6m85pv",
      "target": "n_wqzi3wr",
      "sourceHandle": "opt_4z9hksg",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_l09sb20",
      "source": "n_wqzi3wr",
      "target": "n_m501swt",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_4mfuidz",
      "source": "n_c6m85pv",
      "target": "n_4i9akym",
      "sourceHandle": "opt_rpf5j6t",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_2ch74ft",
      "source": "n_c6m85pv",
      "target": "n_o6xsf4a",
      "sourceHandle": "opt_ej8muot",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_t1363dq",
      "source": "n_m501swt",
      "target": "n_bp3hbfd",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_xs4xhe8",
      "source": "n_bp3hbfd",
      "target": "n_o7y9158",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_qyw6n9k",
      "source": "n_4i9akym",
      "target": "n_nhkhjxw",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_8gztukd",
      "source": "n_nhkhjxw",
      "target": "n_bp3hbfd",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_f2y4kmi",
      "source": "n_o6xsf4a",
      "target": "n_kgfqhdq",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_a9fhfsp",
      "source": "n_kgfqhdq",
      "target": "n_bp3hbfd",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_91j2giy",
      "source": "n_o7y9158",
      "target": "n_yvqs3qu",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_fy91wvh",
      "source": "n_ctvtj4f",
      "target": "n_0r0953k",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    },
    {
      "id": "e_8e2ajaq",
      "source": "n_0r0953k",
      "target": "a_sys",
      "sourceHandle": "out",
      "targetHandle": "in",
      "data": {}
    }
  ]
}
