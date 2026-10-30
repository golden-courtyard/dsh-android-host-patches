<div align="center">

  <h1>dsh-android-host-patches</h1>
  <sub><sup>在无 root 的 Android 上运行 DeepSeek Harness 所需的宿主侧补丁</sup></sub>

  <p>
    <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered%20by-dsh-4D6BFE?logo=deepseek&logoColor=white" alt="powered by dsh"></a>
    <img src="https://img.shields.io/badge/License-GPL--3.0-blue" alt="License">
    <img src="https://img.shields.io/badge/Node-24-green" alt="Node">
    <img src="https://img.shields.io/badge/Platform-Android%20arm64-lightgrey" alt="Platform">
    <img src="https://img.shields.io/badge/Termux-0.118%2B-black" alt="Termux">
  </p>
</div>

本仓是宿主侧补丁集，不是官方支持的能力。dsh 官方不提供 `android-arm64` 构建；这里在安装目录之外做适配，并把每处适配做成可重放脚本，因为 `npm install -g` 会整体替换安装目录。

☕ 如果这个方向对你有用，可以 [请我喝杯奶茶](https://afdian.com/a/liumiaoqi)。

> **建议在能执行命令的 agent 辅助下完成移植。**
>
> 五处不兼容的判断依据全是**运行时的报错原文**，没有一份"照着做就对"的清单能让它们自动消失 —— 每解掉一处就要重跑一次命令看下一个错，中间还有好几次重启进程、比对输出。
> 教程给的是**验证过的路径**，不是一键脚本；路径之外的岔路（不同的 Android 版本、不同的 dsh 版本、不同的 shell）需要现场判断。
> 这也是本仓把机制、失败形态、判据写进 [参考](docs/reference.md) 的原因：**给人看，也给 agent 看**。

## 目标环境

| 项 | 实测值 |
|---|---|
| 机型 / 系统 | Xiaomi 2510ERA8BC，Android 16，aarch64，8 核 |
| 内存 | 11.6 GB（可用约 3.6 GB，swap 已用 7.5 GB） |
| 存储 | 464 GB，剩 41 GB |
| 运行时 | Termux 0.118.3，无 root，进程域 `untrusted_app_27` |
| 工具链 | node v24.22.1 / python 3.14.8 / clang 21.1.8 / git 2.56.0 / libvips 8.18.7 |
| dsh | `@deepseek-ai/dsh@0.2.2-alpha.2` |

这台机器只有 node、python、clang、vips；没有 R、Mathematica、MATLAB、julia、rustc、go、java、ffmpeg。

## 补丁清单

| 补丁 | 失效的机制 | 落点 | 安装器 |
|---|---|---|---|
| 原生模块 | `node-addon-require-builtin` 无 android 预编译包 | 安装目录 `node_modules/android-arm64/` | `build2.sh` → `install-addon.sh` |
| 文件锁 | `flock` 被平台门控拒绝 | dsh 依赖内 | `shim-flock.sh` |
| 硬链接 | Android 应用数据目录不支持 `link()` | `fs` 方法，`NODE_OPTIONS` 注入 | `android-fs-shim.cjs` |
| 图片解码 | `sharp` 无 android 构建 | 安装目录 `node_modules/sharp/` | `install-sharp-shim.sh` |
| 附件持久化 | `fsync` 到 `/data/data` 返回 `EACCES` | `dsh-attachment-local/lib/index.js` | `patch-attachment-durable.sh` |

安装器全部幂等。`upgrade.sh` 按上述顺序重放，并在最后列出安装目录里仍带 `is not supported on` 的包——那是下一个待处理的不兼容点。

逐处的机制、失败形态与判据见 [参考](docs/reference.md)；从零走通见 [教程](docs/tutorial.md)。

## 用法

```bash
# 首次安装：按 docs/tutorial.md 走（步骤 3~7 手动做，每步有验证判据）
# 以后升级：
bash ~/upgrade.sh <目标版本>
```

升级后必须重启进程。`NODE_OPTIONS` 与模块缓存都在启动时固定，不重启则补丁不生效：

```bash
pkill -f "dsh --profile" && cd ~ && nohup dsh --profile main --no-open >> ~/dsh-run.log 2>&1 &
```

⚠️ **`upgrade.sh` 尚未实测。** 本仓只在 `0.2.2-alpha.2` 上做过一次移植，没有任何一次真实升级记录（判据：`~/upgrade.log` 不存在，而脚本第一行就 `tee` 到该文件）。它把步骤 3~7 的动作串起来重放，**设计给重复执行用，不适合首次移植**——首次走教程手动做，出错才能定位。详见[教程该节](docs/tutorial.md#以后升级怎么办未实测)。

图片链路的端到端判据是产物尺寸变化：2446×3462 PNG 输入，落盘为 1721×2436 JPEG。尺寸不变即解码未真正发生，见 [参考 §4](docs/reference.md)。

## 已知限制

| 限制 | 后果 |
|---|---|
| `flock` 为 no-op | 同一工作区开两个 dsh 实例会写坏会话 JSONL |
| `link` 退化为 `copyFile` | 不再具备原子发布语义；大文件多一次完整拷贝 |
| 图片后端每张图起若干 vips 子进程 | 单次缩放编码约 0.48 s，未做常驻优化 |
| 只实现 dsh 实际用到的 sharp 接口面 | gif / avif / heif 直接抛错，不降级 |
| 版本钉在 `0.2.2-alpha.2` | dsh 升级后补丁可能失效，需重跑 `upgrade.sh` |

## 不是 fork

补丁落在安装目录之外（`~/shims`、`~/bin`）或可重放脚本里，不 fork dsh。代价是每次升级要跑一次 `upgrade.sh`，收益是不与上游合并冲突。

## 版本与 tag

**本仓没有自己的版本号**，它跟着 dsh 走。tag 名就是相配的 dsh 版本：

```
v0.2.2-alpha.2-bringup
   └─────┬─────┘ └──┬──┘
    dsh 版本号      标记含义
```

`-bringup` 指的是"这个 dsh 版本在这台机器上跑起来了"那一刻，不是本仓的发布版本。

**升级到别的 dsh 版本时新打一个 tag，不要移动旧 tag**（比如 `v0.2.3-bringup`）。移动 tag 会让别人手里的旧 tag 失效，而且可能指向已不在历史里的提交 —— 本次就踩过：历史重写后旧 tag 漂成了孤儿，`git describe` 直接报 `No tags can describe`。

## 文档

| 文档 | 类型 | 内容 |
|---|---|---|
| [docs/tutorial.md](docs/tutorial.md) | 教程 | 从裸 Termux 走到能解码图片，按顺序 |
| [docs/reference.md](docs/reference.md) | 参考 | 每个补丁的机制、失败形态、判据、代价 |
| [docs/phone-bringup-2026-10-29.md](docs/phone-bringup-2026-10-29.md) | 移植记录 | 首次移植时的现场记录，含当时的误判，保留不改 |

## 仓库里的其它文件

| 文件 | 说明 |
|---|---|
| `upgrade.sh` | 升级后按顺序重放全部补丁；参数是目标版本号 |
| `verify-dsh.sh` | 端到端检查：配置能组合、没有未激活条目。不依赖任何具体预设 |
| `probe.sh` | 排查用：列出 dsh 支持哪些 `--from-default-profile` 模板、现有 profile 挂了哪些 bundle |
| `examples/.bashrc` · `examples/.npmrc` · `examples/dsh-wrapper` | 本机实际在用的配置样例。**里面的绝对路径要改成你自己的**，`dsh-wrapper` 是给 `NODE_OPTIONS` 兜底的包装器 |
| `narb-src/…/require_builtin.node` | 已编好的 android-arm64 原生模块（约 96 KB），省去现场编译。**其它平台不能直接用**，要从源码编，见教程步骤 2 |

`build2.sh` 负责编译那个 `.node`，`install-addon.sh` 负责落位。两个都是幂等的。

## 许可

[GPL-3.0](LICENSE)。第三方组件（dsh、libvips、Node）各自遵循其原许可。
