#!/data/data/com.termux/files/usr/bin/bash
# 在手机上编译 node-addon-require-builtin（android-arm64）
set -u
cd "$HOME" || exit 1
LOG="$HOME/narb-build.log"
exec > >(tee "$LOG") 2>&1

echo "=== 1. 解包 ==="
rm -rf narb-src
mkdir -p narb-src
tar -xzf "$HOME/narb-src.tar.gz" -C narb-src --strip-components=1
ls narb-src/packages/ 2>&1

cd narb-src/packages/native || { echo "进不去"; exit 1; }
echo "  目录: $(pwd)"

echo "=== 2. 装 node-addon-api ==="
npm install node-addon-api --no-save 2>&1 | tail -4

echo "=== 3. 编译 ==="
npx --yes node-gyp rebuild --narb_product=require-builtin 2>&1 | tail -45

echo "=== 4. 产物 ==="
find "$HOME/narb-src" -name '*.node' 2>/dev/null
ls -la build/Release/ 2>&1 | head -8

echo "=== 完成 ==="
