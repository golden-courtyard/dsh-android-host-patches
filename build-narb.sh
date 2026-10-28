#!/data/data/com.termux/files/usr/bin/bash
# 从源码编译 node-addon-require-builtin 的 android-arm64 版本
set -u

cd "$HOME" || exit 1
LOG="$HOME/narb-build.log"
exec > >(tee "$LOG") 2>&1

echo "=== 1. 拉源码 ==="
rm -rf narb-src
git clone --depth 1 https://github.com/deepseek-ai/dsh-node-addon-require-builtin narb-src 2>&1 | tail -5
cd narb-src/packages/native || { echo "进不去 packages/native"; exit 1; }
echo "  当前目录: $(pwd)"
ls

echo "=== 2. 装 node-addon-api ==="
npm install node-addon-api --no-save 2>&1 | tail -4

echo "=== 3. 编译（可能几分钟）==="
npx node-gyp rebuild --narb_product=require-builtin 2>&1 | tail -40

echo "=== 4. 产物 ==="
find . -name '*.node' -newermt '-10 minutes' 2>/dev/null
ls -la build/Release/ 2>&1 | head -10

echo "=== 完成 ==="
