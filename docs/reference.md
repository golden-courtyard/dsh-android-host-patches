# 参考：每个补丁的机制、失败形态与判据

按 dsh 安装目录的改动位置分组。操作顺序见 [教程](tutorial.md)；首次移植的现场记录见 [`sync/phone-share/`](../sync/phone-share/)。

## 1. 原生模块 `node-addon-require-builtin`

`node-addon-require-builtin` 是 dsh 的运行时依赖，npm 只发布 linux / darwin / win32 的预编译包。dsh 按 `node_modules/android-arm64/` 这个约定路径加载它，因此把本地编译的产物放到该路径即可，不需要改 dsh 代码。

失败形态：`Cannot find module '.../node_modules/android-arm64/require_builtin.node'`。

`install-addon.sh` 除了复制 `.node`，还会写一个 `package.json` 声明包名与入口；缺少它时 Node 的解析会退化到目录查找并失败。

产物 96 KB，由 `build2.sh` 用 `node-gyp` + clang 21 编译。本仓已包含该产物（`narb-src/packages/native/build/Release/require_builtin.node`），构建树整体被 `.gitignore` 排除，仅此文件被强制纳入版本控制。

## 2. `flock`

dsh 用 `flock` 做工作区级的跨进程互斥。该 API 在 Android 上被平台门控拒绝，`shim-flock.sh` 将其替换为 no-op。

代价是跨进程文件锁不存在。同一工作区同时运行两个 dsh 实例会并发写会话 JSONL 并破坏内容。这条不是性能建议，是数据完整性约束：单实例运行是必须的。

## 3. 硬链接

Android 的应用数据目录不允许硬链接，`ln` 与 `fs.link` 均返回 `EACCES`。dsh 有两处依赖 `link()` 做原子发布：`dsh-session-persistence-jsonl` 写会话日志，`dsh-attachment-local` 发布附件对象。

`android-fs-shim.cjs` 经 `NODE_OPTIONS --require` 注入，把失败的 `fs.link*` 回退为 `fs.copyFile`。

回退必须是 `copyFile` 而不是 `rename`。调用方的惯用法是 `link(src, dst)` 之后自行 `unlink(src)`；`rename` 已经把 `src` 移走，后续 `unlink(src)` 会返回 `ENOENT`，把调用方的流程打断。这是本仓唯一一处"选错回退方式会破坏上层逻辑"的地方。

代价：不再有原子发布语义。`copyFile` 中途失败会留下部分写入的目标文件，而 `link` 不会。

`NODE_OPTIONS` 在进程启动时读取，对已运行的 shell 与已启动的进程均不生效。

## 4. 图片解码（`sharp`）

dsh 通过 `sharp` 处理附件图片。npm 上没有 `@img/sharp-android-arm64`，sharp 不发布 android 构建。

### 4.1 不可用的两条路径

官方平台包不存在。原生编译不可行：Termux 的 libvips 不提供 `vips-cpp.h`，而 sharp 的 `src/*.cc` 需要它。

wasm32 路径可用但无效。sharp 自带 wasm 兜底分支，装上后不报错，但实际落到 passthrough 实现，返回输入而不做任何像素处理。

### 4.2 判定假成功

以下三条同时成立即说明走的是 passthrough，不是真实解码：

```
sharp.versions.vips === "n/a-shim"
versions 里存在 sharp: "shim" 字段
resize({width:800}) 后的 toBuffer() 长度等于输入字节数，magic 不变
```

不报错不能作为判据。这类实现的行为特征是"所有元数据正确、输出正确、只有像素没变"。

### 4.3 采用的实现

Termux 源提供 libvips 8.18.7，与 sharp 0.35.5 声明的 `minimumLibvipsVersion` 相同。因此不编译原生 binding，改用 vips 命令行做像素后端。

`shims/sharp/index.cjs` 只实现 dsh 实际调用到的接口面。接口面由源码确定，`dsh-attachment-local` 对 sharp 的调用为：

```
resize ×2   toColourspace ×2   toBuffer ×2   webp ×1
rotate ×1   raw ×1             metadata ×1   jpeg ×1   clone ×1
```

像素工作交给 `vips` / `vipsheader` / `rawsave` / `thumbnail` 子进程。

未实现的格式（gif / avif / heif）直接抛错。降级会重新引入 4.2 的问题，因此不做。

### 4.4 生效条件

该后端通过替换安装目录内的 `node_modules/sharp` 生效，不经 `NODE_OPTIONS` 注入。`install-sharp-shim.sh` 会删除 `@img/sharp-wasm32` 与 `@emnapi/runtime`；残留这些包时 wasm 兜底会接管，问题不可见。

`shims/sharp-boot.cjs` 是早期的模块加载钩子方案，保留在仓库中但不被引用。替换 `node_modules/sharp` 是被实证有效的机制，钩子方案未再使用。

### 4.5 性能

单次缩放编码约 0.48 s，由两次 vips 子进程构成。每次调用起独立子进程，无常驻服务。单用户场景下不需要优化；批量处理图片时需要另做常驻方案。

## 5. 附件持久化

`ensureDurableHome` 从 `DSH_HOME` 沿目录树向上 `fsync` 到文件系统根。`/data/data` 这一层属 system，对 Termux 不可读，`open` 直接返回 `EACCES`，导致整次附件写入失败。

`patch-attachment-durable.sh` 修改 `dsh-attachment-local/lib/index.js` 的 `syncDirectory`：`open` 失败且错误码为 `EACCES` 或 `EPERM` 时跳过该层并继续，不使整个操作失败。

语义与其它补丁一致：无法担保的祖先目录不担保，而不是让整个写入失败。

该补丁直接修改安装目录内的文件，因此必须可重放。脚本在替换前校验目标字符串命中次数恰好为 1，不为 1 即放弃；替换后执行 `node --check`。

## 6. 重放与生效

`npm install -g` 整体替换安装目录，落在安装目录内的改动（补丁 1、2、4、5）在升级后丢失。`~/.dsh` 与 `~/shims` 不在安装目录内，补丁 3 因此在升级中保留。

`upgrade.sh` 按 1 → 2 → 4 → 5 的顺序重放，并在结束时检查 `NODE_OPTIONS` 与列出剩余门控包。

所有补丁在进程重启后才生效。`NODE_OPTIONS` 与模块缓存都在启动时固定。

## 7. 找出下一个不兼容点

```bash
grep -l "is not supported on" \
  $PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*/lib/*.js
```

输出中每一行是一个带平台门控的包，也是下一个可能需要适配的点。这条比等待运行时报错更早暴露范围：报错只在执行到对应路径时出现，grep 能一次列出全部门控点。

## 8. 未验证项

- 上传通道的 `401 unauthorized`：与图片后端无关，未排查
- 本地模型推理（`qwen05.gguf`，470 MB）：从未启动
- 除本机外的其它 aarch64 设备与 Android 版本：未测试
