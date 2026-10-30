---
name: installed-tools
description: Use before assuming any command exists on this phone (Termux/Android, no root), or when choosing a tool for image, text, media, sensor, or network work here. Lists what is actually installed, what is missing, the shims that replace missing pieces, and the Android-specific traps.
---

# 本机工具（2026-10-29 实测）

判据永远是 `command -v <name>`，不要凭印象。这台机器是 Termux / Android 16 / aarch64 / 无 root。

## 有

| 类别 | 工具 |
| --- | --- |
| JS | `node` v24.22.1、`npm`、`npx` |
| Python | `python3` 3.14.8、`pip3`（仅 pip / proot-distro / udocker，**没有 numpy、PIL**） |
| 编译 | `clang` / `gcc` / `g++` 21.1.8、`make`、`node-gyp` 可用（原生模块能本地编） |
| 版本 | `git` 2.56.0、`gh` 2.103.3（已登录 liumiaoqi） |
| 图像 | `vips` / `vipsheader` 8.18.7、`magick` / `convert` 7.1.2 |
| 文本 | `sed`、`awk`、`tar`、`unzip`、`curl` |
| 远程 | `ssh`、`scp`（sshd 常驻，PC 可反向连入） |

## 没有

`cmake`、`wget`、`jq`、`zip`、`rsync`、`sqlite3`、`tree`、`tmux`、`file`、`xxd`、`ffmpeg` / `ffprobe`、`optipng`、`pngquant`

以及 PC 上那些大件：`R` / `Rscript`、`julia`、`octave`、`mathematica`、`rustc`、`go`、`java`、`gdb` / WinDbg。

**不要直接写缺的那几个名字**，先换成替代：

| 缺的 | 用这个 |
| --- | --- |
| `jq` | `python -c 'import json,sys; d=json.load(sys.stdin); ...'` |
| `file` | `vipsheader`（图片）；其他用 python 读魔数 |
| `zip` | `tar -czf x.tgz ...` |
| `rsync` | `scp -r`，或 syncthing |
| `ffmpeg` | 没有替代；音视频转码只能 `udocker` / `proot-distro` |
| 图像库（PIL / sharp 原生） | `vips` 命令行 |

## Android 专有坑（都踩过）

1. **`/tmp` 不存在。** 临时文件写 `$TMPDIR`（= `$PREFIX/tmp`），写 `/tmp` 会 `write failed`。
2. **不支持硬链接。** `ln` 直接 `Permission denied`；跑 dsh 靠 `~/.dsh/android-fs-shim.cjs` 把 `fs.link` 降级成 `copyFile`。
3. **`/data/data` 从外部不可读。** 手机文件管理器、Shizuku 都进不来；要取文件先 `cp` 到 `/sdcard`。
4. **`vips` 的 `--Q` 只属于 savers**（`jpegsave` / `webpsave`）。`vips thumbnail` 不认 `--Q`，会报 `Unknown option`。缩略图要么分两步（`thumbnail` → `.v` → `saves`），要么接受默认质量。
5. **dsh 的 sharp 是 CLI 后端，不是官方 binding。** 实现在 `~/shims/sharp/`，落位在 dsh 的 `node_modules/sharp`。它靠替换目录生效，**不靠 `NODE_OPTIONS` 钩子**（钩子对解码路径无效，2026-10-29 实测）。
6. **`termux-api` 命令需要 `com.termux.api` 应用常驻**，否则命令挂起不该等——用 `timeout`。
7. **存储只剩约 41 GB**（464 GB 已用 92%）。别拉大模型、别建大索引。

## termux-api（传感器是这台机器相对 PC 的独有输入）

`termux-sensor`、`termux-battery-status`、`termux-notification`、`termux-clipboard-get`、`termux-toast`、`termux-camera-photo`、`termux-location`、`termux-tts-speak`、`termux-vibrate`

采样率不要信 `-d` 的标称值，实测：`~/rate.sh` 用 `termux-sensor -d N -n 60` 数行数除以真实耗时。

## 什么时候用 udocker / proot-distro

只在真的需要 x86 工具链或 glibc 生态时（ffmpeg、某些 python 包）。代价是启动慢、占空间，手机单用户场景优先考虑"用现有 node/python 重写"。
