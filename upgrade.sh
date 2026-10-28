#!/data/data/com.termux/files/usr/bin/bash
set -u
LOG="$HOME/upgrade.log"
exec > >(tee "$LOG") 2>&1

echo "=== 0. 升级前版本 ==="
dsh --version

echo "=== 1. 装 0.2.2-alpha.2 ==="
npm install -g '@deepseek-ai/dsh@0.2.2-alpha.2' --ignore-scripts 2>&1 | tail -6

echo "=== 2. 版本核对 ==="
dsh --version
node -e "console.log('addon 依赖:', require(process.env.PREFIX+'/lib/node_modules/@deepseek-ai/dsh/package.json').dependencies['node-addon-require-builtin'])"

echo "=== 3. 重放原生模块 ==="
D="$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules"
mkdir -p "$D/android-arm64"
if [ -f "$HOME/narb-src/packages/native/build/Release/require_builtin.node" ]; then
    cp "$HOME/narb-src/packages/native/build/Release/require_builtin.node" "$D/android-arm64/"
    cat > "$D/android-arm64/package.json" <<'EOF'
{ "name": "node-addon-require-builtin-android-arm64", "version": "0.1.9",
  "private": true, "main": "require_builtin.node" }
EOF
    echo "  已放置"
    ls -l "$D/android-arm64/"
else
    echo "  ✗ 找不到编好的 .node，需要重新编译"
fi

echo "=== 4. 重放 flock 替换 ==="
if [ -f "$HOME/shim-flock.sh" ]; then
    bash "$HOME/shim-flock.sh" 2>&1 | tail -8
else
    echo "  ✗ 没有 shim-flock.sh"
fi

echo "=== 5. 检查还有没有别的平台门控包 ==="
grep -l "is not supported on" "$D"/@deepseek-ai/*/lib/*.js 2>/dev/null | sed "s|$D/||" | head -10

echo "=== 完成 ==="
