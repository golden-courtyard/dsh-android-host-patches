#!/data/data/com.termux/files/usr/bin/bash
set -u
DSH_NM="$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules"
TARGET="$DSH_NM/android-arm64"
NODE_FILE="$HOME/narb-src/packages/native/build/Release/require_builtin.node"

echo "=== 1. 检查源文件 ==="
ls -l "$NODE_FILE" || exit 1
echo "=== 2. 检查目标目录的父级 ==="
ls -d "$DSH_NM" || { echo "找不到 dsh 的 node_modules"; exit 1; }
ls -d "$DSH_NM/node-addon-require-builtin" 2>&1

echo "=== 3. 放置 ==="
mkdir -p "$TARGET"
cp "$NODE_FILE" "$TARGET/require_builtin.node"
cat > "$TARGET/package.json" <<'EOF'
{
  "name": "node-addon-require-builtin-android-arm64",
  "version": "0.1.9",
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
