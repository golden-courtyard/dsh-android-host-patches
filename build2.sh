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

echo "=== 5. 记下这份产物是给哪个源码版本编的 ==="
# ⛔ install-addon.sh 靠这个文件判断能不能装 —— 没有它就拒绝安装。
#    .node 是编译产物，ABI 与源码版本绑定；dsh 的 `^0.1.9` 是 semver 松约束，
#    对二进制不成立，所以必须留下**确切**版本。
VER=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json 2>/dev/null | head -1)
if [ -n "$VER" ]; then
    printf 'node-addon-require-builtin@%s\n' "$VER" > build/Release/PREBUILT_FOR
    echo "  已写 build/Release/PREBUILT_FOR → $(cat build/Release/PREBUILT_FOR)"
else
    echo "  ⛔ 读不到 package.json 的 version，PREBUILT_FOR 未生成"
    echo "     → install-addon.sh 会因此拒绝安装（这是有意的）"
fi

echo "=== 完成 ==="
