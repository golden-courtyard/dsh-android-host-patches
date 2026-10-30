# 手机端 DSH 宿主：移植记录与交接

写于 2026-10-29 00:41，01:1x 补 3.8（Asia/Shanghai）。作者：lead（华），会话 cwd `~/hub`。
本文件放在 `~/sync/phone-share/`，经 syncthing 同步到 PC（LAPTOP-LMQ），供 PC 上的 dsh 阅读。

## 0. 一句话

一台无 root 的 Android 16 手机（Xiaomi 2510ERA8BC / Termux）已经能跑
`@deepseek-ai/dsh@0.2.2-alpha.2` 的 web 界面。本轮补上第四道平台关卡（图片解码），
代码已落位并自测通过，**但需要重启 dsh 进程才生效**。

## 1. 环境事实（全部实测，非推断）

- Android 16，aarch64，8 核，11.6 GB RAM（available ≈3.6 GB，swap 已用 7.5 GB）
- 存储 464 GB，已用 92%，剩 41 GB —— 空间是硬约束
- Termux 0.118.3，无 root，进程域 `untrusted_app_27`
- node v24.22.1 / python 3.14.8 / clang 21.1.8 / git 2.56.0
- **没有** R、Mathematica、MATLAB、WinDbg、julia、rustc、go、java、ffmpeg
  （CLAUDE.md 里"这些都在"指的是 PC，不是这台机器）
- 常驻服务由 runsvdir 管理：syncthing、sshd、ssh-agent；`sshd` 的
  `authorized_keys` 里有 PC 的公钥，所以 PC 可以反向连进来
- dsh web 手动启动，监听 `127.0.0.1:3080`，token 在 `~/dsh-run.log`
- 本地模型 `qwen05.gguf` 470 MB，从未跑过
- 本轮 `apt install libvips` 顺带装进了 imagemagick 7、librsvg 2.63、poppler、graphviz

## 2. 本轮之前已经打通的三道关卡

都是"官方不支持 android-arm64"这一类，解法都是 shim + 可重放脚本：

1. **原生模块 `node-addon-require-builtin` 无预编译包**
   → 手机本地 `node-gyp` + clang 21 编译出 96 KB `require_builtin.node`，
   手工放进 `node_modules/@deepseek-ai/dsh/node_modules/android-arm64/`。
   脚本：`build2.sh`（从 tar 包解）、`install-addon.sh`。
2. **`flock` 被平台门控拒绝**
   → `shim-flock.sh` 换成 no-op。代价写在脚本注释里：跨进程文件锁没了，
   同工作区双实例会写坏 JSONL，单实例可接受。
3. **Android 不支持硬链接**
   → `.dsh/android-fs-shim.cjs`，经 `NODE_OPTIONS --require` 注入，
   `fs.link*` 失败时回退 `rename`。语义差异：rename 会覆盖已存在目标。

`upgrade.sh` 在每次 `npm install` 后重放 1、2 两关（升级会覆盖）。

## 3. 本轮：第四道关卡 —— 图片解码（sharp）

### 3.1 症状

`read_image` 直接报：

```
Could not load the "sharp" module using the android-arm64 runtime
```

### 3.2 关键证据：wasm 兜底是假成功

npm 上没有 `@img/sharp-android-arm64`，但 sharp 自带 wasm 兜底分支
（`dist/sharp.cjs` 里 `require("@img/sharp-wasm32/sharp.node")`）。
装上去之后 `metadata()` 返回正确宽高、`toBuffer()` 返回 Buffer、**不报错**——
但：

- `sharp.versions.vips === "n/a-shim"`
- `versions` 里多一个 `sharp: "shim"` 字段
- `resize({width:800})` 之后的 `toBuffer()` 长度精确等于输入字节数，magic 仍是 PNG

结论：它落到了 sharp 打包的 passthrough shim。**不报错 ≠ 干了活**。
这条坑差点让人以为 wasm 可用。

### 3.3 一条更早的、更弱的 shim（已退役）

`~/.dsh/sharp-shim.cjs`（2026-10-28 00:02，241 行）用 `Module._load` 拦截
`require('sharp')`，纯 JS 解文件头 + 原字节直通。它自己注释里写明了边界：
大图会走管线、尺寸对不上、被 `verifyNormalizedImage` 拒绝。

`hub/reg-cert.png`（2446×3462，8.5 MP，1.9 MB）正好踩在断点上：
`readRequestImageFile` → `createRequestImage` 要真实缩放，直通尺寸不符，
`verifyRequestImage` 拒掉。

该实现原样留档于 `shims/retired/sharp-shim.passthrough.cjs`，没有覆盖丢弃。

### 3.4 三条死路与一条活路

| 路线 | 结果 |
| --- | --- |
| 官方平台包 | 不存在，sharp 不发 android 构建 |
| wasm32 | 静默 passthrough，假成功（见 3.2） |
| 原生编译 | 不通：Termux 的 libvips 不带 `vips-cpp.h`，而 sharp 的 `src/*.cc` 需要它 |
| **libvips CLI 后端** | **可行**，Termux 源里 `libvips 8.18.7`，正好等于 sharp 0.35.5 的 `minimumLibvipsVersion` |

### 3.5 实现

- `shims/sharp/index.cjs` —— 只实现 `@deepseek-ai/dsh-attachment-local`
  真正用到的接口面：`metadata / raw / rotate / toColourspace / resize /
  jpeg / png / webp / clone / toBuffer({resolveWithObject}) / toFile`。
  像素工作全部交给 `vips` / `vipsheader` / `rawsave` / `thumbnail` 子进程。
  不支持的格式（gif/avif/heif）**直接抛错，不静默降级**。
- `shims/sharp-boot.cjs` —— `NODE_OPTIONS --require` 钩子，只做转发，
  不再自己实现任何图像逻辑。
- `shims/sharp/selftest.cjs` —— 覆盖 metadata → 全解码 → 缩放 → 编码 → 回读。
- `install-sharp-shim.sh` —— 幂等重放：备份官方 sharp → 落位 → 清掉会
  静默接管的 wasm 包 → 检查 NODE_OPTIONS → 自测。

接口面是从源码点出来的。`attachment-local` 里 sharp 的方法调用只有这几种：

```
2 .resize(  2 .toColourspace(  2 .toBuffer(  1 .webp(
1 .rotate(  1 .raw(  1 .metadata(  1 .jpeg(  1 .clone(
```

（`.trim(` 的两处是 `String.prototype.trim`，不是 sharp 的。）

### 3.6 自测数字（真图 `reg-cert.png`）

```
✓ metadata   png 2446x3462 uchar srgb alpha=false
✓ 全解码      25404156 B = 2446*3462*3，精确
✓ 缩放编码    565x800 JPEG，58629 B
✓ 回读校验    jpeg 565x800，与声明一致
```

单次缩放编码约 0.48 s（两次 vips 子进程）。当前实现每张图会起若干子进程，
没有做常驻优化——手机单用户场景够用。

### 3.7 生效条件

`NODE_OPTIONS` 在进程启动时固定，`Module._load` 钩子也是启动时装上的。
**已经在跑的 dsh 进程用的是旧 shim**，必须重启：

```bash
pkill -f "dsh --profile main"
cd ~ && dsh --profile main --no-open >> ~/dsh-run.log 2>&1 &
```

`.bashrc` 已指向 `shims/sharp-boot.cjs`，新 shell 自动带。

### 3.8 后来的一次实证：解码在主进程，钩子是多余的

重启之后（PID 13858，2026-10-29 00:53）`read_image` 直接成功了：
`hub/reg-cert.png` 2446x3462 → 归一化副本 1721x2436 JPEG 493 KB，
落在 `.dsh/attachments/v1/objects/e8/e8dd22…`。这是真解码 + 真缩放 + 真重编码。

但此时进程的 `NODE_OPTIONS` 仍指向**旧的 passthrough shim**
（`.dsh/sharp-shim.cjs`），而它只会原字节直通。矛盾。于是做了实证：

**抓子进程**（ps 轮询 25 s，同时读一张新图 `probe2.jpg` 2400x3396）：

```
19986 13858 vipsheader -a /…/dsh-sharp-13858-907b1baabddc.bin
20006 13858 vips rawsave /…/dsh-sharp-13858-a6e35b6e5a7c.bin /…62a5ff4ba7f4.raw
20099 13858 vips colourspace /…/dsh-sharp-13858-76359037fe45.bin /…fd1ff40d1cf7.v srgb
20150 13858 vips jpegsave --Q 85 /…fd1ff40d1cf7.v /…635aa52bd107.jpeg
```

`ppid=13858`，临时文件名里的 pid 也是 `13858`（shim 的 `tmpPath` 用 `process.pid`）。
结论：**解码就在 dsh 主进程里，走的是 `node_modules/sharp`（CLI 后端）**，
不是子进程，也不是钩子返回的 passthrough 对象。

同时给 shim 插了调用日志，日志文件**没有出现**——因为主进程启动时加载的是
插桩前的版本（模块已缓存）。这一点反过来印证了"代码确实来自该文件"。

已排除的方向：

- 钩子在 CJS 与 ESM 下都有效：用同样的 `NODE_OPTIONS` 跑
  `createRequire(attachment-local/lib/index.js)("sharp")`，两种都是 `n/a-shim`
- dsh 没有自己 patch `Module._load`（全树 grep 无命中）

**未定**：进程 `/proc/13858/environ` 里确实有那条 `--require=...sharp-shim.cjs`，
但解码路径没有经过它。具体机制没有定论，也不再追。

机制问题已开 issue 跟踪：**agent-hub #3** —
https://github.com/liumiaoqi/agent-hub/issues/3
（2026-10-30 关闭为 NOT_PLANNED：机制层面成立、现象不可复现、已无影响）

**处置**：既然"替换 `node_modules/sharp`"是被实证有效的机制，就不再依赖钩子：

- `.bashrc` 的 `NODE_OPTIONS` 撤回为只含 `android-fs-shim`
  （它 patch 的是 `fs` 对象上的方法，与模块加载系统无关，因此在任何环境下都生效）
- `shims/sharp-boot.cjs` 保留在仓里备用，但不再被引用
- 解码路径的下一步验证：重启后看 `$TMPDIR/dsh-sharp-calls.log` 是否出现

## 4. 猜测（无实证，明确标为猜测）

- 这台机器进团队的理由可能不是算力而是**传感器**。`rate.sh` 用
  `termux-sensor` 测 icm4x6xx 加速度计在不同 `-d` 下的实际采样率，
  这在 PC 上做不了。IMU/GPS/麦克风/摄像头是手机独有的输入。
- `~/ur.txt` 与 `~/upload_resp.txt` 内容都是 `unauthorized`（00:24、00:25），
  是网页上传通道的 401，与 sharp 无关，是另一条线。之后 00:29 图片被直接
  放进了 `hub/`，看起来是上传失败后改用手工放置。

## 5. 本机状态

- git 仓在 `~` 根（不是 hub），`main` 分支，已有若干 commit：
  - `f288440` 手机端 DSH 宿主补丁集：首仓
  - `d7ce30e` NODE_OPTIONS 同时加载硬链接垫片与 sharp 垫片
  - `fac4e3c` 忽略 .config/（gh 的明文 token）与 *.log
  - `9ea7343` sharp 后端：用 libvips 命令行顶替原生 binding
- 标签 `v0.2.2-alpha.2-bringup` 标的是"这台机器确实跑起来了"那一刻
- `.gitignore` 排除：`.dsh/`（含凭据、会话日志）、`narb-src/`、`*.gguf`、
  `sync/`、`hub/`、`.ssh/`、`.udocker/`、`.config/`、`*.log`
- `hub/` 是工作台，本身接近空，只有本轮这张 `reg-cert.png`
- 已入库的文件清单：`bin/dsh`、`.bashrc`、`.npmrc`、10 个 `*.sh`、
  `dsh-presets-phone/`（delivery + sec-assessment 两个预设包）、
  `shims/`、`narb-src/packages/native/build/Release/require_builtin.node`
  （96 KB，force-add，因为 `narb-src` 整棵被忽略）

## 5.5 本轮实际动过的东西（审计用）

不是猜测，是操作记录：

- `apt install libvips` → 8.18.7，连带 imagemagick 7.1.2、librsvg 2.63.4、
  poppler 26.10.0、graphviz 16.1.0
- `node_modules/@deepseek-ai/dsh/node_modules/sharp` → 替换为 CLI 后端，
  原包备份在同目录 `sharp.orig`
- 删除了本轮试装过的 `@img/sharp-wasm32` 与 `@emnapi/runtime`
  （它们会静默接管，必须清掉问题才可见）
- 新增 `~/shims/{sharp/,sharp-boot.cjs,retired/}`、`~/install-sharp-shim.sh`
- `.bashrc` 的 `NODE_OPTIONS`：撤回为只含 `android-fs-shim`
  （sharp 钩子经实证对解码路径无效，见 3.8）
- `~/.dsh/sharp-shim.cjs` **没有删除**，只是不再被引用；
  内容副本在 `shims/retired/sharp-shim.passthrough.cjs`
- git 提交 `9ea7343`
- `~/hub/reg-cert.png` 未入库（`hub/` 在 .gitignore 里）

## 6. 未决事项

1. ~~重启并验证 `read_image`~~ 已于 2026-10-29 00:5x 验证通过
   （见 3.8；钩子已撤回，机制收敛为 node_modules 替换）
2. 上传通道 401 `unauthorized` —— 未查，与 sharp 无关
3. `qwen05.gguf` 从未启动，本地推理链路未验证
4. 存储剩 41 GB、swap 已用 7.5 GB —— 这台机器适合小矩阵、长时序的算法实验，
   不适合大模型或大图搜索
5. `upgrade.sh` 目前只重放 flock 与原生模块两关，sharp 这关需要追加一步
   （`install-sharp-shim.sh`）
6. ~~NODE_OPTIONS 钩子为何未作用于解码路径~~ —— agent-hub #3 已关闭（NOT_PLANNED）。
   结论：`NODE_OPTIONS --require` + `Module._load` patch 在 PC 与手机上都成立，
   `android-fs-shim` 就是这条且一直有效；现象不可复现，改用替换 `node_modules/sharp`
   后解码一直正常，已无影响。当时那个进程已退出，最可能的解释是 `.bashrc` 指向的
   文件内容与事后读到的那一版不是同一份。
   **教训：再遇到"钩子像没生效"，先核对 `--require` 那个文件的 sha256，再谈加载机制。**

## 7. 给 PC 侧 dsh 的两条建议

- 不要假设这台机器有 R/Mathematica/MATLAB。它只有 node/python/clang/vips。
- 需要它做图像处理时，走 `vips` CLI，不要指望 sharp 的原生 binding。
