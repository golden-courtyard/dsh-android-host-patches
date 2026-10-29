<div align="center">

  <h1>dsh-android-host-patches</h1>
  <sub><sup>把 DeepSeek Harness 装进一台无 root 的 Android 手机</sup></sub>

  <p>
    <img src="https://img.shields.io/badge/License-GPL--3.0-blue" alt="License">
    <img src="https://img.shields.io/badge/Node-24-green" alt="Node">
    <img src="https://img.shields.io/badge/Platform-Android%20arm64-lightgrey" alt="Platform">
    <img src="https://img.shields.io/badge/Termux-0.118%2B-black" alt="Termux">
    <img src="https://img.shields.io/badge/Status-自用验证中-yellow" alt="Status">
  </p>
</div>

> **这是宿主侧的补丁集，不是官方支持的能力。** dsh 官方没有 `android-arm64` 构建，
> 下面全部是在**安装目录之外**做的手工适配：编译原生模块、替换平台门控、
> 用 libvips 命令行顶掉 sharp 的原生 binding。
>
> ☕ 如果这个方向对你有用，可以 [请我喝杯奶茶](https://afdian.com/a/liumiaoqi)。

## 它能干什么

在一台 **无 root** 的 Android 16 手机（Xiaomi 2510ERA8BC / Termux / aarch64）上跑
`@deepseek-ai/dsh@0.2.2-alpha.2` 的 web 界面，并且**图片是真的解码、真的缩放、真的重编码** ——
不是那种"不报错但什么也没干"的假成功。

实测：2446×3462 的 PNG 读进来，归一化成 1721×2436 的 JPEG 落盘，565×800 缩略图 58 KB。

## 五道关卡

每一关都是"官方不支持 android-arm64"的不同变体。**解法都是可重放的脚本**，
因为 `npm install -g` 会整个换掉安装目录，手工改的东西下次升级就没了。

| # | 关卡 | 症状 | 解法 | 脚本 |
|---|---|---|---|---|
| 1 | `node-addon-require-builtin` 没有预编译包 | `Cannot find module` | 手机本地 `node-gyp` + clang 编出 96 KB 的 `.node` | `build2.sh` → `install-addon.sh` |
| 2 | `flock` 被平台门控拒绝 | 启动即报 unsupported | 换成 no-op（代价：跨进程文件锁没了） | `shim-flock.sh` |
| 3 | Android 不支持硬链接 | 会话日志 / 附件发布失败（`EACCES`） | `fs.link` 失败回退 `copyFile` | `android-fs-shim.cjs`（`NODE_OPTIONS` 注入） |
| 4 | `sharp` 没有 android 构建 | `Could not load the "sharp" module` | 用 `vips` CLI 做后端，只实现真正用到的接口面 | `install-sharp-shim.sh` |
| 5 | 附件写入 fsync 到 `/data/data` 失败 | 上传图片报 `EACCES` | `syncDirectory` 遇到 `EACCES/EPERM` 跳过，不整次失败 | `patch-attachment-durable.sh` |

**第 4 关有个大坑**：sharp 自带的 wasm 兜底会**静默落到 passthrough shim** ——
`metadata()` 返回正确宽高、`toBuffer()` 返回 Buffer、**一个错都不报**，
但 `versions.vips === "n/a-shim"`，`resize()` 之后字节数一模一样。
**不报错 ≠ 干了活。** 详见 [教程第 8 节](docs/tutorial.md)。

## 目录

```
bin/dsh                        启动包装
upgrade.sh                     升级后重放全部补丁（一条就够了）
build2.sh / install-addon.sh   关卡 1：编并装原生模块
shim-flock.sh                  关卡 2：flock → no-op
android-fs-shim.cjs            关卡 3：link → copyFile 兜底
shims/sharp/                   关卡 4：libvips CLI 后端（含 selftest）
install-sharp-shim.sh          关卡 4 的安装器（幂等）
patch-attachment-durable.sh    关卡 5：fsync 越权跳过
verify-dsh.sh                  验证清单
probe.sh / rate.sh             仪器：抓子进程 / 测传感器采样率
dsh-presets-phone/             手机侧的两个 dsh 预设（delivery / sec-assessment）
sync/phone-share/              移植过程的原始记录（含当时的误判，保留不删）
```

## 用法

```bash
# 首次：按 docs/tutorial.md 走一遍五关
# 升级 dsh 之后：一条命令重放
bash ~/upgrade.sh 0.2.2-alpha.2
```

升级完**必须重启 dsh 进程** —— `NODE_OPTIONS` 和模块缓存都在启动时固定：

```bash
pkill -f "dsh --profile" && cd ~ && nohup dsh --profile main --no-open >> ~/dsh-run.log 2>&1 &
```

## 已知限制

| 限制 | 后果 | 能忍吗 |
|---|---|---|
| `flock` 是 no-op | 同一工作区开两个 dsh 实例会写坏 JSONL | 单实例使用，能忍 |
| 硬链接退化成 `copyFile` | 不再有"原子发布"语义；大文件多一次拷贝 | 能忍 |
| sharp 后端每张图起若干子进程 | 单次缩放编码约 0.48 s | 手机单用户，能忍 |
| 只实现了真正用到的接口面 | gif / avif / heif **直接抛错**，不静默降级 | 能忍 |
| 存储是硬约束 | 实测机 464 GB 用了 92%，剩 41 GB | 看你机器 |

**没有做的**：常驻的 sharp 服务、`flock` 的真实实现、其它平台门控。
这些都能做，但当前场景不值得。

## 状态

**个人项目，仍在自用验证阶段，暂未公开。** 计划在使用一段时间、积累更多迁移与改装经验之后开源。

在那之前，仓库里的东西是"在我这台机器上跑通了"的记录，不是"拿去就能用"的产品：

- 脚本里的路径全是 Termux 的（`/data/data/com.termux/files/home`）
- 版本号钉在 `0.2.2-alpha.2`，dsh 升级后可能失效
- 没有 CI，验证靠 `verify-dsh.sh` 手跑

## 不是 fork

没有 fork dsh —— 补丁全部落在**安装目录之外**（`~/shims`、`~/bin`）或**可重放的脚本**里。
这样 dsh 升级时不会跟上游打架，代价是每次升级要跑一次 `upgrade.sh`。

`upgrade.sh` 里有一句自检值得留着：它会把安装目录里所有
`is not supported on` 的门控包列出来 —— 那是下一个要打的关卡的清单。

## 许可

[GPL-3.0](LICENSE)。

第三方组件（dsh 本身、libvips、Node）各自遵循其原许可。
