#!/data/data/com.termux/files/usr/bin/bash
set -u
DSH_NM="$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules"
TARGET="$DSH_NM/android-arm64"
NODE_FILE="$HOME/narb-src/packages/native/build/Release/require_builtin.node"
PREBUILT="$HOME/narb-src/packages/native/build/Release/PREBUILT_FOR"

echo "=== 1. 检查源文件 ==="
ls -l "$NODE_FILE" || exit 1
echo "=== 2. 检查目标目录的父级 ==="
ls -d "$DSH_NM" || { echo "找不到 dsh 的 node_modules"; exit 1; }
ls -d "$DSH_NM/node-addon-require-builtin" 2>&1

echo "=== 2.5 版本校验（预编译产物 vs dsh 需求）==="
# dsh 用 `^`/`~` 这类松约束声明依赖，但 .node 是**编译产物**，ABI 与源码版本绑定，
# 不服从 semver 的兼容承诺 —— 所以这里取数字部分做**精确比对**，不做区间判断。
WANT=$(sed -n 's/.*"node-addon-require-builtin": *"[^0-9]*\([0-9][^"]*\)".*/\1/p' \
        "$PREFIX/lib/node_modules/@deepseek-ai/dsh/package.json" 2>/dev/null | head -1)
BUILT=$(sed -n 's/.*@[^0-9]*\([0-9][0-9.]*\).*/\1/p' "$PREBUILT" 2>/dev/null | head -1)

echo "  dsh 需要:     ${WANT:-（读不到 dsh 的 package.json）}"
echo "  产物编译自:   ${BUILT:-（缺 $PREBUILT）}"

if [ -z "$BUILT" ]; then
    echo "  ⛔ 无从判断这份 .node 是给哪个版本编的 —— 不装。"
    echo "     → 重跑 build2.sh（会重写 PREBUILT_FOR）；确知自己在做什么才用 ALLOW_ADDON_MISMATCH=1。"
    [ "${ALLOW_ADDON_MISMATCH:-0}" = "1" ] || exit 1
elif [ -n "$WANT" ] && [ "$WANT" != "$BUILT" ]; then
    echo "  ⛔ 版本不一致：dsh 要 $WANT，产物是 $BUILT。"
    echo "     硬装可能**静默**出错（加载成功但行为不对），所以默认拒绝。"
    echo "     → 重跑 build2.sh 重编；确知自己在做什么才用 ALLOW_ADDON_MISMATCH=1。"
    [ "${ALLOW_ADDON_MISMATCH:-0}" = "1" ] || exit 1
else
    echo "  ✔ 版本一致"
fi

echo "=== 3. 放置 ==="
mkdir -p "$TARGET"
cp "$NODE_FILE" "$TARGET/require_builtin.node"
# 写**真实**版本而不是硬编码，否则 dsh 升版后这个 package.json 会一直撒谎
cat > "$TARGET/package.json" <<EOF
{
  "name": "node-addon-require-builtin-android-arm64",
  "version": "${WANT:-$BUILT}",
  "private": true,
  "main": "require_builtin.node"
}
EOF
ls -la "$TARGET"

echo "=== 4. 单独 require 测试 ==="
node -e '
const m = require(process.argv[1]);
console.log("  导出:", Object.keys(m).join(", "));
if (typeof m.getNativeBindingInfo === "function") console.log("  bindingInfo:", JSON.stringify(m.getNativeBindingInfo()));
' "$TARGET" 2>&1

echo "=== 5. dsh --help 测试 ==="
timeout 60 dsh --profile main --help 2>&1 | head -12

echo "=== 完成 ==="
