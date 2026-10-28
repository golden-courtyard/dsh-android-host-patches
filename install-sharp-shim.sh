#!/data/data/com.termux/files/usr/bin/bash
# 在 android-arm64 上给 dsh 装一个能真正干活的 sharp：
# 官方没有 android 平台包，wasm 版会静默落到 passthrough shim（假成功），
# 所以用 libvips 命令行做后端。
set -u
D="$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules"
SHIMS="$HOME/shims"

echo "=== 0. 前置 ==="
command -v vips >/dev/null || { echo "缺少 vips：apt install libvips"; exit 1; }
vips --version
[ -f "$SHIMS/sharp/index.cjs" ] || { echo "缺少 $SHIMS/sharp/index.cjs"; exit 1; }
[ -f "$SHIMS/sharp-boot.cjs" ] || { echo "缺少 $SHIMS/sharp-boot.cjs"; exit 1; }

echo "=== 1. 备份官方 sharp（只备份一次）==="
if [ -d "$D/sharp" ] && [ ! -d "$D/sharp.orig" ]; then
    mv "$D/sharp" "$D/sharp.orig"
    echo "  已备份为 sharp.orig"
elif [ -d "$D/sharp.orig" ]; then
    echo "  备份已存在"
else
    echo "  ✗ 找不到 $D/sharp"
    exit 1
fi

echo "=== 2. 落位后端 ==="
rm -rf "$D/sharp"
cp -r "$SHIMS/sharp" "$D/sharp"
echo "  $(du -sh "$D/sharp" | cut -f1)"

echo "=== 3. 清掉会静默接管的 wasm 包 ==="
# @img/sharp-wasm32 在本机落到 sharp 自带 passthrough shim
# （versions.vips === "n/a-shim"），resize 原样返回输入，属于假成功。
rm -rf "$D/@img/sharp-wasm32" "$D/@emnapi/runtime" 2>/dev/null
echo "  @img 剩余: $(ls "$D/@img" 2>/dev/null | tr '\n' ' ')"

echo "=== 4. 检查 NODE_OPTIONS 指向 boot 钩子 ==="
if grep -q "shims/sharp-boot.cjs" "$HOME/.bashrc"; then
    echo "  .bashrc 已指向 shims/sharp-boot.cjs"
else
    echo "  ⚠ .bashrc 未指向新钩子，请手动改 NODE_OPTIONS 里的 --require"
    grep NODE_OPTIONS "$HOME/.bashrc"
fi

echo "=== 5. 端到端自测 ==="
cd "$SHIMS/sharp" || exit 1
IMG="${1:-$HOME/hub/reg-cert.png}"
if [ -f "$IMG" ]; then
    node selftest.cjs "$IMG"
else
    echo "  跳过：找不到测试图 $IMG"
fi

echo "=== 完成 ==="
echo "注意：dsh 进程必须重启才会加载新后端（NODE_OPTIONS 在进程启动时固定）。"
