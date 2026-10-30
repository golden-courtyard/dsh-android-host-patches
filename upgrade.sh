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
# ⛔ 别在这里再写一遍复制逻辑：与 install-addon.sh 重复，两处会漂。
#    版本校验也在那边（.node 是编译产物，不服从 semver 兼容承诺）。
if [ -f "$HOME/install-addon.sh" ]; then
    bash "$HOME/install-addon.sh" 2>&1 | tail -14
else
    echo "  失败：没有 install-addon.sh"
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

echo "=== 4.6 重放附件持久化补丁（/data/data 不可读）==="
if [ -f "$HOME/patch-attachment-durable.sh" ]; then
    bash "$HOME/patch-attachment-durable.sh" 2>&1 | tail -12
else
    echo "  失败：没有 patch-attachment-durable.sh"
fi

echo "=== 5. 检查 NODE_OPTIONS ==="
grep NODE_OPTIONS "$HOME/.bashrc" || echo "  失败：.bashrc 里没有 NODE_OPTIONS"

echo "=== 6. 还有没有别的平台门控包 ==="
grep -l "is not supported on" "$D"/@deepseek-ai/*/lib/*.js 2>/dev/null | sed "s|$D/||" | head -10
echo "  （上面这些是已知门控，见 reference/toolchain/2026-10-28-termux-phone.md）"

echo "=== 完成 ==="
echo "注意：dsh 进程必须重启才加载新后端。"
echo "  pkill -f 'dsh --profile' && cd ~ && nohup dsh --profile main --no-open > dsh-run.log 2>&1 &"
