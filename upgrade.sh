#!/data/data/com.termux/files/usr/bin/bash
# 升级 dsh 之后重放全部宿主补丁。
# npm install -g 会换掉整个安装目录，所以安装目录里的改动都要重放；
# ~/.dsh 与 ~/shims 不在安装目录内，不受影响。
set -u
LOG="$HOME/upgrade.log"
exec > >(tee "$LOG") 2>&1

VER="${1:-0.2.2-alpha.2}"
D="$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules"

echo "=== 0. 升级前版本 ==="
dsh --version

echo "=== 1. 装 $VER ==="
npm install -g "@deepseek-ai/dsh@$VER" --ignore-scripts 2>&1 | tail -6

echo "=== 2. 版本核对 ==="
dsh --version
echo "  需要的原生模块版本: $(node -e "console.log(require(process.env.PREFIX+'/lib/node_modules/@deepseek-ai/dsh/package.json').dependencies['node-addon-require-builtin'])" 2>&1)"

echo "=== 3. 重放原生模块（require_builtin.node）==="
mkdir -p "$D/android-arm64"
if [ -f "$HOME/narb-src/packages/native/build/Release/require_builtin.node" ]; then
    cp "$HOME/narb-src/packages/native/build/Release/require_builtin.node" "$D/android-arm64/"
    cat > "$D/android-arm64/package.json" <<'EOF'
{ "name": "node-addon-require-builtin-android-arm64", "version": "0.1.9",
  "private": true, "main": "require_builtin.node" }
EOF
    echo "  已放置 $(ls -l "$D/android-arm64/require_builtin.node" | awk '{print $5}') 字节"
else
    echo "  失败：找不到编好的 .node，需要先跑 build2.sh 重编"
fi

echo "=== 4. 重放 flock 替换 ==="
if [ -f "$HOME/shim-flock.sh" ]; then
    bash "$HOME/shim-flock.sh" 2>&1 | tail -8
else
    echo "  失败：没有 shim-flock.sh"
fi

echo "=== 4.5 重放 sharp 后端（libvips 命令行）==="
if [ -f "$HOME/install-sharp-shim.sh" ]; then
    bash "$HOME/install-sharp-shim.sh" 2>&1 | tail -20
else
    echo "  失败：没有 install-sharp-shim.sh"
fi

echo "=== 5. 检查 NODE_OPTIONS ==="
grep NODE_OPTIONS "$HOME/.bashrc" || echo "  失败：.bashrc 里没有 NODE_OPTIONS"

echo "=== 6. 还有没有别的平台门控包 ==="
grep -l "is not supported on" "$D"/@deepseek-ai/*/lib/*.js 2>/dev/null | sed "s|$D/||" | head -10
echo "  （上面这些是已知门控，见 reference/toolchain/2026-10-28-termux-phone.md）"

echo "=== 完成 ==="
echo "注意：dsh 进程必须重启才加载新后端。"
echo "  pkill -f 'dsh --profile' && cd ~ && nohup dsh --profile main --no-open > dsh-run.log 2>&1 &"
