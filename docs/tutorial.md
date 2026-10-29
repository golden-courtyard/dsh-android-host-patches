# 把 dsh 装上无 root 的 Android —— 实测记录

> 记录时间：2026-10-29。目标版本 `@deepseek-ai/dsh@0.2.2-alpha.2`。
> 全部数字都是这台机器上跑出来的，不是推断。猜测会明确标"猜测"。

## 0. 这份文档怎么用

它记的是**一台具体机器的移植过程**，不是通用安装指南。你按它走，会依次撞上五道关卡，
每一关都写了：症状 → 为什么 → 怎么解 → 怎么验证解对了。

**最值得读的不是解法，是第 4 关和第 8 节** —— 那里记了一个"不报错但什么也没干"的假成功，
以及一次"我以为 A 在起作用，实际是 B"的误判。这两种比报错难查得多。

## 1. 前提与边界

### 实测机

| 项 | 值 |
|---|---|
| 机型 | Xiaomi 2510ERA8BC，Android 16，aarch64，8 核 |
| 内存 | 11.6 GB（可用约 3.6 GB，swap 已用 7.5 GB） |
| 存储 | 464 GB，已用 92%，**剩 41 GB** |
| Termux | 0.118.3，**无 root**，进程域 `untrusted_app_27` |
| 工具链 | node v24.22.1 / python 3.14.8 / clang 21.1.8 / git 2.56.0 |

**这台机器没有** R、Mathematica、MATLAB、julia、rustc、go、java、ffmpeg。
它只有 node / python / clang / vips。别照搬 PC 上的假设。

### 边界

- **无 root**。所有解法都在应用沙箱内，不碰系统分区。
- **不改 dsh 源码，不 fork**。补丁落在安装目录之外，或做成可重放脚本。
- 目标是"能干活"，不是"和 PC 上一样快"。

## 2. 五关总览

| # | 关卡 | 症状（原话） | 解法 |
|---|---|---|---|
| 1 | 原生模块无预编译包 | `Cannot find module ...require_builtin.node` | 本地编 |
| 2 | `flock` 平台门控 | 启动即报 unsupported | no-op |
| 3 | 不支持硬链接 | 会话日志/附件写入 `EACCES` | `link` → `copyFile` |
| 4 | `sharp` 无 android 构建 | `Could not load the "sharp" module using the android-arm64 runtime` | libvips CLI |
| 5 | fsync 到 `/data/data` 失败 | 上传图片 `EACCES` | 越权祖先目录跳过 |

**顺序不是随便排的**：前一关不通，dsh 根本起不来，也就看不到后一关的报错。
所以必须按顺序打，一关通了再跑一次看下一个错。

## 3. 第 0 步：Termux 底座

```bash
pkg update && pkg upgrade
pkg install nodejs-lts python clang make git
pkg install libvips              # 第 4 关的正主，8.18.7

node -v && vips --version
```

`vips --version` 要能看到 `8.18.x` —— sharp 0.35.5 要求的最低 libvips 是 8.18，
版本低了后端跑不起来。

同时建好常驻服务（可跳过，但强烈建议 —— PC 能反向 ssh 进来才好排查）：

```bash
pkg install openssh termux-services
sv-enable sshd
```

## 4. 第 1 步：装 dsh，先让它坏

```bash
npm i -g @deepseek-ai/dsh@0.2.2-alpha.2
dsh --profile main --no-open
```

**它会起不来。这是好事** —— 你现在看到了第一关的原始报错，而不是别人转述的症状。

从这一步开始，每次解决一关，就重跑一次这条命令，看下一个错。

## 5. 关卡一：原生模块没有 android 包

### 症状

```
Error: Cannot find module '.../node_modules/android-arm64/require_builtin.node'
```

`node-addon-require-builtin` 是 dsh 的依赖，npm 上只有 linux/darwin/win32 的预编译包，
`android-arm64` 没有。

### 解法：本地编

```bash
bash build2.sh        # 从 tar 包解出源码，node-gyp + clang 编 android-arm64
bash install-addon.sh # 放到 dsh 的 node_modules/android-arm64/ 下并自测
```

编出来的 `.node` 只有 96 KB。`install-addon.sh` 会在旁边补一个 `package.json`：

```json
{ "name": "node-addon-require-builtin-android-arm64",
  "version": "0.1.9", "private": true, "main": "require_builtin.node" }
```

### 验证

```bash
node -e 'const m=require(process.argv[1]); console.log(Object.keys(m))' \
  "$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/android-arm64"
dsh --profile main --help | head -5
```

`dsh --help` 能出内容，说明这一关过了。

> **为什么把 `.node` 直接提交进仓**：构建树 `narb-src/` 被 `.gitignore` 排除了，
> 96 KB 的产物是这台机器上唯一能直接复用的东西。重编要装整套 clang 工具链，不划算。

## 6. 关卡二：`flock` 平台门控

### 症状

启动时报 `flock` 不被支持。dsh 用 `flock` 做工作区级的跨进程锁。

### 解法

`shim-flock.sh` 把它换成 no-op。

### 代价（写在脚本注释里，不是口头承诺）

**跨进程文件锁没了。** 同一个工作区同时开两个 dsh 实例，会话 JSONL 会被写坏。
单实例使用可以接受 —— 但这意味着"手机上别开两个 dsh"是**硬约束**，不是建议。

## 7. 关卡三：Android 不支持硬链接

### 症状

会话日志和附件发布报 `EACCES`。实测 `ln` 和 `fs.link` 都是 `Permission denied`。

dsh 有两处用 `link()` 做**原子发布**：

```
@deepseek-ai/dsh-session-persistence-jsonl   写会话日志
@deepseek-ai/dsh-attachment-local            发布附件对象
```

### 解法：`fs.link` 失败回退 `copyFile`

`android-fs-shim.cjs`，经 `NODE_OPTIONS --require` 注入。`.bashrc` 里：

```bash
export NODE_OPTIONS="--require=$HOME/.dsh/android-fs-shim.cjs"
```

### 为什么是 `copyFile` 而不是 `rename`

调用方用的是「`link(src, dst)` → `unlink(src)`」这套惯用法：
它期望 `link` 之后 **src 还在**，然后自己删。

如果兜底用 `rename`，src 已经被移走了，`unlink(src)` 会 `ENOENT` —— **把调用方的惯用法打破**。

**这是本仓里唯一一处"选错兜底会把上层逻辑弄坏"的地方。** 最初版本就是 `rename`，
被这条推理推翻后改成 `copyFile`（见提交 `e97080b`）。

### 语义差异（必须知道）

Android 上不再有"原子发布"。`copyFile` 是拷一份，中途崩溃会留半份文件。
单用户手机场景能忍，但别在大文件上指望它。

## 8. 关卡四：`sharp` 没有 android 构建（**最容易翻车的一关**）

### 3.1 症状

```
Could not load the "sharp" module using the android-arm64 runtime
```

`read_image` 直接用不了。

### 3.2 大坑：wasm 兜底是**假成功**

npm 上确实没有 `@img/sharp-android-arm64`，但 sharp 自带 wasm 兜底分支。
装上去之后：

```
metadata() → 返回正确的宽高
toBuffer() → 返回一个 Buffer
一个错都不报
```

**看起来成了。其实没干。** 判据：

```
sharp.versions.vips === "n/a-shim"        ← 正常的应该是 8.18.x
versions 里多一个 sharp: "shim" 字段
resize({width:800}) 之后 toBuffer() 的长度 === 输入字节数，magic 仍是 PNG
```

**它落到 sharp 打包的 passthrough shim 上了。不报错 ≠ 干了活。**

> 这条差点让人以为 wasm 可用。**判据不能是"有没有报错"，必须是"输出对不对"。**

### 3.3 三条死路

| 路线 | 结果 |
|---|---|
| 官方平台包 | 不存在，sharp 根本不发 android 构建 |
| wasm32 | 静默 passthrough，假成功（见上） |
| 原生编译 | **不通**：Termux 的 libvips 不带 `vips-cpp.h`，而 sharp 的 `src/*.cc` 需要它 |

### 3.4 活路：用 libvips 命令行做后端

Termux 源里的 `libvips 8.18.7` 正好等于 sharp 0.35.5 的 `minimumLibvipsVersion`。
所以不编原生 binding，直接**调 vips 命令**。

关键是**只实现真正用到的接口面**。从 dsh 源码里点出来，
`attachment-local` 调 sharp 的方法只有这几种：

```
2 .resize(   2 .toColourspace(   2 .toBuffer(   1 .webp(
1 .rotate(   1 .raw(             1 .metadata(   1 .jpeg(   1 .clone(
```

（`.trim(` 的两处是 `String.prototype.trim`，不是 sharp 的 —— 别数错了。）

`shims/sharp/index.cjs` 就实现这些，像素工作全部交给 `vips` / `vipsheader` /
`rawsave` / `thumbnail` 子进程。

**不支持的格式（gif / avif / heif）直接抛错，不静默降级。**
理由同上：静默降级就是下一个"假成功"。

### 3.5 安装

```bash
bash install-sharp-shim.sh
```

它做四件事，**幂等**（重复跑不会搞坏）：

1. 备份官方 sharp → `sharp.orig`
2. 落位 CLI 后端
3. **清掉会静默接管的 wasm 包**（`@img/sharp-wasm32`、`@emnapi/runtime`）——
   不删它们，问题就看不出来
4. 检查 `NODE_OPTIONS`，跑 `selftest.cjs`

### 3.6 自测数字（真图 2446×3462 PNG）

```
✓ metadata   png 2446x3462 uchar srgb alpha=false
✓ 全解码      25404156 B = 2446*3462*3，精确
✓ 缩放编码    565x800 JPEG，58629 B
✓ 回读校验    jpeg 565x800，与声明一致
```

单次缩放编码约 **0.48 s**（两次 vips 子进程）。没做常驻优化，手机单用户够用。

### 3.7 一个必须知道的误判

最初的设计是"用 `Module._load` 钩子拦截 `require('sharp')`"，经 `NODE_OPTIONS` 注入。

重启之后 `read_image` **成功了**。但当时进程的 `NODE_OPTIONS` 还指向**旧的 passthrough shim**
—— 按设计它只会原字节直通，不可能成功。矛盾。

于是抓子进程（ps 轮询 25 s，同时读一张新图）：

```
19986 13858 vipsheader -a /…/dsh-sharp-13858-….bin
20006 13858 vips rawsave /…/dsh-sharp-13858-….bin /….raw
20099 13858 vips colourspace /…/dsh-sharp-13858-….bin /….v srgb
20150 13858 vips jpegsave --Q 85 /….v /….jpeg
```

`ppid=13858` —— 就是 dsh 主进程的 pid，临时文件名里的 pid 也是它。

**结论：解码在主进程里跑，走的是 `node_modules/sharp`（已替换成 CLI 后端），
不是钩子。** 钩子是多余的。

**处置**：`.bashrc` 的 `NODE_OPTIONS` 撤回为只含 `android-fs-shim`
（它 patch 的是 `fs` 对象上的方法，与模块加载系统无关，任何环境下都生效）；
`shims/sharp-boot.cjs` 留在仓里备用，但不再被引用。

> 至今没搞清"为什么钩子没生效却看起来像生效了"（进程 environ 里确实有那条 `--require`）。
> **但机制已经收敛到一个可以被实证的方向**：替换 `node_modules/sharp` 是有效的，
> 那就只用它，不再依赖钩子。**未定的事记成未定，不要编一个解释。**

## 9. 关卡五：附件写入 fsync 到 `/data/data` 就失败

### 症状

上传图片报 `EACCES`。

### 原因

`ensureDurableHome` 会从 `DSH_HOME` 一路 `fsync` 到**文件系统根**。
而 `/data/data` 这一层对 Termux 不可读（system 所有），`open` 直接 `EACCES`。

### 解法

```bash
bash patch-attachment-durable.sh
```

改 `syncDirectory`：`open` 失败且是 `EACCES`/`EPERM` 时**跳过**，不让整次写入失败。

语义与其它几关一致 —— **无法担保的祖先目录就不担保，而不是整个操作失败**。

这个补丁是**改 dsh 安装目录里的文件**（`dsh-attachment-local/lib/index.js`），
所以必须做成可重放的，且脚本会：

- 先 `grep` 检查是否已打过（幂等）
- 备份成 `.orig-HHMMSS`
- 校验**预期命中恰好 1 次**，不是 1 次就放弃（防止上游改代码后打歪）
- 打完 `node --check` 语法检查

> **"预期命中 1 次"这个自检值得学**：字符串替换类补丁最怕上游微调后
> 静默命中 0 次或 2 次。命中数不对就拒绝执行，比打完才发现好。

## 10. 升级之后怎么重放

`npm install -g` 会**整个换掉安装目录**，所以关卡 1、2、4、5 的改动全丢。
`~/.dsh` 和 `~/shims` 不在安装目录内，不受影响（关卡 3 就活在那儿）。

```bash
bash ~/upgrade.sh 0.2.2-alpha.2
```

它按顺序做：

```
0. 升级前版本
1. 装指定版本（--ignore-scripts）
2. 版本核对 + 打印需要的原生模块版本
3. 重放原生模块
4. 重放 flock 替换
4.5 重放 sharp 后端
4.6 重放附件持久化补丁
5. 检查 NODE_OPTIONS
6. 列出还有哪些平台门控包  ← 这是下一关的清单
```

### 升级后必须重启进程

`NODE_OPTIONS` 和模块缓存都在启动时固定。**不重启 = 用的还是旧代码**：

```bash
pkill -f "dsh --profile" && cd ~ && nohup dsh --profile main --no-open >> ~/dsh-run.log 2>&1 &
```

> 这一步坑过一次：补丁落位了、自测过了，但 `read_image` 还是旧行为 —— 因为进程没重启。

## 11. 验证清单

```bash
bash verify-dsh.sh
```

要看的几项：

```bash
dsh --version                          # 版本对
vips --version                         # 8.18.x
node -e 'console.log(process.env.NODE_OPTIONS)'   # 只有 android-fs-shim
ls -l $PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/sharp/package.json  # 是 CLI 后端
node $HOME/shims/sharp/selftest.cjs    # 四行 ✓
```

端到端最硬的一条：**上传一张大图，看落盘的是不是真的缩放后的副本。**

```
输入 2446×3462 PNG
→ .dsh/attachments/v1/objects/…/…  1721×2436 JPEG 493 KB
```

尺寸变了、格式变了、字节数变了 —— 这才是真解码。**尺寸没变就是假成功，回去看第 8 节。**

## 12. 排错表

| 现象 | 先查什么 |
|---|---|
| `Cannot find module ...require_builtin.node` | 关卡 1 没重放；跑 `install-addon.sh` |
| 启动报 flock unsupported | 关卡 2 没重放；跑 `shim-flock.sh` |
| 会话日志写不进去 | 关卡 3；确认 `NODE_OPTIONS` 里有 `android-fs-shim` |
| `Could not load the "sharp" module` | 关卡 4；跑 `install-sharp-shim.sh` |
| sharp 不报错但 `resize` 没效果 | **wasm 假成功**；查 `sharp.versions.vips` 是不是 `n/a-shim`，删掉 `@img/sharp-wasm32` |
| 上传图片 `EACCES` | 关卡 5；跑 `patch-attachment-durable.sh` |
| 补丁都打了但行为没变 | **进程没重启**；`pkill` 后重开 |
| 补丁打了，重启了，还是没变 | `NODE_OPTIONS` 在进程启动时固定；确认 `.bashrc` 生效（新 shell 才行） |

## 13. 为什么不做成 fork

fork 一条分支，改起来爽，但每次 dsh 上游更新都要合并，冲突会越来越多 ——
而且这些补丁**全都是平台适配**，跟 dsh 的功能演进没关系，混在一起只会互相拖累。

现在的做法：补丁全在安装目录之外或可重放脚本里。代价是升级要跑一次 `upgrade.sh`，
收益是不会跟上游打架。对一个"我自己一台机器用"的场景，这个取舍很划算。

## 14. 怎么找下一关

`upgrade.sh` 第 6 步：

```bash
grep -l "is not supported on" "$D"/@deepseek-ai/*/lib/*.js
```

它把安装目录里所有带平台门控的包列出来。**每一行都是下一个可能的关卡。**

这个方法比"等它报错"好：报错只在你踩到那条路径时才出现，
而 grep 能提前看到全部门控点。

## 15. 保留误判

`sync/phone-share/` 里那份原始记录**没有删改**，包括当时的错误判断
（比如把硬链接兜底写成 `rename`，实际实现是 `copyFile`）。

留着的原因：**下次遇到同类问题，最有用的不是正确答案，是"当初怎么想错的"。**
正确答案在代码里，误判只在记录里。
