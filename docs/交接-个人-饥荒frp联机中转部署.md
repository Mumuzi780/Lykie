# 交接-个人-饥荒frp联机中转部署规格

> 性质：个人用途运维规格，与 Lykie 主仓代码无关，不涉及任何仓库代码/配置改动。
> 执行人：用户本人（服务器 SSH + 本机 Windows 操作），顾问只出规格不执行。
> 说明：文中 `<服务器IP>` 指 Lykie 站点所在腾讯云服务器（2核2G3M，Ubuntu 26.04），刻意不写明，避免 IP 进仓库。

## 0. 目标与架构

房主本机 Windows 跑 DST 专用服务器（存档在本地、电脑就是主机），云服务器只跑 frps 做 UDP 中转，朋友经「服务器IP:端口」直连。

```
朋友A/B/C ──UDP──> 云服务器 frps(UDP 11000/11001) ──TCP隧道(7000)──> 本机 frpc ──> 本机 DST 专用服务器
房主本机客户端 ──直连 127.0.0.1──> 本机 DST 专用服务器
```

要点：

- 服务器零游戏逻辑、零存档，只转发 UDP；frps 常驻内存约 20MB，CPU 忽略不计。
- 与服务器现有服务完全隔离：Nginx(80/TCP)、waitress(127.0.0.1:5000)、Docker NapCat/AstrBot(6099/6185 仅本机) 端口与协议零冲突，全程不碰这些服务。
- 所有游戏流量都过服务器（进、出各一次），3M 出带宽是硬上限，建议 ≤5 人。
- 电脑关机/断网 = 服下线；`pause_when_empty` 保证无人时世界冻结不推进，存档安全。

## 1. 端口与资源清单

| 端口 | 协议 | 方向 | 用途 | 谁放行 |
|---|---|---|---|---|
| 7000 | TCP | 公网入站 | frp 控制隧道（frpc↔frps） | 云防火墙 |
| 11000 | UDP | 公网入站 | DST 主世界 | 云防火墙 |
| 11001 | UDP | 公网入站 | DST 洞穴（可选） | 云防火墙 |
| 10888 | TCP | 仅本机 127.0.0.1 | DST 集群内部通信 | 无需对外 |

本机资源：DST 专用服务器单进程约 0.5~1GB 内存（开洞穴再加一份）；Steam 免费提供工具。

## 2. 阶段一：服务器侧 frps

2.1 下载 frp（GitHub fatedier/frp 最新 release，本机下载再上传，避开服务器直连 GitHub 慢的问题；国内下载可走 ghproxy 镜像前缀）
- 需要 windows_amd64（本机 frpc）+ linux_amd64（服务器 frps）两个包
- 认准 v0.52+ 新版：配置格式是 TOML（本规格按 TOML 写，旧 INI 已弃用）

2.2 上传部署
```
scp frp_*_linux_amd64.zip ubuntu@<服务器IP>:/tmp/
# SSH 上去后：
sudo mkdir -p /opt/frp
unzip /tmp/frp_*_linux_amd64.zip -d /tmp/frp-unzip
sudo cp /tmp/frp-unzip/frp_*/frps /opt/frp/
```

2.3 写 /opt/frp/frps.toml（token 用 `openssl rand -hex 32` 生成，记下来 frpc 要用同一个）
```toml
bindPort = 7000
auth.token = "<随机64位hex>"
```

2.4 systemd 常驻（沿用 Lykie 的 unit 风格）：/etc/systemd/system/frps.service
```ini
[Unit]
Description=frp server (DST relay)
After=network.target

[Service]
Type=simple
ExecStart=/opt/frp/frps -c /opt/frp/frps.toml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```
sudo systemctl daemon-reload
sudo systemctl enable --now frps
systemctl status frps      # 期望 active (running)
ss -tlnp | grep 7000       # 期望看到监听
```

2.5 腾讯云控制台防火墙（轻量服务器叫「防火墙」，CVM 叫「安全组」）入站放行：TCP 7000、UDP 11000（开洞穴再补 UDP 11001）

## 3. 阶段二：本机 DST 专用服务器

3.1 安装：Steam 库 → 「工具」→ 搜 "Don't Starve Together Dedicated Server" → 安装（免费）。不要点 Steam 的「开始」按钮，统一用 3.4 的 bat 启动。默认路径 `C:\Program Files (x86)\Steam\steamapps\common\Don't Starve Together Dedicated Server`。

3.2 Klei 服务器 Token：
1. 游戏客户端登录 Klei 账号
2. 浏览器打开 https://accounts.klei.com/account/profile/servers → 新游戏服务器 → 命名 → 复制 Token
3. Token 绑定 Klei 账号，勿外传

3.3 建集群目录 `Documents\Klei\DoNotStarveTogether\MyDedi\`，三个文件：

cluster_token.txt（Token 原样粘贴一行）

cluster.ini：
```ini
[GAMEPLAY]
game_mode = survival
max_players = 5
pvp = false
pause_when_empty = true

[CLUSTER]
cluster_name = <服务器名，朋友搜这个>
cluster_description = <随便写>
cluster_intention = cooperative

[MISC]
console_enabled = true
cluster_password = <朋友共知的密码，防列表陌生人>

[SHARD]
shard_enabled = true
bind_ip = 127.0.0.1
master_ip = 127.0.0.1
master_port = 10888
cluster_key = <随机串，开洞穴时主世界与洞穴互联用>
```

Master\server.ini：
```ini
[NETWORK]
port = 11000
tick_rate = 15

[SHARD]
is_master = true
name = Master
id = 1
```

> 模板字段与 Klei 官方 Quick Setup 指南对齐；动手前可到 support.klei.com 搜 "Dedicated Server Quick Setup" 交叉核对一遍字段名。

3.4 启动脚本 `D:\frp\start_dst.bat`（exe 实际在安装目录的 bin 或 bin64 下，以实际为准）：
```bat
@echo off
cd /d "C:\Program Files (x86)\Steam\steamapps\common\Don't Starve Together Dedicated Server\bin64"
dontstarve_dedicated_server_nullrenderer.exe -console -cluster MyDedi -shard Master
```

3.5 首次启动：控制台日志滚到 `Sim paused`（pause_when_empty 生效）即成功。Windows 防火墙若弹窗点允许（frpc 走 127.0.0.1 回环本不受限，弹窗来自对外监听）。

3.6 本机进服验证：开 DST 客户端 → `~` 呼出控制台 → `c_connect("127.0.0.1", 11000)` → 输密码进世界。存档自动落盘在集群目录下。

## 4. 阶段三：本机 frpc

4.1 解压 windows_amd64 包到 `D:\frp\`

4.2 写 D:\frp\frpc.toml：
```toml
serverAddr = "<服务器IP>"
serverPort = 7000
auth.token = "<与 frps 一致>"

[[proxies]]
name = "dst-master"
type = "udp"
localPort = 11000
remotePort = 11000

# 开洞穴时放开以下段：
# [[proxies]]
# name = "dst-caves"
# type = "udp"
# localPort = 11001
# remotePort = 11001
```

4.3 手动验证：命令行跑 `frpc.exe -c D:\frp\frpc.toml`，日志出现 login success + `start proxy success`。DST 开不开都行，隧道是 listener 型，先后顺序无关。

4.4 开机自启（二选一，够用选前者）：
- 任务计划程序 → 创建基本任务 → 触发器「登录时」→ 启动程序 `D:\frp\frpc.exe`，参数 `-c D:\frp\frpc.toml`
- NSSM 装成 Windows 服务（彻底后台无窗口）

## 5. 连接方式与验收标准

朋友连接（任选其一）：
- 控制台 `c_connect("<服务器IP>", 11000)`，输密码进
- 有 Token 时服务器会注册进 Klei 服务器列表，按 cluster_name 搜索加入（所以密码必设）

验收标准（全过才算完）：
1. 服务器 `systemctl status frps` = active；重启服务器后自动拉起
2. frpc 日志 login + proxy success；本机 DST 启动滚到 Sim paused
3. 本机客户端 127.0.0.1 直连进世界，跑图正常
4. ≥1 个异地朋友经 <服务器IP>:11000 进服游玩 ≥10 分钟，无掉线，延迟可接受（预期 50~120ms）
5. 现有服务无影响：`curl -s http://127.0.0.1:5000/` 探活正常，QQ 机器人在线
6. 游戏期间服务器带宽峰值 < 3Mbps（`iftop` 或控制台监控看一眼）

## 6. 可选：开洞穴

1. 建 `MyDedi\Caves\server.ini`：
```ini
[NETWORK]
port = 11001
tick_rate = 15

[SHARD]
is_master = false
name = Caves
id = 2
```
2. start_dst.bat 复制一行，`-shard Caves`（两个窗口分别跑地上/洞穴）
3. frpc.toml 放开 caves 代理段
4. 云防火墙补放行 UDP 11001
5. shard 互联走 cluster.ini 的 127.0.0.1:10888，无需对外开任何口

## 7. 回滚（零残留）

- 服务器：`sudo systemctl disable --now frps`，删 /opt/frp 与 unit 文件，撤防火墙 7000/11000/11001 规则。全程不碰 Nginx/Docker/waitress。
- 本机：关 bat、停 frpc 计划任务、删 D:\frp；集群目录想留存档就留着。

## 8. 风险与注意

1. 3M 出带宽是硬顶：>5 人或世界后期实体暴涨会全员卡顿，先 max_players=5 起步，卡了降人数。
2. 房主电脑关机 = 服下线（pause_when_empty 保证无人时世界不推进，无损耗）。
3. TCP 7000 对公网开，仅靠 token 保护；介意可把防火墙 7000 来源限到家宽 IP 段（家宽 IP 会漂移，懒得跟就靠长随机 token）。
4. Klei Token、frp token、cluster_key 均勿外传。
5. 本机 frpc 与 DST 依赖电脑常开；想要 7×24 再议别的方案，本规格不覆盖。
6. DST 专用服务器更新：Steam 库里工具右键更新即可，存档不受影响；存档备份 = 复制整个 MyDedi 集群目录。
