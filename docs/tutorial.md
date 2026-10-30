# 教程：从裸 Termux 到能解码图片

面向的读者：能在 Termux 里装包、跑命令，没做过 Node 原生模块适配。按顺序走完即可；每一步都给了验证判据，判据不过就停下，别往下走。

补丁为什么这样写、代价是什么，见 [参考](reference.md)。本文只讲操作顺序。

## 前提

- 一台无 root、aarch64 的 Android 设备，Termux 已装好
- 能访问 npm 与 GitHub（速度慢的话先做下一节的换源）
- 磁盘至少留 5 GB

先确认环境：

```bash
uname -m && node -v && vips --version
```

`uname -m` 应为 `aarch64`。`node -v` 应为 v24 或更高。`vips --version` 应为 `8.18.x`——版本低于 8.18 时后文的图片后端不可用。

## 换源（Termux 包源 + npm 源）

手机上直连官方源普遍很慢。**两处要换，作用不同，都要做**：

| 换哪 | 影响什么 | 什么时候用到 |
|---|---|---|
| Termux 包源 | `pkg install` | 步骤 1 装 node / clang / libvips |
| npm 源 | `npm i -g` | 步骤 2 装 dsh |

### Termux 包源

官方给了交互式工具：

```bash
termux-change-repo          # TUI，方向键选镜像站
```

TUI 不适合脚本和 agent。直接改文件更可控：

```bash
# 先备份
cp $PREFIX/etc/apt/sources.list $PREFIX/etc/apt/sources.list.bak

# 换成清华源（一行）
cat > $PREFIX/etc/apt/sources.list <<'EOF'
deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main
EOF

pkg update
```

验证：

```bash
grep -v '^#' $PREFIX/etc/apt/sources.list
```

应只剩 `deb ...` 那一行。

**三个容易写错的地方**：

- **路径必须含 `/termux/apt/termux-main`**。少写一段（比如只写到 `/termux/`）会让 `pkg update` 报 404，而后面的 `pkg install` 全部失败。
- **想换回官方源**，写 `deb https://packages-cf.termux.dev/apt/termux-main stable main`。
- `pkg update` 报 `Release file ... is not valid yet` 通常不是源坏了，是**手机时间不对**——先校准时间。

### npm 源

```bash
npm config set registry https://registry.npmmirror.com
npm config get registry          # 应回显镜像地址
```

或者写进 `~/.npmrc`，一行就够（仓库里的 `examples/.npmrc` 就是这个内容）：

```
registry=https://registry.npmmirror.com
```

**留意镜像同步延迟。** dsh 发版很密（几天一个 alpha），而镜像同步到新版本需要时间。如果装刚发布的版本报 `No matching version`，不是版本号写错，是镜像还没跟上——临时用官方源装：

```bash
npm i -g @deepseek-ai/dsh@0.2.2-alpha.2 --registry=https://registry.npmjs.org
```

装完可以留在镜像源上（日常装包更快），只在追新版本时用 `--registry` 临时覆盖。

## 步骤 1：装底座

```bash
pkg update && pkg upgrade
pkg install nodejs-lts python clang make git libvips openssh termux-services
sv-enable sshd
```

装好后从另一台机器 ssh 进来一次并保留会话。后续步骤会反复重启 dsh 进程，有一条稳定的旁路通道能省下大量时间。

## 打通 PC → 手机的通道（adb + ssh）

上一步装了 `openssh` 并启用了 sshd，现在把通道建起来。后续每一步都要在手机上改文件、重启进程、看日志，用手机键盘敲很痛苦；而 `adb shell` 是非交互的，`TERM` 缺失还会让一些工具输出异常。USB 映射 + ssh 之后就和操作一台普通 Linux 机器一样。

```bash
# PC 侧：把手机的 8022 映射到本机 22022
adb devices                              # 先确认设备串号
adb -s <串号> forward tcp:22022 tcp:8022

# 连上去。用户名用手机上的 `whoami` 查，或者随便填 —— 这个 sshd 不按用户名授权（见坑①）
ssh -p 22022 -i ~/.ssh/<你的密钥> <你的用户名>@127.0.0.1
```

这条通道走 USB，**不依赖手机有没有外网**。手机断网、开飞行模式、代理挂了，通道照常。

### 四个实测坑

**① Termux 的 sshd 不按用户名授权。** 实测 `root@` 与一个根本不存在的用户名都落到同一个 uid，认证只看公钥。所以用户名写错不会报错，也**不是**认证失败的排查方向 —— 连不上时只查私钥对不对、公钥有没有写进 `~/.ssh/authorized_keys`。

**② `adb forward --list` 里有规则，不代表它还能用。** 规则会"列得出来但已经死了"，ssh 报 `kex_exchange_identification: Connection closed`。重发一次同样的 `adb forward` 命令即恢复 —— 这条命令是幂等的，别先怀疑密钥。

**③ 私钥带口令在非交互环境用不了。** ssh 会等口令输入而卡住，表现为"命令超时"。给手机专用的密钥建议 `ssh-keygen -p -f <密钥>` 去掉口令，或者走 ssh-agent。

**④ 首次连接要接受主机指纹。** 脚本里会卡在 `Are you sure you want to continue connecting`。加 `-o StrictHostKeyChecking=accept-new`，或者先手工连一次。

### 附：把 PC 的代理借给手机

手机没有外网、或手机上的代理没覆盖 Termux 时，可以用 `adb reverse` 把 PC 的代理端口反向映射进去：

```bash
# PC 侧：手机 127.0.0.1:17897 → PC 127.0.0.1:7897
adb reverse tcp:17897 tcp:7897

# 手机上：临时走这条通道
git -c http.proxy=http://127.0.0.1:17897 pull
```

端口别用 7897 —— 手机上自己的代理（Clash 之类）通常已经占着它，`adb reverse` 会报 `cannot bind listener: Address already in use`。

PC 的代理如果只监听 `127.0.0.1`，局域网是连不上的，`adb reverse` 是唯一办法。


## 步骤 2：装 dsh，确认它起不来

```bash
npm i -g @deepseek-ai/dsh@0.2.2-alpha.2
dsh --profile main --no-open
```

预期它报错退出。记下报错原文——这是第一处不兼容，也是后续每一步的入口：解掉一处，重跑这条命令，看下一个错误。

这条命令在后续每一步之后都要重跑一次。不要把五处不兼容一次性全部处理，否则失败时无法判断是哪一处引起的。

## 步骤 3：编译原生模块

复制 `build2.sh` 与 `install-addon.sh` 到 `~`，然后：

```bash
bash ~/build2.sh
bash ~/install-addon.sh
```

`build2.sh` 从源码包编译 `node-addon-require-builtin` 的 android-arm64 版本，产物约 96 KB。`install-addon.sh` 把它放到 dsh 的 `node_modules/android-arm64/` 并补一个 `package.json`。

验证：

```bash
ls -l $PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/android-arm64/require_builtin.node
dsh --profile main --help | head -5
```

`--help` 输出正常即通过。产物已在本仓 `narb-src/packages/native/build/Release/` 里，可以直接复制到 `~/narb-src/` 跳过编译；构建树被 `.gitignore` 排除，只有 `.node` 被单独强制加入版本控制。

## 步骤 4：替换文件锁

```bash
bash ~/shim-flock.sh
```

把 dsh 依赖里的 `flock` 换成 no-op。

验证：`dsh --profile main --help` 不再报锁相关错误。

这一步的代价是跨进程文件锁消失，同一工作区不能同时跑两个 dsh 实例。把这条当作硬约束执行，见 [参考 §2](reference.md)。

## 步骤 5：接管硬链接

把 `android-fs-shim.cjs` 放到 `~/.dsh/`，然后在 `~/.bashrc` 追加：

```bash
export NODE_OPTIONS="--require=$HOME/.dsh/android-fs-shim.cjs"
```

验证（必须新开一个 shell，`NODE_OPTIONS` 不会对已存在的 shell 生效）：

```bash
echo $NODE_OPTIONS
```

应输出包含 `android-fs-shim.cjs` 的路径。

`NODE_OPTIONS` 只保留这一个 `--require`。图片后端不走环境变量注入，见步骤 6。

## 步骤 6：换上图片后端

```bash
bash ~/patch-attachment-durable.sh   # 先跑步骤 7 的补丁也可以，两者互不依赖
bash ~/install-sharp-shim.sh
```

`install-sharp-shim.sh` 依次做四件事：备份官方 sharp 到 `sharp.orig`、落位命令行后端、删除会静默接管的 `@img/sharp-wasm32` 与 `@emnapi/runtime`、跑自测。

验证自测四行全为 ✓：

```bash
node $HOME/shims/sharp/selftest.cjs
```

```
✓ metadata   png 2446x3462 uchar srgb alpha=false
✓ 全解码      25404156 B = 2446*3462*3，精确
✓ 缩放编码    565x800 JPEG，58629 B
✓ 回读校验    jpeg 565x800，与声明一致
```

若 `sharp.versions.vips` 为 `n/a-shim` 而不是 `8.18.x`，说明装的是 wasm 兜底而非本后端，回到 `install-sharp-shim.sh` 检查是否残留 `@img/sharp-wasm32`。判据与原因见 [参考 §4](reference.md)。

## 步骤 7：让附件写入容忍不可读祖先目录

```bash
bash ~/patch-attachment-durable.sh
```

脚本会先检查补丁是否已存在，再备份目标文件、校验字符串命中次数恰好为 1、替换后跑 `node --check`。

验证：输出包含 `语法 OK`，且重复执行时打印"已经打过补丁，跳过"。

## 步骤 8：重启并端到端验证

补丁落位不等于生效，进程必须重启：

```bash
pkill -f "dsh --profile"
cd ~ && nohup dsh --profile main --no-open >> ~/dsh-run.log 2>&1 &
bash ~/verify-dsh.sh
```

端到端判据是上传一张大图后观察落盘产物：

```
输入 2446×3462 PNG
产物 .dsh/attachments/v1/objects/…/…   1721×2436 JPEG 493 KB
```

尺寸变了、格式变了、字节数变了，三条同时成立才算解码真的发生。尺寸不变的产物说明走的是直通实现，回到步骤 6。

## 以后升级怎么办（**未实测**）

**先说清楚验证状态：本仓只在 `0.2.2-alpha.2` 上做过一次移植，`upgrade.sh` 一次都没跑过。**

判据：`~/upgrade.log` 不存在。脚本第一行就把输出 `tee` 到那个文件，跑过就一定有。所以下面讲的是**设计意图**，不是实测记录——第一次真升级时请盯着跑，别当已知可用。

### `upgrade.sh` 和上面那些步骤是什么关系

**同一件事的两种形态，不是两条路。**

| | 用途 | 什么时候用 |
|---|---|---|
| 步骤 3~7 | 手动把五处补丁逐个做一遍，每步带验证判据 | **首次移植**，以及升级后怀疑某处没生效时 |
| `upgrade.sh` | 把同一批动作串起来重放 | **以后重复执行**，不适合首次 |

首次就上脚本的问题：`npm install -g` 会整个换掉安装目录，如果脚本里某一步在新版本上失效（上游改了文件路径、改了要替换的那行字），它可能**打完一半才失败**，而你已经分不清哪几处生效了。手动做每一步都能立刻验证，坏了能定位。

### 真要升级时

```bash
bash ~/upgrade.sh <目标版本>
```

脚本按补丁清单顺序重放，最后列出安装目录里仍带 `is not supported on` 的包——那是下一个待处理的不兼容点。重放完成后同样要重启进程。

**第一次跑完别只看退出码**，回头把步骤 3~8 的判据手工验一遍：`dsh --help` 出内容、`selftest.cjs` 四行 ✓、大图落盘尺寸有变化。脚本绿了但补丁没生效的情况，正是这个仓最想防的那类失败。

## 排错

| 现象 | 处理 |
|---|---|
| `Cannot find module ...require_builtin.node` | 步骤 3 未完成 |
| 启动报 flock 不支持 | 步骤 4 未完成 |
| 会话日志或附件写入 `EACCES`（`link` 相关） | 步骤 5；确认 `NODE_OPTIONS` 在启动前已生效 |
| `Could not load the "sharp" module` | 步骤 6 未完成 |
| 图片能读但缩放无效、字节数不变 | 步骤 6 装成了 wasm 兜底，见 [参考 §4](reference.md) |
| 上传图片 `EACCES` | 步骤 7 未完成 |
| 补丁都打了但行为没变 | 进程未重启 |
| 重启后仍没变 | 新 shell 才有 `NODE_OPTIONS`；确认启动 dsh 的 shell 是补丁之后开的 |
